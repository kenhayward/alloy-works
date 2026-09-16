# Architecture - the repository as built

> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules
> and the version chain. The workspaces, the split between web and desktop, and the seam between them are
> real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - and the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain). Nothing authors, pastes, cuts or publishes any of it yet.
> The single `Component` beside it in `packages/domain` is still the scaffolding that
> proved the path end to end, and is not a decision about content.
>
> **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
> system of record, publishing workers, PostgreSQL and object storage, and the data flowing between
> them - is [`design/system.md`](design/system.md). None of it exists here yet.

**This document describes the repository as it stands.** The subsystems being designed on top of it
live in [`design/`](design/), one document per subsystem, each naming the requirements it answers.
This page is the map; those are the depth. As each subsystem is built, its design document stops
describing something planned and starts describing something here.

## Workspaces

One pnpm workspace, one lock file, eleven packages.

| Workspace               | Package                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `@alloy-works/domain`       | The content model - the stored shape of a component's content, its canonical form and its migration chain - the admission pipeline everything entering a component passes through - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - the canonical serialisation of a whole version, the theme model, and their rules. Pure TypeScript + zod - no React, no Electron, no `fs`                                                       |
| `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                                                                                                                            |
| `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas, and the OpenAPI document generated from them                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/service`          | `@alloy-works/service`      | The web service: Fastify, hostname to tenant, the contract's routes, and the built renderer beside them                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, playing an organisation's provider or Google, for development and tests only                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/objects`      | `@alloy-works/objects`      | Object storage: a credential per tenant scoped to its own prefix, objects by content hash, and signed links                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/worker`           | `@alloy-works/worker`       | Claims jobs from the platform queue and runs each inside its own tenant; carries the pinned Typst                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/api-client`   | `@alloy-works/api-client`   | The one way in for a client: types generated from `openapi.json`, a typed client, and the stream reader                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/trace`        | `@alloy-works/trace`        | The requirement corpus compiled: the parsers, the citation scanner, the state ladder, `check` and `verify`, the committed `trace.json`, the query command, a hand-written baseline declaring what a release is answerable for, `pnpm trace gate` deciding pass or fail over it, `pnpm trace pack` writing the evidence pack a baseline's release commits alongside it, and intake - the issue form and `pnpm trace draft`, which drafts a row from a filed issue or from flags but never inserts it |
| `tests/e2e`             | `@alloy-works/e2e`          | The whole system in containers, driven over HTTP: sign in, ask for a sample, wait on the stream, fetch the PDF                                                                                                                                                                                                                                                                                                                                                                                      |

CI now has one real gate: `pnpm trace gate`, run as its own step after Test, is not
`continue-on-error` like the checks around it - see [`docs/testing.md`](testing.md) and
[`CLAUDE.md`](../CLAUDE.md) for why that is safe rather than reckless.

The theme model (`src/theme/`) is a prototype, measured and recorded in ADR-0014 but not yet
exported from the package: a resolver and three projections - CSS for the editor, data for the
Typst template, and Word styles. Like the content model draft, it is promoted when the editor or
the publishing pipeline first needs it.

Dependencies point one way: `apps/web` depends on `@alloy-works/domain` and on
`@alloy-works/api-client`, which is the only way it calls the service (API-001); `apps/desktop`
depends on `@alloy-works/web` **for types only** (see the platform bridge below). `packages/db`
depends on `@alloy-works/domain`, for the version's canonical serialisation and the schemas a
version's content is checked against. The domain package
depends on neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI
along.

## The content model

`packages/domain/src/content/model/` holds the shape a component's content is stored in, designed in
[`design/content-model.md`](design/content-model.md) and built on
[ADR-0005](decisions/0005-purpose-built-node-and-mark-content-model.md) and
[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md). It is the whole of the stored
shape and none of the product on top: nothing authors content, stores it, admits it from another
format or publishes it.

| File           | Holds                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| `marks.ts`     | Thirteen marks, and the set is closed. Each carries an identifier and no appearance          |
| `inline.ts`    | Eight inline nodes, and the three-state alternative a figure or an image carries             |
| `blocks.ts`    | Seven blocks, and the restricted sequence a footnote's content is                            |
| `document.ts`  | The root a version holds, and `parseContentDocument` - the one way a document is constructed |
| `canonical.ts` | `canonicalise`, whose output is what a caller hashes into `content_hash`                     |
| `migrate.ts`   | The migration chain, applied on read, and the quarantine for content that will not parse     |
| `mapping.ts`   | One row per node and per mark, naming what it becomes in Word and in tagged PDF              |
| `fixtures/v1/` | Stored content at schema version 1, never deleted                                            |

**Four properties, because each is a decision rather than an implementation detail.**

**The root's members are closed.** A component's content carries the schema version it was written
against, its own title, its base language, its base direction, and its blocks. Adding a member is a
schema version with a migration and a fixture, not a configuration option.

**Every document goes through `parseContentDocument`.** Three rules live there rather than in the
schema, because each is a property of a document rather than of a node: block identifiers are unique
within the component, two adjacent empty paragraphs are refused while one is admitted, and a
footnote's content is paragraphs only.

**Migration is a read-time projection and never a rewrite.** Version rows take inserts only and
`content_hash` is the hash of what was written, so migrating stored content would either invalidate
its hash or need a version row nobody authored. The stored bytes never change. With one schema version
the chain is empty; the chain, the fixture directory and the test that walks every fixture to current
exist anyway, because the first schema change is when a chain nobody built is found to be missing.

**No node exists without a way out.** `mapping.ts` carries a row for every block, inline node and mark,
and a test fails when a type has no row or a row has a blank cell. A cell that cannot be filled is a
finding about the node rather than a comment in the file.

Hashing is deliberately not here. `canonicalise` returns a string and the caller hashes it, because
`node:crypto` is not platform-free and `crypto.subtle` would make parsing async for nothing. The
canonical rules and the migration chain themselves live in `packages/domain/src/stored/`, shared
with the metadata definitions; `canonicalise` names `marks` as the one member whose array is a set.
The whole version's serialisation is `packages/domain/src/version/`, and the hashing of it and of
content is `packages/db/src/version-digest.ts`.

**The content model spike's schema still stands beside this one**, in `packages/domain/src/content/`,
with `compare.ts`, `resolve.ts`, `binding.ts`, the OOXML reader and writer, and the four gate-case
tests that are the evidence ADR-0005 rests on. Retiring it, and moving the OOXML pair out of this
package as `design/content-model.md` requires, is a later plan's work - named in
[`plans/README.md`](plans/README.md) so it is a debt rather than a surprise.

## The admission pipeline

`packages/domain/src/content/admission/` is the one way content enters a component from outside it - a
paste, a copy from another component, and later an import - designed in
[`design/content-model.md`](design/content-model.md), "The admission boundary". Nothing calls it yet: the
editor that pastes through it, and the readers of Word, Markdown and HTML that will feed it, are later
plans.

| File            | Holds                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.ts`     | The entries every stage appends, with fixed messages; what arrived travels in `detail`, never in a message                                          |
| `limits.ts`     | The provisional limits one admission is held to, measured without recursion before any stage walks the content                                      |
| `mathml.ts`     | A strict reader of an equation's MathML, an allowlist of MathML Core, the one form it is written back in, and the check validation makes against it |
| `sanitise.ts`   | Scripts, embedded objects, event handlers, links whose scheme is not allowlisted, executable formatting, MathML                                     |
| `migrate.ts`    | Content at an earlier schema version brought to current through content's own chain, or refused                                                     |
| `normalise.ts`  | Formatting dropped, NFC, empty runs and adjacent empty paragraphs removed, the source's language kept as a mark                                     |
| `reidentify.ts` | A new identifier for every block, footnote and mark; comments, suggestions and conditions without an axis dropped                                   |
| `admit.ts`      | The stages in order, validation last, and the outcome: blocks and the report, or a named refusal and the report                                     |
| `clipboard.ts`  | The product's own clipboard format, written on copy and read on paste                                                                               |

