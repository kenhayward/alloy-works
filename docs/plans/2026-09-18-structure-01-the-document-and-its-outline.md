# Structure 1: the document and its outline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document exists. Signed in, a person makes one in a space they may create in, gives it a
title, a base language and a base direction, and lands on version `0.1` with an empty outline. Then
they build the outline: add a section, add a component to it, drag one under another, retitle one,
remove one - each act its own version, each undoable, and a second person's conflicting act refused
against the outline as it now stands rather than silently overwriting theirs. Nothing is numbered
yet, and the panel says so rather than showing a number that would be wrong.

**Architecture:** `packages/domain` gains `src/structure/`: the outline document's schema - one tree
of `section` and `reference` nodes, each with a 128-bit identifier, a title that is inline content,
and the positional switches - its parse, its own canonical form, its migration chain, and the five
operations as pure functions over a tree. `packages/domain`'s `VersionSubstance` gains a third arm,
`DocumentSubstance`, and `canonicaliseVersionContent` becomes a three-way choice rather than a
ternary. Tenant migration 0016 widens `artifact.kind`, `artifact_space_by_kind` and
`artifact_version_component_author`; `packages/db` gains `document` to `artifactKinds` and
`contentKinds`, a third branch in `prepare` and `createArtifact`, and `src/documents.ts` with
`createDocument`, `readDocument`, `listReadableDocuments` and `editOutline`, which applies one
operation inside `recordVersion`'s transaction. `packages/api-contract` and `apps/service` gain
`GET /v1/documents`, `POST /v1/spaces/{space}/documents`, `GET /v1/documents/{id}` and
`POST /v1/documents/{id}/outline`. `apps/web` gains a documents page: the list, **New document**, and
the outline panel with its pointer surface, its keymap and an undo stack over the outlines the
operations returned.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`),
Fastify 5, Vitest 5 with jsdom for the renderer. No new dependency, and no ProseMirror: a section
title is stored as inline content and edited as text (decision B).

**Spec:** [`../design/structure.md`](../design/structure.md) ("The document artifact", "The outline,
and why it is one tree", "Identity", "Editing the outline", "Stores", "Routes", "Where the code
lives" and "Verification"), as this plan's task 6 amends it; read with
[storage-and-versioning.md](../design/storage-and-versioning.md) ("Stores", which task 6 corrects by
one line), [access.md](../design/access.md) ("Deciding", "Routes", corrected by the same line),
[content-model.md](../design/content-model.md) ("The root" and the canonical form),
[service-foundations.md](../design/service-foundations.md), and
[the second editor plan](2026-09-17-editor-02-creating-a-component.md), whose "What this plan
deliberately leaves undone" is where the creating half of this one starts.

First of the structure plans. The design claims thirty-nine requirements; this plan builds the first
slice of them and names every later plan in
[What this plan deliberately leaves undone](#what-this-plan-deliberately-leaves-undone).

**The code below was run before the plan was committed.** It was written in a throwaway worktree from
`claude/structure-design` at 0.26.0 (commit `5ac5a2e`), against a scratch Postgres container of its
own on port 55433 - never the shared development database on 5432, and no running container was
stopped or restarted. There:

- **Migration 0016 applied on a fresh environment and on one provisioned before it.** On a fresh one
  it failed first, with `cannot ALTER TABLE "artifact_version" because it has pending trigger events`
  (55006), because every migration of a tenant runs in one transaction and 0015's insert of the
  starter component type leaves pending trigger events on that table; `set constraints all immediate`
  before the ALTER fixed it. On an environment already at 0015, `'document'` was refused by
  `artifact_kind_check` before the migration and by `artifact_space_by_kind` after it, a document in
  _General_ was accepted, and a document version with no author was still refused by
  `artifact_version_component_author`.
- **A document's version round-tripped through the canonical form and both digests**, a section title
  carrying two marks included: both digests recomputed in TypeScript from the stored row equalled the
  row's, and two outlines differing only in the order their marks were built produced one string and
  one digest. The plain shared rule, which the design predicted would be reached by accident, was run
  against the same pair and produced **two** strings - so the correction is load-bearing and not
  theoretical.
- **Creating and restructuring ran end to end through routes.** Ada created **The dosing report** in
  _General_ at `0.1` with an empty outline, opened it, saw it listed, inserted a section and got
  `0.2` with a fresh 26-character node identifier; two acts sent together from one `openedFrom`
  answered one `200` and one `409 version_precondition` carrying the current outline, and the chain
  held exactly two versions; an operation naming a node that is not there answered
  `400 outline_invalid`; a component's id on `/v1/documents/{id}` answered `404`; a body carrying a
  member the schema does not declare answered `400`, and so did an uppercase id in the path.
- **The permission answers were measured.** Ada, Administrator of the environment, was refused `403`
  creating in a space nothing grants her `create` in; Alice, a Reader on _General_, was refused `403`
  creating there, `404` in a space she may not read, and `403` editing the outline of a document she
  may read; another environment's space answered `404`, and so did an unknown one.
- **The suites were run.** The database suite passed **266 of 267**, the one failure being
  `spaces.test.ts > refuses a kind the version chain does not hold`, which asserts today that
  `'document'` is refused - the test this plan moves. The service suite passed **175 of 176** with
  two harness suites failing exactly as task 4 says they will. `packages/api-contract` passed 24 of
  25, the one failure being the `openapi.json` drift check before it was regenerated. `pnpm build`
  was clean across all eleven workspaces.

Then the scratch container and the throwaway worktree were removed.

**What was not run.** The renderer - the documents page, **New document** and the outline panel - was
not built, so task 5 is reasoned from the code it calls rather than measured. `pnpm lint`,
`pnpm format`, `pnpm trace verify` and `pnpm trace gate` were not run, the last two because the
worker's and the object store's suites were not run and both refuse without those reports. The counts
in [Requirements this plan cites](#requirements-this-plan-cites-and-those-it-does-not) are reasoned
from the pins on `claude/structure-design`, which already carries the design's thirty-nine claims;
they were not measured. **One thing differs from the run on purpose**: the run answered
`version.unchanged` as a `409`, and decision K makes it a `200`.

## Where structure.md and the built code are wrong, missing or contradicted, most serious first

Planning the build against structure.md, storage-and-versioning.md, access.md and content-model.md
found these. Task 6 amends each design for what this plan builds and records the rest as raised, with
whose each is.

1. **The version chain assumes every artifact that is not a component is a definition, and an outline
   is neither.** `prepare` sends any other kind through `definitionSchemas[substance.kind].parse` and
   then demands `content.id === artifact.id`; `recordVersion` demands the same again; `createArtifact`
   inserts `{ id: substance.content.id, space_id: null }` for anything that is not a component. An
   outline has no `id` member and lives in a space, so all three are wrong for it and none of them
   fails at compile time - `prepare`'s index would be a runtime `undefined`. **Built:** all three
   branch on three kinds. A document's identity is its artifact row's, as a component's is; an
   outline does not repeat it (decision 2).
2. **Migration 0016 cannot ALTER `artifact_version` on a fresh environment without flushing pending
   trigger events first.** Every migration of a tenant runs in one transaction, so on a tenant
   provisioned now 0015's insert has left pending events on that table and Postgres refuses
   (`55006`). Seen in the proof run, and it fails only on the path everybody uses - a fresh
   environment - while passing on an existing one. **Built:** `set constraints all immediate` before
   the ALTER, with the reason in the migration.
3. **STR-057's cycle check has no index to walk.** structure.md's "Stores" says `reference` "gains
   outline rows", as though the table were there; [relationships.md](../design/relationships.md)
   designs it and nothing builds it, and there is no `reference` table in any of the sixteen tenant
   migrations. **Not built** (decision D): in T1 no cycle is reachable, because nothing lets a
   component reference a document at all. structure.md claims STR-057 and no test cites it, and task 6
   says so in prose beside the claim.
4. **The design's canonical-form correction is right, and it is reachable only by a value the
   application cannot yet build.** Two outlines whose section titles carry the same marks in two
   orders produce two strings under `canonicalJson` and one under the content model's rule - proved
   both ways in the run. Nothing in this slice authors a mark in a title, so the hole cannot be
   reached from the application; the test builds the value directly, which is the only way to hold a
   rule that exists to stop a future mistake. **Built**, with that test.
5. **`artifact_version_component_author` lets a document version have no author.** 0015 wrote
   `check (author_id is not null or kind <> 'component')`, which was right when the only unauthored
   thing was a definition the environment started with. Nothing starts with a document. **Built:**
   0016 widens it to `kind not in ('component', 'document')`.
6. **An administrator of the environment may read a space they may not create in**, so a document
   page that offered every readable space would offer refusals. Measured: Ada, Administrator at the
   tenant, got `403` from `POST /v1/spaces/{space}/documents` in _Quality_. **Built** by reusing
   `GET /v1/spaces`, which editor 2 already built and which answers `mayCreate` per space; the form
   offers only those. No design changes.
7. **`spaces.test.ts` asserts that `'document'` is refused** (`refuses a kind the version chain does
not hold`, line 83). It is the one test in the whole database suite that this plan breaks, and it
   exists precisely to be moved. **Changed:** it names a kind the chain still does not hold.
8. **storage-and-versioning.md and access.md each list "a document, an outline" among the artifact
   kinds**, which decision A of the design makes wrong: they are one kind, because STR-012 wants the
   outline versioned with the document. **Corrected** in task 6, one line each, as structure.md says
   the pull request that builds this should do.
9. **A section's field values have nowhere to come from.** The node carries `values` (STR-060), and
   which schemas apply comes from the template's section-level assignments (TPL-054), which TPL does
   not design. **Built as a member and validated by nothing**, said plainly here and in task 6;
   structure.md already leaves STR-060 unclaimed.
10. **The two content-model holes structure.md recorded are free to close today and a migration
    later.** `crossReferenceNodeSchema` is a bare `target: z.string().min(1)` with no occurrence, no
    identity and no alternative form; `parseContentDocument`'s uniqueness walk descends into list
    items, blockquote content and table cells and **not** into footnote content, so a duplicate block
    identifier inside a footnote is stored today without complaint. Nothing authors a cross-reference
    or a footnote, so no stored component holds either, so closing both costs nothing now and costs a
    content migration the day one does. **Neither is closed here** (decision E), and the window is
    named rather than left to be rediscovered.

## Decisions for Ken

Each is a product choice this plan makes provisionally so that it can be built, with a
recommendation. Reject any of them and the plan changes where the decision says.

- **A. The slice is the document, its outline, and editing that outline - and numbering is not in
  it.** A document exists in a space, holds a tree of sections and component references, and can be
  restructured. Numbering, captions, cross-references, generated lists, deep links and page-break
  output are later plans. Recommended: accept. The reason is not size but honesty: `number` needs a
  scheme, a counter stack and each occurrence's contributions, and a panel that showed a number
  before the publisher could print the same one would make STR-036 false on the day it shipped.
  Without numbers the panel says nothing untrue - it is an outline, rendered. **Otherwise**: fold
  numbering in and the plan roughly doubles, with the table-driven scheme suite, the contributions
  route and the default scheme; the document artifact underneath it does not change.
- **B. A section title is inline content in the store, and a plain text field in the panel.** The
  stored shape is `InlineNode[]`, so CNT-046's equation in a heading is representable without a
  migration of every outline ever stored; the panel edits it as text and writes one unmarked text
  run. Recommended: accept. **Otherwise**: a ProseMirror view per node title over an inline-only
  schema, which brings a toolbar, marks and the equation editor - none of which exists - into a plan
  about structure.
- **C. Every positional switch is on the node at schema version 1**, including the ones nothing reads
  yet: `numbered`, `matter`, `pageBreak`, `mode` and `values`. Recommended: accept. Adding a member
  later is a migration of every stored outline, and a read-time projection for a member that should
  have been there from the first version. **Otherwise**: ship `id`, `title`, `children` and
  `component` alone, and pay for each of the other five when its plan arrives.
- **D. The cycle check is not built, and STR-057 is cited by nothing.** Finding 3: there is no
  reference index to walk, and in T1 no cycle is reachable. Recommended: accept, and let the plan
  that builds relationships.md's index write the check with something to walk. **Otherwise**: this
  plan builds a `reference` table, one row per component reference written from a document version at
  insert - which is relationships.md's design, built by a plan that does not own it.
- **E. The two content-model holes get their own change, not this one.** Finding 10. Recommended:
  accept, and make it the next thing after this lands, before structure 2 authors a cross-reference:
  a small content-model pull request giving `crossReferenceNodeSchema` a structured target with an
  optional occurrence, an `id`, and a member for STR-055's alternative, and making
  `parseContentDocument`'s walk descend into footnote content. Both are bug-shaped, so both start as
  issues. **Otherwise**: widen this plan by a task and change what content-model.md claims in a pull
  request about documents.
- **F. A document version must have an author.** Finding 5, migration 0016. Recommended: accept - a
  document is always made by somebody, and the check is what keeps that true rather than a habit.
- **G. A reference node records `approved` and nothing resolves it.** STR-058 asks that the node
  record which of three modes it takes; `approved` means the latest revision, and revisions are LIF's
  and do not exist. `GET /v1/documents/{id}` answers such a node with no resolved version and the
  panel says **waiting on revisions**. Recommended: accept, and let the revisions plan resolve it.
  **Otherwise**: refuse `approved` at the schema, which makes STR-058's closed set of three a set of
  two and costs a migration when revisions arrive.
- **H. Creating answers `200`, not `201`.** The same guard as editor 2's decision C: a
  permission-checked handler is given no `FastifyReply` and cannot set a status, which is what stops
  it sending before its transaction commits. Recommended: accept, and leave what every route answers
  to service-foundations.md (API-005).
- **I. Issue #120 is landed here as STR-061; #119 and #118 are not.** #120 - a document is a named,
  versioned artifact belonging to exactly one space, carrying its own title and identity - is what
  this slice is, and task 4 lands the row, claims it in structure.md and cites it on the wire. **#119**,
  the navigation budget STR-039 cites, is left: this slice builds a panel but cannot measure
  navigation honestly, because there is no browser suite and a jsdom render is not a measurement of
  opening a document. It belongs to **structure 3, navigation and the contents panel**, which builds
  the panel that STR-039 is about and can measure it beside the browser suite component-editor.md's
  plan introduces. **#118**, a theme carrying a caption style, is **STY**'s: it asks for a seventh
  style catalogue, and it is answered by whichever plan first designs STY's catalogues - captions
  cannot be placed until then, which is why structure.md leaves STR-025 unclaimed. Recommended:
  accept.
- **J. The outline panel is not yet a table of contents.** It shows no numbers (STR-036) and clicking
  a node goes nowhere, because jumping to a node needs the document view, which is the editor's next
  slice and is not designed. So STR-034, STR-036 and STR-037 are claimed by the design and cited by
  nothing here. Recommended: accept, and let structure 3 cite all three at once when the panel shows
  numbers and navigates. **Otherwise**: cite STR-034 and STR-037 now, which reads well and says that
  a table of contents exists when what exists is a tree.
- **K. An act that leaves the outline as it was answers `200`, not a refusal.** `recordVersion`
  already answers `version.unchanged`, and `cutVersion` turns that into a `200` with
  `outcome: 'unchanged'`. A move that ends where it started is not an error, and the chain keeps no
  row for it. Recommended: accept, and answer `200` with the current version and outline. **This is
  the one place the plan differs from the proof run**, which answered `409`. **Otherwise**: `409
