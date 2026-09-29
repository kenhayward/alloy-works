# Data connector spike

> **Status: Brief; not yet run.** Findings go beside it, in `Data_Connector_Spike_Findings.md`, and
> are not edited afterwards. It runs before any of T2 is designed
> ([ADR-0033](../../decisions/0033-t2-is-the-data-spine.md)). It follows the shape of
> [`Publishing_Engine_Spike.md`](Publishing_Engine_Spike.md): hard cases, named gates, a written
> finding per case, and a decision record either way.

## 1. What this spike decides

T2 is the data spine: 109 rows, 54 of them **DAT**'s. Almost all of them are design, and are settled
by writing one. A few are not, because they turn on what a database driver, an HTTP source and a
spreadsheet actually do, and because a wrong answer is written into something that is expensive to
move:

- **Where a query runs is a container boundary.** Which process holds a tenant's source credential,
  and which network a query leaves from, is drawn once in [system.md](../../design/system.md); moving
  it once connectors exist moves every connector. It also decides whether the edge connector that
  [scope](../Project_Scope.md) §14 holds in reserve - "Customer data cannot leave the network" - is a
  deployment of the same interface or a second design.
- **Query definitions and provenance are stored for good.** A query definition is versioned like
  content (VER-057) and a provenance record is immutable (DAT-043). The parameter declaration, and the
  canonical form a result's checksum is taken over (DAT-040), are written into every version and
  every record, so a loose shape becomes a migration.
- **Running as the end user may change the session model.** The service keeps no token from a
  tenant's identity provider today; a session row holds a hash
  ([service-foundations.md](../../design/service-foundations.md)). If pass-through needs a user's
  delegated token when a publish runs, the product starts holding a new class of secret, per user.

So the question is not "which connectors", but:

> **Can a query reach a tenant's source without the connector becoming a route into our own network,
> run as the identity its connection declares - the end user's included - wherever and whenever it
> runs, and return a result that pins, checksums and fails the same way from a relational database,
> an HTTP endpoint and a file?**

A finding that one clause cannot be met for one connector type is a legitimate outcome, and the
likeliest one. Section 8 names the requirements such a finding would send back.

## 2. Candidates

### Where a query runs

| Placement                                     | Opens the source credential | Known strength                                                                  | Known doubt                                                                                                                                                               |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A - The service, inline**                   | The service                 | Simplest; the principal is at hand                                              | Every service instance is a route out, on the network beside the platform's database; a slow source holds a request open                                                  |
| **B - The worker, as a job**                  | The worker                  | Heavy and retried work already goes there                                       | The worker has no principal ([publishing.md](../../design/publishing.md)), so pass-through has nobody to run as; DAT-014's run against sample parameters waits on a queue |
| **C - A connector container**                 | Only the connector          | The boundary is a fact of the network rather than a check in code               | A container and a hop per query more; one process serving every tenant can open every tenant's secret, which DAT-056 may not allow                                        |
| **D - A connector in the customer's network** | The customer                | Answers scope §14's risk: the source never has to be reachable from our network | Not built here                                                                                                                                                            |

B shares A's place on the network, so case 1 covers it through A; what B adds is case 4's. D is not
built. What the spike establishes is whether C's interface - a connection, a query definition version,
parameter values and an identity in; a typed result or a named failure out - is one D could implement
unchanged, so that the edge connector stays a deployment rather than a redesign.

### What "as the end user" can mean

Scope §7.4 says the end user's identity is "passed through so that source-side row-level security
applies". DAT-008 says only "as the end user". There are three ways to do it, and they are not
equivalent:

