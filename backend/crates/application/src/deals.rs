use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use rand::RngCore;
use safedeal_domain::blockchain::{
    OnChainEventType, OnChainTradeSnapshot, TransactionVerificationResult,
};
use safedeal_domain::canonical_terms::{trim_js_whitespace, CanonicalInput, CanonicalTermsHasher};
use safedeal_domain::deal::{BlockchainTransaction, Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::AuditLogEntry;
use safedeal_domain::ports::{
    in_tx, BlockchainGateway, DealEventRepository, DealRepository, DisputeRepository, PageSlice,
    UnitOfWork,
};
use safedeal_shared::{
    CorrelationIdContext, DomainError, EthFormatValidator, ZERO_ADDRESS,
};
use std::str::FromStr;

const MIN_INSPECTION_SECONDS: i64 = 3600;
const MAX_INSPECTION_SECONDS: i64 = 30 * 86400;

#[derive(Debug, Clone)]
pub struct CreateDealCommand {
    pub seller_address: String,
    pub buyer_address: Option<String>,
    pub arbiter_address: String,
    pub amount_wei: String,
    pub funding_deadline_epoch_seconds: i64,
    pub delivery_deadline_epoch_seconds: i64,
    pub inspection_window_seconds: i64,
    pub title: String,
    pub description: String,
    pub terms: String,
}

#[derive(Debug, Clone)]
pub struct DealWithDispute {
    pub deal: Deal,
    pub dispute_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct DealHistory {
    pub events: Vec<DealEvent>,
    pub transactions: Vec<BlockchainTransaction>,
}

pub struct CreateDealDraftUseCase {
    uow: Arc<dyn UnitOfWork>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
}

impl CreateDealDraftUseCase {
    pub fn new(uow: Arc<dyn UnitOfWork>, blockchain_gateway: Arc<dyn BlockchainGateway>) -> Self {
        Self {
            uow,
            blockchain_gateway,
        }
    }

    pub async fn execute(&self, cmd: CreateDealCommand) -> Result<Deal, DomainError> {
        let seller = EthFormatValidator::require_address(Some(&cmd.seller_address), "sellerAddress")?;
        let buyer = EthFormatValidator::normalize_optional_address(
            cmd.buyer_address.as_deref(),
            "buyerAddress",
        )?;
        let arbiter =
            EthFormatValidator::require_address(Some(&cmd.arbiter_address), "arbiterAddress")?;
        let amount = EthFormatValidator::require_positive_wei(Some(&cmd.amount_wei), "amountWei")?;
        let amount_str = amount.to_string();

        if seller == arbiter {
            return Err(DomainError::validation(
                "Arbiter cannot be the same wallet as the seller.",
            ));
        }
        if buyer.as_deref() == Some(seller.as_str()) {
            return Err(DomainError::validation(
                "Buyer cannot be the same wallet as the seller.",
            ));
        }
        if buyer.as_deref() == Some(arbiter.as_str()) {
            return Err(DomainError::validation(
                "Buyer cannot be the same wallet as the arbiter.",
            ));
        }

        let now = Utc::now();
        let funding_deadline = DateTime::from_timestamp(cmd.funding_deadline_epoch_seconds, 0)
            .ok_or_else(|| DomainError::validation("Invalid fundingDeadlineEpochSeconds."))?;
        let delivery_deadline = DateTime::from_timestamp(cmd.delivery_deadline_epoch_seconds, 0)
            .ok_or_else(|| DomainError::validation("Invalid deliveryDeadlineEpochSeconds."))?;

        if funding_deadline <= now {
            return Err(DomainError::validation(
                "Funding deadline must be strictly in the future.",
            ));
        }
        if delivery_deadline <= funding_deadline {
            return Err(DomainError::validation(
                "Delivery deadline must be strictly after funding deadline.",
            ));
        }
        if !(MIN_INSPECTION_SECONDS..=MAX_INSPECTION_SECONDS)
            .contains(&cmd.inspection_window_seconds)
        {
            return Err(DomainError::validation(
                "Inspection window must be between 1 hour and 30 days.",
            ));
        }

        let title = require_trimmed(&cmd.title, "title", 3, 160)?;
        let description = require_trimmed(&cmd.description, "description", 10, 4000)?;
        let terms = require_trimmed(&cmd.terms, "terms", 10, 8000)?;

        let mut id_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut id_bytes);
        let trade_id = format!("0x{}", hex::encode(id_bytes));

        let chain_id = self.blockchain_gateway.chain_id();
        let canonical = CanonicalTermsHasher::compute(&CanonicalInput {
            version: 1,
            chain_id,
            seller: &seller,
            buyer: buyer.as_deref(),
            arbiter: &arbiter,
            amount_wei: &amount_str,
            funding_deadline: funding_deadline.timestamp(),
            delivery_deadline: delivery_deadline.timestamp(),
            inspection_window_seconds: cmd.inspection_window_seconds,
            title: &title,
            description: &description,
            terms: &terms,
        });

        let configured_contract = self.blockchain_gateway.contract_address();
        let contract_address = if configured_contract.trim().is_empty() {
            ZERO_ADDRESS.to_string()
        } else {
            configured_contract.trim().to_ascii_lowercase()
        };

        let deal = Deal {
            id: None,
            trade_id: trade_id.clone(),
            chain_id,
            contract_address,
            seller: seller.clone(),
            buyer,
            arbiter,
            amount_wei: amount_str,
            terms_hash: canonical.terms_hash_hex.clone(),
            funding_deadline,
            delivery_deadline,
            inspection_window_seconds: cmd.inspection_window_seconds,
            delivered_at: None,
            funded_at: None,
            status: DealStatus::Draft,
            on_chain_bound: false,
            settled: false,
            create_tx_hash: None,
            buyer_award_wei: None,
            seller_award_wei: None,
            title,
            description,
            terms,
            canonical_terms_json: canonical.canonical_json,
            schema_version: 1,
            created_at: now,
            updated_at: now,
        };

        let correlation_id = CorrelationIdContext::get_or_default("n/a");

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let saved = repos.deals().save(&deal).await?;
                repos
                    .deal_events()
                    .save_if_absent(&DealEvent {
                        id: None,
                        trade_id: saved.trade_id.clone(),
                        event_type: "DRAFT_CREATED".to_string(),
                        actor_address: Some(seller.clone()),
                        tx_hash: None,
                        block_number: None,
                        log_index: None,
                        details: format!(
                            "Deal draft prepared with RFC 8785 canonical termsHash {}",
                            saved.terms_hash
                        ),
                        created_at: now,
                    })
                    .await?;
                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "DEAL_DRAFT_CREATED".to_string(),
                        actor_address: Some(seller),
                        resource_type: "DEAL".to_string(),
                        resource_id: saved.trade_id.clone(),
                        correlation_id: Some(correlation_id),
                        details: format!(
                            "Prepared draft tradeId={} amountWei={}",
                            saved.trade_id, saved.amount_wei
                        ),
                        created_at: now,
                    })
                    .await?;
                Ok(saved)
            })
        })
        .await
    }
}

