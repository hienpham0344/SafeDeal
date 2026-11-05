#!/usr/bin/env bash
# Runs every check the CI runs. Requires Java 21 (JAVA_HOME or PATH) and Node 22+.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Backend (Spring Boot) ==="
(cd apps/api && ./mvnw -B clean test)

echo "=== Contracts (Hardhat) ==="
(cd packages/contracts && npm run compile && npm test)

echo "=== Web (Next.js) ==="
(cd apps/web && npm run typecheck && npm run lint && npm test && npm run build)

echo "All checks passed."
