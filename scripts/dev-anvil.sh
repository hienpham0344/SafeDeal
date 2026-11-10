#!/usr/bin/env bash
set -euo pipefail

ANVIL_BIN="$(command -v anvil || true)"
if [ -z "$ANVIL_BIN" ] && [ -x "$HOME/.foundry/bin/anvil" ]; then
  ANVIL_BIN="$HOME/.foundry/bin/anvil"
fi

if [ -z "$ANVIL_BIN" ]; then
  echo "Error: anvil binary not found. Install Foundry before running local node." >&2
  exit 1
fi

HOST="${ANVIL_HOST:-127.0.0.1}"
PORT="${ANVIL_PORT:-8545}"
CHAIN_ID="${LOCAL_CHAIN_ID:-31337}"
BLOCK_TIME="${ANVIL_BLOCK_TIME:-}"

ARGS=(--host "$HOST" --port "$PORT" --chain-id "$CHAIN_ID")
if [ -n "$BLOCK_TIME" ]; then
  ARGS+=(--block-time "$BLOCK_TIME")
fi

echo "Starting Anvil on http://$HOST:$PORT (chainId=$CHAIN_ID)..."
exec "$ANVIL_BIN" "${ARGS[@]}"
