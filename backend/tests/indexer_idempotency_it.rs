mod common;

use std::sync::Arc;

use chrono::Utc;
use common::{TestAppHarness, DEFAULT_CONTRACT};
use safedeal_application::deals::CreateDealCommand;
use safedeal_domain::blockchain::{
    ChainSyncState, OnChainEventType, OnChainTradeSnapshot, TransactionVerificationResult,
    VerifiedChainEvent,
};
use safedeal_domain::deal::DealStatus;
use safedeal_domain::dispute::DisputeStatus;
use safedeal_domain::ports::{ChainSyncStateRepository, DealEventRepository, DealRepository};
use tokio::sync::Barrier;

#[tokio::test]
async fn deduplicates_chain_events_by_tx_hash_and_log_index_and_advances_cursor() {
    let harness = TestAppHarness::start().await;
    let seller = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
    let buyer = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
    let arbiter = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

    let now = Utc::now().timestamp();
    let draft = harness
        .components
        .create_deal_draft
        .execute(CreateDealCommand {
            seller_address: seller.to_string(),
            buyer_address: None,
            arbiter_address: arbiter.to_string(),
            amount_wei: "1000000000000000000".to_string(),
            funding_deadline_epoch_seconds: now + 3600,
            delivery_deadline_epoch_seconds: now + 7200,
            inspection_window_seconds: 86_400,
            title: "Indexer Test Deal".to_string(),
            description: "Verifying log deduplication and cursor resumption".to_string(),
            terms: "Delivered upon milestone confirmation".to_string(),
        })
        .await
        .expect("create draft");

    let ev_created = VerifiedChainEvent {
        tx_hash: format!("0x{}", "1".repeat(64)),
        log_index: 0,
        block_number: 5,
        block_timestamp_epoch: now,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::TradeCreated,
        trade_id: Some(draft.trade_id.clone()),
        actor_address: Some(seller.to_string()),
        buyer_address: None,
        amount_wei: Some("1000000000000000000".to_string()),
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: Some(draft.terms_hash.clone()),
    };
    let ev_funded = VerifiedChainEvent {
        tx_hash: format!("0x{}", "2".repeat(64)),
        log_index: 0,
        block_number: 8,
        block_timestamp_epoch: now + 10,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::TradeFunded,
        trade_id: Some(draft.trade_id.clone()),
        actor_address: Some(buyer.to_string()),
        buyer_address: Some(buyer.to_string()),
        amount_wei: Some("1000000000000000000".to_string()),
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: None,
    };

    harness
        .gateway
        .inner
        .update(|s| {
            s.deployment_block = 1;
            s.latest_block = 50;
            s.logs = vec![ev_created, ev_funded];
        })
        .await;

    let first_processed = harness
        .components
        .indexer
        .poll_and_index()
        .await
        .expect("first poll");
    assert_eq!(first_processed, 2);

    let snap = harness.gateway.inner.snapshot().await;
    assert_eq!(snap.fetch_logs_calls, vec![(1, 50)]);

    let updated = harness
        .components
        .repos
        .deals
        .find_by_trade_id(&draft.trade_id)
        .await
        .unwrap()
        .expect("updated deal");
    assert_eq!(updated.status, DealStatus::Funded);
    assert_eq!(updated.buyer.as_deref(), Some(buyer));
    assert!(updated.on_chain_bound);
    let sync_state = harness
        .components
        .repos
        .chain_sync_states
        .find_primary()
        .await
        .unwrap()
        .expect("sync state");
    assert_eq!(sync_state.last_synced_block, 50);

    // Advance block head & return overlapping duplicate logs -> 0 new processed events
    harness
        .gateway
        .inner
        .update(|s| {
            s.latest_block = 55;
        })
        .await;
    let second_processed = harness
        .components
        .indexer
        .poll_and_index()
        .await
        .expect("second poll");
    assert_eq!(second_processed, 0);

    let events: Vec<String> = harness
        .components
        .repos
        .deal_events
        .find_by_trade_id_order_by_created_at_asc(&draft.trade_id)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.event_type)
        .collect();
    assert_eq!(
        events,
        vec!["DRAFT_CREATED", "TRADE_CREATED", "TRADE_FUNDED"]
    );
}

