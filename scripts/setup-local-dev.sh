#!/bin/bash
# Swap to SQLite schema for local development and regenerate client
set -euo pipefail
cd "$(dirname "$0")/.."

if grep -q 'provider = "sqlite"' prisma/schema.prisma; then
  echo "✓ Already using SQLite schema for local dev"
else
  cp prisma/schema.prisma prisma/schema.prisma.postgres-backup
  cp prisma/schema.prisma.local prisma/schema.prisma
  echo "✓ Swapped to SQLite schema for local dev"
fi

mkdir -p db
bunx prisma db push --accept-data-loss 2>&1
bunx prisma generate 2>&1
echo "✓ Local dev ready (SQLite)"
