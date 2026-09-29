# Data connector spike - harness

> **Throwaway.** This is the harness behind
> [`Data_Connector_Spike_Findings.md`](../../docs/specification/spikes/Data_Connector_Spike_Findings.md),
> which the brief [`Data_Connector_Spike.md`](../../docs/specification/spikes/Data_Connector_Spike.md)
> frames. It is scaffolding to reach a decision before T2 is designed
> ([ADR-0033](../../docs/decisions/0033-t2-is-the-data-spine.md)); the connector will be written in
> the product, not promoted from here.

Not part of the pnpm workspace, not run by CI. It needs Docker. Project name `aw-data-connectors`;
every published port is on `127.0.0.1` in the 157xx range and none is the development stack's.

## The stack

Three networks, as [the brief](../../docs/specification/spikes/Data_Connector_Spike.md) §11 draws them:

| Network               | Subnet          | Holds                                                                                          |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `aw-dc-platform`      | 172.31.10.0/24  | `platform-pg`, `seaweedfs`, `metadata`, `idp`, and the `caller`                                |
| `aw-dc-sources`       | 172.31.20.0/24  | `source-pg`, `sqlserver`, `fake-api`, `token-exchange`, `resolver`, the `caller`, `connector`  |
| `aw-dc-connector-rpc` | 172.31.30.0/24  | the `caller` and the `connector` only                                                          |

| Container        | Static IP      | Published        | What it is                                                                                       |
| ---------------- | -------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `platform-pg`    | 172.31.10.11   | 127.0.0.1:15701  | Postgres standing for the platform's own database - a target case 1 must not reach from a source |
| `seaweedfs`      | 172.31.10.12   | 127.0.0.1:15704  | Object store standing for the tenant's - another case 1 target                                   |
| `metadata`       | 172.31.10.13   | -                | Stand-in cloud metadata endpoint; the declared metadata address (Docker will not route 169.254) |
| `idp`            | 172.31.10.14   | -                | Stand-in identity provider (phase-1 stub; phase 2 mints subject tokens here)                     |
| `caller`         | .10/.20/.30    | 127.0.0.1:15706  | Placement A: reaches sources itself, and sits on the platform network - only code stops it       |
| `connector`      | .29/.31        | 127.0.0.1:15707  | Placement C: on `aw-dc-sources` and `aw-dc-connector-rpc` only - not on the platform network     |
| `source-pg`      | 172.31.20.21   | 127.0.0.1:15702  | Postgres 18 with row-level security; the tenant's source (a private address that must answer)    |
| `sqlserver`      | 172.31.20.22   | 127.0.0.1:15703  | SQL Server 2022 Developer; security policy + SESSION_CONTEXT                                      |
| `fake-api`       | 172.31.20.23   | -                | Fake JSON API behind a bearer token; also serves a redirect for case 1                           |
| `token-exchange` | 172.31.20.24   | -                | Fake RFC 8693 token-exchange endpoint (phase-1 stub; phase 2 drives it)                           |
| `resolver`       | 172.31.20.25   | -                | DNS that rebinds `rebind.evil.test`: allowed IP then denied IP, alternating                       |

The `caller` and `connector` run the same `agent.mjs`; the only difference is which networks compose
attaches. That is the point of case 1 - the boundary is a fact of the network, not a branch in code.

## Bringing it up and down

```bash
cd spikes/data-connectors
docker build -t aw-dc-agent:latest .                        # the Node image with pg and tedious
docker compose -p aw-data-connectors up -d                  # the whole stack
# SQL Server has no init hook, so load its schema once it is ready:
docker cp init/sqlserver.sql aw-data-connectors-sqlserver-1:/tmp/init.sql
docker exec aw-data-connectors-sqlserver-1 bash -lc \
  "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Spike-SqlServer-Fake-Pw1' -C -i /tmp/init.sql"

docker compose -p aw-data-connectors down -v                # take down and wipe volumes
```

`source-pg` loads `init/source-pg.sql` automatically on first start (roles, RLS, Ada/Grace rows).

## The SQL Server licence

The Developer edition licence was accepted by the repository owner (Ken Hayward) on 2026-09-29 for
development use, choosing SQL Server over MySQL for this spike. That is why `ACCEPT_EULA=Y` is set for
the `mcr.microsoft.com/mssql/server` image (2022, pinned by digest) in `compose.yaml`. No other
licence is accepted by this harness.

## Running the cases

Run from the host (Node 20+), against the published control APIs:

```bash
node case1.mjs   # SSRF gate: hostile connections through placements A and C
node case2.mjs   # the secret opens in one place and never comes back out
```

Each writes a `dcp1-*.json` report (git-ignored; the findings carry the numbers) and prints a summary.

## Credentials

Every credential is an invented, fake development value, committed the way `deploy/` commits its dev
values. None is real, and no real name appears: the invented users are Ada and Grace.
