use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::auth::{AuthNonce, UserAccount};
use safedeal_domain::ports::{AuthNonceRepository, UserRepository};
use safedeal_shared::DomainError;
use sqlx::{PgConnection, PgPool};

use super::{acquire_conn, map_sqlx_err, PgTxHandle};

#[derive(sqlx::FromRow)]
struct AuthNonceRow {
    id: i64,
    nonce: String,
    wallet_address: String,
    chain_id: i64,
    siwe_message: String,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    consumed_at: Option<DateTime<Utc>>,
}

impl From<AuthNonceRow> for AuthNonce {
    fn from(r: AuthNonceRow) -> Self {
        Self {
            id: Some(r.id),
            nonce: r.nonce,
            wallet_address: r.wallet_address,
            chain_id: r.chain_id,
            siwe_message: r.siwe_message,
            issued_at: r.issued_at,
            expires_at: r.expires_at,
            consumed_at: r.consumed_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct UserRow {
    id: i64,
    wallet_address: String,
    created_at: DateTime<Utc>,
    last_login_at: DateTime<Utc>,
}

impl From<UserRow> for UserAccount {
    fn from(r: UserRow) -> Self {
        Self {
            id: Some(r.id),
            wallet_address: r.wallet_address,
            created_at: r.created_at,
            last_login_at: r.last_login_at,
        }
    }
}

async fn save_nonce_conn(conn: &mut PgConnection, nonce: &AuthNonce) -> Result<AuthNonce, DomainError> {
    let wallet = nonce.wallet_address.to_ascii_lowercase();
    let row = match nonce.id {
        None => {
            sqlx::query_as::<_, AuthNonceRow>(
                r#"
                INSERT INTO auth_nonces (nonce, wallet_address, chain_id, siwe_message, issued_at, expires_at, consumed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, nonce, wallet_address, chain_id, siwe_message, issued_at, expires_at, consumed_at
                "#,
            )
            .bind(&nonce.nonce)
            .bind(&wallet)
            .bind(nonce.chain_id)
            .bind(&nonce.siwe_message)
            .bind(nonce.issued_at)
            .bind(nonce.expires_at)
            .bind(nonce.consumed_at)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
        Some(id) => {
            sqlx::query_as::<_, AuthNonceRow>(
                r#"
                UPDATE auth_nonces
                SET nonce = $2, wallet_address = $3, chain_id = $4, siwe_message = $5,
                    issued_at = $6, expires_at = $7, consumed_at = $8
                WHERE id = $1
                RETURNING id, nonce, wallet_address, chain_id, siwe_message, issued_at, expires_at, consumed_at
                "#,
            )
            .bind(id)
            .bind(&nonce.nonce)
            .bind(&wallet)
            .bind(nonce.chain_id)
            .bind(&nonce.siwe_message)
            .bind(nonce.issued_at)
            .bind(nonce.expires_at)
            .bind(nonce.consumed_at)
            .fetch_one(conn)
            .await
            .map_err(map_sqlx_err)?
        }
    };
    Ok(row.into())
}

async fn find_nonce_conn(
    conn: &mut PgConnection,
    nonce: &str,
) -> Result<Option<AuthNonce>, DomainError> {
    let row = sqlx::query_as::<_, AuthNonceRow>(
        r#"
        SELECT id, nonce, wallet_address, chain_id, siwe_message, issued_at, expires_at, consumed_at
        FROM auth_nonces
        WHERE nonce = $1
        "#,
    )
    .bind(nonce)
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.map(Into::into))
}

async fn consume_nonce_conn(
    conn: &mut PgConnection,
    nonce: &str,
    wallet_address: &str,
    chain_id: i64,
    now: DateTime<Utc>,
) -> Result<bool, DomainError> {
    let res = sqlx::query(
        r#"
        UPDATE auth_nonces
        SET consumed_at = $4
        WHERE nonce = $1
          AND wallet_address = $2
          AND chain_id = $3
          AND consumed_at IS NULL
          AND expires_at > $4
        "#,
    )
    .bind(nonce)
    .bind(wallet_address.trim().to_ascii_lowercase())
    .bind(chain_id)
    .bind(now)
    .execute(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(res.rows_affected() == 1)
}

async fn upsert_user_conn(
    conn: &mut PgConnection,
    wallet_address: &str,
    login_at: DateTime<Utc>,
) -> Result<UserAccount, DomainError> {
    let normalized = wallet_address.to_ascii_lowercase();
    let row = sqlx::query_as::<_, UserRow>(
        r#"
        INSERT INTO users (wallet_address, created_at, last_login_at)
        VALUES ($1, $2, $2)
        ON CONFLICT (wallet_address) DO UPDATE
        SET last_login_at = EXCLUDED.last_login_at
        RETURNING id, wallet_address, created_at, last_login_at
        "#,
    )
    .bind(&normalized)
    .bind(login_at)
    .fetch_one(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.into())
}

async fn find_user_conn(
    conn: &mut PgConnection,
    wallet_address: &str,
) -> Result<Option<UserAccount>, DomainError> {
    let row = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, wallet_address, created_at, last_login_at
        FROM users
        WHERE wallet_address = $1
        "#,
    )
    .bind(wallet_address.trim().to_ascii_lowercase())
    .fetch_optional(conn)
    .await
    .map_err(map_sqlx_err)?;
    Ok(row.map(Into::into))
}

pub struct PgAuthNonceRepository {
    pool: PgPool,
}

impl PgAuthNonceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuthNonceRepository for PgAuthNonceRepository {
    async fn save(&self, nonce: &AuthNonce) -> Result<AuthNonce, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        save_nonce_conn(&mut conn, nonce).await
    }

    async fn find_by_nonce(&self, nonce: &str) -> Result<Option<AuthNonce>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_nonce_conn(&mut conn, nonce).await
    }

    async fn consume_once(
        &self,
        nonce: &str,
        wallet_address: &str,
        chain_id: i64,
        now: DateTime<Utc>,
    ) -> Result<bool, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        consume_nonce_conn(&mut conn, nonce, wallet_address, chain_id, now).await
    }
}

pub(crate) struct PgTxAuthNonceRepository {
    tx: PgTxHandle,
}

impl PgTxAuthNonceRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl AuthNonceRepository for PgTxAuthNonceRepository {
    async fn save(&self, nonce: &AuthNonce) -> Result<AuthNonce, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        save_nonce_conn(tx, nonce).await
    }

