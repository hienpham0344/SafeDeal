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
  echo "Error: Export DEPLOYER_PRIVATE_KEY for the target local Anvil account before deploying." >&2
  exit 1
fi

RPC_URL="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
CHAIN_ID="${LOCAL_CHAIN_ID:-31337}"

echo "Deploying SafeDealEscrow to local Anvil ($RPC_URL, chainId=$CHAIN_ID)..."
OUTPUT=$(
  cd "$ROOT_DIR/blockchain" &&
    "$FORGE_BIN" script script/Deploy.s.sol:Deploy \
      --rpc-url "$RPC_URL" \
      --broadcast 2>&1
)
echo "$OUTPUT"

ADDRESS=$(echo "$OUTPUT" | grep -oE 'SafeDealEscrow deployed at: 0x[0-9a-fA-F]{40}' | awk '{print $NF}' | tail -n 1 || true)
if [ -n "$ADDRESS" ]; then
  mkdir -p "$ROOT_DIR/blockchain/deployments"
  cat >"$ROOT_DIR/blockchain/deployments/local-${CHAIN_ID}.json" <<EOF
{
  "chainId": ${CHAIN_ID},
  "contractName": "SafeDealEscrow",
  "address": "${ADDRESS}",
  "rpcUrl": "${RPC_URL}"
}
EOF
  echo ""
  echo "Export into backend/.env and frontend/.env:"
  echo "  ESCROW_CONTRACT_ADDRESS=${ADDRESS}"
  echo "  VITE_ESCROW_CONTRACT_ADDRESS=${ADDRESS}"
fi
