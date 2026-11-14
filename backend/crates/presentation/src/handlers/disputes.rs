use axum::body::Body;
use axum::extract::multipart::{MultipartError, MultipartRejection};
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use bytes::Bytes;
use safedeal_shared::DomainError;
use serde::Deserialize;
use tokio_util::io::ReaderStream;
use utoipa::ToSchema;

use safedeal_application::disputes::UploadEvidenceCommand;

use crate::dto::{DisputeDetailResponse, DisputeEvidenceResponse, OpenDisputeRequest};
use crate::error::{parse_path_i64, ApiError};
use crate::extractors::{CurrentPrincipal, ValidatedJson};
use crate::mapper::{to_dispute_detail, to_evidence_response};
use crate::router::AppState;

#[derive(Debug, Deserialize, Default)]
pub struct UploadEvidenceQuery {
    pub title: Option<String>,
    pub notes: Option<String>,
}

#[derive(ToSchema)]
#[allow(dead_code)]
pub struct EvidenceUploadFormSchema {
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
}

#[utoipa::path(
    post,
    path = "/api/v1/deals/{tradeId}/disputes",
    tag = "dispute-controller",
    operation_id = "openDispute",
    params(
        ("tradeId" = String, Path, description = "")
    ),
    request_body(content = OpenDisputeRequest),
    responses(
        (status = 201, description = "Created", body = DisputeDetailResponse, content_type = "*/*")
    )
)]
pub async fn open_dispute(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(trade_id): Path<String>,
    ValidatedJson(request): ValidatedJson<OpenDisputeRequest>,
) -> Result<(StatusCode, Json<DisputeDetailResponse>), ApiError> {
    let created = state
        .dispute_use_case
        .open_dispute(
            &trade_id,
            &principal.address,
            request.reason.as_deref().unwrap_or(""),
            request.summary.as_deref().unwrap_or(""),
            request.tx_hash.as_deref(),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(to_dispute_detail(created))))
}

#[utoipa::path(
    get,
    path = "/api/v1/disputes/{disputeId}",
    tag = "dispute-controller",
    operation_id = "getDispute",
    params(
        ("disputeId" = i64, Path, description = "")
    ),
    responses(
        (status = 200, description = "OK", body = DisputeDetailResponse, content_type = "*/*")
    )
)]
pub async fn get_dispute(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(raw_dispute_id): Path<String>,
) -> Result<Json<DisputeDetailResponse>, ApiError> {
    let dispute_id = parse_path_i64(&raw_dispute_id, "disputeId")?;
    let res = state
        .dispute_use_case
        .get_dispute(dispute_id, &principal.address)
        .await?;
    Ok(Json(to_dispute_detail(res)))
}

#[utoipa::path(
    get,
    path = "/api/v1/disputes/{disputeId}/evidence",
    tag = "dispute-controller",
    operation_id = "listEvidence",
    params(
        ("disputeId" = i64, Path, description = "")
    ),
    responses(
        (status = 200, description = "OK", body = Vec<DisputeEvidenceResponse>, content_type = "*/*")
    )
)]
pub async fn list_evidence(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(raw_dispute_id): Path<String>,
) -> Result<Json<Vec<DisputeEvidenceResponse>>, ApiError> {
    let dispute_id = parse_path_i64(&raw_dispute_id, "disputeId")?;
    let items = state
        .dispute_use_case
        .list_evidence(dispute_id, &principal.address)
        .await?;
    Ok(Json(items.into_iter().map(to_evidence_response).collect()))
}