version_unchanged`, which makes the renderer branch on a refusal for something nobody did wrong.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. `packages/trace` scans titles; an identifier in a comment
  is a mention.
- **Cite only what structure.md claims, and only when the test demonstrates that requirement's own
  statement** (`pnpm trace show <ID>`).
  [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the whole list; a
  test outside it carries no identifier.
- **`packages/domain` stays platform-free.** The outline schema, the parse, the canonical form and the
  five operations go in it, and none of them takes randomness from anywhere: `applyOutlineOperation`
  takes a `newIdentifier` function, as `createEditorState` already does, and `packages/db` passes
  `node:crypto`'s `randomBytes` through `blockIdentifierFrom`.
- **A passing run has no errors or warnings**, including through the renderer's console gate
  (`apps/web/src/test/consoleGate.ts`).
- **A web test that waits for an editing surface must also wait for a React-rendered node of the same
  component.** ProseMirror inserts the surface itself, so waiting only for it races the first render;
  this cost a CI failure in PR #117. Nothing in this plan mounts a ProseMirror view (decision B), so
  the trap does not bite here - the rule is written down so the next structure plan, which does mount
  one per node title, does not have to learn it again.
- **The deadlock rule.** None of this plan's routes declares `changesAccess`: creating an artifact
  fires no epoch trigger, because 0010's only artifact trigger is `after update of space_id`, and
  nothing here updates one. All four run under `decideOnly`, and `changing-access.test.ts` passed
  unchanged in the proof run.
- **Refusals.** A space or a document that is missing, another environment's, or one the caller may
  not read answers `404` and never `403`; one they may read but may not create in or edit answers
  `403`, naming only the permission. Wire codes use an underscore, mapped from the store's dotted
  answer in `apps/service/src/wire-codes.ts` and nowhere else. **Request bodies are strict objects,
  and ids in them and in paths are lowercase uuids** - `DocumentParams` uses `LowercaseUuid`, unlike
  `ComponentParams`, which editor 2 left as a bare `z.uuid()` and named as wrong.
- **Every read and write path has a cross-tenant test** (IAM-004): each database function in its own
  file's tests, each route in `cross-tenant.test.ts`. They do not cite IAM-004.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`).
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **`pnpm install --frozen-lockfile` in CI.** Nothing here changes `pnpm-lock.yaml`.
- **One pull request, one version bump (0.27.0, a functional enhancement) and one changelog entry**,
  in the last task, headed `## 0.27.0 - YYYY-MM-DD (PR #n)`. `apps/desktop/src/version.test.ts` now
  requires the date and the PR number in the newest heading, so the placeholder is filled before the
  branch is done, not after. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement named.
- **`trace.json` is drift-checked and the citation, claim and requirement counts are pinned.** Each
  task that adds a claim, a cited title or a row runs `pnpm --filter @alloy-works/trace generate` and
  moves the pins in `packages/trace/src/trace.test.ts` in the same commit, so every task ends green.
  Task 1: citations 149 to 154. Task 2: 154 to 157. Task 4 step 1: requirements 1365 to 1366 - here
  and in `packages/trace/src/parse/requirements.test.ts` - and claims 358 to 359, with STR-061's row;
  then citations 157 to 161 once its tests are green. Task 5: citations 161 to 162, and the `.tsx`
  count 7 to 8. 149, 358 and 1365 were read on `claude/structure-design` at 0.26.0; if the branch has
  moved, set each pin to what the regenerated file holds and say so in the comment.
- **A migration is never edited once it has shipped.** 0016 is new; if the base has gained a 0016 by
  the time this is executed, renumber this one before the first commit, never the one on the base.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, `Ivy` - and
  `example.com`, `example.test`, `alloy.test` or `idp.example` hosts. A document is **The dosing
  report**, its sections **Introduction**, **Method** and **Results**.
- **No em or en dashes in user-facing text** - the renderer's strings
  (`apps/web/src/dashes.test.ts` enforces it), the service's refusal messages, route summaries and the
  changelog. Code comments are exempt.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store
  too.** Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`.
  **Never run `pnpm dev:setup` against the shared development database**, and never stop or restart a
  running container; run against a scratch container of its own, as the proof run did.
- **A filtered run does not build what it imports.** After changing `packages/domain`, `packages/db`,
  `packages/api-contract` or `packages/api-client`, build it (or run `pnpm build`) before a filtered
  run of anything importing it.

---

## The scope, and why

**Built: a document, its outline, and restructuring it.** The outline's schema and its parse; the
five operations as pure functions over a tree; a fifth artifact kind versioning through the one
mechanism; four routes; and a documents page with an outline panel, a keymap and an undo stack. After
it, a person can build a document's structure out of sections and the components editor 2 lets them
make.

**Left out, each to a named plan:**

| Left out                                                                         | Why not here                                                                                                         | Whose                                    |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `number`, the scheme, the counter stack and the numbering table                  | Decision A: the panel says nothing untrue without numbers, and `number` needs contributions from every occurrence    | **Structure 2, numbering**               |
| Captions, cross-references and the four-stage pipeline                           | All three read a numbering table that does not exist; the target union is a content-model change first (decision E)  | **Structure 2**, after the content model |
| `contents`, `listOf`, the contents panel proper, deep links and STR-039's budget | Decision J, and issue #119's number: each is the panel showing numbers and navigating, which needs the document view | **Structure 3, navigation**              |
| The cycle check (STR-057)                                                        | Decision D: there is no reference index to walk, and no cycle is reachable in T1                                     | **The relationships plan**               |
| Section field values validated against anything                                  | Finding 9: which schemas apply is TPL-054's, and TPL is not designed                                                 | **TPL's plan**                           |
| A page break reaching an output format (STR-050)                                 | Nothing publishes, so nothing can drop a declaration without error                                                   | **PUB's plan**                           |
| Resolving `approved`, and revisions                                              | Decision G: there is no revision to resolve to                                                                       | **The revisions plan**                   |
| A caption style, so captions can be placed (issue #118)                          | STY-003's six catalogues have no caption style, and STY is not designed                                              | **STY's plan**                           |
| Instantiating a document from a template (TPL-027, TPL-015, TPL-030)             | A document owning its outline after instantiation is about instantiation                                             | **TPL's plan**                           |
| Deleting a document made by mistake                                              | Deletion, retention and legal hold are undesigned (LIF-019, LIF-021)                                                 | **LIF's plan**                           |

## Decisions taken before this plan was written

Each is an open shape the design leaves to the plan. A reviewer should be able to reject each on its
own.

**1. The outline lives in `packages/domain/src/structure/`, and the spike's `OutlineSection` is left
where it is.** structure.md says the design "replaces it with a tree"; it does not say the
replacement has to happen in this change, and the two are not the same thing: `OutlineSection` serves
the **spike** content model (`content/document.ts`), which the OOXML reader and writer are built on
and which nothing else uses. Rewriting the reader to build a tree means giving it a parent stack, an
identifier source it has no randomness for, and a title that is inline content rather than a string -
five call sites in two files, in a package whose spike half is being retired anyway. **Built:** the
new module stands beside it, and retiring `content/outline.ts` goes on the list with the rest of the
spike.

**2. A document's content does not repeat its artifact's id.** Finding 1. A definition's payload
carries its own `id`, and `createArtifact` inserts the artifact with it; a component's identity is the
artifact row's, and an outline's is too. So `prepare`, `createArtifact` and `recordVersion` each
branch on three kinds rather than two, and `recordVersion`'s `content.id === artifactId` check narrows
to definitions. **Rejected**: giving the outline an `id` member so the existing two-way branch keeps
working - a payload that repeats its own artifact id is a second place for it to be wrong, and
`artifact_version_schema_version_is_content` already shows what the product does when it wants a
member of the content to agree with the row.

**3. A node's identifier is `blockIdentifierFrom`'s spelling, allocated by the service.** 128 random
bits as 26 lower-case base32 characters, the spelling the product already fixes for a block, from
`node:crypto`'s `randomBytes` in `packages/db`. Uniqueness is checked within the outline at every
parse, the way a component's block identifiers are checked within their component; across documents
the guarantee is the one the product already accepts for `gen_random_uuid`. STR-053 asks for
uniqueness within the tenant and is **not cited**, because no test can demonstrate it.

**4. `editOutline` reads the version the caller opened from, applies to that, and lets
`recordVersion` refuse.** It reads `openedFrom` by id, checks it belongs to this artifact and is a
document, parses its outline, applies the operation and calls `recordVersion` with the same
`openedFrom` - which takes the transaction-scoped advisory lock, finds the latest, and answers
`version.precondition` with the current version when somebody moved first. Applying to the version
the caller saw rather than to the latest is what makes the refusal honest: the store never silently
rebases one person's act onto another's. Measured: two acts sent together produced one `200`, one
`409` carrying the current outline, and exactly two rows in the chain.

**5. One route for five operations.** `POST /v1/documents/{id}/outline` takes `openedFrom` and one
operation from a closed union. Each is one act against one outline at one version, they share every
refusal, and a sixth operation should be a member of the union rather than a sixth path with the same
preconditions copied into it.

**6. The panel holds the undo stack, over the outlines the operations returned**, and clears it when
a precondition refuses - because undoing onto an outline somebody else has changed is the silent
overwrite STR-059 forbids. Undo is one entry per operation (STR-008), and it is an entry in the
renderer rather than a route, because the inverse of an operation is another operation.

**7. `values` is a member and nothing validates it.** Finding 9. The node carries
`values: Record<string, unknown>`, covered by the content hash and the version digest, and the schema
that would make a value valid comes from TPL-054. Nothing in the panel edits one.

**8. The documents page reuses `GET /v1/spaces`.** Finding 6. Editor 2 built it and it answers
`mayCreate` per space; **New document** offers only the spaces it says yes to, and shows nothing at
all where there are none - the same shape as **New component**, deliberately, so the two pages do not
disagree about what a person may do.

**9. Thirteen citations, and one requirement filed.** See the requirements section.

---

## Files

| File                                                                              | Responsibility                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/domain/src/structure/outline.ts`                                        | The outline document's schema, its parse, its migration chain and its canonical form       |
| `packages/domain/src/structure/operations.ts`                                     | The five operations as pure functions over a tree                                          |
| `packages/domain/src/structure/index.ts`                                          | The module's surface                                                                       |
| `packages/domain/src/structure/outline.test.ts`, `operations.test.ts`             | Tasks 1 and 2, and eight of the thirteen citations                                         |
| `packages/domain/src/structure/fixtures/v1/every-node.json`                       | The stored shape at schema version 1, held to completeness by `outline.test.ts`            |
| `packages/domain/src/version/substance.ts`, `src/index.ts`                        | Modified: `DocumentSubstance`, the three-way canonical choice, the package surface         |
| `packages/db/migrations/tenant/0016_documents.sql`                                | The three widened checks, and the flush that lets them apply on a fresh environment        |
| `packages/db/src/artifact-kind.ts`                                                | Modified: `document` in `artifactKinds` and in `contentKinds`                              |
| `packages/db/src/versions.ts`                                                     | Modified: `NewArtifact`, `prepare`, `createArtifact` and `recordVersion` branch three ways |
| `packages/db/src/documents.ts`                                                    | `createDocument`, `readDocument`, `listReadableDocuments`, `editOutline`                   |
| `packages/db/src/documents.test.ts`, `document-migration.test.ts`                 | Task 3: the store, the digests, the race, the lock that cannot be taken, the migration     |
| `packages/db/src/spaces.test.ts`, `src/index.ts`                                  | Modified: finding 7's test names another kind; the surface                                 |
| `packages/api-contract/src/documents.ts`, `routes.ts`, `index.ts`, `openapi.json` | The four routes and their schemas; the surface; the regenerated document                   |
| `packages/api-client/src/generated/schema.ts`                                     | Regenerated                                                                                |
| `apps/service/src/documents.ts`, `wire-codes.ts`, `wire-codes.test.ts`, `app.ts`  | The four handlers; `outline.invalid`; the handlers spread in                               |
| `apps/service/src/document-routes.test.ts`                                        | Task 4: the routes on the wire, and four of the citations                                  |
| `apps/service/src/cross-tenant.test.ts`, `access-routes.test.ts`                  | Modified: an entry per new route in each harness                                           |
| `apps/web/src/structure/DocumentList.tsx`, `NewDocument.tsx`, `OutlinePanel.tsx`  | The list, the create form, and the panel with its keymap                                   |
| `apps/web/src/structure/DocumentPage.tsx`, `DocumentPage.test.tsx`                | The page that holds them, the undo stack, and STR-008's citation                           |
| `apps/web/src/App.tsx`                                                            | Modified: the documents route in the hash router                                           |
| `packages/trace/src/trace.test.ts`, `parse/requirements.test.ts`, `trace.json`    | Modified in tasks 1, 2, 4 and 5                                                            |
| `docs/specification/requirements/STR-...md`, `requirements/README.md`             | Modified in task 4: STR-061's row, its change history, and the index's count               |
| `docs/design/structure.md`, `storage-and-versioning.md`, `access.md`              | Modified in tasks 4 and 6                                                                  |

