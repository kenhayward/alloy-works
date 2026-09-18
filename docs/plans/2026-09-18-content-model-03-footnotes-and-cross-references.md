# Content model 3: footnotes and cross-references

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the content model's holes around footnotes and cross-references while closing them
costs nothing, because nothing in the product authors either yet. After this, every identifier inside
a component is unique - a footnote's, a footnote paragraph's and a cross-reference's included (issue
#122); a footnote holds only what CNT-129's closed list allows; and a cross-reference carries an
identifier of its own, a target that says what kind of thing it names, and a declared form for a page
reference in an output with no pages. Nobody sees a difference, which is the point: the day an editor
writes a footnote or a cross-reference, each of these is a migration of immutable versions instead.

**Architecture:** All in `packages/domain`. `content/model/document.ts`'s walk over inline content,
renamed `checkInlineContent`, claims every identifier in one set, refuses an image or a footnote
inside a footnote, and holds a cross-reference to the targets its home can reach - a component or a
section title, which the outline's title schema passes. `content/model/inline.ts` gains
`crossReferenceTargetSchema`, a closed union of `block`, `component` and `node`, and the node gains
`id` and `withoutPages`; the two identifier spellings the target names move from `structure/outline.ts`
to `content/model/identifier.ts`, because the content model cannot import the outline built on it.
`content/admission/reidentify.ts` gives a copied cross-reference a new identifier and points one at
the copy of a block that travelled with it. The version stays **1** (decision B); the one fixture
holding either construct is edited, and nothing in `packages/db` or `apps/service` changes. The wire
contract is regenerated because a section title's schema is in it.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Vitest 5. No new dependency, no migration, no route.

