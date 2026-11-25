# Database Design & Indexing (SQLx Migrations — 12 Tables)

## 1. Migration & Validation Discipline

SafeDeal uses **PostgreSQL 16** with **SQLx** forward schema migrations stored in [`backend/migrations/`](../backend/migrations/) (`20240101000001_initial_schema.sql` / `20260101000001_initial_schema.sql` and `20261121000002_multi_arbiter_timeout.sql` / `20260601000002_consensus_dispute_votes.sql`), applied automatically at startup via `sqlx::migrate!` and tracked in `_sqlx_migrations`. There is no ORM auto-DDL; any schema evolution requires a new forward SQL migration file.

Integration tests run against a real PostgreSQL 16 database (`SAFEDEAL_TEST_DB_URL` / `TEST_DATABASE_URL`, default `postgres://safedeal:safedeal@127.0.0.1:5432/safedeal_test`), applying the identical SQLx migrations.

## 2. Relational Schema Inventory (12 Tables)

| # | Table | Role | Keys, Uniqueness & Integrity Constraints |
|---|---|---|---|
| 1 | `users` | Registered wallet accounts | `PK id`, `wallet_address VARCHAR(42) UNIQUE`, `created_at`, `last_login_at` |
| 2 | `auth_nonces` | Single-use EIP-4361 login challenges | `PK id`, `nonce VARCHAR(64) UNIQUE`, `idx_auth_nonces_wallet_expires (wallet_address, expires_at)`, atomic single-use `consumed_at`, periodically purged by `CleanupOrphanDraftsUseCase` (`delete_expired_before`) |
| 3 | `deals` | Off-chain projection of `SafeDealEscrow` trades | `PK id`, `trade_id VARCHAR(66) UNIQUE`, `create_tx_hash VARCHAR(66) UNIQUE`, `chk_deals_status` (9 lifecycle states: `DRAFT`, `CREATED`, `FUNDED`, `DELIVERED`, `RELEASED`, `REFUNDED`, `DISPUTED`, `RESOLVED`, `CANCELLED`), `chk_deals_distinct_roles (seller_address <> arbiter_address)`, indexes on `seller_address`, `buyer_address`, `arbiter_address`, `status` |
| 4 | `deal_terms` | Deliverable terms & canonical RFC 8785 hash commitment | `PK id`, `deal_id UNIQUE FK -> deals(id) ON DELETE CASCADE`, stores `title`, `description`, `terms_text`, `canonical_json`, `terms_hash`, `schema_version` |
| 5 | `deal_events` | User-visible chronological escrow event log | `PK id`, `uq_deal_events_tx_log UNIQUE (tx_hash, log_index)`, `idx_deal_events_trade_id` |
| 6 | `chain_events` | Immutable deduplicated store of decoded EVM logs | `PK id`, `CONSTRAINT uq_chain_events_tx_log UNIQUE (tx_hash, log_index)`, indexes on `trade_id`, `block_number` |
| 7 | `blockchain_transactions` | Recorded chain transactions & confirmations | `PK id`, `tx_hash VARCHAR(66) UNIQUE`, `idx_blockchain_tx_trade_id` |
| 8 | `disputes` | Open/resolved disputes associated with a deal (with 14-day timeout tracking) | `PK id`, `trade_id UNIQUE`, `resolve_tx_hash UNIQUE`, `disputed_at TIMESTAMP WITH TIME ZONE NULL`, `dispute_timeout_seconds BIGINT NOT NULL DEFAULT 1209600` (14 days), `chk_disputes_status IN ('OPEN', 'RESOLVED')`, `idx_disputes_trade_id` |
| 9 | `dispute_votes` | 2-of-3 multi-party consensus split proposals (`submitResolutionVote`) | `PK id`, `dispute_id FK -> disputes(id) ON DELETE CASCADE`, `trade_id VARCHAR(66)`, `voter_address VARCHAR(42)`, `voter_role VARCHAR(16) CHECK (voter_role IN ('BUYER', 'SELLER', 'ARBITER'))`, `buyer_award_wei VARCHAR(78)`, `seller_award_wei VARCHAR(78)`, `proposal_hash VARCHAR(66)`, `rationale TEXT NULL`, `tx_hash VARCHAR(66)`, `CONSTRAINT uq_dispute_votes_dispute_voter UNIQUE (dispute_id, voter_address)`, `idx_dispute_votes_trade_id` |
| 10 | `dispute_evidence` | Private evidence attachments metadata | `PK id`, `dispute_id FK -> disputes(id) ON DELETE CASCADE`, stores `sha256_hex`, `storage_key` (UUID filename), `mime_type`, `size_bytes`, `idx_dispute_evidence_dispute_id` |
| 11 | `audit_logs` | Security & state mutation trace logs | `PK id`, `idx_audit_logs_resource (resource_type, resource_id)`, stores `correlation_id` |
| 12 | `chain_sync_state` | Indexer cursor row (`id = 1`) | `PK id INT`, tracks active `(chain_id, contract_address)` and `last_synced_block` |

## 3. Financial Precision & Role Consistency

- Native AVAX values (`amount_wei`, `buyer_award_wei`, `seller_award_wei`) across `deals`, `chain_events`, `disputes`, and `dispute_votes` are stored as `VARCHAR(78)` base-10 integer strings to support full Solidity `uint256` precision without float rounding or `BIGINT` 64-bit overflow.
- All Ethereum addresses (`seller_address`, `buyer_address`, `arbiter_address`, `wallet_address`, `actor_address`, `voter_address`) and 32-byte hashes (`trade_id`, `terms_hash`, `tx_hash`, `proposal_hash`) are validated by `EthFormatValidator` and normalized lowercase prior to persistence.

## 4. Deduplication, Fallback Auto-Creation & Crash Recovery Guarantees

- **Log-level idempotency**: `chain_events` enforces `UNIQUE (tx_hash, log_index)` via PostgreSQL constraint (`record_if_absent`), and `deal_events` mirrors `UNIQUE INDEX uq_deal_events_tx_log (tx_hash, log_index)` via `save_if_absent`.
- **Upsert vote tracking**: `dispute_votes` enforces `UNIQUE (dispute_id, voter_address)` so if a participant updates their on-chain split vote via `submitResolutionVote` before 2-of-3 consensus is reached, the latest vote and `proposal_hash` overwrite their prior proposal atomically.
- **On-chain dispute fallback & backfill**: If a buyer or seller invokes `openDispute(tradeId)` directly on-chain without first calling `POST /api/v1/deals/{tradeId}/disputes`, `BlockchainEventIndexerService` and `SyncDealUseCase` automatically create a fallback `disputes` record (`reason = "On-chain dispute opened"`) so `/arbiter` and vote indexing never miss the dispute; when the participant later submits off-chain metadata, `DisputeUseCase::open_dispute` backfills `reason` and `summary` seamlessly.
- **Cursor switch protection**: If `(chain_id, contract_address)` configuration changes between restarts, `BlockchainEventIndexerService` automatically resets `chain_sync_state` cursor (`id = 1`) to `max(0, ESCROW_DEPLOYMENT_BLOCK - 1)`.

## 5. Health Check Query Probe

[`PgDatabaseReadinessAdapter`](../backend/crates/infrastructure/src/persistence/readiness.rs) backs `GET /api/v1/health/ready` using a bounded-timeout SQLx query (`SELECT 1`, `2s` Tokio timeout) directly against the active `PgPool`, paired with a 5-second cached storage writability check in `LocalEvidenceStorageAdapter::is_storage_ready()`.