**Four properties, because each is a decision rather than an implementation detail.**

**One pipeline, and it does not know the source.** A reader turns its format into untrusted JSON, using a
fixed vocabulary for what the pipeline removes, and never removes it itself; a copy within the product and
a foreign paste are therefore reported to one standard. Anything inside the content that no stage knows is
refused by validation, with the whole admission - the candidate's root contributes only its content,
schema version, language and direction, so any other root member (a stray `title`, say) is dropped in
silence rather than refused.

**The report comes back with the content.** Every stage that discards or rewrites appends to it, and a
refusal returns it too, ending with why. Messages are fixed strings; content is never interpolated into one.

**An outcome, never an exception, and never part of the content.** Either every block that survived,
validated as a whole under the receiving component's root, or a named refusal and nothing.

**MathML is the one markup this package reads.** An equation is rendered as markup, so it is the one string
a script could hide in. The reader refuses rather than guesses, and writes every combining mark as a
reference so that NFC cannot fuse one with a tag. Validation asks the same reader: `parseContentDocument`
refuses an equation whose MathML the reader would not keep exactly as it stands, so content that reaches
validation without passing through admission meets the same rule, and there is no second description of
the form to drift from the first.

## Metadata

`packages/domain/src/metadata/` holds the rules that decide which fields apply to a component, what
makes a value valid, and what a version records about the definitions it was written against, designed
in [`design/metadata.md`](design/metadata.md). They are pure functions over definition payloads a
caller hands in. Nothing stores a definition or a value, no route calls them, and no panel shows them.

