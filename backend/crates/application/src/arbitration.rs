use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::{OnChainEventType, VerifiedChainEvent};
use safedeal_domain::deal::{BlockchainTransaction, Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::{AuditLogEntry, Dispute, DisputeStatus, DisputeVote, VoterRole};
use safedeal_domain::ports::{in_tx, BlockchainGateway, TxRepos, UnitOfWork};
use safedeal_shared::{CorrelationIdContext, DomainError, EthFormatValidator};

use crate::disputes::DisputeWithDeal;

pub struct ArbitrationUseCase {
    uow: Arc<dyn UnitOfWork>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
}

impl ArbitrationUseCase {
    pub fn new(uow: Arc<dyn UnitOfWork>, blockchain_gateway: Arc<dyn BlockchainGateway>) -> Self {
        Self {
            uow,
            blockchain_gateway,
        }
    }

    pub async fn list_assigned_disputes(
        &self,
        arbiter_address: &str,
    ) -> Result<Vec<DisputeWithDeal>, DomainError> {
        let arbiter = EthFormatValidator::require_address(Some(arbiter_address), "arbiterAddress")?;
        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let disputes = repos.disputes().find_assigned_to_arbiter(&arbiter).await?;
                if disputes.is_empty() {
                    return Ok(Vec::new());
                }
                let trade_ids: Vec<String> = disputes.iter().map(|d| d.trade_id.clone()).collect();
                let dispute_ids: Vec<i64> = disputes.iter().filter_map(|d| d.id).collect();
                let deals = repos.deals().find_by_trade_ids(&trade_ids).await?;
                let mut votes_by_dispute_id = repos
                    .dispute_votes()
                    .find_by_dispute_ids(&dispute_ids)
                    .await?;
                let mut deals_by_trade_id: HashMap<String, Deal> = deals
                    .into_iter()
                    .map(|deal| (deal.trade_id.to_ascii_lowercase(), deal))
                    .collect();

                let mut result = Vec::with_capacity(disputes.len());
                for dispute in disputes {
                    let deal = deals_by_trade_id
                        .remove(&dispute.trade_id.to_ascii_lowercase())
                        .ok_or_else(|| {
                            DomainError::not_found(format!(
                                "Deal not found for dispute {}",
                                dispute.id.unwrap_or_default()
                            ))
                        })?;
                    let votes = dispute
                        .id
                        .and_then(|id| votes_by_dispute_id.remove(&id))
                        .unwrap_or_default();
                    result.push(DisputeWithDeal {
                        dispute,
                        deal,
                        votes,
                    });
                }
                Ok(result)
            })
        })
        .await
    }

    pub async fn record_resolution(
        &self,
        dispute_id: i64,
        arbiter_address: &str,
        raw_tx_hash: &str,
        rationale: &str,
    ) -> Result<DisputeWithDeal, DomainError> {
        let caller = EthFormatValidator::require_address(Some(arbiter_address), "arbiterAddress")?;
        let tx_hash = EthFormatValidator::require_bytes32(Some(raw_tx_hash), "txHash")?;
        let trimmed_rationale = rationale.trim().to_string();
        let char_len = trimmed_rationale.chars().count();
        if !(10..=4000).contains(&char_len) {
            return Err(DomainError::validation(
                "Arbitration rationale must be between 10 and 4000 characters.",
            ));
        }

        // Phase 1: Authorize & check idempotency / rationale backfill in short tx
        let caller_p1 = caller.clone();
        let tx_hash_p1 = tx_hash.clone();
        let rationale_p1 = trimmed_rationale.clone();
        let correlation_id_p1 = CorrelationIdContext::get_or_default("n/a");
        let now_p1 = Utc::now();
        let (already_resolved, ctx) = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let initial_dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                let deal = repos
                    .deals()
                    .find_by_trade_id_for_update(&initial_dispute.trade_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!(
                            "Deal not found: {}",
                            initial_dispute.trade_id
                        ))
                    })?;
                let dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                if !deal.arbiter.eq_ignore_ascii_case(&caller_p1) {
                    return Err(DomainError::forbidden(
                        "Only the deal's designated arbiter may record settlement.",
                    ));
                }
                if dispute.status == DisputeStatus::Resolved {
                    if dispute
                        .resolve_tx_hash
                        .as_deref()
                        .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash_p1))
                    {
                        if dispute
                            .resolution_rationale
                            .as_deref()
                            .is_none_or(|r| r.trim().is_empty())
                        {
                            let mut with_rationale = dispute;
                            with_rationale.resolution_rationale = Some(rationale_p1);
                            let saved = repos.disputes().save(&with_rationale).await?;
                            repos
                                .audit_logs()
                                .append(&AuditLogEntry {
                                    id: None,
                                    action: "ARBITRATION_RATIONALE_BACKFILLED".to_string(),
                                    actor_address: Some(caller_p1),
                                    resource_type: "DISPUTE".to_string(),
                                    resource_id: dispute_id.to_string(),
                                    correlation_id: Some(correlation_id_p1),
                                    details: format!(
                                        "Backfilled arbitration rationale for tradeId={} txHash={tx_hash_p1}",
                                        deal.trade_id
                                    ),
                                    created_at: now_p1,
                                })
                                .await?;
                            let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                            return Ok((
                                true,
                                DisputeWithDeal {
                                    dispute: saved,
                                    deal,
                                    votes,
                                },
                            ));
                        }
                        let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                        return Ok((
                            true,
                            DisputeWithDeal {
                                dispute,
                                deal,
                                votes,
                            },
                        ));
                    }
                    return Err(DomainError::conflict("Dispute has already been resolved."));
                }
                let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                Ok((
                    false,
                    DisputeWithDeal {
                        dispute,
                        deal,
                        votes,
                    },
                ))
            })
        })
        .await?;

        if already_resolved {
            return Ok(ctx);
        }

        if !self.blockchain_gateway.is_enabled() {
            return Err(DomainError::external_service(
                "Blockchain verification is disabled; cannot verify dispute settlement.",
            ));
        }

        // Phase 2: Verify settlement receipt, awards sum, and decoded DisputeResolved OUTSIDE DB transaction
        let receipt = self
            .blockchain_gateway
            .inspect_transaction(&tx_hash)
            .await?
            .ok_or_else(|| {
                DomainError::validation(format!(
                    "Resolution transaction receipt not found or pending: {tx_hash}"
                ))
            })?;
        if !receipt.succeeded {
            return Err(DomainError::validation(format!(
                "Resolution transaction reverted on-chain: {tx_hash}"
            )));
        }

        let resolved_event = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::DisputeResolved
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&ctx.deal.trade_id))
            })
            .cloned()
            .ok_or_else(|| {
                DomainError::validation(
                    "Transaction receipt does not emit DisputeResolved for this trade.",
                )
            })?;

        let buyer_award = EthFormatValidator::require_non_negative_wei(
            resolved_event.buyer_award_wei.as_deref(),
            "buyerAwardWei",
        )?;
        let seller_award = EthFormatValidator::require_non_negative_wei(
            resolved_event.seller_award_wei.as_deref(),
            "sellerAwardWei",
        )?;
        let expected_total =
            EthFormatValidator::require_positive_wei(Some(&ctx.deal.amount_wei), "amountWei")?;
        if buyer_award.checked_add(seller_award) != Some(expected_total) {
            return Err(DomainError::validation(
                "On-chain split settlement does not sum to locked escrow amount.",
            ));
        }

        let snapshot = self
            .blockchain_gateway
            .fetch_trade(&ctx.deal.trade_id)
            .await?
            .ok_or_else(|| {
                DomainError::external_service("Unable to fetch on-chain trade after resolution.")
            })?;
        if snapshot.to_deal_status()? != DealStatus::Resolved {
            return Err(DomainError::validation(
                "On-chain trade status is not RESOLVED.",
            ));
        }

        // Phase 3: Atomic persistence commit under FOR UPDATE lock
        let trade_id = ctx.deal.trade_id;
        let now = Utc::now();
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let buyer_award_str = buyer_award.to_string();
        let seller_award_str = seller_award.to_string();

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current_deal = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
                let current_dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;

                if current_dispute.status == DisputeStatus::Resolved {
                    if !current_dispute
                        .resolve_tx_hash
                        .as_deref()
                        .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash))
                    {
                        return Err(DomainError::conflict("Dispute has already been resolved."));
                    }
                    if current_dispute
                        .resolution_rationale
                        .as_deref()
                        .is_none_or(|r| r.trim().is_empty())
                    {
                        let mut with_rationale = current_dispute;
                        with_rationale.resolution_rationale = Some(trimmed_rationale);
                        let saved = repos.disputes().save(&with_rationale).await?;
                        repos
                            .audit_logs()
                            .append(&AuditLogEntry {
                                id: None,
                                action: "ARBITRATION_RATIONALE_BACKFILLED".to_string(),
                                actor_address: Some(caller),
                                resource_type: "DISPUTE".to_string(),
                                resource_id: dispute_id.to_string(),
                                correlation_id: Some(correlation_id),
                                details: format!(
                                    "Backfilled arbitration rationale for tradeId={trade_id} txHash={tx_hash}"
                                ),
                                created_at: now,
                            })
                            .await?;
                        let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                        return Ok(DisputeWithDeal {
                            dispute: saved,
                            deal: current_deal,
                            votes,
                        });
                    }
                    let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                    return Ok(DisputeWithDeal {
                        dispute: current_dispute,
                        deal: current_deal,
                        votes,
                    });
                }

                settle_dispute_in_tx(
                    repos,
                    current_deal,
                    current_dispute,
                    &resolved_event,
                    receipt.block_number,
                    &tx_hash,
                    &caller,
                    &buyer_award_str,
                    &seller_award_str,
                    trimmed_rationale,
                    &correlation_id,
                    now,
                    "RESOLVE_DISPUTE",
                    format!(
                        "Arbiter split resolution recorded: buyer={buyer_award_str} seller={seller_award_str}"
                    ),
                )
                .await
            })
        })
        .await
    }

    /// Records a 2-of-3 settlement vote submitted on-chain by Buyer, Seller, or Arbiter.
    /// If the transaction also reached 2-of-3 consensus and emitted `DisputeResolved`, settles atomically.
    pub async fn record_vote(
        &self,
        dispute_id: i64,
        caller_address: &str,
        raw_tx_hash: &str,
        optional_rationale: Option<&str>,
    ) -> Result<DisputeWithDeal, DomainError> {
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        let tx_hash = EthFormatValidator::require_bytes32(Some(raw_tx_hash), "txHash")?;
        let trimmed_rationale = optional_rationale
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if let Some(ref r) = trimmed_rationale {
            let char_len = r.chars().count();
            if char_len > 4000 {
                return Err(DomainError::validation(
                    "Vote rationale must not exceed 4000 characters.",
                ));
            }
        }

        // Phase 1: Verify caller role in short tx
        let caller_p1 = caller.clone();
        let (ctx, voter_role) = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                let deal = repos
                    .deals()
                    .find_by_trade_id(&dispute.trade_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Deal not found: {}", dispute.trade_id))
                    })?;
                let role = resolve_voter_role(&deal, &caller_p1)?;
                if role == VoterRole::Arbiter {
                    if let Some(ref r) = trimmed_rationale {
                        if r.chars().count() < 10 {
                            return Err(DomainError::validation(
                                "Arbitration rationale must be at least 10 characters.",
                            ));
                        }
                    }
                }
                let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                Ok((
                    DisputeWithDeal {
                        dispute,
                        deal,
                        votes,
                    },
                    role,
                ))
            })
        })
        .await?;

        let is_idempotent_resolved_tx = ctx.dispute.status == DisputeStatus::Resolved
            && (ctx
                .dispute
                .resolve_tx_hash
                .as_deref()
                .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash))
                || ctx.votes.iter().any(|v| {
                    v.voter_address.eq_ignore_ascii_case(&caller)
                        && v.tx_hash.eq_ignore_ascii_case(&tx_hash)
                }));
        if ctx.dispute.status == DisputeStatus::Resolved && !is_idempotent_resolved_tx {
            return Err(DomainError::conflict("Dispute has already been resolved."));
        }

        if !self.blockchain_gateway.is_enabled() {
            return Err(DomainError::external_service(
                "Blockchain verification is disabled; cannot verify dispute vote.",
            ));
        }

        // Phase 2: Inspect transaction receipt OUTSIDE DB transaction
        let receipt = self
            .blockchain_gateway
            .inspect_transaction(&tx_hash)
            .await?
            .ok_or_else(|| {
                DomainError::validation(format!(
                    "Vote transaction receipt not found or pending: {tx_hash}"
                ))
            })?;
        if !receipt.succeeded {
            return Err(DomainError::validation(format!(
                "Vote transaction reverted on-chain: {tx_hash}"
            )));
        }

        let vote_event = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::DisputeVoteSubmitted
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&ctx.deal.trade_id))
                    && ev
                        .actor_address
                        .as_deref()
                        .is_some_and(|a| a.eq_ignore_ascii_case(&caller))
            })
            .cloned()
            .ok_or_else(|| {
                DomainError::validation(
                    "Transaction receipt does not emit DisputeVoteSubmitted for this caller and trade.",
                )
            })?;

        let buyer_award = EthFormatValidator::require_non_negative_wei(
            vote_event.buyer_award_wei.as_deref(),
            "buyerAwardWei",
        )?;
        let seller_award = EthFormatValidator::require_non_negative_wei(
            vote_event.seller_award_wei.as_deref(),
            "sellerAwardWei",
        )?;
        let expected_total =
            EthFormatValidator::require_positive_wei(Some(&ctx.deal.amount_wei), "amountWei")?;
        if buyer_award.checked_add(seller_award) != Some(expected_total) {
            return Err(DomainError::validation(
                "On-chain vote allocation does not sum to locked escrow amount.",
            ));
        }
        let proposal_hash = EthFormatValidator::require_bytes32(
            vote_event.proposal_hash.as_deref(),
            "proposalHash",
        )?;

        let resolved_event_opt = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::DisputeResolved
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&ctx.deal.trade_id))
            })
            .cloned();

        if let Some(ref resolved_ev) = resolved_event_opt {
            let resolved_buyer = EthFormatValidator::require_non_negative_wei(
                resolved_ev.buyer_award_wei.as_deref(),
                "buyerAwardWei",
            )?;
            let resolved_seller = EthFormatValidator::require_non_negative_wei(
                resolved_ev.seller_award_wei.as_deref(),
                "sellerAwardWei",
            )?;
            if resolved_buyer.checked_add(resolved_seller) != Some(expected_total) {
                return Err(DomainError::validation(
                    "On-chain split settlement does not sum to locked escrow amount.",
                ));
            }
            if let Some(snapshot) = self
                .blockchain_gateway
                .fetch_trade(&ctx.deal.trade_id)
                .await?
            {
                if snapshot.to_deal_status()? != DealStatus::Resolved {
                    return Err(DomainError::validation(
                        "On-chain trade status is not RESOLVED.",
                    ));
                }
                if !snapshot.seller.eq_ignore_ascii_case(&ctx.deal.seller)
                    || !snapshot.arbiter.eq_ignore_ascii_case(&ctx.deal.arbiter)
                    || snapshot.amount_wei != ctx.deal.amount_wei
                {
                    return Err(DomainError::validation(
                        "On-chain trade parameters mismatch canonical deal record.",
                    ));
                }
            }
        }

        // Phase 3: Persist vote and (if 2-of-3 reached) settlement atomically
        let trade_id = ctx.deal.trade_id;
        let now = Utc::now();
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let buyer_award_str = buyer_award.to_string();
        let seller_award_str = seller_award.to_string();
        let vote_rationale = optional_rationale
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current_deal = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
                let current_dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                let prior_votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                if current_dispute.status == DisputeStatus::Resolved {
                    let is_matching_resolved_tx = current_dispute
                        .resolve_tx_hash
                        .as_deref()
                        .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash))
                        || prior_votes.iter().any(|v| {
                            v.voter_address.eq_ignore_ascii_case(&caller)
                                && v.tx_hash.eq_ignore_ascii_case(&tx_hash)
                        });
                    if !is_matching_resolved_tx {
                        return Err(DomainError::conflict("Dispute has already been resolved."));
                    }
                }

                let vote_time = DateTime::from_timestamp(vote_event.block_timestamp_epoch, 0)
                    .unwrap_or(now);
                repos
                    .dispute_votes()
                    .upsert_vote(&DisputeVote {
                        id: None,
                        dispute_id,
                        trade_id: trade_id.clone(),
                        voter_address: caller.clone(),
                        voter_role,
                        buyer_award_wei: buyer_award_str.clone(),
                        seller_award_wei: seller_award_str.clone(),
                        proposal_hash: proposal_hash.clone(),
                        rationale: vote_rationale.clone(),
                        tx_hash: tx_hash.clone(),
                        updated_at: vote_time,
                    })
                    .await?;

                repos.chain_events().record_if_absent(&vote_event).await?;
                repos
                    .deal_events()
                    .save_if_absent(&DealEvent {
                        id: None,
                        trade_id: trade_id.clone(),
                        event_type: OnChainEventType::DisputeVoteSubmitted.as_str().to_string(),
                        actor_address: Some(caller.clone()),
                        tx_hash: Some(tx_hash.clone()),
                        block_number: Some(receipt.block_number),
                        log_index: Some(vote_event.log_index),
                        details: format!(
                            "{} voted split: buyer={} seller={}",
                            voter_role.as_str(),
                            buyer_award_str,
                            seller_award_str
                        ),
                        created_at: vote_time.max(current_deal.created_at),
                    })
                    .await?;

                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "DISPUTE_VOTE_SUBMITTED".to_string(),
                        actor_address: Some(caller.clone()),
                        resource_type: "DISPUTE".to_string(),
                        resource_id: dispute_id.to_string(),
                        correlation_id: Some(correlation_id.clone()),
                        details: format!(
                            "Recorded 2-of-3 vote ({}) txHash={tx_hash} buyerWei={buyer_award_str} sellerWei={seller_award_str}",
                            voter_role.as_str()
                        ),
                        created_at: now,
                    })
                    .await?;

                let updated_dispute = if let Some(resolved_ev) = resolved_event_opt {
                    if current_dispute.status == DisputeStatus::Open {
                        let existing_votes =
                            repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                        let arbiter_proposal_rationale = existing_votes
                            .iter()
                            .find(|v| {
                                v.voter_role == VoterRole::Arbiter
                                    && v.proposal_hash.eq_ignore_ascii_case(&proposal_hash)
                            })
                            .and_then(|v| v.rationale.clone());
                        let consensus_rationale = if voter_role == VoterRole::Arbiter {
                            vote_rationale.or(arbiter_proposal_rationale)
                        } else {
                            arbiter_proposal_rationale.or(vote_rationale)
                        }
                        .unwrap_or_else(|| {
                            format!(
                                "2-of-3 multi-party consensus finalized by {} co-signature.",
                                voter_role.as_str()
                            )
                        });
                        return settle_dispute_in_tx(
                            repos,
                            current_deal,
                            current_dispute,
                            &resolved_ev,
                            receipt.block_number,
                            &tx_hash,
                            &caller,
                            &buyer_award_str,
                            &seller_award_str,
                            consensus_rationale,
                            &correlation_id,
                            now,
                            "SUBMIT_RESOLUTION_VOTE",
                            format!(
                                "2-of-3 consensus reached: buyer={buyer_award_str} seller={seller_award_str}"
                            ),
                        )
                        .await;
                    } else if current_dispute.status == DisputeStatus::Resolved
                        && current_dispute
                            .resolution_rationale
                            .as_deref()
                            .is_none_or(|r| r.trim().is_empty())
                        && current_dispute
                            .resolve_tx_hash
                            .as_deref()
                            .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash))
                    {
                        if let Some(rationale_text) = vote_rationale {
                            repos
                                .disputes()
                                .save(&Dispute {
                                    resolution_rationale: Some(rationale_text),
                                    ..current_dispute
                                })
                                .await?
                        } else {
                            current_dispute
                        }
                    } else {
                        current_dispute
                    }
                } else {
                    current_dispute
                };

                let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                Ok(DisputeWithDeal {
                    dispute: updated_dispute,
                    deal: current_deal,
                    votes,
                })
            })
        })
        .await
    }

    /// Verifies and persists a permissionless 14-day stalemate timeout 50/50 resolution.
    pub async fn record_timeout_resolution(
        &self,
        dispute_id: i64,
        caller_address: &str,
        raw_tx_hash: &str,
    ) -> Result<DisputeWithDeal, DomainError> {
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        let tx_hash = EthFormatValidator::require_bytes32(Some(raw_tx_hash), "txHash")?;

        let caller_p1 = caller.clone();
        let ctx = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                let deal = repos
                    .deals()
                    .find_by_trade_id(&dispute.trade_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Deal not found: {}", dispute.trade_id))
                    })?;
                if !deal.is_participant_or_arbiter(Some(&caller_p1)) {
                    return Err(DomainError::forbidden(
                        "Only deal parties or the assigned arbiter may record timeout settlement.",
                    ));
                }
                let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                Ok(DisputeWithDeal {
                    dispute,
                    deal,
                    votes,
                })
            })
        })
        .await?;

        let has_rationale = ctx
            .dispute
            .resolution_rationale
            .as_deref()
            .is_some_and(|r| !r.trim().is_empty());
        if ctx.dispute.status == DisputeStatus::Resolved && has_rationale {
            return Ok(ctx);
        }

        if !self.blockchain_gateway.is_enabled() {
            return Err(DomainError::external_service(
                "Blockchain verification is disabled; cannot verify timeout settlement.",
            ));
        }

        let receipt = self
            .blockchain_gateway
            .inspect_transaction(&tx_hash)
            .await?
            .ok_or_else(|| {
                DomainError::validation(format!(
                    "Timeout transaction receipt not found or pending: {tx_hash}"
                ))
            })?;
        if !receipt.succeeded {
            return Err(DomainError::validation(format!(
                "Timeout transaction reverted on-chain: {tx_hash}"
            )));
        }

        let timeout_ev = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::DisputeResolvedByTimeout
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&ctx.deal.trade_id))
            })
            .cloned()
            .ok_or_else(|| {
                DomainError::validation(
                    "Transaction receipt does not emit DisputeResolvedByTimeout for this trade.",
                )
            })?;

        let resolved_ev = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::DisputeResolved
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&ctx.deal.trade_id))
            })
            .cloned()
            .ok_or_else(|| {
                DomainError::validation(
                    "Transaction receipt does not emit DisputeResolved for this trade.",
                )
            })?;

        let buyer_award = EthFormatValidator::require_non_negative_wei(
            timeout_ev.buyer_award_wei.as_deref(),
            "buyerAwardWei",
        )?;
        let seller_award = EthFormatValidator::require_non_negative_wei(
            timeout_ev.seller_award_wei.as_deref(),
            "sellerAwardWei",
        )?;
        let expected_total =
            EthFormatValidator::require_positive_wei(Some(&ctx.deal.amount_wei), "amountWei")?;
        if buyer_award.checked_add(seller_award) != Some(expected_total) {
            return Err(DomainError::validation(
                "On-chain timeout split does not sum to locked escrow amount.",
            ));
        }

        let trade_id = ctx.deal.trade_id;
        let now = Utc::now();
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let buyer_award_str = buyer_award.to_string();
        let seller_award_str = seller_award.to_string();

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current_deal = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
                let current_dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;

                if current_dispute.status == DisputeStatus::Resolved {
                    const TIMEOUT_RATIONALE: &str =
                        "Automatic 50/50 stalemate timeout fallback executed after 14-day dispute window.";
                    let needs_rationale = current_dispute
                        .resolution_rationale
                        .as_deref()
                        .is_none_or(|r| r.trim().is_empty());
                    let final_dispute = if needs_rationale
                        && current_dispute
                            .resolve_tx_hash
                            .as_deref()
                            .is_none_or(|h| h.eq_ignore_ascii_case(&tx_hash))
                    {
                        let resolve_tx_hash = current_dispute
                            .resolve_tx_hash
                            .clone()
                            .or_else(|| Some(tx_hash.clone()));
                        repos
                            .disputes()
                            .save(&Dispute {
                                resolution_rationale: Some(TIMEOUT_RATIONALE.to_string()),
                                resolve_tx_hash,
                                ..current_dispute
                            })
                            .await?
                    } else {
                        current_dispute
                    };
                    let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                    return Ok(DisputeWithDeal {
                        dispute: final_dispute,
                        deal: current_deal,
                        votes,
                    });
                }

                repos.chain_events().record_if_absent(&timeout_ev).await?;

                settle_dispute_in_tx(
                    repos,
                    current_deal,
                    current_dispute,
                    &resolved_ev,
                    receipt.block_number,
                    &tx_hash,
                    &caller,
                    &buyer_award_str,
                    &seller_award_str,
                    "Automatic 50/50 stalemate timeout fallback executed after 14-day dispute window.".to_string(),
                    &correlation_id,
                    now,
                    "RESOLVE_DISPUTE_TIMEOUT",
                    format!(
                        "14-day stalemate timeout 50/50 split executed: buyer={buyer_award_str} seller={seller_award_str}"
                    ),
                )
                .await
            })
        })
        .await
    }
}