**Spec:** [`../design/content-model.md`](../design/content-model.md) ("Identity", "Inlines and
marks", "Two things this document requires of STR") and [`../design/structure.md`](../design/structure.md)
("What this design needs from the content model, and from the corpus", "Cross-references", "Who is
shown what"), as task 5 amends both; read with
[the first content-model plan](2026-09-13-content-model-01-the-schema.md) for the fixtures' promise,
[the admission plan](2026-09-15-content-model-02-the-admission-pipeline.md) for re-identify and its
decision 17, and [the first structure plan](2026-09-18-structure-01-the-document-and-its-outline.md),
whose decision E put this change here and before the numbering plan.

Third of the content-model plans, and a small one. It carries `Fixes #122` (footnote identifiers),
a second fix filed in task 2 (a footnote holding an image or a footnote), and lands requirement issue
#73 as **STR-062**, reworded (decision C). The final fix wave added `Fixes #124` (a footnote held as
parsed, finding 10).

**The code below was run before the plan was committed.** It was written in two throwaway worktrees
from `origin/main` at 0.27.0 (commit `47b5167`) - the second at a short path, because the first's
path was too long for Windows to start `esbuild` from - against a scratch Postgres container of its
own on port 55439: never the shared development database on 5432, and no running container was
stopped or restarted. There:

- **Issue #122 reproduced.** The CNT-002 test below failed first on the case it exists for - a
  footnote's paragraph with a body paragraph's identifier was accepted - and passed once the walk
  claimed footnote identifiers. The title test beside it failed and passed the same way.
- **A third hole was found and measured** (finding 1). An inline image inside a footnote's paragraph
  is accepted today, though CNT-129 closes the list and names images as excluded, and so is a footnote
  inside a footnote. Once the walk refused both, `CNT-012 migrates every fixture of every schema
version` failed on `v1/every-node.json` with `Footnote f1 holds a node a footnote may not: image` -
  **the permanent fixture itself holds the counterexample**. Task 2 edits it.
- **The cross-reference's new shape** failed eight tests first and passed once built; the old fixture
  then failed CNT-012 on its bare string target until task 3 edited it.
- **Re-identify** failed its new test first, then gave three copied cross-references new identifiers,
  pointed the one whose figure travelled at the figure's copy, and left the other two as they stood.
- **The suites.** `packages/domain` went from 498 tests to 508, all passing; `packages/api-contract`
  failed its `openapi.json` drift check until regenerated and then passed 25 of 25;
  `packages/api-client` 4 of 4 after regenerating; `packages/editor` 25; `apps/web` 350;
  `packages/trace` 296 after regenerating `trace.json`; and against the scratch container
  `packages/db` 281 of 281 and `apps/service` 241 of 241. `pnpm typecheck` was clean across all 21
  tasks, and eslint on the changed domain files.
- **Both digests round-tripped through Postgres.** A component version holding two cross-references
  and a footnote with a third - their members, and a text node's marks, deliberately out of order - was
  created through `createArtifact` in a fresh environment; the row read back through `jsonb` parsed
  equal to what was written, and `versionDigests(substanceOf(stored))` equalled the row's
  `content_hash` and `version_digest`.
- **The evidence query decision B rests on** was run against a seeded scratch schema: it counted one
  version holding a cross-reference and one iteration holding a footnote nested three levels down in a
  list, and none in a schema holding only an outline.
- **The trace, simulated.** With STR-062's row in the STR document and structure.md claiming STR-056
  and STR-062, `pnpm trace check` reported no problems and the regenerated model held 1367
  requirements, 361 claims and 163 citations - 360 claims once the final fix wave dropped STR-026.

Then the scratch container and both worktrees were removed.

**What was not run.** The evidence query against any real environment - that is decision B's
precondition and task 1's first step, and it is Ken's database to query. `pnpm test` as a whole,
`pnpm trace verify` and `pnpm trace gate`, because the worker's and the object store's suites were not
run. **One rule differs from the run on purpose:** the run let a section title's cross-reference
target another component's block, and decision E refuses it, because an outline answer would then
carry a component's identity to a reader who may not read it. The line that does it is in task 3, and
its test is written to that rule.

## Where the designs and the built code are wrong, missing or contradicted, most serious first

1. **CNT-129's image half is not enforced, the test citing it does not show it, and the permanent
   fixture holds the counterexample.** CNT-129: footnote content "must support paragraphs, the
   character marks, citations, inline equations, cross-references, hyperlinks, variables and inline
   data bindings. The list is closed, and must **not** include tables or images". The schema makes a
   footnote hold paragraphs, which refuses a table - and a paragraph holds any inline node, an `image`
   among them. The test `CNT-129 admits no table and no image inside a footnote` builds a table and
   nothing else, so its title claims what its body does not show, and `fixtures/v1/every-node.json`
   stores "A note on the span, with a decorative image" with the image inside the footnote. The list
   does not name a footnote either, and the walk's own comment calls a footnote inside a footnote
   intended. **Built** in task 2 (decision D): both refused, the test made true, the fixture edited.
2. **Issue #73, as filed, contradicts STR-056 at the storage level.** "Must identify its target by
   the pair of the outline occurrence and the block identifier, and must never identify it by the
   block identifier alone." STR-056 requires a reference inside a component to its own figure to
   resolve against whichever occurrence the reader is in - and a component does not know where it is
   placed, so the only thing it can store for that reference is the block identifier alone. The pair
   is the key resolution looks up, not what is stored. Filed as worded, the row would forbid the one
   shape STR-056 needs. **Changed** (decision C): STR-062 states the rule about resolution, where it
   is true.
3. **A target naming an occurrence makes a component's reference to another component work in one
   document only.** structure.md's `{ block, occurrence? }` stores an outline node's identifier inside
   a component; that node exists in exactly one outline, so in every other document using the same
   component the reference fails by name, and nothing its author can do fixes it without breaking the
   first. The product is for reuse. **Changed** (decision A): a reference to another component's block
   names the component, and resolution finds that component's one occurrence in the resolving
   document - failing by name where it has none or several, never taking the first.
4. **Issue #122 is real, and a section title has the same hole.** `parseContentDocument`'s walk
   claims block identifiers and never a footnote's own or its paragraphs'; a section title's walk
   claims nothing at all. **Built** in task 1: one walk claims every identifier, in a component and
   within each title.
5. **A cross-reference with an `id` must be re-identified on paste, or a slice pasted twice is
   refused.** Re-identify gives blocks, footnotes and marks new identifiers and passes a
   cross-reference through untouched. Once the reference carries an identifier the walk claims, pasting
   the same sentence twice stores one identifier twice. And a sentence pasted with the figure it cites
   would go on citing the original. **Built** in task 4: a new identifier, and a pointer moved to the
   copy where its block travelled - the question the admission plan left "for STR".
6. **A title's cross-reference naming a component would undo a fix structure 1's final review made.**
   Every answer carrying an outline withholds a component the reader may not read ("Who is shown
   what"); a `component` target inside a title would carry that identity straight past it. **Refused**
   in titles for now (decision E), so there is nothing to withhold until the withholding exists.
7. **STR-056 is answered by structure.md and neither claimed nor listed as unclaimed.** The design
   says its rule "answers STR-056 and STR-028 together", then claims STR-028 and not STR-056, and
   STR-056 is not in "What this document does not own". **Claimed** in task 5.
8. **The admission plan's decision 17 said the next tightening needs a migration.** "Once iterations
   are stored, a rule like this needs a migration rather than a fixture edit." Iterations are stored
   now. This plan tightens schema version 1 anyway, for the reason decision B gives, and it says so
   rather than letting the sentence quietly stop being true.
9. **A title's refusal said the wrong thing.** `sectionTitleSchema` answered every failure of the
   content model's walk with "A footnote in a title holds paragraphs alone". **Changed** to one fixed
   message covering the walk's rules.
10. **Inside a footnote, the schema's defaults are never applied.** A footnote's `content` is parsed
    by the walk and the parsed copy discarded, so a footnote paragraph stored without `style`, or a
    text run without `marks`, is kept exactly so: measured, two spellings of one footnote serialise to
    two strings and two digests. Planned as named and not fixed (issue #124); **fixed in the final fix
    wave instead**, because once defaults were filled in on read every version written before would
    stop matching `version.unchanged`, and nothing stored yet holds a footnote. The walk returns what
    it parsed, and the component and the section title store that. The pull request closes #124.
11. **A block tree's depth is bounded only in admission.** `admissionLimits.depth` stops a paste at
    128, and nothing stops the iteration route storing a list nested deeper than a browser's stack
    can parse back. Not this plan's hole and **not fixed here**; this plan bounds the recursion it
    adds (the stored-shape check, row 10).
12. **A correction to how citations are counted.** `parseCitations` keeps one citation per
    identifier, per kind, per file. The new CNT-002 test sits in a file that already cites CNT-002 in
    a title, so it moves no pin.

## Decisions for Ken

Each is a choice this plan makes provisionally so that it can be built, with a recommendation.
Reject one and the plan changes where the decision says.

- **A. A reference to another component's block names the component, not an occurrence.** The
  target is a closed union of three: `block` (a block or footnote of the component the reference is
  in, bound at resolution to the occurrence being read - STR-056), `component` plus `block` (another
  component's, bound to that component's one occurrence in the resolving document), and `node` (an
  outline node). Recommended: accept. Finding 3 is the reason: named by occurrence, a reusable
  component's reference works in one document. DITA names a cross-reference's target by its topic and
  element, not by its place in a map, and resolves a topic used twice to the first silently; this
  refuses the ambiguous case by name instead. **The costs**: a target component used twice in one
  document cannot be disambiguated yet (a key held in the outline, as DITA's keys are, would be the
  widening that does it); and the target's identifier sits in the holder's content, visible to anybody
  who may read the holder, so structure 2's resolver must decide what such a reader is shown of the
  number and title. **Otherwise (i)**: `{ kind: 'occurrence', occurrence, block }` as structure.md and
  #73 have it - unambiguous in the one document whose outline minted the node, a named failure in every
  other, and uncheckable at write because a component knows no outline. In task 3 the arm's members
  change and nothing else. **Otherwise (ii)**: ship `block` and `node` only, and let structure 2 add
  the cross-component arm with its resolver in hand - adding an arm is a widening, so nothing stored
  would change.
- **B. The node changes in place, at content schema version 1.** No version bump, no migration step,
  no `fixtures/v2/`; `fixtures/v1/every-node.json` is edited, as it was once already (the admission
  plan's decision 17, commit `66c8467`). Recommended: accept, **on one condition**: the evidence query
  in task 1 step 1, run against every database that has stored content - the development database
  and anything else Ken has run - counts no stored version and no iteration holding a cross-reference
  or a footnote. The editor writes paragraphs alone, so only a hand-built API call could have stored
  one. The argument: a version bump would need a migration from the old node to the new, and there is
  no honest one - a bare string has no kind, the old node has no identifier and a migration that
  mints one is not pure - so it would invent meaning for content that, by the evidence, was never
  written; and the #122 fix is the same in-place tightening, which nobody proposes to migrate. What
  makes the precondition necessary is finding 8. **If the query finds anything**, stop: the answer
  becomes a second schema version with a migration that refuses a bare-string target by name, and
  this plan is rewritten before task 1.
- **C. Issue #73 lands here as STR-062, reworded, and structure.md claims it and STR-056.** The row:
  "A cross-reference to a block must resolve against exactly one outline occurrence of that block's
  component: the occurrence it is read in, for a block of its own component (STR-056), and otherwise
  the one occurrence of that component in the resolving document. Where there is none, or more than
  one, it must fail with a named error (STR-029) rather than resolve against the first occurrence or
  against the block identifier alone." Recommended: accept. Finding 2 is why it cannot land as filed,
  and this plan fixes the stored shape the requirement constrains - leaving the row until structure 2
  would leave an open issue whose words forbid the shape being frozen here. Nothing cites either
  claim until structure 2's resolver. If decision A goes to (i), the row's second clause becomes "the
  occurrence its target names". **Otherwise**: leave #73 open and let structure 2 land it with the
  citation.
- **D. A footnote's closed list is enforced here, and a footnote inside a footnote is refused.**
  Finding 1: no image and no footnote inside a footnote's paragraph, the test made to show what its
  title says, the fixture edited, and an issue filed for it (task 2), since it is a fix. Recommended:
  accept - it is the same kind of hole, in the same walk, and free for the same reason. Word allows no
  footnote in a footnote. It also bounds the walk: it descends one footnote deep and no further.
  **Otherwise**: drop task 2 and file the issue for later - and accept that the fixture keeps the
  counterexample.
- **E. Where each target may stand.** In a component, `block` and `component`, never `node` - an
  outline node belongs to one document, and a component is used in many. In a section title, `node`
  alone - a title is in no component, so `block` means nothing there, and `component` would carry a
  component's identity past the withholding "Who is shown what" requires (finding 6). Recommended:
  accept. Each refusal can be lifted later as a widening, which changes nothing stored.
- **F. A copied reference whose block did not travel is left as it stands.** Pasted without its
  figure, a reference keeps naming a block the receiving component does not have, and resolution names
  it as missing (STR-029), as it would for a figure deleted after the reference was written. As built,
  it is also counted at paste, under a report action of its own, `kept` - nothing was discarded or
  rewritten (CNT-064), but the author is told now rather than only at resolution - and only where the
  receiving component does not hold its target: a sentence copied within one component resolves as
  the original does, and is not counted. Amended in the final fix wave to match what was built; the
  plan first said it was not reported at paste. Recommended: accept.
  **Otherwise**: drop the reference and report it - which silently leaves "see " in the sentence until
  the author reads the report.
- **G. Nothing checks at write that a `component` target is a component the author may read.** The
  outline checks its reference nodes in the store; content has no such check, and this plan does not
  add one. Recommended: accept, and let the first plan that authors a cross-reference add it. The
  reason it can wait where the outline's could not: a write-time check is not a read-time rule - adding
  it later refuses no stored version, so it is not a migration - and resolution must handle a component
  the reader may not read regardless, because grants change after a reference is written.
  **Otherwise**: build it now in `packages/db` on the iteration, promotion and version paths, with its
  own refusal and a database test - roughly a task.
- **H. No `entry` arm yet.** STR-026 lists a bibliography entry among the targets; LIB has not
  designed what an entry's identity is, and a citation's `entry` is already a bare string nothing
  checks. Adding an arm is a widening. Recommended: accept; structure.md says so beside STR-026's
  claim, which stays. **Amended in the final fix wave**: the claim does not stay. With no entry arm,
  and with a `node` target refused outside a section title (decision E), so that body text cannot
  reference a section, the union answers STR-026 only in part; structure.md drops the claim and names
  both gaps in "What this document does not own".
- **I. The release is 0.27.1, a Build bump.** It is a fix (#122 and task 2's) and a correction to a
  stored shape nothing authors; nobody can do anything after it that they could not before.
  Recommended: accept. **Otherwise**: 0.28.0, if a changed stored shape counts as a functional change
  whether or not anybody can reach it.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. A test cites a requirement only when its own body
  demonstrates that requirement's own statement (`pnpm trace show <ID>`) and the owning design claims
  it in full. [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the
  whole list; every other test title carries no identifier.
- **`packages/domain` stays platform-free.** Everything here is in it except the regenerated contract
  and client; nothing takes randomness, a clock or `fs` outside a test.
- **A passing run has no errors or warnings.**
- **No em or en dashes in user-facing text** - the admission report's messages, the changelog, the
  issue. Code comments and this document are exempt.
- **No real data anywhere.** Invented names only - `Ada`, `Grace` - and the component id
  `7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27` the structure fixtures already use.
- **The corpus is queried, never read wholesale.** Open a requirement document only to edit it
  (task 5).
- **`trace.json` is drift-checked and its line numbers move with every test edit.** Each task that
  touches a test file runs `pnpm --filter @alloy-works/trace generate` and commits the result, so
  every task ends green. The pins in `packages/trace/src/trace.test.ts` and
  `packages/trace/src/parse/requirements.test.ts` move in task 5 alone: requirements 1366 to 1367,
  claims 359 to 361 (360 after the final fix wave dropped STR-026), citations 163 unchanged. They were read on `origin/main` at `47b5167`; if main has
  moved, set each to what the regenerated file holds and say so in the comment.
- **A filtered run does not build what it imports.** After changing `packages/domain`, run
  `pnpm --filter @alloy-works/domain build` before `pnpm --filter @alloy-works/api-contract generate`
  or any filtered run of a package importing it.
- **Paths.** Run from a checkout at a short path. The first proof run failed to start `esbuild` from a
  worktree under the user's temporary directory, because the path passed Windows' limit.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
  The code below is written to it; the test titles are long enough that prettier may wrap a call, and
  that is expected.
- **One pull request, one version bump (0.27.1, decision I) and one changelog entry**, in task 5,
  headed `## 0.27.1 - YYYY-MM-DD (PR #n)` and filled with the date and the number once the pull request
  exists - `apps/desktop/src/version.test.ts` fails on a heading without both. Never commit to `main`.

---

## The stored-shape check

Versions are insert-only, so anything a stored shape accepts today that a later rule refuses is a
migration of immutable history. Structure 1's final review found five such cases late. This is the
same check made here, member by member, before any of it is stored.

**The write paths every row below is held on.** Content: the iteration route (`apps/service`
`editing.ts`, then `packages/db` `saveIteration`), cutting a version from an iteration
(`promotion.ts`), and every component version recorded (`versions.ts` `prepare`) - each through
`parseContentDocument` - plus admission's validate stage, which is `parseContentDocument` too, and
read-back through `readContent`. A section title: the wire body of an insert or a retitle
(`sectionTitleSchema` inside `outlineOperationSchema`), the operation's result, every document version
recorded and every read - each through `parseOutlineDocument`, whose nodes use `sectionTitleSchema`,
and a reader's view through `readOutlineView`, which extends the same node schema. **Nothing else
parses inline content**: `inlineNodeSchema` is used directly by these two schemas alone, which is why
the walk they both run is where every rule below that the schema cannot state lives.

**The canonical form, once for every row.** `canonicalise` applies `marksAsASet` to any member named
`marks`, at any depth, and the outline's form applies it to a node's `title`. No member added here is
named `marks`, holds an array, or holds a free-form record, so the rule reaches nothing new: the
target is three fixed string members under a discriminant, and the rest are strings. Proved: two
member orders of a reference and its target give one string, and the stored row's two digests
recompute from `jsonb`.

| #   | Member                                        | Validated on every write path by                                                                                                                                              | Reused schema: loose or tight?                                                                                                                                                    | Recursion                                                                                | Points at, and who checks                                                                                                                                                                                                                     |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `crossReference.id`                           | The node schema, `z.string().min(1)`; unique by the walk - in a component beside every block and footnote, in a title within that title                                       | The block identifier's own rule, `min(1)`, deliberately not the 26-character spelling: fixtures and admitted content use short ones, and a stricter rule would refuse them        | None                                                                                     | Itself. Admission gives a copied one a new value (task 4)                                                                                                                                                                                     |
| 2   | `crossReference.target`, and its `kind`       | `crossReferenceTargetSchema`, a discriminated union of strict objects: a bare string, a fourth kind or an extra member (an `occurrence` on `block`) is refused                | New                                                                                                                                                                               | None                                                                                     | Where each kind may stand is the walk's rule (decision E): `node` refused in a component, anything but `node` refused in a title                                                                                                              |
| 3   | `target.block` (`block` and `component` arms) | `z.string().min(1)`                                                                                                                                                           | The same rule as the identifier it names                                                                                                                                          | None                                                                                     | A block or footnote. **Nothing checks it exists at write, on purpose**: the parse checking it would refuse deleting a cited figure. Resolution names a missing one (STR-029); re-identify points a copied one at the copy (task 4)            |
| 4   | `target.component`                            | `artifactIdentifierSchema`, the lowercase uuid                                                                                                                                | The tightened one: moved from `structure/outline.ts`, where a reference node already uses it, not restated                                                                        | None                                                                                     | A component in this environment other than the holder. Spelling at parse; existence, readability and self **at resolution, not at write** (decision G) - a write-time check refuses nothing stored when added, so it is not a migration later |
| 5   | `target.node`                                 | `nodeIdentifierSchema`, 26 base32 characters                                                                                                                                  | The tightened one, moved likewise                                                                                                                                                 | None                                                                                     | A node of the same outline; titles alone. Not checked to exist at write, for the reason in row 3: a check in the parse would stop the node being removed                                                                                      |
| 6   | `crossReference.withoutPages`                 | The node schema: optional, one of `number`, `title`, `numberAndTitle`, and present only when `display` is `page` (a refinement on the object, so every path holding the node) | New. Narrow on purpose: `page` and `relative` need pages themselves, and widening the set later changes nothing stored                                                            | None                                                                                     | Nothing. Absent on a page reference is STR-055's "none declared"                                                                                                                                                                              |
| 7   | `crossReference.display`                      | Unchanged, five forms                                                                                                                                                         | Unchanged                                                                                                                                                                         | None                                                                                     | Nothing                                                                                                                                                                                                                                       |
| 8   | A footnote's `id`                             | Unchanged schema, `min(1)`; **now claimed by the walk** (issue #122)                                                                                                          | Unchanged                                                                                                                                                                         | None                                                                                     | Itself; a `block` target may name it                                                                                                                                                                                                          |
| 9   | A footnote paragraph's `id`                   | `paragraphNodeSchema` through `footnoteContentSchema`; **now claimed by the walk**                                                                                            | The tightened one, as before                                                                                                                                                      | None                                                                                     | Itself                                                                                                                                                                                                                                        |
| 10  | A footnote's `content`                        | `inlineNodeSchema` leaves it `z.array(z.unknown())`; the walk parses it with `footnoteContentSchema` and now refuses an image or a footnote in its paragraphs                 | **The loose one in the schema, tightened only by the walk** - which is why both homes must run the walk, and both do. Finding 10: the walk's parsed copy is what is stored (#124) | **Bounded at one footnote**: no footnote inside one, so the walk descends once and stops | Nothing                                                                                                                                                                                                                                       |
| 11  | A section title's inline content              | `sectionTitleSchema`, whose refinement runs the same walk with home `title` and a fresh set per title                                                                         | The content model's own walk, exported, not copied                                                                                                                                | As row 10                                                                                | Identifiers inside a title are unique within it: anything in a title is reached through its node, as anything in a component is through its occurrence                                                                                        |

**Two things this check found and does not change.** A block tree's own depth is still bounded only
in admission (finding 11), and a footnote's defaults were not applied (finding 10). Neither makes
anything stored unreadable later, which is the test this table applies. The second was fixed in the
final fix wave all the same (issue #124), because a later fix would have moved every digest.

## Files

| File                                                                                | Responsibility                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/content/model/document.ts`                                     | `checkInlineContent`, the one walk over inline content, and `parseContentDocument` calling it            |
| `packages/domain/src/content/model/inline.ts`                                       | `crossReferenceTargetSchema` and the cross-reference node                                                |
| `packages/domain/src/content/model/identifier.ts`                                   | `nodeIdentifierSchema` and `artifactIdentifierSchema`, moved from the outline                            |
| `packages/domain/src/content/model/fixtures/v1/every-node.json`                     | Modified: the footnote's image removed (task 2); the cross-reference in the new shape, two arms (task 3) |
| `packages/domain/src/structure/outline.ts`                                          | Modified: the moved spellings imported; the title walk with home `title`; its refusal message            |
| `packages/domain/src/content/admission/reidentify.ts`, `report.ts`                  | A copied cross-reference's new identifier and its pointer; one report subject and one message changed    |
| `.../content/model/document.test.ts`, `inline.test.ts`, `canonical.test.ts`         | Tasks 1 to 3                                                                                             |
| `packages/domain/src/structure/outline.test.ts`                                     | Tasks 1 and 3: a title's identifiers and a title's cross-reference                                       |
| `packages/domain/src/content/admission/reidentify.test.ts`                          | Task 4                                                                                                   |
| `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts` | Regenerated in task 3: a section title's schema is in two operation bodies                               |
| `packages/trace/trace.json`, `src/trace.test.ts`, `src/parse/requirements.test.ts`  | Regenerated in every task; pins moved in task 5                                                          |
| `docs/specification/requirements/STR-...md`, `requirements/README.md`               | Task 5: STR-062's row, its change history, the count                                                     |
| `docs/design/structure.md`, `content-model.md`, `docs/architecture.md`              | Task 5                                                                                                   |
| `CLAUDE.md`, `docs/guides/reading-the-trace.md`                                     | Task 5: the requirement count, 1,366 to 1,367                                                            |
| `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, two `package.json`          | Task 5                                                                                                   |

No file in `packages/db`, `apps/service`, `packages/editor` or `apps/web` changes. All four suites
passed unchanged in the proof run.

## Requirements this plan cites, and those it does not

**No new citation is counted**, and the pin stays at 163. One requirement is added to the corpus,
STR-062, taking it from 1366 to 1367; two claims are added, STR-056 and STR-062, taking them from 359
to 361; and the final fix wave drops one, STR-026, which the built union answers only in part, leaving 360.

| ID          | Statement, in short                                                                     | Claimed by       | Cited in                                                  | Task | Pin                                       |
| ----------- | --------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- | ---- | ----------------------------------------- |
| **CNT-002** | Every block carries an identifier, unique within its component, never reused            | content-model.md | `content/model/document.test.ts`, a second title          | 1    | Unchanged: one citation per file per kind |
| **CNT-129** | A footnote holds a closed list of content, and no table or image                        | content-model.md | `content/model/document.test.ts`, its title made true     | 2    | Unchanged: the same title, reworded       |
| **CNT-027** | A cross-reference is an inline node carrying a target identity and a display, no answer | content-model.md | `content/model/inline.test.ts`, rewritten to the new node | 3    | Unchanged                                 |

**CNT-002 is the fix's own requirement**: its statement is uniqueness of a block's identifier within
its component, and a footnote's paragraph is a block. The test shows each case issue #122 names - a
body paragraph's identifier reused inside a footnote, two footnotes' paragraphs sharing one - and a
clean component accepted.

**Near misses, not cited:**

| ID               | Why not                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-132          | Re-identify already reaches a footnote's paragraphs, shown by its existing test; the fix is the parse's. A cross-reference is not a block, so task 4's test demonstrates something CNT-132 does not state |
| STR-026          | The target union is built without its `entry` arm (decision H), so a test cannot show "or a bibliography entry"; and no longer claimed either, since the final fix wave (decision H)                      |
| STR-032, STR-056 | "Able to target" is shown by resolving, not by parsing: the stored shape makes both representable, and structure 2's resolver test (structure.md, "Verification") cites them                              |
| STR-062          | New here, and about resolution. Cited by structure 2                                                                                                                                                      |
| STR-029, STR-055 | Unclaimed: the named failure is produced by STR's resolver and the publish that fails on it is PUB's. `id` and `withoutPages` are what make them answerable; nothing answers them yet                     |
| STR-053          | A node's identifier spelling is reused, not changed                                                                                                                                                       |
| CNT-011, CNT-012 | The canonical round trip and the fixture walk are exercised again; already cited, and neither changes                                                                                                     |

---

## Task 1: Every identifier inside a footnote is unique (issue #122)

**Files:**

- Modify: `packages/domain/src/content/model/document.ts`, `packages/domain/src/structure/outline.ts`
- Test: `packages/domain/src/content/model/document.test.ts`,
  `packages/domain/src/structure/outline.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: `footnoteContentSchema` from `./blocks.js`
- Produces: `checkInlineContent(inlines: readonly InlineNode[], seen: Set<string>): void`, replacing
  `refuseForbiddenFootnoteContent`. Task 3 adds a `home` parameter between the two.

- [ ] **Step 1: Check decision B's premise before anything is committed**

Against every database that has stored content - at least the development database - run this
read-only query. It counts, in each environment's schema, the versions and iterations whose content
holds a cross-reference or a footnote anywhere in its tree (an outline's section titles included):

```bash
docker compose -f deploy/compose.yaml exec -T postgres psql -U postgres -d alloy_dev <<'SQL'
do $$
declare
  t record;
  versions bigint;
  iterations bigint;
begin
  for t in select schema_name from platform.tenant order by schema_name loop
    execute format(
      $q$select count(*) from %I.artifact_version
         where jsonb_path_exists(content, 'strict $.**.type ? (@ == "crossReference" || @ == "footnote")')$q$,
      t.schema_name) into versions;
    execute format(
      $q$select count(*) from %I.iteration
         where jsonb_path_exists(content, 'strict $.**.type ? (@ == "crossReference" || @ == "footnote")')$q$,
      t.schema_name) into iterations;
    raise notice '% : % versions, % iterations', t.schema_name, versions, iterations;
  end loop;
end
$$;
SQL
```

Expected: a `NOTICE` per environment, every one `0 versions, 0 iterations`. **Anything else, stop**
and take it back to Ken: decision B becomes a second schema version, and this plan is rewritten. Say
in the pull request body which databases were checked.

- [ ] **Step 2: Write the failing tests**

In `packages/domain/src/content/model/document.test.ts`, after
`CNT-002 refuses two blocks sharing an identifier`:

```ts
it('CNT-002 keeps a block identifier unique across the whole component, footnotes included', () => {
  const noted = (id: string, footnoteId: string, inner: string) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [
      { type: 'text', value: 'Measured at noon.', marks: [] },
      {
        type: 'footnote',
        id: footnoteId,
        anchor: { kind: 'span' },
        content: [paragraph(inner, 'Local time.')],
      },
    ],
  });
  expect(() =>
    parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb2')])),
  ).not.toThrow();
  // A footnote's paragraph with a body paragraph's identifier - issue #122's own case.
  expect(() => parseContentDocument(doc([noted('b1', 'f1', 'b1')]))).toThrow(/b1/);
  // Two footnotes' paragraphs sharing one.
  expect(() =>
    parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb1')])),
  ).toThrow(/fb1/);
  // A footnote with a block's, which a reference to either would then name twice (STR-026).
  expect(() => parseContentDocument(doc([noted('b1', 'b2', 'fb1'), paragraph('b2')]))).toThrow(
    /b2/,
  );
  // Two footnotes sharing one.
  expect(() =>
    parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f1', 'fb2')])),
  ).toThrow(/f1/);
});
```

In `packages/domain/src/structure/outline.test.ts`, inside
`describe('a section title, under the content model rules', ...)`, after its one test:

```ts
it('keeps every identifier inside a title unique within that title, as a component keeps its own', () => {
  const second = { ...footnote([{ ...paragraph, id: 'p2' }]), id: 'f2' };
  expect(() => parseOutlineDocument(titled([words, footnote([paragraph]), second]))).not.toThrow();
  // Two footnotes sharing an identifier, and a footnote's paragraph sharing its footnote's.
  expect(() =>
    parseOutlineDocument(titled([words, footnote([paragraph]), { ...second, id: 'f1' }])),
  ).toThrow();
  expect(() =>
    parseOutlineDocument(titled([words, footnote([{ ...paragraph, id: 'f1' }])])),
  ).toThrow();
  // Two sections are two titles: the same footnote identifier in each is not a collision, because
  // anything in a title is reached through its node, as anything in a component is through its
  // occurrence.
  expect(() =>
    parseOutlineDocument({
      ...empty,
      nodes: [
        section(NODE, { title: [words, footnote([paragraph])] }),
        section(OTHER, { title: [words, footnote([paragraph])] }),
      ],
    }),
  ).not.toThrow();
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/content/model/document.test.ts src/structure/outline.test.ts
```

Expected: two failures, each `AssertionError: expected [Function] to throw an error` - the first at
`noted('b1', 'f1', 'b1')`, the second at the two footnotes sharing `f1`.

- [ ] **Step 4: Claim every identifier in one walk**

In `packages/domain/src/content/model/document.ts`, replace `refuseForbiddenFootnoteContent` and its
comment with:

```ts
/** Adds an identifier to those already held, refusing one already there (CNT-002). */
function claim(id: string, seen: Set<string>): void {
  if (seen.has(id)) throw new Error(`Identifier ${id} is used more than once in this component`);
  seen.add(id);
}

/**
 * The rules inline content is held to wherever it is stored, in one walk. The walk cannot live in
 * `inline.ts`, because a footnote holds blocks and a block holds inlines - so one of the two files
 * has to learn about the other after the fact, and this is that place.
 *
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here.
 * - **Every identifier inside is claimed in `seen`** - a footnote's own and each of its paragraphs' -
 *   so none can share one with a block or with anything else in what holds it (CNT-002, issue #122).
 *   A cross-reference targets a footnote by identity (STR-026), so one it shared would name two
 *   things.
 *
 * Exported because inline content is stored in more than one place: a section title in an outline
 * is inline content too (structure.md), and runs this same walk rather than a copy of it, so one rule
 * governs inline content wherever it is stored. Throws on the first breach.
 */
export function checkInlineContent(inlines: readonly InlineNode[], seen: Set<string>): void {
  for (const inline of inlines) {
    if (inline.type !== 'footnote') continue;
    claim(inline.id, seen);
    for (const paragraph of footnoteContentSchema.parse(inline.content)) {
      claim(paragraph.id, seen);
      checkInlineContent(paragraph.content, seen);
    }
  }
}
```

and in `parseContentDocument`, replace the first walk with:

```ts
const seen = new Set<string>();
walk(document.content, (block) => {
  claim(block.id, seen);
  if (block.type === 'paragraph') checkInlineContent(block.content, seen);
  if (block.type === 'blockquote' && block.attribution) {
    checkInlineContent(block.attribution, seen);
  }
  if (block.type === 'table' && block.note) checkInlineContent(block.note, seen);
});
```

The message changes from `Block identifier ...` to `Identifier ...`, because the identifier may now
be a footnote's. Nothing matches on the old words: the existing test matches `/b1/`.

In `packages/domain/src/structure/outline.ts`, import `checkInlineContent` in place of
`refuseForbiddenFootnoteContent`, and in `sectionTitleSchema` replace the `try` block with:

```ts
try {
  checkInlineContent(title, new Set());
} catch {
  context.addIssue({
    code: 'custom',
    message: 'A title holds inline content the content model refuses',
  });
}
```

A fresh set per title: a title's identifiers are unique within that title (the stored-shape check,
row 11). In the comment above `sectionTitleSchema`, change "applied by `refuseForbiddenFootnoteContent`"
to "applied by `checkInlineContent`", and add after that paragraph:

```ts
 * The same walk holds every identifier inside a title - a footnote's and its paragraphs' - unique
 * within that title. Anything in a title is reached through its node, as anything in a component is
 * through its occurrence, so the title is the scope, as the component is for a block.
```

- [ ] **Step 5: Run the domain suite**

```bash
pnpm --filter @alloy-works/domain test
```

Expected: 500 passed - 498 before, and the two above.

- [ ] **Step 6: Regenerate the trace and check it**

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

Expected: 296 passed. The citation count stays 163: `document.test.ts` already cites CNT-002.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/content/model/document.ts packages/domain/src/content/model/document.test.ts packages/domain/src/structure/outline.ts packages/domain/src/structure/outline.test.ts packages/trace/trace.json
git commit -m "Refuse an identifier used twice in a component, footnotes included"
```

---

## Task 2: A footnote holds what CNT-129 lists, and nothing else

**Files:**

- Modify: `packages/domain/src/content/model/document.ts`,
  `packages/domain/src/content/model/fixtures/v1/every-node.json`
- Test: `packages/domain/src/content/model/document.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: `checkInlineContent` from task 1
- Produces: no new name; `checkInlineContent` refuses an `image` or a `footnote` inside a footnote's
  paragraph

- [ ] **Step 1: File the issue**

It is a fix (decision D), so it starts as an issue describing what goes wrong:

```bash
gh issue create --title "A footnote can hold an image, or another footnote" --body-file - <<'EOF'
### What goes wrong

A component can be stored with an image inside a footnote, and with a footnote inside a footnote. The content rules say a footnote holds paragraphs of text and a closed list of things inside them, and that list names neither.

### How to reproduce

Save a component whose paragraph has a footnote, and put an inline image, or a second footnote, in the footnote's paragraph. It is accepted. A table in the same place is refused.

### What was expected

The same refusal for an image and for a footnote as for a table (CNT-129).

### Notes

Nothing in the product writes footnotes yet, so nothing stored is affected. That is why it is worth fixing now: once footnotes can be written, correcting this means migrating stored content. The test that names CNT-129 checks the table alone, and the content model's own stored example holds an image in a footnote.
EOF
```

Note its number for the pull request body.

- [ ] **Step 2: Rewrite the CNT-129 test so it shows what its title says**

In `packages/domain/src/content/model/document.test.ts`, replace
`CNT-129 admits no table and no image inside a footnote` whole with:

```ts
it('CNT-129 admits no table and no image inside a footnote, and nothing outside its closed list', () => {
  const noting = (content: unknown[]) => ({
    type: 'paragraph',
    id: 'b9',
    style: 'body',
    content: [{ type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content }],
  });
  const note = (inline: unknown) => ({
    type: 'paragraph',
    id: 'fb1',
    style: 'footnote',
    content: [{ type: 'text', value: 'See the appendix.', marks: [] }, inline],
  });
  const table = {
    type: 'table',
    id: 'b10',
    caption: 'x',
    headerRows: 0,
    headerColumns: 0,
    rows: [],
  };
  const image = {
    type: 'image',
    asset: 'asset-1',
    imageStyle: 'inline',
    alternative: { kind: 'decorative' },
  };
  const nested = {
    type: 'footnote',
    id: 'f2',
    anchor: { kind: 'span' },
    content: [paragraph('fb2')],
  };
  // A table in place of a paragraph; an image, and a footnote, inside a footnote's paragraph.
  expect(() => parseContentDocument(doc([noting([table])]))).toThrow();
  expect(() => parseContentDocument(doc([noting([note(image)])]))).toThrow(/image/);
  expect(() => parseContentDocument(doc([noting([note(nested)])]))).toThrow(/footnote/);
  // What the list does admit: a citation, an equation, a variable and a binding.
  for (const inline of [
    { type: 'citation', entry: 'bib-1' },
    { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
    { type: 'variable', name: 'productName' },
    { type: 'binding', query: 'query-1' },
  ]) {
    expect(() => parseContentDocument(doc([noting([note(inline)])]))).not.toThrow();
  }
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/content/model/document.test.ts
```

Expected: one failure, `AssertionError: expected [Function] to throw an error`, at the image.

- [ ] **Step 4: Refuse both inside the walk**

In `checkInlineContent`, replace the loop over a footnote's paragraphs with:

```ts
for (const paragraph of footnoteContentSchema.parse(inline.content)) {
  claim(paragraph.id, seen);
  for (const inner of paragraph.content) {
    if (inner.type === 'image' || inner.type === 'footnote') {
      throw new Error(`Footnote ${inline.id} holds a node a footnote may not: ${inner.type}`);
    }
  }
  checkInlineContent(paragraph.content, seen);
}
```

and in the comment above it, replace the first bullet with:

```ts
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here. Those
 *   paragraphs hold nothing outside CNT-129's closed list: no image, and no footnote - so the walk
 *   descends one footnote deep and no further, whatever it is given.
```

- [ ] **Step 5: Run the domain suite, and watch the fixture fail**

```bash
pnpm --filter @alloy-works/domain test
```

Expected: one failure, `CNT-012 migrates every fixture of every schema version to the current one`,
with `v1/every-node.json` and `Footnote f1 holds a node a footnote may not: image`. The permanent
fixture holds the counterexample (finding 1).

- [ ] **Step 6: Edit the fixture**

In `packages/domain/src/content/model/fixtures/v1/every-node.json`, the footnote's paragraph becomes
text alone:

```diff
               "content": [
                 {
                   "type": "text",
-                  "value": "A note on the span, with a decorative image ",
+                  "value": "A note on the span.",
                   "marks": []
-                },
-                {
-                  "type": "image",
-                  "asset": "asset-2",
-                  "imageStyle": "inline",
-                  "alternative": { "kind": "decorative" }
                 }
               ]
```

The fixture keeps an inline image elsewhere (`asset-1`), so the test that holds it to every
construct still passes. Editing a schema version's fixture is safe only on decision B's condition, which
task 1 step 1 checked.

- [ ] **Step 7: Run the domain suite and the trace**

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

Expected: 500 passed in the domain (the test was rewritten, not added); 296 in the trace, citations 163.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/content/model/document.ts packages/domain/src/content/model/document.test.ts packages/domain/src/content/model/fixtures/v1/every-node.json packages/trace/trace.json
git commit -m "Refuse an image or a footnote inside a footnote, as CNT-129's closed list says"
```

---

## Task 3: A cross-reference says what it points at

**Files:**

- Modify: `packages/domain/src/content/model/identifier.ts`, `inline.ts`, `document.ts`,
  `fixtures/v1/every-node.json`; `packages/domain/src/structure/outline.ts`
- Test: `packages/domain/src/content/model/inline.test.ts`, `document.test.ts`, `canonical.test.ts`;
  `packages/domain/src/structure/outline.test.ts`
- Modify: `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts`,
  `packages/trace/trace.json`

**Interfaces:**

- Consumes: `checkInlineContent` from tasks 1 and 2
- Produces: `crossReferenceTargetSchema` and the type `CrossReferenceTarget` from `inline.ts`;
  `nodeIdentifierSchema` and `artifactIdentifierSchema` from `identifier.ts`; the type
  `InlineHome = 'component' | 'title'` and
  `checkInlineContent(inlines: readonly InlineNode[], home: InlineHome, seen: Set<string>): void`
  from `document.ts`. None is added to the package's public surface, so `index.test.ts`'s pin does
  not move.

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/content/model/inline.test.ts`, replace
`CNT-027 carries a target and a display kind on a cross-reference, and no number` whole with:

```ts
it('CNT-027 carries a target identity and a display kind on a cross-reference, and no number or title', () => {
  const node = {
    type: 'crossReference',
    id: 'x1',
    target: { kind: 'block', block: 'b7' },
    display: 'numberAndTitle',
  };
  expect(inlineNodeSchema.parse(node)).toEqual(node);
  expect(() => inlineNodeSchema.parse({ ...node, number: 3 })).toThrow();
  expect(() => inlineNodeSchema.parse({ ...node, title: 'Figure 2' })).toThrow();
});
```

and before `CNT-123 refuses a dimension on an inline image`:

```ts
it('names what a cross-reference points at as one of three kinds, and never as a bare string', () => {
  const reference = (target: unknown) => ({
    type: 'crossReference',
    id: 'x1',
    target,
    display: 'number',
  });
  const component = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const node = 'a'.repeat(26);
  for (const target of [
    { kind: 'block', block: 'b7' },
    { kind: 'component', component, block: 'b7' },
    { kind: 'node', node },
  ]) {
    expect(inlineNodeSchema.parse(reference(target))).toMatchObject({ target });
  }
  // The bare identifier the node held until now, which resolves against whichever occurrence comes
  // first and says nothing when it is wrong.
  expect(() => inlineNodeSchema.parse(reference('b7'))).toThrow();
  // Closed: no occurrence on a block of this component, which the component cannot know, and no
  // fourth kind.
  expect(() =>
    inlineNodeSchema.parse(reference({ kind: 'block', block: 'b7', occurrence: node })),
  ).toThrow();
  expect(() => inlineNodeSchema.parse(reference({ kind: 'entry', entry: 'bib-1' }))).toThrow();
  // Each identity spelled as the product spells it.
  expect(() =>
    inlineNodeSchema.parse(
      reference({ kind: 'component', component: component.toUpperCase(), block: 'b7' }),
    ),
  ).toThrow();
  expect(() => inlineNodeSchema.parse(reference({ kind: 'node', node: 'Section-4' }))).toThrow();
  expect(() => inlineNodeSchema.parse(reference({ kind: 'block', block: '' }))).toThrow();
});

it('gives a cross-reference an identifier of its own, so a failure can name it', () => {
  const target = { kind: 'block', block: 'b7' };
  expect(
    inlineNodeSchema.parse({ type: 'crossReference', id: 'x1', target, display: 'number' }),
  ).toMatchObject({ id: 'x1' });
  expect(() =>
    inlineNodeSchema.parse({ type: 'crossReference', target, display: 'number' }),
  ).toThrow();
  expect(() =>
    inlineNodeSchema.parse({ type: 'crossReference', id: '', target, display: 'number' }),
  ).toThrow();
});

it('declares the form a page reference takes where there are no pages, and only on a page reference', () => {
  const reference = (over: Record<string, unknown>) => ({
    type: 'crossReference',
    id: 'x1',
    target: { kind: 'block', block: 'b7' },
    ...over,
  });
  for (const withoutPages of ['number', 'title', 'numberAndTitle']) {
    expect(inlineNodeSchema.parse(reference({ display: 'page', withoutPages }))).toMatchObject({
      withoutPages,
    });
  }
  // Declaring none is a state of its own: the publish fails where there are no pages (STR-055).
  expect(inlineNodeSchema.parse(reference({ display: 'page' }))).not.toHaveProperty('withoutPages');
  // Never a form that needs pages itself, and never on a reference that is not to a page.
  expect(() =>
    inlineNodeSchema.parse(reference({ display: 'page', withoutPages: 'page' })),
  ).toThrow();
  expect(() =>
    inlineNodeSchema.parse(reference({ display: 'page', withoutPages: 'relative' })),
  ).toThrow();
  expect(() =>
    inlineNodeSchema.parse(reference({ display: 'number', withoutPages: 'title' })),
  ).toThrow();
});
```

In `packages/domain/src/content/model/document.test.ts`, a new `describe` before
`describe('an equation, stored only as the MathML reader writes it', ...)`:

```ts
describe('a cross-reference, where a component holds one', () => {
  const COMPONENT = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const reference = (id: string, target: unknown) => ({
    type: 'crossReference',
    id,
    target,
    display: 'number',
  });
  const citing = (id: string, inlines: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: 'See ', marks: [] }, ...inlines],
  });

  it('keeps its identifier unique in the component, beside every block and footnote', () => {
    const own = { kind: 'block', block: 'b2' };
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', own), reference('x2', own)]), paragraph('b2')]),
      ),
    ).not.toThrow();
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('x1', own), reference('x1', own)])])),
    ).toThrow(/x1/);
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('b2', own)]), paragraph('b2')])),
    ).toThrow(/b2/);
    // Inside a footnote, too: the walk that claims a footnote's paragraphs claims what they hold.
    const noted = citing('b1', [
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [{ ...citing('fb1', [reference('x1', own)]), style: 'footnote' }],
      },
      reference('x1', own),
    ]);
    expect(() => parseContentDocument(doc([noted, paragraph('b2')]))).toThrow(/x1/);
  });

  it('reaches a block of its own component or of another, and never an outline node', () => {
    for (const target of [
      { kind: 'block', block: 'b2' },
      { kind: 'component', component: COMPONENT, block: 'b2' },
    ]) {
      expect(() =>
        parseContentDocument(doc([citing('b1', [reference('x1', target)]), paragraph('b2')])),
      ).not.toThrow();
    }
    // A node belongs to one document's outline, and a component is used in many.
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', { kind: 'node', node: 'a'.repeat(26) })])]),
      ),
    ).toThrow(/outline node/);
  });
});
```

In `packages/domain/src/structure/outline.test.ts`, inside
`describe('a section title, under the content model rules', ...)`, before task 1's test:

```ts
it('lets a cross-reference in a title target an outline node, and nothing a title cannot show', () => {
  const reference = (id: string, target: unknown) => ({
    type: 'crossReference',
    id,
    target,
    display: 'number',
  });
  const toNode = { kind: 'node', node: OTHER };
  expect(() => parseOutlineDocument(titled([words, reference('x1', toNode)]))).not.toThrow();
  // A block of "its own" component: a title is in no component.
  expect(() =>
    parseOutlineDocument(titled([words, reference('x1', { kind: 'block', block: 'b2' })])),
  ).toThrow();
  // Another component's block: an outline is answered with a component the reader may not read
  // withheld, and a title's reference would carry its identity past that (decision E).
  expect(() =>
    parseOutlineDocument(
      titled([words, reference('x1', { kind: 'component', component: COMPONENT, block: 'b2' })]),
    ),
  ).toThrow();
  // And its identifier is unique within the title.
  expect(() =>
    parseOutlineDocument(titled([words, reference('x1', toNode), reference('x1', toNode)])),
  ).toThrow();
});
```

In `packages/domain/src/content/model/canonical.test.ts`, at the end of
`describe('canonical serialisation', ...)`:

```ts
it('serialises a cross-reference and its target to one string whatever their member order, and reads it back', () => {
  const cited = (reference: Record<string, unknown>) =>
    parseContentDocument({
      ...base,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'See ', marks: [] }, reference],
        },
        {
          type: 'figure',
          id: 'b2',
          asset: 'asset-1',
          imageStyle: 'column-width',
          caption: 'Dose',
          alternative: { kind: 'decorative' },
        },
      ],
    });
  const one = cited({
    type: 'crossReference',
    id: 'x1',
    target: { kind: 'component', component: '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27', block: 'b2' },
    display: 'page',
    withoutPages: 'number',
  });
  const other = cited({
    withoutPages: 'number',
    display: 'page',
    target: { block: 'b2', component: '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27', kind: 'component' },
    id: 'x1',
    type: 'crossReference',
  });
  expect(canonicalise(one)).toBe(canonicalise(other));
  // What is stored is the canonical string; read back, it is the same document and the same string.
  const read = parseContentDocument(JSON.parse(canonicalise(one)));
  expect(read).toEqual(one);
  expect(canonicalise(read)).toBe(canonicalise(one));
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/content/model src/structure
```

Expected: eight failures - the four in `inline.test.ts`, the two in `document.test.ts`, the one in
`outline.test.ts` and the one in `canonical.test.ts` - each because the node refuses an `id` or an
object `target`, or because nothing yet refuses where a target stands.

- [ ] **Step 3: Move the two identifier spellings into the content model**

At the top of `packages/domain/src/content/model/identifier.ts`:

```ts
import { z } from 'zod';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * An outline node's identifier: 128 bits in the spelling `blockIdentifierFrom` fixes (structure.md,
 * "Identity"). Here rather than in `structure/` because a cross-reference names one too, and the
 * content model cannot import the outline, which is built on it.
 */
