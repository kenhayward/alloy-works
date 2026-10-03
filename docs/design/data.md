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

| ID          | How it is met                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-001** | `connection` is an artifact kind in one space of one tenant's schema; its version carries a `name` and the settings of one source ([The connection](#the-connection))                                                                                                                                                                     |
| **DAT-074** | A connection's `type` is `postgres`, `sqlServer`, `http` or `s3`, and a query definition's fetch reads CSV, XLSX, JSON or JSON Lines from an S3 object or an HTTP response; every one is pulled by the connector                                                                                                                          |
| **DAT-003** | The credential is sealed into `connection_credential` in the tenant's schema, with a key only the connector holds; no route answers it, so it is write-only from every client                                                                                                                                                             |
| **DAT-004** | `GET /v1/connections/{id}` answers `credential: { set, setBy, setAt }` from the latest credential row, and nothing a route answers carries the sealed value or the secret                                                                                                                                                                 |
| **DAT-005** | The secret is opened only in the connector's per-request child, goes in a header never a URL, and is kept out of every log, telemetry event, export, crash report and error; the spike's case 2 matrix becomes a test for each path, in the service and in the connector                                                                  |
| **DAT-075** | `test` answers `ok`, or `connection_failed` alike for a refused or filtered port, an unknown host, a guarded address and a wrong credential, naming no address and echoing no credential; checks of the authenticated account are reported after it by name ([The connection test](#the-connection-test))                                 |
| **DAT-007** | Every change to a connection's settings is a version, so what changed is a comparison of two versions; every credential set or replaced is a row naming who and when and never the value; a connection is never deleted, and retiring it is a version                                                                                     |
| **DAT-076** | `identity` is `service`, or `endUser` by `delegated` or `asserted`; a delegated act needs the provider access token a session through the tenant's own provider holds, so a Google-route session or a personal API token is refused, `identity_unavailable`                                                                               |
| **DAT-078** | Each connection type's connector declares the mechanisms it supports - `postgres` and `sqlServer` asserted, `http` delegated, `s3` none - and a connection version declaring another is refused, `identity_not_supported`                                                                                                                 |
| **DAT-064** | Where a connection is used - the definitions naming it and, through their bindings and resolutions, the documents - is computed when asked, `GET /v1/connections/{id}/uses`, and the retire screen shows it before it proceeds                                                                                                            |
| **DAT-065** | Nothing deletes a connection; retiring one is refused, `connection_in_use`, naming each definition that is not itself retired and names it, so no definition is left pointing at nothing and nothing cascades                                                                                                                             |
| **DAT-066** | Setting a credential inserts a row and cuts no version, so no stored result or resolution changes; the service tests the connection at once and, on a failure, reports it once, naming every definition that names the connection                                                                                                         |
| **DAT-056** | The connector holds no platform credential and has no route to the platform; each request runs in a fresh process handed one opened credential, which exits with the request                                                                                                                                                              |
| **DAT-113** | On PostgreSQL an asserted identity runs only builder-generated text, the SQL fallback refused; on SQL Server the assertion is a `read_only` `SESSION_CONTEXT` key or `EXECUTE AS USER ... WITH COOKIE` with the cookie held by the connector                                                                                              |
| **DAT-114** | No source connection is reused: the child process that opened it closes it and exits with its one request, so a connection that carried a user's identity is always discarded                                                                                                                                                             |
| **DAT-009** | `queryDefinition` is an artifact kind in one space whose version carries a `title` and exactly one `connection`, a connection artifact's identifier                                                                                                                                                                                       |
| **VER-057** | A query definition versions through `artifact_version` by `recordVersion`, with an author, `schemaVersion`, the digest and the insert-only grant every artifact has; a change is a new version from `openedFrom`                                                                                                                          |
| **SCH-055** | `queryDefinition` is a search kind, its entry written with each version from its title, description and column names                                                                                                                                                                                                                      |
| **DAT-010** | Each parameter declares `name`, `type` from the column vocabulary but `image`, `required`, `list`, and `permitted` values as a list or a range                                                                                                                                                                                            |
| **DAT-019** | A variation is a parameter whose permitted values are the keys of fragments the definition declares; its value selects one as an own property and is never placed in the query                                                                                                                                                            |
| **DAT-020** | Every value is checked against its declaration before the connector is asked, and a value that fails refuses the act, `parameter_invalid`, naming the parameter, the rule and the value                                                                                                                                                   |
| **DAT-081** | A database value is the driver's bound parameter; an HTTP value is placed by a builder that encodes it for its position and refuses what that position cannot carry; a file's is a typed filter over canonical rows. No path splices a value into text                                                                                    |
| **DAT-018** | Sources, columns, joins and conditions are the definition's own structure or text; a parameter supplies a value or, as a variation, selects among declared fragments, so no parameter changes a query's shape                                                                                                                             |
| **DAT-021** | The connector's suite runs the spike's case 5 values - 3,792 hostile and ill-typed - through every parameter type and every binder, and each is refused by name or bound inert                                                                                                                                                            |
| **DAT-099** | A database definition's fetch is `builder`, a saved query tree, unless it is `sql`; the connector generates the dialect's SQL from the tree at each run, and provenance keeps what ran                                                                                                                                                    |
| **DAT-100** | The tree's format, version 1, admits several sources, joins, nested queries as sources, grouping and aggregates from the start, though T2's screens offer one source                                                                                                                                                                      |
| **DAT-101** | Saving a definition whose fetch is `sql` needs `write_sql`, a permission of its own decided at the connection it names                                                                                                                                                                                                                    |
| **DAT-102** | A `sql` fetch is refused, `sql_not_permitted`, on a PostgreSQL connection whose identity is asserted, when saved and when run                                                                                                                                                                                                             |
| **DAT-103** | The connection test checks, where the source can say - PostgreSQL's and SQL Server's catalogues - that the account holds no write privilege, and a `sql` fetch is refused on a connection whose last test did not find it read-only                                                                                                       |
| **DAT-104** | An `http` fetch is a request template - method, path segments, query, headers and a JSON body, each part fixed or a parameter - with the format and, for JSON, a pointer to the rows                                                                                                                                                      |
| **DAT-095** | JSON is read at a JSON Pointer to an array of objects or as JSON Lines; each column maps by a pointer relative to the row; a number is read from its source text; a nested value is refused, `nested_value`, unless its column is text                                                                                                    |
| **DAT-080** | A column's type is one of `text`, `integer`, `decimal` with precision and scale, `date`, `time`, `localDateTime`, `instant` with a fractional precision, `boolean` or `image`; a value not exact in its type is refused by name, never rounded                                                                                            |
| **DAT-105** | The columns are the second step: proposed from `describe` for the builder and SQL, from the sample for HTTP and files, and saved only as the author confirms each                                                                                                                                                                         |
| **DAT-106** | The connector checks every run against the declared columns and order and refuses, `result_mismatch`, a result that does not fit, never adjusting it                                                                                                                                                                                      |
| **DAT-107** | A definition's `order` is a total order that includes every key column, or `multiset`; the connector hashes the rows in that order or sorted by their canonical text                                                                                                                                                                      |
| **DAT-068** | A definition declares `empty: 'valid'` or `'invalid'`, and a run of no rows against `invalid` fails, `empty_result`                                                                                                                                                                                                                       |
| **DAT-050** | A definition declares rows, bytes and seconds; a tenant setting lowers each, and a run takes the lesser                                                                                                                                                                                                                                   |
| **DAT-109** | The connector's deadline covers the whole execution, and a limit reached cancels at the source: a PostgreSQL cancel request, a SQL Server attention, an aborted HTTP or S3 exchange                                                                                                                                                       |
| **DAT-110** | Bytes are counted as they arrive, so a single value past the byte limit fails the execution, `byte_limit`                                                                                                                                                                                                                                 |
| **DAT-051** | Reaching the row, byte or time limit is `row_limit`, `byte_limit` or `timeout`, and nothing is stored                                                                                                                                                                                                                                     |
| **DAT-045** | A result cut by a limit is a failure and is never stored, so nothing can publish it as complete                                                                                                                                                                                                                                           |
| **DAT-108** | Where an S3 object or an HTTP response states a length, a digest or a row count apart from its framing, the connector checks what arrived against it and refuses, `result_incomplete`, what does not match                                                                                                                                |
| **DAT-096** | An `image` column declares `base64` or `binary`; the connector admits only a PNG or a JPEG by the asset door's header reading, the cell is the stored hash, and `ingest` decodes it before the dataset version is recorded                                                                                                                |
| **DAT-014** | `POST /v1/connections/{id}/sample` runs a draft definition with sample parameters, shows the result and its proposed columns, and stores nothing - so it runs before anything depends on the definition                                                                                                                                   |
| **DAT-015** | Every change to a definition is a version, and a binding names its definition with an optional `version`: present pins it, absent floats at latest                                                                                                                                                                                        |
| **DAT-016** | Where a definition is used - the bindings naming it and the documents resolving them - is computed when asked, and the definition's editor shows it before a version is saved                                                                                                                                                             |
| **DAT-025** | `use_connection`, decided at the connection, is needed to run anything against it; reading a document that holds its results needs only `read` on the document                                                                                                                                                                            |
| **DAT-077** | A query runs at the source as the identity its connection declares, so the source's own rules decide the rows; an `s3` connection's identity may only be `service`                                                                                                                                                                        |
| **DAT-090** | A stored result is read only through a document that resolves to it, on `read` on that document; fetching one - a resolve or a check - and accepting one each ask what the source side asks: `read` on the query definition it ran and `use_connection` on its connection, an accept on top of `edit` on the document ([Accept](#accept)) |
| **DAT-092** | `dataset` is an artifact kind; each recorded result is an immutable version of it, named by an insert-only `dataset_name`, and a resolution names exactly one dataset version                                                                                                                                                             |
| **DAT-083** | Every binding a document resolves, checked or pinned, is resolved to a dataset version, whose content is its provenance record                                                                                                                                                                                                            |
| **DAT-085** | A dataset version's content records the definition and connection with their versions, the canonical parameters, the SQL or request that ran, the identity, the time, the row count, `canonical: 1`, and the SHA-256 checksum; its own identifier is the dataset version                                                                  |
| **DAT-043** | A dataset version is an `artifact_version`, insert-only, which a baseline pins as it pins any version; its rows are an object nothing sweeps while anything names it                                                                                                                                                                      |
| **DAT-093** | Accepting adds a resolution row for that document's binding alone; another document holding the same dataset keeps its row, and its version, until somebody accepts there                                                                                                                                                                 |
| **DAT-084** | A check compares a fresh result with the one held only where the opener's identity key is the dataset's; a different checksum is recorded as a dataset version and answered as a waiting revision                                                                                                                                         |
| **DAT-037** | Accepting is its own route, and its resolution row names the version the binding held, the version it holds after, who and when                                                                                                                                                                                                           |
| **DAT-089** | Only the service calls the connector, only from a route a person calls - resolve, check, a sample run, describe and test - and neither the worker nor a publish nor a preview has a route to it                                                                                                                                           |
| **DAT-086** | Each act succeeds whole or fails by one named failure identifying the definition and, where the act has them, the binding and the document; a failed act records nothing                                                                                                                                                                  |
| **DAT-049** | Every failure carries `attribution`: `connector`, `query` or `product`, fixed per code ([Failures](#failures))                                                                                                                                                                                                                            |
| **DAT-029** | A binding names its definition in `query`, its `parameters`, and, inline, `take`, the value it takes                                                                                                                                                                                                                                      |
| **DAT-030** | A binding's parameter is `{ literal }` or `{ document }`, a document parameter by name, read from the document's parameter set when the binding is resolved                                                                                                                                                                               |
| **DAT-067** | An inline binding's `take` is `{ column }`, of a result of exactly one row, or `{ key, column }`; the schema admits nothing else, so a binding identifying neither is refused when it is written                                                                                                                                          |

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
| IAM-082                            | Sign-out stopping data flowing on a connection that carries the person's authority is D7's, where a run first carries a person's own identity (D3-Q). In D3 every run is the service account's, and an act whose session ends while the source answers records nothing (D3-H)                                                                                                                |
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
    | { host: string, port: number, database: string, account: string,                  // postgres, sqlServer
        tls: 'require' | 'verifyFull' }
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

**D1 admits `type: 'postgres'` alone** (the D1 plan, D1-C): `sqlServer`, `http` and `s3` each arrive
as an arm with their slice, which refuses nothing stored, and every write refuses an identity its
type's connector does not declare, so only `service` can be written until D7 declares `asserted`.

**What a version holds is what anybody who may read it sees**: never a secret. A database source
names its `account`, the login it runs as, beside its host, so the connection's readers see what it
runs as and a changed account is a version (DAT-007); only the password is the credential. The check
refuses a `source` of another type's shape, an `http` base URL that is not `https`, a host that
names a local path or a socket, and an `identity` the type's connector does not declare (DAT-078):
`postgres` and `sqlServer` declare `asserted`, `http` declares `delegated`, and `s3` declares none,
so its identity is `service` (DAT-077). **Asserted identity's rules** (DAT-112 to DAT-114, ADR-0035)
are the connector's to apply: in PostgreSQL the role membership is `WITH INHERIT FALSE, SET TRUE`
and the assertion is `SET LOCAL ROLE` in a transaction the connector opens and ends; in SQL Server a
`read_only` `SESSION_CONTEXT` key or `EXECUTE AS USER ... WITH COOKIE`, whichever `assertion` names;
where the source cannot fail loud, the connector refuses an end-user query it has not asserted for.

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
  set_at         timestamptz not null,
  target_digest  text                  -- SHA-256 of the target it was set for; null before 0045
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

**A credential is bound to its connection and its connection's target** - the connection's id, and
its type, host, port, database, account and TLS as the version it was sealed for had them (DA-AF).
The connector seals it with the id and that target in the associated data beside the tenant and the
purpose, and opens it only with the id and the target of the request's own; the service stores the
digest of the target it asked the connector to seal for - never the latest version's as read after
the seal, which a version saved meanwhile would have moved - beside the sealed row, and hands the
connector the credential only while the latest version has the same digest. So a version that points
the connection anywhere else - an administrator's own server among them, and a version saved while
the credential was being sealed - leaves no credential the service will send or the connector will
open, a sealed row copied to another of the tenant's connections opens there for nothing, and the
connection's page and read say the password must be set again (`targetChanged`; a test or describe
is refused `credential_target_changed`). A row set before credentials were bound names no target, is
never used, and says so as its own case (`setBeforeBinding`: set before this version of the product),
since nothing about the connection changed. A name or a description changes nothing. **The child
signs in by SCRAM-SHA-256 alone, bound to the TLS channel where the source offers it**: a source that
asks for the password in the clear or as MD5 is sent nothing and read as any failure to sign in,
`connection_failed` (DAT-075), since `tls: 'require'` checks no certificate and a server that asks
that way would be handed the password or its equivalent; and where the source offers
SCRAM-SHA-256-PLUS the exchange names the certificate the child saw, so a relay between them cannot
pass it on. A source offering plain SCRAM alone is still signed in to, the child saying it could have
bound, which a real source that offers binding refuses from a relay that strips the offer; refusing
plain SCRAM would refuse the poolers and proxies that cannot bind.

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
pooled or reused, so there is no reset question (DAT-114). **The child runs as a user of its own**,
one per slot of the supervisor's cap, with no capability: the kernel keeps both keys in the
supervisor's `/proc/<pid>/environ` whatever it deletes from `process.env`, so it is the kernel's
access check on another user's `/proc` entries, not the supervisor's tidiness, that keeps them from a
child, and from one child the credential another is holding. The supervisor holds only the three
capabilities that switching and killing another user take, the connector's code and filesystem are
not the child's to write, and the connector refuses to start unless a child spawned as every child is
proves it cannot read the supervisor's environment. Its container lets no child make shared memory,
a message queue or a semaphore set - in a file, or in its IPC namespace, where one would outlive the
child that made it, and the connector refuses to start where one could be made - so nothing passes between children that way, bounds how many processes they may start, and runs under an init that reaps what
the supervisor kills of a child's leftovers. Case 2 priced it at 41 ms p50 against 5 ms
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
trailing dot included - before checking it. An IPv6 address that carries an IPv4 one for something
else to reach - IPv4-compatible, the well-known NAT64 prefix `64:ff9b::/96`, or RFC 8215's local-use
`64:ff9b:1::/48`, read in every layout RFC 6052 allows it - is checked with the IPv4 address it
carries as well, and dialled as given, since on an IPv6-only network a NAT64 address is the only way
to an IPv4 source. **It also refuses what the connector's own networks say is the host, and
itself**: each gateway its route tables name - on a bridge network, the host's address there - and
each address the connector holds, read once at start, so a deployment that forgot to list its host
is not reached through it. It cannot see further than that. An internal network names no gateway
whether or not its bridge holds an address for the host, and an isolated bridge's first address is
not the host's - Docker gives it to the first container to join, often the source - so for compose's
networks the host is kept out by the engine (Docker Engine 28.0.0 or later, whose
`gateway_mode_ipv4: isolated` gives the bridge no address), which the whole-system isolation test
asserts, and not by the guard. Nor can the connector find out at start whether that isolation holds:
from inside, an isolated bridge and one holding an address the host answers at look the same until
something on the host answers, and nothing of the connector's listens there to be found. It resolves
once and connects to the address it checked;
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
the credential row it was made with, who asked and when, the answer and its findings - insert-only,
and the latest is what the two refusals read. A latest test of an earlier version, or made with an
earlier credential - one in flight when the password was replaced, answering after the new one's own
test - is read as no test of the connection as it now is, and the page says so.

**A describe lists what a page can show, and no more than fits.** PostgreSQL allows a name a page
cannot: a table named with a tab, say. The child holds each relation and each column to the
protocol's bounds on its own, and leaves out - rather than escapes, since an escaped name is not the
name and nothing could be read by it - a relation whose schema or name holds a control character, and
a column whose name does or whose type's text is longer than 1,024 bytes (the longest a type is named
without a modifier is 259: two quoted names of 63 double quotes, the dot and an array's brackets). The
answer counts what it left out, `leftOut`, and the page says how many. It lists at most 2,000
relations, and stops adding them before its answer passes half the 32 MiB an answer may be, saying
`truncated` either way; the page says the list was cut short.

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
  fetch: BuilderFetch | SqlFetch | HttpFetch | FileFetch,   // SqlFetch alone in D2 (D2-D)
  columns: Column[],
  key: string[],                                       // column names; may be empty
  order: { column: string, direction: 'ascending' | 'descending' }[] | 'multiset',
  empty: 'valid' | 'invalid',                          // DAT-068
  limits: { rows: number, bytes: number, seconds: number },   // DAT-050
  retired: boolean,                                    // D2-E: DAT-065's "not itself retired"
}
```

**Every string a version holds is already NFC, or the write is refused** `definition_invalid`,
naming the member (D2-F): a version's digest composes its strings (ADR-0024), where the source
compares two spellings of a SQL text as different, so the edit between them would be answered
unchanged. A decomposed literal is written with PostgreSQL's `U&'...'` escapes. **A D2 definition's
fetch is SQL alone** (D2-D); the builder's tree arrives with D4 as an arm, refusing nothing stored, so
every D2 definition needs `write_sql`.

**Every definition that passes its checks can be run.** Its canonical JSON is at most 512 KiB of
UTF-8, and the longest SQL it can bind to - its text with each variation marker replaced by its
longest fragment and each value marker by its placeholder - at most 300,000 characters, the most a
run reports it ran; either past its bound is refused `definition_invalid`, naming the size, on every
write and on a sample's draft. A run's request to the connector may be 1 MiB and 64 KiB, the
service's own body limit and room for the connection and its sealed credential, so a definition at
its bound always fits with room. The values are not bounded by the definition: a sample's are held by
the service's body limit, which answers a larger body 413 before anything reaches the connector, and
D3's resolve, whose values come from a document, must bound them before it asks.

### Parameters

```ts
Parameter = {
  name: string,
  type: ColumnType,                                    // any but image
  required: boolean,
  list: boolean,
  permitted?: { values: CanonicalValue[] } | { minimum?: CanonicalValue, maximum?: CanonicalValue },
  variation?: { key: string, sql: string }[],          // a key choosing a fragment (D2-E)
}
```

**One declaration shape for every connector type** (DAT-010, case 5). A value is checked against its
declaration before the connector is asked - its type in canonical form, presence, list, permitted
values or range - and one that fails refuses the act, `parameter_invalid`, naming the parameter, the
rule and the value (DAT-020). Text refuses U+0000, and a "contains" or "starts with" filter is bound
to a pattern-free function, never into `LIKE`. **A variation** is a parameter whose permitted values
are its fragments' keys (DAT-019): the value selects a fragment as an own property, and the fragment,
not the value, reaches the query - a sort column, a unit - so a parameter never changes a query's
shape (DAT-018). A variation is an array looked up by its `key`, never a record keyed by the
author's words, so no key - `__proto__`, `constructor` - reaches a prototype, and the canonical
form's one name-keyed rule never meets one (D2-E). **A value is checked in its canonical form
exactly** - an instant with `Z`, a decimal without trailing zeros - so what is validated is what is
bound; text is at most 1,000 characters with no U+0000 or lone surrogate, an integer within 64 bits,
and a list at most 50 items, none null or a list (D2-R).

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

- **`sql`**, the fallback: text with named parameters, `{{site}}` for a value and `{{#name}}` for a
  variation's fragment (D2-B), always bound by the driver. A marker is found by a PostgreSQL lexer in
  `packages/domain`, and one inside a string, a quoted identifier, a dollar-quoted body or a comment,
  or a `$1` of the author's own, is refused when the definition is written - `:site` was ruled out,
  since PostgreSQL's `::` cast and an array slice `a[1:n]` spell it too. The lexer reads what is inside
  a literal as PostgreSQL's scanner does: a string continued on the next line is one literal of the
  kind it began as, an escape string's escapes and all; a dollar quote's tag has no length limit; a
  number followed directly by a letter, a quote or a `$` is refused, which PostgreSQL 14 reads as two
  tokens - `1e5E'...'` a number and an escape string, `1a$b$` a number and a name - and later versions
  refuse as trailing junk;
  and a standard string's backslash is itself, which every connection the connector opens pins with
  `standard_conforming_strings=on`. PostgreSQL's binder writes each value marker `($n::type)`,
  parenthesised so a subscript after the marker is the value's and not the cast's, with a space
  either side so it never fuses with its neighbours, by its declaration - `int8`, `numeric`, `text`,
  `date`, `time`, `timestamp`, `timestamptz`, `boolean`, or that type's array for a list - and hands
  the value's canonical text to the driver; a marker used twice binds once; the SQL that ran is that
  rewritten text (D2-C). The rewritten text is read again by the same lexer, and nothing is sent
  unless its placeholders outside every literal and comment are exactly those written. **A
  variation's fragment is placed set apart**, `/**/ <fragment> /**/`, so nothing either side runs
  into it - a minus before a minus, an E before a quote, a dot before an exponent - and the SQL that
  ran shows the empty comments; and a fragment must be sound on its own when it is written: lexing
  whole, holding no marker, and leaving no line comment open at its end. So every combination of
  fragments binds, which the definition's checks confirm by binding once, in time linear in its size;
  one that reaches a run unchecked is `definition_unbindable`. Saving one needs `write_sql` on the connection
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
`nonexistent_date`, `cell_error` - never rounded.

**For SQL, describe takes the statement** (D2-G): the connector asks the source to describe it with
Parse, Describe and Sync and never runs it (the D2 plan's Q1), each fragment bound by its first key,
and proposes each column by D1's map; a statement with no columns is `result_mismatch`. A run
describes the bound statement the same way before running it, and refuses a column its declaration
does not hold, as well as one it holds that the result lacks: the declared columns are the whole
result. **What a declared type admits from PostgreSQL** (D2-L): text from `text`, `varchar`,
`bpchar`, `name`, `citext`, `uuid`, `json`, `jsonb`, `xml` and any enum; integer from `int2`,
`int4`, `int8` and `numeric`; decimal from those four; date from `date`; time from `time`; local
date-time from `timestamp`; instant from `timestamptz`; boolean from `bool`; a domain by its base.
Each built-in is admitted only from `pg_catalog`, and `citext` only where it is the extension's, its
input function `citextin`: an account can make a type named `int8` or `bool` in a schema of its own.
Any other type is `result_mismatch`, naming the column, and the author casts it in the SQL. A value
with more digits or places than its declaration is `precision_lost`; one no canonical form holds - a
numeric `NaN` or infinity, an infinite date or timestamp, a year before 1 or after 9999, a time of
24:00:00 - is `value_unrepresentable`; a null key is `result_mismatch`. An image column's description is a column the
definition names, or it is declared decorative (DAT-097's declaration; its failure at publish is
`bindings.md`'s).

### Key, order, empty, limits

- **Key and order** (DAT-107): the key columns, and an order that is total and includes every key
  column, or `multiset`. The rows are hashed in that order, or sorted by their canonical text as a
  multiset, so rewriting unchanged rows moves no checksum - case 6 flagged unchanged data as moved in
  19 of 19 refreshes without it. **A declared order is checked, never imposed** (D2-M): the connector
  compares each row with the one before by the product's comparison - numbers and times by value,
  `false` before `true`, **text by code point**, nulls last ascending and first descending as
  PostgreSQL's default - and refuses `result_mismatch`, naming the row, where a pair is out of order
  or two rows share a key. So a text sort key is ordered `COLLATE "C"` in the SQL, and the page says
  so. A multiset sorts the rows by their canonical text, code point by code point.
- **Empty** (DAT-068): whether no rows is a valid answer; a run of no rows against `invalid` fails,
  `empty_result`, exactly as any failure does.
- **Limits** (DAT-050): rows, bytes and seconds. A tenant setting, `data_policy`, lowers each, and a
  run takes the lesser of the definition's and the tenant's. The defaults are 10,000 rows, 5 MiB and
  30 seconds, the ceilings 100,000 rows, 25 MiB and 120 seconds (the D1 plan, D1-R). **The byte limit
  counts both what arrives and what is kept** (D2-J): the bytes read from the source at the child's
  socket after the statement is sent, and the canonical result's bytes; either past the limit is
  `byte_limit`, and a single value larger than the limit is stopped before the driver holds it
  (DAT-110). **The connector runs at most four definitions at once**, of its eight children: a result
  at the ceilings - 99,999 rows of 39 columns, about 19.9 MB canonical - peaked at 368 to 371 MiB in
  its child, against 88 MiB for a child at rest, and the supervisor held about 87 MiB of heap parsing
  each such answer (measured under `tsx` on Windows). Four fit the container's 3 GiB (`mem_limit:
3g`) beside the supervisor; eight would not. A fifth run at once is `connector_busy`, and a test or
  a describe, which holds far less, takes one of the other slots. **The seconds limit is the run's
  wall time from its child's start**, as the supervisor kills it a second after: the child counts its
  deadline from its process's start, so the process starting - a few hundred milliseconds - is inside
  the limit, and a statement close to it can answer `timeout` one time and not the next.
  **A limit reached cancels at the source by the protocol's cancel request alone** (DAT-109): the
  connector never falls back to `pg_cancel_backend`, since through a pooler the key the backend sent is
  the pooler's, and the process it names could be another session's. So through a relay or a pooler
  that drops cancel requests, a statement whose SQL turned off the server's own checks -
  `client_connection_check_interval` and `statement_timeout` - runs on at the source until the source
  stops it; the connector has answered `timeout` or the limit and holds nothing of it.

### Searchable

`queryDefinition` joins `searchKinds` (SCH-055). Its entry is written with each version, as every
kind's is, from its title, its description and its column names. Not from its connection's name: a
reader of a definition need not be able to read the connection it names, and the name is the
connection's to show. A connection
and a dataset are not search entries in T2: a connection is found on its space's Connections page,
and a dataset is read only through a document.

## Permissions

The closed set gains two, **both decided at the connection** - held there by a grant on it, or on its
space or the tenant, walked as every permission is:

| Permission       | Lets the principal                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ |
| `use_connection` | Run anything against the connection: a sample run, describe, test, resolve and check |
| `write_sql`      | Save a query definition whose fetch is SQL against the connection                    |

Adding them is the code change and the migration access.md names - `use_connection` in D1, and
`write_sql` in D2 with the check that reads it (DAT-101), since a permission no check reads is a
promise with nothing behind it: `permissions` in `packages/domain/src/access/permissions.ts`, and
the check constraints `role_permissions_closed` and `api_token_scopes_closed`. **No starting role
gains either**, so using a connection is always granted on purpose; the external cap gains both.

| Act                                                     | Needs                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Making, changing, retiring a connection; its credential | `administer` on the space to make one, on the connection otherwise                            |
| Making and changing a query definition                  | `edit` in its space; `use_connection` on the connection it names; `write_sql` for a SQL fetch |
| A sample run, describe, test                            | `use_connection`                                                                              |
| Resolve                                                 | `edit` on the document, `read` on the definition, `use_connection`                            |
| Check                                                   | `read` on the document and `use_connection`; without it, nothing is checked for that person   |
| Accept                                                  | `edit` on the document, `read` on the definition, `use_connection`                            |
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
  (DAT-090), and only a version that document's bindings show the caller: one a binding they can see
  holds, or has waiting while it is not stale - never one in a component they may not read, or at a
  node the outline no longer has. Its rows, their checksum and its declared columns are the
  reader's; **the SQL that ran and the connection it ran on are shown only to a caller who may also
  read the query definition**, `ran.sql` and `connection` answered null otherwise, as a definition
  names its connection only to a reader of the connection (D2). The stored provenance is whole
  either way. Browsing datasets in their own right, and querying them, wait for T4 (DAT-094).
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
(definition, parameters digest, identity key); **the latest version is reused only where the checksum,
the definition version and the SQL that ran all equal this run's** (D3-F), otherwise a new version is
recorded; and a resolution row is added. Resolving
a binding again under one's own identity - fetching one's own view - is the same act, and carries
DAT-091's acknowledgement where the identity is the person's own.

### Check

Asked for on a document with checked bindings (D3 builds the route; when a screen asks is
`bindings.md`'s). For each, **the service re-runs only where the opener's
identity key is the dataset's** - a service-account connection always, an end-user one only for the
identity whose view is stored (DAT-084). For anybody else a different result is a different view, not
a source that moved, and is never flagged. A different checksum is **recorded as a new dataset version
but not resolved to**: it is the waiting revision, answered to the screen beside what the document
holds. Accepting it later accepts exactly the rows the person saw, with no second query. Pinned
bindings are never checked. **Each distinct question runs once**, however many bindings ask it, at
most two at a time of the connector's four run slots and at most fifty a check; past that the rest
are answered unchecked, `limit`, never a failure, and each binding's answer stands alone (D3-I).

### Accept

Adds a resolution row naming the waiting version and the one it replaces (DAT-037, DAT-093). It needs
`edit` on the document and what a fetch asks of the source side (DAT-090): `read` on the query
definition the accepted version ran and `use_connection` on the connection it ran on, decided in
the transaction that records it and refused as a resolve refuses - a definition the caller may not
read answered `binding_missing`, as one that is not there is, and a connection they may not use
`forbidden` - recording nothing. It **queries nothing**. Where the version was fetched under the accepting
person's own identity, the request must carry `sharesOwnView: true`, or it is refused,
`acknowledgement_required`: the screen's warning that everybody who may read the document will see it
is `bindings.md`'s (DAT-091), and the route will not accept without it. **Acts on one binding take turns**: an
accept, and a resolve's and a check's recording transactions, take a transaction-scoped lock on each
document, node and binding they read what is held of before reading it, so two accepts each replacing
the version held cannot both succeed - the second reads what the first recorded and is refused
`resolution_precondition`.

### Sample run, describe and test

A **sample run** is a query author's, with `use_connection`, on a draft definition, and stores nothing
(DAT-014). **Describe** and **test** store nothing but the test's findings. A dataset exists only once
a binding is resolved.

**No act holds access while a source answers.** The permission is decided, and the connection's
settings and sealed credential read, in one short transaction, which commits before the connector is
asked; a test is then recorded in a second, against the version it tested even where a newer one was
cut meanwhile, since the row names that version and the test is still true of it, and the connection's
read then says the latest version is untested. A deciding transaction holds the access epoch's shared
lock, and a source can take twenty seconds to answer: held across the call, a revocation would wait
that long while the person it revokes kept running.

### Rotation, where used and retiring

- **Rotation** (DAT-066): changes no stored result; the service tests the connection straight after,
  and reports a failure once, naming every definition that names the connection.
- **Where used** (DAT-016, DAT-064): computed when asked, never stored beside what it counts - the
  definitions naming a connection, from their latest versions; the components whose latest versions
  hold a binding naming a definition; the documents resolving those bindings. A route answers the ones
  the caller may read by name and counts the rest. When [relationships.md](relationships.md)'s
  reference index is built, a binding is one more reference it records.
- **Retiring** a connection or a definition shows its uses first; a connection is refused while a
  definition that is not retired names it (DAT-065). A connection's page shows, under **Used by**
  above **Retire**, the definitions naming it and the documents holding results from it, readable
  ones linked and the rest counted (DAT-064); a document holding a result does not refuse the retire,
  since what it holds is kept and DAT-064 asks for it to be shown, not to block. Nothing is deleted. D1 builds retiring and
  reinstating, each a version, and refuses a test, a describe and a credential on a retired
  connection, `connection_retired`; where used, and the refusal to retire one in use, arrive with D2,
  when there is a definition to name (the D1 plan, D1-O).

### Audit

Newer results and acceptances are the dataset versions and the resolution rows (DAT-037); changes to
a connection are its versions and its credential rows (DAT-007); changes to a definition are its
versions, which is DAT-013's audit half. When LIF's log is designed, each act is an event in it too.

### Failures

Every failure is one code, `attribution` fixed per code (DAT-049), naming the definition and, where
the act has them, the binding and the document (DAT-086). A failed act records nothing.

| Code                      | Attribution | When                                                                                                                                                                                                                                                |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_failed`       | connector   | Any failure to reach or authenticate, one reason for all (DAT-075)                                                                                                                                                                                  |
| `address_refused`         | connector   | The guard refused the address, in a run; a test says `connection_failed`                                                                                                                                                                            |
| `timeout`                 | connector   | The deadline passed; the source was cancelled (DAT-109)                                                                                                                                                                                             |
| `row_limit`, `byte_limit` | query       | A limit was reached; nothing stored (DAT-051, DAT-110)                                                                                                                                                                                              |
| `result_incomplete`       | connector   | A stated length, digest or row count did not match what arrived (DAT-108)                                                                                                                                                                           |
| `result_mismatch`         | query       | Columns or order did not fit the declaration (DAT-106)                                                                                                                                                                                              |
| `precision_lost` and kin  | query       | A value was not exact in its declared type (DAT-080)                                                                                                                                                                                                |
| `nested_value`            | query       | A nested JSON value in a column not declared text (DAT-095)                                                                                                                                                                                         |
| `image_refused`           | query       | An image was not a PNG or a JPEG, or `ingest` refused it (DAT-096)                                                                                                                                                                                  |
| `empty_result`            | query       | No rows, where the definition says empty is invalid (DAT-068)                                                                                                                                                                                       |
| `identity_unavailable`    | product     | A delegated act by a person with no provider token (DAT-076)                                                                                                                                                                                        |
| `identity_expired`        | connector   | The provider token has expired; sign in again                                                                                                                                                                                                       |
| `identity_unmatched`      | connector   | The source does not know the asserted person                                                                                                                                                                                                        |
| `sql_not_permitted`       | product     | A SQL fetch on a connection that refuses one (DAT-102, DAT-103)                                                                                                                                                                                     |
| `parameter_invalid`       | product     | A value failed its declaration before anything ran (DAT-020)                                                                                                                                                                                        |
| `binding_unresolved`      | product     | A publish met a binding with no stored result - raised by the publish (DAT-087, `bindings.md`)                                                                                                                                                      |
| `source_unsupported`      | connector   | The source signed the account in and is older than PostgreSQL 14, which a test cannot check                                                                                                                                                         |
| `connector_error`         | connector   | The connector's child ended without an answer                                                                                                                                                                                                       |
| `connector_unavailable`   | product     | No connector is configured, or it did not answer; nothing was asked of the source                                                                                                                                                                   |
| `connector_busy`          | product     | The connector was running as many requests as it may                                                                                                                                                                                                |
| `source_refused`          | query       | The source refused the statement - a syntax error, a permission, a division by zero - with its SQLSTATE and its message, cut to 1,000 characters                                                                                                    |
| `value_unrepresentable`   | query       | A value no canonical form of its declared type can hold: `NaN`, an infinity, a date out of range                                                                                                                                                    |
| `definition_unbindable`   | query       | The binder refused the definition's binding: a fragment, unsound on its own, runs into the SQL around it where it is placed. The definition's checks refuse it when it is written; one reaching a run unchecked is answered so, and nothing is sent |

The four before those two were added by the D1 plan (D1-M, D1-Q), and the last two by the D2 plan
(D2-H), whose `source_refused` is answered with the source's message only to somebody holding
`write_sql`. D3 keeps that rule for a resolve and a check, which need only `use_connection`: a
caller holding `write_sql` at the connection is given the source's SQLSTATE and message, and anybody
else the SQLSTATE alone, with words that quote nothing the source said. A failure is answered with its HTTP status by
where it arose: a failed test is an answer, 200; describe's `connection_failed`, `connector_error` and
`source_unsupported` are 502 and `timeout` 504; `connector_unavailable` and `connector_busy` 503. A
sample's failure is an answer, 200, as a failed test is; a describe of a statement answers the
query's failures - `source_refused`, `result_mismatch` - 400, the author's to fix (the D2 plan).
**SQL is refused `sql_not_permitted`, 409**, before anything runs, unless the connection's latest test
is a pass of its latest version and credential that did not find its account able to write
(DAT-103); a version retiring a definition is let through, since it runs nothing, so a definition

- and after it its connection - can be retired once the account is found able to write.

## Routes

| Route                                       | Permission                                                         | Does                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/connections`       | `administer` on the space                                          | Makes a connection at 0.1 from settings that pass the check                                                                  |
| `GET /v1/connections`                       | Signed in                                                          | The connections the caller may read                                                                                          |
| `GET /v1/connections/{id}`                  | `read` on the connection                                           | Its latest version, whether a credential is set and by whom and when, and the latest test's findings                         |
| `POST /v1/connections/{id}/versions`        | `administer` on the connection                                     | Cuts a version from `openedFrom` and whole settings; retiring is `retired: true`, refused while in use                       |
| `PUT /v1/connections/{id}/credential`       | `administer` on the connection                                     | Seals the secret through the connector, adds a credential row, tests the connection and answers the test with its dependents |
| `POST /v1/connections/{id}/test`            | `use_connection`                                                   | The connection test                                                                                                          |
| `POST /v1/connections/{id}/describe`        | `use_connection`, and `write_sql` for a statement                  | Tables and views, or a draft SQL fetch's result shape                                                                        |
| `POST /v1/connections/{id}/sample`          | `use_connection`, and `write_sql` for a SQL fetch                  | Runs a draft definition with sample parameters; answers rows and proposed columns; stores nothing                            |
| `GET /v1/connections/{id}/uses`             | `read` on the connection                                           | Where it is used                                                                                                             |
| `POST /v1/spaces/{space}/query-definitions` | `edit` on the space, `use_connection`, `write_sql` for SQL         | Makes a definition at 0.1                                                                                                    |
| `GET /v1/query-definitions`                 | Signed in                                                          | The definitions the caller may read                                                                                          |
| `GET /v1/query-definitions/{id}`            | `read` on the definition                                           | Its latest version, its connection's identity, and its connection's name where the caller may read the connection            |
| `POST /v1/query-definitions/{id}/versions`  | `edit` on the definition, `use_connection`, `write_sql` for SQL    | Cuts a version from `openedFrom`; retiring is a version too                                                                  |
| `GET /v1/query-definitions/{id}/uses`       | `read` on the definition                                           | Where it is used                                                                                                             |
| `GET /v1/documents/{id}/bindings`           | `read` on the document                                             | Each binding's resolution, its dataset version's provenance, and any waiting revision                                        |
| `POST /v1/documents/{id}/bindings/resolve`  | `edit` on the document, `use_connection`                           | Resolves the named bindings                                                                                                  |
| `POST /v1/documents/{id}/bindings/check`    | `read` on the document                                             | Checks the document's checked bindings where the caller's identity key allows, with `use_connection`                         |
| `POST /v1/documents/{id}/bindings/accept`   | `edit` on the document, `read` on the definition, `use_connection` | Accepts a waiting version for one binding                                                                                    |
| `GET /v1/documents/{id}/datasets/{version}` | `read` on the document                                             | A dataset version's rows, where the document resolves to it or has it waiting                                                |
| `PUT /v1/datasets/{id}/name`                | `edit` on the dataset                                              | Names a dataset                                                                                                              |
| `GET /v1/settings/data`, `PUT` the same     | `read`, and `administer` at the tenant to change                   | The tenant's lowered limits                                                                                                  |

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

### Settled while writing, approved by Ken on 2026-09-30

Not in the design as Ken first approved it; each is what that design needed to be built, and Ken
approved them the same day.

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-W  | **A fourth request, `seal`.** The service never holds the connector's key, so it cannot seal a credential itself; it hands the secret to the connector, which answers the sealed value and keeps nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DA-X  | **The supervisor holds the key; the child holds one credential.** Code that parses a hostile source's answer never holds the key that opens every tenant's credentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| DA-Y  | **`administer` makes and changes a connection and sets its credential**, on the space and on the connection. A connection is configuration, its credential reaches a tenant's systems, and `create` and `edit` would put it in every author's hands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DA-Z  | **Naming a connection in a definition needs `use_connection`**, when it is made and at each version, since choosing a connection is using it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| DA-AA | **A resolution records its binding's digest**, and holds only while the binding is unchanged, so a changed question is never answered by an old result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| DA-AB | **Retiring a connection is refused while a definition that is not retired names it** (DAT-065), and retiring is a version with `retired: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DA-AC | **The connection test reports the account's checks by name after it authenticates**, while every failure to reach or authenticate reads the same. DAT-103 asks the test to check read-only, which one reason for every failure could not report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DA-AD | **The connector checks a stated length, digest or row count** (DAT-108): an S3 object's size and stored checksum where the store gives one, and an HTTP response's row count where the definition declares a pointer to it. A body stating none is taken as it arrives, bounded by the limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DA-AE | **The accept route asks for `sharesOwnView: true`** where the result is the person's own view, so the API cannot accept past DAT-091's warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DA-AF | **A credential is bound to its connection and its connection's target, and signs in by SCRAM alone, bound to TLS where the source offers it** (D1's final review, a clarity addition approved in the build; the connection's id and channel binding from its re-review). Anyone who may set a credential could otherwise cut a version pointing at their own server and press Test, and node-postgres answers a cleartext or MD5 request with the password. A version changing host, port, database, account or TLS leaves no usable credential until one is set again; the seal's associated data names the connection's id as well as its target, so a sealed row copied to another connection opens nothing, and the digest stored is of the target the connector sealed for |

### Settled by the D3 plan, approved by Ken on 2026-10-03

The D3 plan's decisions this design takes as its own; the rest of them are the plan's alone.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3-C | **The binding, held tight**: `id` an identifier of the component's, `query` and `version` identifiers, `parameters` by D2's name pattern, at most 50, each `{ literal }` or `{ document }`, `mode`, and `take` `{ column }` or `{ key, column }`; every string in NFC, refused rather than normalised, so what is stored is what the digest covers. Widened in place at schema 1: task 0 found none stored                                                                                                                                                        |
| D3-D | **A binding stands wherever component content admits an inline**, and is refused in a section title, `binding_in_title`: a title belongs to no component, so no resolution could hold it                                                                                                                                                                                                                                                                                                                                                                          |
| D3-F | **A dataset version is reused only where the run's checksum, the definition version and the SQL that ran all equal the latest version's**: a version's content is its provenance (DAT-085), and a reused one naming what did not run would be untrue                                                                                                                                                                                                                                                                                                              |
| D3-H | **No act holds access while a source answers**: resolve and check decide and read in a short transaction, ask the connector after it commits, and record in a second that decides the session, the permission on the document, `read` on each definition and `use_connection` on each connection again and re-reads each binding. Anything changed records nothing: `access_changed` or `binding_changed`                                                                                                                                                         |
| D3-I | **A check runs each distinct question once**, two at a time, fifty a check, the rest `unchecked: 'limit'`; each binding's answer stands alone                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3-K | **Accept takes the version it replaces**, and is refused `resolution_precondition` with the binding as it stands where that is not what it holds, or the version is not a newer result of it                                                                                                                                                                                                                                                                                                                                                                      |
| D3-L | **Named refusals**: `binding_missing`, `binding_in_title`, `binding_changed`, `access_changed`, `take_invalid` (checked at resolve, against the version resolved to), `definition_retired`, `resolution_precondition`, and `parameter_invalid` for a `{ document }` parameter until a document has a parameter set (TPL-020); each names the definition, the binding, its node and the document. A binding naming a definition the caller may not read is `binding_missing`, word for word as one naming no definition, so a refusal never says whether it exists |
| D3-R | **A resolution's digest is SHA-256 over the binding's canonical form, `id` and `mode` included**: a binding turned from pinned to checked is a question nobody re-confirmed, and holds nothing until it is resolved again                                                                                                                                                                                                                                                                                                                                         |

**Until the publish's binding stage exists, nothing publishes a binding** (the D3 plan, "Added in
phase B"): a publish or a preview of a document whose resolved content holds one is refused before
anything is queued, `binding_unresolved`, naming each binding by its node and the document, and
`assemble` refuses one by the same code should a request reach it. DAT-046 and DAT-087 stay
unclaimed: their answer is the binding stage, `bindings.md`'s.

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

| Question                                                                                                                                                               | Where it goes                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Mutual TLS between the service and the connector in production                                                                                                         | Hosting, which is open (system.md)                |
| The concurrency of a creation's resolves (case 4: 1.4 to 1.8 s for 440 at 8). A check's is answered by D3-I: each distinct question once, two at a time, fifty a check | The `templates.md` additions                      |
| When a screen asks for a check - on opening a document, or on request                                                                                                  | `bindings.md`                                     |
| IAM-082's stated bound for data flowing on the person's authority after a sign-out                                                                                     | D7's plan                                         |
| Checking the account's own privilege at each asserted run, which would let DAT-112 be claimed                                                                          | D7's plan                                         |
| Comparison and order under each source's collation, where two keys compare equal: answered for PostgreSQL's SQL by D2-M - checked by code point, ordered `COLLATE "C"` | D4 and D5's plans, for the builder and SQL Server |
| A nested JSON value kept as text: its source text or a canonical form, which decides whether reformatting at the source moves a checksum                               | D6's plan                                         |
| How a new definition version a floating binding would take, or a changed parameter value, is offered                                                                   | `bindings.md` (DAT-070)                           |

## Build order

Each slice has a plan of its own, written when its turn comes.

| Slice  | What                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | The connection kind and its sealed credential; `use_connection`; `apps/connector` with a process per request, the guard, PostgreSQL, `test`, `describe` and `seal`; the compose networks; a Connections page                                                                          |
| **D2** | The query definition kind: parameters, the SQL fallback and `write_sql` with the check that reads it, columns second, the sample run, canonicalising and checksumming in the connector; search. Built by [the D2 plan](../plans/2026-09-30-d2-query-definitions.md)                   |
| **D3** | Datasets and resolutions: the dataset kind, objects keyed by checksum, provenance, resolve, check and accept; the binding inline widened after the evidence query. Built by [the D3 plan](../plans/2026-10-03-d3-datasets-and-resolutions.md). **`bindings.md` is designed after D3** |
| **D4** | The builder: the saved query tree, PostgreSQL's SQL generated from it, its screens                                                                                                                                                                                                    |
| **D5** | SQL Server: `tedious`, its dialect, `NVARCHAR` and `CAST`                                                                                                                                                                                                                             |
| **D6** | HTTP and S3 connections and the file formats: the product's own XLSX reader, CSV and JSON                                                                                                                                                                                             |
| **D7** | End-user identity: the delegated token, with the session holding the provider's token, and asserted identity on PostgreSQL and SQL Server; IAM-082, sign-out stopping data flowing on the person's authority                                                                          |
| **D8** | Image columns through `ingest`                                                                                                                                                                                                                                                        |

Then `tables.md`, and the `templates.md` additions: a template's parameters, and a document's
bindings established when it is made.
