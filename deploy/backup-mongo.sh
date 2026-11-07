#!/usr/bin/env bash
#
# Nightly MongoDB backup for a self-hosted DermaLens AI.
#
# Dumps the application database out of the running compose stack into a
# gzipped archive, verifies the archive is real, then prunes old ones. Safe to
# run by hand at any time; designed to be run from cron as the user that owns
# the deployment (normally `dermalens`).
#
#     bash deploy/backup-mongo.sh
#
# Install (as root):
#     cp deploy/dermalens-backup.cron /etc/cron.d/dermalens-backup
#     chmod 0644 /etc/cron.d/dermalens-backup
#
# Restore the most recent backup:
#     cd <repo> && docker compose exec -T mongo sh -c \
#       'mongorestore --archive --gzip --drop \
#          --username "$MONGO_INITDB_ROOT_USERNAME" \
#          --password "$MONGO_INITDB_ROOT_PASSWORD" \
#          --authenticationDatabase admin' < ~/backups/dermalens-YYYYmmdd-HHMM.gz
#
# What this protects: accounts, per-account analysis counters (which gate the
# paywall), subscription records and device activations. Photos, scan results
# and notes live on each user's phone and are never on this server.

set -euo pipefail

# cron runs with a near-empty environment.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST_DIR="${DEST_DIR:-$HOME/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Floor for a plausible archive. A dump of a database with collections but no
# documents is legitimately only a few hundred bytes, so this is deliberately
# low — it exists to catch an empty or truncated file, not to judge content.
# Integrity is checked properly by gzip -t below.
MIN_BYTES="${MIN_BYTES:-256}"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"; }
die() { printf '%s ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >&2; exit 1; }

cd "$REPO_DIR" || die "cannot enter $REPO_DIR"

# Database name, as the backend is configured to use it.
DB_NAME="$(grep -E '^DB_NAME=' backend/.env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
DB_NAME="${DB_NAME:-dermalens}"

docker compose ps --status running --services 2>/dev/null | grep -qx mongo \
	|| die "the 'mongo' service is not running in $REPO_DIR"

mkdir -p "$DEST_DIR"
STAMP="$(date -u +%Y%m%d-%H%M)"
TMP="$DEST_DIR/.dermalens-$STAMP.gz.partial"
OUT="$DEST_DIR/dermalens-$STAMP.gz"

log "dumping database '$DB_NAME' -> $OUT"

# Credentials are read from the mongo container's own environment, so the
# password never appears in this script, in the host's process list, or in a
# shell history.
if ! docker compose exec -T mongo sh -c '
		mongodump --quiet --archive --gzip \
			--db "'"$DB_NAME"'" \
			--username "$MONGO_INITDB_ROOT_USERNAME" \
			--password "$MONGO_INITDB_ROOT_PASSWORD" \
			--authenticationDatabase admin
	' > "$TMP"; then
	rm -f "$TMP"
	die "mongodump failed; keeping existing backups untouched"
fi

SIZE="$(stat -c %s "$TMP" 2>/dev/null || echo 0)"
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
	rm -f "$TMP"
	die "dump was only ${SIZE} bytes (< ${MIN_BYTES}); treating as failed"
fi

# mongodump --gzip writes a gzip stream, so this catches a truncated or
# corrupted archive — a far better check than guessing at a size.
if ! gzip -t "$TMP" 2>/dev/null; then
	rm -f "$TMP"
	die "archive failed its gzip integrity check; treating as failed"
fi

# Only now is the backup considered good — rename is atomic, so a half-written
# file is never mistaken for a usable backup.
mv "$TMP" "$OUT"
log "wrote $OUT ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B"))"

# Prune only after a successful dump, so a run of failures can never empty the
# backup directory.
DELETED="$(find "$DEST_DIR" -maxdepth 1 -name 'dermalens-*.gz' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
[ "$DELETED" -gt 0 ] && log "pruned $DELETED backup(s) older than $RETENTION_DAYS days"

KEPT="$(find "$DEST_DIR" -maxdepth 1 -name 'dermalens-*.gz' | wc -l)"
log "done; $KEPT backup(s) in $DEST_DIR"