| Mechanism                        | How the source knows the user                                                                           | Where it exists                                                                                                                                                                                                            | Known doubt                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Delegated token**              | A token issued for the user by a provider the source trusts, verified by the source                     | HTTP APIs, through OAuth 2.0 Token Exchange (RFC 8693) or Entra ID's on-behalf-of flow, a variant of its own; Azure SQL with Entra ID tokens; PostgreSQL 18's OAuth authentication, given a validator module on the server | Needs the user's token from the tenant's provider at the moment the query runs. The Google route (ADR-0009) yields no token a customer's source would trust              |
| **Asserted identity**            | The connection's own account tells the source who the user is, and the source applies its rules to them | PostgreSQL: `SET ROLE`, or a setting that row-level security policies read. SQL Server: `EXECUTE AS USER`, or `SESSION_CONTEXT` read by a security policy                                                                  | The source trusts us, not the user: the connection's account holds the union of every user's authority, which is hard to square with DAT-056                             |
| **A stored credential per user** | The user's own password or key for the source, held by us                                               | Anywhere                                                                                                                                                                                                                   | Makes the product a store of every user's password for every source, against the direction ADR-0009 and IAM-042 set. Recorded, not built, unless both of the others fail |

### The spike's sources

Two relational databases with different identity models, one HTTP API, and two file formats.

- **PostgreSQL** through `pg`, already in the workspace: roles, row-level security, `SET ROLE`.
- **SQL Server** through `tedious` (MIT, pure JavaScript): logins and database users, `EXECUTE AS`,
  `SESSION_CONTEXT` and security policies. The driver supports Entra ID tokens, which need Azure to
  exercise (section 7). The image is Microsoft's Developer edition, whose licence a person must accept
  before the stack runs; if it is not accepted, MySQL through `mysql2` stands in, and the finding says
  what that loses - MySQL has no row-level security, so asserted identity there is a view or a stored
  procedure.
- **An HTTP API**: a fake JSON API behind a bearer token, and a fake RFC 8693 token-exchange endpoint
  that trusts tokens from a stand-in identity provider.
