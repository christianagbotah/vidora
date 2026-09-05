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
  "$PROJECT_DIR/.next"|"$PROJECT_DIR/.next/"*)
    echo "FATAL: GENERATED_DIR must live outside .next so deploys cannot erase media"
    exit 1
    ;;
esac
if [[ "$BACKUP_DIR" != /* ]]; then
  echo "FATAL: BACKUP_DIR must be an absolute path"
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

# Media export is a production feature, not an optional host capability. Validate
# the exact FFmpeg surface used by Vidora before spending time on build/backups
# or restarting PM2. This catches stripped FFmpeg builds where filters/codecs
# are listed partially or fail only when a customer starts an export.
for media_bin in ffmpeg ffprobe; do
  if ! command -v "$media_bin" >/dev/null 2>&1; then
    echo "FATAL: $media_bin is required for Vidora video export but is not installed"
    exit 1
  fi
done

FFMPEG_FILTERS="$(ffmpeg -hide_banner -filters 2>&1 || true)"
required_ffmpeg_filters=(
  drawtext xfade concat scale pad setsar fps format
  aresample aformat volume atrim asetpts afade adelay amix
)
for filter_name in "${required_ffmpeg_filters[@]}"; do
  if ! grep -Eq "[[:space:]]${filter_name}[[:space:]]" <<<"$FFMPEG_FILTERS"; then
    echo "FATAL: FFmpeg filter '$filter_name' is unavailable; install a full FFmpeg build before deploying"
    exit 1
  fi
done

FFMPEG_ENCODERS="$(ffmpeg -hide_banner -encoders 2>&1 || true)"
required_ffmpeg_encoders=(libx264 aac libvpx libopus)
for encoder_name in "${required_ffmpeg_encoders[@]}"; do
  if ! grep -Eq "[[:space:]]${encoder_name}[[:space:]]" <<<"$FFMPEG_ENCODERS"; then
    echo "FATAL: FFmpeg encoder '$encoder_name' is unavailable; Vidora cannot provide all advertised export formats"
    exit 1
  fi
done

# A filter/encoder can be listed yet still fail at runtime because of missing
# font libraries, codec linkage, muxers, or incompatible filter support. Run a
# tiny synthetic encode through the same core graph used by Vidora: normalized
# scene inputs + xfade + narration/music-style audio filters + amix. Exercise
# both advertised output families (MP4/H.264/AAC and WebM/VP8/Opus).
FFMPEG_SMOKE_DIR="$(mktemp -d)"
cleanup_ffmpeg_smoke() { rm -rf "$FFMPEG_SMOKE_DIR"; }
trap cleanup_ffmpeg_smoke EXIT
printf '%s\n' 'Vidora' > "$FFMPEG_SMOKE_DIR/title.txt"

if ! ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i "color=c=black:s=320x180:d=0.1:r=24" \
  -vf "drawtext=textfile='$FFMPEG_SMOKE_DIR/title.txt':expansion=none:fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2" \
  -frames:v 1 -f null - >/dev/null 2>&1; then
  echo "FATAL: FFmpeg drawtext runtime probe failed; title-card export would be degraded"
  exit 1
fi

FFMPEG_SMOKE_GRAPH="[0:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n0];[1:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n1];[n0][n1]xfade=transition=fade:duration=0.2:offset=0.8[outv];[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.500,atrim=duration=0.9,asetpts=PTS-STARTPTS,afade=t=out:st=0.3:d=0.2,adelay=10:all=1[a0];[3:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.300,atrim=duration=0.9,asetpts=PTS-STARTPTS,afade=t=out:st=0.3:d=0.2,adelay=200:all=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]"

ffmpeg_smoke_inputs=(
  -f lavfi -i "color=c=black:s=320x180:d=1.2:r=24"
  -f lavfi -i "color=c=gray:s=320x180:d=1.2:r=24"
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1.0"
  -f lavfi -i "sine=frequency=660:sample_rate=44100:duration=1.0"
)

if ! ffmpeg -nostdin -hide_banner -loglevel error -y \
  "${ffmpeg_smoke_inputs[@]}" \
  -filter_complex "$FFMPEG_SMOKE_GRAPH" \
  -map "[outv]" -map "[aout]" \
  -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart \
  -t 1.5 "$FFMPEG_SMOKE_DIR/vidora-smoke.mp4"; then
  echo "FATAL: FFmpeg MP4 smoke encode failed; Vidora H.264/AAC export is not production-ready"
  exit 1
fi
if [[ ! -s "$FFMPEG_SMOKE_DIR/vidora-smoke.mp4" ]]; then
  echo "FATAL: FFmpeg MP4 smoke encode produced no output"
  exit 1
fi

if ! ffmpeg -nostdin -hide_banner -loglevel error -y \
  "${ffmpeg_smoke_inputs[@]}" \
  -filter_complex "$FFMPEG_SMOKE_GRAPH" \
  -map "[outv]" -map "[aout]" \
  -c:v libvpx -crf 32 -b:v 0 -cpu-used 8 \
  -c:a libopus -b:a 96k \
  -t 1.5 "$FFMPEG_SMOKE_DIR/vidora-smoke.webm"; then
  echo "FATAL: FFmpeg WebM smoke encode failed; Vidora VP8/Opus export is not production-ready"
  exit 1
fi
if [[ ! -s "$FFMPEG_SMOKE_DIR/vidora-smoke.webm" ]]; then
  echo "FATAL: FFmpeg WebM smoke encode produced no output"
  exit 1
fi

cleanup_ffmpeg_smoke
trap - EXIT

echo "FFmpeg export capability preflight: OK"

# Public AI health intentionally checks configuration only. Deployment performs
# one admin-equivalent free-model call locally so stale/expired credentials can
# never produce a false-success release. It runs before backup/migration/restart.
NODE_ENV=production bun scripts/check-zai-live.ts

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

# Production schema changes are versioned and reviewable. db push is forbidden.
bunx prisma migrate deploy

mkdir -p logs
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

HTTP_CODE="000"
for attempt in 1 2 3 4 5; do
  HTTP_CODE="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:3004/ || true)"
  [[ "$HTTP_CODE" == "200" ]] && break
  sleep 2
done
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FATAL: Vidora did not become reachable after deploy (HTTP $HTTP_CODE)"
  pm2 logs vidora --lines 80 --nostream || true
  exit 1
fi

HEALTH="$(curl -sS -m 20 http://127.0.0.1:3004/api/ai/health || true)"
if [[ -z "$HEALTH" ]]; then
  echo "FATAL: AI health endpoint did not respond"
  exit 1
fi
if [[ "$HEALTH" != *'"status":"ok"'* ]]; then
  echo "FATAL: AI service is not configured as production-ready"
  echo "AI health: $HEALTH"
  exit 1
fi

echo "Deploy complete"
echo "Commit: $RELEASE_SHA"
echo "Database backup: $BACKUP_FILE"
echo "Media backup: $MEDIA_BACKUP_FILE"
echo "Web: HTTP $HTTP_CODE"
echo "AI health: $HEALTH"
