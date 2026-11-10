# Railway Deployment (SafeDeal Backend + PostgreSQL)

Use Railway for the Spring Boot API (`backend/`) and managed PostgreSQL database.

## Setup Steps

1. Create a Railway project and attach a **PostgreSQL** plugin.
2. Add a service from GitHub with **Root Directory** set to `backend`.
   - `backend/railway.json` configures the multi-stage `backend/Dockerfile` builder and `/api/v1/health` healthcheck.
3. Configure service environment variables in Railway:
   - `SPRING_PROFILES_ACTIVE=prod`
   - `DB_URL=jdbc:postgresql://<PGHOST>:<PGPORT>/<PGDATABASE>?sslmode=require`
   - `DB_USERNAME=<PGUSER>`
   - `DB_PASSWORD=<PGPASSWORD>`
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

- Production profile (`application-prod.yml`) fails startup if `JWT_SECRET` contains placeholder strings, is shorter than 32 characters, or if `COOKIE_SECURE` is `false`.
- Never commit `JWT_SECRET`, `DB_PASSWORD`, or deployer private keys to git.