fn resolve_voter_role(deal: &Deal, caller: &str) -> Result<VoterRole, DomainError> {
    if deal
        .buyer
        .as_deref()
        .is_some_and(|b| b.eq_ignore_ascii_case(caller))
    {
        return Ok(VoterRole::Buyer);
    }
    if deal.seller.eq_ignore_ascii_case(caller) {
        return Ok(VoterRole::Seller);
    }
    if deal.arbiter.eq_ignore_ascii_case(caller) {
        return Ok(VoterRole::Arbiter);
    }
    Err(DomainError::forbidden(
        "Only the deal buyer, seller, or designated arbiter may submit a resolution vote.",
    ))
}

#[allow(clippy::too_many_arguments)]
async fn settle_dispute_in_tx<'a>(
    repos: &(dyn TxRepos + 'a),
    current_deal: Deal,
    current_dispute: Dispute,
    resolved_event: &VerifiedChainEvent,
    block_number: i64,
    tx_hash: &str,
    caller: &str,
    buyer_award_str: &str,
    seller_award_str: &str,
    rationale: String,
    correlation_id: &str,
    now: DateTime<Utc>,
    tx_operation: &str,
    event_details: String,
) -> Result<DisputeWithDeal, DomainError> {
    let dispute_id = current_dispute
        .id
        .ok_or_else(|| DomainError::internal("Dispute missing id"))?;
    let trade_id = current_deal.trade_id.clone();

    let updated_dispute = repos
        .disputes()
        .save(&Dispute {
            id: current_dispute.id,
            trade_id: current_dispute.trade_id,
            opened_by: current_dispute.opened_by,
            reason: current_dispute.reason,
            summary: current_dispute.summary,
            status: DisputeStatus::Resolved,
            buyer_award_wei: Some(buyer_award_str.to_string()),
            seller_award_wei: Some(seller_award_str.to_string()),
            resolution_rationale: Some(rationale),
            open_tx_hash: current_dispute.open_tx_hash,
            resolve_tx_hash: Some(tx_hash.to_string()),
            disputed_at: current_dispute.disputed_at,
            dispute_timeout_seconds: current_dispute.dispute_timeout_seconds,
            created_at: current_dispute.created_at,
            resolved_at: Some(now),
        })
        .await?;

    let mut next_deal = current_deal.clone();
    next_deal.status = DealStatus::Resolved;
    next_deal.on_chain_bound = true;
    next_deal.settled = true;
    next_deal.buyer_award_wei = Some(buyer_award_str.to_string());
    next_deal.seller_award_wei = Some(seller_award_str.to_string());
    next_deal.updated_at = now;
    let updated_deal = repos.deals().save(&next_deal).await?;

    repos
        .chain_events()
        .record_if_absent(resolved_event)
        .await?;
    let resolved_time = DateTime::from_timestamp(resolved_event.block_timestamp_epoch, 0)
        .unwrap_or(current_deal.created_at);
    let timeline_time = if resolved_time < current_deal.created_at {
        current_deal.created_at
    } else {
        resolved_time
    };

    repos
        .deal_events()
        .save_if_absent(&DealEvent {
            id: None,
            trade_id: trade_id.clone(),
            event_type: OnChainEventType::DisputeResolved.as_str().to_string(),
            actor_address: Some(caller.to_string()),
            tx_hash: Some(tx_hash.to_string()),
            block_number: Some(block_number),
            log_index: Some(resolved_event.log_index),
            details: event_details,
            created_at: timeline_time,
        })
        .await?;

    repos
        .blockchain_transactions()
        .save_or_update(&BlockchainTransaction {
            id: None,
            trade_id,
            tx_hash: tx_hash.to_string(),
            operation: tx_operation.to_string(),
            status: "CONFIRMED".to_string(),
            block_number: Some(block_number),
            submitted_by: Some(caller.to_string()),
            created_at: now,
            confirmed_at: Some(now),
        })
        .await?;

    repos
        .audit_logs()
        .append(&AuditLogEntry {
            id: None,
            action: "DISPUTE_RESOLVED".to_string(),
            actor_address: Some(caller.to_string()),
            resource_type: "DISPUTE".to_string(),
            resource_id: dispute_id.to_string(),
            correlation_id: Some(correlation_id.to_string()),
            details: format!(
                "Verified DisputeResolved txHash={tx_hash} buyerWei={buyer_award_str} sellerWei={seller_award_str}"
            ),
            created_at: now,
        })
        .await?;

    let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
    Ok(DisputeWithDeal {
        dispute: updated_dispute,
        deal: updated_deal,
        votes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        sample_bound_deal, FakeBlockchainGateway, InMemoryStore, TEST_CONTRACT,
    };
    use safedeal_domain::blockchain::{OnChainTradeSnapshot, TransactionVerificationResult};
    use safedeal_domain::dispute::DEFAULT_DISPUTE_TIMEOUT_SECONDS;
    use safedeal_domain::ports::{DealRepository, DisputeRepository};

    #[tokio::test]
    async fn record_vote_cross_checks_fetch_trade_snapshot_when_settling_to_resolved() {
        let store = InMemoryStore::new();
        let gateway = FakeBlockchainGateway::new(true);
        let uc = ArbitrationUseCase::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
        );

        let trade_id = format!("0x{}", "c".repeat(64));
        let deal = sample_bound_deal(&trade_id, DealStatus::Disputed);
        let buyer = deal.buyer.clone().unwrap();
        DealRepository::save(store.as_ref(), &deal).await.unwrap();

        let dispute = DisputeRepository::save(
            store.as_ref(),
            &Dispute {
                id: Some(7),
                trade_id: trade_id.clone(),
                opened_by: buyer.clone(),
                reason: "Quality dispute".to_string(),
                summary: "Testing record_vote fetch_trade cross-check".to_string(),
                status: DisputeStatus::Open,
                buyer_award_wei: None,
                seller_award_wei: None,
                resolution_rationale: None,
                open_tx_hash: None,
                resolve_tx_hash: None,
                disputed_at: Some(Utc::now()),
                dispute_timeout_seconds: DEFAULT_DISPUTE_TIMEOUT_SECONDS,
                created_at: Utc::now(),
                resolved_at: None,
            },
        )
        .await
        .unwrap();

        let tx_hash = format!("0x{}", "9".repeat(64));
        let prop_hash = format!("0x{}", "8".repeat(64));
        let now_epoch = Utc::now().timestamp();
        {
            let mut gw = gateway.state.lock().unwrap();
            gw.transactions.insert(
                tx_hash.clone(),
                TransactionVerificationResult {
                    tx_hash: tx_hash.clone(),
                    succeeded: true,
                    block_number: 42,
                    from_address: buyer.clone(),
                    to_address: TEST_CONTRACT.to_string(),
                    decoded_events: vec![
                        VerifiedChainEvent {
                            tx_hash: tx_hash.clone(),
                            log_index: 0,
                            block_number: 42,
                            block_timestamp_epoch: now_epoch,
                            contract_address: TEST_CONTRACT.to_string(),
                            event_type: OnChainEventType::DisputeVoteSubmitted,
                            trade_id: Some(trade_id.clone()),
                            actor_address: Some(buyer.clone()),
                            buyer_address: Some(buyer.clone()),
                            amount_wei: None,
                            buyer_award_wei: Some("1000000000000000000".to_string()),
                            seller_award_wei: Some("1000000000000000000".to_string()),
                            terms_hash: None,
                            proposal_hash: Some(prop_hash),
                        },
                        VerifiedChainEvent {
                            tx_hash: tx_hash.clone(),
                            log_index: 1,
                            block_number: 42,
                            block_timestamp_epoch: now_epoch,
                            contract_address: TEST_CONTRACT.to_string(),
                            event_type: OnChainEventType::DisputeResolved,
                            trade_id: Some(trade_id.clone()),
                            actor_address: Some(buyer.clone()),
                            buyer_address: Some(buyer.clone()),
                            amount_wei: None,
                            buyer_award_wei: Some("1000000000000000000".to_string()),
                            seller_award_wei: Some("1000000000000000000".to_string()),
                            terms_hash: None,
                            proposal_hash: None,
                        },
                    ],
                },
            );
            // Snapshot still shows DISPUTED (6) instead of RESOLVED (7) -> must reject!
            gw.trades.insert(
                trade_id.clone(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: deal.seller.clone(),
                    buyer: Some(buyer.clone()),
                    arbiter: deal.arbiter.clone(),
                    amount_wei: deal.amount_wei.clone(),
                    terms_hash: deal.terms_hash.clone(),
                    funding_deadline_epoch: deal.funding_deadline.timestamp(),
                    delivery_deadline_epoch: deal.delivery_deadline.timestamp(),
                    inspection_window_seconds: deal.inspection_window_seconds,
                    delivered_at_epoch: 0,
                    disputed_at_epoch: now_epoch,
                    chain_status_ordinal: 6,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
        }

        let err = uc
            .record_vote(dispute.id.unwrap(), &buyer, &tx_hash, None)
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));

        // Once on-chain snapshot reflects RESOLVED (7), settlement succeeds
        {
            let mut gw = gateway.state.lock().unwrap();
            if let Some(snap) = gw.trades.get_mut(&trade_id) {
                snap.chain_status_ordinal = 7;
                snap.settled = true;
            }
        }

        let res = uc
            .record_vote(dispute.id.unwrap(), &buyer, &tx_hash, None)
            .await
            .unwrap();
        assert_eq!(res.dispute.status, DisputeStatus::Resolved);
        assert_eq!(res.deal.status, DealStatus::Resolved);
    }
}
