use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use safedeal_shared::{format_iso_utc, CorrelationIdContext, DomainError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiFieldError {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorPayload {
    pub code: String,
    pub message: String,
    pub correlation_id: String,
    pub timestamp: String,
    pub field_errors: Option<Vec<ApiFieldError>>,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
    pub field_errors: Option<Vec<ApiFieldError>>,
}

impl ApiError {
    pub fn malformed_json() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "MALFORMED_JSON".to_string(),
            message: "Request body could not be parsed as valid JSON.".to_string(),
            field_errors: None,
        }
    }

    pub fn validation_fields(field_errors: Vec<ApiFieldError>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "REQUEST_VALIDATION_FAILED".to_string(),
            message: "Submitted request contains invalid fields.".to_string(),
            field_errors: Some(field_errors),
        }
    }

    pub fn invalid_parameter(param_name: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "INVALID_PARAMETER".to_string(),
            message: format!("Invalid value for parameter '{param_name}'."),
            field_errors: None,
        }
    }

    pub fn missing_parameter(param_name: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "MISSING_PARAMETER".to_string(),
            message: format!("Required request parameter or part '{param_name}' is missing."),
            field_errors: None,
        }
    }

    pub fn file_too_large() -> Self {
        Self {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            code: "FILE_TOO_LARGE".to_string(),
            message: "Uploaded evidence attachment exceeds maximum allowed size.".to_string(),
            field_errors: None,
        }
    }

    pub fn invalid_multipart() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "INVALID_MULTIPART_REQUEST".to_string(),
            message: "Malformed multipart upload request.".to_string(),
            field_errors: None,
        }
    }

    pub fn method_not_allowed(method: &Method) -> Self {
        Self {
            status: StatusCode::METHOD_NOT_ALLOWED,
            code: "METHOD_NOT_ALLOWED".to_string(),
            message: format!("HTTP method '{method}' is not supported for this endpoint."),
            field_errors: None,
        }
    }

    pub fn route_not_found(uri: &Uri) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND".to_string(),
            message: format!("No endpoint found for path '{}'.", uri.path()),
            field_errors: None,
        }
    }
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        let status = StatusCode::from_u16(err.http_status())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let code = err.error_code().to_string();
        let message = if matches!(err, DomainError::Internal(_)) {
            let cid = CorrelationIdContext::get_or_default("n/a");
            tracing::error!(correlation_id = %cid, error = %err, "Internal server error");
            format!("An unexpected internal error occurred. Reference correlationId: {cid}")
        } else {
            err.message().to_string()
        };
        let field_errors = err.field_errors().map(|errs| {
            errs.iter()
                .map(|fe| ApiFieldError {
                    field: fe.field.clone(),
                    message: fe.message.clone(),
                })
                .collect()
        });
        Self {
            status,
            code,
            message,
            field_errors,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let payload = ApiErrorPayload {
            code: self.code,
            message: self.message,
            correlation_id: CorrelationIdContext::get_or_default("n/a"),
            timestamp: format_iso_utc(Utc::now()),
            field_errors: self.field_errors,
        };
        (self.status, Json(payload)).into_response()
    }
}

pub async fn method_not_allowed_handler(method: Method) -> Response {
    ApiError::method_not_allowed(&method).into_response()
}

pub async fn not_found_handler(uri: Uri) -> Response {
    ApiError::route_not_found(&uri).into_response()
}

pub fn parse_path_i64(raw: &str, param_name: &str) -> Result<i64, ApiError> {
    raw.trim()
        .parse::<i64>()
        .map_err(|_| ApiError::invalid_parameter(param_name))
}
