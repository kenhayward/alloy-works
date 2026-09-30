# Data connector spike - findings

> **Status: Complete; decided in
> [ADR-0034](../../decisions/0034-data-connectors-run-apart-as-a-declared-identity.md).** Cases 1 to 7
> have run. The decision record is Proposed: Ken takes the requirement rewordings below, and DAT-Q03,
> separately. These findings sit beside the brief
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

## Summary

The brief asked:

> **Can a query reach a tenant's source without the connector becoming a route into our own network,
> run as the identity its connection declares - the end user's included - wherever and whenever it
> runs, and return a result that pins, checksums and fails the same way from a relational database,
> an HTTP endpoint and a file?**

**Yes, with three qualifications, each a finding rather than a defect.**

- **Not a route in: yes, when the query runs in a connector container on a network with no route to
  the platform** (placement C). The network stopped every hostile connection the code guard let
  through - a redirect to the metadata endpoint, a DNS rebind - while the tenant's private source
  answered. Run by the caller itself (placement A), only code stood between a connection and the
  platform, and case 1 found three ways that code is one mistake from a route in. The guarantee that
  the connector's network has no route to the platform is production's to give; Docker Desktop did
  not give it for a published port.
- **As the declared identity, the end user's included: yes for HTTP by a delegated token, and for
  both databases only as asserted identity**, which the source takes on trust from the connection's
  account. In PostgreSQL the query text can re-assert whom it likes, so asserted identity there holds
  only against text the product controls. For an uploaded file "as the end user" means nothing.
  Later and elsewhere - in a worker's publish, after an expiry, across a sign-out, through a cache -
  each has an answer, at the cost of the product holding a user's delegated token for a job's length
  and a refresh token for a session's, under a per-session lock.
- **Pins, checksums and fails the same way: yes**, under one canonical form in which no cell is a
  JSON number: ten source-and-reader paths gave one checksum in four time zones. Each loss a driver or
  format imposes is refused by name, and a query that feeds a pin needs a total order or is hashed as
  a multiset. Every limit failed by name, and cancellation reached both databases - but only when the
  connector sent it; neither driver's own timeout stops the statement.

| Case                                                 | Role        | Verdict                                                                                                                                                                                                    |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** - The connector is not a route in              | Gate        | **Pass for placement C, with a named condition; fail for placement A on its own**                                                                                                                          |
| **2** - The secret opens in one place                | Correctness | **Pass with cost** - no path leaks the secret except the query-string transport, which is refused by design                                                                                                |
| **3** - As the end user, per connector type          | Gate        | **Pass for HTTP (delegated token); pass with cost for both databases, as asserted identity only; meaningless for an uploaded file**                                                                        |
| **4** - The end user's identity, later and elsewhere | Gate        | **Pass with cost** - every sub-case has an answer that holds IAM-064 and DAT-026, at the costs named in section 4                                                                                          |
| **5** - One parameter declaration, three encodings   | Correctness | **Pass with cost** - no bound value changed a statement's shape in 3,792 attempts; `LIKE`, collations and `STRING_SPLIT` need rules; in Postgres the text around a bound value can still move the identity |
| **6** - A typed result, pinned and checksummed       | Gate        | **Pass, with named refusals** - one canonical form, one checksum from ten source-and-reader paths in four zones; the losses each driver imposes named                                                      |
| **7** - Limits that fail rather than truncate        | Correctness | **Pass with cost** - every limit a named failure; cancellation reaches both databases only when the connector sends it                                                                                     |

Cases 3 and 4 ran on the same machine and Docker Desktop as cases 1 and 2, against a stack brought up
fresh from `compose.yaml` (one harness defect was fixed on the way: the source Postgres's two init
scripts ran in the wrong order on a fresh volume, and the container exited on a role that did not yet
exist; they are numbered now). Cases 5 to 7 ran on the same machine, against the same stack brought up
fresh with a third init file for each database, each case in a one-shot Linux container on the sources'
network.

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
  while the job ran, was presented to the connector after the sign-out: **served as Ada, rows 1 and
  3**, through the connector's cache of exchanged tokens, and through a fresh exchange too, because the
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

## Case 5 - One parameter declaration, three encodings

**What was run.** `case5.mjs`, in a one-shot container on `aw-dc-sources` (the connector's network),
against the source databases directly and a fake HTTP source it starts beside itself. One declaration
(DAT-010) - text, integer, decimal, date, instant, boolean, a value from a list, a list of integers and
a list of texts, and one variation, a sort key - is validated (DAT-020) by `lib/params.mjs` and then
bound three ways:

- **SQL**: the author's text marks a parameter `{{name}}` and a variation `{{#name}}`; the binder
  replaces a parameter marker with the driver's placeholder (`$n` for `pg`, `@name` for `tedious`) and
  a variation marker with the fixed fragment the definition declares for the chosen key. A value never
  becomes text.
- **HTTP**: a request template - path segments, query-string entries, headers, a JSON body - filled by
  a builder that encodes each value for its position (`encodeURIComponent` for a segment,
  `URLSearchParams` for the query, a checked header value, `JSON.stringify` for the body, with integers
  and decimals written as exact JSON numbers through `JSON.rawJSON`).
- **A file**: declared filters (`eq`, `contains`, `prefix`, `gte`, `in`) applied by the connector to the
  file's own canonical rows (case 6's form), compared by declared type - never by pattern, never by float.

Each attempt was scored against what the same value **read as data** would return - rows whose label
equals the value, for instance - so a result that differs is a value that changed what the query did.

### The attempts

Forty-two hostile values - SQL metacharacters and comment markers, `'; drop table ...`,
`1; select pg_sleep(3)` and `waitfor delay`, placeholder look-alikes (`$1`, `@label`, `{{label}}`,
`{{#sort}}`), `LIKE` wildcards (`%`, `_`, `[a-z]%`), a NUL, a modifier apostrophe, a string that closes
JSON, `..`, `.`, `%2e%2e`, `a/b`, `a%2Fb`, `?x=1`, `#frag`, `a&b=c`, CR LF with a header after it, a lone
surrogate, a 100,000-character string, the empty string and null - were put through every type in every
position, with, per type, the values wrong in type, range or presence (`1.5`, `'0x10'`, `' 1'`,
`'1e3'`, 2^63, `'12.345'` against scale 2, `'2026-02-30'`, an instant with no zone, seven fractional
digits against a precision of six, `'yes'`, `'NORTH'`, a list of 51, a nested list, and so on), and
eight variation keys including `'amount desc; drop table ...'`, `'constructor'` and `'__proto__'`.

**3,792 attempts** across **51 source-and-position pairs**: Postgres 14, SQL Server 20 (a list bound
three ways each), HTTP 5, a file 12.

| Source     | Attempts | Refused by DAT-020, by name | Bound, and inert | Not inert | Refused by the source |
| ---------- | -------- | --------------------------- | ---------------- | --------- | --------------------- |
| PostgreSQL | 680      | 465                         | 205              | 5         | 5                     |
| SQL Server | 772      | 465                         | 291              | 16        | 0                     |
| HTTP       | 1,800    | 1,518                       | 281              | 1         | 0                     |
| File       | 540      | 366                         | 174              | 0         | 0                     |
| **All**    | 3,792    | **2,814**                   | **951**          | **22**    | **5**                 |

