# Structure 2: numbering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document is numbered. The outline panel shows every section its number - `1`, `2.1`,
`A.1` - computed from the outline the page holds, so a move renumbers it before anybody asks the
service anything; an author can take a node out of the numbering and make a top-level node an
appendix. Behind the panel, `GET /v1/documents/{id}/numbering` answers the whole numbering table -
sections, figures, tables, equations and footnotes, each entry naming the node, the block and the
counters that produced it - as the caller is shown it: a reader who may not read a component is never
answered from its content, and every number it could have moved is withheld rather than guessed.

**Architecture:** `packages/domain/src/structure/` gains three modules. `scheme.ts` holds the scheme's
schema, the product's default scheme and the counter formats; `contributions.ts` projects a
component's content to what it contributes - each caption-bearing block and footnote, in document
order; `numbering.ts` holds the first three stages of structure.md's pipeline - `resolve`,
`conditions` (the identity until REU) and `number` - and `sectionNumbers`. `packages/db` gains
`numberingInputs`, which resolves each occurrence to a component version in two queries and projects
the content of those the principal may read. `packages/api-contract` and `apps/service` gain
`GET /v1/documents/{id}/numbering`. `apps/web`'s outline panel calls the same `number` over the
outline it renders, shows each section number as the tree item's description, and gains **Numbered**
and **Appendix** boxes that send the `set` operation structure 1 built. **Nothing is stored**: no
migration, no column, no cache.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`),
Fastify 5, Vitest 5 with jsdom for the renderer. No new dependency and no migration.

**Spec:** [`../design/structure.md`](../design/structure.md) ("Numbering", "Captions", "Who is shown
what", "Routes", "Where the code lives" and "Verification"), as task 6 amends it; read with
[access.md](../design/access.md) ("Deciding", "Refusing"), [content-model.md](../design/content-model.md)
("Identity", the caption-bearing blocks), [service-foundations.md](../design/service-foundations.md),
[the first structure plan](2026-09-18-structure-01-the-document-and-its-outline.md), whose "What this
plan deliberately leaves undone" is where this one starts, and
[the third content-model plan](2026-09-18-content-model-03-footnotes-and-cross-references.md), which
built the cross-reference this plan does not yet resolve.

Second of the structure plans. It builds numbering and captions and nothing that resolves a
cross-reference (decision A), and names every later plan in
[What this plan deliberately leaves undone](#what-this-plan-deliberately-leaves-undone).

**The code below was run before the plan was committed.** It was written in a throwaway worktree
from `origin/main` at 0.27.1 (commit `6c5d020`), at a short path, against a scratch Postgres
container of its own on port 55442 - never the shared development database on 5432, and no running
container was stopped or restarted. There:

- **The numbering function numbered a realistic outline.** Restarts at three depths and none; two
  appendices between body chapters, the body resuming after them; excluded nodes at the top level
  and below; one component placed twice; a sequence the scheme adds; footnotes in a section title and
  in two occurrences of one component; nine levels; and two hundred generated outlines mixing every
  switch, each giving exactly one section number per node whose every ancestor is numbered. The
  domain's structure suites passed **61 of 61** and `tsc --noEmit` was clean, with a probe that a
  `Resolved` handed to `number` does not typecheck (STR-051's order).
- **Contributions were obtained, and costed.** A document of **330 nodes - thirty chapters holding
  300 occurrences of 150 distinct components of 40 blocks each** - was resolved, read and numbered,
  `numberingInputs` and `number` together, fifteen times: **median 19.6 ms, worst 25.5 ms**, for 5,430
  entries, including the two queries and `readContent`'s parse of 150 contents. No cache is needed
  at this size (decision B), and none is built.
- **The route's permission answers were measured.** Grace, who may read both components, was answered
  every figure: `Figure 1.1` to `Figure 1.5`. Alice, a Reader on _General_, and Ada, an Author there,
  neither of whom may read _Quality_, were each answered the same section numbers, the first
  occurrence's figures, `null` for the three figures after the component they may not read, and
  `version: null` for its occurrence - and neither answer contained that component's identifier, its
  version or its block. An unknown id, a component's id and an uppercase id answered `404`, `404` and
  `400`; no session, `401`. `cross-tenant.test.ts` and `access-routes.test.ts` failed with
  `OTHER_TENANT_IDS[route.operationId] is not a function` and `getNumbering has no address in
HOLDING_NOTHING` until each had its entry, then passed 56 and 15.
- **The store's reads were probed.** A pinned version of another component, recorded by hand past the
  write-time check, was not read; neither was another environment's component named in an outline;
  and an `approved` reference resolved to nothing though the same component's head had been read for
  another occurrence.
- **The renderer was built.** The documents page suite passed **64 of 64**, the four new tests among
  them and every existing one unchanged, because the number is the tree item's description rather
  than part of its name (decision G); the whole `apps/web` suite passed 354 and `tsc` was clean.
- **The trace, simulated.** With the ten cited titles in place, `pnpm trace check` reported no
  problems and the regenerated model held **173 citations**, 1367 requirements and 360 claims.
- **The suites.** `packages/api-contract` failed its `openapi.json` drift check until regenerated,
  then passed 25 of 25; `packages/domain`'s surface test failed until the ten new exports were added
  to it (task 2 says so), and the rest of its 534 passed; against the scratch container the whole
  `packages/db` suite passed **285 of 285** and `apps/service` **246 of 246**, the three new files
  among them.

Then the scratch container and the throwaway worktree were removed.

**What was not run.** The measurement is not a committed test: a timing in a unit suite is a flake
waiting for a slow runner, and the budget it would be held to is issue #119's, which is not in the
corpus. The panel was not seen in a browser. `pnpm lint`, `pnpm format`, `pnpm trace verify` and
`pnpm trace gate` were not run, the last two because the worker's and the object store's suites were
not.

## The slice, and why it is one plan and not the cross-references too

Structure 1 named two things for "structure 2": numbering, and captions and cross-references. **This
plan builds numbering and captions, and leaves resolving a cross-reference to a plan of its own**
(decision A).

**Captions belong here because a caption's number is numbering's output.** STR-023 is "every
caption-bearing block numbered in the sequence for its kind"; STR-024's label is a member of the
scheme; the caption's text is the component's and never moves. There is nothing to build for a
caption that `number` does not already do, so it is not a slice of its own.

**Resolution is small in code and not small in design, and nothing would call it.** Given the
numbering table, `references` is a lookup - perhaps 120 lines. What it has to decide is not:

- **What a reader is shown of a target in a component they may not read.** A `component` target's
  identifier sits in the readable holder's content. Resolving it answers whether that component is in
  this document and at which occurrence - which the outline view withholds - and its `title` form is
  another component's caption text. The third content-model plan's decision A named this as the
  resolver's to settle; it is an access question as sharp as decision C below, and it deserves its own
  review.
- **What a block's `title` is.** A figure's caption text; a table's; an equation has none. A form
  chosen with nothing that renders it is a guess.
- **Nothing calls it.** Nothing authors a cross-reference (the editor writes paragraphs), nothing
  renders one (there is no document view) and nothing publishes. Numbering has two callers in this
  slice - the panel and the route; resolution would have none.
- **The union is not finished.** A component cannot reference a section - the most common
  cross-reference there is - until the target gains an arm for "the heading of the node that places
  this component", which the content-model plan left to "structure 2 or the plan that first authors a
  cross-reference". Resolving the union before it is widened would be done twice.

So resolution waits for its first consumer, as **structure 4, cross-references**, planned beside the
editor slice that first authors or renders one. **Structure 3, navigation**, keeps its place: the
contents panel, `listOf` and deep links read the numbering table this plan builds and have visible
callers today.

**The product stays usable and honest.** After this plan an author sees section numbers that
`number` computes, from the one scheme anything numbers against, and the route answers the same
table the publisher will read. Nothing shows a number it could not compute: a reader's withheld
numbers are `null`, not guessed; the panel shows section numbers alone, because only those need
nothing but the outline. Decision F argues this against STR-036 and STR-031.

## Where structure.md and the built code are wrong, missing or contradicted, most serious first

Planning and running the code against structure.md found these. Task 6 amends the design for what
this plan builds and records the rest as raised.

1. **STR-031's cache key misses the component versions.** structure.md: the table "is keyed in memory
   by the document's version digest, the scheme's version and the profile". A reference at `latest`
   resolves to its component's head, and a new component version changes the figure numbers without
   changing the document's digest - so a cache keyed so would serve a stale number, which STR-031
   forbids. **Built:** nothing is cached (decision B), and every answer names each occurrence's
   resolved version; the design's row says a cache, when one is needed, is keyed by the document
   version, every occurrence's resolved component version, the scheme and the profile.
2. **"Who is shown what" is silent on numbers.** It withholds a component's identity from a reader
   who may not read it; a number leaks past that. If everybody is shown the same numbers, a gap -
   `Figure 2.1`, then `Figure 2.4` - tells a reader how many figures a component they may not read
   holds, and watching the gap tells them when it is edited. **Built** (decision C): the service never
   reads such a component, `number` treats its occurrence as not known, and every counter in its
   matter is unknown from there until it next restarts - whether or not the occurrence holds anything,
   so which numbers go missing says nothing about what it contains.
3. **`number` has two signatures.** "Numbering" gives `number(outline, contributions, scheme)`; the
   pipeline gives `number(resolved, scheme)`. **Built:** the pipeline's. `resolve(outline,
contributions)` makes a `Resolved` carrying contributions keyed by **occurrence**, never by
   component, and an occurrence absent from the map is one nobody here knows; `conditions` makes a
   `Conditioned`; `number` takes that. Each stage is a distinct type, so STR-051's order is a compile
   error when broken.
4. **The panel has no component's content open, and needs none.** structure.md says contributions are
   "computed in the domain from the content the renderer already has open and answered by the
   service for components it does not" - the documents page has none open. It turns out not to
   matter: **no section number depends on what an occurrence contributes**, which a test holds, so the
   panel numbers sections from the outline alone. The design's `GET /v1/documents/{id}/contributions`
   is not needed in this slice, and is left for whichever plan first shows a caption's number in the
   renderer (decision H).
5. **The design is silent on what lies beneath an unnumbered node.** STR-017 excludes a node; its
   children's numbers, and whether its figures restart anything, are unsaid. **Built** (decision D):
   a section number exists only where the node and every ancestor are numbered; what an unnumbered
   node holds carries on the counters of the numbered node before it and restarts nothing.
6. **"Switches every sequence to its appendix rule and restarts it" is ambiguous** with two appendices
   (does the second restart the section counter?) and with a body chapter after an appendix (does it
   restart at 1?). **Built:** each matter keeps its own counter stack. The first appendix is `A`, the
   second `B`, and a body chapter after them carries on the body's numbering.
7. **One `format` per rule cannot write `A.1`.** An appendix's top-level part is alphabetic and the
   parts beneath it decimal. **Built:** `format` is a list, one per part from the top, the last
   repeating; a caption's prefix is written with the section rule's formats. The scheme is not stored,
   so this costs nothing (the stored-shape check).
8. **A section title's footnotes are numbered.** A title is inline content and may hold a footnote;
   the design never says where it counts. **Built:** at its node, before anything the node holds.
9. **A reference node takes a section number.** The design implies it - a `node` target reaches "a
   component reference's own heading" - and "Numbering" never says it. **Built**, and said.
10. **An `approved` reference makes every later number in its scope unknown, for everybody**, until
    revisions exist: it resolves to nothing, so what it contributes cannot be known. Section numbers
    are untouched. **Built**, and said.
11. **The table's entry is reshaped.** The design's `rule` member copies a rule into every entry;
    the rule is named instead, by the table's `scheme` and the entry's `sequence` and `matter`. The
    entry gains `matter`, `value` (this sequence's counter), `restartedAt` (the node whose entry last
    restarted it) and `number` beside `label`. STR-022 is answered by what the entry names.
12. **The route table puts each occurrence's resolved version on `GET /v1/documents/{id}`.** Built on
    the numbering route instead, beside the numbers it produced; the document route is unchanged.
13. **Every figure and every table is numbered, an empty caption included.** STR-023 says every
    caption-bearing block is numbered, and only a block equation carries `numbered` (CNT-047). A table
    used for layout would be `Table 3`. Built as STR-023 says; decision I recommends a requirement.

## Decisions for Ken

Each is a choice this plan makes provisionally so that it can be built, with a recommendation.
Reject one and the plan changes where the decision says.

- **A. Numbering and captions are this plan; resolving a cross-reference is not.** Argued in
  [the slice](#the-slice-and-why-it-is-one-plan-and-not-the-cross-references-too). Recommended:
  accept, and plan resolution as structure 4 beside the first editor slice that authors or renders a
  cross-reference. **Otherwise (i)**: fold it in - two more tasks (`references(conditioned,
numbering)` in the domain, failures on the numbering route), the citations of STR-028, STR-032,
  STR-056 and STR-062, and a decision on what a reader is shown of a target they may not read, made
  with nothing that renders one. **Otherwise (ii)**: resolution next, before navigation.
- **B. Numbering is computed when it is asked for, and nothing stores or caches it.** The service
  resolves and reads each occurrence per request - two queries whatever the outline's size, each
  version read and parsed once however often it is placed - and the panel numbers sections on every
  render. Measured: 19.6 ms median for 330 nodes and 300 occurrences of 150 components. Recommended:
  accept. **Otherwise (i)**: a `contributions` column on `artifact_version`, written at insert - a
  derived cache, rebuildable from content, but a migration of an insert-only table and a projection
  every write path must compute, so a change to `contributionsOf` would mean rewriting every row.
  **Otherwise (ii)**: an in-memory cache, keyed per finding 1 - worth it only once a measurement says
  so, and every key it forgets is STR-031's stale number.
- **C. A reader is never numbered from a component they may not read, and is shown no number it could
  have moved.** Its content is not read; its occurrence answers `version: null`; every counter in its
  matter is unknown until that counter next restarts, whatever it holds; section numbers are all
  shown. Everybody who is shown a number is shown the same one. Recommended: accept. **Otherwise
  (i)**: everybody numbered from everything, the unreadable occurrence's own entries omitted - simple,
  and a gap tells the reader how many figures, tables, equations and footnotes the component holds,
  and when that changes. **Otherwise (ii)**: number each reader over what they may read - no leak, and
  their `Figure 4` is not the publication's, which is STR-036 false for them and two people disagreeing
  about which figure is which.
- **D. An unnumbered node takes nothing, and neither does anything beneath it; what it holds carries
  on the counters before it.** A preface's sub-sections are unnumbered; a figure in an unnumbered
  interlude after chapter 2 is `Figure 2.4`, continuing chapter 2's; one in a preface before any
  chapter is `Figure 1`, with no prefix to give it. Recommended: accept - no number is formed from an
  ancestor that has none, and no two figures share a label. **Otherwise (i)**: children of an
  unnumbered node number as LaTeX's do (`0.1` before chapter 1, `2.1` after chapter 2, colliding with
  2.1's own). **Otherwise (ii)**: an unnumbered node's captions go unnumbered too - which STR-023's
  "every caption-bearing block" forbids.
- **E. The default scheme** (design decision E): decimal sections; figures and tables prefixed with
  their chapter and restarting with it (`Figure 2.4`); equations continuous (`Equation 7`); footnotes
  continuous; appendices `A`, `B`, their sections `A.1`, their figures `Figure A.1` and equations
  `Equation A.1`, each restarting per appendix. Each matter keeps its own counters, so a body chapter
  after an appendix carries on the body's numbering (finding 6), and appendix footnotes start at 1.
  A section's label is empty - the panel shows `2.1`, not `Section 2.1`. Recommended: accept; it is
  a value in code, and PUB replaces it with the layout's.
- **F. Section numbers are shown in the outline panel, and nothing else is.** The panel calls the same
  `number` the route does, over the outline it renders, with the default scheme. **Against STR-036**:
  structure 1's decision A kept numbers out because "a panel showing numbers the publisher cannot yet
  print makes STR-036 false". That was true when there was no function and no scheme. Now the panel's
  numbers are exactly what `number` gives, a section number depends on the outline and the scheme
  alone, and until a layout exists the default scheme is the only one any document can be numbered
  with - so nothing the panel shows can differ from what the publisher will print, unless PUB brings a
  layout scheme and does not bring it to the panel, which task 6 records as PUB's obligation. STR-036
  is **still not cited**: no publisher exists to show "as it will publish", and decision J of
  structure 1 cites STR-034, STR-036 and STR-037 together once the panel is a table of contents.
  **Against STR-031**: the numbers are recomputed from the outline every render, so there is no number
  to fall behind; caption numbers, which a component's new version can move, are not shown in the
  panel at all. Recommended: accept. **Otherwise (i)**: no numbers in the panel - the route alone, and
  nothing an author can see. **Otherwise (ii)**: the panel also lists figures and tables - `listOf`,
  STR-041, structure 3's.
- **G. The panel gains a Numbered box and, at the top level, an Appendix box, and shows a number as
  the item's description rather than its name.** Both boxes send the `set` operation structure 1
  built, so there is no new write path; without them exclusion and appendices exist only through the
  API. The number is `aria-describedby`, not part of the name, because a tree's type-to-find matches a
  name's first characters - `2.1 Method` would make typing `M` find nothing - and every announcement
  names a node by its title, which a move does not change. Recommended: accept. **Otherwise**: the
  number in the name, `1 Introduction`, and 74 tests renamed.
- **H. One route, `GET /v1/documents/{id}/numbering`, answering the latest version; no
  `/contributions` route.** Its answer: the document, the version numbered, the scheme's id, each
  occurrence with the version it resolved to (or `null`), and the table's entries. Recommended:
  accept. **Otherwise**: a `version` query to number an earlier version (nothing needs one before
  baselines); the contributions route (nothing in the renderer shows a caption's number yet).
- **I. Every figure and table is numbered, as STR-023 says** (finding 13). Recommended: accept, and
  file a requirement - see [Requirements to file](#requirements-to-file-not-filed-here).
- **J. The release is 0.28.0**, a functional enhancement: an author can see and change numbering.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. A test cites a requirement only when its own body
  demonstrates that requirement's own statement (`pnpm trace show <ID>`) and structure.md claims it in
  full. [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the whole
  list; every other title carries no identifier.
- **`packages/domain` stays platform-free.** The scheme, the projection and the pipeline go in it; none
  takes a clock, randomness or `fs`.
- **A passing run has no errors or warnings**, through the renderer's console gate too.
- **The renderer's tests render under `<StrictMode>`** (the house `open` helper already does), and
  nothing reconciles a field by counting renders. The panel's numbers are a `useMemo` over the outline.
- **Refusals.** A document that is missing, another environment's, a component's id, or one the
  caller may not read answers `404`, never `403`. Ids in paths are lowercase uuids (`DocumentParams`
  is already `LowercaseUuid`). This plan adds no wire code.
- **Every read path has a cross-tenant test** (IAM-004): `numberingInputs` in its own file's tests,
  the route in `cross-tenant.test.ts` and `access-routes.test.ts`. They do not cite IAM-004.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`).
