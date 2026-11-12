#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
#![deny(unsafe_code)]

pub mod dto;
pub mod error;
pub mod extractors;
pub mod handlers;
pub mod mapper;
pub mod openapi;
pub mod router;

pub use openapi::ApiDoc;
pub use router::{build_api_router, AppState};
