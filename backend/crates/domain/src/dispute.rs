use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DisputeStatus {
    Open,
    Resolved,
}

impl DisputeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Resolved => "RESOLVED",
        }
    }
}

impl fmt::Display for DisputeStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dispute {
    pub id: Option<i64>,
    pub trade_id: String,
    pub opened_by: String,
    pub reason: String,
    pub summary: String,
    pub status: DisputeStatus,
    pub buyer_award_wei: Option<String>,
    pub seller_award_wei: Option<String>,
    pub resolution_rationale: Option<String>,
    pub open_tx_hash: Option<String>,
    pub resolve_tx_hash: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisputeEvidence {
    pub id: Option<i64>,
    pub dispute_id: i64,
    pub submitted_by: String,
    pub title: String,
    pub notes: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub sha256_hex: Option<String>,
    pub storage_key: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl DisputeEvidence {
    pub fn has_attachment(&self) -> bool {
        self.storage_key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditLogEntry {
    pub id: Option<i64>,
    pub action: String,
    pub actor_address: Option<String>,
    pub resource_type: String,
    pub resource_id: String,
    pub correlation_id: Option<String>,
    pub details: String,
    pub created_at: DateTime<Utc>,
}
