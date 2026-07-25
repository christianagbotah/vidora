#!/bin/bash
# ═══════════════════════════════════════════════════
# Vidora - Setup Nginx Reverse Proxy
# ═══════════════════════════════════════════════════
# Run this after git pull or anytime Webuzo resets nginx configs
# Usage: bash setup-nginx.sh
# ═══════════════════════════════════════════════════

DOMAIN="vidora.lightworldtech.com"
APP_PORT=3004
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBUZO_CUSTOM="/var/webuzo-data/nginx/custom/domains"
CONF_D="/usr/local/apps/nginx/etc/conf.d"

echo "🔧 Vidora Nginx Setup"
echo "======================"

# 1. Create custom domains directory if missing
mkdir -p "$WEBUZO_CUSTOM"

# 2. Remove any standalone vhost config (conflicts with Webuzo)
if [ -f "$CONF_D/vidora.conf" ]; then
    echo "⚠️  Removing old standalone vhost config..."
    rm -f "$CONF_D/vidora.conf"
fi

# 3. Copy proxy config to Webuzo's custom include path
echo "📋 Installing proxy config for $DOMAIN..."
cp "$SCRIPT_DIR/nginx-proxy.conf" "$WEBUZO_CUSTOM/$DOMAIN.conf"

# 4. Test nginx config
echo "🧪 Testing nginx config..."
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx config test FAILED. Not reloading."
    exit 1
fi

# 5. Reload nginx
echo "🔄 Reloading nginx..."
nginx -s reload

echo "✅ Done! $DOMAIN → proxy to port $APP_PORT"
echo ""
echo "💡 If Webuzo resets this config, just run: bash setup-nginx.sh"
