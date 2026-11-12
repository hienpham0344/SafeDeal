#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo binary not found on PATH or ~/.cargo/bin." >&2
  exit 1
fi

FORGE_BIN="$(command -v forge || true)"
if [ -z "$FORGE_BIN" ] && [ -x "$HOME/.foundry/bin/forge" ]; then
  FORGE_BIN="$HOME/.foundry/bin/forge"
fi
if [ -z "$FORGE_BIN" ] && [ -x "/tmp/foundry-tool/forge" ]; then
  FORGE_BIN="/tmp/foundry-tool/forge"
fi
if [ -z "$FORGE_BIN" ]; then
  echo "Error: forge binary not found on PATH, ~/.foundry/bin, or /tmp/foundry-tool." >&2
  exit 1
fi

echo "=== [1/3] Blockchain: Foundry tests ==="
"$FORGE_BIN" test --root "$ROOT_DIR/blockchain" -vvv

echo "=== [2/3] Backend: Rust fmt + clippy + workspace tests + release binary ==="
cargo fmt --manifest-path "$ROOT_DIR/backend/Cargo.toml" --check
cargo clippy --manifest-path "$ROOT_DIR/backend/Cargo.toml" --workspace --all-targets -- -D warnings
cargo test --manifest-path "$ROOT_DIR/backend/Cargo.toml" --workspace -- --test-threads=1
cargo build --release --manifest-path "$ROOT_DIR/backend/Cargo.toml" --bin safedeal-api

echo "=== [3/3] Frontend: Typecheck, Lint, Unit/Integration Tests & Build ==="
npm --prefix "$ROOT_DIR/frontend" run typecheck
npm --prefix "$ROOT_DIR/frontend" run lint
npm --prefix "$ROOT_DIR/frontend" test
npm --prefix "$ROOT_DIR/frontend" run build

if [ "${RUN_E2E:-1}" = "1" ]; then
  echo "=== [Bonus] Frontend: Playwright E2E ==="
  npm --prefix "$ROOT_DIR/frontend" run test:e2e
fi

echo "All SafeDeal verification checks passed."
