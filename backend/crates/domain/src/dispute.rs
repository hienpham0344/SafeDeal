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

pub const DEFAULT_EVIDENCE_SLA_SECONDS: i64 = 7 * 86_400;
pub const DEFAULT_DISPUTE_TIMEOUT_SECONDS: i64 = 14 * 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VoterRole {
    Buyer,
    Seller,
    Arbiter,
}

impl VoterRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Buyer => "BUYER",
            Self::Seller => "SELLER",
            Self::Arbiter => "ARBITER",
        }
    }
}

impl fmt::Display for VoterRole {
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
    pub disputed_at: Option<DateTime<Utc>>,
    pub dispute_timeout_seconds: i64,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisputeVote {
    pub id: Option<i64>,
    pub dispute_id: i64,
    pub trade_id: String,
    pub voter_address: String,
    pub voter_role: VoterRole,
    pub buyer_award_wei: String,
    pub seller_award_wei: String,
    pub proposal_hash: String,
    pub rationale: Option<String>,
    pub tx_hash: String,
    pub updated_at: DateTime<Utc>,
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

pub const AUDIT_GENESIS_HASH: &str = "GENESIS";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainedAuditLogEntry {
    pub entry: AuditLogEntry,
    pub prev_hash: String,
    pub entry_hash: String,
}

/// Computes the deterministic SHA-256 hex digest chaining `entry` onto `prev_hash`.
pub fn compute_audit_entry_hash(prev_hash: &str, entry: &AuditLogEntry) -> String {
    let payload = format!(
        "{prev_hash}|{}|{}|{}|{}|{}|{}|{}",
        entry.action,
        entry.actor_address.as_deref().unwrap_or(""),
        entry.resource_type,
        entry.resource_id,
        entry.correlation_id.as_deref().unwrap_or(""),
        entry.details,
        entry.created_at.timestamp_millis()
    );
    hex::encode(Sha256::digest(payload.as_bytes()))
}

/// Verifies an ordered sequence of hash-chained `audit_logs` records starting from `"GENESIS"`.
pub fn verify_audit_log_chain(entries: &[ChainedAuditLogEntry]) -> Result<(), DomainError> {
    let mut expected_prev = AUDIT_GENESIS_HASH;
    for (idx, item) in entries.iter().enumerate() {
        if item.prev_hash != expected_prev {
            return Err(DomainError::internal(format!(
                "Audit log chain broken at index {idx}: expected prev_hash '{expected_prev}', found '{}'.",
                item.prev_hash
            )));
        }
        let recomputed = compute_audit_entry_hash(&item.prev_hash, &item.entry);
        if !recomputed.eq_ignore_ascii_case(&item.entry_hash) {
            return Err(DomainError::internal(format!(
                "Audit log tamper detected at index {idx}: entry_hash mismatch."
            )));
        }
        expected_prev = &item.entry_hash;
    }
    Ok(())
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

    #[test]
    fn computes_deterministic_audit_hash_chain_and_detects_tampering_or_deletion() {
        let ts1 = DateTime::from_timestamp_millis(1_770_000_000_123).unwrap();
        let ts2 = DateTime::from_timestamp_millis(1_770_000_005_456).unwrap();

        let e1 = AuditLogEntry {
            id: Some(1),
            action: "AUTH_LOGIN_VERIFIED".to_string(),
            actor_address: Some("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".to_string()),
            resource_type: "USER".to_string(),
            resource_id: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".to_string(),
            correlation_id: Some("corr-1".to_string()),
            details: "Verified SIWE login on chainId=43113".to_string(),
            created_at: ts1,
        };
        let h1 = compute_audit_entry_hash(AUDIT_GENESIS_HASH, &e1);
        assert_eq!(h1.len(), 64);

        let e2 = AuditLogEntry {
            id: Some(2),
            action: "DEAL_DRAFT_CREATED".to_string(),
            actor_address: Some("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".to_string()),
            resource_type: "DEAL".to_string(),
            resource_id: "0x1111".to_string(),
            correlation_id: None,
            details: "Prepared draft".to_string(),
            created_at: ts2,
        };
        let h2 = compute_audit_entry_hash(&h1, &e2);

        let chain = vec![
            ChainedAuditLogEntry {
                entry: e1.clone(),
                prev_hash: AUDIT_GENESIS_HASH.to_string(),
                entry_hash: h1.clone(),
            },
            ChainedAuditLogEntry {
                entry: e2.clone(),
                prev_hash: h1.clone(),
                entry_hash: h2.clone(),
            },
        ];
        assert!(verify_audit_log_chain(&chain).is_ok());

        // Tamper with details of entry 0 -> entry_hash mismatch detected
        let mut tampered_details = chain.clone();
        tampered_details[0].entry.details = "Forged details".to_string();
        assert!(verify_audit_log_chain(&tampered_details).is_err());

        // Delete entry 0 -> broken prev_hash link detected at index 0
        let deleted_first = vec![chain[1].clone()];
        assert!(verify_audit_log_chain(&deleted_first).is_err());
    }
}
