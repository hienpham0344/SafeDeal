use std::sync::Arc;

use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::{ChainSyncState, OnChainEventType, VerifiedChainEvent};
use safedeal_domain::deal::{Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::{
    Dispute, DisputeStatus, DisputeVote, VoterRole, DEFAULT_DISPUTE_TIMEOUT_SECONDS,
};
use safedeal_domain::ports::{in_tx, BlockchainGateway, TxRepos, UnitOfWork};
use safedeal_shared::{DomainError, EthFormatValidator, ZERO_ADDRESS};
use tokio::sync::Mutex;

pub const AUTO_INDEXED_DISPUTE_REASON: &str = "On-chain dispute opened";
pub const AUTO_INDEXED_DISPUTE_SUMMARY: &str =
    "Synced automatically from on-chain DisputeOpened event.";

pub struct BlockchainEventIndexerService {
    uow: Arc<dyn UnitOfWork>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
    poll_lock: Mutex<()>,
}

impl BlockchainEventIndexerService {
    pub fn new(uow: Arc<dyn UnitOfWork>, blockchain_gateway: Arc<dyn BlockchainGateway>) -> Self {
        Self {
            uow,
            blockchain_gateway,
            poll_lock: Mutex::new(()),
        }
    }

    pub async fn poll_and_index(&self) -> Result<usize, DomainError> {
        let contract = self.blockchain_gateway.contract_address().trim();
        if !self.blockchain_gateway.is_enabled()
            || contract.is_empty()
            || contract.eq_ignore_ascii_case(ZERO_ADDRESS)
        {
            return Ok(0);
        }

        let Ok(_guard) = self.poll_lock.try_lock() else {
            return Ok(0);
        };

        self.do_poll_and_index().await
    }

    async fn do_poll_and_index(&self) -> Result<usize, DomainError> {
        // Phase 1: Query RPC head OUTSIDE any open database transaction
        let latest_block = self.blockchain_gateway.fetch_latest_block_number().await?;
        let confirmations_lag =
            i64::from((self.blockchain_gateway.confirmations_required() - 1).max(0));
        let safe_head = (latest_block - confirmations_lag).max(0);

        let configured_chain_id = self.blockchain_gateway.chain_id();
        let configured_contract = self
            .blockchain_gateway
            .contract_address()
            .trim()
            .to_ascii_lowercase();
        let initial_cursor = (self.blockchain_gateway.deployment_block() - 1).max(0);

        // Phase 2: Read or initialize/reset sync cursor in a short DB transaction
        let contract_init = configured_contract.clone();
        let state = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let existing = repos.chain_sync_states().find_primary().await?;
                match existing {
                    Some(cur)
                        if cur.chain_id == configured_chain_id
                            && cur.contract_address.eq_ignore_ascii_case(&contract_init) =>
                    {
                        Ok(cur)
                    }
                    _ => {
                        repos
                            .chain_sync_states()
                            .save(&ChainSyncState {
                                id: 1,
                                chain_id: configured_chain_id,
                                contract_address: contract_init,
                                last_synced_block: initial_cursor,
                                updated_at: Utc::now(),
                            })
                            .await
                    }
                }
            })
        })
        .await?;

        if safe_head <= state.last_synced_block {
            return Ok(0);
        }

        let batch_size = self.blockchain_gateway.sync_batch_size().max(10);
        let mut cursor = state.last_synced_block + 1;
        let mut total_processed = 0usize;

        while cursor <= safe_head {
            let to_block = safe_head.min(cursor.saturating_add(batch_size - 1));
            // Phase 3a: Fetch and decode logs over JSON-RPC OUTSIDE DB transaction
            let events = self.blockchain_gateway.fetch_logs(cursor, to_block).await?;

            // Phase 3b: Apply events idempotently & advance cursor atomically in short DB transaction
            let contract_chunk = configured_contract.clone();
            let inserted_in_chunk = in_tx(self.uow.as_ref(), move |repos| {
                Box::pin(async move {
                    let mut applied = 0usize;
                    for ev in &events {
                        let locked_deal = match ev.trade_id.as_deref() {
                            Some(tid) if ev.event_type != OnChainEventType::FundsWithdrawn => {
                                repos.deals().find_by_trade_id_for_update(tid).await?
                            }
                            _ => None,
                        };
                        if repos.chain_events().record_if_absent(ev).await? {
                            apply_event_to_deal_projection(repos, ev, locked_deal).await?;
                            applied += 1;
                        }
                    }

                    repos
                        .chain_sync_states()
                        .save(&ChainSyncState {
                            id: 1,
                            chain_id: configured_chain_id,
                            contract_address: contract_chunk,
                            last_synced_block: to_block,
                            updated_at: Utc::now(),
                        })
                        .await?;

                    Ok(applied)
                })
            })
            .await?;

            total_processed += inserted_in_chunk;
            cursor = to_block + 1;
        }

        if total_processed > 0 {
            tracing::info!(
                indexed_events = total_processed,
                safe_head = safe_head,
                "Indexed new SafeDealEscrow events"
            );
        }

        Ok(total_processed)
    }
}

