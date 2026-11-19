pub mod audit_repo;
pub mod auth_repo;
pub mod deal_repo;
pub mod dispute_repo;
pub mod event_repo;
pub mod readiness;

use std::any::Any;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use safedeal_domain::ports::{
    AuditLogRepository, AuthNonceRepository, BlockchainTransactionRepository, ChainEventRepository,
    ChainSyncStateRepository, DealEventRepository, DealRepository, DisputeEvidenceRepository,
    DisputeRepository, TxRepos, TxWorkFn, UnitOfWork, UserRepository,
};
use safedeal_shared::DomainError;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};
use tokio::sync::Mutex;

use crate::config::DatabaseConfig;
use audit_repo::{PgAuditLogRepository, PgTxAuditLogRepository};
use auth_repo::{
    PgAuthNonceRepository, PgTxAuthNonceRepository, PgTxUserRepository, PgUserRepository,
};
use deal_repo::{PgDealRepository, PgTxDealRepository};
use dispute_repo::{
    PgDisputeEvidenceRepository, PgDisputeRepository, PgTxDisputeEvidenceRepository,
    PgTxDisputeRepository,
};
use event_repo::{
    PgBlockchainTransactionRepository, PgChainEventRepository, PgChainSyncStateRepository,
    PgDealEventRepository, PgTxBlockchainTransactionRepository, PgTxChainEventRepository,
    PgTxChainSyncStateRepository, PgTxDealEventRepository,
};
pub use readiness::PgDatabaseReadinessAdapter;

pub type PgTxHandle = Arc<Mutex<Option<Transaction<'static, Postgres>>>>;

pub async fn create_pg_pool(config: &DatabaseConfig) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(Duration::from_millis(config.acquire_timeout_ms))
        .idle_timeout(Duration::from_secs(300))
        .test_before_acquire(true)
        .connect(&config.url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}

pub fn map_sqlx_err(err: sqlx::Error) -> DomainError {
    if let sqlx::Error::Database(ref db_err) = err {
        if db_err
            .code()
            .as_deref()
            .is_some_and(|c| c.starts_with("23"))
        {
            return DomainError::conflict_with_code(
                "DATA_CONFLICT",
                "Submitted operation conflicts with an existing record.",
            );
        }
    }
    tracing::error!(error = %err, "PostgreSQL persistence error");
    DomainError::internal("Database persistence error.")
}

pub struct PgRepositories {
    pub uow: Arc<dyn UnitOfWork>,
    pub readiness: Arc<PgDatabaseReadinessAdapter>,
    pub deals: Arc<PgDealRepository>,
    pub disputes: Arc<PgDisputeRepository>,
    pub auth_nonces: Arc<PgAuthNonceRepository>,
    pub users: Arc<PgUserRepository>,
    pub deal_events: Arc<PgDealEventRepository>,
    pub chain_events: Arc<PgChainEventRepository>,
    pub blockchain_transactions: Arc<PgBlockchainTransactionRepository>,
    pub dispute_evidence: Arc<PgDisputeEvidenceRepository>,
    pub audit_logs: Arc<PgAuditLogRepository>,
    pub chain_sync_states: Arc<PgChainSyncStateRepository>,
}

impl PgRepositories {
    pub fn new(pool: PgPool) -> Self {
        Self {
            uow: Arc::new(PgUnitOfWork::new(pool.clone())),
            readiness: Arc::new(PgDatabaseReadinessAdapter::new(pool.clone())),
            deals: Arc::new(PgDealRepository::new(pool.clone())),
            disputes: Arc::new(PgDisputeRepository::new(pool.clone())),
            auth_nonces: Arc::new(PgAuthNonceRepository::new(pool.clone())),
            users: Arc::new(PgUserRepository::new(pool.clone())),
            deal_events: Arc::new(PgDealEventRepository::new(pool.clone())),
            chain_events: Arc::new(PgChainEventRepository::new(pool.clone())),
            blockchain_transactions: Arc::new(PgBlockchainTransactionRepository::new(pool.clone())),
            dispute_evidence: Arc::new(PgDisputeEvidenceRepository::new(pool.clone())),
            audit_logs: Arc::new(PgAuditLogRepository::new(pool.clone())),
            chain_sync_states: Arc::new(PgChainSyncStateRepository::new(pool)),
        }
    }
}

