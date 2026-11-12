mod common;

use axum::http::{Method, StatusCode};
use common::{build_test_config, send_request, ConfigurableStaticGateway, TestAppHarness};
use serde_json::Value;
use std::fs;
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn generated_openapi_spec_matches_committed_docs_openapi_json() {
    let harness = TestAppHarness::start().await;
    let res = send_request(
        harness.app(),
        Method::GET,
        "/v3/api-docs",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);

    let live_spec: Value = res.json();
    assert!(live_spec["paths"]
        .as_object()
        .is_some_and(|p| p.contains_key("/api/v1/health/ready")));
    assert!(live_spec["paths"]
        .as_object()
        .is_some_and(|p| p.contains_key("/api/v1/deals")));
    assert!(live_spec["paths"]
        .as_object()
        .is_some_and(|p| p.contains_key("/api/v1/auth/verify")));

    let repo_root = common::resolve_repo_root();
    let spec_path = repo_root.join("docs").join("openapi.json");
    let committed_raw =
        fs::read_to_string(&spec_path).expect("Missing committed docs/openapi.json");
    let committed_spec: Value =
        serde_json::from_str(&committed_raw).expect("Invalid JSON in docs/openapi.json");

    if live_spec != committed_spec {
        // Print concise top-level and path/schema diff before asserting so any mismatch is immediately actionable
        let live_paths: std::collections::BTreeSet<_> = live_spec["paths"]
            .as_object()
            .expect("paths object")
            .keys()
            .cloned()
            .collect();
        let committed_paths: std::collections::BTreeSet<_> = committed_spec["paths"]
            .as_object()
            .expect("paths object")
            .keys()
            .cloned()
            .collect();
        assert_eq!(live_paths, committed_paths, "OpenAPI path keys differ");

        for path in &committed_paths {
            assert_eq!(
                live_spec["paths"][path], committed_spec["paths"][path],
                "Mismatch in OpenAPI path {path}"
            );
        }

        let live_schemas: std::collections::BTreeSet<_> = live_spec["components"]["schemas"]
            .as_object()
            .expect("schemas object")
            .keys()
            .cloned()
            .collect();
        let committed_schemas: std::collections::BTreeSet<_> = committed_spec["components"]
            ["schemas"]
            .as_object()
            .expect("schemas object")
            .keys()
            .cloned()
            .collect();
        assert_eq!(
            live_schemas, committed_schemas,
            "OpenAPI component schema keys differ"
        );

        for schema in &committed_schemas {
            assert_eq!(
                live_spec["components"]["schemas"][schema],
                committed_spec["components"]["schemas"][schema],
                "Mismatch in OpenAPI schema {schema}"
            );
        }

        assert_eq!(live_spec, committed_spec, "Top-level OpenAPI spec differs");
    }
}

#[tokio::test]
async fn swagger_ui_serves_normalized_spec_and_redirects_when_enabled() {
    let harness = TestAppHarness::start_with_overrides(&[
        ("API_DOCS_ENABLED", "true"),
        ("SWAGGER_UI_ENABLED", "true"),
    ])
    .await;

    let docs_res = send_request(
        harness.app(),
        Method::GET,
        "/v3/api-docs",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(docs_res.status, StatusCode::OK);

    let swagger_redirect = send_request(
        harness.app(),
        Method::GET,
        "/swagger-ui",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(swagger_redirect.status, StatusCode::SEE_OTHER);
    assert_eq!(
        swagger_redirect
            .headers
            .get("location")
            .and_then(|v| v.to_str().ok()),
        Some("/swagger-ui/")
    );

    let swagger_html = send_request(
        harness.app(),
        Method::GET,
        "/swagger-ui/index.html",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(swagger_html.status, StatusCode::OK);
    assert!(swagger_html.text().contains("swagger-ui"));

    let swagger_init = send_request(
        harness.app(),
        Method::GET,
        "/swagger-ui/swagger-initializer.js",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(swagger_init.status, StatusCode::OK);
    let init_js = swagger_init.text();
    assert!(init_js.contains("SwaggerUIBundle"));
    assert!(init_js.contains("/v3/api-docs/openapi.json"));

    let swagger_spec_res = send_request(
        harness.app(),
        Method::GET,
        "/v3/api-docs/openapi.json",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(swagger_spec_res.status, StatusCode::OK);
    assert_eq!(swagger_spec_res.json(), docs_res.json());
}

#[tokio::test]
async fn openapi_and_swagger_return_404_when_disabled() {
    let harness = TestAppHarness::start().await;
    let tmp = TempDir::new().expect("temp");
    let config = build_test_config(
        &common::test_db_url(),
        tmp.path(),
        &[
            ("API_DOCS_ENABLED", "false"),
            ("SWAGGER_UI_ENABLED", "false"),
        ],
    );
    let gw = Arc::new(ConfigurableStaticGateway {
        enabled: true,
        chain_id: 31337,
        chain_name: "Anvil Local".to_string(),
        contract_address: common::DEFAULT_CONTRACT.to_string(),
        deployment_block: 0,
        confirmations_required: 1,
        sync_batch_size: 100,
    });
    let comps = safedeal_api::assemble_application(&config, harness.pool.clone(), gw)
        .expect("assemble disabled docs");

    let docs_res = send_request(
        comps.router.clone(),
        Method::GET,
        "/v3/api-docs",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(docs_res.status, StatusCode::NOT_FOUND);

    let ui_root_res = send_request(
        comps.router.clone(),
        Method::GET,
        "/swagger-ui",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(ui_root_res.status, StatusCode::NOT_FOUND);

    let ui_res = send_request(
        comps.router,
        Method::GET,
        "/swagger-ui/index.html",
        &[],
        None,
        None,
        None,
    )
    .await;
    assert_eq!(ui_res.status, StatusCode::NOT_FOUND);
}
