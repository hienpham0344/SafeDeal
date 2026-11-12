# Railway Deployment (SafeDeal Backend + PostgreSQL)

Use Railway for the Rust `safedeal-api` service (`backend/`) and managed PostgreSQL database.

## Setup Steps

1. Create a Railway project and attach a **PostgreSQL** plugin.
2. Add a service from GitHub with **Root Directory** set to `backend`.
   - `backend/railway.json` configures the multi-stage `backend/Dockerfile` builder and `/api/v1/health` healthcheck.
   - The server automatically binds `0.0.0.0` on `SERVER_PORT` (falling back to Railway's injected `PORT`).
3. Configure service environment variables in Railway:
   - `APP_ENV=prod`
   - `DATABASE_URL=postgres://<PGUSER>:<PGPASSWORD>@<PGHOST>:<PGPORT>/<PGDATABASE>?sslmode=require` (or `DB_URL` + `DB_USERNAME` + `DB_PASSWORD`)
   - `JWT_SECRET=<cryptographically-random-32+-chars>`
   - `CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>`
   - `SIWE_DOMAIN=<your-vercel-domain>`
   - `SIWE_URI=https://<your-vercel-domain>`
   - `COOKIE_SECURE=true`
   - `COOKIE_SAME_SITE=None`
   - `BLOCKCHAIN_SYNC_ENABLED=true`
   - `CHAIN_ID=43113`
   - `CHAIN_NAME=Avalanche Fuji C-Chain`
   - `AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc`
   - `ESCROW_CONTRACT_ADDRESS=<deployed-fuji-SafeDealEscrow-address>`
   - `ESCROW_DEPLOYMENT_BLOCK=<deployment-block-number>`
   - `BLOCKCHAIN_CONFIRMATIONS_REQUIRED=2`
   - Attach a persistent Railway Volume at `/app/storage/evidence` and set `EVIDENCE_STORAGE_DIR=/app/storage/evidence`.

## Security Notes

- Staging and production profiles (`backend/crates/infrastructure/src/config.rs`) fail startup if `JWT_SECRET` contains placeholder strings or is shorter than 32 characters, if `COOKIE_SECURE` is `false`, if `SIWE_URI`/`CORS_ALLOWED_ORIGINS` do not use `https://`, if loopback hosts are configured, or if DB credentials are missing/empty.
- Never commit `JWT_SECRET`, `DB_PASSWORD`, or deployer private keys to git.
