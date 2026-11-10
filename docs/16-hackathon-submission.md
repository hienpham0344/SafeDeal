# Hackathon Submission Summary & Known Scope Boundaries (UNIHACK 2026)

## 1. Project Identity

- **Project Name**: **SafeDeal** — Decentralized Non-Custodial P2P Escrow on Avalanche C-Chain
- **Track / Context**: UNIHACK 2026 — Trust-Minimized Web3 P2P Commerce
- **Repository Root**: Modular monorepo (`blockchain/`, `backend/`, `frontend/`, `infra/`, `scripts/`, `docs/`)

## 2. Deployment & Explorer Placeholders (Honesty Policy)

No unverified mainnet/testnet contract hashes are fabricated in source control:
- **Network**: Avalanche Fuji C-Chain (`chainId = 43113`)
- **Escrow Contract Address**: `<DEPLOYED_FUJI_ADDRESS>` *(populated only after executing `bash scripts/deploy-fuji.sh`)*
- **Deployment Transaction Hash**: `<FUJI_DEPLOY_TX_HASH>`
- **Snowtrace Explorer URL**: `https://testnet.snowtrace.io/address/<DEPLOYED_FUJI_ADDRESS>`
- **Deployment Block (`ESCROW_DEPLOYMENT_BLOCK`)**: `<DEPLOYMENT_BLOCK>`

## 3. Pre-Project Decisions & Sprint 0 Traceability Summary

SafeDeal satisfies all **16 Pre-Project Architectural Decisions** and **5 Sprint 0 Deliverables** catalogued in [`01-requirements.md`](./01-requirements.md):
- **Pull-Payment Escrow (`SafeDealEscrow.sol`)**: Native AVAX custody with zero admin keys, CEI + `ReentrancyGuard`, recipient failure isolation (`withdraw()`), open-buyer single binding, seller pre-funding cancel/voluntary refund, overdue deadline refund, and mathematically constrained arbiter splits (`buyerAmount + sellerAmount == amount`).
- **Cross-Stack Canonical Terms (`RFC 8785`)**: Bit-identical canonical JSON + SHA-256 `termsHash` computed independently in browser TypeScript (`canonical-terms.ts`) and Java backend (`CanonicalTermsHasher.java`), verified against on-chain `TradeCreated` events and `getTrade`.
- **Defense-in-Depth Web2.5 Backend**: EIP-4361 SIWE with atomic single-use nonces, `HttpOnly` HS256 JWT + Double-Submit CSRF, spoof-proof `remoteAddr` auth rate limiting, ArchUnit-enforced Clean Architecture boundaries, non-transactional Web3j RPC boundaries, magic-byte validated evidence attachments, `GET /api/v1/health/ready`, and verified `docs/openapi.json` contract parity.
- **Preserved Editorial Landing Page + Reload-Safe Web3 UI**: Exact Foldcraft video hero Landing Page (`/`) untouched (`LandingPage.tsx`), paired with strict-TypeScript deal authoring (`CreateDealPage` reload-safe pending/pre-bind recovery), lifecycle reconciliation (`/deals/:id`), portfolio claim banner (`/dashboard`), evidence management (`/disputes/:id`), and arbitration console (`/arbiter`).

## 4. Verification Highlights

- **Smart Contracts (`forge test --root blockchain -vvv`)**: Unit, security attack/griefing, and `64 x 32` stateful solvency invariant fuzz suites passing cleanly.
- **Backend (`./backend/gradlew -p backend test bootJar`)**: ArchUnit boundary suite, readiness controller tests, OpenAPI parity check against `docs/openapi.json`, SIWE/CSRF security tests, multi-actor dispute/evidence integration tests, and idempotent `(tx_hash, log_index)` indexer tests passing cleanly.
- **Frontend (`typecheck && lint && test && build && test:e2e`)**: Strict TS (`no-explicit-any: error`), zero-warning ESLint, Vitest unit/integration suites (33 tests across 5 files), Vite production bundle, and Playwright Chromium audits across `1440x900`, `768x1024`, and `390x844` (including Foldcraft CSS/video/animation checks, PNG screenshots, and fault-injection reload recovery).
- **Unmocked 3-Tier Live E2E (`bash scripts/e2e-live.sh`)**: Real headless Chromium -> built Vite app -> packaged `safedeal-api.jar` -> live Anvil node exercising cooperative, voluntary open-buyer refund, and dispute/PNG evidence/outsider-`403`/arbiter-split/withdrawal lifecycles without mocks.

## 5. Known Limitations & Trust Boundaries

1. **Human Arbiter Trust on Disputed Deals**: Cooperative release and deadline refunds require no arbiter intervention; however, if escalated to `DISPUTED`, the immutable `arbiter` selected at `createTrade` holds trusted discretion to allocate the escrowed split. Future versions can swap in multi-sig, DAO, or decentralized arbitration panels.
2. **Native AVAX Scope**: Current vault accounting handles native gas currency (AVAX) without ERC-20 allowance/fee-on-transfer edge cases.
3. **Single-Host Local Evidence & In-Memory Auth Rate Limiter**: `LocalEvidenceStorageAdapter` and `AuthRateLimitFilter` target single-node / sticky-volume deployments (`EVIDENCE_STORAGE_DIR`); multi-replica horizontal scaling should migrate attachments to S3/R2 (`EvidenceStoragePort`) and counters to Redis.
4. **Polling Refresh cadence**: Deal/dispute detail pages poll at `VITE_TX_POLL_INTERVAL_MS` rather than holding persistent WebSocket subscriptions.