pub struct BindDealTransactionUseCase {
    uow: Arc<dyn UnitOfWork>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
}

impl BindDealTransactionUseCase {
    pub fn new(uow: Arc<dyn UnitOfWork>, blockchain_gateway: Arc<dyn BlockchainGateway>) -> Self {
        Self {
            uow,
            blockchain_gateway,
        }
    }

    pub async fn execute(
        &self,
        raw_trade_id: &str,
        raw_tx_hash: &str,
        caller_address: &str,
    ) -> Result<Deal, DomainError> {
        let trade_id = EthFormatValidator::require_bytes32(Some(raw_trade_id), "tradeId")?;
        let tx_hash = EthFormatValidator::require_bytes32(Some(raw_tx_hash), "txHash")?;
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;

        if !self.blockchain_gateway.is_enabled() {
            return Err(DomainError::external_service(
                "Blockchain verification is currently disabled on this server.",
            ));
        }

        // Phase 1: DB pre-check (short read/lock transaction)
        let tid_p1 = trade_id.clone();
        let txh_p1 = tx_hash.clone();
        let caller_p1 = caller.clone();
        let deal = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let found = repos
                    .deals()
                    .find_by_trade_id_for_update(&tid_p1)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {tid_p1}")))?;
                if !found.seller.eq_ignore_ascii_case(&caller_p1) {
                    return Err(DomainError::forbidden(
                        "Only the deal seller can bind the initial createTrade transaction.",
                    ));
                }
                if found.on_chain_bound
                    && found
                        .create_tx_hash
                        .as_deref()
                        .is_some_and(|h| h.eq_ignore_ascii_case(&txh_p1))
                {
                    return Ok(found);
                }
                if found.on_chain_bound {
                    return Err(DomainError::conflict("Deal is already bound on-chain."));
                }
                if let Some(existing) = repos.deals().find_by_create_tx_hash(&txh_p1).await? {
                    if !existing.trade_id.eq_ignore_ascii_case(&tid_p1) {
                        return Err(DomainError::conflict(
                            "Transaction hash is already bound to another deal.",
                        ));
                    }
                }
                Ok(found)
            })
        })
        .await?;

        if deal.on_chain_bound
            && deal
                .create_tx_hash
                .as_deref()
                .is_some_and(|h| h.eq_ignore_ascii_case(&tx_hash))
        {
            return Ok(deal);
        }

        // Phase 2: External RPC verification OUTSIDE any open database transaction
        let receipt = self
            .blockchain_gateway
            .inspect_transaction(&tx_hash)
            .await?
            .ok_or_else(|| {
                DomainError::validation(format!(
                    "Transaction receipt not found or still pending on-chain: {tx_hash}"
                ))
            })?;

        if !receipt.succeeded {
            return Err(DomainError::validation(format!(
                "Transaction reverted on-chain and cannot bind deal: {tx_hash}"
            )));
        }

        let configured_contract = self.blockchain_gateway.contract_address().to_ascii_lowercase();
        if !receipt.to_address.eq_ignore_ascii_case(&configured_contract) {
            return Err(DomainError::validation(
                "Transaction target contract does not match SafeDealEscrow.",
            ));
        }

        let created_event = receipt
            .decoded_events
            .iter()
            .find(|ev| {
                ev.event_type == OnChainEventType::TradeCreated
                    && ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
            })
            .ok_or_else(|| {
                DomainError::validation(
                    "Receipt does not contain a matching TradeCreated event for tradeId.",
                )
            })?;

        if !created_event
            .actor_address
            .as_deref()
            .is_some_and(|a| a.eq_ignore_ascii_case(&deal.seller))
        {
            return Err(DomainError::validation(
                "On-chain TradeCreated seller does not match draft seller.",
            ));
        }
        if !created_event
            .terms_hash
            .as_deref()
            .is_some_and(|th| th.eq_ignore_ascii_case(&deal.terms_hash))
        {
            return Err(DomainError::validation(
                "On-chain termsHash does not match canonical draft termsHash.",
            ));
        }
        if created_event.amount_wei.as_deref() != Some(deal.amount_wei.as_str()) {
            return Err(DomainError::validation(
                "On-chain escrow amount does not match draft amountWei.",
            ));
        }

        let snapshot = self
            .blockchain_gateway
            .fetch_trade(&trade_id)
            .await?
            .ok_or_else(|| {
                DomainError::external_service(format!(
                    "Unable to read on-chain trade state for {trade_id}"
                ))
            })?;

        validate_snapshot_matches_deal(
            &deal,
            &snapshot,
            "On-chain trade parameters mismatch canonical draft terms.",
        )?;

        // Phase 3: Atomic persistence commit
        let now = Utc::now();
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let reconciled_status = snapshot.to_deal_status()?;

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;

                if current.on_chain_bound {
                    if let Some(existing_tx) = current.create_tx_hash.as_deref() {
                        if !existing_tx.eq_ignore_ascii_case(&tx_hash) {
                            return Err(DomainError::conflict("Deal is already bound on-chain."));
                        }
                    }
                    repos
                        .blockchain_transactions()
                        .save_or_update(&BlockchainTransaction {
                            id: None,
                            trade_id: trade_id.clone(),
                            tx_hash,
                            operation: "CREATE_TRADE".to_string(),
                            status: "CONFIRMED".to_string(),
                            block_number: Some(receipt.block_number),
                            submitted_by: Some(caller),
                            created_at: now,
                            confirmed_at: Some(now),
                        })
                        .await?;
                    return Ok(current);
                }

                if let Some(existing) = repos.deals().find_by_create_tx_hash(&tx_hash).await? {
                    if !existing.trade_id.eq_ignore_ascii_case(&trade_id) {
                        return Err(DomainError::conflict(
                            "Transaction hash is already bound to another deal.",
                        ));
                    }
                }

                let resolved_buyer = snapshot
                    .buyer
                    .as_deref()
                    .filter(|b| !b.is_empty() && !EthFormatValidator::is_zero_address(b))
                    .map(str::to_ascii_lowercase)
                    .or(current.buyer);
                let delivered_at = if snapshot.delivered_at_epoch > 0 {
                    DateTime::from_timestamp(snapshot.delivered_at_epoch, 0).or(current.delivered_at)
                } else {
                    current.delivered_at
                };

                let updated = Deal {
                    id: current.id,
                    trade_id: current.trade_id,
                    chain_id: current.chain_id,
                    contract_address: configured_contract,
                    seller: current.seller,
                    buyer: resolved_buyer,
                    arbiter: current.arbiter,
                    amount_wei: current.amount_wei,
                    terms_hash: current.terms_hash,
                    funding_deadline: current.funding_deadline,
                    delivery_deadline: current.delivery_deadline,
                    inspection_window_seconds: current.inspection_window_seconds,
                    delivered_at,
                    funded_at: current.funded_at,
                    status: reconciled_status,
                    on_chain_bound: true,
                    settled: snapshot.settled || reconciled_status.is_settled(),
                    create_tx_hash: Some(tx_hash.clone()),
                    buyer_award_wei: Some(snapshot.buyer_award_wei),
                    seller_award_wei: Some(snapshot.seller_award_wei),
                    title: current.title,
                    description: current.description,
                    terms: current.terms,
                    canonical_terms_json: current.canonical_terms_json,
                    schema_version: current.schema_version,
                    created_at: current.created_at,
                    updated_at: now,
                };

                let persisted = repos.deals().save(&updated).await?;

                for ev in &receipt.decoded_events {
                    if !ev
                        .trade_id
                        .as_deref()
                        .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
                    {
                        continue;
                    }
                    repos.chain_events().record_if_absent(ev).await?;
                    let ev_time = DateTime::from_timestamp(ev.block_timestamp_epoch, 0)
                        .unwrap_or(current.created_at);
                    let timeline_time = if ev_time < current.created_at {
                        current.created_at
                    } else {
                        ev_time
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
                                "Verified on-chain event {} at block {}",
                                ev.event_type.as_str(),
                                ev.block_number
                            ),
                            created_at: timeline_time,
                        })
                        .await?;
                }

                repos
                    .blockchain_transactions()
                    .save_or_update(&BlockchainTransaction {
                        id: None,
                        trade_id: trade_id.clone(),
                        tx_hash: tx_hash.clone(),
                        operation: "CREATE_TRADE".to_string(),
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
                        action: "DEAL_BOUND_ON_CHAIN".to_string(),
                        actor_address: Some(caller),
                        resource_type: "DEAL".to_string(),
                        resource_id: trade_id.clone(),
                        correlation_id: Some(correlation_id),
                        details: format!(
                            "Bound tradeId={trade_id} createTxHash={tx_hash} status={}",
                            persisted.status
                        ),
                        created_at: now,
                    })
                    .await?;

                Ok(persisted)
            })
        })
        .await
    }
}

