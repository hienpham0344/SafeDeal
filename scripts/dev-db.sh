#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required to launch the local PostgreSQL container via infra/docker-compose.yml." >&2
  exit 1
fi

echo "Starting PostgreSQL container..."
docker compose -f "$ROOT_DIR/infra/docker-compose.yml" up -d postgres

echo "Waiting for PostgreSQL readiness..."
for _ in $(seq 1 30); do
  if docker compose -f "$ROOT_DIR/infra/docker-compose.yml" exec -T postgres \
    pg_isready -U "${DB_USERNAME:-safedeal}" -d "${DB_NAME:-safedeal}" >/dev/null 2>&1; then
    echo "PostgreSQL is ready on localhost:${DB_PORT:-5432}."
    exit 0
  fi
  sleep 1
done

echo "Error: PostgreSQL did not become ready within 30 seconds." >&2
exit 1
