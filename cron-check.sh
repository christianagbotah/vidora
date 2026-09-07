#!/bin/bash
# ═══════════════════════════════════════════════════
# Vidora - Production Cron Safety Net
# ═══════════════════════════════════════════════════
# - Restores the nginx proxy config if it gets wiped/changed.
# - Runs stateful Vidora production health monitoring and transition alerts.
# Add to crontab: */5 * * * * /home/lightworld/webapps/vidora/cron-check.sh
# ═══════════════════════════════════════════════════
set -u

APP_DIR="/home/lightworld/webapps/vidora"
TARGET="/var/webuzo-data/nginx/custom/domains/vidora.lightworldtech.com.conf"
SOURCE="$APP_DIR/nginx-proxy.conf"
LOG="$APP_DIR/logs/cron-check.log"

mkdir -p "$APP_DIR/logs"
cd "$APP_DIR" || exit 1

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

restore_nginx() {
    local reason="$1"
    echo "$(date -Is): nginx config $reason; restoring..." >> "$LOG"
    if ! cp "$SOURCE" "$TARGET"; then
        echo "$(date -Is): ERROR failed to copy nginx proxy config" >> "$LOG"
        return 1
    fi
    if nginx -t >> "$LOG" 2>&1 && nginx -s reload >> "$LOG" 2>&1; then
        echo "$(date -Is): nginx config restored and reloaded" >> "$LOG"
        return 0
    fi
    echo "$(date -Is): ERROR nginx validation/reload failed after restore" >> "$LOG"
    return 1
}

NGINX_OK=true
if [ ! -f "$TARGET" ] || [ ! -s "$TARGET" ]; then
    restore_nginx "missing or empty" || NGINX_OK=false
elif ! diff -q "$SOURCE" "$TARGET" > /dev/null 2>&1; then
    restore_nginx "changed" || NGINX_OK=false
fi

MONITOR_OK=true
if ! NODE_ENV=production bun scripts/monitor-production.ts >> "$LOG" 2>&1; then
    MONITOR_OK=false
    echo "$(date -Is): Vidora production monitor reported degraded/down health" >> "$LOG"
fi

if [ "$NGINX_OK" != true ] || [ "$MONITOR_OK" != true ]; then
    exit 1
fi

exit 0