export const nodeIdentifierSchema = z
  .string()
  .regex(/^[a-z2-7]{26}$/, 'not an outline node identifier');

// Duplicates the wire contract's `LowercaseUuid` deliberately: `packages/domain` stays platform-free
// and does not depend on `packages/api-contract`, which is a service-side concern (routes, wire
// codes). One regex, defined twice on purpose, rather than a cross-package dependency for a pattern.
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An artifact's identifier, as an outline's component reference and a cross-reference name one. */
export const artifactIdentifierSchema = z.string().regex(LOWERCASE_UUID, 'not a lowercase uuid');
```

(the existing `const BASE32` line is the one kept). In `packages/domain/src/structure/outline.ts`,
delete the local `nodeIdentifier`, `LOWERCASE_UUID` and `artifactIdentifier` with their comments, and
import them under the names the file already uses:

```ts
import {
  artifactIdentifierSchema as artifactIdentifier,
  nodeIdentifierSchema as nodeIdentifier,
} from '../content/model/identifier.js';
```

- [ ] **Step 4: The node and its target**

In `packages/domain/src/content/model/inline.ts`, import the spellings:

```ts
import { artifactIdentifierSchema, nodeIdentifierSchema } from './identifier.js';
```

and replace `crossReferenceNodeSchema` and its comment with:

```ts
/**
 * What a cross-reference points at (STR-026): a closed union, each kind naming an identity and never
 * a position, and none naming an answer (STR-028).
 *
 * - `block`: a block or a footnote of the component the reference is stored in. It carries no
 *   occurrence, because a component does not know where it is placed: resolution binds it to the
 *   occurrence being read, so one stored "see Figure 2" is Figure 2 in one place and Figure 7 in
 *   another (STR-056).
 * - `component`: a block or a footnote of another component, resolved against that component's one
 *   occurrence in the resolving document - and failed by name, never guessed, where it has none or
 *   several (STR-062). Named by the component rather than by an occurrence so that the reference
 *   survives the component being used in a second document.
 * - `node`: an outline node, which only a section title may hold.
 *
 * Which kind may stand where is `checkInlineContent`'s rule, not this schema's, because the schema
 * does not know whether it is parsing a component or a title. A bibliography entry (STR-026) is not
 * here until LIB says what an entry's identity is; adding a kind changes nothing stored.
 */