Each production file has a test beside it, except `index.ts` files and the migration, exercised by
`document-migration.test.ts`; the contract's `documents.ts`, by `access.test.ts`, `openapi.test.ts`
and the service's route tests; `app.ts`, by the service's route tests; and `DocumentList.tsx`,
`NewDocument.tsx` and `OutlinePanel.tsx`, by `DocumentPage.test.tsx`.

## How the design's commitments become tests

| The design says                                                                                   | Where                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A document artifact's content is one outline, whose root holds one ordered array of nodes         | Task 1, which carries STR-001's citation                                       |
| `node` is a closed union of `section` and `reference`; a third arm is a schema version            | Task 1, STR-002                                                                |
| A node carries `pageBreak`, and the content model has no member for one                           | Task 1, STR-048 and STR-049                                                    |
| A reference node records `pinned`, `latest` or `approved`, and absent is not a fourth             | Task 1, STR-058                                                                |
| An identifier is 128 random bits, allocated at insertion, unique within the outline, never reused | Task 2, STR-003                                                                |
| Nesting is the tree's own, with no declared maximum                                               | Task 2, STR-007                                                                |
| Two nodes may name one component, each with its own identifier                                    | Task 2, STR-010                                                                |
| An outline canonicalises with the content model's rule, not the shared one                        | Tasks 1 and 3: two mark orders, one string and one digest. Cites nothing       |
| A document is a fifth artifact kind, versioning through the one mechanism                         | Task 3: the migration, both digests recomputed, the chain                      |
| A section has no artifact row, so there is no identity to share it by                             | Task 4, STR-004                                                                |
| An outline may hold no nodes at all, and that is a document rather than an error                  | Task 4, STR-054                                                                |
| Every operation carries the version it was read at, and no document lock can be introduced        | Task 4, STR-059: the race on the wire, and `component_lock`'s check constraint |
| A document is a named, versioned artifact belonging to exactly one space                          | Task 4, STR-061                                                                |
| A move takes its subtree, and is one undoable action                                              | Task 5, STR-008                                                                |
| The panel renders the outline every operation returns, with no second source                      | Task 5, and not cited: decision J                                              |
| A cycle is refused before the version is recorded (STR-057)                                       | Not here: decision D, and there is no index to walk                            |

## Requirements this plan cites, and those it does not

**Thirteen citations**, taking the pin from 149 to 162, and one claim, from 358 to 359. One
requirement is added to the corpus, STR-061, taking it from 1365 to 1366:

| ID          | Statement, in short                                                                          | Claimed by   | Cited in                                  | Task |
| ----------- | -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------- | ---- |
| **STR-001** | A document has exactly one outline, and it is an ordered tree                                | structure.md | `domain/src/structure/outline.test.ts`    | 1    |
| **STR-002** | Every outline node is either a section or a component reference                              | structure.md | `domain/src/structure/outline.test.ts`    | 1    |
| **STR-048** | A node may declare that it begins on a new page, or on a new recto page                      | structure.md | `domain/src/structure/outline.test.ts`    | 1    |
| **STR-049** | That declaration is a property of the node, never of the content it references               | structure.md | `domain/src/structure/outline.test.ts`    | 1    |
| **STR-058** | A component reference records which of the three reference modes it takes                    | structure.md | `domain/src/structure/outline.test.ts`    | 1    |
| **STR-003** | Every node carries a stable identifier, allocated on creation and never reused               | structure.md | `domain/src/structure/operations.test.ts` | 2    |
| **STR-007** | The outline supports nesting to at least nine levels                                         | structure.md | `domain/src/structure/operations.test.ts` | 2    |
| **STR-010** | One component is referenceable more than once, each occurrence a node with its own identity  | structure.md | `domain/src/structure/operations.test.ts` | 2    |
| **STR-004** | A section exists only in the document that declares it, and is not shareable or reusable     | structure.md | `service/src/document-routes.test.ts`     | 4    |
| **STR-054** | An outline has an implicit root - the document - and may hold no nodes at all                | structure.md | `service/src/document-routes.test.ts`     | 4    |
| **STR-059** | A version precondition governs concurrent outline edits, and no document lock is introduced  | structure.md | `service/src/document-routes.test.ts`     | 4    |
| **STR-061** | A document is a named, versioned artifact belonging to exactly one space, with its own title | structure.md | `service/src/document-routes.test.ts`     | 4    |
| **STR-008** | Moving a node moves its entire subtree, and is a single undoable action                      | structure.md | `web/src/structure/DocumentPage.test.tsx` | 5    |

**STR-059 is the sharpest of the thirteen, and its test shows both halves.** Two acts are sent
together from one `openedFrom`: one is recorded and the other answered `409 version_precondition`
carrying the outline as it now stands, and the chain holds exactly two versions, so nothing was
overwritten. In the same test, an attempt to take a lock on the document is refused by
`component_lock_kind_check` - the check constraint COL-N02 rests on, which is what makes "no
document-level lock is introduced" structural rather than a rule somebody remembers. The clause the
requirement puts on the interface - "refused or surfaced against the current outline" - is the
renderer's, shown in task 5 beside the citation rather than in it.

**STR-004 is the one a reviewer should weigh first.** Its statement is a negative - a section is not
shareable and not reusable - and a test cannot demonstrate the absence of every route that might one
day return one. What the test shows is why the absence holds: a section's identifier is 26 base32
characters, so it cannot name an artifact row at all; inserting one writes no row to `artifact`; and
`GET /v1/documents/{id}` answers `404` for it. **If a reviewer wants a demonstration rather than a
construction, the citation should wait** and STR-004 should join the near misses below.

**STR-061** is new (issue #120, decision I): "A document must be a named, versioned artifact
belonging to exactly one space, carrying its own title and identity." T1. Task 4 step 1 places the
row at the **end of section 3, The outline**, after STR-054. **Why there, and not a new section:**
section 3's prose already opens "A document owns exactly one outline", and every row in it is about
what a document and its outline are; STR-061 is the sentence that was assumed and never written, so
it belongs beside the rows that assumed it. Placing it after STR-054 rather than before STR-001
leaves the run STR-001 to STR-012, which the section's prose and traceability treat as one,
unbroken.

The test that cites it, `STR-061 makes a document a named, versioned artifact in exactly one space,
with its own title`, shows each clause on the wire: created in _General_ and nowhere else, its
`artifact` row carrying that space and its kind; answered at `0.1` with an author; its title inside
the versioned content, so the listing and the page read the same one; and the same document not
reachable from another environment at all. structure.md claims it in full, because the design answers
every clause by construction.

**Near misses, not cited:**

| ID                        | Why not                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| STR-012                   | "Pinned by a baseline like anything else": baselines do not exist, so half the statement cannot be shown. structure.md claims it |
| STR-053                   | Uniqueness within the **tenant** is an argument about 128 bits, not something a test can demonstrate                             |
| STR-057                   | Decision D: there is no reference index to walk, and no cycle is reachable in T1                                                 |
| STR-006                   | The keymap is built; its announcements and focus handling need the browser suite, and no release claims STR-006 without it       |
| STR-034, STR-036, STR-037 | Decision J: the panel is an outline, not yet a table of contents. Structure 3 cites all three                                    |
| STR-039                   | Issue #119's number is not in the corpus, and a jsdom render is not a measurement of navigation                                  |
| STR-060                   | Finding 9: the node carries `values` and nothing decides which schemas apply. structure.md already leaves it unclaimed           |
| CNT-046                   | An equation in a heading is representable, because a title is inline content; nothing authors one, and the caption half is CNT's |
| CNT-002, CNT-003, CNT-056 | The identifier spelling and the marks-as-a-set rule are exercised again; content-model.md's, already cited                       |
| VER-011, VER-042          | One versioning mechanism, and the digest over the whole version, exercised again; storage-and-versioning.md's, already cited     |
| IAM-014, IAM-018, API-037 | A space is the unit of access control, `create` is decided at it, and every route carries a precondition; owned elsewhere        |
| IAM-004                   | The cross-tenant harness grows, as the house rule has it, without citing                                                         |

---

## Task 1: The outline, in the domain

**Files:**

- Create: `packages/domain/src/structure/outline.ts`, `packages/domain/src/structure/index.ts`,
  `packages/domain/src/structure/fixtures/v1/every-node.json`
- Test: `packages/domain/src/structure/outline.test.ts`
- Modify: `packages/domain/src/version/substance.ts`, `packages/domain/src/index.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `inlineNodeSchema` from `../content/model/inline.js`; `canonicalJson` from
  `../stored/canonical.js`; `migrateStored` and `MigrationChain` from `../stored/migrate.js`
- Produces: `OUTLINE_SCHEMA_VERSION`, `outlineDocumentSchema`, `outlineNodeSchema`,
  `referenceModeSchema`, `parseOutlineDocument`, `migrateOutline`, `readOutline`,
  `canonicaliseOutline`, `walkOutline`; the types `OutlineDocument`, `OutlineNode`, `SectionNode`,
  `ReferenceNode`, `OutlineReadOutcome`; and `DocumentSubstance` in `VersionSubstance`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/structure/outline.test.ts`. The fixture directory is enumerated the way
`content/model/migrate.test.ts` enumerates its own, so a new schema version's directory is picked up
without editing the test.

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseVersionContent } from '../version/substance.js';
import {
  canonicaliseOutline,
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  readOutline,
  type OutlineDocument,
} from './outline.js';

const NODE = 'a'.repeat(26);
const OTHER = 'b'.repeat(26);
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

const empty: OutlineDocument = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
};

const section = (id: string, over: Record<string, unknown> = {}) => ({
  type: 'section',
  id,
  title: [{ type: 'text', value: 'Introduction', marks: [] }],
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
  ...over,
});

describe('the outline a document version holds', () => {
  it('STR-001 gives a document exactly one outline, an ordered tree with nowhere for a second', () => {
    expect(parseOutlineDocument(empty).nodes).toEqual([]);
    const ordered = parseOutlineDocument({ ...empty, nodes: [section(NODE), section(OTHER)] });
    expect(ordered.nodes.map((node) => node.id)).toEqual([NODE, OTHER]);
    // The root is closed: there is no second array to put an outline in.
    expect(() => parseOutlineDocument({ ...empty, outline: [] })).toThrow();
    expect(() => parseOutlineDocument({ ...empty, nodes: {} })).toThrow();
  });

  it('STR-002 makes every node either a section or a component reference, and nothing else', () => {
    const both = parseOutlineDocument({
      ...empty,
      nodes: [
        section(NODE, {
          children: [
            {
              type: 'reference',
              id: OTHER,
              component: COMPONENT,
              mode: { kind: 'latest' },
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        }),
      ],
    });
    expect(both.nodes[0]?.children[0]?.type).toBe('reference');
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), type: 'paragraph' }] }),
    ).toThrow();
    // A node's identifier is unique within its outline, as a block's is within its component.
    expect(() => parseOutlineDocument({ ...empty, nodes: [section(NODE), section(NODE)] })).toThrow(
      /used more than once/,
    );
  });

  it('STR-048 lets a node declare that it begins on a new page, or on a new recto page', () => {
    for (const pageBreak of ['none', 'page', 'recto']) {
      const parsed = parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak })] });
      expect(parsed.nodes[0]).toMatchObject({ pageBreak });
    }
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak: 'verso' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), pageBreak: undefined }] }),
    ).toThrow();
  });

  it('STR-049 makes the page-break declaration a property of the node, never of the content', () => {
    // The node carries it, and `contentDocumentSchema`'s root and every block refuse it, so the
    // declaration cannot travel with a component reused somewhere it should not break a page.
    const parsed = parseOutlineDocument({
      ...empty,
      nodes: [section(NODE, { pageBreak: 'page' })],
    });
    expect(parsed.nodes[0]).toHaveProperty('pageBreak', 'page');
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        pageBreak: 'page',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [] }],
      }),
    ).toThrow();
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [], pageBreak: 'page' }],
      }),
    ).toThrow();
  });

  it('STR-058 records which of the three reference modes a component reference takes', () => {
    const reference = (mode: unknown) => ({
      type: 'reference',
      id: NODE,
      component: COMPONENT,
      mode,
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    });
    for (const mode of [
      { kind: 'pinned', version: '11111111-1111-4111-8111-111111111111' },
      { kind: 'latest' },
      { kind: 'approved' },
    ]) {
      expect(parseOutlineDocument({ ...empty, nodes: [reference(mode)] }).nodes[0]).toMatchObject({
        mode,
      });
    }
    // The three are closed, absent is not a fourth, and pinned without a version is not pinned.
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'draft' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'pinned' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [{ ...reference({ kind: 'latest' }), mode: undefined }],
      }),
    ).toThrow();
  });

  it('canonicalises two identical outlines to one string where their marks were built in two orders', () => {
    const marks = [
      { type: 'emphasis', id: 'm2' },
      { type: 'strong', id: 'm1' },
    ];
    const titled = (order: typeof marks) =>
      parseOutlineDocument({
        ...empty,
        nodes: [section(NODE, { title: [{ type: 'text', value: 'Dosing', marks: order }] })],
      });
    const one = titled(marks);
    const other = titled([...marks].reverse());
    expect(canonicaliseOutline(one)).toBe(canonicaliseOutline(other));
    expect(canonicaliseVersionContent({ kind: 'document', content: one })).toBe(
      canonicaliseVersionContent({ kind: 'document', content: other }),
    );
    // The shared rule, which the version chain's `else` branch would have reached, gives two.
    expect(canonicalJson(one)).not.toBe(canonicalJson(other));
  });

  it('reads a stored outline through its own migration chain, and says why one will not read', () => {
    const outcome = readOutline(empty, { artifact: 'a', version: 'v' });
    expect(outcome.ok && outcome.outline.title).toBe('The dosing report');
    const refused = readOutline({ schemaVersion: 1, title: '' }, { artifact: 'a', version: 'v' });
    expect(refused.ok).toBe(false);
    expect(readOutline({}, { artifact: 'a', version: 'v' })).toMatchObject({ ok: false });
  });

  it('parses every fixture stored at every schema version, and the fixture holds every node', () => {
    const directory = new URL('./fixtures/', import.meta.url);
    for (const version of readdirSync(directory)) {
      for (const file of readdirSync(new URL(`${version}/`, directory))) {
        const stored: unknown = JSON.parse(
          readFileSync(new URL(`${version}/${file}`, directory), 'utf8'),
        );
        expect(readOutline(stored, { artifact: 'a', version: 'v' }).ok).toBe(true);
      }
    }
    const every: OutlineDocument = JSON.parse(
      readFileSync(new URL('./fixtures/v1/every-node.json', import.meta.url), 'utf8'),
    );
    const types = new Set<string>();
    const modes = new Set<string>();
    const breaks = new Set<string>();
    const walk = (nodes: OutlineDocument['nodes']) => {
      for (const node of nodes) {
        types.add(node.type);
        breaks.add(node.pageBreak);
        if (node.type === 'reference') modes.add(node.mode.kind);
        walk(node.children);
      }
    };
    walk(parseOutlineDocument(every).nodes);
    expect([...types].sort()).toEqual(['reference', 'section']);
    expect([...modes].sort()).toEqual(['approved', 'latest', 'pinned']);
    expect([...breaks].sort()).toEqual(['none', 'page', 'recto']);
  });
});
```

`contentDocumentSchema` is imported from `../content/model/document.js` at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/domain test -- --run src/structure/outline.test.ts
```