#[tokio::test]
async fn resets_sync_cursor_when_chain_id_or_contract_changes() {
    let harness = TestAppHarness::start().await;
    harness
        .components
        .repos
        .chain_sync_states
        .save(&ChainSyncState {
            id: 1,
            chain_id: 43113,
            contract_address: "0x000000000000000000000000000000000000dead".to_string(),
            last_synced_block: 9_999,
            updated_at: Utc::now(),
        })
        .await
        .expect("seed foreign sync state");

    harness
        .gateway
        .inner
        .update(|s| {
            s.deployment_block = 1;
            s.latest_block = 12;
        })
        .await;

    let count = harness
        .components
        .indexer
        .poll_and_index()
        .await
        .expect("poll after reset");
    assert_eq!(count, 0);
    let snap = harness.gateway.inner.snapshot().await;
    assert_eq!(snap.fetch_logs_calls, vec![(1, 12)]);

    let state = harness
        .components
        .repos
        .chain_sync_states
        .find_primary()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.chain_id, 31337);
    assert_eq!(state.contract_address, DEFAULT_CONTRACT);
    assert_eq!(state.last_synced_block, 12);
}

#[tokio::test]
async fn record_resolution_backfills_rationale_and_stale_sync_does_not_regress_deal() {
    let harness = TestAppHarness::start().await;
    let seller = "0x4444444444444444444444444444444444444444";
    let buyer = "0x5555555555555555555555555555555555555555";
    let arbiter = "0x6666666666666666666666666666666666666666";
    let now = Utc::now().timestamp();
    let funding_deadline = now + 3600;
    let delivery_deadline = now + 7200;

    let draft1 = harness
        .components
        .create_deal_draft
        .execute(CreateDealCommand {
            seller_address: seller.to_string(),
            buyer_address: Some(buyer.to_string()),
            arbiter_address: arbiter.to_string(),
            amount_wei: "2000000000000000000".to_string(),
            funding_deadline_epoch_seconds: funding_deadline,
            delivery_deadline_epoch_seconds: delivery_deadline,
            inspection_window_seconds: 3600,
            title: "Indexer Rationale Backfill Test".to_string(),
            description: "Verifying arbiter rationale survives background log sync.".to_string(),
            terms: "Arbiter split resolution applied cleanly.".to_string(),
        })
        .await
        .unwrap();

    let dispute_tx = format!("0x{}", "d".repeat(64));
    let dispute_ev = VerifiedChainEvent {
        tx_hash: dispute_tx.clone(),
        log_index: 0,
        block_number: 30,
        block_timestamp_epoch: now,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::DisputeOpened,
        trade_id: Some(draft1.trade_id.clone()),
        actor_address: Some(buyer.to_string()),
        buyer_address: Some(buyer.to_string()),
        amount_wei: None,
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: None,
    };
    let trade_id_1 = draft1.trade_id.clone();
    harness
        .gateway
        .inner
        .update(|s| {
            s.transactions.insert(
                dispute_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: dispute_tx.clone(),
                    succeeded: true,
                    block_number: 30,
                    from_address: buyer.to_string(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![dispute_ev],
                },
            );
            s.trades.insert(
                trade_id_1.clone(),
                OnChainTradeSnapshot {
                    trade_id: trade_id_1.clone(),
                    seller: seller.to_string(),
                    buyer: Some(buyer.to_string()),
                    arbiter: arbiter.to_string(),
                    amount_wei: "2000000000000000000".to_string(),
                    terms_hash: draft1.terms_hash.clone(),
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 3600,
                    delivered_at_epoch: 0,
                    chain_status_ordinal: 6,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
        })
        .await;

    let dispute_ctx = harness
        .components
        .dispute_use_case
        .open_dispute(
            &draft1.trade_id,
            buyer,
            "Incomplete handoff",
            "Acceptance criteria evidence failed check.",
            Some(&dispute_tx),
        )
        .await
        .expect("open dispute");
    let dispute_id = dispute_ctx.dispute.id.unwrap();

    // Background indexer observes DisputeResolved before arbiter submits rationale
    let resolve_tx = format!("0x{}", "e".repeat(64));
    let resolved_ev = VerifiedChainEvent {
        tx_hash: resolve_tx.clone(),
        log_index: 0,
        block_number: 35,
        block_timestamp_epoch: now + 5,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::DisputeResolved,
        trade_id: Some(draft1.trade_id.clone()),
        actor_address: Some(arbiter.to_string()),
        buyer_address: Some(buyer.to_string()),
        amount_wei: None,
        buyer_award_wei: Some("1000000000000000000".to_string()),
        seller_award_wei: Some("1000000000000000000".to_string()),
        terms_hash: None,
    };
    harness
        .gateway
        .inner
        .update(|s| {
            s.latest_block = 35;
            s.logs = vec![resolved_ev];
        })
        .await;

    let indexed = harness.components.indexer.poll_and_index().await.unwrap();
    assert_eq!(indexed, 1);

    let after_index = harness
        .components
        .dispute_use_case
        .get_dispute(dispute_id, arbiter)
        .await
        .unwrap();
    assert_eq!(after_index.dispute.status, DisputeStatus::Resolved);
    assert_eq!(after_index.dispute.resolution_rationale, None);

    // Arbiter records rationale idempotently
    let backfilled = harness
        .components
        .arbitration_use_case
        .record_resolution(
            dispute_id,
            arbiter,
            &resolve_tx,
            "50/50 split awarded based on submitted evidence.",
        )
        .await
        .expect("backfill rationale");
    assert_eq!(backfilled.dispute.status, DisputeStatus::Resolved);
    assert_eq!(
        backfilled.dispute.resolution_rationale.as_deref(),
        Some("50/50 split awarded based on submitted evidence.")
    );

    // Second deal: stale sync snapshot (FUNDED) does not regress DELIVERED deal set by indexer
    let draft2 = harness
        .components
        .create_deal_draft
        .execute(CreateDealCommand {
            seller_address: seller.to_string(),
            buyer_address: Some(buyer.to_string()),
            arbiter_address: arbiter.to_string(),
            amount_wei: "1000000000000000000".to_string(),
            funding_deadline_epoch_seconds: funding_deadline,
            delivery_deadline_epoch_seconds: delivery_deadline,
            inspection_window_seconds: 3600,
            title: "Stale Sync Guard".to_string(),
            description: "Ensures out-of-order stale sync never fails or regresses deal state."
                .to_string(),
            terms: "Standard escrow agreement terms applied.".to_string(),
        })
        .await
        .unwrap();

    let fund_tx = format!("0x{}", "f".repeat(64));
    let ev_created = VerifiedChainEvent {
        tx_hash: format!("0x11{}", "0".repeat(62)),
        log_index: 0,
        block_number: 200,
        block_timestamp_epoch: now,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::TradeCreated,
        trade_id: Some(draft2.trade_id.clone()),
        actor_address: Some(seller.to_string()),
        buyer_address: Some(buyer.to_string()),
        amount_wei: Some(draft2.amount_wei.clone()),
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: Some(draft2.terms_hash.clone()),
    };
    let ev_funded = VerifiedChainEvent {
        tx_hash: fund_tx.clone(),
        log_index: 0,
        block_number: 201,
        block_timestamp_epoch: now + 1,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::TradeFunded,
        trade_id: Some(draft2.trade_id.clone()),
        actor_address: Some(buyer.to_string()),
        buyer_address: Some(buyer.to_string()),
        amount_wei: Some(draft2.amount_wei.clone()),
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: None,
    };
    let ev_delivered = VerifiedChainEvent {
        tx_hash: format!("0x12{}", "0".repeat(62)),
        log_index: 0,
        block_number: 202,
        block_timestamp_epoch: now + 2,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::DeliveryMarked,
        trade_id: Some(draft2.trade_id.clone()),
        actor_address: Some(seller.to_string()),
        buyer_address: None,
        amount_wei: None,
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: None,
    };

    let tid2 = draft2.trade_id.clone();
    let ftx = fund_tx.clone();
    let ef_clone = ev_funded.clone();
    harness
        .gateway
        .inner
        .update(|s| {
            s.latest_block = 202;
            s.logs = vec![ev_created, ev_funded, ev_delivered];
            s.transactions.insert(
                ftx.clone(),
                TransactionVerificationResult {
                    tx_hash: ftx.clone(),
                    succeeded: true,
                    block_number: 201,
                    from_address: buyer.to_string(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![ef_clone],
                },
            );
            // Stale RPC read returning FUNDED (2)
            s.trades.insert(
                tid2.clone(),
                OnChainTradeSnapshot {
                    trade_id: tid2.clone(),
                    seller: seller.to_string(),
                    buyer: Some(buyer.to_string()),
                    arbiter: arbiter.to_string(),
                    amount_wei: draft2.amount_wei.clone(),
                    terms_hash: draft2.terms_hash.clone(),
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 3600,
                    delivered_at_epoch: now + 2,
                    chain_status_ordinal: 2,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
        })
        .await;

    harness.components.indexer.poll_and_index().await.unwrap();
    let synced = harness
        .components
        .sync_deal
        .execute(&draft2.trade_id, Some(&fund_tx), buyer)
        .await
        .expect("stale sync must not fail");
    assert_eq!(synced.status, DealStatus::Delivered);
}

#[tokio::test]
async fn concurrent_bind_tx_and_indexer_poll_do_not_violate_unique_constraints() {
    let harness = TestAppHarness::start().await;
    let seller = "0x1212121212121212121212121212121212121212";
    let buyer = "0x2323232323232323232323232323232323232323";
    let arbiter = "0x3434343434343434343434343434343434343434";
    let now = Utc::now().timestamp();
    let funding_deadline = now + 3600;
    let delivery_deadline = now + 7200;

    for attempt in 0..15 {
        let draft = harness
            .components
            .create_deal_draft
            .execute(CreateDealCommand {
                seller_address: seller.to_string(),
                buyer_address: Some(buyer.to_string()),
                arbiter_address: arbiter.to_string(),
                amount_wei: "1000000000000000000".to_string(),
                funding_deadline_epoch_seconds: funding_deadline,
                delivery_deadline_epoch_seconds: delivery_deadline,
                inspection_window_seconds: 3600,
                title: format!("Concurrent Bind Race #{attempt}"),
                description:
                    "Exercises concurrent BindDealTransactionUseCase and BlockchainEventIndexerService."
                        .to_string(),
                terms: "Standard escrow agreement terms applied.".to_string(),
            })
            .await
            .expect("draft");

        let create_tx = format!("0xca{attempt:02x}{}", "0".repeat(60));
        let block_num = 100 + i64::from(attempt);
        let created_ev = VerifiedChainEvent {
            tx_hash: create_tx.clone(),
            log_index: 0,
            block_number: block_num,
            block_timestamp_epoch: now,
            contract_address: DEFAULT_CONTRACT.to_string(),
            event_type: OnChainEventType::TradeCreated,
            trade_id: Some(draft.trade_id.clone()),
            actor_address: Some(seller.to_string()),
            buyer_address: Some(buyer.to_string()),
            amount_wei: Some(draft.amount_wei.clone()),
            buyer_award_wei: None,
            seller_award_wei: None,
            terms_hash: Some(draft.terms_hash.clone()),
        };

        let ctx_hash = create_tx.clone();
        let tid = draft.trade_id.clone();
        let thash = draft.terms_hash.clone();
        let ev_clone = created_ev.clone();
        harness
            .gateway
            .inner
            .update(|s| {
                s.latest_block = block_num;
                s.logs.push(ev_clone.clone());
                s.transactions.insert(
                    ctx_hash.clone(),
                    TransactionVerificationResult {
                        tx_hash: ctx_hash.clone(),
                        succeeded: true,
                        block_number: block_num,
                        from_address: seller.to_string(),
                        to_address: DEFAULT_CONTRACT.to_string(),
                        decoded_events: vec![ev_clone],
                    },
                );
                s.trades.insert(
                    tid.clone(),
                    OnChainTradeSnapshot {
                        trade_id: tid.clone(),
                        seller: seller.to_string(),
                        buyer: Some(buyer.to_string()),
                        arbiter: arbiter.to_string(),
                        amount_wei: "1000000000000000000".to_string(),
                        terms_hash: thash,
                        funding_deadline_epoch: funding_deadline,
                        delivery_deadline_epoch: delivery_deadline,
                        inspection_window_seconds: 3600,
                        delivered_at_epoch: 0,
                        chain_status_ordinal: 1,
                        settled: false,
                        buyer_award_wei: "0".to_string(),
                        seller_award_wei: "0".to_string(),
                    },
                );
            })
            .await;

        let barrier = Arc::new(Barrier::new(2));
        let bind_uc = Arc::clone(&harness.components.bind_deal_transaction);
        let idx_uc = Arc::clone(&harness.components.indexer);
        let tid_bind = draft.trade_id.clone();
        let txh_bind = create_tx.clone();

        let b1 = Arc::clone(&barrier);
        let bind_fut = tokio::spawn(async move {
            b1.wait().await;
            bind_uc.execute(&tid_bind, &txh_bind, seller).await
        });

        let b2 = Arc::clone(&barrier);
        let idx_fut = tokio::spawn(async move {
            b2.wait().await;
            idx_uc.poll_and_index().await
        });

        let (bind_res, idx_res) = tokio::join!(bind_fut, idx_fut);
        let bound = bind_res.expect("join bind").expect("bind succeeded");
        idx_res.expect("join indexer").expect("indexer succeeded");

        assert_eq!(bound.status, DealStatus::Created);
        assert!(bound.on_chain_bound);
        assert_eq!(bound.create_tx_hash.as_deref(), Some(create_tx.as_str()));

        let created_events_count = harness
            .components
            .repos
            .deal_events
            .find_by_trade_id_order_by_created_at_asc(&draft.trade_id)
            .await
            .unwrap()
            .into_iter()
            .filter(|e| e.event_type == "TRADE_CREATED")
            .count();
        assert_eq!(created_events_count, 1);
    }
}
