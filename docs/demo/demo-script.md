# SafeDeal Live Demo Script (5 Minutes)

## Pre-Demo Readiness Checklist
- **Quick Automated Run (Anvil + packaged JAR + Vite preview)**: `bash scripts/e2e-live.sh`
- **Interactive Local Stack**:
  - Terminal 1: PostgreSQL (`bash scripts/dev-db.sh`) & Anvil (`bash scripts/dev-anvil.sh`)
  - Terminal 2: Deployed `SafeDealEscrow` (`bash scripts/deploy-local.sh`) & Spring Boot API (`bash scripts/dev-backend.sh`)
  - Terminal 3: React Vite frontend (`bash scripts/dev-frontend.sh`), browser ready with injected wallets for **Seller**, **Buyer**, **Arbiter**, and an **Outsider** account
  - Verify readiness: `bash scripts/smoke-test.sh` (confirms `/api/v1/health/ready` == `READY`)

## Walkthrough Script

1. **[0:00–0:45] Editorial Landing & Trust Boundary (`/`)**
   - Present the Foldcraft full-bleed hero (`/`) untouched while framing the P2P escrow boundary: AVAX held exclusively in `SafeDealEscrow.sol`, commercial terms anchored via RFC 8785 SHA-256 `termsHash`, private dispute files guarded by SIWE + `HttpOnly` cookies.
2. **[0:45–1:45] Deal Authoring, Canonical Hash Match & Reload Recovery (`/create`)**
   - Seller connects wallet and signs the EIP-4361 SIWE prompt (`safedeal_session` + `safedeal_csrf` issued).
   - Enter Buyer (or leave blank for an Open-Buyer link), Arbiter, AVAX amount, deadlines, inspection window, and deliverable terms.
   - Click **Preview On-Chain Transaction** -> show client/backend matching RFC 8785 `termsHash`.
   - Click **Create Trade On-Chain**, confirm tx, optionally demonstrate browser reload preserving pending/pre-bind recovery (**Retry Backend Binding**), and bind to `CREATED`.
3. **[1:45–3:00] Buyer Funding, Delivery & Pull-Payment Release (`/deals/:id`, `/dashboard`)**
   - Switch to Buyer wallet -> SIWE login -> click **Fund Escrow** (`fundTrade{value: amount}`). Show deal synced to `FUNDED` and locked.
   - Switch to Seller -> click **Mark Delivered** (`markDelivered` -> `DELIVERED`).
   - Switch to Buyer -> click **Approve & Release Funds** (`releaseFunds` -> `RELEASED`).
   - Switch to Seller (`/dashboard` or `/deals/:id`) -> point out claimable payout banner and withdraw native AVAX via **Withdraw AVAX** (`withdraw()`).
4. **[3:00–4:30] Dispute, Magic-Byte Evidence & Split Arbitration (`/deals/:id` -> `/disputes/:id` -> `/arbiter`)**
   - On a second `FUNDED` deal, Buyer clicks **Open Dispute** (`openDispute`) and submits the dispute record.
   - Buyer uploads a PNG screenshot (`multipart/form-data`); explain magic-byte inspection and briefly hit `/disputes/:id` with the **Outsider** account to prove strict `403` / `Access Denied or Not Found` enforcement.
   - Switch to **Arbiter** -> open `/arbiter` -> verify evidence download -> allocate e.g. `0.2 AVAX` Buyer / `0.4 AVAX` Seller (`0` arbiter cut) -> **Sign & Submit Settlement On-Chain** (`resolveDispute`).
   - Both Buyer and Seller independently pull their split shares via **Withdraw AVAX**.
5. **[4:30–5:00] Production Readiness & Quality Verification (`/support`)**
   - Show `/support` (`Anvil Local` / Fuji config status) and highlight `/api/v1/health/ready`, OpenAPI contract verification (`docs/openapi.json`), ArchUnit boundary tests, Foundry invariant fuzzing, and `scripts/e2e-live.sh`.