pub struct SyncDealUseCase {
    uow: Arc<dyn UnitOfWork>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
}

impl SyncDealUseCase {
    pub fn new(uow: Arc<dyn UnitOfWork>, blockchain_gateway: Arc<dyn BlockchainGateway>) -> Self {
        Self {
            uow,
            blockchain_gateway,
        }
    }

    pub async fn execute(
        &self,
        raw_trade_id: &str,
        raw_optional_tx_hash: Option<&str>,
        caller_address: &str,
    ) -> Result<Deal, DomainError> {
        let trade_id = EthFormatValidator::require_bytes32(Some(raw_trade_id), "tradeId")?;
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        let tx_hash = match raw_optional_tx_hash {
            Some(s) if !s.trim().is_empty() => {
                Some(EthFormatValidator::require_bytes32(Some(s), "txHash")?)
            }
            _ => None,
        };

        let tid_p1 = trade_id.clone();
        let caller_p1 = caller.clone();
        let deal = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let found = repos
                    .deals()
                    .find_by_trade_id(&tid_p1)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {tid_p1}")))?;
                if !found.can_view(Some(&caller_p1)) {
                    return Err(DomainError::forbidden(
                        "Caller is not authorized to synchronize this deal.",
                    ));
                }
                Ok(found)
            })
        })
        .await?;

        if !self.blockchain_gateway.is_enabled() {
            return Err(DomainError::external_service(
                "Blockchain synchronization is disabled on this server.",
            ));
        }

        let receipt: Option<TransactionVerificationResult> = if let Some(ref hash) = tx_hash {
            let rec = self
                .blockchain_gateway
                .inspect_transaction(hash)
                .await?
                .ok_or_else(|| {
                    DomainError::validation(format!(
                        "Transaction receipt not found or still pending: {hash}"
                    ))
                })?;
            if !rec.succeeded {
                return Err(DomainError::validation(format!(
                    "Submitted transaction reverted on-chain: {hash}"
                )));
            }
            let configured_contract = self.blockchain_gateway.contract_address();
            if !rec.to_address.eq_ignore_ascii_case(configured_contract) {
                return Err(DomainError::validation(
                    "Submitted transaction did not target configured SafeDealEscrow contract.",
                ));
            }
            let matches_trade = rec.decoded_events.iter().any(|ev| {
                ev.trade_id
                    .as_deref()
                    .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
            });
            if !matches_trade {
                return Err(DomainError::validation(format!(
                    "Submitted transaction did not emit any verified event for tradeId: {trade_id}"
                )));
            }
            Some(rec)
        } else {
            None
        };

        let snapshot = self
            .blockchain_gateway
            .fetch_trade(&trade_id)
            .await?
            .ok_or_else(|| {
                DomainError::validation(format!("Trade does not exist on-chain yet: {trade_id}"))
            })?;

        validate_snapshot_matches_deal(
            &deal,
            &snapshot,
            "On-chain contract state disagrees with stored canonical terms.",
        )?;

        let configured_contract = self.blockchain_gateway.contract_address().to_ascii_lowercase();
        let now = Utc::now();
        let snapshot_status = snapshot.to_deal_status()?;

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;

                let mut next_status = snapshot_status;
                if !current.status.can_reconcile_to(next_status) {
                    if next_status.can_reconcile_to(current.status) {
                        next_status = current.status;
                    } else {
                        return Err(DomainError::validation(format!(
                            "Invalid escrow state transition from {} to {}",
                            current.status, next_status
                        )));
                    }
                }

                let resolved_buyer = snapshot
                    .buyer
                    .as_deref()
                    .filter(|b| !b.is_empty() && !EthFormatValidator::is_zero_address(b))
                    .map(str::to_ascii_lowercase)
                    .or(current.buyer);
                let delivered_at = if snapshot.delivered_at_epoch > 0 {
                    DateTime::from_timestamp(snapshot.delivered_at_epoch, 0).or(current.delivered_at)
                } else {
                    current.delivered_at
                };

                let mut buyer_award = current.buyer_award_wei;
                let mut seller_award = current.seller_award_wei;
                let mut resolved_create_tx_hash = current.create_tx_hash;
                let mut resolved_funded_at = current.funded_at;

                if let Some(ref rec) = receipt {
                    for ev in &rec.decoded_events {
                        if !ev
                            .trade_id
                            .as_deref()
                            .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
                        {
                            continue;
                        }
                        if ev.event_type == OnChainEventType::TradeCreated
                            && resolved_create_tx_hash.is_none()
                        {
                            resolved_create_tx_hash = Some(ev.tx_hash.clone());
                        }
                        if ev.event_type == OnChainEventType::TradeFunded
                            && resolved_funded_at.is_none()
                            && ev.block_timestamp_epoch > 0
                        {
                            resolved_funded_at =
                                DateTime::from_timestamp(ev.block_timestamp_epoch, 0);
                        }
                        if ev.event_type == OnChainEventType::DisputeResolved {
                            buyer_award = ev.buyer_award_wei.clone();
                            seller_award = ev.seller_award_wei.clone();
                        }
                    }
                }

                let funded_at = if resolved_funded_at.is_none()
                    && !matches!(
                        next_status,
                        DealStatus::Created | DealStatus::Cancelled | DealStatus::Draft
                    ) {
                    Some(now)
                } else {
                    resolved_funded_at
                };

                let updated = Deal {
                    id: current.id,
                    trade_id: current.trade_id,
                    chain_id: current.chain_id,
                    contract_address: configured_contract,
                    seller: current.seller,
                    buyer: resolved_buyer,
                    arbiter: current.arbiter,
                    amount_wei: current.amount_wei,
                    terms_hash: current.terms_hash,
                    funding_deadline: current.funding_deadline,
                    delivery_deadline: current.delivery_deadline,
                    inspection_window_seconds: current.inspection_window_seconds,
                    delivered_at,
                    funded_at,
                    status: next_status,
                    on_chain_bound: true,
                    settled: snapshot.settled || next_status.is_settled(),
                    create_tx_hash: resolved_create_tx_hash,
                    buyer_award_wei: buyer_award,
                    seller_award_wei: seller_award,
                    title: current.title,
                    description: current.description,
                    terms: current.terms,
                    canonical_terms_json: current.canonical_terms_json,
                    schema_version: current.schema_version,
                    created_at: current.created_at,
                    updated_at: now,
                };

                let saved = repos.deals().save(&updated).await?;

                if let Some(rec) = receipt {
                    let mut operation_name = "SYNC".to_string();
                    for ev in &rec.decoded_events {
                        if !ev
                            .trade_id
                            .as_deref()
                            .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
                        {
                            continue;
                        }
                        operation_name = ev.event_type.as_str().to_string();
                        repos.chain_events().record_if_absent(ev).await?;
                        let ev_time = DateTime::from_timestamp(ev.block_timestamp_epoch, 0)
                            .unwrap_or(current.created_at);
                        let timeline_time = if ev_time < current.created_at {
                            current.created_at
                        } else {
                            ev_time
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
                                details: format!("Verified on-chain event {}", ev.event_type.as_str()),
                                created_at: timeline_time,
                            })
                            .await?;
                    }
                    repos
                        .blockchain_transactions()
                        .save_or_update(&BlockchainTransaction {
                            id: None,
                            trade_id,
                            tx_hash: rec.tx_hash,
                            operation: operation_name,
                            status: "CONFIRMED".to_string(),
                            block_number: Some(rec.block_number),
                            submitted_by: Some(caller),
                            created_at: now,
                            confirmed_at: Some(now),
                        })
                        .await?;
                }

                Ok(saved)
            })
        })
        .await
    }
}