- **No em or en dashes in user-facing text** - the renderer's strings (`apps/web/src/dashes.test.ts`),
  route summaries and descriptions, and the changelog. Code comments are exempt.
- **No raw control characters in source**, and no real data: `Ada`, `Grace`, `Alice`, `Ivy`;
  **The dosing report**, **Introduction**, **Method**, **Results**, **Install the printer**,
  **Calibration**; `example.com`, `alloy.test` and `idp.example` hosts.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>`.
- **`trace.json` is drift-checked and its line numbers move with every test edit.** Each task that
  touches a test file runs `pnpm --filter @alloy-works/trace generate` and commits the result. The
  citation pin in `packages/trace/src/trace.test.ts` moves in task 2 alone, **163 to 173**; claims
  stay **360** and requirements **1367**. Read on `origin/main` at `6c5d020`; if main has moved, set
  each to what the regenerated file holds and say so in the comment.
- **A filtered run does not build what it imports.** After changing `packages/domain`, `packages/db`,
  `packages/api-contract` or `packages/api-client`, build it (or `pnpm build`) before a filtered run of
  anything importing it.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store
  too.** `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`, or a scratch
  container pointed at by `ALLOY_TEST_DATABASE_URL`. Never `pnpm dev:setup` against the shared
  development database, and never stop or restart a running container. **Never run the e2e suite**:
  use the root `pnpm test`, not `turbo run test` unfiltered.
- **Paths.** Run from a checkout at a short path; a worktree under the temporary directory can pass
  Windows' path limit starting `esbuild`.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump (0.28.0) and one changelog entry**, in task 6, headed
  `## 0.28.0 - YYYY-MM-DD (PR #n)` and filled with the date and the number once the pull request
  exists - `apps/desktop/src/version.test.ts` fails on a heading without both. Never commit to `main`.

---

## The stored-shape check

**This plan stores nothing.** No migration, no column, no table, no cache, and no new write path:
the numbering table is computed when it is asked for, a contribution is derived from a version's
content when it is read, and the scheme is a value in code. Nothing it produces can be found already
written by a later rule, which is the failure this check exists for.

What it does do is **read, for the first time, members structure 1 stored and nothing read** -
`numbered`, `matter` and an `approved` mode - and **write two of them from the panel** through the
existing `set`. So the check here is the other way round: that every value the store already accepts
is one numbering answers, without throwing and without a guess.