The refusals are the declaration's own names, before anything ran: `param_type` 2,073,
`param_not_permitted` 301 (a value not in the permitted list), `param_required` 118, `param_range` 91,
`param_not_placeable` 104 (HTTP only: a value that cannot be a path segment or a header - below),
`variation_unknown` 106, `param_scale_exceeded` 7, `param_precision_exceeded` 7, `param_zone_missing` 7.
**No attempt ended as an empty result where it should have been an error.**

**No bound value changed a statement's shape.** Across 522 bound SQL executions no value added rows by
boolean logic, ran a second statement, or delayed the query (every `pg_sleep` and `waitfor` payload
returned in under 2.5 s, as data); every placeholder look-alike was a literal. The 22 results that
differ from "the value read as data" are all a value being interpreted by something **after** it was
bound:

| What interpreted the value                          | Count | The cases                                                                                                                                                            |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIKE`'s pattern language                           | 10    | `%`, `100%`, `_`, `[a-z]%` bound into `label like @p` or `like '%' + @p + '%'` - Postgres 4, SQL Server 6. The same values through `strpos` / `charindex` were inert |
| SQL Server's collation                              | 8     | a trailing NUL is ignored in comparison (`'alpha\0' = 'alpha'`), 7 positions; and `LIKE` does not ignore a trailing space where `=` does, 1                          |
| `STRING_SPLIT` over a joined list                   | 1     | the one item `alpha,beta` became two items and matched two rows                                                                                                      |
| Each database's collation, sorting a variation      | 2     | `label, id` sorted `O'Brien` among the lower-case labels in both databases; a code-point sort (the file source's) puts it first                                      |
| HTTP itself                                         | 1     | a header value's trailing space was trimmed in transit                                                                                                               |
| _Refused by the source: Postgres's text has no NUL_ | 5     | `22021 invalid byte sequence for encoding "UTF8": 0x00` - bound, and refused by the server rather than by the declaration                                            |

So DAT-017 and DAT-018 hold **by construction** for SQL and HTTP, and DAT-021's list above becomes the
regression suite with these rules written into the declaration rather than into escaping:

- **A text parameter refuses U+0000** (DAT-020): one source refuses it and the other ignores it.
- **A "contains" or "starts with" match is declared, and bound to a pattern-free function** (`strpos`,
  `starts_with`, `charindex`), never into `LIKE`; escaping wildcards is the thing the Pass line rules out.
- **A list binds as one value**: a Postgres array (`= any($1::int[])`), and on SQL Server - which has no
  array parameter - a JSON array read by `OPENJSON`, a table-valued parameter (a type the source must
  declare), or one parameter per item. All three were inert; joining items into a string for
  `STRING_SPLIT` was not.
- **A variation's key never reaches the source**: the key selects a declared fragment, and the fragment
  is the definition's text. `'constructor'` and `'__proto__'` were refused because the lookup is
  `Object.hasOwn`, not `in` - a detail worth a test of its own.

### HTTP: what the builder has to refuse

