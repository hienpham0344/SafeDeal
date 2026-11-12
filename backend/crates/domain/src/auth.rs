use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedPrincipal {
    pub address: String,
    pub chain_id: i64,
    pub authenticated_at: DateTime<Utc>,
    pub csrf_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthNonce {
    pub id: Option<i64>,
    pub nonce: String,
    pub wallet_address: String,
    pub chain_id: i64,
    pub siwe_message: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
}

impl AuthNonce {
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        now >= self.expires_at
    }

    pub fn is_consumed(&self) -> bool {
        self.consumed_at.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserAccount {
    pub id: Option<i64>,
    pub wallet_address: String,
    pub created_at: DateTime<Utc>,
    pub last_login_at: DateTime<Utc>,
}
