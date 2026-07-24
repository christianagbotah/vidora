#!/bin/bash
# auto-git.sh — Watches for file changes and auto-commits + pushes to GitHub
# Usage: bun run auto-git (runs in background)
# Token: Set GITHUB_TOKEN env var or it reads from ~/.github_token

PROJECT_DIR="/home/z/my-project"
LOG_FILE="$PROJECT_DIR/auto-git.log"

# Read token from env var or file
if [ -n "$GITHUB_TOKEN" ]; then
  TOKEN="$GITHUB_TOKEN"
elif [ -f "$HOME/.github_token" ]; then
  TOKEN=$(cat "$HOME/.github_token")
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: No GITHUB_TOKEN found" | tee -a "$LOG_FILE"
  exit 1
fi

REMOTE_URL="https://${TOKEN}@github.com/christianagbotah/vidora.git"

cd "$PROJECT_DIR" || exit 1

# Ensure remote is configured
git remote get-url origin > /dev/null 2>&1 || git remote add origin "$REMOTE_URL"
git remote set-url origin "$REMOTE_URL"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

auto_commit_and_push() {
  cd "$PROJECT_DIR" || return

  # Check if there are any changes
  if git diff --quiet HEAD -- . ':!*.log' ':!auto-git.log' ':!/public/generated/' ':!/db/' ':!/tool-results/' 2>/dev/null; then
    return
  fi

  # Check for untracked files (excluding ignored)
  UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null)
  CHANGED=$(git diff --name-only HEAD 2>/dev/null)

  if [ -z "$CHANGED" ] && [ -z "$UNTRACKED" ]; then
    return
  fi

  # Stage all changes (respecting .gitignore)
  git add -A 2>/dev/null

  # Generate commit message based on changed files
  FILES=$(git diff --cached --name-only 2>/dev/null | head -20)
  COMMIT_MSG="auto: update ${FILES}" 
  # Truncate if too long
  if [ ${#COMMIT_MSG} -gt 200 ]; then
    COMMIT_MSG="auto: sync project files"
  fi

  # Commit
  git commit -m "$COMMIT_MSG" --no-verify 2>/dev/null

  # Push
  BRANCH=$(git branch --show-current 2>/dev/null)
  git push origin "$BRANCH" 2>/dev/null

  log "Committed and pushed: $COMMIT_MSG"
}

log "Auto-git watcher started"

# Main loop: check every 10 seconds
while true; do
  auto_commit_and_push
  sleep 10
done
