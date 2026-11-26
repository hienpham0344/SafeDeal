use axum::extract::{Extension, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::Json;
use safedeal_domain::auth::{AuthenticatedPrincipal, VerifiedSessionToken};
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

    let (token, cookie_headers) = state.session_cookies.issue_session(&principal)?;
    let mut headers = HeaderMap::new();
    for cookie_header in cookie_headers {
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
            token: Some(token),
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
        token: None,
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
pub async fn logout(
    State(state): State<AppState>,
    authenticated: Option<Extension<AuthenticatedPrincipal>>,
    request_headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap), ApiError> {
    let mut sessions_to_revoke: Vec<VerifiedSessionToken> = Vec::new();

    if let Some(bearer_tok) = extract_bearer_token(&request_headers) {
        if let Some(verified) = state.session_cookies.inspect_token(bearer_tok) {
            sessions_to_revoke.push(verified);
        }
    }

    // If middleware authenticated a session (e.g. via cookie after passing double-submit CSRF),
    // also revoke the cookie token when present and not already queued by jti.
    if authenticated.is_some() {
        if let Some(cookie_tok) = extract_cookie_from_headers(
            &request_headers,
            state.session_cookies.session_cookie_name(),
        ) {
            if let Some(verified) = state.session_cookies.inspect_token(&cookie_tok) {
                let already_queued = !verified.jti.is_empty()
                    && sessions_to_revoke.iter().any(|s| s.jti == verified.jti);
                if !already_queued {
                    sessions_to_revoke.push(verified);
                }
            }
        }
    }

    for session in sessions_to_revoke {
        state.siwe_auth.revoke_session(&session).await?;
        state
            .session_cookies
            .revoke_token_in_memory(&session.jti, session.expires_at);
    }

    let mut headers = HeaderMap::new();
    for cookie_header in state.session_cookies.clear_cookie_headers() {
        let hv = HeaderValue::from_str(&cookie_header)
            .map_err(|e| DomainError::internal(format!("Failed to build cookie header: {e}")))?;
        headers.append(header::SET_COOKIE, hv);
    }
    Ok((StatusCode::NO_CONTENT, headers))
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let bearer = raw.strip_prefix("Bearer ")?.trim();
    if bearer.is_empty() {
        None
    } else {
        Some(bearer)
    }
}

fn extract_cookie_from_headers(headers: &HeaderMap, target_name: &str) -> Option<String> {
    for hv in headers.get_all(header::COOKIE) {
        let Ok(raw) = hv.to_str() else {
            continue;
        };
        for pair in raw.split(';') {
            let trimmed = pair.trim();
            if let Some((name, val)) = trimmed.split_once('=') {
                if name.trim() == target_name {
                    let v = val.trim();
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }
    }
    None
}
