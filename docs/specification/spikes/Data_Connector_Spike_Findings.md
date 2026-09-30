# Data connector spike - findings

> **Status: Draft: cases 1 to 4 run; cases 5 to 7 to come.** These findings sit beside the brief
> [`Data_Connector_Spike.md`](Data_Connector_Spike.md) and follow the shape of
> [`Publishing_Engine_Spike_Findings.md`](Publishing_Engine_Spike_Findings.md): what was run, what
> came back in numbers, the verdict against each case's Pass line, and what stayed a claim. The
> harness is throwaway, in [`/spikes/data-connectors/`](../../../spikes/data-connectors/), outside
> the pnpm workspace and CI. Every number below came from a command that ran against that stack on
> this machine; nothing here is asserted from reading a driver's documentation.
>
> **The environment matters for case 1.** The numbers were taken on Docker Desktop for Windows (Docker
> 29.6.1, Linux containers in its VM), not on the Linux CI runner the other spikes use. One case 1
> finding - the published-port leak - is a property of that environment, and is called out as such;
> it is a finding _for_ the design, not against it.

## Verdicts

| Case                                                 | Role        | Verdict                                                                                                                             |
| ---------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1** - The connector is not a route in              | Gate        | **Pass for placement C, with a named condition; fail for placement A on its own**                                                   |
| **2** - The secret opens in one place                | Correctness | **Pass with cost** - no path leaks the secret except the query-string transport, which is refused by design                         |
| **3** - As the end user, per connector type          | Gate        | **Pass for HTTP (delegated token); pass with cost for both databases, as asserted identity only; meaningless for an uploaded file** |
| **4** - The end user's identity, later and elsewhere | Gate        | **Pass with cost** - every sub-case has an answer that holds IAM-064 and DAT-026, at the costs named in section 4                   |

Cases 5 to 7 have not run. Cases 3 and 4 ran on the same machine and Docker Desktop as cases 1 and
2, against a stack brought up fresh from `compose.yaml` (one harness defect was fixed on the way: the
source Postgres's two init scripts ran in the wrong order on a fresh volume, and the container exited
on a role that did not yet exist; they are numbered now).

---

## Case 1 - The connector is not a route into the platform _(gate)_

**What was run.** The same `agent.mjs` runs as two containers: the **caller** (placement A) on all
three networks including the platform's, and the **connector** (placement C) on the sources and
connector-rpc networks only. Both use an identical code guard. `case1.mjs` drove five families of
test from the host against each placement's control API.

### A. Raw network reachability (guard off) - the decisive measurement

From each placement, a raw TCP connect to each platform target and to the tenant's own private source.

| Target (guard off)                    | From A/caller | From C/connector   |
| ------------------------------------- | ------------- | ------------------ |
| platform Postgres `172.31.10.11:5432` | connected 0ms | **timeout 2503ms** |
| object store `172.31.10.12:8333`      | connected 0ms | **timeout 2501ms** |
| cloud metadata `172.31.10.13:80`      | connected 1ms | **timeout 2501ms** |
| identity provider `172.31.10.14:80`   | connected 0ms | **timeout 2501ms** |
| caller's own control port `:8080`     | connected 0ms | **timeout 2502ms** |
| tenant private source `172.31.20.21`  | connected 0ms | connected 0ms      |

Placement A reaches every platform service; **only code stands between a hostile connection and the
platform.** Placement C reaches none of them - the connection is dropped at the network - **while the
tenant's private source, on a private address, still answers.** That is the gate's Pass line met by
the network rather than by a check. It was confirmed at the driver level too: from the connector, a
full authenticated query to the platform's Postgres fails (`The query failed (postgres)`); from the
caller the same query returns `platform`'s own data.

### B. The code guard, and the alternate spellings

The guard normalises a host to what the OS will actually dial, then denies loopback, link-local (the
metadata address included) and a declared set of platform addresses, while allowing a declared
private source. Every internal spelling was denied; the tenant's private source was allowed.

| Host as written                           | Guard verdict       | Resolved to  |
| ----------------------------------------- | ------------------- | ------------ |
| `172.31.10.11` (canonical)                | DENY platform       | 172.31.10.11 |
| `2887715339` (decimal)                    | DENY platform       | 172.31.10.11 |
| `0254.037.012.013` (octal)                | DENY platform       | 172.31.10.11 |
| `::ffff:172.31.10.11` (IPv4-mapped IPv6)  | DENY platform       | 172.31.10.11 |
| `172.31.10.11.` (trailing dot)            | DENY platform       | 172.31.10.11 |
| `127.0.0.1` / decimal / octal / mapped    | DENY loopback       | 127.0.0.1    |
| `/var/run/postgresql` (unix socket path)  | DENY (unresolvable) | -            |
| `/etc/ssl/private/source.key` (file path) | DENY (unresolvable) | -            |
| `172.31.20.21` (tenant private source)    | **ALLOW**           | 172.31.20.21 |

The guard catches every spelling **only because it canonicalises numeric IPv4 forms itself** - a
guard that string-matched a denylist of dotted-quads would pass the decimal and octal forms straight
through to the OS, which dials 127.0.0.1 for both. That normaliser is the load-bearing part, and it
is written up in the harness so the connector's regression suite inherits it.

### C. The DAT-006 oracle

A connection test must not become a network-mapping tool. The raw probe shows the outcomes are
distinguishable at the socket - refused, connected, unreachable, dns-error - so a test that surfaced
the driver's own error would leak topology. The guarded connection test collapses them:

- Three **internal** targets (refused port, open service, metadata) - underlying classes refused /
  connected / connected - all returned the **same** reason: "A connection reason was withheld."
- Three **allowed-but-failing** private targets (refused port, dark address, wrong password) -
  underlying classes refused / unreachable / connected - all returned the **same** reason: "The
  connection could not be established."

So no internal address is named, and neither refused-vs-filtered nor unknown-host is distinguishable
within a family. **One residual signal:** the two families use different phrases, so an administrator
can tell "the guard refused this" from "we tried and it failed" - which reveals which addresses the
guard covers, though never an address itself. The finding recommends collapsing both to a single
phrase; it is a small change and it is not yet made.

### D. A redirect from an allowed host to a denied one

The fake API's `/redirect` returns a 302 to the stand-in metadata endpoint. The guard runs once, on
the initial host, and never re-checks a followed hop.

