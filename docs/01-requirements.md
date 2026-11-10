# Requirements & UNIHACK 2026 Engineering Decisions

## 1. Problem Statement & Scope

Peer-to-peer online transactions frequently stall because neither party wants to assume counterparty risk: buyers fear sending non-reversible transfers without guaranteed delivery, while sellers fear handing over software, IP, or goods without guaranteed payout. Existing escrow services rely on centralized custody, creating platform lock-in, high fees, and counterparty opacity.

SafeDeal solves this with a non-custodial Avalanche C-Chain escrow contract paired with deterministic off-chain terms commitments (`termsHash`), authenticated Web2 coordination, and private dispute evidence management.

## 2. Alignment with UNIHACK 2026: 16 Pre-Project Decisions

Every foundational architecture and product decision is codified in code, build scripts, and tests:

| # | Pre-Project Decision | Realized Implementation |
|---|---|---|
| 1 | **Non-custodial native asset escrow** | `SafeDealEscrow.sol` locks native AVAX (`payable fundTrade`) with zero admin/owner sweep backdoors. |
| 2 | **Single clean monorepo layout** | Top-level `frontend/`, `backend/`, `blockchain/`, `infra/`, `scripts/`, `docs/` directories. |
| 3 | **Deterministic off-chain commercial terms** | Shared RFC 8785 Canonical JSON + SHA-256 hashing (`CanonicalTermsHasher.java` & `canonical-terms.ts`). |
| 4 | **Three distinct protocol roles** | Immutable per trade: `seller`, `buyer` (preassigned or bound on first valid `fundTrade`), and `arbiter` (`seller != arbiter`, `buyer != arbiter`, `buyer != seller`). |
| 5 | **Open-buyer vs. preassigned deals** | `preassignedBuyer == address(0)` permits shareable link funding by any eligible external buyer, then locks `buyer` permanently on-chain. |
| 6 | **Pull-payment settlement over push payouts** | Settlement transitions credit `_claimableBalances` + `_totalClaimable`; recipients call `withdraw()` under `ReentrancyGuard`. |
| 7 | **Seller-only pre-funding cancellation & voluntary refund** | `cancelUnfundedTrade` (`CREATED -> CANCELLED`) and `refundBySeller` (`FUNDED -> REFUNDED`) isolate legitimate seller exits. |
| 8 | **Buyer inspection window protection** | Configurable `inspectionWindow` (`>= 1h`, `<= 30d` in off-chain policy) blocks premature seller disputes on `DELIVERED` deals until `deliveredAt + inspectionWindow` elapses. |
| 9 | **Split arbitration allocation** | `resolveDispute(tradeId, buyerAmount, sellerAmount)` requires `buyerAmount + sellerAmount == trade.amount`, returning `0` fee to `arbiter`. |
| 10 | **Wallet-native passwordless authentication** | EIP-4361 SIWE via Web3j `ecrecover` with atomic PostgreSQL single-use nonces (`consumeOnce`). |
| 11 | **XSS/CSRF-hardened web sessions** | HS256 JWT stored solely in `HttpOnly` cookie (`safedeal_session`) paired with Double-Submit CSRF (`safedeal_csrf` + `X-CSRF-Token`). |
| 12 | **Strict backend Clean Architecture** | Four concentric layers (`domain/`, `application/`, `infrastructure/`, `presentation/`) enforced in CI by `ModuleBoundaryArchTest` (ArchUnit). |
| 13 | **Connection-pool safe blockchain calls** | Web3j RPC reads (`inspectTransaction`, `fetchTrade`, `fetchLogs`) execute outside database transactions (`TransactionOperations` wraps short ACID writes only). |
| 14 | **Contract-first OpenAPI specification** | SpringDoc output continuously verified against committed [`docs/openapi.json`](./openapi.json) via `OpenApiContractVerificationTest`. |
| 15 | **Binary-validated private dispute evidence** | `LocalEvidenceStorageAdapter` validates MIME allowlist + magic bytes + size bounds + UUID normalized paths, accessible exclusively to trade `seller`, `buyer`, and `arbiter`. |
| 16 | **Immutable Foldcraft editorial landing page** | `/` preserves exact Foldcraft hero media, typography, staggered motion, and responsive navigation breakpoints while functional dApp workflows operate on dedicated routes. |