- **Files**: CSV and XLSX, uploaded. The XLSX reader is a choice of its own among SheetJS Community
  Edition (Apache 2.0; current releases are published from its vendor's server, and the npm
  registry's copy is old), ExcelJS (MIT), and a reader of our own over `fflate`, which the workspace
  already carries for Word output.
- **Left untested, and said so:** MySQL and MariaDB unless standing in, Oracle, Snowflake, BigQuery,
  Databricks. They are what DAT-054 (T5) makes addable; the spike's two establish the interface, not
  the catalogue.

### Files: uploaded or referenced - settled by argument, not by a case

**Recommended: a file source in T2 is an uploaded file, held by hash in the tenant's object store**,
as an asset is. It is reproducible - a pin and its checksum name bytes we hold - it has no credential
and no egress, and "the source has moved" is a new upload. A file **at a remote location** -
SharePoint, an S3 bucket, a URL - is an HTTP connection whose response a file format reads, and needs
nothing beyond the two.

So "file" is a format, not a transport. The spike builds its connectors on that split - transports:
a database, HTTP, a stored object; formats: rows, JSON, CSV, XLSX - and the finding says whether it
held. It reshapes DAT-001 and DAT-002 (section 8).

## 3. Inputs, not questions

- **Tenant isolation at the data layer**: [ADR-0008](../../decisions/0008-schema-per-tenant-isolation.md),
  IAM-002 as system.md meets it, IAM-075, and IAM-066 - every cache and every second copy is the
  tenant's own.
- **The containers of [ADR-0019](../../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md)**,
  and **publishing decided at the request**: the worker has no principal and decides nothing
  (publishing.md, "Who may publish").
- **Sign-in as [ADR-0009](../../decisions/0009-federation-and-google-accounts-no-local-passwords.md)
  has it**: a tenant's own provider over OpenID Connect, or Google. The service checks the ID token,
  keeps a session and holds no provider token.
- **Secrets sealed to their tenant** with the service's sealing key, as the object store credential
  and the sign-in client secret already are (service-foundations.md).
- **[ADR-0007](../../decisions/0007-no-per-server-licensing-in-the-publishing-pipeline.md)'s reasons,
  applied to drivers.** By its letter the record covers the rendering path. Its reasons - self-hosting
  without a commercial negotiation, and a cost per tenant that carries no licence - apply to anything
  a connector ships, so a driver or reader must be open-source, install from the npm registry under
  the frozen lock file, and carry no per-server licence. The decision record says whether ADR-0007 is
  extended or a record of its own states it.
- **The constraints that hold in every tranche**: DAT-003 and DAT-004 (a credential is write-only);
  DAT-017 and DAT-018 (a parameter is bound, and cannot change a query's shape); DAT-026 (a result
  cached under one user's identity is never served to another); DAT-045 and DAT-046 (no truncated
  result and no placeholder is published); DAT-056 (a connector runs with no more authority than its
  connection); IAM-064 (a cached assertion never outlives its session); IAM-067 (a revocation stops
  data flowing on a connection already open).
- **DAT-052's default**: nothing is cached unless a query definition declares it.

## 4. The cases

Each case is built against the spike's sources and written up: pass, pass with cost, or fail, with
the cost named. Four are **gates**: each is where the answer is written into a container boundary, a
secret the product holds, or a stored shape, and a gate failure is the finding that sends a
placement or a requirement back.

### Case 1 - The connector is not a route into the platform _(gate)_

A tenant administrator configures a connection, and a connection names a host. Pointed at the
platform, it is server-side request forgery.

- **Builds:** placements A and C - a caller reaching sources itself, and a connector container on a
  network of its own - with the same hostile connections run through both.
- **Tests:** an HTTP connection and a database connection each pointed at the platform's Postgres, the
  object store, the caller's own ports, the identity provider, the connector's own loopback, and a
  stand-in cloud metadata endpoint (at `169.254.169.254` where Docker will route it, otherwise at an
  address the harness declares as the metadata address); the same addresses spelled otherwise -
  decimal and octal IPv4, IPv4-mapped IPv6, a trailing dot; a redirect from an allowed host to a denied
  one; a name that resolves to an allowed address when checked and a denied one when connected (DNS
  rebinding); and connection options that reach the connector's own machine rather than a host - a
  Unix socket path, a certificate or password file path.
- **And DAT-006's test as an oracle.** A connection test reports success or a reason. If the reason
  tells a refused port from a filtered one or an unknown host on a denied address, an administrator
  can map our network with it.
- **And the other direction.** Most customer sources are on private addresses, so a deny list of every
  private range is not an answer: it denies the customer too. A source on a private address the tenant
  declares must still answer.
- **Pass:** every hostile connection fails, identically, with a reason that names no internal address,
  enforced where a mistake in the connector's code cannot undo it - the network, not only a check
  before connecting - while the tenant's private source still answers. The finding names the placement
  that passes, what enforces it, and what production must provide that compose can only imitate.

### Case 2 - The secret opens in one place, and never comes back out

- **Builds:** a connection's credential sealed as the platform's other secrets are, and opened only in
  the process that runs the query.
- **Tests:** DAT-005 on every path the harness has - each container's log, an error returned to the
  caller, DAT-006's test result, a crash (an uncaught exception, and a killed process with its
  report), and the job row - with each driver made to fail every way it can: a wrong password, an
  unknown host, a TLS failure, a timeout, a malformed connection string. Drivers and HTTP clients are
  known to put connection strings and URLs, query strings included, into their errors; the test
  searches every byte written for the secret, raw, URL-encoded and in base64.
- **And DAT-056.** One connector process serving every tenant can open every tenant's secret. The
  spike measures the alternative - a process per execution, handed its own connection's secret and
  nothing else - so the design chooses against a number (section 6).
- **Pass:** no path carries the secret in any encoding, and the processes able to open a source
  credential are named: one kind, if it can be done.

### Case 3 - As the end user, per connector type _(gate)_

DAT-008 lets a connection authenticate as the end user, DAT-022 makes which identity is in force
visible, and DAT-023 says the source's own access rules then apply, so two users of one document may
see different results.

- **Builds:** one table, and one API resource, whose rows the source shows per user by its own rule -
  row-level security in Postgres, a security policy in SQL Server, a scope check in the fake API - and
  two invented users, Ada and Grace, who see different rows.
