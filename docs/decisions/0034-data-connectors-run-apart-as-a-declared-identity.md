# 0034 - Data connectors run apart, as a declared identity, and pin a canonical result

- **Status:** Proposed
- **Date:** 2026-09-30

## Context

[ADR-0033](0033-t2-is-the-data-spine.md) made T2 the data spine: connections to a tenant's own
systems, query definitions, parameters, bindings and their provenance. Most of it is design. Three
parts are not, because each is written into something expensive to move:

- **Where a query runs is a container boundary.** Which process opens a tenant's source credential,
  and which network a query leaves from, is drawn once in [system.md](../design/system.md). A
  connection names a host a tenant administrator chose, so pointed at the platform it is server-side
  request forgery.
- **Running as the end user may change the session model.** The service holds no token from a
  tenant's identity provider today ([ADR-0009](0009-federation-and-google-accounts-no-local-passwords.md),
  [service-foundations.md](../design/service-foundations.md)). A publish runs in a worker, which has
  no principal.
- **A query definition and a provenance record are stored for good** (VER-057, DAT-043). The
  parameter declaration, and the canonical form a result's checksum is taken over (DAT-040), are
  written into every version and every record.

[`Data_Connector_Spike.md`](../specification/spikes/Data_Connector_Spike.md) set seven cases, four of
them gates, against PostgreSQL 18 through `pg`, SQL Server 2022 through `tedious`, a JSON API behind a
bearer token and an RFC 8693 token exchange, and uploaded CSV and XLSX files. The findings are in
[`Data_Connector_Spike_Findings.md`](../specification/spikes/Data_Connector_Spike_Findings.md). In
short:

- **Case 1 (gate): pass for a connector container on its own network; fail for the caller reaching
  sources itself.** From the caller, every platform service was reachable and only code stood between
  a hostile connection and the platform: a redirect to the stand-in metadata endpoint returned its
  credential, and a DNS rebind reached the platform's Postgres, past a guard that approved both. From
  the connector, on a network with no route to the platform, every one of them timed out while the
  tenant's private source answered. One condition: on Docker Desktop, a platform port published to the
  host was reachable from the connector's network through the host.
- **Case 2: pass with cost.** The secret, sealed and opened only in the connector, appeared in no
  error, log, connection test or crash dump, raw, URL-encoded or base64 - except when put in an HTTP
  query string, where it rode the URL. A process per execution, handed one secret, cost 41 ms p50
  against 5 ms for a warm process.
- **Case 3 (gate): pass for HTTP by a delegated token; pass with cost for both databases, by asserted
  identity only; meaningless for an uploaded file.** Under asserted identity the source trusts the
  connection's account, which holds every user's authority; a forgotten assertion was an empty result,
  not an error, in three forms of five; and in PostgreSQL the query text could re-assert the identity,
  even as one bound statement through `set_config()`, and a view could do it for the text. SQL Server
  has assertions the text cannot undo. `pg` has no `OAUTHBEARER`, so PostgreSQL 18's OAuth route was
  not reachable. The exchange refused a token from the Google route; asserted identity served that
  user.
- **Case 4 (gate): pass with cost.** A worker's publish ran 440 pass-through bindings carrying only
  the principal's name for asserted identity, and the user's access token, sealed beside the job, for
  a delegated one; finishing past the token's expiry needed a refresh token held per session, and a
  lock, without which a rotating provider revoked the user's whole token family. Sign-out stopped
  every publish within 50 ms with the source's statements cancelled. Left open by the harness: the
  job's sealed token outlived the job, the connector's cache of exchanged tokens outlived sign-out,
  the job recorded the cancellation rather than the sign-out, and once in 36 runs one binding ran on.
  A cache keyed without the identity served Grace Ada's rows; one keyed with it went on serving a row
  the source had since reassigned.
- **Case 5: pass with cost.** One declaration shape, bound three ways, took 3,792 hostile and
  ill-typed values: 2,814 refused by name, 951 bound inert, none changing a statement's shape. The 22
  that behaved differently from the value read as data were interpreted after binding - `LIKE`, a
  collation, `STRING_SPLIT`, HTTP's whitespace - and `tedious`'s native decimal and instant types lost
  digits.