A path segment is the one HTTP position where encoding is not enough. A builder that only
percent-encodes let `..` and `.` through as themselves, and the URL parser (WHATWG, which `fetch` uses)
then **removed them as dot segments**: `/echo/records/../rows` arrived as `/echo/rows`. `%2e%2e`
survived only because `encodeURIComponent` turned its `%` into `%25`. The builder refuses by
construction instead: a segment may not be empty, `.` or `..`, or carry `/`, `\` or a control
character (`param_not_placeable`), and a list may not go in a segment or a header at all. `fetch`
itself refused a header value carrying CR LF (`TypeError ... is an invalid header value`) - the builder
refuses it first so the failure is DAT-020's, not a crash - but **trims a trailing space silently**, so a
header value must also refuse leading and trailing whitespace. The query string (through
`URLSearchParams`) and the JSON body (through `JSON.stringify`) were inert for every value, and a value
closing a JSON string arrived as one string.

### What a type needs of its own, per binding

| Type and binding                                               | Sent                            | Arrived                                                                                            |
| -------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Postgres, a decimal of 28 digits, bound as text                | `123456789012345678.1234567891` | the same                                                                                           |
| Postgres, an instant with microseconds, as text                | `2026-03-29T00:30:00.123456Z`   | the same                                                                                           |
| SQL Server, a decimal of 28 digits, `tedious`'s `Decimal` type | the same 28 digits              | **the driver threw** `RangeError ... < 2n ** 64n. Received 1_234_567_890_123_456_850_245_451_776n` |
| SQL Server, a decimal of 19 digits, `Decimal` type             | `922337203685477.5807`          | **`922337203685477.5808`** - silently                                                              |
| SQL Server, a decimal of 15 digits, `Decimal` type             | `12345678901.2345`              | the same                                                                                           |
| SQL Server, a decimal, `NVARCHAR` and `CAST` in the text       | 28 digits                       | the same                                                                                           |
| SQL Server, an instant, `tedious`'s `DateTimeOffset` type      | `...00:30:00.123456Z`           | **`...00:30:00.1230000Z`** - the microseconds gone                                                 |
| SQL Server, an instant, `NVARCHAR` and `CAST` in the text      | `...00:30:00.123456Z`           | `...00:30:00.1234560Z`                                                                             |
| SQL Server, an int64 from its text, `BigInt` type              | `9223372036854775807`           | the same                                                                                           |
| HTTP body, a decimal through `JSON.rawJSON`                    | `0.1`                           | the digits `0.1`                                                                                   |

`tedious` passes a `Decimal` parameter through a JavaScript number, so its native type is exact to
about 15 significant digits. **One declaration shape serves all three encodings**; what differs is the
binder's rule per type and per driver - on SQL Server a decimal and a sub-millisecond instant bind as
text the query definition casts - and where a value may be placed. That is a property of the connector
type's binder, not a variant of the stored declaration.

### Phase 2's finding 1: the identity, and what a parameter model or a text rule can do

Case 3 found that in Postgres one bound statement can call `set_config(...)` and change the identity it
runs under. Four things were run against it:

1. **A bound value can move the identity when the text hands it on.** Asserted as Ada
   (`set_config('app.user', 'ada', true)`), the text
   `... where set_config('app.user', {{label}}, true) is not null` with the bound value `grace` returned
   **Grace's row 2**. Binding kept the value out of the text, and the text gave it to the one function
   that matters. A parameter model cannot see this: the parameter is a well-formed text.
2. **An allowed-text rule, with Postgres's own parser** (`libpg-query` 18.1.5, the server's grammar
   compiled to WebAssembly): one statement, a `SELECT`, and every function called on an allowlist. It
   refused 6 of 6 direct forms - `set_config` in a `WHERE`, schema-qualified and quoted
   (`"pg_catalog"."set_config"`), in a materialised CTE, as a function in `FROM`, a `SET ROLE`
   statement, and two statements - and allowed the honest query (Ada's rows 1 and 3). **It allowed a
   query that reads a view** whose definition calls `set_config`, and that query returned **Grace's row
   2**. The text named only a relation. A rule over the text cannot see into the source's own objects,
   and the tenant's database may hold any number of views and functions that change a setting.
3. **Identity at login rather than asserted after it.** A login, `ada_login`, that is a member of `ada`
   and nothing else, with `SET LOCAL ROLE ada`: Ada's rows 1 and 3; `set_config('role', 'grace', true)`
   in the text was **refused - `42501 permission denied to set role "grace"`**; resetting the role left
   the login itself, which the policy shows no rows. The text can move only within what the login
   holds. (The login's password stands in for a credential minted per execution - a short-lived client
   certificate, say, from a CA the source trusts - which the spike did not build; see what stayed a
   claim.)
4. **SQL Server's `read_only` context**: the same bound value handed by the text to
   `sp_set_session_context` moved the identity (row 2) without `read_only`, and **was refused, `15664`**,
   with it.

**What each would have to do.** A parameter model must forbid a text from passing a parameter into an
identity function, which it cannot check without the text rule's parser - so the parameter model alone
does nothing here. A text rule must be an allowlist over a real parse (not a denylist, not a regular
expression) **and** cannot be complete: any view or function in the source can call `set_config`, so the
rule would have to allowlist relations too, which is the tenant's schema, not ours. **The robust answer
is the identity mechanism, not the text**: an assertion the text cannot undo (SQL Server's `read_only`
key, or `EXECUTE AS ... WITH COOKIE`), or, in Postgres, which has none, an identity established at login
so that the connection holds no authority but the user's. In Postgres, asserted identity plus
author-written SQL is not safe against the author; it is safe only where the text comes from somebody
already trusted with every user's rows, or from a builder.

### A file, and "bound"

A file has no engine and no text, so nothing can be injected; the question is whether the filter is
exact. All 174 filters that ran matched an independent computation over the same rows - `%` and `_`
were literal characters, a decimal compared as a decimal (`'100'` equal to `'100.00'`), an instant given
as `+01:00` compared as its UTC instant. One thing found: a canonical time strips trailing zeros, so its
text order is not its time order (`...:00.5Z` sorts before `...:00Z`); the filter pads the fraction to
nine digits before comparing, and so must anything that sorts canonical times.

### Found, not asked

- `tedious`'s native `Decimal` parameter goes through a JavaScript number: silently wrong at 19 digits,
  a `RangeError` from inside the driver at 28, and its `DateTimeOffset` drops microseconds.
- The two databases compare text differently under their default collations - SQL Server ignores a
  trailing NUL and trailing spaces in `=` and is case-insensitive, and both sort linguistically - so
  "the same" filter over the same rows can return different rows from two sources, and a file filtered
  by the connector (code-point order, case-sensitive) differs again. A declared comparison is per source
  unless the product declares its own.
- The WHATWG URL parser removes `.` and `..` segments that a percent-encoder leaves alone.
- `fetch` trims header whitespace silently, and refuses CR LF by throwing.
- Postgres cannot store U+0000 in text at all.

### What stayed a claim

Identity minted per execution at login (a short-lived client certificate or token the source trusts,
instead of a password) - argued from the `ada_login` result, not built. Other drivers' parameter
handling (`mssql` over `tedious` inherits `tedious`'s). Servers that decode `%2F` before routing: the
builder refuses `/` in a segment so the question does not arise, but a source that decodes other
escapes early was not tested.

### Verdict

**Pass with cost.** Of 3,792 attempts, 2,814 were refused by name and 951 bound inert; 5 were refused
by the source (Postgres and a NUL), which the declaration should refuse first; and 22 were a value
reaching an interpreter after binding (`LIKE`, a collation, `STRING_SPLIT`, HTTP's whitespace
handling), which the rules above take away by construction. None changed a statement's shape. One
declaration shape serves SQL, HTTP and files; each connector type needs its own binder rules per type
(text-and-`CAST` for decimals and fine instants on SQL Server) and its own placement rules (a path
segment and a header accept less than a query string or a body). The cost is DAT-017's limit: **a
bound parameter is inert, but in Postgres the text around it is not**, and no rule over the text can
make it so.

---

## Case 6 - A typed result, pinned and checksummed the same way every time _(gate)_

**What was run.** `case6.mjs`, in a one-shot container on `aw-dc-sources`. One logical result of three
rows and twelve declared columns (DAT-011) - a key; a decimal of 28 digits (`decimal(28,10)`); a 64-bit
integer at both ends of its range and at 2^53 + 1; a currency amount (`decimal(19,4)`, currency GBP
declared on the column) at SQL Server's `money` maximum; a date, including 1900-03-01 and 2000-02-29; a
local date-time with microseconds, one of them in London's spring-forward gap and one in its
autumn-back overlap; an instant written with an offset (`+01:00`) and one before 1970; a time at
23:59:59.999999; a boolean with a null; a null beside an empty string, both ways round; and text in
Greek, Chinese and an astral character (U+20BB7), with `café` both composed and decomposed - was
produced from every source:

- **Postgres** (`typed_result`, `numeric`, `bigint`, `date`, `timestamp(6)`, `timestamptz(6)`,
  `time(6)`), through `pg` with its default parsers, and with every type parser replaced by the
  server's own text.
- **SQL Server** (`DECIMAL`, `BIGINT`, `DATE`, `DATETIME2(6)`, `DATETIMEOFFSET(6)`, `TIME(6)`, `BIT`,
  `NVARCHAR`), through `tedious`'s types, and through a query that casts each column to text.
- **JSON over HTTP**, twice: decimals and int64 as strings, and as bare JSON numbers carrying every
  digit (as a server in another language would send them), each read by `JSON.parse` and by
  `JSON.parse` with the source text of each number (Node 22's reviver `context.source`).
- **CSV**, with the declared convention that an unquoted empty field is null and a quoted `""` is the
  empty string; read with `csv-parse` honouring the quoting, and ignoring it.
- **XLSX**, two workbooks written by hand so every cell is exactly what the case names: one in the 1900
  date system and one in the 1904 (the date system is a property of the workbook, not the sheet, so it
  takes two files): dates and date-times as serial numbers under date formats, a currency format, a key
  that is a formula with a cached value, an inline empty string, a shared empty string, a formula whose
  string result is empty, an absent cell, and - where a spreadsheet cannot hold a value as a number (over
  15 significant digits, an int64, an instant, a date before 1904 in the 1904 system) - a text cell, as
  a person would have to type it. A second sheet holds the probes: a percentage, a grouped number, an
  int64 and a 28-digit decimal written as numbers, serial 60, an error cell, a shared string with a
  phonetic run, and a formula with a cached number. Each workbook read by three readers: **our own over
  `fflate` and `saxes`**, **ExcelJS 4.4.0**, and **SheetJS 0.18.5** (the npm registry's copy), SheetJS
  and ours converting serials by the rules below.

### The canonical form proposed

```
{ "columns": [["k","integer"], ["dec","decimal"], ...], "rows": [["1","123456789012345678.1234567891", ...], ...] }
```

- **One document per result**: the declared columns as `[name, type]` pairs in declared order - the
  base type only, so a changed precision is a constraint, not a new checksum - and the rows.
- **Every cell is a JSON string, a JSON boolean or `null`. There are no JSON numbers.** An integer is
  base-10 text with no sign but `-` and no leading zeros; a decimal is base-10 text with no exponent, no
  leading zeros, **no trailing fractional zeros**, no `.` when whole, and `-0` as `0`, within the declared
  precision and scale - a value needing more is refused, never rounded. So `1234.5600` from Postgres,
  `1234.56` from JSON and a currency-formatted cell holding 1234.56 are one value.
- **A date** `YYYY-MM-DD`; **a time** `HH:MM:SS[.f]` and **a local date-time**
  `YYYY-MM-DDTHH:MM:SS[.f]`, as themselves, no zone; **an instant** `YYYY-MM-DDTHH:MM:SS[.f]Z`,
  converted to UTC exactly, the fraction carried as digits (never through a JavaScript `Date`), with
  trailing zeros stripped, within the declared precision (refused beyond it). An offset is not kept: the
  instant is the value, and a zone that matters is a column of its own.
- **Null is `null`, the empty string is `""`**, and they checksum differently.
- **Text is its code points, unnormalised.** Composed and decomposed `café` are two values; normalising
  would hide a real change at the source.
- **Rows** in the query's stated order when that order is total (it covers a key), and otherwise sorted
  by each row's own canonical text, as a multiset - see "No stated order" below.
- **Serialised as RFC 8785 canonical JSON and hashed with SHA-256.** Because the document holds no
  numbers, RFC 8785's hardest part - its number formatting - never applies, and no reader's float can
  reach the hash.

The version of the form (`canonical: 1`) belongs in the provenance record beside the checksum, so a later
change to the form is a new version rather than a silent re-hash.

### Every source, one checksum

The expected result's checksum is `ce33edf8...a7fd8`. What each source and reader produced:

| Source and reader                                        | Result                                                                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres, the server's own text                          | **`ce33edf8`**                                                                                                                                                                          |
| Postgres, `pg`'s default parsers                         | differs: microseconds lost in 3 cells (`timestamp` and `timestamptz` become JavaScript `Date`s); in London, 01:30 in the spring gap became **02:30**                                    |
| SQL Server, a query casting each column to text          | **`ce33edf8`**                                                                                                                                                                          |
| SQL Server, `tedious`'s types                            | **refused, `precision_lost`**, for `dec` in row 1 and `amount` in row 2: `tedious` returned `123456789012345660` for the 28-digit decimal and `922337203685477.6` for the money maximum |
| JSON, strings, either reader                             | **`ce33edf8`**                                                                                                                                                                          |
| JSON, bare numbers, read by their source text            | **`ce33edf8`**                                                                                                                                                                          |
| JSON, bare numbers, `JSON.parse`                         | refused, `precision_lost`, for the int64 - but the decimals were **silently wrong** in 2 of 3 rows (`123456789012345680`, `922337203685477.6`): a double gives no sign of loss          |
| CSV, quoting honoured                                    | **`ce33edf8`**                                                                                                                                                                          |
| CSV, quoting ignored                                     | refused (a null boolean read as `''`); in a text column the same loss is silent - null and `""` merge                                                                                   |
| XLSX 1900 and 1904, our reader                           | **`ce33edf8`**, both                                                                                                                                                                    |
| XLSX 1900 and 1904, SheetJS's raw values, our conversion | **`ce33edf8`**, both                                                                                                                                                                    |
| XLSX, ExcelJS                                            | differs in 4 cells, both workbooks: microseconds lost; **23:59:59.999999 became 00:00:00**; an inline empty string and a formula's empty result became **null**                         |
| XLSX 1904 read as if 1900                                | differs: 4 dates **four years and a day early**                                                                                                                                         |

**Ten source-and-reader combinations produced the same checksum.** The same ten produced it again in
three more fresh processes whose zone was `Pacific/Kiritimati` (+14), `Europe/London` and
`America/St_Johns` (-2:30), and 100 runs in one process gave **1 distinct checksum** for Postgres and 1 for
SQL Server. Without the canonical form - the drivers' values through `JSON.stringify`, as a connector
that trusted its driver would store them - Postgres's result had **four different checksums in the four
zones** (every `date` and `timestamp` becomes a `Date` in the process's zone); `tedious`'s was stable,
because it reads dates as UTC by default.

### What each source hands back, and what it takes to reach the canonical form

- **`pg`**: `bigint` and `numeric` as strings (exact); `date`, `timestamp` and `timestamptz` as
  JavaScript `Date`s - milliseconds only, and `date` and `timestamp` in the process's zone. Replacing
  the type parsers so every value is the server's text, with the session's `TimeZone` set to UTC, is
  exact for every type. **Postgres: pinned faithfully, given text parsers.**
- **`tedious`**: `bigint` as a string (exact); `decimal`, `numeric` and `money` as JavaScript numbers;
  `datetime2`, `datetimeoffset` and `time` as `Date`s with the sub-millisecond digits in a hidden
  `nanosecondsDelta` property (usable: the adapter reconstructed 100 ns exactly); `datetimeoffset`'s
  offset dropped (the instant survives). A decimal is exact only while its unscaled integer is below
  2^53, and the adapter checks that and **refuses by name** past it. There is no option to have a
  decimal as text. So: **SQL Server through `tedious` cannot pin a decimal beyond about 15 significant
  digits unless the query casts it to text** - a rule on the query definition (or on what a builder
  generates), or a different driver. With the cast, exact.
- **JSON**: `JSON.parse` makes every number a double, and a decimal that lost digits is
  indistinguishable from one that did not. Reading each number by its source text (the reviver's
  `context.source`, in Node 22) is exact. **JSON: pinned faithfully only by a reader that never makes a
  number a double**; `JSON.parse` alone must be refused for decimal and integer columns.
- **CSV** has no types and no null. It reaches the canonical form only under a declared convention for
  null, and a reader that reports whether a field was quoted (`csv-parse`'s `cast` context does).
- **XLSX** stores numbers as doubles and dates as serial days in one of two systems. What it can carry:
  a decimal or an integer to 15 significant digits as a number, anything longer only as text; no zone
  at all (an instant is text, or refused, `zone_missing`); a local date-time to about **0.63 µs at 2026
  dates** - enough for microseconds, which our reader recovered exactly - and **1.26 µs from serial 65536
  (2079-06-05)**, where a declared precision of 6 is refused (`precision_not_carried`) because the double
  can no longer tell adjacent microseconds apart; milliseconds to year 9999. Serial 60 is 1900-02-29,
  which never existed (Lotus's bug, kept by Excel): our reader refuses it, SheetJS formatted it
  `2/29/00`, and ExcelJS returned **1900-02-28**. Serial 1 to 59 are shifted by a day against serial 61
  onward. The format is presentation: a percentage cell holds `0.125`, which every reader returned as
  such, while SheetJS's formatted text (`sheet_to_json` with `raw: false`) gave `12.5%` and
  `1,234,567.89`; the declared type decides what a number means. An error cell (`#DIV/0!`) is refused
  (`cell_error`). A phonetic run in a shared string is not the string's text; all three readers left it
  out. A formula's cached value is what every reader returned; a stale cache (a workbook saved without
  recalculation) was not tested, and no reader here would notice one.