| File                  | Holds                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lexical.ts`          | The forms a value takes: a decimal as a canonical string, a date, a time, a date and time with its offset                              |
| `definition.ts`       | The definition schema version every field, schema and component type records                                                           |
| `field.ts`            | Seven closed data types, and the field definition. No `pattern` yet                                                                    |
| `schema.ts`           | The metadata schema definition, and `checkSchema`, which checks each default against its field                                         |
| `component-type.ts`   | The component type definition, whose assignments name a schema and the fields they require                                             |
| `migrate.ts`          | The migration chain per definition kind, applied on read, and `readDefinition`'s report                                                |
| `failure.ts`          | `MetadataFailure`, its stable `code` and the rule union, and `failure()` to build one - the shape the service's error shape will carry |
| `check-value.ts`      | `checkValue(field, value)`: the field's own rules, and nothing else                                                                    |
| `values.ts`           | `MetadataValues`, `hasMember`, `isClear`, `isUserValue` and `sameValue` - the value-shape rules the rest of the package shares         |
| `resolve.ts`          | `resolveComponentFields`, and the error a default it cannot use throws - disagreeing, or refused by its field                          |
| `check-assignment.ts` | `checkAssignment`: a stray `requires`, and a default that disagrees with one already assigned                                          |
| `validate.ts`         | `validate(effective, values)`: every failure, each naming the schemas behind a schema's rule                                           |
| `users.ts`            | `checkUserValues` over a lookup the service supplies, and `principalIdsIn` to load it in one query                                     |
| `carry.ts`            | `carryForward`: what the next version holds, and `notCarried`                                                                          |
| `record.ts`           | `definitionsFor`, and the canonical form of values and `notCarried` in the version digest                                              |
| `fixtures/v1/`        | Stored definitions at definition schema version 1, never deleted                                                                       |

The canonical form and the migration chain both rest on `packages/domain/src/stored/`, shared with the
content model - see [above](#the-content-model).

**Four properties, because each is a decision rather than an implementation detail.**

**A value is valid or not by its field alone.** `checkValue` takes the field and the value. The two
rules a schema imposes - required and fixed - are `validate`'s, and name every schema that imposed
them; checking that a user value names somebody needs the directory, so it is `checkUserValues`, apart
from `validate`, which runs at publish with no directory to hand.

**A number is the string entered.** It is valid only in canonical form - no leading zeros, no trailing
fractional zeros - and `canonicaliseDecimal` is how a caller gets there. Comparison is exact, so a bound
of `9007199254740993` means that number and not its nearest float.

**Carrying forward never changes a value that is present.** No member and a clear are different: only
a field with no member takes a default, so a clear survives, and a present value on a fixed field that
differs from its default stays for `validate` to name rather than being replaced.

**Definitions are read the way content is.** Every payload records its definition schema version and is
migrated on read, never on write, through the chain `packages/domain/src/stored/` now provides to
content and definitions alike, beside the canonical rules both serialise with.

`pattern` does not exist yet: metadata.md's open question on bounding its backtracking is unanswered,
and the field definition refuses one.

## The version chain

`packages/db` holds the permanent record every versioned thing is kept in, designed in
[`design/storage-and-versioning.md`](design/storage-and-versioning.md) under
[ADR-0024](decisions/0024-a-version-digest-over-the-whole-version.md). Two tenant migrations and five
functions, each taking the transaction `withTenant` opened. Nothing calls them yet: no route cuts a
version, and there is no iteration, lock, revision or baseline.

| Where                                         | Holds                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/tenant/0007_spaces_and_artifacts` | `space`, name unique in the tenant; `artifact`, an id and a kind, in exactly one space for a component and in none for a field, schema or type             |
| `migrations/tenant/0008_version_chain`        | `artifact_version` - numbers, author, time, note, schema version, content, values, what was not carried, the type, both digests - and `version_definition` |
| `src/version-digest.ts`                       | `versionDigests`: SHA-256 over `canonicaliseVersionContent` and `canonicaliseVersion` from the domain package                                              |
| `src/spaces.ts`                               | `createSpace`                                                                                                                                              |
| `src/versions.ts`                             | `createArtifact` at `0.1`, `readVersion`, `latestVersion`, `substanceOf`, and `recordVersion`                                                              |
| `src/load/`                                   | The load test, outside `pnpm test`: `pnpm --filter @alloy-works/db test:load`                                                                              |

