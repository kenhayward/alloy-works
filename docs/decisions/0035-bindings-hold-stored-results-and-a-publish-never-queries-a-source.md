# 0035 - Bindings hold stored results, and a publish never queries a source

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

[ADR-0033](0033-t2-is-the-data-spine.md) made T2 the data spine: connections to a tenant's own
systems, query definitions, parameters, bindings and their provenance. Three parts of it are written
into something expensive to move, and the data connector spike was run to settle them:

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
  every publish within 50 ms with the source's statements cancelled, but the job recorded the
  cancellation rather than the sign-out, and once in 36 runs one binding ran on. Held open at the
  request instead, 440 bindings of 20 ms took 1.4 to 1.8 s at a concurrency of 8 and 11 to 14 s at 1.
  A pin made by Ada and read by Grace showed Grace rows her own rules hide, and recorded whose view it
  was. A cache keyed without the identity served Ada's rows to Grace; one keyed with it went on serving
  a row the source had since reassigned. **Pinned-only was the one answer that held no user secret.**
- **Case 5: pass with cost.** One declaration shape, bound three ways, took 3,792 hostile and
  ill-typed values: 2,814 refused by name, 951 bound inert, none changing a statement's shape. The 22
  that behaved differently from the value read as data were interpreted after binding - `LIKE`, a
  collation, `STRING_SPLIT`, HTTP's whitespace - and `tedious`'s native decimal and instant types lost
  digits. A rule over PostgreSQL text, however exact its parser, allowed a query that read a view
  which re-asserted the identity.
- **Case 6 (gate): pass, with named refusals.** One canonical form gave one checksum from ten
  source-and-reader paths in four time zones, and every loss a driver or format imposes was refused by
  name. With no total order, a check of unchanged data was flagged moved in 19 of 19 refreshes in
  PostgreSQL and 16 of 19 in SQL Server.
- **Case 7: pass with cost.** Every limit was a named failure with memory bounded, but neither
  driver's own timeout stopped the statement at the source, and neither XLSX library bounded what it
  inflated; one returned an empty sheet for a workbook too large for it, without an error.

[ADR-0034](0034-data-connectors-run-apart-as-a-declared-identity.md) was written from those findings
and **Proposed** on 2026-09-30. Ken reviewed it the same day and decided eleven points, which this
record makes. It supersedes 0034 whole rather than amending it, because a record takes no edit but its
status line; everything of 0034 that stands is restated here, so 0034 need not be read to know what is
in force. What changed, and why:

- **0034 let a publish query its sources.** It answered case 4 by running pass-through bindings live in
  the worker's publish, and paid for that with the user's access token sealed beside the job, a refresh
  token held per session, a lock on its refresh, a cache of exchanged tokens tied to the session, and a
  result cache whose entries outlive the user's permission at the source. Ken took the other answer
  case 4 offered, and a stronger form of it: **every binding holds a stored result, and neither a
  preview nor a publish queries a source.** Then PUB-006 - a preview shows what publishing produces -
  holds for data as it does for text, everybody reading a document sees the same values, and the
  product holds no refresh token and no cache.
- **0034 left DAT-Q03 open** - who may read a value obtained under somebody else's view. Ken answered
  it.
- **0034 left open what an author writes.** Ken chose a query builder that stores its structure, with
  SQL as a fallback that is a permission of its own and is refused where it cannot be made safe.
- **The sources change.** An upload is a push, which nothing can check for a revision, so it is not a
  data source in T2; S3-compatible object storage is, and a file may be CSV, XLSX or JSON over either
  transport. A result may carry images. **S3 was argued, not tested**: the spike listed cloud object
  stores as a remote file location that stayed a claim. JSON was read over HTTP in case 6, but not as a
  file with a pointer to its rows; an XLSX fetched over HTTP was not run end to end; and no image column
  was run at all.
- **DAT-034's three modes - live, pinned and refreshable - are replaced**, since nothing is live.

## Decision

**Every binding holds a stored result in the tenant, and the editor, a preview and a publish read it.
A source is queried only when a person present acts, by a connector container on a network of its
own with no route to the platform, as the identity its connection declares by a named mechanism, and
it returns a result in one canonical form that is checksummed, or a named failure. Nothing a source
returns replaces a stored result until a person accepts it.**

### Stored results

- **Every binding holds a stored result in the tenant**: the canonical rows, their checksum and the
  provenance record. The editor, a preview and a publish read the stored result. **A preview or a
  publish never queries a source.** So PUB-006 holds for data, and everybody reading the document
  sees the same values.