Expected: FAIL. The file does not resolve at all:
`Failed to resolve import "./outline.js" from "src/structure/outline.test.ts"`.

- [ ] **Step 3: Write the schema**

Create `packages/domain/src/structure/outline.ts`. This is the code the proof run used, with its
comments.

```ts
import { z } from 'zod';

import { inlineNodeSchema, type InlineNode } from '../content/model/inline.js';
import { canonicalJson } from '../stored/canonical.js';
import { migrateStored, type MigrationChain } from '../stored/migrate.js';

export const OUTLINE_SCHEMA_VERSION = 1;

const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

/** 128 bits as 26 lower-case base32 characters: the spelling `blockIdentifierFrom` already fixes. */
const nodeIdentifier = z.string().regex(/^[a-z2-7]{26}$/, 'not an outline node identifier');

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const artifactIdentifier = z.string().regex(LOWERCASE_UUID, 'not a lowercase uuid');

/** STR-058: the three REU and LIF name, closed, and absent is not a fourth. */
export const referenceModeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pinned'), version: artifactIdentifier }),
  z.strictObject({ kind: z.literal('latest') }),
  z.strictObject({ kind: z.literal('approved') }),
]);

/**
 * What both arms carry, because STR-017 and STR-048 are properties of a node's place rather than of
 * what fills it. Every switch is here at schema version 1 even where nothing reads it yet (the plan's
 * decision C): adding one later is a migration of every outline ever stored.
 */
const positional = {
  id: nodeIdentifier,
  numbered: z.boolean(),
  matter: z.enum(['body', 'appendix']),
  pageBreak: z.enum(['none', 'page', 'recto']),
  /** A section's own field values (STR-060). Which schemas apply is TPL-054's, so nothing validates them. */
  values: z.record(z.string(), z.unknown()),
};

export type SectionNode = {
  readonly type: 'section';
  readonly id: string;
  /** Inline content, not a string: CNT-046 puts an equation in a heading, and a heading is a node. */
  readonly title: readonly InlineNode[];
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly values: Record<string, unknown>;
  readonly children: readonly OutlineNode[];
};

export type ReferenceNode = {
  readonly type: 'reference';
  readonly id: string;
  readonly component: string;
  readonly mode: z.infer<typeof referenceModeSchema>;
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly values: Record<string, unknown>;
  readonly children: readonly OutlineNode[];
};

export type OutlineNode = SectionNode | ReferenceNode;

// Written out by hand above and lazily below, the way `blockNodeSchema` is, because a recursive zod
// schema cannot infer its own type.
export const outlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [sectionNodeSchema, referenceNodeSchema]),
);

export const sectionNodeSchema = z.strictObject({
  type: z.literal('section'),
  ...positional,
  title: z.array(inlineNodeSchema),
  children: z.array(outlineNodeSchema),
});

export const referenceNodeSchema = z.strictObject({
  type: z.literal('reference'),
  ...positional,
  component: artifactIdentifier,
  mode: referenceModeSchema,
  children: z.array(outlineNodeSchema),
});

/**
 * The root, and its members are closed. `nodes` has no minimum, unlike content's: STR-054 makes an
 * empty outline a valid document rather than an error.
 */
export const outlineDocumentSchema = z.strictObject({
  schemaVersion: z.literal(OUTLINE_SCHEMA_VERSION),
  title: z.string().min(1),
  language: bcp47,
  direction: z.enum(['ltr', 'rtl']),
  nodes: z.array(outlineNodeSchema),
});

export type OutlineDocument = z.infer<typeof outlineDocumentSchema>;

/** Depth-first, in document order, with the depth a node sits at. One walk, used by everything. */
export function walkOutline(
  nodes: readonly OutlineNode[],
  visit: (node: OutlineNode, depth: number) => void,
  depth = 1,
): void {
  for (const node of nodes) {
    visit(node, depth);
    walkOutline(node.children, visit, depth + 1);
  }
}

/**
 * The one entry point. One rule the schema cannot express on its own, because it is about a document
 * rather than a node: an identifier is unique within its outline (STR-003), the way a block
 * identifier is unique within its component (CNT-002).
 */
export function parseOutlineDocument(value: unknown): OutlineDocument {
  const outline = outlineDocumentSchema.parse(value);
  const seen = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (seen.has(node.id)) {
      throw new Error(`Outline node identifier ${node.id} is used more than once in this document`);
    }
    seen.add(node.id);
  });
  return outline;
}

// Created now rather than at the first schema change, because a chain nobody built is discovered to
// be missing on the day it is needed.
export const outlineMigrationChain: MigrationChain = {
  subject: 'outline',
  current: OUTLINE_SCHEMA_VERSION,
  migrations: {},
};

export function migrateOutline(value: unknown): unknown {
  return migrateStored(value, outlineMigrationChain);
}

export type OutlineReadOutcome =
  | { ok: true; outline: OutlineDocument }
  | { ok: false; artifact: string; version: string; failure: string };

export function readOutline(
  value: unknown,
  context: { artifact: string; version: string },
): OutlineReadOutcome {
  try {
    return { ok: true, outline: parseOutlineDocument(migrateOutline(value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * An outline's canonical form, and the input to its `content_hash`.
 *
 * **The shared rule is the wrong one here**, and this is the correction structure.md names. A section
 * title is inline content, inline content carries `marks`, and CNT-003 makes marks a set - so two
 * identical outlines whose marks were built in different orders would otherwise produce two strings,
 * two digests, and a `recordVersion` that records a version saying nothing new. Measured: under
 * `canonicalJson` they differ; under this they do not.
 */
export function canonicaliseOutline(outline: OutlineDocument): string {
  return canonicalJson(outline, marksAsASet);
}

function marksAsASet(member: string, array: readonly unknown[]): readonly unknown[] {
  if (member !== 'marks') return array;
  return [...(array as { type: string; id: string }[])].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1,
  );
}
```

Create `packages/domain/src/structure/index.ts` exporting the schema, the parse, the read, the
canonical form, `walkOutline` and the types, and add to `packages/domain/src/index.ts`:

```ts
// The document's outline: the tree, its parse, and the five operations over it.
export * from './structure/index.js';
```

Then the third arm, in `packages/domain/src/version/substance.ts`:

```ts
import { canonicaliseOutline, type OutlineDocument } from '../structure/outline.js';

/** A document version says its outline, and nothing else. */
export type DocumentSubstance = {
  readonly kind: 'document';
  readonly content: OutlineDocument;
};

export type VersionSubstance = ComponentSubstance | DefinitionSubstance | DocumentSubstance;
```

and make the choice three-way rather than a ternary, which is the whole point:

```ts
export function canonicaliseVersionContent(substance: VersionSubstance): string {
  if (substance.kind === 'component') return canonicalise(substance.content);
  // A section title is inline content and marks are a set, so an outline takes the content model's
  // rule too. The shared rule below is for a definition's payload, where no array is a set.
  if (substance.kind === 'document') return canonicaliseOutline(substance.content);
  return canonicalJson(substance.content);
}
```

`canonicaliseVersion` needs no change: `component` stays `undefined` for a document, so its
`componentType`, `definitions`, `notCarried` and `values` members are `null`, `[]`, `[]` and `{}` -
exactly as a definition's are, so every row's digest keeps one shape. Add `DocumentSubstance` to the
type exports in `packages/domain/src/index.ts`.

Create `packages/domain/src/structure/fixtures/v1/every-node.json`: one outline holding a section
with a reference beneath it, a second reference at top level, all three reference modes, all three
page breaks, both matters, a `numbered: false` node, a title carrying two marks, and a `values` member
that is not empty.

- [ ] **Step 4: Run it green**

```bash
pnpm --filter @alloy-works/domain test
```

Expected: PASS, the seven new tests beside the package's existing ones. Then

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

and move the citation pin in `packages/trace/src/trace.test.ts`, with a comment line above it:

```ts
// 154, from 149: the document and its outline (docs/plans/2026-09-18-structure-01-the-document-and-its-outline.md)
// cites STR-001, STR-002, STR-048, STR-049 and STR-058 in the outline's schema.
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/structure packages/domain/src/version/substance.ts \
  packages/domain/src/index.ts packages/trace
git commit -m "Give a document an outline: the tree, its parse and its canonical form"
```

---

## Task 2: The five operations

**Files:**

- Create: `packages/domain/src/structure/operations.ts`
- Test: `packages/domain/src/structure/operations.test.ts`
- Modify: `packages/domain/src/structure/index.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `parseOutlineDocument`, `walkOutline`, `referenceModeSchema` and the node types from
  `./outline.js`; `inlineNodeSchema` from `../content/model/inline.js`
- Produces: `outlineOperationSchema`, `applyOutlineOperation(outline, operation, newIdentifier)`;
  the types `OutlineOperation` and `OutlineApplied`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/structure/operations.test.ts`. The identifier source is a counter here,
so a property over generated sequences is reproducible; `packages/db` passes real randomness.

