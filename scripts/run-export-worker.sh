#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [[ -z "$BUN_BIN" ]]; then
  echo "FATAL: bun executable not found in PATH and BUN_BIN is not set" >&2
  exit 127
fi

exec "$BUN_BIN" scripts/export-worker-entry.ts
