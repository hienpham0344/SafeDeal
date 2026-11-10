#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Stopping local docker compose services and resetting DB/evidence volumes..."
if command -v docker >/dev/null 2>&1; then
  docker compose -f "$ROOT_DIR/infra/docker-compose.yml" down -v || true
fi

rm -rf "$ROOT_DIR/backend/storage/evidence"
mkdir -p "$ROOT_DIR/backend/storage/evidence"
rm -f "$ROOT_DIR/blockchain/deployments"/local-*.json

echo "Local SafeDeal development state reset."