- **A source is queried only when a person present acts**: creating a document from a template, which
  establishes its bindings (TPL-063), and placing a binding in the editor, which is the same act for
  one binding; checking for a revision, or accepting one; and a query author's sample run (DAT-014).
- **So the worker runs no source query under a user's identity**, and holds nothing sealed beside a
  job. Publishing needs nothing of the publisher's sign-in route: a Google-route user, or a program
  with a personal API token, publishes a document with delegated bindings as anybody else does.
- **The cost moves to the acts.** A creation from a template runs every binding while the person waits.
  Case 4 priced that shape at the request: 1.4 to 1.8 s for 440 bindings of 20 ms at a concurrency of
  8, and 11 to 14 s one at a time. A real source's latency multiplies it; the T2 design sets the
  concurrency and says what a person sees while it runs.

### Binding modes: checked and pinned

- **Every binding holds a stored result; its mode says only how the product looks for revisions.** A
  **checked** binding is looked for automatically when the document is opened. A **pinned** binding is
  never looked for.
- **A revision is shown beside the current value, and nothing changes until a person accepts it.**
  Accepting is an explicit act, audited with what the binding held and what it holds after (DAT-037).
- **A revision check compares only when the person checking is the identity whose view is stored** -
  the same execution identity as the source saw it, which the provenance record names - **or the
  connection runs as a service account.** For anybody else a different result is a different view, not
  a source that moved, and it is never flagged as moved. They may still fetch their own view and accept
  it, as an explicit act, under the warning below.
- **The stable checksum is what makes "moved" mean the data changed** (case 6): rows hashed in a total
  order that covers the declared key, or as a multiset, so rewriting unchanged rows flags nothing.
- **Sign-out or revocation stops a check or a creation in flight** (IAM-067): checking the session and
  registering an execution are one step, so no execution starts unseen after a sign-out; the stopped
  work records the sign-out or revocation as its reason, and the cancelled queries as its consequence.
  The stated bound IAM-067 asks for is the T2 design's.

### Who sees stored data

This answers DAT-Q03.

- **The document's permission governs who reads its stored results.** The source's own rules govern
  only who may fetch a result or accept one, as DAT-025 already separates permission to use a
  connection from permission to read a document.
- **Accepting a result obtained as oneself warns that everyone who can read the document will see
  it.** The warning is the act's, not a setting.
- **The provenance record labels whose view the stored result is**, and the document can show it
  (DAT-024).

### Datasets

- **A stored result is a dataset**: a first-class, immutable, versioned object, separate from the
  bindings that use it, which may be named. **A binding references one dataset version.**
- **Accepting a revision makes a new dataset version and moves only that document's binding.** Another
  document referencing the same dataset keeps its version until somebody accepts there.
- **A dataset keeps its declared column types**, so it reads back as a typed table, not as text.
- **A dataset carries the view of whoever accepted it.** Read through a document, it is governed by
  the document's permission; read in its own right - named, reused and, later, queried - by permission
  to the dataset.
- **Querying stored datasets is a later tranche** (T4, reuse): a dataset as a source of its own,
  through the same builder, which never goes back to the original system. It is not built in T2. It is
  decided now because turning values embedded in bindings into separate objects later would migrate
  immutable data.
- **How a dataset is stored** - rows in the tenant's schema, an object by hash, or both - is the T2
  design's.

### Connection types and file formats

**Every source is pulled.** There are three connection types:

- **A relational database** - PostgreSQL and SQL Server first.
- **An HTTP endpoint.**
- **S3-compatible object storage**, as a tenant service account only in T2. It has no end-user mode.

**A file is a format, independent of its transport**: CSV, XLSX or JSON, read from S3 or over HTTP.

- **JSON** is read either at a JSON Pointer (RFC 6901) to an array of objects, or as JSON Lines. A
  column is mapped by a pointer relative to each row. Numbers are read from their source text, never
  through a double. A nested object or array is refused by name, unless its column is declared text,
  when it is kept as JSON text.
- **An upload is not a data source in T2.** It is a push, and a push cannot be checked for a revision.
- **SharePoint and OneDrive come later**, as HTTP connections reading a file.

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
  resolves once and connects to the address it checked; and follows no redirect across hosts. An S3
  endpoint is a host like any other.
