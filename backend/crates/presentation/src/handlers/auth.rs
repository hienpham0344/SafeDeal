use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::Json;
use safedeal_shared::DomainError;

use crate::dto::{NonceRequest, NonceResponse, SessionUserResponse, VerifyRequest};
use crate::error::ApiError;
use crate::extractors::{CurrentPrincipal, ValidatedJson};
use crate::router::AppState;

#[utoipa::path(
    post,
    path = "/api/v1/auth/nonce",
    tag = "auth-controller",
    operation_id = "issueNonce",
    request_body(content = NonceRequest),
    responses(
        (status = 200, description = "OK", body = NonceResponse, content_type = "*/*")
    )
)]
pub async fn issue_nonce(
    State(state): State<AppState>,
    ValidatedJson(request): ValidatedJson<NonceRequest>,
) -> Result<Json<NonceResponse>, ApiError> {
    let address = request.address.as_deref().unwrap_or("");
    let chain_id = request.chain_id.unwrap_or(0);
    let challenge = state.siwe_auth.issue_challenge(address, chain_id).await?;
    Ok(Json(NonceResponse {
        nonce: challenge.nonce,
        domain: challenge.domain,
        uri: challenge.uri,
        chain_id: challenge.chain_id,
        issued_at: challenge.issued_at,
        expiration_time: challenge.expiration_time,
        statement: challenge.statement,
        message: challenge.message,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/verify",
    tag = "auth-controller",
    operation_id = "verify",
    request_body(content = VerifyRequest),
    responses(
        (status = 200, description = "OK", body = SessionUserResponse, content_type = "*/*")
    )
)]
pub async fn verify(
    State(state): State<AppState>,
    ValidatedJson(request): ValidatedJson<VerifyRequest>,
) -> Result<(HeaderMap, Json<SessionUserResponse>), ApiError> {
    let message = request.message.as_deref().unwrap_or("");
    let signature = request.signature.as_deref().unwrap_or("");
    let principal = state
        .siwe_auth
        .verify_and_authenticate(message, signature)
        .await?;

    let mut headers = HeaderMap::new();
    for cookie_header in state.session_cookies.session_cookie_headers(&principal)? {
        let hv = HeaderValue::from_str(&cookie_header)
            .map_err(|e| DomainError::internal(format!("Failed to build cookie header: {e}")))?;
        headers.append(header::SET_COOKIE, hv);
    }

    Ok((
        headers,
        Json(SessionUserResponse {
            address: principal.address,
            chain_id: principal.chain_id,
            authenticated_at: principal.authenticated_at,
            csrf_token: principal.csrf_token,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/me",
    tag = "auth-controller",
    operation_id = "currentSession",
    responses(
        (status = 200, description = "OK", body = SessionUserResponse, content_type = "*/*")
    )
)]
pub async fn current_session(
    CurrentPrincipal(principal): CurrentPrincipal,
) -> Json<SessionUserResponse> {
    Json(SessionUserResponse {
        address: principal.address,
        chain_id: principal.chain_id,
        authenticated_at: principal.authenticated_at,
        csrf_token: principal.csrf_token,
    })
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    tag = "auth-controller",
    operation_id = "logout",
    responses(
        (status = 204, description = "No Content")
    )
)]
pub async fn logout(State(state): State<AppState>) -> Result<(StatusCode, HeaderMap), ApiError> {
    let mut headers = HeaderMap::new();
    for cookie_header in state.session_cookies.clear_cookie_headers() {
        let hv = HeaderValue::from_str(&cookie_header)
            .map_err(|e| DomainError::internal(format!("Failed to build cookie header: {e}")))?;
        headers.append(header::SET_COOKIE, hv);
    }
    Ok((StatusCode::NO_CONTENT, headers))
}