- **Case 6 (gate): pass, with named refusals.** One canonical form gave one checksum from ten
  source-and-reader paths in four time zones, and every loss a driver or format imposes was refused by
  name. With no total order, a refresh of unchanged data was flagged moved in 19 of 19 refreshes in
  PostgreSQL and 16 of 19 in SQL Server.
- **Case 7: pass with cost.** Every limit was a named failure with memory bounded, but neither
  driver's own timeout stopped the statement at the source, and neither XLSX library bounded what it
  inflated; one returned an empty sheet for a workbook too large for it, without an error.

## Decision

**A query runs in a connector container, on a network of its own with no route to the platform, as
the identity its connection declares by a named mechanism, and returns a result in one canonical form
that is checksummed, or a named failure.**

### Placement

- **Queries run in a separate connector container (placement C), on its own network, with no route
  to the platform's services.** The service and the worker never reach a source themselves; they ask
  the connector. The boundary is the network, because case 1 showed code alone one mistake from a
  route in, three ways.
- **The connector's interface is: a connection, a query definition version, parameter values and an
  execution identity in; a typed result or a named failure out.** An edge connector in the customer's
  network (placement D, scope section 14) can implement that interface later, so answering "customer
  data cannot leave the network" is a deployment, not a redesign. It is not built.
- **The guard stays, as defence in depth, not as the boundary.** It normalises a host to what the OS
  will dial - decimal, octal, IPv4-mapped IPv6 and a trailing dot included - before checking it;
  denies loopback, link-local and the platform's declared addresses while allowing the tenant's
  declared private sources; refuses connection options that name a local path (a socket, a key file);
  resolves once and connects to the address it checked; and follows no redirect across hosts.
- **Production must guarantee the connector's network has no route to any platform service,
  including through a host that publishes a platform port.** The spike measured the boundary on Docker
  Desktop for Windows, not Linux, and found the published-port leak there. Production's isolation is
  verified on production's own platform before connectors ship; it is a requirement on hosting, which
  is still open.

### Credentials

- **A source credential is sealed to its tenant and purpose as the platform's other secrets are, and
  opened only in the connector**, for the execution that needs it, and dropped. No other kind of
  process opens one.
- **An HTTP source's secret goes in a header, never in the URL, and no code path logs or returns a
  source request's URL.**
- **The connection test (DAT-006) gives one reason for every failure**, naming no address: a refused
  port, a filtered one, an unknown host, a guarded address and a wrong password read the same.

### End-user identity

**"As the end user" is one of two named mechanisms, and a connection declares which.**

- **A delegated token**, by RFC 8693 token exchange: the connector exchanges the user's token from the
  tenant's provider for one the source trusts, naming the connector as the actor. It is available only
  to a user signed in through the tenant's own provider: not through the Google route
  ([ADR-0009](0009-federation-and-google-accounts-no-local-passwords.md)), whose token no customer's
  exchange trusts, and not through a personal API token, which has no provider token behind it.
- **Asserted identity**: the connection's own account tells the source who the user is. It admits any
  principal, so a connection's mechanism decides which sign-in routes can use it. It holds only under
  these rules:
  - **The connection's account holds no privilege on the data of its own**, so a forgotten assertion
    fails loud rather than returning nothing. In PostgreSQL, role membership is granted
    `WITH INHERIT FALSE, SET TRUE`, and the assertion is `SET LOCAL ROLE` inside a transaction the
    connector opens and ends. In SQL Server, `EXECUTE AS USER ... WITH COOKIE` against grants made to
    the users only. Where the source cannot fail loud (a `SESSION_CONTEXT` key read by a security
    policy), the connector refuses to run an end-user query it has not asserted for. The connection
    test checks the account's own privilege where the source can say.
  - **The assertion is one the query text cannot change**: SQL Server's `SESSION_CONTEXT` set
    `read_only`, or `EXECUTE AS ... WITH COOKIE` with the connector holding the cookie. **Where the
    source has none, as PostgreSQL has none, the query text must be generated by the product or written
    by a person already trusted with every user's rows**; no rule over the text is complete, because a
    view or a function in the source can change the setting for it. Identity established when the
    connection authenticates would remove the condition and is not built.
  - **A connection that carried a user's identity is reset, by a means shown to clear it, or
    discarded, before it is reused.** Neither `pg.Pool` nor `mssql`'s pool resets a connection; where a
    reset is not shown to clear the identity - a `NO REVERT` context, a `read_only` key - the
    connection is closed. That a reset clears it is a documented claim here, not a tested one.
