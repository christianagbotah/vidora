#!/usr/bin/env bash
# Vidora production rollback — explicit, manifest-bound, destructive, fail-closed.
set -euo pipefail

PROJECT_DIR="/home/lightworld/webapps/vidora"
cd "$PROJECT_DIR"

usage() {
  echo "Usage: ./rollback.sh --manifest /absolute/path/to/manifest.json --confirm-destructive-restore"
}

MANIFEST_FILE=""
CONFIRMED=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      MANIFEST_FILE="$2"
      shift 2
      ;;
    --confirm-destructive-restore)
      CONFIRMED=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unsupported option: $1"
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$MANIFEST_FILE" || "$CONFIRMED" != true ]]; then
  echo "FATAL: rollback requires both --manifest and --confirm-destructive-restore"
  usage
  exit 2
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

required_env=(DATABASE_URL GENERATED_DIR BACKUP_DIR)
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "FATAL: required environment variable $name is missing"
    exit 1
  fi
done

if [[ "$GENERATED_DIR" != /* || "$GENERATED_DIR" == "/" ]]; then
  echo "FATAL: GENERATED_DIR must be a safe absolute path"
  exit 1
fi
if [[ "$BACKUP_DIR" != /* || "$BACKUP_DIR" == "/" ]]; then
  echo "FATAL: BACKUP_DIR must be a safe absolute path"
  exit 1
fi
if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "FATAL: BACKUP_DIR does not exist: $BACKUP_DIR"
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "FATAL: production working tree is dirty; rollback refuses to overwrite local changes"
  exit 1
fi

BACKUP_DIR_REAL="$(realpath "$BACKUP_DIR")"
MANIFEST_REAL="$(realpath "$MANIFEST_FILE")"
case "$MANIFEST_REAL" in
  "$BACKUP_DIR_REAL"/*) ;;
  *)
    echo "FATAL: manifest must live inside BACKUP_DIR"
    exit 1
    ;;
esac

FIELDS_TMP="$(mktemp)"
cleanup_tmp() { rm -f "$FIELDS_TMP"; }
trap cleanup_tmp EXIT
if ! bun scripts/deployment-manifest.ts fields "$MANIFEST_REAL" > "$FIELDS_TMP"; then
  echo "FATAL: recovery manifest is invalid"
  exit 1
fi
mapfile -d '' -t FIELDS < "$FIELDS_TMP"
if [[ ${#FIELDS[@]} -ne 8 ]]; then
  echo "FATAL: recovery manifest returned an unexpected field set"
  exit 1
fi

PREVIOUS_SHA="${FIELDS[0]}"
RELEASE_SHA="${FIELDS[1]}"
DATABASE_BACKUP="${FIELDS[2]}"
DATABASE_BACKUP_SHA256="${FIELDS[3]}"
MEDIA_BACKUP="${FIELDS[4]}"
MEDIA_BACKUP_SHA256="${FIELDS[5]}"
MANIFEST_GENERATED_DIR="${FIELDS[6]}"
MANIFEST_STATUS="${FIELDS[7]}"
CURRENT_SHA="$(git rev-parse HEAD)"

if [[ "$CURRENT_SHA" != "$RELEASE_SHA" ]]; then
  echo "FATAL: manifest release $RELEASE_SHA does not match current checkout $CURRENT_SHA"
  echo "Refusing to apply backups to a different release."
  exit 1
fi
if ! git cat-file -e "${PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  echo "FATAL: previous release commit is not available locally: $PREVIOUS_SHA"
  exit 1
fi

DATABASE_BACKUP_REAL="$(realpath "$DATABASE_BACKUP")"
MEDIA_BACKUP_REAL="$(realpath "$MEDIA_BACKUP")"
for backup in "$DATABASE_BACKUP_REAL" "$MEDIA_BACKUP_REAL"; do
  case "$backup" in
    "$BACKUP_DIR_REAL"/*) ;;
    *)
      echo "FATAL: manifest backup path escapes BACKUP_DIR: $backup"
      exit 1
      ;;
  esac
done

GENERATED_DIR_REAL="$(realpath -m "$GENERATED_DIR")"
MANIFEST_GENERATED_REAL="$(realpath -m "$MANIFEST_GENERATED_DIR")"
if [[ "$GENERATED_DIR_REAL" != "$MANIFEST_GENERATED_REAL" ]]; then
  echo "FATAL: manifest generated directory does not match current GENERATED_DIR"
  exit 1
fi
case "$GENERATED_DIR_REAL" in
  "/"|"$PROJECT_DIR"|"$PROJECT_DIR/.next"|"$PROJECT_DIR/.next/"*)
    echo "FATAL: refusing unsafe generated-media restore target: $GENERATED_DIR_REAL"
    exit 1
    ;;
esac

actual_db_sha="$(sha256sum "$DATABASE_BACKUP_REAL" | awk '{print $1}')"
actual_media_sha="$(sha256sum "$MEDIA_BACKUP_REAL" | awk '{print $1}')"
if [[ "$actual_db_sha" != "$DATABASE_BACKUP_SHA256" ]]; then
  echo "FATAL: database backup checksum mismatch"
  exit 1
fi
if [[ "$actual_media_sha" != "$MEDIA_BACKUP_SHA256" ]]; then
  echo "FATAL: media backup checksum mismatch"
  exit 1
fi
gzip -t "$DATABASE_BACKUP_REAL"
tar -tzf "$MEDIA_BACKUP_REAL" >/dev/null

DB_SCHEMA="$(DATABASE_URL="$DATABASE_URL" bun -e '
const raw = process.env.DATABASE_URL;
if (!raw) process.exit(2);
const url = new URL(raw);
process.stdout.write(url.searchParams.get("schema") || "public");
')"
if [[ "$DB_SCHEMA" != "public" ]]; then
  echo "FATAL: rollback currently supports only the canonical public PostgreSQL schema (found: $DB_SCHEMA)"
  exit 1
fi
PG_DATABASE_URL="$(DATABASE_URL="$DATABASE_URL" bun -e '
const raw = process.env.DATABASE_URL;
if (!raw) process.exit(2);
const url = new URL(raw);
url.searchParams.delete("schema");
process.stdout.write(url.toString());
')"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EMERGENCY_DB="$BACKUP_DIR_REAL/vidora_emergency_db_${STAMP}_${RELEASE_SHA:0:12}.sql.gz"
EMERGENCY_MEDIA="$BACKUP_DIR_REAL/vidora_emergency_media_${STAMP}_${RELEASE_SHA:0:12}.tar.gz"
ROLLBACK_RECORD="$BACKUP_DIR_REAL/vidora_rollback_${STAMP}_${RELEASE_SHA:0:12}_to_${PREVIOUS_SHA:0:12}.txt"
DEPLOYED_SHA_FILE="$BACKUP_DIR_REAL/vidora_deployed_release.sha"

SERVICES_STOPPED=false
DESTRUCTIVE_STARTED=false
stop_vidora_services() {
  # Set this before the first stop command. If PM2 fails halfway through the
  # list, the error handler knows it must restart the untouched current release.
  SERVICES_STOPPED=true
  for app in vidora vidora-generation-worker vidora-export-worker; do
    if pm2 describe "$app" >/dev/null 2>&1; then
      pm2 stop "$app"
    fi
  done
}
restart_current_release() {
  echo "Attempting to restart the current release because destructive restore has not begun..."
  pm2 startOrReload ecosystem.config.js --update-env || true
  pm2 save || true
  SERVICES_STOPPED=false
}
on_error() {
  local code=$?
  trap - ERR
  if [[ "$DESTRUCTIVE_STARTED" == true ]]; then
    echo "Stopping Vidora because rollback failed after destructive restore began..."
    stop_vidora_services || true
    echo "FATAL: rollback failed after destructive restore began. Services have been stopped; recover manually using:"
    echo "  Emergency DB: $EMERGENCY_DB"
    echo "  Emergency media: $EMERGENCY_MEDIA"
    echo "  Intended recovery DB: $DATABASE_BACKUP_REAL"
    echo "  Intended recovery media: $MEDIA_BACKUP_REAL"
  elif [[ "$SERVICES_STOPPED" == true ]]; then
    restart_current_release
  fi
  exit "$code"
}
trap on_error ERR

cat <<EOF
Vidora production rollback
  Manifest status: $MANIFEST_STATUS
  Current release:  $RELEASE_SHA
  Restore code to:  $PREVIOUS_SHA
  Database backup:  $DATABASE_BACKUP_REAL
  Media backup:     $MEDIA_BACKUP_REAL
  Generated dir:    $GENERATED_DIR_REAL
EOF

# Stop every Vidora writer before taking emergency snapshots so the database and
# generated-media archives describe one quiesced failed/current state.
stop_vidora_services

# Preserve the failed/current database before destructive restore. If either
# emergency snapshot fails, the ERR handler restarts the untouched current release.
echo "Creating emergency database snapshot: $EMERGENCY_DB"
EMERGENCY_DB_TMP="${EMERGENCY_DB}.tmp"
pg_dump --no-owner --no-privileges "$PG_DATABASE_URL" | gzip -9 > "$EMERGENCY_DB_TMP"
gzip -t "$EMERGENCY_DB_TMP"
[[ -s "$EMERGENCY_DB_TMP" ]]
mv "$EMERGENCY_DB_TMP" "$EMERGENCY_DB"
chmod 600 "$EMERGENCY_DB"

echo "Creating emergency media snapshot: $EMERGENCY_MEDIA"
mkdir -p "$GENERATED_DIR_REAL"
tar -C "$GENERATED_DIR_REAL" -czf "$EMERGENCY_MEDIA" .
tar -tzf "$EMERGENCY_MEDIA" >/dev/null
[[ -s "$EMERGENCY_MEDIA" ]]
chmod 600 "$EMERGENCY_MEDIA"

DESTRUCTIVE_STARTED=true

# Restore the pre-deploy database. The production schema is intentionally
# constrained to public so this destructive operation cannot guess at custom
# schema layouts.
echo "Restoring PostgreSQL database from manifest backup..."
psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL
gunzip -c "$DATABASE_BACKUP_REAL" | psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1

# Restore generated media only after both archives have passed checksum/archive
# validation and all Vidora writer processes are stopped.
echo "Restoring generated media..."
find "$GENERATED_DIR_REAL" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -C "$GENERATED_DIR_REAL" -xzf "$MEDIA_BACKUP_REAL"
chmod 750 "$GENERATED_DIR_REAL"

# Run the previous release without rewriting the main branch. A normal future
# deploy will explicitly checkout main again.
echo "Checking out previous release: $PREVIOUS_SHA"
git checkout --detach "$PREVIOUS_SHA"
bun install --frozen-lockfile
bunx prisma validate
bunx prisma generate
bunx prisma migrate deploy
bun run build

mkdir -p logs
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
SERVICES_STOPPED=false
NODE_ENV=production bun scripts/check-pm2-health.ts

HTTP_CODE="000"
for attempt in 1 2 3 4 5; do
  HTTP_CODE="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/ || true)"
  [[ "$HTTP_CODE" == "200" ]] && break
  sleep 2
done
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FATAL: rolled-back Vidora did not become reachable (HTTP $HTTP_CODE)"
  false
fi

HEALTH="$(curl -sS -m 20 http://127.0.0.1:3004/api/ai/health || true)"
if [[ -z "$HEALTH" || "$HEALTH" != *'"status":"ok"'* ]]; then
  echo "FATAL: rolled-back AI health gate failed"
  echo "AI health: $HEALTH"
  false
fi

# The release marker is updated only after every recovery health gate succeeds.
DEPLOYED_SHA_TMP="${DEPLOYED_SHA_FILE}.tmp"
printf '%s\n' "$PREVIOUS_SHA" > "$DEPLOYED_SHA_TMP"
chmod 600 "$DEPLOYED_SHA_TMP"
mv "$DEPLOYED_SHA_TMP" "$DEPLOYED_SHA_FILE"
chmod 600 "$DEPLOYED_SHA_FILE"

{
  echo "status=completed"
  echo "completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "manifest=$MANIFEST_REAL"
  echo "from_release=$RELEASE_SHA"
  echo "to_release=$PREVIOUS_SHA"
  echo "database_backup=$DATABASE_BACKUP_REAL"
  echo "media_backup=$MEDIA_BACKUP_REAL"
  echo "emergency_database_backup=$EMERGENCY_DB"
  echo "emergency_media_backup=$EMERGENCY_MEDIA"
  echo "deployed_release_marker=$DEPLOYED_SHA_FILE"
  echo "web_http=$HTTP_CODE"
} > "$ROLLBACK_RECORD"
chmod 600 "$ROLLBACK_RECORD"

echo "Rollback complete"
echo "Code: $PREVIOUS_SHA (detached HEAD)"
echo "Deployed release marker: $DEPLOYED_SHA_FILE"
echo "Emergency database snapshot: $EMERGENCY_DB"
echo "Emergency media snapshot: $EMERGENCY_MEDIA"
echo "Rollback record: $ROLLBACK_RECORD"
echo "Web: HTTP $HTTP_CODE"
echo "AI health: $HEALTH"
