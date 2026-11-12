use alloy::rpc::types::Log;
use alloy::sol_types::{sol, SolCall, SolEventInterface};
use alloy_primitives::{Address, B256};
use safedeal_domain::blockchain::{OnChainEventType, OnChainTradeSnapshot, VerifiedChainEvent};
use safedeal_shared::{DomainError, EthFormatValidator};

#[allow(clippy::too_many_arguments)]
mod abi {
    use super::sol;

    sol! {
        #![sol(alloy_sol_types = ::alloy::sol_types)]
        #[allow(missing_docs)]
        interface ISafeDealEscrow {
        enum TradeStatus {
            NONE,
            CREATED,
            FUNDED,
            DELIVERED,
            RELEASED,
            REFUNDED,
            DISPUTED,
            RESOLVED,
            CANCELLED
        }

        struct Trade {
            bytes32 tradeId;
            address seller;
            address buyer;
            address arbiter;
            uint256 amount;
            bytes32 termsHash;
            uint64 createdAt;
            uint64 fundedAt;
            uint64 deliveredAt;
            uint64 fundingDeadline;
            uint64 deliveryDeadline;
            uint64 inspectionWindow;
            TradeStatus status;
            bool settled;
        }

        event TradeCreated(
            bytes32 indexed tradeId,
            address indexed seller,
            address indexed buyer,
            address arbiter,
            uint256 amount,
            bytes32 termsHash,
            uint64 fundingDeadline,
            uint64 deliveryDeadline,
            uint64 inspectionWindow
        );

        event TradeFunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount);
        event DeliveryMarked(bytes32 indexed tradeId, address indexed seller, uint64 deliveredAt);
        event FundsReleased(bytes32 indexed tradeId, address indexed seller, uint256 amount);
        event RefundExecuted(
            bytes32 indexed tradeId,
            address indexed buyer,
            uint256 amount,
            address indexed initiatedBy
        );
        event DisputeOpened(bytes32 indexed tradeId, address indexed openedBy);
        event DisputeResolved(
            bytes32 indexed tradeId,
            address indexed arbiter,
            address indexed buyer,
            uint256 buyerAmount,
            address seller,
            uint256 sellerAmount
        );
        event FundsWithdrawn(address indexed beneficiary, uint256 amount);
        event TradeCancelled(bytes32 indexed tradeId, address indexed cancelledBy);

        function getTrade(bytes32 tradeId) external view returns (Trade memory);
        function claimableBalances(address account) external view returns (uint256);
    }
}
}

pub use abi::ISafeDealEscrow;

pub struct SafeDealContractCodec;

impl SafeDealContractCodec {
    pub fn encode_get_trade_call_data(trade_id_hex: &str) -> Result<Vec<u8>, DomainError> {
        let normalized = EthFormatValidator::require_bytes32(Some(trade_id_hex), "tradeId")?;
        let trade_id: B256 = normalized
            .parse()
            .map_err(|_| DomainError::validation("tradeId must be valid 32-byte hex."))?;
        Ok(ISafeDealEscrow::getTradeCall { tradeId: trade_id }.abi_encode())
    }

    pub fn decode_get_trade_response(
        raw: &[u8],
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        if raw.is_empty() {
            return Ok(None);
        }
        let trade = ISafeDealEscrow::getTradeCall::abi_decode_returns(raw).map_err(|e| {
            DomainError::external_service(format!("Failed to decode getTrade response: {e}"))
        })?;

        let chain_status_ordinal = trade_status_ordinal(trade.status)?;
        if chain_status_ordinal == 0 {
            return Ok(None);
        }

        let buyer = if trade.buyer == Address::ZERO {
            None
        } else {
            Some(format!("{:#x}", trade.buyer))
        };

        Ok(Some(OnChainTradeSnapshot {
            trade_id: format!("{:#x}", trade.tradeId),
            seller: format!("{:#x}", trade.seller),
            buyer,
            arbiter: format!("{:#x}", trade.arbiter),
            amount_wei: trade.amount.to_string(),
            terms_hash: format!("{:#x}", trade.termsHash),
            funding_deadline_epoch: u64_to_i64(trade.fundingDeadline, "fundingDeadline")?,
            delivery_deadline_epoch: u64_to_i64(trade.deliveryDeadline, "deliveryDeadline")?,
            inspection_window_seconds: u64_to_i64(trade.inspectionWindow, "inspectionWindow")?,
            delivered_at_epoch: u64_to_i64(trade.deliveredAt, "deliveredAt")?,
            chain_status_ordinal,
            settled: trade.settled,
            buyer_award_wei: "0".to_string(),
            seller_award_wei: "0".to_string(),
        }))
    }

    pub fn encode_claimable_balances_call_data(address_hex: &str) -> Result<Vec<u8>, DomainError> {
        let normalized = EthFormatValidator::require_address(Some(address_hex), "account")?;
        let account: Address = normalized
            .parse()
            .map_err(|_| DomainError::validation("account must be valid EVM address."))?;
        Ok(ISafeDealEscrow::claimableBalancesCall { account }.abi_encode())
    }

