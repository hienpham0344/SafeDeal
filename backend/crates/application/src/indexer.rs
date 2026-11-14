use std::sync::Arc;

use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::{ChainSyncState, OnChainEventType, VerifiedChainEvent};
use safedeal_domain::deal::{Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::{Dispute, DisputeStatus};
use safedeal_domain::ports::{in_tx, BlockchainGateway, TxRepos, UnitOfWork};
use safedeal_shared::{DomainError, EthFormatValidator, ZERO_ADDRESS};
use tokio::sync::Mutex;

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

    let next_status = match ev.event_type {
        OnChainEventType::TradeCreated => DealStatus::Created,
        OnChainEventType::TradeFunded => DealStatus::Funded,
        OnChainEventType::DeliveryMarked => DealStatus::Delivered,
        OnChainEventType::FundsReleased => DealStatus::Released,
        OnChainEventType::RefundExecuted => DealStatus::Refunded,
        OnChainEventType::DisputeOpened => DealStatus::Disputed,
        OnChainEventType::DisputeResolved => DealStatus::Resolved,
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

    let (buyer_award_wei, seller_award_wei) = if ev.event_type == OnChainEventType::DisputeResolved
    {
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

    if ev.event_type == OnChainEventType::DisputeResolved {
        if let Some(existing) = repos.disputes().find_by_trade_id(trade_id).await? {
            if existing.status == DisputeStatus::Open {
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
                        resolution_rationale: existing.resolution_rationale,
                        open_tx_hash: existing.open_tx_hash,
                        resolve_tx_hash: Some(ev.tx_hash.clone()),
                        created_at: existing.created_at,
                        resolved_at: Some(event_time),
                    })
                    .await?;
            }
        }
    }

    Ok(())
}