- **Tests:** each mechanism of section 2 against each source it applies to - a delegated token for the
  HTTP API, exchanged from the stand-in provider's token; asserted identity for both databases; and
  PostgreSQL 18's OAuth authentication if `pg` can present a bearer token to it, recorded untested if
  it cannot. For an uploaded file, what "as the end user" could mean at all.
- **Pass:** for each connector type, a written answer - which mechanism, what the source must be
  configured to do, and what the connection must declare - with Ada and Grace each shown their own rows
  through the connector and never the other's.

**The expected finding** is that pass-through is real for HTTP through token exchange; real for a
database as asserted identity, and as a delegated token only where the database trusts the tenant's
provider; and meaningless for an uploaded file. That finding is set up to send DAT-008 and DAT-023
back (section 8), not to be absorbed.

### Case 4 - The end user's identity, later and elsewhere _(gate)_

Case 3 runs a query while the user is at the screen. Most executions are not like that: a publish
runs in a worker, a baseline pins every binding (DAT-038), a refresh comes later, and a pinned value
is read by somebody else.

1. **A publish with pass-through bindings.** Where the publisher's identity is when each query runs:
   resolved at the request in the service, as publishing.md already decides permission there; or
   carried to the worker as a delegated, short-lived, audience-restricted token, sealed and held in the
   tenant's schema rather than in the platform's queue; or not at all, so that a pass-through binding
   must be pinned before a publish and cannot be live in one. Measured: how long each keeps a request
   or a token alive for a document of realistic size (section 6).
2. **Sign-out mid-publish.** Ada signs out, or her session is revoked, while her publish is running
   pass-through queries. IAM-064 and IAM-067 require the rest to stop, promptly and by name. Tested
   for each option in 1.
3. **A token that expires.** Whether finishing a long publish needs a refresh token from the tenant's
   provider (`offline_access`, sealed per user) - a secret the session model does not hold today.
4. **A pin read by another.** Ada pins a value Grace's rules would hide from her, and Grace opens the
   document. DAT-024 requires the pin to record whose view produced it, and the document to be able to
   show that; the test shows both. Whether Grace may see the value at all is DAT-Q03, a decision with
   **IAM**, and not this spike's.
5. **The cache.** Grace asks for a result cached for Ada, by the same query definition version and
   parameters (DAT-026). What the key must hold - the tenant, the connection, the query definition
   version, the canonical parameters, and the execution identity as the source sees it - and whether a
   pass-through result can honestly be cached for longer than the user's source-side permissions stay
   the same. Where the cache lives follows from IAM-075 and is not a question: a table in the tenant's
   schema, never an in-process map shared across users.

- **Pass:** each of 1 to 5 has an answer that holds IAM-064 and DAT-026 without exception, and the
  answer to 1 says whether the product holds a user's delegated token, for how long, and where. A
  publish that cannot run pass-through queries and refuses them by name is a pass with cost, stated.

### Case 5 - One parameter declaration, three encodings

DAT-010 declares each parameter's name, type, whether it is required and its permitted values; DAT-017
binds it; DAT-018 forbids it to change the query's shape; DAT-019 allows a declared variation chosen
from a list; DAT-020 validates every value before the query runs; DAT-021 attempts injection through
every type.

- **Builds:** one declaration - text, integer, decimal, date, instant, boolean, a value from a list,
  and a list of values - bound three ways: as the driver's parameters in SQL; into an HTTP request's
  path segment, query string and JSON body by a builder, never by splicing text; and as filters a
  file source applies to its own rows, since a file has no engine to bind into. A variation, such as a
  sort column, is a key choosing among fixed fragments of text the query definition declares.
- **Tests:** injection through every type in every position - SQL metacharacters; a path segment
  carrying `..` or an encoded slash; a value that closes a JSON string; a query-string value carrying
  `&` and `=`; a value bound into a `LIKE` pattern bringing its own wildcards; a list of values where
  the driver has no array parameter (SQL Server); a variation key not in the list; and a value of the
  wrong type, out of range or missing, each of which must be DAT-020's named error rather than an empty
  result.
