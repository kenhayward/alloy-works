#!/usr/bin/env bash
# compose.internet.yaml's Keycloak: what the realm file must not hold. Safe to run again, and runs at every
# start, so changing a setting and redeploying changes it here. Says no secret.
set -euo pipefail

kcadm=/opt/keycloak/bin/kcadm.sh
realm=alloy
config=/tmp/kcadm.config

echo "Waiting for Keycloak at $KEYCLOAK_URL"
ready=''
for _ in $(seq 1 120); do
  if "$kcadm" config credentials --config "$config" --server "$KEYCLOAK_URL" --realm master \
    --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1 &&
    "$kcadm" get "realms/$realm" --config "$config" --fields realm >/dev/null 2>&1; then
    ready=yes
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "Keycloak did not answer at $KEYCLOAK_URL, or refused its administrator's password." >&2
  exit 1
fi

# Mail: password resets. Over STARTTLS, with the account's own password.
"$kcadm" update "realms/$realm" --config "$config" \
  -s "smtpServer.host=$SMTP_HOST" \
  -s "smtpServer.port=$SMTP_PORT" \
  -s "smtpServer.from=$SMTP_FROM" \
  -s 'smtpServer.fromDisplayName=Alloy Works' \
  -s 'smtpServer.auth=true' \
  -s 'smtpServer.starttls=true' \
  -s "smtpServer.user=$SMTP_USER" \
  -s "smtpServer.password=$SMTP_PASSWORD"

# The client's secret, and where a sign-in may return.
client=$("$kcadm" get clients -r "$realm" --config "$config" -q "clientId=$SIGN_IN_CLIENT_ID" \
  --fields id --format csv --noquotes)
if [ -z "$client" ]; then
  echo "The realm has no client $SIGN_IN_CLIENT_ID." >&2
  exit 1
fi
"$kcadm" update "clients/$client" -r "$realm" --config "$config" \
  -s "secret=$SECRET_SIGN_IN_CLIENT" \
  -s "redirectUris=[\"$ALLOY_REDIRECT_URI\"]"

# The first administrator, once: they change this password and enrol a second factor at first sign-in.
# Their address is verified here, as the invitation they claim requires.
found=$("$kcadm" get users -r "$realm" --config "$config" -q "email=$FIRST_ADMINISTRATOR_EMAIL" \
  -q exact=true --fields id --format csv --noquotes)
if [ -z "$found" ]; then
  "$kcadm" create users -r "$realm" --config "$config" \
    -s "username=$FIRST_ADMINISTRATOR_EMAIL" \
    -s "email=$FIRST_ADMINISTRATOR_EMAIL" \
    -s emailVerified=true \
    -s enabled=true \
    -s 'requiredActions=["CONFIGURE_TOTP","UPDATE_PASSWORD"]'
  "$kcadm" set-password -r "$realm" --config "$config" --username "$FIRST_ADMINISTRATOR_EMAIL" \
    --new-password "$KEYCLOAK_FIRST_ADMIN_PASSWORD" --temporary
  echo "Made the first administrator"
fi

echo "Keycloak is configured"