- **Pass-through means nothing for an uploaded file**: there is no source to present an identity to.
  A file connection declares no end-user mode.
- **Delegated tokens into a database** - Azure SQL with Entra ID, PostgreSQL 18's OAuth - and Kerberos
  constrained delegation are not decided here; neither could be run.

### Publishing with pass-through bindings

- **A publish runs its pass-through bindings in the worker**, not held open at the request, which
  made the request as slow as the slowest source (11 to 14 s for 440 bindings at 20 ms, one at a
  time).
- **What the worker holds:** for asserted identity, the principal's name, which the job already
  carries. For a delegated token, the user's access token, sealed in the tenant's schema beside the
  job, never in a queue, and **deleted when the job ends**, whichever way it ends. Where a publish may
  outlast the access token, a **refresh token** (`offline_access`) held sealed per session for the
  session's life, deleted and revoked at the provider on sign-out. This is a new class of secret, per
  user, that the session model does not hold today.
- **A refresh runs under a per-session lock**, and a second job of the session uses the access token
  the first obtained.
- **Sign-out or revocation stops the publish with a named reason**: the job records the session's end
  as its failure, and the cancelled queries as its consequence. Checking the session and registering
  an execution are one step, so no execution starts unseen after a sign-out; the bound IAM-067 asks
  to be stated is set by the T2 design against that.
- **The connector's cache of exchanged tokens is keyed to the session and purged with it**, or not
  kept. A delegated token that has already left the product's custody cannot be recalled; only its
  lifetime, which the tenant's provider sets, bounds it.
- **Where the identity cannot travel** - a session with no provider token, the Google route or an API
  token against a delegated connection - the publish is refused by name before any job exists, and the
  bindings must be pinned first.

### The cache

- **The key holds the tenant, the connection and its version, the query definition version, the
  canonical parameters, and the execution identity as the source sees it** (`asserted:<principal>`,
  `delegated:<issuer>|<subject>`). The cache is a table in the tenant's schema, tied to the session
  that filled it.
- **A pass-through result's lifetime is capped by its credential's and by a stated maximum**, because
  the product cannot learn that a user's permission at the source has changed. For asserted identity
  the stated maximum is the only cap. Its value is the T2 design's.

### The canonical result and its checksum

- **One document per result**: the declared columns as `[name, base type]` pairs in declared order,
  and the rows. **Every cell is a JSON string, a JSON boolean or `null`; there are no JSON numbers.**
- **By type:** an integer is base-10 text with no leading zeros; a decimal is base-10 text with no
  exponent, no leading zeros, no trailing fractional zeros, no point when whole and `-0` as `0`,
  within its declared precision and scale; a date is `YYYY-MM-DD`; a time and a local date-time are
  themselves, with no zone; an instant is converted exactly to UTC and ends in `Z`, its fraction
  carried as digits, never through a JavaScript `Date`, with trailing zeros stripped, within its
  declared precision; an offset is not kept. Null and the empty string differ. Text is its code
  points, unnormalised. A value a source cannot deliver exactly in its declared type is refused by
  name (`precision_lost`, `precision_not_carried`, `zone_missing`, `nonexistent_date`, `cell_error`),
  never rounded.
- **Rows are hashed in the query's stated order where that order is total, covering the declared key;
  otherwise as a multiset**, sorted by each row's canonical text.
- **The document is serialised as RFC 8785 canonical JSON and hashed with SHA-256**, and the form's
  version (`canonical: 1`) is recorded in the provenance record beside the checksum, so a change to the
  form is a new version, never a silent re-hash.
