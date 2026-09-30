# Data

Connections to a tenant's own systems, the query definitions that run against them, the results
stored from them and the documents that hold those results - and the connector, the one process that
reaches a source.

This realises the T2 half of [DAT](../specification/requirements/DAT-data-connectivity-and-bindings.md)
that is not the editor's or the publish's. It is written from
[ADR-0035](../decisions/0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md),
which is the authority - every binding holds a stored result, a preview or a publish never queries a
source, and a source is queried only when a person present acts, by a connector on a network of its
own - from [ADR-0033](../decisions/0033-t2-is-the-data-spine.md), which made T2 the data spine, and
from the [data connector spike's findings](../specification/spikes/Data_Connector_Spike_Findings.md),
whose cases are cited here by number. A connection, a query definition and a dataset are stored by
[storage-and-versioning.md](storage-and-versioning.md)'s one mechanism; who may do what is
[access.md](access.md)'s decision, with two permissions this design adds; a result's bytes are
objects by hash as [assets.md](assets.md)'s are, and a bound image comes through the same door; the
binding's place in a component is [content-model.md](content-model.md)'s inline, widened here.
**`bindings.md`**, designed after the third slice below, owns the editor's side of a binding and the
publish's binding stage; **`tables.md`** owns a bound table's presentation.

## The shape in one paragraph

A **connection** is an artifact in a space whose versions hold its visible settings - its type, where
the source is, and the identity it runs as - while its **credential** is sealed in a table of its own
with a key only the connector holds, and never read back by anybody. A **query definition** is an
artifact in a space, versioned like content, that names one connection and holds its parameters, one
of four fetches - a saved builder structure, SQL, an HTTP request template or a file read - the
columns it returns, their key and order, whether empty is valid, and its limits. A **dataset** is a
stored answer to one question - a definition, its canonical parameters and the identity that asked -
whose every version is one recorded result: the version's content is the provenance record, and the
rows are one object in the tenant's store keyed by their own checksum. A **binding** in a component's
content says what to ask and which value to take, and never holds a result, because one component
serves many documents; a **resolution**, owned by the document, maps each binding to the dataset
version that document holds, one insert-only row per change. Only the service asks the **connector**,
a container on its own network with no route to the platform, and only when a person acts: placing a
binding, opening a document with checked bindings, accepting a revision, a sample run, a connection
test. The connector opens one credential in a fresh process, runs one request, and answers a canonical,
checksummed result or one named failure.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-001** | `connection` is an artifact kind in one space of one tenant's schema; its version carries a `name` and the settings of one source ([The connection](#the-connection))                                                                                                                                     |
| **DAT-074** | A connection's `type` is `postgres`, `sqlServer`, `http` or `s3`, and a query definition's fetch reads CSV, XLSX, JSON or JSON Lines from an S3 object or an HTTP response; every one is pulled by the connector                                                                                          |
| **DAT-003** | The credential is sealed into `connection_credential` in the tenant's schema, with a key only the connector holds; no route answers it, so it is write-only from every client                                                                                                                             |
| **DAT-004** | `GET /v1/connections/{id}` answers `credential: { set, setBy, setAt }` from the latest credential row, and nothing a route answers carries the sealed value or the secret                                                                                                                                 |
| **DAT-005** | The secret is opened only in the connector's per-request child, goes in a header never a URL, and is kept out of every log, telemetry event, export, crash report and error; the spike's case 2 matrix becomes a test for each path, in the service and in the connector                                  |
| **DAT-075** | `test` answers `ok`, or `connection_failed` alike for a refused or filtered port, an unknown host, a guarded address and a wrong credential, naming no address and echoing no credential; checks of the authenticated account are reported after it by name ([The connection test](#the-connection-test)) |
| **DAT-007** | Every change to a connection's settings is a version, so what changed is a comparison of two versions; every credential set or replaced is a row naming who and when and never the value; a connection is never deleted, and retiring it is a version                                                     |
| **DAT-076** | `identity` is `service`, or `endUser` by `delegated` or `asserted`; a delegated act needs the provider access token a session through the tenant's own provider holds, so a Google-route session or a personal API token is refused, `identity_unavailable`                                               |
| **DAT-078** | Each connection type's connector declares the mechanisms it supports - `postgres` and `sqlServer` asserted, `http` delegated, `s3` none - and a connection version declaring another is refused, `identity_not_supported`                                                                                 |
| **DAT-064** | Where a connection is used - the definitions naming it and, through their bindings and resolutions, the documents - is computed when asked, `GET /v1/connections/{id}/uses`, and the retire screen shows it before it proceeds                                                                            |
| **DAT-065** | Nothing deletes a connection; retiring one is refused, `connection_in_use`, naming each definition that is not itself retired and names it, so no definition is left pointing at nothing and nothing cascades                                                                                             |
| **DAT-066** | Setting a credential inserts a row and cuts no version, so no stored result or resolution changes; the service tests the connection at once and, on a failure, reports it once, naming every definition that names the connection                                                                         |
| **DAT-056** | The connector holds no platform credential and has no route to the platform; each request runs in a fresh process handed one opened credential, which exits with the request                                                                                                                              |
| **DAT-113** | On PostgreSQL an asserted identity runs only builder-generated text, the SQL fallback refused; on SQL Server the assertion is a `read_only` `SESSION_CONTEXT` key or `EXECUTE AS USER ... WITH COOKIE` with the cookie held by the connector                                                              |
| **DAT-114** | No source connection is reused: the child process that opened it closes it and exits with its one request, so a connection that carried a user's identity is always discarded                                                                                                                             |
| **DAT-009** | `queryDefinition` is an artifact kind in one space whose version carries a `title` and exactly one `connection`, a connection artifact's identifier                                                                                                                                                       |
| **VER-057** | A query definition versions through `artifact_version` by `recordVersion`, with an author, `schemaVersion`, the digest and the insert-only grant every artifact has; a change is a new version from `openedFrom`                                                                                          |
| **SCH-055** | `queryDefinition` is a search kind, its entry written with each version from its title, description, column names and its connection's name                                                                                                                                                               |
| **DAT-010** | Each parameter declares `name`, `type` from the column vocabulary but `image`, `required`, `list`, and `permitted` values as a list or a range                                                                                                                                                            |
| **DAT-019** | A variation is a parameter whose permitted values are the keys of fragments the definition declares; its value selects one as an own property and is never placed in the query                                                                                                                            |
| **DAT-020** | Every value is checked against its declaration before the connector is asked, and a value that fails refuses the act, `parameter_invalid`, naming the parameter, the rule and the value                                                                                                                   |
| **DAT-081** | A database value is the driver's bound parameter; an HTTP value is placed by a builder that encodes it for its position and refuses what that position cannot carry; a file's is a typed filter over canonical rows. No path splices a value into text                                                    |
| **DAT-018** | Sources, columns, joins and conditions are the definition's own structure or text; a parameter supplies a value or, as a variation, selects among declared fragments, so no parameter changes a query's shape                                                                                             |
| **DAT-021** | The connector's suite runs the spike's case 5 values - 3,792 hostile and ill-typed - through every parameter type and every binder, and each is refused by name or bound inert                                                                                                                            |
| **DAT-099** | A database definition's fetch is `builder`, a saved query tree, unless it is `sql`; the connector generates the dialect's SQL from the tree at each run, and provenance keeps what ran                                                                                                                    |
| **DAT-100** | The tree's format, version 1, admits several sources, joins, nested queries as sources, grouping and aggregates from the start, though T2's screens offer one source                                                                                                                                      |
| **DAT-101** | Saving a definition whose fetch is `sql` needs `write_sql`, a permission of its own decided at the connection it names                                                                                                                                                                                    |
| **DAT-102** | A `sql` fetch is refused, `sql_not_permitted`, on a PostgreSQL connection whose identity is asserted, when saved and when run                                                                                                                                                                             |
| **DAT-103** | The connection test checks, where the source can say - PostgreSQL's and SQL Server's catalogues - that the account holds no write privilege, and a `sql` fetch is refused on a connection whose last test did not find it read-only                                                                       |
| **DAT-104** | An `http` fetch is a request template - method, path segments, query, headers and a JSON body, each part fixed or a parameter - with the format and, for JSON, a pointer to the rows                                                                                                                      |
| **DAT-095** | JSON is read at a JSON Pointer to an array of objects or as JSON Lines; each column maps by a pointer relative to the row; a number is read from its source text; a nested value is refused, `nested_value`, unless its column is text                                                                    |
| **DAT-080** | A column's type is one of `text`, `integer`, `decimal` with precision and scale, `date`, `time`, `localDateTime`, `instant` with a fractional precision, `boolean` or `image`; a value not exact in its type is refused by name, never rounded                                                            |
| **DAT-105** | The columns are the second step: proposed from `describe` for the builder and SQL, from the sample for HTTP and files, and saved only as the author confirms each                                                                                                                                         |
| **DAT-106** | The connector checks every run against the declared columns and order and refuses, `result_mismatch`, a result that does not fit, never adjusting it                                                                                                                                                      |
| **DAT-107** | A definition's `order` is a total order that includes every key column, or `multiset`; the connector hashes the rows in that order or sorted by their canonical text                                                                                                                                      |
| **DAT-068** | A definition declares `empty: 'valid'` or `'invalid'`, and a run of no rows against `invalid` fails, `empty_result`                                                                                                                                                                                       |
| **DAT-050** | A definition declares rows, bytes and seconds; a tenant setting lowers each, and a run takes the lesser                                                                                                                                                                                                   |
| **DAT-109** | The connector's deadline covers the whole execution, and a limit reached cancels at the source: a PostgreSQL cancel request, a SQL Server attention, an aborted HTTP or S3 exchange                                                                                                                       |
| **DAT-110** | Bytes are counted as they arrive, so a single value past the byte limit fails the execution, `byte_limit`                                                                                                                                                                                                 |
| **DAT-051** | Reaching the row, byte or time limit is `row_limit`, `byte_limit` or `timeout`, and nothing is stored                                                                                                                                                                                                     |
| **DAT-045** | A result cut by a limit is a failure and is never stored, so nothing can publish it as complete                                                                                                                                                                                                           |
| **DAT-108** | Where an S3 object or an HTTP response states a length, a digest or a row count apart from its framing, the connector checks what arrived against it and refuses, `result_incomplete`, what does not match                                                                                                |
| **DAT-096** | An `image` column declares `base64` or `binary`; the connector admits only a PNG or a JPEG by the asset door's header reading, the cell is the stored hash, and `ingest` decodes it before the dataset version is recorded                                                                                |
| **DAT-014** | `POST /v1/connections/{id}/sample` runs a draft definition with sample parameters, shows the result and its proposed columns, and stores nothing - so it runs before anything depends on the definition                                                                                                   |
| **DAT-015** | Every change to a definition is a version, and a binding names its definition with an optional `version`: present pins it, absent floats at latest                                                                                                                                                        |
| **DAT-016** | Where a definition is used - the bindings naming it and the documents resolving them - is computed when asked, and the definition's editor shows it before a version is saved                                                                                                                             |
| **DAT-025** | `use_connection`, decided at the connection, is needed to run anything against it; reading a document that holds its results needs only `read` on the document                                                                                                                                            |
| **DAT-077** | A query runs at the source as the identity its connection declares, so the source's own rules decide the rows; an `s3` connection's identity may only be `service`                                                                                                                                        |
| **DAT-090** | A stored result is read only through a document that resolves to it, on `read` on that document; fetching or accepting one asks `use_connection` and runs as the person                                                                                                                                   |
| **DAT-092** | `dataset` is an artifact kind; each recorded result is an immutable version of it, named by an insert-only `dataset_name`, and a resolution names exactly one dataset version                                                                                                                             |
| **DAT-083** | Every binding a document resolves, checked or pinned, is resolved to a dataset version, whose content is its provenance record                                                                                                                                                                            |
| **DAT-085** | A dataset version's content records the definition and connection with their versions, the canonical parameters, the SQL or request that ran, the identity, the time, the row count, `canonical: 1`, and the SHA-256 checksum; its own identifier is the dataset version                                  |
| **DAT-043** | A dataset version is an `artifact_version`, insert-only, which a baseline pins as it pins any version; its rows are an object nothing sweeps while anything names it                                                                                                                                      |
| **DAT-093** | Accepting adds a resolution row for that document's binding alone; another document holding the same dataset keeps its row, and its version, until somebody accepts there                                                                                                                                 |
| **DAT-084** | A check compares a fresh result with the one held only where the opener's identity key is the dataset's; a different checksum is recorded as a dataset version and answered as a waiting revision                                                                                                         |
| **DAT-037** | Accepting is its own route, and its resolution row names the version the binding held, the version it holds after, who and when                                                                                                                                                                           |
| **DAT-089** | Only the service calls the connector, only from a route a person calls - resolve, check, a sample run, describe and test - and neither the worker nor a publish nor a preview has a route to it                                                                                                           |
| **DAT-086** | Each act succeeds whole or fails by one named failure identifying the definition and, where the act has them, the binding and the document; a failed act records nothing                                                                                                                                  |
| **DAT-049** | Every failure carries `attribution`: `connector`, `query` or `product`, fixed per code ([Failures](#failures))                                                                                                                                                                                            |
| **DAT-029** | A binding names its definition in `query`, its `parameters`, and, inline, `take`, the value it takes                                                                                                                                                                                                      |
| **DAT-030** | A binding's parameter is `{ literal }` or `{ document }`, a document parameter by name, read from the document's parameter set when the binding is resolved                                                                                                                                               |
| **DAT-067** | An inline binding's `take` is `{ column }`, of a result of exactly one row, or `{ key, column }`; the schema admits nothing else, so a binding identifying neither is refused when it is written                                                                                                          |

## What this document does not own

| Left unclaimed                     | Why                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-013                            | **A named gap.** A query definition is permissioned like content and every change is a version, which is its audit, but "reviewable like content" is T3's content review (COL, LIF), which is not designed. Claimed when that review reaches a definition                                                                                                                                    |
| DAT-112                            | **A named gap.** Whether the connection's account holds privilege of its own is the source administrator's configuration. The connection test checks it where the source can say, and refuses asserted identity on an account found holding any, but the privilege can be granted after the test; nothing here makes it hold at each run. [Open questions](#open-questions) names the remedy |
| DAT-012                            | This design lets a definition declare its key (DAT-107); requiring one of a definition that feeds a bound table, which anything may be anchored to, is refused where a bound table is placed, which is `bindings.md`'s                                                                                                                                                                       |
| DAT-022                            | A query runs as its connection declares (above), and a definition's page shows it; making it visible to every author placing a binding is the editor's, `bindings.md`'s                                                                                                                                                                                                                      |
| DAT-024                            | The provenance record names whose view it is (DAT-085, claimed); the document showing it is `bindings.md`'s                                                                                                                                                                                                                                                                                  |
| DAT-027, DAT-031, DAT-032, DAT-033 | Substituting a value into running text, failing where a take selects more or less than one value, never rendering an empty string, and formatting by a style are where a value is read - the editor and the publish - `bindings.md`'s, with `tables.md` for a table's formatting                                                                                                             |
| DAT-028, DAT-069                   | A block binding's table and an empty result's statement are presentation, `tables.md`'s. The failure half of DAT-069 is DAT-068 and DAT-086 here                                                                                                                                                                                                                                             |
| DAT-097, DAT-098                   | A definition names an image's description column or declares it decorative here; the publish failing on a bound image with neither, and placing one in a cell, a line or a figure, are `bindings.md`'s                                                                                                                                                                                       |
| DAT-057, DAT-060, DAT-061, DAT-063 | Revising a resolved value by hand, and a revision meeting a source revision, are the editor's and the resolution's, `bindings.md`'s; DAT-061's reviewers and gate are also T3's COL and LIF                                                                                                                                                                                                  |
| DAT-082                            | A binding's `mode` is stored here and the check act is here; showing a revision beside the stored result is the editor's, so the row is `bindings.md`'s                                                                                                                                                                                                                                      |
| DAT-091                            | The accept route asks for the warning's acknowledgement ([Accept](#accept)); showing the warning to the person accepting is the editor's, `bindings.md`'s                                                                                                                                                                                                                                    |
| DAT-038                            | A baseline pins a dataset version as it pins any artifact version, but baselines are [storage-and-versioning.md](storage-and-versioning.md)'s and not built; its VER-019 `baseline_value` becomes that pin                                                                                                                                                                                   |
| DAT-039, DAT-070                   | A document's bindings in one view, and a floating binding flagged when its definition advances, are the editor's, `bindings.md`'s                                                                                                                                                                                                                                                            |
| DAT-041, DAT-042                   | Inspecting provenance from a value, and a publication carrying the provenance of every bound value (with PUB-049), are `bindings.md`'s                                                                                                                                                                                                                                                       |
| DAT-087                            | The code `binding_unresolved` is named in [Failures](#failures); a publish meeting a binding with no stored result is the publish's binding stage, `bindings.md`'s (PUB-099)                                                                                                                                                                                                                 |
| DAT-047, DAT-048                   | A failed binding shown in place, and a footnote by key whose row is gone (with CNT-039), are the editor's and the publish's, `bindings.md`'s                                                                                                                                                                                                                                                 |
| DAT-088, DAT-046                   | Neither the worker nor a preview has a route to the connector, so neither can query a source; reading each binding's stored result, and never publishing a placeholder, are the publish's binding stage, `bindings.md`'s                                                                                                                                                                     |
| DAT-058, DAT-059, DAT-062, DAT-072 | A person's revision of a value and the concurrency of binding acts on a component are `bindings.md`'s                                                                                                                                                                                                                                                                                        |
| DAT-026, DAT-111                   | Nothing caches a result in T2 (ADR-0035), so neither has anything to apply to. A dataset reused is one the same identity key asked for, and is reused only after the source answered with its checksum                                                                                                                                                                                       |
| DAT-052, DAT-094, IAM-083, IAM-084 | A declared cache life is T7; querying a stored dataset is T4; a dataset's own read grant and publishing only by one who sees every value are T7                                                                                                                                                                                                                                              |
| DAT-053, DAT-071                   | Execution attributed and throttled per tenant are T3                                                                                                                                                                                                                                                                                                                                         |
| IAM-082                            | Sign-out stopping a check or a creation in flight needs a stated bound, measured; [Open questions](#open-questions)                                                                                                                                                                                                                                                                          |
| TPL-063, TPL-065, TPL-019, TPL-041 | Establishing a document's bindings when it is made, and a template's parameters feeding them, are the `templates.md` additions'; they call resolve, below                                                                                                                                                                                                                                    |
| CNT-039, PUB-049, PUB-099          | `bindings.md`'s                                                                                                                                                                                                                                                                                                                                                                              |

The superseded rows - DAT-002, DAT-006, DAT-008, DAT-011, DAT-017, DAT-023, DAT-034, DAT-035,
DAT-036, DAT-040, DAT-044 and IAM-020 - are claimed by nobody. DAT-054, DAT-073 and DAT-079 are T5's.

## Five stored things

### The connection

`connection` joins `artifactKinds` as a spaced kind: `artifact_kind_check`, `artifact_space_by_kind`,
`spacedKinds` and the author check `artifact_version_component_author` each gain it, and
`VersionSubstance` gains an arm whose content is its settings. It is not content: `create` and `edit`
do not reach it, as they do not reach a template; `administer` creates and changes it
([Permissions](#permissions)).

In `packages/domain/src/data/connection.ts`, a zod schema and a check:

```ts
{
  schemaVersion: 1,
  name: string,                        // 1 to 200 characters, trimmed
  description: string,
  type: 'postgres' | 'sqlServer' | 'http' | 's3',
  source:                              // by type
    | { host: string, port: number, database: string, tls: 'require' | 'verifyFull' }   // postgres, sqlServer
    | { baseUrl: string, secretHeader: string }                                           // http: https only
    | { endpoint: string, region: string, bucket: string, pathStyle: boolean },           // s3
  identity:
    | { kind: 'service' }
    | { kind: 'endUser', mechanism: 'delegated', tokenEndpoint: string, audience: string }
    | { kind: 'endUser', mechanism: 'asserted', attribute: 'email' | 'subject',
        assertion?: 'sessionContext' | 'executeAs' },                                      // sqlServer only
  retired: boolean,
}
```

**What a version holds is what anybody who may read it sees**: never a secret. The check refuses a
`source` of another type's shape, an `http` base URL that is not `https`, a host that names a local
path or a socket, and an `identity` the type's connector does not declare (DAT-078): `postgres` and
`sqlServer` declare `asserted`, `http` declares `delegated`, and `s3` declares none, so its identity is
`service` (DAT-077). **Asserted identity's rules** (DAT-112 to DAT-114, ADR-0035) are the connector's
to apply: in PostgreSQL the role membership is `WITH INHERIT FALSE, SET TRUE` and the assertion is
`SET LOCAL ROLE` in a transaction the connector opens and ends; in SQL Server a `read_only`
`SESSION_CONTEXT` key or `EXECUTE AS USER ... WITH COOKIE`, whichever `assertion` names; where the
source cannot fail loud, the connector refuses an end-user query it has not asserted for.

**Retiring is a version** with `retired: true` and the settings unchanged. A retired connection runs
nothing and cannot be named by a new definition; everything stored from it still reads, and every
document holding its results still publishes, because a publish reads stored results. Nothing deletes
a connection (DAT-065).

### The credential

```sql
connection_credential (
  connection_id  uuid references artifact,
  sealed         text not null,        -- seal.ts's shape: v1, IV, tag, body
  set_by         uuid references principal not null,
  set_at         timestamptz not null
)                                      -- insert-only: UPDATE and DELETE revoked, as on the chain
```

The latest row is the credential. **It is sealed with the connector's key**, AES-256-GCM with the
additional data `source-credential:${tenantId}` - the platform's sealing shape, a new purpose, and a
key apart from the service's sealing key, which opens the object store credential and the sign-in
secret. The service never holds the connector's key, so it cannot open a credential it stores: it
hands the secret to the connector's `seal` request, stores what comes back, and passes the sealed
value in each later request; the connector never reaches the database. What the secret is depends on
the type: a password for a database, the header value for HTTP, an access key pair for S3, a client
secret for a delegated connection's token exchange.

**Write-only** (DAT-003, DAT-004): `PUT /v1/connections/{id}/credential` takes it; nothing answers it.
A connection's read says whether a credential is set, by whom and when. **Replacing it cuts no
version** (DAT-066): a credential is not a setting, and a version records what anybody may read. What
a connection resolves to, and every stored result, is unchanged by a rotation; the service tests the
connection straight after, and if the test fails it says so once, to the person rotating, naming
every definition that names the connection - rather than one broken document at a time.

### The query definition

`queryDefinition` joins the kinds as a spaced kind, as `connection` does. It is authored: `edit` in
its space makes and changes one ([Permissions](#permissions)). A version holds what
[What a query definition version holds](#what-a-query-definition-version-holds) lists, and names
exactly one connection by artifact identifier, not by version (DAT-009): a connection's settings
change under it by versions of their own, which is what a rotation or a moved host needs. A
definition may name a connection in any space its author holds `use_connection` on, because a
connection is configuration, not content.

### The dataset

`dataset` joins the kinds as a spaced kind, in its definition's space. **Its identity is the question**:

```sql
dataset (
  artifact_id        uuid primary key references artifact,
  query_definition   uuid not null references artifact,
  parameters_digest  text not null,    -- SHA-256 over the canonical parameters, RFC 8785
  identity_key       text not null,    -- service | asserted:<principal> | delegated:<issuer>|<subject>
  unique (query_definition, parameters_digest, identity_key)
)
dataset_name (dataset_id, name, named_by, named_at)   -- insert-only; the latest is the name
```

**Each recorded result is a version of it**, and that version's content is its provenance record
([Storage of results](#storage-of-results-and-provenance)) - immutable, as every version is (DAT-043).
Two documents asking the same question - one definition, the same parameters, the same identity -
share one dataset and may hold different versions of it. A dataset's name lives in `dataset_name`
because an artifact row takes no update; the latest row is the name (DAT-092).

The identity key is the identity **as the source sees it**: `service` for every service-account run,
the product principal for an asserted one, and the provider's issuer and subject for a delegated one.
It is what makes a check compare only like with like (DAT-084).

### The binding, in the component's content

The reserved inline `binding` (`packages/domain/src/content/model/inline.ts`, `{ type, query }` at
content schema 1) is widened to the binding's definition. **It never holds a result**: one component
serves many documents, each with its own parameters and its own accepted version, so a result held in
the component would be one document's, and CNT-030 already says a binding carries no value.

```ts
BindingCore = {
  id: string,                                    // stable across the component's versions
  query: string,                                 // a query definition's artifact identifier
  version?: string,                              // a version of it: pinned; absent floats at latest (DAT-015)
  parameters: Record<string,                     // by the definition's parameter names (DAT-030)
    | { literal: CanonicalValue | CanonicalValue[] }
    | { document: string }>,                      // the document parameter of that name
  mode: 'checked' | 'pinned',                    // DAT-082
}
InlineBinding = BindingCore & {
  type: 'binding',
  take: { column: string } | { key: Record<string, CanonicalValue>, column: string },   // DAT-067
}
```

A literal is written in the canonical form of its parameter's type: text, `true`, `false` or `null`.
A document's parameter set is the `templates.md` additions' (TPL-020); until a document has one, a
binding taking a document parameter fails to resolve there, `parameter_invalid`, as a required value
missing does.

**The schema admits the two `take` forms and no third**, so a binding naming neither a single-row
column nor a key and a column is refused when it is written (DAT-067). Whether the column exists, and
whether the definition declares that key, are checked where the binding is resolved, as a
cross-reference's target is ([the footnotes plan](../plans/2026-09-18-content-model-03-footnotes-and-cross-references.md),
decision G): a floating binding's definition can change after the component is saved, so a check at
write would prove nothing about the version it resolves against.

**In place at schema 1, or schema 2.** Content at schema 1 admits the old node, so changing it in
place is licensed only by evidence that nothing stored holds one - the precedent of the footnotes
plan's decision B and its stored-shape check. **The third slice's first step is that evidence query**,
over every version and iteration in every tenant Ken has run: none found, the node changes in place
at schema 1; any found, content goes to schema 2 with a migration step that refuses the old node by
name, since a bare `query` has no parameters, no take and no identifier to migrate to. The same step
holds the stored-shape check for each member above, as that plan's table does.

**A block binding** - a bound table - takes `BindingCore` and a presentation member that is
`tables.md`'s, settled before the first bound table is stored.

### The resolution, owned by the document

```sql
binding_resolution (
  document_id      uuid references artifact,
  node_id          text,               -- the component reference node in the document's outline
  binding_id       text,
  binding_digest   text,               -- SHA-256 over the binding's canonical form when resolved
  dataset_version  uuid references artifact_version,
  replaces         uuid references artifact_version,   -- what it held before, or null
  act              text check (act in ('resolve', 'accept')),
  resolved_by      uuid references principal,
  resolved_at      timestamptz
)                                      -- insert-only
```

The latest row for a document, a node and a binding is what that binding holds **in that document**.
Accepting a newer result adds a row that moves only that document (DAT-093); the rows, each naming
what it replaces, are the audit trail of every acceptance (DAT-037). **A resolution holds only while
its binding is unchanged**: where a component version changes a binding's query, parameters or take,
the digest no longer matches and the binding holds nothing in that document until it is resolved
again, so a result is never read for a question it did not answer. A publish records the resolutions
it read, as it records the component versions it read today; that record is `bindings.md`'s, with the
publish's binding stage.

## The connector

### A container of its own

`apps/connector` is a Node service in a container of its own, on two networks and no others:

- **`connector-private`**, an internal network shared only with the service, carrying the connector's
  one inbound interface. The service authenticates to it with a shared key, a platform secret in the
  service's and the connector's secret stores; production puts mutual TLS on it, which depends on
  hosting.
- **`connector-egress`**, the connector's own network out to tenants' sources, with no route to
  PostgreSQL, the object store, the identity provider or anything else of the platform's.

It holds no platform credential - no database login, no object store key - only its own sealing key
and the key the service authenticates with. That is case 1's answer: from the caller, only code stood between a hostile connection
and the platform, and code failed three ways; from the connector's network, every platform target
timed out while the tenant's source answered. **The service and the worker never reach a source
themselves.** The worker is not on `connector-private` at all.

### One request, one answer

| Request    | In                                                                                                                                                                                         | Out                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`      | The tenant, the connection version's settings, the sealed credential, the definition version (fetch, columns, key and order, limits), canonical parameter values, the identity, a deadline | The canonical result's bytes, its row count and SHA-256 checksum, the SQL or request that ran, the identity as the source saw it, its duration, and each image's bytes by hash - or one named failure |
| `describe` | The same, without parameters, and a fetch or none                                                                                                                                          | The source's tables and views, for the builder; or a SQL statement's result shape without running it; each with the column types proposed from the source's metadata                                  |
| `test`     | The tenant, the settings, the sealed credential                                                                                                                                            | `ok` with the account's checks, or `connection_failed` ([The connection test](#the-connection-test))                                                                                                  |
| `seal`     | The tenant and a secret                                                                                                                                                                    | The sealed value; nothing is kept                                                                                                                                                                     |

**The connector canonicalises and checksums**, with the canonical form's code in `packages/domain`, so
the service can hash the bytes it is given and refuse any that do not match before it stores them.
Nothing else crosses the interface: no route, no session, no tenant data but what the request carries.
The interface is also placement D's: an edge connector in a customer's network could answer it
later, which is a deployment, not a redesign (ADR-0035).

### A fresh process per request

**ADR-0035 left DAT-056's granularity to this design: one process per request.** The connector's
supervisor holds the sealing key, accepts a request, opens the one credential it carries, and starts a
fresh Node process handed that credential and the request on its standard input; the child connects,
runs, answers on its standard output and exits, and the supervisor kills it at the deadline. **The
child never holds the key**, so code that parses what a hostile source returns can open no other
tenant's credential; no memory is shared between tenants or requests; and no source connection is
pooled or reused, so there is no reset question (DAT-114). Case 2 priced it at 41 ms p50 against 5 ms
for a warm process - negligible now that a source is queried only when a person acts. It is revisited
if an act comes to run hundreds of queries, as a document made from a large template might.

### Identity

- **A service account** runs as the connection's own account, with the credential.
- **A delegated token**: the service passes the person's access token from the tenant's own provider,
  which the session holds sealed ([What the session holds](#what-the-session-holds)); the connector
  exchanges it by RFC 8693 for one the source trusts, naming the connector as the actor, uses it for
  the one request, and discards it. A person signed in through the Google route, or acting through a
  personal API token, has no such token, and an act on a delegated connection is refused,
  `identity_unavailable` (DAT-076).
- **Asserted identity**: the connection declares which sign-in attribute names the person at the
  source, `email` or `subject`; the service passes that value, and the connector asserts it by the
  source's mechanism. A person the source does not know is refused, `identity_unmatched`, by name
  rather than answered with nothing.

### The address guard

The guard lives in the connector, as defence in depth behind the network. **It allows the connection's
declared host, which may be a private address**, and refuses loopback, link-local and the platform's
own address ranges, which are the deployment's configuration; a tenant declares nothing else. It
normalises a host to what the operating system will dial - decimal, octal, IPv4-mapped IPv6 and a
trailing dot included - before checking it; resolves once and connects to the address it checked;
follows no redirect across hosts; and refuses a connection option that names a local path. An S3
endpoint is a host like any other.

### The connection test

`test` connects and authenticates, and answers **`ok`, or `connection_failed` for every failure to
reach or authenticate** - a refused port, a filtered one, an unknown host, a guarded address and a
wrong credential read the same, naming no address and echoing no credential (DAT-075, case 1's
oracle). **Once authenticated**, it checks the account where the source can say, and reports each
finding by name, since none reveals anything about the network: `account_not_read_only`, which
refuses the SQL fallback on that connection (DAT-103), and `account_holds_privilege`, which refuses
asserted identity (DAT-112). Each test is a row in `connection_test` - the connection version tested,
who asked and when, the answer and its findings - insert-only, and the latest is what the two refusals
read.

### What the session holds

For a delegated connection, **a session through the tenant's own provider holds the provider's access
token, sealed with the service's key under a purpose of its own, for the session's life, and deletes it
at sign-out**. No refresh token is held: an expired token fails the next data act by name,
`identity_expired`, and signing in again cures it. This is the session model change ADR-0035 names;
[service-foundations.md](service-foundations.md), under which the service keeps no provider token, is
changed by the slice that builds it (D7), not before.

### Deployment

The compose file gains the connector and its two networks; development and CI add source containers on
`connector-egress` - PostgreSQL 18, SQL Server 2022, a fake HTTP API and a fake token exchange, as the
spike ran. [system.md](system.md) draws the container and states ADR-0035's requirement on hosting:
**production must guarantee the connector's network has no route to any platform service, including
through a host that publishes a platform port** - case 1 found exactly that leak on Docker Desktop -
verified on production's own platform before connectors ship.

## What a query definition version holds

```ts
{
  schemaVersion: 1,
  title: string,
  description: string,
  connection: string,                                  // a connection's artifact identifier (DAT-009)
  parameters: Parameter[],
  fetch: BuilderFetch | SqlFetch | HttpFetch | FileFetch,
  columns: Column[],
  key: string[],                                       // column names; may be empty
  order: { column: string, direction: 'ascending' | 'descending' }[] | 'multiset',
  empty: 'valid' | 'invalid',                          // DAT-068
  limits: { rows: number, bytes: number, seconds: number },   // DAT-050
}
```

### Parameters

```ts
Parameter = {
  name: string,
  type: ColumnType,                                    // any but image
  required: boolean,
  list: boolean,
  permitted?: { values: CanonicalValue[] } | { minimum?: CanonicalValue, maximum?: CanonicalValue },
  variation?: Record<string, Fragment>,                // a key choosing a fragment the fetch declares
}
```

**One declaration shape for every connector type** (DAT-010, case 5). A value is checked against its
declaration before the connector is asked - its type in canonical form, presence, list, permitted
values or range - and one that fails refuses the act, `parameter_invalid`, naming the parameter, the
rule and the value (DAT-020). Text refuses U+0000, and a "contains" or "starts with" filter is bound
to a pattern-free function, never into `LIKE`. **A variation** is a parameter whose permitted values
are its fragments' keys (DAT-019): the value selects a fragment as an own property, and the fragment,
not the value, reaches the query - a sort column, a unit - so a parameter never changes a query's
shape (DAT-018).

**Each connector type binds by its own rules** (DAT-081, ADR-0035): a database value is the driver's
bound parameter, a list as one value (a PostgreSQL array; on SQL Server a JSON array read by
`OPENJSON`); on SQL Server a decimal and a sub-millisecond instant are bound as `NVARCHAR` and
`CAST` in the generated text; an HTTP value is placed by a builder that encodes it for its position
and refuses what the position cannot carry - a path segment refuses empty, `.`, `..`, `/`, `\` and
control characters, a header CR LF and surrounding whitespace, and neither takes a list; a file's
value is a typed filter the connector applies to its canonical rows.

### The fetch

- **`builder`**, for a database: a saved query tree with its own `format: 1`:

  ```ts
  Query = {
    sources: ({ alias: string, table: { schema?: string, name: string } }
            | { alias: string, query: Query })[],
    joins: { kind: 'inner' | 'left', source: string, on: Condition }[],
    select: { name: string, of: ColumnRef | { aggregate: 'count' | 'sum' | 'average' | 'minimum' | 'maximum', of?: ColumnRef } }[],
    where?: Condition,             // and, or, not over comparisons of a column with a parameter or a literal
    groupBy: ColumnRef[],             // ColumnRef: a source's alias and a column in it
    orderBy: { of: ColumnRef, direction: 'ascending' | 'descending' }[],
    limit?: number,
  }
  ```

  **The format admits several joined sources and nested queries from the start**, so multi-join
  queries arrive later with no migration of a saved query (DAT-100). **T2's screens offer one table or
  view**, its columns, filters on parameters, sort, a limit and the five aggregates, grouped; a join in
  T2 is written in the SQL fallback, or defined as a view at the source. The connector generates the
  dialect's SQL from the tree at every run - PostgreSQL's first, then SQL Server's - and provenance
  keeps the SQL that ran (DAT-099). Product-generated text is what keeps PostgreSQL's asserted identity
  safe (cases 3 and 5).

- **`sql`**, the fallback: text with named parameters, `:site`, always bound by the driver, and a
  variation placed at a marker the text declares. Saving one needs `write_sql` on the connection
  (DAT-101). It is refused, `sql_not_permitted`, on a PostgreSQL connection whose identity is asserted,
  when saved and when run (DAT-102), and on any connection whose last test found its account not
  read-only (DAT-103).
- **`http`**: a request template - method, path segments, query string, headers and a JSON body, each
  part fixed or a parameter - and where the rows are: JSON at a pointer, JSON Lines, CSV or XLSX
  (DAT-104). The connection's secret goes in its declared header, never in the URL, and no code path
  logs or returns a request's URL.
- **`file`**, for S3: an object key whose segments may be parameters, the format - CSV with its
  declared convention for null, XLSX with a sheet, JSON at a pointer, JSON Lines - and column selection,
  filters and a sort over the canonical rows.

**JSON** (DAT-095) is read at a JSON Pointer to an array of objects, or as JSON Lines; a column maps
by a pointer relative to the row; a number is read from its source text, never through a double; a
nested object or array is refused, `nested_value`, unless its column is text. **XLSX** is read by the
product's own reader over `fflate` and `saxes`, converting serials in the workbook's date system and
refusing serial 60; **CSV** by `csv-parse`, which reports whether a field was quoted. Neither SheetJS
nor ExcelJS (ADR-0035).

### The columns, a second step

A definition is written in the order ADR-0035 sets: the connection; the fetch and its parameters; a
**sample run**; then the columns (DAT-080, DAT-105).

```ts
Column = {
  name: string,
  from: { column: string } | { pointer: string } | { header: string } | { letter: string },
  type:
    { base: 'text' } |
    { base: 'integer' } |
    { base: 'decimal', precision: number, scale: number } |
    { base: 'date' } |
    { base: 'time', fraction: number } |
    { base: 'localDateTime', fraction: number } |
    { base: 'instant', fraction: number } |
    { base: 'boolean' } |
    {
      base: 'image',
      encoding: 'base64' | 'binary',
      description: { column: string } | 'decorative',
    },
};
```

**Each column is proposed**: from the source's own metadata through `describe`, for the builder and
SQL; from the sample, for HTTP and files, where the author must confirm each because a sample cannot
prove a decimal's precision. Nothing is saved until the author has confirmed every column. **The
declared columns and the order are the contract** (DAT-106): the connector refuses, `result_mismatch`,
a run whose columns or rows do not fit, and never adjusts one; a value a source cannot deliver exactly
in its declared type is refused by name - `precision_lost`, `precision_not_carried`, `zone_missing`,
`nonexistent_date`, `cell_error` - never rounded. An image column's description is a column the
definition names, or it is declared decorative (DAT-097's declaration; its failure at publish is
`bindings.md`'s).

### Key, order, empty, limits

- **Key and order** (DAT-107): the key columns, and an order that is total and includes every key
  column, or `multiset`. The rows are hashed in that order, or sorted by their canonical text as a
  multiset, so rewriting unchanged rows moves no checksum - case 6 flagged unchanged data as moved in
  19 of 19 refreshes without it.
- **Empty** (DAT-068): whether no rows is a valid answer; a run of no rows against `invalid` fails,
  `empty_result`, exactly as any failure does.
- **Limits** (DAT-050): rows, bytes and seconds. A tenant setting lowers each, and a run takes the
  lesser of the definition's and the tenant's. The product's own ceilings and defaults are an
  [open question](#open-questions) the first slice settles.

### Searchable

`queryDefinition` joins `searchKinds` (SCH-055). Its entry is written with each version, as every
kind's is, from its title, its description, its column names and its connection's name; renaming a
connection rewrites the entries of the definitions naming it, in the same transaction. A connection
and a dataset are not search entries in T2: a connection is found on its space's Connections page,
and a dataset is read only through a document.

## Permissions

The closed set gains two, **both decided at the connection** - held there by a grant on it, or on its
space or the tenant, walked as every permission is:

| Permission       | Lets the principal                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ |
| `use_connection` | Run anything against the connection: a sample run, describe, test, resolve and check |
| `write_sql`      | Save a query definition whose fetch is SQL against the connection                    |

Adding them is the code change and the migration access.md names: `permissions` in
`packages/domain/src/access/permissions.ts`, and the check constraints `role_permissions_closed` and
`api_token_scopes_closed`. **No starting role gains either**, so using a connection is always granted
on purpose; the external cap gains both.

| Act                                                     | Needs                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Making, changing, retiring a connection; its credential | `administer` on the space to make one, on the connection otherwise                            |
| Making and changing a query definition                  | `edit` in its space; `use_connection` on the connection it names; `write_sql` for a SQL fetch |
| A sample run, describe, test                            | `use_connection`                                                                              |
| Resolve                                                 | `edit` on the document, `read` on the definition, `use_connection`                            |
| Check                                                   | `read` on the document and `use_connection`; without it, nothing is checked for that person   |
| Accept                                                  | `edit` on the document                                                                        |
| Reading a stored result                                 | `read` on a document that resolves to it (DAT-090)                                            |

**Using a connection is separate from reading a document that uses it** (DAT-025): a reader of the
document reads its stored results and never needs `use_connection`, and the source's own rules
govern only who may fetch a result or accept one - which ADR-0035's answer to DAT-Q03 makes the
document's permission, not the source's, the rule for reading.

## Storage of results and provenance

**The canonical result is an object.** The rows, in ADR-0035's canonical form version 1 - the
declared columns as `[name, base type]` pairs and the rows, every cell a JSON string, boolean or
`null`, serialised as RFC 8785 canonical JSON - are stored in the tenant's object store under the
SHA-256 of their own bytes, `t_<tenant>/sha256/<hex>`. **The checksum is the object key**: identical
results are stored once, the bytes cannot change without the key changing, and a publish pins them by
hash as it pins an image. Chosen over the rows as JSONB in the version row, which would carry every
result in the chain's own table, and over a table of rows, which would be thousands of inserts per
result; a relational form for T4's querying can be derived later from the immutable objects,
additively.

**A dataset version's content is the provenance record** (DAT-085), small JSONB:

```ts
{
  schemaVersion: 1,
  queryDefinition: { artifact: string, version: string },
  connection: { artifact: string, version: string },
  parameters: Record<string, CanonicalValue | CanonicalValue[]>,
  ran: { sql: string } | { request: { method: string, target: string, headers: string[] } },  // never a secret
  identity: { kind: 'service' } | { kind: 'endUser', mechanism: 'delegated' | 'asserted',
              principal: string, signInRoute: string, asSeen: string },
  at: string, durationMs: number, rowCount: number,
  columns: Column[],
  canonical: 1,
  checksum: string,                                    // the object's key
  images: Record<string, string>,                      // an image's hash to the asset version admitted for it
}
```

`ran` records what ran without its secret: a request's target is recorded as the template's path
with its parameters, not a URL that could carry one, and a header by name alone.

- **Reading a dataset** is through a document that resolves to it, on `read` on that document
  (DAT-090). Browsing datasets in their own right, and querying them, wait for T4 (DAT-094).
- **Nothing sweeps a dataset in T2.** An object is held while any dataset version, publication or
  baseline names it, as an asset's are.
- **Images** (DAT-096): the connector reads each image cell from its declared encoding, admits only a
  PNG or a JPEG by the asset door's own header reading in `packages/domain`, keeps the image alone as
  the door does, and puts its SHA-256 in the cell, so the checksum is stable however the source
  encodes it. The service stores each image's bytes by hash and queues `ingest`, which decodes them
  whole as it does an upload; an image whose hash an asset in the space already holds reuses that
  asset. **The dataset version and the resolution are recorded only once every image is admitted** -
  the screen checks back, as it does for an upload - and one image refused refuses the whole result,
  `image_refused`, naming its row and column.

## Acts, revisions and failures

Five acts touch a source, each at a person's request, each succeeding whole or failing by name
(DAT-086, DAT-089). **Only the service calls the connector, only from these routes**; the worker never
does, and a preview or a publish reads stored results alone.

### Resolve

Placing a binding, and creating a document from a template, which is the same act for each of its
bindings. The service reads the binding in the component the document references, resolves its
parameters - literals, and the document's own by name - validates them, and asks the connector to run
the definition **as that person, in that document's context**. The dataset is found or made from
(definition, parameters digest, identity key); **if the checksum equals the dataset's latest version's,
that version is reused**, otherwise a new version is recorded; and a resolution row is added. Resolving
a binding again under one's own identity - fetching one's own view - is the same act, and carries
DAT-091's acknowledgement where the identity is the person's own.

### Check

Opening a document with checked bindings. For each, **the service re-runs only where the opener's
identity key is the dataset's** - a service-account connection always, an end-user one only for the
identity whose view is stored (DAT-084). For anybody else a different result is a different view, not
a source that moved, and is never flagged. A different checksum is **recorded as a new dataset version
but not resolved to**: it is the waiting revision, answered to the screen beside what the document
holds. Accepting it later accepts exactly the rows the person saw, with no second query. Pinned
bindings are never checked.

### Accept

Adds a resolution row naming the waiting version and the one it replaces (DAT-037, DAT-093). It needs
`edit` on the document and **queries nothing**. Where the version was fetched under the accepting
person's own identity, the request must carry `sharesOwnView: true`, or it is refused,
`acknowledgement_required`: the screen's warning that everybody who may read the document will see it
is `bindings.md`'s (DAT-091), and the route will not accept without it.

### Sample run, describe and test

A **sample run** is a query author's, with `use_connection`, on a draft definition, and stores nothing
(DAT-014). **Describe** and **test** store nothing but the test's findings. A dataset exists only once
a binding is resolved.

### Rotation, where used and retiring

- **Rotation** (DAT-066): changes no stored result; the service tests the connection straight after,
  and reports a failure once, naming every definition that names the connection.
- **Where used** (DAT-016, DAT-064): computed when asked, never stored beside what it counts - the
  definitions naming a connection, from their latest versions; the components whose latest versions
  hold a binding naming a definition; the documents resolving those bindings. A route answers the ones
  the caller may read by name and counts the rest. When [relationships.md](relationships.md)'s
  reference index is built, a binding is one more reference it records.
- **Retiring** a connection or a definition shows its uses first; a connection is refused while a
  definition that is not retired names it (DAT-065). Nothing is deleted.

### Audit

Newer results and acceptances are the dataset versions and the resolution rows (DAT-037); changes to
a connection are its versions and its credential rows (DAT-007); changes to a definition are its
versions, which is DAT-013's audit half. When LIF's log is designed, each act is an event in it too.

### Failures

Every failure is one code, `attribution` fixed per code (DAT-049), naming the definition and, where
the act has them, the binding and the document (DAT-086). A failed act records nothing.

| Code                      | Attribution | When                                                                                           |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `connection_failed`       | connector   | Any failure to reach or authenticate, one reason for all (DAT-075)                             |
| `address_refused`         | connector   | The guard refused the address, in a run; a test says `connection_failed`                       |
| `timeout`                 | connector   | The deadline passed; the source was cancelled (DAT-109)                                        |
| `row_limit`, `byte_limit` | query       | A limit was reached; nothing stored (DAT-051, DAT-110)                                         |
| `result_incomplete`       | connector   | A stated length, digest or row count did not match what arrived (DAT-108)                      |
| `result_mismatch`         | query       | Columns or order did not fit the declaration (DAT-106)                                         |
| `precision_lost` and kin  | query       | A value was not exact in its declared type (DAT-080)                                           |
| `nested_value`            | query       | A nested JSON value in a column not declared text (DAT-095)                                    |
| `image_refused`           | query       | An image was not a PNG or a JPEG, or `ingest` refused it (DAT-096)                             |
| `empty_result`            | query       | No rows, where the definition says empty is invalid (DAT-068)                                  |
| `identity_unavailable`    | product     | A delegated act by a person with no provider token (DAT-076)                                   |
| `identity_expired`        | connector   | The provider token has expired; sign in again                                                  |
| `identity_unmatched`      | connector   | The source does not know the asserted person                                                   |
| `sql_not_permitted`       | product     | A SQL fetch on a connection that refuses one (DAT-102, DAT-103)                                |
| `parameter_invalid`       | product     | A value failed its declaration before anything ran (DAT-020)                                   |
| `binding_unresolved`      | product     | A publish met a binding with no stored result - raised by the publish (DAT-087, `bindings.md`) |

## Routes

| Route                                       | Permission                                                      | Does                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/connections`       | `administer` on the space                                       | Makes a connection at 0.1 from settings that pass the check                                                                  |
| `GET /v1/connections`                       | Signed in                                                       | The connections the caller may read                                                                                          |
| `GET /v1/connections/{id}`                  | `read` on the connection                                        | Its latest version, whether a credential is set and by whom and when, and the latest test's findings                         |
| `POST /v1/connections/{id}/versions`        | `administer` on the connection                                  | Cuts a version from `openedFrom` and whole settings; retiring is `retired: true`, refused while in use                       |
| `PUT /v1/connections/{id}/credential`       | `administer` on the connection                                  | Seals the secret through the connector, adds a credential row, tests the connection and answers the test with its dependents |
| `POST /v1/connections/{id}/test`            | `use_connection`                                                | The connection test                                                                                                          |
| `POST /v1/connections/{id}/describe`        | `use_connection`                                                | Tables and views, or a draft SQL fetch's result shape                                                                        |
| `POST /v1/connections/{id}/sample`          | `use_connection`, and `write_sql` for a SQL fetch               | Runs a draft definition with sample parameters; answers rows and proposed columns; stores nothing                            |
| `GET /v1/connections/{id}/uses`             | `read` on the connection                                        | Where it is used                                                                                                             |
| `POST /v1/spaces/{space}/query-definitions` | `edit` on the space, `use_connection`                           | Makes a definition at 0.1                                                                                                    |
| `GET /v1/query-definitions`                 | Signed in                                                       | The definitions the caller may read                                                                                          |
| `GET /v1/query-definitions/{id}`            | `read` on the definition                                        | Its latest version, and its connection's name and identity                                                                   |
| `POST /v1/query-definitions/{id}/versions`  | `edit` on the definition, `use_connection`, `write_sql` for SQL | Cuts a version from `openedFrom`; retiring is a version too                                                                  |
| `GET /v1/query-definitions/{id}/uses`       | `read` on the definition                                        | Where it is used                                                                                                             |
| `GET /v1/documents/{id}/bindings`           | `read` on the document                                          | Each binding's resolution, its dataset version's provenance, and any waiting revision                                        |
| `POST /v1/documents/{id}/bindings/resolve`  | `edit` on the document, `use_connection`                        | Resolves the named bindings                                                                                                  |
| `POST /v1/documents/{id}/bindings/check`    | `read` on the document                                          | Checks the document's checked bindings where the caller's identity key allows, with `use_connection`                         |
| `POST /v1/documents/{id}/bindings/accept`   | `edit` on the document                                          | Accepts a waiting version for one binding                                                                                    |
| `GET /v1/documents/{id}/datasets/{version}` | `read` on the document                                          | A dataset version's rows, where the document resolves to it or has it waiting                                                |
| `PUT /v1/datasets/{id}/name`                | `edit` on the dataset                                           | Names a dataset                                                                                                              |
| `GET /v1/settings/data`, `PUT` the same     | `read`, and `administer` at the tenant to change                | The tenant's lowered limits                                                                                                  |

## Where the code lives

| Where                                                          | What                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/connector`                                               | The supervisor, the per-request child, the guard, the drivers (`pg`, `tedious`), the HTTP and S3 clients, the readers, SQL generation per dialect  |
| `domain: src/data/`                                            | Connection and query definition schemas, the parameter declaration and its checks, the query tree, the column vocabulary, the canonical form       |
| `domain: src/content/model/inline.ts`                          | The binding inline, widened                                                                                                                        |
| `domain: src/access/permissions.ts`                            | `use_connection` and `write_sql`                                                                                                                   |
| `domain: src/search/`                                          | `queryDefinition` as a search kind                                                                                                                 |
| `db: migrations/tenant/`                                       | One migration per slice: the connection kind and its credential (D1), the query definition kind (D2), the dataset kind, names and resolutions (D3) |
| `db: src/connections.ts`, `queryDefinitions.ts`, `datasets.ts` | Making, reading and versioning each; the credential rows; resolutions; where used                                                                  |
| `service: src/data/`                                           | The routes, the connector client and its shared key, the five acts                                                                                 |
| `worker: src/jobs/ingest.ts`                                   | Admitting a bound image's bytes, as an upload's                                                                                                    |
| `web: src/data/`                                               | The Connections page and the query definition editor                                                                                               |
| `deploy/compose.yaml`                                          | The connector, `connector-private` and `connector-egress`, and development's source containers                                                     |

## Verification

- `apps/connector`: a suite against real sources - PostgreSQL 18 and SQL Server 2022 containers, a
  fake HTTP API and a fake token exchange, as the spike ran. **The spike's lists become regression
  suites**: case 1's targets and spellings through the guard, case 2's failure modes asserting the
  secret in no log, error, test answer or crash dump, raw, URL-encoded or base64 (DAT-005), and case
  5's hostile and ill-typed values through every parameter type (DAT-021). **Cross-source checksum
  fixtures**: one table read from every source and reader gives one checksum, in several time zones
  (case 6). Each limit fails by name and cancels at the source (case 7).
- `packages/domain`: each schema refusing what its check refuses; the canonical form's rules per type;
  the query tree's format admitting joins and nested queries.
- `packages/db`: each kind made, read and versioned by the one mechanism; credential and resolution
  rows refusing an update; a dataset's identity unique; an object held while named.
- `apps/service`: every route with its permission; each act succeeding whole or failing by name and
  recording nothing; a check comparing only like identity keys; the credential in no log or error on
  its way through.
- **CI's whole-system job gains the source containers.** Ken accepted SQL Server Developer edition's
  licence for development and test use on 2026-09-29; it is never shipped.

## Decisions

Taken as recommended, approved by Ken on 2026-09-30.

| #    | Decision                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-A | Five stored things: a connection, a query definition and a dataset as artifact kinds in a space; a binding's definition in the component's content; a resolution per document                |
| DA-B | A connection's version holds its visible settings; its credential is sealed with the connector's key in an insert-only table, write-only from every client, and replacing it cuts no version |
| DA-C | `use_connection` and `write_sql`, both held on the connection, join the closed set; a definition is made and changed with `edit` in its space                                                |
| DA-D | `apps/connector` is a container on its own network with no route to the platform, reached only by the service over a private network with a shared key, mutual TLS in production             |
| DA-E | One fresh process per request, answering DAT-056's granularity; revisited if an act comes to run hundreds of queries                                                                         |
| DA-F | Only the service calls the connector, and only on a person's act; the worker never does, but completes a result's images through `ingest`                                                    |
| DA-G | The guard is the connector's: the connection's declared host allowed, private or not; loopback, link-local and the platform's ranges refused; tenants declare nothing else                   |
| DA-H | Delegated identity passes the person's provider access token, held sealed by the session with no refresh token; asserted identity names the person by a declared sign-in attribute           |
| DA-I | A definition version holds parameters, one of four fetches, columns, key and order, empty and limits; one parameter shape for every source                                                   |
| DA-J | The builder saves a query tree with its own format version that admits joins and nested queries from the start; T2's screens offer one source; SQL is generated per dialect at each run      |
| DA-K | The SQL fallback is named parameters, driver-bound, behind `write_sql`, refused on PostgreSQL's asserted identity                                                                            |
| DA-L | Columns are the second step, after a sample run, proposed from `describe` or the sample and confirmed by the author                                                                          |
| DA-M | A result is an object keyed by the SHA-256 of its canonical bytes; the provenance record is the dataset version's content                                                                    |
| DA-N | A dataset is identified by its definition, its parameters' digest and the identity key; names are insert-only, latest wins                                                                   |
| DA-O | The binding inline is widened in place at schema 1 only if the evidence query finds none stored, otherwise schema 2 with a migration step                                                    |
| DA-P | Resolutions are insert-only rows per document, node and binding; accepting moves only that document                                                                                          |
| DA-Q | Five acts touch a source. A check records a different result as a waiting dataset version; accepting it adds a resolution row and queries nothing                                            |
| DA-R | A stored result is read through a document, on the document's permission; browsing datasets waits for T4; nothing sweeps a dataset in T2                                                     |
| DA-S | Where used is computed, not stored; retiring shows the uses first; nothing is deleted                                                                                                        |
| DA-T | A rotation tests the connection straight after and reports a failure once, naming every dependent definition                                                                                 |
| DA-U | Every failure is a named code attributed to the connector, the query or the product                                                                                                          |
| DA-V | Built in eight slices, D1 to D8, each with its own plan, `bindings.md` designed after D3                                                                                                     |

### Settled while writing, for Ken's review

Not in the design Ken approved; each is what the approved design needed to be built, and open to
reversal.

| #     | Decision                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-W  | **A fourth request, `seal`.** The service never holds the connector's key, so it cannot seal a credential itself; it hands the secret to the connector, which answers the sealed value and keeps nothing                                                                                      |
| DA-X  | **The supervisor holds the key; the child holds one credential.** Code that parses a hostile source's answer never holds the key that opens every tenant's credentials                                                                                                                        |
| DA-Y  | **`administer` makes and changes a connection and sets its credential**, on the space and on the connection. A connection is configuration, its credential reaches a tenant's systems, and `create` and `edit` would put it in every author's hands                                           |
| DA-Z  | **Naming a connection in a definition needs `use_connection`**, when it is made and at each version, since choosing a connection is using it                                                                                                                                                  |
| DA-AA | **A resolution records its binding's digest**, and holds only while the binding is unchanged, so a changed question is never answered by an old result                                                                                                                                        |
| DA-AB | **Retiring a connection is refused while a definition that is not retired names it** (DAT-065), and retiring is a version with `retired: true`                                                                                                                                                |
| DA-AC | **The connection test reports the account's checks by name after it authenticates**, while every failure to reach or authenticate reads the same. DAT-103 asks the test to check read-only, which one reason for every failure could not report                                               |
| DA-AD | **The connector checks a stated length, digest or row count** (DAT-108): an S3 object's size and stored checksum where the store gives one, and an HTTP response's row count where the definition declares a pointer to it. A body stating none is taken as it arrives, bounded by the limits |
| DA-AE | **The accept route asks for `sharesOwnView: true`** where the result is the person's own view, so the API cannot accept past DAT-091's warning                                                                                                                                                |

## What was ruled out

- **The rows as JSONB in the version row**, which would put every result in the chain's own table,
  and **a table of rows**, thousands of inserts per result. An object by hash is stored once, cannot
  change, and is pinned as an image is.
- **A result in the binding.** One component serves many documents, each with its own parameters and
  its own accepted version.
- **The service or the worker reaching a source.** Case 1: code alone was one mistake from a route
  into the platform, three ways.
- **A publish or a preview running a query** - ADR-0034's pass-through publish, the token beside the
  job, the refresh token and its lock - superseded by ADR-0035.
- **A warm or pooled connector process.** It would share memory between tenants and requests, and a
  pooled source connection that carried a user's identity would need a reset shown to clear it.
- **Tenants declaring private address lists.** The connection's declared host is the declaration.
- **A result cache.** None in T2 (ADR-0035).
- **Deleting a connection or a definition.** Retiring keeps every stored result readable and every
  document publishable.

## Open questions

| Question                                                                                                                                                        | Where it goes                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| The default limits - rows, bytes, time - and the product's ceilings                                                                                             | D1's plan, from the spike's case 7          |
| Mutual TLS between the service and the connector in production                                                                                                  | Hosting, which is open (system.md)          |
| The cadence and latency of the check on opening a document with many bindings, and the concurrency of a creation's resolves (case 4: 1.4 to 1.8 s for 440 at 8) | D3's plan, and the `templates.md` additions |
| IAM-082's stated bound for a check or a creation stopped by a sign-out                                                                                          | D3's plan, measured                         |
| Checking the account's own privilege at each asserted run, which would let DAT-112 be claimed                                                                   | D7's plan                                   |
| Comparison and order under each source's collation, where two keys compare equal                                                                                | D4 and D5's plans                           |
| A nested JSON value kept as text: its source text or a canonical form, which decides whether reformatting at the source moves a checksum                        | D6's plan                                   |
| How a new definition version a floating binding would take, or a changed parameter value, is offered                                                            | `bindings.md` (DAT-070)                     |

## Build order

Each slice has a plan of its own, written when its turn comes.

| Slice  | What                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | The connection kind and its sealed credential; `use_connection` and `write_sql`; `apps/connector` with a process per request, the guard, PostgreSQL, `test`, `describe` and `seal`; the compose networks; a Connections page |
| **D2** | The query definition kind: parameters, the SQL fallback, columns second, the sample run, canonicalising and checksumming in the connector; search                                                                            |
| **D3** | Datasets and resolutions: the dataset kind, objects keyed by checksum, provenance, resolve, check and accept; the binding inline widened after the evidence query. **`bindings.md` is designed after D3**                    |
| **D4** | The builder: the saved query tree, PostgreSQL's SQL generated from it, its screens                                                                                                                                           |
| **D5** | SQL Server: `tedious`, its dialect, `NVARCHAR` and `CAST`                                                                                                                                                                    |
| **D6** | HTTP and S3 connections and the file formats: the product's own XLSX reader, CSV and JSON                                                                                                                                    |
| **D7** | End-user identity: the delegated token, with the session holding the provider's token, and asserted identity on PostgreSQL and SQL Server                                                                                    |
| **D8** | Image columns through `ingest`                                                                                                                                                                                               |

Then `tables.md`, and the `templates.md` additions: a template's parameters, and a document's
bindings established when it is made.
