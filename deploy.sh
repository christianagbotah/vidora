#!/usr/bin/env bash
#
# ───────────────────────────────────────────────────────────────────────────
#  Vidora — Production Deploy Script
# ───────────────────────────────────────────────────────────────────────────
#
#  Usage:
#    ./deploy.sh            # full deploy (pull + build + restart)
#    ./deploy.sh --no-pull  # build + restart only (skip git pull)
#
#  This script exists because `pm2 restart vidora` reuses stale environment
#  variables — it does NOT re-read ecosystem.config.js. If you change env
#  vars or pull new code that affects startup, you MUST delete and recreate
#  the PM2 process. This script does that safely.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_DIR="/home/lightworld/webapps/vidora"
cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  Vidora Production Deploy"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Pull latest code (unless --no-pull) ──
if [[ "${1:-}" != "--no-pull" ]]; then
  echo "▶ [1/5] Pulling latest code from git..."
  git pull origin main
else
  echo "▶ [1/5] Skipping git pull (--no-pull)"
fi
echo ""

# ── Step 2: Install any new dependencies ──
echo "▶ [2/5] Checking dependencies..."
if [[ -f package.json ]]; then
  bun install --frozen-lockfile 2>/dev/null || bun install
fi
echo ""

# ── Step 3: Build the standalone production bundle ──
echo "▶ [3/5] Building Next.js standalone bundle..."
echo "  (this takes 2-3 minutes — please wait)"
bun run build
echo ""

# ── Step 4: Ensure logs directory exists ──
mkdir -p logs

# ── Step 5: Recreate PM2 process with fresh env ──
echo "▶ [5/5] Restarting PM2 process (delete + start)..."
# MUST delete + start, NOT just restart — restart reuses stale env vars
# and won't pick up changes to ecosystem.config.js or .env
pm2 delete vidora 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
echo ""

# ── Verify ──
echo "═══════════════════════════════════════════════════════════"
echo "  Verifying server is up..."
echo "═══════════════════════════════════════════════════════════"
sleep 3

echo ""
echo "▶ Port 3004 binding:"
ss -tlnp | grep 3004 || echo "  ⚠  Nothing listening on port 3004!"
echo ""

echo "▶ Health check (local):"
HEALTH=$(curl -s -m 5 http://localhost:3004/api/ai/health || echo "FAILED")
echo "  $HEALTH"
echo ""

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✅ Deploy successful — AI service is operational."
elif echo "$HEALTH" | grep -q '"status":"degraded"'; then
  echo "⚠  Deploy successful — but AI service is degraded (check Z.ai balance)."
elif echo "$HEALTH" | grep -q '"status":"down"'; then
  echo "❌ Server is up but AI service is down. Run: pm2 logs vidora --lines 30"
else
  echo "❌ Health check failed. Server may not be responding."
  echo "   Run: pm2 logs vidora --lines 30 --nostream"
fi
echo ""
echo "Done. Site: https://vidora.lightworldtech.com"