- **Pass:** every attempt is refused or bound inert by construction, not by escaping. One declaration
  shape serves all three, or the finding names what each type needs of its own, and whether that is a
  variant of one stored shape or three.

### Case 6 - A typed result, pinned and checksummed the same way every time _(gate)_

DAT-011 declares a result's columns and types, DAT-012 its key, DAT-035 stores a pinned value with its
provenance, DAT-040 records a checksum of the result, DAT-043 makes that record immutable, and
STY-014 formats a column by its declared type. Whatever canonical form the checksum is taken over is
written into every provenance record for good.

- **Builds:** one logical result - a key, a decimal of 28 digits, a 64-bit integer, a currency amount,
  a date, a local date-time, an instant with a zone, a boolean, a null, an empty string, and text in a
  second script - from every source: Postgres, SQL Server, JSON over HTTP, CSV, and XLSX. The workbook
  carries a date stored as a serial number, a sheet in the 1904 date system, a number formatted as a
  percentage, a formula with a cached value, and an empty cell beside a cell holding an empty string.
- **Tests:** what each driver or reader hands back before we touch it - `pg` gives 64-bit integers and
  decimals as strings and timestamps as JavaScript dates in the process's zone; `tedious` is reported
  to give decimals as JavaScript numbers; `JSON.parse` makes every number a double; CSV has neither
  types nor a null - and whether each can reach one canonical form per declared type with nothing
  lost. Then the checksum: the same result twice, from a restarted process in another time zone, and
  from a query with no stated order.
- **Pass:** one canonical serialisation per declared type - the brief expects a decimal as a
  normalised decimal string, an instant in UTC at a declared precision, a local date and a local
  date-time as themselves, a null distinct from an empty string, rows in the query's order and columns
  in the declared order, hashed with SHA-256 over canonical JSON (RFC 8785) - under which every source's
  result for the same data checksums identically, and every loss a source imposes is named and refused
  rather than rounded.

A result with no stated order may checksum differently from run to run, and a refreshable binding
would then be flagged as moved (DAT-036) when nothing moved. The finding says whether a stated order,
or a key, must be required of every query definition that feeds a pin.

### Case 7 - Limits that fail rather than truncate

DAT-050 declares a row limit, a size limit and a timeout; DAT-051 makes exceeding any of them a named
failure; DAT-045 forbids publishing a truncated result.

- **Tests, per source:** a query returning one row more than its limit, found by fetching the limit
  plus one from a cursor rather than by rewriting the query; a result over its byte limit, counted as
  rows arrive; a query that runs past its timeout, and whether the source actually stops - the cancel
  reaching Postgres and SQL Server, seen in each server's own list of running statements - rather than
  running on after we have given up; an HTTP body longer than its `Content-Length` said, compressed to
  expand past the limit, or sent a byte at a time; a CSV with one enormous line; an XLSX that is a zip
  bomb, or whose shared strings dwarf its cells.
- **Pass:** every limit is a named failure, reached with memory bounded by the limit rather than by
  the input, and the source's work is cancelled. Where a reader cannot stream - an XLSX reader that
  loads a whole workbook - the finding says what bounds its memory instead.

## 5. Scoring

| Cases          | Role        | Rule                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1, 3, 4, 6** | Gates       | A failure is a finding, not a defect to absorb. Case 1 failing for every placement sends the answer to placement D or to a network production must supply; case 3 or 4 failing for a connector type sends DAT-008, DAT-023 or DAT-038 back for that type; case 6 failing names a declared type the product cannot pin faithfully from that source |
| **2, 5, 7**    | Correctness | May pass with work. Record the cost                                                                                                                                                                                                                                                                                                               |

The gates are the four places where an answer becomes permanent: a container boundary, a secret the
session model holds, and a stored shape of provenance. The rest can be corrected in a later
tranche's code.

## 6. What is measured, and how

**The corpus sets no performance budget for running a query**, while a live binding resolves on every
view (scope §6). That absence is a finding for T2's design to answer. The spike records numbers for a
budget to be set against; it does not pass or fail on them.