```ts
import { describe, expect, it } from 'vitest';
import { applyOutlineOperation, type OutlineOperation } from './operations.js';
import { parseOutlineDocument, walkOutline, type OutlineDocument } from './outline.js';

const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const OTHER_COMPONENT = '11111111-1111-4111-8111-111111111111';

const empty: OutlineDocument = parseOutlineDocument({
  schemaVersion: 1,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
});

/** Deterministic identifiers, so a generated sequence of operations reproduces exactly. */
function identifiers() {
  let next = 0;
  const made: string[] = [];
  return {
    made,
    allocate: () => {
      next += 1;
      const spelled = `${'a'.repeat(25)}${'bcdefghijklmnopqrstuvwxyz234567'[next % 31]!}`.slice(
        -26,
      );
      const unique = `${String(next).padStart(3, '0')}${'a'.repeat(23)}`.replace(
        /\d/g,
        (d) => 'abcdefghij'[Number(d)]!,
      );
      made.push(unique);
      return unique;
    },
  };
}

const run = (outline: OutlineDocument, operation: OutlineOperation, allocate: () => string) => {
  const answer = applyOutlineOperation(outline, operation, allocate);
  if (!answer.applied) throw new Error(answer.reason);
  return answer.outline;
};

const addSection = (
  parent: string | null,
  position = 0,
  title = 'Introduction',
): OutlineOperation => ({
  operation: 'insert',
  parent,
  position,
  node: { type: 'section', title: [{ type: 'text', value: title, marks: [] }] },
});

describe('the five operations over an outline', () => {
  it('STR-003 gives every node an identifier at insertion, and never reissues one', () => {
    const { allocate, made } = identifiers();
    let outline = run(empty, addSection(null), allocate);
    outline = run(outline, addSection(null, 1, 'Method'), allocate);
    const first = outline.nodes[0]!.id;
    outline = run(outline, addSection(first, 0, 'Scope'), allocate);

    const seen: string[] = [];
    walkOutline(outline.nodes, (node) => seen.push(node.id));
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(seen.every((id) => /^[a-z]{26}$/.test(id))).toBe(true);

    // Removing a node and inserting another never hands back the identifier that went.
    outline = run(outline, { operation: 'remove', node: first }, allocate);
    outline = run(outline, addSection(null, 0, 'Results'), allocate);
    const after: string[] = [];
    walkOutline(outline.nodes, (node) => after.push(node.id));
    expect(after).not.toContain(first);
    expect(new Set(made).size).toBe(made.length);
  });

  it('STR-007 nests to nine levels, with no maximum the schema declares', () => {
    const { allocate } = identifiers();
    let outline = empty;
    let parent: string | null = null;
    for (let depth = 1; depth <= 9; depth += 1) {
      outline = run(outline, addSection(parent, 0, `Level ${depth}`), allocate);
      let node = outline.nodes[0]!;
      for (let step = 1; step < depth; step += 1) node = node.children[0]!;
      parent = node.id;
    }
    let deepest = 0;
    walkOutline(outline.nodes, (_node, depth) => {
      deepest = Math.max(deepest, depth);
    });
    expect(deepest).toBe(9);
    // And it round-trips through the store's shape unchanged.
    expect(parseOutlineDocument(JSON.parse(JSON.stringify(outline)))).toEqual(outline);
  });

  it('STR-010 lets one component be referenced twice, each occurrence a node with its own identity', () => {
    const { allocate } = identifiers();
    const reference = (position: number, component: string): OutlineOperation => ({
      operation: 'insert',
      parent: null,
      position,
      node: { type: 'reference', component, mode: { kind: 'latest' } },
    });
    let outline = run(empty, reference(0, COMPONENT), allocate);
    outline = run(outline, reference(1, COMPONENT), allocate);
    outline = run(outline, reference(2, OTHER_COMPONENT), allocate);
    const nodes = outline.nodes.map((node) => (node.type === 'reference' ? node : undefined));
    expect(nodes[0]?.component).toBe(COMPONENT);
    expect(nodes[1]?.component).toBe(COMPONENT);
    expect(nodes[0]?.id).not.toBe(nodes[1]?.id);
    // Each occurrence carries its own switches, so one can be an appendix and the other not.
    outline = run(outline, { operation: 'set', node: nodes[1]!.id, matter: 'appendix' }, allocate);
    expect(outline.nodes[0]).toMatchObject({ matter: 'body' });
    expect(outline.nodes[1]).toMatchObject({ matter: 'appendix' });
  });

  it('moves a node with its whole subtree, and refuses a parent inside it', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null, 0, 'Introduction'), allocate);
    const first = outline.nodes[0]!.id;
    outline = run(outline, addSection(first, 0, 'Scope'), allocate);
    outline = run(outline, addSection(null, 1, 'Method'), allocate);
    const second = outline.nodes[1]!.id;

    outline = run(
      outline,
      { operation: 'move', node: first, parent: second, position: 0 },
      allocate,
    );
    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]!.children[0]!.id).toBe(first);
    expect(outline.nodes[0]!.children[0]!.children).toHaveLength(1);

    const inside = outline.nodes[0]!.children[0]!.children[0]!.id;
    expect(
      applyOutlineOperation(
        outline,
        { operation: 'move', node: first, parent: inside, position: 0 },
        allocate,
      ),
    ).toEqual({ applied: false, reason: 'A node cannot be moved inside its own subtree' });
  });

  it('retitles, sets a switch, removes a subtree, and refuses what does not apply', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null), allocate);
    const node = outline.nodes[0]!.id;
    outline = run(
      outline,
      { operation: 'retitle', node, title: [{ type: 'text', value: 'Results', marks: [] }] },
      allocate,
    );
    expect(outline.nodes[0]).toMatchObject({
      title: [{ type: 'text', value: 'Results', marks: [] }],
    });
    outline = run(
      outline,
      { operation: 'set', node, numbered: false, pageBreak: 'recto' },
      allocate,
    );
    expect(outline.nodes[0]).toMatchObject({ numbered: false, pageBreak: 'recto' });

    const absent = 'z'.repeat(26);
    for (const operation of [
      { operation: 'remove', node: absent },
      { operation: 'move', node: absent, parent: null, position: 0 },
      { operation: 'retitle', node: absent, title: [] },
      { operation: 'set', node: absent, numbered: true },
      addSection(absent),
      // A mode belongs to a component reference, not to a section.
      { operation: 'set', node, mode: { kind: 'latest' } },
    ] as OutlineOperation[]) {
      expect(applyOutlineOperation(outline, operation, allocate).applied).toBe(false);
    }

    outline = run(outline, addSection(node, 0, 'Scope'), allocate);
    outline = run(outline, { operation: 'remove', node }, allocate);
    expect(outline.nodes).toEqual([]);
  });

  it('keeps every invariant after any sequence of operations', () => {
    const { allocate } = identifiers();
    let outline = empty;
    for (let step = 0; step < 200; step += 1) {
      const ids: string[] = [];
      walkOutline(outline.nodes, (node) => ids.push(node.id));
      const target = ids[step % Math.max(ids.length, 1)];
      const operation: OutlineOperation =
        step % 4 === 0 || target === undefined
          ? addSection(step % 8 === 0 ? null : (ids[0] ?? null), 0, `Section ${step}`)
          : step % 4 === 1
            ? {
                operation: 'move',
                node: target,
                parent: ids[0] === target ? null : (ids[0] ?? null),
                position: 0,
              }
            : step % 4 === 2
              ? { operation: 'set', node: target, numbered: step % 8 === 2 }
              : {
                  operation: 'retitle',
                  node: target,
                  title: [{ type: 'text', value: `T${step}`, marks: [] }],
                };
      const answer = applyOutlineOperation(outline, operation, allocate);
      if (answer.applied) outline = answer.outline;

      const seen = new Set<string>();
      walkOutline(outline.nodes, (node) => {
        expect(node.id).toMatch(/^[a-z]{26}$/);
        expect(seen.has(node.id)).toBe(false);
        seen.add(node.id);
      });
      // Every outline an operation returns is one the parse accepts, which is what makes a store
      // that records them able to record anything the panel can produce.
      expect(parseOutlineDocument(outline)).toEqual(outline);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/domain test -- --run src/structure/operations.test.ts
```

Expected: FAIL, `Failed to resolve import "./operations.js" from
"src/structure/operations.test.ts"`.

- [ ] **Step 3: Write the operations**

Create `packages/domain/src/structure/operations.ts`, as the proof run had it. The shape to keep: a
closed operation union whose members are exactly what the route's body carries, and one function that
returns either an outline or a reason.

```ts
export type OutlineApplied =
  | { readonly applied: true; readonly outline: OutlineDocument }
  | { readonly applied: false; readonly reason: string };

/**
 * One structural act over one outline, as a pure function (STR-018's determinism is a property of a
 * pure function, and this is where a tree operation can be property-tested without a database).
 *
 * `newIdentifier` is the caller's, because where randomness comes from is the caller's platform and
 * this package has none: `packages/db` passes `node:crypto`'s `randomBytes` through
 * `blockIdentifierFrom`, and a test passes a counter.
 *
 * Every return goes back through `parseOutlineDocument`, so an operation cannot produce an outline
 * the store would refuse - which is what lets the service apply one and record it without a second
 * validation nobody would keep in step.
 */
export function applyOutlineOperation(
  outline: OutlineDocument,
  operation: OutlineOperation,
  newIdentifier: () => string,
): OutlineApplied;
```

with the five arms:

- **insert** builds the node - a section with its title, or a reference with its component and mode -
  gives it a fresh identifier and the defaults `numbered: true`, `matter: 'body'`,
  `pageBreak: 'none'`, `values: {}` and no children, and splices it in at `position` among the
  children of `parent` (or at the root when `parent` is `null`). A `parent` that is not in the
  outline is refused.
- **move** finds the node, refuses when the new parent is inside the node's own subtree, removes it
  and splices it back in. **The subtree travels because it is the subtree**: the node is one value.
- **remove** takes the node out, with its children.
- **retitle** replaces a section's title. A node that is not a section is refused.
- **set** replaces one or more of `numbered`, `matter`, `pageBreak`, `mode` and `values`. A `mode` on
  anything but a reference is refused.

Export them from `packages/domain/src/structure/index.ts`.

- [ ] **Step 4: Run it green, and move the pin**

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

Expected: PASS. Then take the citation pin from 154 to 157, with a comment naming STR-003, STR-007
and STR-010 in the operations.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/structure packages/trace
git commit -m "Insert, move, remove, retitle and set, as pure functions over an outline"
```

---

## Task 3: The document artifact, in the database

**Files:**

- Create: `packages/db/migrations/tenant/0016_documents.sql`, `packages/db/src/documents.ts`
- Test: `packages/db/src/documents.test.ts`, `packages/db/src/document-migration.test.ts`
- Modify: `packages/db/src/artifact-kind.ts`, `packages/db/src/versions.ts`,
  `packages/db/src/index.ts`, `packages/db/src/spaces.test.ts`

**Interfaces:**

- Consumes: `createArtifact`, `latestVersion`, `readVersion`, `recordVersion` from `./versions.js`;
  `applyOutlineOperation`, `blockIdentifierFrom`, `readOutline`, `OUTLINE_SCHEMA_VERSION` from
  `@alloy-works/domain`; `loadReadableSet` from `./access-facts.js`
- Produces: `createDocument(trx, input): Promise<CreateDocumentAnswer>`;
  `editOutline(trx, input): Promise<OutlineAnswer>`; `readDocument(trx, id)`;
  `listReadableDocuments(trx, readable)`; and `'document'` in `ArtifactKind` and `ContentKind`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/document-migration.test.ts`, in the shape
`invitation-migration.test.ts` already has: copy every migration but 0016 to a temporary directory,
provision a tenant against those, then migrate the rest.

```ts
it('widens the two artifact checks and the author check on an environment already at 0015', async () => {
  const id = db.newTenantId();
  await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
  const tenant = await provisionTenant(db.adminUrl, {
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id, name: 'Demonstration' },
    hostnames: [`${id}.alloy.test`],
  });
  await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
  const schema = tenant.schema;

  await expect(
    queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
  ).rejects.toThrow(/artifact_kind_check/);

  expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0016_documents']);

  // A document is content, so it lives in exactly one space.
  await expect(
    queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
  ).rejects.toThrow(/artifact_space_by_kind/);
  const { rows } = await queryAs(
    db.adminUrl,
    `insert into ${schema}.artifact (kind, space_id)
     values ('document', (select id from ${schema}.space where name = 'General')) returning id, kind`,
  );
  expect(rows[0].kind).toBe('document');

  await expect(
    queryAs(
      db.adminUrl,
      `insert into ${schema}.artifact_version
         (artifact_id, kind, revision_no, version_no, author_id, schema_version, content,
          content_hash, metadata_values, not_carried, version_digest)
       values ($1, 'document', 0, 1, null, 1, '{"schemaVersion":1}'::jsonb,
               repeat('a', 64), '{}'::jsonb, '[]'::jsonb, repeat('b', 64))`,
      [rows[0].id],
    ),
  ).rejects.toThrow(/artifact_version_component_author/);
});
```

Create `packages/db/src/documents.test.ts`, with `createTenantDatabase(db.serviceUrl, { max: 4 })` so
two acts can be in flight at once, and these cases, each of which the proof run passed:

- **Creating** answers `created` with revision 0, version 1, `kind: 'document'`, no component type,
  no values, no definitions, an outline holding no nodes, and an `artifact` row carrying the space.
- **The digests** recompute in TypeScript from the stored row and equal the row's, after an insert;
  and two outlines differing only in the order their marks were built produce one version digest.
- **The race**: two `editOutline` calls from one `openedFrom`, one recorded and one answered
  `version.precondition` naming the recorded version, with exactly two rows in the chain.
- **The lock that cannot be taken**: inserting a `component_lock` row for a document is rejected by
  `component_lock_kind_check`.
- **Another environment's document** is answered `undefined` by `readDocument`, and
  `listReadableDocuments` lists only what the caller may read.
- **A space this environment does not hold** answers `space.missing`.
- **An act that changes nothing** answers `version.unchanged`, and the chain does not grow (decision
  K).

Modify `packages/db/src/spaces.test.ts`, finding 7. The test names a kind the chain still does not
hold:

```diff
-  it('refuses a kind the version chain does not hold', async () => {
+  it('refuses a kind the version chain does not hold', async () => {
     await expect(
       service.withTenant(production, (trx) =>
-        sql`insert into artifact (kind) values ('document')`.execute(trx),
+        // A template is the next kind to arrive, by a migration widening this check (TPL's plan).
+        sql`insert into artifact (kind) values ('template')`.execute(trx),
       ),
     ).rejects.toThrow(/artifact_kind_check/);
   });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/db test -- --run src/documents.test.ts src/document-migration.test.ts
```

Expected: FAIL, both. `documents.test.ts` does not resolve `./documents.js`; the migration test fails
with `expected [] to deeply equal [ '0016_documents' ]`, since there is no 0016 to apply.

- [ ] **Step 3: Write the migration**

Create `packages/db/migrations/tenant/0016_documents.sql`. **The `set constraints all immediate` is
not tidiness** - finding 2, and without it a fresh environment cannot be provisioned at all.

```sql
-- A document is a fifth artifact kind, and its content is its outline (docs/design/structure.md).
-- It is content, so it lives in exactly one space, and it versions through the one mechanism
-- (VER-011): no new table, and artifact_version is untouched apart from the author check below.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check
  check (kind in ('component', 'document', 'field', 'metadataSchema', 'componentType'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document')) = (space_id is not null));

-- A document is made by a person, as a component is. 0015 required an author of a component alone,
-- because a definition the environment itself started with has none; nothing starts with a document.
--
-- `set constraints all immediate` first, and this is load-bearing: every migration of a tenant runs
-- in one transaction, so on a tenant provisioned now 0015's insert of the starter component type has
-- left pending trigger events on artifact_version, and Postgres refuses to ALTER a table that has
-- any ("cannot ALTER TABLE because it has pending trigger events", 55006). Flushing them costs
-- nothing and is the difference between this migration applying on a fresh environment and not.
set constraints all immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind not in ('component', 'document'));
```

- [ ] **Step 4: Widen the kinds and branch the chain three ways**

In `packages/db/src/artifact-kind.ts`:

```ts
export const artifactKinds = ['component', 'document', ...definitionKinds] as const;

/** Content kinds live in exactly one space; every other kind is a definition and lives in none. */
export const contentKinds = ['component', 'document'] as const satisfies readonly ArtifactKind[];
```

In `packages/db/src/versions.ts`, finding 1, in three places. `NewArtifact`:

```ts
export type NewArtifact = Authorship &
  (
    | {
        readonly substance: Extract<VersionSubstance, { kind: 'component' | 'document' }>;
        readonly spaceId: string;
      }
    | { readonly substance: Exclude<VersionSubstance, { kind: 'component' | 'document' }> }
  );
```

`prepare`, before the definition branch:

```ts
if (substance.kind === 'document') {
  // An outline carries no `id`: a document's identity is its artifact row's, as a component's is.
  return { kind: 'document', content: parseOutlineDocument(substance.content) };
}
```

`createArtifact`, which inserts a definition by the id its payload carries and content by a generated
one:

