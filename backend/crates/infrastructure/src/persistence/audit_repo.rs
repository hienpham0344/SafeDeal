use async_trait::async_trait;
use safedeal_domain::dispute::AuditLogEntry;
use safedeal_domain::ports::AuditLogRepository;
use safedeal_shared::DomainError;
use sqlx::{PgConnection, PgPool};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

async fn append_audit_conn(
    conn: &mut PgConnection,
    entry: &AuditLogEntry,
) -> Result<(), DomainError> {
    let actor = entry.actor_address.as_deref().map(str::to_ascii_lowercase);
    sqlx::query(
        r#"
        INSERT INTO audit_logs (
            action, actor_address, resource_type, resource_id, correlation_id, details, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(&entry.action)
    .bind(&actor)
    .bind(&entry.resource_type)
    .bind(&entry.resource_id)
    .bind(&entry.correlation_id)
    .bind(&entry.details)
    .bind(entry.created_at)
    .execute(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(())
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
        let mut conn = acquire_conn(&self.pool).await?;
        append_audit_conn(&mut conn, entry).await
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
        append_audit_conn(tx, entry).await
    }
}