**Four properties, because each is a decision rather than an implementation detail.**

**Insert-only is a grant.** The tenant's runtime role holds `INSERT` and `SELECT` on `artifact_version`
and `version_definition` and nothing else, and no `UPDATE` on `artifact`; a test attempts each refused
statement as that role. A correction is another version.

**Two digests, each with one meaning.** The version digest is over the whole version - content, type,
values, what was not carried, and the definitions as a set - and decides whether a version changed:
`recordVersion` answers `version.unchanged` rather than inserting a version that says nothing new. The
content hash is over content alone and will key derived data. Authorship is in neither. Both are
recomputable from a row read back, by `versionDigests(substanceOf(row))`.

**The database checks the shape of what a version records, not its substance.** It checks that a
version's kind is its artifact's; that only a component records a component type or carries values,
held as an object and a list; that its schema version is its content's; that each recorded
definition's kind, identifier and version are exactly a stored definition version's, by a composite
foreign key; and that a component's type is the component type version it records among those
definitions, by a key checked at commit (`artifact_version_component_type_recorded`). It does not
check the content against the content model, that a definition's payload `id` is its artifact's id,
that every identifier is spelled as a lower-case hyphenated UUID, or that the digests match the row:
`createArtifact` and `recordVersion` do those before they write, and anybody holding the row can
recompute the digests. **One gap is named rather than closed:** nothing refuses a later transaction
inserting a `version_definition` row against a version already cut. The version digest detects it, since
the definitions are part of what it covers, but nothing prevents it; refusing it would take a trigger,
which the plan's decision 5 disfavours. storage-and-versioning.md names the same gap beside VER-008 and
VER-042.

**Content is inline JSONB, and was measured before it was built on.** The load test's volumes,
thresholds and result are in [the plan](plans/2026-09-15-storage-01-the-version-chain.md), task 5.
Content is stored as parsed and never rewritten; migration stays a projection on read.

## One renderer, two deliveries

`apps/web` **is** the web application, and it is also the thing the Electron window loads. There is
no second copy of the UI and no per-delivery fork of a component.

```
                    packages/domain          (content rules, platform-free)
                            |
                            v
                       apps/web              (React renderer - the whole UI)
                       /        \
          built and served    loaded by
          as a web app        apps/desktop in a BrowserWindow
```

