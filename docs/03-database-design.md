# Database Design & Indexing (`V1__initial_schema.sql`)

## 1. Migration & Validation Discipline

SafeDeal uses **PostgreSQL 16** with **SQLx** schema migrations (`backend/migrations/*.sql`, applied at startup via `sqlx::migrate!` and tracked in `_sqlx_migrations`). There is no ORM auto-DDL; any schema evolution requires a new forward SQL migration file.

Integration tests run against a real PostgreSQL database (`SAFEDEAL_TEST_DB_URL` / `TEST_DATABASE_URL`, default `postgres://safedeal:safedeal@127.0.0.1:5432/safedeal_test`), applying the identical migrations.

## 2. Relational Schema Inventory (11 Tables)

| Table | Role | Keys, Uniqueness & Integrity Constraints |
|---|---|---|
| `users` | Registered wallet accounts | `PK id`, `wallet_address VARCHAR(42) UNIQUE` |
| `auth_nonces` | Single-use EIP-4361 login challenges | `PK id`, `nonce VARCHAR(64) UNIQUE`, `idx_auth_nonces_wallet_expires (wallet_address, expires_at)`, atomic single-use `consumed_at` |
| `deals` | Off-chain projection of `SafeDealEscrow` trades | `PK id`, `trade_id VARCHAR(66) UNIQUE`, `create_tx_hash VARCHAR(66) UNIQUE`, `chk_deals_status` (9 lifecycle states), `chk_deals_distinct_roles (seller_address <> arbiter_address)`, indexes on `seller_address`, `buyer_address`, `arbiter_address`, `status` |
| `deal_terms` | Deliverable terms & canonical RFC 8785 hash commitment | `PK id`, `deal_id UNIQUE FK -> deals(id) ON DELETE CASCADE`, stores `title`, `description`, `terms_text`, `canonical_json`, `terms_hash`, `schema_version` |
| `deal_events` | User-visible chronological escrow event log | `PK id`, `uq_deal_events_tx_log UNIQUE (tx_hash, log_index)`, `idx_deal_events_trade_id` |
| `chain_events` | Immutable deduplicated store of decoded EVM logs | `PK id`, `CONSTRAINT uq_chain_events_tx_log UNIQUE (tx_hash, log_index)`, indexes on `trade_id`, `block_number` |
| `blockchain_transactions` | Recorded chain transactions & confirmations | `PK id`, `tx_hash VARCHAR(66) UNIQUE`, `idx_blockchain_tx_trade_id` |
| `disputes` | Open/resolved disputes associated with a deal | `PK id`, `trade_id UNIQUE`, `resolve_tx_hash UNIQUE`, `chk_disputes_status IN ('OPEN', 'RESOLVED')`, `idx_disputes_trade_id` |
| `dispute_evidence` | Private evidence attachments metadata | `PK id`, `dispute_id FK -> disputes(id) ON DELETE CASCADE`, stores `sha256_hex`, `storage_key` (UUID filename), `mime_type`, `size_bytes` |
| `audit_logs` | Security & state mutation trace logs | `PK id`, `idx_audit_logs_resource (resource_type, resource_id)`, stores `correlation_id` |
| `chain_sync_state` | Indexer cursor row (`id = 1`) | `PK id INT`, tracks active `(chain_id, contract_address)` and `last_synced_block` |

## 3. Financial Precision & Role Consistency

- Native AVAX values (`amount_wei`, `buyer_award_wei`, `seller_award_wei`) are stored as `VARCHAR(78)` base-10 integer strings to support full Solidity `uint256` precision without float rounding or `BIGINT` 64-bit overflow.
- All Ethereum addresses (`seller_address`, `buyer_address`, `arbiter_address`, `wallet_address`, `actor_address`) and 32-byte hashes (`trade_id`, `terms_hash`, `tx_hash`) are validated by `EthFormatValidator` and normalized lowercase prior to persistence.

## 4. Deduplication & Crash Recovery Guarantees

- **Log-level idempotency**: `chain_events` enforces `UNIQUE (tx_hash, log_index)` via PostgreSQL constraint (`recordIfAbsent`), and `deal_events` mirrors `UNIQUE INDEX uq_deal_events_tx_log (tx_hash, log_index)` via `saveIfAbsent`.
- **Re-scan safety**: If the backend crashes or restarts after binding a transaction manually (`POST /sync`) or while overlapping confirmation ranges are polled by `BlockchainEventIndexerService`, duplicate log events are harmlessly ignored without double-applying state transitions.
- **Cursor switch protection**: If `(chain_id, contract_address)` configuration changes between restarts, `BlockchainEventIndexerService` automatically resets `chain_sync_state` cursor (`id = 1`) to `max(0, ESCROW_DEPLOYMENT_BLOCK - 1)`.

## 5. Health Check Query Probe

[`PgDatabaseReadinessAdapter`](../backend/crates/infrastructure/src/persistence/readiness.rs) backs `GET /api/v1/health/ready` using a bounded-timeout SQLx query (`SELECT 1`, `2s` Tokio timeout) directly against the active `PgPool`.