| #   | Member or value                                                                    | Stored?                                                | Validated on every write path by                                                                                                                                                         | What numbering does with every value the store accepts                                                                                                                                          | Recursion                                                                                                                                                                                                                       | Points at, and who checks                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The numbering table                                                                | **No.** Computed per request and per render            | Its type; the route's `NumberingView`                                                                                                                                                    | -                                                                                                                                                                                               | The walk is bounded by the outline parse's 64 levels (`MAXIMUM_OUTLINE_DEPTH`)                                                                                                                                                  | Entries name nodes of the outline numbered and blocks of content read in the same request                                                                           |
| 2   | A contribution                                                                     | **No.** Derived from a version's content at every read | `contributionsOf` reads only what `readContent` returned: content already through `parseContentDocument`                                                                                 | -                                                                                                                                                                                               | **Bounded by the parse before it.** A block tree's depth is bounded only in admission (issue #125); content deeper than the stack fails `readContent`, and its occurrence is simply not known - never a crash in the projection | A block or footnote identifier, unique in its component (CNT-002)                                                                                                   |
| 3   | The scheme                                                                         | **No.** A value in code, `defaultNumberingScheme`      | `numberingSchemeSchema`, at module load: the five sequences present; a section rule neither restarts nor takes a prefix; depths 1 to 64                                                  | -                                                                                                                                                                                               | None                                                                                                                                                                                                                            | Nothing. **Every rule on it is free to change**, which is why finding 7 costs nothing. The day PUB stores one on a layout version, that plan owes this check for it |
| 4   | A node's `numbered`                                                                | Yes, since 0.27.0, at outline schema version 1         | `outlineNodeSchema`, a boolean, on the wire body, the operation's result, `recordVersion`'s `prepare` and every read. **Newly written from the panel**, through `set` - an existing path | Both values, at every depth, on both arms. `false` takes no number and consumes none; beneath it nothing takes one (decision D)                                                                 | -                                                                                                                                                                                                                               | Nothing                                                                                                                                                             |
| 5   | A node's `matter`                                                                  | Yes                                                    | `parseOutlineDocument` refuses `appendix` below the top level, which covers insert, move and set. **Newly written from the panel** through `set`, top-level nodes only                   | An appendix anywhere at the top level: first, last, between body chapters, every node an appendix, an unnumbered appendix. Each matter has its own counters, so every order answers (finding 6) | -                                                                                                                                                                                                                               | Nothing                                                                                                                                                             |
| 6   | A reference's `mode`                                                               | Yes                                                    | `referenceModeSchema`; a `pinned` version must belong to the component, checked by `editOutline` in the store                                                                            | `latest`: the component's head. `pinned`: that version, **checked again at the read** - one of another artifact is not read. `approved`: not known, for everybody (finding 10)                  | -                                                                                                                                                                                                                               | A component the author could read at the write. Readability is decided again at every read, for the reader                                                          |
| 7   | A section title's footnotes                                                        | Yes                                                    | `sectionTitleSchema`, which runs `checkInlineContent`                                                                                                                                    | Each takes the next footnote number at its node (finding 8). A footnote holds no footnote, so there is nothing below it to count                                                                | One footnote deep, by `checkInlineContent`                                                                                                                                                                                      | Its own identifier, unique within the title                                                                                                                         |
| 8   | A component's caption-bearing blocks (`figure`, `table`, `equation`) and footnotes | Yes, since content schema version 1                    | `parseContentDocument` on every write path and at read-back through `readContent`                                                                                                        | Every one, wherever nested - list item, blockquote, table cell, a table's note. A block equation's `numbered: false` takes nothing (CNT-047). An empty caption is still numbered (finding 13)   | Bounded by the parse, as row 2                                                                                                                                                                                                  | -                                                                                                                                                                   |

**Nothing this check found needs changing before anything is stored**, because nothing is. Row 2's
dependence on issue #125 is the one thing a later fix improves: until a block tree's depth is bounded
on every write path, a component deep enough to overflow the parse is one numbering cannot count - it
is withheld like any occurrence nobody can read, which is honest, and it is the content's hole rather
than numbering's.

## The scope, and why

**Built:** the numbering scheme and the product's default; the projection from content to
contributions; `resolve`, `conditions` and `number`, and `sectionNumbers`; `numberingInputs` in the
store; `GET /v1/documents/{id}/numbering`; and section numbers, **Numbered** and **Appendix** in the
outline panel.

**Left out, each to a named plan:**

| Left out                                                                                          | Why not here                                                                           | Whose                                                        |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Resolving a cross-reference, and its named failures (STR-028, STR-031, STR-032, STR-056, STR-062) | Decision A: a lookup in code and an access decision in design, with nothing to call it | **Structure 4, cross-references**                            |
| A component's reference to a section: a target arm for the heading of the node that places it     | A widening of the union, made with its resolver                                        | **Structure 4**                                              |
| `contents`, `listOf`, the panel as a table of contents, deep links, STR-039's budget              | Structure 1's decision J, and issue #119's number                                      | **Structure 3, navigation**                                  |
| A caption's number shown in the renderer, and `GET /v1/documents/{id}/contributions`              | Decision H: nothing in the renderer shows one until a list of figures does             | **Structure 3**                                              |
| A layout's own scheme (STR-013, PUB-011) and a caption's label from it (STR-024)                  | The default stands in (decision E); PUB has not designed the layout                    | **PUB's plan**, which must bring its scheme to the panel too |
| Condition evaluation (STR-020, STR-042)                                                           | REU's, T4. `conditions` is the identity until then                                     | **REU's plan**                                               |
| Resolving `approved`                                                                              | There is no revision to resolve to; its occurrence is not known (finding 10)           | **The revisions plan**                                       |
| Caption placement (STR-025, issue #118)                                                           | STY's catalogues have no caption style                                                 | **STY's plan**                                               |
| Numbering a baseline (STR-052)                                                                    | Baselines do not exist                                                                 | **The baselines plan**                                       |

## Decisions taken before this plan was written

Each is an open shape the design leaves to the plan. A reviewer should be able to reject each on its
own.

**1. Three modules, not one.** `scheme.ts` (the scheme's schema, the default, formats), `contributions.ts`
(content to contributions) and `numbering.ts` (the pipeline). Each has one reason to change: PUB
changes the first, the content model the second, STR the third.

**2. A stage is a type with a `stage` discriminant.** `Resolved` is `{ stage: 'resolved', ... }` and
`Conditioned` is `{ stage: 'conditioned', resolved }`, so handing `number` a `Resolved` is a type error.
Rejected: a `unique symbol` brand, which is the same guarantee with a declaration nothing at runtime
carries.

**3. `number` reads a node's structure alone** - `type`, `id`, `numbered`, `matter`, a section's
`title`, `children` - through `NumberableNode`, so a stored outline and a reader's view, whose withheld
references carry `component: null`, number alike. It never reads which component a node names.

**4. A contribution's `sequence` is a string, and a sequence the scheme does not declare numbers
nothing.** `contributionsOf` produces the five kinds; a layout that adds a sequence (STR-014) has
something to number the day content can say what contributes to it.

**5. `numberingInputs` reads in two queries**: the head of every readable `latest` component, with
`distinct on`, and every readable `pinned` version, by id - each with its content. Each version is
projected once however many occurrences resolve to it. `readableComponents`, structure 1's one
predicate, decides readability.

**6. The handler copies the domain's read-only answers** into the wire's mutable types
(`occurrences.map`, `entries.map`), as the proof run's typecheck required.

**7. The measurement is recorded here and not committed** as a test (see "What was not run").

---

## Files

| File                                                                                              | Responsibility                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/domain/src/structure/scheme.ts`, `scheme.test.ts`                                       | Task 1: the scheme's schema, the default scheme, `formatCounter` and `formatParts` |
| `packages/domain/src/structure/contributions.ts`, `contributions.test.ts`                         | Task 1: `Contribution`, `contributionsOf`, `inlineContributions`                   |
| `packages/domain/src/structure/numbering.ts`, `numbering.test.ts`                                 | Task 2: `resolve`, `conditions`, `number`, `sectionNumbers`, and the ten citations |
| `packages/domain/src/structure/index.ts`, `src/index.test.ts`                                     | Tasks 1 and 2: the surface, and the test that pins it                              |
| `packages/db/src/numbering.ts`, `numbering.test.ts`, `src/index.ts`                               | Task 3: `numberingInputs`                                                          |
| `packages/api-contract/src/documents.ts`, `openapi.json`                                          | Task 4: `NumberingView` and `getNumbering`; the regenerated document               |
| `packages/api-client/src/generated/schema.ts`                                                     | Task 4: regenerated                                                                |
| `apps/service/src/documents.ts`, `numbering-routes.test.ts`                                       | Task 4: the handler and its tests                                                  |
| `apps/service/src/cross-tenant.test.ts`, `access-routes.test.ts`                                  | Task 4: an entry each                                                              |
| `apps/web/src/structure/OutlinePanel.tsx`, `DocumentPage.tsx`, `DocumentPage.test.tsx`            | Task 5: the numbers, the two boxes, their announcements, and four tests            |
| `packages/trace/trace.json`, `src/trace.test.ts`                                                  | Regenerated in every task; the citation pin moved in task 2                        |
| `docs/design/structure.md`, `docs/architecture.md`, `docs/features.md`, `README.md`               | Task 6                                                                             |
| `docs/development.md`, `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, two `package.json` | Task 6                                                                             |

No migration, no wire code and no new dependency. `packages/editor` does not change.

## How the design's commitments become tests

| The design says                                                                        | Where                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sections, figures, tables and equations each numbered independently; more may be added | Task 2, STR-014                                                                        |
| A sequence restarts at a declared depth                                                | Task 2, STR-015: at depth 1, depth 2 and never                                         |
| Appendices number in their own scheme, with their own restarts                         | Task 2, STR-016                                                                        |
| An excluded node consumes no number                                                    | Task 2, STR-017                                                                        |
| Numbering is deterministic                                                             | Task 2, STR-018: two construction orders, one table                                    |
| One component placed twice is numbered once per occurrence                             | Task 2, STR-021                                                                        |
| Every number traces to what produced it                                                | Task 2, STR-022: the whole entry asserted, counters and restart included               |
| Every caption-bearing block numbered in its kind's sequence                            | Task 2, STR-023, from real content through `contributionsOf`                           |
| Footnotes are numbered over the document, not the component                            | Task 2, CNT-041                                                                        |
| An unnumbered equation consumes no number                                              | Task 2, CNT-047                                                                        |
| Nine levels number                                                                     | Task 2, not cited: STR-007 is cited already                                            |
| Calling `number` before `conditions` does not typecheck (STR-051)                      | Task 2's `number` signature; not cited, because the second half needs `references`     |
| A reader is not shown a component they may not read                                    | Tasks 3 and 4: never read, `version: null`, its numbers-in-scope `null`. Cites nothing |
| The panel shows numbering, and it cannot fall behind the outline (STR-036, STR-031)    | Task 5, not cited: decision F                                                          |
| An empty outline is numbered without an error (STR-054)                                | Task 4, not cited again                                                                |

## Requirements this plan cites, and those it does not

**Ten citations**, all in `packages/domain/src/structure/numbering.test.ts`, taking the pin from 163
to 173 in task 2. **No claim changes** - structure.md already claims all ten - so claims stay 360;
no row is added, so requirements stay 1367.

| ID          | Statement, in short                                                                | Claimed by   | Cited in                                 | Task |
| ----------- | ---------------------------------------------------------------------------------- | ------------ | ---------------------------------------- | ---- |
| **STR-014** | Sections, figures, tables and equations numbered independently; more declarable    | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-015** | A sequence restarts at a declared outline depth                                    | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-016** | Appendices numberable in their own scheme, with their own restarting sub-sequences | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-017** | A node excludable from numbering without consuming a number                        | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-018** | Numbering is deterministic                                                         | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-021** | One component referenced twice, each occurrence numbered independently (T4)        | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-022** | Every number traceable to the node that produced it                                | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **STR-023** | Every caption-bearing block numbered in the sequence for its kind                  | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **CNT-041** | Footnote numbering a property of the outline, not of the component                 | structure.md | `domain/src/structure/numbering.test.ts` | 2    |
| **CNT-047** | A block equation numbered or explicitly unnumbered; unnumbered consumes no number  | structure.md | `domain/src/structure/numbering.test.ts` | 2    |

**STR-014 is the one a reviewer should weigh first.** Its first half - four independent sequences - is
shown plainly: a table between two figures moves no figure's number. Its second half - "the layout
must be able to declare further sequences" - is shown by a scheme declaring a `listing` sequence that
numbers a contribution to it, and by the default numbering the same contribution nothing. No layout
exists, and no content can yet say it contributes to a listing; what the test shows is that a further
sequence is a member of the scheme and not a code change, which is structure.md's answer. **If a
reviewer wants a layout declaring one, the citation should wait** and STR-014 join the near misses.

**STR-021 is T4** and cited in a T1 plan, because the engine that numbers per occurrence is this one
and the test demonstrates the statement. The tranche says when it is due, not when it may be shown.

**Near misses, not cited:**

| ID                                 | Why not                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR-019                            | "Recomputed whenever the outline, the layout or the conditions change": no layout and no conditions exist to change                               |
| STR-031                            | About cross-references resolving afresh; nothing resolves one (decision A)                                                                        |
| STR-036, STR-034, STR-037          | Decision F: the panel is not yet a table of contents, and no publisher exists to show "as it will publish". Structure 3 cites the three together  |
| STR-051                            | Its first half is the stage types; its second, "resolved only over content that has been numbered", needs `references`                            |
| STR-013, STR-024                   | Unclaimed: the declaration and the label are the layout's (PUB-011)                                                                               |
| STR-028, STR-032, STR-056, STR-062 | Resolution: structure 4                                                                                                                           |
| STR-007, STR-010, STR-054          | Nine levels, two occurrences and an empty outline are exercised again; already cited                                                              |
| CNT-081                            | Every caption-bearing block carries a stable identity: content-model.md's, and already built; numbering reads the identity rather than showing it |

### Requirements to file, not filed here

1. **A figure or table that is explicitly unnumbered** (finding 13, decision I). "A figure or a table
   must be numbered or explicitly unnumbered; an unnumbered one must consume no number (**STR**
   owns the sequence)" - CNT-047's rule for equations, extended. As STR-023 stands, a table used for
   layout is `Table 3`. Adding the member is a content schema change best made before anything
   authors a table.
2. **A number must reveal nothing a reader may not read** (decision C). access.md's rule reaches an
   identity; nothing in the corpus says a derived number, count or order is held to the same rule,
   so decision C is a design answer with no row behind it. Likely an IAM row beside the
   "indistinguishable from one that does not exist" rule.

---

## Task 1: The scheme, and what a component contributes

**Files:**

- Create: `packages/domain/src/structure/scheme.ts`, `packages/domain/src/structure/contributions.ts`
- Test: `packages/domain/src/structure/scheme.test.ts`,
  `packages/domain/src/structure/contributions.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: `MAXIMUM_OUTLINE_DEPTH` from `./outline.js`; the types `BlockNode`, `ContentDocument`,
  `InlineNode` from `../content/model/`
- Produces: `numberFormatSchema`, `NumberFormat`, `numberingRuleSchema`, `NumberingRule`,
  `sequenceRulesSchema`, `REQUIRED_SEQUENCES`, `numberingSchemeSchema`, `NumberingScheme`,
  `defaultNumberingScheme`, `formatCounter(value: number, format: NumberFormat): string`,
  `formatParts(parts: readonly number[], rule: NumberingRule): string[]`;
  `Contribution { block: string; sequence: string; numbered: boolean }`,
  `inlineContributions(inlines: readonly InlineNode[]): Contribution[]`,
  `contributionsOf(content: ContentDocument): Contribution[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/structure/scheme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { defaultNumberingScheme, formatCounter, numberingSchemeSchema } from './scheme.js';

describe('a numbering scheme', () => {
  it('holds the product default to its own schema, with the five sequences the engine needs', () => {
    expect(numberingSchemeSchema.parse(defaultNumberingScheme)).toEqual(defaultNumberingScheme);
    expect(Object.keys(defaultNumberingScheme.sequences).sort()).toEqual([
      'equation',
      'figure',
      'footnote',
      'section',
      'table',
    ]);
    const { section } = defaultNumberingScheme.sequences;
    expect(
      numberingSchemeSchema.safeParse({ id: 'sections-only/1', sequences: { section } }).success,
    ).toBe(false);
  });

  it('refuses a section rule that restarts or takes a prefix, since a section number is its stack', () => {
    const section = defaultNumberingScheme.sequences['section']!;
    const restarting = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        section: { ...section, body: { ...section.body, restartAt: 1 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(restarting).success).toBe(false);
  });

  it('writes every counter in every format, past z and past 3999', () => {
    expect([26, 27, 28, 52, 53, 702, 703].map((n) => formatCounter(n, 'lowerAlpha'))).toEqual([
      'z',
      'aa',
      'ab',
      'az',
      'ba',
      'zz',
      'aaa',
    ]);
    expect(formatCounter(28, 'upperAlpha')).toBe('AB');
    expect(formatCounter(1994, 'lowerRoman')).toBe('mcmxciv');
    expect(formatCounter(4, 'upperRoman')).toBe('IV');
    expect(formatCounter(4000, 'upperRoman')).toBe('4000');
    expect(formatCounter(0, 'upperAlpha')).toBe('0');
    expect(formatCounter(12, 'decimal')).toBe('12');
  });
});
```

Create `packages/domain/src/structure/contributions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf } from './contributions.js';

const MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

const note = (id: string) => ({
  type: 'footnote',
  id,
  anchor: { kind: 'span' },
  content: [{ type: 'paragraph', id: `${id}p`, content: [{ type: 'text', value: 'A note' }] }],
});

const figure = (id: string) => ({
  type: 'figure',
  id,
  asset: 'asset',
  imageStyle: 'wide',
  caption: 'A caption',
  alternative: { kind: 'decorative' },
});

describe('what a component contributes to the sequences', () => {
  it('takes every caption-bearing block and footnote in document order, wherever it is nested', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          content: [{ type: 'text', value: 'Unpack it.' }, note('n1')],
        },
        figure('f1'),
        {
          type: 'table',
          id: 't1',
          caption: 'Parts',
          headerRows: 1,
          headerColumns: 0,
          note: [{ type: 'text', value: 'Sizes vary.' }, note('n3')],
          rows: [
            {
              cells: [
                { content: [{ type: 'paragraph', id: 'c1', content: [note('n2')] }] },
                { content: [{ type: 'equation', id: 'e1', mathml: MATHML, numbered: true }] },
              ],
            },
          ],
        },
        { type: 'list', id: 'l1', kind: 'ordered', items: [{ content: [figure('f2')] }] },
        {
          type: 'blockquote',
          id: 'q1',
          content: [{ type: 'equation', id: 'e2', mathml: MATHML, numbered: false }],
          attribution: [note('n4')],
        },
        { type: 'preformatted', id: 'x1', text: 'lpr -P office' },
      ],
    });
    // The table before its cells, its cells before its note, and an unnumbered equation said so.
    expect(contributionsOf(content)).toEqual([
      { block: 'n1', sequence: 'footnote', numbered: true },
      { block: 'f1', sequence: 'figure', numbered: true },
      { block: 't1', sequence: 'table', numbered: true },
      { block: 'n2', sequence: 'footnote', numbered: true },
      { block: 'e1', sequence: 'equation', numbered: true },
      { block: 'n3', sequence: 'footnote', numbered: true },
      { block: 'f2', sequence: 'figure', numbered: true },
      { block: 'e2', sequence: 'equation', numbered: false },
      { block: 'n4', sequence: 'footnote', numbered: true },
    ]);
  });

  it('contributes nothing for a component of paragraphs alone', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [{ type: 'paragraph', id: 'p1', content: [] }],
    });
    expect(contributionsOf(content)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/scheme.test.ts src/structure/contributions.test.ts
```

Expected: both files FAIL with `Failed to resolve import "./scheme.js"` and `Failed to resolve
import "./contributions.js"`.

- [ ] **Step 3: Write the scheme**

Create `packages/domain/src/structure/scheme.ts`:

```ts
import { z } from 'zod';

import { MAXIMUM_OUTLINE_DEPTH } from './outline.js';

/**
 * How one part of a number is written. Alphabetic is bijective base 26 - `z` is followed by `aa`, as a
 * spreadsheet's columns are - and roman is written for 1 to 3999 and in decimal past it, so every
 * counter has a spelling and `formatCounter` is total. Zero, which only a prefix padded past the
 * sections that exist can hold, is `0` in every format.
 */
export const numberFormatSchema = z.enum([
  'decimal',
  'lowerAlpha',
  'upperAlpha',
  'lowerRoman',
  'upperRoman',
]);
export type NumberFormat = z.infer<typeof numberFormatSchema>;

const outlineDepth = z.number().int().min(1).max(MAXIMUM_OUTLINE_DEPTH);

/**
 * One sequence's rule in one matter (structure.md, "The scheme").
 *
 * - `label` is the word a caption's number is rendered with - "Figure" - and may be empty. STR-024
 *   makes it the layout's; until a layout exists, the default scheme below supplies it.
 * - `format` writes the parts of a number from the top, the last repeating: `['upperAlpha', 'decimal']`
 *   is "A", "A.1", "A.1.2". For the section sequence the parts are the section counters; for any other,
 *   the prefix's parts are written by the **section** rule's formats and the sequence's own counter by
 *   this rule's last one.
 * - `restartAt` restarts the counter whenever a numbered node at that depth or above is entered (STR-015);
 *   `null` never restarts it.
 * - `prefix` writes the section number to that depth before the counter - "2.4" is chapter 2's fourth
 *   figure - and `null` writes none.
 * - `separator` joins the parts of a section number, and a prefix to its counter.
 */
export const numberingRuleSchema = z.strictObject({
  label: z.string(),
  format: z.array(numberFormatSchema).min(1),
  restartAt: outlineDepth.nullable(),
  prefix: outlineDepth.nullable(),
  separator: z.string(),
});
export type NumberingRule = z.infer<typeof numberingRuleSchema>;

/** Every sequence has a rule in each matter: an appendix numbers in its own scheme (STR-016). */
export const sequenceRulesSchema = z.strictObject({
  body: numberingRuleSchema,
  appendix: numberingRuleSchema,
});

/** The five sequences a scheme always has (STR-014, CNT-041). A layout may declare more. */
export const REQUIRED_SEQUENCES = ['section', 'figure', 'table', 'equation', 'footnote'] as const;

/**
 * A numbering scheme: an open map from a sequence's name to its rules. **Not stored anywhere** - the
 * product's default below is a value in code, and a layout's will be a value PUB reads from the layout
 * artifact (STR-013) - so nothing here is a shape a later rule could find already written.
 *
 * `id` names the scheme so that anything keyed by the inputs to a numbering (STR-031) can key by it.
 * The section sequence's `restartAt` and `prefix` are `null`: a section number is the counter stack
 * itself, so it neither restarts nor takes a prefix.
 */
export const numberingSchemeSchema = z
  .strictObject({
    id: z.string().min(1),
    sequences: z.record(z.string().min(1), sequenceRulesSchema),
  })
  .refine(
    (scheme) => REQUIRED_SEQUENCES.every((name) => Object.hasOwn(scheme.sequences, name)),
    'A scheme numbers sections, figures, tables, equations and footnotes',
  )
  .refine((scheme) => {
    const section = scheme.sequences['section'];
    return (
      section === undefined ||
      [section.body, section.appendix].every(
        (rule) => rule.restartAt === null && rule.prefix === null,
      )
    );
  }, 'A section number is its counter stack, so the section sequence neither restarts nor takes a prefix');
export type NumberingScheme = z.infer<typeof numberingSchemeSchema>;

const caption = (label: string) => ({
  body: { label, format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' },
  appendix: { label, format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' },
});

const continuous = (label: string) => ({
  label,
  format: ['decimal'],
  restartAt: null,
  prefix: null,
  separator: '.',
});

/**
 * **The product's default scheme** (structure.md, "The scheme", design decision E): decimal sections,
 * figures and tables prefixed with their chapter and restarting with it, equations continuous,
 * footnotes continuous, and appendices in upper alphabetic - "Appendix A" is `A`, its sections `A.1`,
 * its figures `Figure A.1`, and its equations `Equation A.1`, restarting per appendix. It is what every
 * document numbers against until PUB gives a layout a scheme of its own (STR-013, PUB-011), and PUB
 * replaces it without the engine changing.
 */
export const defaultNumberingScheme: NumberingScheme = numberingSchemeSchema.parse({
  id: 'default/1',
  sequences: {
    section: {
      body: continuous(''),
      appendix: { ...continuous(''), format: ['upperAlpha', 'decimal'] },
    },
    figure: caption('Figure'),
    table: caption('Table'),
    equation: {
      body: continuous('Equation'),
      appendix: { ...continuous('Equation'), restartAt: 1, prefix: 1 },
    },
    footnote: { body: continuous(''), appendix: continuous('') },
  },
});

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

function roman(value: number): string {
  if (value < 1 || value > 3999) return String(value);
  let rest = value;
  let written = '';
  for (const [size, letters] of ROMAN) {
    while (rest >= size) {
      written += letters;
      rest -= size;
    }
  }
  return written;
}

function alphabetic(value: number): string {
  let rest = value;
  let written = '';
  while (rest > 0) {
    rest -= 1;
    written = String.fromCharCode(97 + (rest % 26)) + written;
    rest = Math.floor(rest / 26);
  }
  return written;
}

/** One counter, written in one format. Total: every non-negative integer has a spelling. */
export function formatCounter(value: number, format: NumberFormat): string {
  if (value === 0) return '0';
  switch (format) {
    case 'decimal':
      return String(value);
    case 'lowerAlpha':
      return alphabetic(value);
    case 'upperAlpha':
      return alphabetic(value).toUpperCase();
    case 'lowerRoman':
      return roman(value);
    case 'upperRoman':
      return roman(value).toUpperCase();
  }
}

/** The parts of a number, each in the format for its place - the last format repeating. */
export function formatParts(parts: readonly number[], rule: NumberingRule): string[] {
  return parts.map((part, index) =>
    formatCounter(part, rule.format[Math.min(index, rule.format.length - 1)] ?? 'decimal'),
  );
}
```

- [ ] **Step 4: Write the projection**

Create `packages/domain/src/structure/contributions.ts`:

```ts
import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';

/**
 * What one caption-bearing block (CNT-081) or one footnote contributes to the sequences: its
 * identifier, the sequence it takes from, and whether it takes a number at all - only a block equation
 * can say no (CNT-047). A small projection of content, and nothing else: no caption text, no position,
 * so the numbering table carries nothing a component holds but the identifiers it already exposes.
 */
export interface Contribution {
  readonly block: string;
  readonly sequence: string;
  readonly numbered: boolean;
}

/**
 * Inline content's contributions, in document order: a footnote takes from the footnote sequence where
 * its anchor stands (CNT-041). A footnote holds no footnote (CNT-129, `checkInlineContent`), so this
 * does not descend into one.
 */
export function inlineContributions(inlines: readonly InlineNode[]): Contribution[] {
  return inlines.flatMap((inline) =>
    inline.type === 'footnote' ? [{ block: inline.id, sequence: 'footnote', numbered: true }] : [],
  );
}

function blockContributions(block: BlockNode): Contribution[] {
  switch (block.type) {
    case 'paragraph':
      return inlineContributions(block.content);
    case 'list':
      return block.items.flatMap((item) => item.content.flatMap(blockContributions));
    case 'blockquote':
      return [
        ...block.content.flatMap(blockContributions),
        ...inlineContributions(block.attribution ?? []),
      ];
    case 'table':
      // The table takes its number before anything inside it, and its note - rendered below the body -
      // after its cells.
      return [
        { block: block.id, sequence: 'table', numbered: true },
        ...block.rows.flatMap((row) =>
          row.cells.flatMap((cell) => cell.content.flatMap(blockContributions)),
        ),
        ...inlineContributions(block.note ?? []),
      ];
    case 'figure':
      return [{ block: block.id, sequence: 'figure', numbered: true }];
    case 'equation':
      return [{ block: block.id, sequence: 'equation', numbered: block.numbered }];
    case 'preformatted':
      return [];
  }
}

/**
 * What a component's content contributes to the sequences, in document order (STR-023): every figure
 * and table, every block equation with whether it is numbered, and every footnote, wherever each is
 * nested - a list item, a blockquote, a table cell. Pure, and linear in the content. It reads content
 * that has already been through `parseContentDocument`, so it recurses no deeper than that parse did.
 */
export function contributionsOf(content: ContentDocument): Contribution[] {
  return content.content.flatMap(blockContributions);
}
```

- [ ] **Step 5: Run them to watch them pass, and typecheck**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/scheme.test.ts src/structure/contributions.test.ts
pnpm --filter @alloy-works/domain exec tsc --noEmit -p .
```

Expected: 5 passed; no type error.

- [ ] **Step 6: Regenerate the trace and commit**

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
git add packages/domain/src/structure packages/trace/trace.json
git commit -m "The numbering scheme, its default, and what a component contributes"
```

Nothing here cites a requirement, so no pin moves. `index.ts` exports the new names in task 2, with
the rest of the surface.

---

## Task 2: The counter stack

**Files:**

- Create: `packages/domain/src/structure/numbering.ts`
- Test: `packages/domain/src/structure/numbering.test.ts`
- Modify: `packages/domain/src/structure/index.ts`, `packages/domain/src/index.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: task 1's `Contribution`, `inlineContributions`, `formatCounter`, `formatParts`,
  `NumberingRule`, `NumberingScheme`, `defaultNumberingScheme`, `numberingSchemeSchema`,
  `contributionsOf`
- Produces: `NumberableNode`, `NumberableOutline`, `Resolved`, `Conditioned`,
  `resolve(outline: NumberableOutline, contributions: ReadonlyMap<string, readonly Contribution[]>): Resolved`,
  `conditions(resolved: Resolved): Conditioned`,
  `number(conditioned: Conditioned, scheme: NumberingScheme): NumberingTable`,
  `sectionNumbers(table: NumberingTable): ReadonlyMap<string, string>`, and the types
  `NumberingEntry { node; block: string | null; sequence; matter; sections: readonly number[];
value: number | null; restartedAt: string | null; number: string | null; label: string | null }`
  and `NumberingTable { scheme: string; entries: readonly NumberingEntry[] }`. `OutlineDocument` and
  `OutlineView` are both assignable to `NumberableOutline`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/structure/numbering.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf, type Contribution } from './contributions.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberableNode,
  type NumberingEntry,
} from './numbering.js';
import {
  defaultNumberingScheme,
  numberingSchemeSchema,
  type NumberingRule,
  type NumberingScheme,
} from './scheme.js';

const MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

const section = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'section',
  id: id(name),
  numbered: true,
  matter: 'body',
  title: [{ type: 'text', value: name, marks: [] }],
  children,
  ...over,
});