## 3. Alignment with Sprint 0 Deliverables (5 Core Artifacts)

| # | Sprint 0 Deliverable | Verification & Location |
|---|---|---|
| 1 | **Verified Escrow Smart Contract + Security/Invariant Tests** | `blockchain/src/SafeDealEscrow.sol`, `SafeDealEscrow.t.sol`, `EscrowSecurity.t.sol`, `EscrowInvariant.t.sol` (`forge test --root blockchain -vvv`). |
| 2 | **PostgreSQL Schema + ArchUnit Clean Modular Backend** | `backend/src/main/resources/db/migration/V1__initial_schema.sql`, ArchUnit `ModuleBoundaryArchTest`, integration & security test suites (`./backend/gradlew -p backend test bootJar`). |
| 3 | **OpenAPI Contract + Backend Readiness Probe** | Committed [`docs/openapi.json`](./openapi.json), `GET /api/v1/health`, and `GET /api/v1/health/ready`. |
| 4 | **Frontend Type-Safe Web3 Workflows + Preserved Landing Page** | Strict TypeScript React app (`LandingPage.tsx`, `CreateDealPage.tsx` reload-safe recovery, `DealDetailsPage.tsx`, `DashboardPage.tsx`, `DisputePage.tsx`, `ArbiterPage.tsx`, `SupportPage.tsx`). |
| 5 | **One-Command Verification & Unmocked 3-Tier Live E2E Harness** | `scripts/verify.sh` + `scripts/e2e-live.sh` + `.github/workflows/*.yml` + complete 20-document specification set. |

## 4. Functional Requirements

- **FR-1 Identity & Sessions**: Authenticate Ethereum addresses via EIP-4361 SIWE (`POST /api/v1/auth/nonce`, `/verify`), inspect current session (`/me`), and clear session (`/logout`).
- **FR-2 Deal Authoring & Canonical Commitment**: Prepare off-chain drafts (`/api/v1/deals/drafts`), cross-verify client & server SHA-256 `termsHash`, persist reload-safe creation progress on `/create`, broadcast `createTrade(...)`, and bind verified receipts (`/bind-tx`).
- **FR-3 Escrow Execution & Synchronization**: Execute `fundTrade`, `markDelivered`, `releaseFunds`, `cancelUnfundedTrade`, `refundBySeller`, `refundAfterDeadline`, and `withdraw` directly from user wallets and reconcile backend projections (`/sync` + background `BlockchainEventIndexerService`).
- **FR-4 Dispute Filing, Evidence & Arbitration**: Open on-chain disputes (`/deals/{tradeId}/disputes`), upload/download binary-verified evidence (`/disputes/{disputeId}/evidence`), list arbiter-assigned cases (`/arbitration/disputes`), and settle split allocations (`/arbitration/disputes/{disputeId}/resolution`).
- **FR-5 Operational Diagnostics**: Provide liveness (`/api/v1/health`), dependency readiness (`/api/v1/health/ready` probing SQL `SELECT 1`, evidence directory writability, SIWE parameters, and escrow contract configuration), and UI status diagnostics (`/support`).

## 5. Non-Functional Requirements

- **Zero Float Money Arithmetic**: `amountWei`, `buyerAmountWei`, and `sellerAmountWei` use arbitrary-precision integer strings on HTTP/SQL and native `bigint` (`viem.parseEther`/`formatEther`) in frontend UI.
- **No Unaudited Configuration**: Non-local `prod`/`staging` profiles fail fast on startup if `JWT_SECRET` is weak or placeholder-like, cookies are non-secure, CORS contains `*`, or endpoints reference loopback addresses.
- **Responsive Multi-Viewport UI**: Zero horizontal overflow across Desktop (`1440px`), Tablet (`768px`), and Mobile (`390px`) with WCAG-friendly keyboard focus, explicit form `<label>` associations, and zero runtime console/page errors.
