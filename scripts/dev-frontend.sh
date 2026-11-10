#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT_DIR/frontend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/frontend/.env"
  set +a
fi

echo "Starting SafeDeal Vite development server..."
exec npm --prefix "$ROOT_DIR/frontend" run dev