- **Production must guarantee the connector's network has no route to any platform service,
  including through a host that publishes a platform port.** The spike measured the boundary on Docker
  Desktop for Windows, not Linux, and found the published-port leak there. Production's isolation is
  verified on production's own platform before connectors ship; it is a requirement on hosting, which
  is still open.

### Credentials

- **A source credential is sealed to its tenant and purpose as the platform's other secrets are, and
  opened only in the connector**, for the execution that needs it, and dropped. No other kind of
  process opens one. An S3 connection's access key is a source credential like any other.
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
  exchange trusts, and not through a personal API token, which has no provider token behind it. A data
  act on a delegated connection by such a user is refused by name.
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
    source has none, as PostgreSQL has none, the query text is generated by the product** - the
    builder below - and SQL written by a person is refused on that connection. This narrows 0034,
    which also admitted text written by a person trusted with every user's rows. No rule over the text
    is complete, because a view or a function in the source can change the setting for it (case 5); a
    view the builder reads is the source administrator's, who already holds every user's rows. Identity
    established when the connection authenticates would remove the condition and is not built.
  - **A connection that carried a user's identity is reset, by a means shown to clear it, or
    discarded, before it is reused.** Neither `pg.Pool` nor `mssql`'s pool resets a connection; where a
    reset is not shown to clear the identity - a `NO REVERT` context, a `read_only` key - the
    connection is closed. That a reset clears it is a documented claim here, not a tested one.
- **An S3 connection declares no end-user mode** in T2, and an HTTP connection reading a file may
  declare a delegated token as any HTTP connection may.
- **Delegated tokens into a database** - Azure SQL with Entra ID, PostgreSQL 18's OAuth - and Kerberos
  constrained delegation are not decided here; neither could be run.

### What the product holds for a delegated connection

- **The session holds the user's provider access token, sealed, for the session's life, and deletes
  it at sign-out.** It is needed only while the person acts. **No refresh token is held.** An expired
  access token means signing in again before the next data act; it fails by name, as case 4 showed it
  does without a refresh.
- **The connector keeps no cache of exchanged tokens beyond the act it exchanged for.** A delegated
  token that has already left the product's custody cannot be recalled; only its lifetime, which the
  tenant's provider sets, bounds it (case 4, section 2).
- **Asserted identity needs only the principal's name.**

### No result cache in T2

- **Nothing caches a source's result in T2.** DAT-052's default - no caching - holds, and no cache is
  built. DAT-026 has nothing to apply to until one exists.
- **A cache designed later starts from case 4's section 5**: its key holds the execution identity as
  the source sees it, and an entry obtained as a user outlives that user's permission at the source for
  as long as it lives, because nothing tells the product the permission changed.

### Queries: a builder, with an SQL fallback

- **A query is built with a query builder, which stores its structure, never SQL.** For a database the
  structure is a relational query tree whose versioned schema already admits several sources joined,
  grouping, aggregates and nested queries, so **multi-join queries are added later without migrating a
  stored query**.
- **T2's builder exposes** one table or view, its columns, filters on parameters, sort, a limit, and
  simple aggregates - count, sum, average, minimum and maximum, grouped. A join in T2 is written in the
  SQL fallback, or defined as a view at the source.
- **The product generates the SQL, per dialect, each time it runs**, and the provenance record keeps
  the SQL that ran. Product-generated text is what keeps PostgreSQL's asserted identity safe (cases 3
  and 5).
- **The SQL fallback is a permission of its own, per connection.** It runs under the connection's
  declared identity. **It is refused on a connection whose end-user mechanism is PostgreSQL's asserted
  identity**, because no rule over text is complete (case 5). It is allowed where the identity is one
  the text cannot change - SQL Server's `read_only` `SESSION_CONTEXT`, `EXECUTE AS ... WITH COOKIE` -
  and on a service-account connection.
- **The fallback's protection is the source account's privileges, not parsing.** The connection's
  account must be read-only at the source, and the connection test checks that where the source can
  say. A parameter is still bound, never spliced (DAT-017).
- **For HTTP the builder is a request template** - path, query, headers and body, each position
  encoded - and a pointer to where the rows are. Its fallback is a raw template, under the same
  encoding rules.
- **For a file the builder is** column selection, filters and sort.

### Result columns, a second step

- **Declaring the columns is a second step, the same for every source.** The flow is: the connection;
  the fetch - builder, SQL, request template or file read - and its parameters; a sample run
  (DAT-014); then the columns.
