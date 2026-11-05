# An installation on the internet

`compose.internet.yaml`, over `compose.yaml`: one environment on one Linux machine, behind a reverse proxy
you run, signing people in through its own Keycloak and following published releases.
[ADR-0094](../../docs/decisions/0094-an-installation-sits-behind-a-proxy-it-does-not-run.md) has the reasoning.

```
internet → your proxy (TLS, a public certificate) → this machine :443 → Caddy → service | Keycloak | store
```

Three public names reach the same proxy host: the app, Keycloak and the store (signed links go to it).

## What it changes from development

- **Nothing is published but 443**, and Keycloak's console on `127.0.0.1` alone. The stand-in, Google and
  every development password are gone; each secret is `${X:?}`, so a missing one stops the start.
- **Caddy believes only the proxy** about who is calling (`PROXY_ADDRESS`), and the service and Keycloak
  believe only Caddy. It answers 404 to Keycloak's administration and to anything in the store but the bucket.
- **Keycloak runs in production mode** with a realm holding no people (`alloy-realm.json`): no
  registration, a password of 12 or more, brute-force protection. `configure.sh` sets its mail, its client
  secret and the first administrator, who must change the password and enrol an authenticator at first sign-in.
- **`pnpm environment:setup`** ([the settings](../README.md#an-installations-own-setup-pnpm-environmentsetup))
  makes the one environment on every deploy.
- Limits on memory, CPUs and privileges on every container.

## Installing

On the machine, as root, with Docker and git:

1. Copy `deploy.sh`, `firewall.sh` and `internet.env.example` to `/opt/alloy-works`, and the three units to
   `/etc/systemd/system`.
2. `/opt/alloy-works/deploy.sh settings` writes `/etc/alloy-works/internet.env` (root, 600) with every
   generated secret. Fill in each `CHANGE_ME`, and keep a copy elsewhere: it is the only copy of the sealing keys.
3. If the firewall drops your network's DNS server, as it will on a private one, give Docker public resolvers
   in `/etc/docker/daemon.json`: `{"dns": ["1.1.1.1", "9.9.9.9"]}`, then restart Docker.
4. `systemctl enable --now alloy-firewall.service alloy-deploy.timer`.
5. Point the proxy's host for all three names at this machine's 443 over https, with websockets on. If it limits
   who may call, allow this machine's own address too: the stack reaches its public names through the proxy.

`deploy.sh check` says what it would do. The timer deploys each new release from `aw-releases` within 15
minutes; `deploy.sh <tag or branch>` deploys one by hand. Each deploy dumps the databases first into
`/opt/alloy-works/backups`, keeping 7, and refuses to retry a release that failed until `deploy.sh latest`.

**Keycloak's console:** `ssh -L 9090:127.0.0.1:9090 <machine>`, then `http://localhost:9090`, signing in as
`admin` with `KEYCLOAK_ADMIN_PASSWORD`. **The first administrator's password** is
`KEYCLOAK_FIRST_ADMIN_PASSWORD`. They hold no content permissions, so they give themselves Author and
Publisher from Administration's Overview, under Access to the whole environment.

## Going back

Migrations only go forward. To go back, restore the dump taken before the release (`psql -U postgres` in the
`postgres` container), then `deploy.sh <older tag>`.

## Not here yet

Backups off the machine, alerts, an outside check, rate limits and a content security policy.
