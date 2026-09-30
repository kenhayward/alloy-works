# D1: Connections and the connector

> **A sketch**, built in one pull request, test-first, with one final whole-branch review before it
> opens that is asked for a break of its own against every citation. It builds D1 of
> [data.md](../design/data.md)'s build order, under
> [ADR-0035](../decisions/0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md).
> data.md's decisions DA-A to DA-V were approved by Ken on 2026-09-30, and DA-W to DA-AE the same
> day. This plan's own decisions, D1-A to D1-S below, are taken as recommended and are Ken's to review
> before the build starts.

**Goal:** an administrator makes a connection to a PostgreSQL source in a space, sets its credential
without ever seeing it again, tests it and lists its tables; the credential is sealed with a key only
the connector holds and opened only in a fresh process for one request; and the connector runs on a
network with no route to the platform, which CI shows on every run. Nothing is queried yet: no query
definition, no dataset, no binding.

| PR   | Holds                                                                                                                  | Version |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| D1.0 | [data.md](../design/data.md) and this plan                                                                             | Build   |
| D1.1 | The build: the sealing package, the connection kind, `use_connection`, `apps/connector`, the routes, the page, compose | Minor   |

## What the two named questions answered

Both were run in scratch containers on this machine, never on the development stack, and taken down.

**Q1: a fresh process per request is cheap enough on Linux. Yes.** A Node 24.21 supervisor in
`node:24-bookworm-slim`, limited to 2 CPUs, spawned a child per request with an empty environment,
wrote one request and one opened credential to its standard input, read its answer and waited for it
to exit; 300 timed runs after 20 to warm, each shape twice:

| Child                                    | p50     | p95     | p99     | Max     |
| ---------------------------------------- | ------- | ------- | ------- | ------- |
| Trivial: read, answer, exit              | 16.6 ms | 18.9 ms | 20.4 ms | 22.3 ms |
| The same, importing `pg` before it reads | 28.0 ms | 31.8 ms | 32.8 ms | 35.8 ms |

Two CPUs made about 65 children a second whatever the concurrency: at 4 at once p50 was 80.5 ms and at
8, 106.7 ms, all of it queueing. The child saw no environment variable at all, and the key never left
the supervisor. This is a Linux container on Docker Desktop's WSL2 kernel (6.18), not a native Linux
host; the spike's 41 ms p50 was a fresh process on Windows and included a connection and a query. **It
changes nothing in the design (DA-E)**; it sets `CONNECTOR_MAX_CHILDREN` (D1-H).

**Q2: on Linux, `internal: true` alone is not enough; `internal: true` with the bridge given no host
address is.** A Linux engine (Docker 28.5.2, iptables) was run inside a privileged `docker:28-dind`
container, which is how a Linux runner's networking behaves and not how Docker Desktop's port
forwarding does. A stand-in platform (a PostgreSQL and an HTTP store on a plain network, each
publishing one port on `127.0.0.1` as `deploy/compose.yaml` does and one on every address), a service
on the platform and a private network, a connector on the private and an egress network, and a source
PostgreSQL on the egress network. Raw TCP from the connector, 2 s per attempt:

| From the connector, to                                    | Egress plain | Egress `internal` | `internal` and isolated gateway |
| --------------------------------------------------------- | ------------ | ----------------- | ------------------------------- |
| The platform's PostgreSQL and store, by address           | timeout      | no route          | no route                        |
| The same, by name                                         | no name      | no name           | no name                         |
| A port published on `127.0.0.1`, through any host address | refused      | refused           | no route                        |
| **A port published on every address, through the host**   | **connects** | timeout           | no route                        |
| **A host process listening on every address**             | connects     | **connects**      | no route                        |
| The source PostgreSQL, by address and by name             | connects     | connects          | connects                        |

