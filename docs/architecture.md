# Architecture - the repository as built

> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules,
> the version chain and access. The workspaces, the split between web and desktop, and the seam between
> them are real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain) - and who may do what to it - [access](#access) - and the
> first thing a person authors with: [the editor and its session](#the-editor-and-its-session), which
> creates a component in a space, opens its paragraphs, edits its title, base language and base direction
> above the surface, saves them as iterations under a lock and cuts versions from them - and
> [the document and its outline](#the-document-and-its-outline), which makes a document in a space,
> restructures its outline of sections and component references a version at a time, and numbers it.
> Nothing yet pastes, edits anything but paragraphs of text, makes a component type, resolves a
> cross-reference, or publishes; an administrator invites people by address and grants and removes roles from a component's
> access page. The single `Component` in `packages/domain` is still the scaffolding's, and nothing
> renders it any more.
>
> **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
> system of record, publishing workers, PostgreSQL and object storage, and the data flowing between
> them - is [`design/system.md`](design/system.md). Part of it exists here: the web service as the system of record, one worker and its queue, PostgreSQL with a schema per environment, and the object store, each described below; publishing beyond a sample, search, realtime beyond one stream, and the rest do not.

**This document describes the repository as it stands.** The subsystems being designed on top of it
live in [`design/`](design/), one document per subsystem, each naming the requirements it answers.
This page is the map; those are the depth. As each subsystem is built, its design document stops
describing something planned and starts describing something here.

## Workspaces

One pnpm workspace, one lock file, thirteen workspaces.

| Workspace               | Package                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `@alloy-works/domain`       | The content model - the stored shape of a component's content, its canonical form and its migration chain - the admission pipeline everything entering a component passes through - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - a document's outline and the five operations over it, its numbering - the scheme, what a component's content contributes, and `number` - the canonical serialisation of a whole version, access - the closed permission set, roles, `decide` and the readable set - the theme model, and their rules. Pure TypeScript + zod - no React, no Electron, no `fs` |
| `packages/editor`       | `@alloy-works/editor`       | The editor's ProseMirror schema, the mapping to and from the stored model, the identity plugin, the invariants every transaction keeps, and the view one component is edited in. Browser code, no React; all but the view is tested in Node                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests, for components, documents and definitions alike; and access - roles, groups, grants, the access epoch, the facts a decision reads, invitations and the first administrator; and what numbering reads of a document's components. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                                                         |
| `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas with what each checks, and the OpenAPI document generated from them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/service`          | `@alloy-works/service`      | The web service: Fastify, hostname to tenant, the contract's routes each checked as it declares, and the built renderer beside them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, playing an organisation's provider or Google, for development and tests only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/objects`      | `@alloy-works/objects`      | Object storage: a credential per tenant scoped to its own prefix, objects by content hash, and signed links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/worker`           | `@alloy-works/worker`       | Claims jobs from the platform queue and runs each inside its own tenant; carries the pinned Typst                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/api-client`   | `@alloy-works/api-client`   | The one way in for a client: types generated from `openapi.json`, a typed client, and the stream reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/trace`        | `@alloy-works/trace`        | The requirement corpus compiled: the parsers, the citation scanner, the state ladder, `check` and `verify`, the committed `trace.json`, the query command, a hand-written baseline declaring what a release is answerable for, `pnpm trace gate` deciding pass or fail over it, `pnpm trace pack` writing the evidence pack a baseline's release commits alongside it, and intake - the issue form and `pnpm trace draft`, which drafts a row from a filed issue or from flags but never inserts it                                                                                                                                                               |
| `tests/e2e`             | `@alloy-works/e2e`          | The whole system in containers, driven over HTTP: sign in, ask for a sample, wait on the stream, fetch the PDF                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

CI now has one real gate: `pnpm trace gate`, run as its own step after Test, is not
`continue-on-error` like the checks around it - see [`docs/testing.md`](testing.md) and
[`CLAUDE.md`](../CLAUDE.md) for why that is safe rather than reckless.

The theme model (`src/theme/`) is a prototype, measured and recorded in ADR-0014 but not yet
exported from the package: a resolver and three projections - CSS for the editor, data for the
Typst template, and Word styles. Like the content model draft, it is promoted when the editor or
the publishing pipeline first needs it.

Dependencies point one way: `apps/web` depends on `@alloy-works/domain`, on `@alloy-works/editor` -
itself on the domain package and ProseMirror - and on `@alloy-works/api-client`, which is the only way
it calls the service (API-001); `apps/desktop`
depends on `@alloy-works/web` **for types only** (see the platform bridge below). `packages/db`
depends on `@alloy-works/domain`, for the version's canonical serialisation and the schemas a
version's content is checked against, and for `decide`. `packages/api-contract` and `apps/service`
depend on it for the permission set a route declares and the decision it is checked by, and the
contract takes an outline operation's schema from it rather than restating it. The domain package
depends on neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI
along.

**The access page checks what arrives, as well as its type.** It was written while the client's answers
reached the renderer as `any` (issue #110, fixed by PR #111), so `apps/web/src/access/describe.ts` checks
each response's shape by hand before reading it. The generated types now reach the renderer too; the
hand-written shapes stay as a check on the body a service actually sent, and can become aliases of the
generated types when the page is next touched.

## The content model

`packages/domain/src/content/model/` holds the shape a component's content is stored in, designed in
[`design/content-model.md`](design/content-model.md) and built on
[ADR-0005](decisions/0005-purpose-built-node-and-mark-content-model.md) and
[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md). It is the whole of the stored
shape and none of the product on top: nothing authors content, stores it, admits it from another
format or publishes it.

| File            | Holds                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marks.ts`      | Thirteen marks, and the set is closed. Each carries an identifier and no appearance                                                                   |
| `inline.ts`     | Eight inline nodes, a cross-reference's closed target union, and the three-state alternative a figure or an image carries                             |
| `blocks.ts`     | Seven blocks, and the restricted sequence a footnote's content is                                                                                     |
| `document.ts`   | The root a version holds, and `parseContentDocument` - the one way a document is constructed                                                          |
| `identifier.ts` | `blockIdentifierFrom`, over bytes the caller supplies, and the two identifier spellings a cross-reference names - an outline node's and an artifact's |
| `canonical.ts`  | `canonicalise`, whose output is what a caller hashes into `content_hash`                                                                              |
| `migrate.ts`    | The migration chain, applied on read, and the quarantine for content that will not parse                                                              |
| `mapping.ts`    | One row per node and per mark, naming what it becomes in Word and in tagged PDF                                                                       |
| `fixtures/v1/`  | Stored content at schema version 1, never deleted                                                                                                     |

**Four properties, because each is a decision rather than an implementation detail.**

**The root's members are closed.** A component's content carries the schema version it was written
against, its own title, its base language, its base direction, and its blocks. Adding a member is a
schema version with a migration and a fixture, not a configuration option.

**Every document goes through `parseContentDocument`.** Four rules live there rather than in the
schema, because each is a property of a document rather than of a node: every block's, footnote's
and cross-reference's identifier, a footnote's paragraphs included, is unique within the component;
two adjacent empty paragraphs are refused while one is admitted; a footnote's content is paragraphs
holding no image and no footnote; and a cross-reference in a component never targets an outline node.
The identifiers, the footnote's list and where a cross-reference may point are checked in one walk
over inline content, `checkInlineContent`, sharing one set of claimed identifiers with the walk over
the blocks; adjacency is checked in every sequence of blocks either reaches - the top level, a list
item, a blockquote, a table cell and a footnote - as admission's normalise collapses it in each. A
section title runs the same walk, where a cross-reference targets an outline node and nothing else,
and shows a number or a page, never a title, so resolving a title cannot loop. A footnote's
paragraphs hold no footnote, so the walk descends one footnote deep and stops. The walk returns what
it parsed - a footnote's paragraphs with the defaults the parse fills in everywhere else - and that
is what is stored and digested, in a component and in a section title alike, so two spellings of one
footnote are one version. Every identifier the walk claims, and the block a target names, is refused
unless it is already in NFC, the form the digest is taken over.

**Migration is a read-time projection and never a rewrite.** Version rows take inserts only and
`content_hash` is the hash of what was written, so migrating stored content would either invalidate
its hash or need a version row nobody authored. The stored bytes never change. With one schema version
the chain is empty; the chain, the fixture directory and the test that walks every fixture to current
exist anyway, because the first schema change is when a chain nobody built is found to be missing.

**No node exists without a way out.** `mapping.ts` carries a row for every block, inline node and mark,
and a test fails when a type has no row or a row has a blank cell. A cell that cannot be filled is a
finding about the node rather than a comment in the file.

**Randomness is not here either, for the same reason hashing is not.** `blockIdentifierFrom` spells
sixteen bytes it is given; where those bytes come from is the caller's platform, so `packages/editor`
passes `crypto.getRandomValues` and `packages/db` passes `node:crypto`'s `randomBytes`. Both spell an
identifier the same way because there is one function that spells one, and one test holds the spelling.

Hashing is deliberately not here. `canonicalise` returns a string and the caller hashes it, because
`node:crypto` is not platform-free and `crypto.subtle` would make parsing async for nothing. The
canonical rules and the migration chain themselves live in `packages/domain/src/stored/`, shared
with the metadata definitions; `canonicalise` names `marks` as the one member whose array is a set.
The whole version's serialisation is `packages/domain/src/version/`, and the hashing of it and of
content is `packages/db/src/version-digest.ts`.

**A document's outline is not content, and has a module of its own**: `packages/domain/src/structure/`,
beside `content/model/` and built on it - a section title is the content model's inline content, and
the outline's canonical form reuses the content model's marks-as-a-set rule for that title and for
nothing else. It is described under [the document and its outline](#the-document-and-its-outline).

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

| File            | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.ts`     | The entries every stage appends, with fixed messages; what arrived travels in `detail`, never in a message                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `limits.ts`     | The provisional limits one admission is held to, measured without recursion before any stage walks the content                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mathml.ts`     | A strict reader of an equation's MathML, an allowlist of MathML Core, the one form it is written back in, and the check validation makes against it                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sanitise.ts`   | Scripts, embedded objects, event handlers, links whose scheme is not allowlisted, executable formatting, MathML                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `migrate.ts`    | Content at an earlier schema version brought to current through content's own chain, or refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `normalise.ts`  | Formatting dropped, NFC, empty runs and adjacent empty paragraphs removed, the source's language kept as a mark                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `reidentify.ts` | A new identifier for every block, footnote, cross-reference and mark, a copied cross-reference pointed at the copy of a block that travelled with it - and left as it stands where its block did not travel or where the block's old identifier arrived on two blocks in one paste, which makes it ambiguous, counted in the report as kept where the receiving component does not hold its target; nothing allocated that the receiver or the paste already names, as an identifier or a `block` target; comments, suggestions and conditions without an axis dropped |
| `admit.ts`      | The stages in order, validation last, and the outcome: blocks and the report, or a named refusal and the report                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `clipboard.ts`  | The product's own clipboard format, written on copy and read on paste                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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
caller hands in. One definition is stored - the component type migration 0015 gives every environment -
and creating a component and cutting a version each resolve its fields and apply every default through
`carryForward`; `GET /v1/spaces/{space}/component-types` lists the types an environment holds. Nothing
else makes, changes or assigns a definition, no route carries a value, and no panel shows one.

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
[ADR-0024](decisions/0024-a-version-digest-over-the-whole-version.md). Four tenant migrations and the
functions that write the chain, each taking the transaction `withTenant` opened. Creating a component
inserts its first version and the editing session cuts the rest (see
[the editor and its session](#the-editor-and-its-session)); creating a document inserts its first
version and each structural act records the next (see
[the document and its outline](#the-document-and-its-outline)); there is no revision and no baseline.

| Where                                         | Holds                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrations/tenant/0007_spaces_and_artifacts` | `space`, name unique in the tenant; `artifact`, an id and a kind, in exactly one space for a component and in none for a field, schema or type                                       |
| `migrations/tenant/0008_version_chain`        | `artifact_version` - numbers, author, time, note, schema version, content, values, what was not carried, the type, both digests - and `version_definition`                           |
| `migrations/tenant/0015_component_types`      | The component type every environment starts with, _Topic_; `component_type_default`, one row, declaring it; and an author nullable for a definition alone                            |
| `migrations/tenant/0016_documents`            | `document` as a kind in `artifact_kind_check`, in exactly one space by `artifact_space_by_kind`, and required to have an author by `artifact_version_component_author`; no new table |
| `src/version-digest.ts`                       | `versionDigests`: SHA-256 over `canonicaliseVersionContent` and `canonicaliseVersion` from the domain package                                                                        |
| `src/spaces.ts`                               | `createSpace`                                                                                                                                                                        |
| `src/versions.ts`                             | `createArtifact` at `0.1`, `readVersion`, `latestVersion`, `substanceOf`, and `recordVersion`, each taking a component, a document or a definition                                   |
| `src/load/`                                   | The load test, outside `pnpm test`: `pnpm --filter @alloy-works/db test:load`                                                                                                        |

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

## Access

Who may do what to which artifact, designed in [`design/access.md`](design/access.md): a pure decision in
`packages/domain/src/access/`, the stores and the facts it reads in `packages/db`, and a route helper in
`apps/service` that checks what each route declares. Grants are listed, made and removed through routes,
and a component's access page in `apps/web` calls them; roles and people are listed to choose from, and
an administrator of the environment invites an address there, so somebody can be granted access before
they first sign in. Nothing manages a role, a group or a principal's kind.

| Where                                            | Holds                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain: access/permissions.ts`                  | The ten permissions, closed; what an external principal is capped at; a principal's kinds                                                                                                                                                         |
| `domain: access/role.ts`                         | `checkRole`, `allowable` - only a role holding `read` may be allowed - and the eight roles a tenant starts with, Editing for denials                                                                                                              |
| `domain: access/level.ts`                        | The tenant, a space or an artifact, and how a route's `target` spells one                                                                                                                                                                         |
| `domain: access/decide.ts`                       | `decide(permission, facts)`: the answer, the deciding level, the grants that decided and every level looked at                                                                                                                                    |
| `domain: access/readable.ts`                     | `readableSet`: the tenant flag, spaces, exclusions and inclusions a listing's query holds, computed by `decide`                                                                                                                                   |
| `db: migrations/tenant/0009_access`              | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, and starting rows                                                                                                                      |
| `db: migrations/tenant/0010_access_epoch`        | `access_epoch`, and the triggers that lock it on every write to a fact a decision reads                                                                                                                                                           |
| `db: migrations/tenant/0011_first_administrator` | `first_administrator`: namings by issuer and subject, kept as the record; nothing names or claims one any more                                                                                                                                    |
| `db: migrations/tenant/0014_invitations`         | An invitation per row, each with the principal it made; a principal's issuer and subject optional; `principal.email_verified`; the runtime role writing only the invitation columns the service needs, never `named_by`                           |
| `db: src/invitations.ts`                         | `invite`, `withdrawInvitation`, `listInvitations` and `readInvitation`, and `claimInvitation`, called in a sign-in through either route that found no principal. `inviteToTenant` (`src/sign-in.ts`) is the operator's invitation, with no expiry |
| `db: src/roles.ts`, `groups.ts`, `grants.ts`     | `createRole`, `findRole`, `createGroup`, `addToGroup` and `grant`, with the external rules where a grant is made                                                                                                                                  |
| `db: src/access-facts.ts`                        | `loadFacts` and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to                                                                                                                             |
| `db: migrations/tenant/0013_deciding_only`       | `access_changed()` again, refusing a change in a transaction that declared it only decides                                                                                                                                                        |
| `db: src/grants.ts` (removing)                   | `removeGrant` under the lock-out guard, `administeringGrants` - what the guard counts - and `grantLevel`                                                                                                                                          |
| `db: src/access-listings.ts`                     | `listGrants` at one level, `readGrant`, `listRoles` and `listPrincipals`, each paged by id                                                                                                                                                        |
| `db: src/first-administrator.ts`                 | `inviteFirstAdministrator`, run as a database administrator: an invitation whose principal holds Administrator at the tenant                                                                                                                      |
| `api-contract: contract.ts`                      | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from                                                                                                                                           |
| `service: src/managing-access.ts`                | The grants, roles and people routes; each refusal a 409 with an underscore code                                                                                                                                                                   |
| `service: src/invitations.ts`                    | The invitations routes: listing, inviting or renewing, and withdrawing with the principal's grants                                                                                                                                                |
| `web: src/access/`                               | The access page: grants at a component's three levels, giving and removing, an explanation per person, and, to an administrator of the environment, inviting an address and withdrawing a waiting invitation                                      |
| `service: src/access.ts`                         | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in                                                                                                                            |

**Four properties, because each is a decision rather than an implementation detail.**

**Nothing is stored that could be computed.** `access_grant` is the only table that confers a permission,
and every decision reads the grants as they are, so a change to a role reaches every holder at the next
decision.

**The explanation is the decision.** `decide` returns the level and grants behind an answer, or the levels
it looked at, and the route helper reads `allowed` from the same value `GET /v1/access/explain` shows.

**A check and its act are one unit, by a lock rather than by care.** Every decision takes `access_epoch`
`FOR SHARE` in the transaction of its act, and a trigger on every fact a decision reads takes it exclusively,
so a change to access waits for an act already authorised and an act begun after a change sees it. A test
holds the list of facts against the triggers.

**A change to access says so, or cannot happen.** A route declaring `changesAccess` takes the epoch
`FOR UPDATE` before it decides, so its decision never upgrades a shared lock into a deadlock; every other
permission-checked route marks its transaction as deciding only, and the epoch's trigger and
`lockAccessForChange` refuse a change there, so a route that forgets fails its first test rather than
deadlocking under load.

**Unreadable is absent.** A target the caller may not read answers 404 exactly as a missing one does; a
readable target refused answers 403 and names only the permission. `administer` is the one exception:
asked "at the target's level or above", a target the caller may administer from a level above is never
refused as unreadable on that account, `GET /v1/access/explain` included, because the walk that answers
it is not the ordinary nearest-level one that decided whether the target is readable in the first place.

**An invitation is a principal before it is a person.** Inviting an address makes a principal with no issuer
and no subject, which grants name like any other, so every rule is applied where a grant is made. The first
sign-in through a permitted route whose provider verifies the address gives it an identity. Making or
claiming one changes no fact a decision reads and takes no epoch - neither sign-in route takes it -
while two invitations of one address take turns on an advisory lock keyed by the schema and the address,
which a first sign-in for a verified address takes too, before claiming and held through the principal it
makes when it claims nothing, and inviting the first administrator takes right after the epoch;
withdrawing one removes its grants, so it takes the epoch before the invitation's row, and a claim, which
takes the address's lock, the row and then the principal's and never the epoch, cannot deadlock against
it. The order throughout is: claim - address lock, invitation row, principal; invite - epoch `FOR SHARE`,
address lock, invitation row; first administrator - epoch `FOR UPDATE`, address lock, invitation rows,
principal; withdraw - epoch `FOR UPDATE`, invitation row, principal, never the address lock; grant -
epoch `FOR UPDATE`, then the principal it names. Because a claim
can commit while an invitation waits on its row, inviting asks again, after that lock, whether somebody has
signed in with the address; inviting the first administrator asks again, after each such lock, both that
and whether anybody administers the tenant.

`pnpm dev:setup` invites the stand-in's Ada, at `ada@example.com`, to administer both development
environments before either permits a sign-in, so she administers each from her first sign-in there.

## The editor and its session

Opening a component, editing its paragraphs and saving them, designed in
[`design/component-editor.md`](design/component-editor.md) over
[`design/storage-and-versioning.md`](design/storage-and-versioning.md)'s iterations and
[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md)'s one view per component. A
component is created, opened, edited above and on the surface, and cut; one holding anything but
paragraphs of unmarked text opens for reading only, and nothing pastes, recovers an iteration or edits
metadata.

| Where                                       | Holds                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor: src/schema.ts`, `mapping.ts`       | The editor's schema - the root, paragraphs, text - and `toEditor`, which refuses by name what the schema lacks, and `fromEditor`, through `parseContentDocument`                                        |
| `editor: src/identity.ts`, `state.ts`       | 128-bit block identifiers, ADR-0023's descent rule as a plugin, no two adjacent empty paragraphs, `Enter` that makes none, and one history per component                                                |
| `editor: src/view.ts`, `style.css`          | `mountEditor`: spellcheck, language and direction on the surface, and paste and drop refused                                                                                                            |
| `editor: src/header.ts`                     | `headerOf`, and `setTitle`, `setLanguage` and `setDirection` as steps on the root, with `titleAccepted` beside the command it gates                                                                     |
| `db: migrations/tenant/0012_editing`        | `component_lock`, one row per component; `iteration`, insert-only, which nothing references                                                                                                             |
| `db: src/editing.ts`, `promotion.ts`        | `claimLock`, `readLock` and `saveIteration` under the sequence rules; `cutVersion`, promoting the latest iteration, and `releaseLock`                                                                   |
| `db: src/creation.ts`                       | `createComponent` at `0.1`, `listComponentTypes` and `defaultComponentType`, and `currentDefinitionsFor`, which creating and cutting share                                                              |
| `db: src/components.ts`, `spaces.ts`        | `listReadableComponents`, filtered by the shared readable-set predicate inside its query, a page at a time; `listSpacesFor`, each space with whether the caller may create in it                        |
| `db: src/dev-content.ts`                    | `seedDevelopmentContent`: a component over the component type the environment starts with, and Ada and Grace allowed Author on General, for development only                                            |
| `api-contract: components.ts`, `editing.ts` | Nine routes and their schemas - `GET /v1/spaces`, `GET /v1/spaces/{space}/component-types` and `POST /v1/spaces/{space}/components` beside the six the session uses; a route may declare a request body |
| `service: src/components.ts`, `editing.ts`  | The handlers, and refusals with their members - `lock_held` naming the holder and the expected release                                                                                                  |
| `web: src/editor/`                          | The session as a state machine over a service and a clock, the adapter onto the generated client, the save indicator, the editor and its header, **New component**, the list and the workspace          |

**Seven properties, because each is a decision rather than an implementation detail.**

**The header is content, not a column on the component.** A component's title, base language and base
direction are attributes of the editor's root, so changing one is a step in the same history as the text,
undone with `Ctrl+Z`, carried inside the iteration the session already sends, and recorded by the next
version cut. Creating needed no route for them and editing needs no request member, so a version records
the title the component had when it was cut (CNT-143) without anything keeping two copies in step.

**A version is cut from an iteration, and only when asked.** Saving writes iterations; only Save version
and Done editing call `cutVersion`, which promotes the session's latest iteration through `recordVersion`.
A lock that expires cuts nothing.

**The lock is checked where the write is.** `saveIteration`, `cutVersion` and `releaseLock` each check
that the calling session holds the lock, in the transaction that writes, serialised per component on the
advisory lock `recordVersion` already takes.

**No write in a session touches access.** A lock, an iteration and a version are not facts a decision
reads, so none takes the access epoch for update, and the shared lock `authorise` took first is never
upgraded; a test runs the writes while another transaction holds the epoch.

**What the editor holds is always storable.** Every iteration leaves the renderer through `fromEditor`,
which runs `parseContentDocument`, and the service parses it again. The identity plugin and the
empty-paragraph plugin keep that true after any sequence of edits, which a seeded test of two thousand
operations holds them to.

`pnpm dev:setup` makes "Install the printer" in both development environments, over the component type
the environment starts with rather than one of its own, and allows Ada and Grace Author on General; Alice
is left with nothing.

## The document and its outline

Making a document and restructuring its outline, designed in [`design/structure.md`](design/structure.md)
and built by [the first structure plan](plans/2026-09-18-structure-01-the-document-and-its-outline.md).
A document is an artifact of its own kind, in exactly one space, and **its content is its outline**: one
JSON tree of sections and component references, versioned through the same chain as a component, with
the same two digests. [The second structure plan](plans/2026-09-18-structure-02-numbering.md) numbers
it: the outline panel shows each node's section number, and `GET /v1/documents/{id}/numbering` answers
the whole numbering table - sections, figures, tables, equations and footnotes - with the component
version each reference resolved to. Nothing resolves a cross-reference or shows a document as a
document view; a component is still opened on its own to be edited.

| Where                                                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain: structure/outline.ts`                            | The outline at schema version 1 - a title, a base language and direction, and `nodes` - each node a section or a reference carrying an identifier, `numbered`, `matter`, `pageBreak`, `values` and children, a section a title, a reference a component and a `mode`; the parse, which bounds the depth at 64, keeps `matter` to the top level and holds a title to the content model's inline rules, to `hasText` and to what Postgres can store; the migration chain and the canonical form; and the view a reader is shown, `withholdComponents` and `readOutlineView`                                                                                                                                                                                                                  |
| `domain: structure/operations.ts`                         | `outlineOperationSchema`, the closed union of insert, move, remove, retitle and set, and `applyOutlineOperation`, which applies one to a tree and answers the new outline or a fixed reason, never an exception                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `domain: structure/scheme.ts`                             | The numbering scheme - a sequence's rule per matter, with its label, formats, restart depth, prefix depth and separator - its schema, which refuses a restarting rule that could print one label twice (a footnote's excepted), `defaultNumberingScheme` (`default/1`), and the counter formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `domain: structure/contributions.ts`                      | `contributionsOf`, a component version's content projected to what it contributes: each figure, table, block equation and footnote, in document order wherever it is nested, whether it is numbered, and a figure's or table's caption, which the contributions route sends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `domain: structure/numbering.ts`                          | `resolve`, `conditions` (the identity until conditions exist) and `number`, each taking the stage before as a type of its own, and `sectionNumbers`. `number` walks occurrences with a counter stack per matter and answers a table whose every entry names its node, block, sequence, matter, section counters, value and the node that last restarted it; a number an unknown occurrence could have moved is `null`                                                                                                                                                                                                                                                                                                                                                                      |
| `domain: structure/lists.ts`                              | `contents(conditioned, numbering, depth)`, every node to a depth in document order, numbered or not, a reference's title left to its caller; and `listOf(conditioned, numbering, sequence)`, one sequence's entries in order, each with the caption its component holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `domain: version/substance.ts`                            | `DocumentSubstance`, the third arm of a version's substance, and `canonicaliseVersionContent` choosing among three                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `db: migrations/tenant/0016_documents`                    | The three widened checks, above, and the one deferred constraint set immediate and back so they apply on a fresh environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `db: src/documents.ts`                                    | `createDocument` at `0.1` with an empty outline, `readDocument`, `listReadableDocuments`, `readableComponents`, and `editOutline`, which checks a reference's target, applies one operation to the version the caller opened from and records it through `recordVersion`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: src/numbering.ts`                                    | `numberingInputs`: which version each occurrence resolves to - a `latest` reference its component's head, a `pinned` one its version, an `approved` one nothing yet - and what each readable one contributes, in two reads of component versions whatever the outline's size - beside the readable-set lookups, a constant handful of queries - each read restricted to the components the principal may read inside the query, so no row of any other is ever selected                                                                                                                                                                                                                                                                                                                    |
| `db: src/readable-artifacts.ts`                           | The readable-set predicate every listing of content filters through inside its query - components and documents alike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `api-contract: documents.ts`                              | `GET /v1/documents`, `POST /v1/spaces/{space}/documents`, `GET /v1/documents/{id}`, `GET /v1/documents/{id}/numbering`, `POST /v1/documents/{id}/outline` and `GET /v1/documents/{id}/contributions`, and their schemas; the operation's schema is the domain's, and the service validates a body with it, so what `openapi.json` cannot express - that only a page reference carries `withoutPages`, and that a title's cross-reference targets an outline node alone - is refused at runtime as `invalid_request`                                                                                                                                                                                                                                                                        |
| `service: src/documents.ts`                               | The handlers: a document's kind checked by each, a stale act answered with the current outline, `outline.invalid` mapped to `outline_invalid`, every answer carrying an outline built through one view that withholds what the caller may not read, the numbering of the latest version against the default scheme from `numberingInputs`, and each occurrence's contribution to the sequences, taking no parameter and naming each version's contributions once                                                                                                                                                                                                                                                                                                                           |
| `web: src/structure/`                                     | The documents list, **New document**, the document page holding the outline the last act returned and an undo stack, the outline panel with its keymap and drag and drop, each node's section number computed with `number` whenever the outline changes and shown as the item's description, **Numbered** and **Appendix** beside the selected node, `tree.ts`, the panel's arithmetic, pure and tested against the domain's operations, `links.ts` and a node's address, the `#/documents/{id}/nodes/{node}` route and its arrivals, the panel going to a linked node and choosing, focusing and marking it, its **Link to** field and **Copy link**, and `GeneratedLists.tsx`, the figures, tables and equations beneath the outline, numbered in the page from the contributions route |
| `web: src/spaces.ts`, `paging.ts`, `editor/Workspace.tsx` | The creatable spaces loader **New component** and **New document** share, the every-page reader the access page and the document page share, and the hash routes `#/documents`, `#/documents/{id}` and `#/documents/{id}/nodes/{node}` beside the components', with a **Components** and **Documents** link above either list                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Five properties, because each is a decision rather than an implementation detail.**

**One act, one version, and no lock.** Each of the five operations is sent alone, carrying the version
it was made against, and is recorded as a version of its own through `recordVersion`, under the
advisory lock the chain already takes. The store applies it to the version the caller opened from,
never the latest, so one person's act is never rebased onto another's: a second act from the same
version is refused with the outline as it now stands, and an act that puts things back where they were
is answered with that outline and records nothing. A document cannot be locked at all:
`component_lock`'s check constraint refuses the kind, and the lock route turns a document's id away
before that.

**The stored outline refuses what a later rule would.** A version is immutable, so anything it
accepts is accepted for ever. The parse holds a section title to the walk `parseContentDocument` runs
over inline content, and every identifier inside a title is unique within it; to `hasText`, which the
editor's `titleAccepted` is; and to characters a `jsonb` column can store. It keeps `matter` to the
top level and bounds the depth at 64, before it recurses. An operation writes nothing into `values`
but `{}`, and the store checks a reference's target in the write transaction: a component the author
may read, and a pinned version of that component, or one fixed `outline_invalid` reason whatever was
wrong.

**A reader is shown a view, and nothing is computed from one.** Every answer carrying an outline -
the page, an act's answer, a `409`'s `current` - withholds the component and pinned version of a
reference whose component the caller may not read, found through the one readable-set predicate. The
digests, the versions and every operation run on the stored outline; the renderer reads the view with
`readOutlineView` and names such a node **A component**.

**A stale caller is told so first.** Whatever else an act from an older version gets wrong, it is
answered `409 version_precondition` with the current outline; `outline_invalid` is kept for an act
refused against the latest, so it always means the author asked for something the outline cannot do.

**The canonical form is composed, not blanket.** A section title is inline content, whose marks are a
set; a section's `values` are metadata, where a field's values keep their order. So the outline is
serialised member by member, the title through the content model's rule and everything else through the
plain one, and a test fails when a member is added to a node and not composed.

**Numbering is computed, never stored.** No stored shape changed for it: no migration, column, table
or cache. The route resolves and reads each occurrence and numbers the latest version whenever it is
asked, and every answer names the component version each occurrence resolved to, so a `latest`
component's new version moves its figures on the next request. The panel computes section numbers in
the browser with the same `number` over the outline it holds, knowing nothing of any occurrence -
no section number depends on one - so the tree is renumbered by the outline an act returns, with no
second request, and the panel never asks the service for a number. It shows section numbers alone.

**A reader is numbered only from what they may read** (IAM-073). `numberingInputs` never selects a
row of a component the caller may not read, and answers its occurrence `version: null`, as it
answers an `approved` reference or content that does not read. `number` treats such an occurrence as
unknown, whatever it holds: every counter in its matter is `null` from there until that counter next
restarts. Section numbers are always shown, and everybody shown a number is shown the same one.

**The panel offers only what the outline accepts.** **Appendix** is offered on a top-level node
alone, and no move that would nest an appendix is offered: `Alt+Right` on one says **An appendix
stays at the top level.**, and a drop that would nest it is not taken. A node left ticked beneath an
unnumbered one says **Not numbered while** that one **is not.**

**Undo is operations, computed in the renderer.** The page keeps, for each act, the one operation that
takes it back, computed from the outline before and the outline the service returned. A conflict
empties the stack, because undoing onto somebody else's outline would overwrite it unseen; a removal
empties it too, because it has no inverse - the subtree's identifiers can never be allocated again.

**One act in flight at a time.** The page sends nothing while an act is unanswered. Every retitle goes
through one queue in the panel that holds **one retitle per section**, in the order of its latest
commit, and sends them one at a time once nothing is in flight, each from the version the one before it
made: a second commit to the same section replaces the first, and a commit to another section waits
behind it rather than taking its place. Each held retitle keeps the rules it had alone - given way to
behind a refusal (a conflict, not permitted, no longer there, not applying), sent behind a failure, not
sent once the author is signed out - and a title that is not saved is always named: after the refusal's
own sentence when a refusal took it, and, when its field has closed, once no other retitle is
outstanding, so a later one's answer cannot replace the sentence. Every other act made meanwhile - a
move by key or pointer, an undo, a page-break change, an add or a remove - is ignored, with the tree's
`aria-busy` the only sign.

**Navigation is computed too, and no stored shape changed for it.** `contents` and `listOf` in
`packages/domain/src/structure/lists.ts` read the conditioned outline and the numbering table:
`contents` walks the outline, and `listOf` takes each caption from the resolved contributions. A
node's address, `#/documents/{document}/nodes/{node}`, names nothing positional, so a reorder cannot
invalidate it; the panel follows one to a node, chooses it, focuses it and marks it, and offers
**Copy link** beneath the chosen node. `GET /v1/documents/{id}/contributions` takes no parameter and
names each version an occurrence resolved to once, however many occurrences name it, rather than
once per occurrence - 232 KB rather than 542 KB at 500 nodes - and the document page numbers its
figures, tables and equations from it with the same pipeline the service numbers with, so a move
renumbers the lists before the page hears back.

`pnpm dev:setup` makes no document: **New document** makes one in General, which Ada and Grace may
create in.

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
- **A deep link is a hash**, so the renderer's relative asset paths are never under a deep path and
  the `file://` fallback serves one as it serves the root.

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

The renderer asks the bridge which delivery it is running under, and, once somebody is signed in,
lists the components they may read. Opening one fetches it at its latest version; its first change
claims the lock, changes go back as iterations after a pause, and Save version and Done editing cut
versions from them. Beside the components, it lists the documents they may read; opening one fetches
its outline at its latest version, numbers its sections in the page, and sends each structural act
back alone, carrying the version it was made against, to be answered with the outline as it now
stands - every call through the generated client.

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
streams it holds. A stream registers with the fan-out and waits for its subscription's `ready` - the
database has acknowledged the `LISTEN` covering its channel - before its snapshot is read, and holds
what arrives until the snapshot has gone, so nothing committed in between is lost or overtaken by
older state. `ready` rejects rather than waits when the `LISTEN` cannot be made or the listener is
closed, and the stream then ends for the browser to come back. Nothing in the renderer calls it:
that arrives with the scaffolding's last plan (see [`plans/`](plans/)). The rest of the proposed
system is [`design/system.md`](design/system.md).

## Containers and images

One `Dockerfile`, in [`deploy/`](../deploy/) with everything else the system is deployed by, holds
every image the system runs as, so the install and the build are done once and shared. Its build
context is the repository root, and the ignore list beside it, `deploy/Dockerfile.dockerignore`, is
what keeps `node_modules` and the tests out of that context:

| Target    | Carries                                                                                    | Runs                                                 |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `build`   | The workspaces the containers need, installed and built                                    | Nothing; the other targets copy from it              |
| `tools`   | The whole workspace, `tsx` included                                                        | The compose stack's setup, and the stand-in provider |
| `service` | `apps/service` and its production dependencies, plus the built renderer at `/app/renderer` | `node dist/server.js` on 8088                        |
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
| `packages/editor` | `tsc -p tsconfig.build.json`        | `dist/`, beside the `style.css` it exports   |
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