- **How each source reaches it:** `pg` with every type parser replaced by the server's text and the
  session's zone UTC; `tedious` with a decimal or `money` column cast to text in the query past about
  15 significant digits, and sub-millisecond times read from its `nanosecondsDelta`; JSON read by each
  number's source text, never `JSON.parse`'s double, for integer and decimal columns; CSV under a
  declared convention for null, read by a reader that reports whether a field was quoted; XLSX by the
  product's own reader, converting serials in the workbook's date system and refusing serial 60.

### Parameters

- **One declaration shape** for every connector type: name, type, required, permitted values, lists,
  and variations whose key selects a fragment the query definition declares (looked up as an own
  property). It is not a variant per connector type.
- **Each connector type has its own binder and placement rules.** SQL binds the driver's parameters,
  a list as one value (a Postgres array; on SQL Server a JSON array read by `OPENJSON`, a table-valued
  parameter or one parameter per item, never a joined string split at the source). HTTP fills a
  request template by a builder that encodes for each position and refuses what a position cannot
  carry: a path segment refuses empty, `.`, `..`, `/`, `\` and control characters; a header refuses
  CR LF and leading or trailing whitespace; neither takes a list. A file applies typed filters to its
  own canonical rows.
- **On SQL Server a decimal and a sub-millisecond instant are bound as `NVARCHAR` and `CAST` in the
  text**, because `tedious`'s native types pass them through a JavaScript number or a millisecond
  `Date`.
- **A text value refuses U+0000; a "contains" or "starts with" match is declared and bound to a
  pattern-free function, never into `LIKE`.** How comparisons behave under each source's collation is
  left to the T2 design.

### Limits

- **A timeout is the connector's own deadline over the whole execution**, followed by a cancel the
  source acts on. PostgreSQL: a cancel request (`pg_cancel_backend` or the protocol's CancelRequest),
  with `statement_timeout` beside it and `client_connection_check_interval` set so that a dropped
  connection stops its statement - not `pg`'s `query_timeout`, which stops only the client. SQL
  Server: a TDS attention on the connector's timer, because `tedious`'s `requestTimeout` stops
  counting at the first packet. HTTP: a deadline over the whole exchange, because `fetch`'s body
  timeout is idle-based.
- **Rows and bytes are counted as they arrive**: the limit plus one fetched from a cursor, or the
  stream cancelled at the row that crosses; an HTTP body counted after decoding, whatever its
  `Content-Length` says; an XLSX's inflated bytes counted across every part; a CSV record bounded by
  `max_record_size`. Decompression is always bounded.
- **One value larger than the byte limit is bounded only by the source**: a database connector's
  memory is the byte limit plus the largest single value the source can return, which the T2 design
  sizes.

### Drivers and readers

- **`pg` for PostgreSQL and `tedious` for SQL Server.** The product's own **XLSX reader, over `fflate`
  and `saxes`**, and **`csv-parse` at 7.0.3 or later**.
- **Neither SheetJS nor ExcelJS.** SheetJS's npm registry copy is from 2022 with two high advisories
  and no fix there, and its current releases are published only off the registry, so they cannot be
  installed under the frozen lock file; and it returned an empty sheet, without an error, for a
  workbook too large for it. ExcelJS changed four values silently and has no bound on what it inflates.
- **ADR-0007's rule extends to connectors, by this record.** Its reasons - self-hosting without a
  commercial negotiation, and a cost per tenant that carries no licence - apply to anything a connector
  ships. A driver or reader is open source, carries no per-server licence, and installs from the npm
  registry under the frozen lock file, from a copy that is maintained there. ADR-0007 is not edited
  and stays Accepted; this record adds the second half, supply, which SheetJS failed on rather than
  its licence.

### Left to the T2 design

- **DAT-056's granularity**: whether one connector process may open every tenant's secret it is
  handed, one per tenant, or one per execution. Case 2 priced the last at 41 ms p50 against 5 ms warm;
  the evidence does not choose.
- **What an author writes** - SQL text, a builder, or both - which decides whether PostgreSQL's
  asserted identity can serve author-written SQL at all.
- **The stated maximum of a pass-through cache entry, and IAM-067's stated bound.**
- **How the connector learns a tenant's declared private addresses**, and how an HTTP body whose
  source states no length, digest or row count is treated, since an under-declared `Content-Length`
  truncates it invisibly.
- **Comparison under each source's collation**, and a streaming read of an uploaded file from the
  object store.

## What would change the answer

- **Production cannot guarantee the connector's network has no route to the platform** - a shared
  host, a published port, an egress policy it cannot enforce. Then the boundary is only the guard, and
  placement D, or a network production must supply, comes forward.
- **The network results do not reproduce on production's platform.** They were measured on Docker
  Desktop for Windows; until verified there, the boundary is argued for production, not shown.
- **A database gains a delegated mechanism the product can use** - `pg` implementing `OAUTHBEARER`
  for PostgreSQL 18, or a tenant's Azure SQL trusting its Entra ID. Then a delegated token becomes
  that database's end-user mechanism, and asserted identity, with the trust it needs, the fallback.
- **An on-premises customer whose database expects Kerberos constrained delegation.** That cannot be
  met from the platform's network, and is the likeliest reason to build placement D.
- **Holding a user's refresh token is judged unacceptable** - by a security review, a tenant's policy
  or a provider that grants no `offline_access`. Then delegated pass-through bindings must be pinned
  before a publish, the one answer that holds no user secret, and a publish is bounded by the access
  token's life.
- **A pooled connection's reset is shown not to clear an identity**, or a pool is wanted that cannot
  be shown to: then a connection that carried a user is always closed, at the cost of connecting per
  execution.
- **DAT-056 is reworded to require a process per execution.** The cost measured was a proxy (a fresh
  Node process on one machine); a pre-forked pool would change it.
- **`tedious` gains a decimal as text**, or another driver is chosen: the `NVARCHAR` and `CAST` rule
  falls away. **SheetJS publishes a maintained release to the npm registry**: the product's own XLSX
  reader is then a choice, not a necessity, though the conversion rules stay the product's.
- **A declared type is added** - an interval, a binary, a zoned date-time. Then the canonical form
  takes a new version; existing records keep theirs.

## Consequences

- **system.md gains a container and a network** when T2 is designed: the connector, the only process
  that opens a source credential, reached by the service and the worker and reaching nothing of the
  platform. [ADR-0019](0019-platform-typescript-service-publishing-workers-object-storage.md)'s
  containers stand; this adds one.
- **The session model changes for delegated connections**: a session through the tenant's own
  provider holds the provider's access and refresh tokens, sealed, deleted and revoked at sign-out.
  service-foundations.md, under which the service keeps no provider token today, changes with T2.
- **The provenance record's shape is fixed here**: the connection and its version, the query
  definition version, the canonical parameters, the execution identity (mode, mechanism, principal,
  sign-in route and the identity as the source saw it), the row count, the checksum and the canonical
  form's version. That answers DAT-024 as written.
- **Whose view a baseline pins, and who may read it, is not decided here.** A pass-through binding
  pins the publisher's view, and every reader of the publication sees it; DAT-Q03, with **IAM**, says
  whether they may.
- **Requirement rewordings are proposed, not made.** The findings' "Requirements this spike sends
  back" gathers them - DAT-001, DAT-002, DAT-006, DAT-008 and DAT-023 with DAT-055's pass-through
  capability, DAT-011, DAT-012, DAT-017, DAT-038, DAT-040, DAT-045, DAT-050, DAT-052, DAT-056 and
  IAM-067 - for Ken to take separately. This record is written to hold whichever way each is decided.
- **The spike's lists become the connectors' regression suite** (DAT-021): case 1's targets and
  spellings, case 2's failure modes, and case 5's hostile and ill-typed values.
- **The harness is a first draft of the shapes, not code to promote.** `lib/guard.mjs`,
  `lib/canon.mjs`, `lib/types.mjs`, `lib/params.mjs`, `lib/xlsx-own.mjs` and `lib/limits.mjs` in
  [`/spikes/data-connectors/`](../../spikes/data-connectors/) should be read before T2 is designed.
