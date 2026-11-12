mod common;

use axum::http::StatusCode;
use chrono::Utc;
use common::{build_multipart_file_body, TestAppHarness, TestWallet, DEFAULT_CONTRACT};
use safedeal_domain::blockchain::{
    OnChainEventType, OnChainTradeSnapshot, TransactionVerificationResult, VerifiedChainEvent,
};
use safedeal_domain::deal::{DealEvent, DealStatus};
use safedeal_domain::ports::{in_tx, DealRepository};

fn sample_png() -> Vec<u8> {
    vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02]
}

#[tokio::test]
async fn executes_full_deal_bind_dispute_private_evidence_and_arbitration_workflow() {
    let harness = TestAppHarness::start().await;
    let seller = harness.login_wallet(&TestWallet::random()).await;
    let buyer = harness.login_wallet(&TestWallet::random()).await;
    let arbiter = harness.login_wallet(&TestWallet::random()).await;
    let outsider = harness.login_wallet(&TestWallet::random()).await;

    let now = Utc::now().timestamp();
    let funding_deadline = now + 3600;
    let delivery_deadline = now + 7200;
    let amount_wei = "2000000000000000000";

    // Reject seller == arbiter
    let conflict_draft = seller
        .post_json(
            harness.app(),
            "/api/v1/deals/drafts",
            serde_json::json!({
                "title": "Invalid Same Arbiter",
                "description": "Testing conflict rejection",
                "amountWei": amount_wei,
                "buyerAddress": buyer.address,
                "arbiterAddress": seller.address,
                "fundingDeadlineEpochSeconds": funding_deadline,
                "deliveryDeadlineEpochSeconds": delivery_deadline,
                "inspectionWindowSeconds": 3600,
                "terms": "Standard delivery terms text"
            }),
        )
        .await;
    assert_eq!(conflict_draft.status, StatusCode::BAD_REQUEST);

    // Create valid draft
    let draft_res = seller
        .post_json(
            harness.app(),
            "/api/v1/deals/drafts",
            serde_json::json!({
                "title": "Avalanche Consulting",
                "description": "Smart contract hardening engagement",
                "amountWei": amount_wei,
                "buyerAddress": buyer.address,
                "arbiterAddress": arbiter.address,
                "fundingDeadlineEpochSeconds": funding_deadline,
                "deliveryDeadlineEpochSeconds": delivery_deadline,
                "inspectionWindowSeconds": 86400,
                "terms": "Signed audit report delivered within 48h"
            }),
        )
        .await;
    assert_eq!(draft_res.status, StatusCode::CREATED);
    let draft_json = draft_res.json();
    let trade_id = draft_json["tradeId"].as_str().expect("tradeId").to_string();
    let terms_hash = draft_json["termsHash"]
        .as_str()
        .expect("termsHash")
        .to_string();

    // Outsider cannot read deal
    let outsider_get = outsider
        .get(harness.app(), &format!("/api/v1/deals/{trade_id}"))
        .await;
    assert_eq!(outsider_get.status, StatusCode::FORBIDDEN);

    // Bind transaction verification setup
    let create_tx = format!("0x{}", "a".repeat(64));
    let created_ev = VerifiedChainEvent {
        tx_hash: create_tx.clone(),
        log_index: 0,
        block_number: 100,
        block_timestamp_epoch: now,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::TradeCreated,
        trade_id: Some(trade_id.clone()),
        actor_address: Some(seller.address.clone()),
        buyer_address: Some(buyer.address.clone()),
        amount_wei: Some(amount_wei.to_string()),
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: Some(terms_hash.clone()),
    };
    harness
        .gateway
        .inner
        .update(|s| {
            s.transactions.insert(
                create_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: create_tx.clone(),
                    succeeded: true,
                    block_number: 100,
                    from_address: seller.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![created_ev.clone()],
                },
            );
            s.trades.insert(
                trade_id.to_ascii_lowercase(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: seller.address.clone(),
                    buyer: Some(buyer.address.clone()),
                    arbiter: arbiter.address.clone(),
                    amount_wei: amount_wei.to_string(),
                    terms_hash: terms_hash.clone(),
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 86400,
                    delivered_at_epoch: 0,
                    chain_status_ordinal: 1,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
        })
        .await;

    // Non-seller rejected on bind-tx
    let buyer_bind = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/bind-tx"),
            serde_json::json!({ "txHash": create_tx }),
        )
        .await;
    assert_eq!(buyer_bind.status, StatusCode::FORBIDDEN);

    // Seller binds tx -> CREATED
    let seller_bind = seller
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/bind-tx"),
            serde_json::json!({ "txHash": create_tx }),
        )
        .await;
    assert_eq!(seller_bind.status, StatusCode::OK);
    let bound_json = seller_bind.json();
    assert_eq!(bound_json["status"], "CREATED");
    assert_eq!(bound_json["onChainBound"], true);

    // Verify SELECT ... FOR UPDATE & ON CONFLICT DO NOTHING idempotency inside Tx
    let extra_tx = format!("0x{}", "f".repeat(64));
    let fresh_chain_ev = VerifiedChainEvent {
        tx_hash: extra_tx.clone(),
        log_index: 0,
        block_number: 101,
        block_timestamp_epoch: now,
        contract_address: DEFAULT_CONTRACT.to_string(),
        event_type: OnChainEventType::DeliveryMarked,
        trade_id: Some(trade_id.clone()),
        actor_address: Some(seller.address.clone()),
        buyer_address: Some(buyer.address.clone()),
        amount_wei: None,
        buyer_award_wei: None,
        seller_award_wei: None,
        terms_hash: None,
    };
    let tid_tx = trade_id.clone();
    let seller_addr_tx = seller.address.clone();
    let create_tx_copy = create_tx.clone();
    in_tx(harness.components.repos.uow.as_ref(), move |repos| {
        Box::pin(async move {
            let locked = repos
                .deals()
                .find_by_trade_id_for_update(&tid_tx)
                .await?
                .expect("locked deal");
            assert_eq!(locked.status, DealStatus::Created);
            assert!(!repos.chain_events().record_if_absent(&created_ev).await?);
            assert!(
                repos
                    .chain_events()
                    .record_if_absent(&fresh_chain_ev)
                    .await?
            );
            assert!(
                !repos
                    .chain_events()
                    .record_if_absent(&fresh_chain_ev)
                    .await?
            );

            let dup_deal_ev = DealEvent {
                id: None,
                trade_id: tid_tx.clone(),
                event_type: "TRADE_CREATED".to_string(),
                actor_address: Some(seller_addr_tx.clone()),
                tx_hash: Some(create_tx_copy),
                block_number: Some(100),
                log_index: Some(0),
                details: "Created".to_string(),
                created_at: Utc::now(),
            };
            assert!(!repos.deal_events().save_if_absent(&dup_deal_ev).await?);

            let fresh_deal_ev = DealEvent {
                id: None,
                trade_id: tid_tx,
                event_type: "DELIVERY_MARKED".to_string(),
                actor_address: Some(seller_addr_tx),
                tx_hash: Some(extra_tx),
                block_number: Some(101),
                log_index: Some(0),
                details: "Synthetic".to_string(),
                created_at: Utc::now(),
            };
            assert!(repos.deal_events().save_if_absent(&fresh_deal_ev).await?);
            assert!(!repos.deal_events().save_if_absent(&fresh_deal_ev).await?);
            Ok(())
        })
    })
    .await
    .expect("idempotency tx");

    let filtered = harness
        .components
        .repos
        .deals
        .find_user_deals(
            &seller.address,
            Some("seller"),
            Some(DealStatus::Created),
            0,
            20,
        )
        .await
        .expect("find user deals");
    assert!(filtered.items.iter().any(|d| d.trade_id == trade_id));

    let open_bound = harness
        .components
        .repos
        .deals
        .find_open_bound_deals()
        .await
        .expect("open bound deals");
    assert!(open_bound.iter().any(|d| d.trade_id == trade_id));

    // Buyer opens dispute on-chain
    let dispute_tx = format!("0x{}", "b".repeat(64));
    harness
        .gateway
        .inner
        .update(|s| {
            s.transactions.insert(
                dispute_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: dispute_tx.clone(),
                    succeeded: true,
                    block_number: 105,
                    from_address: buyer.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![VerifiedChainEvent {
                        tx_hash: dispute_tx.clone(),
                        log_index: 0,
                        block_number: 105,
                        block_timestamp_epoch: now,
                        contract_address: DEFAULT_CONTRACT.to_string(),
                        event_type: OnChainEventType::DisputeOpened,
                        trade_id: Some(trade_id.clone()),
                        actor_address: Some(buyer.address.clone()),
                        buyer_address: Some(buyer.address.clone()),
                        amount_wei: None,
                        buyer_award_wei: None,
                        seller_award_wei: None,
                        terms_hash: None,
                    }],
                },
            );
            s.trades.insert(
                trade_id.to_ascii_lowercase(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: seller.address.clone(),
                    buyer: Some(buyer.address.clone()),
                    arbiter: arbiter.address.clone(),
                    amount_wei: amount_wei.to_string(),
                    terms_hash: terms_hash.clone(),
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 86400,
                    delivered_at_epoch: 0,
                    chain_status_ordinal: 6,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
        })
        .await;

    let dispute_res = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/disputes"),
            serde_json::json!({
                "reason": "Deliverable missing",
                "summary": "Final report lacks mandatory test traces.",
                "txHash": dispute_tx
            }),
        )
        .await;
    assert_eq!(dispute_res.status, StatusCode::CREATED);
    let dispute_json = dispute_res.json();
    assert_eq!(dispute_json["status"], "OPEN");
    let dispute_id = dispute_json["id"].as_i64().expect("dispute id");

    // Upload PNG evidence via multipart (title & notes as query params)
    let png = sample_png();
    let boundary = "----SafeDealPngBoundary";
    let mp_body = build_multipart_file_body(
        boundary,
        &[],
        Some(("file", "proof.png", "image/png", &png)),
    );
    let ev_res = buyer
        .post_multipart(
            harness.app(),
            &format!(
                "/api/v1/disputes/{dispute_id}/evidence?title=Log%20screenshot&notes=Shows%20failing%20verification%20step"
            ),
            boundary,
            mp_body,
        )
        .await;
    assert_eq!(ev_res.status, StatusCode::CREATED);
    let ev_json = ev_res.json();
    assert_eq!(ev_json["hasAttachment"], true);
    let evidence_id = ev_json["id"].as_i64().expect("evidence id");

    // Also accept frontend-style multipart form fields (`title` & `notes` inside multipart form)
    let mp_form_fields = build_multipart_file_body(
        boundary,
        &[
            ("title", "Form field note"),
            ("notes", "Submitted from multipart fields like React client"),
        ],
        None,
    );
    let form_ev_res = seller
        .post_multipart(
            harness.app(),
            &format!("/api/v1/disputes/{dispute_id}/evidence"),
            boundary,
            mp_form_fields,
        )
        .await;
    assert_eq!(form_ev_res.status, StatusCode::CREATED);
    assert_eq!(form_ev_res.json()["hasAttachment"], false);

    // Arbiter cannot upload evidence (only buyer/seller)
    let arbiter_upload = arbiter
        .post_multipart(
            harness.app(),
            &format!(
                "/api/v1/disputes/{dispute_id}/evidence?title=Arbiter&notes=Should%20fail%20403"
            ),
            boundary,
            build_multipart_file_body(boundary, &[], None),
        )
        .await;
    assert_eq!(arbiter_upload.status, StatusCode::FORBIDDEN);

    // Outsider forbidden from reading dispute or downloading evidence
    assert_eq!(
        outsider
            .get(harness.app(), &format!("/api/v1/disputes/{dispute_id}"))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        outsider
            .get(
                harness.app(),
                &format!("/api/v1/disputes/{dispute_id}/evidence/{evidence_id}/download")
            )
            .await
            .status,
        StatusCode::FORBIDDEN
    );

    // Arbiter allowed to download private evidence cleanly
    let dl = arbiter
        .get(
            harness.app(),
            &format!("/api/v1/disputes/{dispute_id}/evidence/{evidence_id}/download"),
        )
        .await;
    assert_eq!(dl.status, StatusCode::OK);
    assert_eq!(
        dl.headers
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff")
    );
    assert_eq!(dl.body, png);

    // Empty 0-byte attachment must be rejected cleanly with 400 VALIDATION_ERROR
    let empty_mp =
        build_multipart_file_body(boundary, &[], Some(("file", "empty.png", "image/png", &[])));
    let empty_res = buyer
        .post_multipart(
            harness.app(),
            &format!(
                "/api/v1/disputes/{dispute_id}/evidence?title=Empty&notes=Should%20reject%200%20bytes"
            ),
            boundary,
            empty_mp,
        )
        .await;
    assert_eq!(empty_res.status, StatusCode::BAD_REQUEST);

    // Deal listing returns mapped disputeId accurately
    let deals_list = buyer.get(harness.app(), "/api/v1/deals").await;
    assert_eq!(deals_list.status, StatusCode::OK);
    assert_eq!(deals_list.json()["items"][0]["disputeId"], dispute_id);

    // Arbiter resolves on-chain with split
    let resolve_tx = format!("0x{}", "c".repeat(64));
    let buyer_award = "1500000000000000000";
    let seller_award = "500000000000000000";
    harness
        .gateway
        .inner
        .update(|s| {
            s.transactions.insert(
                resolve_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: resolve_tx.clone(),
                    succeeded: true,
                    block_number: 120,
                    from_address: arbiter.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![VerifiedChainEvent {
                        tx_hash: resolve_tx.clone(),
                        log_index: 0,
                        block_number: 120,
                        block_timestamp_epoch: now,
                        contract_address: DEFAULT_CONTRACT.to_string(),
                        event_type: OnChainEventType::DisputeResolved,
                        trade_id: Some(trade_id.clone()),
                        actor_address: Some(arbiter.address.clone()),
                        buyer_address: Some(buyer.address.clone()),
                        amount_wei: None,
                        buyer_award_wei: Some(buyer_award.to_string()),
                        seller_award_wei: Some(seller_award.to_string()),
                        terms_hash: None,
                    }],
                },
            );
            s.trades.insert(
                trade_id.to_ascii_lowercase(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: seller.address.clone(),
                    buyer: Some(buyer.address.clone()),
                    arbiter: arbiter.address.clone(),
                    amount_wei: amount_wei.to_string(),
                    terms_hash: terms_hash.clone(),
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 86400,
                    delivered_at_epoch: 0,
                    chain_status_ordinal: 7,
                    settled: true,
                    buyer_award_wei: buyer_award.to_string(),
                    seller_award_wei: seller_award.to_string(),
                },
            );
        })
        .await;

    // Buyer cannot resolve
    let buyer_resolve = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/arbitration/disputes/{dispute_id}/resolution"),
            serde_json::json!({
                "txHash": resolve_tx,
                "rationale": "Partial refund granted per evidence review."
            }),
        )
        .await;
    assert_eq!(buyer_resolve.status, StatusCode::FORBIDDEN);

    // Assigned arbiter lists disputes & resolves cleanly
    let assigned = arbiter
        .get(harness.app(), "/api/v1/arbitration/disputes")
        .await;
    assert_eq!(assigned.status, StatusCode::OK);
    assert_eq!(assigned.json()[0]["id"], dispute_id);

    let resolved = arbiter
        .post_json(
            harness.app(),
            &format!("/api/v1/arbitration/disputes/{dispute_id}/resolution"),
            serde_json::json!({
                "txHash": resolve_tx,
                "rationale": "Partial refund granted per evidence review."
            }),
        )
        .await;
    assert_eq!(resolved.status, StatusCode::OK);
    let rj = resolved.json();
    assert_eq!(rj["status"], "RESOLVED");
    assert_eq!(rj["buyerAwardWei"], buyer_award);
    assert_eq!(rj["sellerAwardWei"], seller_award);

    let open_after = harness
        .components
        .repos
        .deals
        .find_open_bound_deals()
        .await
        .expect("open bound deals after resolution");
    assert!(!open_after.iter().any(|d| d.trade_id == trade_id));
}

