#!/usr/bin/env bash
# RAG Tax AI — restore from a backup produced by scripts/backup.sh.
#
# Usage:
#   ./scripts/restore.sh /var/backups/ragtax/ragtax-20260713-031500.tar.gz
#
# Safety: the current data/ (and friends) are NOT deleted — they are moved to
# *.pre-restore-<timestamp> next to the originals, so a bad restore is reversible.
# After restoring, restart the app:  pm2 restart all

set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 /path/to/ragtax-YYYYMMDD-HHMMSS.tar.gz" >&2
  exit 1
fi

APP_DIR="${RAGTAX_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STAMP="$(date +%Y%m%d-%H%M%S)"
cd "$APP_DIR"

echo "[restore] Backup:   $BACKUP_FILE"
echo "[restore] App dir:  $APP_DIR"
read -r -p "[restore] This will replace live data (current copies kept as *.pre-restore-$STAMP). Continue? [y/N] " CONFIRM
if [ "${CONFIRM,,}" != "y" ]; then
  echo "[restore] Aborted."
  exit 1
fi

# Park the current state.
for p in data client_files knowledge_base review_examples .env; do
  if [ -e "$p" ]; then
    mv "$p" "$p.pre-restore-$STAMP"
    echo "[restore] parked $p -> $p.pre-restore-$STAMP"
  fi
done

tar -xzf "$BACKUP_FILE" -C "$APP_DIR"
echo "[restore] Files restored."
echo "[restore] NOTE: the Postgres mirror will re-sync from data/ as the app writes; for a"
echo "[restore] full DB restore from a ragtax-db-*.sql.gz dump:  gunzip -c DUMP | psql \"\$DATABASE_URL\""
echo "[restore] Now run:  pm2 restart all"
