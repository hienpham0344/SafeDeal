use std::sync::Arc;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use safedeal_application::arbitration::ArbitrationUseCase;
use safedeal_application::auth::{SessionCookiePort, SiweAuthService, SiweSettings};
use safedeal_application::deals::{
    BindDealTransactionUseCase, CreateDealDraftUseCase, QueryDealsUseCase, SyncDealUseCase,
};
use safedeal_application::disputes::DisputeUseCase;
use safedeal_domain::ports::{BlockchainGateway, DatabaseReadinessPort, EvidenceStoragePort};
use tower_http::limit::RequestBodyLimitLayer;
use utoipa_swagger_ui::SwaggerUi;

use crate::error::{method_not_allowed_handler, not_found_handler, ApiError};
use crate::handlers::{arbitration, auth, deals, disputes, health};
use crate::openapi::openapi_json_value;

#[derive(Clone)]
pub struct AppState {
    pub create_deal_draft: Arc<CreateDealDraftUseCase>,
    pub bind_deal_transaction: Arc<BindDealTransactionUseCase>,
    pub sync_deal: Arc<SyncDealUseCase>,
    pub query_deals: Arc<QueryDealsUseCase>,
    pub siwe_auth: Arc<SiweAuthService>,
    pub session_cookies: Arc<dyn SessionCookiePort>,
    pub dispute_use_case: Arc<DisputeUseCase>,
    pub arbitration_use_case: Arc<ArbitrationUseCase>,
    pub blockchain_gateway: Arc<dyn BlockchainGateway>,
    pub database_readiness: Arc<dyn DatabaseReadinessPort>,
    pub evidence_storage: Arc<dyn EvidenceStoragePort>,
    pub siwe_settings: SiweSettings,
    pub evidence_max_bytes: usize,
    pub evidence_max_request_bytes: usize,
    pub api_docs_enabled: bool,
    pub swagger_ui_enabled: bool,
}

pub fn build_api_router(state: AppState) -> Router {
    let evidence_upload_route: axum::routing::MethodRouter<AppState> =
        post(disputes::upload_evidence)
            .layer::<_, std::convert::Infallible>(DefaultBodyLimit::disable())
            .layer(RequestBodyLimitLayer::new(state.evidence_max_request_bytes))
            .layer(middleware::from_fn(map_payload_too_large_to_json));

    let mut router = Router::new()
        .route("/api/v1/health", get(health::health))
        .route("/api/v1/health/ready", get(health::ready))
        .route("/actuator/health", get(health::actuator_health))
        .route(
            "/actuator/health/readiness",
            get(health::actuator_readiness),
        )
        .route("/actuator/health/liveness", get(health::actuator_liveness))
        .route("/actuator/info", get(health::actuator_info))
        .route("/api/v1/auth/nonce", post(auth::issue_nonce))
        .route("/api/v1/auth/verify", post(auth::verify))
        .route("/api/v1/auth/me", get(auth::current_session))
        .route("/api/v1/auth/logout", post(auth::logout))
        .route("/api/v1/deals/drafts", post(deals::create_draft))
        .route("/api/v1/deals", get(deals::list_deals))
        .route("/api/v1/deals/{tradeId}", get(deals::get_deal))
        .route(
            "/api/v1/deals/{tradeId}/bind-tx",
            post(deals::bind_transaction),
        )
        .route("/api/v1/deals/{tradeId}/sync", post(deals::sync_deal))
        .route("/api/v1/deals/{tradeId}/history", get(deals::get_history))
        .route(
            "/api/v1/deals/{tradeId}/disputes",
            post(disputes::open_dispute),
        )
        .route("/api/v1/disputes/{disputeId}", get(disputes::get_dispute))
        .route(
            "/api/v1/disputes/{disputeId}/evidence",
            get(disputes::list_evidence).merge(evidence_upload_route),
        )
        .route(
            "/api/v1/disputes/{disputeId}/evidence/{evidenceId}/download",
            get(disputes::download_evidence),
        )
        .route(
            "/api/v1/arbitration/disputes",
            get(arbitration::list_assigned_disputes),
        )
        .route(
            "/api/v1/arbitration/disputes/{disputeId}/resolution",
            post(arbitration::record_resolution),
        );

    if state.api_docs_enabled {
        router = router.route("/v3/api-docs", get(|| async { Json(openapi_json_value()) }));
    }

    if state.swagger_ui_enabled {
        router = router.merge(
            SwaggerUi::new("/swagger-ui")
                .external_url_unchecked("/v3/api-docs/openapi.json", openapi_json_value()),
        );
    }

    router
        .method_not_allowed_fallback(method_not_allowed_handler)
        .fallback(not_found_handler)
        .with_state(state)
}

async fn map_payload_too_large_to_json(req: Request<Body>, next: Next) -> Response {
    let response = next.run(req).await;
    if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
        let is_json = response
            .headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| ct.contains("application/json"));
        if !is_json {
            return ApiError::file_too_large().into_response();
        }
    }
    response
}
