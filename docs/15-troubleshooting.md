# Troubleshooting Runbook

## 1. SIWE Authentication Fails (`401 Unauthorized` — `SIWE domain mismatch` / `URI mismatch`)
- **Cause**: Browser origin (e.g., `http://127.0.0.1:4173` or `https://app.example.com`) differs from backend `SIWE_DOMAIN` / `SIWE_URI`.
- **Fix**: Align `SIWE_DOMAIN` (`host[:port]`), `SIWE_URI` (`scheme://host[:port]` without trailing slash), and `CORS_ALLOWED_ORIGINS` with the exact browser origin.

## 2. Mutating Requests Return `403 CSRF_VALIDATION_FAILED`
- **Cause**: Client omitted `X-CSRF-Token`, dropped `credentials: "include"`, or set `COOKIE_SECURE=true` over non-TLS `http://localhost`, OR used `COOKIE_SAME_SITE=Lax` across two different sites (e.g., `vercel.app` -> `railway.app`).
- **Fix**: Use `COOKIE_SECURE=false` + `COOKIE_SAME_SITE=Lax` locally over HTTP; use `COOKIE_SECURE=true` + `COOKIE_SAME_SITE=None` over cross-site HTTPS.

## 3. `GET /api/v1/health/ready` Returns `503 NOT_READY`
Inspect the JSON fields in `ReadinessStatusResponse`:
- `databaseConnected: false` -> PostgreSQL unreachable, wrong `DB_URL`/`DB_USERNAME`/`DB_PASSWORD`, or container not started (`bash scripts/dev-db.sh`).
- `evidenceStorageReady: false` -> `EVIDENCE_STORAGE_DIR` missing/unwritable permissions or volume not mounted at `/app/storage/evidence`.
- `siweConfigured: false` -> Blank `SIWE_DOMAIN` / `SIWE_URI` or non-positive `CHAIN_ID`.
- `escrowContractConfigured: false` (when `blockchainEnabled: true`) -> Blank or `0x000...000` `ESCROW_CONTRACT_ADDRESS`. Set deployed contract address or `BLOCKCHAIN_SYNC_ENABLED=false` while un-deployed.

## 4. `/create` Page Reloaded After On-Chain `createTrade` or `503 bind-tx`
- **Behavior**: SafeDeal persists `previewDraft`, `clientTermsHash`, and `submittedCreateTxHash` per seller wallet in `sessionStorage` (`safedeal:create-draft:<address>`) alongside pending tx metadata.
- **Resolution**: Reconnect the same seller wallet and return to `/create`. If pending, UI finishes waiting for confirmation automatically; if confirmed, click **Retry Backend Binding**. Never click **Edit Draft** if you intend to bind the already-mined trade without recreating.

## 5. Production Backend Fails Startup (`IllegalStateException`)
- **Cause**: Active profile is `prod` or `staging`, and [`validateProductionConfiguration`](../backend/src/main/java/com/safedeal/infrastructure/configuration/InfrastructureBeansConfig.java) rejected a placeholder word in `JWT_SECRET`, `COOKIE_SECURE=false`, wildcard CORS `*`, or loopback hosts in `SIWE_DOMAIN`/`SIWE_URI`/`CORS_ALLOWED_ORIGINS`/`AVALANCHE_RPC_URL`.
- **Fix**: Generate a random secret (`openssl rand -hex 32`) and populate non-loopback HTTPS origins.

## 6. Evidence Upload Returns `400 File contents do not match declared MIME type`
- **Cause**: Extension or declared MIME type spoofed (e.g. script or binary payload renamed `.png`) or empty/null-byte `.txt`.
- **Fix**: Upload genuine `PNG`, `JPEG`, `PDF`, or non-blank UTF-8 plain text within `EVIDENCE_MAX_BYTES` (default 5 MiB).

## 7. Authentication Calls Return `429 RATE_LIMITED`
- **Cause**: Exceeded `AUTH_RATE_LIMIT_PER_MINUTE` calls from the resolved client IP (`request.getRemoteAddr()`) on `/api/v1/auth/nonce` or `/verify`.
- **Fix**: Wait up to 60 seconds, or verify reverse-proxy `X-Forwarded-For` configuration if multiple remote users share one proxy IP with Spring `server.forward-headers-strategy: framework`. Disable only in isolated test harnesses (`RATE_LIMIT_ENABLED=false`).

## 8. `OpenApiContractVerificationTest` Fails After Controller Changes
- **Cause**: Backend API DTOs or routes changed while [`docs/openapi.json`](./openapi.json) was not regenerated.
- **Fix**: Intentionally refresh the contract snapshot and commit alongside your code diff:
  ```bash
  ./backend/gradlew -p backend test --tests com.safedeal.OpenApiContractVerificationTest -DupdateOpenApiSpec=true
  ```

## 9. `scripts/verify.sh` / `e2e-live.sh` Cannot Find `java` or `forge`/`anvil`
- **Fix**: Ensure Java 21 is installed (scripts check `PATH` and `$HOME/.jdks/jdk-21*`) and Foundry is on `PATH`, `~/.foundry/bin`, or `/tmp/foundry-tool`.
