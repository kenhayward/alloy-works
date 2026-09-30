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

| Network               | Subnet         | Holds                                                                                         |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `aw-dc-platform`      | 172.31.10.0/24 | `platform-pg`, `seaweedfs`, `metadata`, `idp`, and the `caller`                               |
| `aw-dc-sources`       | 172.31.20.0/24 | `source-pg`, `sqlserver`, `fake-api`, `token-exchange`, `resolver`, the `caller`, `connector` |
| `aw-dc-connector-rpc` | 172.31.30.0/24 | the `caller` and the `connector` only                                                         |

| Container        | Static IP    | Published       | What it is                                                                                       |
| ---------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------ |
| `platform-pg`    | 172.31.10.11 | -               | Postgres standing for the platform's own database - a target case 1 must not reach from a source |
| `seaweedfs`      | 172.31.10.12 | -               | Object store standing for the tenant's - another case 1 target                                   |
| `metadata`       | 172.31.10.13 | -               | Stand-in cloud metadata endpoint; the declared metadata address (Docker will not route 169.254)  |
| `idp`            | 172.31.10.14 | -               | Stand-in identity provider: signs the users' tokens (cases 3 and 4)                              |
| `caller`         | .10/.20/.30  | 127.0.0.1:15706 | Placement A: reaches sources itself, and sits on the platform network - only code stops it       |
| `connector`      | .29/.31      | 127.0.0.1:15707 | Placement C: on `aw-dc-sources` and `aw-dc-connector-rpc` only - not on the platform network     |
| `source-pg`      | 172.31.20.21 | 127.0.0.1:15702 | Postgres 18 with row-level security; the tenant's source (a private address that must answer)    |
| `sqlserver`      | 172.31.20.22 | 127.0.0.1:15703 | SQL Server 2022 Developer; security policy + SESSION_CONTEXT                                     |
| `fake-api`       | 172.31.20.23 | -               | Fake JSON API behind a bearer token; also serves a redirect for case 1                           |
| `token-exchange` | 172.31.20.24 | -               | Fake RFC 8693 token-exchange endpoint (cases 3 and 4)                                            |
| `resolver`       | 172.31.20.25 | -               | DNS that rebinds `rebind.evil.test`: allowed IP then denied IP, alternating                      |

The `caller` and `connector` run the same `agent.mjs`; the only difference is which networks compose
attaches. That is the point of case 1 - the boundary is a fact of the network, not a branch in code.

`platform-pg` and `seaweedfs` publish **no** host port on purpose. On Docker Desktop a published
port is reachable from a sibling network, which would let the `connector` reach the platform's
Postgres through the host and defeat the boundary case 1 tests (this is itself a case 1 finding).
Inspect those two with `docker exec` rather than a published port.

## Bringing it up and down

```bash
cd spikes/data-connectors
docker build -t aw-dc-agent:latest .                        # the Node image with pg and tedious
docker compose -p aw-data-connectors up -d                  # the whole stack
bash load-sqlserver.sh                                      # SQL Server has no init hook: the three schema files
curl -s -X POST http://127.0.0.1:15706/svc/setup            # the tenant's schema in platform-pg (case 4)

docker compose -p aw-data-connectors down -v                # take down and wipe volumes
```

