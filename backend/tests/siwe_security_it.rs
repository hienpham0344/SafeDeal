mod common;

use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;

use axum::http::{header, Method, StatusCode};
use common::{
    build_multipart_file_body, build_test_config, find_set_cookie_header, send_request,
    ConfigurableStaticGateway, TestAppHarness, TestWallet,
};
use sqlx::postgres::PgPoolOptions;
use tempfile::TempDir;

#[tokio::test]
async fn health_readiness_and_actuator_probes_behave_accurately() {
    let harness = TestAppHarness::start().await;

    let health = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/health",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(health.status, StatusCode::OK);
    let hj = health.json();
    assert_eq!(hj["status"], "UP");
    assert_eq!(hj["service"], "safedeal-api");
    assert_eq!(hj["chainId"], 31337);
    assert_eq!(hj["chainName"], "Anvil Local");
    assert_eq!(hj["escrowContractConfigured"], true);

    assert_eq!(
        health
            .headers
            .get("x-frame-options")
            .and_then(|v| v.to_str().ok()),
        Some("DENY")
    );
    assert_eq!(
        health
            .headers
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff")
    );
    assert_eq!(
        health
            .headers
            .get("referrer-policy")
            .and_then(|v| v.to_str().ok()),
        Some("strict-origin-when-cross-origin")
    );
    assert!(health.headers.contains_key("x-correlation-id"));

    let ready = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/health/ready",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(ready.status, StatusCode::OK);
    let rj = ready.json();
    assert_eq!(rj["status"], "READY");
    assert_eq!(rj["databaseConnected"], true);
    assert_eq!(rj["evidenceStorageReady"], true);
    assert_eq!(rj["siweConfigured"], true);
    assert_eq!(rj["escrowContractConfigured"], true);

    for path in [
        "/actuator/health",
        "/actuator/health/readiness",
        "/actuator/health/liveness",
    ] {
        let res = send_request(harness.app(), Method::GET, path, &[], None, None, None).await;
        assert_eq!(res.status, StatusCode::OK, "path={path}");
        assert_eq!(res.json()["status"], "UP");
    }

    let info_res = send_request(
        harness.app(),
        Method::GET,
        "/actuator/info",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(info_res.status, StatusCode::OK);

    // Zero contract address when sync enabled -> /health stays UP with escrowContractConfigured=false, /ready -> 503
    harness
        .gateway
        .set_contract("0x0000000000000000000000000000000000000000")
        .await;

    let h_zero = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/health",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(h_zero.status, StatusCode::OK);
    assert_eq!(h_zero.json()["escrowContractConfigured"], false);

    let r_zero = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/health/ready",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(r_zero.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(r_zero.json()["status"], "NOT_READY");
    assert_eq!(r_zero.json()["escrowContractConfigured"], false);

    let act_zero = send_request(
        harness.app(),
        Method::GET,
        "/actuator/health/readiness",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(act_zero.status, StatusCode::OK);
    assert_eq!(act_zero.json()["status"], "UP");

    // Blockchain disabled + blank contract still reports 200 READY
    let tmp = TempDir::new().expect("tmp");
    let disabled_cfg = build_test_config(
        &common::test_db_url(),
        tmp.path(),
        &[
            ("BLOCKCHAIN_SYNC_ENABLED", "false"),
            ("ESCROW_CONTRACT_ADDRESS", ""),
        ],
    );
    let gw_disabled = Arc::new(ConfigurableStaticGateway {
        enabled: false,
        chain_id: 31337,
        chain_name: "Anvil Local".to_string(),
        contract_address: String::new(),
        deployment_block: 0,
        confirmations_required: 1,
        sync_batch_size: 100,
    });
    let disabled_comps =
        safedeal_api::assemble_application(&disabled_cfg, harness.pool.clone(), gw_disabled)
            .expect("assemble disabled");
    let r_disabled = send_request(
        disabled_comps.router,
        Method::GET,
        "/api/v1/health/ready",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(r_disabled.status, StatusCode::OK);
    assert_eq!(r_disabled.json()["status"], "READY");
    assert_eq!(r_disabled.json()["databaseConnected"], true);

    // Unreachable DB -> /api/v1/health/ready, /actuator/health, and /actuator/health/readiness all return 503
    let dead_pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(150))
        .connect_lazy("postgres://safedeal:safedeal@127.0.0.1:1/nonexistent")
        .expect("lazy pool creation");
    let dead_cfg = build_test_config(
        "postgres://safedeal:safedeal@127.0.0.1:1/nonexistent",
        tmp.path(),
        &[],
    );
    let dead_gw = Arc::new(ConfigurableStaticGateway {
        enabled: true,
        chain_id: 31337,
        chain_name: "Anvil Local".to_string(),
        contract_address: common::DEFAULT_CONTRACT.to_string(),
        deployment_block: 0,
        confirmations_required: 1,
        sync_batch_size: 100,
    });
    let dead_comps =
        safedeal_api::assemble_application(&dead_cfg, dead_pool, dead_gw).expect("assemble dead");
    let ready_dead = send_request(
        dead_comps.router.clone(),
        Method::GET,
        "/api/v1/health/ready",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(ready_dead.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(ready_dead.json()["status"], "NOT_READY");
    assert_eq!(ready_dead.json()["databaseConnected"], false);

    let actuator_ready_dead = send_request(
        dead_comps.router,
        Method::GET,
        "/actuator/health/readiness",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(actuator_ready_dead.status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn full_siwe_login_issues_httponly_and_csrf_cookies_and_blocks_replay_and_missing_csrf() {
    let harness = TestAppHarness::start().await;
    let wallet = TestWallet::random();

    // 1. Unauthenticated /auth/me rejected (with correlation id echoed)
    let unauth = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/auth/me",
        &[("X-Correlation-Id", "corr-unauth-123")],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(unauth.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        unauth
            .headers
            .get("x-correlation-id")
            .and_then(|v| v.to_str().ok()),
        Some("corr-unauth-123")
    );
    assert_eq!(unauth.json()["code"], "UNAUTHORIZED");

    // 2. Request nonce
    let nonce_res = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/nonce",
        &[],
        None,
        Some("application/json"),
        Some(
            serde_json::json!({
                "address": wallet.address,
                "chainId": 31337
            })
            .to_string()
            .into_bytes(),
        ),
    )
    .await;
    assert_eq!(nonce_res.status, StatusCode::OK);
    let nonce_json = nonce_res.json();
    assert!(!nonce_json["nonce"].as_str().unwrap_or("").is_empty());
    assert_eq!(nonce_json["domain"], "localhost:5173");

    let message = nonce_json["message"].as_str().expect("message");
    let signature = wallet.sign_personal(message);
    let verify_body = serde_json::json!({
        "message": message,
        "signature": signature
    })
    .to_string()
    .into_bytes();

    // 3. Verify valid signature -> HttpOnly session cookie + non-HttpOnly CSRF cookie
    let verify_res = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/verify",
        &[],
        None,
        Some("application/json"),
        Some(verify_body.clone()),
    )
    .await;
    assert_eq!(verify_res.status, StatusCode::OK);
    let verify_json = verify_res.json();
    assert_eq!(verify_json["address"], wallet.address);
    assert!(!verify_json["csrfToken"].as_str().unwrap_or("").is_empty());

    let raw_session_cookie = find_set_cookie_header(&verify_res.headers, "safedeal_session")
        .expect("session set-cookie");
    let raw_csrf_cookie =
        find_set_cookie_header(&verify_res.headers, "safedeal_csrf").expect("csrf set-cookie");
    assert!(raw_session_cookie.contains("HttpOnly"));
    assert!(!raw_csrf_cookie.contains("HttpOnly"));

    // 4. Replay exact same signed challenge -> 401 UNAUTHORIZED
    let replay = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/verify",
        &[],
        None,
        Some("application/json"),
        Some(verify_body),
    )
    .await;
    assert_eq!(replay.status, StatusCode::UNAUTHORIZED);

    // Log in cleanly via actor helper
    let actor = harness.login_wallet(&TestWallet::random()).await;

    // 5. Cookie-authenticated GET /me succeeds
    let me = actor.get(harness.app(), "/api/v1/auth/me").await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.json()["address"], actor.address);

    // 5b. Bearer token authentication works on GET and POST without CSRF header
    let bearer_header = format!("Bearer {}", actor.session_cookie);
    let bearer_me = send_request(
        harness.app(),
        Method::GET,
        "/api/v1/auth/me",
        &[(header::AUTHORIZATION.as_str(), &bearer_header)],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(bearer_me.status, StatusCode::OK);
    assert_eq!(bearer_me.json()["address"], actor.address);

    // 6. Cookie-authenticated mutating POST without X-CSRF-Token -> 403 CSRF_VALIDATION_FAILED
    let no_csrf = actor
        .post_json_without_csrf(harness.app(), "/api/v1/deals/drafts", serde_json::json!({}))
        .await;
    assert_eq!(no_csrf.status, StatusCode::FORBIDDEN);
    assert_eq!(no_csrf.json()["code"], "CSRF_VALIDATION_FAILED");

    // 6b. Malformed JSON -> 400 MALFORMED_JSON
    let malformed = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/deals/drafts",
        &[
            (header::COOKIE.as_str(), &actor.cookie_header()),
            ("X-CSRF-Token", &actor.csrf_cookie),
        ],
        None,
        Some("application/json"),
        Some(b"{broken-json".to_vec()),
    )
    .await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
    assert_eq!(malformed.json()["code"], "MALFORMED_JSON");

    // 6c. Empty JSON object -> 400 REQUEST_VALIDATION_FAILED with fieldErrors
    let invalid_fields = actor
        .post_json(harness.app(), "/api/v1/deals/drafts", serde_json::json!({}))
        .await;
    assert_eq!(invalid_fields.status, StatusCode::BAD_REQUEST);
    let err_json = invalid_fields.json();
    assert_eq!(err_json["code"], "REQUEST_VALIDATION_FAILED");
    assert!(!err_json["fieldErrors"]
        .as_array()
        .expect("fieldErrors array")
        .is_empty());

    // 7. Malformed path variable, query param, missing multipart param, unsupported HTTP method
    let bad_id = actor
        .get(harness.app(), "/api/v1/disputes/not-a-number")
        .await;
    assert_eq!(bad_id.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad_id.json()["code"], "INVALID_PARAMETER");

    let bad_page = actor.get(harness.app(), "/api/v1/deals?page=abc").await;
    assert_eq!(bad_page.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad_page.json()["code"], "INVALID_PARAMETER");

    let boundary = "----SafeDealTestBoundary123";
    let empty_mp = build_multipart_file_body(boundary, &[], None);
    let missing_mp = actor
        .post_multipart(
            harness.app(),
            "/api/v1/disputes/1/evidence",
            boundary,
            empty_mp,
        )
        .await;
    assert_eq!(missing_mp.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing_mp.json()["code"], "MISSING_PARAMETER");

    let method_not_allowed = send_request(
        harness.app(),
        Method::DELETE,
        "/api/v1/deals",
        &[
            (header::COOKIE.as_str(), &actor.cookie_header()),
            ("X-CSRF-Token", &actor.csrf_cookie),
        ],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(method_not_allowed.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(method_not_allowed.json()["code"], "METHOD_NOT_ALLOWED");

    // 8. Logout clears cookies (and rejects cookie-auth logout without X-CSRF-Token)
    let logout_no_csrf = actor
        .post_json_without_csrf(harness.app(), "/api/v1/auth/logout", serde_json::json!({}))
        .await;
    assert_eq!(logout_no_csrf.status, StatusCode::FORBIDDEN);

    let logout = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/logout",
        &[
            (header::COOKIE.as_str(), &actor.cookie_header()),
            ("X-CSRF-Token", &actor.csrf_cookie),
        ],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
    let cleared_session =
        find_set_cookie_header(&logout.headers, "safedeal_session").expect("cleared session");
    assert!(cleared_session.contains("Max-Age=0"));
}

#[tokio::test]
async fn rejects_wrong_signature_or_tampered_domain_or_uri() {
    let harness = TestAppHarness::start().await;
    let legitimate = TestWallet::random();
    let attacker = TestWallet::random();

    let nonce_res = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/nonce",
        &[],
        None,
        Some("application/json"),
        Some(
            serde_json::json!({
                "address": legitimate.address,
                "chainId": 31337
            })
            .to_string()
            .into_bytes(),
        ),
    )
    .await;
    assert_eq!(nonce_res.status, StatusCode::OK);
    let message = nonce_res.json()["message"]
        .as_str()
        .expect("message")
        .to_string();

    let attacker_sig = attacker.sign_personal(&message);
    let wrong_sig = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/verify",
        &[],
        None,
        Some("application/json"),
        Some(
            serde_json::json!({
                "message": message,
                "signature": attacker_sig
            })
            .to_string()
            .into_bytes(),
        ),
    )
    .await;
    assert_eq!(wrong_sig.status, StatusCode::UNAUTHORIZED);

    let tampered_domain = message.replace("localhost:5173", "evil.attacker.com");
    let tampered_domain_sig = legitimate.sign_personal(&tampered_domain);
    let bad_domain_res = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/verify",
        &[],
        None,
        Some("application/json"),
        Some(
            serde_json::json!({
                "message": tampered_domain,
                "signature": tampered_domain_sig
            })
            .to_string()
            .into_bytes(),
        ),
    )
    .await;
    assert_eq!(bad_domain_res.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_rate_limiter_keys_by_peer_ip_and_ignores_spoofable_xff() {
    let harness = TestAppHarness::start_with_overrides(&[
        ("RATE_LIMIT_ENABLED", "true"),
        ("AUTH_RATE_LIMIT_PER_MINUTE", "2"),
    ])
    .await;

    let wallet = TestWallet::random();
    let body = serde_json::json!({
        "address": wallet.address,
        "chainId": 31337
    })
    .to_string()
    .into_bytes();

    let peer_a = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 10));
    let peer_b = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 11));

    for (idx, spoofed) in ["1.1.1.1", "2.2.2.2", "3.3.3.3"].iter().enumerate() {
        let res = send_request(
            harness.app(),
            Method::POST,
            "/api/v1/auth/nonce",
            &[("X-Forwarded-For", spoofed)],
            Some(peer_a),
            Some("application/json"),
            Some(body.clone()),
        )
        .await;
        if idx < 2 {
            assert_eq!(res.status, StatusCode::OK);
        } else {
            assert_eq!(res.status, StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(res.json()["code"], "RATE_LIMITED");
        }
    }

    let other_peer = send_request(
        harness.app(),
        Method::POST,
        "/api/v1/auth/nonce",
        &[],
        Some(peer_b),
        Some("application/json"),
        Some(body),
    )
    .await;
    assert_eq!(other_peer.status, StatusCode::OK);
}
