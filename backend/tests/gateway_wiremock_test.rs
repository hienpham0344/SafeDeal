use alloy::rpc::types::Log;
use alloy::sol_types::{SolCall, SolEvent, SolValue};
use alloy_primitives::{Address, Bytes, TxHash, B256, U256};
use safedeal_domain::blockchain::OnChainEventType;
use safedeal_domain::ports::BlockchainGateway;
use safedeal_infrastructure::blockchain::{
    AlloyBlockchainGateway, ISafeDealEscrow, SafeDealContractCodec,
};
use safedeal_infrastructure::config::BlockchainConfig;
use safedeal_shared::DomainError;
use serde_json::{json, Value};
use wiremock::matchers::{body_string_contains, method};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const CONTRACT: &str = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

fn json_rpc_response(request: &Request, result: Value) -> ResponseTemplate {
    let req_json: Value = serde_json::from_slice(&request.body).unwrap_or_default();
    let id = req_json.get("id").cloned().unwrap_or_else(|| json!(1));
    ResponseTemplate::new(200).set_body_json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
}

fn gateway_for_url(rpc_url: &str) -> AlloyBlockchainGateway {
    AlloyBlockchainGateway::new(&BlockchainConfig {
        enabled: true,
        chain_id: 31337,
        chain_name: "Anvil Local".to_string(),
        rpc_url: rpc_url.to_string(),
        escrow_contract_address: CONTRACT.to_string(),
        deployment_block: 0,
        confirmations_required: 1,
        sync_batch_size: 100,
        poll_interval_ms: 1000,
        rpc_timeout_ms: 5000,
    })
    .expect("construct AlloyBlockchainGateway")
}

fn mock_rpc_log<E: SolEvent>(
    ev: &E,
    contract: Address,
    tx_hash: TxHash,
    block_number: u64,
    log_index: u64,
) -> Log {
    Log {
        inner: alloy_primitives::Log {
            address: contract,
            data: ev.encode_log_data(),
        },
        block_hash: Some(B256::repeat_byte(0xab)),
        block_number: Some(block_number),
        block_timestamp: None,
        transaction_hash: Some(tx_hash),
        transaction_index: Some(0),
        log_index: Some(log_index),
        removed: false,
    }
}

