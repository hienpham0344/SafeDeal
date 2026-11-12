use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::dispute::{Dispute, DisputeEvidence, DisputeStatus};
use safedeal_domain::ports::{DisputeEvidenceRepository, DisputeRepository};
use safedeal_shared::DomainError;
use sqlx::{PgConnection, PgPool};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

#[derive(sqlx::FromRow)]
struct DisputeRow {
    id: i64,
    trade_id: String,
    opened_by: String,
    reason: String,
    summary: String,
    status: String,
    buyer_award_wei: Option<String>,
    seller_award_wei: Option<String>,
    resolution_rationale: Option<String>,
    open_tx_hash: Option<String>,
    resolve_tx_hash: Option<String>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

impl TryFrom<DisputeRow> for Dispute {
    type Error = DomainError;

    fn try_from(r: DisputeRow) -> Result<Self, Self::Error> {
        let status = match r.status.as_str() {
            "OPEN" => DisputeStatus::Open,
            "RESOLVED" => DisputeStatus::Resolved,
            other => {
                return Err(DomainError::internal(format!(
                    "Invalid dispute status in DB: {other}"
                )))
            }
        };
        Ok(Self {
            id: Some(r.id),
            trade_id: r.trade_id,
            opened_by: r.opened_by,
            reason: r.reason,
            summary: r.summary,
            status,
            buyer_award_wei: r.buyer_award_wei,
            seller_award_wei: r.seller_award_wei,
            resolution_rationale: r.resolution_rationale,
            open_tx_hash: r.open_tx_hash,
            resolve_tx_hash: r.resolve_tx_hash,
            created_at: r.created_at,
            resolved_at: r.resolved_at,
        })
    }
}

#[derive(sqlx::FromRow)]
struct EvidenceRow {
    id: i64,
    dispute_id: i64,
    submitted_by: String,
    title: String,
    notes: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    sha256_hex: Option<String>,
    storage_key: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<EvidenceRow> for DisputeEvidence {
    fn from(r: EvidenceRow) -> Self {
        Self {
            id: Some(r.id),
            dispute_id: r.dispute_id,
            submitted_by: r.submitted_by,
            title: r.title,
            notes: r.notes,
            file_name: r.file_name,
            mime_type: r.mime_type,
            size_bytes: r.size_bytes,
            sha256_hex: r.sha256_hex,
            storage_key: r.storage_key,
            created_at: r.created_at,
        }
    }
}

async fn save_dispute_conn(
    conn: &mut PgConnection,
    dispute: &Dispute,
) -> Result<Dispute, DomainError> {
    let trade_id = dispute.trade_id.to_ascii_lowercase();
    let opened_by = dispute.opened_by.to_ascii_lowercase();
    let open_tx = dispute.open_tx_hash.as_ref().map(|h| h.to_ascii_lowercase());
    let resolve_tx = dispute
        .resolve_tx_hash
        .as_ref()
        .map(|h| h.to_ascii_lowercase());
    let status = dispute.status.as_str();

    let row = match dispute.id {
        None => {
            sqlx::query_as::<_, DisputeRow>(
                r#"
                INSERT INTO disputes (
                    trade_id, opened_by, reason, summary, status,
                    buyer_award_wei, seller_award_wei, resolution_rationale,
                    open_tx_hash, resolve_tx_hash, created_at, resolved_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id, trade_id, opened_by, reason, summary, status,
                          buyer_award_wei, seller_award_wei, resolution_rationale,
                          open_tx_hash, resolve_tx_hash, created_at, resolved_at
                "#,
            )
            .bind(&trade_id)
            .bind(&opened_by)
            .bind(&dispute.reason)
            .bind(&dispute.summary)
            .bind(status)
            .bind(&dispute.buyer_award_wei)
            .bind(&dispute.seller_award_wei)
            .bind(&dispute.resolution_rationale)
            .bind(&open_tx)
            .bind(&resolve_tx)
            .bind(dispute.created_at)
            .bind(dispute.resolved_at)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
        Some(id) => {
            sqlx::query_as::<_, DisputeRow>(
                r#"
                UPDATE disputes SET
                    trade_id = $2, opened_by = $3, reason = $4, summary = $5, status = $6,
                    buyer_award_wei = $7, seller_award_wei = $8, resolution_rationale = $9,
                    open_tx_hash = $10, resolve_tx_hash = $11, resolved_at = $12
                WHERE id = $1
                RETURNING id, trade_id, opened_by, reason, summary, status,
                          buyer_award_wei, seller_award_wei, resolution_rationale,
                          open_tx_hash, resolve_tx_hash, created_at, resolved_at
                "#,
            )
            .bind(id)
            .bind(&trade_id)
            .bind(&opened_by)
            .bind(&dispute.reason)
            .bind(&dispute.summary)
            .bind(status)
            .bind(&dispute.buyer_award_wei)
            .bind(&dispute.seller_award_wei)
            .bind(&dispute.resolution_rationale)
            .bind(&open_tx)
            .bind(&resolve_tx)
            .bind(dispute.resolved_at)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
    };
    row.try_into()
}

async fn find_dispute_by_id_conn(
    conn: &mut PgConnection,
    id: i64,
) -> Result<Option<Dispute>, DomainError> {
    let row = sqlx::query_as::<_, DisputeRow>(
        r#"
        SELECT id, trade_id, opened_by, reason, summary, status,
               buyer_award_wei, seller_award_wei, resolution_rationale,
               open_tx_hash, resolve_tx_hash, created_at, resolved_at
        FROM disputes
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    row.map(TryInto::try_into).transpose()
}

async fn find_dispute_by_trade_id_conn(
    conn: &mut PgConnection,
    trade_id: &str,
) -> Result<Option<Dispute>, DomainError> {
    let row = sqlx::query_as::<_, DisputeRow>(
        r#"
        SELECT id, trade_id, opened_by, reason, summary, status,
               buyer_award_wei, seller_award_wei, resolution_rationale,
               open_tx_hash, resolve_tx_hash, created_at, resolved_at
        FROM disputes
        WHERE trade_id = $1
        "#,
    )
    .bind(trade_id.trim().to_ascii_lowercase())
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    row.map(TryInto::try_into).transpose()
}

async fn find_dispute_ids_by_trade_ids_conn(
    conn: &mut PgConnection,
    trade_ids: &[String],
) -> Result<HashMap<String, i64>, DomainError> {
    let mut normalized: Vec<String> = trade_ids
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return Ok(HashMap::new());
    }

    let rows =
        sqlx::query_as::<_, (String, i64)>("SELECT trade_id, id FROM disputes WHERE trade_id = ANY($1)")
            .bind(&normalized)
            .fetch_all(conn)
            .await
            .map_err(map_sqlx_err)?;

    let mut out = HashMap::with_capacity(rows.len());
    for (tid, id) in rows {
        out.entry(tid).or_insert(id);
    }
    Ok(out)
}

async fn find_assigned_to_arbiter_conn(
    conn: &mut PgConnection,
    arbiter_address: &str,
) -> Result<Vec<Dispute>, DomainError> {
    let rows = sqlx::query_as::<_, DisputeRow>(
        r#"
        SELECT disp.id, disp.trade_id, disp.opened_by, disp.reason, disp.summary, disp.status,
               disp.buyer_award_wei, disp.seller_award_wei, disp.resolution_rationale,
               disp.open_tx_hash, disp.resolve_tx_hash, disp.created_at, disp.resolved_at
        FROM disputes disp
        JOIN deals deal ON disp.trade_id = deal.trade_id
        WHERE deal.arbiter_address = $1
        ORDER BY disp.created_at DESC, disp.id DESC
        "#,
    )
    .bind(arbiter_address.trim().to_ascii_lowercase())
    .fetch_all(conn)
    .await
    .map_err(map_sqlx_err)?;
    rows.into_iter().map(TryInto::try_into).collect()
}

pub struct PgDisputeRepository {
    pool: PgPool,
}

impl PgDisputeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DisputeRepository for PgDisputeRepository {
    async fn save(&self, dispute: &Dispute) -> Result<Dispute, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_dispute_conn(&mut conn, dispute).await
    }

    async fn find_by_id(&self, id: i64) -> Result<Option<Dispute>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_dispute_by_id_conn(&mut conn, id).await
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Dispute>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_dispute_by_trade_id_conn(&mut conn, trade_id).await
    }

    async fn find_dispute_ids_by_trade_ids(
        &self,
        trade_ids: &[String],
    ) -> Result<HashMap<String, i64>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_dispute_ids_by_trade_ids_conn(&mut conn, trade_ids).await
    }

    async fn find_assigned_to_arbiter(
        &self,
        arbiter_address: &str,
    ) -> Result<Vec<Dispute>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_assigned_to_arbiter_conn(&mut conn, arbiter_address).await
    }
}

pub(crate) struct PgTxDisputeRepository {
    tx: PgTxHandle,
}

impl PgTxDisputeRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl DisputeRepository for PgTxDisputeRepository {
    async fn save(&self, dispute: &Dispute) -> Result<Dispute, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_dispute_conn(tx, dispute).await
    }