export const crossReferenceTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('block'), block: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('component'),
    component: artifactIdentifierSchema,
    block: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('node'), node: nodeIdentifierSchema }),
]);

export type CrossReferenceTarget = z.infer<typeof crossReferenceTargetSchema>;

/** The forms a reference to a page may fall back to where the output has no pages (STR-055). */
const withoutPagesForms = ['number', 'title', 'numberAndTitle'] as const;

/**
 * CNT-027: a target and what to display, never a resolved number or title. `id` is the reference's
 * own, unique in what holds it, so the failure STR-029 requires can name the reference as well as its
 * target. `withoutPages` is STR-055's declared alternative, and only a page reference carries one:
 * absent there means none was declared, and the publish fails in an output with no pages.
 */
export const crossReferenceNodeSchema = z
  .strictObject({
    type: z.literal('crossReference'),
    id: z.string().min(1),
    target: crossReferenceTargetSchema,
    display: z.enum(['number', 'title', 'numberAndTitle', 'page', 'relative']),
    withoutPages: z.enum(withoutPagesForms).optional(),
  })
  .refine((node) => node.withoutPages === undefined || node.display === 'page', {
    message: 'Only a reference to a page declares a form for an output with no pages',
    path: ['withoutPages'],
  });
```

A refined strict object still stands in `inlineNodeSchema`'s discriminated union in zod 4 - measured.

- [ ] **Step 5: Where each kind may stand**

In `packages/domain/src/content/model/document.ts`, give `checkInlineContent` a home. Replace the
function and its comment with:

```ts
/**
 * The rules inline content is held to wherever it is stored, in one walk. The walk cannot live in
 * `inline.ts`, because a footnote holds blocks and a block holds inlines - so one of the two files
 * has to learn about the other after the fact, and this is that place.
 *
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here. Those
 *   paragraphs hold nothing outside CNT-129's closed list: no image, and no footnote - so the walk
 *   descends one footnote deep and no further, whatever it is given.
 * - **Every identifier inside is claimed in `seen`** - a footnote's own, each of its paragraphs', and
 *   a cross-reference's - so none can share one with a block or with anything else in what holds it
 *   (CNT-002, issue #122). A cross-reference targets a footnote by identity (STR-026), so one it
 *   shared would name two things.
 * - **A cross-reference targets only what its home can reach.** In a component, never an outline
 *   node: a node belongs to one document's outline, and a component is used in many. In a section
 *   title, an outline node alone: a title is in no component, and an outline is answered with a
 *   component the reader may not read withheld, which a title's reference would carry past.
 *
 * Exported because inline content is stored in more than one place: a section title in an outline
 * is inline content too (structure.md), and runs this same walk rather than a copy of it, so one rule
 * governs inline content wherever it is stored. Throws on the first breach.
 */
