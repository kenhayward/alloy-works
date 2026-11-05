#!/bin/sh
# Docker's published ports and containers' traffic bypass ufw, so this is their firewall. Run at boot, after
# Docker (alloy-firewall.service). In: only the proxy, only to 443. Out: the internet, and nothing private
# but the proxy's 443, which is how the stack reaches its own public names. Reads the proxy's address from
# the settings.
set -eu

PROXY=$(sed -n 's/^PROXY_ADDRESS=//p' "${ALLOY_SETTINGS:-/etc/alloy-works/internet.env}" | tail -1)
[ -n "$PROXY" ] || {
  echo 'PROXY_ADDRESS is not set' >&2
  exit 1
}
OUTSIDE=${ALLOY_OUTSIDE_INTERFACE:-eth0}

iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A DOCKER-USER -i "$OUTSIDE" -s "$PROXY" -p tcp -m conntrack --ctorigdstport 443 -j RETURN
iptables -A DOCKER-USER -i "$OUTSIDE" -j DROP
iptables -A DOCKER-USER -o "$OUTSIDE" -d "$PROXY" -p tcp --dport 443 -j RETURN
for range in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  iptables -A DOCKER-USER -o "$OUTSIDE" -d "$range" -j DROP
done
iptables -A DOCKER-USER -j RETURN
