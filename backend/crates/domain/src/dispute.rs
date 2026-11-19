use std::fmt;

use chrono::{DateTime, Utc};
use safedeal_shared::DomainError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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

    /// Verifies that downloaded evidence bytes match the recorded SHA-256 digest when present.
    pub fn verify_bytes_integrity(&self, bytes: &[u8]) -> Result<(), DomainError> {
        if let Some(expected) = self
            .sha256_hex
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let actual = hex::encode(Sha256::digest(bytes));
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(DomainError::internal(
                    "Stored evidence integrity verification failed (SHA-256 mismatch).",
                ));
            }
        }
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_evidence_sha256_integrity_and_rejects_tampered_bytes() {
        let payload = b"immutable dispute proof";
        let expected_sha = hex::encode(Sha256::digest(payload));
        let evidence = DisputeEvidence {
            id: Some(1),
            dispute_id: 10,
            submitted_by: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".to_string(),
            title: "Tracking Proof".to_string(),
            notes: "Verified courier receipt".to_string(),
            file_name: Some("proof.txt".to_string()),
            mime_type: Some("text/plain".to_string()),
            size_bytes: Some(payload.len() as i64),
            sha256_hex: Some(expected_sha),
            storage_key: Some("10/proof.txt".to_string()),
            created_at: Utc::now(),
        };

        assert!(evidence.verify_bytes_integrity(payload).is_ok());
        let err = evidence
            .verify_bytes_integrity(b"tampered dispute proof")
            .unwrap_err();
        assert!(matches!(err, DomainError::Internal(_)));
        assert!(err.to_string().contains("SHA-256 mismatch"));
    }
}
