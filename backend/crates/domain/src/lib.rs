#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
#![deny(unsafe_code)]

pub mod auth;
pub mod blockchain;
pub mod canonical_terms;
pub mod deal;
pub mod dispute;
pub mod ports;
