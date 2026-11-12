#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo binary not found on PATH or ~/.cargo/bin." >&2
  exit 1
fi

if [ -f "$ROOT_DIR/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/backend/.env"
  set +a
fi

PROFILE="${APP_ENV:-${SPRING_PROFILES_ACTIVE:-local}}"

if [ -z "${JWT_SECRET:-}" ]; then
  if [ "$PROFILE" = "local" ] && command -v openssl >/dev/null 2>&1; then
    export JWT_SECRET="$(openssl rand -hex 32)"
    echo "Generated ephemeral JWT_SECRET for this local session."
  else
    echo "Error: JWT_SECRET must be set via backend/.env or environment." >&2
    exit 1
  fi
fi

echo "Starting SafeDeal Rust API (env=${PROFILE})..."
exec cargo run --manifest-path "$ROOT_DIR/backend/Cargo.toml" --bin safedeal-api
