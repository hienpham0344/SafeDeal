use std::collections::VecDeque;
use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use safedeal_shared::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DealStatus {
    Draft,
    Created,
    Funded,
    Delivered,
    Released,
    Refunded,
    Disputed,
    Resolved,
    Cancelled,
}

impl DealStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Created => "CREATED",
            Self::Funded => "FUNDED",
            Self::Delivered => "DELIVERED",
            Self::Released => "RELEASED",
            Self::Refunded => "REFUNDED",
            Self::Disputed => "DISPUTED",
            Self::Resolved => "RESOLVED",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn is_settled(self) -> bool {
        matches!(
            self,
            Self::Released | Self::Refunded | Self::Resolved | Self::Cancelled
        )
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        if self == next {
            return true;
        }
        self.allowed_next_states().contains(&next)
    }

    /// Checks forward reachability along valid SafeDealEscrow contract paths.
    /// Allows authoritative chain sync/indexing to catch up across skipped intermediate
    /// off-chain sync calls while rejecting backwards, post-settlement, or invalid branch jumps.
    pub fn can_reconcile_to(self, target: Self) -> bool {
        if self == target {
            return true;
        }
        let mut visited = [false; 9];
        let mut queue = VecDeque::new();
        visited[self.idx()] = true;
        queue.push_back(self);
        while let Some(cursor) = queue.pop_front() {
            for &next in cursor.allowed_next_states() {
                if next == target {
                    return true;
                }
                if !visited[next.idx()] {
                    visited[next.idx()] = true;
                    queue.push_back(next);
                }
            }
        }
        false
    }

    fn allowed_next_states(self) -> &'static [Self] {
        match self {
            Self::Draft => &[Self::Created],
            Self::Created => &[Self::Funded, Self::Cancelled],
            Self::Funded => &[Self::Delivered, Self::Refunded, Self::Disputed],
            Self::Delivered => &[Self::Released, Self::Disputed],
            Self::Disputed => &[Self::Resolved],
            Self::Released | Self::Refunded | Self::Resolved | Self::Cancelled => &[],
        }
    }

    fn idx(self) -> usize {
        match self {
            Self::Draft => 0,
            Self::Created => 1,
            Self::Funded => 2,
            Self::Delivered => 3,
            Self::Released => 4,
            Self::Refunded => 5,
            Self::Disputed => 6,
            Self::Resolved => 7,
            Self::Cancelled => 8,
        }
    }

    pub fn from_chain_ordinal(ordinal: i32) -> Result<Self, DomainError> {
        match ordinal {
            1 => Ok(Self::Created),
            2 => Ok(Self::Funded),
            3 => Ok(Self::Delivered),
            4 => Ok(Self::Released),
            5 => Ok(Self::Refunded),
            6 => Ok(Self::Disputed),
            7 => Ok(Self::Resolved),
            8 => Ok(Self::Cancelled),
            _ => Err(DomainError::validation(format!(
                "Invalid or uninitialized on-chain escrow status: {ordinal}"
            ))),
        }
    }
}