- **Placement A, following redirects:** the request followed the 302 to `172.31.10.13` and **returned
  the stand-in metadata credential's bytes** (`AKIAFAKE-SPIKE-...`) to the caller. A live SSRF
  exfiltration, past a guard that approved only `fake-api`.
- **Placement C, following redirects:** the same request failed (`502`) - the metadata endpoint is
  unreachable from the connector's network. The network stopped what the code did not.
- Not following redirects (both placements): the 302 is returned unfollowed; safe.

**Finding:** every redirect hop must be re-guarded, or redirects disabled, on placement A. On
placement C the network makes the mistake harmless.

### E. DNS rebinding

The resolver answers `rebind.evil.test` with the allowed source address on the first query and the
platform's Postgres address on the next. Check-time resolution saw `172.31.20.21` (allowed);
connect-time resolution saw `172.31.10.11` (the platform).

- **Placement A:** the connect-time address was **reachable** (connected) - a check-then-connect
  guard is beaten by the flip.
- **Placement C:** the connect-time address **timed out** - beaten guard or not, the network blocks
  it.

**Finding:** a guard must resolve once and connect to the pinned address, not re-resolve a name it
already checked. The harness's guard returns a `pinnedIp` for exactly this, but the drivers connect
by name, so on placement A the pin is not yet enforced. On placement C it does not matter.

### The published-port leak - a property of the environment, and a finding for production

Before the platform's Postgres and object store had their published host ports removed, the
**connector reached them anyway** - it authenticated to the platform's Postgres and read its data,
from a network it is not on. The cause: on Docker Desktop a container port published to the host
(`127.0.0.1:15701`) is reachable from a sibling network through the host, bypassing the
inter-network isolation that otherwise held (an unpublished platform service - the metadata endpoint,
the identity provider - was never reachable from the connector). Removing the two published ports
made the connector's access to every platform service disappear (all six targets went from connected
to timeout), which is the clean result in section A.

**This is the answer to the Pass line's "what production must provide that compose can only
imitate."** The boundary is only as real as the guarantee that the connector's network has no route
to the platform - including no shared host that publishes a platform service's port. Compose on
Docker Desktop does not give that guarantee for free; a real deployment must (a separate network or
subnet with an egress policy, and no platform service exposed on a host the connector can reach).

### Verdict

**Placement C passes the gate, on one condition; placement A fails it on its own.** With C, every
hostile connection - direct, every alternate spelling, a redirect, and a DNS rebind - fails at the
network, identically and naming no internal address, while the tenant's private source answers. The
condition is the one named above: the connector's network must genuinely have no route to the
platform. Placement A can be made safe only by code (the normalising guard, per-hop redirect
re-checks, resolve-and-pin), and case 1 shows three distinct ways that code is one mistake away from
being a route in. This is the finding the brief anticipated: **the boundary belongs in the network
(placement C), and D's edge connector is the same interface deployed one network further out.**

---

## Case 2 - The secret opens in one place, and never comes back out

**What was run.** A connection credential is sealed exactly as the product seals its object-store and
sign-in secrets (`aes-256-gcm`, bound to purpose and tenant), and is opened only inside the process
that runs the query, by `openSecret`, then dropped. `case2.mjs` made each driver fail every way it
can and searched every byte written - the caller-facing error, the DAT-006 test reason, and the
**raw driver error** (what a log line or a job row would hold if it were not scrubbed) - for the
secret, **raw, URL-encoded and base64**. Three `crashprobe` runs then rethrew the raw driver error as
an **uncaught exception**, so Node printed it to stderr and exited, standing in for a crash report.

### The failure matrix

Thirteen attempts across the three sources. Search hits for the secret in each encoding:

| Source     | Failure modes exercised                                                    | Raw-driver-error leaks | Caller-facing leaks |
| ---------- | -------------------------------------------------------------------------- | ---------------------- | ------------------- |
| PostgreSQL | wrong password, unknown host, TLS-required, timeout, malformed conn-string | 0 / 5                  | 0 / 5               |
| SQL Server | wrong password, unknown host, TLS failure, timeout                         | 0 / 4                  | 0 / 4               |
| HTTP       | wrong bearer (401), unknown host, TLS failure, **token in query string**   | 0 / 4                  | **1 / 4**           |

Every Postgres and SQL Server failure produced a genuine driver error (each recorded a
`query-error`, e.g. "password authentication failed", "Login failed"), and **none carried the secret
in any encoding** - not the wrong-password error, not even a malformed connection string with the
secret embedded in the URL. Container stdout across all five containers: **0 leaks.**

**The crash path is clean too.** All three crash probes exited non-zero after a real auth failure
(`password authentication failed`, `Login failed`), and a distinctive canary secret appeared **zero
times** in the stderr dump - including the connection-string case, where the secret was embedded in
the URL handed to `pg`.

### The one leak, and what it tells the design

The single hit is `http/token-in-query-string`: when the secret is placed in the URL query string
rather than the `Authorization` header, it appears - raw and URL-encoded - in the response's final
URL (`http://fake-api/?token=fake-api-bearer-token-for-the-spike`), and would appear in any log of
the request URL. The bearer-in-header transport, used everywhere else, never leaked.

**Finding:** an HTTP source's secret goes in the `Authorization` header and never in the URL; and no
code path may log or return a source request's full URL, because a misconfigured source could carry
its secret there. This is the concrete form of the brief's warning about "URLs, query strings
included". It is a rule the connector must enforce, not a driver defect.

### DAT-056 - the cost of opening one secret per process

The brief asks the spike to measure the alternative to one long-lived process that can open every
tenant's secret: a process handed only its own connection's secret.

| Shape                                                              | One-row query, p50 | p95    |
| ------------------------------------------------------------------ | ------------------ | ------ |
| Warm process, new connection per call (incl. host HTTP round-trip) | 5.0 ms             | 6.2 ms |
| **Fresh process per execution** (startup + open + connect + query) | **41 ms**          | 43 ms  |

A process per execution costs roughly **35-40 ms of Node startup and module load per query** on top
of the work itself - about 8x the warm figure here. That is the price of the isolation DAT-056 may
require: a process that can open only its own connection's secret cannot open another tenant's. The
number is a proxy (a fresh Node process, not a pooled pre-forked worker; containers on one machine;
no source-side latency), and the design should weigh it against a warm pool that opens secrets on
demand and must therefore be trusted with all of them.