From the service, the connector connected on the private network and the source never did. So: with a
plain egress network, **every port the host publishes on all addresses is the connector's** - the
Docker Desktop leak the spike found is a Linux one too, for such ports; with an internal one, the
bridge still carries a host address, and any host process listening on all addresses answers there.
Docker 28's `com.docker.network.bridge.gateway_mode_ipv4: isolated` gives an internal bridge no host
address, and then nothing of the host or the platform answers while the source does (D1-I). Whether
CI's runner behaves the same is answered by the whole-system job's isolation test (task 6), which
fails on an engine older than 28.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Instead of                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1-A | **One tenant migration, `0044_connections.sql`**: the kind in the three artifact checks, `use_connection` in the two closed sets, `connection_credential` and `connection_test`                                                                                                                                                                                                                                                                                                                                                                              | One per table, which three `alter` statements on the same constraints would repeat                                                                                                                                                     |
| D1-B | **The seal's purpose is `source-credential`, and the sealing scheme moves unchanged from `packages/db/src/seal.ts` into a package of its own, `@alloy-works/sealing`** (`node:crypto` only), which `packages/db` re-exports so every caller stays as it is; the connector depends on it and on nothing of the platform's                                                                                                                                                                                                                                     | The connector importing `@alloy-works/db`, which would put the platform's database library, its migrations and its schema in the one image that must hold nothing of the platform's; or a second copy of the scheme, which would drift |
| D1-C | **A connection version's shape admits `type: 'postgres'` alone.** `sqlServer`, `http` and `s3` each arrive as a new arm with their slice (D5, D6), which refuses nothing stored. `identity` admits the design's three shapes, but every write refuses one its type's connector does not declare, and in D1 PostgreSQL declares no end-user mechanism: asserted identity is declared with D7                                                                                                                                                                  | Admitting four types and two end-user mechanisms no connector runs; an `http` or `s3` connection stored now would hold a shape D6 had not tried, and a version cannot be migrated in place                                             |
| D1-D | **A PostgreSQL source names its `account`**, the login role, as a visible setting beside `host`, `port`, `database` and `tls`. data.md's shape has no member for it                                                                                                                                                                                                                                                                                                                                                                                          | Sealing the name with the password, which would hide from the connection's readers what it runs as, and let the account change without a version (DAT-007)                                                                             |
| D1-E | **The connector's interface is HTTP/1.1 and JSON on `connector-private`, port 8090**: `POST /v1/seal`, `POST /v1/test`, `POST /v1/describe`, `GET /v1/health`. Every `POST` carries `authorization: Bearer <key>`, compared as SHA-256 digests with `timingSafeEqual`. A named failure is an answer (200, `{ failure }`); a malformed request is 400 `request_invalid`, an unauthenticated one 401 with no body, a body over 64 KiB 413, a full supervisor 503 `connector_busy`. Node's `http`, no framework                                                 | gRPC, or Fastify, each a dependency the connector's image would carry for four paths; mutual TLS in development, which production decides with hosting (data.md's open question)                                                       |
| D1-F | **The service finds the connector by `CONNECTOR_URL`, and authenticates with `SECRET_CONNECTOR_KEY` from its secret store**, set together or neither. Without them the service starts, and every data act answers 503 `connector_unavailable`; the Connections page says so. The worker is given neither                                                                                                                                                                                                                                                     | Refusing to start without a connector, which would make every installation run one before it has a source                                                                                                                              |
| D1-G | **The connector's configuration**: `CONNECTOR_PORT` (8090), `CONNECTOR_HOST` (`0.0.0.0`), `CONNECTOR_KEY` and `CONNECTOR_SEALING_KEY` (32 bytes of base64 each, read once at start and deleted from `process.env`), `CONNECTOR_DENY` (a comma-separated list of CIDR ranges, **required**: the literal `none` says there are none, as compose does), `CONNECTOR_MAX_CHILDREN` (8) and `LOG_LEVEL`. Refused whatever it says: `127.0.0.0/8`, `::1/128`, `169.254.0.0/16`, `fe80::/10`, `0.0.0.0/8`, `::/128`, `224.0.0.0/4`, `ff00::/8`, `255.255.255.255/32` | A default of no platform ranges, which a deployment that forgot them would never notice                                                                                                                                                |
| D1-H | **The child**: `spawn(process.execPath, ['--max-old-space-size=256', childEntry], { env: {}, stdio: 'pipe' })`; one JSON line in (the request, the opened secret and the guard's ranges) and one out; its standard error read, counted and dropped; killed with `SIGKILL` one second after the request's deadline. **The guard runs in the child**, which resolves and dials, so the process that meets a hostile source holds no key. At most 8 children at once (Q1: about 65 a second on 2 CPUs)                                                          | `fork`, whose IPC channel nothing needs; a worker thread, which shares the supervisor's memory and so the key; the guard in the supervisor, which would put hostile DNS answers in the process that holds the key                      |
| D1-I | **Compose puts the connector on `connector-private` and `connector-egress`, both `internal: true` with `com.docker.network.bridge.gateway_mode_ipv4: isolated`**, so neither the platform's containers nor the host is on either (Q2). Docker Engine 28 or later. Production's egress reaches the internet, so it is not internal: that isolation is hosting's, as system.md says                                                                                                                                                                            | A plain egress network, which Q2 showed reaches every port the host publishes on all addresses                                                                                                                                         |
| D1-J | **A development source in a compose profile, `sources`**: `source-postgres`, PostgreSQL 18.6 by the spike's digest (`sha256:4ef4dbc9...`), TLS on with the image's own snakeoil pair, seeded by `deploy/sources/postgres.sql` with a read-only account `reader`, an account `writer` that may insert, and schema `sample` holding `site`, `reading` and a view `site_summary`. It publishes no port. `deploy/.env.example` sets `COMPOSE_PROFILES=sources`; CI's whole-system job passes `--profile sources`                                                 | The source in every compose run, which a small installation (ADR-0019) would then run too                                                                                                                                              |
| D1-K | **The connector's own suite reaches its source on `127.0.0.1:5434`**, a container `pnpm --filter @alloy-works/connector source` starts from the same image and seed (and CI's build job in a step). Loopback is always refused, so the suite hands the child a policy without `127.0.0.0/8` through a function parameter, never configuration; a test holds the production policy to refusing loopback whatever `CONNECTOR_DENY` says                                                                                                                        | A flag in configuration that lets loopback through, which would be one environment variable from a route into every host; or running the suite inside a container on the egress network                                                |
| D1-L | **A test and a describe answer `connection_failed` for every failure to reach or authenticate, and a failed test answers no sooner than the connect timeout, 5 s**, so neither its words nor its time tells a refused port from a filtered one or a guarded address. `address_refused` is a run's (D2)                                                                                                                                                                                                                                                       | Describe answering `address_refused`, which would make it the oracle a test is not; answering each failure as fast as it happened, which says refused (1 ms) from filtered (5 s)                                                       |
| D1-M | **D1's test reports one finding, `account_not_read_only`**, by the catalogue query in task 4. `account_holds_privilege` arrives with asserted identity (D7), where it refuses something. A source older than PostgreSQL 14 answers `source_unsupported` once authenticated                                                                                                                                                                                                                                                                                   | A finding nothing reads yet; guessing at a source whose catalogue lacks `pg_write_all_data` and `client_connection_check_interval`                                                                                                     |
| D1-N | **Every test the connector answered is a `connection_test` row**, ok or failed, naming the connection version tested, who asked and when; nothing is recorded for one refused before the connector is asked (no credential, retired, no connector)                                                                                                                                                                                                                                                                                                           | Recording only successes, which would leave DAT-103's refusal reading a stale pass                                                                                                                                                     |
| D1-O | **Where used, and refusing to retire a connection in use, arrive with D2**, when there is a definition to name. D1 builds retiring (a version, `retired: true`), reinstating (a version, `retired: false`), and refuses test, describe and setting a credential on a retired connection, `connection_retired`                                                                                                                                                                                                                                                | `GET /v1/connections/{id}/uses` answering nothing on every call: a route that can only say "not used" is a promise with nothing behind it                                                                                              |
| D1-P | **`write_sql` joins the closed sets in D2's migration, with the check that reads it (DAT-101).** Recommended against data.md's D1 row: `permissions.ts` says a permission no check reads is "a promise with nothing behind it", and until D2 nothing could check it. Reversing this costs one word in each of two constraints                                                                                                                                                                                                                                | Granting a permission for two slices before anything decides it                                                                                                                                                                        |
| D1-Q | **Failures, and their HTTP status**: a failed test is an answer (200). Describe's `connection_failed` and `connector_error` are 502, `timeout` 504; `connector_unavailable` and `connector_busy` 503; `connection_retired` and `credential_missing` 409; `connection_invalid` and `identity_not_supported` 400. Three codes join data.md's table: **`connector_error`** (connector: the child ended without an answer), **`connector_unavailable`** and **`connector_busy`** (product)                                                                       | A child that crashed answered as `connection_failed`, which would blame the source for the product                                                                                                                                     |
| D1-R | **Limits, data.md's open question for D1**: by default 10,000 rows, 5 MiB (5,242,880 bytes) and 30 s; the product's ceilings 100,000 rows, 25 MiB (26,214,400 bytes) and 120 s, which a definition may not exceed and a tenant only lowers. In `packages/domain/src/data/limits.ts` now, enforced from D2. A test's deadline is 10 s (connect 5 s), a describe's 20 s. Case 7: a database child holds the byte limit plus the largest value, 5 to 10 times it                                                                                                | 10 MB and 100,000 rows as the spike ran, which at 5 to 10 times the value puts a child near a gigabyte                                                                                                                                 |
| D1-S | **The credential route takes no idempotency key**: a repeated `PUT` already ends where one does, and a recorded request or answer is one more place a secret could rest                                                                                                                                                                                                                                                                                                                                                                                      | Recording it as every mutating route is recorded                                                                                                                                                                                       |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title; an
  `it.each` title cites nothing, and a `rule:` field in a test cites its requirement.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture. Every
  source password in `deploy/` is an invented development value.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; pins from the tool, never by hand. The full suite before the pull
  request, and its CI log read.