export function checkInlineContent(
  inlines: readonly InlineNode[],
  home: InlineHome,
  seen: Set<string>,
): void {
  for (const inline of inlines) {
    if (inline.type === 'crossReference') {
      claim(inline.id, seen);
      if (home === 'component' && inline.target.kind === 'node') {
        throw new Error(`Cross-reference ${inline.id} in a component targets an outline node`);
      }
      if (home === 'title' && inline.target.kind !== 'node') {
        throw new Error(`Cross-reference ${inline.id} in a title targets what a title cannot name`);
      }
    }
    if (inline.type !== 'footnote') continue;
    claim(inline.id, seen);
    for (const paragraph of footnoteContentSchema.parse(inline.content)) {
      claim(paragraph.id, seen);
      for (const inner of paragraph.content) {
        if (inner.type === 'image' || inner.type === 'footnote') {
          throw new Error(`Footnote ${inline.id} holds a node a footnote may not: ${inner.type}`);
        }
      }
      checkInlineContent(paragraph.content, home, seen);
    }
  }
}

/** Where inline content is stored, which decides what a cross-reference in it may target. */
export type InlineHome = 'component' | 'title';
```

In `parseContentDocument`'s first walk, pass `'component'` as the second argument of each of the three
calls. In `packages/domain/src/structure/outline.ts`'s `sectionTitleSchema`, the call becomes
`checkInlineContent(title, 'title', new Set())`, and its comment's paragraph "What a heading may hold"
gains a sentence:

```ts
 * A cross-reference in a heading targets an outline node and nothing else (`checkInlineContent`).
