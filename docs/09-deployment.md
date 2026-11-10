# Deployment Architecture & CI/CD

## 1. Environment Topologies

| Environment | Blockchain | Backend Runtime | Database & Storage | Frontend Hosting |
|---|---|---|---|---|
| **Local Development** | Anvil (`http://127.0.0.1:8545`, chain `31337`) | Gradle `bootRun` / Docker container (`:8080`) | Docker PostgreSQL 16 + `./storage/evidence` | Vite dev/preview (`:5173` / `:4173`) |
| **Local Live 3-Tier E2E** | Isolated Anvil (`127.0.0.1:18545`) | Packaged `safedeal-api.jar` (`PropertiesLauncher`, `:18080`) | H2 PostgreSQL-mode or `DB_URL` override + temp evidence dir | Built Vite SPA (`127.0.0.1:14173`) |
| **Full Docker Compose** | `anvil` service (`infra/docker-compose.yml`) | Multi-stage `backend/Dockerfile` (Eclipse Temurin JRE 21) | Named volumes `postgres_data` + `evidence_data` | `frontend/Dockerfile` (`nginx:1.27-alpine`) |
| **Cloud Testnet / Production** | Avalanche Fuji C-Chain (`43113`) | Railway (`backend/railway.json` healthcheck `/api/v1/health`) | Managed PostgreSQL addon + mounted persistent volume `/app/storage/evidence` | Vercel (`frontend/vercel.json` SPA rewrites & security headers) |

## 2. Container & Web Security Configuration

- **`backend/Dockerfile`**: Two-stage build producing non-root user `safedeal`, JRE 21 runtime, container memory limits (`-XX:MaxRAMPercentage=75.0`), and Docker `HEALTHCHECK` against `http://127.0.0.1:8080/api/v1/health`.
- **`frontend/Dockerfile` & `frontend/nginx.conf`**: Copies `public/` (favicon, static assets), runs `npm run build`, and serves via `nginx:1.27-alpine` with `server_tokens off`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, immutable asset caching, and SPA fallback (`try_files $uri $uri/ /index.html`).
- **`frontend/vercel.json`**: Configures matching security headers and SPA fallback rewrite on Vercel Edge.

## 3. GitHub Actions CI/CD Workflows (`.github/workflows/`)

1. **`ci.yml`** (on `push` to `main` and every `pull_request`):
   - `blockchain`: Foundry `forge test --root blockchain -vvv`.
   - `backend`: JDK 21 + Gradle `./backend/gradlew -p backend test bootJar` (executes unit, ArchUnit, security, controller, indexer, and OpenAPI sync verification tests).
   - `frontend`: Node 22 `npm ci`, `typecheck`, `lint`, `test` (Vitest), `build`, and `npm run test:e2e` (Playwright across Desktop, Tablet, Mobile).
2. **`secrets-scan.yml`** (on `push`, `pull_request`, and weekly cron):
   - Executes Gitleaks secret scanning across commit history.
3. **`contracts-deploy.yml`** (manual `workflow_dispatch`):
   - Validates `forge test`, broadcasts `script/Deploy.s.sol:Deploy` to `FUJI_RPC_URL` with secret `DEPLOYER_PRIVATE_KEY` (plus optional `SNOWTRACE_API_KEY`), and uploads `blockchain/broadcast/` artifact.
4. **`deploy-backend.yml`** (push to `main` under `backend/**` or manual):
   - Executes `./backend/gradlew -p backend test bootJar`, pushes backend to Railway via `RAILWAY_TOKEN`, and probes `vars.BACKEND_HEALTH_URL` if configured.
5. **`deploy-frontend.yml`** (push to `main` under `frontend/**` or manual):
   - Builds `frontend/` using `vars.VITE_*` and deploys prebuilt production bundle to Vercel via `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

## 4. Production Secrets & Variables Matrix

| Scope | Secrets (`secrets.*`) | Variables (`vars.*`) |
|---|---|---|
| Contracts Deploy | `DEPLOYER_PRIVATE_KEY`, `SNOWTRACE_API_KEY` | `FUJI_RPC_URL` |
| Backend Deploy | `RAILWAY_TOKEN` | `BACKEND_HEALTH_URL` |
| Frontend Deploy | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `VITE_APP_NAME`, `VITE_APP_ENV`, `VITE_API_BASE_URL`, `VITE_CHAIN_ID`, `VITE_CHAIN_NAME`, `VITE_RPC_URL`, `VITE_EXPLORER_BASE_URL`, `VITE_ESCROW_CONTRACT_ADDRESS`, `VITE_DEFAULT_ARBITER_ADDRESS` |

Concrete operational procedures appear in [`12-local-development.md`](./12-local-development.md), [`13-fuji-setup.md`](./13-fuji-setup.md), and [`14-railway-setup.md`](./14-railway-setup.md).