pub struct QueryDealsUseCase {
    deal_repo: Arc<dyn DealRepository>,
    deal_event_repo: Arc<dyn DealEventRepository>,
    tx_repo: Arc<dyn safedeal_domain::ports::BlockchainTransactionRepository>,
    dispute_repo: Arc<dyn DisputeRepository>,
}

impl QueryDealsUseCase {
    pub fn new(
        deal_repo: Arc<dyn DealRepository>,
        deal_event_repo: Arc<dyn DealEventRepository>,
        tx_repo: Arc<dyn safedeal_domain::ports::BlockchainTransactionRepository>,
        dispute_repo: Arc<dyn DisputeRepository>,
    ) -> Self {
        Self {
            deal_repo,
            deal_event_repo,
            tx_repo,
            dispute_repo,
        }
    }

    pub async fn list_user_deals(
        &self,
        wallet_address: &str,
        role: Option<&str>,
        status_param: Option<&str>,
        page: i32,
        size: i32,
    ) -> Result<PageSlice, DomainError> {
        let caller = EthFormatValidator::require_address(Some(wallet_address), "walletAddress")?;
        let bounded_page = page.max(0);
        let bounded_size = size.clamp(1, 100);
        let status_filter = match status_param {
            Some(raw) if !raw.trim().is_empty() && !raw.trim().eq_ignore_ascii_case("ALL") => {
                Some(DealStatus::from_str(raw).map_err(|_| {
                    DomainError::validation(format!("Unsupported status filter: {raw}"))
                })?)
            }
            _ => None,
        };
        self.deal_repo
            .find_user_deals(&caller, role, status_filter, bounded_page, bounded_size)
            .await
    }