const reference = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'reference',
  id: id(name),
  numbered: true,
  matter: 'body',
  children,
  ...over,
});

const figures = (...blocks: string[]): Contribution[] =>
  blocks.map((block) => ({ block, sequence: 'figure', numbered: true }));

/** The pipeline, in its order: resolve, conditions, number. `known` is keyed by occurrence name. */
const table = (
  nodes: NumberableNode[],
  known: Record<string, readonly Contribution[]> = {},
  scheme: NumberingScheme = defaultNumberingScheme,
) =>
  number(
    conditions(
      resolve({ nodes }, new Map(Object.entries(known).map(([name, list]) => [id(name), list]))),
    ),
    scheme,
  );

/** The default scheme with one sequence's body rule changed, or added, parsed as a layout's would be. */
const withRule = (sequence: string, body: Partial<NumberingRule>): NumberingScheme => {
  const base =
    defaultNumberingScheme.sequences[sequence] ?? defaultNumberingScheme.sequences['figure']!;
  return numberingSchemeSchema.parse({
    id: `${defaultNumberingScheme.id}+${sequence}`,
    sequences: Object.fromEntries([
      ...Object.entries(defaultNumberingScheme.sequences),
      [sequence, { ...base, body: { ...base.body, ...body } }],
    ]),
  });
};

const labels = (entries: readonly NumberingEntry[], sequence: string) =>
  entries.filter((entry) => entry.sequence === sequence).map((entry) => entry.label);

describe('numbering an outline', () => {
  it('numbers sections as a counter stack, in document order', () => {
    const numbered = table([
      section('intro'),
      section('method', [section('scope'), section('design', [section('sample')])]),
      section('results'),
    ]);
    expect([...sectionNumbers(numbered).values()]).toEqual(['1', '2', '2.1', '2.2', '2.2.1', '3']);
  });

  it('STR-023 numbers every caption-bearing block in the sequence for its kind, wherever it is nested', () => {
    const figure = (block: string) => ({
      type: 'figure',
      id: block,
      asset: 'asset',
      imageStyle: 'wide',
      caption: 'A caption',
      alternative: { kind: 'decorative' },
    });
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Dosing',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        figure('f1'),
        {
          type: 'table',
          id: 't1',
          caption: 'Doses',
          headerRows: 1,
          headerColumns: 0,
          rows: [
            {
              cells: [
                { content: [{ type: 'equation', id: 'e1', mathml: MATHML, numbered: true }] },
              ],
            },
          ],
        },
        { type: 'list', id: 'l1', kind: 'unordered', items: [{ content: [figure('f2')] }] },
        {
          type: 'blockquote',
          id: 'q1',
          content: [{ type: 'equation', id: 'e2', mathml: MATHML, numbered: true }],
        },
      ],
    });
    const numbered = table([section('one', [reference('dosing')])], {
      dosing: contributionsOf(content),
    });
    const captions = numbered.entries.filter((entry) => entry.block !== null);
    expect(captions.map((entry) => [entry.block, entry.label])).toEqual([
      ['f1', 'Figure 1.1'],
      ['t1', 'Table 1.1'],
      ['e1', 'Equation 1'],
      ['f2', 'Figure 1.2'],
      ['e2', 'Equation 2'],
    ]);
  });

  it('CNT-047 gives an unnumbered block equation no number, and the next one the number it would have taken', () => {
    const numbered = table([reference('maths')], {
      maths: [
        { block: 'e1', sequence: 'equation', numbered: true },
        { block: 'e2', sequence: 'equation', numbered: false },
        { block: 'e3', sequence: 'equation', numbered: true },
      ],
    });
    expect(numbered.entries.filter((entry) => entry.sequence === 'equation')).toMatchObject([
      { block: 'e1', label: 'Equation 1' },
      { block: 'e3', label: 'Equation 2' },
    ]);
  });

  it('STR-014 numbers each sequence independently, and a sequence the scheme declares beyond its own', () => {
    const mixed: Contribution[] = [
      { block: 't1', sequence: 'table', numbered: true },
      { block: 'f1', sequence: 'figure', numbered: true },
      { block: 'x1', sequence: 'listing', numbered: true },
      { block: 't2', sequence: 'table', numbered: true },
      { block: 'f2', sequence: 'figure', numbered: true },
    ];
    const outline = [section('one', [reference('mixed')])];
    const declared = table(outline, { mixed }, withRule('listing', { label: 'Listing' }));
    expect(labels(declared.entries, 'table')).toEqual(['Table 1.1', 'Table 1.2']);
    expect(labels(declared.entries, 'figure')).toEqual(['Figure 1.1', 'Figure 1.2']);
    expect(labels(declared.entries, 'listing')).toEqual(['Listing 1.1']);
    // Undeclared, the same contribution numbers nothing and moves no other sequence.
    const undeclared = table(outline, { mixed });
    expect(labels(undeclared.entries, 'listing')).toEqual([]);
    expect(labels(undeclared.entries, 'figure')).toEqual(['Figure 1.1', 'Figure 1.2']);
  });

  it('STR-015 restarts a sequence at the depth the scheme declares, or never', () => {
    const outline = [
      section('one', [section('a', [reference('p')]), section('b', [reference('q')])]),
      section('two', [section('c', [reference('r')])]),
    ];
    const known = { p: figures('p1'), q: figures('q1'), r: figures('r1') };
    expect(labels(table(outline, known).entries, 'figure')).toEqual([
      'Figure 1.1',
      'Figure 1.2',
      'Figure 2.1',
    ]);
    const perSection = withRule('figure', { restartAt: 2, prefix: 2 });
    expect(labels(table(outline, known, perSection).entries, 'figure')).toEqual([
      'Figure 1.1.1',
      'Figure 1.2.1',
      'Figure 2.1.1',
    ]);
    const continuous = withRule('figure', { restartAt: null, prefix: null });
    expect(labels(table(outline, known, continuous).entries, 'figure')).toEqual([
      'Figure 1',
      'Figure 2',
      'Figure 3',
    ]);
  });

  it('STR-016 numbers appendices in their own scheme, each restarting its own sequences', () => {
    const numbered = table(
      [
        section('one', [reference('p')]),
        section('glossary', [section('terms', [reference('q')])], { matter: 'appendix' }),
        section('data', [reference('r')], { matter: 'appendix' }),
        section('two', [reference('s')]),
      ],
      { p: figures('p1'), q: figures('q1', 'q2'), r: figures('r1'), s: figures('s1') },
    );
    // A reference is a heading in the outline, so it takes a section number of its own.
    expect([...sectionNumbers(numbered).entries()]).toEqual([
      [id('one'), '1'],
      [id('p'), '1.1'],
      [id('glossary'), 'A'],
      [id('terms'), 'A.1'],
      [id('q'), 'A.1.1'],
      [id('data'), 'B'],
      [id('r'), 'B.1'],
      [id('two'), '2'],
      [id('s'), '2.1'],
    ]);
    expect(labels(numbered.entries, 'figure')).toEqual([
      'Figure 1.1',
      'Figure A.1',
      'Figure A.2',
      'Figure B.1',
      'Figure 2.1',
    ]);
    expect(numbered.entries.find((entry) => entry.block === 'r1')).toMatchObject({
      matter: 'appendix',
      restartedAt: id('data'),
    });
  });

  it('STR-017 excludes a node from numbering without it consuming a number', () => {
    const numbered = table([
      section('preface', [section('thanks')], { numbered: false }),
      section('one'),
      section('aside', [], { numbered: false }),
      section('two'),
    ]);
    expect([...sectionNumbers(numbered).entries()]).toEqual([
      [id('one'), '1'],
      [id('two'), '2'],
    ]);
  });

  it('carries on the counters of the numbered node before an unnumbered one, and restarts nothing', () => {
    const numbered = table(
      [
        section('preface', [reference('p')], { numbered: false }),
        section('one', [reference('q')]),
        section('aside', [reference('r')], { numbered: false }),
        section('two', [reference('s')]),
      ],
      { p: figures('p1'), q: figures('q1'), r: figures('r1'), s: figures('s1') },
    );
    expect(labels(numbered.entries, 'figure')).toEqual([
      'Figure 1',
      'Figure 1.1',
      'Figure 1.2',
      'Figure 2.1',
    ]);
  });

  it('STR-021 numbers each occurrence of one component independently', () => {
    const numbered = table(
      [section('one', [reference('twice')]), section('two', [reference('again')])],
      // Two occurrences of one component: the same contributions, keyed by each occurrence's node.
      { twice: figures('f1', 'f2'), again: figures('f1', 'f2') },
    );
    const f1 = numbered.entries.filter((entry) => entry.block === 'f1');
    expect(f1.map((entry) => [entry.node, entry.label])).toEqual([
      [id('twice'), 'Figure 1.1'],
      [id('again'), 'Figure 2.1'],
    ]);
  });

  it('CNT-041 counts footnotes over the document, not within a component', () => {
    const notes: Contribution[] = [
      { block: 'n1', sequence: 'footnote', numbered: true },
      { block: 'n2', sequence: 'footnote', numbered: true },
    ];
    const numbered = table(
      [
        section('one', [reference('first')], {
          title: [
            { type: 'text', value: 'One', marks: [] },
            { type: 'footnote', id: 'tn', anchor: { kind: 'span' }, content: [] },
          ],
        }),
        section('two', [reference('second')]),
      ],
      { first: notes, second: notes },
    );
    expect(numbered.entries.filter((entry) => entry.sequence === 'footnote')).toMatchObject([
      { node: id('one'), block: 'tn', number: '1' },
      { node: id('first'), block: 'n1', number: '2' },
      { node: id('first'), block: 'n2', number: '3' },
      { node: id('second'), block: 'n1', number: '4' },
      { node: id('second'), block: 'n2', number: '5' },
    ]);
  });

  it('STR-022 traces every number to the node, block, counters and restart that produced it', () => {
    const numbered = table([section('one'), section('two', [section('a', [reference('p')])])], {
      p: figures('p1', 'p2'),
    });
    expect(numbered.scheme).toBe('default/1');
    expect(numbered.entries.find((entry) => entry.block === 'p2')).toEqual({
      node: id('p'),
      block: 'p2',
      sequence: 'figure',
      matter: 'body',
      sections: [2, 1, 1],
      value: 2,
      restartedAt: id('two'),
      number: '2.2',
      label: 'Figure 2.2',
    });
    expect(numbered.entries.find((entry) => entry.node === id('a'))).toEqual({
      node: id('a'),
      block: null,
      sequence: 'section',
      matter: 'body',
      sections: [2, 1],
      value: 1,
      restartedAt: id('two'),
      number: '2.1',
      label: '2.1',
    });
  });

  it('STR-018 numbers the same outline the same way, however its values were built', () => {
    const build = (reversed: boolean): NumberableNode[] => {
      const node = (name: string, children: NumberableNode[] = []) => {
        const members: [string, unknown][] = [
          ['type', 'reference'],
          ['id', id(name)],
          ['numbered', true],
          ['matter', 'body'],
          ['children', children],
        ];
        return Object.fromEntries(
          reversed ? members.reverse() : members,
        ) as unknown as NumberableNode;
      };
      return [node('one', [node('p')]), node('two', [node('q')])];
    };
    const known = (reversed: boolean) => {
      const entries: [string, Contribution[]][] = [
        ['p', figures('p1')],
        ['q', figures('q1')],
        ['one', []],
        ['two', []],
      ];
      return Object.fromEntries(reversed ? entries.reverse() : entries);
    };
    const first = table(build(false), known(false));
    expect(JSON.stringify(table(build(true), known(true)))).toBe(JSON.stringify(first));
    expect(JSON.stringify(table(build(false), known(false)))).toBe(JSON.stringify(first));
  });

  it('withholds every number an occurrence nobody here can read could have moved, and no other', () => {
    const outline = [
      section('one', [reference('readable'), reference('secret'), reference('after')]),
      section('two', [reference('later')]),
    ];
    const known = { readable: figures('a1'), after: figures('b1'), later: figures('c1') };
    const numbered = table(outline, known);
    expect(numbered.entries.filter((entry) => entry.sequence === 'figure')).toMatchObject([
      { block: 'a1', label: 'Figure 1.1' },
      // After the unknown occurrence, in the same chapter: not guessed.
      { block: 'b1', value: null, number: null, label: null },
      // Chapter two restarts the counter, so its figures are known again.
      { block: 'c1', label: 'Figure 2.1' },
    ]);
    // A continuous sequence stays unknown to the end, whatever the unknown occurrence holds.
    const equations = table(outline, {
      ...known,
      later: [{ block: 'e1', sequence: 'equation', numbered: true }],
    });
    expect(equations.entries.find((entry) => entry.block === 'e1')).toMatchObject({ number: null });
    // And every section number is known, since none depends on what an occurrence holds.
    expect([...sectionNumbers(numbered).values()]).toEqual(['1', '1.1', '1.2', '1.3', '2', '2.1']);
  });

  it('gives every section the same number whatever the occurrences contribute', () => {
    const outline = [
      section('one', [reference('p', [section('inner')])]),
      section('two', [], { matter: 'appendix' }),
    ];
    const none = sectionNumbers(table(outline));
    const all = sectionNumbers(table(outline, { p: figures('p1', 'p2') }));
    expect([...none.entries()]).toEqual([...all.entries()]);
  });

  it('numbers nine levels', () => {
    let nodes: NumberableNode[] = [reference('deep9')];
    for (let level = 8; level >= 1; level -= 1) nodes = [section(`deep${level}`, nodes)];
    const numbered = table(nodes, { deep9: figures('f') });
    expect(sectionNumbers(numbered).get(id('deep9'))).toBe('1.1.1.1.1.1.1.1.1');
    expect(labels(numbered.entries, 'figure')).toEqual(['Figure 1.1']);
  });

  it('numbers every shape of outline the parse accepts, one section entry per numbered node', () => {
    // A linear congruential generator: the same two hundred outlines on every run.
    let seed = 7;
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    let count = 0;
    const grow = (depth: number): NumberableNode[] =>
      Array.from({ length: depth > 6 ? 0 : next(4) }, () => {
        count += 1;
        const name = `n${count}`;
        const over = { numbered: next(4) !== 0 };
        return next(2) === 0
          ? section(name, grow(depth + 1), over)
          : reference(name, grow(depth + 1), over);
      });
    for (let run = 0; run < 200; run += 1) {
      const nodes = grow(1).map((node) => ({
        ...node,
        matter: next(3) === 0 ? ('appendix' as const) : ('body' as const),
      }));
      const known: Record<string, Contribution[]> = {};
      for (let index = 1; index <= count; index += 1) {
        if (next(3) !== 0) known[`n${index}`] = figures(`f${index}`);
      }
      const expected: string[] = [];
      const walk = (list: readonly NumberableNode[], above: boolean) => {
        for (const node of list) {
          if (above && node.numbered) expected.push(node.id);
          walk(node.children, above && node.numbered);
        }
      };
      walk(nodes, true);
      expect([...sectionNumbers(table(nodes, known)).keys()]).toEqual(expected);
    }
  });
});
```

In `packages/domain/src/index.test.ts`, after `'outlineOperationSchema',` in the surface list, add the
ten names this task promotes:

```ts
        // Numbering, promoted in the plan that builds it
        // (docs/plans/2026-09-18-structure-02-numbering.md).
        'REQUIRED_SEQUENCES',
        'numberingSchemeSchema',
        'defaultNumberingScheme',
        'formatCounter',
        'contributionsOf',
        'inlineContributions',
        'resolve',
        'conditions',
        'number',
        'sectionNumbers',
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/numbering.test.ts src/index.test.ts
```

Expected: `numbering.test.ts` FAILS with `Failed to resolve import "./numbering.js"`, and
`index.test.ts` fails `exports the content model and the metadata rules as its public surface`, its
expected list holding ten names the package does not export.

- [ ] **Step 3: Write the pipeline**

Create `packages/domain/src/structure/numbering.ts`:

```ts
import type { InlineNode } from '../content/model/inline.js';

