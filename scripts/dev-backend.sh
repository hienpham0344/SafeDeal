#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT_DIR/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/backend/.env"
  set +a
fi

if [ -z "${JAVA_HOME:-}" ] && ! command -v java >/dev/null 2>&1; then
  for jdk_dir in "$HOME"/.jdks/jdk-21*; do
    if [ -d "$jdk_dir/bin" ]; then
      export JAVA_HOME="$jdk_dir"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

if [ -z "${JWT_SECRET:-}" ]; then
  if [ "${SPRING_PROFILES_ACTIVE:-local}" = "local" ] && command -v openssl >/dev/null 2>&1; then
    export JWT_SECRET="$(openssl rand -hex 32)"
    echo "Generated ephemeral JWT_SECRET for this local session."
  else
    echo "Error: JWT_SECRET must be set via backend/.env or environment." >&2
    exit 1
  fi
fi

echo "Starting SafeDeal Spring Boot API (profile=${SPRING_PROFILES_ACTIVE:-local})..."
exec "$ROOT_DIR/backend/gradlew" -p "$ROOT_DIR/backend" bootRun
