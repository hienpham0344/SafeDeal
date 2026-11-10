#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT_DIR/blockchain/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/blockchain/.env"
  set +a
fi

FORGE_BIN="$(command -v forge || true)"
if [ -z "$FORGE_BIN" ] && [ -x "$HOME/.foundry/bin/forge" ]; then
  FORGE_BIN="$HOME/.foundry/bin/forge"
fi
if [ -z "$FORGE_BIN" ]; then
  echo "Error: forge binary not found." >&2
  exit 1
fi

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be set in environment or blockchain/.env (testnet key only)." >&2
  exit 1
fi

FUJI_RPC_URL="${FUJI_RPC_URL:-https://api.avax-test.network/ext/bc/C/rpc}"
VERIFY_ARGS=()
if [ -n "${SNOWTRACE_API_KEY:-}" ]; then
  VERIFY_ARGS+=(--verify --etherscan-api-key "$SNOWTRACE_API_KEY")
fi

echo "Deploying SafeDealEscrow to Avalanche Fuji C-Chain ($FUJI_RPC_URL)..."
(
  cd "$ROOT_DIR/blockchain" &&
    "$FORGE_BIN" script script/Deploy.s.sol:Deploy \
      --rpc-url "$FUJI_RPC_URL" \
      --broadcast \
      "${VERIFY_ARGS[@]}"
)