import { inlineContributions, type Contribution } from './contributions.js';
import { formatCounter, formatParts, type NumberingRule, type NumberingScheme } from './scheme.js';

/**
 * What numbering reads of a node, so that a stored outline and a reader's view (whose withheld
 * references carry `component: null`) number alike: numbering never reads which component a
 * reference names, only which occurrence it is.
 */
export interface NumberableNode {
  readonly type: 'section' | 'reference';
  readonly id: string;
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly title?: readonly InlineNode[];
  readonly children: readonly NumberableNode[];
}

export interface NumberableOutline {
  readonly nodes: readonly NumberableNode[];
}

/**
 * The first stage's answer (structure.md, "The order of the four stages"): the outline, and what each
 * occurrence it could resolve contributes, keyed by the occurrence's node - never by the component,
 * because one component placed twice is two occurrences (STR-010, STR-021). **An occurrence with no
 * entry is not known to whoever is numbering**: a component they may not read, one whose mode is
 * `approved` and so resolves to nothing yet, or one whose content does not read.
 */
export interface Resolved {
  readonly stage: 'resolved';
  readonly outline: NumberableOutline;
  readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
}

/** The second stage's answer: what survives condition evaluation (STR-020, REU's, T4). */
export interface Conditioned {
  readonly stage: 'conditioned';
  readonly resolved: Resolved;
}

export function resolve(
  outline: NumberableOutline,
  contributions: ReadonlyMap<string, readonly Contribution[]>,
): Resolved {
  return { stage: 'resolved', outline, contributions };
}

/**
 * Condition evaluation, which is REU's and T4: the identity until then. It is a stage of its own now
 * so that `number` cannot be handed anything that has not been through it (STR-051) - a `Resolved`
 * does not typecheck where a `Conditioned` is wanted.
 */
export function conditions(resolved: Resolved): Conditioned {
  return { stage: 'conditioned', resolved };
}

/**
 * One numbered thing, and everything that produced it (STR-022): the node, the block or footnote
 * where it is one, the sequence and the matter, the section counter stack at that point, this
 * sequence's own counter, and the node whose entry last restarted that counter - so "why is this
 * Figure 7?" is answered by reading the entry, not by guessing. The rule applied is named by the
 * table's `scheme` with the entry's `sequence` and `matter`, rather than copied into every entry.
 *
 * `value`, `number` and `label` are `null` where the counter is not known to whoever is numbering:
 * an occurrence before it in the same counter's scope could not be read, so the number it would print
 * cannot be computed without a guess. A section's never is - a section number depends on the outline
 * alone.
 */
export interface NumberingEntry {
  readonly node: string;
  readonly block: string | null;
  readonly sequence: string;
  readonly matter: 'body' | 'appendix';
  readonly sections: readonly number[];
  readonly value: number | null;
  readonly restartedAt: string | null;
  readonly number: string | null;
  readonly label: string | null;
}

export interface NumberingTable {
  /** The scheme it was numbered against, by its `id`. */
  readonly scheme: string;
  readonly entries: readonly NumberingEntry[];
}

interface Counter {
  value: number;
  restartedAt: string | null;
  /** False from an occurrence nobody here can read until the counter next restarts. */
  known: boolean;
}

interface MatterState {
  /** The section counter stack: `sections[d - 1]` is the counter at depth `d`. */
  sections: number[];
  readonly counters: Map<string, Counter>;
}

const labelled = (rule: NumberingRule, written: string) =>
  rule.label === '' ? written : `${rule.label} ${written}`;

/**
 * **The one numbering function** (structure.md, "Numbering"), called by the service for a document's
 * numbering and by the outline panel for its section numbers - so the two cannot disagree, not by
 * agreement but by being one function (STR-036). Pure (STR-018): no clock, no randomness, and no
 * order but the tree's.
 *
 * The walk is depth-first in document order, and each matter keeps a counter stack of its own - an
 * appendix numbers in its own scheme (STR-016), and a body node after an appendix carries on the body's
 * numbering. For each node:
 *
 * 1. **Its section number**, if it and every ancestor is numbered. A node with `numbered: false` takes
 *    none and consumes none (STR-017), and neither does anything beneath it: a number formed from an
 *    ancestor that has none would be a guess. Taking one restarts every other sequence whose `restartAt`
 *    is at or below its depth (STR-015). A reference is a heading in the outline and takes one too.
 * 2. **Its title's footnotes**, for a section - a title is inline content, and may hold one.
 * 3. **Its occurrence's contributions**, for a reference: each caption-bearing block and footnote in
 *    document order takes the next number in its sequence (STR-023) - and an unnumbered equation takes
 *    none (CNT-047). An occurrence not known here makes every other counter in its matter unknown until
 *    it next restarts, **whether or not it holds anything**, so which counters go unknown says nothing
 *    about what the occurrence contains.
 * 4. **Its children.** An unnumbered node is transparent: what it holds carries on the counters of the
 *    numbered node before it.
 */
export function number(conditioned: Conditioned, scheme: NumberingScheme): NumberingTable {
  const { outline, contributions } = conditioned.resolved;
  const others = Object.keys(scheme.sequences).filter((name) => name !== 'section');
  const states: Record<'body' | 'appendix', MatterState> = {
    body: { sections: [], counters: new Map() },
    appendix: { sections: [], counters: new Map() },
  };
  const entries: NumberingEntry[] = [];

  const counterOf = (state: MatterState, sequence: string): Counter => {
    let counter = state.counters.get(sequence);
    if (counter === undefined) {
      counter = { value: 0, restartedAt: null, known: true };
      state.counters.set(sequence, counter);
    }
    return counter;
  };

  const take = (node: string, contribution: Contribution, matter: 'body' | 'appendix') => {
    const rule = scheme.sequences[contribution.sequence]?.[matter];
    const sectionRule = scheme.sequences['section']?.[matter];
    // A sequence the scheme does not declare numbers nothing, and an unnumbered equation takes no
    // number (CNT-047): neither is an entry, and neither moves a counter.
    if (rule === undefined || sectionRule === undefined || !contribution.numbered) return;
    const state = states[matter];
    const counter = counterOf(state, contribution.sequence);
    counter.value += 1;
    let written: string | null = null;
    if (counter.known) {
      const prefix =
        rule.prefix === null
          ? []
          : Array.from({ length: rule.prefix }, (_, index) => state.sections[index] ?? 0);
      const own = formatCounter(counter.value, rule.format[rule.format.length - 1] ?? 'decimal');
      written = prefix.some((part) => part > 0)
        ? `${formatParts(prefix, sectionRule).join(sectionRule.separator)}${rule.separator}${own}`
        : own;
    }
    entries.push({
      node,
      block: contribution.block,
      sequence: contribution.sequence,
      matter,
      sections: [...state.sections],
      value: counter.known ? counter.value : null,
      restartedAt: counter.restartedAt,
      number: written,
      label: written === null ? null : labelled(rule, written),
    });
  };

  const visit = (
    node: NumberableNode,
    depth: number,
    matter: 'body' | 'appendix',
    parent: string | null,
    numberedAbove: boolean,
  ) => {
    const state = states[matter];
    const takesNumber = numberedAbove && node.numbered;
    const sectionRule = scheme.sequences['section']?.[matter];
    if (takesNumber && sectionRule !== undefined) {
      state.sections = state.sections.slice(0, depth);
      state.sections[depth - 1] = (state.sections[depth - 1] ?? 0) + 1;
      state.sections.length = depth;
      const written = formatParts(state.sections, sectionRule).join(sectionRule.separator);
      entries.push({
        node: node.id,
        block: null,
        sequence: 'section',
        matter,
        sections: [...state.sections],
        value: state.sections[depth - 1] ?? null,
        restartedAt: parent,
        number: written,
        label: labelled(sectionRule, written),
      });
      for (const sequence of others) {
        const rule = scheme.sequences[sequence]?.[matter];
        if (rule?.restartAt != null && depth <= rule.restartAt) {
          state.counters.set(sequence, { value: 0, restartedAt: node.id, known: true });
        }
      }
    }
    if (node.type === 'section') {
      for (const footnote of inlineContributions(node.title ?? [])) take(node.id, footnote, matter);
    } else {
      const known = contributions.get(node.id);
      if (known === undefined) {
        for (const sequence of others) counterOf(state, sequence).known = false;
      } else {
        for (const contribution of known) take(node.id, contribution, matter);
      }
    }
    for (const child of node.children) {
      visit(child, depth + 1, matter, takesNumber ? node.id : parent, takesNumber);
    }
  };

  for (const node of outline.nodes) visit(node, 1, node.matter, null, true);
  return { scheme: scheme.id, entries };
}

