#!/bin/bash
# Restore PostgreSQL schema before git commit/push
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f prisma/schema.prisma.postgres-backup ]; then
  cp prisma/schema.prisma.postgres-backup prisma/schema.prisma
  rm prisma/schema.prisma.postgres-backup
  echo "✓ Restored PostgreSQL schema"
else
  echo "✓ Already using PostgreSQL schema"
fi