- **The vocabulary is one closed list for every source**: **text** - any character data of any length,
  including large text, a CLOB and JSON read as text, bounded only by the byte limit - **integer**,
  **decimal** with precision and scale, **date**, **time**, **local date-time**, **instant** with a
  fractional-second precision, **boolean** and **image**. Only the mapping differs by source: a column
  name, a pointer, a header or a column letter.
- **The product proposes each column** from the source's own metadata where it has some, and from the
  sample otherwise, where the user must confirm each, because a sample cannot prove a decimal's
  precision.
- **The declared columns and the row order are the contract**: a total order that includes the key, or
  else the rows checksummed as a multiset. A run that does not fit is refused by name, never adjusted.
- **Changing the columns is a new version of the query definition** (DAT-015).

### The canonical result and its checksum

- **One document per result**: the declared columns as `[name, base type]` pairs in declared order,
  and the rows. **Every cell is a JSON string, a JSON boolean or `null`; there are no JSON numbers.**
- **By type:** an integer is base-10 text with no leading zeros; a decimal is base-10 text with no
  exponent, no leading zeros, no trailing fractional zeros, no point when whole and `-0` as `0`,
  within its declared precision and scale; a date is `YYYY-MM-DD`; a time and a local date-time are
  themselves, with no zone; an instant is converted exactly to UTC and ends in `Z`, its fraction
  carried as digits, never through a JavaScript `Date`, with trailing zeros stripped, within its
  declared precision; an offset is not kept; **an image is the SHA-256 the object store keys its bytes
  by**, as lowercase hexadecimal. Null and the empty string differ. Text is its code points,
  unnormalised. A value a source cannot deliver exactly in its declared type is refused by name
  (`precision_lost`, `precision_not_carried`, `zone_missing`, `nonexistent_date`, `cell_error`),
  never rounded.
- **Rows are hashed in the query's stated order where that order is total, covering the declared key;
  otherwise as a multiset**, sorted by each row's canonical text.
- **The document is serialised as RFC 8785 canonical JSON and hashed with SHA-256**, and the form's
  version (`canonical: 1`) is recorded in the provenance record beside the checksum, so a change to the
  form is a new version, never a silent re-hash. **Version 1 includes the image type from the start**;
  nothing has been stored under the form yet, so adding it now is not a new version.
- **How each source reaches it:** `pg` with every type parser replaced by the server's text and the
  session's zone UTC; `tedious` with a decimal or `money` column cast to text in the query past about
  15 significant digits, and sub-millisecond times read from its `nanosecondsDelta`; JSON read by each
  number's source text, never `JSON.parse`'s double, for integer and decimal columns; CSV under a
  declared convention for null, read by a reader that reports whether a field was quoted; XLSX by the
  product's own reader, converting serials in the workbook's date system and refusing serial 60.

### Image columns

- **An `image` column is available from every source.** The query definition declares its encoding:
  base64 text, or a database's binary column. No image is given as a URL in T2.
- **A bound image comes through the same door as an uploaded one**: PNG or JPEG only, read from its own
  bytes, decoded whole by the worker's `ingest` job and bounded in pixels and bytes, and stored in the
  object store by hash. The `ingest` job runs no source query; it is handed bytes the connector already
  returned. A run with an image the door refuses is refused by name, and nothing is stored without it.
- **The stored result's cell holds the hash**, so the checksum is stable however the source encodes the
  image.
- **Every bound image takes its description from a column the query definition names, or is declared
  decorative; otherwise the publish fails by name.**
- **It may be placed where an image can be today**: a table's cell, a line of text, or a figure.

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
  own canonical rows, comparing a canonical time with its fraction padded, since its text order is not
  its time order.
- **On SQL Server a decimal and a sub-millisecond instant are bound as `NVARCHAR` and `CAST` in the
  text**, because `tedious`'s native types pass them through a JavaScript number or a millisecond
  `Date`. The builder generates the cast.
- **A text value refuses U+0000; a "contains" or "starts with" match is declared and bound to a
  pattern-free function, never into `LIKE`.**

### Limits