    pub async fn get_deal(
        &self,
        raw_trade_id: &str,
        wallet_address: &str,
    ) -> Result<DealWithDispute, DomainError> {
        let trade_id = EthFormatValidator::require_bytes32(Some(raw_trade_id), "tradeId")?;
        let caller = EthFormatValidator::require_address(Some(wallet_address), "walletAddress")?;
        let deal = self
            .deal_repo
            .find_by_trade_id(&trade_id)
            .await?
            .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
        if !deal.can_view(Some(&caller)) {
            return Err(DomainError::forbidden(format!(
                "Access denied for deal {trade_id}"
            )));
        }
        let dispute_id = self
            .dispute_repo
            .find_by_trade_id(&trade_id)
            .await?
            .and_then(|d| d.id);
        Ok(DealWithDispute { deal, dispute_id })
    }

    pub async fn find_dispute_id(&self, trade_id: &str) -> Result<Option<i64>, DomainError> {
        Ok(self
            .dispute_repo
            .find_by_trade_id(trade_id)
            .await?
            .and_then(|d| d.id))
    }

    pub async fn find_dispute_ids(
        &self,
        trade_ids: &[String],
    ) -> Result<HashMap<String, i64>, DomainError> {
        self.dispute_repo.find_dispute_ids_by_trade_ids(trade_ids).await
    }