impl fmt::Display for DealStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for DealStatus {
    type Err = DomainError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_uppercase().as_str() {
            "DRAFT" => Ok(Self::Draft),
            "CREATED" => Ok(Self::Created),
            "FUNDED" => Ok(Self::Funded),
            "DELIVERED" => Ok(Self::Delivered),
            "RELEASED" => Ok(Self::Released),
            "REFUNDED" => Ok(Self::Refunded),
            "DISPUTED" => Ok(Self::Disputed),
            "RESOLVED" => Ok(Self::Resolved),
            "CANCELLED" => Ok(Self::Cancelled),
            other => Err(DomainError::validation(format!(
                "Invalid deal status: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deal {
    pub id: Option<i64>,
    pub trade_id: String,
    pub chain_id: i64,
    pub contract_address: String,
    pub seller: String,
    pub buyer: Option<String>,
    pub arbiter: String,
    pub amount_wei: String,
    pub terms_hash: String,
    pub funding_deadline: DateTime<Utc>,
    pub delivery_deadline: DateTime<Utc>,
    pub inspection_window_seconds: i64,
    pub delivered_at: Option<DateTime<Utc>>,
    pub funded_at: Option<DateTime<Utc>>,
    pub status: DealStatus,
    pub on_chain_bound: bool,
    pub settled: bool,
    pub create_tx_hash: Option<String>,
    pub buyer_award_wei: Option<String>,
    pub seller_award_wei: Option<String>,
    pub title: String,
    pub description: String,
    pub terms: String,
    pub canonical_terms_json: String,
    pub schema_version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Deal {
    pub fn is_participant_or_arbiter(&self, wallet_address: Option<&str>) -> bool {
        let Some(wallet) = wallet_address else {
            return false;
        };
        let lower = wallet.to_ascii_lowercase();
        lower == self.seller
            || lower == self.arbiter
            || self.buyer.as_deref() == Some(lower.as_str())
    }

    pub fn is_open_buyer_eligible(&self, wallet_address: Option<&str>) -> bool {
        let Some(wallet) = wallet_address else {
            return false;
        };
        let lower = wallet.to_ascii_lowercase();
        self.buyer.is_none()
            && self.on_chain_bound
            && self.status == DealStatus::Created
            && lower != self.seller
            && lower != self.arbiter
    }

    pub fn can_view(&self, wallet_address: Option<&str>) -> bool {
        self.is_participant_or_arbiter(wallet_address)
            || self.is_open_buyer_eligible(wallet_address)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DealEvent {
    pub id: Option<i64>,
    pub trade_id: String,
    pub event_type: String,
    pub actor_address: Option<String>,
    pub tx_hash: Option<String>,
    pub block_number: Option<i64>,
    pub log_index: Option<i32>,
    pub details: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockchainTransaction {
    pub id: Option<i64>,
    pub trade_id: String,
    pub tx_hash: String,
    pub operation: String,
    pub status: String,
    pub block_number: Option<i64>,
    pub submitted_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_valid_escrow_state_transitions() {
        assert!(DealStatus::Draft.can_transition_to(DealStatus::Created));
        assert!(DealStatus::Created.can_transition_to(DealStatus::Funded));
        assert!(DealStatus::Created.can_transition_to(DealStatus::Cancelled));
        assert!(DealStatus::Funded.can_transition_to(DealStatus::Delivered));
        assert!(DealStatus::Funded.can_transition_to(DealStatus::Refunded));
        assert!(DealStatus::Funded.can_transition_to(DealStatus::Disputed));
        assert!(DealStatus::Delivered.can_transition_to(DealStatus::Released));
        assert!(DealStatus::Delivered.can_transition_to(DealStatus::Disputed));
        assert!(DealStatus::Disputed.can_transition_to(DealStatus::Resolved));
    }

    #[test]
    fn rejects_backwards_or_post_settlement_transitions() {
        assert!(!DealStatus::Released.can_transition_to(DealStatus::Disputed));
        assert!(!DealStatus::Refunded.can_transition_to(DealStatus::Released));
        assert!(!DealStatus::Cancelled.can_transition_to(DealStatus::Funded));
        assert!(!DealStatus::Resolved.can_transition_to(DealStatus::Funded));
        assert!(!DealStatus::Disputed.can_transition_to(DealStatus::Funded));
    }

    #[test]
    fn maps_solidity_enum_ordinals_safely() {
        assert_eq!(DealStatus::from_chain_ordinal(1).unwrap(), DealStatus::Created);
        assert_eq!(DealStatus::from_chain_ordinal(6).unwrap(), DealStatus::Disputed);
        assert_eq!(
            DealStatus::from_chain_ordinal(8).unwrap(),
            DealStatus::Cancelled
        );
        assert!(matches!(
            DealStatus::from_chain_ordinal(0),
            Err(DomainError::Validation { .. })
        ));
        assert!(matches!(
            DealStatus::from_chain_ordinal(99),
            Err(DomainError::Validation { .. })
        ));
    }

    #[test]
    fn permits_forward_catch_up_and_rejects_invalid_cross_branch_reconciliation() {
        assert!(DealStatus::Draft.can_reconcile_to(DealStatus::Funded));
        assert!(DealStatus::Draft.can_reconcile_to(DealStatus::Disputed));
        assert!(DealStatus::Created.can_reconcile_to(DealStatus::Disputed));
        assert!(DealStatus::Created.can_reconcile_to(DealStatus::Released));
        assert!(!DealStatus::Funded.can_reconcile_to(DealStatus::Cancelled));
        assert!(!DealStatus::Delivered.can_reconcile_to(DealStatus::Refunded));
        assert!(!DealStatus::Disputed.can_reconcile_to(DealStatus::Released));
        assert!(!DealStatus::Released.can_reconcile_to(DealStatus::Disputed));
    }
}
