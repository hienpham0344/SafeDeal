use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::dispute::{
    compute_audit_entry_hash, AuditLogEntry, ChainedAuditLogEntry, AUDIT_GENESIS_HASH,
};
use safedeal_domain::ports::AuditLogRepository;
use safedeal_shared::DomainError;
use sqlx::{PgConnection, PgPool};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

const AUDIT_CHAIN_ADVISORY_LOCK_ID: i64 = 0x5344_4155_4449_5431;

#[derive(sqlx::FromRow)]
struct AuditLogRow {
    id: i64,
    action: String,
    actor_address: Option<String>,
    resource_type: String,
    resource_id: String,
    correlation_id: Option<String>,
    details: String,
    created_at: DateTime<Utc>,
    prev_hash: String,
    entry_hash: String,
}

impl From<AuditLogRow> for ChainedAuditLogEntry {
    fn from(r: AuditLogRow) -> Self {
        Self {
            entry: AuditLogEntry {
                id: Some(r.id),
                action: r.action,
                actor_address: r.actor_address,
                resource_type: r.resource_type,
                resource_id: r.resource_id,
                correlation_id: r.correlation_id,
                details: r.details,
                created_at: r.created_at,
            },
            prev_hash: r.prev_hash,
            entry_hash: r.entry_hash,
        }
    }
}

async fn append_audit_in_tx(
    tx: &mut PgConnection,
    entry: &AuditLogEntry,
) -> Result<(), DomainError> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(AUDIT_CHAIN_ADVISORY_LOCK_ID)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;

    let prev_row: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT entry_hash
        FROM audit_logs
        ORDER BY id DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_err)?;

    let prev_hash = prev_row
        .map(|(h,)| h)
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| AUDIT_GENESIS_HASH.to_string());

    let actor = entry.actor_address.as_deref().map(str::to_ascii_lowercase);
    let created_at_millis = DateTime::from_timestamp_millis(entry.created_at.timestamp_millis())
        .unwrap_or(entry.created_at);
    let normalized = AuditLogEntry {
        actor_address: actor.clone(),
        created_at: created_at_millis,
        ..entry.clone()
    };
    let entry_hash = compute_audit_entry_hash(&prev_hash, &normalized);

    sqlx::query(
        r#"
        INSERT INTO audit_logs (
            action, actor_address, resource_type, resource_id, correlation_id, details, created_at, prev_hash, entry_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(&normalized.action)
    .bind(&actor)
    .bind(&normalized.resource_type)
    .bind(&normalized.resource_id)
    .bind(&normalized.correlation_id)
    .bind(&normalized.details)
    .bind(normalized.created_at)
    .bind(&prev_hash)
    .bind(&entry_hash)
    .execute(&mut *tx)
    .await
    .map_err(map_sqlx_err)?;
    Ok(())
}

async fn list_all_audit_conn(
    conn: &mut PgConnection,
) -> Result<Vec<ChainedAuditLogEntry>, DomainError> {
    let rows = sqlx::query_as::<_, AuditLogRow>(
        r#"
        SELECT id, action, actor_address, resource_type, resource_id, correlation_id, details, created_at, prev_hash, entry_hash
        FROM audit_logs
        ORDER BY id ASC
        "#,
    )
    .fetch_all(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub struct PgAuditLogRepository {
    pool: PgPool,
}

impl PgAuditLogRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuditLogRepository for PgAuditLogRepository {
    async fn append(&self, entry: &AuditLogEntry) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        append_audit_in_tx(&mut tx, entry).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(())
    }

    async fn list_all(&self) -> Result<Vec<ChainedAuditLogEntry>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        list_all_audit_conn(&mut conn).await
    }
}

pub(crate) struct PgTxAuditLogRepository {
    tx: PgTxHandle,
}

impl PgTxAuditLogRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl AuditLogRepository for PgTxAuditLogRepository {
    async fn append(&self, entry: &AuditLogEntry) -> Result<(), DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        append_audit_in_tx(tx, entry).await
    }

    async fn list_all(&self) -> Result<Vec<ChainedAuditLogEntry>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        list_all_audit_conn(tx).await
    }
}