/** Each numbered node's section number, for a panel that shows nothing else. */
export function sectionNumbers(table: NumberingTable): ReadonlyMap<string, string> {
  return new Map(
    table.entries.flatMap((entry) =>
      entry.sequence === 'section' && entry.number !== null ? [[entry.node, entry.number]] : [],
    ),
  );
}
```

Append to `packages/domain/src/structure/index.ts`:

```ts
export { contributionsOf, inlineContributions } from './contributions.js';
export type { Contribution } from './contributions.js';
export { conditions, number, resolve, sectionNumbers } from './numbering.js';
export type {
  Conditioned,
  NumberableNode,
  NumberableOutline,
  NumberingEntry,
  NumberingTable,
  Resolved,
} from './numbering.js';
export {
  defaultNumberingScheme,
  formatCounter,
  numberingSchemeSchema,
  REQUIRED_SEQUENCES,
} from './scheme.js';
export type { NumberFormat, NumberingRule, NumberingScheme } from './scheme.js';
```

- [ ] **Step 4: Run it to watch it pass, and the whole domain suite**

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/domain exec tsc --noEmit -p .
pnpm --filter @alloy-works/domain build
```

Expected: every test passes, the structure suites 61 of them; no type error.

- [ ] **Step 5: Move the citation pin, regenerate and commit**

In `packages/trace/src/trace.test.ts`, above `expect(model.citations).toHaveLength(163)`, add:

```ts
// 173, from 163: the numbering plan (docs/plans/2026-09-18-structure-02-numbering.md) cites ten
// requirements structure.md claims, all in packages/domain/src/structure/numbering.test.ts: STR-014,
// STR-015, STR-016, STR-017, STR-018, STR-021, STR-022, STR-023, CNT-041 and CNT-047.
```

and make the expectation `173`. Then:

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
pnpm trace check
git add packages/domain packages/trace
git commit -m "The counter stack: resolve, conditions and number, over occurrences"
```

Expected: `No problems in the corpus.`; `pnpm trace show STR-023` names `numbering.test.ts`.

---

## Task 3: What an occurrence contributes, read from the store

**Files:**

- Create: `packages/db/src/numbering.ts`
- Test: `packages/db/src/numbering.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `contributionsOf`, `readContent`, `walkOutline`, `Contribution`, `OutlineDocument` from
  `@alloy-works/domain`; `readableComponents` from `./documents.js`
- Produces: `numberingInputs(trx: TenantTransaction, outline: OutlineDocument, principalId: string):
Promise<NumberingInputs>`, with `NumberingInputs { occurrences: readonly OccurrenceResolution[];
contributions: ReadonlyMap<string, readonly Contribution[]> }` and
  `OccurrenceResolution { node: string; version: string | null }`, in outline order

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/numbering.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  conditions,
  defaultNumberingScheme,
  number,
  resolve,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { numberingInputs } from './numbering.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));

/** A component's content: three figures, the second inside a list. */
const figured = (title: string): ContentDocument => {
  const figure = (id: string) => ({
    type: 'figure' as const,
    id,
    asset: 'asset',
    imageStyle: 'wide',
    caption: 'A caption',
    alternative: { kind: 'decorative' as const },
  });
  return {
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content: [
      figure('f1'),
      { type: 'list', id: 'l1', kind: 'unordered', items: [{ content: [figure('f2')] }] },
      figure('f3'),
    ],
  };
};

const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

const sectionNode = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

const referenceNode = (component: string, mode: ReferenceNode['mode']): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode,
  ...base,
  children: [],
});

describe('what a document numbers against, read from the store', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const generalOf = (trx: TenantTransaction) =>
    trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component at 0.1, as created, and at 0.2, holding three figures. */
  const component = async (
    trx: TenantTransaction,
    space: string,
    author: string,
    title: string,
  ): Promise<{ first: StoredVersion; head: StoredVersion }> => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const substance = substanceOf(made.version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author,
      substance: { ...substance, content: figured(title) },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return { first: made.version, head: recorded.version };
  };

  /** A document whose outline is recorded as given: the store's checks on a reference are bypassed. */
  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return outline;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = await generalOf(trx);
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada may read General; Grace may read General and Quality.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('resolves each occurrence, reads nothing the reader may not read, and withholds what it could move', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const first = referenceNode(shared.head.artifactId, { kind: 'latest' });
      const pinned = referenceNode(shared.head.artifactId, {
        kind: 'pinned',
        version: shared.first.id,
      });
      const hidden = referenceNode(secret.head.artifactId, { kind: 'latest' });
      const later = referenceNode(shared.head.artifactId, { kind: 'latest' });
      const waiting = referenceNode(shared.head.artifactId, { kind: 'approved' });
      const outline = await documentWith(trx, [
        sectionNode('Introduction', [first, pinned, hidden, later]),
        sectionNode('Method', [waiting]),
      ]);

      const forAda = await numberingInputs(trx, outline, ada);
      expect(forAda.occurrences).toEqual([
        { node: first.id, version: shared.head.id },
        { node: pinned.id, version: shared.first.id },
        { node: hidden.id, version: null },
        { node: later.id, version: shared.head.id },
        // `approved` resolves to nothing yet, though the same component's head was read above.
        { node: waiting.id, version: null },
      ]);
      expect([...forAda.contributions.keys()]).toEqual([first.id, pinned.id, later.id]);
      // Version 0.1 is one empty paragraph: known, and contributing nothing.
      expect(forAda.contributions.get(pinned.id)).toEqual([]);

      const figuresFor = async (principal: string, node: string) => {
        const inputs = await numberingInputs(trx, outline, principal);
        const table = number(
          conditions(resolve(outline, inputs.contributions)),
          defaultNumberingScheme,
        );
        return table.entries
          .filter((entry) => entry.node === node && entry.sequence === 'figure')
          .map((entry) => entry.label);
      };
      expect(await figuresFor(ada, first.id)).toEqual(['Figure 1.1', 'Figure 1.2', 'Figure 1.3']);
      // After the component Ada may not read, in the same chapter: withheld, not guessed.
      expect(await figuresFor(ada, later.id)).toEqual([null, null, null]);
      // Grace may read it, so she is told the numbers Ada is not.
      expect(await figuresFor(grace, later.id)).toEqual(['Figure 1.7', 'Figure 1.8', 'Figure 1.9']);
    });
  });

  it('never reads a pinned version that is not the component the node names', async () => {
    await service.withTenant(production, async (trx) => {
      const one = await component(trx, general, ada, 'One');
      const other = await component(trx, general, ada, 'Other');
      // The operation refuses this at the write; recorded directly, the read must refuse it too.
      const crossed = referenceNode(one.head.artifactId, {
        kind: 'pinned',
        version: other.head.id,
      });
      const outline = await documentWith(trx, [crossed]);
      const inputs = await numberingInputs(trx, outline, ada);
      expect(inputs.occurrences).toEqual([{ node: crossed.id, version: null }]);
      expect(inputs.contributions.size).toBe(0);
    });
  });

  it("never reads another environment's component, whatever an outline names", async () => {
    const theirs = await service.withTenant(development, async (trx) => {
      const ivy = await person(trx, 'ivy', 'Ivy');
      return component(trx, await generalOf(trx), ivy, 'Elsewhere');
    });
    await service.withTenant(production, async (trx) => {
      const foreign = referenceNode(theirs.head.artifactId, { kind: 'latest' });
      const pinnedForeign = referenceNode(theirs.head.artifactId, {
        kind: 'pinned',
        version: theirs.head.id,
      });
      const outline = await documentWith(trx, [foreign, pinnedForeign]);
      const inputs = await numberingInputs(trx, outline, ada);
      expect(inputs.occurrences).toEqual([
        { node: foreign.id, version: null },
        { node: pinnedForeign.id, version: null },
      ]);
      expect(inputs.contributions.size).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm --filter @alloy-works/db exec vitest run src/numbering.test.ts
```

Expected: FAIL with `Failed to resolve import "./numbering.js"`.

- [ ] **Step 3: Write `numberingInputs`**

Create `packages/db/src/numbering.ts`:

```ts
import {
  contributionsOf,
  readContent,
  walkOutline,
  type Contribution,
  type OutlineDocument,
} from '@alloy-works/domain';
import { readableComponents } from './documents.js';
import type { TenantTransaction } from './tables.js';

/**
 * Which version one occurrence resolved to, as its numbering is told it: `null` where the caller is
 * not told - a component they may not read, whose version is withheld as the outline withholds it; a
 * reference whose mode is `approved`, which resolves to nothing until revisions exist; a pinned
 * version that is not the component's; or a version whose content does not read.
 */
export interface OccurrenceResolution {
  readonly node: string;
  readonly version: string | null;
}

export interface NumberingInputs {
  readonly occurrences: readonly OccurrenceResolution[];
  /** What each resolved occurrence contributes, keyed by its node. Absent: not known to this caller. */
  readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
}

/**
 * The resolve stage's inputs, for one principal (structure.md, "Numbering"): which version each
 * occurrence takes, and what that version's content contributes to the sequences.
 *
 * **A component the principal may not read is never read at all**, so nothing it contains can reach
 * the answer: its occurrence is simply absent from `contributions`, and `number` withholds every number
 * it could have moved. Readable components are read in two queries whatever the outline's size - the
 * head of every `latest` one, and every `pinned` version - each version once, however many occurrences
 * resolve to it, and each version's content through `readContent`, the read-back rule every stored
 * component is held to (CNT-013). One whose content does not read is not known either, and says so in
 * no other way: numbering it would be a guess.
 */
export async function numberingInputs(
  trx: TenantTransaction,
  outline: OutlineDocument,
  principalId: string,
): Promise<NumberingInputs> {
  const references: {
    node: string;
    component: string;
    pinned: string | null;
    approved: boolean;
  }[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    references.push({
      node: node.id,
      component: node.component,
      pinned: node.mode.kind === 'pinned' ? node.mode.version : null,
      approved: node.mode.kind === 'approved',
    });
  });
  const readable = await readableComponents(
    trx,
    principalId,
    references.map((reference) => reference.component),
  );
  const latest = [
    ...new Set(
      references
        .filter((each) => readable.has(each.component) && each.pinned === null && !each.approved)
        .map((each) => each.component),
    ),
  ];
  const pinned = [
    ...new Set(
      references.flatMap((each) =>
        readable.has(each.component) && each.pinned !== null ? [each.pinned] : [],
      ),
    ),
  ];

  const heads =
    latest.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .distinctOn('artifact_id')
          .select(['id', 'artifact_id', 'content'])
          .where('artifact_id', 'in', latest)
          .orderBy('artifact_id')
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .execute();
  const pins =
    pinned.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['id', 'artifact_id', 'content'])
          .where('id', 'in', pinned)
          .execute();

  const headOf = new Map(heads.map((row) => [row.artifact_id, row]));
  const pinOf = new Map(pins.map((row) => [row.id, row]));
  const projected = new Map<string, readonly Contribution[] | null>();
  const project = (row: { id: string; artifact_id: string; content: unknown }) => {
    if (!projected.has(row.id)) {
      const read = readContent(row.content, { artifact: row.artifact_id, version: row.id });
      projected.set(row.id, read.ok ? contributionsOf(read.document) : null);
    }
    return projected.get(row.id) ?? null;
  };

  const occurrences: OccurrenceResolution[] = [];
  const contributions = new Map<string, readonly Contribution[]>();
  for (const reference of references) {
    // `approved` resolves to nothing until revisions exist, even where the same component is also
    // placed at `latest` and its head was read for that occurrence.
    const row =
      !readable.has(reference.component) || reference.approved
        ? undefined
        : reference.pinned !== null
          ? pinOf.get(reference.pinned)
          : headOf.get(reference.component);
    // A pinned version of some other artifact is refused when it is written; checked again here,
    // because a check that runs only at the write is a rule the read trusts rather than holds.
    if (row === undefined || row.artifact_id !== reference.component) {
      occurrences.push({ node: reference.node, version: null });
      continue;
    }
    const projection = project(row);
    occurrences.push({ node: reference.node, version: projection === null ? null : row.id });
    if (projection !== null) contributions.set(reference.node, projection);
  }
  return { occurrences, contributions };
}
```

In `packages/db/src/index.ts`, after the `./documents.js` export block:

```ts
export { numberingInputs, type NumberingInputs, type OccurrenceResolution } from './numbering.js';
```

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm --filter @alloy-works/db exec vitest run src/numbering.test.ts
pnpm --filter @alloy-works/db exec tsc --noEmit -p .
pnpm --filter @alloy-works/db build
```

Expected: 3 passed; no type error.

- [ ] **Step 5: Regenerate and commit**

```bash
pnpm --filter @alloy-works/trace generate
git add packages/db packages/trace/trace.json
git commit -m "Resolve each occurrence and read what it contributes, never what the reader may not read"
```

---

## Task 4: The numbering route

**Files:**

- Modify: `packages/api-contract/src/documents.ts`, `packages/api-contract/openapi.json`
- Modify: `packages/api-client/src/generated/schema.ts` (regenerated)
- Modify: `apps/service/src/documents.ts`
- Test: `apps/service/src/numbering-routes.test.ts`
- Modify: `apps/service/src/cross-tenant.test.ts`, `apps/service/src/access-routes.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: task 3's `numberingInputs`; task 2's `resolve`, `conditions`, `number`;
  `defaultNumberingScheme`; the existing `readDocument`, `readOutline`, `versionView`, `notFound`
- Produces: `NumberingView` and the route `getNumbering`, `GET /v1/documents/{id}/numbering`, `read`
  on the artifact, answering `200 NumberingView`, `401`, `404`

- [ ] **Step 1: Write the failing tests**

Create `apps/service/src/numbering-routes.test.ts`:

```ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  recordVersion,
  seedDevelopmentContent,
  substanceOf,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const UNKNOWN = '11111111-1111-4111-8111-111111111111';

type Json = Record<string, unknown>;

/** What the numbering route answers, as far as these tests read it. */
interface Numbering {
  document: string;
  version: { id: string; number: string };
  scheme: string;
  occurrences: { node: string; version: string | null }[];
  entries: {
    node: string;
    block: string | null;
    sequence: string;
    number: string | null;
    label: string | null;
  }[];
}

interface DocumentBody {
  id: string;
  version: { id: string };
  outline: { nodes: { id: string; children: { id: string }[] }[] };
}

const text = (value: string) => [{ type: 'text', value, marks: [] }];

const figure = (id: string) => ({
  type: 'figure',
  id,
  asset: 'asset',
  imageStyle: 'wide',
  caption: 'A caption',
  alternative: { kind: 'decorative' },
});

describe('a document numbered through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A component at 0.2 holding these figures, made through the store: the editor writes none yet. */
  const componentWithFigures = (space: string, title: string, figures: string[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.grace!,
        substance: {
          ...substance,
          content: { ...substance.content, content: figures.map(figure) } as never,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { id: made.version.artifactId, version: recorded.version.id };
    });

  const create = (title: string) =>
    call('grace', 'POST', `/v1/spaces/${general}/documents`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    }).then((made) => made.json<DocumentBody>());

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const reader = await findRole(trx, 'Reader');
      const author = await findRole(trx, 'Author');
      // Alice reads General; Grace authors in General and in Quality. The seed gives Ada Author on
      // General and nothing else, so neither Ada nor Alice may read Quality.
      for (const [role, principal, space] of [
        [reader!, ids.alice!, general],
        [author!, ids.grace!, general],
        [author!, ids.grace!, quality],
      ] as const) {
        await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('numbers for each reader only from what they may read, and withholds what it could not', async () => {
    const shared = await componentWithFigures(general, 'Install the printer', ['f1', 'f2']);
    const secret = await componentWithFigures(quality, 'Calibration', ['s1']);
    let doc = await create('The dosing report');
    const act = async (operation: Json) => {
      const answer = await call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation,
      });
      expect(answer.statusCode, answer.body).toBe(200);
      doc = answer.json<DocumentBody>();
    };
    await act({
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text('Introduction') },
    });
    const introduction = doc.outline.nodes[0]!.id;
    for (const [position, component] of [shared.id, secret.id, shared.id].entries()) {
      await act({
        operation: 'insert',
        parent: introduction,
        position,
        node: { type: 'reference', component, mode: { kind: 'latest' } },
      });
    }
    const [first, hidden, again] = doc.outline.nodes[0]!.children.map((child) => child.id);
    const figures = (body: Numbering) =>
      body.entries
        .filter((entry) => entry.sequence === 'figure')
        .map((entry) => [entry.node, entry.block, entry.label]);

    const forGrace = await call('grace', 'GET', `/v1/documents/${doc.id}/numbering`);
    expect(forGrace.statusCode, forGrace.body).toBe(200);
    const all = forGrace.json<Numbering>();
    expect(all).toMatchObject({
      document: doc.id,
      version: { id: doc.version.id },
      scheme: 'default/1',
    });
    expect(figures(all)).toEqual([
      [first, 'f1', 'Figure 1.1'],
      [first, 'f2', 'Figure 1.2'],
      [hidden, 's1', 'Figure 1.3'],
      [again, 'f1', 'Figure 1.4'],
      [again, 'f2', 'Figure 1.5'],
    ]);

    for (const reader of ['alice', 'ada']) {
      const answer = await call(reader, 'GET', `/v1/documents/${doc.id}/numbering`);
      expect(answer.statusCode, answer.body).toBe(200);
      const body = answer.json<Numbering>();
      expect(body.occurrences).toEqual([
        { node: first, version: shared.version },
        { node: hidden, version: null },
        { node: again, version: shared.version },
      ]);
      // Nothing of the component they may not read: not its block, its version or its identity.
      expect(answer.body).not.toContain('"s1"');
      expect(answer.body).not.toContain(secret.version);
      expect(answer.body).not.toContain(secret.id);
      expect(figures(body)).toEqual([
        [first, 'f1', 'Figure 1.1'],
        [first, 'f2', 'Figure 1.2'],
        [again, 'f1', null],
        [again, 'f2', null],
      ]);
      // Every section number is shown, because none depends on what a component holds.
      expect(
        body.entries.filter((entry) => entry.sequence === 'section').map((entry) => entry.number),
      ).toEqual(['1', '1.1', '1.2', '1.3']);
    }
  });

  it('numbers a document with no nodes as nothing at all, without an error', async () => {
    const doc = await create('Front matter only');
    const answer = await call('alice', 'GET', `/v1/documents/${doc.id}/numbering`);
    expect(answer.statusCode).toBe(200);
    expect(answer.json<Numbering>()).toMatchObject({ occurrences: [], entries: [] });
  });

  it('answers what is not a document here as absent, and a caller with no session as unknown', async () => {
    expect((await call('alice', 'GET', `/v1/documents/${UNKNOWN}/numbering`)).statusCode).toBe(404);
    const component = await componentWithFigures(general, 'Not a document', ['x1']);
    expect((await call('grace', 'GET', `/v1/documents/${component.id}/numbering`)).statusCode).toBe(
      404,
    );
    const doc = await create('Nobody signed in');
    expect((await call(undefined, 'GET', `/v1/documents/${doc.id}/numbering`)).statusCode).toBe(
      401,
    );
    expect(
      (await call('grace', 'GET', `/v1/documents/${doc.id.toUpperCase()}/numbering`)).statusCode,
    ).toBe(400);
  });
});
```

In `apps/service/src/cross-tenant.test.ts`'s `OTHER_TENANT_IDS`, after `editOutline`:

```ts
  getNumbering: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
