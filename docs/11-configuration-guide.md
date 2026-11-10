# Configuration & Environment Variable Guide

No secrets, private keys, deployment addresses, or environment URLs are hardcoded in application binaries. Runtime validation occurs in [`env.ts`](../frontend/src/config/env.ts), [`InfrastructureBeansConfig.java`](../backend/src/main/java/com/safedeal/infrastructure/configuration/InfrastructureBeansConfig.java), and `@ConfigurationProperties` bindings.

## 1. Root Docker Stack (`.env` for `infra/docker-compose.yml`)

Create from root `.env.example` when running the containerized compose stack:
- `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`, `DB_PORT`
- `JWT_SECRET` (`openssl rand -hex 32`)
- `SPRING_PROFILES_ACTIVE`, `BLOCKCHAIN_SYNC_ENABLED`, `ESCROW_CONTRACT_ADDRESS`
- `VITE_API_BASE_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_ESCROW_CONTRACT_ADDRESS`

## 2. Smart Contracts (`blockchain/.env`)

| Variable | Default / Template | Purpose |
|---|---|---|
| `LOCAL_RPC_URL` | `http://127.0.0.1:8545` | Anvil local JSON-RPC URL |
| `LOCAL_CHAIN_ID` | `31337` | Local Anvil chain ID |
| `FUJI_RPC_URL` | `https://api.avax-test.network/ext/bc/C/rpc` | Avalanche Fuji C-Chain JSON-RPC endpoint |
| `FUJI_CHAIN_ID` | `43113` | Avalanche Fuji C-Chain ID |
| `DEPLOYER_PRIVATE_KEY` | *(supplied dynamically — never commit)* | Deployment signer used only during `Deploy.s.sol` broadcast |
| `SNOWTRACE_API_KEY` | *(optional)* | Explorer API key for automated `--verify` on Snowtrace |

## 3. Backend (`backend/.env` + Spring Environment)

| Variable | Default (`application.yml` / `.env.example`) | Notes |
|---|---|---|
| `SPRING_PROFILES_ACTIVE` | `local` | Supported: `local`, `test`, `staging`, `prod` |
| `SERVER_PORT` | `8080` | HTTP port bound by Spring Boot |
| `DB_URL` | `jdbc:postgresql://localhost:5432/safedeal` (`local`) | Required JDBC PostgreSQL URL |
| `DB_USERNAME` / `DB_PASSWORD` | `safedeal` / `safedeal` (`local`) | Database user credentials |
| `DB_DRIVER_CLASS_NAME` | `org.postgresql.Driver` | `org.h2.Driver` only in H2 test/live-E2E harnesses |
| `JWT_SECRET` | *(required, no fallback)* | Must be `>= 32` chars; `prod`/`staging` fail startup on placeholders (`replace-with`, `placeholder`, `changeme`, `change-me`, `dev-only`, `test-only`, `example`) |
| `SESSION_TTL_SECONDS` | `86400` | Signed session JWT lifetime |
| `NONCE_TTL_SECONDS` | `300` | SIWE challenge expiry window |
| `SIWE_DOMAIN` / `SIWE_URI` | `localhost:5173` / `http://localhost:5173` | Expected browser domain and origin URI (`localhost` forbidden in `prod`/`staging`) |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | `safedeal_session` / `safedeal_csrf` | Session cookie & CSRF token cookie names |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` | `false` / `Lax` (`true` / `None` in `application-prod.yml`) | Must be `true` in `prod`/`staging` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins; `*` and loopback hosts forbidden in `prod`/`staging` |
| `BLOCKCHAIN_SYNC_ENABLED` | `true` (`application.yml`; `false` in `.env.example`) | Enables RPC verification, indexing, and `/health/ready` contract check |
| `CHAIN_ID` / `CHAIN_NAME` | `31337` / `Anvil Local` | Target Avalanche/EVM network (`43113` on Fuji) |
| `AVALANCHE_RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC URL queried via Web3j |
| `ESCROW_CONTRACT_ADDRESS` | *(blank until deployed)* | Deployed `SafeDealEscrow` address |
| `ESCROW_DEPLOYMENT_BLOCK` | `0` | Indexer start cursor (`max(0, deploymentBlock - 1)`) |
| `BLOCKCHAIN_CONFIRMATIONS_REQUIRED` | `1` | Confirmation lag before indexing (`2+` recommended on Fuji) |
| `BLOCKCHAIN_SYNC_BATCH_SIZE` | `1000` | Max block span per `eth_getLogs` poll |
| `BLOCKCHAIN_POLL_INTERVAL_MS` | `10000` | Scheduler fixed delay in ms |
| `BLOCKCHAIN_RPC_TIMEOUT_MS` | `10000` | OkHttp read/connect/write timeout |
| `EVIDENCE_STORAGE_DIR` | `./storage/evidence` | Root directory for private evidence attachments |
| `EVIDENCE_MAX_BYTES` | `5242880` | Max binary upload per attachment (5 MiB) |
| `EVIDENCE_MAX_REQUEST_BYTES` | `6291456` | Max multipart HTTP payload |
| `RATE_LIMIT_ENABLED` / `AUTH_RATE_LIMIT_PER_MINUTE` | `true` / `30` | Sliding-window IP rate limit on `/api/v1/auth/nonce` & `/verify` |

## 4. Frontend (`frontend/.env` + `src/config/*.ts`)

| Variable / Config | Default | Purpose |
|---|---|---|
| `VITE_APP_NAME` / `VITE_APP_ENV` | `SafeDeal` / `local` | Brand title & runtime environment label |
| `VITE_API_BASE_URL` | `http://localhost:8080` | Base origin for API calls (`credentials: "include"`) |
| `VITE_CHAIN_ID` / `VITE_CHAIN_NAME` | `31337` / `Anvil Local` | Target EVM chain (`43113` on Fuji) |
| `VITE_RPC_URL` | `http://127.0.0.1:8545` | Browser read RPC URL |
| `VITE_EXPLORER_BASE_URL` | *(blank locally)* | e.g. `https://testnet.snowtrace.io` on Fuji |
| `VITE_ESCROW_CONTRACT_ADDRESS` | *(blank until deployed)* | Zero-address inputs rejected by `loadFrontendEnv` |
| `VITE_DEFAULT_ARBITER_ADDRESS` | *(optional)* | Pre-populates arbiter address on `/create` |
| `VITE_DEFAULT_INSPECTION_WINDOW_SECONDS` | `259200` | 3-day default buyer inspection window |
| `VITE_MAX_EVIDENCE_BYTES` | `5242880` | Matches `EVIDENCE_MAX_BYTES` |
| `VITE_TX_POLL_INTERVAL_MS` | `2000` | Poll interval on deal/dispute views |
| `VITE_HERO_VIDEO_URL` | Foldcraft CloudFront MP4 | Overridable hero ambient video URL |

Frontend runtime policies and route builders live in [`app.config.ts`](../frontend/src/config/app.config.ts), [`brand.config.ts`](../frontend/src/config/brand.config.ts), [`network.config.ts`](../frontend/src/config/network.config.ts), and [`routes.ts`](../frontend/src/config/routes.ts).