    pub fn decode_rpc_log(
        log: &Log,
        block_timestamp_epoch: i64,
    ) -> Result<Option<VerifiedChainEvent>, DomainError> {
        let topics = log.topics();
        if topics.is_empty() || log.removed {
            return Ok(None);
        }

        let Ok(decoded) =
            ISafeDealEscrow::ISafeDealEscrowEvents::decode_raw_log(topics, &log.data().data)
        else {
            return Ok(None);
        };

        let tx_hash = log
            .transaction_hash
            .map(|h| format!("{h:#x}"))
            .ok_or_else(|| DomainError::external_service("RPC log missing transactionHash"))?;
        let log_index_u64 = log
            .log_index
            .ok_or_else(|| DomainError::external_service("RPC log missing logIndex"))?;
        let log_index = i32::try_from(log_index_u64)
            .map_err(|_| DomainError::external_service("RPC logIndex exceeds i32 range"))?;
        let block_number_u64 = log
            .block_number
            .ok_or_else(|| DomainError::external_service("RPC log missing blockNumber"))?;
        let block_number = u64_to_i64(block_number_u64, "blockNumber")?;
        let contract_address = format!("{:#x}", log.address());

        let event = match decoded {
            ISafeDealEscrow::ISafeDealEscrowEvents::TradeCreated(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::TradeCreated,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.seller)),
                buyer_address: (e.buyer != Address::ZERO).then(|| format!("{:#x}", e.buyer)),
                amount_wei: Some(e.amount.to_string()),
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: Some(format!("{:#x}", e.termsHash)),
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::TradeFunded(e) => {
                let buyer_hex = format!("{:#x}", e.buyer);
                VerifiedChainEvent {
                    tx_hash,
                    log_index,
                    block_number,
                    block_timestamp_epoch,
                    contract_address,
                    event_type: OnChainEventType::TradeFunded,
                    trade_id: Some(format!("{:#x}", e.tradeId)),
                    actor_address: Some(buyer_hex.clone()),
                    buyer_address: Some(buyer_hex),
                    amount_wei: Some(e.amount.to_string()),
                    buyer_award_wei: None,
                    seller_award_wei: None,
                    terms_hash: None,
                }
            }
            ISafeDealEscrow::ISafeDealEscrowEvents::DeliveryMarked(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::DeliveryMarked,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.seller)),
                buyer_address: None,
                amount_wei: None,
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::FundsReleased(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::FundsReleased,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.seller)),
                buyer_address: None,
                amount_wei: Some(e.amount.to_string()),
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::RefundExecuted(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::RefundExecuted,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.initiatedBy)),
                buyer_address: Some(format!("{:#x}", e.buyer)),
                amount_wei: Some(e.amount.to_string()),
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::DisputeOpened(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::DisputeOpened,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.openedBy)),
                buyer_address: None,
                amount_wei: None,
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::DisputeResolved(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::DisputeResolved,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.arbiter)),
                buyer_address: Some(format!("{:#x}", e.buyer)),
                amount_wei: None,
                buyer_award_wei: Some(e.buyerAmount.to_string()),
                seller_award_wei: Some(e.sellerAmount.to_string()),
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::FundsWithdrawn(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::FundsWithdrawn,
                trade_id: None,
                actor_address: Some(format!("{:#x}", e.beneficiary)),
                buyer_address: None,
                amount_wei: Some(e.amount.to_string()),
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
            ISafeDealEscrow::ISafeDealEscrowEvents::TradeCancelled(e) => VerifiedChainEvent {
                tx_hash,
                log_index,
                block_number,
                block_timestamp_epoch,
                contract_address,
                event_type: OnChainEventType::TradeCancelled,
                trade_id: Some(format!("{:#x}", e.tradeId)),
                actor_address: Some(format!("{:#x}", e.cancelledBy)),
                buyer_address: None,
                amount_wei: None,
                buyer_award_wei: None,
                seller_award_wei: None,
                terms_hash: None,
            },
        };

        Ok(Some(event))
    }
}

fn trade_status_ordinal(status: ISafeDealEscrow::TradeStatus) -> Result<i32, DomainError> {
    match status {
        ISafeDealEscrow::TradeStatus::NONE => Ok(0),
        ISafeDealEscrow::TradeStatus::CREATED => Ok(1),
        ISafeDealEscrow::TradeStatus::FUNDED => Ok(2),
        ISafeDealEscrow::TradeStatus::DELIVERED => Ok(3),
        ISafeDealEscrow::TradeStatus::RELEASED => Ok(4),
        ISafeDealEscrow::TradeStatus::REFUNDED => Ok(5),
        ISafeDealEscrow::TradeStatus::DISPUTED => Ok(6),
        ISafeDealEscrow::TradeStatus::RESOLVED => Ok(7),
        ISafeDealEscrow::TradeStatus::CANCELLED => Ok(8),
        ISafeDealEscrow::TradeStatus::__Invalid => Err(DomainError::external_service(
            "Invalid TradeStatus ordinal returned by contract",
        )),
    }
}

fn u64_to_i64(val: u64, field: &str) -> Result<i64, DomainError> {
    i64::try_from(val)
        .map_err(|_| DomainError::external_service(format!("{field} value exceeds i64 range")))
}
