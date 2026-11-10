#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${JAVA_HOME:-}" ] && ! command -v java >/dev/null 2>&1; then
  for jdk_dir in "$HOME"/.jdks/jdk-21*; do
    if [ -d "$jdk_dir/bin" ]; then
      export JAVA_HOME="$jdk_dir"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

JAVA_BIN="$(command -v java || true)"
if [ -z "$JAVA_BIN" ] || ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: java, node, and npm must be installed and available." >&2
  exit 1
fi

find_foundry_bin() {
  local name="$1"
  local found
  found="$(command -v "$name" || true)"
  if [ -z "$found" ] && [ -x "$HOME/.foundry/bin/$name" ]; then
    found="$HOME/.foundry/bin/$name"
  fi
  if [ -z "$found" ] && [ -x "/tmp/foundry-tool/$name" ]; then
    found="/tmp/foundry-tool/$name"
  fi
  echo "$found"
}

ANVIL_BIN="$(find_foundry_bin anvil)"
FORGE_BIN="$(find_foundry_bin forge)"
CAST_BIN="$(find_foundry_bin cast)"

if [ -z "$ANVIL_BIN" ] || [ -z "$FORGE_BIN" ] || [ -z "$CAST_BIN" ]; then
  echo "Error: Foundry binaries (anvil, forge, cast) not found on PATH, ~/.foundry/bin, or /tmp/foundry-tool." >&2
  exit 1
fi

ANVIL_PORT="${ANVIL_PORT:-18545}"
API_PORT="${API_PORT:-18080}"
WEB_PORT="${WEB_PORT:-14173}"

RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"

TMP_DIR="$(mktemp -d)"
ANVIL_PID=""
BACKEND_PID=""
FRONTEND_PID=""
DIST_BACKUP_DIR=""

cleanup() {
  local exit_code=$?
  set +e
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" >/dev/null 2>&1
    wait "$FRONTEND_PID" >/dev/null 2>&1
  fi
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1
    wait "$BACKEND_PID" >/dev/null 2>&1
  fi
  if [ -n "$ANVIL_PID" ]; then
    kill "$ANVIL_PID" >/dev/null 2>&1
    wait "$ANVIL_PID" >/dev/null 2>&1
  fi
  if [ -n "$DIST_BACKUP_DIR" ] && [ -d "$DIST_BACKUP_DIR/dist" ]; then
    rm -rf "$ROOT_DIR/frontend/dist"
    mv "$DIST_BACKUP_DIR/dist" "$ROOT_DIR/frontend/dist"
  fi
  if [ "$exit_code" -ne 0 ]; then
    echo "=== E2E Live Run Failed — Last Logs ===" >&2
    for log_file in "$TMP_DIR/anvil.log" "$TMP_DIR/backend.log" "$TMP_DIR/frontend.log"; do
      if [ -f "$log_file" ]; then
        echo "--- $log_file ---" >&2
        tail -n 60 "$log_file" >&2
      fi
    done
  fi
  rm -rf "$TMP_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== [1/6] Ensuring packaged backend JAR & H2 runtime driver ==="
"$ROOT_DIR/backend/gradlew" -p "$ROOT_DIR/backend" bootJar copyTestH2

echo "=== [2/6] Starting live Anvil node on ${RPC_URL} ==="
"$ANVIL_BIN" --host 127.0.0.1 --port "$ANVIL_PORT" --chain-id 31337 --silent >"$TMP_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!

for _ in $(seq 1 40); do
  if "$CAST_BIN" block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
"$CAST_BIN" block-number --rpc-url "$RPC_URL" >/dev/null

echo "=== [3/6] Deploying SafeDealEscrow to Anvil ==="
EPHEMERAL_DEPLOYER_KEY="0x$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
EPHEMERAL_DEPLOYER_ADDR="$("$CAST_BIN" wallet address --private-key "$EPHEMERAL_DEPLOYER_KEY")"
"$CAST_BIN" rpc anvil_setBalance "$EPHEMERAL_DEPLOYER_ADDR" "0x3635c9adc5dea00000" --rpc-url "$RPC_URL" >/dev/null

DEPLOY_OUTPUT=$(
  cd "$ROOT_DIR/blockchain" &&
    DEPLOYER_PRIVATE_KEY="$EPHEMERAL_DEPLOYER_KEY" \
      "$FORGE_BIN" script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast 2>&1
)
ESCROW_CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oE 'SafeDealEscrow deployed at: 0x[0-9a-fA-F]{40}' | awk '{print $NF}' | tail -n 1 || true)
if [ -z "$ESCROW_CONTRACT_ADDRESS" ]; then
  echo "Error: Failed to extract SafeDealEscrow contract address from forge output:" >&2
  echo "$DEPLOY_OUTPUT" >&2
  exit 1