- A stored shape is checked against every write path it admits (below).
- Every trigger or function reading a table reads it by `tg_table_schema`.
- **No secret in a URL, an argument, an environment variable of a child, a log line, an error or an
  answer**, at any layer; each path has a test (DAT-005).
- Never test against the development stack's compose project; the suites use their own databases and
  their own source container.

## The stored-shape check

Versions are insert-only, so anything a stored shape accepts today that a later rule refuses is a
migration of immutable history.

**The write paths.** A connection version: `POST /v1/spaces/{space}/connections` to `createConnection`
to `createArtifact`, and `POST /v1/connections/{id}/versions` to `recordConnectionVersion` to
`recordVersion` - both through `prepare` in `packages/db/src/versions.ts`, which calls
`parseConnectionForWrite` (the shape and the declaration check). Read back through `substanceOf` with
`parseConnection`, the shape alone, so a declaration widened later (D7) never makes a stored version
unreadable. `testing/every-kind.ts` makes one through `createArtifact` like any caller. A credential
row: `setConnectionCredential` alone, from the connector's `seal` answer after the service has parsed
it with the protocol's schema. A test row: `recordConnectionTest` alone. Nothing else writes these.

**The canonical form.** A connection version is canonicalised by the shared rule, `canonicalJson`
with no set rule: it holds no array and no member named `marks`. Proved: two member orders give one
digest, and the stored row's digests recompute from `jsonb`.

