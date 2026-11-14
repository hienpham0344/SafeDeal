use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::OnChainEventType;
use safedeal_domain::deal::{BlockchainTransaction, Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::{AuditLogEntry, Dispute, DisputeStatus};
use safedeal_domain::ports::{in_tx, BlockchainGateway, UnitOfWork};
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
                let deals = repos.deals().find_by_trade_ids(&trade_ids).await?;
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
                    result.push(DisputeWithDeal { dispute, deal });
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
                            return Ok((
                                true,
                                DisputeWithDeal {
                                    dispute: saved,
                                    deal,
                                },
                            ));
                        }
                        return Ok((true, DisputeWithDeal { dispute, deal }));
                    }
                    return Err(DomainError::conflict("Dispute has already been resolved."));
                }
                Ok((false, DisputeWithDeal { dispute, deal }))
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
        let configured_contract = self.blockchain_gateway.contract_address();
        if !receipt.to_address.eq_ignore_ascii_case(configured_contract) {
            return Err(DomainError::validation(
                "Resolution transaction did not target SafeDealEscrow.",
            ));
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
                        return Ok(DisputeWithDeal {
                            dispute: saved,
                            deal: current_deal,
                        });
                    }
                    return Ok(DisputeWithDeal {
                        dispute: current_dispute,
                        deal: current_deal,
                    });
                }

                let updated_dispute = repos
                    .disputes()
                    .save(&Dispute {
                        id: current_dispute.id,
                        trade_id: current_dispute.trade_id,
                        opened_by: current_dispute.opened_by,
                        reason: current_dispute.reason,
                        summary: current_dispute.summary,
                        status: DisputeStatus::Resolved,
                        buyer_award_wei: Some(buyer_award_str.clone()),
                        seller_award_wei: Some(seller_award_str.clone()),
                        resolution_rationale: Some(trimmed_rationale),
                        open_tx_hash: current_dispute.open_tx_hash,
                        resolve_tx_hash: Some(tx_hash.clone()),
                        created_at: current_dispute.created_at,
                        resolved_at: Some(now),
                    })
                    .await?;

                let mut next_deal = current_deal.clone();
                next_deal.status = DealStatus::Resolved;
                next_deal.on_chain_bound = true;
                next_deal.settled = true;
                next_deal.buyer_award_wei = Some(buyer_award_str.clone());
                next_deal.seller_award_wei = Some(seller_award_str.clone());
                next_deal.updated_at = now;
                let updated_deal = repos.deals().save(&next_deal).await?;

                repos.chain_events().record_if_absent(&resolved_event).await?;
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
                        actor_address: Some(caller.clone()),
                        tx_hash: Some(tx_hash.clone()),
                        block_number: Some(receipt.block_number),
                        log_index: Some(resolved_event.log_index),
                        details: format!(
                            "Arbiter split resolution recorded: buyer={buyer_award_str} seller={seller_award_str}"
                        ),
                        created_at: timeline_time,
                    })
                    .await?;

                repos
                    .blockchain_transactions()
                    .save_or_update(&BlockchainTransaction {
                        id: None,
                        trade_id: trade_id.clone(),
                        tx_hash: tx_hash.clone(),
                        operation: "RESOLVE_DISPUTE".to_string(),
                        status: "CONFIRMED".to_string(),
                        block_number: Some(receipt.block_number),
                        submitted_by: Some(caller.clone()),
                        created_at: now,
                        confirmed_at: Some(now),
                    })
                    .await?;

                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "DISPUTE_RESOLVED".to_string(),
                        actor_address: Some(caller),
                        resource_type: "DISPUTE".to_string(),
                        resource_id: dispute_id.to_string(),
                        correlation_id: Some(correlation_id),
                        details: format!(
                            "Verified DisputeResolved txHash={tx_hash} buyerWei={buyer_award_str} sellerWei={seller_award_str}"
                        ),
                        created_at: now,
                    })
                    .await?;

                Ok(DisputeWithDeal {
                    dispute: updated_dispute,
                    deal: updated_deal,
                })
            })
        })
        .await
    }
}
