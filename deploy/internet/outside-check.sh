#!/usr/bin/env bash
# The outside check (README.md beside this): what a caller on the internet can and cannot do to an
# installation, as requests with expected answers. Run it from a checkout, from outside the network, after
# any change to the stack:
#
#   outside-check.sh <app name> <sign-in name> <store name> [bucket]
#
# ALLOY_CHECK_SSH=<ssh host> also reads the door's log there and, with ALLOY_CHECK_LAN="<address>:<port> ...",
# tries those LAN addresses from inside the containers. ALLOY_CHECK_CREDENTIALS=yes tries development's
# published passwords and keys, read from the files that publish them; a person runs that part.
# Changes nothing but a sign-in attempt, which expires. Every check runs; the exit status counts failures.
set -uo pipefail

app=${1:?the app name} idp=${2:?the sign-in name} store=${3:?the store name} bucket=${4:-alloy}
repo=$(cd "$(dirname "$0")/../.." && pwd)
failures=0

section() { printf '\n== %s\n' "$1"; }
pass() { printf '  pass  %s\n' "$1"; }
failed() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}
skip() { printf '  skip  %s\n' "$1"; }
# A label, the answers wanted (an extended regular expression) and the answer got.
expect() { if [[ $3 =~ $2 ]]; then pass "$1: ${3:0:60}"; else failed "$1: wanted $2, got '${3:0:200}'"; fi; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
# The address Keycloak's sign-in page is at, as the app sends a browser there.
sign_in_url() { curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$@" "https://$app/v1/sign-in/organisation"; }
remote() { ssh -o BatchMode=yes "$ALLOY_CHECK_SSH" "$@"; }
container() { echo "\$(sudo docker ps -q -f label=com.docker.compose.project=alloy-works -f label=com.docker.compose.service=$1)"; }

section 'headers'
headers=$(curl -sI --max-time 20 "https://$app/" | tr -d '\r' | tr 'A-Z' 'a-z')
for want in 'strict-transport-security: max-age=' 'x-content-type-options: nosniff' 'x-frame-options: deny' \
  'referrer-policy: strict-origin-when-cross-origin'; do
  if grep -q "^$want" <<<"$headers"; then pass "$want"; else failed "no '$want' on the app's page"; fi
done
server=$(sed -n 's/^server: //p' <<<"$headers")
if [ -z "$server" ]; then pass 'no Server header'; else failed "the app's page names its server: $server"; fi

section 'forged host'
real=$(sign_in_url)
expect 'the sign-in returns to the app' "redirect_uri=https%3A%2F%2F${app//./\\.}%2F" "$real"
forged=$(sign_in_url -H 'X-Forwarded-Host: forged.invalid')
expect 'and still does with a forged X-Forwarded-Host' "redirect_uri=https%3A%2F%2F${app//./\\.}%2F" "$forged"
for name in forged.invalid localhost staging.localhost; do
  body=$(curl -sk --max-time 20 --connect-to "$name:443:$app:443" "https://$name/health")
  if [ "$body" = '{"status":"ok"}' ]; then failed "the service answers for Host: $name"; else pass "nothing answers for Host: $name"; fi
done

section 'forged client address'
nonce=outside-check-$RANDOM$RANDOM
status -H 'X-Forwarded-For: 203.0.113.66' "https://$app/health?$nonce" >/dev/null
if [ -n "${ALLOY_CHECK_SSH:-}" ]; then
  line=$(remote "sudo docker logs --since 10m $(container public-proxy) 2>&1 | grep -F $nonce | tail -1")
  seen=$(sed -n 's/.*"client_ip":"\([^"]*\)".*/\1/p' <<<"$line")
  if [ -z "$seen" ]; then
    failed 'the door logged no client address for the request'
  elif [ "$seen" = 203.0.113.66 ]; then
    failed 'the door believed a forged X-Forwarded-For'
  else
    pass "the door logged $seen, not the forged 203.0.113.66"
  fi
else
  skip 'needs ALLOY_CHECK_SSH to read the door log'
fi

section 'blocked paths'
for path in /admin /admin/ /admin/master/console/ /realms/master /realms/master/.well-known/openid-configuration \
  //admin/ /%61dmin/master/console/ /realms/%6daster/.well-known/openid-configuration \
  /realms/alloy/../master/.well-known/openid-configuration '/admin;x/master/console/' \
  '/realms/master;x/.well-known/openid-configuration' /realms/master%3Bx/.well-known/openid-configuration \
  '/realms/alloy/..;/master/.well-known/openid-configuration' /health /metrics /js/; do
  expect "$path" '^404$' "$(status --path-as-is "https://$idp$path")"
done
for path in /realms/master/protocol/openid-connect/token '/realms/master;x/protocol/openid-connect/token'; do
  expect "the token endpoint of master, at $path" '^404$' \
    "$(status --path-as-is -X POST -d grant_type=password -d client_id=admin-cli "https://$idp$path")"
done
expect 'the realm itself still answers' '^200$' "$(status "https://$idp/realms/alloy/.well-known/openid-configuration")"

section 'the store'
expect 'no list of buckets' '^404$' "$(status "https://$store/")"
expect 'no bucket made' '^404$' "$(status -X PUT "https://$store/outside-check-bucket")"
expect 'no IAM' '^404$' "$(status -X POST -d 'Action=ListUsers&Version=2010-05-08' "https://$store/")"
expect 'no climbing out of the bucket' '^404$' "$(status --path-as-is "https://$store/$bucket/../")"
expect 'no anonymous listing of the bucket' '^403$' "$(status "https://$store/$bucket/?list-type=2")"
expect 'no anonymous read' '^(403|404)$' "$(status "https://$store/$bucket/outside-check")"
expect 'no anonymous write' '^403$' "$(status -X PUT --data outside-check "https://$store/$bucket/outside-check")"

section 'registration'
login=$(sign_in_url)
page=$(curl -s --max-time 20 "$login")
if [[ $page == *'id="username"'* ]]; then pass 'the sign-in page is there'; else failed 'no sign-in page to look at'; fi
if [[ $page == *registration* ]]; then failed 'the sign-in page offers registration'; else pass 'and offers no registration'; fi
form=$(curl -s --max-time 20 "${login/\/auth\?//registrations?}")
if [[ $form == *'id="kc-register-form"'* ]]; then failed 'the registration form answers'; else pass 'nor answers at registrations'; fi

section 'published credentials'
if [ "${ALLOY_CHECK_CREDENTIALS:-}" = yes ]; then
  key=$(sed -n 's/^ *AWS_ACCESS_KEY_ID: //p' "$repo/deploy/compose.yaml" | head -1)
  secret=$(sed -n 's/^ *AWS_SECRET_ACCESS_KEY: //p' "$repo/deploy/compose.yaml" | head -1)
  expect "the store refuses development's key" '^403$' \
    "$(status --aws-sigv4 'aws:amz:us-east-1:s3' --user "$key:$secret" "https://$store/$bucket/?list-type=2")"
  realm=$repo/deploy/keycloak/alloy-realm.json
  client_secret=$(sed -n 's/^ *"secret": "\(.*\)",*$/\1/p' "$realm" | head -1)
  expect "Keycloak refuses development's client" '^(400|401)$' \
    "$(status -d grant_type=client_credentials -d client_id=alloy-dev --data-urlencode "client_secret=$client_secret" \
      "https://$idp/realms/alloy/protocol/openid-connect/token")"
  password=$(sed -n 's/^ *"value": "\(.*\)",*$/\1/p' "$realm" | head -1)
  for user in $(sed -n 's/^ *"username": "\(.*\)",*$/\1/p' "$realm"); do
    jar=$(mktemp)
    action=$(curl -s -c "$jar" -b "$jar" --max-time 20 "$(sign_in_url)" |
      sed -n 's/.*id="kc-form-login"[^>]*action="\([^"]*\)".*/\1/p' | sed 's/&amp;/\&/g')
    answer=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -c "$jar" -b "$jar" --max-time 20 \
      --data-urlencode "username=$user" --data-urlencode "password=$password" "$action")
    rm -f "$jar"
    if [ -z "$action" ]; then
      failed "no sign-in form to try $user at"
    elif [[ $answer == 302*code=* ]]; then
      failed "Keycloak let $user in with development's password"
    else
      pass "Keycloak refuses $user with development's password"
    fi
  done
else
  skip 'set ALLOY_CHECK_CREDENTIALS=yes to try them'
fi

section 'ports'
address=$(curl -s -o /dev/null -w '%{remote_ip}' --max-time 20 "https://$app/health")
open=''
for port in 21 22 23 25 53 80 81 110 143 445 873 2375 2376 3000 3306 5432 6379 8000 8080 8088 8333 8443 8888 9000 \
  9090 9091 9333 9443 10000; do
  if timeout 4 bash -c "exec 3<>/dev/tcp/$address/$port" 2>/dev/null; then open+=" $port"; fi
done
if [ -z "$open" ]; then pass "$address answers on none of the usual ports but 443"; else failed "$address answers on$open"; fi
echo '        From inside the network this reaches the router itself; only a scan from outside counts.'

section 'from inside'
if [ -n "${ALLOY_CHECK_SSH:-}" ] && [ -n "${ALLOY_CHECK_LAN:-}" ]; then
  try='const [h,p]=process.argv[1].split(":");const s=require("net").connect(+p,h);
s.setTimeout(12000,()=>{console.log("closed");process.exit()});s.on("connect",()=>{console.log("open");process.exit()});
s.on("error",()=>{console.log("closed");process.exit()})'
  for service in service worker connector; do
    for target in $ALLOY_CHECK_LAN seaweedfs:8888 seaweedfs:9333 seaweedfs:8080 github.com:443; do
      got=$(remote "sudo docker exec $(container "$service") node -e '$try' $target" 2>/dev/null | tail -1)
      if [ "$target" = github.com:443 ]; then
        [ "$service" = connector ] && want=closed || want=open
        expect "$service reaches the internet only if it should ($target)" "^$want$" "$got"
      else
        expect "$service reaches no $target" '^closed$' "$got"
      fi
    done
  done
else
  skip 'needs ALLOY_CHECK_SSH and ALLOY_CHECK_LAN'
fi

printf '\n%s\n' "$([ "$failures" = 0 ] && echo 'Every check passed.' || echo "$failures failed.")"
exit "$failures"