```

In `apps/service/src/access-routes.test.ts`'s `HOLDING_NOTHING`, after `getDocument`:

```ts
    getNumbering: () => ({ url: `/v1/documents/${report}/numbering`, status: 404 }),
```

- [ ] **Step 2: Run them to watch them fail**

```bash
pnpm --filter @alloy-works/service exec vitest run src/numbering-routes.test.ts src/cross-tenant.test.ts src/access-routes.test.ts
```

Expected: all three tests in `numbering-routes.test.ts` FAIL - the route does not exist, so every
request to it is Fastify's `404`, where the first two expect `200` and the third expects `401` without
a session and `400` for an uppercase id. The two harnesses pass: they walk the contract's routes, which
do not name this one yet, so their new entries are spare until step 3.

- [ ] **Step 3: Declare the route**

In `packages/api-contract/src/documents.ts`, before `const unauthenticated`:

```ts
/**
 * A document's numbering (structure.md, "Numbering"), as the caller is shown it: the version it
 * numbers, the scheme, which component version each occurrence resolved to, and the numbering table.
 */
export const NumberingView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  scheme: z
    .string()
    .describe('The scheme numbered against, by its id: `default/1` until layouts exist'),
  occurrences: z
    .array(z.object({ node: z.string(), version: z.string().nullable() }))
    .describe(
      'Each component reference, in outline order, and the component version it resolved to: null ' +
        'where the caller may not read the component, where it waits on revisions, or where its ' +
        'content does not read. Its contributions are then not counted, and every number it could ' +
        'have moved is null',
    ),
  entries: z.array(
    z.object({
      node: z.string().describe('The outline node that produced it'),
      block: z.string().nullable().describe('The block or footnote, for a caption or a footnote'),
      sequence: z.string(),
      matter: z.enum(['body', 'appendix']),
      sections: z.array(z.number().int()).describe('The section counter stack at this point'),
      value: z.number().int().nullable().describe("This sequence's counter; null when not known"),
      restartedAt: z.string().nullable().describe('The node that last restarted the counter'),
      number: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
});
export type NumberingView = z.infer<typeof NumberingView>;
```

and in `documentRoutes`, before `editOutline`:

```ts
  getNumbering: {
    operationId: 'getNumbering',
    method: 'GET',
    path: '/v1/documents/{id}/numbering',
    summary: "The latest version's numbering, as the caller is shown it",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The numbering table', schema: NumberingView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may number',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
```

Then regenerate and build, which the service's typecheck needs:

```bash
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/api-client build
```

Now `pnpm --filter @alloy-works/service build` fails to typecheck: the handlers `app.ts` spreads no
longer satisfy `Handlers`, which requires one for `getNumbering`. That is the next step.

- [ ] **Step 4: Write the handler**

In `apps/service/src/documents.ts`, add `numberingInputs` to the `@alloy-works/db` import, and make the
domain import:

```ts
import {
  conditions,
  decide,
  defaultNumberingScheme,
  number,
  readOutline,
  resolve,
  walkOutline,
  withholdComponents,
} from '@alloy-works/domain';
```

and in `documentHandlers`, before `editOutline`:

```ts
    /**
     * The latest version's numbering, as this caller is shown it (structure.md, "Numbering" and "Who
     * is shown what"). A component they may not read is never read (`numberingInputs`), so no number
     * here was computed from one, and every number such an occurrence could have moved is null rather
     * than guessed. A stored outline that does not read is a broken store, thrown as the outline route
     * throws it.
     */
    getNumbering: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const read = readOutline(document.version.content, {
        artifact: id,
        version: document.version.id,
      });
      if (!read.ok) {
        throw new Error(`The document ${id} at ${document.version.id} does not read: ${read.failure}`);
      }
      const inputs = await numberingInputs(trx, read.outline, principalId);
      const table = number(
        conditions(resolve(read.outline, inputs.contributions)),
        defaultNumberingScheme,
      );
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        scheme: table.scheme,
        // Copied, because the domain's answers are read-only and the wire's types are not.
        occurrences: inputs.occurrences.map((occurrence) => ({ ...occurrence })),
        entries: table.entries.map((entry) => ({ ...entry, sections: [...entry.sections] })),
      };
    },
```

- [ ] **Step 5: Run them to watch them pass**

```bash
pnpm --filter @alloy-works/service build
pnpm --filter @alloy-works/service exec vitest run src/numbering-routes.test.ts src/cross-tenant.test.ts src/access-routes.test.ts src/document-routes.test.ts
pnpm --filter @alloy-works/api-contract test
```

Expected: 3 passed in `numbering-routes.test.ts`, `cross-tenant.test.ts` 56, `access-routes.test.ts`
15, `document-routes.test.ts` unchanged; the contract's 25 including the drift check. To see each
harness refuse a route without its entry, delete one entry and run it: `OTHER_TENANT_IDS[route.operationId]
is not a function` and `getNumbering has no address in HOLDING_NOTHING` - then put it back.

- [ ] **Step 6: Regenerate and commit**

```bash
pnpm --filter @alloy-works/trace generate
git add packages/api-contract packages/api-client apps/service packages/trace/trace.json
git commit -m "GET /v1/documents/{id}/numbering, as each reader is shown it"
```

---

## Task 5: Section numbers in the outline panel, and two switches

**Files:**

- Modify: `apps/web/src/structure/OutlinePanel.tsx`, `apps/web/src/structure/DocumentPage.tsx`
- Test: `apps/web/src/structure/DocumentPage.test.tsx`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: `number`, `resolve`, `conditions`, `sectionNumbers`, `defaultNumberingScheme`,
  `Contribution` from `@alloy-works/domain`; the existing `set` operation
- Produces: a tree item's `aria-describedby` naming its section number; **Numbered** and, at the top
  level, **Appendix** checkboxes in the node's details; announcements `X is now numbered.`, `X is no
longer numbered.`, `X is now an appendix.`, `X is no longer an appendix.`

- [ ] **Step 1: Write the failing tests**

At the end of `apps/web/src/structure/DocumentPage.test.tsx`, which already holds the model service,
`open` (under `<StrictMode>`), `item`, `section`, `reference` and `outline`:

```tsx
describe('section numbers in the outline panel', () => {
  it('shows each numbered node its section number, and renumbers a move without asking for one', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    // The number describes the item, and the title stays its name.
    expect(item('Introduction')).toHaveAccessibleDescription('1');
    expect(item('Method')).toHaveAccessibleDescription('2');
    expect(item('Scope')).toHaveAccessibleDescription('2.1');

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('2'));
    expect(item('Method')).toHaveAccessibleDescription('1');
    expect(item('Scope')).toHaveAccessibleDescription('1.1');
    // Numbered from the outline the page holds: nothing asked the service for a number.
    expect(fake.sent.some((request) => request.url.endsWith('/numbering'))).toBe(false);
  });

  it('takes a node out of the numbering, and its subtree with it, from its Numbered box', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Numbered' }));
    await waitFor(() => expect(item('Method')).not.toHaveAccessibleDescription());
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: METHOD, numbered: false },
    });
    expect(item('Scope')).not.toHaveAccessibleDescription();
    // Results takes the number Method no longer consumes.
    expect(item('Results')).toHaveAccessibleDescription('2');
    expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.');
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).not.toBeChecked();
  });

  it('makes a top-level node an appendix, numbered in its own scheme, and offers it nowhere else', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Scope'));
    expect(screen.queryByRole('checkbox', { name: 'Appendix' })).toBeNull();
    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Appendix' }));
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('A'));
    expect(item('Scope')).toHaveAccessibleDescription('A.1');
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, matter: 'appendix' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Method is now an appendix.');
  });

  it('numbers a reference to a component the reader may not read like any other node', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(RESULTS, 'latest')])]),
      { mayRead: () => false },
    );
    open(fake.fetch);
    const withheld = await screen.findByRole('treeitem', { name: /A component/ });
    expect(withheld).toHaveAccessibleDescription('1.1');
  });
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
pnpm --filter @alloy-works/web exec vitest run src/structure/DocumentPage.test.tsx
```

Expected: the four new tests FAIL - the first on `toHaveAccessibleDescription('1')` receiving an
empty description, the second and third finding no checkbox named `Numbered` or `Appendix`, the
fourth on its description - and the sixty existing tests pass.

- [ ] **Step 3: Show the numbers, and add the two boxes**

In `apps/web/src/structure/OutlinePanel.tsx`, widen the imports:

```tsx
import {
  conditions,
  defaultNumberingScheme,
  hasText,
  number,
  resolve,
  sectionNumbers,
  type Contribution,
  type OutlineView,
  type OutlineViewNode,
  type OutlineOperation,
  type SectionViewNode,
} from '@alloy-works/domain';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
```

Before `const PAGE_BREAKS`:

```tsx
/**
 * What the panel knows of any occurrence's contributions: nothing. It shows section numbers alone, and
 * a section number never depends on what an occurrence holds, so knowing nothing costs it nothing.
 */
const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();
```

After `const may = editable && !busy;`:

```tsx
// The one numbering function, over the outline this render shows: recomputed whenever the outline
// is, so there is no number to fall behind it (STR-031), and the same function the service numbers
// with, so the two cannot disagree (STR-036).
const numbers = useMemo(
  () => sectionNumbers(number(conditions(resolve(outline, NOTHING_KNOWN)), defaultNumberingScheme)),
  [outline],
);
```

In `renderNodes`, after `const labelId = ...`:

```tsx
const numberId = `${labelId}-number`;
const shown = numbers.get(node.id);
```

on the `<li>`, after `aria-labelledby={labelId}`:

```tsx
          // The number describes the item rather than naming it: a name is what typing a title finds
          // in a tree, and what every announcement says, and it stays put when a move renumbers it.
          aria-describedby={shown === undefined ? undefined : numberId}
```

and before `<span id={labelId} data-drop={`into:${node.id}`}>`:

```tsx
{
  shown !== undefined && (
    <>
      <span id={numberId}>{shown}</span>{' '}
    </>
  );
}
```

Where `NodeDetails` is rendered, pass whether the node is at the top level:

```tsx
          node={selected}
          topLevel={placeOf(nodes, selected.id)?.parent === null}