- **A timeout is the connector's own deadline over the whole execution**, followed by a cancel the
  source acts on. PostgreSQL: a cancel request (`pg_cancel_backend` or the protocol's CancelRequest),
  with `statement_timeout` beside it and `client_connection_check_interval` set so that a dropped
  connection stops its statement - not `pg`'s `query_timeout`, which stops only the client. SQL
  Server: a TDS attention on the connector's timer, because `tedious`'s `requestTimeout` stops
  counting at the first packet. HTTP and S3: a deadline over the whole exchange, because `fetch`'s body
  timeout is idle-based.
- **Rows and bytes are counted as they arrive**: the limit plus one fetched from a cursor, or the
  stream cancelled at the row that crosses; an HTTP or S3 body counted after decoding, whatever its
  `Content-Length` says; an XLSX's inflated bytes counted across every part; a CSV record bounded by
  `max_record_size`. Decompression is always bounded.
- **One value larger than the byte limit is bounded only by the source**: a database connector's
  memory is the byte limit plus the largest single value the source can return, which the T2 design
  sizes. An image column makes that value likelier to be large.

### Drivers and readers

- **`pg` for PostgreSQL and `tedious` for SQL Server.** The product's own **XLSX reader, over `fflate`
  and `saxes`**, and **`csv-parse` at 7.0.3 or later**. JSON is read with the source text of each
  number (Node 22's reviver `context.source`).
- **Neither SheetJS nor ExcelJS.** SheetJS's npm registry copy is from 2022 with two high advisories
  and no fix there, and its current releases are published only off the registry, so they cannot be
  installed under the frozen lock file; and it returned an empty sheet, without an error, for a
  workbook too large for it. ExcelJS changed four values silently and has no bound on what it inflates.
- **ADR-0007's rule extends to connectors, by this record** as it did by 0034's. Its reasons -
  self-hosting without a commercial negotiation, and a cost per tenant that carries no licence - apply
  to anything a connector ships. A driver, a reader or an S3 client is open source, carries no
  per-server licence, and installs from the npm registry under the frozen lock file, from a copy that
  is maintained there. ADR-0007 is not edited and stays Accepted; this record adds the second half,
  supply, which SheetJS failed on rather than its licence.

### DAT-056

- **DAT-056 is split**, in the requirements change that follows this record. DAT-056 stays as written:
  a connector runs with no more authority than the connection it serves. A new row carries asserted
  identity's rules above. Whether one connector process may open several tenants' secrets stays the
  T2 design's.

### What ADR-0034 decided that this record does not

- **Publishing with pass-through bindings** - the worker running them, the user's access token sealed
  beside the job (`job_identity`), the refresh token held per session and its per-session lock, and a
  publish refused where the identity cannot travel - is superseded: a publish runs no query.
- **The cache of results**, keyed with the execution identity and capped by a stated maximum, is
  superseded: nothing is cached in T2.
- **The connector's cache of exchanged tokens, tied to the session**, is superseded: none is kept
  beyond the act.
- **Asserted identity in PostgreSQL over text from a person trusted with every user's rows** is
  withdrawn: only product-generated text runs there.
- **An uploaded file as a source**, with its typed filters and no end-user mode, is withdrawn for T2.
- **"What an author writes"**, which 0034 left to the T2 design, is decided above.

### Left to the T2 design

- **DAT-056's process granularity**: whether one connector process may open every tenant's secret it
  is handed, one per tenant, or one per execution. Case 2 priced the last at 41 ms p50 against 5 ms
  warm; the evidence does not choose.
- **How the connector learns a tenant's declared private addresses.**
- **An HTTP or S3 body whose source states no length, digest or row count**, since an under-declared
  `Content-Length` truncates it invisibly.
- **Comparison under each source's collation.**
- **The builder's user interface.**
- **The dataset's storage medium.**
- **IAM-067's stated bound** for a check or a creation in flight.
- **How a nested JSON value kept as text is written** - as its source text, or in a canonical form -
  which decides whether reformatting at the source moves a checksum.
- **How a new query definition version a binding floats to (DAT-015), or a changed parameter value,
  is offered**, within the rule that nothing changes until a person accepts it.

## What would change the answer

- **Production cannot guarantee the connector's network has no route to the platform** - a shared
  host, a published port, an egress policy it cannot enforce. Then the boundary is only the guard, and
  placement D, or a network production must supply, comes forward.
- **The network results do not reproduce on production's platform.** They were measured on Docker
  Desktop for Windows; until verified there, the boundary is argued for production, not shown.
- **A customer needs a document whose data updates without an explicit acceptance** - a dashboard, a
  status page. That needs a mode this record rules out, and with it the live query at a preview or a
  publish, the user's token held for it and a cache; case 4 has priced each.
- **Bulk generation in T4 runs many creations at once under one user's identity.** A creation then
  outlives the person's presence and may outlast the access token, which is 0034's case again: a
  refresh token and its lock, or generation restricted to service-account connections.
- **A source whose data may not be stored by the product at all** - a data-residency rule, a contract
  that allows display but not retention. The stored-result model cannot meet it; it would need a
  query at each read, or placement D with results stored in the customer's network.
- **A database gains a delegated mechanism the product can use** - `pg` implementing `OAUTHBEARER`
  for PostgreSQL 18, or a tenant's Azure SQL trusting its Entra ID. Then a delegated token becomes
  that database's end-user mechanism, and asserted identity, with the trust it needs, the fallback;
  and the SQL fallback could be allowed on such a PostgreSQL connection.
- **An on-premises customer whose database expects Kerberos constrained delegation.** That cannot be
  met from the platform's network, and is the likeliest reason to build placement D.
- **A provider's access token lives so briefly that signing in again interrupts real work.** Then a
  refresh token comes back for the session, with the lock case 4 showed it needs.
- **A pooled connection's reset is shown not to clear an identity**, or a pool is wanted that cannot
  be shown to: then a connection that carried a user is always closed, at the cost of connecting per
  execution.
- **DAT-056 is reworded to require a process per execution.** The cost measured was a proxy (a fresh
  Node process on one machine); a pre-forked pool would change it.
- **S3 does not behave as argued** - an endpoint that cannot be held to one resolved address, a client
  that follows redirects across hosts or logs a signed URL. Its case is then run before T2 builds it.
- **`tedious` gains a decimal as text**, or another driver is chosen: the `NVARCHAR` and `CAST` rule
  falls away. **SheetJS publishes a maintained release to the npm registry**: the product's own XLSX
  reader is then a choice, not a necessity, though the conversion rules stay the product's.
- **A declared type is added** - an interval, a binary other than an image, a zoned date-time. Then
  the canonical form takes a new version; existing records keep theirs.

## Consequences

- **system.md gains a container and a network** when T2 is designed: the connector, the only process
  that opens a source credential, reached by the service and the worker and reaching nothing of the
  platform. [ADR-0019](0019-platform-typescript-service-publishing-workers-object-storage.md)'s
  containers stand; this adds one.
- **The session model changes for delegated connections**: a session through the tenant's own
  provider holds the provider's access token, sealed, deleted at sign-out, and no refresh token.
  service-foundations.md, under which the service keeps no provider token today, changes with T2.
- **The publish job is unchanged in kind**: it reads stored results, as it reads the rest of a
  document, and holds nothing of the publisher's identity. PUB-049's provenance of every bound value
  with its publication is the provenance of the dataset versions the publication read.
- **The provenance record's shape is fixed here**: the connection and its version, the query
  definition version, the canonical parameters, the SQL or request that ran, the execution identity
  (mode, mechanism, principal, sign-in route and the identity as the source saw it), the time, the row
  count, the checksum, the canonical form's version, and the dataset version it produced. That answers
  DAT-024 as written, and DAT-040 once its checksum names the canonical form.
- **T2 grows** by the query builder, with its stored query tree and its generators per dialect, by
  bound images and their descriptions, and by datasets. It loses uploaded files as a source, the
  result cache and every part of a live publish.
- **The requirements change in the next pull request, not this one.** It rewords or supersedes
  DAT-002, DAT-006, DAT-008, DAT-011, DAT-012, DAT-017, DAT-023, DAT-034, DAT-038, DAT-040, DAT-045,
  DAT-050, DAT-052, DAT-056 (split) and IAM-067; checks DAT-024, DAT-035 and DAT-036, which speak of
  pinned and refreshable bindings, against the modes above; moves DAT-055's pass-through part into T2;
  and adds rows for S3 and JSON files, the image type and its description, the builder and its SQL
  fallback, the two-step column definition, and named datasets, with querying them in T4. The findings'
  proposed addition to DAT-001, an uploaded file as a source of its own, is not taken.
- **The spike's lists become the connectors' regression suite** (DAT-021): case 1's targets and
  spellings, case 2's failure modes, and case 5's hostile and ill-typed values.
- **The harness is a first draft of the shapes, not code to promote.** `lib/guard.mjs`,
  `lib/canon.mjs`, `lib/types.mjs`, `lib/params.mjs`, `lib/xlsx-own.mjs` and `lib/limits.mjs` in
  [`/spikes/data-connectors/`](../../spikes/data-connectors/) should be read before T2 is designed.