The shell decides where to load the renderer from, and that decision is a pure function
(`resolveRendererTarget` in `apps/desktop/src/shell.ts`) so it can be tested without booting
Electron:

- **Given an environment's address** - loads it, packaged or not
  ([ADR-0022](decisions/0022-the-desktop-window-loads-the-service.md)). A session is a `__Host-`
  cookie belonging to the service's own hostname, and a window loading `file://` is a different
  origin that can hold none, so a desktop delivery without this could not sign in at all. The
  address comes from `ALLOY_SERVICE_URL`; there is no screen to ask for it yet.
- **Unpackaged** - loads `http://127.0.0.1:5173`, the Vite dev server, so a renderer edit
  hot-reloads inside the desktop window. The address is pinned to the **IPv4 loopback**, not
  `localhost`: Node 17+ resolves `localhost` to `::1` first, so a Vite server left on the default
  host binds IPv6 only and the shell's `wait-on tcp:127.0.0.1:5173` blocks forever - a hang with no
  error and no window. Vite's `server.host`, the shell's `DEV_SERVER_URL` and the `dev` script all
  name the same literal address, and a test fails when they drift apart.
- **Packaged** - loads `apps/web/dist/index.html` from disk. The renderer is built with
  `base: './'` for exactly this reason: an absolute `/assets/...` URL resolves against the
  filesystem root under `file://` and the window comes up blank.

### The service serves the renderer

The page and the API it calls are one origin, which is what lets the session cookie work in a
browser tab and in an Electron window alike.

- **In the image**, the service stage carries `apps/web/dist` at `/app/renderer` and `RENDERER_ROOT`
  names it. Without that variable the service answers the API and nothing else, which is what every
  service test does.
- **Anything under `/v1` stays the API's**, including its own "there is nothing here" as JSON.
  Anything else that matches no file is answered with the renderer's page, because the addresses a
  single-page interface owns exist only in the browser. That is `apps/service/src/renderer.ts`.
- **In development** the renderer keeps its own server on 5173 and proxies `/v1` to the service,
  passing the `Host` header through, so the environment resolves from the address in the browser's
  bar exactly as it does in production.
- **Not yet:** the renderer is built with `base: './'` for the packaged desktop fallback, so a deep
  link served by the fallback would resolve its assets relative to that path. Nothing produces a
  deep link yet - there is no routing - and this is settled when there is.

## The platform bridge

Everything that differs between a browser tab and an Electron window arrives through one interface,
so nothing above it has to ask which delivery it is running in.

```ts
interface PlatformInfo {
  readonly delivery: 'web' | 'desktop';
  readonly runtime: string;
}

interface PlatformBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
}
```

- The contract lives in `apps/web/src/platform/contract.ts` and is deliberately **free of DOM
  types**, because the CommonJS Electron shell typechecks against it too. `window` lives next door
  in `bridge.ts`, which only the renderer imports.
- `resolveBridge()` returns the injected bridge if the host provided one, and a browser
  implementation otherwise. The renderer never branches on "am I in Electron".
- The shell's `describePlatform` is typed to return the renderer's own `PlatformInfo`, so changing
  the contract without changing the shell is a **typecheck failure**, not a wrong value in a window.

### The cross-process surface

| Direction        | Mechanism                        | Channel                     |
| ---------------- | -------------------------------- | --------------------------- |
| Renderer -> main | `ipcRenderer.invoke` via preload | `alloy-works:platform-info` |

Rules that hold for every channel added later:

- **The renderer is untrusted.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The preload exposes a narrow, enumerated surface - never a general "run this
  `fs` call for me" bridge.
- Every handler **validates its own arguments in the main process**. The renderer having already
  checked is not a check.
- Channels are namespaced (`alloy-works:`) so an unrelated handler cannot answer them, and the
  channel name and the injected global name are pinned by tests in `apps/desktop/src/shell.test.ts`.
  A rename on one side without the other is a blank window, not a build error.

## Data flow today

There is no server and no persistence behind the renderer yet. The renderer builds one `Component`
through the domain package at module load and renders it, and asks the bridge which delivery it is
running under.

