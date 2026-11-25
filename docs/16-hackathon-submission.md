# Competition Submission Summary & Known Scope Boundaries (SEApp UIT — Bảng App)

## 1. Project Identity

- **Project Name**: **SafeDeal** — Decentralized Non-Custodial P2P Escrow & Browser Companion on Avalanche C-Chain
- **Competition & Category**: **SEApp UIT (Bảng App)** — Khoa Công nghệ Phần mềm (Faculty of Software Engineering), Trường Đại học Công nghệ Thông tin – ĐHQG TP.HCM (UIT)
- **Repository Root**: Modular monorepo (`blockchain/`, `backend/`, `frontend/`, `extension/`, `infra/`, `scripts/`, `docs/`)
- **Vietnamese Submission & Booth Playbook**: [`docs/17-seapp-uit-submission.md`](./17-seapp-uit-submission.md)

## 2. Deployment & Live Endpoints

- **Live Web App (Firebase Hosting)**: `https://avalanche-9b099.web.app/`
- **Live Backend API (Railway)**: `https://safedeal-production.up.railway.app` (`/api/v1/health/ready`)
- **Browser Companion (`extension/`)**: `SafeDeal Escrow Companion — Avalanche P2P Verifier` (Manifest V3 Chrome Extension — Load unpacked from `/extension`)
- **Network**: Avalanche Fuji C-Chain (`chainId = 43113`)
- **Escrow Contract Address**: `0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`
- **Deployment Transaction Hash**: `0x13fa645cc49962284c412e3b2fce0cb38c3b63796b1a72593ade725d44fe7fc3`
- **Snowtrace Explorer URL**: `https://testnet.snowtrace.io/address/0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`
- **Deployment Block (`ESCROW_DEPLOYMENT_BLOCK`)**: `61432299`

## 3. Architectural Decisions & Deliverables Traceability Summary

SafeDeal satisfies all **16 Core Architectural Decisions** and **6 Production Deliverables** catalogued in [`01-requirements.md`](./01-requirements.md):
- **Pull-Payment Escrow (`SafeDealEscrow.sol`)**: Native AVAX custody with zero admin keys, CEI + `ReentrancyGuard`, recipient failure isolation (`withdraw()`), open-buyer single binding, seller pre-funding cancel/voluntary refund, overdue deadline refund, and **2-of-3 multi-party dispute consensus (`submitResolutionVote`) + 14-day 50/50 timeout fallback (`resolveDisputeByTimeout`)**.
- **Cross-Stack Canonical Terms (`RFC 8785`)**: Bit-identical canonical JSON + SHA-256 `termsHash` computed independently in browser TypeScript (`canonical-terms.ts`), Manifest V3 Chrome Extension (`extension/shared/canonical-terms.js`), and Rust backend (`crates/domain/src/canonical_terms.rs`), verified against on-chain `TradeCreated` events and `getTrade`.
- **Defense-in-Depth Web2.5 Backend (Rust 1.91+ / Axum 0.8)**: EIP-4361 SIWE with atomic single-use nonces (`k256` + `sha3`) and expired-nonce cleanup, dual-mode `HttpOnly` HS256 JWT + Double-Submit CSRF (`csrf_protection_middleware`) paired with cross-origin `Authorization: Bearer` fallback, peer-IP auth rate limiting (`AuthRateLimitState` via `ConnectInfo<SocketAddr>`), 5-crate Cargo workspace + `architecture_dag.rs` enforced Clean Architecture boundaries, non-transactional `AlloyBlockchainGateway` RPC boundaries, magic-byte & SHA-256 verified evidence attachments (`local` and `s3`/R2 adapters), `GET /api/v1/health/ready`, and verified `docs/openapi.json` contract parity.
- **Preserved Editorial Landing Page + SEApp Booth UX**: Exact Foldcraft video hero Landing Page (`/`) untouched (`LandingPage.tsx`), paired with strict-TypeScript deal authoring (`CreateDealPage` with 1-click SEApp UIT Student Deal Templates, pre-flight Fuji Faucet balance check, and reload-safe pending/pre-bind recovery), lifecycle reconciliation (`/deals/:id`), paginated portfolio & claim banner (`/dashboard`), authenticated Blob evidence download & 2-of-3 voting (`/disputes/:id`), and arbitration console (`/arbiter`).
- **Manifest V3 Chrome Extension (`extension/`)**: Complies with all 20 Mandatory Chrome Extension MV3 rules (`openPanelOnActionClick: true`, real 16/48/128 PNG icons, zero inline/eval scripts, `chrome.storage.local` + `chrome.alarms`, `requestAnimationFrame` + `scheduler.yield()` batched Shadow DOM link verification, context-menu deal draft capture with toast confirmation, and complete `CHROMEWEBSTORE.md` store listing).

