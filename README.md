# SafeDeal — Decentralized P2P Escrow on Avalanche

Non-custodial peer-to-peer escrow platform for high-trust digital and service transactions on Avalanche C-Chain (Fuji testnet & local Anvil). SafeDeal pairs an immutable Solidity `SafeDealEscrow` contract with a React + TypeScript frontend and a Spring Boot verification, SIWE authentication, dispute, and event-indexing backend.

> **Trust Model**: Funds are locked and released strictly on-chain by buyer/seller/arbiter signatures via pull-payment (`withdraw()`). The off-chain backend and database index events, verify RFC 8785 canonical terms hashes, and host private dispute evidence—never custody user funds. When a trade enters `DISPUTED`, the designated human arbiter is a trusted party.

## Repository Structure

```text
frontend/     React 18 + Vite 6 + TypeScript + Tailwind CSS + wagmi/viem + TanStack Query
backend/      Java 21 + Spring Boot 3.5.7 + Gradle + PostgreSQL/Flyway + Web3j + ArchUnit + SpringDoc
blockchain/   Solidity 0.8.28 + Foundry + OpenZeppelin (SafeDealEscrow + unit/security/invariant tests)
infra/        Docker Compose + Nginx SPA config + Railway & Vercel deployment specs
scripts/      Developer workflow, deployment, smoke-test, offline verification, and live 3-tier E2E scripts
docs/         Complete 20-document engineering, setup, demo specification, and openapi.json contract
```

## Prerequisites

- **Java 21** (Temurin / OpenJDK 21)
- **Node.js 22+** and npm
- **Foundry** (`forge`, `anvil`, `cast`) — [getfoundry.sh](https://getfoundry.sh)
- **PostgreSQL 16** (or Docker + Docker Compose)

## Quick Start (Local Anvil Stack)

1. **Initialize environment templates & install dependencies**
   ```bash
   INIT_ENV=1 bash scripts/install.sh
   ```
2. **Start PostgreSQL and Anvil (two terminals)**
   ```bash
   bash scripts/dev-db.sh
   bash scripts/dev-anvil.sh
   ```
3. **Deploy `SafeDealEscrow` to local Anvil**
   ```bash
   export DEPLOYER_PRIVATE_KEY=<your-local-anvil-private-key>
   bash scripts/deploy-local.sh
   ```
   Copy the emitted contract address into `backend/.env` (`ESCROW_CONTRACT_ADDRESS`, `BLOCKCHAIN_SYNC_ENABLED=true`) and `frontend/.env` (`VITE_ESCROW_CONTRACT_ADDRESS`).
4. **Run Backend API (`http://localhost:8080`) and Frontend (`http://localhost:5173`)**
   ```bash
   bash scripts/dev-backend.sh
   bash scripts/dev-frontend.sh
   ```
5. **Probe health/readiness and run full checks**
   ```bash
   bash scripts/smoke-test.sh   # verifies /api/v1/health, /api/v1/health/ready, /actuator/health/readiness
   bash scripts/verify.sh       # contracts + backend + OpenAPI parity + frontend + Playwright E2E
   bash scripts/e2e-live.sh     # self-contained unmocked Browser -> Vite -> safedeal-api.jar -> Anvil E2E
   ```

## Core Commands

| Area | Command | Purpose |
|------|---------|---------|
| Monorepo | `make verify` / `bash scripts/verify.sh` | Run Foundry tests, Gradle tests + JAR, Vite check/test/build, Playwright E2E |
| Live 3-Tier E2E | `bash scripts/e2e-live.sh` | Launch live Anvil, deploy escrow, boot packaged JAR, run unmocked Playwright flows |
| Smoke Probe | `make smoke-test` / `bash scripts/smoke-test.sh` | Verify `/api/v1/health`, `/api/v1/health/ready` (`READY`), frontend `200`, auth `401` |
| Contracts | `forge test --root blockchain -vvv` | Unit, security, and stateful invariant smart contract tests |
| Backend | `./backend/gradlew -p backend test bootJar` | Unit, ArchUnit boundary, security, controller, OpenAPI sync, and indexer tests + fat JAR |
| Frontend | `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test && npm --prefix frontend run build` | TypeScript strict check, ESLint, Vitest unit/integration tests, Vite build |
| E2E Browser | `npm --prefix frontend run test:e2e` | Playwright browser suite across Desktop, Tablet, and Mobile viewports |

## Security & Configuration Rules

- Never commit `.env` files, real `JWT_SECRET` values, `DB_PASSWORD` credentials, or `DEPLOYER_PRIVATE_KEY` keys.
- Production and staging profiles (`application-prod.yml`, `application-staging.yml`) enforce strong `JWT_SECRET` validation, `COOKIE_SECURE=true`, explicit `CORS_ALLOWED_ORIGINS` (wildcards forbidden), and strict SIWE domain/URI checks.

## Documentation & Specifications

- Core Engineering:
  - [`docs/00-overview.md`](docs/00-overview.md) · [`docs/01-requirements.md`](docs/01-requirements.md) · [`docs/02-architecture.md`](docs/02-architecture.md) · [`docs/03-database-design.md`](docs/03-database-design.md)
  - [`docs/04-api-contracts.md`](docs/04-api-contracts.md) ([`docs/openapi.json`](docs/openapi.json)) · [`docs/05-business-flows.md`](docs/05-business-flows.md) · [`docs/06-state-machines.md`](docs/06-state-machines.md)
  - [`docs/07-smart-contract-design.md`](docs/07-smart-contract-design.md) · [`docs/08-security.md`](docs/08-security.md) · [`docs/09-deployment.md`](docs/09-deployment.md) · [`docs/10-testing-strategy.md`](docs/10-testing-strategy.md)
- Operations, Environment & Hackathon Dossier:
  - [`docs/11-configuration-guide.md`](docs/11-configuration-guide.md) · [`docs/12-local-development.md`](docs/12-local-development.md) · [`docs/13-fuji-setup.md`](docs/13-fuji-setup.md) · [`docs/14-railway-setup.md`](docs/14-railway-setup.md)
  - [`docs/15-troubleshooting.md`](docs/15-troubleshooting.md) · [`docs/16-hackathon-submission.md`](docs/16-hackathon-submission.md)
- Demo & Judge Materials:
  - [`docs/demo/demo-script.md`](docs/demo/demo-script.md) · [`docs/demo/pitch-outline.md`](docs/demo/pitch-outline.md) · [`docs/demo/judge-qa.md`](docs/demo/judge-qa.md)
