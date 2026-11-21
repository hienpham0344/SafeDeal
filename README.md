# SafeDeal

> Non-Custodial Peer-to-Peer Escrow on Avalanche C-Chain

SafeDeal is a non-custodial escrow platform engineered for high-trust digital transactions, freelance deliverables, bespoke services, and over-the-counter settlements on the Avalanche C-Chain. The system combines an immutable Solidity smart contract implementing pull-payment settlement and 2-of-3 dispute consensus with a Clean Architecture Rust backend (Axum, Tokio, SQLx, Alloy) and a React 18 single-page application (TypeScript, Vite, Tailwind CSS, wagmi, viem).

By anchoring RFC 8785 canonical agreement hashes on-chain, enforcing deterministic state transitions, and providing a 14-day stalemate timeout fallback, SafeDeal guarantees that neither the backend service, deployer keys, nor unresponsive counterparties can alter terms, divert balances, or trap funds in escrow.

---

## 1. Problem and Value Proposition

### The Asymmetric Trust Gap

Direct peer-to-peer commerce carries inherent counterparty risk:
- Paying upfront leaves the buyer vulnerable to non-delivery, fraudulent deliverables, or abandoned milestones.
- Delivering upfront exposes the seller to payment default, post-delivery ghosting, or unjustified chargebacks.
- Centralized escrow intermediaries introduce single-point-of-failure custodial risk, administrative freeze hazards, opaque dispute adjudication, and substantial fee overheads.

### The SafeDeal Solution

SafeDeal resolves the trust gap by establishing a verifiable Web2.5 execution model:

- **Mathematical Escrow Custody**: Native AVAX deposits lock directly into the immutable `SafeDealEscrow` contract. Funds cannot be seized, redirected, or withdrawn by platform administrators.
- **Pull-Payment Settlement**: Payouts and refunds credit internal claimable balances instead of pushing transfers inline, eliminating reentrancy attack surfaces and denial-of-service risks caused by reverting recipient contracts.
- **Deterministic Off-Chain Agreement Anchoring**: Commercial terms (descriptions, deadlines, inspection windows, counterparties, and settlement amounts) are deterministically serialized via RFC 8785 Canonical JSON, hashed with SHA-256 (`termsHash`), and immutably registered on-chain during trade creation.
- **Cryptographic Authentication with Cross-Site Resilience**: Wallet-native Sign-In with Ethereum (EIP-4361 / SIWE) eliminates custodial passwords. Sessions are secured via a dual-mode authentication scheme (`HttpOnly` JWT cookies paired with `localStorage` Bearer tokens for seamless cross-origin and multi-tab support), protected by double-submit CSRF headers and peer-IP rate limiting.
- **2-of-3 Dispute Consensus with 14-Day Stalemate Fallback**: Disputed trades allow the buyer, seller, and designated arbiter to submit settlement proposals. When any two parties agree on the allocation, the trade settles immediately. If the dispute remains unresolved after 14 days, any participant can trigger an automated 50/50 fallback settlement, guaranteeing funds never remain trapped indefinitely.
- **Private, Role-Gated Evidence Archival**: Disputed trades support binary and textual evidence submissions verified through file magic-byte inspection and restricted strictly to buyer, seller, and the designated arbiter.
- **Resilient Event Indexing**: A background event indexer monitors Avalanche logs using chunked queries and deduplication, ensuring the relational projection monotonically reconciles with on-chain truth even under rapid state transitions or network interruptions.

---

## 2. System Architecture

The SafeDeal platform separates trustless value settlement from authenticated metadata management and off-chain coordination.

### System Overview

```mermaid
flowchart TD
    subgraph Clients["Client Layer"]
        Wallet["User Wallet (MetaMask / Core / EIP-1193)"]
        Frontend["Frontend SPA (React 18 + Vite 6 + wagmi + viem)"]
    end

    subgraph BackendApp["Backend Application (Rust / Axum 0.8)"]
        Presentation["safedeal-presentation (REST Endpoints & Probes)"]
        Application["safedeal-application (Use Cases & Indexer Service)"]
        Domain["safedeal-domain (Entities, State Machine & Canonical Terms)"]
        Infrastructure["safedeal-infrastructure (SQLx, Alloy RPC, Session & CSRF)"]
    end

    subgraph Storage["Data & Execution Infrastructure"]
        Postgres[("PostgreSQL 16 Database")]
        EvidenceFS[("Evidence File Storage (Local / S3)")]
        AvalancheNode["Avalanche C-Chain / Anvil EVM Node"]
        EscrowContract["SafeDealEscrow.sol (Pull-Payment Settlement)"]
    end

    Wallet -->|"1. Direct Contract Calls (createTrade, fundTrade, vote, withdraw)"| AvalancheNode
    AvalancheNode --> EscrowContract
    Wallet -->|"2. EIP-4361 SIWE Signature"| Frontend
    Frontend -->|"3. REST JSON + Bearer Token / Cookie + X-CSRF-Token"| Presentation
    Presentation --> Application
    Application --> Domain
    Application --> Infrastructure
    Infrastructure -->|"4. ACID State Persistence"| Postgres
    Infrastructure -->|"5. Magic-Byte Validated Uploads"| EvidenceFS
    Infrastructure -->|"6. Non-Transactional RPC Verification & Event Indexing"| AvalancheNode
```

