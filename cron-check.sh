#!/bin/bash
# ═══════════════════════════════════════════════════
# Vidora - Cron Safety Net
# ═══════════════════════════════════════════════════
# Auto-restores nginx proxy config if it gets wiped
# Add to crontab: */5 * * * * /home/lightworld/webapps/vidora/cron-check.sh
# ═══════════════════════════════════════════════════

APP_DIR="/home/lightworld/webapps/vidora"
TARGET="/var/webuzo-data/nginx/custom/domains/vidora.lightworldtech.com.conf"
SOURCE="$APP_DIR/nginx-proxy.conf"
LOG="$APP_DIR/logs/cron-check.log"

mkdir -p "$APP_DIR/logs"

# Check if target exists and has content
if [ ! -f "$TARGET" ] || [ ! -s "$TARGET" ]; then
    echo "$(date): ⚠️ Config missing or empty, restoring..." >> "$LOG"
    cp "$SOURCE" "$TARGET"
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null
    echo "$(date): ✅ Config restored and nginx reloaded" >> "$LOG"
    exit 0
fi

# Check if content matches (in case it was overwritten with wrong content)
if ! diff -q "$SOURCE" "$TARGET" > /dev/null 2>&1; then
    echo "$(date): ⚠️ Config changed, restoring correct version..." >> "$LOG"
    cp "$SOURCE" "$TARGET"
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null
    echo "$(date): ✅ Config restored and nginx reloaded" >> "$LOG"
    exit 0
fi

# Everything is fine, silent exit
exit 0