Beside it, the web service answers HTTP on its own: a request's hostname names a tenant, found in the
platform table; the service reads that tenant's data only through `withTenant` in `packages/db`,
which assumes the tenant's role for one transaction
([ADR-0020](decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)); and every
answer and every error follows the contract in `packages/api-contract`, from which the committed
`openapi.json` is generated and checked. People sign in through their organisation's identity
provider - in development and tests, the stand-in - and hold a session in their environment's own
schema, which `GET /v1/me` and signing out use. An environment may also take Google accounts:
Google returns to the one sign-in address, `signin.<domain>`, which checks the account against the
environment's invitations and named Workspace domains and hands the sign-in back to the environment
with a one-time code. Work a request should not wait for goes on a queue in the platform schema - a
tenant, a kind and an id, never content - which a worker claims with `SKIP LOCKED` under a lease and
then does inside that tenant's schema. The one kind there is renders a sample PDF with the pinned
Typst and keeps it in the tenant's own corner of the object store, which its own credential is the
only one that reaches. A signed-in viewer can hold one stream open on their environment,
`GET /v1/stream`: it sends a snapshot of what is there, then ids as things happen. A worker's own
transaction notifies a channel named for its tenant, so nothing is announced that did not commit and
a tenant can speak on no other channel; one listening connection in the service fans that out to the
streams it holds. A stream registers with the fan-out before its snapshot is read and holds what
arrives until the snapshot has gone, so nothing committed in between is lost or overtaken by older
state. Nothing in the renderer calls it: that arrives with the scaffolding's last plan (see
[`plans/`](plans/)). The rest of the proposed system is [`design/system.md`](design/system.md).

## Containers and images

One `Dockerfile`, in [`deploy/`](../deploy/) with everything else the system is deployed by, holds
every image the system runs as, so the install and the build are done once and shared. Its build
context is the repository root, and the ignore list beside it, `deploy/Dockerfile.dockerignore`, is
what keeps `node_modules` and the tests out of that context:

| Target    | Carries                                                                                    | Runs                                                 |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `build`   | The workspaces the containers need, installed and built                                    | Nothing; the other targets copy from it              |
| `tools`   | The whole workspace, `tsx` included                                                        | The compose stack's setup, and the stand-in provider |
| `service` | `apps/service` and its production dependencies, plus the built renderer at `/app/renderer` | `node dist/server.js` on 8080                        |
| `worker`  | The same for `apps/worker`, plus the pinned Typst binary, checked against its hash         | `node dist/main.js`                                  |

Neither image carries development tooling, test files or Electron: the install is filtered to the
workspaces the containers need, and `pnpm deploy` reduces each app to its own production tree. The
service image is the exception to "no renderer": it carries `apps/web/dist` as static files, because
the page and the API it calls have to be one origin.
Both run as the `node` user. CI builds both on every pull request and runs each entry point; nothing
is pushed anywhere, because where they would be pushed comes with hosting.

`deploy/compose.yaml` runs the whole system: PostgreSQL, the object store, the stand-in provider, a
one-shot `setup` that migrates and creates the development environments, then the service and the
worker. Two of those services answer to a name rather than only a container: the object store is also
`store.localhost` and the provider `idp.localhost`. Any `*.localhost` name resolves to the local
machine in a browser and to the container inside the compose network, so **one address works on both
sides** - which is what a signed download link and a sign-in redirect need, since each carries the
address that made it. Their published ports must match the ports inside for the same reason.

The development environment also answers at `127.0.0.1`, given by `DEV_EXTRA_HOSTNAME`, so a tool
that makes nothing of `*.localhost` still reaches it - `tests/e2e` is the reason. Running the setup
again brings an environment's addresses up to date rather than only creating what is missing.

## Build and packaging

| Workspace         | Build                               | Output                                       |
| ----------------- | ----------------------------------- | -------------------------------------------- |
| `packages/domain` | `tsc -p tsconfig.build.json`        | `dist/` - JS, `.d.ts` and source maps        |
| `apps/web`        | `vite build`                        | `dist/` - the static renderer bundle         |
| `apps/desktop`    | `tsc`, then esbuild for the preload | `dist/main.js`, `dist/preload.js` (CommonJS) |