### Verdict

**Pass with cost.** The secret opens in exactly one place and is never returned, logged, put in an
error, surfaced by the DAT-006 test, or printed by a crash - for every driver-level failure, across
all three encodings. The cost is twofold: the query-string transport must be forbidden by the
connector (an HTTP secret belongs in a header), and DAT-056's per-process isolation, if adopted,
carries the ~40 ms measured above. The **kind of process that can open a source credential** is named:
one that is handed a single sealed connection and opens it with `openSecret`; whether one such process
may serve many tenants is the DAT-056 design question the number above is meant to inform.

---

## Case 3 - As the end user, per connector type _(gate)_

**What was run.** `case3.mjs` drove the connector (placement C) directly. **Every execution ran on a
fresh connection**, opened for it and closed after it; no connection was reused, so nothing could
pass from one execution to the next (pooled connections were left out on purpose - see "Pooled
connections" below). Each source shows its rows per user by its own rule, and Ada owns rows 1 and 3,
Grace row 2:

| Source          | Table or resource | The source's rule                                                                                                           |
| --------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 18   | `record`          | forced row-level security, `owner = current_user`                                                                           |
| PostgreSQL 18   | `record_guc`      | forced row-level security, `owner = current_setting('app.user')`                                                            |
| SQL Server 2022 | `dbo.record`      | a security policy's filter predicate on `SESSION_CONTEXT(N'app_user')`                                                      |
| SQL Server 2022 | `dbo.record_eu`   | a filter predicate on `USER_NAME()`; readable by the users `ada` and `grace` only, who exist `WITHOUT LOGIN`                |
| Fake JSON API   | `/records`        | rows whose owner is the verified token's `sub`; the token must be the exchange's, audience `fake-api`, scope `records:read` |

The connection's own account is a least-privileged `connector_login` on both databases - not a
superuser and not `sa` - a member of the roles `ada` and `grace` in Postgres, and holding `IMPERSONATE`
on the users `ada` and `grace` in SQL Server.

### A. Ada and Grace through one binding

| Mechanism                                         | Ada saw | Grace saw | Who the source saw, in Ada's run                               | How long the assertion lasts                                  | ms per execution (Ada / Grace) |
| ------------------------------------------------- | ------- | --------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| Postgres `SET ROLE`                               | 1, 3    | 2         | `current_user` ada, `session_user` connector_login             | the session: still ada after `COMMIT`                         | 8.0 / 8.4                      |
| Postgres `SET LOCAL ROLE`                         | 1, 3    | 2         | the same                                                       | the transaction: connector_login after `COMMIT`               | 7.8 / 8.1                      |
| Postgres setting read by the policy (session)     | 1, 3    | 2         | `current_user` connector_login, `app.user` ada                 | the session                                                   | 8.3 / 7.6                      |
| Postgres setting read by the policy (`LOCAL`)     | 1, 3    | 2         | the same                                                       | the transaction                                               | 7.2 / 7.2                      |
| SQL Server `SESSION_CONTEXT`                      | 1, 3    | 2         | database user connector_login, `app_user` ada                  | the logical connection                                        | 10.2 / 9.2                     |
| SQL Server `SESSION_CONTEXT`, `read_only`         | 1, 3    | 2         | the same                                                       | the logical connection, unchangeable                          | 10.1 / 11.0                    |
| SQL Server `EXECUTE AS USER`                      | 1, 3    | 2         | database user ada (the login shows as the user's SID)          | until `REVERT` or the session ends                            | 12.5 / 11.2                    |
| SQL Server `EXECUTE AS USER ... WITH COOKIE`      | 1, 3    | 2         | the same; reverted by the connector with its cookie afterwards | until the connector reverts it                                | 12.0 / 11.3                    |
| SQL Server `EXECUTE AS USER ... WITH NO REVERT`   | 1, 3    | 2         | the same                                                       | until the session ends                                        | 11.9 / 11.4                    |
| HTTP, delegated token (RFC 8693 exchange)         | 1, 3    | 2         | `sub` ada, `act` aw-connector-acme                             | the exchanged token's life, never past the user's own token's | 3.0 / 3.9                      |
| _HTTP, the connection's own bearer, for contrast_ | 1, 2, 3 | -         | `service-account`                                              | -                                                             | 1.4                            |

**Every mechanism showed Ada rows 1 and 3 and Grace row 2, and never the other's** - 18 of 18
database executions and 2 of 2 HTTP, and the same in each of the three runs whose output was kept. The
times are single executions from one run, each a fresh connection (TLS included for SQL Server) on one
machine; a later run gave 4.5 to 10 ms for the same rows, and the same queries with nothing asserted
took 5.6 to 7.5 ms, so asserting costs nothing measurable beside connecting.

### B. Nobody asserted: does the source fail closed?

The same query, on a fresh connection, with no assertion made:

| Source and form                                               | Result                                     |
| ------------------------------------------------------------- | ------------------------------------------ |
| Postgres `record`, membership granted as the init script does | **0 rows, no error**                       |
| Postgres `record`, membership `WITH INHERIT FALSE, SET TRUE`  | `42501 permission denied for table record` |
| Postgres `record_guc` (setting absent)                        | **0 rows, no error**                       |
| SQL Server `dbo.record` (`SESSION_CONTEXT` null)              | **0 rows, no error**                       |
| SQL Server `dbo.record_eu` (`EXECUTE AS` form)                | `229 The SELECT permission was denied`     |

`grant ada to connector_login` is `WITH INHERIT TRUE` by default since PostgreSQL 16, so
`has_table_privilege('connector_login', 'public.record', 'select')` was **true**: the connection's
account held Ada's and Grace's `SELECT` itself, and only the policy stood between it and every row.
Granted `WITH INHERIT FALSE, SET TRUE`, the privilege was false, the unasserted query was refused, and
`SET LOCAL ROLE` still gave Ada 1, 3 and Grace 2.

**Finding:** in three of the five forms a forgotten assertion is an **empty result**, indistinguishable
from "this user has no rows" - and a publish would print it as an empty table, which no DAT-045 or
DAT-046 check catches because nothing failed. The forms that fail loud are those where the
connection's own account holds no privilege on the data: Postgres membership without `INHERIT`, and
SQL Server `EXECUTE AS` against grants made to the users only. `SESSION_CONTEXT` read by a filter
predicate cannot be made to fail loud by the source; there the connector must refuse to run an
end-user query it has not asserted for. The connection test (DAT-006) could check the first two
(`has_table_privilege` on the connection's own account is false).

### C. Can the query text move the identity inside its own execution?

Ada's execution, with query text written to reach Grace's row. A result of `2` means the text moved
the identity; each run on a fresh connection, so nothing outlives the execution.

| Mechanism                                                          | The text adds                                           | Result                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Postgres `SET ROLE`                                                | `reset role; set role grace;` before the `SELECT`       | **2** - moved                                                                         |
| Postgres `SET LOCAL ROLE`                                          | `set local role grace;`                                 | **2** - moved                                                                         |
| Postgres setting (`LOCAL`)                                         | `select set_config('app.user','grace',true);`           | **2** - moved                                                                         |
| Postgres `SET LOCAL ROLE`, one bound statement (extended protocol) | `set local role grace;` before it                       | refused: `42601 cannot insert multiple commands into a prepared statement`            |
| Postgres `SET LOCAL ROLE`, one bound statement                     | `where set_config('role','grace',true) is not null`     | **2** - moved                                                                         |
| Postgres setting, one bound statement                              | `where set_config('app.user','grace',true) is not null` | **2** - moved                                                                         |
| Postgres setting, one bound statement                              | a `MATERIALIZED` CTE calling `set_config` first         | **2** - moved                                                                         |
| SQL Server `SESSION_CONTEXT`                                       | `EXEC sp_set_session_context N'app_user', N'grace';`    | **2** - moved                                                                         |
| SQL Server `SESSION_CONTEXT`, `read_only`                          | the same                                                | refused: `15664 ... The key has been set as read_only for this session`               |
| SQL Server `EXECUTE AS USER`                                       | `REVERT; EXECUTE AS USER = N'grace';`                   | **2** - moved                                                                         |
| SQL Server `EXECUTE AS USER`                                       | `EXECUTE AS USER = N'grace';` nested, without `REVERT`  | refused: `15517` - ada holds no `IMPERSONATE`                                         |
| SQL Server `... WITH COOKIE`                                       | `REVERT; EXECUTE AS USER = N'grace';`                   | refused: `15591 The current security context cannot be reverted using this statement` |
| SQL Server `... WITH NO REVERT`                                    | the same                                                | refused: `15196 The current security context is non-revertible`                       |
| HTTP, delegated token                                              | - (a request has no text that reaches the token)        | not applicable                                                                        |

**Finding - the decisive one of this case.** Under asserted identity the query definition's text runs
with the connection account's authority, and the source cannot tell the connector's assertion from
the text's own. **SQL Server has assertions the text cannot undo**: `SESSION_CONTEXT` set with
`read_only = 1`, and `EXECUTE AS USER ... WITH COOKIE` (the connector keeps the cookie) or `WITH NO
REVERT`. **PostgreSQL has none.** A role and a setting are ordinary run-time settings, and
`set_config()` is a function, so even one bound statement can change either from inside a `WHERE`
clause or a CTE; restricting the text to one statement is no defence. In Postgres, asserted identity
holds only against query text the product controls - text written by somebody already trusted with
every user's rows (a tenant administrator, say), or produced by a builder rather than typed - and
the brief (§9) has left "what an author writes" open. The connection account's standing authority is
what the text inherits either way: in Postgres membership in every user's role, in SQL Server
`IMPERSONATE` on every user.

### D. Who the source trusts

- **The databases trust us, not the user.** Nothing Ada presents reaches Postgres or SQL Server; the
  connector says "this is Ada" and the source believes the connection's account, which holds every
  user's authority by construction. That is DAT-056's doubt, measured: under asserted identity "no
  more authority than its connection" is the union of every user's.
- **The HTTP source trusts the exchange, and the exchange trusts the tenant's provider.** The
  connector cannot make a token for Ada: it can only exchange one the provider signed for her, and the
  exchange authenticates the connector as a client before it will. Presented straight to the source,
  Ada's own provider token was refused (`signature not trusted` - wrong issuer and audience); a wrong
  client secret was refused at the exchange (`client authentication failed`); no token at all was
  refused by name before any request (`identity_absent`). The exchanged token names the connector as
  the actor (`act`), so the source can see both who and through whom.
- **The Google route yields no usable token.** A token signed by the second issuer, standing for
  Google, was refused at the exchange: `subject token issuer not trusted`. (Case 4 shows the other
  half: asserted identity served the same Google-route user without complaint, because the database
  trusts us rather than any token.)

### E. PostgreSQL 18's OAuth route, and the uploaded file

- **PostgreSQL 18's OAuth authentication stays a claim.** `pg` cannot present a bearer token: its SASL
  client offers only `SCRAM-SHA-256` in 8.13.1 (the harness's) and only `SCRAM-SHA-256` and
  `SCRAM-SHA-256-PLUS` in 8.23.0 (the workspace's), and throws for any other mechanism
  (`lib/crypto/sasl.js`, `startSession`). `OAUTHBEARER` appears nowhere in either. A delegated token
  into Postgres from Node needs a driver that implements it, as well as a validator module on the
  server; neither was built.
- **An uploaded file: pass-through means nothing, by argument.** The bytes are the tenant's, held by
  hash in its object store; there is no source process to present an identity to and no source-side
  rule to apply. "As the end user" could only mean the product filtering rows by a rule of its own -
  which is the product's access control, not DAT-023's "source system's own access rules". A file
  fetched over HTTP is the HTTP case above. So a file connection declares no end-user mode.

### Pooled connections - a claim, not measured

The owner excluded, on 2026-09-30, any attempt to make one user's identity carry over to another
execution on a shared connection, so nothing above used one. What resets session identity, from each
database's and driver's own documentation and source:

- **PostgreSQL.** `DISCARD ALL` is documented as equivalent to `CLOSE ALL; SET SESSION AUTHORIZATION
DEFAULT; RESET ALL; DEALLOCATE ALL; UNLISTEN *; ...`, and cannot run inside a transaction block
  ([DISCARD](https://www.postgresql.org/docs/current/sql-discard.html)). `RESET ROLE` returns the
  current user to the connection-time setting or the session user, and "can be executed by any user"
  ([SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html)) - which is also why section C
  found the text can do it. "The effects of `SET LOCAL` last only till the end of the current
  transaction, whether committed or not", while a plain `SET` committed "will persist until the end of
  the session" ([SET](https://www.postgresql.org/docs/current/sql-set.html)); `set_config(..., true)`
  is `SET LOCAL`'s function form. node-postgres's pool documents `release()` as returning the client to
  the pool and `release(true)` as destroying it ([pg.Pool](https://node-postgres.com/apis/pool)); it
  documents no reset, and `pg-pool` 3.14.0's source issues none. PgBouncer sends `server_reset_query`
  (default `DISCARD ALL`) on release in session pooling only, not in transaction pooling unless
  `server_reset_query_always` is set ([PgBouncer configuration](https://www.pgbouncer.org/config.html)).
- **SQL Server.** The TDS `RESETCONNECTION` flag tells the server "to clean up the environment state of
  the connection back to the default environment setting, effectively simulating a logout and a
  subsequent login", and exists for connection pooling ([MS-TDS 2.2.3.1.1 Status](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/ce398f9a-7d47-4ede-8f36-9dd6fc21ca43)).
  tedious documents `connection.reset()` as "Reset the connection to its initial state. Can be useful
  for connection pool implementations" ([tedious Connection](https://tediousjs.github.io/tedious/api-connection.html));
  in 18.6.1's source it sets the flag on the next request. The `mssql` package's pool (12.7.2) calls
  neither `reset()` nor anything else that sets the flag in its source, and its README does not say it
  resets. `sp_set_session_context`'s `read_only` flag holds "on this logical connection"
  ([sp_set_session_context](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-set-session-context-transact-sql)).
  `EXECUTE AS` lasts until another `EXECUTE AS`, a `REVERT`, the session being dropped, or the module
  exiting; `WITH NO REVERT` "remains in effect until the session is dropped", and `WITH COOKIE` is
  documented as "useful in an environment in which connection pooling is used"
  ([EXECUTE AS](https://learn.microsoft.com/en-us/sql/t-sql/statements/execute-as-transact-sql)).
  Whether a reset clears a `NO REVERT` context or a `read_only` key is not stated on those pages, and
  was not tested.

**The design consequence, and what the decision record should require:** a connection that has
carried a user's identity must be reset or discarded before it is reused. Where the reset is not
proven to clear the identity - a `NO REVERT` context, a `read_only` key, a pool that does not reset at
all, as `pg.Pool` and `mssql` do not - the connection is closed rather than returned. The cheapest
form that needs no reset is an assertion scoped to a transaction the connector opens and ends
(`SET LOCAL ROLE`, `set_config(..., true)`), which case 4 used throughout for Postgres.

### Found, not asked

- PostgreSQL 16+ grants role membership `WITH INHERIT TRUE` by default, which gives the connection's
  account every user's privileges and turns a forgotten assertion into an empty result (section B).
- In Postgres the query text can re-assert the identity even as one bound statement, through
  `set_config()` (section C). No mechanism in the source prevents it.
- SQL Server refused a nested `EXECUTE AS` from inside Ada's context, because Ada holds no
  `IMPERSONATE`: the impersonated user's own permissions, not the connection's, decide the next switch.
- The harness's source Postgres did not start on a fresh volume (its init scripts ran out of order),
  so the earlier draft's note that the stack was "up and answering" for cases 3 to 7 did not hold for
  a fresh bring-up. Fixed by numbering the mounts.

### What stayed a claim

PostgreSQL 18's OAuth route (no `OAUTHBEARER` in `pg`); Entra ID tokens against Azure SQL, and Entra
ID's on-behalf-of flow; Kerberos constrained delegation; and everything about pooled connections,
above.

### Verdict

**Pass for HTTP; pass with cost for PostgreSQL and SQL Server, as asserted identity only;
pass-through is meaningless for an uploaded file.** This is the brief's expected finding, with one
thing sharper than it expected:

| Connector type | Mechanism                                                                     | The source must be configured to                                                                                         | The connection must declare                                                                                         |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| HTTP           | Delegated token by RFC 8693 exchange                                          | trust an authorisation server that trusts the tenant's provider, and check audience and scope                            | end user; the exchange endpoint, the client, the audience                                                           |
| SQL Server     | Asserted: `SESSION_CONTEXT` `read_only`, or `EXECUTE AS USER ... WITH COOKIE` | a security policy on the context key, or users without login granted the data and impersonable by the connection's login | end user (asserted); which form; the principal mapping                                                              |
| PostgreSQL     | Asserted: `SET LOCAL ROLE` (roles granted `WITH INHERIT FALSE`)               | row-level security per role, and a connection role holding no data privilege of its own                                  | end user (asserted); and query text the product controls, because nothing in the source stops the text re-asserting |
| Uploaded file  | None                                                                          | -                                                                                                                        | service only                                                                                                        |

The costs: the databases trust us rather than the user, and the connection's account holds every
user's authority; a forgotten assertion is silently empty unless the connection's account holds no
privilege of its own; and in Postgres the query text can re-assert whom it likes. Delegated tokens
into a database (Azure SQL with Entra ID, PostgreSQL 18's OAuth) stay claims.

---

## Case 4 - The end user's identity, later and elsewhere _(gate)_

**What was run.** `case4.mjs` drove the caller's `/svc/*` routes, where the caller stands for the
service (sessions and the tenant's schema, in `platform-pg` as `tenant_acme`) and, given a job id and
nothing of the requester's, for the worker. Every query still went through the connector, on a fresh
connection. Three end-user connections were registered: Postgres `SET LOCAL ROLE`, SQL Server
`SESSION_CONTEXT` `read_only`, and HTTP delegated. Signing in stands for the authorization-code flow
(the harness has no browser) and asks the stand-in provider for `openid offline_access`, so the session
row now carries what the product's does not today: the provider's access token and refresh token,
sealed, in `session_provider_token`.

### 1. A publish with pass-through bindings: three options

A document of 400 inline and 40 block bindings, all pass-through, each binding's source given 20 ms
of latency (in the query text for the databases, by the API for HTTP):

| Connection | Concurrency | (a) at the request: request held open | (b) in the worker: job ran | Provider token held for (b)                                      | (c) pinned only                          |
| ---------- | ----------- | ------------------------------------- | -------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Postgres   | 8           | 1,725 ms                              | 1,714 ms                   | none - asserted needs only the principal's name                  | refused, 409 `pass_through_binding_live` |
| Postgres   | 1           | 13,130 ms                             | 12,968 ms                  | none                                                             | refused                                  |
| SQL Server | 8           | 1,779 ms                              | 1,853 ms                   | none                                                             | refused                                  |
| SQL Server | 1           | 13,970 ms                             | 14,019 ms                  | none                                                             | refused                                  |
| HTTP       | 8           | 1,352 ms                              | 1,362 ms                   | the user's access token, sealed in `job_identity` beside the job | refused                                  |
| HTTP       | 1           | 10,977 ms                             | 11,189 ms                  | the same                                                         | refused                                  |

- **What the worker must hold, and for how long.** For asserted identity: the principal's name, which
  the job row already carries. For a delegated token: the user's token from the provider, for as long
  as the job runs - and, if the job can outlast the token, the means to renew it (section 3). The
  harness sealed it into the tenant's schema beside the job (`job_identity`), never into a queue.
  **The row was still there after the job finished** (1 of 1 in each HTTP run) - nothing deleted it
  but the session's end. The design must delete it when the job ends.
- **The exchange is cheap.** With the connector keeping exchanged tokens by the subject token until
  shortly before they expire, a 440-binding HTTP publish made **1 to 3 exchanges** (concurrent first
  bindings racing), and the worker run that followed made none.
- **What (a) costs.** A request held open for 1.4 to 1.8 s at a concurrency of 8, and 11 to 14 s at 1,
  for a source only 20 ms away. Per binding at a concurrency of 1 that is 25 ms (HTTP) to 32 ms (SQL
  Server): the 20 ms of latency plus a fresh connection and the caller-to-connector hop. A real source's
  latency multiplies this; (a) makes the publish request as slow as its slowest source, which is the
  case publishing.md moved work to the worker to avoid.
- **(c) refuses by name**, before any job exists: "440 bindings run as the end user and are not pinned;
  pin them before publishing."
- **The Google route, and a session with no provider token.** A Google-route session's HTTP publish
  failed at its first binding, by name (`exchange_refused: ... subject token issuer not trusted`); the
  same session's Postgres publish **succeeded**, 4 of 4, because asserted identity trusts us and asks
  for no token. A session that kept no provider token was refused before any job, `identity_absent`.
- **A publish authenticated by a personal API token has no identity to pass through**, by argument
  from [service-foundations.md](../../design/service-foundations.md): an `api_token` row carries a
  principal, scopes and an expiry, and is sent as a bearer to the product - there is no provider token
  behind it, so nothing can be exchanged for the source. Under asserted identity the principal's name
  would do, which is the same asymmetry as the Google route.

### 2. Sign-out partway through a publish

Ada signs out 1.5 s into a 440-binding publish (bindings of 200 ms, concurrency 4). Sign-out deletes
the session row - the provider tokens and any `job_identity` row go with it by foreign key - cancels
the connector executions registered to the session, and revokes the refresh token at the provider
(RFC 7009-shaped). Five runs per connection and option, 30 in all:

| Connection and option | Runs stopped | Last work ended after sign-out | A binding started after sign-out | Cancelled in flight | The job's recorded failure                                          |
| --------------------- | ------------ | ------------------------------ | -------------------------------- | ------------------- | ------------------------------------------------------------------- |
| Postgres, request     | 5 of 5       | 25-27 ms                       | 0 of 5                           | 4 per run           | `query_cancelled ... 57014 canceling statement due to user request` |
| Postgres, worker      | 5 of 5       | 25-31 ms                       | 0 of 5                           | 4                   | the same                                                            |
| SQL Server, request   | 5 of 5       | 36-44 ms                       | 0 of 5                           | 4                   | `query_failed ... Canceled.`                                        |
| SQL Server, worker    | 5 of 5       | 32-49 ms                       | 0 of 5                           | 4                   | the same                                                            |
| HTTP, request         | 5 of 5       | 9-11 ms                        | 0 of 5                           | 4                   | `query_cancelled: The request was cancelled.`                       |
| HTTP, worker          | 5 of 5       | 8-10 ms                        | 0 of 5                           | 4                   | the same                                                            |

Every publish stopped at 28 of 440, within 50 ms of the sign-out, the source's own statement
cancelled (Postgres by `pg_cancel_backend`, SQL Server by a TDS attention, HTTP by aborting the
request). Three things are not right yet:

- **The job names the cancellation, not the sign-out**: 30 of 30 recorded `query_cancelled` or
  `Canceled`, and none `session_ended`. IAM-067 asks that a stopped connection "surface an
  authentication failure rather than continuing quietly"; the design must record the reason and treat
  the cancellations as its consequence.
- **A race, seen once.** In the first full run (not the 30 above), one Postgres worker binding passed
  its session check just before the delete, started 0 ms after the sign-out, was not yet registered
  with the connector when the cancellations went out, and ran its full 200 ms (`stoppedAfterSignoutMs`
  210). 1 run in 36 across both runs. The bound IAM-067 asks to be stated is therefore **one binding's
  duration**, unless the session check and the registration of the execution are made one step (the
  sign-out waits for, or re-scans, executions registered after it).
- **A copy of the token outside our custody outlives the sign-out.** A copy of the job's token, taken
  while the job ran, was presented to the connector after the sign-out: **served as Ada, rows 1 and 3**
  - through the connector's cache of exchanged tokens, and through a fresh exchange too, because the
    exchange checks only signature, issuer, audience and expiry. Disabling Ada at the exchange stopped a
    fresh exchange (`user disabled`) but **not the connector's cached exchanged token**, which still
    served her rows. The copy had 300 s of life left. So: the connector's exchange cache must be keyed to
    and purged with the session (or not kept), and a delegated token that has left our custody cannot be
    recalled - only its lifetime bounds it. That bound is the provider's access-token lifetime, which the
    tenant sets, not us.

### 3. A token that expires inside a long publish

The provider's access-token lifetime set to 6 s, and a 440-binding HTTP publish of 100 ms bindings at
concurrency 4 (about 11.6 s):

| Run                                                | Result                                                                                             | Refresh grants the provider served    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| (a) at the request, no refresh                     | failed at 216 of 440, 5.9 s: `source_refused: ... token expired`                                   | 0                                     |
| (b) worker, no refresh                             | failed at 224 of 440, 6.1 s: `exchange_refused: ... subject token expired`                         | 0                                     |
| (b) worker, refresh token, per-session lock        | **done, 440 of 440**, 11.6 s                                                                       | 3                                     |
| Two jobs of one session, refresh, **no lock**      | **both failed** at 88 and 89: `refresh token reused; family revoked`, then `refresh token revoked` | 1 served, 5 refused, 1 reuse detected |
| Two jobs of one session, refresh, per-session lock | **both done**, 440 of 440 each, 11.7 s                                                             | 3 (shared by both jobs)               |

- **Finishing a publish that outlasts the user's token needs a refresh token** - `offline_access`,
  sealed per session, the new class of secret the brief named. Held for the refresh token's own life
  (the stand-in provider's default is 86,400 s), or until sign-out, which deletes it and revokes it at
  the provider.
- **Custody costs a lock.** A provider that rotates refresh tokens and detects reuse, as the OAuth 2.0
  Security BCP asks, treats two concurrent refreshes with one token as theft and revokes the whole
  family: two jobs of one session without a lock both died, and the session could no longer refresh at
  all. With a per-session lock (a `FOR UPDATE` on the session's refresh row, and the second job reusing
  the access token the first obtained) both finished on 3 grants.
- Without a refresh token, the failure is by name in both options - though at the request it surfaced
  as the source's `token expired`, a token that was valid when sent and expired during the source's
  latency, and in the worker as the exchange's `subject token expired`.

### 4. A pin made by Ada, read by Grace

Ada pinned each connection's binding; Grace, signed in on her own session, read the pin:

| Connection | Ada pinned | Grace read from the pin | What the pin showed Grace                     | Grace's own live result |
| ---------- | ---------- | ----------------------- | --------------------------------------------- | ----------------------- |
| Postgres   | 1, 3       | 1, 3                    | "Resolved as Ada, through pg-set-local-role"  | 2                       |
| SQL Server | 1, 3       | 1, 3                    | "Resolved as Ada, through ms-session-context" | 2                       |
| HTTP       | 1, 3       | 1, 3                    | "Resolved as Ada, through http-delegated"     | 2                       |

The provenance records the connection and its declaration, the query definition version, the
canonical parameters, and the execution identity - mode, mechanism, principal, the sign-in route, and
the identity **as the source saw it** (`current_user`, `SESSION_CONTEXT`, or the exchanged token's
`sub`) - with a row count and a checksum. **DAT-024 is met**: the pin says whose view produced it and
the document can show that. The harness gives Grace the value; **whether it should is DAT-Q03**, with
IAM, and is not this spike's to answer. What the case shows is that the question is real for every
pass-through connection: a baseline (DAT-038) pins under the publisher's view, and every reader of what
was published sees rows their own rules would hide. (The Postgres and SQL Server pins checksum
identically - the same rows in the same order - a first sight of case 6.)

### 5. The cache

| Key                                                 | Ada, then Grace, then each again | Grace was served                        |
| --------------------------------------------------- | -------------------------------- | --------------------------------------- |
| With the execution identity (all three connections) | miss, miss, hit, hit             | her own row 2, from her own entry       |
| Without it (all three connections)                  | Ada miss, **Grace hit**          | **Ada's rows 1 and 3** - DAT-026 broken |

- **What the key must hold:** the tenant, the connection and its version, the query definition version,
  the canonical parameters, and the **execution identity as the source sees it** - `asserted:ada` for
  asserted identity, `delegated:<issuer>|<sub>` from the user's provider token for delegated. Left out,
  Grace was served Ada's rows on all three connections. The cache lives in the tenant's schema
  (`result_cache`), tied to the session that filled it: signing Ada out removed her 8 entries with her
  session row.
- **A cached result outlives the user's permission at the source.** With Ada's result cached, row 1 was
  reassigned to Grace at the source (the API's owner switch; an `UPDATE` in Postgres). Ada's next
  cached read still returned **rows 1 and 3** from the cache, while her live query returned **3** alone.
  Nothing the source does tells the product: there was no way to learn of the change but to ask again.
  For a delegated token the harness caps the entry's life at the token's own (asked for 3,600 s,
  granted **300**); for asserted identity there is no such bound (granted **3,600**).

### Found, not asked

- The job's sealed delegated token (`job_identity`) survived the job's end; only the session's end
  removed it.
- The connector's cache of exchanged tokens survived both the sign-out and the user being disabled at
  the exchange, and went on serving Ada's rows.
- A stopped job recorded the cancellation of its queries as its failure, never the sign-out.
- One binding in 36 runs started at the instant of sign-out and ran to completion.
- Asserted identity served a Google-route user whom the delegated route refused: the two mechanisms do
  not admit the same users, so a connection's mode decides which sign-in routes can use it.
- Two unlocked refreshes of one session did not merely fail - the provider's reuse detection revoked
  the session's whole token family.

### What stayed a claim

A real provider's refresh-token behaviour (rotation, reuse detection and lifetimes are each provider's
policy - Entra ID, Okta and others differ, and the stand-in follows the OAuth 2.0 Security BCP); a real
browser's authorization-code flow, stood in for by a direct grant; the timing numbers, which are one
machine and a set latency; and whether a reset clears a pooled connection's identity (case 3).

### Verdict

**Pass with cost.** Each of 1 to 5 has an answer that holds IAM-064 and DAT-026, and the costs are
named:

1. **Where the publisher's identity is:** asserted identity needs only the principal's name, and a
   worker can carry it at no cost. A delegated token must travel with the job, sealed in the tenant's
   schema, **for the job's duration and deleted when it ends**, and, where a publish may outlast the
   provider's access token, a refresh token held per session for the session's life. Resolving at the
   request holds the publish request open for the whole document (11-14 s for 440 bindings at 20 ms
   each, one at a time). Pinned-only refuses by name, and is the answer that holds no user secret at
   all.
2. **Sign-out** stops every option within 50 ms and cancels the source's statements, but the job must
   record the sign-out as its reason, the bound is one binding's duration unless check-and-register is
   made atomic, and the connector's cache of exchanged tokens must be purged with the session.
3. **Expiry** needs refresh-token custody, and custody needs a per-session lock, or a rotating
   provider revokes the user's whole token family.
4. **A pin** records whose view produced it; DAT-Q03 decides who may read it.
5. **The cache** must be keyed on the execution identity as the source sees it, and a pass-through
   result can outlive the user's permission at the source for as long as the entry lives. The product
   cannot learn of the change; only a short lifetime bounds it.

**The product does come to hold a user's delegated token** if pass-through HTTP bindings may be live in
a worker's publish: an access token for the length of the job, and a refresh token for the length of
the session if the job may outlast it. Pinned-only (option c) is the one answer that holds neither.

---

## What is a proxy, and what is verified

- **Verified on this stack:** the reachability contrast between A and C; the guard's handling of every
  spelling; the redirect exfiltration and its block on C; the rebinding flip and its block on C; the
  absence of the secret on every searched path including a real crash dump.
- **A proxy:** the timing numbers (one machine, no network latency, Node not a pooled worker); the
  "job row" and "crash report" paths (stood in for by the raw driver error and a real uncaught-exception
  stderr dump - the product has no job store yet to write into); the sealing key travelling in the
  request rather than living in the process (a harness simplification - it does not affect the leak
  search, which is over what the drivers emit).
- **Verified on this stack (cases 3 and 4):** Ada's and Grace's rows under every mechanism; which forms
  fail closed; which assertions the query text can and cannot undo; the refusals of the Google-route
  token, the raw provider token and a wrong client; the publish options' behaviour, sign-out's stop and
  its race, expiry with and without refresh and the lock; the pin's provenance; the cache key and the
  stale entry.
- **A proxy (cases 3 and 4):** the service and the worker are one process (the caller), and a session
  is a row the harness writes after a direct grant rather than a browser's code flow; the timings, as
  for cases 1 and 2; the provider is a stand-in whose refresh policy is the Security BCP's, not any
  real provider's.
- **Environment-specific:** the published-port leak is a Docker Desktop property, called out as a
  requirement on production rather than a defect. The other spikes' numbers are taken on Linux CI;
  these were taken on Docker Desktop for Windows, and case 1's network results should be reconfirmed
  on the Linux runner before the decision record rests on them.

## Requirements the spike may send back so far

Only the rows section 8 of the brief lists that cases 1 to 4 touch, and one it does not. None is
decided; each is a finding for Ken, to land through the requirements process.

- **DAT-056 (and the placement decision).** Case 1 makes the network the boundary (placement C), and
  case 2 measures the cost of the per-process isolation DAT-056 may demand (~40 ms/query). The pair
  points at stating, in DAT-056, whether one connector process may serve many tenants (opening every
  secret it is handed) or must be one-secret-per-process. _(Written with cases 1 and 2; case 3 has
  since answered what it waited on - next item.)_
- **DAT-056, from case 3.** Asserted identity is the only database mechanism the spike could run, and
  under it the connection's account holds every user's authority, which the query text inherits. The
  evidence points at DAT-056 saying what authority means under asserted identity, for example: _"Under
  asserted end-user identity, a connection's account must hold no privilege on the data of its own; its
  assertion must be one the query text cannot change, or the query text must be under the product's
  control; and a connection that has carried a user's identity must be reset or discarded before it is
  reused."_
- **DAT-008 and DAT-023.** Case 3 found no delegated mechanism for either database that the spike
  could run, and none has meaning for an uploaded file. The evidence points at: _"A connection must
  declare how queries against it authenticate: as a tenant service account, or as the end user by a
  mechanism its connector declares - a delegated token, or an asserted identity."_ DAT-023 then holds
  only where the connector declares one, which pulls DAT-055's pass-through capability (T5) into T2, as
  the brief foresaw.
- **DAT-008, the Google route.** Confirmed for a delegated token (refused at the exchange), and found
  not to hold for asserted identity (served). The wording the evidence points at: _"End-user
  authentication by a delegated token is available only to a user signed in through the tenant's own
  provider; a user signed in otherwise, or acting through a personal API token, cannot use it."_
- **DAT-038 and DAT-024.** Case 4 found no identity to publish under but the publisher's: a baseline
  pins every pass-through binding under the publisher's view. DAT-024 is met as written. The evidence
  points at DAT-038 adding _"...and a pass-through binding pins the view of the person who made the
  baseline, which the baseline records"_, and at DAT-Q03 being answered before T2's design.
- **DAT-052 and DAT-026.** Case 4 found no way for the product to learn that a user's source-side
  permission changed. The evidence points at: _"A result obtained under end-user identity may be
  cached for no longer than the identity's own credential is valid, and never for longer than a stated
  maximum; the cache key must include the identity as the source sees it."_
- **IAM-067, not in the brief's list.** Its "within a stated bound" is, on this evidence, one binding's
  duration unless checking the session and registering an execution are one step; and "surface an
  authentication failure" is not what the harness's job recorded. The requirement stands; the design
  owes the bound and the reason.
- **DAT-006.** The connection test is a usable oracle only because its reasons are uniform. The
  residual signal (guard-refused vs connect-failed use different phrases) is a small change worth
  writing into DAT-006's statement, so the requirement asks for one phrase, not two.
- **A note toward DAT-017.** Case 2 already shows HTTP has no binding interface and its secret must
  ride a header, not the URL; case 5 will decide DAT-017's wording, but the leak result is the first
  evidence for "never spliced into, or carried by, query text or a URL."

## Where the code is

`spikes/data-connectors/` - `compose.yaml` (the stack), `agent.mjs` (caller and connector),
`lib/guard.mjs` (the normalising SSRF guard), `lib/connect.mjs` (the drivers and the sealed-secret
open), `lib/seal.mjs` (the spike copy of the product's sealing), `case1.mjs`, `case2.mjs`,
`crashprobe.mjs`, and `README.md`. For cases 3 and 4: `idp.mjs`, `token-exchange.mjs` and
`fake-api.mjs` (the provider, the source's authorisation server and the source), `lib/identity.mjs`
(execution as the end user), `lib/service.mjs` (sessions, publish jobs, pins and the cache),
`init/*-phase2.sql`, `case3.mjs` and `case4.mjs`. `case1.mjs`'s target and spelling lists, and `case2.mjs`'s failure
modes, are the start of the regression suite the brief (§10.3, DAT-021) asks the connectors to carry.