#[test]
fn codec_decodes_all_nine_events_and_get_trade_round_trip() {
    let trade_id = B256::repeat_byte(0x12);
    let seller: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
        .parse()
        .unwrap();
    let buyer: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        .parse()
        .unwrap();
    let arbiter: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
        .parse()
        .unwrap();
    let contract: Address = CONTRACT.parse().unwrap();
    let terms_hash = B256::repeat_byte(0x34);
    let amount = U256::from(1_500_000_000_000_000_000u128);

    // Calldata encoding starts with getTrade(bytes32) selector + tradeId
    let calldata = SafeDealContractCodec::encode_get_trade_call_data(&format!("{trade_id:#x}"))
        .expect("encode calldata");
    let decoded_call =
        ISafeDealEscrow::getTradeCall::abi_decode(&calldata).expect("abi decode call");
    assert_eq!(decoded_call.tradeId, trade_id);

    // Empty / NONE trade -> Ok(None)
    let none_trade = ISafeDealEscrow::Trade {
        tradeId: B256::ZERO,
        seller: Address::ZERO,
        buyer: Address::ZERO,
        arbiter: Address::ZERO,
        amount: U256::ZERO,
        termsHash: B256::ZERO,
        createdAt: 0,
        fundedAt: 0,
        deliveredAt: 0,
        fundingDeadline: 0,
        deliveryDeadline: 0,
        inspectionWindow: 0,
        status: ISafeDealEscrow::TradeStatus::NONE,
        settled: false,
    };
    let encoded_none = ISafeDealEscrow::getTradeCall::abi_encode_returns(&none_trade);
    assert_eq!(
        SafeDealContractCodec::decode_get_trade_response(&encoded_none).unwrap(),
        None
    );

    // Open buyer (Address::ZERO) -> buyer: None, DELIVERED status ordinal = 3
    let active_trade = ISafeDealEscrow::Trade {
        tradeId: trade_id,
        seller,
        buyer: Address::ZERO,
        arbiter,
        amount,
        termsHash: terms_hash,
        createdAt: 1_700_000_000,
        fundedAt: 1_700_000_100,
        deliveredAt: 1_700_000_200,
        fundingDeadline: 1_700_003_600,
        deliveryDeadline: 1_700_007_200,
        inspectionWindow: 86_400,
        status: ISafeDealEscrow::TradeStatus::DELIVERED,
        settled: false,
    };
    let encoded_active = active_trade.abi_encode();
    let snap = SafeDealContractCodec::decode_get_trade_response(&encoded_active)
        .unwrap()
        .expect("decoded active trade");
    assert_eq!(snap.trade_id, format!("{trade_id:#x}"));
    assert_eq!(snap.seller, format!("{seller:#x}"));
    assert_eq!(snap.buyer, None);
    assert_eq!(snap.arbiter, format!("{arbiter:#x}"));
    assert_eq!(snap.amount_wei, "1500000000000000000");
    assert_eq!(snap.terms_hash, format!("{terms_hash:#x}"));
    assert_eq!(snap.delivered_at_epoch, 1_700_000_200);
    assert_eq!(snap.chain_status_ordinal, 3);
    assert!(!snap.settled);

    // All 9 events round-trip
    let tx_hash = TxHash::repeat_byte(0x99);
    let ts = 1_700_000_555i64;
    let logs = vec![
        mock_rpc_log(
            &ISafeDealEscrow::TradeCreated {
                tradeId: trade_id,
                seller,
                buyer: Address::ZERO,
                arbiter,
                amount,
                termsHash: terms_hash,
                fundingDeadline: 1_700_003_600,
                deliveryDeadline: 1_700_007_200,
                inspectionWindow: 86_400,
            },
            contract,
            tx_hash,
            10,
            0,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::TradeFunded {
                tradeId: trade_id,
                buyer,
                amount,
            },
            contract,
            tx_hash,
            11,
            1,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::DeliveryMarked {
                tradeId: trade_id,
                seller,
                deliveredAt: 1_700_000_200,
            },
            contract,
            tx_hash,
            12,
            2,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::FundsReleased {
                tradeId: trade_id,
                seller,
                amount,
            },
            contract,
            tx_hash,
            13,
            3,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::RefundExecuted {
                tradeId: trade_id,
                buyer,
                amount,
                initiatedBy: seller,
            },
            contract,
            tx_hash,
            14,
            4,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::DisputeOpened {
                tradeId: trade_id,
                openedBy: buyer,
            },
            contract,
            tx_hash,
            15,
            5,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::DisputeResolved {
                tradeId: trade_id,
                arbiter,
                buyer,
                buyerAmount: U256::from(1_000_000_000_000_000_000u128),
                seller,
                sellerAmount: U256::from(500_000_000_000_000_000u128),
            },
            contract,
            tx_hash,
            16,
            6,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::FundsWithdrawn {
                beneficiary: buyer,
                amount: U256::from(1_000_000_000_000_000_000u128),
            },
            contract,
            tx_hash,
            17,
            7,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::TradeCancelled {
                tradeId: trade_id,
                cancelledBy: seller,
            },
            contract,
            tx_hash,
            18,
            8,
        ),
    ];

    let decoded: Vec<_> = logs
        .iter()
        .map(|l| {
            SafeDealContractCodec::decode_rpc_log(l, ts)
                .unwrap()
                .unwrap()
        })
        .collect();
    assert_eq!(decoded.len(), 9);
    assert_eq!(decoded[0].event_type, OnChainEventType::TradeCreated);
    assert_eq!(decoded[0].buyer_address, None);
    assert_eq!(decoded[0].terms_hash, Some(format!("{terms_hash:#x}")));
    assert_eq!(decoded[1].event_type, OnChainEventType::TradeFunded);
    assert_eq!(decoded[1].buyer_address, Some(format!("{buyer:#x}")));
    assert_eq!(decoded[2].event_type, OnChainEventType::DeliveryMarked);
    assert_eq!(decoded[3].event_type, OnChainEventType::FundsReleased);
    assert_eq!(decoded[4].event_type, OnChainEventType::RefundExecuted);
    assert_eq!(decoded[4].actor_address, Some(format!("{seller:#x}")));
    assert_eq!(decoded[5].event_type, OnChainEventType::DisputeOpened);
    assert_eq!(decoded[6].event_type, OnChainEventType::DisputeResolved);
    assert_eq!(
        decoded[6].buyer_award_wei.as_deref(),
        Some("1000000000000000000")
    );
    assert_eq!(
        decoded[6].seller_award_wei.as_deref(),
        Some("500000000000000000")
    );
    assert_eq!(decoded[7].event_type, OnChainEventType::FundsWithdrawn);
    assert_eq!(decoded[7].trade_id, None);
    assert_eq!(decoded[8].event_type, OnChainEventType::TradeCancelled);
}