```

In `NodeDetails`, take the prop:

```tsx
function NodeDetails({
  node,
  topLevel,
  busy,
  onOperation,
  onRetitle,
  openField,
  onNotice,
  onRemove,
}: {
  node: OutlineViewNode;
  /** Whether the node is at the top level, the only place `matter` may be set (STR-016). */
  topLevel: boolean;
  busy: boolean;
```

and before its **Remove** button:

```tsx
{
  /* Controlled, and left enabled while an act is in flight, as the select above is: a change
          made then is not sent, and the box goes on showing what the node holds. */
}
<label>
  <input
    type="checkbox"
    checked={node.numbered}
    onChange={(event) => {
      if (busy) return;
      void onOperation({ operation: 'set', node: node.id, numbered: event.target.checked });
    }}
  />
  Numbered
</label>;
{
  topLevel && (
    <label>
      <input
        type="checkbox"
        checked={node.matter === 'appendix'}
        onChange={(event) => {
          if (busy) return;
          const matter = event.target.checked ? 'appendix' : 'body';
          void onOperation({ operation: 'set', node: node.id, matter });
        }}
      />
      Appendix
    </label>
  );
}
```

In `apps/web/src/structure/DocumentPage.tsx`'s `announce`, the `set` case becomes:

```tsx
    case 'set': {
      const node = placeOf(after.nodes, operation.node)?.node;
      if (!node) return 'Changed.';
      if (operation.pageBreak !== undefined) {
        return `${nodeName(node, names)} ${STARTS[operation.pageBreak]}.`;
      }
      if (operation.numbered !== undefined) {
        return `${nodeName(node, names)} is ${operation.numbered ? 'now' : 'no longer'} numbered.`;
      }
      if (operation.matter !== undefined) {
        return operation.matter === 'appendix'
          ? `${nodeName(node, names)} is now an appendix.`
          : `${nodeName(node, names)} is no longer an appendix.`;
      }
      return `Changed ${nodeName(node, names)}.`;
    }
```

Undo needs nothing: `tree.ts`'s inverse already takes back `numbered` and `matter` with the other
switches.

- [ ] **Step 4: Run them to watch them pass, and the whole renderer**

```bash
pnpm --filter @alloy-works/web exec vitest run src/structure/DocumentPage.test.tsx
pnpm --filter @alloy-works/web test
pnpm --filter @alloy-works/web exec tsc --noEmit -p .
```

Expected: 64 passed in the page suite, with no console noise; the whole renderer suite passes,
`dashes.test.ts` included; no type error.

- [ ] **Step 5: Regenerate and commit**

```bash
pnpm --filter @alloy-works/trace generate
git add apps/web packages/trace/trace.json
git commit -m "Section numbers in the outline panel, and Numbered and Appendix beside each node"
```

---

## Task 6: The trace, the docs and the release

**Files:**

- Modify: `docs/design/structure.md`
- Modify: `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md`
- Modify: `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`
- Modify: `packages/trace/trace.json`

- [ ] **Step 1: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace tranche T1 STR
pnpm trace show STR-022
pnpm trace show STR-036
```

Expected: `No problems in the corpus.`; STR-014 to STR-018, STR-022 and STR-023 `Covered`, each
naming `numbering.test.ts`; STR-036 `Designed`, claimed and cited by nothing (decision F).

- [ ] **Step 2: Pass the gate**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/worker fetch-typst   # once per machine
pnpm test
pnpm trace verify
pnpm trace gate
```

- [ ] **Step 3: Amend structure.md**

1. **The "Part of this is built" note**: numbering is built - the scheme, the default, contributions,
   `resolve`, `conditions`, `number`, the numbering route and section numbers in the panel - and what
   is still design loses "numbering" and gains "caption numbers shown in the renderer".
2. **STR-031's row** becomes: "Nothing caches a number. The numbering table is computed from the
   outline, each occurrence's resolved component version and the scheme whenever it is asked for,
   and every answer names each occurrence's version. A cache, when one is needed, is keyed by the
   document version, every occurrence's resolved component version, the scheme and the profile - the
   document's digest alone misses a `latest` component's new head."
3. **"Numbering"**: `contributions` is keyed by occurrence, and an occurrence absent from it is one
   nobody numbering can read; the panel needs none, because no section number depends on one; the
   scheme's `format` is a list, one per part; each matter keeps its own counters; a reference takes a
   section number; a title's footnotes count at their node; beneath an unnumbered node nothing takes a
   section number, and what it holds carries on the counters before it; the entry's members as
   `NumberingEntry` has them, the rule named by scheme, sequence and matter.
4. **"Who is shown what"** gains a paragraph: a reader is numbered only from what they may read; the
   service never reads a component they may not; every counter in its matter is unknown from its
   occurrence until the counter next restarts, whatever it holds, so everyone shown a number is shown
   the same one and a missing number says nothing about what the component contains.
5. **"Routes"**: `GET /v1/documents/{id}/numbering` is built, answering each occurrence's resolved
   version; `GET /v1/documents/{id}/contributions` is not, and waits for the renderer to show a
   caption's number; `GET /v1/documents/{id}` still resolves none.
6. **"Where the code lives"**: `packages/domain`'s `scheme.ts`, `contributions.ts`, `numbering.ts`;
   `packages/db`'s `numberingInputs`; the panel shows section numbers.
7. **"Changed while planning the build"** gains a paragraph and rows, in the shape the section has:

```markdown
[The second structure plan](../plans/2026-09-18-structure-02-numbering.md) built numbering and
captions and left resolving a cross-reference to structure 4, with its first consumer. It found
thirteen things; no claim changed.

| Found                                                                                                                           | Change                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-031's cache key missed the component versions**: a `latest` reference's new head moves a figure without moving the digest | Nothing is cached, every answer names each occurrence's version, and the key a cache would need is written into STR-031's row           |
| **"Who is shown what" was silent on numbers**, and a gap in them counts what a reader may not read                              | An unreadable occurrence is never read, and every number it could move is withheld whatever it holds ("Who is shown what")              |
| **`number` had two signatures**                                                                                                 | The pipeline's: `resolve` carries contributions by occurrence, `conditions` and `number` take the stage before, and the order is a type |
| **The panel has no component open**                                                                                             | It needs none: no section number depends on a contribution, which a test holds. The contributions route is not built                    |
| **Beneath an unnumbered node was unsaid**                                                                                       | Nothing beneath it takes a section number; what it holds carries on the counters before it and restarts nothing                         |
| **An appendix "restarting every sequence" was ambiguous**                                                                       | Each matter keeps its own counters: `A`, then `B`, and a body chapter after them carries on the body's numbering                        |
| **One format could not write `A.1`**                                                                                            | `format` is a list, one per part, the last repeating                                                                                    |
| **A title's footnotes and a reference's heading were never placed**                                                             | Both are numbered: a title's footnotes at their node, a reference in the section sequence                                               |
| **`approved` resolves to nothing**                                                                                              | Its occurrence is not known to anybody, so the numbers it could move are withheld from everybody until revisions exist                  |
| **The entry copied its rule**                                                                                                   | It names the rule by scheme, sequence and matter, and carries `matter`, `value`, `restartedAt` and `number`                             |
| **Each occurrence's resolved version was on `GET /v1/documents/{id}`**                                                          | It is on the numbering route, beside the numbers it produced                                                                            |
| **Every table is numbered, one used for layout included**                                                                       | Built as STR-023 says; a requirement for an explicitly unnumbered figure or table is recommended, not filed                             |
| **PUB must bring its scheme to the panel**                                                                                      | Recorded: the panel is right only while every document numbers against the scheme the panel uses                                        |
```

- [ ] **Step 4: Describe what is built**

In `docs/architecture.md`: `src/structure/`'s three new modules in the domain's section;
`numberingInputs` and its two queries in the database's; the route in the service's, with its
withholding; and the panel's numbers in the renderer's. No stored shape changed, and it says so. In
`docs/development.md`: how to see section numbers, exclusion and an appendix by hand, and how to see
caption numbers through the route, as "Trying it by hand" below sets out.

- [ ] **Step 5: The features, in lockstep**

In `docs/features.md`, under the documents entry, replace "Nothing is numbered yet - no section
numbers, no figure or table numbers, no cross-references resolved, and no table of contents." with:

```markdown
**Sections are numbered.** Each section and each component in the outline shows its number - `1`,
`2.1` - and a move renumbers everything at once. Untick **Numbered** to leave a node and everything
under it out of the numbering; tick **Appendix** on a top-level node to number it `A`, `B` and so on.
Figures, tables, equations and footnotes are numbered too, per chapter and per appendix, and the
service answers every number with where it came from - but the editor does not yet write a figure,
so you only see those through the API. Nothing resolves a cross-reference yet, and there is no table
of contents.
```

and in "What does not exist", replace "No numbering, no cross-references, no table of contents" with
"No cross-references resolved, no table of contents, no list of figures". In `README.md`'s Features
table, the documents row becomes:

```markdown
| Documents and outlines | Make a document in a space, build its outline out of sections and components, and restructure it a version at a time. Sections are numbered as you go |
```

- [ ] **Step 6: Mark the plan built**

In `docs/plans/README.md`, this plan's row becomes `Built (PR #n)` once the number is known, and the
prose below the structure table gains a paragraph in the shape plan 1's has.

- [ ] **Step 7: Bump the version and write the changelog**

`version.json`, the root `package.json` and `apps/desktop/package.json` all become `0.28.0`. At the
top of `CHANGELOG.md`:

```markdown
## 0.28.0 - YYYY-MM-DD (PR #n)

### Added

- **Section numbers.** A document's outline shows every section its number, and a move renumbers
  them straight away. Untick Numbered to leave a section and everything under it out; tick Appendix
  on a top-level section to number it A, B and so on.
- **Numbering through the API.** A document's numbering - sections, figures, tables, equations and
  footnotes - can be read with where each number came from. A number that would depend on a component
  you may not read is left out rather than guessed.
```

- [ ] **Step 8: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs CHANGELOG.md README.md packages/domain packages/db packages/api-contract apps/service apps/web packages/trace
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.28.0: numbering"
git push -u origin <branch>
gh pr create --base main --title "Numbering: section numbers in the outline, and the numbering table"
```

The pull request body says what changed for a person, names the ten requirements cited, says that
STR-036 and STR-031 are claimed and not cited and why (decision F), and names the two requirements
recommended for filing. It closes no issue. Then fill the changelog heading's `YYYY-MM-DD (PR #n)` and
the plans index's `Built (PR #n)`, commit, and push.

---

## Trying it by hand

After task 6, with Docker running and the whole system in containers:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

Nothing is migrated: a development database from before 0.28.0 is numbered as it stands.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation`, choose **Ada**,
   and open **The dosing report** (make it as structure 1's steps do if it is not there), with
   **Introduction**, **Method** and **Results**, and **Scope** under **Method**. The tree shows `1`,
   `2`, `2.1` and `3` before the titles.
2. Select **Introduction** and press `Alt+Down`: it becomes `2`, **Method** `1` and **Scope** `1.1`,
   at once.
3. Select **Method** and untick **Numbered**: **Method** and **Scope** lose their numbers, **Results**
   takes the number **Method** had, and the page says **Method is no longer numbered.** `Ctrl+Z` puts
   it back.
4. Select **Results** and tick **Appendix**: it becomes `A`. Select **Scope**: there is no **Appendix**
   box.
5. Add **Install the printer** under **Introduction**, twice. Each takes a section number of its own.
6. Open `http://dev.acme.localhost:8088/v1/documents/<the document's id>/numbering`: the table, with
   `scheme: "default/1"`, each section's entry and each occurrence's version.
7. **Captions, through the API**, because the editor writes paragraphs alone. On a component's page,
   in the browser console, give it two figures:

   ```js
   const component = '<the component id>';
   const json = { 'content-type': 'application/json' };
   const opened = (await (await fetch(`/v1/components/${component}`)).json()).version.id;
   const session = crypto.randomUUID();
   await fetch(`/v1/components/${component}/lock`, {
     method: 'POST',
     headers: json,
     body: JSON.stringify({ session }),
   });
   const figure = (id) => ({
     type: 'figure',
     id,
     asset: 'asset',
     imageStyle: 'wide',
     caption: 'A caption',
     alternative: { kind: 'decorative' },
   });
   await fetch(`/v1/components/${component}/iterations/${session}/1`, {
     method: 'PUT',
     headers: json,
     body: JSON.stringify({
       openedFrom: opened,
       content: {
         schemaVersion: 1,
         title: 'Install the printer',
         language: 'en-GB',
         direction: 'ltr',
         content: [figure('f1'), figure('f2')],
       },
     }),
   });
   await fetch(`/v1/components/${component}/versions`, {
     method: 'POST',
     headers: json,
     body: JSON.stringify({ session, openedFrom: opened }),
   });
   ```

   Open the numbering again: the first occurrence's figures are `Figure 2.1` and `Figure 2.2`, the
   second's `Figure 2.3` and `Figure 2.4` - one component, numbered once per place.

8. Give Alice **Reader** on _General_ alone, and as somebody who may read both, place under
   **Introduction**, between the two occurrences, a component from a space Alice may not read. Signed
   in as Alice, the numbering answers that occurrence `version: null`, and the figures after it in the
   same chapter `null`; its identifier appears nowhere in the answer.

### What a person can see, and what only a test proves

| Claim                                                            | Seen by hand | Proven only by a test                                                      |
| ---------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| Section numbers in the panel, recomputed by a move               | Steps 1, 2   | No request for a number: `DocumentPage.test.tsx`                           |
| Exclusion without consuming a number (STR-017)                   | Step 3       | `numbering.test.ts`                                                        |
| Appendices in their own scheme (STR-016)                         | Step 4       | Restarting per appendix, the body resuming: `numbering.test.ts`            |
| One component, numbered per occurrence (STR-021)                 | Steps 5, 7   | `numbering.test.ts`, `numbering-routes.test.ts`                            |
| Every number traced to what produced it (STR-022)                | Step 6       | The whole entry: `numbering.test.ts`                                       |
| Restarts at a declared depth, and determinism (STR-015, STR-018) |              | `numbering.test.ts`                                                        |
| Nothing numbered from a component the reader may not read        | Step 8       | Its block, version and id absent from the body: `numbering-routes.test.ts` |
| Every shape the parse accepts numbers                            |              | Two hundred generated outlines: `numbering.test.ts`                        |
| The desktop app                                                  | `pnpm app`   |                                                                            |

Steps 1 to 8 were **not** done in a browser before this plan was committed. The renderer was run in
jsdom, and the route on the wire.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Resolving a cross-reference** - `references(conditioned, numbering)`, occurrence-local
  resolution (STR-056), a `component` target's one occurrence (STR-062), the failures STR-029 needs,
  what a reader is shown of a target they may not read, and what a block's `title` form is (STR-028,
  STR-031, STR-032). Decision A. **Structure 4, cross-references**, planned beside the first editor
  slice that authors or renders one.
- **A component's reference to a section**: a target arm meaning the heading of the node that places
  the component, resolved per occurrence - the content-model plan's leftover. **Structure 4.**
- **The panel as a table of contents, `contents`, `listOf`, deep links and STR-039's budget** (issue
  #119), and citing STR-034, STR-036 and STR-037 together. **Structure 3, navigation**, which also
  decides whether `GET /v1/documents/{id}/contributions` is ever needed, once the renderer shows a
  caption's number.
- **A layout's scheme** (STR-013, PUB-011) and its labels (STR-024), and bringing that scheme to the
  panel, without which the panel's numbers are the default's and the publication's are not. **PUB's
  plan.**
- **Conditions** (STR-020, STR-042), the identity stage until then. **REU's plan.**
- **Resolving `approved`**: until revisions exist, every number after such an occurrence in its scope
  is withheld from everybody. **The revisions plan.**
- **A cache of the numbering table**, which the measurement says is not needed at several hundred
  nodes; when it is, keyed as STR-031's row now says. **Whichever plan measures a document that needs
  one.**
- **The measurement as a committed load test**, beside the version chain's, once issue #119 puts a
  number in the corpus to hold it to. **Structure 3.**
- **Numbering an earlier version or a baseline** (STR-052). **The baselines plan.**
- **A number in an announcement.** "Moved Introduction after Method." names the node by its title and
  not its new number; the number is the item's description, announced when it is focused. Whether an
  announcement should say the new number too is for the browser suite to show. **The accessibility
  plan.**
- **A title's footnote numbers in the panel**, which it does not show; nothing authors one.
  **Whichever plan edits a title as inline content.**

Found while writing this plan, and left rather than widened into it:

- **An explicitly unnumbered figure or table** (finding 13): recommended for filing. **The content
  model, before anything authors a table.**
- **A number revealing nothing a reader may not read** (decision C): recommended for filing, so the
  rule has a row. **IAM.**
- **A block tree's depth is still bounded only in admission** (issue #125). Numbering is safe from it
  - an unparseable component is simply not known - but a component deep enough to overflow the parse
    is withheld from everyone's numbering without anybody being told why. **The small content-model
    fix.**
- **`GET /v1/documents/{id}` still resolves no component version.** The numbering route answers it;
  whether the document route should too is **structure 3's**, when the panel names what each
  occurrence resolved to.
