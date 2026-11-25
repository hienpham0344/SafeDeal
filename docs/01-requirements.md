# Requirements & SEApp UIT Engineering Decisions

## 1. Problem Statement & Scope

Peer-to-peer online transactions among students, freelancers, and digital merchants frequently stall because neither party wants to assume counterparty risk: buyers fear sending non-reversible transfers without guaranteed delivery, while sellers fear handing over software, design deliverables, or hardware without guaranteed payout. Existing escrow services rely on centralized custody, creating platform lock-in, high fees, and counterparty opacity.

SafeDeal solves this for **SEApp UIT (Bảng App — Khoa Công nghệ Phần mềm, Trường Đại học Công nghệ Thông tin, ĐHQG-HCM)** with a non-custodial Avalanche C-Chain escrow contract paired with deterministic off-chain terms commitments (`termsHash`), a Clean Architecture Rust backend, a reload-safe React Web3 dApp, and the **`SafeDeal Escrow Companion` Manifest V3 Chrome Extension (`extension/`)**.

## 2. Alignment with SEApp UIT (Bảng App): 16 Core Engineering Decisions

Every foundational architecture and product decision is codified in code, build scripts, and automated tests:

| # | Architectural Decision | Realized Implementation |
|---|---|---|
| 1 | **Non-custodial native asset escrow** | `SafeDealEscrow.sol` locks native AVAX (`payable fundTrade`) with zero admin/owner sweep backdoors. |
| 2 | **Single clean monorepo layout** | Top-level `frontend/`, `backend/`, `blockchain/`, `extension/`, `infra/`, `scripts/`, `docs/` directories. |
| 3 | **Deterministic off-chain commercial terms** | Shared RFC 8785 Canonical JSON + SHA-256 hashing across Rust (`canonical_terms.rs`), React (`canonical-terms.ts`), and Chrome Extension (`extension/shared/canonical-terms.js`). |
| 4 | **Three distinct protocol roles** | Immutable per trade: `seller`, `buyer` (preassigned or bound on first valid `fundTrade`), and `arbiter` (`seller != arbiter`, `buyer != arbiter`, `buyer != seller`). |
| 5 | **Open-buyer vs. preassigned deals** | `preassignedBuyer == address(0)` permits shareable link funding by any eligible external buyer, then locks `buyer` permanently on-chain. |
| 6 | **Pull-payment settlement over push payouts** | Settlement transitions credit `_claimableBalances` + `_totalClaimable`; recipients call `withdraw()` under `ReentrancyGuard`. |
| 7 | **Seller-only pre-funding cancellation & voluntary refund** | `cancelUnfundedTrade` (`CREATED -> CANCELLED`) and `refundBySeller` (`FUNDED -> REFUNDED`) isolate legitimate seller exits. |
| 8 | **Buyer inspection window protection** | Configurable `inspectionWindow` (`>= 1h`, `<= 30d` in off-chain policy) blocks premature seller disputes on `DELIVERED` deals until `deliveredAt + inspectionWindow` elapses. |
| 9 | **2-of-3 Multi-Party Dispute Consensus + 14-Day Fallback** | `submitResolutionVote(tradeId, buyerAmount, sellerAmount)` settles immediately when any 2 of `[buyer, seller, arbiter]` vote for the same split (`buyerAmount + sellerAmount == trade.amount`, `0` fee to `arbiter`); if deadlocked for 14 days (`DISPUTE_TIMEOUT`), anyone can call `resolveDisputeByTimeout(tradeId)` for a deterministic 50/50 split. |
| 10 | **Wallet-native passwordless authentication** | EIP-4361 SIWE via `k256` secp256k1 recovery (`K256SignatureVerifier`) with atomic PostgreSQL single-use nonces (`consume_once`) and periodic expired-nonce cleanup. |
| 11 | **Dual-mode XSS/CSRF-hardened web sessions** | Signed HS256 JWT in `HttpOnly` cookie (`safedeal_session`) paired with Double-Submit CSRF (`safedeal_csrf` + `X-CSRF-Token`) for same-site browsers, plus cross-origin `Authorization: Bearer` token fallback for Firebase Hosting (`avalanche-9b099.web.app`) <-> Railway (`safedeal-production.up.railway.app`). |
| 12 | **Strict backend Clean Architecture** | Five Cargo workspace crates (`safedeal-shared`, `safedeal-domain`, `safedeal-application`, `safedeal-infrastructure`, `safedeal-presentation`) enforced at compile time and verified by `backend/tests/architecture_dag.rs` in CI. |
| 13 | **Connection-pool safe blockchain calls** | Alloy RPC reads (`inspect_transaction`, `fetch_trade`, `fetch_logs`) execute outside database transactions (`UnitOfWork::in_tx` wraps short ACID writes only). |
| 14 | **Contract-first OpenAPI specification** | `utoipa` output continuously verified against committed [`docs/openapi.json`](./openapi.json) via `backend/tests/openapi_contract.rs`. |
| 15 | **Binary-validated & SHA-256 verified private evidence** | `LocalEvidenceStorageAdapter` (and `S3EvidenceStorage`) validates MIME allowlist + magic bytes + size bounds + UUID paths + SHA-256 byte integrity on upload and download, accessible exclusively to trade `seller`, `buyer`, and `arbiter`. |
| 16 | **Immutable Foldcraft landing page + MV3 Chrome Extension** | `/` preserves exact Foldcraft hero media, typography, staggered motion, and responsive breakpoints, while `extension/` delivers a Manifest V3 Chrome Side Panel & content-script verifier for in-browser P2P commerce. |

