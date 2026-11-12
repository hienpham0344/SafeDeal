use std::str::FromStr;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::deal::{Deal, DealStatus};
use safedeal_domain::ports::{DealRepository, PageSlice};
use safedeal_shared::DomainError;
use sqlx::{PgConnection, PgPool, Postgres, QueryBuilder};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

#[derive(sqlx::FromRow)]
struct DealJoinedRow {
    id: i64,
    trade_id: String,
    chain_id: i64,
    contract_address: String,
    seller_address: String,
    buyer_address: Option<String>,
    arbiter_address: String,
    amount_wei: String,
    terms_hash: String,
    funding_deadline: DateTime<Utc>,
    delivery_deadline: DateTime<Utc>,
    inspection_window_seconds: i64,
    delivered_at: Option<DateTime<Utc>>,
    funded_at: Option<DateTime<Utc>>,
    status: String,
    on_chain_bound: bool,
    settled: bool,
    create_tx_hash: Option<String>,
    buyer_award_wei: Option<String>,
    seller_award_wei: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    title: Option<String>,
    description: Option<String>,
    terms_text: Option<String>,
    canonical_json: Option<String>,
    schema_version: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct DealRow {
    id: i64,
    trade_id: String,
    chain_id: i64,
    contract_address: String,
    seller_address: String,
    buyer_address: Option<String>,
    arbiter_address: String,
    amount_wei: String,
    terms_hash: String,
    funding_deadline: DateTime<Utc>,
    delivery_deadline: DateTime<Utc>,
    inspection_window_seconds: i64,
    delivered_at: Option<DateTime<Utc>>,
    funded_at: Option<DateTime<Utc>>,
    status: String,
    on_chain_bound: bool,
    settled: bool,
    create_tx_hash: Option<String>,
    buyer_award_wei: Option<String>,
    seller_award_wei: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct DealTermsRow {
    title: String,
    description: String,
    terms_text: String,
    canonical_json: String,
    schema_version: i32,
}

fn row_to_deal(r: DealJoinedRow) -> Result<Deal, DomainError> {
    let status = DealStatus::from_str(&r.status)?;
    Ok(Deal {
        id: Some(r.id),
        trade_id: r.trade_id,
        chain_id: r.chain_id,
        contract_address: r.contract_address,
        seller: r.seller_address,
        buyer: r.buyer_address,
        arbiter: r.arbiter_address,
        amount_wei: r.amount_wei,
        terms_hash: r.terms_hash,
        funding_deadline: r.funding_deadline,
        delivery_deadline: r.delivery_deadline,
        inspection_window_seconds: r.inspection_window_seconds,
        delivered_at: r.delivered_at,
        funded_at: r.funded_at,
        status,
        on_chain_bound: r.on_chain_bound,
        settled: r.settled,
        create_tx_hash: r.create_tx_hash,
        buyer_award_wei: r.buyer_award_wei,
        seller_award_wei: r.seller_award_wei,
        title: r.title.unwrap_or_default(),
        description: r.description.unwrap_or_default(),
        terms: r.terms_text.unwrap_or_default(),
        canonical_terms_json: r.canonical_json.unwrap_or_else(|| "{}".to_string()),
        schema_version: r.schema_version.unwrap_or(1),
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

const SELECT_DEAL_JOINED: &str = r#"
    SELECT d.id, d.trade_id, d.chain_id, d.contract_address, d.seller_address, d.buyer_address,
           d.arbiter_address, d.amount_wei, d.terms_hash, d.funding_deadline, d.delivery_deadline,
           d.inspection_window_seconds, d.delivered_at, d.funded_at, d.status, d.on_chain_bound,
           d.settled, d.create_tx_hash, d.buyer_award_wei, d.seller_award_wei, d.created_at, d.updated_at,
           t.title, t.description, t.terms_text, t.canonical_json, t.schema_version
    FROM deals d
    LEFT JOIN deal_terms t ON t.deal_id = d.id
"#;

async fn save_deal_conn(conn: &mut PgConnection, deal: &Deal) -> Result<Deal, DomainError> {
    let trade_id = deal.trade_id.to_ascii_lowercase();
    let contract = deal.contract_address.to_ascii_lowercase();
    let seller = deal.seller.to_ascii_lowercase();
    let buyer = deal.buyer.as_ref().map(|b| b.to_ascii_lowercase());
    let arbiter = deal.arbiter.to_ascii_lowercase();
    let terms_hash = deal.terms_hash.to_ascii_lowercase();
    let create_tx_hash = deal
        .create_tx_hash
        .as_ref()
        .map(|h| h.to_ascii_lowercase());
    let status_str = deal.status.as_str();

    let saved_deal = match deal.id {
        None => {
            sqlx::query_as::<_, DealRow>(
                r#"
                INSERT INTO deals (
                    trade_id, chain_id, contract_address, seller_address, buyer_address, arbiter_address,
                    amount_wei, terms_hash, funding_deadline, delivery_deadline, inspection_window_seconds,
                    delivered_at, funded_at, status, on_chain_bound, settled, create_tx_hash,
                    buyer_award_wei, seller_award_wei, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11,
                    $12, $13, $14, $15, $16, $17,
                    $18, $19, $20, $21
                )
                RETURNING id, trade_id, chain_id, contract_address, seller_address, buyer_address,
                          arbiter_address, amount_wei, terms_hash, funding_deadline, delivery_deadline,
                          inspection_window_seconds, delivered_at, funded_at, status, on_chain_bound,
                          settled, create_tx_hash, buyer_award_wei, seller_award_wei, created_at, updated_at
                "#,
            )
            .bind(&trade_id)
            .bind(deal.chain_id)
            .bind(&contract)
            .bind(&seller)
            .bind(&buyer)
            .bind(&arbiter)
            .bind(&deal.amount_wei)
            .bind(&terms_hash)
            .bind(deal.funding_deadline)
            .bind(deal.delivery_deadline)
            .bind(deal.inspection_window_seconds)
            .bind(deal.delivered_at)
            .bind(deal.funded_at)
            .bind(status_str)
            .bind(deal.on_chain_bound)
            .bind(deal.settled)
            .bind(&create_tx_hash)
            .bind(&deal.buyer_award_wei)
            .bind(&deal.seller_award_wei)
            .bind(deal.created_at)
            .bind(deal.updated_at)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_err)?
        }
        Some(id) => {
            sqlx::query_as::<_, DealRow>(
                r#"
                UPDATE deals SET
                    trade_id = $2, chain_id = $3, contract_address = $4, seller_address = $5,
                    buyer_address = $6, arbiter_address = $7, amount_wei = $8, terms_hash = $9,
                    funding_deadline = $10, delivery_deadline = $11, inspection_window_seconds = $12,
                    delivered_at = $13, funded_at = $14, status = $15, on_chain_bound = $16,
                    settled = $17, create_tx_hash = $18, buyer_award_wei = $19,
                    seller_award_wei = $20, updated_at = $21
                WHERE id = $1
                RETURNING id, trade_id, chain_id, contract_address, seller_address, buyer_address,
                          arbiter_address, amount_wei, terms_hash, funding_deadline, delivery_deadline,
                          inspection_window_seconds, delivered_at, funded_at, status, on_chain_bound,
                          settled, create_tx_hash, buyer_award_wei, seller_award_wei, created_at, updated_at
                "#,
            )
            .bind(id)
            .bind(&trade_id)
            .bind(deal.chain_id)
            .bind(&contract)
            .bind(&seller)
            .bind(&buyer)
            .bind(&arbiter)
            .bind(&deal.amount_wei)
            .bind(&terms_hash)
            .bind(deal.funding_deadline)
            .bind(deal.delivery_deadline)
            .bind(deal.inspection_window_seconds)
            .bind(deal.delivered_at)
            .bind(deal.funded_at)
            .bind(status_str)
            .bind(deal.on_chain_bound)
            .bind(deal.settled)
            .bind(&create_tx_hash)
            .bind(&deal.buyer_award_wei)
            .bind(&deal.seller_award_wei)
            .bind(deal.updated_at)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sqlx_err)?
        }
    };

    let saved_terms = sqlx::query_as::<_, DealTermsRow>(
        r#"
        INSERT INTO deal_terms (deal_id, title, description, terms_text, canonical_json, terms_hash, schema_version, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (deal_id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            terms_text = EXCLUDED.terms_text,
            canonical_json = EXCLUDED.canonical_json,
            terms_hash = EXCLUDED.terms_hash,
            schema_version = EXCLUDED.schema_version
        RETURNING title, description, terms_text, canonical_json, schema_version
        "#,
    )
    .bind(saved_deal.id)
    .bind(&deal.title)
    .bind(&deal.description)
    .bind(&deal.terms)
    .bind(&deal.canonical_terms_json)
    .bind(&terms_hash)
    .bind(deal.schema_version)
    .bind(deal.created_at)
    .fetch_one(conn)
    .await
    .map_err(map_sqlx_err)?;

    let status = DealStatus::from_str(&saved_deal.status)?;
    Ok(Deal {
        id: Some(saved_deal.id),
        trade_id: saved_deal.trade_id,
        chain_id: saved_deal.chain_id,
        contract_address: saved_deal.contract_address,
        seller: saved_deal.seller_address,
        buyer: saved_deal.buyer_address,
        arbiter: saved_deal.arbiter_address,
        amount_wei: saved_deal.amount_wei,
        terms_hash: saved_deal.terms_hash,
        funding_deadline: saved_deal.funding_deadline,
        delivery_deadline: saved_deal.delivery_deadline,
        inspection_window_seconds: saved_deal.inspection_window_seconds,
        delivered_at: saved_deal.delivered_at,
        funded_at: saved_deal.funded_at,
        status,
        on_chain_bound: saved_deal.on_chain_bound,
        settled: saved_deal.settled,
        create_tx_hash: saved_deal.create_tx_hash,
        buyer_award_wei: saved_deal.buyer_award_wei,
        seller_award_wei: saved_deal.seller_award_wei,
        title: saved_terms.title,
        description: saved_terms.description,
        terms: saved_terms.terms_text,
        canonical_terms_json: saved_terms.canonical_json,
        schema_version: saved_terms.schema_version,
        created_at: saved_deal.created_at,
        updated_at: saved_deal.updated_at,
    })
}

async fn find_by_trade_id_conn(
    conn: &mut PgConnection,
    trade_id: &str,
) -> Result<Option<Deal>, DomainError> {
    let sql = format!("{SELECT_DEAL_JOINED} WHERE d.trade_id = $1");
    let row = sqlx::query_as::<_, DealJoinedRow>(&sql)
        .bind(trade_id.trim().to_ascii_lowercase())
        .fetch_optional(conn)
        .await
        .map_err(map_sqlx_err)?;
    row.map(row_to_deal).transpose()
}

async fn find_by_trade_ids_conn(
    conn: &mut PgConnection,
    trade_ids: &[String],
) -> Result<Vec<Deal>, DomainError> {
    let mut normalized: Vec<String> = trade_ids
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }

    let sql = format!("{SELECT_DEAL_JOINED} WHERE d.trade_id = ANY($1)");
    let rows = sqlx::query_as::<_, DealJoinedRow>(&sql)
        .bind(&normalized)
        .fetch_all(conn)
        .await
        .map_err(map_sqlx_err)?;
    rows.into_iter().map(row_to_deal).collect()
}

async fn find_by_trade_id_for_update_conn(
    conn: &mut PgConnection,
    trade_id: &str,
) -> Result<Option<Deal>, DomainError> {
    let sql = format!("{SELECT_DEAL_JOINED} WHERE d.trade_id = $1 FOR UPDATE OF d");
    let row = sqlx::query_as::<_, DealJoinedRow>(&sql)
        .bind(trade_id.trim().to_ascii_lowercase())
        .fetch_optional(conn)
        .await
        .map_err(map_sqlx_err)?;
    row.map(row_to_deal).transpose()
}

async fn find_by_create_tx_hash_conn(
    conn: &mut PgConnection,
    create_tx_hash: &str,
) -> Result<Option<Deal>, DomainError> {
    if create_tx_hash.trim().is_empty() {
        return Ok(None);
    }
    let sql = format!("{SELECT_DEAL_JOINED} WHERE d.create_tx_hash = $1");
    let row = sqlx::query_as::<_, DealJoinedRow>(&sql)
        .bind(create_tx_hash.trim().to_ascii_lowercase())
        .fetch_optional(conn)
        .await
        .map_err(map_sqlx_err)?;
    row.map(row_to_deal).transpose()
}

async fn exists_by_create_tx_hash_conn(
    conn: &mut PgConnection,
    create_tx_hash: &str,
) -> Result<bool, DomainError> {
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM deals WHERE create_tx_hash = $1)")
            .bind(create_tx_hash.trim().to_ascii_lowercase())
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?;
    Ok(exists)
}

fn push_role_filter<'a>(
    qb: &mut QueryBuilder<'a, Postgres>,
    role: &'a str,
    lower_wallet: &'a str,
) {
    match role {
        "seller" | "created" => {
            qb.push("d.seller_address = ");
            qb.push_bind(lower_wallet);
        }
        "buyer" => {
            qb.push("d.buyer_address = ");
            qb.push_bind(lower_wallet);
        }
        "funded" => {
            qb.push("(d.buyer_address = ");
            qb.push_bind(lower_wallet);
            qb.push(" AND d.status NOT IN ('DRAFT', 'CREATED'))");
        }
        "arbiter" => {
            qb.push("d.arbiter_address = ");
            qb.push_bind(lower_wallet);
        }
        _ => {
            qb.push("(d.seller_address = ");
            qb.push_bind(lower_wallet);
            qb.push(" OR d.buyer_address = ");
            qb.push_bind(lower_wallet);
            qb.push(" OR d.arbiter_address = ");
            qb.push_bind(lower_wallet);
            qb.push(")");
        }
    }
}

async fn find_user_deals_conn(
    conn: &mut PgConnection,
    wallet_address: &str,
    role: Option<&str>,
    status_filter: Option<DealStatus>,
    page: i32,
    size: i32,
) -> Result<PageSlice, DomainError> {
    let page = page.max(0);
    let size = size.max(1);
    let offset = i64::from(page) * i64::from(size);
    let limit = i64::from(size);

    let lower_wallet = wallet_address.trim().to_ascii_lowercase();
    let normalized_role = role
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();

    let mut count_qb = QueryBuilder::<Postgres>::new("SELECT COUNT(*) FROM deals d WHERE ");
    push_role_filter(&mut count_qb, &normalized_role, &lower_wallet);
    if let Some(status) = status_filter {
        count_qb.push(" AND d.status = ");
        count_qb.push_bind(status.as_str());
    }
    let total_items: i64 = count_qb
        .build_query_scalar()
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_err)?;

    let mut data_qb = QueryBuilder::<Postgres>::new(SELECT_DEAL_JOINED);
    data_qb.push(" WHERE ");
    push_role_filter(&mut data_qb, &normalized_role, &lower_wallet);
    if let Some(status) = status_filter {
        data_qb.push(" AND d.status = ");
        data_qb.push_bind(status.as_str());
    }
    data_qb.push(" ORDER BY d.created_at DESC, d.id DESC LIMIT ");
    data_qb.push_bind(limit);
    data_qb.push(" OFFSET ");
    data_qb.push_bind(offset);

    let rows = data_qb
        .build_query_as::<DealJoinedRow>()
        .fetch_all(conn)
        .await
        .map_err(map_sqlx_err)?;

    let items = rows
        .into_iter()
        .map(row_to_deal)
        .collect::<Result<Vec<_>, _>>()?;
    let total_pages = if total_items == 0 {
        0
    } else {
        ((total_items + limit - 1) / limit) as i32
    };

    Ok(PageSlice {
        items,
        page,
        size,
        total_items,
        total_pages,
    })
}

async fn find_open_bound_deals_conn(conn: &mut PgConnection) -> Result<Vec<Deal>, DomainError> {
    let sql = format!("{SELECT_DEAL_JOINED} WHERE d.on_chain_bound = TRUE AND d.settled = FALSE");
    let rows = sqlx::query_as::<_, DealJoinedRow>(&sql)
        .fetch_all(conn)
        .await
        .map_err(map_sqlx_err)?;
    rows.into_iter().map(row_to_deal).collect()
}

pub struct PgDealRepository {
    pool: PgPool,
}

impl PgDealRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DealRepository for PgDealRepository {
    async fn save(&self, deal: &Deal) -> Result<Deal, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let saved = save_deal_conn(&mut tx, deal).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(saved)
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Deal>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_by_trade_id_conn(&mut conn, trade_id).await
    }