```ts
      substance.kind === 'component' || substance.kind === 'document'
        ? { kind: substance.kind, space_id: 'spaceId' in input ? input.spaceId : null }
        : { id: substance.content.id, kind: substance.kind, space_id: null },
```

and `recordVersion`'s identity check, which is a definition's rule and not content's:

```ts
  if (
    substance.kind !== 'component' &&
    substance.kind !== 'document' &&
    substance.content.id !== input.artifactId
  ) {
```

- [ ] **Step 5: Write the store**

Create `packages/db/src/documents.ts` with `createDocument`, `readDocument`,
`listReadableDocuments` and `editOutline`. Three things to keep from the proof run:

```ts
const newNodeIdentifier = () => blockIdentifierFrom(randomBytes(16));
```

`createDocument` refuses a space this environment does not hold before anything else, then writes
version `0.1` with an outline holding no nodes (STR-054):

```ts
const content = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: input.title,
  language: input.language,
  direction: input.direction,
  nodes: [],
};
```

and `editOutline`, which is decision 4 in code: read the version the caller opened from, check it is
this artifact's and is a document, parse, apply, record.

```ts
/**
 * One structural act, and one version (structure.md, "Editing the outline"). There is no document
 * lock and there cannot be one: `component_lock`'s check constraint refuses a document at the
 * database (COL-N02).
 *
 * The operation is applied to the version the caller **opened from**, never to the latest, so the
 * store never rebases one person's act onto another's; `recordVersion` then takes the advisory lock,
 * finds the latest and answers `version.precondition` with it when somebody moved first.
 */
export async function editOutline(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly operation: OutlineOperation;
  },
): Promise<OutlineAnswer> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.artifactId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.artifactId, version: opened.id });
  if (!read.ok) return { answer: 'outline.invalid', reason: read.failure };
  const applied = applyOutlineOperation(read.outline, input.operation, newNodeIdentifier);
  if (!applied.applied) return { answer: 'outline.invalid', reason: applied.reason };
  return recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'document', content: applied.outline },
  });
}
```

`listReadableDocuments` copies `listReadableComponents`' predicate exactly, with `a.kind` as
`'document'` - including the deliberate omission of the `space_id is null and tenant` disjunct, since
`artifact_space_by_kind` now forces a document to carry a space too. Export the four from
`packages/db/src/index.ts`.

- [ ] **Step 6: Run them green, and run the whole database suite**

```bash
pnpm build
pnpm --filter @alloy-works/db test
```

Expected: PASS everywhere, including `version-chain.test.ts`, which loops over `artifactKinds` and
handles `document` because `contentKinds` now names it, and `spaces.test.ts` with step 1's edit. The
proof run reached 266 of 267 before that edit and the failure was exactly that test.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/tenant/0016_documents.sql packages/db/src/documents.ts \
  packages/db/src/documents.test.ts packages/db/src/document-migration.test.ts \
  packages/db/src/artifact-kind.ts packages/db/src/versions.ts packages/db/src/index.ts \
  packages/db/src/spaces.test.ts
git commit -m "Hold a document in the version chain, and edit its outline a version at a time"
```

---

## Task 4: Documents through the service

**Files:**

- Create: `packages/api-contract/src/documents.ts`, `apps/service/src/documents.ts`
- Modify: `packages/api-contract/src/routes.ts`, `src/index.ts`, `openapi.json`
- Modify: `packages/api-client/src/generated/schema.ts` (regenerated)
- Modify: `apps/service/src/app.ts`, `src/wire-codes.ts`, `src/wire-codes.test.ts`
- Test: `apps/service/src/document-routes.test.ts`
- Modify: `apps/service/src/cross-tenant.test.ts`, `src/access-routes.test.ts`
- Modify (decision I): `docs/specification/requirements/STR-structure-numbering-and-cross-references.md`,
  `docs/specification/requirements/README.md`, `docs/design/structure.md`, `CLAUDE.md`,
  `docs/guides/reading-the-trace.md`, `packages/trace/src/trace.test.ts`,
  `packages/trace/src/parse/requirements.test.ts`

- [ ] **Step 1: Land STR-061 in the corpus, and claim it**

Before any test names it, so `pnpm trace check` never sees a citation naming nothing. The row is
`pnpm trace draft 120`'s - it allocates STR-061 - placed at the end of **section 3, The outline**,
after STR-054 (see
[the requirements section](#requirements-this-plan-cites-and-those-it-does-not) for why there).

```bash
pnpm trace draft 120
```

prints

```markdown
| **STR-061** | A document must be a named, versioned artifact belonging to exactly one space, carrying its own title and identity. | T1 | Specified |
```

Add that row after STR-054's, a paragraph after the one on STR-054, and a change history entry naming
the issue (keep the table's padding with `pnpm exec prettier`):

```markdown
**STR-061 says what a document is.** TPL-001 says a template is "a named, versioned artifact
belonging to a space", and nothing said the same of a document: STR-001 presumes one, TPL
instantiates one, and VER versions one. The design answers it by construction, which is exactly the
kind of answer that ought to have a row behind it.

### From planning the document and its outline