### Currency

A currency amount is a decimal, and its currency a declaration on the column (or a column of its own);
neither database's money type reaches the canonical form unaided. Postgres's `money` prints by
`lc_monetary`: `$1,234.56` under both `C` and `en_US.utf8` (and `en_GB.utf8` is not installed in the
image, so the setting was refused) - a text to parse, and one that changes with a server setting.
SQL Server's `money` through `tedious` is a double: `922337203685477.5807` arrived as
`922337203685477.6`. Both are read as `decimal` by casting in the query.

### No stated order

`unordered` holds 30 rows. Between 20 refreshes of the same query, rows were rewritten with their own
values (an `UPDATE ... SET v = v` in Postgres, a delete and re-insert of the same row in SQL Server's
heap), so the data never changed. A refresh whose checksum differs from the last would be flagged
"moved" (DAT-036):

| Source     | Query                           | Rows as returned: flagged moved         | Rows sorted by their own text: flagged moved |
| ---------- | ------------------------------- | --------------------------------------- | -------------------------------------------- |
| PostgreSQL | no `ORDER BY`                   | **19 of 19** (20 checksums)             | 0 of 19                                      |
| PostgreSQL | `ORDER BY category` (ties)      | **19 of 19**                            | 0 of 19                                      |
| PostgreSQL | `ORDER BY category, id` (total) | 0 of 19                                 | 0 of 19                                      |
| SQL Server | no `ORDER BY`                   | **16 of 19** (17 checksums)             | 0 of 19                                      |
| SQL Server | `ORDER BY category` (ties)      | 0 of 19 - stable here, but not promised | 0 of 19                                      |
| SQL Server | `ORDER BY category, id` (total) | 0 of 19                                 | 0 of 19                                      |