#[tokio::test]
async fn gateway_throws_external_service_when_block_header_is_null_instead_of_fabricating() {
    let server = MockServer::start().await;
    let tx_hash = format!("0x{}", "1".repeat(64));

    Mock::given(method("POST"))
        .and(body_string_contains("eth_getTransactionReceipt"))
        .respond_with(|req: &Request| {
            json_rpc_response(
                req,
                json!({
                    "transactionHash": format!("0x{}", "1".repeat(64)),
                    "transactionIndex": "0x0",
                    "blockHash": format!("0x{}", "2".repeat(64)),
                    "blockNumber": "0xa",
                    "from": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
                    "to": CONTRACT,
                    "cumulativeGasUsed": "0x5208",
                    "gasUsed": "0x5208",
                    "contractAddress": Value::Null,
                    "logs": [],
                    "logsBloom": format!("0x{}", "0".repeat(512)),
                    "status": "0x1",
                    "effectiveGasPrice": "0x3b9aca00",
                    "type": "0x2"
                }),
            )
        })
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(body_string_contains("eth_getBlockByNumber"))
        .respond_with(|req: &Request| json_rpc_response(req, Value::Null))
        .expect(1)
        .mount(&server)
        .await;

    let gateway = gateway_for_url(&server.uri());
    let err = gateway
        .inspect_transaction(&tx_hash)
        .await
        .expect_err("null block header must fail");
    match err {
        DomainError::ExternalService { message, .. } => {
            assert!(
                message.contains("null block header"),
                "unexpected message: {message}"
            );
        }
        other => panic!("expected ExternalService error, got {other:?}"),
    }
}