#[utoipa::path(
    post,
    path = "/api/v1/disputes/{disputeId}/evidence",
    tag = "dispute-controller",
    operation_id = "uploadEvidence",
    params(
        ("disputeId" = i64, Path, description = ""),
        ("title" = String, Query, description = ""),
        ("notes" = String, Query, description = "")
    ),
    request_body(content = EvidenceUploadFormSchema, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "Created", body = DisputeEvidenceResponse, content_type = "*/*")
    )
)]
pub async fn upload_evidence(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path(raw_dispute_id): Path<String>,
    Query(query): Query<UploadEvidenceQuery>,
    multipart_result: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<DisputeEvidenceResponse>), ApiError> {
    let dispute_id = parse_path_i64(&raw_dispute_id, "disputeId")?;
    let mut multipart = multipart_result.map_err(map_multipart_rejection)?;

    let mut form_title: Option<String> = None;
    let mut form_notes: Option<String> = None;
    let mut saw_file = false;
    let mut file_name: Option<String> = None;
    let mut content_type: Option<String> = None;
    let mut file_bytes: Option<Bytes> = None;

    while let Some(field) = multipart.next_field().await.map_err(map_multipart_error)? {
        match field.name() {
            Some("title") => {
                form_title = Some(field.text().await.map_err(map_multipart_error)?);
            }
            Some("notes") => {
                form_notes = Some(field.text().await.map_err(map_multipart_error)?);
            }
            Some("file") => {
                saw_file = true;
                file_name = field.file_name().map(str::to_string);
                content_type = field.content_type().map(str::to_string);
                file_bytes = Some(field.bytes().await.map_err(map_multipart_error)?);
            }
            _ => {}
        }
    }

    let title = form_title
        .or(query.title)
        .ok_or_else(|| ApiError::missing_parameter("title"))?;
    let notes = form_notes
        .or(query.notes)
        .ok_or_else(|| ApiError::missing_parameter("notes"))?;

    if saw_file && file_bytes.as_ref().is_some_and(|b| b.is_empty()) {
        return Err(ApiError::from(DomainError::validation(
            "Attached evidence file cannot be empty.",
        )));
    }
    if file_bytes
        .as_ref()
        .is_some_and(|b| b.len() > state.evidence_max_bytes)
    {
        return Err(ApiError::file_too_large());
    }

    let saved = state
        .dispute_use_case
        .upload_evidence(UploadEvidenceCommand {
            dispute_id,
            caller_address: &principal.address,
            title: &title,
            notes: &notes,
            original_filename: file_name.as_deref(),
            declared_mime_type: content_type.as_deref(),
            file_bytes: file_bytes.as_deref(),
        })
        .await?;
    Ok((StatusCode::CREATED, Json(to_evidence_response(saved))))
}

#[utoipa::path(
    get,
    path = "/api/v1/disputes/{disputeId}/evidence/{evidenceId}/download",
    tag = "dispute-controller",
    operation_id = "downloadEvidence",
    params(
        ("disputeId" = i64, Path, description = ""),
        ("evidenceId" = i64, Path, description = "")
    ),
    responses(
        (status = 200, description = "OK", content_type = "*/*", body = String)
    )
)]
pub async fn download_evidence(
    State(state): State<AppState>,
    CurrentPrincipal(principal): CurrentPrincipal,
    Path((raw_dispute_id, raw_evidence_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let dispute_id = parse_path_i64(&raw_dispute_id, "disputeId")?;
    let evidence_id = parse_path_i64(&raw_evidence_id, "evidenceId")?;

    let target = state
        .dispute_use_case
        .prepare_evidence_download(dispute_id, evidence_id, &principal.address)
        .await?;

    let file = tokio::fs::File::open(&target.path)
        .await
        .map_err(|_| DomainError::not_found("Evidence file missing from storage."))?;
    let meta = file
        .metadata()
        .await
        .map_err(|e| DomainError::internal(format!("Failed to stat evidence file: {e}")))?;

    let filename = target
        .metadata
        .file_name
        .as_deref()
        .unwrap_or("evidence.bin");
    let mime = target
        .metadata
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    if let Ok(len_val) = HeaderValue::from_str(&meta.len().to_string()) {
        headers.insert(header::CONTENT_LENGTH, len_val);
    }
    let disposition = format!("attachment; filename=\"{filename}\"");
    if let Ok(disp_val) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, disp_val);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    let stream = ReaderStream::new(file);
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = StatusCode::OK;
    *response.headers_mut() = headers;
    Ok(response)
}

fn map_multipart_rejection(rej: MultipartRejection) -> ApiError {
    if rej.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::file_too_large()
    } else {
        ApiError::invalid_multipart()
    }
}

fn map_multipart_error(err: MultipartError) -> ApiError {
    if err.status() == StatusCode::PAYLOAD_TOO_LARGE
        || err
            .body_text()
            .to_ascii_lowercase()
            .contains("length limit")
    {
        ApiError::file_too_large()
    } else {
        ApiError::invalid_multipart()
    }
}