Not a review. [Issue #120](https://github.com/kenhayward/alloy-works/issues/120), filed while
planning [the first structure plan](../../plans/2026-09-18-structure-01-the-document-and-its-outline.md),
found that nothing in the corpus declared what a document is.

| What was found                                                                                                   | Change                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| STR-001 presumes a document, TPL instantiates one and VER versions one, and no requirement declares its identity | **STR-061**: a document is a named, versioned artifact belonging to exactly one space, carrying its own title and identity |

| Counts           | Before                    | After                     |
| ---------------- | ------------------------- | ------------------------- |
| Requirements     | 60, of which 3 superseded | 61, of which 3 superseded |
| Non-requirements | 5                         | 5                         |
| Open questions   | 4                         | 4                         |
```

Modify `docs/specification/requirements/README.md`, the index's count in its status note, from 1365
to 1366, and the same count where it is prose elsewhere: `CLAUDE.md` ("There are 1,365 requirements
in 22 documents") and `docs/guides/reading-the-trace.md` (each place it names the total) become
1,366.

Claim it in `docs/design/structure.md`'s `## Requirements owned`, beside STR-054:

```markdown
| **STR-061** | A document is an artifact of its own kind: its identity is the `artifact` row, `artifact_space_by_kind` puts it in exactly one space, its title lives inside its versioned content as a component's does, and it versions through the one mechanism |
```

Then regenerate and move the pins:

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

In `packages/trace/src/trace.test.ts`, take the requirement count to 1366 and the claim count to 359,
each with a comment line above it; and the same requirement count in
`packages/trace/src/parse/requirements.test.ts`.

- [ ] **Step 2: Write the failing test**

Create `apps/service/src/document-routes.test.ts`, in the shape
`component-creation.test.ts` already has: a fresh database, the stand-in provider, `buildApp`, Ada,
Grace and Alice signed in, _General_ seeded and _Quality_ made, Alice a Reader on _General_, and
**Ada granted Administrator at the tenant** - which the proof run found is not what
`seedDevelopmentContent` does on its own: the seed grants Ada Author on _General_ and nothing else,
so a test that wants the read-but-not-create case has to grant it.

The four citations, each a plain `it`:

```ts
it('STR-061 makes a document a named, versioned artifact in exactly one space, with its own title', async () => {
  const made = await create('ada', general, 'The dosing report');
  expect(made.statusCode).toBe(200);
  const body = made.json<{
    id: string;
    space: { id: string };
    version: { number: string; author: string };
    outline: { title: string };
  }>();
  expect(body.version.number).toBe('0.1');
  expect(body.version.author).toBe(ids.ada);
  expect(body.space.id).toBe(general);
  // The title is inside the versioned content, so the listing and the page read one title.
  expect(body.outline.title).toBe('The dosing report');
  const listed = await call('ada', 'GET', '/v1/documents');
  expect(listed.json<{ items: { id: string; title: string }[] }>().items).toContainEqual({
    id: body.id,
    title: 'The dosing report',
  });
  const row = await tenantDb.withTenant(tenant, (trx) =>
    trx
      .selectFrom('artifact')
      .select(['kind', 'space_id'])
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow(),
  );
  expect(row).toEqual({ kind: 'document', space_id: general });
  // And it is this environment's alone.
  const elsewhereApp = await app.inject({
    method: 'GET',
    url: `/v1/documents/${body.id}`,
    headers: { host: OTHER, cookie: cookies.ada! },
  });
  expect(elsewhereApp.statusCode).toBe(401);
});

it('STR-054 gives an outline an implicit root and lets it hold no nodes at all', async () => {
  const made = await create('ada', general, 'Front matter only');
  const body = made.json<{ id: string; outline: { nodes: unknown[] } }>();
  expect(body.outline.nodes).toEqual([]);
  // Created, read and listed with no nodes, and no error anywhere. The root the deep link would
  // address is the document itself, which is the id the route is named by.
  const opened = await call('ada', 'GET', `/v1/documents/${body.id}`);
  expect(opened.statusCode).toBe(200);
  expect(opened.json<{ id: string; outline: { nodes: unknown[] } }>()).toMatchObject({
    id: body.id,
    outline: { nodes: [] },
  });
  expect(
    (await call('ada', 'GET', '/v1/documents'))
      .json<{ items: { id: string }[] }>()
      .items.map((i) => i.id),
  ).toContain(body.id);
});

it('STR-004 keeps a section inside the document that declares it, with no identity to share it by', async () => {
  const made = await create('ada', general, 'Owning its sections');
  const doc = made.json<{ id: string; version: { id: string } }>();
  const inserted = await addSection(doc, 'Introduction');
  const node = inserted.json<{ outline: { nodes: { id: string }[] } }>().outline.nodes[0]!;
  // A node identifier is 26 base32 characters, so it cannot name an artifact row at all.
  expect(node.id).toMatch(/^[a-z2-7]{26}$/);
  const artifacts = await tenantDb.withTenant(tenant, (trx) =>
    trx.selectFrom('artifact').select('id').where('space_id', '=', general).execute(),
  );
  expect(artifacts.map((each) => each.id)).not.toContain(node.id);
  // And there is no route that returns one: a section is reachable only through its document.
  expect((await call('ada', 'GET', `/v1/documents/${node.id}`)).statusCode).toBe(400);
  expect((await call('ada', 'GET', `/v1/components/${doc.id}`)).statusCode).toBe(404);
});

it('STR-059 refuses a conflicting act against the current outline, and no document lock exists', async () => {
  const made = await create('ada', general, 'Raced');
  const doc = made.json<{ id: string; version: { id: string } }>();
  const [first, second] = await Promise.all([addSection(doc, 'First'), addSection(doc, 'Second')]);
  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  const refused = first.statusCode === 409 ? first : second;
  expect(refused.json()).toMatchObject({ code: 'version_precondition' });
  // The refusal carries the outline as it now stands, so nothing is overwritten silently.
  expect(
    refused.json<{ current: { outline: { nodes: unknown[] } } }>().current.outline.nodes,
  ).toHaveLength(1);
  const chain = await tenantDb.withTenant(tenant, (trx) =>
    trx.selectFrom('artifact_version').select('id').where('artifact_id', '=', doc.id).execute(),
  );
  expect(chain).toHaveLength(2);
  // And no document-level lock can be introduced by accident: the constraint refuses one.
  await expect(
    tenantDb.withTenant(tenant, (trx) =>
      sql`insert into component_lock (artifact_id, kind, principal_id, session_id, expires_at)
          values (${doc.id}, 'document', ${ids.ada!}, gen_random_uuid(), now() + interval '1 hour')`.execute(
        trx,
      ),
    ),
  ).rejects.toThrow(/component_lock_kind_check/);
});
```

and beside them, carrying no identifier:

- **restructuring** takes `0.1` to `0.2` with a fresh node identifier, then a move, a retitle, a set
  and a remove, each one version;
- **an act that changes nothing** answers `200` and leaves the chain as it was (decision K);
- **an operation that does not apply** answers `400 outline_invalid`;
- **the refusals**: Alice `403` creating in _General_, `404` in _Quality_; Ada `403` creating in
  _Quality_ (she administers and may read it, and `administer` carries no `create`); another
  environment's space and an unknown one `404`; Alice `200` reading a document in _General_ with
  `mayEdit` false and `403` editing its outline;
- **a strict body** and **an uppercase id in a path** each `400`.

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/service test -- --run src/document-routes.test.ts
```

Expected: FAIL at the first request, `Route POST:/v1/spaces/<id>/documents not found`, answered 404 by
Fastify, so the first expectation reads `expected 404 to be 200`.

- [ ] **Step 4: Declare the routes**

Create `packages/api-contract/src/documents.ts`. **Import `LowercaseUuid` and `ErrorBody` from
`./schemas.js`**, never define a third copy: `components.ts` and `editing.ts` already import from each
other, and a third definition site is a circular import that fails at run time rather than at build.

The four routes, exactly as the proof run declared them and as
`packages/api-contract/src/access.test.ts` requires - `tenantScoped: true`, the target's parameter in
both the path and `params.shape`, and a declared `403` and `404`:

| Route                               | Access                           | Body / params                            |
| ----------------------------------- | -------------------------------- | ---------------------------------------- |
| `GET /v1/documents`                 | `{ check: 'session' }`           | -                                        |
| `POST /v1/spaces/{space}/documents` | `create` at `{ space: 'space' }` | `CreateDocumentBody`, `SpaceParams`      |
| `GET /v1/documents/{id}`            | `read` at `{ artifact: 'id' }`   | `DocumentParams`                         |
| `POST /v1/documents/{id}/outline`   | `edit` at `{ artifact: 'id' }`   | `OutlineOperationBody`, `DocumentParams` |

None declares `changesAccess`. `OutlineOperationBody` is a strict object of `openedFrom` and one
`operation` from the closed union; `OutlineRefusal` is `ErrorBody.extend({ current:
DocumentView.optional() })`, so the precondition's answer carries the outline as it stands.

Register `...documentRoutes` in `packages/api-contract/src/routes.ts` between `componentRoutes` and
`editingRoutes`, and export the schemas from `packages/api-contract/src/index.ts`.

- [ ] **Step 5: Answer them**

In `apps/service/src/wire-codes.ts`, one new code, and its line in `wire-codes.test.ts`:

```ts
  'outline.invalid': 'outline_invalid',
```

Create `apps/service/src/documents.ts` with the four handlers, spread into `handlers` in `app.ts`
beside `componentHandlers`. Three things the proof run settled:

- **`getDocument` must guard the kind itself.** `authorise` never looks at an artifact's kind, so a
  component's id on `/v1/documents/{id}` would authorise cleanly; `readDocument` answers `undefined`
  for anything that is not a document, and the handler throws `notFound()` - the mirror of
  `getComponent`'s guard.
- **A refusal's extra members go in `AppError`'s fifth argument**, not assigned onto the error
  afterwards. Only `error.members` reaches the caller (`toErrorBody`), which is how
  `version_precondition` carries `current`.

```ts
if (answer.answer === 'version.precondition') {
  throw new AppError(
    409,
    wireCode('version.precondition'),
    'This document has a newer version than the one this page opened.',
    undefined,
    { current: view(id, space, answer.current, decide('edit', facts).allowed) },
  );
}
if (answer.answer === 'version.unchanged') {
  // Decision K: putting something back where it was is not an error, and the chain keeps no
  // row for it. The same shape `cutVersion` already answers.
  return view(id, space, answer.current, decide('edit', facts).allowed);
}
```

- **`space.missing` from the store is answered `404`.** The space was decided on before the handler
  ran, so it can only mean the space went in the moment between; answered as absent either way, never
  as a refusal that says it exists.

- [ ] **Step 6: Give the harnesses their entries**

In `apps/service/src/cross-tenant.test.ts`, add to `OTHER_TENANT_IDS`:

```ts
  createDocument: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  editOutline: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
```

with a `documentIdIn` beside `componentIdIn`, making a document in environment B's _General_ through
`createDocument`; and to `VALID_INPUT`:

```ts
  createDocument: { payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' } },
  editOutline: {
    payload: {
      openedFrom: '11111111-1111-4111-8111-111111111111',
      operation: { operation: 'remove', node: 'a'.repeat(26) },
    },
  },
```

In `apps/service/src/access-routes.test.ts`, add a document to the fixture beside `dosing` and its
entries to `HOLDING_NOTHING`, each `404`, since a principal holding nothing may not read the space.

- [ ] **Step 7: Regenerate the document and the client**

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm build
```

Both files are committed with the routes they follow.

- [ ] **Step 8: Run everything the routes touch, and move the pin**

```bash
pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/service test
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

Expected: PASS everywhere, `changing-access.test.ts` included - none of the four declares
`changesAccess`, and creating an artifact fires no epoch trigger. Then take the citation pin from 157
to 161, naming STR-004, STR-054, STR-059 and STR-061.

- [ ] **Step 9: Commit**

```bash
git add packages/api-contract packages/api-client/src/generated/schema.ts apps/service/src \
  docs/specification/requirements docs/design/structure.md docs/guides/reading-the-trace.md \
  CLAUDE.md packages/trace
git commit -m "Create a document and restructure its outline through the service"
```

---

## Task 5: The documents page and the outline panel

**Files:**

- Create: `apps/web/src/structure/DocumentList.tsx`, `NewDocument.tsx`, `OutlinePanel.tsx`,
  `DocumentPage.tsx`
- Test: `apps/web/src/structure/DocumentPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: the generated client's `GET /v1/spaces`, `GET /v1/documents`,
  `POST /v1/spaces/{space}/documents`, `GET /v1/documents/{id}` and
  `POST /v1/documents/{id}/outline`
- Produces: `DocumentPage({ client, id })`, `OutlinePanel({ outline, editable, onOperation, notice })`,
  `NewDocument({ client, onCreated })`, `DocumentList({ client, onOpen })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/structure/DocumentPage.test.tsx`, driving the client with a hand-written `fetch`
as the renderer's other tests do - copy the fake's shape from `NewComponent.test.tsx` rather than
inventing a second one. Every response body is checked before it is read, never trusted.

```tsx
it('STR-008 moves a node with its whole subtree, as one action undo takes back', async () => {
  // The outline the service answers: Introduction, with Scope beneath it, then Method.
  const { fetch, sent } = service({ ... });
  render(<DocumentPage client={client(fetch)} id={DOCUMENT} />);
  await screen.findByRole('treeitem', { name: /Introduction/ });

  // Drag Introduction under Method, from the panel's keymap: Alt+Down then Alt+Right.
  await userEvent.click(screen.getByRole('treeitem', { name: /Introduction/ }));
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');

  // One operation was sent, and it named the node, its new parent and its position - not its subtree.
  expect(sent.filter((request) => request.url.endsWith('/outline'))).toHaveLength(2);
  expect(sent.at(-1)?.body).toMatchObject({
    operation: { operation: 'move', node: INTRODUCTION, parent: METHOD, position: 0 },
  });
  // The subtree travelled: Scope is still under Introduction, which is now under Method.
  const method = await screen.findByRole('treeitem', { name: /Method/ });
  expect(within(method).getByRole('treeitem', { name: /Introduction/ })).toBeInTheDocument();
  expect(within(method).getByRole('treeitem', { name: /Scope/ })).toBeInTheDocument();

  // And it is a single undoable action: one Ctrl+Z puts the node and its subtree back.
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() =>
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Scope[\s\S]*Method/),
  );
  expect(sent.at(-1)?.body).toMatchObject({
    operation: { operation: 'move', node: INTRODUCTION, parent: null, position: 0 },
  });
});
```

and beside it, carrying no identifier:

- **New document** offers only the spaces `GET /v1/spaces` says `mayCreate` for, and shows nothing at
  all where there are none - the same shape as **New component** (decision 8);
- a title that is empty, or a language tag that is not one, is not sent, and the page says which;
- inserting, retitling, setting a page break and removing each send one operation and render what
  came back;
- a `409 version_precondition` renders the outline the refusal carried, says **Somebody else changed
  this document. This is how it stands now.**, and **clears the undo stack**, so undo cannot overwrite
  their change;
- a `403` says **You may not change this document.** and leaves the outline as it was;
- a reference node whose mode is `approved` renders **waiting on revisions** rather than a version
  (decision G);
- a document with no nodes renders **This document has no sections yet.** and the panel still takes
  an insert.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/web test -- --run src/structure/DocumentPage.test.tsx
```

Expected: FAIL, `Failed to resolve import "./DocumentPage.js"`.

- [ ] **Step 3: Write the page**

`OutlinePanel` is a `role="tree"` of `role="treeitem"` nodes, **one tab stop** with arrow-key movement
between nodes, as component-editor.md's toolbar is, and the enumerated keymap STR-006 asks for:
`Alt+Up` and `Alt+Down` to move among siblings, `Alt+Left` and `Alt+Right` to promote and demote,
`Enter` to insert a sibling, `Delete` for a node and its subtree. Each announces what moved and where
it landed through a `role="status"` region. **STR-006 is not cited**: its announcements and focus
handling need the browser suite component-editor.md's plan introduces, and no release claims it
without one.

`DocumentPage` holds the outline the last operation returned and an undo stack of inverse operations,
one entry per act (decision 6), cleared on a precondition refusal. It sends one operation at a time
and disables the panel while one is in flight, the same `useRef` guard `NewComponent` uses.

`NewDocument` mirrors `NewComponent`: **Where**, **Title**, **Language**, **Direction**, **Create** -
no component type, because a document has none.

- [ ] **Step 4: Run it green, and move the counts**

```bash
pnpm --filter @alloy-works/web test
```

Then in `packages/trace/src/trace.test.ts` the `.tsx` count 7 to 8, and the citation pin 161 to 162.

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src packages/trace
git commit -m "Build a document's outline from the page, one act at a time"
```

---

## Task 6: The trace, the docs and the release

**Files:**

- Modify: `docs/design/structure.md`, `docs/design/storage-and-versioning.md`,
  `docs/design/access.md`
- Modify: `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md`
- Modify: `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`
- Modify: `packages/trace/trace.json`

- [ ] **Step 1: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace tranche T1 STR
pnpm trace show STR-061
pnpm trace show STR-057
```

Expected: `No problems in the corpus.`; the thirteen cited requirements each `Covered`, naming the
test that cites them; STR-057 `Designed`, claimed by structure.md and cited by nothing, which is
decision D and is meant.

- [ ] **Step 2: Pass the gate**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/worker fetch-typst   # once per machine
pnpm test
pnpm trace verify
pnpm trace gate
```

`pnpm trace gate` refuses without the worker's and the object store's reports, so the whole
`pnpm test` has to have run.

- [ ] **Step 3: Correct the two designs decision A makes wrong**

Finding 8, one line each, which structure.md says the pull request that builds this should make.

```diff
--- a/docs/design/storage-and-versioning.md
+++ b/docs/design/storage-and-versioning.md
@@
-**`artifact`** is the identity of a versioned thing: a kind and an id. A component, a document, an outline, an asset, a query definition, a theme, a layout, a template, a field, a metadata schema or a component type are all artifacts, and
+**`artifact`** is the identity of a versioned thing: a kind and an id. A component, a document - whose content is its outline ([structure.md](structure.md)) - an asset, a query definition, a theme, a layout, a template, a field, a metadata schema or a component type are all artifacts, and
```

```diff
--- a/docs/design/access.md
+++ b/docs/design/access.md
@@
-live in exactly one: a component, a document, an outline, a template, an asset, a query definition.
+live in exactly one: a component, a document (which holds its own outline), a template, an asset, a query definition.
```

VER-011's row in storage-and-versioning.md is left alone: it says one mechanism is parameterised by
`artifact_kind`, which is a statement about the mechanism rather than a mandate on the inventory, and
it is as true with four content kinds as with five.

- [ ] **Step 4: Amend structure.md**

STR-061's claim is already there from task 4. Add a `## Changed while planning the build` section in
the shape access.md's and component-editor.md's have:

```markdown
[The first structure plan](../plans/2026-09-18-structure-01-the-document-and-its-outline.md) was
written against this document and found ten things. One requirement claim is new, STR-061 (issue
#120): nothing in the corpus declared what a document is.

| Found                                                                                                                                                                | Change                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The version chain assumes every artifact that is not a component is a definition**, parsing its content by kind and demanding its payload repeat the artifact's id | `prepare`, `createArtifact` and `recordVersion` branch on three kinds; a document's identity is its artifact row's, and an outline carries no id of its own |
| **Migration 0016 cannot ALTER `artifact_version` on a fresh environment**: 0015's insert leaves pending trigger events in the same transaction                       | `set constraints all immediate` before the ALTER, with the reason in the migration. It fails only on a fresh environment, which is the path everybody uses  |
| **STR-057's cycle check has no index to walk**: "Stores" says `reference` gains outline rows, and there is no `reference` table                                      | Not built. In T1 no cycle is reachable at all; STR-057 stays claimed and is cited by nothing until relationships.md's index exists                          |
| **`artifact_version_component_author` let a document version have no author**                                                                                        | 0016 widens it to `kind not in ('component', 'document')`                                                                                                   |
| **The canonical-form correction is right, and reachable only by a hand-built value**                                                                                 | Built and held by a test, with the shared rule run against the same pair to show it gives two strings                                                       |
| **An administrator may read a space they may not create in**, so a page offering every readable space would offer refusals                                           | **New document** offers only what `GET /v1/spaces` says `mayCreate` for, as **New component** does                                                          |
| **A section's `values` have nowhere to come from**: TPL-054's section-level assignments do not exist                                                                 | The member is stored and validated by nothing, said here. STR-060 stays unclaimed                                                                           |
| **`version.unchanged` is not a refusal**                                                                                                                             | An act that leaves the outline as it was answers `200` with the outline as it stands, the shape `cutVersion` already answers                                |
| **The two content-model holes are free to close today and a migration later**                                                                                        | Named and not closed here: a cross-reference's bare target, and the uniqueness walk that does not descend into footnote content                             |
| **The panel is not yet a table of contents**                                                                                                                         | It shows no numbers and jumps nowhere, so STR-034, STR-036 and STR-037 stay claimed and cited by nothing until the navigation plan                          |
```

and, under "The outline, and why it is one tree", replace the note that none of this is built with
what now is.

- [ ] **Step 5: Describe what is built**

In `docs/architecture.md`: the new migration and the widened checks in the database section;
`packages/domain/src/structure/` in the content model's; the four routes in the service's; and the
documents page and the outline panel in the renderer's. In `docs/development.md`: how to make a
document and build its outline by hand on 8088, as step "Trying it by hand" below sets it out, and
that a development database from before 0.27.0 gains only the three widened checks.

- [ ] **Step 6: The features, in lockstep**

In `docs/features.md`, under "What exists today", a new entry after "Making a component":

```markdown
- **Documents and their outlines.** A document is a thing of its own, made in a space you may create
  in, with a title, a base language and a direction. Its outline is a tree: add a section, put a
  component in it, move one under another with the mouse or with `Alt` and the arrow keys, rename
  one, and remove one with everything under it. Every act is its own version, so the history reads as
  what somebody did rather than as keystrokes, and `Ctrl+Z` takes the last one back. Nobody locks a
  document: if somebody else changes the outline while you have it open, your next change is refused
  and the page shows you theirs rather than overwriting it.

  **This is structure, not the document.** Nothing is numbered yet - no section numbers, no figure or
  table numbers, no cross-references resolved, and no table of contents. There is no document view:
  the outline is a tree you build, and you still open a component on its own to edit it.
```

and under "What does not exist", replace "No document view, component tree, reuse or transclusion."
with:

```markdown
- No document view: a document's outline is a tree you build, and a component still opens on its own
  to be edited. No numbering, no cross-references, no table of contents, no reuse or transclusion.
```

In `README.md`'s Features table, add one row and leave the rest:

```markdown
| Documents and outlines | Make a document in a space, build its outline out of sections and components, and restructure it a version at a time |
```

- [ ] **Step 7: Mark the plan built**

In `docs/plans/README.md`, this plan's row becomes `Built (PR #n)` once the number is known, and the
prose below the structure table gains a paragraph in the shape the other plans' have.

- [ ] **Step 8: Bump the version and write the changelog**

`version.json`, the root `package.json` and `apps/desktop/package.json` all become `0.27.0`. At the
top of `CHANGELOG.md`, with the date and the PR number in the heading, which
`apps/desktop/src/version.test.ts` now requires:

```markdown
## 0.27.0 - YYYY-MM-DD (PR #n)

### Added

- **Documents.** A document is a thing of its own now. Make one in a space you may create in, give it
  a title, a base language and a direction, and it opens at version 0.1 with an empty outline.
- **Outlines.** Build a document's structure as a tree: add a section, put a component in it, move
  one under another by pointer or with `Alt` and the arrow keys, rename one, mark one to start on a
  new page, and remove one with everything beneath it. Each act is its own version, and `Ctrl+Z`
  takes the last one back.
- **No lock on a document.** Two people can have the same outline open. If somebody else changes it
  first, your next change is refused and the page shows you the outline as it now stands, rather than
  overwriting what they did.

### Changed

- The version chain now holds a fifth kind of thing, a document, on the same terms as everything else
  it holds: one space, one chain of versions, and the same two digests.
```

- [ ] **Step 9: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write .
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.27.0: documents and their outlines"
git push -u origin <branch>
gh pr create --base main --title "A document, its outline, and editing it"
```

The pull request body says what changed for a person, names the thirteen requirements cited and
STR-061 as the one claim added, says plainly that STR-057, STR-034, STR-036 and STR-037 are claimed
by the design and built by nobody yet, and carries this line on its own so merging closes the
requirement's issue:

```
Fixes #120
```

Then fill the changelog heading's `YYYY-MM-DD (PR #n)` and the plans index's `Built (PR #n)` with the
date and the number `gh pr create` printed, commit, push, and after the merge check that #120 closed.

---

## Trying it by hand

After task 6, with Docker running, the whole system in containers - its `setup` container runs
`pnpm dev:setup`, which migrates to 0016:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

On a development database from before 0.27.0, nothing you had changes: 0016 only widens three checks.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation` and choose
   **Ada**. **Documents** beside **Components** offers **New document**, with **Where** showing
   **General** alone.
2. Type `The dosing report` in **Title**, leave **Language** at `en-GB` and **Direction** at **Left
   to right**, and press **Create**. The page opens it: **The dosing report**, **Version 0.1 in
   General**, and **This document has no sections yet.**
3. Press **Add section**, type `Introduction`, and press `Enter`: the tree shows **Introduction**, and
   the page says **Version 0.2**. Add **Method** and **Results** the same way - `0.3`, `0.4`.
4. Select **Introduction** and press `Alt+Down`, then `Alt+Right`: it moves under **Method**, and the
   page says **Moved Introduction under Method.** Press `Ctrl+Z`: it goes back, in one step.
5. Press **Add component** under **Method** and choose **Install the printer**: the tree shows it,
   with **latest**. Add it again under **Results**: the same component, twice, each its own row.
6. Select **Results** and tick **Starts on a new page**. Nothing in the page looks different, because
   nothing publishes yet - the declaration is on the node, which is what STR-049 is about.
7. In a second private window, sign in as **Grace** and open the same document. As Ada, rename
   **Method**. Then, as Grace, move something: **Somebody else changed this document. This is how it
   stands now.**, and the tree redraws as Ada left it. Grace's undo is gone, deliberately.
8. As Ada, open **Manage access** on a component and give **Alice** **Reader** on **General**. Sign
   in as Alice: she sees the document and its outline, and every act in the panel is refused with
   **You may not change this document.**

### What a person can see, and what only a test proves

| Claim                                                                            | Seen by hand                          | Proven only by a test                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| A document in exactly one space, with its own title and identity (STR-061)       | Steps 1, 2                            | The `artifact` row's kind and space, and another environment's: route tests     |
| An empty outline is a document, not an error (STR-054)                           | Step 2                                | Created, read and listed with no nodes: `document-routes.test.ts`               |
| A move takes its subtree and is one undo (STR-008)                               | Step 4                                | The one operation sent names the node, not the subtree: `DocumentPage.test.tsx` |
| One component referenced twice, each occurrence its own node (STR-010)           | Step 5                                | Each carries its own switches: `operations.test.ts`                             |
| A page break on the node and nowhere in the content (STR-048, STR-049)           | Step 6, in the panel                  | The content model refuses one: `outline.test.ts`                                |
| A conflicting act refused against the current outline, and no lock (STR-059)     | Step 7                                | The chain holds two versions, and `component_lock` refuses a document           |
| A section is not shareable, and has no identity to share it by (STR-004)         |                                       | No `artifact` row, and no route returns one: `document-routes.test.ts`          |
| Nine levels, and every invariant after any sequence of operations (STR-003, 007) |                                       | `operations.test.ts`                                                            |
| Two mark orders, one digest                                                      |                                       | `outline.test.ts` and `documents.test.ts`                                       |
| 0016 on a fresh environment and on one provisioned before it                     | A fresh `docker compose up`           | `document-migration.test.ts`                                                    |
| Read but not create, read but not edit, and another environment's                | Step 8                                | `document-routes.test.ts`, `cross-tenant.test.ts`, `access-routes.test.ts`      |
| The desktop app                                                                  | `pnpm app`, which loads the same page |                                                                                 |

Steps 1 to 8 were **not** done in a browser before this plan was committed; the renderer was not
built. Everything below the renderer was run on the wire, and the table above says which test stands
in for each.

**As built, four of these steps read differently**, and [`docs/development.md`](../development.md)
carries them as they now are. **Add section** and **Add component** insert after the selected node,
not under it, and `Alt+Right` then nests one (steps 3 and 5). One `Ctrl+Z` takes back one act, so
step 4's two moves take two. A page break is **Starts on**, a three-way select, and it shows in the
node's row (step 6). A reader is offered no controls at all and is told she may read and not change
the document; **You may not change this document.** is what an editor sees when a grant is withdrawn
under them (step 8). Step 7 needs the person whose act is refused to have acted first, or there is no
undo to lose. None of them has been done in a browser either.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Numbering** - `number(outline, contributions, scheme)`, the counter stack, `restartAt`, matters
  and appendices, the numbering table, the product's default scheme, `GET /v1/documents/{id}/numbering`
  and `/contributions`, and the panel showing numbers as they will publish (STR-013 to STR-023,
  STR-031, STR-036, STR-051). Decision A. **Structure 2, numbering.**
- **Captions and cross-references** - a caption's label and number, the target union, resolution
  against the numbering table, occurrence-local references, and the named failures (STR-024,
  STR-026 to STR-032, STR-055, STR-056). They need the numbering table and the content-model change
  below. **Structure 2**, after the content model.
- **The two content-model holes** (decision E, finding 10), which are free now and a migration later:
  `crossReferenceNodeSchema`'s bare `target: z.string()` needs a structured target with an optional
  occurrence, an `id` of its own, and a member for STR-055's alternative; and
  `parseContentDocument`'s uniqueness walk does not descend into footnote content, so a duplicate
  block identifier inside a footnote is stored today. Both are bug-shaped and should be filed as
  issues. **A small content-model change, before structure 2.**
- **The contents panel, generated lists and deep links** - `contents(numbering, depth)`,
  `listOf(numbering, sequence)`, the panel showing numbers and tracking the reader, a node's URL, and
  STR-039's budget with the number issue #119 asks for (STR-034 to STR-046). Decisions I and J.
  **Structure 3, navigation.**
- **The cycle check** (STR-057, REU-044): a reachability walk over relationships.md's reference index,
  which nothing builds. Decision D. **The relationships plan.**
- **A section's field values validated against anything** (STR-060): which schemas apply at section
  level is TPL-054's. Finding 9. **TPL's plan.**
- **A caption style** (issue #118, STR-025): STY-003's six catalogues have no caption style, so
  nothing can say whether a figure caption sits above or below its figure. **STY's plan.**
- **Resolving `approved`** (decision G) and revisions. **The revisions plan.**
- **Instantiating a document from a template** - a document owning its outline afterwards, what a
  template lets an author change, and a missing required section (TPL-027, TPL-015, TPL-030). **TPL's
  plan.**
- **A page break reaching an output format without error** (STR-050). **PUB's plan**, with
  word-output.md's.
- **The accessibility suite** (STR-006, CNT-078, CNT-139): the panel's keymap is built and its
  announcements and focus handling are not held by anything, because there is no browser suite.
  **No release claims STR-006 without it.** **The accessibility plan.**
- **`Idempotency-Key` on creating a document and on an outline operation** (API-008): a create
  retried after its answer was lost makes a second document, and an operation retried after a lost
  answer is refused by its own precondition, which is the better half of the same gap. **Service
  foundations' idempotency work.**
- **Paging `GET /v1/documents`**, which lists everything readable in one answer as
  `listReadableComponents` deliberately does not. Correct today and linear in the number of documents.
  **Whichever plan gives an environment many documents.**
- **Deleting a document**, including one made by mistake (LIF-019, LIF-021). **LIF's plan.**
- **Retiring `packages/domain/src/content/outline.ts`**, the spike's flat `OutlineSection`, which the
  OOXML reader and writer still use as a type (decision 1). It goes with the rest of the spike model.
  **Whichever plan retires `content/document.ts`.**

Found while writing this plan, and left rather than widened into it:

- **`seedDevelopmentContent` grants Ada Author on _General_ and nothing else**, so a test that wants
  the "may read, may not create" case has to grant her Administrator itself. Editor 2's plan text says
  Ada "administers the environment" in that file's fixture; the seed is what makes that true only
  after `pnpm dev:setup` invites her, and a service test that calls the seed alone does not get it.
  Worth a sentence in `docs/development.md` rather than a change. **Whichever plan next touches the
  seed.**
- **`ComponentParams` is still a bare `z.uuid()` while every space, iteration and now document
  parameter is a `LowercaseUuid`**, which editor 2 recorded and nothing has picked up. An uppercase
  UUID is a `400` on a document's route and a `404` on a component's. **Whichever plan next touches
  the component routes.**
- **`apps/service` has three hand-rolled copies of the lowercase-UUID regex** and `packages/db` four,
  because neither can import the contract's `LowercaseUuid`. This plan set out to add none, by taking
  the spelling from `@alloy-works/domain`'s schema in the domain and from the contract at the door.
  **As built it adds two**: `LOWERCASE_UUID` in `packages/domain/src/structure/outline.ts`,
  deliberately, because the domain may not depend on the contract, and `UUID` in
  `packages/db/src/documents.ts`, which `createDocument` uses to refuse a malformed space id as
  `space.missing` rather than a raised `22P02` - so `packages/db` now holds five. **Whichever plan
  gives the database package its own id type**, which could take the domain's.

Found while building this plan, and by reviewing each task, and left rather than widened into it:

- **A removal cannot be undone.** Decision 6 says the inverse of an operation is another operation,
  and for a removal it is not: the inverse would insert the whole subtree under the identifiers it
  had, and an insert takes one node and allocates a fresh identifier, which STR-003 forbids reusing.
  The panel asks first, says it cannot be undone, and empties the undo stack when one is recorded
  (structure.md, "Editing the outline"). The subtree is still in every earlier version. Getting it
  back from there is a restore, which storage-and-versioning.md designs and nothing builds.
  **Whichever plan builds restore.**
- **A page-break change, an add or a remove made while another act is in flight is ignored**, with the
  tree's `aria-busy` the only sign; only a retitle is held and sent after. Whether an author ever meets
  it, and whether a sentence should say so, is for a browser to show. **The accessibility plan**, with
  the browser suite.
- **Two things only a browser can show**: that `Alt+Left`, which is Back in Chromium on Windows and
  Linux, is taken by the tree rather than leaving the page, and that dragging and dropping a row works.
  Both are exercised with synthetic events in jsdom and neither has been done in a browser; the gaps a
  row is dropped before are unstyled. `docs/development.md` asks for both by hand. **The accessibility
  plan**, with the browser suite.
- **The page's stale-act guard has no test.** `DocumentPage` refuses to send an act computed against
  an outline older than the one it last received; the window it closes lies between an answer's
  `finally` and the next render, which jsdom cannot reach, and removing the guard leaves every test
  green. It is kept as a belt over the `busy` checks and rests on reading the code. **The accessibility
  plan's browser suite**, or never, if nothing can reach it.
- **A section title holding a mark or anything but text** shows in a disabled field with a sentence
  saying why, so the plain-text retitle of decision B never drops formatting. Nothing authors such a
  title yet. **The plan that mounts the title editor.**
- **Nothing changes a document's own title, base language or base direction** once it is made: the
  five operations are over nodes, and the root's three members are written only by creating. **The
  plan that gives a document a header**, as editor 2 gave a component one.
- **`GET /v1/documents/{id}` resolves no component version for a reference**: it answers each node as
  stored, naming its component and its mode, and the panel names a reference by the component's title
  from `GET /v1/components`. structure.md's route table says it answers each occurrence's resolved
  version. **Structure 2**, whose `resolve` stage is where that answer comes from.
- **Nothing observes 0016's restored deferral.** 0016 sets `artifact_version_component_type_recorded`
  immediate and back to deferred; nothing runs after it in the same transaction yet, so no test sees
  the second half, and the SQL is its only evidence. **Whichever plan writes 0017**, whose fresh-path
  test is the first place it can show.
- **`set`'s patch is cast** (`{ ...node, ...patch } as OutlineNode` in `operations.ts`), relying on the
  check above it that only a reference takes a `mode`, and on the parse every result goes through,
  rather than on the type system. **Whichever plan next adds a switch.**
- **Signed out, the documents list, the document page and New document offer no Try again**, since
  trying again cannot work until the person signs in; **New component** still offers one. A deliberate
  divergence, and the two should agree. **Whichever plan next touches New component.**