    async fn find_by_id(&self, id: i64) -> Result<Option<Dispute>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_dispute_by_id_conn(tx, id).await
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Dispute>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_dispute_by_trade_id_conn(tx, trade_id).await
    }

    async fn find_dispute_ids_by_trade_ids(
        &self,
        trade_ids: &[String],
    ) -> Result<HashMap<String, i64>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_dispute_ids_by_trade_ids_conn(tx, trade_ids).await
    }

    async fn find_assigned_to_arbiter(
        &self,
        arbiter_address: &str,
    ) -> Result<Vec<Dispute>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_assigned_to_arbiter_conn(tx, arbiter_address).await
    }
}

async fn save_evidence_conn(
    conn: &mut PgConnection,
    ev: &DisputeEvidence,
) -> Result<DisputeEvidence, DomainError> {
    let submitted_by = ev.submitted_by.to_ascii_lowercase();
    let row = match ev.id {
        None => {
            sqlx::query_as::<_, EvidenceRow>(
                r#"
                INSERT INTO dispute_evidence (
                    dispute_id, submitted_by, title, notes, file_name,
                    mime_type, size_bytes, sha256_hex, storage_key, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id, dispute_id, submitted_by, title, notes, file_name,
                          mime_type, size_bytes, sha256_hex, storage_key, created_at
                "#,
            )
            .bind(ev.dispute_id)
            .bind(&submitted_by)
            .bind(&ev.title)
            .bind(&ev.notes)
            .bind(&ev.file_name)
            .bind(&ev.mime_type)
            .bind(ev.size_bytes)
            .bind(&ev.sha256_hex)
            .bind(&ev.storage_key)
            .bind(ev.created_at)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
        Some(id) => {
            sqlx::query_as::<_, EvidenceRow>(
                r#"
                UPDATE dispute_evidence SET
                    title = $2, notes = $3, file_name = $4, mime_type = $5,
                    size_bytes = $6, sha256_hex = $7, storage_key = $8
                WHERE id = $1
                RETURNING id, dispute_id, submitted_by, title, notes, file_name,
                          mime_type, size_bytes, sha256_hex, storage_key, created_at
                "#,
            )
            .bind(id)
            .bind(&ev.title)
            .bind(&ev.notes)
            .bind(&ev.file_name)
            .bind(&ev.mime_type)
            .bind(ev.size_bytes)
            .bind(&ev.sha256_hex)
            .bind(&ev.storage_key)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
    };
    Ok(row.into())
}

async fn find_evidence_by_dispute_conn(
    conn: &mut PgConnection,
    dispute_id: i64,
) -> Result<Vec<DisputeEvidence>, DomainError> {
    let rows = sqlx::query_as::<_, EvidenceRow>(
        r#"
        SELECT id, dispute_id, submitted_by, title, notes, file_name,
               mime_type, size_bytes, sha256_hex, storage_key, created_at
        FROM dispute_evidence
        WHERE dispute_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(dispute_id)
    .fetch_all(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

async fn find_evidence_by_id_and_dispute_conn(
    conn: &mut PgConnection,
    evidence_id: i64,
    dispute_id: i64,
) -> Result<Option<DisputeEvidence>, DomainError> {
    let row = sqlx::query_as::<_, EvidenceRow>(
        r#"
        SELECT id, dispute_id, submitted_by, title, notes, file_name,
               mime_type, size_bytes, sha256_hex, storage_key, created_at
        FROM dispute_evidence
        WHERE id = $1 AND dispute_id = $2
        "#,
    )
    .bind(evidence_id)
    .bind(dispute_id)
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.map(Into::into))
}

pub struct PgDisputeEvidenceRepository {
    pool: PgPool,
}

impl PgDisputeEvidenceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DisputeEvidenceRepository for PgDisputeEvidenceRepository {
    async fn save(&self, evidence: &DisputeEvidence) -> Result<DisputeEvidence, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_evidence_conn(&mut conn, evidence).await
    }

    async fn find_by_dispute_id_order_by_created_at_asc(
        &self,
        dispute_id: i64,
    ) -> Result<Vec<DisputeEvidence>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_evidence_by_dispute_conn(&mut conn, dispute_id).await
    }

    async fn find_by_id_and_dispute_id(
        &self,
        evidence_id: i64,
        dispute_id: i64,
    ) -> Result<Option<DisputeEvidence>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_evidence_by_id_and_dispute_conn(&mut conn, evidence_id, dispute_id).await
    }
}

pub(crate) struct PgTxDisputeEvidenceRepository {
    tx: PgTxHandle,
}

impl PgTxDisputeEvidenceRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl DisputeEvidenceRepository for PgTxDisputeEvidenceRepository {
    async fn save(&self, evidence: &DisputeEvidence) -> Result<DisputeEvidence, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_evidence_conn(tx, evidence).await
    }

    async fn find_by_dispute_id_order_by_created_at_asc(
        &self,
        dispute_id: i64,
    ) -> Result<Vec<DisputeEvidence>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_evidence_by_dispute_conn(tx, dispute_id).await
    }

    async fn find_by_id_and_dispute_id(
        &self,
        evidence_id: i64,
        dispute_id: i64,
    ) -> Result<Option<DisputeEvidence>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_evidence_by_id_and_dispute_conn(tx, evidence_id, dispute_id).await
    }
}
