use std::any::Any;
use std::collections::HashMap;
use std::marker::PhantomData;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;

use crate::auth::{AuthNonce, UserAccount};
use crate::blockchain::{
    ChainSyncState, OnChainTradeSnapshot, TransactionVerificationResult, VerifiedChainEvent,
};
use crate::deal::{BlockchainTransaction, Deal, DealEvent, DealStatus};
use crate::dispute::{AuditLogEntry, Dispute, DisputeEvidence};
use safedeal_shared::DomainError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageSlice {
    pub items: Vec<Deal>,
    pub page: i32,
    pub size: i32,
    pub total_items: i64,
    pub total_pages: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAttachment {
    pub sanitized_file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256_hex: String,
    pub storage_key: String,
}

#[async_trait]
pub trait AuditLogRepository: Send + Sync {
    async fn append(&self, entry: &AuditLogEntry) -> Result<(), DomainError>;
}

#[async_trait]
pub trait AuthNonceRepository: Send + Sync {
    async fn save(&self, nonce: &AuthNonce) -> Result<AuthNonce, DomainError>;
    async fn find_by_nonce(&self, nonce: &str) -> Result<Option<AuthNonce>, DomainError>;
    /// Atomically marks the nonce consumed iff it exists, matches wallet + chain, is unconsumed,
    /// and has not expired yet. Returns true only on the first consumption (prevents race replay).
    async fn consume_once(
        &self,
        nonce: &str,
        wallet_address: &str,
        chain_id: i64,
        now: DateTime<Utc>,
    ) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait BlockchainGateway: Send + Sync {
    fn is_enabled(&self) -> bool;
    fn chain_id(&self) -> i64;
    fn chain_name(&self) -> &str;
    fn contract_address(&self) -> &str;
    fn deployment_block(&self) -> i64;
    fn confirmations_required(&self) -> i32;
    fn sync_batch_size(&self) -> i64;

    async fn fetch_trade(&self, trade_id: &str)
        -> Result<Option<OnChainTradeSnapshot>, DomainError>;
    async fn inspect_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError>;
    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError>;
    async fn fetch_logs(
        &self,
        from_block: i64,
        to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError>;
}

#[async_trait]
pub trait BlockchainTransactionRepository: Send + Sync {
    async fn save_or_update(
        &self,
        transaction: &BlockchainTransaction,
    ) -> Result<BlockchainTransaction, DomainError>;
    async fn find_by_tx_hash(
        &self,
        tx_hash: &str,
    ) -> Result<Option<BlockchainTransaction>, DomainError>;
    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<BlockchainTransaction>, DomainError>;
}

#[async_trait]
pub trait ChainEventRepository: Send + Sync {
    /// Inserts the event iff (txHash, logIndex) has not yet been processed.
    /// Returns true when inserted, false when already processed (idempotent dedup).
    async fn record_if_absent(&self, event: &VerifiedChainEvent) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait ChainSyncStateRepository: Send + Sync {
    async fn find_primary(&self) -> Result<Option<ChainSyncState>, DomainError>;
    async fn save(&self, state: &ChainSyncState) -> Result<ChainSyncState, DomainError>;
}

#[async_trait]
pub trait DatabaseReadinessPort: Send + Sync {
    async fn is_database_connected(&self) -> bool;
}

#[async_trait]
pub trait DealEventRepository: Send + Sync {
    async fn save_if_absent(&self, event: &DealEvent) -> Result<bool, DomainError>;
    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<DealEvent>, DomainError>;
}

#[async_trait]
pub trait DealRepository: Send + Sync {
    async fn save(&self, deal: &Deal) -> Result<Deal, DomainError>;
    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Deal>, DomainError>;
    async fn find_by_trade_ids(&self, trade_ids: &[String]) -> Result<Vec<Deal>, DomainError>;
    async fn find_by_trade_id_for_update(&self, trade_id: &str)
        -> Result<Option<Deal>, DomainError>;
    async fn find_by_create_tx_hash(&self, create_tx_hash: &str)
        -> Result<Option<Deal>, DomainError>;
    async fn exists_by_create_tx_hash(&self, create_tx_hash: &str) -> Result<bool, DomainError>;
    async fn find_user_deals(
        &self,
        wallet_address: &str,
        role: Option<&str>,
        status_filter: Option<DealStatus>,
        page: i32,
        size: i32,
    ) -> Result<PageSlice, DomainError>;
    async fn find_open_bound_deals(&self) -> Result<Vec<Deal>, DomainError>;
}

#[async_trait]
pub trait DisputeEvidenceRepository: Send + Sync {
    async fn save(&self, evidence: &DisputeEvidence) -> Result<DisputeEvidence, DomainError>;
    async fn find_by_dispute_id_order_by_created_at_asc(
        &self,
        dispute_id: i64,
    ) -> Result<Vec<DisputeEvidence>, DomainError>;
    async fn find_by_id_and_dispute_id(
        &self,
        evidence_id: i64,
        dispute_id: i64,
    ) -> Result<Option<DisputeEvidence>, DomainError>;
}

#[async_trait]
pub trait DisputeRepository: Send + Sync {
    async fn save(&self, dispute: &Dispute) -> Result<Dispute, DomainError>;
    async fn find_by_id(&self, id: i64) -> Result<Option<Dispute>, DomainError>;
    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Dispute>, DomainError>;
    async fn find_dispute_ids_by_trade_ids(
        &self,
        trade_ids: &[String],
    ) -> Result<HashMap<String, i64>, DomainError>;
    async fn find_assigned_to_arbiter(
        &self,
        arbiter_address: &str,
    ) -> Result<Vec<Dispute>, DomainError>;
}

#[async_trait]
pub trait EvidenceStoragePort: Send + Sync {
    async fn store(
        &self,
        dispute_id: i64,
        original_filename: &str,
        declared_mime_type: Option<&str>,
        bytes: &[u8],
    ) -> Result<StoredAttachment, DomainError>;
    async fn load(&self, storage_key: &str) -> Result<Vec<u8>, DomainError>;
    async fn delete_best_effort(&self, storage_key: &str);
    fn resolve_attachment_path(
        &self,
        storage_key: &str,
    ) -> Result<std::path::PathBuf, DomainError>;
    fn is_storage_ready(&self) -> bool;
}

pub trait SignatureVerifierPort: Send + Sync {
    fn recover_address_from_personal_sign(
        &self,
        message: &str,
        signature_hex: &str,
    ) -> Result<String, DomainError>;
}

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn upsert_login(
        &self,
        wallet_address: &str,
        login_at: DateTime<Utc>,
    ) -> Result<UserAccount, DomainError>;
    async fn find_by_wallet_address(
        &self,
        wallet_address: &str,
    ) -> Result<Option<UserAccount>, DomainError>;
}

/// Exposes transaction-scoped repository adapters without leaking SQL/database types into domain/application.
pub trait TxRepos: Send + Sync {
    fn deals(&self) -> &dyn DealRepository;
    fn disputes(&self) -> &dyn DisputeRepository;
    fn auth_nonces(&self) -> &dyn AuthNonceRepository;
    fn users(&self) -> &dyn UserRepository;
    fn deal_events(&self) -> &dyn DealEventRepository;
    fn chain_events(&self) -> &dyn ChainEventRepository;
    fn blockchain_transactions(&self) -> &dyn BlockchainTransactionRepository;
    fn dispute_evidence(&self) -> &dyn DisputeEvidenceRepository;
    fn audit_logs(&self) -> &dyn AuditLogRepository;
    fn chain_sync_states(&self) -> &dyn ChainSyncStateRepository;
}

pub trait TxCallback<'env, R>: Send + 'env {
    fn call_tx<'a>(
        self: Box<Self>,
        repos: &'a (dyn TxRepos + 'a),
    ) -> BoxFuture<'a, Result<R, DomainError>>
    where
        'env: 'a;
}

impl<'env, R, F> TxCallback<'env, R> for F
where
    F: for<'a> FnOnce(&'a (dyn TxRepos + 'a)) -> BoxFuture<'a, Result<R, DomainError>>
        + Send
        + 'env,
{
    fn call_tx<'a>(
        self: Box<Self>,
        repos: &'a (dyn TxRepos + 'a),
    ) -> BoxFuture<'a, Result<R, DomainError>>
    where
        'env: 'a,
    {
        (*self)(repos)
    }
}