### Trade Lifecycle State Machine

Off-chain deal records mirror the authoritative state transitions defined in `SafeDealEscrow.sol`:

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Seller drafts deal terms (/api/v1/deals/drafts)
    DRAFT --> CREATED : Seller broadcasts createTrade() & binds tx (/bind-tx)
    CREATED --> CANCELLED : Seller calls cancelUnfundedTrade()
    CREATED --> FUNDED : Buyer calls fundTrade() with native AVAX before deadline
    FUNDED --> DELIVERED : Seller calls markDelivered()
    FUNDED --> REFUNDED : Seller voluntary refund OR Buyer refundAfterDeadline()
    FUNDED --> DISPUTED : Buyer or Seller calls openDispute()
    DELIVERED --> RELEASED : Buyer calls releaseFunds()
    DELIVERED --> DISPUTED : Buyer anytime OR Seller after inspection window
    DISPUTED --> RESOLVED : 2-of-3 Consensus (submitResolutionVote) OR 14-Day Timeout (resolveDisputeByTimeout)
    CANCELLED --> [*]
    RELEASED --> [*]
    REFUNDED --> [*]
    RESOLVED --> [*]
```

### Settlement and Balance Claims

Settlement actions (`releaseFunds`, `refundBySeller`, `refundAfterDeadline`, `submitResolutionVote` consensus, and `resolveDisputeByTimeout`) do not execute inline native token transfers. Instead, they update internal ledger balances:

1. **State Transition**: Contract updates trade status (`RELEASED`, `REFUNDED`, or `RESOLVED`) and marks `settled = true`.
2. **Balance Credit**: Contract increases `_claimableBalances[beneficiary]` by the allocated amount and decrements `_totalLockedEscrow`.
3. **Pull-Payment Withdrawal**: The beneficiary executes `withdraw()`, which reads the balance, zeroes the ledger entry (Checks-Effects-Interactions), and transfers the native AVAX under a `nonReentrant` guard.

### Clean Architecture Backend Boundaries

The backend is structured into five distinct Rust crates within a Cargo workspace, validated continuously by `tests/architecture_dag.rs`:

- `crates/shared`: Common error types, standard timestamp formatters, correlation identifiers, and EVM hex/wei utilities (`alloy_primitives::U256`).
- `crates/domain`: Pure business logic, `DealStatus` transition matrices, `canReconcileTo` reachability rules, RFC 8785 canonical terms hasher, dispute consensus models, and port traits. Contains zero dependencies on web or database frameworks.
- `crates/application`: Use case orchestrators (`deal`, `dispute`, `arbitration`, `siwe`, `indexer`). All external RPC calls are kept strictly outside database transactions.
- `crates/infrastructure`: Implementations for SQLx PostgreSQL persistence, embedded migrations, Alloy RPC gateway, JWT session cookies and Bearer tokens, Double-Submit CSRF validation, IP rate limiting, and magic-byte evidence storage.
- `crates/presentation`: Axum router definitions (`/api/v1/**`), health probes (`/api/v1/health`, `/api/v1/health/ready`, `/actuator/health/readiness`), request/response DTOs, and utoipa OpenAPI specifications.
- `src/main.rs`: Production binary entrypoint orchestrating Tokio runtime tasks, structured tracing, background indexer loops, and graceful shutdown handlers.

### Non-Transactional RPC Pattern

To prevent thread starvation and connection pool exhaustion on PostgreSQL, database transactions are never held across network RPC operations:

1. **Phase 1 (Database Transaction)**: Short, atomic read to verify local authorization and record preliminary metadata.
2. **Phase 2 (Out-of-Transaction RPC)**: External JSON-RPC request to the Avalanche node (`eth_getTransactionReceipt`, `getTrade`, `getDisputeVotes`, or `eth_getLogs`) bounded by `BLOCKCHAIN_RPC_TIMEOUT_MS`.
3. **Phase 3 (Database Transaction)**: Short, atomic commit to persist reconciled deal states, transaction receipts, and indexer checkpoints.

---

## 3. Technology Stack

| Domain | Technology | Version / Specification | Purpose |
|---|---|---|---|
| Smart Contracts | Solidity | `^0.8.28` | Non-custodial escrow core with 2-of-3 consensus (`SafeDealEscrow.sol`) |
| Contract Framework | Foundry | `forge`, `anvil`, `cast` | Compilation, unit testing, security invariants, deployment scripting |
| Contract Security | OpenZeppelin Contracts | `v5.x` | Standardized `ReentrancyGuard` baseline |
| Backend Runtime | Rust | `1.91+` (2021 Edition) | High-performance, memory-safe backend services |
| Web Framework | Axum | `0.8` | Asynchronous HTTP routing and multipart payload processing |
| Async Runtime | Tokio | `1.x` | Event loop, task concurrency, scheduled indexer routines |
| Database Persistence | SQLx | `0.8` | Compile-time checked asynchronous PostgreSQL queries and migrations |
| EVM Client | Alloy | `1.7` (`sol!` ABI codec) | EVM RPC communication, contract interaction, and log decoding |
| Cryptography | k256 / sha3 / sha2 | `0.13` / `0.10` / `0.10` | EIP-191 / EIP-4361 signature verification and SHA-256 terms hashing |
| API Specification | utoipa | `5.x` / OpenAPI 3.0 | Auto-generated OpenAPI documentation and Swagger UI |
| Frontend Framework | React | `18.3` | User interface component architecture |
| Build Tool | Vite | `6.x` | Modern ESM bundler and development server |
| Language | TypeScript | `5.7` (strict mode) | End-to-end static type enforcement |
| Styling | Tailwind CSS | `3.4` | Utility-first responsive design system |
| Web3 Integration | wagmi / viem | `2.14` / `2.23` | React hooks for EIP-1193 wallets and typed contract interactions |
| Server State | TanStack Query | `5.66` | Asynchronous query caching, optimistic updates, and polling |
| Forms & Validation | React Hook Form / Zod | `7.54` / `3.24` | Schema-driven form parsing and client validation |
| Unit & E2E Testing | Vitest / Playwright | `3.0` / `1.50` | Component unit tests and cross-browser integration suites |
| Primary Frontend Hosting | Firebase Hosting | Automated GitHub Actions | Static asset edge distribution and SPA route rewrites |
| Alternative Frontend Hosting | Vercel | `frontend/vercel.json` | Static deployment configuration with security headers |
| Backend Platform | Railway | `backend/Dockerfile` | Containerized Rust Axum API and managed PostgreSQL |

---

## 4. Key Features

### 1. Deterministic On-Chain Custody
Native AVAX is locked directly inside the `SafeDealEscrow` contract upon buyer funding. The contract enforces state transitions deterministically without administrative bypasses, pause mechanisms, or operator withdrawal capabilities. Funds can only be unlocked via legal transitions: buyer release, mutual or deadline refund, 2-of-3 consensus settlement, or automated stalemate timeout.

### 2. Pull-Payment Settlement
All payouts credit the recipient's internal balance (`_claimableBalances`) within contract storage. Beneficiaries claim their funds by executing `withdraw()`. This isolates individual transfers, preventing malicious smart contracts or reverting fallback functions from blocking trade settlements or trapping counterparty assets.

### 3. RFC 8785 Canonical Terms Hashing
Deal specifications (title, description, raw terms, deadlines, inspection window, counterparty addresses, and amount in wei) are normalized using RFC 8785 Canonical JSON before being hashed with SHA-256. The resulting 32-byte `termsHash` is committed on-chain in `createTrade()`. Any post-agreement modification off-chain fails hash validation, guaranteeing agreement integrity.

### 4. SIWE Authentication with Cross-Site Resilience
SafeDeal uses Sign-In with Ethereum (EIP-4361) to authenticate users without email addresses or passwords. The backend generates single-use nonces with a 5-minute time-to-live. Upon signature verification, the server issues both an `HttpOnly` session cookie and an authenticated JWT Bearer token in the JSON response payload. The frontend persists the token in `localStorage` under `safedeal_bearer_token`, ensuring reliable session persistence across tabs and cross-origin hosting setups (such as Firebase frontend interacting with a Railway API). Mutating REST operations require a matching double-submit CSRF token (`X-CSRF-Token`).

### 5. 2-of-3 Consensus Dispute Resolution with 14-Day Timeout
When a trade is in `FUNDED` or `DELIVERED`, either party can trigger `openDispute()`. Once disputed, three authorized parties can propose or vote on resolution splits via `submitResolutionVote(tradeId, buyerAmount, sellerAmount)`:
- **Consensus Rule**: As soon as any two parties (buyer + seller, buyer + arbiter, or seller + arbiter) agree on the identical allocation (`matchCount >= 2`), the trade settles immediately.
- **Stalemate Protection**: If consensus is not reached within 14 days (`DISPUTE_TIMEOUT = 14 days`), any participant can call `resolveDisputeByTimeout(tradeId)` to execute an automatic 50/50 split (`trade.amount / 2`), ensuring funds are never permanently locked due to unresponsive arbiters or deadlock.
- **Role-Gated Evidence**: During the dispute window, participants can upload supporting evidence (PNG, JPEG, PDF, TXT) up to 5 MB per file, protected by magic-byte verification and ACL-restricted to the involved parties.

### 6. Resilient Event Indexing and Status Reconciliation
The Rust backend features an asynchronous indexing loop that polls Avalanche event logs (`TradeCreated`, `TradeFunded`, `DeliveryMarked`, `FundsReleased`, `RefundExecuted`, `DisputeOpened`, `DisputeVoteSubmitted`, `DisputeResolved`, `DisputeResolvedByTimeout`, `TradeCancelled`). Events are deduplicated on `(tx_hash, log_index)`. The domain state engine reconciles database records forward monotonically, ensuring client interfaces update accurately even after browser reloads or intermittent connectivity drops.

---

## 5. Repository Structure

```text
SafeDeal/
├── blockchain/              Solidity smart contracts, tests, and deployment scripts
│   ├── src/
│   │   ├── SafeDealEscrow.sol       Core escrow implementation with pull-payment & 2-of-3 consensus
│   │   └── interfaces/
│   │       └── ISafeDealEscrow.sol  Public ABI interface, structs, and consensus events
│   ├── test/
│   │   ├── SafeDealEscrow.t.sol     Unit tests covering full trade lifecycles and voting
│   │   ├── EscrowSecurity.t.sol     Security tests against reentrancy and unauthorized calls
│   │   └── EscrowInvariant.t.sol    Stateful property-based invariant test suite
│   ├── script/
│   │   └── Deploy.s.sol             Foundry deployment script
│   └── foundry.toml                 Foundry compiler, optimizer, and EVM configurations
│
├── backend/                 Clean Architecture Rust backend workspace
│   ├── crates/
│   │   ├── shared/          Domain errors, timestamp utilities, wei/hex helpers
│   │   ├── domain/          Entities, state machines, RFC 8785 canonical terms hasher
│   │   ├── application/     Use cases (deals, disputes, arbitration voting, SIWE, indexer)
│   │   ├── infrastructure/  SQLx persistence, Alloy EVM client, JWT auth, CSRF, storage
│   │   └── presentation/    Axum HTTP routers, health probes, DTOs, OpenAPI spec
│   ├── migrations/          Flyway-compatible SQL migrations for PostgreSQL schema
│   ├── tests/
│   │   └── architecture_dag.rs  Automated Clean Architecture crate dependency assertions
│   ├── src/main.rs          Backend binary entrypoint and runtime orchestration
│   └── Cargo.toml           Cargo workspace definition and dependency configurations
│
├── frontend/                Single-page application client
│   ├── src/
│   │   ├── config/          Runtime environment validation, network, and brand configs
│   │   ├── contracts/       Strongly typed contract ABI definitions
│   │   ├── features/        Domain feature modules (auth, deals, disputes, consensus voting)
│   │   ├── pages/           Landing, HowItWorks, Support, Create, Deal, Dashboard, Arbiter
│   │   ├── services/http/   Axios/fetch client with Bearer token & CSRF injection
│   │   ├── utils/           RFC 8785 canonical serializer, wei math, and date helpers
│   │   └── App.tsx          Application routing, query providers, and wagmi wrappers
│   ├── public/              Static icons, manifest, and public assets
│   ├── package.json         Frontend dependencies and build scripts
│   └── vite.config.ts       Vite build configuration and proxy definitions
│
├── infra/                   Containerization and cloud deployment manifests
│   ├── docker-compose.yml   Local multi-container stack (Postgres, Anvil, API, Frontend)
│   ├── railway/             Railway cloud deployment descriptors for backend
│   └── vercel/              Vercel single-page application routing configurations
│
├── scripts/                 Automation scripts for local setup, testing, and deployment
│   ├── install.sh           Toolchain verification and dependency installation
│   ├── dev-db.sh            Local PostgreSQL container management
│   ├── dev-anvil.sh         Local Foundry Anvil blockchain node startup
│   ├── deploy-local.sh      SafeDealEscrow contract deployment to local Anvil
│   ├── deploy-fuji.sh       SafeDealEscrow deployment to Avalanche Fuji testnet
│   ├── dev-backend.sh       Rust Axum backend development server startup
│   ├── dev-frontend.sh      Vite frontend development server startup
│   ├── verify.sh            Monorepo test and verification gate
│   ├── smoke-test.sh        Health probe, readiness, and endpoint smoke testing
│   ├── e2e-live.sh          Full unmocked 3-tier browser-to-blockchain integration test
│   └── reset-dev.sh         Local container volumes and state cleanup
│
├── docs/                    Engineering documentation, architecture diagrams, and specs
│   ├── 00-overview.md       Executive summary and project overview
│   ├── 02-architecture.md   System design, module boundaries, and synchronization
│   ├── 04-api-contracts.md  REST API specifications, headers, and error envelopes
│   ├── 06-state-machines.md State transitions and reconciliation rules
│   ├── 07-smart-contract-design.md Contract security invariants and pull-payment mechanics
│   ├── 08-security.md       Threat model, authentication, and file security
│   └── openapi.json         Committed OpenAPI 3.0 specification
│
├── firebase.json            Firebase Hosting configuration for frontend deployment
├── Makefile                 Standardized developer entrypoint for common workflows
└── README.md                Repository documentation
```

---

## 6. Getting Started

### Prerequisites

Ensure the following runtimes and toolchains are installed on your host system:

- **Rust `1.91+`**: Required for the backend API (`rustc`, `cargo`, `rustfmt`, `clippy`). Install via [rustup.rs](https://rustup.rs).
- **Node.js `22+` & npm**: Required for the frontend client.
- **Foundry**: Required for smart contract testing and local blockchain execution (`forge`, `anvil`, `cast`). Install via [getfoundry.sh](https://getfoundry.sh).
- **PostgreSQL 16** (or Docker with Docker Compose): Required for metadata persistence.

### Fast Local Development Tips

- **Use Native Scripts for Day-to-Day Coding**: Avoid running `docker compose up --build` for regular feature development, as the backend Dockerfile compiles Rust in release mode with Link-Time Optimization (LTO). Instead, start PostgreSQL via `bash scripts/dev-db.sh` and run `dev-anvil.sh`, `dev-backend.sh`, and `dev-frontend.sh` natively.
- **Lightweight Debug Builds**: `backend/Cargo.toml` configures `[profile.dev]` with `debug = "line-tables-only"`, keeping `target/debug` artifacts compact and compilation/linking times fast.
- **Targeted Fast Verification**: To run formatting, clippy, unit, integration, and contract tests without launching the full Playwright browser suite, use:
  ```bash
  RUN_E2E=0 bash scripts/verify.sh
  ```

### Quick Start (Local Development Stack)

Follow these steps to initialize and run the full SafeDeal environment locally using separate terminal windows.

#### Step 1: Install Dependencies and Templates

Initialize configuration files from `.env.example` templates and install project dependencies:

```bash
INIT_ENV=1 bash scripts/install.sh
```

#### Step 2: Start PostgreSQL and Anvil

In terminal 1, launch the PostgreSQL database container:

```bash
bash scripts/dev-db.sh
```

In terminal 2, start the local Anvil blockchain node (`chainId: 31337`):

```bash
bash scripts/dev-anvil.sh
```

#### Step 3: Deploy Smart Contracts to Anvil

In terminal 3, deploy `SafeDealEscrow` to the local Anvil node using a local development private key:

```bash
export DEPLOYER_PRIVATE_KEY=<your-local-anvil-private-key>
bash scripts/deploy-local.sh
```

The script outputs the deployed contract address (e.g., `0x5FbDB2315678afecb367f032d93F642f64180aa3`) and writes it to `blockchain/deployments/local-31337.json`.

Ensure this address is present in your environment configurations:
- `backend/.env`: `ESCROW_CONTRACT_ADDRESS=<deployed-address>` and `BLOCKCHAIN_SYNC_ENABLED=true`
- `frontend/.env`: `VITE_ESCROW_CONTRACT_ADDRESS=<deployed-address>`

#### Step 4: Start the Backend API

In terminal 3, launch the Rust Axum backend:

```bash
bash scripts/dev-backend.sh
```

The service applies embedded database migrations automatically and listens on `http://localhost:8080`.

#### Step 5: Start the Frontend Application

In terminal 4, launch the Vite development server:

```bash
bash scripts/dev-frontend.sh
```

The user interface becomes available at `http://localhost:5173`.

#### Step 6: Verify Service Health

In terminal 5, verify that all components are operating correctly:

```bash
bash scripts/smoke-test.sh
```

The smoke test probes:
- Backend liveness: `GET /api/v1/health` (expects HTTP 200 `status: UP`)
- Backend dependency readiness: `GET /api/v1/health/ready` (expects HTTP 200 `status: READY`)
- Actuator readiness endpoint: `GET /actuator/health/readiness` (expects HTTP 200 `status: UP`)
- Frontend availability: `GET http://localhost:5173` (expects HTTP 200)
- Private authorization boundaries: `GET /api/v1/auth/me` (expects HTTP 401 Unauthorized)

---

## 7. Full-Stack Docker Compose Workflow

To launch the complete SafeDeal environment inside isolated Docker containers without installing local toolchains:

```bash
cp .env.example .env
# Ensure JWT_SECRET in .env contains a random string of at least 32 characters
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

Configured container services:
- **Frontend UI**: `http://localhost:5173`
- **Backend API**: `http://localhost:8080` (Swagger UI at `http://localhost:8080/swagger-ui`)
- **Anvil Node**: `http://localhost:8545`
- **PostgreSQL**: `localhost:5432` (`safedeal` / `safedeal`)

To reset Docker volumes and clear local state:

```bash
bash scripts/reset-dev.sh
```

---

## 8. Environment Variables Reference

SafeDeal organizes configuration through package-specific environment files (`blockchain/.env`, `backend/.env`, and `frontend/.env`), unified at the root level via `.env.example`.

### Blockchain Configuration (`blockchain/.env`)

| Variable | Description | Required | Default Value |
|---|---|---|---|
| `LOCAL_RPC_URL` | Local Anvil JSON-RPC endpoint URL | Yes (Local) | `http://127.0.0.1:8545` |
| `LOCAL_CHAIN_ID` | Chain identifier for local Anvil node | Yes (Local) | `31337` |
| `FUJI_RPC_URL` | Avalanche Fuji C-Chain JSON-RPC endpoint | Yes (Fuji) | `https://api.avax-test.network/ext/bc/C/rpc` |
| `FUJI_CHAIN_ID` | Chain identifier for Avalanche Fuji testnet | Yes (Fuji) | `43113` |
| `DEPLOYER_PRIVATE_KEY` | Hex private key used exclusively for contract deployment | Yes (Deploy) | None (export in shell) |
| `SNOWTRACE_API_KEY` | Snowtrace API key for smart contract verification | No | Empty |

### Backend Configuration (`backend/.env`)

| Variable | Description | Required | Default Value |
|---|---|---|---|
| `APP_ENV` | Application environment profile (`local`, `test`, `staging`, `prod`) | Yes | `local` |
| `SERVER_PORT` | TCP port on which the Axum HTTP server binds | Yes | `8080` |
| `DATABASE_URL` | PostgreSQL connection URL | Yes | `postgres://safedeal:safedeal@localhost:5432/safedeal` |
| `JWT_SECRET` | Cryptographic secret for signing session tokens (minimum 32 chars) | Yes | None (must be configured) |
| `SESSION_TTL_SECONDS` | Expiration time for authenticated sessions | No | `86400` (24 hours) |
| `NONCE_TTL_SECONDS` | Expiration time for single-use SIWE nonces | No | `300` (5 minutes) |
| `SIWE_DOMAIN` | Domain expected within SIWE message verification | Yes | `localhost:5173` |
| `SIWE_URI` | Full URI expected within SIWE message verification | Yes | `http://localhost:5173` |
| `SESSION_COOKIE_NAME` | Name of the issued session cookie | No | `safedeal_session` |
| `CSRF_COOKIE_NAME` | Name of the issued CSRF verification cookie | No | `safedeal_csrf` |
| `COOKIE_SECURE` | Restrict session cookies to HTTPS connections | Yes (Prod) | `false` (Local) / `true` (Prod) |
| `COOKIE_SAME_SITE` | SameSite cookie policy (`Lax`, `Strict`, `None`) | No | `Lax` (`None` for cross-site) |
| `CORS_ALLOWED_ORIGINS` | Comma-delimited list of permitted CORS web origins | Yes | `http://localhost:5173` |
| `BLOCKCHAIN_SYNC_ENABLED` | Enable the background indexer polling loop | Yes | `false` (Set true after deploy) |
| `CHAIN_ID` | Target EVM chain identifier | Yes | `31337` |
| `AVALANCHE_RPC_URL` | JSON-RPC provider endpoint for backend queries | Yes | `http://127.0.0.1:8545` |
| `ESCROW_CONTRACT_ADDRESS` | Deployed address of the `SafeDealEscrow` contract | Yes (Sync) | None |
| `EVIDENCE_STORAGE_BACKEND` | Storage backend for dispute files (`local` or `s3`) | Yes | `local` |
| `EVIDENCE_STORAGE_DIR` | Filesystem path for stored attachments | Yes (Local) | `./storage/evidence` |
| `EVIDENCE_MAX_BYTES` | Maximum permitted file upload size in bytes | No | `5242880` (5 MB) |
| `RATE_LIMIT_ENABLED` | Enable peer-IP authentication rate limiting | No | `true` |
| `AUTH_RATE_LIMIT_PER_MINUTE`| Maximum permitted authentication requests per IP per minute | No | `30` |

### Frontend Configuration (`frontend/.env`)

| Variable | Description | Required | Default Value |
|---|---|---|---|
| `VITE_APP_NAME` | Application title presented in the user interface | No | `SafeDeal` |
| `VITE_APP_ENV` | Client environment mode (`local`, `staging`, `production`) | No | `local` |
| `VITE_API_BASE_URL` | Base URL of the backend REST API | Yes | `http://localhost:8080` |
| `VITE_CHAIN_ID` | Required network chain identifier for wallet connection | Yes | `31337` |
| `VITE_CHAIN_NAME` | User-facing display name of the active network | No | `Anvil Local` |
| `VITE_RPC_URL` | Client-accessible JSON-RPC URL for wallet queries | Yes | `http://127.0.0.1:8545` |
| `VITE_ESCROW_CONTRACT_ADDRESS` | Deployed address of the `SafeDealEscrow` contract | Yes | None |
| `VITE_DEFAULT_ARBITER_ADDRESS` | Default arbiter wallet address pre-filled in deal drafts | No | Empty |
| `VITE_DEFAULT_INSPECTION_WINDOW_SECONDS` | Default post-delivery review window | No | `259200` (3 days) |
| `VITE_MAX_EVIDENCE_BYTES` | Maximum allowed attachment size enforced on client | No | `5242880` (5 MB) |

---

## 9. Development and Verification Workflow

SafeDeal enforces strict automated quality gates across all monorepo layers.

### Monorepo Verification Suite

Run all verification checks across contracts, backend, frontend, and browser integration:

```bash
make verify
# Alternatively:
bash scripts/verify.sh
```

To run fast checks skipping the Playwright browser suite:

```bash
RUN_E2E=0 bash scripts/verify.sh
```

### Component Test Commands

| Layer | Command | Verification Scope |
|---|---|---|
| Smart Contracts | `forge test --root blockchain -vvv` | Executes unit tests, reentrancy security simulations, and stateful fuzz invariant suites |
| Backend Linting | `cargo fmt --manifest-path backend/Cargo.toml --check` | Verifies adherence to standard Rust formatting |
| Backend Clippy | `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings` | Enforces zero warnings, `#![deny(unsafe_code)]`, and strict error handling policies |
| Backend Tests | `cargo test --manifest-path backend/Cargo.toml --workspace -- --test-threads=1` | Runs workspace unit tests, PostgreSQL repository tests, and Clean Architecture crate DAG checks |
| Backend Release | `cargo build --release --manifest-path backend/Cargo.toml --bin safedeal-api` | Verifies production release binary compilation |
| Frontend Types | `npm --prefix frontend run typecheck` | Validates TypeScript in strict mode (`tsc --noEmit`) |
| Frontend Lint | `npm --prefix frontend run lint` | Runs ESLint over components and hooks |
| Frontend Tests | `npm --prefix frontend test` | Runs Vitest unit tests covering canonical terms hashing and UI components |
| Frontend Build | `npm --prefix frontend run build` | Compiles production assets via Vite |
| Browser E2E | `npm --prefix frontend run test:e2e` | Runs Playwright suites across desktop and mobile viewport configurations |
| Live 3-Tier E2E | `bash scripts/e2e-live.sh` | Launches dedicated Anvil, deploys escrow, boots `safedeal-api`, and executes unmocked browser flows |

---

## 10. Security Model and Trust Boundaries

### Smart Contract Invariants

- **Zero Inline Transfers on Settlement**: Settlement functions do not transfer native AVAX directly. They transition trade status and credit `_claimableBalances[recipient]`. This protects against reentrancy and griefing vectors where a recipient's fallback logic reverts or consumes excessive gas.
- **Strict Role Enforcement**: Only the pre-assigned buyer can release funds or reclaim assets after the delivery deadline. Only the seller can cancel an unfunded deal or issue voluntary refunds. Only the three designated parties (buyer, seller, arbiter) can participate in dispute voting.
- **Immutable Financial Balances**: Invariant testing (`EscrowInvariant.t.sol`) guarantees that the contract's total native balance equals `totalLockedEscrow + totalClaimable` at all times.
- **Fail-Closed Open Buyers**: When a deal is drafted with an open counterparty (`address(0)`), the first account to successfully execute `fundTrade()` binds permanently as the buyer. Seller and arbiter accounts are strictly prevented from funding their own deals.

### Dispute Consensus & Stalemate Protection

The dispute mechanism is designed to avoid unilateral arbiter bias and prevent permanent fund lockups:
- **2-of-3 Consensus**: Any two matching votes among the buyer, seller, and arbiter reach immediate consensus. If the buyer and seller independently agree on a compromise split, the settlement executes without requiring arbiter intervention.
- **Strict Allocation Conservation**: Every proposed settlement must satisfy `buyerAmount + sellerAmount == trade.amount`. The contract forbids allocating funds to third parties, and arbiters receive zero automatic commission.
- **14-Day Stalemate Fallback**: If consensus cannot be reached within 14 days (`DISPUTE_TIMEOUT = 14 days`), any participant can trigger `resolveDisputeByTimeout(tradeId)`. The contract automatically splits the escrowed balance 50/50 between buyer and seller, guaranteeing funds never remain trapped in a frozen dispute state.

### Web and Authentication Security

- **SIWE Single-Use Nonces**: Authentication nonces are generated with cryptographically secure random entropy, valid for 5 minutes, and invalidated immediately upon first presentation to prevent replay attacks.
- **Dual-Mode Session Security**: Authenticated sessions support both `HttpOnly` cookies and client-side `localStorage` Bearer tokens (`safedeal_bearer_token`). This prevents session dropouts in modern browsers with strict cross-site cookie restrictions while maintaining seamless multi-tab synchronization.
- **Double-Submit CSRF Protection**: Every mutating HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) requires an `X-CSRF-Token` header that matches the value in the `safedeal_csrf` cookie or in-memory session token.
- **Peer-IP Rate Limiting**: The authentication router applies rate limiting to prevent brute-force nonce generation and signature submission attempts.
- **Evidence Upload Defenses**: Uploaded evidence files are restricted to `image/png`, `image/jpeg`, `application/pdf`, and `text/plain`. The backend inspects binary magic bytes before accepting payloads, rejecting spoofed extensions, SVG vectors, and executable formats.

---

## 11. Deployment Architecture

### Avalanche Fuji Testnet

Deploy `SafeDealEscrow` to the public Avalanche Fuji C-Chain:

```bash
export FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
export DEPLOYER_PRIVATE_KEY="<your-fuji-deployer-private-key>"
bash scripts/deploy-fuji.sh
```

Detailed step-by-step instructions for funding testnet accounts and configuring block explorers are available in [`docs/13-fuji-setup.md`](docs/13-fuji-setup.md).

### Cloud Production Topology

```text
[ Users / Wallets ]
        |
        v
[ Firebase Hosting CDN ]  -->  Frontend SPA (React 18 / Vite 6)
        |
        |  REST JSON + Bearer Token / Cookie + X-CSRF-Token
        v
[ Railway PaaS ]          -->  Backend API (Rust Axum safedeal-api)
        |                              |
        | SQLx Pool                    | Alloy JSON-RPC
        v                              v
[ Railway PostgreSQL ]           [ Avalanche C-Chain / Fuji ]
```

- **Frontend (Firebase Hosting)**: The primary continuous deployment target configured via `.github/workflows/deploy-frontend.yml` and `firebase.json`, distributing static assets over global CDN edge nodes with SPA rewrite handling. Alternatively, Vercel deployment descriptors remain available in `frontend/vercel.json` and `infra/vercel/README.md`.
- **Backend (Railway)**: Built from `backend/Dockerfile` using multi-stage builds. Production settings require `APP_ENV=prod`, an explicit `CORS_ALLOWED_ORIGINS` domain, `COOKIE_SECURE=true`, and an allocated persistent volume for evidence storage. Refer to [`docs/14-railway-setup.md`](docs/14-railway-setup.md).

---

## 12. Project Status and Boundaries

### Implemented Capabilities

- Fully implemented and audited `SafeDealEscrow.sol` contract supporting the complete trade lifecycle (`CREATED`, `FUNDED`, `DELIVERED`, `RELEASED`, `REFUNDED`, `DISPUTED`, `RESOLVED`, `CANCELLED`).
- 2-of-3 consensus arbitration mechanism between buyer, seller, and arbiter, backed by an automated 14-day 50/50 stalemate timeout fallback.
- Clean Architecture Rust backend workspace with isolated crate boundaries, non-transactional Alloy RPC queries, and PostgreSQL persistence.
- React 18 single-page application with wallet connection, EIP-4361 authentication, cross-tab Bearer token synchronization, canonical deal creation, transaction tracking, dispute management, and consensus voting consoles.
- Automated verification pipelines including unit tests, fuzz testing, integration tests, and Playwright end-to-end browser automation.

### Current Scope Boundaries

- **Asset Support**: Currently supports native AVAX. ERC-20 token escrow is architecturally planned for future releases.
- **Arbitration Triad**: Supports a single 3-party dispute consensus model (buyer, seller, designated arbiter) per deal with a 14-day timeout fallback. Multi-signature juror pools and decentralized staking juries remain prospective future roadmap items.
- **Blockchain Networks**: Verified against Avalanche C-Chain Fuji testnet (`chainId: 43113`) and local Foundry Anvil (`chainId: 31337`).

---

## 13. Documentation Index

Comprehensive technical documentation is maintained within the `docs/` directory:

### Core Architecture and Engineering

- [Project Overview](docs/00-overview.md): System goals, trust boundaries, and problem framing.
- [Requirements Specification](docs/01-requirements.md): Functional and non-functional requirements.
- [System Architecture](docs/02-architecture.md): Clean Architecture, module boundaries, and synchronization diagrams.
- [Database Design](docs/03-database-design.md): PostgreSQL schema, unique constraints, and indexing indexes.
- [REST API Contracts](docs/04-api-contracts.md): Endpoint reference, authentication headers, error envelopes, and [OpenAPI 3.0 Specification](docs/openapi.json).
- [Business Flows](docs/05-business-flows.md): Sequence diagrams for trade lifecycles, disputes, and recovery.
- [State Machines](docs/06-state-machines.md): On-chain and off-chain status transition matrices.
- [Smart Contract Design](docs/07-smart-contract-design.md): Pull-payment mechanics, security invariants, and gas optimization.
- [Security Strategy](docs/08-security.md): Threat modeling, SIWE authentication, and file security.
- [Deployment Strategy](docs/09-deployment.md): Multi-stage containerization and cloud infrastructure specifications.
- [Testing Strategy](docs/10-testing-strategy.md): Foundry invariants, ArchUnit checks, Vitest, and Playwright suites.

### Operations and Deployment Guides

- [Configuration Guide](docs/11-configuration-guide.md): Complete environment variable reference.
- [Local Development Walkthrough](docs/12-local-development.md): Step-by-step setup guide for local environments.
- [Avalanche Fuji Setup](docs/13-fuji-setup.md): Testnet deployment and verification walkthrough.
- [Railway and Vercel Setup](docs/14-railway-setup.md): Cloud hosting configuration guide.
- [Troubleshooting Guide](docs/15-troubleshooting.md): Diagnostics for common connectivity, SIWE, and sync issues.
- [Hackathon Dossier](docs/16-hackathon-submission.md): Submission ledger and project deliverables.

---

## 14. License

SafeDeal is open-source software licensed under the [MIT License](backend/Cargo.toml).
