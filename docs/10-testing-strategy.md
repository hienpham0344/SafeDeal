# Testing & QA Strategy

SafeDeal verifies correctness across four layers — Solidity smart contracts, the Rust Axum clean-architecture API, React/TypeScript frontend, and an unmocked 3-tier `Browser -> Frontend -> Backend binary -> Anvil` integration suite.

## 1. Smart Contract Tests (`blockchain/test/*.t.sol`)

```bash
forge test --root blockchain -vvv
```

- [`SafeDealEscrow.t.sol`](../blockchain/test/SafeDealEscrow.t.sol): Covers preassigned & open-buyer deal creation, funding, delivery marking, release, pull withdrawal, cancellation, seller & overdue refunds, inspection window enforcement, and arbiter split arbitration.
- [`EscrowSecurity.t.sol`](../blockchain/test/EscrowSecurity.t.sol): Exercises malicious reentrancy contracts (`ReentrancyAttacker`), reverting griefing recipients (`RevertingRecipient` proving counterparty isolation), direct transfer blocking, role spoofing, deadline violations, and invalid split sums.
- [`EscrowInvariant.t.sol`](../blockchain/test/EscrowInvariant.t.sol): Stateful fuzzing (`64` runs x `32` depth) asserting at every random action:
  - `address(escrow).balance >= totalLockedEscrow + totalClaimable`
  - Exact equality between summed claimable balances and `totalClaimable`
  - Exact equality between active funded/delivered/disputed trades and `totalLockedEscrow`

## 2. Backend Verification (`backend/tests/**` + crate unit tests)

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml --workspace -- --test-threads=1
```

Integration tests need a PostgreSQL database (`SAFEDEAL_TEST_DB_URL` / `TEST_DATABASE_URL`, default `postgres://safedeal:safedeal@127.0.0.1:5432/safedeal_test`; start one with `scripts/dev-db.sh`).

- **Architecture Rules ([`architecture_dag.rs`](../backend/tests/architecture_dag.rs))**: Verifies the Cargo crate DAG (`domain`/`application` free of `sqlx`, `axum`, `tower`, `reqwest`, `alloy-provider`; `presentation -> application` layering) and zero OpenSSL linkage.
- **OpenAPI Contract Parity ([`openapi_contract.rs`](../backend/tests/openapi_contract.rs))**: Fetches live `/v3/api-docs` and asserts structural JSON equality against committed [`docs/openapi.json`](./openapi.json); also checks Swagger UI enable/disable behaviour.
- **SIWE & Security ([`siwe_security_it.rs`](../backend/tests/siwe_security_it.rs))**: Nonce issuance/consumption, signature verification, session cookie, CSRF, and auth rate limiting.
- **Deal, Dispute & Arbitration Workflows ([`deals_disputes_it.rs`](../backend/tests/deals_disputes_it.rs))**: Participant/arbiter authorization, evidence upload/download, and state transitions.
- **Indexer Idempotency ([`indexer_idempotency_it.rs`](../backend/tests/indexer_idempotency_it.rs))**: Replayed chain logs never duplicate events or regress deal state.
- **RPC Gateway ([`gateway_wiremock_test.rs`](../backend/tests/gateway_wiremock_test.rs))**: `AlloyBlockchainGateway` decoding, timeouts, and RPC error mapping against a Wiremock JSON-RPC server.
- **Crate Unit Tests**: `CanonicalTermsHasher` golden vectors shared with the frontend, `DealStatus` transitions, config/production validation, `K256SignatureVerifier`, storage adapters.
- **Live Anvil Test ([`live_anvil_e2e.rs`](../backend/tests/live_anvil_e2e.rs))**: Spawns a real Anvil node, deploys `SafeDealEscrow`, and exercises cooperative, dispute, evidence upload/download, and withdrawal flows via real HTTP requests and Ethereum signatures (requires Foundry on `PATH`).

## 3. Frontend Verification & Browser E2E (`frontend/tests/**`)

```bash
npm --prefix frontend run typecheck && \
npm --prefix frontend run lint && \
npm --prefix frontend test && \
npm --prefix frontend run build && \
npm --prefix frontend run test:e2e
```

- **Vitest Unit & Integration Suites (`frontend/tests/unit/`, `frontend/tests/integration/`)**:
  - `canonical-terms.test.ts` (RFC 8785 deterministic hashing matching the Rust backend byte-for-byte).
  - `format-and-schemas.test.ts` (wei/AVAX conversion, zero-address rejection, env parser validation).
  - `LandingPage.test.tsx` (Foldcraft hero video, CSS/motion classes, mobile drawer structure).
  - `AuthSessionProvider.test.tsx` (SIWE login/logout race safety, wallet mismatch cleanup, and cross-account query cache invalidation).
  - `WorkflowPages.test.tsx` (role action gating, `/create` pending tx & confirmed pre-bind reload recovery, **Retry Backend Binding**, **Edit Draft**, `/deals/:id` `openDispute` recovery, `/arbiter` rationale backfill retry, and arbiter split sum check).
- **Default Playwright E2E Suite (`desktop` 1440x900, `tablet` 768x1024, `mobile` 390x844)**:
  - [`landing-and-responsive.spec.ts`](../frontend/tests/e2e/landing-and-responsive.spec.ts): Asserts `/icons/favicon.svg`, `Geist` font family, `<video>` geometry (`objectFit: cover`, `objectPosition: 70% 50%`), `fadeSlideUp` delays (`0.2s`/`0.4s`/`0.7s`/`0.9s`), navbar single-row alignment, zero horizontal overflow across all routes, mobile drawer transitions, and exports PNG visual screenshots under `frontend/test-results/visual-audit/`.
  - [`app-flows-and-errors.spec.ts`](../frontend/tests/e2e/app-flows-and-errors.spec.ts): Verifies `/support` health (`UP`/`503`), 404 handling, `/create` Zod validation, SIWE login & signature rejection (`4001`), `Wrong Network` switching, temporary `503` bind-tx failure across reload + `409` duplicate tx recovery without re-submitting `createTrade`.

## 4. Full Unmocked 3-Tier Live Browser E2E (`scripts/e2e-live.sh`)

```bash
bash scripts/e2e-live.sh
```

Launches a real ephemeral Anvil node (`127.0.0.1:18545`), deploys `SafeDealEscrow.sol`, builds and starts the release `safedeal-api` binary against PostgreSQL (`DB_URL` / `DATABASE_URL`), builds & serves the real Vite production app, injects real `viem` EIP-1193 wallets with zero HTTP route interception (`LIVE_E2E_ENABLED=1`), verifies `smoke-test.sh` & `/api/v1/health/ready`, and runs all 3 full multi-actor browser lifecycles (Cooperative settlement, Open-Buyer Voluntary Refund, Dispute + real PNG upload/download + outsider `403` + Arbiter split `RESOLVED` + pull withdrawals to `0n`).

## 5. Monorepo Full Gate

```bash
bash scripts/verify.sh
```