`source-pg` loads `init/source-pg.sql`, `init/source-pg-phase2.sql` and `init/source-pg-phase3.sql`
automatically on first start (roles, RLS, Ada/Grace rows, and phase 3's tables). They are mounted as
`01-`, `02-` and `03-` because the entrypoint runs them in name order, and unnumbered the phase 2 file
sorts first and fails on a role not yet made.
After a change to `lib/` or any `*.mjs`, rebuild the image and
`docker compose -p aw-data-connectors up -d --force-recreate caller connector` (and any other service
running the changed file).

## The SQL Server licence

The Developer edition licence was accepted by the repository owner on 2026-09-29 for
development use, choosing SQL Server over MySQL for this spike. That is why `ACCEPT_EULA=Y` is set for
the `mcr.microsoft.com/mssql/server` image (2022, pinned by digest) in `compose.yaml`. No other
licence is accepted by this harness.

## Running the cases

Run from the host (Node 20+), against the published control APIs:

```bash
node case1.mjs   # SSRF gate: hostile connections through placements A and C
node case2.mjs   # the secret opens in one place and never comes back out
node case3.mjs   # as the end user: Ada and Grace through each mechanism, each on a fresh connection
node case4.mjs   # later and elsewhere: publish options, sign-out, expiry, pins, the cache (~6 minutes)
ONLY=4.2,4.3 REPEAT=5 node case4.mjs   # just those sections; REPEAT sets the sign-out runs per cell
```

Cases 1 and 2 write `dcp1-*.json`, cases 3 and 4 `dcp2-*.json` (git-ignored; the findings carry the
numbers), and each prints a summary. Cases 3 and 4 run every query on a **fresh connection** (`pool:
'none'`) and nothing else: pooled connections are left out on purpose, and what must reset one is in
the findings as a claim.

### Phase 2 pieces

| File                 | What it is                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idp.mjs`            | The tenant's stand-in provider: ES256 tokens, settable lifetimes, `offline_access` refresh with rotation and reuse detection, revocation; a second issuer stands for the Google route |
| `token-exchange.mjs` | RFC 8693 exchange trusting only the tenant's provider (through the `trust` volume), audience `fake-api`, capped at the subject token's life; can disable a user                       |
| `fake-api.mjs`       | Verifies the exchanged token and answers `{ as, rows }` with the caller's own rows; latency and owner-reassign switches                                                               |
| `lib/identity.mjs`   | Runs a query as the end user in the connector, per mechanism                                                                                                                          |
| `lib/service.mjs`    | The caller as service and worker: sessions and the provider tokens they would hold, publish jobs under the three options, pins with provenance, the result cache, sign-out            |
| `case3.mjs`          | Case 3's driver, against the connector directly                                                                                                                                       |
| `case4.mjs`          | Case 4's driver, through the caller's `/svc/*` routes                                                                                                                                 |

### Phase 3 pieces (cases 5 to 7)

Cases 5 to 7 run in a **one-shot container** on `aw-dc-sources` - the connector's network - with the
harness's current source copied in, so an edit needs no image rebuild (a change to `package.json`
does). They reach the two databases directly and start their own fake HTTP source beside themselves.

```bash
bash run.sh case5.mjs > dcp3-case5.json                            # ~1 s: 3,792 binding attempts
bash run.sh case6.mjs > dcp3-case6.json                            # ~1 min: every source, 100 runs, order
bash run.sh case6.mjs -e MODE=tz -e TZ=Pacific/Kiritimati > dcp3-case6-tz.json   # checksums in another zone
bash run.sh case7.mjs --memory 3g > dcp3-case7.json                # ~5 min: limits; readers in child processes
```

| File                        | What it is                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `init/*-phase3.sql`         | `param_probe`, `typed_result`, `unordered`, `many`; a view that calls `set_config`; `ada_login`; `IntList`                     |
| `lib/types.mjs`             | The declared types and each one's canonical text; a `NamedFailure` for every refusal                                           |
| `lib/params.mjs`            | The parameter declaration, DAT-020's validation, and the three binders (SQL, HTTP builder, file filters)                       |
| `lib/canon.mjs`             | The canonical result document, RFC 8785 serialisation and the SHA-256 checksum                                                 |
| `lib/xlsx-own.mjs`          | The XLSX reader over `fflate` and `saxes`, byte- and row-bounded, and serial-date conversion                                   |
| `lib/fixtures.mjs`          | Case 6's logical result, and the CSV and two workbooks (1900 and 1904) written by hand                                         |
| `lib/limits.mjs`            | Row, byte and time limits for HTTP, CSV, Postgres (a cursor) and SQL Server (a cancelled stream)                               |
| `lib/bombs.mjs`             | Inputs that expand far past their size, generated in memory and never written out expanded                                     |
| `fake-data-api.mjs`         | The fake HTTP source: an echo, typed JSON, oversized, gzip, drip, slow and lying-length responses                              |
| `case5.mjs` ... `case7.mjs` | The drivers; `probe-node.mjs` checks the Node features the canonical form leans on, `probe-sizes.mjs` measures case 7's inputs |

## Credentials

Every credential is an invented, fake development value, committed the way `deploy/` commits its dev
values. None is real, and no real name appears: the invented users are Ada and Grace.
