use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use safedeal_application::deals::CreateDealCommand;
use safedeal_domain::deal::Deal;
use serde::Deserialize;

use crate::dto::{
    BindTxRequest, CreateDraftRequest, CreateDraftResponse, DealDetailResponse, DealHistoryResponse,
    PaginatedDealSummaryResponse, SyncRequest,
};
use crate::error::ApiError;
use crate::extractors::{CurrentPrincipal, OptionalJsonBody, ValidatedJson};
use crate::mapper::{
    to_detail, to_event_response, to_summary, to_tx_response,
};
use crate::router::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct ListDealsQueryParams {
    pub role: Option<String>,
    pub status: Option<String>,
    pub page: Option<String>,
    pub size: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/deals/drafts",
    tag = "deal-controller",
    operation_id = "createDraft",
    request_body(content = CreateDraftRequest),
    responses(
        (status = 201, description = "Created", body = CreateDraftResponse, content_type = "*/*")
    )
)]
pub async fn create_draft(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    ValidatedJson(request): ValidatedJson<CreateDraftRequest>,
) -> Result<(StatusCode, Json<CreateDraftResponse>), ApiError> {
    let created = state
        .create_deal_draft
        .execute(CreateDealCommand {
            seller_address: principal.address,
            buyer_address: request.buyer_address,
            arbiter_address: request.arbiter_address.unwrap_or_default(),
            amount_wei: request.amount_wei.unwrap_or_default(),
            funding_deadline_epoch_seconds: request.funding_deadline_epoch_seconds.unwrap_or(0),
            delivery_deadline_epoch_seconds: request.delivery_deadline_epoch_seconds.unwrap_or(0),
            inspection_window_seconds: request.inspection_window_seconds.unwrap_or(0),
            title: request.title.unwrap_or_default(),
            description: request.description.unwrap_or_default(),
            terms: request.terms.unwrap_or_default(),
        })
        .await?;

    let trade_id = created.trade_id.clone();
    let terms_hash = created.terms_hash.clone();
    let canonical_terms_json = created.canonical_terms_json.clone();
    let chain_id = created.chain_id;
    let contract_address = created.contract_address.clone();
    let detail = to_detail(&created, None);

    Ok((
        StatusCode::CREATED,
        Json(CreateDraftResponse {
            deal: detail,
            trade_id,
            terms_hash,
            canonical_terms_json,
            chain_id,
            contract_address,
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/deals/{tradeId}/bind-tx",
    tag = "deal-controller",
    operation_id = "bindTransaction",
    params(
        ("tradeId" = String, Path, description = "")
    ),
    request_body(content = BindTxRequest),
    responses(
        (status = 200, description = "OK", body = DealDetailResponse, content_type = "*/*")
    )
)]
pub async fn bind_transaction(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(trade_id): Path<String>,
    ValidatedJson(request): ValidatedJson<BindTxRequest>,
) -> Result<Json<DealDetailResponse>, ApiError> {
    let updated = state
        .bind_deal_transaction
        .execute(
            &trade_id,
            request.tx_hash.as_deref().unwrap_or(""),
            &principal.address,
        )
        .await?;
    let dispute_id = state.query_deals.find_dispute_id(&updated.trade_id).await?;
    Ok(Json(to_detail(&updated, dispute_id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/deals/{tradeId}/sync",
    tag = "deal-controller",
    operation_id = "syncDeal",
    params(
        ("tradeId" = String, Path, description = "")
    ),
    request_body(content = Option<SyncRequest>),
    responses(
        (status = 200, description = "OK", body = DealDetailResponse, content_type = "*/*")
    )
)]
pub async fn sync_deal(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(trade_id): Path<String>,
    OptionalJsonBody(request): OptionalJsonBody<SyncRequest>,
) -> Result<Json<DealDetailResponse>, ApiError> {
    let tx_hash = request.as_ref().and_then(|r| r.tx_hash.as_deref());
    let updated = state
        .sync_deal
        .execute(&trade_id, tx_hash, &principal.address)
        .await?;
    let dispute_id = state.query_deals.find_dispute_id(&updated.trade_id).await?;
    Ok(Json(to_detail(&updated, dispute_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/deals",
    tag = "deal-controller",
    operation_id = "listDeals",
    params(
        ("role" = Option<String>, Query, description = ""),
        ("status" = Option<String>, Query, description = ""),
        ("page" = Option<i32>, Query, description = ""),
        ("size" = Option<i32>, Query, description = "")
    ),
    responses(
        (status = 200, description = "OK", body = PaginatedDealSummaryResponse, content_type = "*/*")
    )
)]
pub async fn list_deals(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Query(query): Query<ListDealsQueryParams>,
) -> Result<Json<PaginatedDealSummaryResponse>, ApiError> {
    let role = query.role.as_deref().unwrap_or("all");
    let page = match query.page.as_deref() {
        Some(raw) => raw
            .trim()
            .parse::<i32>()
            .map_err(|_| ApiError::invalid_parameter("page"))?,
        None => 0,
    };
    let size = match query.size.as_deref() {
        Some(raw) => raw
            .trim()
            .parse::<i32>()
            .map_err(|_| ApiError::invalid_parameter("size"))?,
        None => 20,
    };

    let slice = state
        .query_deals
        .list_user_deals(
            &principal.address,
            Some(role),
            query.status.as_deref(),
            page,
            size,
        )
        .await?;

    let trade_ids: Vec<String> = slice.items.iter().map(|d: &Deal| d.trade_id.clone()).collect();
    let dispute_ids = state.query_deals.find_dispute_ids(&trade_ids).await?;
    let items = slice
        .items
        .iter()
        .map(|d| {
            let did = dispute_ids.get(&d.trade_id.to_ascii_lowercase()).copied();
            to_summary(d, did)
        })
        .collect();

    Ok(Json(PaginatedDealSummaryResponse {
        items,
        page: slice.page,
        size: slice.size,
        total_items: slice.total_items,
        total_pages: slice.total_pages,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/deals/{tradeId}",
    tag = "deal-controller",
    operation_id = "getDeal",
    params(
        ("tradeId" = String, Path, description = "")
    ),
    responses(
        (status = 200, description = "OK", body = DealDetailResponse, content_type = "*/*")
    )
)]
pub async fn get_deal(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(trade_id): Path<String>,
) -> Result<Json<DealDetailResponse>, ApiError> {
    let res = state
        .query_deals
        .get_deal(&trade_id, &principal.address)
        .await?;
    Ok(Json(to_detail(&res.deal, res.dispute_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/deals/{tradeId}/history",
    tag = "deal-controller",
    operation_id = "getHistory",
    params(
        ("tradeId" = String, Path, description = "")
    ),
    responses(
        (status = 200, description = "OK", body = DealHistoryResponse, content_type = "*/*")
    )
)]
pub async fn get_history(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(trade_id): Path<String>,
) -> Result<Json<DealHistoryResponse>, ApiError> {
    let history = state
        .query_deals
        .get_history(&trade_id, &principal.address)
        .await?;
    Ok(Json(DealHistoryResponse {
        events: history.events.into_iter().map(to_event_response).collect(),
        transactions: history
            .transactions
            .into_iter()
            .map(to_tx_response)
            .collect(),
    }))
}
