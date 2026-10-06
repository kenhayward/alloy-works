# D6: HTTP and S3 connections, and the file formats

> D6 of [data.md](../design/data.md)'s build order, on D1 to D4, D7.1, D7.2 and D8, with the
> delegated token Ken moved here from D7 (the D7 plan's question 1 and D7-K). **Full tier**: process
> boundaries (the connector reading untrusted bytes from two new network clients), a stored shape
> (the session's provider token, migration), auth (the token) and new contract arms. The plan rides
> alone, since it needs Ken's answers ([ADR-0039](../decisions/0039-ci-at-two-speeds-and-fewer-prs.md)).
> **Two reviews in place of the pre-flight and per-task reviews**, one per risk (question 7): the
> network clients and the readers at D6.3, over D6.1 to D6.3; the token at D6.4.

**Goal:** a connection can be `http` or `s3` (DAT-074). An `http` definition is a request template
whose every value is placed by a builder for its position (DAT-104, DAT-081); a `file` definition
reads one S3 object by a key template, with typed filters over its rows. Either reads JSON at a
pointer or JSON Lines (DAT-095), CSV, or XLSX by the product's own reader, into the one canonical
form, every limit holding over the whole exchange and every inflated byte (DAT-108 to DAT-110). And an
`http` connection may run as the person, by their provider token exchanged by RFC 8693 (DAT-076's
delegated half).

| PR   | Holds                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D6.0 | This plan, with a change fragment. Its own PR: it needs Ken's answers                                                                         |
| D6.1 | The type seam; `http` with a service secret; the guarded HTTPS client; the HTTP binder; JSON and JSON Lines; its screens and source container |
| D6.2 | `s3` and the `file` fetch: SigV4 over the same client, the key template, typed filters; CSV; its screens and source container                 |
| D6.3 | The XLSX reader; the cross-source checksum fixture; **the first review** (the clients and the readers)                                        |
| D6.4 | The delegated token: the session's sealed provider token, the exchange, own views; **the second review**; D6's close                          |

If question 1 defers the token, D6.3 carries the close.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Beat                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D6-A | **The seam is the connector's `work.ts` choosing a source by `settings.type`**, each source (`postgres`, `http`, `s3`) answering `test` and `run`, `describe` PostgreSQL's alone (`describe_not_supported` on the others; DAT-105 proposes their columns from the sample). Rows from every source end in D2's `finishResult`. `bindFetch` stays the database's; the HTTP binder and the file filter are `packages/domain`'s, pure. A connection's `type` never changes across versions (`connection_invalid`)                              | A class hierarchy per source; one `bindFetch` over every kind, which would hand a database text to a URL builder                                                                           |
| D6-B | **One guarded HTTPS client** (`node:https`) for the `http` source, S3 and the token exchange: the host guarded and resolved once, `lookup` pinned to the checked address, `servername` the host; HTTPS only; **no redirect followed**, a 3xx `source_refused` with its status; no proxy read from the environment; one deadline over the whole exchange, headers and body (DAT-109), the request aborted at it; the body counted after decoding (`gzip`, `deflate`, `br` only, bounded), raw bytes too, either past the limit `byte_limit` | `fetch` (undici): its body timeout is idle-based (ADR-0035) and pinning its address takes a dispatcher of its own; following same-host redirects, re-guarded, for no source that needs one |
| D6-C | **S3 is a SigV4-signed `GET` or `HEAD` through D6-B**, signed by `@smithy/signature-v4` from a static access key pair, path-style or virtual-hosted as the connection says, the bucket's host guarded too. Test is `HeadBucket`                                                                                                                                                                                                                                                                                                            | `@aws-sdk/client-s3`: a second network path past the guard, three retries by default inside one deadline, region redirects                                                                 |
| D6-D | **The `http` source holds `{baseUrl, secretHeader}`**: `baseUrl` `https`, no userinfo, query or fragment, its host canonical as a database's; `secretHeader` a token name that is not `host`, a framing header or `cookie`. The credential is sent verbatim in that header (service) or as `Bearer <exchanged>` (delegated). A template may not name that header or a framing one. A non-2xx is `source_refused` naming the status alone, never the body                                                                                   | The secret as a query parameter, which case 2 found riding the URL                                                                                                                         |
| D6-E | **The HTTP template** (DAT-104): `method` `GET` or `POST`; `path` segments, `query` and `headers` pairs, each part `{fixed}` or `{parameter}`; a POST `body` as a JSON tree whose leaves may be parameters, written by JSON serialisation (a number from its canonical text, a list as an array). Position rules as data.md's (DAT-081); a list only in the query, as repeated names; percent-encoding RFC 3986's unreserved set                                                                                                           | A raw template with markers in text, the fallback ADR-0035 allows: a second binder to make safe for no current need                                                                        |
| D6-F | **Formats are transport-free**: `json {rows: pointer, count?: pointer}`, `jsonLines`, `csv {delimiter, headerRow, null}`, `xlsx {sheet, headerRow}`, read in the child (DA-X). Column `from` gains `{pointer}` (JSON), `{header}` and `{letter}` (CSV, XLSX), at definition schema 1, additive as D4-A was                                                                                                                                                                                                                                 | A format per transport                                                                                                                                                                     |
| D6-G | **A nested JSON value in a text column is its canonical form** (data.md's open question, question 6): members sorted by code unit as RFC 8785, no whitespace, strings escaped as RFC 8785, every number its source text verbatim. Reformatting or reordering at the source moves no checksum; a number's spelling does                                                                                                                                                                                                                     | Source text: whitespace moves checksums, case 6's flagging again. Whole RFC 8785: numbers through a double, which DAT-095 forbids                                                          |
| D6-H | **JSON by `JSON.parse` with the reviver's `context.source`** (ADR-0035), after a byte scan refusing nesting deeper than 64 (the reviver recurses); JSON Lines a line at a time. **CSV by `csv-parse` 7.0.3 or later**, `max_record_size` the byte limit, quoting reported; `null` declared as `empty` (an unquoted empty field) or `never`                                                                                                                                                                                                 | A JSON parser of our own: more code on hostile bytes for duplicate-key detection alone (a risk below)                                                                                      |
| D6-I | **The XLSX reader is the product's own over `fflate` and `saxes`** (ADR-0035), from the spike's `lib/xlsx-own.mjs`: every inflated byte of every part counted against the byte limit, at most 10,000 zip entries, any `DOCTYPE` refused, rows strictly ascending, a formula's cached value or `cell_error`, an error cell `cell_error`; serials in the workbook's date system, serial 60 `nonexistent_date`, a time refused `precision_not_carried` where the double cannot carry the declared fraction (the spike's `serialParts`)        | SheetJS and ExcelJS, ruled out by ADR-0035                                                                                                                                                 |
| D6-J | **A file definition's order is imposed by the connector**, which sorts the filtered rows by D2-M's comparison (times by value, padded fraction), then `finishResult` checks it; an `http` definition's order is checked as a database's. File filters reuse D4's `Condition` over declared columns, each value typed                                                                                                                                                                                                                       | Checking a file's order only: a file has no query to order it                                                                                                                              |
| D6-K | **DAT-108**: an HTTP body checked against `Content-Length` (raw bytes) and RFC 9530's `Content-Digest` (`sha-256`, `sha-512`) where present, and a JSON row count where the definition declares a `count` pointer; S3 against `Content-Length` and an `x-amz-checksum-*` the store answers to checksum mode. Never an ETag, which SSE-KMS and multipart make no digest                                                                                                                                                                     | ETag as MD5, which would refuse sound objects                                                                                                                                              |
| D6-L | **Provenance records what ran without a URL**: for `http` the method, the template and the canonical parameters; for `s3` the bucket, the bound key and the object's version id where given. No code path logs or returns a composed URL or a signed request                                                                                                                                                                                                                                                                               | The URL as run, which ADR-0035 forbids returning                                                                                                                                           |
| D6-M | **The delegated token, D7-K's shape** (Ken, 2026-10-06): the session gains `provider_token`, sealed with the service's key under purpose `provider-token`, context the session's id, and `provider_token_expires_at`; written only by the organisation route; **no refresh token** (question 4); deleted with the session; `identity_expired` past its expiry, before the connector is asked. Never logged                                                                                                                                 | A refresh token, which brings back case 4's lock and token family revocation                                                                                                               |
| D6-N | **The exchange is the connector's**: RFC 8693 at the identity's `tokenEndpoint` through D6-B, the person's token as `subject_token`, the connection's `audience`, client authentication `client_secret_basic` by a new visible `clientId` and the sealed client secret; the exchanged token used for the one request and dropped. `invalid_grant` is `identity_expired`; any other refusal `connection_failed`. The service opens the person's token per act and passes it as the credential is passed, never in argv or the environment   | The service exchanging: the exchanged token would cross the platform's network                                                                                                             |
| D6-O | **A delegated act is a person's own view, as D7-H's**: identity key `delegated:<issuer>\|<subject>` (0047 admits it); provenance `{kind: 'endUser', mechanism: 'delegated', principal, signInRoute: 'organisation', asSeen: <issuer>\|<subject>}`; check, accept and `sharesOwnView` by D7-H's rules; IAM-082's stop by D7-I's watcher unchanged. A Google-route session or a personal token is `identity_unavailable`; `test` runs as the administrator, who must hold a token                                                            | A delegated test run as the client alone, which tests no exchange                                                                                                                          |

## The stored-shape check

- **Connection content** (D6-A, D6-D, D6-N): `type` gains `http` and `s3` with their `source` arms;
  the delegated arm gains `clientId`; `connectorIdentities` gains `http: ['delegated']`, `s3: []`
  (DAT-077, DAT-078). Nothing stored narrows: every version is `postgres`, and none is delegated,
  which `checkConnection` refuses today. DA-AF's target digest gains each type's target (`baseUrl`,
  `secretHeader`; `endpoint`, `region`, `bucket`, `pathStyle`; the identity's `tokenEndpoint`,
  `audience`, `clientId`). The seal request's secret is per type: a string, or an S3 key pair sealed
  as JSON. Write paths: create, each version, retire, reinstate, the seal, `dev-content.ts`'s seed.
- **Definition content** (D6-E, D6-F, D6-J): `fetch` gains `http` and `file`, `Column.from` its three
  arms, at schema 1. A fetch must suit its connection's type, refused `definition_invalid` on save, on
  a sample's draft and at each run, by the connection version it runs on. Write paths: create, each
  version, the sample's draft, the seed. Bounds per data.md (512 KiB canonical).
- **Provenance** per D6-L and D6-O; stored versions read unchanged.
- **Migration, D6.4 alone** (the next free number at build time): `session.provider_token text` and
  `provider_token_expires_at timestamptz`, both null or both set; `SealPurpose` gains
  `provider-token`. D6.1 to D6.3 change no table: no migration names a connection type or a fetch kind.
- **Run request** (not stored): the settings by type, the S3 key pair or the secret as today, and for
  a delegated run the person's token beside the sealed client secret.

## Task 1: The seam, HTTP and JSON - D6.1

- Domain: `connection.ts` (the `http` arm, D6-D); `definition.ts` (the `http` fetch, `from.pointer`);
  `http-template.ts` (schema and `bindHttp`, D6-E); `json-text.ts` (D6-G); `protocol.ts` per type;
  `provenance.ts` (D6-L).
- Connector: `work.ts` per D6-A; `https.ts` (D6-B, reusing `guard.ts`); `http-source.ts`;
  `formats/json.ts`, `formats/cells.ts` (a cell's text to its declared type, from `from-text.ts`);
  `config.ts` gains a CA bundle for development's and CI's sources, which production names none of.
- Service, contract, web: connection create and test per type; `describe_not_supported`; the sample
  proposing columns by pointer; the Connections page's type and fields; the definition editor's
  template and format; `openapi.json` and the client regenerated. `deploy`: `source-http` on
  `connector-egress`, TLS by a development CA, from the spike's `fake-data-api.mjs`.
- Tests: **`DAT-104`** a template's parts placed by position (`http-template.test.ts`). **`DAT-081`**
  and **`DAT-021`** case 5's values through every position: a path segment refusing `..`, `/` and
  control characters, a header refusing CR LF, a body leaf only ever a JSON value
  (`hostile.test.ts`). **`DAT-095`** a pointer to rows, JSON Lines, a 30-digit number exact, a nested
  value `nested_value` unless text, and its canonical text unmoved by reformatting (`json.test.ts`).
  **`DAT-109`** a source trickling a byte a second is `timeout` at the deadline, the socket closed;
  **`DAT-110`** one string past the limit and a gzip bomb each `byte_limit` (`https.test.ts`).
  **`DAT-108`** a short `Content-Length`, a wrong `Content-Digest`, a `count` that disagrees, each
  `result_incomplete`. **`DAT-075`** a guarded host, a refused port, a 401 and a redirect to
  loopback read alike. **`DAT-005`** the secret header's value and the composed URL in no log, error,
  answer or crash dump, raw, URL-encoded or base64 (`secrets.test.ts`). **`DAT-078`** `http`
  declares delegated, `s3` none (`connection.test.ts`). **`DAT-105`** columns proposed from the sample.

## Task 2: S3, the file fetch and CSV - D6.2

- Domain: the `s3` arm; the `file` fetch, its key template (segments as a path's), `csv` and `xlsx`
  formats, `from.header` and `from.letter`; `file-filter.ts` (D6-J).
- Connector: `s3.ts` (D6-C, D6-K); `formats/csv.ts` (D6-H); the file order imposed (D6-J).
- Service and web: the S3 connection, its key pair write-only; the file definition's key, format,
  filters and sort. `deploy`: `source-s3`, a SeaweedFS of its own on `connector-egress`, seeded.
- Tests: **`DAT-074`** an S3 CSV and an HTTP CSV each read into a dataset (`run.test.ts`, the
  sources). **`DAT-077`** an `s3` connection declaring an end user refused. **`DAT-081`** and
  **`DAT-021`** hostile values through the key's segments and every filter's type. **`DAT-108`** an
  object shorter than its length, and a checksum that disagrees. **`DAT-109`** an abandoned exchange
  `timeout`. A CSV `null` convention per declaration, a quoted empty field text, and a record past
  `max_record_size` `byte_limit`. **`DAT-005`** the secret key in no log, nor the
  signature's inputs. A virtual-hosted bucket whose name resolves to loopback refused.

## Task 3: XLSX, and the first review - D6.3

- Connector: `formats/xlsx.ts` per D6-I, a stream over the body as it arrives; styles read only to
  propose a date column from a date format.
- Tests (`xlsx.test.ts`, fixtures from the spike's `lib/bombs.mjs`): **`DAT-074`** a workbook over S3
  and over HTTP into a dataset. **`DAT-110`** a sheet bomb, a shared-strings bomb and 100,000 empty
  entries each refused, memory bounded by the limit. **`DAT-080`** serial 60 `nonexistent_date`,
  `0.30000000000000004` into scale 2 `precision_lost`, an uncached formula `cell_error`. A 1904
  workbook's dates; a `DOCTYPE` with an entity refused. The cross-source fixture: one table from
  PostgreSQL, JSON, CSV and XLSX gives one checksum in four zones (case 6).
- **The first review**, over D6.1 to D6.3: breaks each citation; probes DNS rebinding between the
  guard and the dial, a redirect, a proxy variable, a header split, a hostile zip (overlapping
  entries, a local header disagreeing with the directory), deep JSON, and the secret through every
  path.

## Task 4: The delegated token, the second review and the close - D6.4

- Migration per the check; `sealing` gains the purpose; `oidc.ts` writes the token at sign-in, the
  sign-out deletes it; `data/connector.ts` opens it per act (D6-M); identity per D6-O through D7's
  paths. Connector: `exchange.ts` (D6-N). `deploy`: the stand-in IdP issues a JWT access token for a
  data resource, and `source-exchange`, from the spike's `token-exchange.mjs`, trusts it.
- Tests: **`DAT-076`** a delegated act by an organisation session exchanges and runs; a Google
  session, a personal token and an expired token are `identity_unavailable`, `identity_unavailable`
  and `identity_expired`, the connector never asked (`delegated-acts.test.ts`). **`DAT-084`** and
  **`DAT-091`** a delegated view checked and accepted only by its person. **`IAM-082`** a delegated
  run stopped within two seconds of sign-out. **`DAT-005`** the provider token, the client secret and
  the exchanged token in no log, error or crash dump; the session row's token opens for its session
  alone.
- **The second review**: the token's storage, deletion and expiry; its path through the supervisor;
  Grace reaching Ada's delegated view.
- Docs: data.md (D6's decisions, the open question answered, DAT-074, DAT-076, DAT-095, DAT-104 and
  DAT-108 claims checked, build order), service-foundations.md (the session's provider token), a guide
  for HTTP and S3 sources, features.md and the README; the close per ADR-0037.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` against the build's own compose project (`-p alloy-d6 --profile sources`), every
  `ALLOY_TEST_*` and `ALLOY_E2E_*` target set: a definition per source and format resolved in a
  document and published. Never Ken's stack.
- Memory: a 25 MiB JSON body and a ceiling XLSX each measured in the child against D2's 371 MiB, in
  D6.1 and D6.3.

## Risks

- **Untrusted file parsing** in the child: zip bombs and entry floods (inflated bytes and entries
  counted), XML entities (`DOCTYPE` refused), deep JSON (pre-scanned), a CSV record without end
  (`max_record_size`). A zip whose local headers disagree with its directory reads as its local
  headers say, which Excel may not: the author sees the sample.
- **SSRF**: four hosts now reach the guard (base URL, S3 endpoint, a virtual-hosted bucket, the token
  endpoint), each resolved once and pinned. A source that answers a redirect is refused, which some
  APIs need; question 5 names it.
- **JSON duplicate keys** read last-wins, as `JSON.parse` and RFC 8259 allow; a pointer then reads
  the last.
- **Memory**: `JSON.parse` with a reviver over 25 MiB may exceed a child's measured budget; if it
  does, D6.1 lowers the JSON ceiling rather than the connector's concurrency.
- **Token storage and life**: a sealed bearer token in the session table and in each request to the
  connector. Provider tokens often live an hour, so delegated acts fail `identity_expired` within a
  working session; and Entra ID's on-behalf-of flow is not RFC 8693, so the likeliest enterprise
  provider cannot use D6-N (question 1).
- **Secrets never logged**: the secret header, the S3 key pair, the client secret, both tokens and
  every composed URL; DAT-005's suite asserts each path, raw, URL-encoded and base64.

## Questions for Ken

1. **Is all of D6 wanted before the first release?** You asked whether anyone needs HTTP, S3 or
   spreadsheets yet; no tenant has. **Recommended: build D6.1 to D6.3, defer the delegated token**
   (D6.4) by an ADR as 0038 did: no tenant has asked, Entra ID cannot exchange by RFC 8693, and it is
   the slice's only auth risk. DAT-074 is T2 and asks for all three formats; DAT-076's delegated half
   stays Designed.
2. **The order** D6.1 HTTP and JSON, D6.2 S3 and CSV, D6.3 XLSX, D6.4 the token? **Recommended: yes**;
   each is usable alone, and HTTP's client is what S3 and the exchange reuse.
3. **XLSX now, or after CSV and JSON?** **Recommended: after, as D6.3**, in D6; it is the costliest
   and riskiest reader, and CSV covers most exports meanwhile.
4. **No refresh token** (D6-M): an expired provider token fails the next act until the person signs
   in again? **Recommended: yes**, as ADR-0035 decided; revisit when a tenant's token life interrupts
   real work.
5. **S3 scope**: a static access key pair, SigV4, path-style or virtual-hosted, tested on SeaweedFS;
   no STS role, instance credentials, anonymous buckets, SSE-C or redirects? And HTTP follows no
   redirect at all? **Recommended: yes to both**; AWS, R2, B2 and MinIO speak the same signing.
6. **A nested JSON value as text** in its canonical form, numbers by source text (D6-G)?
   **Recommended: yes.**
7. **Two final reviews**, at D6.3 and D6.4, in place of a pre-flight and per-task reviews?
   **Recommended: yes.**