    async fn find_by_trade_ids(&self, trade_ids: &[String]) -> Result<Vec<Deal>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_by_trade_ids_conn(&mut conn, trade_ids).await
    }

    async fn find_by_trade_id_for_update(&self, trade_id: &str) -> Result<Option<Deal>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_by_trade_id_for_update_conn(&mut conn, trade_id).await
    }

    async fn find_by_create_tx_hash(
        &self,
        create_tx_hash: &str,
    ) -> Result<Option<Deal>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_by_create_tx_hash_conn(&mut conn, create_tx_hash).await
    }

    async fn exists_by_create_tx_hash(&self, create_tx_hash: &str) -> Result<bool, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        exists_by_create_tx_hash_conn(&mut conn, create_tx_hash).await
    }

    async fn find_user_deals(
        &self,
        wallet_address: &str,
        role: Option<&str>,
        status_filter: Option<DealStatus>,
        page: i32,
        size: i32,
    ) -> Result<PageSlice, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_user_deals_conn(&mut conn, wallet_address, role, status_filter, page, size).await
    }

    async fn find_open_bound_deals(&self) -> Result<Vec<Deal>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_open_bound_deals_conn(&mut conn).await
    }
}

pub(crate) struct PgTxDealRepository {
    tx: PgTxHandle,
}