#[tokio::test]
async fn gateway_deduplicates_unique_blocks_and_resolves_timestamps_concurrently() {
    let server = MockServer::start().await;
    let contract: Address = CONTRACT.parse().unwrap();
    let trade_id = B256::repeat_byte(0x44);
    let seller: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
        .parse()
        .unwrap();
    let buyer: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        .parse()
        .unwrap();

    // Build 4 logs across ONLY 2 blocks: block 100 (0x64) and block 101 (0x65)
    let logs = vec![
        mock_rpc_log(
            &ISafeDealEscrow::TradeFunded {
                tradeId: trade_id,
                buyer,
                amount: U256::from(100u64),
            },
            contract,
            TxHash::repeat_byte(0x01),
            100,
            0,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::DeliveryMarked {
                tradeId: trade_id,
                seller,
                deliveredAt: 1_700_000_100,
            },
            contract,
            TxHash::repeat_byte(0x02),
            100,
            1,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::FundsReleased {
                tradeId: trade_id,
                seller,
                amount: U256::from(100u64),
            },
            contract,
            TxHash::repeat_byte(0x03),
            101,
            0,
        ),
        mock_rpc_log(
            &ISafeDealEscrow::FundsWithdrawn {
                beneficiary: seller,
                amount: U256::from(100u64),
            },
            contract,
            TxHash::repeat_byte(0x04),
            101,
            1,
        ),
    ];

    let logs_value = serde_json::to_value(&logs).unwrap();
    Mock::given(method("POST"))
        .and(body_string_contains("eth_getLogs"))
        .respond_with(move |req: &Request| json_rpc_response(req, logs_value.clone()))
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(body_string_contains("eth_getBlockByNumber"))
        .respond_with(|request: &Request| {
            let req: Value = serde_json::from_slice(&request.body).unwrap_or_default();
            let tag = req
                .get("params")
                .and_then(|p| p.get(0))
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let ts_hex = match tag {
                "0x64" => "0x6553f100", // 1700000000
                "0x65" => "0x6553f164", // 1700000100
                other => panic!("Unexpected block requested: {other}"),
            };
            json_rpc_response(
                request,
                json!({
                    "number": tag,
                    "hash": format!("0x{}", "a".repeat(64)),
                    "parentHash": format!("0x{}", "b".repeat(64)),
                    "nonce": "0x0000000000000000",
                    "mixHash": format!("0x{}", "0".repeat(64)),
                    "sha3Uncles": format!("0x{}", "c".repeat(64)),
                    "logsBloom": format!("0x{}", "0".repeat(512)),
                    "transactionsRoot": format!("0x{}", "d".repeat(64)),
                    "stateRoot": format!("0x{}", "e".repeat(64)),
                    "receiptsRoot": format!("0x{}", "f".repeat(64)),
                    "miner": "0x0000000000000000000000000000000000000000",
                    "difficulty": "0x0",
                    "extraData": "0x",
                    "size": "0x100",
                    "gasLimit": "0x1c9c380",
                    "gasUsed": "0x0",
                    "timestamp": ts_hex,
                    "transactions": [],
                    "uncles": []
                }),
            )
        })
        .expect(2)
        .mount(&server)
        .await;

    let gateway = gateway_for_url(&server.uri());
    let events = gateway.fetch_logs(100, 101).await.expect("fetch logs");
    assert_eq!(events.len(), 4);
    assert_eq!(events[0].block_timestamp_epoch, 1_700_000_000);
    assert_eq!(events[1].block_timestamp_epoch, 1_700_000_000);
    assert_eq!(events[2].block_timestamp_epoch, 1_700_000_100);
    assert_eq!(events[3].block_timestamp_epoch, 1_700_000_100);
}

#[tokio::test]
async fn gateway_fetch_trade_and_block_number_work_over_json_rpc() {
    let server = MockServer::start().await;
    let trade_id = B256::repeat_byte(0x55);
    let seller: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
        .parse()
        .unwrap();
    let arbiter: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
        .parse()
        .unwrap();

    let trade = ISafeDealEscrow::Trade {
        tradeId: trade_id,
        seller,
        buyer: Address::ZERO,
        arbiter,
        amount: U256::from(2_000_000_000_000_000_000u128),
        termsHash: B256::repeat_byte(0x66),
        createdAt: 1_700_000_000,
        fundedAt: 0,
        deliveredAt: 0,
        fundingDeadline: 1_700_003_600,
        deliveryDeadline: 1_700_007_200,
        inspectionWindow: 86_400,
        status: ISafeDealEscrow::TradeStatus::CREATED,
        settled: false,
    };
    let encoded_hex = format!("0x{}", hex::encode(Bytes::from(trade.abi_encode())));

    Mock::given(method("POST"))
        .and(body_string_contains("eth_blockNumber"))
        .respond_with(|req: &Request| json_rpc_response(req, json!("0x2a")))
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(body_string_contains("eth_call"))
        .respond_with(move |req: &Request| json_rpc_response(req, json!(encoded_hex)))
        .expect(1)
        .mount(&server)
        .await;

    let gateway = gateway_for_url(&server.uri());
    assert_eq!(gateway.fetch_latest_block_number().await.unwrap(), 42);
    let fetched = gateway
        .fetch_trade(&format!("{trade_id:#x}"))
        .await
        .unwrap()
        .expect("trade present");
    assert_eq!(fetched.chain_status_ordinal, 1);
    assert_eq!(fetched.buyer, None);
    assert_eq!(fetched.amount_wei, "2000000000000000000");
}