## 3. Alignment with Core Deliverables (6 Production Artifacts)

| # | Core Deliverable | Verification & Location |
|---|---|---|
| 1 | **Verified Escrow Smart Contract + Security/Invariant Tests** | `blockchain/src/SafeDealEscrow.sol`, `SafeDealEscrow.t.sol`, `EscrowSecurity.t.sol`, `EscrowInvariant.t.sol` (`forge test --root blockchain -vvv`). |
| 2 | **PostgreSQL 12-Table Schema + Clean Modular Rust Backend** | `backend/migrations/*.sql`, crate-DAG test `backend/tests/architecture_dag.rs`, integration & security test suites (`cargo test --manifest-path backend/Cargo.toml --workspace -- --test-threads=1`). |
| 3 | **OpenAPI Contract + Backend Readiness Probe** | Committed [`docs/openapi.json`](./openapi.json), `GET /api/v1/health`, and `GET /api/v1/health/ready`. |
| 4 | **Frontend Type-Safe Web3 Workflows + Preserved Landing Page** | Strict TypeScript React app (`LandingPage.tsx`, `CreateDealPage.tsx` with 1-click SEApp UIT templates & reload-safe recovery, `DealDetailsPage.tsx`, `DashboardPage.tsx`, `DisputePage.tsx`, `ArbiterPage.tsx`, `SupportPage.tsx`). |
| 5 | **Manifest V3 Chrome Extension (`SafeDeal Escrow Companion`)** | `extension/manifest.json`, `service-worker.js`, `sidepanel/`, `content/deal-verifier.js`, `shared/canonical-terms.js`, `CHROMEWEBSTORE.md`, `verify-extension.mjs`. |
| 6 | **One-Command Verification & Unmocked 3-Tier Live E2E Harness** | `scripts/verify.sh` + `scripts/e2e-live.sh` + `.github/workflows/*.yml` + complete specification & SEApp UIT submission package (`docs/17-seapp-uit-submission.md`). |

## 4. Functional Requirements

- **FR-1 Identity & Sessions**: Authenticate Ethereum addresses via EIP-4361 SIWE (`POST /api/v1/auth/nonce`, `/verify`), inspect current session (`/me`), and clear session (`/logout`).
- **FR-2 Deal Authoring & Canonical Commitment**: Prepare off-chain drafts (`/api/v1/deals/drafts`), select 1-click SEApp UIT student deal templates, cross-verify client & server SHA-256 `termsHash`, persist reload-safe creation progress on `/create`, broadcast `createTrade(...)`, and bind verified receipts (`/bind-tx`).
- **FR-3 Escrow Execution & Synchronization**: Execute `fundTrade`, `markDelivered`, `releaseFunds`, `cancelUnfundedTrade`, `refundBySeller`, `refundAfterDeadline`, and `withdraw` directly from user wallets and reconcile backend projections (`/sync` + background `BlockchainEventIndexerService`).
- **FR-4 Dispute Filing, Evidence, 2-of-3 Consensus & 14-Day Timeout**: Open on-chain disputes (`/deals/{tradeId}/disputes` with automatic fallback indexing if opened directly on-chain), upload/download magic-byte & SHA-256 verified evidence (`/disputes/{disputeId}/evidence`), record 2-of-3 consensus split votes (`submitResolutionVote` -> `POST /api/v1/disputes/{disputeId}/votes` or `/api/v1/arbitration/disputes/{disputeId}/resolution`), and trigger or sync 14-day stalemate timeout resolution (`resolveDisputeByTimeout` -> `POST /api/v1/disputes/{disputeId}/timeout`).
- **FR-5 Operational Diagnostics & In-Browser Verification**: Provide liveness (`/api/v1/health`), dependency readiness (`/api/v1/health/ready` probing SQL `SELECT 1`, cached evidence directory writability, SIWE parameters, and escrow contract configuration), UI status diagnostics (`/support`), and zero-login on-chain verification via the Manifest V3 Chrome Extension Side Panel (`extension/`).

## 5. Non-Functional Requirements

- **Zero Float Money Arithmetic**: `amountWei`, `buyerAmountWei`, and `sellerAmountWei` use arbitrary-precision integer strings on HTTP/SQL and native `bigint` (`viem.parseEther`/`formatEther`) in frontend UI.
- **No Unaudited Configuration**: Non-local `prod`/`staging` profiles fail fast on startup (`AppConfig::validate`) if `JWT_SECRET` is weak or placeholder-like, cookies are non-secure, CORS contains `*`, or endpoints reference loopback addresses.
- **Responsive Multi-Viewport UI**: Zero horizontal overflow across Desktop (`1440px`), Tablet (`768px`), and Mobile (`390px`) with WCAG-friendly keyboard focus, explicit form `<label>` associations, and zero runtime console/page errors.