fi
echo "Deployed SafeDealEscrow at: $ESCROW_CONTRACT_ADDRESS"

echo "=== [4/6] Starting packaged safedeal-api.jar on ${API_URL} ==="
mkdir -p "$TMP_DIR/evidence"
EPHEMERAL_JWT_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
DEFAULT_E2E_DB_URL="jdbc:h2:mem:safedeal_e2e_live;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1"

SPRING_PROFILES_ACTIVE=local \
SERVER_PORT="$API_PORT" \
DB_URL="${DB_URL:-$DEFAULT_E2E_DB_URL}" \
DB_USERNAME="${DB_USERNAME:-sa}" \
DB_PASSWORD="${DB_PASSWORD-}" \
DB_DRIVER_CLASS_NAME="${DB_DRIVER_CLASS_NAME:-org.h2.Driver}" \
JWT_SECRET="$EPHEMERAL_JWT_SECRET" \
SIWE_DOMAIN="127.0.0.1:${WEB_PORT}" \
SIWE_URI="$WEB_URL" \
COOKIE_SECURE=false \
COOKIE_SAME_SITE=Lax \
CORS_ALLOWED_ORIGINS="$WEB_URL" \
BLOCKCHAIN_SYNC_ENABLED=true \
CHAIN_ID=31337 \
CHAIN_NAME="Anvil Local" \
AVALANCHE_RPC_URL="$RPC_URL" \
ESCROW_CONTRACT_ADDRESS="$ESCROW_CONTRACT_ADDRESS" \
ESCROW_DEPLOYMENT_BLOCK=0 \
BLOCKCHAIN_CONFIRMATIONS_REQUIRED=1 \
BLOCKCHAIN_POLL_INTERVAL_MS=1000 \
EVIDENCE_STORAGE_DIR="$TMP_DIR/evidence" \
RATE_LIMIT_ENABLED=false \
  "$JAVA_BIN" -Dloader.path="$ROOT_DIR/backend/build/e2e-libs" \
    -cp "$ROOT_DIR/backend/build/libs/safedeal-api.jar" \
    org.springframework.boot.loader.launch.PropertiesLauncher \
    >"$TMP_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 240); do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "Error: safedeal-api.jar exited prematurely before becoming ready." >&2
    exit 1
  fi
  if curl -fsS "${API_URL}/api/v1/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS "${API_URL}/api/v1/health/ready" | grep -q '"status":"READY"'

echo "=== [5/6] Building & starting real Vite frontend on ${WEB_URL} ==="
if [ -d "$ROOT_DIR/frontend/dist" ]; then
  DIST_BACKUP_DIR="$TMP_DIR/dist-backup"
  mkdir -p "$DIST_BACKUP_DIR"
  mv "$ROOT_DIR/frontend/dist" "$DIST_BACKUP_DIR/dist"
fi

VITE_APP_NAME="SafeDeal" \
VITE_APP_ENV="local" \
VITE_API_BASE_URL="$API_URL" \
VITE_CHAIN_ID=31337 \
VITE_CHAIN_NAME="Anvil Local" \
VITE_RPC_URL="$RPC_URL" \
VITE_ESCROW_CONTRACT_ADDRESS="$ESCROW_CONTRACT_ADDRESS" \
VITE_TX_POLL_INTERVAL_MS=500 \
  npm --prefix "$ROOT_DIR/frontend" run build

npm --prefix "$ROOT_DIR/frontend" run preview -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort \
  >"$TMP_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

for _ in $(seq 1 80); do
  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    echo "Error: Vite preview process exited prematurely." >&2
    exit 1
  fi
  if curl -fsS "$WEB_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "$WEB_URL" >/dev/null

echo "=== Running Smoke Checks ==="
API_BASE_URL="$API_URL" FRONTEND_BASE_URL="$WEB_URL" bash "$ROOT_DIR/scripts/smoke-test.sh"

echo "=== [6/6] Running Unmocked Playwright 3-Tier Browser E2E ==="
LIVE_E2E_ENABLED=1 \
LIVE_E2E_RPC_URL="$RPC_URL" \
LIVE_E2E_API_URL="$API_URL" \
LIVE_E2E_CONTRACT_ADDRESS="$ESCROW_CONTRACT_ADDRESS" \
PLAYWRIGHT_BASE_URL="$WEB_URL" \
  npm --prefix "$ROOT_DIR/frontend" run test:e2e -- tests/e2e/live-three-tier.spec.ts --project=desktop

echo "All unmocked 3-tier E2E flows passed cleanly."
