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

BACKUP_RETENTION_SETS="${BACKUP_RETENTION_SETS:-5}"
BACKUP_SPACE_HEADROOM_PERCENT="${BACKUP_SPACE_HEADROOM_PERCENT:-25}"
BACKUP_MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-5}"
if [[ ! "$BACKUP_RETENTION_SETS" =~ ^[0-9]+$ ]] || (( BACKUP_RETENTION_SETS < 1 || BACKUP_RETENTION_SETS > 50 )); then
  echo "FATAL: BACKUP_RETENTION_SETS must be an integer from 1 to 50"
  exit 1
fi
if [[ ! "$BACKUP_SPACE_HEADROOM_PERCENT" =~ ^[0-9]+$ ]] || (( BACKUP_SPACE_HEADROOM_PERCENT > 200 )); then
  echo "FATAL: BACKUP_SPACE_HEADROOM_PERCENT must be an integer from 0 to 200"
  exit 1
fi
if [[ ! "$BACKUP_MIN_FREE_GB" =~ ^[0-9]+$ ]] || (( BACKUP_MIN_FREE_GB > 10000 )); then
  echo "FATAL: BACKUP_MIN_FREE_GB must be an integer from 0 to 10000"
  exit 1
fi

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

# Prefer the last release that actually passed production health over whatever
# commit happens to be checked out on disk. This prevents an out-of-band git
# pull/checkout from silently changing the recovery target. On the first deploy
# after this feature ships there is no marker yet, so the clean on-disk commit is
# the migration-compatible fallback.
ON_DISK_SHA="$(git rev-parse HEAD)"
DEPLOYED_SHA_FILE="$BACKUP_DIR/vidora_deployed_release.sha"
PREVIOUS_SHA="$ON_DISK_SHA"
if [[ -f "$DEPLOYED_SHA_FILE" ]]; then
  CANDIDATE_PREVIOUS_SHA="$(tr -d '\r\n' < "$DEPLOYED_SHA_FILE")"
  if [[ ! "$CANDIDATE_PREVIOUS_SHA" =~ ^[A-Fa-f0-9]{40}$ ]] || ! git cat-file -e "${CANDIDATE_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
    echo "FATAL: deployed release marker is invalid: $DEPLOYED_SHA_FILE"
    exit 1
  fi
  PREVIOUS_SHA="${CANDIDATE_PREVIOUS_SHA,,}"
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
echo "Deploying Vidora commit $RELEASE_SHA (last deployed commit: $PREVIOUS_SHA; on-disk before pull: $ON_DISK_SHA)"

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

# Fail before writing a new recovery set if the backup filesystem cannot hold a
# conservative uncompressed-size estimate plus configured headroom. Old backups
# are never deleted automatically to make a low-space deploy fit; an operator can
# inspect/prune known healthy sets explicitly, and normal retention runs only
# after a release has passed every health gate.
MEDIA_BYTES="$(du -sb -- "$GENERATED_DIR" | awk '{print $1}')"
DATABASE_BYTES="$(psql "$PG_DUMP_DATABASE_URL" -Atqc 'SELECT pg_database_size(current_database())')"
if [[ ! "$MEDIA_BYTES" =~ ^[0-9]+$ || ! "$DATABASE_BYTES" =~ ^[0-9]+$ ]]; then
  echo "FATAL: could not determine media/database size for backup-capacity preflight"
  exit 1
fi
CAPACITY_JSON=""
if ! CAPACITY_JSON="$(bun scripts/backup-policy.ts capacity \
  "$BACKUP_DIR" \
  "$MEDIA_BYTES" \
  "$DATABASE_BYTES" \
  "$BACKUP_SPACE_HEADROOM_PERCENT" \
  "$BACKUP_MIN_FREE_GB")"; then
  echo "FATAL: backup filesystem does not have enough safe free space for a new recovery set"
  echo "Capacity: ${CAPACITY_JSON:-unavailable}"
  echo "Policy: media=${MEDIA_BYTES}B database=${DATABASE_BYTES}B headroom=${BACKUP_SPACE_HEADROOM_PERCENT}% minimum-free=${BACKUP_MIN_FREE_GB}GiB"
  echo "No existing backup was deleted. Review BACKUP_DIR before retrying."
  exit 1
fi
echo "Backup capacity: $CAPACITY_JSON"

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

# Migrations must leave the durable preview/export queue contract usable before
# the running processes are touched. This catches Prisma-vs-migration drift such
# as a missing ExportJob.activeKey column/index and fails closed on the old app.
NODE_ENV=production bun scripts/check-runtime-db-contract.ts

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
# recovery point. The timestamped manifest remains in the backup set; the
# well-known manifest and deployed-SHA marker make current recovery state explicit.
bun scripts/deployment-manifest.ts mark "$MANIFEST_FILE" healthy
cp "$MANIFEST_FILE" "$LAST_SUCCESSFUL_MANIFEST"
chmod 600 "$LAST_SUCCESSFUL_MANIFEST"
DEPLOYED_SHA_TMP="${DEPLOYED_SHA_FILE}.tmp"
printf '%s\n' "$RELEASE_SHA" > "$DEPLOYED_SHA_TMP"
chmod 600 "$DEPLOYED_SHA_TMP"
mv "$DEPLOYED_SHA_TMP" "$DEPLOYED_SHA_FILE"
chmod 600 "$DEPLOYED_SHA_FILE"

# Retention is deliberately post-health and best-effort. It prunes only old
# HEALTHY timestamped recovery sets, preserves every prepared/failed-deploy set,
# never targets emergency rollback snapshots, and keeps the current manifest.
# Cleanup failure does not misreport an already healthy release as failed; the
# next deployment's capacity preflight will still fail closed if space is unsafe.
if ! bun scripts/backup-policy.ts prune "$BACKUP_DIR" "$BACKUP_RETENTION_SETS" "$MANIFEST_FILE"; then
  echo "WARNING: backup retention cleanup failed; no release health state was changed"
fi

echo "Deploy complete"
echo "Commit: $RELEASE_SHA"
echo "Database backup: $BACKUP_FILE"
echo "Media backup: $MEDIA_BACKUP_FILE"
echo "Recovery manifest: $MANIFEST_FILE"
echo "Latest healthy manifest: $LAST_SUCCESSFUL_MANIFEST"
echo "Deployed release marker: $DEPLOYED_SHA_FILE"
echo "Backup retention: keep $BACKUP_RETENTION_SETS healthy recovery set(s)"
echo "Web: HTTP $HTTP_CODE"
echo "AI health: $HEALTH"
