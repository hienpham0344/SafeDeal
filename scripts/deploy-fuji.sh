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
CHAIN_ID="${FUJI_CHAIN_ID:-43113}"
ROUTESCAN_VERIFIER_URL="${ROUTESCAN_VERIFIER_URL:-https://api.routescan.io/v2/network/testnet/evm/${CHAIN_ID}/etherscan/api}"
SNOWTRACE_API_KEY="${SNOWTRACE_API_KEY:-verifyContract}"

echo "Deploying SafeDealEscrow to Avalanche Fuji C-Chain ($FUJI_RPC_URL, chainId=$CHAIN_ID)..."
OUTPUT=$(
  cd "$ROOT_DIR/blockchain" &&
    "$FORGE_BIN" script script/Deploy.s.sol:Deploy \
      --rpc-url "$FUJI_RPC_URL" \
      --broadcast 2>&1
)
echo "$OUTPUT"

ADDRESS=$(echo "$OUTPUT" | grep -oE 'SafeDealEscrow deployed at: 0x[0-9a-fA-F]{40}' | awk '{print $NF}' | tail -n 1 || true)
if [ -n "$ADDRESS" ]; then
  mkdir -p "$ROOT_DIR/blockchain/deployments"
  cat >"$ROOT_DIR/blockchain/deployments/fuji-${CHAIN_ID}.json" <<EOF
{
  "chainId": ${CHAIN_ID},
  "network": "avalanche-fuji",
  "contractName": "SafeDealEscrow",
  "address": "${ADDRESS}",
  "rpcUrl": "${FUJI_RPC_URL}"
}
EOF
  if [ -f "$ROOT_DIR/blockchain/out/SafeDealEscrow.sol/SafeDealEscrow.json" ]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); json.dump(d["abi"], open(sys.argv[2], "w"), indent=2); open(sys.argv[2], "a").write("\n")' \
        "$ROOT_DIR/blockchain/out/SafeDealEscrow.sol/SafeDealEscrow.json" \
        "$ROOT_DIR/blockchain/deployments/SafeDealEscrow.abi.json"
    elif command -v jq >/dev/null 2>&1; then
      jq '.abi' "$ROOT_DIR/blockchain/out/SafeDealEscrow.sol/SafeDealEscrow.json" >"$ROOT_DIR/blockchain/deployments/SafeDealEscrow.abi.json"
    fi
  fi

  echo ""
  echo "Verifying SafeDealEscrow ($ADDRESS) on Routescan / Snowtrace..."
  "$FORGE_BIN" verify-contract \
    --root "$ROOT_DIR/blockchain" \
    "$ADDRESS" \
    src/SafeDealEscrow.sol:SafeDealEscrow \
    --chain-id "$CHAIN_ID" \
    --verifier custom \
    --verifier-url "$ROUTESCAN_VERIFIER_URL" \
    --verifier-api-key "$SNOWTRACE_API_KEY" \
    --watch

  echo ""
  echo "Verifying SafeDealEscrow ($ADDRESS) on Sourcify..."
  "$FORGE_BIN" verify-contract \
    --root "$ROOT_DIR/blockchain" \
    "$ADDRESS" \
    src/SafeDealEscrow.sol:SafeDealEscrow \
    --chain-id "$CHAIN_ID" \
    --verifier sourcify \
    --watch

  echo ""
  echo "Export into backend/.env and frontend/.env:"
  echo "  ESCROW_CONTRACT_ADDRESS=${ADDRESS}"
  echo "  VITE_ESCROW_CONTRACT_ADDRESS=${ADDRESS}"
fi