impl PgTxDealRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl DealRepository for PgTxDealRepository {
    async fn save(&self, deal: &Deal) -> Result<Deal, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_deal_conn(tx, deal).await
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Deal>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_by_trade_id_conn(tx, trade_id).await
    }

    async fn find_by_trade_ids(&self, trade_ids: &[String]) -> Result<Vec<Deal>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_by_trade_ids_conn(tx, trade_ids).await
    }

    async fn find_by_trade_id_for_update(&self, trade_id: &str) -> Result<Option<Deal>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_by_trade_id_for_update_conn(tx, trade_id).await
    }

    async fn find_by_create_tx_hash(
        &self,
        create_tx_hash: &str,
    ) -> Result<Option<Deal>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_by_create_tx_hash_conn(tx, create_tx_hash).await
    }

    async fn exists_by_create_tx_hash(&self, create_tx_hash: &str) -> Result<bool, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        exists_by_create_tx_hash_conn(tx, create_tx_hash).await
    }

    async fn find_user_deals(
        &self,
        wallet_address: &str,
        role: Option<&str>,
        status_filter: Option<DealStatus>,
        page: i32,
        size: i32,
    ) -> Result<PageSlice, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_user_deals_conn(tx, wallet_address, role, status_filter, page, size).await
    }

    async fn find_open_bound_deals(&self) -> Result<Vec<Deal>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_open_bound_deals_conn(tx).await
    }
}
