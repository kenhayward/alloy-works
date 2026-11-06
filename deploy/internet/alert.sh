#!/usr/bin/env bash
# Mails ALERT_EMAIL that a unit failed, with its last lines, through the same SMTP settings Keycloak uses.
# Run by alloy-alert@.service, which a deploy or a backup names in OnFailure.
set -euo pipefail

SETTINGS=${ALLOY_SETTINGS:-/etc/alloy-works/internet.env}
unit=${1:?which unit failed}
setting() { sed -n "s/^$1=//p" "$SETTINGS" | tail -1; }
address() { sed 's/.*<\(.*\)>.*/\1/' <<<"$1"; }

to=$(setting ALERT_EMAIL)
from=$(setting SMTP_FROM)
body=$(mktemp)
trap 'rm -f "$body"' EXIT
{
  printf 'From: %s\r\nTo: %s\r\nSubject: Alloy Works: %s failed on %s\r\n\r\n' "$from" "$to" "$unit" "$(hostname)"
  journalctl -u "$unit" -n 40 --no-pager -o short-iso
} >"$body"

# The password goes to curl on its standard input, never its command line.
printf 'user = "%s:%s"\n' "$(setting SMTP_USER)" "$(setting SMTP_PASSWORD)" |
  curl -sS --ssl-reqd --url "smtp://$(setting SMTP_HOST):$(setting SMTP_PORT)" \
    --mail-from "$(address "$from")" --mail-rcpt "$(address "$to")" --upload-file "$body" -K -