async fn apply_event_to_deal_projection<'a>(
    repos: &(dyn TxRepos + 'a),
    ev: &VerifiedChainEvent,
    current_opt: Option<Deal>,
) -> Result<(), DomainError> {
    let Some(current) = current_opt else {
        return Ok(());
    };
    let Some(ref trade_id) = ev.trade_id else {
        return Ok(());
    };
    if ev.event_type == OnChainEventType::FundsWithdrawn {
        return Ok(());
    }

    if !current.on_chain_bound || current.status == DealStatus::Draft {
        if ev.event_type != OnChainEventType::TradeCreated {
            tracing::warn!(
                trade_id = %trade_id,
                event_type = %ev.event_type.as_str(),
                tx_hash = %ev.tx_hash,
                "Ignoring non-TradeCreated event for unbound draft deal"
            );
            return Ok(());
        }
        let seller_matches = ev
            .actor_address
            .as_deref()
            .is_some_and(|a| a.eq_ignore_ascii_case(&current.seller));
        let terms_matches = ev
            .terms_hash
            .as_deref()
            .is_some_and(|th| th.eq_ignore_ascii_case(&current.terms_hash));
        let amount_matches = ev.amount_wei.as_deref() == Some(current.amount_wei.as_str());
        let event_buyer = ev
            .buyer_address
            .as_deref()
            .filter(|b| !b.trim().is_empty() && !EthFormatValidator::is_zero_address(b));
        let buyer_matches = match current.buyer.as_ref() {
            Some(expected) => {
                event_buyer.is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
            }
            None => event_buyer.is_none(),
        };
        if !seller_matches || !terms_matches || !amount_matches || !buyer_matches {
            tracing::warn!(
                trade_id = %trade_id,
                tx_hash = %ev.tx_hash,
                "Ignoring mismatched TradeCreated event for unbound draft deal"
            );
            return Ok(());
        }
    }

    let next_status = match ev.event_type {
        OnChainEventType::TradeCreated => DealStatus::Created,
        OnChainEventType::TradeFunded => DealStatus::Funded,
        OnChainEventType::DeliveryMarked => DealStatus::Delivered,
        OnChainEventType::FundsReleased => DealStatus::Released,
        OnChainEventType::RefundExecuted => DealStatus::Refunded,
        OnChainEventType::DisputeOpened => DealStatus::Disputed,
        OnChainEventType::DisputeVoteSubmitted => current.status,
        OnChainEventType::DisputeResolved | OnChainEventType::DisputeResolvedByTimeout => {
            DealStatus::Resolved
        }
        OnChainEventType::TradeCancelled => DealStatus::Cancelled,
        OnChainEventType::FundsWithdrawn => current.status,
    };

    let now = Utc::now();
    let event_time = DateTime::from_timestamp(ev.block_timestamp_epoch, 0).unwrap_or(now);

    let buyer = ev
        .buyer_address
        .as_deref()
        .filter(|b| !b.trim().is_empty() && !EthFormatValidator::is_zero_address(b))
        .map(str::to_ascii_lowercase)
        .or_else(|| current.buyer.clone());

    let funded_at = if ev.event_type == OnChainEventType::TradeFunded && current.funded_at.is_none()
    {
        Some(event_time)
    } else {
        current.funded_at
    };

    let delivered_at = if ev.event_type == OnChainEventType::DeliveryMarked {
        Some(event_time)
    } else {
        current.delivered_at
    };

    let (buyer_award_wei, seller_award_wei) = if matches!(
        ev.event_type,
        OnChainEventType::DisputeResolved | OnChainEventType::DisputeResolvedByTimeout
    ) {
        (ev.buyer_award_wei.clone(), ev.seller_award_wei.clone())
    } else {
        (
            current.buyer_award_wei.clone(),
            current.seller_award_wei.clone(),
        )
    };

    let create_tx_hash = current
        .create_tx_hash
        .clone()
        .or_else(|| (ev.event_type == OnChainEventType::TradeCreated).then(|| ev.tx_hash.clone()));

    if current.status.can_reconcile_to(next_status) {
        repos
            .deals()
            .save(&Deal {
                id: current.id,
                trade_id: current.trade_id.clone(),
                chain_id: current.chain_id,
                contract_address: current.contract_address.clone(),
                seller: current.seller.clone(),
                buyer,
                arbiter: current.arbiter.clone(),
                amount_wei: current.amount_wei.clone(),
                terms_hash: current.terms_hash.clone(),
                funding_deadline: current.funding_deadline,
                delivery_deadline: current.delivery_deadline,
                inspection_window_seconds: current.inspection_window_seconds,
                delivered_at,
                funded_at,
                status: next_status,
                on_chain_bound: true,
                settled: next_status.is_settled(),
                create_tx_hash,
                buyer_award_wei,
                seller_award_wei,
                title: current.title.clone(),
                description: current.description.clone(),
                terms: current.terms.clone(),
                canonical_terms_json: current.canonical_terms_json.clone(),
                schema_version: current.schema_version,
                created_at: current.created_at,
                updated_at: now,
            })
            .await?;
    }

    let timeline_time = if event_time < current.created_at {
        current.created_at
    } else {
        event_time
    };
    repos
        .deal_events()
        .save_if_absent(&DealEvent {
            id: None,
            trade_id: trade_id.clone(),
            event_type: ev.event_type.as_str().to_string(),
            actor_address: ev.actor_address.clone(),
            tx_hash: Some(ev.tx_hash.clone()),
            block_number: Some(ev.block_number),
            log_index: Some(ev.log_index),
            details: format!(
                "Indexed event {} at block {}",
                ev.event_type.as_str(),
                ev.block_number
            ),
            created_at: timeline_time,
        })
        .await?;

    if ev.event_type == OnChainEventType::DisputeOpened {
        let existing =
            ensure_dispute_record_exists(repos, trade_id, &current, ev, event_time, timeline_time)
                .await?;
        if existing.disputed_at.is_none() || existing.open_tx_hash.is_none() {
            repos
                .disputes()
                .save(&Dispute {
                    disputed_at: existing.disputed_at.or(Some(event_time)),
                    open_tx_hash: existing.open_tx_hash.or_else(|| Some(ev.tx_hash.clone())),
                    ..existing
                })
                .await?;
        }
    }

    if ev.event_type == OnChainEventType::DisputeVoteSubmitted {
        let existing =
            ensure_dispute_record_exists(repos, trade_id, &current, ev, event_time, timeline_time)
                .await?;
        if let (Some(actor), Some(buyer_wei), Some(seller_wei), Some(prop_hash)) = (
            ev.actor_address.as_deref(),
            ev.buyer_award_wei.as_ref(),
            ev.seller_award_wei.as_ref(),
            ev.proposal_hash.as_ref(),
        ) {
            if let Some(dispute_id) = existing.id {
                let role = if current
                    .buyer
                    .as_deref()
                    .is_some_and(|b| b.eq_ignore_ascii_case(actor))
                {
                    Some(VoterRole::Buyer)
                } else if current.seller.eq_ignore_ascii_case(actor) {
                    Some(VoterRole::Seller)
                } else if current.arbiter.eq_ignore_ascii_case(actor) {
                    Some(VoterRole::Arbiter)
                } else {
                    None
                };
                if let Some(voter_role) = role {
                    repos
                        .dispute_votes()
                        .upsert_vote(&DisputeVote {
                            id: None,
                            dispute_id,
                            trade_id: trade_id.clone(),
                            voter_address: actor.to_ascii_lowercase(),
                            voter_role,
                            buyer_award_wei: buyer_wei.clone(),
                            seller_award_wei: seller_wei.clone(),
                            proposal_hash: prop_hash.clone(),
                            rationale: None,
                            tx_hash: ev.tx_hash.clone(),
                            updated_at: event_time,
                        })
                        .await?;
                }
            }
        }
    }

    if matches!(
        ev.event_type,
        OnChainEventType::DisputeResolved | OnChainEventType::DisputeResolvedByTimeout
    ) {
        const TIMEOUT_RATIONALE: &str =
            "Automatic 50/50 stalemate timeout fallback executed after 14-day dispute window.";
        let existing =
            ensure_dispute_record_exists(repos, trade_id, &current, ev, event_time, timeline_time)
                .await?;
        if existing.status == DisputeStatus::Open {
            let rationale = existing.resolution_rationale.clone().or_else(|| {
                (ev.event_type == OnChainEventType::DisputeResolvedByTimeout)
                    .then(|| TIMEOUT_RATIONALE.to_string())
            });
            repos
                .disputes()
                .save(&Dispute {
                    id: existing.id,
                    trade_id: existing.trade_id,
                    opened_by: existing.opened_by,
                    reason: existing.reason,
                    summary: existing.summary,
                    status: DisputeStatus::Resolved,
                    buyer_award_wei: ev.buyer_award_wei.clone(),
                    seller_award_wei: ev.seller_award_wei.clone(),
                    resolution_rationale: rationale,
                    open_tx_hash: existing.open_tx_hash,
                    resolve_tx_hash: Some(ev.tx_hash.clone()),
                    disputed_at: existing.disputed_at,
                    dispute_timeout_seconds: existing.dispute_timeout_seconds,
                    created_at: existing.created_at,
                    resolved_at: Some(event_time),
                })
                .await?;
        } else if existing.status == DisputeStatus::Resolved
            && ev.event_type == OnChainEventType::DisputeResolvedByTimeout
            && existing
                .resolution_rationale
                .as_deref()
                .is_none_or(|r| r.trim().is_empty())
        {
            let resolve_tx_hash = existing
                .resolve_tx_hash
                .clone()
                .or_else(|| Some(ev.tx_hash.clone()));
            repos
                .disputes()
                .save(&Dispute {
                    resolution_rationale: Some(TIMEOUT_RATIONALE.to_string()),
                    resolve_tx_hash,
                    ..existing
                })
                .await?;
        }
    }

    Ok(())
}

