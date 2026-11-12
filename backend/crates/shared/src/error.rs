use std::borrow::Cow;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldViolation {
    pub field: String,
    pub message: String,
}

impl FieldViolation {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("{message}")]
    Validation {
        code: Cow<'static, str>,
        message: String,
        field_errors: Option<Vec<FieldViolation>>,
    },

    #[error("{message}")]
    Unauthorized {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    Forbidden {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    NotFound {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    Conflict {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    PayloadTooLarge {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    RateLimited {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{message}")]
    ExternalService {
        code: Cow<'static, str>,
        message: String,
    },

    #[error("{0}")]
    Internal(String),
}

impl DomainError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation {
            code: Cow::Borrowed("VALIDATION_ERROR"),
            message: message.into(),
            field_errors: None,
        }
    }

    pub fn validation_with_code(
        code: impl Into<Cow<'static, str>>,
        message: impl Into<String>,
    ) -> Self {
        Self::Validation {
            code: code.into(),
            message: message.into(),
            field_errors: None,
        }
    }

    pub fn request_validation(field_errors: Vec<FieldViolation>) -> Self {
        Self::Validation {
            code: Cow::Borrowed("REQUEST_VALIDATION_FAILED"),
            message: "Submitted request contains invalid fields.".to_owned(),
            field_errors: Some(field_errors),
        }
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::Unauthorized {
            code: Cow::Borrowed("UNAUTHORIZED"),
            message: message.into(),
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden {
            code: Cow::Borrowed("FORBIDDEN"),
            message: message.into(),
        }
    }

    pub fn forbidden_with_code(
        code: impl Into<Cow<'static, str>>,
        message: impl Into<String>,
    ) -> Self {
        Self::Forbidden {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            code: Cow::Borrowed("NOT_FOUND"),
            message: message.into(),
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict {
            code: Cow::Borrowed("CONFLICT"),
            message: message.into(),
        }
    }

    pub fn conflict_with_code(
        code: impl Into<Cow<'static, str>>,
        message: impl Into<String>,
    ) -> Self {
        Self::Conflict {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::PayloadTooLarge {
            code: Cow::Borrowed("FILE_TOO_LARGE"),
            message: message.into(),
        }
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::RateLimited {
            code: Cow::Borrowed("RATE_LIMITED"),
            message: message.into(),
        }
    }

    pub fn external_service(message: impl Into<String>) -> Self {
        Self::ExternalService {
            code: Cow::Borrowed("BLOCKCHAIN_RPC_ERROR"),
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    pub fn error_code(&self) -> &str {
        match self {
            Self::Validation { code, .. }
            | Self::Unauthorized { code, .. }
            | Self::Forbidden { code, .. }
            | Self::NotFound { code, .. }
            | Self::Conflict { code, .. }
            | Self::PayloadTooLarge { code, .. }
            | Self::RateLimited { code, .. }
            | Self::ExternalService { code, .. } => code.as_ref(),
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }

    pub fn http_status(&self) -> u16 {
        match self {
            Self::Validation { .. } => 400,
            Self::Unauthorized { .. } => 401,
            Self::Forbidden { .. } => 403,
            Self::NotFound { .. } => 404,
            Self::Conflict { .. } => 409,
            Self::PayloadTooLarge { .. } => 413,
            Self::RateLimited { .. } => 429,
            Self::ExternalService { .. } => 502,
            Self::Internal(_) => 500,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::Validation { message, .. }
            | Self::Unauthorized { message, .. }
            | Self::Forbidden { message, .. }
            | Self::NotFound { message, .. }
            | Self::Conflict { message, .. }
            | Self::PayloadTooLarge { message, .. }
            | Self::RateLimited { message, .. }
            | Self::ExternalService { message, .. } => message,
            Self::Internal(_) => "An unexpected server error occurred.",
        }
    }

    pub fn field_errors(&self) -> Option<&[FieldViolation]> {
        match self {
            Self::Validation { field_errors, .. } => field_errors.as_deref(),
            _ => None,
        }
    }
}
