# Railway & Vercel Production Deployment Guide (Setup Steps 14–19)

This guide completes the 19-step setup sequence (Steps **14–19**), connecting your Fuji `SafeDealEscrow` contract from [`13-fuji-setup.md`](./13-fuji-setup.md) to **Railway** (Spring Boot API + Managed PostgreSQL) and **Vercel** (React + Vite SPA).

---

### Step 14: Provision Railway Project & Managed PostgreSQL

1. Create a new project on Railway and attach the **PostgreSQL** plugin.
2. Note the generated JDBC parameters (`<PGHOST>`, `<PGPORT>`, `<PGDATABASE>`, `<PGUSER>`, `<PGPASSWORD>`).

---

### Step 15: Configure Backend Service & Persistent Evidence Volume

1. Add a GitHub-linked service in Railway with **Root Directory** set to `backend`.
   - [`backend/railway.json`](../backend/railway.json) automatically builds [`backend/Dockerfile`](../backend/Dockerfile) and configures healthcheck `/api/v1/health`.
2. Attach a persistent **Railway Volume** mounted at `/app/storage/evidence` so uploaded dispute files persist across redeploys.

---

### Step 16: Set Backend Production Environment Variables in Railway

Generate a strong random JWT signing secret locally first:

```bash
openssl rand -hex 32
```

Configure these environment variables on the Railway backend service:

```env
SPRING_PROFILES_ACTIVE=prod
SERVER_PORT=8080
DB_URL=jdbc:postgresql://<PGHOST>:<PGPORT>/<PGDATABASE>?sslmode=require
DB_USERNAME=<PGUSER>
DB_PASSWORD=<PGPASSWORD>
JWT_SECRET=<OUTPUT_FROM_OPENSSL_RAND_HEX_32>
CORS_ALLOWED_ORIGINS=https://<YOUR_VERCEL_DOMAIN>
SIWE_DOMAIN=<YOUR_VERCEL_DOMAIN>
SIWE_URI=https://<YOUR_VERCEL_DOMAIN>
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
BLOCKCHAIN_SYNC_ENABLED=true
CHAIN_ID=43113
CHAIN_NAME=Avalanche Fuji C-Chain
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
ESCROW_CONTRACT_ADDRESS=<DEPLOYED_FUJI_ADDRESS>
ESCROW_DEPLOYMENT_BLOCK=<DEPLOYMENT_BLOCK>
BLOCKCHAIN_CONFIRMATIONS_REQUIRED=2
EVIDENCE_STORAGE_DIR=/app/storage/evidence
RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_PER_MINUTE=30
```

> `prod` startup enforces [`validateProductionConfiguration`](../backend/src/main/java/com/safedeal/infrastructure/configuration/InfrastructureBeansConfig.java): placeholder secrets, `<32` char `JWT_SECRET`, `COOKIE_SECURE=false`, wildcard CORS `*`, or loopback URLs immediately fail boot.

---

### Step 17: Deploy Backend to Railway & Verify Readiness

Trigger deployment via Railway CLI or `.github/workflows/deploy-backend.yml` (`RAILWAY_TOKEN` secret):

```bash
cd backend && railway up --detach
```

Probe the live backend readiness endpoint once deployment turns green:

```bash
curl -fsS https://<YOUR_RAILWAY_DOMAIN>/api/v1/health/ready
```

Expected: HTTP `200 OK` with `"status":"READY"`, `"databaseConnected":true`, `"evidenceStorageReady":true`, `"siweConfigured":true`, `"escrowContractConfigured":true`, `"chainId":43113`.

---

### Step 18: Deploy Frontend to Vercel (`frontend/vercel.json`)

Import the repository in Vercel with **Root Directory** set to `frontend`, or run Vercel CLI / `.github/workflows/deploy-frontend.yml`:

Configure Vercel **Environment Variables** (`Production`):

```env
VITE_APP_NAME=SafeDeal
VITE_APP_ENV=production
VITE_API_BASE_URL=https://<YOUR_RAILWAY_DOMAIN>
VITE_CHAIN_ID=43113
VITE_CHAIN_NAME=Avalanche Fuji C-Chain
VITE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VITE_EXPLORER_BASE_URL=https://testnet.snowtrace.io
VITE_ESCROW_CONTRACT_ADDRESS=<DEPLOYED_FUJI_ADDRESS>
VITE_DEFAULT_ARBITER_ADDRESS=<OPTIONAL_ARBITER_WALLET>
```

Deploy prebuilt bundle via CLI (or merge to `main`):

```bash
cd frontend && vercel --prod
```

Ensure Railway's `CORS_ALLOWED_ORIGINS`, `SIWE_DOMAIN`, and `SIWE_URI` match your final `https://<YOUR_VERCEL_DOMAIN>` origin **without** a trailing slash.

---

### Step 19: Execute Live Deployment Smoke Check & Origin Sanity Test

Run the repository smoke test script against the deployed backend and frontend URLs:

```bash
API_BASE_URL="https://<YOUR_RAILWAY_DOMAIN>" \
FRONTEND_BASE_URL="https://<YOUR_VERCEL_DOMAIN>" \
  bash scripts/smoke-test.sh
```

Then open `https://<YOUR_VERCEL_DOMAIN>/support` in a browser with MetaMask/Core on Avalanche Fuji (`43113`), confirm API Status reports healthy, and sign in via SIWE on `/dashboard` to confirm cross-site `HttpOnly` cookie + CSRF headers work end-to-end.
