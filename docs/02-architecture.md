# System Architecture & Synchronization Design

## 1. High-Level Clean Architecture

SafeDeal strictly decouples irreversible EVM asset custody (`blockchain/SafeDealEscrow.sol`) from rich commercial metadata, authentication, indexing, and dispute evidence storage (`backend/` Clean Modular Monolith + `PostgreSQL` + `frontend/`).

```mermaid
flowchart LR
    U["User Wallet (MetaMask / Core / EIP-1193)"]
    FE["Frontend SPA (React 18 + Vite 6 + wagmi + viem)"]
    API["Spring Boot 3.5.7 API (SIWE + CSRF + REST + Indexer)"]
    DB[("PostgreSQL 16 + Flyway")]
    FS[("Evidence Storage Dir / Railway Volume")]
    RPC["Avalanche C-Chain / Anvil EVM RPC"]
    SC["SafeDealEscrow.sol (Pull-Payment Escrow)"]

    U -- "1. Sign SIWE & Tx" --> FE
    FE -- "2. JSON + HttpOnly Cookie + X-CSRF-Token" --> API
    FE -- "3. Direct Wallet Tx & eth_call" --> RPC
    RPC --> SC
    API -- "4. Web3j Outside DB Tx (Receipt, getTrade, eth_getLogs)" --> RPC
    API -- "5. Short ACID TransactionOperations" --> DB
    API -- "6. Magic-Byte Verified Private Attachments" --> FS
```

## 2. Backend Module Boundaries (`com.safedeal`)

Enforced automatically during every test run by [`ModuleBoundaryArchTest`](../backend/src/test/java/com/safedeal/ModuleBoundaryArchTest.java):

| Layer | Package | Permitted Dependencies | Responsibilities |
|---|---|---|---|
| **Domain** | `com.safedeal.domain.*` | Standard JDK + `shared` | Entities (`Deal`, `Dispute`, `DealStatus`), `CanonicalTermsHasher` (RFC 8785), and 13 port interfaces (`BlockchainGateway`, `DatabaseReadinessPort`, `EvidenceStoragePort`, repositories). Zero imports of Spring, JPA, or Web3j. |
| **Application** | `com.safedeal.application.*` | `domain`, `shared`, `TransactionOperations` | Use cases (`CreateDealDraftUseCase`, `BindDealTransactionUseCase`, `SyncDealUseCase`, `QueryDealsUseCase`, `DisputeUseCase`, `ArbitrationUseCase`, `SiweAuthService`, `BlockchainEventIndexerService`). |
| **Infrastructure** | `com.safedeal.infrastructure.*` | `domain`, `application`, frameworks | JPA/Flyway repositories, `JdbcDatabaseReadinessAdapter`, `Web3jBlockchainGateway`, `SafeDealContractCodec`, `Web3jSignatureVerifier`, `JwtSessionService`, `DoubleSubmitCsrfFilter`, `AuthRateLimitFilter`, `LocalEvidenceStorageAdapter`. |
| **Presentation** | `com.safedeal.presentation.*` | `application`, `domain`, `shared` | `/api/v1/**` REST controllers (`AuthController`, `DealController`, `DisputeController`, `ArbitrationController`, `HealthController`), SpringDoc DTOs, `ApiDtoMapper`, `GlobalExceptionHandler`. |

## 3. Non-Transactional RPC & HikariCP Isolation

Database connections are **never** held while waiting on external Avalanche RPC responses:
1. Phase 1 (`TransactionOperations`): Short DB read verifies authorization and preconditions.
2. Phase 2 (no active transaction): `Web3jBlockchainGateway` executes `eth_getTransactionReceipt`, `getTrade`, or `eth_getLogs` bounded by `BLOCKCHAIN_RPC_TIMEOUT_MS`.
3. Phase 3 (`TransactionOperations`): Short ACID write persists reconciled `deals`, idempotent `chain_events`, `deal_events`, `disputes`, and `audit_logs`.

## 4. Blockchain Event Synchronization & Reconciliation Flow

Background indexing (`BlockchainEventIndexerService`) complements immediate user-triggered `POST /api/v1/deals/{tradeId}/sync` calls so off-chain views catch up automatically even if the user closes their browser immediately after broadcasting a transaction.

```mermaid
flowchart TD
    T["Scheduled Poll (PollLock.tryLock)"] --> E{"Sync Enabled &<br/>Contract Configured?"}
    E -- "No / Busy" --> SKIP["Return 0 (No-Op)"]
    E -- "Yes" --> RPC_HEAD["Web3j: eth_blockNumber (No DB Tx)"]
    RPC_HEAD --> LAG["safeHead = latestBlock - (confirmationsRequired - 1)"]
    LAG --> CUR["DB Tx 1: Read/Init chain_sync_state (last_synced_block)"]
    CUR --> CMP{"safeHead ><br/>lastSyncedBlock?"}
    CMP -- "No" --> DONE["Done"]
    CMP -- "Yes" --> BATCH["Iterate chunks [cursor .. min(safeHead, cursor + batchSize - 1)]"]
    BATCH --> LOGS["Web3j: eth_getLogs + decode SafeDealContractCodec (No DB Tx)"]
    LOGS --> DB_TX2["DB Tx 2 (Short Atomic Batch)"]
    DB_TX2 --> DEDUP{"INSERT chain_events ON CONFLICT DO NOTHING<br/>UNIQUE (tx_hash, log_index)"}
    DEDUP -- "Duplicate" --> NEXT_EV["Skip projection update"]
    DEDUP -- "New Event" --> REC["Validate DealStatus.canReconcileTo(nextStatus)<br/>Update Deal, Dispute (if resolved), & saveIfAbsent DealEvent"]
    NEXT_EV --> CURSOR_ADV
    REC --> CURSOR_ADV["Advance chain_sync_state.last_synced_block = chunkTo"]
    CURSOR_ADV --> MORE{"More chunks?"}
    MORE -- "Yes" --> BATCH
    MORE -- "No" --> DONE
```

## 5. Frontend Architecture Summary (`frontend/src/`)

- `config/` — `env.ts` (Zod-safe parsing of `VITE_*` variables), `brand.config.ts` (editorial Foldcraft copy & navigation), `app.config.ts` (`sessionStorage`/`localStorage` prefixes, limits), `network.config.ts` (Fuji & Anvil wagmi chains), `routes.ts`.
- `features/` — `authentication` (SIWE + HttpOnly cookie modal/context), `deals` (API hooks + `useCreateDraftPersistence` reload recovery + `usePendingTransactions`), `disputes`, `arbitration`, `escrow` (`useEscrowActions` enforcing `chainId` & configured contract address prior to wallet signing).
- `contracts/SafeDealEscrow.ts` — Strongly typed ABI matching `ISafeDealEscrow.sol`.
- **OpenAPI Contract Verification**: [`OpenApiContractVerificationTest`](../backend/src/test/java/com/safedeal/OpenApiContractVerificationTest.java) enforces exact schema parity between SpringDoc `/v3/api-docs` and the committed [`docs/openapi.json`](./openapi.json).