#[tokio::test]
async fn evidence_upload_returns_413_json_when_exceeding_max_bytes_or_request_limit() {
    let harness = TestAppHarness::start_with_overrides(&[
        ("EVIDENCE_MAX_BYTES", "1024"),
        ("EVIDENCE_MAX_REQUEST_BYTES", "4096"),
    ])
    .await;

    let seller = harness.login_wallet(&TestWallet::random()).await;
    let buyer = harness.login_wallet(&TestWallet::random()).await;
    let arbiter = harness.login_wallet(&TestWallet::random()).await;

    let now = Utc::now().timestamp();
    let draft_res = seller
        .post_json(
            harness.app(),
            "/api/v1/deals/drafts",
            serde_json::json!({
                "title": "Large File Limit Test",
                "description": "Verifying 413 FILE_TOO_LARGE HTTP JSON parity",
                "amountWei": "1000000000000000000",
                "buyerAddress": buyer.address,
                "arbiterAddress": arbiter.address,
                "fundingDeadlineEpochSeconds": now + 3600,
                "deliveryDeadlineEpochSeconds": now + 7200,
                "inspectionWindowSeconds": 3600,
                "terms": "Standard test agreement"
            }),
        )
        .await;
    assert_eq!(draft_res.status, StatusCode::CREATED);
    let trade_id = draft_res.json()["tradeId"]
        .as_str()
        .expect("tid")
        .to_string();
    let terms_hash = draft_res.json()["termsHash"]
        .as_str()
        .expect("hash")
        .to_string();

    let dispute_tx = format!("0x{}", "5".repeat(64));
    harness
        .gateway
        .inner
        .update(|s| {
            s.transactions.insert(
                dispute_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: dispute_tx.clone(),
                    succeeded: true,
                    block_number: 10,
                    from_address: buyer.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![VerifiedChainEvent {
                        tx_hash: dispute_tx.clone(),
                        log_index: 0,
                        block_number: 10,
                        block_timestamp_epoch: now,
                        contract_address: DEFAULT_CONTRACT.to_string(),
                        event_type: OnChainEventType::DisputeOpened,
                        trade_id: Some(trade_id.clone()),
                        actor_address: Some(buyer.address.clone()),
                        buyer_address: Some(buyer.address.clone()),
                        amount_wei: None,
                        buyer_award_wei: None,
                        seller_award_wei: None,
                        terms_hash: None,
                    }],
                },
            );
            s.trades.insert(
                trade_id.to_ascii_lowercase(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: seller.address.clone(),
                    buyer: Some(buyer.address.clone()),
                    arbiter: arbiter.address.clone(),
                    amount_wei: "1000000000000000000".to_string(),
                    terms_hash,
                    funding_deadline_epoch: now + 3600,
                    delivery_deadline_epoch: now + 7200,
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

    let d_res = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/disputes"),
            serde_json::json!({
                "reason": "Defect found",
                "summary": "Testing file size rejections cleanly.",
                "txHash": dispute_tx
            }),
        )
        .await;
    assert_eq!(d_res.status, StatusCode::CREATED);
    let dispute_id = d_res.json()["id"].as_i64().expect("dispute id");

    // 1. Over EVIDENCE_MAX_BYTES (1500 bytes <= 4096 request limit)
    let mut medium_png = sample_png();
    medium_png.resize(1500, 0x42);
    let boundary = "----SafeDealLimitBoundary";
    let res_file_limit = buyer
        .post_multipart(
            harness.app(),
            &format!(
                "/api/v1/disputes/{dispute_id}/evidence?title=BigFile&notes=Exceeds%201024%20bytes"
            ),
            boundary,
            build_multipart_file_body(
                boundary,
                &[],
                Some(("file", "big.png", "image/png", &medium_png)),
            ),
        )
        .await;
    assert_eq!(res_file_limit.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(res_file_limit.json()["code"], "FILE_TOO_LARGE");

    // 2. Over EVIDENCE_MAX_REQUEST_BYTES (5000 bytes -> rejected at RequestBodyLimitLayer -> 413 JSON)
    let mut huge_png = sample_png();
    huge_png.resize(5000, 0x43);
    let res_req_limit = buyer
        .post_multipart(
            harness.app(),
            &format!("/api/v1/disputes/{dispute_id}/evidence?title=HugeReq&notes=Exceeds%204096%20request%20limit"),
            boundary,
            build_multipart_file_body(boundary, &[], Some(("file", "huge.png", "image/png", &huge_png))),
        )
        .await;
    assert_eq!(res_req_limit.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(res_req_limit.json()["code"], "FILE_TOO_LARGE");
}

#[tokio::test]
async fn sync_deal_preserves_create_tx_hash_and_rejects_spoofed_contract_and_cross_trade() {
    let harness = TestAppHarness::start().await;
    let seller = harness.login_wallet(&TestWallet::random()).await;
    let buyer = harness.login_wallet(&TestWallet::random()).await;
    let arbiter = harness.login_wallet(&TestWallet::random()).await;

    let now = Utc::now().timestamp();
    let funding_deadline = now + 3600;
    let delivery_deadline = now + 7200;
    let amount_wei = "1000000000000000000";

    let draft_res = seller
        .post_json(
            harness.app(),
            "/api/v1/deals/drafts",
            serde_json::json!({
                "title": "Sync Hash Purity Test",
                "description": "Verifying sync preserves createTxHash semantics cleanly.",
                "amountWei": amount_wei,
                "buyerAddress": buyer.address,
                "arbiterAddress": arbiter.address,
                "fundingDeadlineEpochSeconds": funding_deadline,
                "deliveryDeadlineEpochSeconds": delivery_deadline,
                "inspectionWindowSeconds": 3600,
                "terms": "Standard escrow agreement terms applied."
            }),
        )
        .await;
    assert_eq!(draft_res.status, StatusCode::CREATED);
    let trade_id = draft_res.json()["tradeId"]
        .as_str()
        .expect("tid")
        .to_string();
    let terms_hash = draft_res.json()["termsHash"]
        .as_str()
        .expect("hash")
        .to_string();

    // 1. Spoofed contract -> 400 Validation containing SafeDealEscrow
    let wrong_contract_tx = format!("0x{}", "1".repeat(64));
    let cross_trade_tx = format!("0x{}", "2".repeat(64));
    let other_trade_id = format!("0x{}", "9".repeat(64));
    let real_fund_tx = format!("0x{}", "f".repeat(64));
    let block_ts = now - 120;

    harness
        .gateway
        .inner
        .update(|s| {
            s.trades.insert(
                trade_id.to_ascii_lowercase(),
                OnChainTradeSnapshot {
                    trade_id: trade_id.clone(),
                    seller: seller.address.clone(),
                    buyer: Some(buyer.address.clone()),
                    arbiter: arbiter.address.clone(),
                    amount_wei: amount_wei.to_string(),
                    terms_hash,
                    funding_deadline_epoch: funding_deadline,
                    delivery_deadline_epoch: delivery_deadline,
                    inspection_window_seconds: 3600,
                    delivered_at_epoch: 0,
                    chain_status_ordinal: 2,
                    settled: false,
                    buyer_award_wei: "0".to_string(),
                    seller_award_wei: "0".to_string(),
                },
            );
            s.transactions.insert(
                wrong_contract_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: wrong_contract_tx.clone(),
                    succeeded: true,
                    block_number: 50,
                    from_address: buyer.address.clone(),
                    to_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
                    decoded_events: vec![],
                },
            );
            s.transactions.insert(
                cross_trade_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: cross_trade_tx.clone(),
                    succeeded: true,
                    block_number: 51,
                    from_address: buyer.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![VerifiedChainEvent {
                        tx_hash: cross_trade_tx.clone(),
                        log_index: 0,
                        block_number: 51,
                        block_timestamp_epoch: now,
                        contract_address: DEFAULT_CONTRACT.to_string(),
                        event_type: OnChainEventType::TradeFunded,
                        trade_id: Some(other_trade_id.clone()),
                        actor_address: Some(buyer.address.clone()),
                        buyer_address: Some(buyer.address.clone()),
                        amount_wei: Some(amount_wei.to_string()),
                        buyer_award_wei: None,
                        seller_award_wei: None,
                        terms_hash: None,
                    }],
                },
            );
            s.transactions.insert(
                real_fund_tx.clone(),
                TransactionVerificationResult {
                    tx_hash: real_fund_tx.clone(),
                    succeeded: true,
                    block_number: 52,
                    from_address: buyer.address.clone(),
                    to_address: DEFAULT_CONTRACT.to_string(),
                    decoded_events: vec![VerifiedChainEvent {
                        tx_hash: real_fund_tx.clone(),
                        log_index: 0,
                        block_number: 52,
                        block_timestamp_epoch: block_ts,
                        contract_address: DEFAULT_CONTRACT.to_string(),
                        event_type: OnChainEventType::TradeFunded,
                        trade_id: Some(trade_id.clone()),
                        actor_address: Some(buyer.address.clone()),
                        buyer_address: Some(buyer.address.clone()),
                        amount_wei: Some(amount_wei.to_string()),
                        buyer_award_wei: None,
                        seller_award_wei: None,
                        terms_hash: None,
                    }],
                },
            );
        })
        .await;

    let err_wrong_contract = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/sync"),
            serde_json::json!({ "txHash": wrong_contract_tx }),
        )
        .await;
    assert_eq!(err_wrong_contract.status, StatusCode::BAD_REQUEST);
    assert!(err_wrong_contract.text().contains("SafeDealEscrow"));

    let err_cross_trade = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/sync"),
            serde_json::json!({ "txHash": cross_trade_tx }),
        )
        .await;
    assert_eq!(err_cross_trade.status, StatusCode::BAD_REQUEST);
    assert!(err_cross_trade.text().contains(&trade_id));

    let synced = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/sync"),
            serde_json::json!({ "txHash": real_fund_tx }),
        )
        .await;
    assert_eq!(synced.status, StatusCode::OK);
    let sj = synced.json();
    assert_eq!(sj["status"], "FUNDED");
    assert!(sj["createTxHash"].is_null());

    // Tampered on-chain snapshot parameters (e.g., delivery deadline or arbiter) must fail validation
    harness
        .gateway
        .inner
        .update(|s| {
            if let Some(snap) = s.trades.get_mut(&trade_id.to_ascii_lowercase()) {
                snap.delivery_deadline_epoch += 600;
            }
        })
        .await;
    let err_tampered = buyer
        .post_json(
            harness.app(),
            &format!("/api/v1/deals/{trade_id}/sync"),
            serde_json::json!({}),
        )
        .await;
    assert_eq!(err_tampered.status, StatusCode::BAD_REQUEST);
    assert!(err_tampered
        .text()
        .contains("disagrees with stored canonical terms"));
}
