#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  local-db-push.sh — apply schema changes to the LOCAL SQLite dev DB
#  WITHOUT ever leaving prisma/schema.prisma in a sqlite state.
# ════════════════════════════════════════════════════════════════════════
#
#  Usage:
#    bash scripts/local-db-push.sh           # push schema → local sqlite
#    bash scripts/local-db-push.sh generate  # just regenerate the client
#
#  This script:
#    1. Backs up the committed postgres schema.prisma
#    2. Copies the sqlite mirror (schema.prisma.local) into place
#    3. Runs `prisma db push` (or `prisma generate`) against local sqlite
#    4. Restores the postgres schema.prisma — ALWAYS, even on error
#
#  The committed schema.prisma never leaves the postgres state.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

SCHEMA_PROD="prisma/schema.prisma"
SCHEMA_LOCAL="prisma/schema.prisma.local"
BACKUP="/tmp/vidora-schema.prod.bak.$$"

# Ensure we always restore the postgres schema, even on error/interrupt
cleanup() {
  if [[ -f "$BACKUP" ]]; then
    cp "$BACKUP" "$SCHEMA_PROD"
    rm -f "$BACKUP"
    echo "✓ Restored postgres schema.prisma"
  fi
}
trap cleanup EXIT INT TERM

# 1. Verify the local mirror exists
if [[ ! -f "$SCHEMA_LOCAL" ]]; then
  echo "❌ $SCHEMA_LOCAL not found. Cannot run local db operations."
  exit 1
fi

# 2. Verify the production schema is postgres (sanity check)
if ! grep -q 'provider = "postgresql"' "$SCHEMA_PROD"; then
  echo "⚠️  WARNING: $SCHEMA_PROD is not postgresql. Aborting to avoid corruption."
  exit 1
fi

# 3. Back up the postgres schema
cp "$SCHEMA_PROD" "$BACKUP"
echo "✓ Backed up postgres schema"

# 4. Swap in the sqlite mirror
cp "$SCHEMA_LOCAL" "$SCHEMA_PROD"
echo "✓ Swapped in sqlite schema for local db operation"

# 5. Run the prisma command
CMD="${1:-push}"
case "$CMD" in
  push)
    echo "▶ Running prisma db push against local sqlite..."
    bunx prisma db push --accept-data-loss
    ;;
  generate)
    echo "▶ Running prisma generate for local sqlite..."
    bunx prisma generate
    ;;
  *)
    echo "Unknown command: $CMD (use 'push' or 'generate')"
    exit 1
    ;;
esac

echo "✓ Local db operation complete"
# trap will restore the postgres schema automatically