    pub async fn get_history(
        &self,
        raw_trade_id: &str,
        wallet_address: &str,
    ) -> Result<DealHistory, DomainError> {
        let trade_id = EthFormatValidator::require_bytes32(Some(raw_trade_id), "tradeId")?;
        let caller = EthFormatValidator::require_address(Some(wallet_address), "walletAddress")?;
        let deal = self
            .deal_repo
            .find_by_trade_id(&trade_id)
            .await?
            .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
        if !deal.can_view(Some(&caller)) {
            return Err(DomainError::forbidden(format!(
                "Access denied for deal history {trade_id}"
            )));
        }
        let (events, transactions) = tokio::join!(
            self.deal_event_repo.find_by_trade_id_order_by_created_at_asc(&trade_id),
            self.tx_repo.find_by_trade_id_order_by_created_at_asc(&trade_id),
        );
        Ok(DealHistory {
            events: events?,
            transactions: transactions?,
        })
    }
}

fn validate_snapshot_matches_deal(
    deal: &Deal,
    snapshot: &OnChainTradeSnapshot,
    message: &str,
) -> Result<(), DomainError> {
    let buyer_matches = deal.buyer.as_ref().is_none_or(|expected| {
        snapshot
            .buyer
            .as_deref()
            .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
    });
    if !deal.seller.eq_ignore_ascii_case(&snapshot.seller)
        || !buyer_matches
        || !deal.arbiter.eq_ignore_ascii_case(&snapshot.arbiter)
        || !deal.terms_hash.eq_ignore_ascii_case(&snapshot.terms_hash)
        || deal.amount_wei != snapshot.amount_wei
        || deal.funding_deadline.timestamp() != snapshot.funding_deadline_epoch
        || deal.delivery_deadline.timestamp() != snapshot.delivery_deadline_epoch
        || deal.inspection_window_seconds != snapshot.inspection_window_seconds
    {
        return Err(DomainError::validation(message));
    }
    Ok(())
}

fn require_trimmed(raw: &str, field: &str, min: usize, max: usize) -> Result<String, DomainError> {
    let trimmed = trim_js_whitespace(raw);
    let char_len = trimmed.chars().count();
    if char_len < min || char_len > max {
        return Err(DomainError::validation(format!(
            "{field} length must be between {min} and {max} characters."
        )));
    }
    Ok(trimmed.to_string())
}