```

- [ ] **Step 6: The fixture, in the new shape**

In `packages/domain/src/content/model/fixtures/v1/every-node.json`, replace the cross-reference with
two, one per kind a component may hold, one of them a page reference declaring its alternative:

```diff
-        { "type": "crossReference", "target": "b4", "display": "numberAndTitle" },
+        {
+          "type": "crossReference",
+          "id": "x1",
+          "target": { "kind": "block", "block": "b4" },
+          "display": "page",
+          "withoutPages": "numberAndTitle"
+        },
+        {
+          "type": "crossReference",
+          "id": "x2",
+          "target": {
+            "kind": "component",
+            "component": "7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27",
+            "block": "b1"
+          },
+          "display": "number"
+        },
```

- [ ] **Step 7: Run the domain suite and the typecheck**

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/domain typecheck
```

Expected: 507 passed - 500, and the seven new tests (the rewritten CNT-027 test is not new); no type
errors.

- [ ] **Step 8: Regenerate the contract and the client**

A section title's schema is inside the insert and retitle bodies, so `openapi.json` gains the node's
`id`, its target's three kinds and `withoutPages`, in two places.

```bash
pnpm --filter @alloy-works/domain build
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/api-client test
pnpm typecheck
```

Expected: 25 passed and 4 passed; before `generate`, the contract's drift check fails, which is the
check working. `pnpm typecheck` is clean across every workspace.