**The preload is bundled, not merely compiled.** The window is created with `sandbox: true`, and a
sandboxed preload can `require` only `electron` and a small set of Node built-ins - a relative
`require` throws before `contextBridge` is reached. `tsc` alone emits `require("./shell.js")`, and
the failure is **silent**: the bridge is never injected, `resolveBridge` falls back to the browser
implementation, and the desktop window reports itself as `web`. So esbuild bundles `preload.ts` into
one self-contained file with `electron` left external, and a test fails the build if a relative
`require` reappears in the output.

Turborepo orders these: `build`, `typecheck` and `test` all declare `dependsOn: ["^build"]`, so the
domain package is built before anything that imports it.

The Electron main process is **CommonJS** on purpose. An ESM main process would force
`sandbox: false` on the preload, which is a worse trade than the one import attribute the CommonJS
side needs to type-import from an ESM package (see the comment in `apps/desktop/src/shell.ts`).

## Packaging

`apps/desktop/electron-builder.yml` produces a Windows NSIS installer, and carries macOS and Linux
configuration that has not been run. There is **no signing, no notarisation, no auto-update and no
release workflow** - `pnpm --filter @alloy-works/desktop package` builds one locally. When releases
are wired up they run on a **tag**, not on every PR.

Two layout facts the shell depends on:

- **The renderer is copied into the bundle as `renderer/`.** `apps/web` does not exist inside the
  package, so `files` maps `../web/dist` to `renderer/` and `rendererIndexHtml` resolves that path
  when `app.isPackaged` is true.
- **Images are unpacked out of the asar.** Electron's **native** image loader is not asar-aware,
  even though Node's `fs` is - so a tray or window icon path inside `app.asar` reads fine from
  JavaScript and produces no icon at all, with no error. The tray images and the window icon are
  listed in `asarUnpack` and read from `app.asar.unpacked` via `assetRoot()`. The renderer is
  deliberately **not** unpacked: `loadFile` goes through the asar-aware path.

## Icons

The vector masters live in `assets/brand/`; everything else is rendered from them. An icon path is
never a build error in any of these mechanisms - the platform substitutes its own default silently -
so every path below is checked against the disk by a test.

| Where                     | Mechanism                                 | Asset                                           |
| ------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Browser tab               | `<link rel="icon">`, ICO and SVG          | `apps/web/public/favicon.ico`, `mark-light.svg` |
| iOS home screen           | `<link rel="apple-touch-icon">`           | `apps/web/public/apple-touch-icon.png` (opaque) |
| Installed web app         | `site.webmanifest`, incl. a maskable icon | `apps/web/public/icon-*.png`                    |
| Window and taskbar        | `BrowserWindow({ icon })`                 | `apps/desktop/assets/icon.png`                  |
| macOS Dock, development   | `app.dock.setIcon()`                      | same                                            |
| About panel               | `app.setAboutPanelOptions({ iconPath })`  | same                                            |
| Tray / menu bar           | `new Tray()`, theme-aware                 | `apps/desktop/assets/tray/*`                    |
| Windows app identity      | `app.setAppUserModelId()`                 | none - see below                                |
| Application icon          | electron-builder `win`/`mac`/`linux`      | `apps/desktop/build/*`                          |
| Installer and uninstaller | electron-builder `nsis`                   | `apps/desktop/build/icon.ico`                   |

**`AppUserModelID` is the one with no asset.** Windows groups taskbar buttons, jump lists and toast
notifications by that id rather than by the window or the executable; left unset, the app inherits
Electron's identity and shows Electron's icon however the other icons are configured. It must equal
`appId` in the packaging config, and a test asserts it does.

**The tray needs three files, not one.** macOS takes a template image and inverts it for the menu
bar itself; Windows and Linux have no such concept, so the glyph is swapped against
`nativeTheme.shouldUseDarkColors` and re-swapped when the theme changes. Each variant ships an
`@2x` companion, which Electron finds on its own from the 1x path.
