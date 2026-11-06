#!/usr/bin/env bash
# Deploys a published release of compose.internet.yaml (README.md beside this). Lives in $ROOT, outside the
# checkout it moves.
#
#   deploy.sh settings   makes the settings file from the example
#   deploy.sh check      says what it would do and changes nothing
#   deploy.sh auto       the newest release, unless it is here already or failed
#   deploy.sh latest     the newest release, retrying one that failed
#   deploy.sh <ref>      that tag or branch; going back needs the data restored
#
# Stops at the first problem, with the old stack running where it can be. Removes no volume.
set -euo pipefail

ROOT=${ALLOY_ROOT:-/opt/alloy-works}
SETTINGS=${ALLOY_SETTINGS:-/etc/alloy-works/internet.env}
SOURCE_REPO=https://github.com/kenhayward/alloy-works.git
RELEASES_REPO=https://github.com/kenhayward/aw-releases.git
KEEP_BACKUPS=7
SRC=$ROOT/src
STATE=$ROOT/state
BACKUPS=$ROOT/backups

fail() {
  echo "$*" >&2
  exit 1
}

mode=${1:-auto}

setting() { sed -n "s/^$1=//p" "$SETTINGS" | tail -1; }

if [ "$mode" = settings ]; then
  [ ! -e "$SETTINGS" ] || fail "$SETTINGS is there already, and holds the only copy of its keys."
  example=${2:-$ROOT/internet.env.example}
  umask 077
  mkdir -p "$(dirname "$SETTINGS")"
  while IFS= read -r line; do
    case "$line" in
    *=GENERATE) echo "${line%=*}=$(openssl rand -hex 32)" ;;
    *=GENERATE_KEY) echo "${line%=*}=$(openssl rand -base64 32)" ;;
    *) printf '%s\n' "$line" ;;
    esac
  done <"$example" >"$SETTINGS"
  echo "Wrote $SETTINGS. Fill in each CHANGE_ME, and keep a copy somewhere safe."
  exit 0
fi

[ -r "$SETTINGS" ] || fail "$SETTINGS is missing: run deploy.sh settings."
unset_names=$(sed -n 's/^\([A-Z_]*\)=\(CHANGE_ME\|GENERATE\|GENERATE_KEY\)$/\1/p' "$SETTINGS")
[ -z "$unset_names" ] || fail "Still to fill in, in $SETTINGS: $unset_names"
[ "$(stat -c %a "$SETTINGS")" = 600 ] || fail "$SETTINGS must be readable by root alone (600)."

newest() {
  git ls-remote --tags --refs --sort=-v:refname "$RELEASES_REPO" 'refs/tags/v*' |
    head -1 | sed 's#.*refs/tags/##'
}

mkdir -p "$STATE" "$BACKUPS"
deployed=$(cat "$STATE/deployed" 2>/dev/null || true)
failed=$(cat "$STATE/failed" 2>/dev/null || true)

case "$mode" in
auto | latest | check)
  target=$(newest)
  [ -n "$target" ] || fail "No release found at $RELEASES_REPO."
  ;;
*) target=$mode ;;
esac

if [ "$mode" = check ]; then
  echo "Deployed: ${deployed:-nothing}. Failed: ${failed:-nothing}. Newest release: $target."
  exit 0
fi
if [ "$mode" = auto ] && [ "$target" = "$deployed" ]; then exit 0; fi
if [ "$mode" = auto ] && [ "$target" = "$failed" ]; then
  echo "$target failed before, so it waits for a newer release or deploy.sh latest."
  exit 0
fi

exec 9>"$STATE/lock"
flock -w 3600 9 || fail "Another deploy or a backup held the lock for an hour."

echo "== $(date -Is) deploying $target over ${deployed:-nothing}"
[ -d "$SRC/.git" ] || git clone --quiet --no-checkout "$SOURCE_REPO" "$SRC"
cd "$SRC"
git fetch --quiet --force --tags origin '+refs/heads/*:refs/remotes/origin/*'
if git rev-parse --verify --quiet "refs/tags/$target^{commit}" >/dev/null; then
  ref=refs/tags/$target
else
  ref=refs/remotes/origin/$target
fi
if ! git cat-file -e "$ref:deploy/compose.internet.yaml" 2>/dev/null; then
  echo "$target does not have this stack yet, so it is left alone."
  exit 0
fi
git checkout --quiet --force --detach "$ref"

compose() {
  docker compose --env-file "$SETTINGS" -f deploy/compose.yaml -f deploy/compose.internet.yaml "$@"
}
NODE_AUTH_TOKEN=$(setting NODE_AUTH_TOKEN)
export NODE_AUTH_TOKEN

record_failure() {
  echo "$target" >"$STATE/failed"
  fail "$target failed: $1. Nothing rolls back by itself, since migrations only go forward."
}

# A failed build changes nothing that is running.
compose build || fail "The build of $target failed; the old stack is still running."

# Before anything migrates, if there is a database yet.
if [ -n "$(compose ps -q --status running postgres)" ]; then
  umask 077
  dump=$BACKUPS/before-${target//\//-}-from-${deployed//\//-}.sql
  compose exec -T postgres pg_dumpall -U postgres >"$dump.partial" ||
    fail "The backup failed, so $target is not deployed."
  mv "$dump.partial" "$dump"
  find "$BACKUPS" -name 'before-*.sql' -printf '%T@ %p\n' | sort -rn | tail -n "+$((KEEP_BACKUPS + 1))" |
    cut -d' ' -f2- | xargs -r rm --
fi

compose up -d --wait --wait-timeout 900 --remove-orphans || record_failure "it did not come up"

# Through the door itself: the service, answering for nobody signed in.
app=$(setting ALLOY_APP_HOST)
answer=''
for _ in $(seq 1 30); do
  answer=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$app:443:127.0.0.1" \
    "https://$app/v1/me" || true)
  [ "$answer" = 401 ] && break
  sleep 2
done
[ "$answer" = 401 ] || record_failure "the service answered $answer rather than 401"

echo "$target" >"$STATE/deployed"
rm -f "$STATE/failed"

# What runs beside the stack follows it: the scripts, the units and, where a backup machine pulls, rsyncd.
# The timers keep whatever was enabled; the firewall runs again only if a release changed its rules.
firewall_was=$(cat "$ROOT/firewall.sh" /etc/systemd/system/alloy-firewall.service 2>/dev/null | sha256sum)
for script in deploy/internet/*.sh; do
  install -m 755 "$script" "$ROOT/$(basename "$script")"
done
install -m 644 deploy/internet/internet.env.example "$ROOT/internet.env.example"
for unit in deploy/internet/alloy-*; do
  install -m 644 "$unit" /etc/systemd/system/
done
systemctl daemon-reload
if [ "$(cat "$ROOT/firewall.sh" /etc/systemd/system/alloy-firewall.service | sha256sum)" != "$firewall_was" ]; then
  systemctl restart alloy-firewall.service
fi
pull=$(setting BACKUP_PULL_ADDRESS)
if [ -n "$pull" ] && [ -f deploy/internet/rsyncd.conf ]; then
  [[ $pull =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail "BACKUP_PULL_ADDRESS '$pull' is not an IPv4 address."
  sed "s/NAS_ADDRESS/$pull/" deploy/internet/rsyncd.conf >/etc/rsyncd.conf.new
  chmod 644 /etc/rsyncd.conf.new
  mv /etc/rsyncd.conf.new /etc/rsyncd.conf
fi
echo "== $(date -Is) $target is up"
