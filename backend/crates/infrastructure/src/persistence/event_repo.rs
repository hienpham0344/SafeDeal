use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::{ChainSyncState, VerifiedChainEvent};
use safedeal_domain::deal::{BlockchainTransaction, DealEvent};
use safedeal_domain::ports::{
    BlockchainTransactionRepository, ChainEventRepository, ChainSyncStateRepository,
    DealEventRepository,
};
use safedeal_shared::{DomainError, ZERO_BYTES32};
use sqlx::{PgConnection, PgPool};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

#[derive(sqlx::FromRow)]
struct DealEventRow {
    id: i64,
    trade_id: String,
    event_type: String,
    actor_address: Option<String>,
    tx_hash: Option<String>,
    block_number: Option<i64>,
    log_index: Option<i32>,
    details: String,
    created_at: DateTime<Utc>,
}

impl From<DealEventRow> for DealEvent {
    fn from(r: DealEventRow) -> Self {
        Self {
            id: Some(r.id),
            trade_id: r.trade_id,
            event_type: r.event_type,
            actor_address: r.actor_address,
            tx_hash: r.tx_hash,
            block_number: r.block_number,
            log_index: r.log_index,
            details: r.details,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct BlockchainTxRow {
    id: i64,
    trade_id: String,
    tx_hash: String,
    operation: String,
    status: String,
    block_number: Option<i64>,
    submitted_by: Option<String>,
    created_at: DateTime<Utc>,
    confirmed_at: Option<DateTime<Utc>>,
}

impl From<BlockchainTxRow> for BlockchainTransaction {
    fn from(r: BlockchainTxRow) -> Self {
        Self {
            id: Some(r.id),
            trade_id: r.trade_id,
            tx_hash: r.tx_hash,
            operation: r.operation,
            status: r.status,
            block_number: r.block_number,
            submitted_by: r.submitted_by,
            created_at: r.created_at,
            confirmed_at: r.confirmed_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ChainSyncStateRow {
    id: i32,
    chain_id: i64,
    contract_address: String,
    last_synced_block: i64,
    updated_at: DateTime<Utc>,
}

impl From<ChainSyncStateRow> for ChainSyncState {
    fn from(r: ChainSyncStateRow) -> Self {
        Self {
            id: r.id,
            chain_id: r.chain_id,
            contract_address: r.contract_address,
            last_synced_block: r.last_synced_block,
            updated_at: r.updated_at,
        }
    }
}

async fn record_chain_event_conn(
    conn: &mut PgConnection,
    event: &VerifiedChainEvent,
) -> Result<bool, DomainError> {
    let tx_hash = event.tx_hash.to_ascii_lowercase();
    let contract_address = event.contract_address.to_ascii_lowercase();
    let trade_id = event
        .trade_id
        .as_deref()
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| ZERO_BYTES32.to_string());
    let actor_address = event
        .actor_address
        .as_deref()
        .map(str::to_ascii_lowercase);
    let terms_hash = event.terms_hash.as_deref().map(str::to_ascii_lowercase);

    let res = sqlx::query(
        r#"
        INSERT INTO chain_events (
            tx_hash, log_index, block_number, block_timestamp, contract_address,
            event_type, trade_id, actor_address, amount_wei, buyer_award_wei,
            seller_award_wei, terms_hash, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(&tx_hash)
    .bind(event.log_index)
    .bind(event.block_number)
    .bind(event.block_timestamp_epoch)
    .bind(&contract_address)
    .bind(event.event_type.as_str())
    .bind(&trade_id)
    .bind(&actor_address)
    .bind(&event.amount_wei)
    .bind(&event.buyer_award_wei)
    .bind(&event.seller_award_wei)
    .bind(&terms_hash)
    .bind(Utc::now())
    .execute(conn)
    .await
    .map_err(map_sqlx_err)?;

    Ok(res.rows_affected() > 0)
}

async fn save_deal_event_conn(
    conn: &mut PgConnection,
    event: &DealEvent,
) -> Result<bool, DomainError> {
    let trade_id = event.trade_id.to_ascii_lowercase();
    let actor = event.actor_address.as_deref().map(str::to_ascii_lowercase);

    if let (Some(tx_hash), Some(log_index)) = (event.tx_hash.as_deref(), event.log_index) {
        let tx_hash_lower = tx_hash.to_ascii_lowercase();
        let res = sqlx::query(
            r#"
            INSERT INTO deal_events (
                trade_id, event_type, actor_address, tx_hash,
                block_number, log_index, details, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(&trade_id)
        .bind(&event.event_type)
        .bind(&actor)
        .bind(&tx_hash_lower)
        .bind(event.block_number)
        .bind(log_index)
        .bind(&event.details)
        .bind(event.created_at)
        .execute(conn)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected() > 0)
    } else {
        sqlx::query(
            r#"
            INSERT INTO deal_events (
                trade_id, event_type, actor_address, tx_hash,
                block_number, log_index, details, created_at
            ) VALUES ($1, $2, $3, NULL, $4, NULL, $5, $6)
            "#,
        )
        .bind(&trade_id)
        .bind(&event.event_type)
        .bind(&actor)
        .bind(event.block_number)
        .bind(&event.details)
        .bind(event.created_at)
        .execute(conn)
        .await
        .map_err(map_sqlx_err)?;
        Ok(true)
    }
}

async fn find_deal_events_conn(
    conn: &mut PgConnection,
    trade_id: &str,
) -> Result<Vec<DealEvent>, DomainError> {
    let rows = sqlx::query_as::<_, DealEventRow>(
        r#"
        SELECT id, trade_id, event_type, actor_address, tx_hash,
               block_number, log_index, details, created_at
        FROM deal_events
        WHERE trade_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(trade_id.trim().to_ascii_lowercase())
    .fetch_all(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

async fn save_or_update_tx_conn(
    conn: &mut PgConnection,
    tx: &BlockchainTransaction,
) -> Result<BlockchainTransaction, DomainError> {
    let tx_hash = tx.tx_hash.to_ascii_lowercase();
    let trade_id = tx.trade_id.to_ascii_lowercase();
    let submitted_by = tx.submitted_by.as_deref().map(str::to_ascii_lowercase);

    let row = sqlx::query_as::<_, BlockchainTxRow>(
        r#"
        INSERT INTO blockchain_transactions (
            trade_id, tx_hash, operation, status, block_number,
            submitted_by, created_at, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tx_hash) DO UPDATE SET
            trade_id = EXCLUDED.trade_id,
            operation = EXCLUDED.operation,
            status = EXCLUDED.status,
            block_number = EXCLUDED.block_number,
            submitted_by = EXCLUDED.submitted_by,
            confirmed_at = EXCLUDED.confirmed_at
        RETURNING id, trade_id, tx_hash, operation, status, block_number,
                  submitted_by, created_at, confirmed_at
        "#,
    )
    .bind(&trade_id)
    .bind(&tx_hash)
    .bind(&tx.operation)
    .bind(&tx.status)
    .bind(tx.block_number)
    .bind(&submitted_by)
    .bind(tx.created_at)
    .bind(tx.confirmed_at)
    .fetch_one(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.into())
}

async fn find_tx_by_hash_conn(
    conn: &mut PgConnection,
    tx_hash: &str,
) -> Result<Option<BlockchainTransaction>, DomainError> {
    let row = sqlx::query_as::<_, BlockchainTxRow>(
        r#"
        SELECT id, trade_id, tx_hash, operation, status, block_number,
               submitted_by, created_at, confirmed_at
        FROM blockchain_transactions
        WHERE tx_hash = $1
        "#,
    )
    .bind(tx_hash.trim().to_ascii_lowercase())
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.map(Into::into))
}

async fn find_txs_by_trade_conn(
    conn: &mut PgConnection,
    trade_id: &str,
) -> Result<Vec<BlockchainTransaction>, DomainError> {
    let rows = sqlx::query_as::<_, BlockchainTxRow>(
        r#"
        SELECT id, trade_id, tx_hash, operation, status, block_number,
               submitted_by, created_at, confirmed_at
        FROM blockchain_transactions
        WHERE trade_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(trade_id.trim().to_ascii_lowercase())
    .fetch_all(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

async fn find_primary_sync_conn(
    conn: &mut PgConnection,
) -> Result<Option<ChainSyncState>, DomainError> {
    let row = sqlx::query_as::<_, ChainSyncStateRow>(
        r#"
        SELECT id, chain_id, contract_address, last_synced_block, updated_at
        FROM chain_sync_state
        WHERE id = 1
        "#,
    )
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.map(Into::into))
}

async fn save_sync_state_conn(
    conn: &mut PgConnection,
    state: &ChainSyncState,
) -> Result<ChainSyncState, DomainError> {
    let contract_address = state.contract_address.to_ascii_lowercase();
    let row = sqlx::query_as::<_, ChainSyncStateRow>(
        r#"
        INSERT INTO chain_sync_state (id, chain_id, contract_address, last_synced_block, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
            chain_id = EXCLUDED.chain_id,
            contract_address = EXCLUDED.contract_address,
            last_synced_block = EXCLUDED.last_synced_block,
            updated_at = EXCLUDED.updated_at
        RETURNING id, chain_id, contract_address, last_synced_block, updated_at
        "#,
    )
    .bind(state.id)
    .bind(state.chain_id)
    .bind(&contract_address)
    .bind(state.last_synced_block)
    .bind(state.updated_at)
    .fetch_one(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.into())
}

pub struct PgChainEventRepository {
    pool: PgPool,
}

impl PgChainEventRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ChainEventRepository for PgChainEventRepository {
    async fn record_if_absent(&self, event: &VerifiedChainEvent) -> Result<bool, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        record_chain_event_conn(&mut conn, event).await
    }
}

pub(crate) struct PgTxChainEventRepository {
    tx: PgTxHandle,
}

impl PgTxChainEventRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl ChainEventRepository for PgTxChainEventRepository {
    async fn record_if_absent(&self, event: &VerifiedChainEvent) -> Result<bool, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        record_chain_event_conn(tx, event).await
    }
}

pub struct PgDealEventRepository {
    pool: PgPool,
}

impl PgDealEventRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DealEventRepository for PgDealEventRepository {
    async fn save_if_absent(&self, event: &DealEvent) -> Result<bool, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_deal_event_conn(&mut conn, event).await
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<DealEvent>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_deal_events_conn(&mut conn, trade_id).await
    }
}

pub(crate) struct PgTxDealEventRepository {
    tx: PgTxHandle,
}

impl PgTxDealEventRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl DealEventRepository for PgTxDealEventRepository {
    async fn save_if_absent(&self, event: &DealEvent) -> Result<bool, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_deal_event_conn(tx, event).await
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<DealEvent>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_deal_events_conn(tx, trade_id).await
    }
}

pub struct PgBlockchainTransactionRepository {
    pool: PgPool,
}

impl PgBlockchainTransactionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BlockchainTransactionRepository for PgBlockchainTransactionRepository {
    async fn save_or_update(
        &self,
        transaction: &BlockchainTransaction,
    ) -> Result<BlockchainTransaction, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_or_update_tx_conn(&mut conn, transaction).await
    }

    async fn find_by_tx_hash(
        &self,
        tx_hash: &str,
    ) -> Result<Option<BlockchainTransaction>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_tx_by_hash_conn(&mut conn, tx_hash).await
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<BlockchainTransaction>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_txs_by_trade_conn(&mut conn, trade_id).await
    }
}

pub(crate) struct PgTxBlockchainTransactionRepository {
    tx: PgTxHandle,
}

impl PgTxBlockchainTransactionRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl BlockchainTransactionRepository for PgTxBlockchainTransactionRepository {
    async fn save_or_update(
        &self,
        transaction: &BlockchainTransaction,
    ) -> Result<BlockchainTransaction, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_or_update_tx_conn(tx, transaction).await
    }

    async fn find_by_tx_hash(
        &self,
        tx_hash: &str,
    ) -> Result<Option<BlockchainTransaction>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_tx_by_hash_conn(tx, tx_hash).await
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<BlockchainTransaction>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_txs_by_trade_conn(tx, trade_id).await
    }
}

pub struct PgChainSyncStateRepository {
    pool: PgPool,
}

impl PgChainSyncStateRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ChainSyncStateRepository for PgChainSyncStateRepository {
    async fn find_primary(&self) -> Result<Option<ChainSyncState>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_primary_sync_conn(&mut conn).await
    }

    async fn save(&self, state: &ChainSyncState) -> Result<ChainSyncState, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_sync_state_conn(&mut conn, state).await
    }
}

pub(crate) struct PgTxChainSyncStateRepository {
    tx: PgTxHandle,
}

impl PgTxChainSyncStateRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl ChainSyncStateRepository for PgTxChainSyncStateRepository {
    async fn find_primary(&self) -> Result<Option<ChainSyncState>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_primary_sync_conn(tx).await
    }

    async fn save(&self, state: &ChainSyncState) -> Result<ChainSyncState, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_sync_state_conn(tx, state).await
    }
}
