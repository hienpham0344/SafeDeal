#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Checking required toolchains ==="
node -v
npm -v
java -version || {
  for jdk_dir in "$HOME"/.jdks/jdk-21*; do
    if [ -d "$jdk_dir/bin" ]; then
      export JAVA_HOME="$jdk_dir"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
  if command -v java >/dev/null 2>&1; then
    java -version
  else
    echo "Error: Java 21 is required." >&2
    exit 1
  fi
}

echo "=== Installing frontend dependencies ==="
npm --prefix "$ROOT_DIR/frontend" ci

echo "=== Verifying Gradle wrapper for backend ==="
chmod +x "$ROOT_DIR/backend/gradlew"
"$ROOT_DIR/backend/gradlew" -p "$ROOT_DIR/backend" --version

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