async fn ensure_dispute_record_exists<'a>(
    repos: &(dyn TxRepos + 'a),
    trade_id: &str,
    current: &Deal,
    ev: &VerifiedChainEvent,
    event_time: DateTime<Utc>,
    timeline_time: DateTime<Utc>,
) -> Result<Dispute, DomainError> {
    if let Some(existing) = repos.disputes().find_by_trade_id(trade_id).await? {
        return Ok(existing);
    }
    repos
        .disputes()
        .save(&Dispute {
            id: None,
            trade_id: trade_id.to_string(),
            opened_by: ev
                .actor_address
                .clone()
                .unwrap_or_else(|| current.seller.clone()),
            reason: AUTO_INDEXED_DISPUTE_REASON.to_string(),
            summary: AUTO_INDEXED_DISPUTE_SUMMARY.to_string(),
            status: DisputeStatus::Open,
            buyer_award_wei: None,
            seller_award_wei: None,
            resolution_rationale: None,
            open_tx_hash: Some(ev.tx_hash.clone()),
            resolve_tx_hash: None,
            disputed_at: Some(event_time),
            dispute_timeout_seconds: DEFAULT_DISPUTE_TIMEOUT_SECONDS,
            created_at: timeline_time,
            resolved_at: None,
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        sample_bound_deal, FakeBlockchainGateway, InMemoryStore, TEST_CONTRACT,
    };
    use safedeal_domain::ports::{DealRepository, DisputeRepository, DisputeVoteRepository};

    #[tokio::test]
    async fn auto_creates_fallback_dispute_for_on_chain_dispute_opened_vote_and_resolution() {
        let store = InMemoryStore::new();
        let gateway = FakeBlockchainGateway::new(true);
        let indexer = BlockchainEventIndexerService::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
        );

        let trade_id = format!("0x{}", "1".repeat(64));
        let deal = sample_bound_deal(&trade_id, DealStatus::Funded);
        DealRepository::save(store.as_ref(), &deal).await.unwrap();

        let now_epoch = Utc::now().timestamp();
        let open_tx = format!("0x{}", "2".repeat(64));
        let vote_tx = format!("0x{}", "3".repeat(64));
        let resolve_tx = format!("0x{}", "4".repeat(64));
        let prop_hash = format!("0x{}", "5".repeat(64));

        {
            let mut gw = gateway.state.lock().unwrap();
            gw.latest_block = 20;
            gw.logs = vec![
                VerifiedChainEvent {
                    tx_hash: open_tx.clone(),
                    log_index: 0,
                    block_number: 10,
                    block_timestamp_epoch: now_epoch,
                    contract_address: TEST_CONTRACT.to_string(),
                    event_type: OnChainEventType::DisputeOpened,
                    trade_id: Some(trade_id.clone()),
                    actor_address: deal.buyer.clone(),
                    buyer_address: deal.buyer.clone(),
                    amount_wei: None,
                    buyer_award_wei: None,
                    seller_award_wei: None,
                    terms_hash: None,
                    proposal_hash: None,
                },
                VerifiedChainEvent {
                    tx_hash: vote_tx.clone(),
                    log_index: 0,
                    block_number: 11,
                    block_timestamp_epoch: now_epoch + 5,
                    contract_address: TEST_CONTRACT.to_string(),
                    event_type: OnChainEventType::DisputeVoteSubmitted,
                    trade_id: Some(trade_id.clone()),
                    actor_address: Some(deal.arbiter.clone()),
                    buyer_address: deal.buyer.clone(),
                    amount_wei: None,
                    buyer_award_wei: Some("1500000000000000000".to_string()),
                    seller_award_wei: Some("500000000000000000".to_string()),
                    terms_hash: None,
                    proposal_hash: Some(prop_hash.clone()),
                },
                VerifiedChainEvent {
                    tx_hash: resolve_tx.clone(),
                    log_index: 0,
                    block_number: 12,
                    block_timestamp_epoch: now_epoch + 10,
                    contract_address: TEST_CONTRACT.to_string(),
                    event_type: OnChainEventType::DisputeResolved,
                    trade_id: Some(trade_id.clone()),
                    actor_address: deal.buyer.clone(),
                    buyer_address: deal.buyer.clone(),
                    amount_wei: None,
                    buyer_award_wei: Some("1500000000000000000".to_string()),
                    seller_award_wei: Some("500000000000000000".to_string()),
                    terms_hash: None,
                    proposal_hash: None,
                },
            ];
        }

        let count = indexer.poll_and_index().await.unwrap();
        assert_eq!(count, 3);

        let dispute = DisputeRepository::find_by_trade_id(store.as_ref(), &trade_id)
            .await
            .unwrap()
            .expect("auto-created dispute row");
        assert_eq!(dispute.reason, AUTO_INDEXED_DISPUTE_REASON);
        assert_eq!(dispute.summary, AUTO_INDEXED_DISPUTE_SUMMARY);
        assert_eq!(dispute.status, DisputeStatus::Resolved);
        assert_eq!(dispute.open_tx_hash.as_deref(), Some(open_tx.as_str()));
        assert_eq!(
            dispute.resolve_tx_hash.as_deref(),
            Some(resolve_tx.as_str())
        );
        assert_eq!(
            dispute.buyer_award_wei.as_deref(),
            Some("1500000000000000000")
        );
        assert_eq!(
            dispute.seller_award_wei.as_deref(),
            Some("500000000000000000")
        );

        let votes = DisputeVoteRepository::find_by_dispute_id(store.as_ref(), dispute.id.unwrap())
            .await
            .unwrap();
        assert_eq!(votes.len(), 1);
        assert_eq!(votes[0].voter_role, VoterRole::Arbiter);
        assert_eq!(votes[0].proposal_hash, prop_hash);
    }
}