**A stated order is not enough: it must be total.** Postgres returned ties in a different order after
every rewrite. Two answers hold: a query definition that feeds a pin states an order that covers its key
(DAT-012), and its rows are hashed in that order; or it states none, and the rows are hashed as a
multiset - sorted by their canonical text - which was stable in every form above, at the price that the
checksum then says nothing about order. The proposal takes both: rows in the stated order where the
definition declares its order total (checked against the declared key), and as a multiset otherwise.

### The XLSX reader: chosen, and why

**Our own, over `fflate` and `saxes`.** Of the three candidates:

- **Our reader** matched the canonical checksum in both date systems, because it hands back the cell
  as stored - a number's text, which kind of string, a boolean, an error, nothing - and leaves meaning
  to the declared type. It counts every byte it inflates across every part and emits rows one at a time
  (case 7 measures what that bounds). `fflate` 0.8.3 is already in the workspace for Word output (MIT),
  and `saxes` 6.0.0 is ISC - and is what ExcelJS parses with. It is about 150 lines.
- **ExcelJS 4.4.0** (MIT) converts date-formatted numbers to JavaScript `Date`s itself: microseconds
  gone, 23:59:59.999999 rounded into the next day and reported as `00:00:00`, serial 60 turned into
  1900-02-28, and an inline or formula-result empty string reported as null - four silent changes to
  the canonical result, in both workbooks. It did honour the 1904 system. `npm audit` flags its `uuid`
  dependency (moderate).
- **SheetJS Community Edition**: the npm registry's copy is **0.18.5, from 2022**; current releases are
  published only from the vendor's own server, which cannot be installed from the npm registry under the
  frozen lock file. `npm audit` reports **high: prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS
  (GHSA-5pgg-2g8v-p4x9), "No fix available"** on the registry. Its raw values were exact once our
  conversion was applied - it is the conversion, not the parsing, that the product has to own - but the
  version the product could install is the one with the advisories. The licence (Apache 2.0) was not the
  obstacle; the supply was.

### Found, not asked

- `pg`'s default parsing of `timestamp` in a zone with daylight saving moves a time in the spring gap
  (01:30 became 02:30 in London) - a wrong value, not only a lost digit.
- `tedious` rounds the 28-digit decimal to `123456789012345660`, not even the nearest double
  (`...680`).
- ExcelJS turns 23:59:59.999999 into midnight: a time rounded to milliseconds, wrapped.
- The 1904 system cannot hold a date before 1904-01-01 as a number at all; a workbook in it carries
  such a date only as text.
- `JSON.parse` with the reviver's source text (Node 22, and `JSON.rawJSON` to write) removes the
  double from JSON entirely, in both directions.
- `npm audit` also flags `csv-parse` below 7.0.2 (GHSA-8cw4-87c7-c6xx, the `columns` option, which the
  harness does not use); the product should take 7.0.3.

### What stayed a claim

Workbooks written by Excel, LibreOffice or Google Sheets (the harness wrote its own, cell by cell, so
the cases were exact; a real writer's quirks - shared formulas, rich text runs, dates in text cells -
were not surveyed); other databases' drivers; Postgres's `money` under a non-US `lc_monetary`, whose
locale the image lacks.

### Verdict

**Pass, with named refusals.** One canonical serialisation per declared type, under which every source
that can carry the value exactly produced the same checksum - Postgres, SQL Server, JSON over HTTP, CSV
and XLSX in both date systems - across four zones, fresh processes and 100 runs. Each loss a source
imposes is named and refused rather than rounded: `precision_lost` (a decimal or int64 through a
double: `tedious`, `JSON.parse`, a spreadsheet number), `precision_not_carried` (a serial too coarse for the
declared precision), `zone_missing` (a spreadsheet instant), `nonexistent_date` (serial 60),
`cell_error`. The declared types a source **cannot pin faithfully as delivered by its driver** are: SQL
Server decimals beyond about 15 digits and `money` through `tedious` (fixed by a text cast in the query);
JSON numbers through `JSON.parse` (fixed by reading source text); spreadsheet numbers beyond 15 digits,
and spreadsheet instants (only as text). A query that feeds a pin needs a total order, or its rows are
hashed as a multiset.

---

## Case 7 - Limits that fail rather than truncate

**What was run.** `case7.mjs`, in a one-shot container on `aw-dc-sources` capped at 3 GB of memory.
The limits (DAT-050) were a row limit of 1,000 for the databases and 100,000 for files, a byte limit of
1 MB for the databases' streamed results and **10 MB** for everything else, and a timeout of 1 s for a
statement and 2 s for an HTTP exchange. Each file and HTTP reader ran in a child process of its own
(`--max-old-space-size=1024`) so its peak resident memory (`maxRSS`) is its own; a Node child that has
loaded the harness's modules and done nothing sits at about 90 to 100 MB, so that is the floor of every
figure below. Every large input was generated in memory from a generator and never written out
expanded; the largest files the harness held were a 60 MB workbook and a 3 MB gzip body.

### Rows and bytes from the databases

| Source     | Limit                                                      | Result                                                                                                         |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | 1,000 rows, over 200,000 (`pg-cursor`, one fetch of 1,001) | **`row_limit`** in 3 ms, 1,001 rows fetched; the same query over exactly 1,000 rows returned them              |
| PostgreSQL | 1 MB, counted as rows arrive (fetches of 500)              | **`size_limit`** after 9,631 rows, 12 ms                                                                       |
| SQL Server | 1,000 rows, streamed, cancelled at the 1,001st             | **`row_limit`** in 22 ms; 0 rows arrived after the cancel; the request left `sys.dm_exec_requests` within 2 ms |
| SQL Server | 1 MB, counted as rows arrive                               | **`size_limit`** after 9,631 rows; the request gone within 1 ms                                                |

Neither query was rewritten: Postgres fetches the limit plus one from a cursor and closes it, and SQL
Server's stream is cancelled with a TDS attention at the row that crosses the limit.

**One value larger than the whole byte limit is not bounded by it.** A single 100 MB text value, under
a 10 MB byte limit, failed by name in both - but only after the driver had assembled it: **530 MB** peak
through `pg` (a protocol message is read whole before a row is handed over) and **1,014 MB** through
`tedious` (a `varchar(max)` value is gathered whole before its row is emitted). The row counter cannot see a value until
the driver has it. So a database connector's memory is bounded by the byte limit **plus the largest
single value the source can return**, which only the source can cap.

### Timeouts, and whether the source stops

Each statement was watched in the server's own list of running statements - `pg_stat_activity` and
`sys.dm_exec_requests`, polled every 20 ms from a separate observer connection - from the moment the
limit was hit. A sleep of 20 s, and a CPU-bound statement (Postgres: summing a 20-billion-row series,
value by value, which spills nothing; SQL Server: a `WHILE` loop to 10^10):

