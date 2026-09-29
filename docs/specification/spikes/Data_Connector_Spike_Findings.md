# Data connector spike - findings

> **Status: Draft: cases 1 and 2 run; cases 3 to 7 to come.** These findings sit beside the brief
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
> it is a finding *for* the design, not against it.

## Verdicts

| Case                                            | Role        | Verdict                                                                                       |
| ----------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| **1** - The connector is not a route in         | Gate        | **Pass for placement C, with a named condition; fail for placement A on its own**             |
| **2** - The secret opens in one place           | Correctness | **Pass with cost** - no path leaks the secret except the query-string transport, which is refused by design |

Cases 3 to 7 have not run. The stack they need is up and answering (the sources, the stand-in
identity provider, the token-exchange endpoint, and Ada/Grace with row-level security are all in
place), so a later phase can start against it directly.

---

## Case 1 - The connector is not a route into the platform _(gate)_

**What was run.** The same `agent.mjs` runs as two containers: the **caller** (placement A) on all
three networks including the platform's, and the **connector** (placement C) on the sources and
connector-rpc networks only. Both use an identical code guard. `case1.mjs` drove five families of
test from the host against each placement's control API.

### A. Raw network reachability (guard off) - the decisive measurement

From each placement, a raw TCP connect to each platform target and to the tenant's own private source.

| Target (guard off)                    | From A/caller | From C/connector |
| ------------------------------------- | ------------- | ---------------- |
| platform Postgres `172.31.10.11:5432` | connected 0ms | **timeout 2503ms** |
| object store `172.31.10.12:8333`      | connected 0ms | **timeout 2501ms** |
| cloud metadata `172.31.10.13:80`      | connected 1ms | **timeout 2501ms** |
| identity provider `172.31.10.14:80`   | connected 0ms | **timeout 2501ms** |
| caller's own control port `:8080`     | connected 0ms | **timeout 2502ms** |
| tenant private source `172.31.20.21`  | connected 0ms | connected 0ms    |

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

| Host as written                          | Guard verdict | Resolved to    |
| ---------------------------------------- | ------------- | -------------- |
| `172.31.10.11` (canonical)               | DENY platform | 172.31.10.11   |
| `2887715339` (decimal)                   | DENY platform | 172.31.10.11   |
| `0254.037.012.013` (octal)               | DENY platform | 172.31.10.11   |
| `::ffff:172.31.10.11` (IPv4-mapped IPv6) | DENY platform | 172.31.10.11   |
| `172.31.10.11.` (trailing dot)           | DENY platform | 172.31.10.11   |
| `127.0.0.1` / decimal / octal / mapped   | DENY loopback | 127.0.0.1      |
| `/var/run/postgresql` (unix socket path) | DENY (unresolvable) | -        |
| `/etc/ssl/private/source.key` (file path)| DENY (unresolvable) | -        |
| `172.31.20.21` (tenant private source)   | **ALLOW**     | 172.31.20.21   |

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

| Source     | Failure modes exercised                                                       | Raw-driver-error leaks | Caller-facing leaks |
| ---------- | ----------------------------------------------------------------------------- | ---------------------- | ------------------- |
| PostgreSQL | wrong password, unknown host, TLS-required, timeout, malformed conn-string    | 0 / 5                  | 0 / 5               |
| SQL Server | wrong password, unknown host, TLS failure, timeout                            | 0 / 4                  | 0 / 4               |
| HTTP       | wrong bearer (401), unknown host, TLS failure, **token in query string**      | 0 / 4                  | **1 / 4**           |

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

| Shape                                                              | One-row query, p50 | p95   |
| ----------------------------------------------------------------- | ------------------ | ----- |
| Warm process, new connection per call (incl. host HTTP round-trip)| 5.0 ms             | 6.2 ms |
| **Fresh process per execution** (startup + open + connect + query)| **41 ms**          | 43 ms  |

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

## What is a proxy, and what is verified

- **Verified on this stack:** the reachability contrast between A and C; the guard's handling of every
  spelling; the redirect exfiltration and its block on C; the rebinding flip and its block on C; the
  absence of the secret on every searched path including a real crash dump.
- **A proxy:** the timing numbers (one machine, no network latency, Node not a pooled worker); the
  "job row" and "crash report" paths (stood in for by the raw driver error and a real uncaught-exception
  stderr dump - the product has no job store yet to write into); the sealing key travelling in the
  request rather than living in the process (a harness simplification - it does not affect the leak
  search, which is over what the drivers emit).
- **Environment-specific:** the published-port leak is a Docker Desktop property, called out as a
  requirement on production rather than a defect. The other spikes' numbers are taken on Linux CI;
  these were taken on Docker Desktop for Windows, and case 1's network results should be reconfirmed
  on the Linux runner before the decision record rests on them.

## Requirements the spike may send back so far

Only the rows section 8 of the brief lists that cases 1 and 2 touch. None is decided; each is a
finding for Ken, to land through the requirements process.

- **DAT-056 (and the placement decision).** Case 1 makes the network the boundary (placement C), and
  case 2 measures the cost of the per-process isolation DAT-056 may demand (~40 ms/query). The pair
  points at stating, in DAT-056, whether one connector process may serve many tenants (opening every
  secret it is handed) or must be one-secret-per-process. Not yet answerable - it waits on case 3
  (whether asserted identity is the only database mechanism) before the trade-off is complete.
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
`crashprobe.mjs`, and `README.md`. `case1.mjs`'s target and spelling lists, and `case2.mjs`'s failure
modes, are the start of the regression suite the brief (§10.3, DAT-021) asks the connectors to carry.
