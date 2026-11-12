#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

echo "=== Checking required toolchains ==="
node -v
npm -v

if ! command -v rustc >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  echo "Error: Rust toolchain (rustc/cargo >= 1.91) is required. Install via https://rustup.rs" >&2
  exit 1
fi
rustc --version
cargo --version

echo "=== Installing frontend dependencies ==="
npm --prefix "$ROOT_DIR/frontend" ci

echo "=== Fetching Cargo workspace dependencies for backend ==="
cargo fetch --manifest-path "$ROOT_DIR/backend/Cargo.toml" --locked

if command -v forge >/dev/null 2>&1; then
  FORGE_BIN="forge"
elif [ -x "$HOME/.foundry/bin/forge" ]; then
  FORGE_BIN="$HOME/.foundry/bin/forge"
else
  FORGE_BIN=""
fi

if [ -n "$FORGE_BIN" ]; then
  echo "=== Foundry detected ==="
  "$FORGE_BIN" --version
  if [ ! -d "$ROOT_DIR/blockchain/lib/forge-std" ] || [ ! -d "$ROOT_DIR/blockchain/lib/openzeppelin-contracts" ]; then
    echo "Installing Foundry submodules/dependencies in blockchain/..."
    (cd "$ROOT_DIR/blockchain" && "$FORGE_BIN" install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git)
  fi
else
  echo "Warning: Foundry (forge/anvil/cast) not found on PATH. Install from https://getfoundry.sh before running blockchain targets."
fi

if [ "${INIT_ENV:-0}" = "1" ]; then
  [ -f "$ROOT_DIR/blockchain/.env" ] || cp "$ROOT_DIR/blockchain/.env.example" "$ROOT_DIR/blockchain/.env"
  [ -f "$ROOT_DIR/backend/.env" ] || cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
  [ -f "$ROOT_DIR/frontend/.env" ] || cp "$ROOT_DIR/frontend/.env.example" "$ROOT_DIR/frontend/.env"
  echo "Initialized missing .env files from .env.example templates."
fi

echo "Install complete."