| Source and mechanism                                                   | The client saw (at)                                  | The statement at the source                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Postgres, `pg`'s own `query_timeout` (client-side)                     | `Query read timeout` (1,001 ms)                      | **still running 4 s later**                 |
| Postgres, `statement_timeout` 1 s (server-side), sleep and CPU         | `57014 canceling statement due to statement timeout` | gone within 0 ms                            |
| Postgres, our timer, then `pg_cancel_backend` from a second connection | `57014 ... due to user request` (1,000 ms)           | gone within 5 ms                            |
| Postgres, our timer, then the socket closed - sleep, and CPU           | `Connection terminated unexpectedly`                 | **still running 4 s later**, both           |
| Postgres, the same with `client_connection_check_interval` = 250 ms    | the same                                             | gone within 251 ms (sleep) and 253 ms (CPU) |
| SQL Server, `tedious`'s `requestTimeout` 1 s, `WAITFOR`                | `ETIMEOUT` (1,002 ms)                                | gone within 2 ms (an attention)             |
| SQL Server, `tedious`'s `requestTimeout` 1 s, the CPU loop             | **no timeout: still waiting at 3 s**                 | **still running 6 s later**                 |
| SQL Server, our timer, then `connection.cancel()`                      | `ECANCEL Canceled.` (1,001 ms)                       | gone within 1 ms                            |
| SQL Server, our timer, then the socket closed - sleep, and CPU         | `ECLOSE Connection closed before request completed.` | gone within 1 ms, both                      |

Two driver timeouts **stop only the client**. `pg`'s `query_timeout` errors the query in Node and the
server runs on; and closing the socket does not stop a Postgres statement unless
the server is told to check (`client_connection_check_interval`, off by default, available since
PostgreSQL 14), because a backend otherwise learns its client has gone only when it next writes to it.
`tedious`'s `requestTimeout` is **a time to first response, not a deadline**: its source stops the timer
"on first data package" (`lib/connection.js`), and the loop - which sends a completion token per
statement - answered at once, so it was never timed out. The same code means a query that returns its
first rows promptly and then runs for an hour is never timed out by `tedious` either. What stopped every
statement is the connector's own deadline followed by a cancel the source acts on - a Postgres cancel
request (`pg_cancel_backend`, or the protocol's CancelRequest) or a server-side `statement_timeout`, and
a TDS attention or a closed socket for SQL Server - which stopped it within 5 ms. **Cancellation reached
both sources, from limit to gone in 0 to 5 ms, whenever the connector sent it.**

### HTTP

Against the fake source, with a 10 MB limit and a 2 s deadline:

| Response                                                                          | Result                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 100 MB, `Content-Length` declared                                                 | **`size_limit` before reading the body** (15 ms)                                                |
| 100 MB, the declared length not trusted, counted as it arrives                    | **`size_limit`** at 10 MB (40 ms), peak 119 MB                                                  |
| 10 MB less 100 bytes                                                              | read whole                                                                                      |
| gzip, **3.05 MB on the wire expanding to 1 GB** (343 : 1), counted after decoding | **`size_limit`** at 10 MB decoded, peak **108 MB**                                              |
| the same read with `await res.text()` and checked afterwards                      | **the child was killed** by the container's memory limit                                        |
| `Content-Length: 1000`, 10 bytes sent                                             | named failure (`UND_ERR_RES_CONTENT_LENGTH_MISMATCH`)                                           |
| `Content-Length: 10`, 1,000 bytes sent                                            | **10 bytes, and no error**: the body is framed by its declared length and the rest is discarded |
| a byte every 100 ms for 10 s                                                      | **`timeout`** at 2,000 ms; with `fetch`'s defaults and no deadline it completed after 10,031 ms |
| headers after 5 s                                                                 | **`timeout`** at 2,000 ms                                                                       |

The drip matters because `fetch`'s own body timeout (Node's `undici`, 300 s by default) is an idle
timeout between chunks, which a source sending a byte at a time never trips; a deadline has to cover
the whole exchange. The under-declared length is the one truncation the connector cannot detect: HTTP
says the message is the first 10 bytes. A JSON body cut short fails to parse, but a CSV cut at a line
break is a valid, shorter file - so a CSV fetched over HTTP should be read against a length or a digest
the source states separately, or its row count compared with one the source reports, where either
exists.

### Files: memory at the limit and at ten times it

| Reader and input (limit 10 MB, 100,000 rows)                             | Result                                                                         | Peak RSS     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------ |
| CSV, ours (`csv-parse` behind a byte counter), 10 MB                     | read, 101,883 rows                                                             | 122 MB       |
| CSV, ours, 100 MB                                                        | **`size_limit`** at 10 MB                                                      | 119 MB       |
| CSV, ours, one 100 MB line (`max_record_size` = 10 MB)                   | **`size_limit`**: "A record is longer than 10485760 bytes"                     | 118 MB       |
| CSV, ours, 100 MB, row limit only                                        | **`row_limit`** at 100,001                                                     | 123 MB       |
| CSV, the whole file read into a string, then parsed, then checked        | the check fails - after the work                                               | **735 MB**   |
| XLSX, ours, a 0.62 MB file expanding to 10 MB                            | read, 53,897 rows                                                              | 151 MB       |
| XLSX, ours, a 6.1 MB file expanding to 100 MB                            | **`size_limit`** at the sheet                                                  | 175 MB       |
| XLSX, ours, a 60 MB file expanding to 1 GB                               | **`size_limit`** at the sheet                                                  | 300 MB       |
| XLSX, ours, a 0.61 MB file whose one shared string is 600 MB (1,030 : 1) | **`size_limit`** at `sharedStrings.xml`                                        | 248 MB       |
| XLSX, ours, 100 MB and 1 GB, row limit only                              | **`row_limit`** at 100,001                                                     | 186, 305 MB  |
| XLSX, ExcelJS `load`, 10 MB                                              | read                                                                           | 223 MB       |
| XLSX, ExcelJS `load`, 100 MB                                             | read - it has no byte limit                                                    | **946 MB**   |
| XLSX, ExcelJS `load`, 1 GB                                               | **crashed**: `JavaScript heap out of memory`                                   | -            |
| XLSX, ExcelJS streaming reader, 1 GB, stopped at the row limit           | `row_limit`                                                                    | 304 MB       |
| XLSX, ExcelJS streaming reader, the 600 MB shared string                 | **`RangeError: Invalid string length`**                                        | 657 MB       |
| XLSX, SheetJS 0.18.5, 10 MB and 100 MB                                   | read                                                                           | 181, 620 MB  |
| XLSX, SheetJS 0.18.5, 1 GB                                               | **no error, and no sheet**: the workbook lists `Data` and holds no data for it | **2,213 MB** |
| XLSX, SheetJS 0.18.5, the 600 MB shared string                           | **no error, and no sheet**, as above                                           | **1,302 MB** |

The row-limited XLSX figures are higher than the byte-limited ones only because the whole compressed
file is in memory (60 MB) before a byte is inflated - the harness holds the file whole, as a reader of an
object-store download would unless it streamed the download too. The fixed cost is the compressed file plus one inflate window and one row; the
variable cost is capped by the byte limit.

**SheetJS's result is the worst outcome case 7 can have**: after spending 2.2 GB it returned a workbook
that names the sheet and holds nothing for it, without an error - an empty result where the input was a
failure, which a publish would print as an empty table (DAT-045 and DAT-046 both miss it, because
nothing failed). ExcelJS failed loudly, by crashing the process or by a `RangeError`; neither is a named
failure, and a crash takes down whatever else the process was doing. Neither library has a byte limit on
what it inflates.