| Quantity                            | How                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The cost of the boundary            | A one-row query run by the caller itself (A) and through the connector (C): p50 and p95 over 1,000 runs                             |
| The cost of a process per execution | Starting a process handed one connection's secret, connecting and running a one-row query, against a pooled long-lived process      |
| Holding a publisher's identity      | Wall-clock time to resolve 400 pass-through inline bindings and 40 block bindings at a request, against a source with a set latency |
| Cancellation                        | From a limit being hit to the statement leaving the source's list of running statements                                             |
| Memory at the limit                 | Peak resident memory reading a CSV and an XLSX at the byte limit, and at ten times it                                               |
| Checksum stability                  | The same data's checksum over 100 runs, two process time zones and a restart                                                        |

Every number is a proxy: containers on one machine, no real network latency, no load on the source.
The findings say what would verify each, as the other spikes' findings do. The numbers are taken on
Linux, in containers, as CI runs.

## 7. What cannot be tested locally, and stays a claim

- **Entra ID tokens against Azure SQL**, or against SQL Server 2022 enabled through Azure Arc, and
  **Entra ID's on-behalf-of flow**, which is not RFC 8693. The fake exchange endpoint covers RFC 8693
  only.
- **Kerberos constrained delegation** to an on-premises SQL Server - how Windows-integrated sources
  pass a user through, and probably what a customer's on-premises database expects. It needs a domain.
  It is also the likeliest reason an on-premises customer needs placement D.
- **A real cloud's network**: its metadata endpoint, its egress controls, a private link into a
  customer's network. Compose imitates them with networks and a stand-in address; what production must
  provide is written as a requirement on hosting, which is still open (scope §10).
- **SharePoint, Microsoft Graph and cloud object stores** as remote file locations: argued in section
  2 to be HTTP connections, and not built.
- **PostgreSQL 18's OAuth authentication**, if no validator module can be built into the stack within
  the time box.

## 8. Requirements the spike may send back

Each row names a doubt the brief already has, and the finding that would turn it into a proposed
change. The spike edits no requirement: a finding goes to Ken, and a change lands through the
requirements process, with a new identifier where it is material.

| Requirement              | The doubt                                                                                                                                                                                              | The finding that sends it back                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DAT-008**, **DAT-023** | "As the end user" is three mechanisms with different guarantees. For an uploaded file it means nothing; for most databases it means asserted identity, where the source trusts us rather than the user | Case 3 shows a connector type with no delegated mechanism. Then DAT-008 declares which mechanism, and DAT-023 holds only where the connector declares one - which pulls DAT-055's pass-through capability (T5) forward into T2 |
| **DAT-008**              | The Google route yields no token a customer's source trusts                                                                                                                                            | Case 3 confirms it. Then the end-user mode is available only to a tenant signing in through its own provider, and DAT-008 says so                                                                                              |
| **DAT-038**, **DAT-024** | A baseline pins every binding, pass-through ones included, under the view of whoever made it, and every reader of what it published then sees that view                                                | Case 4 shows no identity to publish under but the publisher's. Then DAT-038 states whose view a baseline pins, and DAT-Q03 is answered before T2's design rather than during it                                                |
| **DAT-056**              | Asserted identity gives a connection's account every user's authority by construction, and one connector process serving every tenant can open every tenant's secret                                   | Case 2's cost of isolation is unaffordable, or case 3 finds asserted identity the only database mechanism. Then DAT-056 says what authority means under asserted identity, or asserted identity is refused                     |
| **DAT-001**, **DAT-002** | An uploaded file is not "a route to one source system"                                                                                                                                                 | The transport and format split of section 2 holds. Then DAT-002's file-based source is a format read from an uploaded file or from an HTTP connection                                                                          |
| **DAT-017**              | "Passed to the source as a bound value": a file has no engine to bind into, and HTTP has no binding interface                                                                                          | Case 5 binds HTTP by a builder and filters files ourselves. Then DAT-017 is read per connector type, or restated as "never spliced into query text"                                                                            |
| **DAT-040**, **DAT-036** | A checksum over a result with no stated order is unstable, and flags as moved a source that has not                                                                                                    | Case 6 shows it. Then DAT-011 or DAT-012 requires a stated order, or a key, of a query definition that feeds a pin                                                                                                             |
| **DAT-052**, **DAT-026** | A pass-through result cached for its declared lifetime may outlive the user's source-side permission                                                                                                   | Case 4 finds no way to learn of that change. Then a pass-through result's cache lifetime is capped, or pass-through results are not cached                                                                                     |

