#!/usr/bin/env bash
# Vidora development database helper.
# Production parity is intentional: development and tests use PostgreSQL too.
set -euo pipefail

cd "$(dirname "$0")/.."

for envfile in .env prisma/.env; do
  if [[ -f "$envfile" && -z "${DATABASE_URL:-}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Vidora no longer swaps the canonical schema to SQLite."
  exit 1
fi

if [[ "$DATABASE_URL" != postgres://* && "$DATABASE_URL" != postgresql://* && "$DATABASE_URL" != postgres+* && "$DATABASE_URL" != postgresql+* ]]; then
  echo "Vidora development now requires PostgreSQL for parity with production concurrency/locking semantics."
  exit 1
fi

CMD="${1:-push}"
case "$CMD" in
  push)
    if [[ "${NODE_ENV:-development}" == "production" ]]; then
      echo "Refusing prisma db push in production. Use: bunx prisma migrate deploy"
      exit 1
    fi
    echo "Applying canonical schema to the DEVELOPMENT PostgreSQL database..."
    bunx prisma db push
    ;;
  generate)
    bunx prisma generate
    ;;
  *)
    echo "Unknown command: $CMD (use 'push' or 'generate')"
    exit 1
    ;;
esac
