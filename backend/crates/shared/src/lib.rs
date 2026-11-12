#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
#![deny(unsafe_code)]

pub mod correlation;
pub mod error;
pub mod time;
pub mod validation;

pub use correlation::{
    current_correlation_id, header_name as correlation_header_name, is_valid_correlation_id,
    with_correlation_id, CorrelationIdContext, HEADER_NAME as CORRELATION_ID_HEADER,
};
pub use error::{DomainError, FieldViolation};
pub use time::format_iso_utc;
pub use validation::{EthFormatValidator, ZERO_ADDRESS, ZERO_BYTES32};
