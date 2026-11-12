use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::dto::{HealthStatusResponse, ReadinessStatusResponse};
use crate::router::AppState;

#[derive(Serialize)]
pub struct ActuatorStatusResponse {
    pub status: &'static str,
}

#[derive(Serialize)]
pub struct ActuatorInfoApp {
    pub name: &'static str,
}

#[derive(Serialize)]
pub struct ActuatorInfoResponse {
    pub app: ActuatorInfoApp,
}

#[utoipa::path(
    get,
    path = "/api/v1/health",
    tag = "health-controller",
    operation_id = "health",
    responses(
        (status = 200, description = "OK", body = HealthStatusResponse, content_type = "*/*")
    )
)]
pub async fn health(State(state): State<AppState>) -> Json<HealthStatusResponse> {
    let configured = is_contract_configured(state.blockchain_gateway.contract_address());
    Json(HealthStatusResponse {
        status: "UP".to_string(),
        service: "safedeal-api".to_string(),
        chain_id: state.blockchain_gateway.chain_id(),
        chain_name: state.blockchain_gateway.chain_name().to_string(),
        escrow_contract_configured: configured,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/health/ready",
    tag = "health-controller",
    operation_id = "ready",
    responses(
        (status = 200, description = "OK", body = ReadinessStatusResponse, content_type = "*/*")
    )
)]
pub async fn ready(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadinessStatusResponse>) {
    let database_connected = state.database_readiness.is_database_connected().await;
    let evidence_storage_ready = state.evidence_storage.is_storage_ready();
    let siwe_configured = !state.siwe_settings.siwe_domain.trim().is_empty()
        && !state.siwe_settings.siwe_uri.trim().is_empty()
        && state.siwe_settings.chain_id > 0;
    let blockchain_enabled = state.blockchain_gateway.is_enabled();
    let escrow_contract_configured =
        is_contract_configured(state.blockchain_gateway.contract_address());

    let is_ready = database_connected
        && evidence_storage_ready
        && siwe_configured
        && (!blockchain_enabled || escrow_contract_configured);

    let payload = ReadinessStatusResponse {
        status: if is_ready { "READY" } else { "NOT_READY" }.to_string(),
        service: "safedeal-api".to_string(),
        database_connected,
        evidence_storage_ready,
        siwe_configured,
        blockchain_enabled,
        escrow_contract_configured,
        chain_id: state.blockchain_gateway.chain_id(),
    };
    let status = if is_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(payload))
}

pub async fn actuator_health(
    State(state): State<AppState>,
) -> (StatusCode, Json<ActuatorStatusResponse>) {
    let db_ok = state.database_readiness.is_database_connected().await;
    let storage_ok = state.evidence_storage.is_storage_ready();
    if db_ok && storage_ok {
        (StatusCode::OK, Json(ActuatorStatusResponse { status: "UP" }))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ActuatorStatusResponse { status: "DOWN" }),
        )
    }
}

pub async fn actuator_readiness(
    State(state): State<AppState>,
) -> (StatusCode, Json<ActuatorStatusResponse>) {
    if state.database_readiness.is_database_connected().await {
        (StatusCode::OK, Json(ActuatorStatusResponse { status: "UP" }))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ActuatorStatusResponse {
                status: "OUT_OF_SERVICE",
            }),
        )
    }
}

pub async fn actuator_liveness() -> Json<ActuatorStatusResponse> {
    Json(ActuatorStatusResponse { status: "UP" })
}

pub async fn actuator_info() -> Json<ActuatorInfoResponse> {
    Json(ActuatorInfoResponse {
        app: ActuatorInfoApp {
            name: "safedeal-api",
        },
    })
}

fn is_contract_configured(address: &str) -> bool {
    let trimmed = address.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case(safedeal_shared::ZERO_ADDRESS)
}
