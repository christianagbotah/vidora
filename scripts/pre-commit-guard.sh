#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  pre-commit guard — blocks commits that flip prisma/schema.prisma to sqlite
# ════════════════════════════════════════════════════════════════════════
#
#  Install (one-time, per clone):
#    cp scripts/pre-commit-guard.sh .git/hooks/pre-commit
#    chmod +x .git/hooks/pre-commit
#
#  Or symlink (survives edits to the script):
#    ln -sf ../../scripts/pre-commit-guard.sh .git/hooks/pre-commit
#
#  This prevents anyone from accidentally committing a sqlite schema,
#  which would break the VPS deploy (bun install → prisma generate).
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

# Only check if schema.prisma is staged
if git diff --cached --name-only | grep -q '^prisma/schema\.prisma$'; then
  # Extract the staged version of the file
  STAGED_PROVIDER=$(git show :prisma/schema.prisma | grep -E '^\s*provider\s*=' | grep -v prisma-client | head -1 || true)
  if echo "$STAGED_PROVIDER" | grep -qi 'sqlite'; then
    echo "❌ BLOCKED: prisma/schema.prisma is staged with provider = \"sqlite\""
    echo ""
    echo "   The committed schema MUST be PostgreSQL (production uses Postgres 17)."
    echo "   A sqlite flip breaks the VPS deploy."
    echo ""
    echo "   To apply schema changes to the LOCAL sqlite dev DB, use:"
    echo "     bash scripts/local-db-push.sh"
    echo "   That script swaps in the sqlite mirror, runs db:push, then"
    echo "   restores the postgres schema automatically."
    echo ""
    echo "   If you intentionally need to commit a sqlite schema (you shouldn't),"
    echo "   bypass with: git commit --no-verify"
    exit 1
  fi
  # Confirm postgres is present
  if echo "$STAGED_PROVIDER" | grep -qi 'postgresql'; then
    echo "✓ schema.prisma is postgresql — safe to commit"
  fi
fi

exit 0
