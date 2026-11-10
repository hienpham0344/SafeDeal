#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${JAVA_HOME:-}" ] && ! command -v java >/dev/null 2>&1; then
  for jdk_dir in "$HOME"/.jdks/jdk-21*; do
    if [ -d "$jdk_dir/bin" ]; then
      export JAVA_HOME="$jdk_dir"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
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

echo "=== [2/3] Backend: Gradle test + bootJar ==="
"$ROOT_DIR/backend/gradlew" -p "$ROOT_DIR/backend" test bootJar

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
