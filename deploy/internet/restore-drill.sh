#!/usr/bin/env bash
# Proves the latest backup restores, touching nothing that runs: each dump is loaded into a container of its
# own, on the store's own image, with no network, and checked for its databases and tables; the store's
# files are restored and verified against the repository. Everything it makes is removed. Removes no volume.
# Monthly, from alloy-drill.timer; records each class's restore and how long it took, a failure too, for
# Diagnostics' recovery time (ADR-0101).
set -euo pipefail

ROOT=${ALLOY_ROOT:-/opt/alloy-works}
SETTINGS=${ALLOY_SETTINGS:-/etc/alloy-works/internet.env}
SRC=$ROOT/src

fail() {
  echo "$*" >&2
  exit 1
}
setting() { sed -n "s/^$1=//p" "$SETTINGS" | tail -1; }

RESTIC_REPOSITORY=$(setting RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(setting RESTIC_PASSWORD)
export RESTIC_REPOSITORY RESTIC_PASSWORD

cd "$SRC"
compose() {
  docker compose --env-file "$SETTINGS" -f deploy/compose.yaml -f deploy/compose.internet.yaml "$@"
}

# Each class's run, recorded where Diagnostics reads it (ADR-0101), a failure too. The platform's database
# is named in compose.internet.yaml; a record that cannot be written is said, and fails nothing.
DATABASE=alloy
record() {
  compose exec -T -u postgres postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE" -c \
    "insert into platform.backup_run (class, act, started_at, finished_at, outcome)
     values ('$1', '$2', '$3', now(), '$4')" >/dev/null || echo "The $2 of $1 could not be recorded." >&2
}

TMP=$(mktemp -d /var/tmp/alloy-drill.XXXXXX)
containers=()
current=
started=
cleanup() {
  local status=$?
  for container in "${containers[@]}"; do docker rm -f "$container" >/dev/null 2>&1 || true; done
  rm -rf "$TMP"
  if [ "$status" -ne 0 ] && [ -n "$current" ]; then record "$current" drill "$started" failed; fi
}
trap cleanup EXIT
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

current=databases started=$(now)
restic restore latest --quiet --tag databases --target "$TMP/databases" --verify

for pair in postgres:postgres delivered-postgres:postgres keycloak-postgres:keycloak; do
  store=${pair%:*} user=${pair#*:}
  dump=$(find "$TMP/databases" -name "$store.sql" | head -1)
  [ -s "$dump" ] || fail "No dump of $store in the latest backup."
  image=$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q "$store")")
  name=alloy-drill-$store-$$
  containers+=("$name")
  docker run -d --rm --name "$name" --network none -e POSTGRES_PASSWORD=drill \
    -v "$dump:/dump.sql:ro" "$image" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$name" pg_isready -q -U postgres 2>/dev/null && break
    sleep 1
  done
  # Its roles exist already in a fresh server, so a few errors are expected; what counts is what arrives.
  docker exec "$name" psql -q -U postgres -f /dump.sql >/dev/null 2>"$TMP/$store.log" || true

  expected=$(sed -n 's/^CREATE DATABASE \([^ ]*\) .*/\1/p' "$dump" | tr -d '"' | sort)
  got=$(docker exec "$name" psql -At -U postgres \
    -c "select datname from pg_database where not datistemplate and datname <> 'postgres'" | sort)
  [ "$expected" = "$got" ] || fail "$store restored the databases '$got', not '$expected'."
  # As many tables as the running store has, which an empty delivery store may have none of.
  tables="select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"
  for database in $got; do
    restored=$(docker exec "$name" psql -At -U postgres -d "$database" -c "$tables")
    live=$(compose exec -T -u postgres "$store" psql -At -U "$user" -d "$database" -c "$tables")
    [ "$restored" = "$live" ] || fail "$store's $database restored $restored tables, not $live."
    echo "$store: $database, $restored tables, as running"
  done
done

record databases drill "$started" succeeded

current=objects started=$(now)
restic restore latest --quiet --tag objects --target "$TMP/objects" --verify
files=$(find "$TMP/objects" -type f | wc -l)
[ "$files" -gt 0 ] || fail 'The store restored no files.'
echo "seaweedfs: $files files, $(du -sh "$TMP/objects" | cut -f1), verified"
record objects drill "$started" succeeded
current=
echo "== $(date -Is) the latest backup restores"