## 4. Verification Highlights

- **Smart Contracts (`forge build --root blockchain --force && forge test --root blockchain -vvv`)**: `0` compiler/linter warnings and 20 tests passing cleanly across unit, security attack/griefing, and `64 x 2048` stateful solvency invariant fuzz suites.
- **Backend (`cargo fmt --check && cargo clippy -D warnings && cargo test --workspace && cargo build --release`)**: `architecture_dag` boundary suite, `gateway_wiremock_test` RPC decoding/error tests, `openapi_contract` parity check against `docs/openapi.json`, `siwe_security_it`, `deals_disputes_it`, `indexer_idempotency_it`, and `live_anvil_e2e` suites.
- **Frontend (`typecheck && lint && test && build && test:e2e`)**: Strict TS (`no-explicit-any: error`), zero-warning ESLint, Vitest unit/integration suites, Vite production bundle, and Playwright Chromium audits across `1440x900`, `768x1024`, and `390x844`.
- **Chrome Extension (`node extension/verify-extension.mjs`)**: Automated validation of `manifest.json`, PNG icon headers/dimensions, and RFC 8785 `termsHash` vector parity with `frontend/src/utils/canonical-terms.ts`.
- **Unmocked 3-Tier Live E2E (`bash scripts/e2e-live.sh`)**: Real headless Chromium -> built Vite app -> `safedeal-api` Rust binary -> live Anvil node exercising cooperative, voluntary open-buyer refund, and 2-of-3 dispute/PNG evidence/outsider-`403`/withdrawal lifecycles without mocks.

## 5. Known Limitations & Trust Boundaries

1. **SLA Arbiter & 14-Day Fallback Game Theory**: Cooperative release and deadline refunds require no arbiter intervention; when escalated to `DISPUTED`, settlement uses 2-of-3 consensus across `[buyer, seller, arbiter]` (preventing unilateral arbiter bias) with a 14-day 50/50 stalemate timeout fallback (`resolveDisputeByTimeout`). Active SLA arbiters resolve legitimate seller deliveries within 24–48 hours (`100%` seller vote by Arbiter + Seller = 2-of-3 consensus) long before the 14-day emergency fallback; V2 roadmap adds `claimAfterInspection` auto-release and multi-sig/decentralized arbitration panels.
2. **Native AVAX Scope & ERC-20 Roadmap**: Current V1 vault accounting handles native gas currency (AVAX) to eliminate ERC-20 allowance/fee-on-transfer attack surfaces; V2 adds `SafeERC20` support for native Avalanche `USDC` and `USDT`.
3. **In-Memory Auth Rate Limiter**: `AuthRateLimitState` targets single-node deployments; evidence attachments support both `local` and S3/R2 (`S3EvidenceStorage`), while multi-replica horizontal scaling should migrate rate-limit counters to Redis.
4. **Polling Refresh Cadence**: Deal/dispute detail pages poll at `VITE_TX_POLL_INTERVAL_MS` rather than holding persistent WebSocket subscriptions.
