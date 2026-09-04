#!/usr/bin/env bash
# Vidora production deployment — backup-first, migration-based, fail-closed.
set -euo pipefail

PROJECT_DIR="/home/lightworld/webapps/vidora"
cd "$PROJECT_DIR"

NO_PULL=false
if [[ "${1:-}" == "--no-pull" ]]; then
  NO_PULL=true
elif [[ -n "${1:-}" ]]; then
  echo "Unsupported option: $1"
  echo "Usage: ./deploy.sh [--no-pull]"
  exit 2
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

required_env=(DATABASE_URL NEXTAUTH_URL NEXTAUTH_SECRET NEXT_PUBLIC_BASE_URL CONFIG_ENCRYPTION_KEY BACKUP_DIR)
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "FATAL: required environment variable $name is missing"
    exit 1
  fi
done

if [[ ${#NEXTAUTH_SECRET} -lt 32 ]] || [[ "$NEXTAUTH_SECRET" == *"CHANGE_ME"* ]] || [[ "$NEXTAUTH_SECRET" == "vidora-secret-change-in-production-2024" ]]; then
  echo "FATAL: NEXTAUTH_SECRET is weak, default, or a placeholder"
  exit 1
fi
if [[ ! "$CONFIG_ENCRYPTION_KEY" =~ ^[A-Fa-f0-9]{64}$ ]] && [[ ${#CONFIG_ENCRYPTION_KEY} -lt 43 ]]; then
  echo "FATAL: CONFIG_ENCRYPTION_KEY must represent 32 random bytes"
  exit 1
fi

if [[ "$NO_PULL" == false ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "FATAL: production working tree is dirty; refusing to overwrite local changes"
    exit 1
  fi
  git fetch --prune origin
  git checkout main
  git pull --ff-only origin main
fi

RELEASE_SHA="$(git rev-parse HEAD)"
echo "Deploying Vidora commit $RELEASE_SHA"

if ! head -30 prisma/schema.prisma | grep -q 'provider = "postgresql"'; then
  echo "FATAL: canonical Prisma schema is not PostgreSQL"
  exit 1
fi

# Dependency install is intentionally frozen. Never silently rewrite bun.lock on production.
bun install --frozen-lockfile

# Preflight quality checks happen before backup/migrations/restart.
bunx prisma validate
bunx prisma generate
bun run lint
bun run typecheck
bun run test:unit
bun run build

# Mandatory backup before any production schema mutation.
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/vidora_$(date -u +%Y%m%dT%H%M%SZ)_${RELEASE_SHA:0:12}.sql.gz"
echo "Creating PostgreSQL backup: $BACKUP_FILE"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$BACKUP_FILE"
if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "FATAL: database backup is empty"
  rm -f "$BACKUP_FILE"
  exit 1
fi
gzip -t "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

# Production schema changes are versioned and reviewable. db push is forbidden.
bunx prisma migrate deploy

mkdir -p logs
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

# Fail closed on web reachability. AI dependency may report degraded, but the
# endpoint itself must remain reachable so operations can distinguish outage types.
for attempt in 1 2 3 4 5; do
  HTTP_CODE="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/ || true)"
  [[ "$HTTP_CODE" == "200" ]] && break
  sleep 2
done
if [[ "${HTTP_CODE:-000}" != "200" ]]; then
  echo "FATAL: Vidora did not become reachable after deploy (HTTP ${HTTP_CODE:-000})"
  pm2 logs vidora --lines 80 --nostream || true
  exit 1
fi

HEALTH="$(curl -sS -m 20 http://127.0.0.1:3004/api/ai/health || true)"
if [[ -z "$HEALTH" ]]; then
  echo "FATAL: AI health endpoint did not respond"
  exit 1
fi

echo "Deploy complete"
echo "Commit: $RELEASE_SHA"
echo "Backup: $BACKUP_FILE"
echo "Web: HTTP $HTTP_CODE"
echo "AI health: $HEALTH"
