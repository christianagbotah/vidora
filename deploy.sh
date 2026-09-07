#!/usr/bin/env bash
# Vidora production deployment — backup-first, migration-based, fail-closed.
set -euo pipefail

PROJECT_DIR="/home/lightworld/webapps/vidora"
cd "$PROJECT_DIR"

# Capture the code that is currently on disk before this deploy advances main.
# The recovery manifest ties the pre-migration backups to this exact commit.
PREVIOUS_SHA="$(git rev-parse HEAD)"

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

required_env=(
  DATABASE_URL
  NEXTAUTH_URL
  NEXTAUTH_SECRET
  NEXT_PUBLIC_BASE_URL
  CONFIG_ENCRYPTION_KEY
  ZAI_BASE_URL
  ZAI_API_KEY
  GENERATED_DIR
  BACKUP_DIR
)
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
if [[ ${#ZAI_API_KEY} -lt 16 ]] || [[ "$ZAI_API_KEY" == *"CHANGE_ME"* ]]; then
  echo "FATAL: ZAI_API_KEY is missing, weak, or a placeholder"
  exit 1
fi
if [[ "$ZAI_BASE_URL" != https://* ]]; then
  echo "FATAL: ZAI_BASE_URL must use https:// in production"
  exit 1
fi
if [[ "$GENERATED_DIR" != /* ]]; then
  echo "FATAL: GENERATED_DIR must be an absolute path"
  exit 1
fi
case "$GENERATED_DIR" in
  "/"|"$PROJECT_DIR/.next"|"$PROJECT_DIR/.next/"*)
    echo "FATAL: GENERATED_DIR must be a safe absolute path outside .next"
    exit 1
    ;;
esac
if [[ "$BACKUP_DIR" != /* || "$BACKUP_DIR" == "/" ]]; then
  echo "FATAL: BACKUP_DIR must be a safe absolute path"
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
echo "Deploying Vidora commit $RELEASE_SHA (previous on-disk commit: $PREVIOUS_SHA)"

if ! head -30 prisma/schema.prisma | grep -q 'provider = "postgresql"'; then
  echo "FATAL: canonical Prisma schema is not PostgreSQL"
  exit 1
fi

# Dependency install is intentionally frozen. Never silently rewrite bun.lock on production.
bun install --frozen-lockfile

# Media export is a production feature, not an optional host capability. Run the
# exact same synthetic MP4/WebM capability smoke test used by CI before spending
# time on builds/backups or touching migrations/PM2.
bash scripts/check-ffmpeg-export.sh

# Z.ai remains Vidora's video provider in this release, so authenticate the
# effective live Z.ai credential before touching the running release.
NODE_ENV=production bun scripts/check-zai-live.ts

# Provider routing is independently configurable. Validate the ACTIVE primary
# text provider/model, any declared fallback, and the selected TTS provider
# before backup/migration/restart. This prevents a seemingly successful deploy
# with a stale Grok/compatible key or unusable ElevenLabs model/voice mapping.
NODE_ENV=production bun scripts/check-ai-provider-routing-live.ts

# Preflight quality checks happen before backup/migrations/restart.
bunx prisma validate
bunx prisma generate
bun run lint
bun run typecheck
bun run test:unit
bun run build

# Mandatory backups before any production schema mutation/restart.
mkdir -p "$BACKUP_DIR" "$GENERATED_DIR"
chmod 700 "$BACKUP_DIR"
chmod 750 "$GENERATED_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/vidora_db_${STAMP}_${RELEASE_SHA:0:12}.sql.gz"
MEDIA_BACKUP_FILE="$BACKUP_DIR/vidora_media_${STAMP}_${RELEASE_SHA:0:12}.tar.gz"
MANIFEST_FILE="$BACKUP_DIR/vidora_release_${STAMP}_${RELEASE_SHA:0:12}.json"
LAST_SUCCESSFUL_MANIFEST="$BACKUP_DIR/vidora_last_successful_release.json"

# Prisma connection URLs commonly include ?schema=public. Prisma understands
# that parameter, but libpq/pg_dump does not. Remove only the Prisma-specific
# schema parameter for pg_dump while preserving all other connection settings
# (for example sslmode=require on managed PostgreSQL).
PG_DUMP_DATABASE_URL="$(DATABASE_URL="$DATABASE_URL" bun -e '
const raw = process.env.DATABASE_URL;
if (!raw) process.exit(2);
const url = new URL(raw);
url.searchParams.delete("schema");
process.stdout.write(url.toString());
')"

BACKUP_TMP="${BACKUP_FILE}.tmp"
rm -f "$BACKUP_TMP"
echo "Creating PostgreSQL backup: $BACKUP_FILE"
if ! pg_dump --no-owner --no-privileges "$PG_DUMP_DATABASE_URL" | gzip -9 > "$BACKUP_TMP"; then
  echo "FATAL: PostgreSQL backup failed"
  rm -f "$BACKUP_TMP"
  exit 1
fi
if [[ ! -s "$BACKUP_TMP" ]]; then
  echo "FATAL: database backup is empty"
  rm -f "$BACKUP_TMP"
  exit 1
fi
if ! gzip -t "$BACKUP_TMP"; then
  echo "FATAL: database backup archive validation failed"
  rm -f "$BACKUP_TMP"
  exit 1
fi
mv "$BACKUP_TMP" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

echo "Creating generated-media backup: $MEDIA_BACKUP_FILE"
tar -C "$GENERATED_DIR" -czf "$MEDIA_BACKUP_FILE" .
if [[ ! -s "$MEDIA_BACKUP_FILE" ]]; then
  echo "FATAL: generated-media backup is empty or was not created"
  rm -f "$MEDIA_BACKUP_FILE"
  exit 1
fi
tar -tzf "$MEDIA_BACKUP_FILE" >/dev/null
chmod 600 "$MEDIA_BACKUP_FILE"

DB_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
MEDIA_SHA256="$(sha256sum "$MEDIA_BACKUP_FILE" | awk '{print $1}')"

# Write the recovery manifest before touching the schema. If any subsequent
# migration/restart/health step fails, this exact backup set remains available
# for an explicit operator-confirmed rollback.
bun scripts/deployment-manifest.ts write \
  "$MANIFEST_FILE" \
  "$PREVIOUS_SHA" \
  "$RELEASE_SHA" \
  "$BACKUP_FILE" \
  "$DB_SHA256" \
  "$MEDIA_BACKUP_FILE" \
  "$MEDIA_SHA256" \
  "$GENERATED_DIR"
chmod 600 "$MANIFEST_FILE"
echo "Recovery manifest prepared: $MANIFEST_FILE"

# Production schema changes are versioned and reviewable. db push is forbidden.
bunx prisma migrate deploy

mkdir -p logs
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

# PM2 accepting the reload command is not enough. Require the web app and both
# durable workers to settle online AND prove that the current worker PIDs can
# reach PostgreSQL through the PID-bound readiness heartbeat gate.
NODE_ENV=production bun scripts/check-pm2-health.ts

HTTP_CODE="000"
for attempt in 1 2 3 4 5; do
  HTTP_CODE="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/ || true)"
  [[ "$HTTP_CODE" == "200" ]] && break
  sleep 2
done
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FATAL: Vidora did not become reachable after deploy (HTTP $HTTP_CODE)"
  echo "Recovery manifest: $MANIFEST_FILE"
  pm2 logs vidora --lines 80 --nostream || true
  exit 1
fi

HEALTH="$(curl -sS -m 20 http://127.0.0.1:3004/api/ai/health || true)"
if [[ -z "$HEALTH" ]]; then
  echo "FATAL: AI health endpoint did not respond"
  echo "Recovery manifest: $MANIFEST_FILE"
  exit 1
fi
if [[ "$HEALTH" != *'"status":"ok"'* ]]; then
  echo "FATAL: AI service is not configured as production-ready"
  echo "AI health: $HEALTH"
  echo "Recovery manifest: $MANIFEST_FILE"
  exit 1
fi

# Only a release that passed every post-restart gate becomes the latest healthy
# recovery point. The timestamped manifest remains immutable in the backup set;
# the well-known file is a convenience copy for operators.
bun scripts/deployment-manifest.ts mark "$MANIFEST_FILE" healthy
cp "$MANIFEST_FILE" "$LAST_SUCCESSFUL_MANIFEST"
chmod 600 "$LAST_SUCCESSFUL_MANIFEST"

echo "Deploy complete"
echo "Commit: $RELEASE_SHA"
echo "Database backup: $BACKUP_FILE"
echo "Media backup: $MEDIA_BACKUP_FILE"
echo "Recovery manifest: $MANIFEST_FILE"
echo "Latest healthy manifest: $LAST_SUCCESSFUL_MANIFEST"
echo "Web: HTTP $HTTP_CODE"
echo "AI health: $HEALTH"
