#!/usr/bin/env bash
# RAG Tax AI — daily backup (run on the VPS via cron).
#
# Backs up everything needed for a FULL recovery:
#   • data/            — primary stores (db, users, tracker, tokens, feedback, audit, cost log)
#   • client_files/    — uploaded client documents (CLIENT_FILES_DIR)
#   • knowledge_base/  — curated tax knowledge
#   • review_examples/ — curated review examples
#   • .env             — secrets, INCLUDING TOKEN_ENCRYPTION_KEY (without it the encrypted
#                        OAuth tokens in any backup are unrecoverable). Backups therefore
#                        contain secrets: the backup dir is chmod 700 and files 600.
#   • Postgres dump    — only if pg_dump is installed and DATABASE_URL is set (the DB is a
#                        mirror of data/, so this is a second layer, not the primary).
#
# Install (as the user that runs the app):
#   chmod +x scripts/backup.sh scripts/restore.sh
#   crontab -e   →   15 3 * * * /ruta/al/repo/scripts/backup.sh >> /var/log/ragtax-backup.log 2>&1
#
# Retention: last 14 daily backups are kept, older ones deleted.

set -euo pipefail

APP_DIR="${RAGTAX_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${RAGTAX_BACKUP_DIR:-/var/backups/ragtax}"
RETENTION_DAYS="${RAGTAX_BACKUP_RETENTION:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/ragtax-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Collect the paths that exist (client_files dir name may vary with CLIENT_FILES_DIR).
cd "$APP_DIR"
PATHS=()
for p in data client_files knowledge_base review_examples .env; do
  [ -e "$p" ] && PATHS+=("$p")
done
if [ "${#PATHS[@]}" -eq 0 ]; then
  echo "[backup] ERROR: nothing to back up under $APP_DIR" >&2
  exit 1
fi

tar -czf "$TARGET" "${PATHS[@]}"
chmod 600 "$TARGET"

# Optional Postgres dump (second layer — the DB mirrors data/).
if command -v pg_dump >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  PGDUMP_TARGET="$BACKUP_DIR/ragtax-db-$STAMP.sql.gz"
  if pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$PGDUMP_TARGET"; then
    chmod 600 "$PGDUMP_TARGET"
  else
    rm -f "$PGDUMP_TARGET"
    echo "[backup] WARN: pg_dump failed (data/ tarball is still complete)." >&2
  fi
fi

# Rotation.
find "$BACKUP_DIR" -name "ragtax-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "ragtax-db-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

SIZE="$(du -h "$TARGET" | cut -f1)"
COUNT="$(ls -1 "$BACKUP_DIR"/ragtax-*.tar.gz 2>/dev/null | wc -l)"
echo "[backup] OK $STAMP — $TARGET ($SIZE), $COUNT backups retained."

# OFFSITE (strongly recommended): uncomment ONE of these after configuring the tool, so a
# dead VPS disk does not take the backups with it.
#   rclone copy "$TARGET" remote:ragtax-backups/          # any S3/Drive/Dropbox via rclone
#   scp -q "$TARGET" backupuser@otherhost:/backups/ragtax/
