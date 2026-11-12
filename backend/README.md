# SafeDeal Backend (Rust / Axum / Tokio / SQLx / Alloy)

High-performance async non-custodial escrow coordination API, SIWE session authenticator, and resumable Avalanche event indexer.

## Workspace Architecture (`backend/`)

Strict Clean Architecture enforced automatically via Cargo crate DAG and `tests/architecture_dag.rs` (plus `#![deny(unsafe_code)]` and `#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]`):

- `crates/shared/` — domain error taxonomy, constant-time/RFC3339 time formatting, correlation IDs, Ethereum hex/wei validators (`alloy_primitives::U256`).
- `crates/domain/` — pure Rust entities, `DealStatus` state transitions + reconciliation guards, RFC 8785 canonical terms hasher, and repository/gateway port traits (zero DB, HTTP, or RPC dependencies).
- `crates/application/` — use cases (`siwe`, `deal`, `dispute`, `arbitration`, `indexer`). External Alloy RPC calls always execute outside SQLx DB transactions.
- `crates/infrastructure/` — `sqlx` PostgreSQL persistence & embedded migrations (`migrations/`), `alloy` RPC gateway & `sol!` ABI codec, HS256 JWT / HttpOnly cookie + Double-Submit CSRF + peer-IP auth rate limiting middleware, local magic-byte evidence storage adapter, fail-fast config loader.
- `crates/presentation/` — `axum` REST routers under `/api/v1/**` + probe compatibility (`/actuator/health*`), DTO validation, unified `ApiErrorPayload`, and `utoipa` OpenAPI (`/v3/api-docs`, `/swagger-ui`).
- `src/main.rs` — production entrypoint (`tokio` runtime, structured JSON/compact tracing, background blockchain indexer loop, graceful `SIGINT`/`SIGTERM` shutdown).

## Verification & Execution

```bash
# Format, clippy lint, unit/DAG/OpenAPI/Wiremock/PG16/live-Anvil tests, and release build
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
SAFEDEAL_TEST_DB_URL=postgres://safedeal:safedeal@127.0.0.1:5432/safedeal_test cargo test --workspace -- --test-threads=1
cargo build --release --bin safedeal-api

# Run locally (requires PostgreSQL + RPC configured via backend/.env)
set -a && source .env && set +a
cargo run --bin safedeal-api
```
