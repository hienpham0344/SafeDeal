use axum::extract::{Path, State};
use axum::Json;

use crate::dto::{DisputeDetailResponse, ResolveDisputeRequest};
use crate::error::{parse_path_i64, ApiError};
use crate::extractors::{CurrentPrincipal, ValidatedJson};
use crate::mapper::to_dispute_detail;
use crate::router::AppState;

#[utoipa::path(
    get,
    path = "/api/v1/arbitration/disputes",
    tag = "arbitration-controller",
    operation_id = "listAssignedDisputes",
    responses(
        (status = 200, description = "OK", body = Vec<DisputeDetailResponse>, content_type = "*/*")
    )
)]
pub async fn list_assigned_disputes(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
) -> Result<Json<Vec<DisputeDetailResponse>>, ApiError> {
    let items = state
        .arbitration_use_case
        .list_assigned_disputes(&principal.address)
        .await?;
    Ok(Json(items.into_iter().map(to_dispute_detail).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/arbitration/disputes/{disputeId}/resolution",
    tag = "arbitration-controller",
    operation_id = "recordResolution",
    params(
        ("disputeId" = i64, Path, description = "")
    ),
    request_body(content = ResolveDisputeRequest),
    responses(
        (status = 200, description = "OK", body = DisputeDetailResponse, content_type = "*/*")
    )
)]
pub async fn record_resolution(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(raw_dispute_id): Path<String>,
    ValidatedJson(request): ValidatedJson<ResolveDisputeRequest>,
) -> Result<Json<DisputeDetailResponse>, ApiError> {
    let dispute_id = parse_path_i64(&raw_dispute_id, "disputeId")?;
    let updated = state
        .arbitration_use_case
        .record_resolution(
            dispute_id,
            &principal.address,
            request.tx_hash.as_deref().unwrap_or(""),
            request.rationale.as_deref().unwrap_or(""),
        )
        .await?;
    Ok(Json(to_dispute_detail(updated)))
}