### Found, not asked

- `pg`'s `query_timeout` and a closed socket both leave a Postgres statement running; only a cancel
  request, `statement_timeout`, or `client_connection_check_interval` stops it.
- `tedious`'s `requestTimeout` stops counting at the server's first packet, so it bounds the time to
  first response and nothing after it.
- One value bigger than the byte limit costs the driver's whole copy of it - 5 to 10 times the limit
  for a 100 MB value - before any limit can act.
- `fetch`'s body timeout is idle-based; a drip-fed body evades it indefinitely.
- An HTTP source that under-declares its `Content-Length` yields a valid, shorter body with no error.
- SheetJS 0.18.5 returns an empty sheet, silently, for a workbook too large for it.

### What stayed a claim

A real network between the connector and a source (latency, a middlebox that holds a connection open,
TCP keepalive); cancellation through a connection pool or `pgbouncer`, where a cancel request must reach
the right backend; a source with its own statement timeout set lower than ours; SQL Server's behaviour
under `SET NOCOUNT ON` and for a query that streams rows slowly (argued from `tedious`'s source, not run).
A streaming read of the uploaded file from the object store, rather than holding it whole, which would
take the compressed size out of the XLSX figures.

### Verdict

**Pass with cost.** Every limit ended as a named failure - `row_limit`, `size_limit`, `timeout`, or the
source's own named refusal - and never as a shorter result, for both databases, HTTP (an oversized body, a
343 : 1 gzip, a lying length, a drip) and both file formats (10 times the limit, one enormous line, a
1,030 : 1 shared string), with the connector's own readers holding memory at 108 to 305 MB whatever the
input. The source's work was cancelled in 0 to 5 ms whenever the connector cancelled it. The costs: the
timeout must be the connector's own deadline and a cancel the source acts on - both drivers' built-in
timeouts let a statement run on; a single value is bounded only by the source; the XLSX reader must be
our own, because neither library bounds what it inflates and one of them hides the failure; and one
HTTP truncation - an under-declared length - is invisible to the connector.

---

## What is a proxy, what is verified, and what stayed a claim

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
- **Environment-specific:** every network result - case 1's reachability, the redirect and the
  rebind blocked on C - was measured on Docker Desktop for Windows (Linux containers in its virtual
  machine), not on Linux, where the other spikes' numbers are taken. The published-port leak is a
  property of that host: a platform service's port published to it was reachable from the connector's
  network, through the host. It is a requirement on production rather than a defect, and it means the result does not carry to
  another host by argument. **Production's network isolation must be verified on production's own
  platform** - that the connector's network has no route to any platform service, published or not -
  and neither this machine nor the Linux CI runner stands in for that.
- **Verified on this stack (cases 5 to 7):** every binding attempt's outcome and the value each source
  received; what each driver and reader hands back per type, and the canonical checksum from every
  source, in four zones, fresh processes and 100 runs; the spurious "moved" flags; every limit's named
  failure; each statement's presence or absence in the server's own list after a limit; the peak memory
  of each reader.
- **A proxy (cases 5 to 7):** the workbooks were written by hand, cell by cell, not by a spreadsheet
  application; the fake HTTP source ran beside the case in its container, over loopback; the uploaded
  file was held whole in memory, not streamed from the object store; the memory figures include a Node
  process's own 90 to 100 MB; one machine, no real network, no load on the sources. Cases 5 to 7 ran in
  Linux containers, as section 6 of the brief asks, but in Docker Desktop's virtual machine rather than
  on the CI runner.
- **Stayed a claim, untested:** Entra ID tokens against Azure SQL, and Entra ID's on-behalf-of flow,
  which is not RFC 8693; Kerberos constrained delegation to an on-premises SQL Server; PostgreSQL 18's
  OAuth authentication, because `pg` has no `OAUTHBEARER` (its SASL client offers only the SCRAM
  mechanisms); a real cloud's metadata endpoint and egress controls, stood in for by an address on a
  compose network; SharePoint, Microsoft Graph and cloud object stores as remote file locations; a real
  provider's refresh-token policy; identity minted per execution at login; workbooks written by a
  spreadsheet application; and a source reached over a real network.
- **Stayed a claim, by decision:** that resetting a pooled connection clears the identity it carried.
  The owner excluded, on 2026-09-30, any attempt to carry one user's identity over to another
  execution on a shared connection, so every execution ran on a fresh connection. What case 3 records
  about `DISCARD ALL`, `RESET ROLE`, the TDS `RESETCONNECTION` flag, `pg.Pool` and `mssql`'s pool is
  from their documentation and source, not from an attack; whether a reset clears a `NO REVERT`
  context or a `read_only` key is not stated there, and was not tested.

## Requirements this spike sends back

Every rewording the cases point at, from every phase, gathered in one place with the finding each
rests on. The spike edits no requirement row. Each goes to Ken and, if taken, lands through the
requirements process, with a new identifier where the change is material.
[ADR-0034](../../decisions/0034-data-connectors-run-apart-as-a-declared-identity.md) is written to
hold whichever way each is decided, and says where an answer would change it.

- **DAT-001 and DAT-002 - a file is a format, not a transport.** _Rests on:_ cases 6 and 7, where the
  CSV and XLSX readers take a byte stream and the same limits bound an HTTP body, and the brief's
  argument (section 2) that an uploaded file, held by hash, needs no credential and no egress. An XLSX
  fetched over HTTP was not run end to end, so the evidence supports the wording without having tested
  it. _Proposed:_ DAT-001 adds _"An uploaded file is a source of its own, held by the tenant, and needs
  no connection"_; DAT-002 becomes _"Connection types must include at minimum a relational database
  and an HTTP endpoint, and a query must be able to read a delimited file or a spreadsheet, uploaded
  to the tenant or fetched through an HTTP connection."_ **Proposed; for Ken's decision.**
- **DAT-006 - one reason for every failure.** _Rests on:_ case 1, section C. Each family of failure
  gave one reason, so no address was named and refused, filtered and unknown could not be told apart;
  but the guard's refusals and a failed attempt used two phrases, which tells an administrator which
  addresses the guard covers. _Proposed:_ _"A connection must be testable from the interface, and the
  test must report success, or one reason that is the same for every failure, naming no address and
  echoing no credential."_ **Proposed; for Ken's decision.**
- **DAT-008 and DAT-023, with DAT-055 - which mechanism, and who may use it.** _Rests on:_ case 3,
  where HTTP passed by a delegated token, both databases only by asserted identity, PostgreSQL 18's
  OAuth route could not be reached from `pg`, and an uploaded file has no source to present an
  identity to; and cases 3 (section D) and 4 (section 1), where the exchange refused a Google-route
  token while asserted identity served the same user, and a personal API token has no provider token
  behind it. _Proposed:_ DAT-008 becomes _"A connection must declare how queries against it
  authenticate: as a tenant service account, or as the end user by a mechanism its connector
  declares, which is a delegated token or an asserted identity. End-user authentication by a
  delegated token is available only to a user signed in through the tenant's own provider; a user
  signed in otherwise, or acting through a personal API token, cannot use it."_ DAT-023 holds only where the connector
  declares an end-user mechanism, and adds _"A file source declares none."_ That pulls DAT-055's
  pass-through capability - only that part - from T5 into T2, as the brief foresaw. **Proposed; for
  Ken's decision.**
