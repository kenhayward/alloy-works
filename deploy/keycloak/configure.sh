#!/usr/bin/env bash
# Development only (deploy/compose.keycloak.yaml). Sets what a realm file cannot, and is safe to run again.
set -euo pipefail

kcadm=/opt/keycloak/bin/kcadm.sh
realm=alloy
config=/tmp/kcadm.config

# Keycloak takes a while to start, and the realm is imported as it does.
echo "Waiting for Keycloak at $KEYCLOAK_URL"
ready=''
for _ in $(seq 1 90); do
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

# Always ask who is signing in. Signing out of Alloy Works does not end Keycloak's own session, so
# otherwise the last person comes straight back, and trying a second person means a second browser.
cookie=$("$kcadm" get authentication/flows/browser/executions -r "$realm" --config "$config" \
  --fields id,providerId --format csv --noquotes | grep ',auth-cookie$\|^auth-cookie,' | tr -d '"' |
  tr ',' '\n' | grep -v '^auth-cookie$')
"$kcadm" update authentication/flows/browser/executions -r "$realm" --config "$config" \
  -b "{\"id\":\"$cookie\",\"requirement\":\"DISABLED\"}"

# Signing out of Alloy Works leaves that session running, and while it runs Keycloak refuses anybody
# else at the form. The service keeps its own session, needing this one only to finish the sign-in.
"$kcadm" update "realms/$realm" --config "$config" -s ssoSessionMaxLifespan=15

# Where a sign-in may return, which moves with this machine's address.
client=$("$kcadm" get clients -r "$realm" --config "$config" -q clientId=alloy-dev --fields id \
  --format csv --noquotes)
uris=$(printf '%s' "$ALLOY_REDIRECT_URIS" | sed 's/[[:space:]]//g; s/,/","/g')
"$kcadm" update "clients/$client" -r "$realm" --config "$config" -s "redirectUris=[\"$uris\"]"

echo "Keycloak is configured: people sign in at each visit, returning to $ALLOY_REDIRECT_URIS"