    async fn find_by_nonce(&self, nonce: &str) -> Result<Option<AuthNonce>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_nonce_conn(tx, nonce).await
    }

    async fn consume_once(
        &self,
        nonce: &str,
        wallet_address: &str,
        chain_id: i64,
        now: DateTime<Utc>,
    ) -> Result<bool, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        consume_nonce_conn(tx, nonce, wallet_address, chain_id, now).await
    }
}

pub struct PgUserRepository {
    pool: PgPool,
}

impl PgUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepository for PgUserRepository {
    async fn upsert_login(
        &self,
        wallet_address: &str,
        login_at: DateTime<Utc>,
    ) -> Result<UserAccount, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        upsert_user_conn(&mut conn, wallet_address, login_at).await
    }

    async fn find_by_wallet_address(
        &self,
        wallet_address: &str,
    ) -> Result<Option<UserAccount>, DomainError> {
        let mut conn = acquire_conn(&self.pool).await?;
        find_user_conn(&mut conn, wallet_address).await
    }
}

pub(crate) struct PgTxUserRepository {
    tx: PgTxHandle,
}

impl PgTxUserRepository {
    pub(crate) fn new(tx: PgTxHandle) -> Self {
        Self { tx }
    }
}

#[async_trait]
impl UserRepository for PgTxUserRepository {
    async fn upsert_login(
        &self,
        wallet_address: &str,
        login_at: DateTime<Utc>,
    ) -> Result<UserAccount, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        upsert_user_conn(tx, wallet_address, login_at).await
    }

    async fn find_by_wallet_address(
        &self,
        wallet_address: &str,
    ) -> Result<Option<UserAccount>, DomainError> {
        let mut guard = self.tx.lock().await;
        let tx = guard
            .as_mut()
            .ok_or_else(|| DomainError::internal("Transaction already finalized"))?;
        find_user_conn(tx, wallet_address).await
    }
}
