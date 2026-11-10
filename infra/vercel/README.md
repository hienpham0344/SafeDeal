# Vercel Deployment (SafeDeal Frontend)

Deploy the React + Vite frontend (`frontend/`) on Vercel with SPA fallback and security headers (`frontend/vercel.json`).

## Setup Steps

1. Import the repository in Vercel and set **Root Directory** to `frontend`.
2. Framework preset: **Vite** (`npm run build`, output directory `dist`).
3. Configure Environment Variables in Vercel Project Settings:
   - `VITE_APP_NAME=SafeDeal`
   - `VITE_APP_ENV=production`
   - `VITE_API_BASE_URL=https://<your-railway-backend-domain>`
   - `VITE_CHAIN_ID=43113`
   - `VITE_CHAIN_NAME=Avalanche Fuji C-Chain`
   - `VITE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc`
   - `VITE_EXPLORER_BASE_URL=https://testnet.snowtrace.io`
   - `VITE_ESCROW_CONTRACT_ADDRESS=<deployed-fuji-SafeDealEscrow-address>`
   - `VITE_DEFAULT_ARBITER_ADDRESS=<optional-arbiter-address>`
4. Ensure backend `CORS_ALLOWED_ORIGINS`, `SIWE_DOMAIN`, and `SIWE_URI` match your live Vercel domain exactly (cross-site credentialed cookies require `HTTPS`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=None`).
