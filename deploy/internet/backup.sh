#!/usr/bin/env bash
# Nightly, from alloy-backup.timer: dumps the three databases, then sends the dumps and the object store's
# files to RESTIC_REPOSITORY, encrypted with RESTIC_PASSWORD. Keeps 7 days, 4 weeks and 6 months, then
# checks the repository. Lives in $ROOT beside deploy.sh, and shares its lock. Removes no volume.
set -euo pipefail

ROOT=${ALLOY_ROOT:-/opt/alloy-works}
SETTINGS=${ALLOY_SETTINGS:-/etc/alloy-works/internet.env}
SRC=$ROOT/src
WORK=$ROOT/backups/nightly

fail() {
  echo "$*" >&2
  exit 1
}
setting() { sed -n "s/^$1=//p" "$SETTINGS" | tail -1; }

command -v restic >/dev/null || fail 'restic is not installed: apt install restic.'
RESTIC_REPOSITORY=$(setting RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(setting RESTIC_PASSWORD)
case "$RESTIC_REPOSITORY" in '' | CHANGE_ME) fail "RESTIC_REPOSITORY is not set in $SETTINGS." ;; esac
case "$RESTIC_PASSWORD" in '' | GENERATE) fail "RESTIC_PASSWORD is not set in $SETTINGS." ;; esac
export RESTIC_REPOSITORY RESTIC_PASSWORD

# Never while a deploy moves the containers.
exec 9>"$ROOT/state/lock"
flock -w 3600 9 || fail 'A deploy held the lock for an hour.'

cd "$SRC"
compose() {
  docker compose --env-file "$SETTINGS" -f deploy/compose.yaml -f deploy/compose.internet.yaml "$@"
}

echo "== $(date -Is) backing up"
umask 077
rm -rf "$WORK"
mkdir -p "$WORK"
dump() {
  compose exec -T -u postgres "$1" pg_dumpall -U "$2" >"$WORK/$1.sql" || fail "The dump of $1 failed."
}
dump postgres postgres
dump delivered-postgres postgres
dump keycloak-postgres keycloak

store=$(compose ps -q seaweedfs)
[ -n "$store" ] || fail 'The store (seaweedfs) is not running.'
data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$store")
[ -d "$data" ] || fail "The store's files are not at '$data'."

# Group-readable, so the backup machine's pull (rsyncd.conf) reads it without root.
umask 027
restic cat config >/dev/null 2>&1 || restic init
deployed=$(cat "$ROOT/state/deployed" 2>/dev/null || echo unknown)
restic backup --quiet --tag databases --tag "release-${deployed//\//-}" "$WORK"

# Paused so its files hold still while they are read; downloads wait those seconds.
compose pause seaweedfs >/dev/null
trap 'compose unpause seaweedfs >/dev/null' EXIT
restic backup --quiet --tag objects --tag "release-${deployed//\//-}" "$data"
compose unpause seaweedfs >/dev/null
trap - EXIT

restic forget --quiet --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --quiet
rm -rf "$WORK"
echo "== $(date -Is) backed up"
