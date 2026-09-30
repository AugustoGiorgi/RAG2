#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/agiorgi/apps/RAG2"
LOG_FILE="/home/agiorgi/deploy-rag-tax.log"
LOCK_DIR="/tmp/rag-tax-deploy.lock"
BRANCH="main"
REMOTE="origin"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG_FILE"
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Deploy already running; skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$APP_DIR"
log "Checking for updates..."
git fetch "$REMOTE" "$BRANCH" >> "$LOG_FILE" 2>&1
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  log "No changes. Current SHA: $LOCAL_SHA"
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  log "Refusing non-fast-forward deployment: $REMOTE_SHA over $LOCAL_SHA"
  exit 1
fi

if ! git diff --quiet "$LOCAL_SHA" "$REMOTE_SHA" -- data; then
  log "Refusing deployment that changes tracked live data files."
  exit 1
fi

mkdir -p backups
BACKUP_FILE="$APP_DIR/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).tgz"
(umask 077; tar -czf "$BACKUP_FILE" -C "$APP_DIR" data .env)
log "Saved private pre-deploy backup."

log "Deploying $REMOTE_SHA over $LOCAL_SHA"
git merge --ff-only "$REMOTE/$BRANCH" >> "$LOG_FILE" 2>&1
npm ci --omit=dev >> "$LOG_FILE" 2>&1
npm run check >> "$LOG_FILE" 2>&1
node --env-file=.env scripts/setup-supabase.js >> "$LOG_FILE" 2>&1
pm2 restart rag-tax-ai --update-env >> "$LOG_FILE" 2>&1
sleep 3
curl -fsS --retry 3 --retry-delay 2 https://ragtax-ia.com/healthz >> "$LOG_FILE" 2>&1
printf '\n' >> "$LOG_FILE"
log "Deploy complete: $REMOTE_SHA"