- [ ] **Step 9: Regenerate the trace and commit**

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
git add packages/domain/src packages/api-contract/openapi.json packages/api-client/src/generated/schema.ts packages/trace/trace.json
git commit -m "Give a cross-reference an identifier, a target that says what it names, and a form without pages"
```

Expected: 296 passed; citations still 163.

---

## Task 4: Copying a cross-reference

**Files:**

- Modify: `packages/domain/src/content/admission/reidentify.ts`,
  `packages/domain/src/content/admission/report.ts`
- Test: `packages/domain/src/content/admission/reidentify.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: the node from task 3
- Produces: a report subject `crossReferenceTarget` under `rewritten`

- [ ] **Step 1: Write the failing test**

In `packages/domain/src/content/admission/reidentify.test.ts`, before
`gives every mark a new identifier, and the fragments of one annotation one between them`:

```ts
it('gives a cross-reference a new identifier, and points one at the copy of what it refers to', () => {
  const component = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const reference = (id: string, target: unknown) => ({
    type: 'crossReference',
    id,
    target,
    display: 'number',
  });
  const figure = {
    type: 'figure',
    id: 'old-figure',
    asset: 'asset-1',
    imageStyle: 'column-width',
    caption: 'Dose',
    alternative: { kind: 'decorative' },
  };
  const { outcome, entries } = run({
    schemaVersion: 1,
    content: [
      // The references come before the figure they point at, so pointing them is a second pass.
      paragraph('old-paragraph', [
        text('See '),
        reference('old-x1', { kind: 'block', block: 'old-figure' }),
        reference('old-x2', { kind: 'block', block: 'not-copied' }),
        reference('old-x3', { kind: 'component', component, block: 'old-figure' }),
      ]),
      figure,
    ],
  });
  expect(outcome).toEqual({
    ok: true,
    value: {
      schemaVersion: 1,
      content: [
        paragraph('n3', [
          text('See '),
          // Its block travelled with it, so it points at the copy.
          reference('n4', { kind: 'block', block: 'n7' }),
          // Its block did not travel: left as it stands, for resolution to name as missing.
          reference('n5', { kind: 'block', block: 'not-copied' }),
          // Another component's block: nothing here renames another component's identifiers.
          reference('n6', { kind: 'component', component, block: 'old-figure' }),
        ]),
        { ...figure, id: 'n7' },
      ],
    },
  });
  expect(entries).toEqual([
    { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 5 },
    { stage: 'reidentify', action: 'rewritten', subject: 'crossReferenceTarget', count: 1 },
  ]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/content/admission/reidentify.test.ts
```

Expected: one failure, `AssertionError: expected { ok: true, value: { …(2) } } to deeply equal ...` -
the references kept `old-x1`, `old-x2` and `old-x3`, and the count was 2.

- [ ] **Step 3: A new identifier, and a pointer moved in a second pass**

In `packages/domain/src/content/admission/reidentify.ts`, add two members to `State`:

```ts
  /** Each block's and footnote's new identifier, by the one it arrived with. */
  readonly renamed: Map<string, string>;
  /** Every cross-reference written, to be pointed once every block has its new identifier. */
  readonly references: Record<string, unknown>[];
```

initialise them in `reidentify` as `renamed: new Map(), references: []`, and after the content is
mapped:

```ts
const content = mapArray(candidate.content, (block) => reidentifyBlock(block, state));
const repointed = repoint(state);
if (state.blocks > 0) {
  report.add('reidentify', 'rewritten', 'blockIdentifier', { count: state.blocks });
}
if (repointed > 0) {
  report.add('reidentify', 'rewritten', 'crossReferenceTarget', { count: repointed });
}
```

After the `State` type:

```ts
/**
 * A cross-reference to a block of its own component that travelled with it is pointed at the copy,
 * so a figure pasted with the sentence citing it is cited by the copy of that sentence. The second
 * pass, because a reference can come before the block it names. A reference whose block did not
 * travel is left as it stands - resolution names it as missing (STR-029) - and so is one naming
 * another component's block, whose identifiers nothing here renames. Returns how many were pointed.
 */
function repoint(state: State): number {
  let count = 0;
  for (const reference of state.references) {
    const target = asRecord(reference.target);
    if (target?.kind !== 'block' || typeof target.block !== 'string') continue;
    const block = state.renamed.get(target.block);
    if (block === undefined) continue;
    reference.target = { ...target, block };
    count += 1;
  }
  return count;
}
```

In `reidentifyBlock`, after `state.blocks += 1;`:

```ts
if (typeof block.id === 'string') state.renamed.set(block.id, out.id as string);
```

In `reidentifyInline`, before the footnote branch:

```ts
if (inline.type === 'crossReference') {
  const out: Record<string, unknown> = { ...inline, id: allocate(state) };
  state.blocks += 1;
  state.references.push(out);
  return [out];
}
```

and in the footnote branch, after `state.blocks += 1;`:

```ts
if (typeof inline.id === 'string') state.renamed.set(inline.id, id);
```

In the stage's comment, the first bullet becomes "**Every block, every footnote and every
cross-reference gets a new identifier** (CNT-132) ..." and gains "A cross-reference whose block
travelled with it is pointed at the copy." `repoint` mutates only objects this stage has just made.

- [ ] **Step 4: The report**

In `packages/domain/src/content/admission/report.ts`, under `rewritten`:

```ts
    blockIdentifier:
      'Blocks, footnotes and cross-references were given new identifiers, so they cannot be mistaken for the ones they were copied from.',
    crossReferenceTarget:
      'Cross-references copied with what they refer to were pointed at the copy.',
```

No test matches a message's words: the report's tests strip `message`.

- [ ] **Step 5: Run the domain suite, regenerate the trace, commit**

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
git add packages/domain/src/content/admission packages/trace/trace.json
git commit -m "Re-identify a copied cross-reference, and point it at the copy of what travelled with it"
```

Expected: 508 passed in the domain; 296 in the trace.

---

## Task 5: STR-062, the claims, the docs and the release

**Files:**

- Modify: `docs/specification/requirements/STR-structure-numbering-and-cross-references.md`,
  `docs/specification/requirements/README.md`, `CLAUDE.md`, `docs/guides/reading-the-trace.md`
- Modify: `docs/design/structure.md`, `docs/design/content-model.md`, `docs/architecture.md`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/src/parse/requirements.test.ts`,
  `packages/trace/trace.json`
- Modify: `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`

- [ ] **Step 1: Land STR-062**

`pnpm trace next STR` answers `STR-062`. In the STR document's section 6, after STR-055's row:

```markdown
| **STR-062** | A cross-reference to a block must resolve against exactly one outline occurrence of that block's component: the occurrence it is read in, for a block of its own component (STR-056), and otherwise the one occurrence of that component in the resolving document. Where there is none, or more than one, it must fail with a named error (STR-029) rather than resolve against the first occurrence or against the block identifier alone | T1 | Specified |
```

and after the section's prose on STR-056, a paragraph:

```markdown
**STR-062 says what "the occurrence" means for a block.** CNT-002 scopes a block identifier to its
component and STR-056 resolves a reference into its own component against the occurrence the reader
is in, so one identifier appears once per occurrence and on its own names nothing. What the stored
reference holds cannot be the pair: a component does not know where it is placed. The pair is what
resolution looks up, and where it cannot find exactly one, it says so.
```

At the end of section 14:

```markdown
### From planning the third content-model plan

Not a review. [Issue #73](https://github.com/kenhayward/alloy-works/issues/73), filed while designing
the content model, was landed by
[the third content-model plan](../../plans/2026-09-18-content-model-03-footnotes-and-cross-references.md),
reworded.

| What was found                                                                                                                                                      | Change                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A block identifier on its own does not name a target in a document holding its component twice, and resolving one against the first occurrence fails without a word | **STR-062**: a cross-reference to a block resolves against exactly one occurrence, or fails by name                                                                                                                            |
| The issue asked that the target be _identified_ by the pair of occurrence and block, never by the block identifier alone                                            | Reworded to _resolve_: a reference into its own component can store nothing but the block identifier, because a component does not know where it is placed (STR-056), so the pair is what resolution finds, not what is stored |

| Counts           | Before                    | After                     |
| ---------------- | ------------------------- | ------------------------- |
| Requirements     | 61, of which 3 superseded | 62, of which 3 superseded |
| Non-requirements | 5                         | 5                         |
| Open questions   | 4                         | 4                         |
```

The requirement count becomes 1367 in the index's status line, in `CLAUDE.md` ("There are 1,367
requirements") and in the three places `docs/guides/reading-the-trace.md` says 1,366.

- [ ] **Step 2: Claim STR-056 and STR-062, and correct STR-032's row**

In `docs/design/structure.md`'s "Requirements owned", STR-032's row becomes:

```markdown
| **STR-032** | A `block` target reaches a block or footnote of the reference's own component; a `component` target reaches one of another component of the same document |
```

and after it, two rows:

```markdown
| **STR-056** | A `block` target carries no occurrence, and resolution binds it to the occurrence being read, so one stored reference resolves once per occurrence |
| **STR-062** | Resolution binds a `block` target to the occurrence being read and a `component` target to that component's one occurrence, and returns a failure naming the reference and its target where there are none or several - never the first |
```

"Forty claims above" becomes "Forty-two claims above". In the "Left unclaimed" row for STR-029,
STR-030 and STR-055, "STR-055 needs a member the content model has no room for yet" becomes "STR-055's
member exists (`withoutPages`), and rendering it is the publisher's". Below the claims table, one
sentence: "STR-026 stays claimed although the built target union has no bibliography entry yet: LIB
has not said what an entry's identity is, and adding the kind changes nothing stored."

- [ ] **Step 3: The rest of structure.md**

Replace the first four paragraphs of "What this design needs from the content model, and from the
corpus" - the target, the identifier, STR-055's member and the footnote's identifier - with:

```markdown
**Built by [the third content-model plan](../plans/2026-09-18-content-model-03-footnotes-and-cross-references.md).**
A cross-reference carries an identifier of its own, unique in its component, so a failure can name
the reference and its target (STR-029); a target that is a closed union of `block`, `component` and
`node`; and `withoutPages`, STR-055's declared alternative on a page reference. Every identifier in a
component - a block's, a footnote's, a footnote paragraph's and a cross-reference's - is unique within
it, and a footnote holds no image and no footnote. The plan changed the target this design first
drew, `{ block, occurrence? }`: an occurrence exists in one outline, so a component that named one
would reach another component's block in one document only, and the product is for reuse.
```

and in "Cross-references", replace the target table and the paragraph after it with:

```markdown
| Kind                                      | Reaches                                                                                                | May stand in    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| `{ kind: 'block', block }`                | A block or footnote of the component the reference is in, in the occurrence being read                 | A component     |
| `{ kind: 'component', component, block }` | A block or footnote of another component, in that component's one occurrence in the resolving document | A component     |
| `{ kind: 'node', node }`                  | An outline node - a section, or a component reference's own heading                                    | A section title |

**A `block` target has no occurrence, and means the one being read.** That single rule answers STR-056
and STR-028 together: a component saying "see Figure 2" resolves to Figure 2 in one place and Figure 7
in another, which is what STR-021 makes true of the numbers. **A `component` target names the
component, not an occurrence of it**, so it survives the component being used in a second document;
where the resolving document holds that component in no occurrence or in several, resolution fails by
name rather than taking the first (STR-062). A way to say which of several - a key held in the
outline, as DITA's keys are - is a widening for later. **A title's reference names a node and nothing
else**: a title is in no component, and a `component` target in a title would carry a component's
identity past the withholding "Who is shown what" requires. A bibliography entry (**LIB**) joins the
union when LIB says what an entry's identity is.
```

- [ ] **Step 4: content-model.md**

CNT-027's row: "`crossReference` carries an identifier of its own, a target identity - a closed union
of a block of its own component, a block of another, or an outline node - and a display kind, and has
no member for a number or a title". CNT-129's row: "Footnote content is paragraphs, holding no table,
no image and no footnote". In "Two things this document requires of STR", the second bullet becomes:

```markdown
- **A cross-reference to a block is resolved against an occurrence and a block together, and never
  against the block identifier alone.** CNT-002 scopes a block identifier to its component,
  deliberately, because STR-056 requires a component referenced twice to resolve "see Figure 2"
  against the occurrence the reader is in. STR-062 now says so; the stored target says which kind of
  block it means, and resolution finds the occurrence.
```

In "Identity", after the paragraph on blocks:

```markdown
**Every identifier in a component shares one namespace.** A block's, a footnote's, a footnote
paragraph's and a cross-reference's are unique together within the component, because a
cross-reference names a block or a footnote by identity (STR-026) and one shared would name two things.
The parse first checked blocks alone, which left a footnote's out (issue #122).
```

- [ ] **Step 5: docs/architecture.md**

In the content model's file table: `inline.ts` - "Eight inline nodes, a cross-reference's closed
target union, and the three-state alternative a figure or an image carries"; `identifier.ts` -
"`blockIdentifierFrom`, over bytes the caller supplies, and the two identifier spellings a
cross-reference names - an outline node's and an artifact's". The paragraph "Every document goes
through `parseContentDocument`" becomes:

```markdown
**Every document goes through `parseContentDocument`.** Four rules live there rather than in the
schema, because each is a property of a document rather than of a node, and all four run in one walk
over inline content, `checkInlineContent`, which a section title runs too: every identifier - a
block's, a footnote's, a footnote paragraph's and a cross-reference's - is unique within the component;
two adjacent empty paragraphs are refused while one is admitted; a footnote's content is paragraphs
holding no image and no footnote; and a cross-reference in a component never targets an outline node,
while one in a section title targets nothing else.
```

The admission table's `reidentify.ts` row: "A new identifier for every block, footnote,
cross-reference and mark, a copied cross-reference pointed at the copy of a block that travelled with
it; comments, suggestions and conditions without an axis dropped". In the structure section, where a
title is held to the walk `parseContentDocument` runs, add: "and every identifier inside a title is
unique within it".

- [ ] **Step 6: The pins**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show STR-062
pnpm trace show STR-056
```

Expected: `No problems in the corpus.`; STR-062 and STR-056 `Designed`, claimed by structure.md and
cited by nothing. Then in `packages/trace/src/trace.test.ts`, `toHaveLength(1366)` becomes `1367`,
with the comment line "1367, from 1366: STR-062, a cross-reference to a block resolving against
exactly one occurrence (issue #73), landed by the third content-model plan."; `toBe(359)` becomes
`361`, with "361, from 359: structure.md claims STR-062, and STR-056, which it had always answered
("A `block` target has no occurrence") and neither claimed nor listed as unclaimed."; and the citation
pin stays 163, with "163 still: the third content-model plan's CNT-002 test sits in a file that
already cites CNT-002, and a file cites an identifier once." In
`packages/trace/src/parse/requirements.test.ts`, `toBe(1366)` becomes `1367`, with "1367, from 1366:
STR-062 (issue #73)." Run `pnpm --filter @alloy-works/trace test`: 296 passed.

- [ ] **Step 7: Pass the gate**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm test
pnpm trace verify
pnpm trace gate
```

`pnpm trace gate` refuses without the worker's and the object store's reports, so the whole
`pnpm test` has to have run.

- [ ] **Step 8: The plans index, the version and the changelog**

In `docs/plans/README.md`, this plan's row becomes `Built (PR #n)` once the number is known, and the
prose below the content model's table gains a paragraph in the shape plans 1 and 2 have: what is built,
and what is left (below). `version.json`, the root `package.json` and `apps/desktop/package.json`
become `0.27.1`. At the top of `CHANGELOG.md`:

```markdown
## 0.27.1 - YYYY-MM-DD (PR #n)

### Fixed

- A component can no longer be saved with two things sharing one identifier when one of them is
  inside a footnote. Every identifier in a component is now unique, footnotes included.
- A footnote can no longer hold an image or another footnote, as the content rules always said.

### Changed

- A cross-reference now carries an identifier of its own, says whether it points at something in its
  own component, in another component, or at a section of the document, and a reference to a page can
  say what to show instead where there are no pages. Nothing in the product writes cross-references or
  footnotes yet, so nothing you have made changes.
```

- [ ] **Step 9: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs CHANGELOG.md CLAUDE.md packages/domain packages/trace
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.27.1: footnote identity, and the cross-reference target"
git push -u origin <branch>
gh pr create --base main --title "Footnote identity, and what a cross-reference points at"
```

The pull request body says what changed for a person - nothing they can see, and why it matters -
names the databases task 1 step 1 checked and what they counted, says that STR-056 and STR-062 are
claimed and cited by nothing until structure 2's resolver, and carries each closing line on its own:

```
Fixes #122
Fixes #<task 2's issue>
Fixes #73
```

Then fill the changelog heading's `YYYY-MM-DD (PR #n)` and the plans index's `Built (PR #n)` with the
date and the number `gh pr create` printed, commit, push, and after the merge check that all three
issues closed.

---

## What this plan deliberately leaves undone

| Left                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Whose                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Resolving a target, the named failure, and what a reader who may not read the target is shown      | It reads a numbering table that does not exist; STR-056, STR-062 and STR-032 are cited there                                                                                                                                                                                                                                                                                                                                                                                                                          | **Structure 2, numbering**                                                   |
| Checking a `component` target at write: exists, readable by the author, not the holder             | Decision G: a write-time rule, so adding it later refuses nothing stored                                                                                                                                                                                                                                                                                                                                                                                                                                              | **The plan that first authors a cross-reference**                            |
| Saying which of several occurrences a `component` target means                                     | A key held in the outline is a widening; until then two occurrences fail by name                                                                                                                                                                                                                                                                                                                                                                                                                                      | **A later structure plan, when a document needs it**                         |
| A bibliography entry as a target                                                                   | Decision H: LIB has not said what an entry's identity is                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **LIB's plan**                                                               |
| A `component` target in a section title                                                            | Decision E: it would carry a component's identity past the outline's withholding                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Whichever plan withholds a title's references**                            |
| Bounding a block tree's depth on every write path, not only in admission                           | Finding 11: not this plan's hole. Filed as issue #125, for the same reason structure 1 bounded an outline at 64                                                                                                                                                                                                                                                                                                                                                                                                       | **A small content-model fix**                                                |
| Pasting a cross-reference **between** components                                                   | Found by the final review. A `block` target whose block did not travel keeps naming the source's block, and resolves in the receiver - to nothing, or to a block of the same name there; a `component` target pasted into the component it names becomes a self-reference. The likely answer: the clipboard writer turns each `block` target into a `component` target naming the source, and admission, given the receiving component's identifier, turns a `component` target naming the receiver back into `block` | **The authoring plan**                                                       |
| A component's reference to a section                                                               | Found by the final review. A `node` target stands in a section title alone (decision E), so body text cannot say "see Section 4.2", the most common cross-reference there is; with the missing entry arm, why structure.md no longer claims STR-026. Likely an arm meaning the heading of the node that places the component, resolved per occurrence; an addition to the union, changing nothing stored                                                                                                              | **Structure 2, numbering, or the plan that first authors a cross-reference** |
| Authoring a footnote or a cross-reference                                                          | The editor writes paragraphs alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **The editor's plans**                                                       |
| Refusing a `condition`, `language`, `comment` or `suggestion` mark inside a footnote               | Ruled while building: CNT-129's closed list names character marks and hyperlinks, and these four are admitted because they annotate text rather than add content. If that is wrong, the rule is the walk's, added before a footnote is writable, so it refuses nothing stored                                                                                                                                                                                                                                         | **Nobody, unless CNT-129 is read otherwise**                                 |
| Refusing a NUL or a lone surrogate in a component's content, which answers `500` rather than `400` | Found while building (issue #127): the insert into `jsonb` fails. Not this plan's hole, and nothing a later rule would refuse can be stored by it                                                                                                                                                                                                                                                                                                                                                                     | **A small content-model fix**                                                |
| Cleaning up after an interrupted database test run, which leaves its databases and roles behind    | Found while building (issue #126); the leftovers were dropped by hand                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **A test-infrastructure fix**                                                |