| #   | Member                                             | Validated on every write path by                                                                                                                                                                                                                     | Loose or tight                                                                                                                                            | Points at, and who checks                                                                                                      |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `schemaVersion`                                    | `z.literal(1)`                                                                                                                                                                                                                                       | Tight                                                                                                                                                     | Nothing                                                                                                                        |
| 2   | `name`                                             | 1 to 200 characters, equal to its trim, no C0 or C1 control                                                                                                                                                                                          | Tight; the space's names are not unique for connections, as for templates                                                                                 | Nothing                                                                                                                        |
| 3   | `description`                                      | 0 to 2,000 characters, no control but a line feed                                                                                                                                                                                                    | Tight                                                                                                                                                     | Nothing                                                                                                                        |
| 4   | `type`                                             | `z.literal('postgres')` (D1-C)                                                                                                                                                                                                                       | Tight; widened by an arm per slice                                                                                                                        | The declarations table                                                                                                         |
| 5   | `source.host`                                      | A lower-case DNS name (labels of `a-z`, `0-9` and `-`, 1 to 63, 253 in all, the last not all digits), or a canonical dotted quad without leading zeros, or a canonical compressed IPv6 address without brackets or zone                              | Tight: `2887715339`, `0254.037.012.013`, `0x7f.0.0.1`, `127.1`, a trailing dot, `/var/run/postgresql` and `C:\x` are refused here, and again by the guard | A host. **Its address is not checked at write**: what it resolves to changes, so the guard decides at each request             |
| 6   | `source.port`                                      | An integer, 1 to 65535                                                                                                                                                                                                                               | Tight                                                                                                                                                     | Nothing                                                                                                                        |
| 7   | `source.database`, `source.account`                | 1 to 63 UTF-8 bytes (PostgreSQL's `NAMEDATALEN` less one), no U+0000                                                                                                                                                                                 | Tight                                                                                                                                                     | Objects at the source, checked by connecting                                                                                   |
| 8   | `source.tls`                                       | `'require' \| 'verifyFull'`                                                                                                                                                                                                                          | Tight: no `disable`. A private CA arrives as an optional member, which refuses nothing stored                                                             | Nothing                                                                                                                        |
| 9   | `identity`                                         | A discriminated union of strict objects, the design's three; then the declaration check, `identity_not_supported`, on every write                                                                                                                    | The shapes as designed; nothing but `service` can be written in D1                                                                                        | The declaration, `connectorIdentities` in `packages/domain/src/data/connection.ts`                                             |
| 10  | `retired`                                          | A boolean; `true` refused when a connection is made                                                                                                                                                                                                  | Tight                                                                                                                                                     | Nothing                                                                                                                        |
| 11  | `connection_credential.sealed`                     | `^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$` and at most 5,600 bytes, in the table and in the protocol's schema                                                                                                                      | 0042's shape, a length added: 4,096 bytes of secret seal to 5,462 characters of body                                                                      | Its connection, by `(connection_id, connection_kind)` to `artifact (id, kind)`                                                 |
| 12  | `connection_credential.set_by`, `set_at`           | A principal by foreign key; `set_at` the database's `now()`, not insertable                                                                                                                                                                          | Tight                                                                                                                                                     | Nothing                                                                                                                        |
| 13  | `connection_test` `outcome`, `findings`, `failure` | `outcome in ('ok', 'failed')`; `findings` a one-dimensional `text[]`, a subset of `{account_not_read_only}`, distinct, empty unless ok; `failure` one of `connection_failed`, `timeout`, `connector_error`, `source_unsupported` exactly when failed | Tight; a finding added later widens the subset                                                                                                            | The version tested, by `(connection_version_id, connection_id, connection_kind)` to `artifact_version (id, artifact_id, kind)` |
| 14  | `role.permissions`, `api_token.scopes`             | `role_permissions_closed` and `api_token_scopes_closed`, each gaining `use_connection` alone                                                                                                                                                         | Tight                                                                                                                                                     | Nothing                                                                                                                        |

## Task 1: The sealing package, and the purpose

1. `packages/sealing` (`@alloy-works/sealing`, private, `0.0.0`, built before `db` by Turborepo): `seal.ts`
   and `seal.test.ts` moved from `packages/db` unchanged, `SealPurpose` gaining `'source-credential'`.
   `packages/db/src/index.ts` re-exports `sealSecret`, `openSecret`, `sealingKey`,
   `SealedSecretRefused` and `SealPurpose` from it, so `packages/objects`, the service and every test
   keep their imports.
2. **Tests** (`packages/sealing/src/seal.test.ts`): the moved titles, unchanged; and `IAM-075 seals a
source credential to its tenant and to source-credential, so it opens for neither another tenant nor
another purpose` (a `source-credential` seal opened as `sign-in`, and as another tenant's, refused).

## Task 2: The domain

All in `packages/domain/src/data/`, exported from the package's surface; zod and no platform.

```ts
// connection.ts
export const CONNECTION_SCHEMA_VERSION = 1;
export type ConnectionSettings = {
  schemaVersion: 1;
  name: string;
  description: string;
  type: 'postgres';
  source: { host: string; port: number; database: string; account: string; tls: 'require' | 'verifyFull' };
  identity:
    | { kind: 'service' }
    | { kind: 'endUser'; mechanism: 'delegated'; tokenEndpoint: string; audience: string }
    | { kind: 'endUser'; mechanism: 'asserted'; attribute: 'email' | 'subject'; assertion?: 'sessionContext' | 'executeAs' };
  retired: boolean;
};
export const connectorIdentities: Record<ConnectionSettings['type'], readonly ('delegated' | 'asserted')[]> =
  { postgres: [] };                                             // D7 adds 'asserted'
export function parseConnection(value: unknown): ConnectionSettings;          // the shape; read-back
export function checkConnection(settings: ConnectionSettings): ConnectionProblem[];   // rules
export function parseConnectionForWrite(value: unknown): ConnectionSettings;  // shape, then check; throws ConnectionRefused
export type ConnectionProblem =
  | { rule: 'connection_invalid'; path: string; message: string }
  | { rule: 'identity_not_supported'; type: string; mechanism: string };

// failures.ts - data.md's table, and D1-Q's three
export type Attribution = 'connector' | 'query' | 'product';
export const dataFailures: Readonly<Record<DataFailureCode, Attribution>>;
export type DataFailure = { code: DataFailureCode; attribution: Attribution };

// columns.ts - the column type vocabulary (the design's `Column.type`), used here only to propose
export type ColumnType = /* data.md's eight bases and image */;

// protocol.ts - the connector's requests and answers, parsed on both sides
export const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;
SealRequest    { tenant: uuid; secret: string }                         // 1 to 4,096 UTF-8 bytes, no U+0000
SealAnswer     { sealed: string }                                       // SEALED, at most 5,600 bytes
TestRequest    { requestId: uuid; tenant: uuid; connection: { id: uuid; version: uuid };
                 settings: ConnectionSettings; sealed: string; deadlineMs: number }   // 1,000 to 60,000
TestAnswer     { outcome: 'ok'; findings: 'account_not_read_only'[] }
             | { outcome: 'failed'; failure: DataFailure }
DescribeRequest = TestRequest
DescribeAnswer { relations: Relation[]; truncated: boolean } | { failure: DataFailure }
Relation       { schema: string; name: string;
                 kind: 'table' | 'view' | 'materializedView' | 'foreignTable' | 'partitionedTable';
                 columns: { name: string; sourceType: string; nullable: boolean; proposed: ColumnType | null }[] }
ChildRequest   { kind: 'test' | 'describe'; request: TestRequest; secret: string;
                 deny: string[]; connectTimeoutMs: number; failureFloorMs: number }   // one line on stdin

// limits.ts (D1-R)
export const defaultLimits = { rows: 10_000, bytes: 5_242_880, seconds: 30 } as const;
export const limitCeilings = { rows: 100_000, bytes: 26_214_400, seconds: 120 } as const;
```

**Tests:**

- `connection.test.ts`: `DAT-001 holds a connection's name and the settings of one PostgreSQL source,
whole, or refuses them by rule` (each member of the stored-shape table refused by its rule, an unknown
  member refused, a whole one taken); `DAT-078 refuses a connection whose identity its connector does not
declare, identity_not_supported` (asserted and delegated on `postgres` refused on write, `service`
  taken, and a stored asserted version still read by `parseConnection`); uncited, `refuses a host that
names a path, a socket, a port or a number that is not a canonical address` over case 1's spellings
  (row 5); `a version's digest is the same for any order of its members`.
- `failures.test.ts`: `DAT-049 fixes the attribution of every data failure by its code` (every code
  data.md names and D1-Q's three, each once, each one of three attributions).
- `protocol.test.ts`, uncited: each answer round-trips; `SEALED` is 0042's pattern, character for
  character, read from the migration's text; a secret with U+0000 or over 4,096 bytes refused.

## Task 3: The permission, the migration and the database

1. **`use_connection`** joins `permissions` and `externalCap` in
   `packages/domain/src/access/permissions.ts`; no starting role gains it (`role.ts` unchanged);
   `decide` walks it from the artifact as it does every permission but `manage_definitions`.
2. **`0044_connections.sql`** (D1-A), in this order:
   - `artifact_kind_check`, `artifact_space_by_kind` and `artifact_version_component_author` each
     gain `'connection'`, the last between `set constraints ... immediate` and `deferred` as 0028 does.
   - `role_permissions_closed` and `api_token_scopes_closed` rewritten with `use_connection`.
   - `connection_credential (connection_id uuid not null, connection_kind text not null default
'connection' check (connection_kind = 'connection'), sealed text not null, set_by uuid not null
references principal, set_at timestamptz not null default now(), foreign key (connection_id,
connection_kind) references artifact (id, kind))`, the `sealed` check of row 11, an index on
     `(connection_id, set_at desc)`.
   - `connection_test (connection_id, connection_version_id, connection_kind, outcome, findings
text[] not null default '{}', failure text, tested_by uuid not null references principal,
tested_at timestamptz not null default now(), foreign key (connection_version_id, connection_id,
connection_kind) references artifact_version (id, artifact_id, kind))`, the checks of row 13.
   - For both: `revoke insert, update, delete, truncate` from the runtime role, then `grant insert`
     on every column but the time, and `grant select`, as 0040 does.
3. **`packages/db/src/connections.ts`**: `createConnection(trx, { author, spaceId, settings })`,
   `readConnection(trx, id)`, `recordConnectionVersion(trx, { author, id, openedFrom, settings })`
   answering `{ connection } | { answer: 'version.precondition' | 'version.unchanged' |
'connection.missing' | 'space.missing' }`, `listReadableConnections(trx, principal, asked,
{ spaces? })` as `listReadableTemplates` pages, `setConnectionCredential(trx, { id, sealed, by })`,
   `credentialOf(trx, id)` answering `{ set: false } | { set: true, setBy, setAt }` and
   `sealedCredentialOf(trx, id)` (the service's alone, never a route's), `recordConnectionTest` and
   `latestConnectionTest`. `artifactKinds` and `spacedKinds` gain `'connection'`;
   `VersionSubstance` gains `ConnectionSubstance { kind: 'connection'; content: ConnectionSettings }`;
   `prepare` and `substanceOf` gain its arm (the stored-shape check's write and read parses); every
   test that holds each kind to a decision - search kinds, `every-kind.ts` - declares a connection
   not searchable (data.md, "Searchable").
4. **Tests** (`packages/db`):
   - `connections.test.ts`: `DAT-001 makes a connection in one space of the tenant's own schema,
named, holding one source's settings`; `DAT-007 records each change to a connection's settings as a
version, retiring among them, and each credential set as a row naming who and when and never the
value` (two versions compared name the changed member; a credential row holds only the sealed value;
     the version chain unchanged by a credential); `DAT-003 holds a connection's credential only sealed, in
a row the runtime role can add and never change or remove`; uncited, a stale `openedFrom` refused and
     an unchanged version answered unchanged; `connection_test` refusing another connection's version, a
     finding on a failure, an unknown finding and a failure without `failure`, and refusing an update.
   - `tenant-database.test.ts`: `IAM-075 keeps each environment's source credentials, sealed, in its
own schema and in no shared one`.
   - `access-schema.test.ts`, uncited: the two closed sets admit `use_connection` and refuse
     `use_connections` and `write_sql` (D1-P).
   - `connection-migration.test.ts`, uncited, **fresh against upgraded**: `migration 0044, over an
environment made before it` - an environment migrated to 0043 (the 0042 test's copy of the
     migrations, filtered below 44) holding a role, a scoped token and one artifact of every kind, then
     0044: every row still valid; the five rewritten constraints' `pg_get_constraintdef` equal to a
     fresh environment's; the runtime role's privileges on the two tables, column by column, equal
     to a fresh environment's.
   - `packages/domain` `permissions.test.ts`: the uncited closed-set test gains `use_connection`;
     uncited, `no starting role holds use_connection, and an external principal is refused it
whatever the grants say`.

## Task 4: The connector

`apps/connector` (`@alloy-works/connector`, private, ESM, Node 24): dependencies
`@alloy-works/domain`, `@alloy-works/sealing`, `pg` and `zod`, and nothing else at runtime.

| File            | Holds                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`     | `loadConnectorConfig(env)`: D1-G, refusing to start naming the variable and never its value; `builtInDenied` the nine ranges                                                                                                                                                                                                                                                                |
| `main.ts`       | Reads the config, deletes the two keys from `process.env`, starts the server; thin                                                                                                                                                                                                                                                                                                          |
| `server.ts`     | `createConnectorServer({ config, spawnChild, clock })`: the four paths, authentication, the 64 KiB body limit, the child cap, the log line                                                                                                                                                                                                                                                  |
| `supervisor.ts` | `childSpawn(request): { file, args, env }` (pure, tested) and `runChild(spec, input, deadlineMs)`: spawn, write one line, read one line, kill at the deadline plus 1 s; `timeout` when killed, `connector_error` when it exits without an answer                                                                                                                                            |
| `child.ts`      | The child's entry: reads `ChildRequest`, runs `test` or `describe`, writes one answer, closes the source connection, exits 0                                                                                                                                                                                                                                                                |
| `guard.ts`      | `normaliseHost(raw)` (decimal, octal, hex and short IPv4 forms, IPv4-mapped IPv6, a trailing dot, brackets; a zone refused), `guardedAddress(host, { deny, builtIn, lookup })` resolving once over `net.BlockList` and answering the one address to dial or `refused`                                                                                                                       |
| `postgres.ts`   | `connectPostgres(settings, secret, address, deadline)`: `pg.Client` with `host` the checked address, `ssl: { servername, rejectUnauthorized: tls === 'verifyFull' }`, `connectionTimeoutMillis` 5,000, `application_name` `alloy-connector`, `options: '-c client_connection_check_interval=250 -c statement_timeout=<remaining>'`; `readOnlyFindings(client)`; `describeRelations(client)` |

**The child's source work.** The environment is empty, so no `PG*` variable and no `~/.pgpass` reaches
`pg`. After authenticating: `server_version_num` below 140000 answers `source_unsupported`; otherwise
the test runs

```sql
select r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls
    or pg_has_role(current_user, 'pg_write_all_data', 'USAGE')
    or has_database_privilege(current_database(), 'CREATE')
    or exists (select 1 from pg_namespace n
               where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
                 and has_schema_privilege(n.oid, 'CREATE'))
    or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind in ('r', 'p', 'v', 'm', 'f')
                 and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
                 and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE')
                      or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE')))
       as may_write
from pg_roles r where r.rolname = current_user
```

and reports `account_not_read_only` where `may_write`. Describe reads `pg_class`, `pg_namespace`,
`pg_attribute` and `pg_type` for the relations of those kinds the account may `SELECT` in a schema it
may use, outside `pg_catalog`, `information_schema` and `pg_toast*`, ordered by schema, name and
column number, at most 2,000 relations (then `truncated: true`). **The proposal map**, a domain's base
type followed first: `int2`, `int4`, `int8` to integer; `numeric` with a type modifier to decimal of
its precision and scale, without one to none; `text`, `varchar`, `bpchar`, `name`, `citext`, `uuid`,
`json`, `jsonb`, `xml` and any enum to text; `bool` to boolean; `date` to date; `time`, `timestamp`
and `timestamptz` to time, local date-time and instant, their fraction the modifier or 6; everything
else - `float4`, `float8`, `money`, `bytea`, `interval`, `timetz`, arrays, ranges - to none, for the
author to declare in D2. **A SQL statement's result shape waits for D2**, which brings the SQL fetch
it describes.

**Tests** (`apps/connector`):

- `guard.test.ts`, uncited: `refuses every spelling of a platform, loopback or link-local address case 1
reached, and allows the declared private source` - with `172.31.10.0/24` denied: `172.31.10.11`,
  `2887715339`, `0254.037.012.013`, `::ffff:172.31.10.11`, `172.31.10.11.`, `127.0.0.1`,
  `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`, `127.1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `[::1]`,
  `169.254.169.254`, `fe80::1`, `fe80::1%eth0`, `0.0.0.0`, `/var/run/postgresql`,
  `/etc/ssl/private/source.key`, and a name resolving to `127.0.0.1` refused; `172.31.20.21` and a
  name resolving to it allowed. `resolves a name once and dials the address it checked` (a lookup
  answering the source then the platform is asked once, and the address handed on is the first).
  `holds the production policy to refusing loopback whatever CONNECTOR_DENY says` (D1-K).
- `supervisor.test.ts`: `DAT-056 runs each request in a fresh process handed one opened credential,
never the sealing key, and nothing of the supervisor's environment` (`childSpawn` gives an empty
  environment and arguments naming neither secret nor key; two requests, two process ids; the key's
  bytes in no child's input); uncited, a child past its deadline killed and answered `timeout`, a child
  that exits without an answer answered `connector_error`, a ninth request at the cap answered 503.
- `package.test.ts`: `DAT-056 has no dependency that reaches the platform: no database library of the
platform's, no object store, no service` (the package's dependencies are the four named, and nothing
  it imports resolves into `packages/db`, `packages/objects` or `apps/service`).
- `postgres.test.ts`, against the suite's source: `DAT-075 answers connection_failed alike for a refused
port, a filtered one, an unknown host, a guarded address and a wrong password, naming no address,
echoing no credential, and no sooner than the connect timeout` (five answers equal byte for byte; a
  `verifyFull` against the snakeoil pair answers the same); `DAT-103 finds an account that may write at
the source not read-only, once it has authenticated` (`writer` found, `reader` not); `DAT-114 never
reuses a source connection: the process that opened it closes it and exits with its request` (no
  backend named `alloy-connector` left in `pg_stat_activity`, observed from a separate connection, and
  the child's process gone); uncited, describe lists `sample.site`, `sample.reading` and
  `sample.site_summary` with each column's proposal, and not a table `reader` may not select.
- `secrets.test.ts`: `DAT-005 keeps a credential out of every answer, log line and crash report of the
connector, raw, URL-encoded or base64` - case 2's matrix for PostgreSQL (a wrong password, an unknown
  host, TLS required where the source offers none, a timeout, a malformed host), then a child made to
  throw the raw driver error uncaught; every answer, every supervisor log line and the child's
  captured standard error searched for a canary secret in the three encodings.
- `server.test.ts`, uncited: `seal` answers a value `SEALED` matches that opens only with the
  connector's key and the tenant's id; a request without the key, or with another, 401 and no body; a
  body over 64 KiB 413; `health` answers `{ ok: true }` to anybody.

## Task 5: The service and the contract

1. **Configuration**: `CONNECTOR_URL` (an `http:` or `https:` URL) in `config.ts`, and
   `SECRET_CONNECTOR_KEY` through `secrets.ts`, together or neither (D1-F); `describeConfig` shows the
   URL's host and never the key.
2. **`apps/service/src/data/connector.ts`**: `createConnectorClient({ url, key, fetch })` with
   `seal(tenant, secret)`, `test(request)`, `describe(request)`; every answer parsed with the domain's
   protocol schemas; a network error, a 5xx or an answer that does not parse is `connector_unavailable`,
   never the error's text; the client's own timeout the request's deadline plus 2 s.
3. **The routes** (`packages/api-contract/src/connections.ts`, `apps/service/src/data/connections.ts`):

| Route                                 | Access                    | Body                           | Answer                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/connections` | `administer` on the space | `{ settings }`                 | 201 `ConnectionView`                                                                                                                                                                                    |
| `GET /v1/connections`                 | Signed in                 | `?spaces=&cursor=&limit=`      | `{ items: ConnectionSummary[], next? }`, the ones the caller may read: `{ id, space, name, type, retired, credentialSet, lastTest: { outcome, at } \| null, changedAt }`                                |
| `GET /v1/connections/{id}`            | `read` on it              |                                | `ConnectionView { id, space, version, settings, credential: { set: false } \| { set: true, setBy, setAt }, lastTest: { outcome, findings, failure?, at, by, version } \| null, mayAdminister, mayUse }` |
| `POST /v1/connections/{id}/versions`  | `administer` on it        | `{ openedFrom, settings }`     | `ConnectionView`; 409 `version_precondition` with the current one; `version_unchanged` as elsewhere                                                                                                     |
| `PUT /v1/connections/{id}/credential` | `administer` on it        | `{ secret }`, 1 to 4,096 bytes | `{ credential, test }`: seals through the connector, adds the row, then tests as the rotation act (DA-T). No idempotency key (D1-S). `dependents` joins in D2                                           |
| `POST /v1/connections/{id}/test`      | `use_connection` on it    | `{}`                           | `TestView { outcome: 'ok', findings, at } \| { outcome: 'failed', failure: { code, attribution, message }, at }`, recorded (D1-N)                                                                       |
| `POST /v1/connections/{id}/describe`  | `use_connection` on it    | `{}`                           | `{ relations, truncated }`, or a failure by D1-Q's status                                                                                                                                               |

`refused` gains `connection.invalid` (rule DAT-001), `identity.not_supported` (rule DAT-078),
`connection.retired`, `credential.missing` and the data failures, each carrying `attribution`.
The OpenAPI document and the client are regenerated; each route is documented as #353 requires.

**Tests** (`apps/service`):

- `connection-routes.test.ts`, with a hand-written fake connector: `DAT-004 answers whether a credential
is set, by whom and when, and never the credential or its sealed value`; `DAT-075 tests a connection
through the API and records each test against the version it tested`; `DAT-049 answers every data
failure with its attribution`; uncited, `makes and changes a connection only with administer, and
tests or describes it only with use_connection, each decided at the connection` (an Author and a
  space's Administrator without the grant refused; a grant on the connection alone allows);
  `connection_retired`, `credential_missing` and `connector_unavailable` answered before the connector
  is asked, and nothing recorded.
- `openapi.test.ts`: `DAT-003 takes a credential through a route that answers none of it, and no route
in the API document answers a secret` (no response schema anywhere holds a member named `secret`,
  `sealed`, `password` or `credential` other than the `{ set, setBy, setAt }` shape).
- `data-secrets.test.ts`: `DAT-005 keeps a credential out of every response, log line, error and
idempotency record of the service` - the service's logger captured; a canary set through the route,
  then each failure: the connector unreachable at `seal`, answering a failure, answering garbage; a
  body too long and one with U+0000; each response, each log line, each error's text and cause, and
  every row of `idempotency_record` searched in the three encodings.
- `connector-boundary.test.ts`: `DAT-089 calls the connector only from a route a person calls: nothing
but the connection routes imports its client, and the worker has no address for it` (an import scan
  of `apps/service/src` and `apps/worker/src`; the worker's configuration names no connector).

## Task 6: Deployment and CI

1. **`deploy/Dockerfile`** gains a `connector` target from `base`: `pnpm deploy --filter
@alloy-works/connector /prod/connector`, run as `node`, `CMD ["node", "dist/main.js"]`; CI's build job
   builds it and checks its entry point as it does the service's and the worker's.
2. **`deploy/compose.yaml`**: networks `connector-private` and `connector-egress` as D1-I; the service
   on `default` and `connector-private`, with `CONNECTOR_URL: http://connector:8090` and
   `SECRET_CONNECTOR_KEY`; `connector` on the two, with invented development keys, `CONNECTOR_DENY:
none` and a health check; `source-postgres` in profile `sources` on `connector-egress`, `command:
['postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem', '-c',
'ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key']`, seeded by `deploy/sources/postgres.sql`.
   `deploy/.env.example` gains `COMPOSE_PROFILES=sources`; `deploy/README.md` the connector's variables
   and the profile.
3. **`.github/workflows/ci.yml`**: the build job gains a step starting the suite's source (D1-K) and
   `ALLOY_TEST_SOURCE_PORT`; the whole-system job's stack is `docker compose -f deploy/compose.yaml
--profile sources up -d --build --wait`, and its stop the same with `down -v`.
4. **Tests** (`tests/e2e`, over the whole system):
   - `connector-isolation.test.ts`, each probe a `node:24-bookworm-slim` container run with `--network
container:<id>` - the connector's image carries no probe: `DAT-056 gives the connector a route to
its source and none to the platform: by name, by address or through the host` (from the connector:
     `source-postgres:5432` connects; `postgres:5432`, `seaweedfs:8333`, `stand-in-idp:9090`,
     `service:8088`, each platform container's address from `docker inspect`, and every address its
     routes name a gateway at, on every port compose publishes, do not; the engine is 28 or later);
     `DAT-089 gives the worker no route to the connector` (from the worker: `connector:8090` and its
     address do not connect); uncited, from the service the connector connects and the source does not.
   - `connections.test.ts`: `DAT-075 tests a connection to a real source through the connector, over
the whole system` (made in the development environment, the `reader` credential set, the test ok,
     describe listing `sample.site`; `writer` found not read-only).

## Task 7: The Connections page

1. `apps/web/src/data/`: `Connections.tsx`, the list in layout A with a space facet, as Templates is
   reached; **New connection** in the modal, offered where the person may administer a space;
   `ConnectionPage.tsx` at `#/connections/{id}`: the settings form and **Save version** (administer),
   **Credential** ("Not set", or "Set by Ada on 30 September 2026", and a password field with **Set** or
   **Replace**, emptied once sent), **Test** (use) saying "Connected." or "Could not connect." and, for a
   finding, "This account can change data at the source, so SQL written by hand will not be allowed on
   this connection.", **Tables** (describe), **Retire** and **Reinstate**, and **Manage access**:
   `AccessAt` gains `connection`, and the permission's label reads "use connection".
2. **Tests** (`apps/web`, a fake client): `DAT-075 tests a connection from its page and says it
connected, or the one reason it did not`; `DAT-004 shows whether a credential is set, by whom and
when, and never shows one` (the field is a password field, empty after Set, and nothing the page
   renders holds the canary); uncited, the list, New connection, Save version's precondition, Retire and
   Reinstate, and the page when no connector is configured.
3. `tests/browser`, uncited: the Connections page and its dialogs pass axe-core's WCAG 2.2 AA rules
   and are worked by keyboard alone.

## Task 8: Docs and the release

`docs/architecture.md`: the connector, its two networks and its four paths, the sealing package,
migration 0044 and the two tables. `docs/design/system.md`: the connector as built in development,
and Q2's finding under hosting. `docs/design/data.md`: D1-C, D1-D, D1-O, D1-P and D1-Q folded in as
Ken decides them. `service-foundations.md`: the source credentials row, from designed to built, naming
the IAM-075 tests. `docs/features.md` and the README: connections made, tested and described; nothing
queried. `docs/testing.md`: the connector's suite and its source. This plan's row: Built. The
changelog: the next Minor.

## Verification

- **Suites**, each alone while building: `packages/sealing`, `packages/domain`, `packages/db` (with
  `ALLOY_TEST_DATABASE_URL`), `apps/connector` (with the source up), `apps/service`,
  `packages/api-contract` (the OpenAPI drift check), `apps/web`, `apps/desktop` (the version); then
  the full `pnpm test`, and `pnpm test:e2e` and `pnpm test:browser` against a stack of the build's own
  compose project with `--profile sources`.
- **CI**: the build job runs the connector's suite against its source; the whole-system job runs the
  isolation test, which is Q2's answer on CI's Linux runner; the traceability gate reads both.
- **By hand, before the pull request**: the development stack with the profile, a connection made on
  the page to `source-postgres` as `reader`, set, tested and described, and a wrong password answered
  "Could not connect." after five seconds.

## Questions for Ken before the build

1. **D1-P**: `write_sql` in D2, against data.md's D1 row. Recommended.
2. **D1-D**: the `account` member data.md's shape lacks.
3. **No design for the page.** `docs/interface/` has no Connections screen; task 7 builds it from the
   existing kit (layouts A and D, the modal). Recommended over waiting for one, since D2's definition
   editor will want a designed pair of screens anyway.
4. **Docker Desktop.** Q2 measured Linux. Whether the isolated gateway also closes the spike's
   published-port leak on Docker Desktop for Windows, where you run the stack, was not run: it decides
   only whether your development stack is isolated as CI's is, and a two-minute run in a scratch
   project would say.
5. **The idempotency record.** D1-S assumes a recorded request could hold something derived from the
   body; that was not read while planning. Task 5's DAT-005 test asserts no record holds the secret,
   either way.

## How this plan was made

About 45 minutes of wall-clock time and about 70 tool calls, Q1 and Q2 among them; the plan is about
370 lines.