## 9. What the spike does not decide

- **Hosting** (scope §10), and placement D beyond whether C's interface would serve it.
- **The open questions DAT names** besides what case 4 touches: DAT-Q01 charts, DAT-Q02 change
  detection (DAT-073, T5), DAT-Q03 who may see a pinned value, DAT-Q04 composing queries, DAT-Q05 what
  a publication shows of a revision, and DAT-Q06 with DAT-071's aggregate limit (T3).
- **Connector extensibility** (DAT-054, DAT-055, T5). The interface case 1 settles is the one it
  would open, but packaging, discovery and somebody else's connector are not built.
- **The rest of the spine, which is design**: binding modes, revisions, provenance's inspection,
  where-used, the permission to use a connection (DAT-025, IAM-020), a template's parameters (**TPL**)
  and tabular presentation (**TAB**, STY-014) beyond case 6 giving it types to format.
- **What an author writes**: whether a query definition is SQL text, a builder, or both, and the
  editor for it.
- **The catalogue of databases** beyond the two the spike runs.

## 10. What the spike produces

1. **A throwaway harness in [`/spikes/data-connectors/`](../../../spikes/)**, labelled throwaway,
   outside the pnpm workspace and CI, so nobody promotes a scaffold into the product because it was
   already there.
2. **A worked artifact per case**, as a test where a test can express it, and **a written finding**
   per case: pass, pass with cost, or fail, with the cost named. A case that cannot be settled in the
   time box is recorded unsettled; the spike does not expand to fix what it finds.
3. **Case 1's hostile connections and case 5's injection attempts as lists**, to become the
   connectors' regression suite - DAT-021 asks for exactly that.
4. **A recommendation**: the placement, the pass-through mechanism per connector type, the parameter
   declaration, and the canonical form of a result and its checksum.
5. **The requirements section 8 would send back**, each with its finding, for Ken to decide.
6. **A decision record, either way**, at the next free number: where connectors run and which process
   opens a source credential, as whom a query may run, and the canonical form of a pinned result -
   with whether ADR-0007's rule extends to drivers.

## 11. The stack

`spikes/data-connectors/compose.yaml`, project `aw-data-connectors`, every port on `127.0.0.1` and
none of the development stack's. Nothing in it is the product's service or worker.

| Network               | Holds                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aw-dc-platform`      | A Postgres standing for the platform's, a SeaweedFS, the caller (placement A), the stand-in identity provider, and the stand-in metadata endpoint                                   |
| `aw-dc-sources`       | PostgreSQL 18 with row-level security, SQL Server Developer edition (or MySQL standing in), the fake JSON API, the fake token-exchange endpoint, and a resolver that rebinds a name |
| `aw-dc-connector-rpc` | The caller and the connector (placement C), and nothing else                                                                                                                        |

The connector sits on `aw-dc-sources` and `aw-dc-connector-rpc` only. Which of the platform's
addresses it can reach, and how it would reach a customer's private address in production, is case
1's finding, not the stack's assumption.

## 12. Time box, and what it unblocks

**Five working days.** A case not settled by then is recorded unsettled with what would settle it;
the time box is what stops the spike becoming the connector.

It unblocks **T2's design**: the connection, the query definition and the execution identity, the
container system.md gains or does not, and the stored shapes of a query definition and a provenance
record. Scope §14's "Customer data cannot leave the network" is not answered by it, but it will know
whether answering that later is a deployment or a redesign.