- **DAT-011 - a closed set of types, refused rather than rounded.** _Rests on:_ case 6: one canonical
  form needs a closed set of declared types with their precision, and each source loses something
  as delivered - SQL Server decimals beyond about 15 digits and `money` through `tedious`, JSON
  numbers through `JSON.parse`, spreadsheet numbers beyond 15 digits, spreadsheet instants.
  _Proposed:_ _"Each result column declares a type - text, integer, decimal with precision and scale,
  date, time, local date-time or instant with a fractional-second precision, or boolean - and a value
  a source cannot deliver exactly in that type is refused by name, never rounded."_ **Proposed; for
  Ken's decision.**
- **DAT-017 - bound, built or filtered, never spliced.** _Rests on:_ case 5, where "passed to the
  source as a bound value" held for both databases and has no meaning for HTTP (a builder) or a file
  (a filter), and 3,792 attempts changed no statement's shape; and case 2, where the one leak was a
  secret in a URL. _Proposed:_ _"A parameter's value is never spliced into query text, a URL or a
  header as text: it is passed as the driver's bound value, placed by a builder that encodes it for its
  position and refuses what that position cannot carry, or applied by the connector as a typed filter
  over a file's rows."_ DAT-018 and DAT-019 hold as written. **Proposed; for Ken's decision.**
- **DAT-024 and DAT-038, with DAT-Q03 - whose view a baseline pins.** _Rests on:_ case 4, sections 1
  and 4: there is no identity to publish under but the publisher's, a pin records whose view produced
  it and the document can show that, and Grace, reading Ada's pin, saw rows her own rules hide. DAT-024
  is met as written. _Proposed:_ DAT-038 adds _"...and a pass-through binding pins the view of the
  person who made the baseline, which the baseline records"_; and DAT-Q03 - who may read a value pinned
  under somebody else's view - is answered, with **IAM**, before T2's design rather than during it.
  **Proposed; for Ken's decision.**
- **DAT-036 and DAT-040, with DAT-012 - a checksum that moves only when the data does.** _Rests on:_
  case 6. With no stated order, 19 of 19 refreshes in Postgres and 16 of 19 in SQL Server were flagged
  moved when nothing moved, and an order with ties did the same in Postgres; one canonical form gave
  one checksum from ten source-and-reader paths. _Proposed:_ DAT-012 adds _"A query definition that
  feeds a pin or a refreshable binding states a total order - one that includes its declared key - or
  its result is checksummed as a multiset of rows"_; and DAT-040's checksum becomes _"...a SHA-256
  checksum over the result's canonical form, whose version the provenance record names."_ DAT-036
  holds as written once the checksum is stable. **Proposed; for Ken's decision.**
- **DAT-045 - a truncation the connector cannot see.** _Rests on:_ case 7: an HTTP source that
  declares a `Content-Length` shorter than it sends yields a valid, shorter body with no error, and a
  CSV cut at a line break is a valid, shorter file. The statement stands; it cannot be met for such a
  body unless something outside its framing says how long it is. _Proposed:_ DAT-045 adds _"Where a
  source states a length, a digest or a row count apart from the message's own framing, the connector
  checks the result against it"_, and the gap for a source that states none is named in the design
  rather than claimed closed. **Proposed; for Ken's decision.**
- **DAT-050 and DAT-051 - a deadline, and a cancel that reaches the source.** _Rests on:_ case 7:
  `pg`'s `query_timeout` and a closed socket both left a Postgres statement running, `tedious`'s
  `requestTimeout` stops counting at the first packet, `fetch`'s body timeout is idle-based, and one
  value larger than the byte limit costs its whole size in the driver before any limit acts.
  _Proposed:_ DAT-050 adds _"A timeout is a deadline over the whole execution, and reaching any limit
  cancels the source's work; a single value larger than the byte limit fails it."_ DAT-051 holds as
  written: every limit was a named failure. **Proposed; for Ken's decision.**
- **DAT-052 and DAT-026 - how long a pass-through result may be cached.** _Rests on:_ case 4, section
  5: a key without the execution identity served Grace Ada's rows on all three connections, and a
  cached result went on returning a row the source had since reassigned, because nothing tells the
  product a permission changed. DAT-026 stands as written. _Proposed:_ DAT-052 adds _"A result
  obtained under end-user identity may be cached for no longer than the identity's own credential is
  valid, and never for longer than a stated maximum; the cache key must include the identity as the
  source sees it."_ **Proposed; for Ken's decision.**
- **DAT-056 - what authority means under asserted identity, and per process.** _Rests on:_ case 3,
  where asserted identity was the only database mechanism, the connection's account held every user's
  authority, a forgotten assertion was an empty result in three of five forms, and Postgres let the
  query text re-assert the identity; case 5's phase-2 finding 1, where a bound value handed on by the
  text moved the identity and a view in the source did it with no function in the text, so no rule
  over the text is complete; and case 2, where a process per execution cost 41 ms p50 against 5 ms for
  a warm one. _Proposed:_ _"A connector must run with no more authority than the connection it
  serves. Under asserted end-user identity, the connection's account holds no privilege on the data
  of its own; the assertion is one the query text cannot change, or, where the source lets the text
  change it, the text comes from a person trusted with every user's rows or is generated by the
  product, or the identity is established when the connection authenticates; and a connection that
  has carried a user's identity is reset, by a means shown to clear it, or discarded before it is
  reused."_ The same rewording should say whether one connector process may open more than one
  tenant's secrets, which the evidence prices and does not decide. **Proposed; for Ken's decision.**
- **IAM-067 - the bound, and the reason.** _Rests on:_ case 4, section 2: every publish stopped within
  50 ms of a sign-out with its statements cancelled at the source, but 30 of 30 jobs recorded the
  cancellation and none the sign-out, and once in 36 runs a binding that passed its session check at
  the instant of sign-out ran to completion. The statement stands. _Proposed:_ it adds _"The work it
  stops records the sign-out or the revocation as its reason."_ The stated bound is the design's: one
  execution's duration, unless checking the session and registering an execution are made one step.
  **Proposed; for Ken's decision.**

## Where the code is

`spikes/data-connectors/` - `compose.yaml` (the stack), `agent.mjs` (caller and connector),
`lib/guard.mjs` (the normalising SSRF guard), `lib/connect.mjs` (the drivers and the sealed-secret
open), `lib/seal.mjs` (the spike copy of the product's sealing), `case1.mjs`, `case2.mjs`,
`crashprobe.mjs`, and `README.md`. For cases 3 and 4: `idp.mjs`, `token-exchange.mjs` and
`fake-api.mjs` (the provider, the source's authorisation server and the source), `lib/identity.mjs`
(execution as the end user), `lib/service.mjs` (sessions, publish jobs, pins and the cache),
`init/*-phase2.sql`, `case3.mjs` and `case4.mjs`. For cases 5 to 7: `run.sh` (a case in a one-shot
container), `init/*-phase3.sql`, `lib/types.mjs` (the declared types and their canonical text),
`lib/params.mjs` (the declaration and the three binders), `lib/canon.mjs` (the canonical document and
checksum), `lib/xlsx-own.mjs` (the XLSX reader), `lib/fixtures.mjs` (case 6's result, CSV and
workbooks), `lib/limits.mjs` and `lib/bombs.mjs` (the limits, and the inputs that test them),
`fake-data-api.mjs`, and `case5.mjs` to `case7.mjs`. `case1.mjs`'s target and spelling lists,
`case2.mjs`'s failure modes, and `case5.mjs`'s hostile values and typed wrong values are the start of
the regression suite the brief (§10.3, DAT-021) asks the connectors to carry.