pub struct PgUnitOfWork {
    pool: PgPool,
}

impl PgUnitOfWork {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct PgTxRepos {
    deals: PgTxDealRepository,
    disputes: PgTxDisputeRepository,
    auth_nonces: PgTxAuthNonceRepository,
    users: PgTxUserRepository,
    deal_events: PgTxDealEventRepository,
    chain_events: PgTxChainEventRepository,
    blockchain_transactions: PgTxBlockchainTransactionRepository,
    dispute_evidence: PgTxDisputeEvidenceRepository,
    audit_logs: PgTxAuditLogRepository,
    chain_sync_states: PgTxChainSyncStateRepository,
}

impl PgTxRepos {
    fn new(handle: &PgTxHandle) -> Self {
        Self {
            deals: PgTxDealRepository::new(Arc::clone(handle)),
            disputes: PgTxDisputeRepository::new(Arc::clone(handle)),
            auth_nonces: PgTxAuthNonceRepository::new(Arc::clone(handle)),
            users: PgTxUserRepository::new(Arc::clone(handle)),
            deal_events: PgTxDealEventRepository::new(Arc::clone(handle)),
            chain_events: PgTxChainEventRepository::new(Arc::clone(handle)),
            blockchain_transactions: PgTxBlockchainTransactionRepository::new(Arc::clone(handle)),
            dispute_evidence: PgTxDisputeEvidenceRepository::new(Arc::clone(handle)),
            audit_logs: PgTxAuditLogRepository::new(Arc::clone(handle)),
            chain_sync_states: PgTxChainSyncStateRepository::new(Arc::clone(handle)),
        }
    }
}

impl TxRepos for PgTxRepos {
    fn deals(&self) -> &dyn DealRepository {
        &self.deals
    }
    fn disputes(&self) -> &dyn DisputeRepository {
        &self.disputes
    }
    fn auth_nonces(&self) -> &dyn AuthNonceRepository {
        &self.auth_nonces
    }
    fn users(&self) -> &dyn UserRepository {
        &self.users
    }
    fn deal_events(&self) -> &dyn DealEventRepository {
        &self.deal_events
    }
    fn chain_events(&self) -> &dyn ChainEventRepository {
        &self.chain_events
    }
    fn blockchain_transactions(&self) -> &dyn BlockchainTransactionRepository {
        &self.blockchain_transactions
    }
    fn dispute_evidence(&self) -> &dyn DisputeEvidenceRepository {
        &self.dispute_evidence
    }
    fn audit_logs(&self) -> &dyn AuditLogRepository {
        &self.audit_logs
    }
    fn chain_sync_states(&self) -> &dyn ChainSyncStateRepository {
        &self.chain_sync_states
    }
}

#[async_trait]
impl UnitOfWork for PgUnitOfWork {
    async fn execute_boxed<'env>(
        &self,
        work: TxWorkFn<'env>,
    ) -> Result<Box<dyn Any + Send>, DomainError> {
        let tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let handle: PgTxHandle = Arc::new(Mutex::new(Some(tx)));
        let repos = PgTxRepos::new(&handle);

        let result = work.call_tx(&repos).await;
        let maybe_tx = handle.lock().await.take();

        match result {
            Ok(val) => {
                if let Some(tx) = maybe_tx {
                    tx.commit().await.map_err(map_sqlx_err)?;
                }
                Ok(val)
            }
            Err(err) => {
                if let Some(tx) = maybe_tx {
                    let _ = tx.rollback().await;
                }
                Err(err)
            }
        }
    }
}

pub(crate) async fn acquire_conn(
    pool: &PgPool,
) -> Result<sqlx::pool::PoolConnection<Postgres>, DomainError> {
    pool.acquire().await.map_err(map_sqlx_err)
}
