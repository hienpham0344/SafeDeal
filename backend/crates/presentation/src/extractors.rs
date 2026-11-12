use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use bytes::Bytes;
use safedeal_domain::auth::AuthenticatedPrincipal;
use safedeal_shared::DomainError;
use serde::de::DeserializeOwned;

use crate::error::{ApiError, ApiFieldError};

/// Extracts the authenticated SIWE wallet principal injected by `session_auth_middleware`.
pub struct CurrentPrincipal(pub AuthenticatedPrincipal);

impl<S> FromRequestParts<S> for CurrentPrincipal
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthenticatedPrincipal>()
            .cloned()
            .map(Self)
            .ok_or_else(|| {
                ApiError::from(DomainError::unauthorized(
                    "Wallet authentication required.",
                ))
            })
    }
}

pub trait ValidateRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>>;
}

/// JSON body extractor that parses strictly, emits `400 MALFORMED_JSON` on invalid JSON,
/// and validates Bean Validation parity constraints (`400 REQUEST_VALIDATION_FAILED`).
pub struct ValidatedJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidatedJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned + ValidateRequest,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(|err| {
            if err.into_response().status() == StatusCode::PAYLOAD_TOO_LARGE {
                ApiError::file_too_large()
            } else {
                ApiError::malformed_json()
            }
        })?;
        if bytes.iter().all(|b| b.is_ascii_whitespace()) {
            return Err(ApiError::malformed_json());
        }
        let parsed: T = serde_json::from_slice(&bytes).map_err(|_| ApiError::malformed_json())?;
        parsed
            .validate()
            .map_err(ApiError::validation_fields)?;
        Ok(Self(parsed))
    }
}

/// Optional JSON body extractor (`POST /api/v1/deals/{tradeId}/sync` accepts empty body or JSON `{}`/`{"txHash":...}`).
pub struct OptionalJsonBody<T>(pub Option<T>);

impl<S, T> FromRequest<S> for OptionalJsonBody<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(|err| {
            if err.into_response().status() == StatusCode::PAYLOAD_TOO_LARGE {
                ApiError::file_too_large()
            } else {
                ApiError::malformed_json()
            }
        })?;
        if bytes.iter().all(|b| b.is_ascii_whitespace()) {
            return Ok(Self(None));
        }
        let parsed: T = serde_json::from_slice(&bytes).map_err(|_| ApiError::malformed_json())?;
        Ok(Self(Some(parsed)))
    }
}
