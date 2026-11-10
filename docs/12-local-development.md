# Local Development Guide (Setup Steps 1–8)

This guide covers Setup **Steps 1–8** of the 19-step deployment runbook. For Avalanche Fuji deployment, continue to [`13-fuji-setup.md`](./13-fuji-setup.md) (Steps 9–13).

## Prerequisites

- **Java 21** (Eclipse Temurin / OpenJDK 21)
- **Node.js 22+** and npm
- **Foundry** (`forge`, `anvil`, `cast`) — https://getfoundry.sh
- **Docker** + **Docker Compose** (or local PostgreSQL 16 service)

---

### Step 1: Verify Toolchains

Confirm Java 21, Node 22+, and Foundry binaries are installed on `PATH` (or `$HOME/.foundry/bin`):

```bash
java -version
node -v && npm -v
forge --version && anvil --version && cast --version
```

---

### Step 2: Initialize Environment Templates & Install Dependencies

Run `scripts/install.sh` with `INIT_ENV=1` to install frontend packages, verify `./backend/gradlew`, fetch missing Foundry libraries (`forge-std`, `openzeppelin-contracts`), and create local `.env` copies from `.env.example`:

```bash
INIT_ENV=1 bash scripts/install.sh
```

> Never commit generated `.env` files. Confirm `blockchain/.env`, `backend/.env`, and `frontend/.env` remain ignored by git.

---

### Step 3: Start Local PostgreSQL 16

Launch the Postgres container defined in [`infra/docker-compose.yml`](../infra/docker-compose.yml) and wait for `pg_isready`:

```bash
bash scripts/dev-db.sh
```

---

### Step 4: Start Local Anvil EVM Node

In a separate terminal, start Anvil listening on `http://127.0.0.1:8545` (`chainId = 31337`):

```bash
bash scripts/dev-anvil.sh
```

> Tip: Set `ANVIL_BLOCK_TIME=1` if you want interval mining instead of instant automining.

---

### Step 5: Deploy `SafeDealEscrow` to Local Anvil & Bind Addresses

Export one of the local Anvil private keys printed in Step 4 and run `scripts/deploy-local.sh`:

```bash
export DEPLOYER_PRIVATE_KEY="<LOCAL_ANVIL_PRIVATE_KEY>"
bash scripts/deploy-local.sh
```

Copy the emitted contract address (also written to gitignored `blockchain/deployments/local-31337.json`) into both `backend/.env` and `frontend/.env`:

```bash
# backend/.env
BLOCKCHAIN_SYNC_ENABLED=true
ESCROW_CONTRACT_ADDRESS=0x...

# frontend/.env
VITE_ESCROW_CONTRACT_ADDRESS=0x...
```

> Also set a local random session secret inside `backend/.env`: `JWT_SECRET="$(openssl rand -hex 32)"` (or omit in `local` profile so `scripts/dev-backend.sh` generates an ephemeral key per run).

---

### Step 6: Start Backend API & Vite Frontend

Run the Spring Boot API (`http://localhost:8080`, applies Flyway `V1__initial_schema.sql`) and React dev server (`http://localhost:5173`) in separate terminals:

```bash
bash scripts/dev-backend.sh
bash scripts/dev-frontend.sh
```

---

### Step 7: Verify Health & Readiness Probes

Run the live HTTP smoke check confirming `/api/v1/health`, `/api/v1/health/ready` (`"status":"READY"`, `"databaseConnected":true`), `/actuator/health/readiness`, frontend HTTP `200`, and private endpoint `401` enforcement:

```bash
bash scripts/smoke-test.sh
```

---

### Step 8: Run Monorepo Verification & Live Unmocked 3-Tier E2E

Run the full offline verification suite (Foundry unit/security/invariant + Gradle ArchUnit/H2/OpenAPI parity + Vite typecheck/lint/Vitest/build + multi-viewport Playwright E2E):

```bash
bash scripts/verify.sh
```

Run the self-contained unmocked 3-tier E2E harness (`Playwright -> Vite Preview -> safedeal-api.jar -> Anvil`):

```bash
bash scripts/e2e-live.sh
```

To wipe local Postgres/evidence volumes and local deployment artifacts before starting fresh:

```bash
bash scripts/reset-dev.sh
```