struct DowncastWrap<T, F>(F, PhantomData<fn() -> T>);

impl<'env, T, F> TxCallback<'env, Box<dyn Any + Send>> for DowncastWrap<T, F>
where
    T: Send + 'static,
    F: TxCallback<'env, T>,
{
    fn call_tx<'a>(
        self: Box<Self>,
        repos: &'a (dyn TxRepos + 'a),
    ) -> BoxFuture<'a, Result<Box<dyn Any + Send>, DomainError>>
    where
        'env: 'a,
    {
        Box::pin(async move {
            let value = Box::new(self.0).call_tx(repos).await?;
            Ok(Box::new(value) as Box<dyn Any + Send>)
        })
    }
}

pub type TxWorkFn<'env> = Box<dyn TxCallback<'env, Box<dyn Any + Send>>>;

#[async_trait]
pub trait UnitOfWork: Send + Sync {
    async fn execute_boxed<'env>(
        &self,
        work: TxWorkFn<'env>,
    ) -> Result<Box<dyn Any + Send>, DomainError>;
}

/// Runs an atomic database transaction across clean domain repository ports.
pub async fn in_tx<'env, T, F>(uow: &dyn UnitOfWork, f: F) -> Result<T, DomainError>
where
    T: Send + 'static,
    F: for<'a> FnOnce(&'a (dyn TxRepos + 'a)) -> BoxFuture<'a, Result<T, DomainError>>
        + Send
        + 'env,
{
    let work: TxWorkFn<'env> = Box::new(DowncastWrap(f, PhantomData));
    let boxed = uow.execute_boxed(work).await?;
    boxed
        .downcast::<T>()
        .map(|b| *b)
        .map_err(|_| DomainError::internal("UnitOfWork type downcast mismatch"))
}
