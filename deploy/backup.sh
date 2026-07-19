#!/usr/bin/env bash
# Nightly Postgres backup for the single-droplet deployment (compose-managed db).
# Keeps 14 days locally; pair with DO droplet snapshots for machine-level recovery.
#
# Install on the droplet:
#   crontab -e
#   15 2 * * * /opt/sherpa/deploy/backup.sh >> /var/log/sherpa-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/opt/sherpa-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP_DIR/sherpa-$STAMP.sql.gz"

find "$BACKUP_DIR" -name 'sherpa-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: sherpa-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/sherpa-$STAMP.sql.gz" | cut -f1))"
