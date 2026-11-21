# Hackathon Submission Summary & Known Scope Boundaries (UNIHACK 2026)

## 1. Project Identity

- **Project Name**: **SafeDeal** — Decentralized Non-Custodial P2P Escrow on Avalanche C-Chain
- **Track / Context**: UNIHACK 2026 — Trust-Minimized Web3 P2P Commerce
- **Repository Root**: Modular monorepo (`blockchain/`, `backend/`, `frontend/`, `infra/`, `scripts/`, `docs/`)

## 2. Deployment & Live Endpoints

- **Live Web App (Firebase Hosting)**: `https://avalanche-9b099.web.app/`
- **Live Backend API (Railway)**: `https://safedeal-production.up.railway.app` (`/api/v1/health/ready`)
- **Network**: Avalanche Fuji C-Chain (`chainId = 43113`)
- **Escrow Contract Address**: `0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`
- **Deployment Transaction Hash**: `0x13fa645cc49962284c412e3b2fce0cb38c3b63796b1a72593ade725d44fe7fc3`
- **Snowtrace Explorer URL**: `https://testnet.snowtrace.io/address/0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`
- **Deployment Block (`ESCROW_DEPLOYMENT_BLOCK`)**: `61432299`

## 3. Pre-Project Decisions & Sprint 0 Traceability Summary

SafeDeal satisfies all **16 Pre-Project Architectural Decisions** and **5 Sprint 0 Deliverables** catalogued in [`01-requirements.md`](./01-requirements.md):
- **Pull-Payment Escrow (`SafeDealEscrow.sol`)**: Native AVAX custody with zero admin keys, CEI + `ReentrancyGuard`, recipient failure isolation (`withdraw()`), open-buyer single binding, seller pre-funding cancel/voluntary refund, overdue deadline refund, and **2-of-3 multi-party dispute consensus (`submitResolutionVote`) + 14-day 50/50 timeout fallback (`resolveDisputeByTimeout`)**.
- **Cross-Stack Canonical Terms (`RFC 8785`)**: Bit-identical canonical JSON + SHA-256 `termsHash` computed independently in browser TypeScript (`canonical-terms.ts`) and Rust backend (`crates/domain/src/canonical_terms.rs`), verified against on-chain `TradeCreated` events and `getTrade`.
- **Defense-in-Depth Web2.5 Backend (Rust)**: EIP-4361 SIWE with atomic single-use nonces (`k256` + `sha3`), `HttpOnly` HS256 JWT + Double-Submit CSRF (with cross-tab bearer fallback), peer-IP auth rate limiting (`AuthRateLimitState`), Cargo workspace + `architecture_dag.rs` enforced Clean Architecture boundaries, non-transactional `AlloyBlockchainGateway` RPC boundaries, magic-byte validated evidence attachments (`local` and `s3`/R2 adapters), `GET /api/v1/health/ready`, and verified `docs/openapi.json` contract parity.
- **Preserved Editorial Landing Page + Reload-Safe Web3 UI**: Exact Foldcraft video hero Landing Page (`/`) untouched (`LandingPage.tsx`), paired with strict-TypeScript deal authoring (`CreateDealPage` reload-safe pending/pre-bind recovery), lifecycle reconciliation (`/deals/:id`), portfolio claim banner (`/dashboard`), evidence management (`/disputes/:id`), and arbitration console (`/arbiter`).

## 4. Verification Highlights

- **Smart Contracts (`forge test --root blockchain -vvv`)**: 20 tests passing cleanly across unit, security attack/griefing, and `64 x 2048` stateful solvency invariant fuzz suites.
- **Backend (`cargo fmt --check && cargo clippy -D warnings && cargo test --workspace && cargo build --release`)**: `architecture_dag` boundary suite, `gateway_wiremock_test` RPC decoding/error tests, `openapi_contract` parity check against `docs/openapi.json`, `siwe_security_it`, `deals_disputes_it`, `indexer_idempotency_it`, and `live_anvil_e2e` suites.
- **Frontend (`typecheck && lint && test && build && test:e2e`)**: Strict TS (`no-explicit-any: error`), zero-warning ESLint, Vitest unit/integration suites (70 tests across 10 files), Vite production bundle, and Playwright Chromium audits (30 tests across `1440x900`, `768x1024`, and `390x844`, including Foldcraft CSS/video/animation checks and fault-injection reload recovery).
- **Unmocked 3-Tier Live E2E (`bash scripts/e2e-live.sh`)**: Real headless Chromium -> built Vite app -> `safedeal-api` Rust binary -> live Anvil node exercising cooperative, voluntary open-buyer refund, and 2-of-3 dispute/PNG evidence/outsider-`403`/withdrawal lifecycles without mocks.

## 5. Known Limitations & Trust Boundaries

1. **Trusted Arbiter Role on Disputed Deals**: Cooperative release and deadline refunds require no arbiter intervention; when escalated to `DISPUTED`, settlement uses 2-of-3 consensus across `[buyer, seller, arbiter]` (preventing unilateral arbiter bias) with a 14-day 50/50 stalemate timeout fallback. Future versions can swap the arbiter address for a multi-sig, DAO, or decentralized arbitration panel.
2. **Native AVAX Scope**: Current vault accounting handles native gas currency (AVAX) without ERC-20 allowance/fee-on-transfer edge cases.
3. **In-Memory Auth Rate Limiter**: `AuthRateLimitState` targets single-node deployments; evidence attachments already support both `local` and S3/R2 (`S3EvidenceStorage`), while multi-replica horizontal scaling should migrate rate-limit counters to Redis.
4. **Polling Refresh Cadence**: Deal/dispute detail pages poll at `VITE_TX_POLL_INTERVAL_MS` rather than holding persistent WebSocket subscriptions.
