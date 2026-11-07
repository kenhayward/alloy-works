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
- Limits on memory, CPUs and privileges on every container, and its logs rotated: five files of 20 MB.

## Installing

On the machine, as root, with Docker, git and restic:

1. Copy the `.sh` files and `internet.env.example` to `/opt/alloy-works`, and the units to
   `/etc/systemd/system`, once: each deploy installs them afresh from the release it deployed.
2. `/opt/alloy-works/deploy.sh settings` writes `/etc/alloy-works/internet.env` (root, 600) with every
   generated secret. Fill in each `CHANGE_ME`, and keep a copy elsewhere: it is the only copy of the sealing keys
   and of `RESTIC_PASSWORD`, without which no backup can be read.
3. If the firewall drops your network's DNS server, as it will on a private one, give Docker public resolvers
   in `/etc/docker/daemon.json`: `{"dns": ["9.9.9.9", "8.8.8.8"]}`, then restart Docker. Check each answers from the
   machine first (`dig @9.9.9.9 github.com`): one that does not costs every lookup in every container its timeout.
4. `systemctl enable --now alloy-firewall.service alloy-deploy.timer alloy-backup.timer alloy-drill.timer`.
5. Point the proxy's host for all three names at this machine's 443 over https, with websockets on. If it limits
   who may call, allow this machine's own address too: the stack reaches its public names through the proxy.

`deploy.sh check` says what it would do. The timer deploys each new release from `aw-releases` within 15
minutes; `deploy.sh <tag or branch>` deploys one by hand. Each deploy dumps the databases first into
`/opt/alloy-works/backups`, keeping 7, and refuses to retry a release that failed until `deploy.sh latest`.

**Keycloak's console:** `ssh -L 9090:127.0.0.1:9090 <machine>`, then `http://localhost:9090`, signing in as
`admin` with `KEYCLOAK_ADMIN_PASSWORD`. **The first administrator's password** is
`KEYCLOAK_FIRST_ADMIN_PASSWORD`. They hold no content permissions, so they give themselves Author and
Publisher from Administration's Overview, under Access to the whole environment.

## Backups and alerts

`alloy-backup.timer` runs `backup.sh` nightly: `pg_dumpall` of the three databases (the platform, delivery and
Keycloak), then those and the object store's files, paused for the seconds it takes, to `RESTIC_REPOSITORY`,
encrypted. It keeps 7 days, 4 weeks and 6 months, then checks the repository.

`restore-drill.sh` proves the latest backup restores without touching the stack: each dump goes into a container
of its own with no network, and must arrive with the running store's databases and tables; the store's files are
verified against the repository. `alloy-drill.timer` runs it on the first of each month; run it too after changing the
repository. Each backup and drill records each class's run, failures too, in the platform's database, where
Administration's Diagnostics reads the recovery point and time (ADR-0101). The worker probes `/health` each minute for
availability.

**A copy off the machine** is pulled, not pushed, so the machine holds no credential for the backup machine
and reaches no LAN. `rsyncd.conf` offers the repository read only, to one address and one user who is not root.
Set `BACKUP_PULL_ADDRESS` to that address, and each deploy writes `/etc/rsyncd.conf` with it.
With `RESTIC_REPOSITORY=/var/backups/alloy-works/restic`, once:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin nas-pull
sudo chgrp -R nas-pull /var/backups/alloy-works
sudo chmod -R g+rX /var/backups/alloy-works
sudo find /var/backups/alloy-works -type d -exec chmod g+s {} +
sudo sh -c 'read -rs p; echo "nas-pull:$p" > /etc/rsyncd.secrets; chmod 600 /etc/rsyncd.secrets'
sudo ufw allow from <backup machine> to any port 873 proto tcp comment 'backup pull'
sudo /opt/alloy-works/deploy.sh <the deployed tag or branch>   # writes /etc/rsyncd.conf
sudo systemctl enable --now rsync
```

The backup machine then pulls module `alloy-restic` as `nas-pull` nightly after the backup, deleting what restic
pruned, onto a share it snapshots. Prove that copy now and then with `restic check --read-data` against it.

A failed deploy or backup runs `alert.sh`, which mails `ALERT_EMAIL` the unit's last lines through the SMTP
settings. Watching that the service is up is for a monitor elsewhere: `https://<app>/health` answers 200 with
`{"status":"ok"}`.

## Going back

Migrations only go forward. To go back, restore the dump taken before the release (`psql -U postgres` in the
`postgres` container), then `deploy.sh <older tag>`. To recover the machine, `restic restore` the latest
snapshots and load each dump, and the store's files into its volume, before the first deploy.

## The outside check

`outside-check.sh <app> <sign-in> <store>`, from a checkout on a machine outside the network, after any change
to the stack. It asks for what a caller on the internet should not get, and exits with the number refused
wrongly: the security headers; a forged `Host` or `X-Forwarded-Host`; Keycloak's administration, by plain and
encoded paths; the store's listing, buckets, IAM and anonymous reads and writes; registration; and the usual
ports. With `ALLOY_CHECK_SSH=<machine>` it also reads the door's log, where a forged `X-Forwarded-For` must not
appear as the caller, and with `ALLOY_CHECK_LAN="<address>:<port> ..."` tries those LAN addresses from inside
the containers. `ALLOY_CHECK_CREDENTIALS=yes` tries development's published passwords and keys at Keycloak and
the store.

Still by hand: a full port scan from outside (`nmap -Pn -p- <public address>`); a sixth wrong password locking
an account; an administrator asked for a second factor; and a heavy publication slowing the worker while the
machine's other work goes on.

## Not here yet

Logs kept off the machine, rate limits and a content security policy.
