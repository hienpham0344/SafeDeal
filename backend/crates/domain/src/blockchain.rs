use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::deal::DealStatus;
use safedeal_shared::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OnChainEventType {
    TradeCreated,
    TradeFunded,
    DeliveryMarked,
    FundsReleased,
    RefundExecuted,
    DisputeOpened,
    DisputeResolved,
    FundsWithdrawn,
    TradeCancelled,
}

impl OnChainEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TradeCreated => "TRADE_CREATED",
            Self::TradeFunded => "TRADE_FUNDED",
            Self::DeliveryMarked => "DELIVERY_MARKED",
            Self::FundsReleased => "FUNDS_RELEASED",
            Self::RefundExecuted => "REFUND_EXECUTED",
            Self::DisputeOpened => "DISPUTE_OPENED",
            Self::DisputeResolved => "DISPUTE_RESOLVED",
            Self::FundsWithdrawn => "FUNDS_WITHDRAWN",
            Self::TradeCancelled => "TRADE_CANCELLED",
        }
    }
}

impl fmt::Display for OnChainEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainSyncState {
    pub id: i32,
    pub chain_id: i64,
    pub contract_address: String,
    pub last_synced_block: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnChainTradeSnapshot {
    pub trade_id: String,
    pub seller: String,
    pub buyer: Option<String>,
    pub arbiter: String,
    pub amount_wei: String,
    pub terms_hash: String,
    pub funding_deadline_epoch: i64,
    pub delivery_deadline_epoch: i64,
    pub inspection_window_seconds: i64,
    pub delivered_at_epoch: i64,
    pub chain_status_ordinal: i32,
    pub settled: bool,
    pub buyer_award_wei: String,
    pub seller_award_wei: String,
}

impl OnChainTradeSnapshot {
    pub fn to_deal_status(&self) -> Result<DealStatus, DomainError> {
        DealStatus::from_chain_ordinal(self.chain_status_ordinal)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedChainEvent {
    pub tx_hash: String,
    pub log_index: i32,
    pub block_number: i64,
    pub block_timestamp_epoch: i64,
    pub contract_address: String,
    pub event_type: OnChainEventType,
    pub trade_id: Option<String>,
    pub actor_address: Option<String>,
    pub buyer_address: Option<String>,
    pub amount_wei: Option<String>,
    pub buyer_award_wei: Option<String>,
    pub seller_award_wei: Option<String>,
    pub terms_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransactionVerificationResult {
    pub tx_hash: String,
    pub succeeded: bool,
    pub block_number: i64,
    pub from_address: String,
    pub to_address: String,
    pub decoded_events: Vec<VerifiedChainEvent>,
}
