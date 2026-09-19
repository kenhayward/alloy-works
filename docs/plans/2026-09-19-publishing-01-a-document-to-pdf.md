# Publishing 1: a document to PDF

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who may publish a document presses **Publish as PDF** on its page and, a second or
two later, is handed a tagged PDF of the version they were looking at - its outline as headings
numbered by the same `number` the outline panel uses, each component's paragraphs beneath its
reference, every page saying **Not approved** - kept for ever as an immutable publication in the
document's space, listed beneath the outline and opened at `#/publications/{id}` with a download.
Where the document cannot be published, the author is told every reason at once, each at its place in
the outline, and a component the publisher may not read is named by where it is and never by what it
is. Nothing an author could fix is ever retried, and nothing is set in a typeface the product did not
pin.

**Architecture:** `packages/domain` gains `src/publishing/`: the published document (`publishing/1`),
the closed failure vocabulary, and `assemble` - one pure function from the recorded inputs to the
published document or to every failure, which checks every character against the pinned faces before
the engine runs. `packages/db` gains migration 0017 (a `publication` artifact kind, the Publisher
starter role, the operational `publication_request` and four insert-only tables), `resolveOccurrences`
and `requestPublication` (decided at the request, as the publisher, restricted to what they may read in
the query), and the record, read and listing. `apps/worker` gains the pinned Liberation Serif faces
and a character-map reader (#145), `JobRefused` (#146), `templates/publication/1/`, `jobs/publish.ts`,
and a regression corpus checked by veraPDF in a pinned container. `packages/api-contract` and
`apps/service` gain four routes; `apps/web` gains the publishing panel on the document page and the
publication's own page. Nothing goes on the stream (#147).

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
Typst 0.15.1 pinned by hash, Liberation Serif 2.1.5 (SIL OFL 1.1) pinned by hash, veraPDF 1.30.2 in
`verapdf/cli` pinned by digest, React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17, Fastify 5, Vitest 5
with jsdom for the renderer. One new dev dependency: `pdfjs-dist` in `apps/worker`, to read a PDF as a
reader and assistive technology meet it. One new workspace dependency: `apps/worker` on
`@alloy-works/domain`.

**Spec:** [`../design/publishing.md`](../design/publishing.md), as Ken's answer (2026-09-19, commit
`59a8401`) amended it - "The shape in one paragraph", "Who may publish", "The published document",
"The request and the job", "Failure, retry, and what an author sees", "Reproducibility", "Stores",
"Routes" and build order slice 1 - read with [access.md](../design/access.md) ("Permissions", which now
says publishing releases content), [structure.md](../design/structure.md) ("Numbering"),
[ADR-0010](../decisions/0010-open-licence-typefaces-only.md),
[ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md),
[ADR-0019](../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md), and issues
[#142](https://github.com/kenhayward/alloy-works/issues/142),
[#143](https://github.com/kenhayward/alloy-works/issues/143),
[#145](https://github.com/kenhayward/alloy-works/issues/145),
[#146](https://github.com/kenhayward/alloy-works/issues/146) and
[#147](https://github.com/kenhayward/alloy-works/issues/147).

First of the publishing plans. It builds the design's slice 1, lands #142 and #143 as rows, fixes #145
and #146, and makes #147 no worse. **One plan, one pull request**, closing all four issues: the slice is
large - eleven tasks - but its halves are not separately useful. Split at task 4, the first half would
land an engine with no way to ask it for anything, and the second would carry the whole behaviour
anyway. If Ken wants two pull requests, the seam is after task 4, and the first carries 0.29.1 and
closes #145 and #146 alone.

**The code below was run before the plan was committed.** It was written in a throwaway worktree of
this branch at `59a8401`, at a short path (`D:/awp1`), against the compose Postgres on 127.0.0.1:5432
through the suites' own `aw_test_*` databases and the compose SeaweedFS - never the development
database, and no running container was stopped or restarted. Measured on Windows 11, an Intel Core
Ultra 7 270K Plus (24 threads), Node 24.16, Docker Desktop:

- **veraPDF on nine heading levels (task 1).** The pinned Typst compiles nine nested headings under
  `--pdf-standard ua-1`, and veraPDF 1.30.2's PDF/UA-1 profile passes it: **106 rules passed, 0
  failed, 1522 checks**, compliant - through a standalone case and again through the publication
  template with the pinned fonts. **But Typst writes levels seven to nine as `H7`, `H8` and `H9`
  role-mapped to `P`**: the structure tree pdf.js and pikepdf both read has `H1` to `H6` and then
  paragraphs. The bookmarks nest nine deep, numbers and all. So the machine rules pass at every depth
  STR-007 asks for, and a screen reader is told levels seven to nine are paragraphs (decision A).
- **The glyph check against the engine (tasks 4 and 7).** Fifteen probe characters were put through
  `assemble` and, separately, straight through the template and the pinned Typst under PDF/UA-1 with
  only Liberation Serif available. Typst refused Arabic, a CJK ideograph, an emoji, a private-use
  character, a C0 control and a byte-order mark between two capitals; it set a tab, a line break, a
  line separator, a non-breaking hyphen the face does not map, a zero-width space, a soft hyphen, a
  variation selector, a combining accent and Hebrew. `assemble` refuses exactly the first six and
  nothing else - and a byte-order mark everywhere, because Typst refuses one between `B` and `C` and
  sets one between `a` and `b` (finding 3).
- **The whole job (task 7).** A document of two chapters, a component and a subsection, requested
  through the store, claimed by `processNext`, assembled, compiled, stored and recorded in **385 ms**;
  the PDF's bookmarks are the outline with its numbers, it is marked tagged and PDF/UA part 1, its
  title and language are the document's, **Not approved** is an artifact on every page and the
  sentence is tagged text once, and `#panic("x") ] [ * _ $` came out as words. A document with an
  Arabic letter and a component the publisher may not read failed **once**, with both failures and no
  character in the log; a store that refused the PDF was retried twice and left **no publication and no
  artifact**; compiling the recorded inputs again gave the stored bytes exactly.
- **A larger document.** Thirty chapters of ten references each - 330 nodes, 300 occurrences, 1,800
  paragraphs - assembled in a median **5 ms** and compiled to **208 pages** (772 KB) in a median **425
  ms**, maximum 430 ms over seven runs, including Typst's start. veraPDF passed it. **veraPDF took 17.0 s
  on it and 11.1 s on a one-page PDF**: about eleven seconds of every run is a JVM starting in a
  container, which matters for PUB-085 and PUB-091 together (finding 1).
- **The request, as the publisher (tasks 5 and 6).** `requestPublication` refused a component in a
  space Ada may not read with `occurrence_unreadable` naming the node alone - neither the component's
  id nor its version's appears anywhere in the request row - and recorded the one she may read; Grace,
  who may read both, resolved both. A stale version and `docx` were refused before anything was
  recorded. The runtime role's `UPDATE` and `DELETE` on `publication`, `publication_input` and
  `publication_output`, and its `UPDATE` of a request's `requested_by`, were each refused `permission
denied`; a second `recordPublication` for a finished request inserted nothing. The whole `packages/db`
  suite then passed **300 of 300** with this plan's six, after the four existing tests task 5 names were
  moved.
- **The routes (task 8).** Through Fastify's `inject` against a signed-in stand-in provider: Ada's
  publish of a document holding a component she may not read answered its node and nothing of the
  component; Grace, who placed the reference, could publish it until her grant on Quality was removed,
  and then could not (IAM-074); a reader was answered 403, somebody with nothing 404, a stale version
  `version_precondition` and `docx` `format_unsupported`; another person's request 404; the listing
  newest first with publisher and time; a publication read by somebody granted its space, and 404 to
  somebody granted only its document; a document's id on the publication route 404. With the four
  routes in `cross-tenant.test.ts` and `access-routes.test.ts`, those two passed **81 of 81**;
  `packages/api-contract` passed 25 of 25 and `packages/api-client` 4 of 4 once regenerated.
- **The renderer (task 9).** The publishing panel, the publication page and its address under
  `<StrictMode>`: publish, follow the request, list the new publication; every failure named by its
  place; no **Publish** for a reader; `#/publications/{id}` opening the page. The whole `apps/web` suite
  then passed **382 of 382**, with this plan's own renderer files extracted from it, once finding 10's
  live region was used and the two fakes answered the new member and route. The whole `apps/service`
  suite passed **272 of 272** with the seed's new grants.
- **The worker suite**, with this plan's own `publish.test.ts` and `regression.test.ts` as written
  below, passed **31 of 31** (32 once task 3's refusal test joins task 2's file); `tsc --noEmit` was
  clean in every package touched; and the `packages/trace` suite passed 296 of 296 at the Part 1
  commit.

Then the throwaway worktree was removed, the Liberation archive and the scratch PDFs deleted, and every
`aw_test_*` database it made was dropped by the suites that made it.

**What was not run.** `pnpm lint`, `pnpm format`, `pnpm trace verify` and `pnpm trace gate` over the
whole repository; the regenerated `trace.json` with the plan's citations in place (its arithmetic is
below, not measured); the end-to-end suite and the worker image (task 10, typechecked only), since
rebuilding the stack replaces running containers; and the application itself, which is the one place
Ken's verification happens. The tests quoted in tasks 2 to 9 are the ones that ran; the assemble, db,
service, template, Typst and renderer files were extracted from this document afterwards and run again
as written. Task 1's standalone case was compiled and checked by hand - Typst, veraPDF and a structure
walk - and its test file as written was not run; the same case through the template, task 7's, was.

## Where publishing.md and the built code are wrong, missing or contradicted, most serious first

Planning and running the code found these. Task 11 amends the design for what this plan builds and
records the rest.

1. **PUB-085 and PUB-091 cannot both hold with a cold veraPDF.** PUB-085 asks for a 300-page
   publication in ten seconds at p95, request to record; PUB-091 asks for veraPDF on every publication,
   as part of publishing. veraPDF took **11.1 s on one page** and 17.0 s on 208, nearly all of the first
   figure starting a JVM in a container. A resident veraPDF would leave roughly six seconds of validation
   for 208 pages, and a 300-page document at the edge of the budget with Typst's half second on top.
   **Built:** nothing - veraPDF per publication is slice 5's - and the conflict is named for Ken
   (decision B, and a proposed change to PUB-085).
2. **Headings at levels seven to nine pass veraPDF and are read as paragraphs.** Typst 0.15.1 role-maps
   `H7`-`H9` to `P`, because PDF/UA-1's standard heading types stop at `H6`. veraPDF's machine rules
   pass; the Matterhorn checkpoint a person judges - content that is a heading, tagged as one - does
   not, for those levels. **Built:** deep documents publish; a regression case pins the mapping so an
   engine that changes it is noticed; PUB-090 stays unclaimed (decision A).
3. **Typst refuses a byte-order mark in some places and not others.** Between `B` and `C` it is "a
   disallowed codepoint"; between `a` and `b` it compiles. A check that followed the engine would pass a
   document the engine then refuses. **Built:** `assemble` refuses U+FEFF, U+FFFE and U+FFFF everywhere,
   as `character_disallowed`.
4. **A character map is not what the engine sets.** Typst lays out a tab, a line feed, a carriage
   return, U+0085, U+2028 and U+2029 as space, shapes away variation selectors, soft hyphens and the
   zero-width joiners, and sets U+2011 with the face's hyphen - none of which Liberation Serif maps, or
   needs to. A check reading the `cmap` alone would refuse every paragraph with a line break in it.
   **Built:** the measured exemptions, and a regression case holding `assemble`'s verdict to Typst's
   for every probe (decision J).
5. **Typst cannot carry a script subtag or a numeric region.** `text(region: "419")` stops the compile
   ("expected two letter region code"), and `lang` takes a language alone, so `es-419` and `sr-Latn` -
   both tags the content model accepts - would fail in the engine. **Built:** the published language is
   the tag's language and its two-letter region, if any; the rest is dropped (decision K).
6. **The queue cannot tell the engine refusing from the engine missing.** Both reach the worker as a
   thrown error. **Built:** a non-zero exit is `TypstRefused`, a `JobRefused`, finished at once; a
   missing binary, a timeout or a kill is `TypstFailed`, retried (#146, decision F).
7. **Nobody in the development environment can publish.** The seed grants Ada and Grace Author on
   General and nothing that holds `publish`, so Ken would open the page and find no **Publish**.
   **Built:** the seed grants them Publisher on General too (decision N).
8. **`document-migration.test.ts` assumes 0016 is the last migration.** It copies the migrations
   leaving out `0016_documents.sql` alone, so 0017 is applied to a tenant standing at 0015 and the
   test's first assertion fails on the wrong check. **Built:** it leaves out every tenant migration from
   0016 on, and expects 0016 and 0017 to be applied.
9. **`contentKinds` means "authored and versioned", and a publication is neither but lives in a space.**
   `spaces.test.ts` puts every kind outside `contentKinds` in no space. **Built:** `spacedKinds`,
   content and publications, which the test and the migration's check both name.
10. **The document page has one `status` region, and its tests read it by role.** A second one in the
    publishing panel made twenty of them fail with "multiple elements with the role status". **Built:**
    the panel's live region is `aria-live="polite"` without the role, and its failures a labelled list.
11. **`published_at` is to the second**, because it is the PDF's creation time (decision K of the design).
    Two publishes of one document in the same second tie. **Built:** the listing orders by it and then by
    when each publication was recorded.
12. **The design says the request answers 202.** A permission-checked handler cannot set a status in
    this service, which is why `createComponent` answers 200. **Built:** 200 (decision H).
13. **The theme is a prototype nothing exports.** `packages/domain/src/theme/` says so of itself, and
    its schema was never reviewed for storing. **Built:** the template carries its own typography until
    themes (decision D).
14. **The editor makes paragraphs of unmarked text and nothing else.** The design's slice 1 lists marks,
    languages and hyperlinks, which no author can make yet. **Built:** what the editor makes (decision C).
15. **The worker has never depended on the domain.** Publishing needs `assemble` and the failure
    vocabulary there. **Built:** `@alloy-works/domain` joins its dependencies, and the image builds it
    already, through `--filter "@alloy-works/worker..."`.

## Decisions for Ken

Each is a choice this plan makes provisionally so that it can be built, with a recommendation and what
was rejected. Reject one and the plan changes where it says.

- **A. Deep headings publish as Typst tags them, and PUB-090 stays unclaimed.** Measured: nine levels
  pass veraPDF, bookmark nine deep, and are announced as paragraphs from level seven. The plan publishes
  them, pins the mapping in the regression corpus, and leaves PUB-090 unclaimed with the gap named: the
  person-judged checkpoint fails at those depths. Recommended: accept, and answer the conflict in the
  corpus - STR-007 asks nine levels of an outline, PUB-090 asks every heading be one to assistive
  technology, and no PDF/UA-1 engine can do both; PDF/UA-2 can, and Typst does not write it. My proposal:
  PUB-090 says headings beyond six "must be bookmarked at their depth and set with their number, and may
  be tagged as paragraphs where the standard has no heading type for them", and the design claims it.
  **Rejected:** heading levels seven to nine clamped to `H6` - three levels announced as one, and the
  bookmarks flattened at six, which breaks PUB-021; refusing outlines deeper than six at publishing -
  STR-007 would then promise an outline nobody can publish.
- **B. veraPDF runs in the test suite in slice 1, not on every publication.** The regression corpus is
  checked by veraPDF in a container pinned by digest, on every change; per publication it is slice 5's,
  with PUB-091 and the report stored. Recommended: accept - and, since you asked to be challenged,
  **amend PUB-085 before slice 5**: measure it to the recorded publication **excluding the
  accessibility report**, which is attached within a stated time after. A cold veraPDF is eleven seconds
  before it reads a page. **Rejected:** veraPDF per publication now - +11 s a publish, the Java runtime in
  the worker image (the design's open question) and PUB-085 unmeetable on the first day it is measured.
- **C. Slice 1 publishes what the editor makes: paragraphs of unmarked text**, in the `body` style, with
  each component's own base language and direction. A mark, any other block, any inline but text, and any
  other style fails `inline_not_publishable`, `block_not_publishable` or `style_missing`, all at once,
  naming the block. Recommended: accept; marks, hyperlinks and language marks arrive with the marks
  editor plan or slice 3. **Rejected:** the design's slice 1 list with marks, languages and hyperlinks -
  template code no author can reach, and so nothing Ken can verify in the application.
- **D. No theme in slice 1.** The template sets Liberation Serif at 11 points with its own heading sizes,
  and is versioned, so a publication records exactly what set it. Recommended: accept; the theme's Typst
  projection replaces it in slice 4. **Rejected:** exporting the prototype theme now - an unreviewed
  shape pinned into `data.json` and into every publication's inputs.
- **E. The faces are Liberation Serif 2.1.5, committed with their licence and pinned by hash.** Four
  files, 1.5 MB, in `apps/worker/fonts/` beside `LICENSE-Liberation.txt`, which the SIL OFL requires to
  travel with them. Metric-compatible with Times New Roman, which is what Word falls back to - useful to
  the Word slice. The design's open question on the mathematics face is not this slice's: no equation
  publishes yet, and STIX Two Math, also Times-metric and OFL, is my recommendation for slice 3 to
  measure. **Rejected:** a fetch script like Typst's - the release's files are not release assets but
  attachments at an unversioned URL, and a test would need the network; Typst's own Libertinus - it
  changes with the engine, and a publication set in it cannot be told from one that forgot
  `--ignore-embedded-fonts`.
- **F. A refused job is finished, not retried (#146).** A handler throws `JobRefused(code)` for what its
  input causes; `processNext` fails the job at once, records `code` as its reason, and hands the refusal
  to `failed`, which writes the request's failures. Typst's non-zero exit is a refusal; a missing binary,
  a timeout or a kill is retried. Recommended: accept. **Rejected:** the handler completing the job
  itself - the job row would say finished for a publish that failed, and every handler would reinvent the
  rule.
- **G. Publishing puts nothing on the stream (#147).** The person who asked follows
  `GET /v1/publication-requests/{id}` once a second while the page is open; everybody else sees a
  publication when they list the document's. Recommended: accept - it makes #147 no worse by adding
  nothing to it. **Rejected:** an event addressed to the requester - the stream's first per-viewer rule,
  which is #147's fix and a design of its own, done badly in passing.
- **H. The request answers 200, not 202** (finding 12), with the request as it stands, failures included.
- **I. A publication's time is its request's**, to the second: what the PDF's metadata says, what the
  listing shows, and the same for a retry. The listing breaks a tie by when each was recorded.
- **J. The glyph check refuses what the pinned Typst refuses and no less**, with U+FEFF refused everywhere
  and the measured exemptions pinned by a regression case that runs the engine. Recommended: accept.
  **Rejected:** the `cmap` alone (refuses a line break); asking Typst (its diagnostic quotes the content,
  which must never reach a log, and arrives one character at a time).
- **K. A language tag reaches the engine as its language and a two-letter region** (finding 5).
  `sr-Latn` publishes as `sr`, `es-419` as `es`. Recommended: accept, named on the published document's
  type. **Rejected:** refusing such a tag - publishing blocked by the engine's metadata, not the page.
- **L. A failure's detail is for its requester.** The character as `U+0627`, the kind of block, the style
  - answered only by `GET /v1/publication-requests/{id}`, to the person who asked, who by decision C can
    read everything it describes; an unreadable place carries its node and nothing else, and the worker's
    log carries the job's code alone.
- **M. Requests are not swept in this slice.** One small row a publish; the design's week is a guess, and
  sweeping needs a grant and a job. Recommended: accept; named in "What this plan leaves undone".
- **N. The development seed grants Ada and Grace Publisher on General** (finding 7), so the application
  can publish on the day this lands.
- **O. PUB-003 and PUB-073 are not cited here, though the design's slice 1 lists them.** PUB-003 wants the
  order "covered by a test", and with `conditions`, `references` and the generated matter all identities
  in slice 1, no adjacent swap changes any output - a test would prove the types line up and call it the
  order. PUB-073 wants another format to be another publication, and there is one format. Recommended:
  accept; PUB-003 is cited by slice 3's test once references exist, PUB-073 by the Word slice.
- **P. The release is 0.30.0**, a functional enhancement: a document can be published.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. A test cites a requirement only when its own body
  demonstrates that requirement's own statement (`pnpm trace show <ID>`) and publishing.md claims it in
  full. [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the whole
  list; every other title carries no identifier.
- **`packages/domain` stays platform-free.** `src/publishing/` takes no clock, randomness, `fs` or
  `window`; the covered characters are handed to `assemble`, never read by it.
- **Nothing derived from a component the publisher may not read reaches anyone** (IAM-073, #143). The
  resolution is restricted to the readable set in the query; a refused place carries its node alone; a
  publication's reader reads only what its publisher could.
- **Refusals.** Missing, another environment's, not a publication, or unreadable: `404`, never `403`. A
  caller who may read a document but not publish it: `403`, naming only the permission. Ids in paths are
  lowercase uuids.
- **Every read path has a cross-tenant test** (IAM-004): each new route in `cross-tenant.test.ts` and
  `access-routes.test.ts`. They do not cite IAM-004.
- **No diagnostic in a log.** The worker logs a job's code; a Typst error's text is never read.
- **A passing run has no errors or warnings**, through the renderer's console gate too. pdf.js runs with
  `verbosity: 0`.
- **The renderer's tests render under `<StrictMode>`**, and wait on a React-rendered node, never only on a
  field. A fake that is asked twice on mount answers by state, not by turn.
- **No em or en dashes in user-facing text** - the renderer's strings, route summaries and descriptions,
  the template's words and the changelog. Code comments are exempt.
- **No raw control or invisible characters in source.** Every non-ASCII character in a test is written
  `\u{...}` - with the braces: an editor or a tool that turns `\uXXXX` into the character leaves a
  byte-order mark or a C0 control in the file. `pnpm format` does not catch it; `grep -nP '[^\x00-\x7F]'`
  over the changed files does.
- **No real data:** `Ada`, `Grace`, `Alice`, `Ivy`; **The dosing report**, **Introduction**, **Method**,
  **Scope**, **Calibration**, **Install the printer**; `example.com`, `alloy.test`, `idp.example`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>`; a row is drafted with
  `pnpm trace draft <issue>` and placed by hand.
- **`trace.json` is drift-checked.** Each task that touches a test file or the corpus runs
  `pnpm --filter @alloy-works/trace generate` and commits the result, and moves the pins in
  `packages/trace/src/trace.test.ts` (and `src/parse/requirements.test.ts` for a row) as the task says,
  with a comment. Read at `59a8401`; if main has moved, set each to what the regenerated file holds and
  say so in the comment.
- **A filtered run does not build what it imports.** After changing `packages/domain`, `packages/db`,
  `packages/objects`, `packages/api-contract` or `packages/api-client`, build it (or `pnpm build`)
  before a filtered run of anything importing it.
- **The suites need Postgres and SeaweedFS, and the worker's needs Docker and the veraPDF image.**
  `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`, `pnpm --filter
@alloy-works/worker fetch-typst` and, from task 1, `pnpm --filter @alloy-works/worker fetch-verapdf`.
  Never `pnpm dev:setup` against the development database, never stop or restart a running container,
  and never `turbo run test` unfiltered: use the root `pnpm test`, or `pnpm --filter <pkg> test`.
- **Paths.** Run from a checkout at a short path; esbuild fails past Windows' path limit.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump (0.30.0) and one changelog entry**, in task 11, headed
  `## 0.30.0 - YYYY-MM-DD (PR #n)`. Its body carries `Fixes #145`, `Fixes #146`, `Closes #142` and
  `Closes #143`, each on a line of its own. Never commit to `main`.

---

## The stored-shape check

Versions are insert-only, and a publication is too. Everything this plan stores is listed, with every
write path and what a later rule could refuse.

| #   | Table, column or shape                           | Written by                                                                               | Closed by                                                                                                                                                                                                                                    | What a later slice does                                                                                                     |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `artifact.kind = 'publication'`, in a space      | `recordPublication` alone                                                                | The kind and space checks; no version is ever recorded for one, because `VersionSubstance` has no arm for it                                                                                                                                 | Nothing: a publication never gains versions (PUB-050)                                                                       |
| 2   | The Publisher role row                           | Migration 0017, `on conflict (name) do nothing`                                          | An ordinary role row, as the eight before it                                                                                                                                                                                                 | A tenant may change it like any role                                                                                        |
| 3   | `publication_request`                            | `requestPublication` inserts; `failPublicationRequest` and `recordPublication` finish it | `formats = {pdf}`; a document's version by composite key; `requested_at` truncated to the second; state and `finished_at` paired; a failed request has a failure. **The runtime role may update only `state`, `failures` and `finished_at`** | The Word slice widens `formats`' check; preview adds a kind and a migration of an operational table, not of history         |
| 4   | `publication_request.failures`, JSONB array      | The same three, each from a typed `PublishFailure[]`                                     | A JSON array; each element built from the domain's closed `publishFailureCodes`, which **only ever gain a code**: the contract's enum reads old rows                                                                                         | New codes are added, never renamed or removed                                                                               |
| 5   | `publication_request_occurrence`                 | `requestPublication`                                                                     | A 26-character node; the version is a **component's** by composite key; one row per node                                                                                                                                                     | Nothing                                                                                                                     |
| 6   | `publication`                                    | `recordPublication` alone, in one transaction                                            | Its id is a `publication` artifact's by key; the document version by composite key; `approval`, `formats`, `engine`, `template` each closed to their one value; versions shaped; `request_id` unique                                         | T3 widens `approval`'s check and adds `baseline_id`; a second engine widens `engine`                                        |
| 7   | `publication.fonts`, JSONB array                 | `recordPublication`, from `PINNED_FONT_FILES`, a constant                                | A non-empty array. **Not closed at the element**: Postgres cannot check each element's keys without a function; the one writer's input is a constant typed `{ file, sha256 }`                                                                | Typeface artifacts (slice 4) record the same pair, from their versions                                                      |
| 8   | `publication.numbering`, JSONB object            | `recordPublication`, from `number`'s `NumberingTable`                                    | An object. Read by nothing in this slice; recorded whole because STR-052 asks for the numbers published                                                                                                                                      | A reader interprets it by the row's `pipeline_version`                                                                      |
| 9   | `publication_input`                              | `recordPublication`                                                                      | One document row (no node) by a partial unique index, one row per node; every version by key, `restrict`                                                                                                                                     | Nothing                                                                                                                     |
| 10  | `publication_output`                             | `recordPublication`                                                                      | `format = 'pdf'`, `standard = 'ua-1'`, `bytes > 0`, and **the key ends in `/sha256/` and the recorded digest** - a row cannot point at other bytes than it names                                                                             | The Word slice widens `format`; slice 5 adds the report's key, `null` on every earlier row, which is true: none was checked |
| 11  | The outline's `front` matter (design decision M) | **Nothing in this slice**                                                                | -                                                                                                                                                                                                                                            | The layout slice's widening                                                                                                 |
| 12  | `data.json` (`publishing/1`)                     | Never stored: only its SHA-256, on the publication                                       | -                                                                                                                                                                                                                                            | A new shape is a new schema string and template version                                                                     |

**One thing this check changed before anything was stored:** `publication_output`'s key check. Without
it, a row could name one digest and point at an object holding another, and reproduction (PUB-077)
would compare against the wrong bytes.

## The scope, and why

**Built:** the veraPDF check on nine heading levels and the regression corpus it starts; the pinned
faces (#145); a refused job finished at once (#146); `assemble`; the Publisher role; the request,
resolved as the publisher and refusing what they may not read (#143); the publish job, the fixed
template and the draft notice (#142); the immutable record, its listing and its page; the download.

**Left out, each to a named plan:**

| Left out                                                                                   | Why not here                                                  | Whose                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- |
| The layout artifact, running heads, page numbering, the cover, contents and lists; #144    | The design's slice 2                                          | **Publishing 2, the layout**                   |
| Marks, hyperlinks, language marks, lists, tables, figures, footnotes, equations, citations | Decision C; slice 3 once the editor or structure 4 makes them | **Publishing 3**                               |
| The theme's projection and typeface artifacts                                              | Decision D                                                    | **Publishing 4**                               |
| veraPDF on every publication and its report; PUB-085 measured                              | Decision B, finding 1                                         | **Publishing 5**                               |
| Preview                                                                                    | The design's slice 6                                          | **Publishing 6**                               |
| Word                                                                                       | The design's slice 7                                          | **Publishing 7**                               |
| Sweeping finished requests                                                                 | Decision M                                                    | **Whichever slice first needs it**             |
| Contributions after conditions (#148)                                                      | Not T1's until REU                                            | **The REU plan**                               |
| Per-viewer events on the stream (#147's fix)                                               | Decision G                                                    | **The plan that puts documents on the stream** |

## Files

| File                                                                                                                                                                                                                                                                                                                                                                                                      | Responsibility                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/worker/src/testing/verapdf.ts`, `testing/pdf.ts`, `regression.test.ts`, `regression/nine-heading-levels.typ`                                                                                                                                                                                                                                                                                        | Task 1: veraPDF in a pinned container; a PDF as pdf.js reads it; the corpus |
| `apps/worker/scripts/fetch-verapdf.ts`, `apps/worker/package.json`, `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                            | Task 1: the image pulled once, locally and in CI; `pdfjs-dist`              |
| `apps/worker/fonts/` (four faces, `LICENSE-Liberation.txt`), `src/fonts.ts`, `src/cmap.ts`, `src/typst.ts`, `typst.test.ts`, `templates/sample.typ`, `src/jobs/sample.ts`, `src/main.ts`, `src/sample.test.ts`                                                                                                                                                                                            | Task 2: #145                                                                |
| `apps/worker/src/refusal.ts`, `src/worker.ts`, `src/sample.test.ts`                                                                                                                                                                                                                                                                                                                                       | Task 3: #146                                                                |
| `packages/domain/src/publishing/` (`published.ts`, `failures.ts`, `language.ts`, `glyphs.ts`, `assemble.ts`, `index.ts`, `assemble.test.ts`), `src/index.ts`, `src/index.test.ts`                                                                                                                                                                                                                         | Task 4                                                                      |
| `packages/db/migrations/tenant/0017_publishing.sql`, `src/publishing.ts`, `src/publishing-tables.ts`, `src/tables.ts`, `src/artifact-kind.ts`, `src/queue.ts`, `src/index.ts`, `src/publishing.test.ts`, `src/dev-content.ts`, `src/dev-content.test.ts`; `packages/domain/src/access/role.ts`, `role.test.ts`; `packages/db/src/spaces.test.ts`, `access-listings.test.ts`, `document-migration.test.ts` | Tasks 5 and 6                                                               |
| `apps/worker/templates/publication/1/main.typ`, `src/jobs/publish.ts`, `src/main.ts`, `src/publish.test.ts`, `src/template.test.ts`, `src/regression.test.ts`, `package.json`                                                                                                                                                                                                                             | Task 7                                                                      |
| `packages/api-contract/src/publishing.ts`, `routes.ts`, `index.ts`, `documents.ts`, `openapi.json`; `packages/api-client/src/generated/schema.ts`; `packages/objects/src/store.ts`; `apps/service/src/publishing.ts`, `app.ts`, `documents.ts`, `publication-routes.test.ts`, `cross-tenant.test.ts`, `access-routes.test.ts`                                                                             | Task 8                                                                      |
| `apps/web/src/publishing/` (`failures.ts`, `Publishing.tsx`, `PublicationPage.tsx` and their tests), `src/structure/DocumentPage.tsx`, `DocumentPage.test.tsx`, `src/editor/Workspace.tsx`, `Workspace.test.tsx`                                                                                                                                                                                          | Task 9                                                                      |
| `tests/e2e/src/stack.test.ts`                                                                                                                                                                                                                                                                                                                                                                             | Task 10                                                                     |
| `docs/specification/requirements/PUB-publishing-and-output.md`, `README.md`; `packages/trace/trace.json`, `src/trace.test.ts`, `src/parse/requirements.test.ts`                                                                                                                                                                                                                                           | Tasks 4 to 8: rows, pins                                                    |
| `docs/design/publishing.md`, `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md`, `docs/testing.md`, `CLAUDE.md`, `docs/guides/reading-the-trace.md`, `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, two `package.json`                                                                                                                                               | Task 11                                                                     |

## How the design's commitments become tests

| The design says                                                                                                                                                                                             | Where                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Headings at levels seven to nine pass veraPDF (open question)                                                                                                                                               | Task 1, and task 7 through the template; not cited (decision A)                |
| The worker compiles only in the pinned faces, and refuses to start without them (I, #145)                                                                                                                   | Task 2, not cited: it is a bug's test                                          |
| A document's own failures are not retried (finding 4, #146)                                                                                                                                                 | Tasks 3 and 7, not cited                                                       |
| Failures are reported together (PUB-052); each names its stage and place (PUB-086)                                                                                                                          | Task 4, cited                                                                  |
| Nothing Typst would refuse reaches it (decision G)                                                                                                                                                          | Tasks 4 and 7, the corpus's agreement case; not cited (STY-049 is themes.md's) |
| Publishing is immutable (PUB-050)                                                                                                                                                                           | Task 6, cited                                                                  |
| Bookmarks are the outline (PUB-021); always PUB/UA-1, never untagged (PUB-061); data not source (PUB-062); engine and template recorded (PUB-063); no artifact on failure (PUB-053); a draft says so (#142) | Task 7, cited                                                                  |
| Same inputs, same bytes (decision K)                                                                                                                                                                        | Task 7, not cited: PUB-043 is T3's baseline statement                          |
| The publisher's read decided at the publication (IAM-074); refused naming only the place (#143)                                                                                                             | Task 8, cited                                                                  |
| Retained, addressable, permissioned (PUB-047); listed with who and when (PUB-048)                                                                                                                           | Task 8, cited                                                                  |
| The order is fixed and tested (PUB-003)                                                                                                                                                                     | Not cited (decision O)                                                         |

## Requirements this plan cites, and those it does not

**Thirteen citations**, taking the pin from 180 to 193. Two requirements are added - #142 and #143,
drafted as PUB-093 and PUB-094 if nothing else lands first - and publishing.md claims both, taking
requirements from 1380 to 1382 and claims from 406 to 408.

| ID                 | Statement, in short                                                                                      | Cited in                                 | Task |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---- |
| **PUB-052**        | Failures reported together                                                                               | `domain/src/publishing/assemble.test.ts` | 4    |
| **PUB-086**        | Every failure names its stage and what it concerns                                                       | `domain/src/publishing/assemble.test.ts` | 4    |
| **PUB-050**        | A publication immutable; correcting one makes another                                                    | `db/src/publishing.test.ts`              | 6    |
| **PUB-021**        | The outline as PDF bookmarks                                                                             | `worker/src/publish.test.ts`             | 7    |
| **PUB-053**        | A failed publish produces no artifact                                                                    | `worker/src/publish.test.ts`             | 7    |
| **PUB-061**        | A publication never untagged                                                                             | `worker/src/publish.test.ts`             | 7    |
| **PUB-062**        | Content reaches the engine as data, never as source                                                      | `worker/src/publish.test.ts`             | 7    |
| **PUB-063**        | The engine, its version and the template version recorded                                                | `worker/src/publish.test.ts`             | 7    |
| **PUB-093** (#142) | A publication not from a baseline says it is not approved, on every page, once tagged, and in its record | `worker/src/publish.test.ts`             | 7    |
| **IAM-074**        | The publisher's read of each referenced component decided at the publication                             | `service/src/publication-routes.test.ts` | 8    |
| **PUB-094** (#143) | Publishing refused where the publisher may not read a component, naming the place, never the component   | `service/src/publication-routes.test.ts` | 8    |
| **PUB-047**        | Retained, addressable by URL, permissioned                                                               | `service/src/publication-routes.test.ts` | 8    |
| **PUB-048**        | Listed beside the document, with who published it and when                                               | `service/src/publication-routes.test.ts` | 8    |

**PUB-050 is the one a reviewer should weigh first.** "Correcting one must produce another rather than
replacing it" is shown by a second `recordPublication` for a finished request inserting nothing and a
second request inserting a second publication - which is the store's half. That no route can change a
publication is the absence of one, which the contract's route list shows and PUB-047's test probes with
a `DELETE`.

**IAM-074 is T4 and cited in a T1 build on purpose.** Its statement is the publisher's permission
decided at publishing, whoever placed the reference; task 8's test shows exactly that, across spaces,
and #143's row says the same of every component in T1.

**Near misses, not cited:**

| ID               | Why not                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| PUB-003, PUB-073 | Decision O                                                                                                         |
| PUB-090          | Unclaimed (decision A)                                                                                             |
| PUB-087          | Claimed; the corpus holds two cases, not the spike's nine, until slice 3 ports them                                |
| PUB-091, PUB-085 | Slice 5 (decision B)                                                                                               |
| PUB-034, CNT-084 | The component's language is carried; a language mark is refused (decision C), so a passage that differs is not yet |
| PUB-043          | T3's: "the same baseline"; task 7 shows the same request's bytes twice, not a baseline's                           |
| STY-049          | themes.md's: "the theme's typefaces", and there is no theme                                                        |
| PUB-079          | The layout slice's: an empty outline publishes the title and the notice, which no layout declared                  |
| IAM-004          | The cross-tenant entries never cite it, by house rule                                                              |

### Requirements landed here

1. **[Issue #142](https://github.com/kenhayward/alloy-works/issues/142)**, drafted in task 7 with
   `pnpm trace draft 142` and placed in PUB section 10, "Publications", beside PUB-047: "A publication
   not produced from a baseline must say that it is not approved, visibly on every page and once where
   assistive technology reads it, and its record must say so." T1.
2. **[Issue #143](https://github.com/kenhayward/alloy-works/issues/143)**, drafted in task 8 with
   `pnpm trace draft 143` and placed in PUB section 11, "Failure", beside PUB-072: "Publishing must be
   refused where the publisher may not read every component the resolved document contains, naming each
   such place in the outline and never the component; a publication must never contain what its
   publisher could not read." T1.

Each is claimed in publishing.md's table in the same task, and each lands with a change-history row in
PUB naming the issue.

---

## Task 1: veraPDF, and nine heading levels

The design's open question, settled first because its answer decides whether a deep document can be
published at all. It starts the regression corpus (PUB-087): each case a PDF the pinned engine makes,
checked by veraPDF and read by pdf.js.

**Files:**

- Create: `apps/worker/src/testing/verapdf.ts`, `apps/worker/src/testing/pdf.ts`
- Create: `apps/worker/regression/nine-heading-levels.typ`, `apps/worker/src/regression.test.ts`
- Create: `apps/worker/scripts/fetch-verapdf.ts`
- Modify: `apps/worker/package.json` (`pdfjs-dist`, `fetch-verapdf`), `apps/worker/tsconfig.build.json`,
  `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `checkPdfUa1(pdf: Buffer): Promise<VeraPdfVerdict>` with `{ compliant, profile,
failedRules, failures }`; `VERAPDF_IMAGE`; `readPdf(bytes: Buffer): Promise<ReadPdf>` with `{ pages,
bookmarks, artifactText, taggedText, roles, marked, pdfuaPart, title, language }`, where `roles` is the
  structure tree in document order **after the role map** - what a screen reader is told.

- [ ] **Step 1: Add the tools**

```bash
pnpm --filter @alloy-works/worker add -D pdfjs-dist
```

In `apps/worker/package.json` scripts, beside `fetch-typst`:

```json
    "fetch-verapdf": "tsx scripts/fetch-verapdf.ts"
```

`apps/worker/scripts/fetch-verapdf.ts`:

```ts
// Pulls the pinned veraPDF image the regression corpus runs in. Once per machine, as fetch-typst is,
// and in CI; `docker run` would pull it on first use, but a test should not wait on the network.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VERAPDF_IMAGE } from '../src/testing/verapdf.js';

await promisify(execFile)('docker', ['pull', VERAPDF_IMAGE], { timeout: 600_000 });
console.log(`veraPDF is ${VERAPDF_IMAGE}`);
```

In `apps/worker/tsconfig.build.json`, keep the test helpers out of `dist`:

```json
  "exclude": ["src/**/*.test.ts", "src/testing/**", "src/dev-setup.ts"]
```

In `.github/workflows/ci.yml`, after the `Typst` step:

```yaml
# The pinned veraPDF, by digest: the checker the regression corpus answers to (PUB-090).
- name: veraPDF
  run: pnpm --filter @alloy-works/worker fetch-verapdf
```

- [ ] **Step 2: Write the failing test**

`apps/worker/regression/nine-heading-levels.typ` - a corpus case, compiled as a publication is:

```typst
// Regression corpus: nine heading levels, the depth STR-007 requires an outline to reach, each with
// its number set as text, as the publication template sets them.
#set document(title: "Nine heading levels")
#set text(lang: "en")
#set heading(numbering: none)
#for level in range(1, 10) [
  #heading(level: level)[#level Level #level]
  A paragraph beneath level #level.
]
```

`apps/worker/src/regression.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const NINE_LEVELS = fileURLToPath(
  new URL('../regression/nine-heading-levels.typ', import.meta.url),
);
const at = new Date('2026-09-19T00:00:00Z');

const depthOf = (bookmarks: readonly Bookmark[]): number =>
  bookmarks.length === 0 ? 0 : 1 + Math.max(...bookmarks.map((each) => depthOf(each.items)));

describe('the publishing regression corpus', () => {
  it('passes veraPDF with nine heading levels, bookmarked nine deep, six of them tagged as headings', async () => {
    const pdf = await createTypst({ binary: typstBinaryPath(), template: NINE_LEVELS }).render(
      {},
      at,
    );

    expect(await checkPdfUa1(pdf)).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
    const read = await readPdf(pdf);
    expect(depthOf(read.bookmarks)).toBe(9);
    // PDF/UA-1's standard heading types stop at H6. Typst 0.15.1 writes levels seven to nine as H7 to
    // H9 role-mapped to P, so assistive technology is told they are paragraphs (decision A). Pinned, so
    // an engine that changes it is noticed; PUB-090 stays unclaimed while it holds.
    expect(read.roles.filter((role) => /^H\d$/.test(role))).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ]);
  }, 120_000);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @alloy-works/worker test -- src/regression.test.ts`
Expected: FAIL - `Failed to load url ./testing/pdf.js` (and `./testing/verapdf.js`).

- [ ] **Step 4: Write the helpers**

`apps/worker/src/testing/verapdf.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * veraPDF 1.30.2, pinned by digest: the checker PUB-090 and PUB-091 name. It runs in its own container,
 * with no network, so neither a developer nor CI needs a Java runtime. About eleven seconds a run is the
 * JVM starting, whatever the PDF (finding 1).
 */
export const VERAPDF_IMAGE =
  'verapdf/cli@sha256:d5ee329657cf9bc4b2400392dd54c7d0a0ce9980ff6fa2da5590eebeec007cdb';

export interface VeraPdfVerdict {
  readonly compliant: boolean;
  readonly profile: string;
  readonly failedRules: number;
  /** Each failed rule as `clause-test`, for a failure to name. */
  readonly failures: readonly string[];
}

interface Report {
  report: {
    jobs: {
      validationResult: {
        compliant: boolean;
        profileName: string;
        details: { failedRules: number; ruleSummaries: { clause: string; testNumber: number }[] };
      }[];
    }[];
  };
}

/** A PDF checked against veraPDF's PDF/UA-1 validation profile. */
export async function checkPdfUa1(pdf: Buffer): Promise<VeraPdfVerdict> {
  const directory = await mkdtemp(join(tmpdir(), 'aw-verapdf-'));
  try {
    await writeFile(join(directory, 'checked.pdf'), pdf);
    const { stdout } = await run(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '-v',
        `${directory}:/checked:ro`,
        VERAPDF_IMAGE,
        '--flavour',
        'ua1',
        '--format',
        'json',
        '/checked/checked.pdf',
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
    );
    const [result] = (JSON.parse(stdout) as Report).report.jobs[0]!.validationResult;
    return {
      compliant: result!.compliant,
      profile: result!.profileName,
      failedRules: result!.details.failedRules,
      failures: result!.details.ruleSummaries.map((rule) => `${rule.clause}-${rule.testNumber}`),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
```

`apps/worker/src/testing/pdf.ts`:

```ts
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One bookmark and those beneath it. */
export interface Bookmark {
  readonly title: string;
  readonly items: readonly Bookmark[];
}

/**
 * A PDF as a reader and assistive technology meet it, read by pdf.js rather than by our own code: its
 * bookmarks; per page, the text inside artifacts (running heads and feet, which assistive technology
 * skips) and the text in tagged content; the structure roles in document order after the role map,
 * which is what a screen reader is told; whether it is marked tagged; and its PDF/UA part.
 */
export interface ReadPdf {
  readonly pages: number;
  readonly bookmarks: readonly Bookmark[];
  readonly artifactText: readonly (readonly string[])[];
  readonly taggedText: readonly (readonly string[])[];
  readonly roles: readonly string[];
  readonly marked: boolean;
  readonly pdfuaPart: string | null;
  readonly title: string | null;
  readonly language: string | null;
}

interface StructNode {
  readonly role?: string;
  readonly children?: readonly StructNode[];
}

export async function readPdf(bytes: Buffer): Promise<ReadPdf> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const outline = (await pdf.getOutline()) ?? [];
    const bookmarks = (items: readonly { title: string; items: unknown[] }[]): Bookmark[] =>
      items.map((item) => ({
        title: item.title,
        items: bookmarks(item.items as { title: string; items: unknown[] }[]),
      }));
    const artifactText: string[][] = [];
    const taggedText: string[][] = [];
    const roles: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const open: string[] = [];
      const artifacts: string[] = [];
      const tagged: string[] = [];
      for (const item of content.items) {
        if ('type' in item) {
          if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
            // pdf.js carries the tag at run time and leaves it out of the type.
            open.push((item as { tag?: string }).tag ?? '');
          } else if (item.type === 'endMarkedContent') {
            open.pop();
          }
        } else if (item.str.trim() !== '') {
          (open.includes('Artifact') ? artifacts : tagged).push(item.str);
        }
      }
      artifactText.push(artifacts);
      taggedText.push(tagged);
      const visit = (node: StructNode) => {
        if (node.role !== undefined && node.role !== 'Root') roles.push(node.role);
        for (const child of node.children ?? []) visit(child);
      };
      const tree = (await page.getStructTree()) as StructNode | null;
      if (tree) visit(tree);
    }
    const metadata = await pdf.getMetadata();
    const info = metadata.info as { Title?: string; Language?: string };
    // pdf.js answers the MarkInfo dictionary as a Map.
    const markInfo = (await pdf.getMarkInfo()) as Map<string, unknown> | null;
    return {
      pages: pdf.numPages,
      bookmarks: bookmarks(outline as { title: string; items: unknown[] }[]),
      artifactText,
      taggedText,
      roles,
      marked: markInfo?.get('Marked') === true,
      pdfuaPart: metadata.metadata?.get('pdfuaid:part') ?? null,
      title: info.Title ?? null,
      language: info.Language ?? null,
    };
  } finally {
    // The loading task, not the document: in pdf.js 6 it is the task that owns the worker.
    await task.destroy();
  }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm --filter @alloy-works/worker fetch-verapdf && pnpm --filter @alloy-works/worker test -- src/regression.test.ts`
Expected: PASS, in about twelve seconds, nearly all of them veraPDF starting. **This is the answer the
design waited for**: every machine rule passes at nine levels, and levels seven to nine are paragraphs
to a screen reader. Nothing is claimed on it; decision A is Ken's.

**Had it failed**, the plan would change here: `assemble` would refuse an outline deeper than six with a
`heading_too_deep` failure naming the deepest node, before Typst ran (decision G of the design), and
STR-007 against PUB-090 would go to Ken as a conflict with no engine answer. It did not.

- [ ] **Step 6: Commit**

```bash
pnpm --filter @alloy-works/trace generate
git add apps/worker/src/testing apps/worker/regression apps/worker/src/regression.test.ts \
  apps/worker/scripts/fetch-verapdf.ts apps/worker/package.json apps/worker/tsconfig.build.json \
  .github/workflows/ci.yml pnpm-lock.yaml packages/trace/trace.json
git commit -m "Check nine heading levels against veraPDF: the machine rules pass, levels seven to nine read as paragraphs"
```

---

## Task 2: The pinned faces (issue #145)

Every PDF is set in Liberation Serif, from files pinned by hash, and in nothing Typst carries or the
machine has. A worker with no fonts, or altered ones, does not start. Fixes #145.

**Files:**

- Create: `apps/worker/fonts/LiberationSerif-Regular.ttf`, `-Bold.ttf`, `-Italic.ttf`,
  `-BoldItalic.ttf`, `LICENSE-Liberation.txt`
- Create: `apps/worker/src/fonts.ts`, `apps/worker/src/cmap.ts`
- Modify: `apps/worker/src/typst.ts`, `typst.test.ts`, `templates/sample.typ`, `src/jobs/sample.ts`,
  `src/main.ts`, `src/sample.test.ts`, `src/regression.test.ts`

**Interfaces:**

- Produces: `PINNED_FONT_FILES`, `FONT_DIRECTORY`, `loadPinnedFonts(directory?): Promise<PinnedFonts>`
  with `{ directory, files, covers(codePoint) }`, `FontsUnavailable`; `codePoints(font: Buffer):
Set<number>`; `Typst.compile(template: string, data: string, createdAt: Date): Promise<Buffer>` -
  replacing `render` - and `typstArguments(root, fonts, createdAt)`; `createTypst({ binary, fonts,
timeoutMs? })`.

- [ ] **Step 1: Place the faces**

From the Liberation Fonts 2.1.5 release, `liberation-fonts-ttf-2.1.5.tar.gz`
(`https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz`,
SHA-256 `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`), copy the four
`LiberationSerif-*.ttf` into `apps/worker/fonts/` and its `LICENSE` to
`apps/worker/fonts/LICENSE-Liberation.txt`. Check each against the hashes below before committing:

```bash
sha256sum apps/worker/fonts/LiberationSerif-*.ttf
```

- [ ] **Step 2: Write the failing tests**

Replace `apps/worker/src/typst.test.ts`:

```ts
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, FontsUnavailable, loadPinnedFonts } from './fonts.js';
import {
  createTypst,
  SAMPLE_TEMPLATE,
  TypstFailed,
  typstArguments,
  typstBinaryPath,
  TYPST_RELEASE,
} from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const data = JSON.stringify({
  environment: 'Development',
  requestedAt: '2026-09-11T00:00:00.000Z',
});
const at = new Date('2026-09-11T00:00:00.000Z');

/** The families a PDF embeds, as its font dictionaries name them, without the subset prefix. */
const families = (pdf: Buffer) =>
  [
    ...new Set(
      [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z-]+)/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();

describe('the pinned Typst', () => {
  it('is the version this worker was built against', async () => {
    expect(await typst.version()).toBe(TYPST_RELEASE.version);
  });

  it('renders the sample as a PDF', async () => {
    const pdf = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('treats the data as data, whatever it looks like (ADR-0013)', async () => {
    const odd = JSON.stringify({ environment: '#panic("injected") *bold*', requestedAt: 'now' });
    const pdf = await typst.compile(SAMPLE_TEMPLATE, odd, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the same bytes for the same input', async () => {
    const once = await typst.compile(SAMPLE_TEMPLATE, data, at);
    const again = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(once.equals(again)).toBe(true);
  });

  it('says plainly when the binary is not there', async () => {
    const missing = createTypst({ binary: 'typst-that-is-not-installed', fonts });
    await expect(missing.compile(SAMPLE_TEMPLATE, data, at)).rejects.toThrow(TypstFailed);
  });
});

describe('the pinned fonts (issue #145)', () => {
  it('sets every PDF in the pinned faces and in nothing Typst carries itself', async () => {
    const pdf = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(families(pdf)).toEqual(['LiberationSerif', 'LiberationSerif-Bold']);
  });

  it('hands Typst the pinned directory alone, with its own and the system fonts ignored', () => {
    const flags = typstArguments('/root', fonts.directory, at);
    expect(flags).toContain('--ignore-system-fonts');
    expect(flags).toContain('--ignore-embedded-fonts');
    const path = flags.indexOf('--font-path');
    expect(flags.slice(path, path + 2)).toEqual(['--font-path', FONT_DIRECTORY]);
  });

  it('refuses to start with no fonts, where Typst would print blank pages and exit 0', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'aw-no-fonts-'));
    try {
      await expect(loadPinnedFonts(empty)).rejects.toThrow(FontsUnavailable);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('refuses a face that is not the file pinned', async () => {
    const altered = await mkdtemp(join(tmpdir(), 'aw-altered-fonts-'));
    try {
      await cp(FONT_DIRECTORY, altered, { recursive: true });
      const [face] = (await readdir(altered)).filter((name) => name.endsWith('.ttf'));
      await writeFile(join(altered, face!), 'not a font');
      await expect(loadPinnedFonts(altered)).rejects.toThrow(FontsUnavailable);
    } finally {
      await rm(altered, { recursive: true, force: true });
    }
  });

  it('knows which characters every face can set', () => {
    expect(fonts.covers('A'.codePointAt(0)!)).toBe(true);
    expect(fonts.covers(0x05d0)).toBe(true); // Hebrew alef
    expect(fonts.covers(0x0627)).toBe(false); // Arabic alef
  });
});
```

In `apps/worker/src/sample.test.ts` and `src/regression.test.ts`, every `createTypst({ binary })` gains
`fonts`, loaded once in `beforeAll` (`fonts = await loadPinnedFonts()`), and `render(data, at)` becomes
`compile(template, JSON.stringify(data), at)`.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @alloy-works/worker test -- src/typst.test.ts`
Expected: FAIL - `Failed to load url ./fonts.js`. With `fonts.ts` written and `typst.ts` not yet
changed, the families test fails with `expected [ 'LibertinusSerif-Bold', 'LibertinusSerif-Bold-Identity-H', 'LibertinusSerif-Regular', 'LibertinusSerif-Regular-Identity-H' ] to deeply equal [ 'LiberationSerif', 'LiberationSerif-Bold' ]`

- the sample, today, is set in Typst's own faces: #145 as filed.

- [ ] **Step 4: Write the character map reader and the fonts**

`apps/worker/src/cmap.ts`:

```ts
/**
 * The characters a TrueType or OpenType face maps to a glyph, read from its `cmap` table's Unicode
 * subtables - format 4 for the Basic Multilingual Plane and format 12 beyond it, which between them
 * are what every face the product ships carries. A character mapped to glyph 0, `.notdef`, is not
 * covered: that is the empty box.
 */
export function codePoints(font: Buffer): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  let cmap = -1;
  for (let table = 0; table < view.getUint16(4); table += 1) {
    const record = 12 + 16 * table;
    if (font.toString('latin1', record, record + 4) === 'cmap') cmap = view.getUint32(record + 8);
  }
  if (cmap < 0) throw new Error('The face has no cmap table');

  const covered = new Set<number>();
  for (let subtable = 0; subtable < view.getUint16(cmap + 2); subtable += 1) {
    const platform = view.getUint16(cmap + 4 + 8 * subtable);
    const encoding = view.getUint16(cmap + 6 + 8 * subtable);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const at = cmap + view.getUint32(cmap + 8 + 8 * subtable);
    const format = view.getUint16(at);
    if (format === 4) {
      const segments = view.getUint16(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + 2 * segments + 2;
      const deltas = starts + 2 * segments;
      const offsets = deltas + 2 * segments;
      for (let s = 0; s < segments; s += 1) {
        const end = view.getUint16(ends + 2 * s);
        const start = view.getUint16(starts + 2 * s);
        const delta = view.getInt16(deltas + 2 * s);
        const offset = view.getUint16(offsets + 2 * s);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          const raw =
            offset === 0 ? code : view.getUint16(offsets + 2 * s + offset + 2 * (code - start));
          const glyph = offset !== 0 && raw === 0 ? 0 : (raw + delta) & 0xffff;
          if (glyph !== 0) covered.add(code);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < view.getUint32(at + 12); group += 1) {
        const start = view.getUint32(at + 16 + 12 * group);
        const end = view.getUint32(at + 20 + 12 * group);
        const glyph = view.getUint32(at + 24 + 12 * group);
        for (let code = start; code <= end; code += 1) {
          if (glyph + (code - start) !== 0) covered.add(code);
        }
      }
    }
  }
  return covered;
}
```

`apps/worker/src/fonts.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codePoints } from './cmap.js';

/**
 * The faces every PDF is set in, pinned by hash as the Typst binary is (design decision I; issue #145):
 * Liberation Serif 2.1.5, under the SIL Open Font License 1.1 (ADR-0010), whose text ships beside them.
 * Typst is handed this directory and nothing else - no system fonts and none of its own - so a page is
 * set in these files or not at all, and a publication records which it used.
 */
export const PINNED_FONT_FILES = [
  {
    file: 'LiberationSerif-Bold.ttf',
    sha256: 'd754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce',
  },
  {
    file: 'LiberationSerif-BoldItalic.ttf',
    sha256: 'f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7',
  },
  {
    file: 'LiberationSerif-Italic.ttf',
    sha256: '0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e',
  },
  {
    file: 'LiberationSerif-Regular.ttf',
    sha256: '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74',
  },
] as const;

export const FONT_DIRECTORY = fileURLToPath(new URL('../fonts/', import.meta.url));

export interface PinnedFonts {
  readonly directory: string;
  readonly files: readonly { readonly file: string; readonly sha256: string }[];
  /** Whether every face can set this character: a heading's bold as well as a paragraph's regular. */
  covers(codePoint: number): boolean;
}

/** The fonts are missing, or are not the files pinned. The worker does not start. */
export class FontsUnavailable extends Error {
  readonly code = 'fonts_unavailable';
}

/**
 * The pinned faces, each checked against its hash, and the characters all of them can set. With no
 * fonts at all Typst 0.15.1 compiles, exits 0 and warns about nothing (issue #145), so an empty or
 * altered directory is refused here, before any compile, rather than noticed in a PDF with no text.
 */
export async function loadPinnedFonts(directory: string = FONT_DIRECTORY): Promise<PinnedFonts> {
  const sets: Set<number>[] = [];
  for (const pinned of PINNED_FONT_FILES) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(directory, pinned.file));
    } catch (error) {
      throw new FontsUnavailable(`The pinned face ${pinned.file} is not in ${directory}.`, {
        cause: error,
      });
    }
    if (createHash('sha256').update(bytes).digest('hex') !== pinned.sha256) {
      throw new FontsUnavailable(`${pinned.file} is not the pinned file.`);
    }
    sets.push(codePoints(bytes));
  }
  const [first = new Set<number>(), ...rest] = sets;
  const everywhere = new Set(
    [...first].filter((codePoint) => rest.every((set) => set.has(codePoint))),
  );
  return {
    directory,
    files: PINNED_FONT_FILES.map((each) => ({ ...each })),
    covers: (codePoint) => everywhere.has(codePoint),
  };
}
```

- [ ] **Step 5: Give Typst the fonts and nothing else**

Replace `createTypst` in `apps/worker/src/typst.ts` - `render` becomes `compile`, which takes the
template and the JSON text, so a caller can hash exactly what Typst reads:

```ts
export interface Typst {
  version(): Promise<string>;
  /**
   * A template compiled over this JSON text, which it reads as data and never as source, as PDF/UA-1,
   * in the pinned fonts alone, with the creation time given.
   */
  compile(template: string, data: string, createdAt: Date): Promise<Buffer>;
}

export function createTypst(options: {
  readonly binary: string;
  readonly fonts: PinnedFonts;
  readonly timeoutMs?: number;
}): Typst {
  const timeout = options.timeoutMs ?? 30_000;

  return {
    async version() {
      // unchanged
    },

    async compile(template, data, createdAt) {
      // The compile root holds the template and the data, and nothing else (PUB-062).
      const root = await mkdtemp(join(tmpdir(), 'aw-render-'));
      try {
        await copyFile(template, join(root, 'main.typ'));
        await writeFile(join(root, 'data.json'), data);
        await run(options.binary, typstArguments(root, options.fonts.directory, createdAt), {
          cwd: root,
          env: {},
          timeout,
        });
        return await readFile(join(root, 'out.pdf'));
      } catch (error) {
        throw new TypstFailed('Typst did not render the document.', { cause: error });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Every flag a compile is given, and nothing that could vary: no network, no system fonts and none of
 * Typst's own (issue #145), the pinned directory alone, no packages, a root the template cannot read
 * outside of, PDF/UA-1 always and never a page range (PUB-061), the creation time pinned, and short
 * diagnostics, which nothing reads.
 */
export function typstArguments(root: string, fonts: string, createdAt: Date): string[] {
  return [
    'compile',
    '--root',
    root,
    '--ignore-system-fonts',
    '--ignore-embedded-fonts',
    '--font-path',
    fonts,
    '--package-path',
    join(root, 'no-packages'),
    '--package-cache-path',
    join(root, 'no-packages'),
    '--pdf-standard',
    'ua-1',
    '--creation-timestamp',
    String(Math.floor(createdAt.getTime() / 1000)),
    '--diagnostic-format',
    'short',
    'main.typ',
    'out.pdf',
  ];
}
```

The `template` option and `SAMPLE_TEMPLATE`'s default go; `SAMPLE_TEMPLATE` stays exported. Imports
gain `copyFile` and `type PinnedFonts`. In `templates/sample.typ` the sample names its face, since
Typst's default is no longer there to fall back to:

```typst
#set text(font: "Liberation Serif", lang: "en", size: 11pt)
```

In `src/jobs/sample.ts`, `deps.typst.render(data, at)` becomes
`deps.typst.compile(SAMPLE_TEMPLATE, JSON.stringify({ environment, requestedAt }), at)`, importing
`SAMPLE_TEMPLATE`. In `src/main.ts`, before `createTypst`:

```ts
// The pinned faces, checked before anything else: with none, Typst would compile blank pages (#145).
const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: config.typstBinary, fonts });
```

In `src/regression.test.ts`, the nine-level case compiles with
`createTypst({ binary: typstBinaryPath(), fonts }).compile(NINE_LEVELS, '{}', at)`, and its
`nine-heading-levels.typ` names the face: `#set text(font: "Liberation Serif", lang: "en")`.

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm --filter @alloy-works/worker test`
Expected: PASS - `typst.test.ts` 10 of 10, the sample suite unchanged, the corpus case still compliant
in the pinned face.

- [ ] **Step 7: Commit**

```bash
pnpm --filter @alloy-works/trace generate
git add apps/worker/fonts apps/worker/src apps/worker/templates/sample.typ apps/worker/regression \
  packages/trace/trace.json
git commit -m "Set every PDF in pinned Liberation Serif and refuse to start without it (#145)"
```

---

## Task 3: A refused job is finished, not retried (issue #146)

**Files:**

- Create: `apps/worker/src/refusal.ts`
- Modify: `apps/worker/src/worker.ts`, `apps/worker/src/typst.ts`, `apps/worker/src/typst.test.ts`,
  `apps/worker/src/sample.test.ts`

**Interfaces:**

- Produces: `class JobRefused extends Error { constructor(code: string, message: string, detail?:
unknown) }`; `class TypstRefused extends JobRefused` (code `typst_refused`); `JobHandler.failed(tenant,
job, cause?: unknown)` - `cause` is what the last attempt threw, absent for an abandoned job.

- [ ] **Step 1: Write the failing tests**

In `apps/worker/src/sample.test.ts`, import `queryAs` from `@alloy-works/db/testing` and `JobRefused`
from `./refusal.js`, and add after the retry test:

```ts
it('finishes a job refused on its merits at once, never trying the same input again (issue #146)', async () => {
  const id = await request();
  const told: unknown[] = [];
  const refusing: Record<string, JobHandler> = {
    sample_pdf: {
      run: async () => {
        throw new JobRefused('sample_refused', 'The sample cannot be made from this.');
      },
      failed: async (_tenant, _job, cause) => {
        told.push(cause);
      },
    },
  };
  const eager = {
    ...queue,
    fail: (job: Job, reason: string) => queue.fail(job, reason, { retryInMs: 0 }),
  };
  expect(await work({ handlers: refusing, queue: eager })).toBe('failed');
  // Nothing is left to claim: the job is failed, with its reason, after one attempt.
  expect(await work({ handlers: refusing, queue: eager })).toBe('idle');
  const [job] = (
    await queryAs(
      db.adminUrl,
      'select attempts, last_error, failed_at is not null as failed from platform.job where subject_id = $1',
      [id],
    )
  ).rows;
  expect(job).toEqual({ attempts: 1, last_error: 'sample_refused', failed: true });
  expect(told).toHaveLength(1);
  expect(told[0]).toBeInstanceOf(JobRefused);
});
```

In `apps/worker/src/typst.test.ts`, import `TypstRefused` and add to "the pinned Typst":

```ts
it('refuses, once and for all, a document the engine will not set', async () => {
  // A private-use character no pinned face holds: PDF/UA-1 refuses it every time.
  const refused = JSON.stringify({ environment: '\u{e000}', requestedAt: 'now' });
  await expect(typst.compile(SAMPLE_TEMPLATE, refused, at)).rejects.toThrow(TypstRefused);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @alloy-works/worker test -- src/sample.test.ts src/typst.test.ts`
Expected: FAIL - `Failed to load url ./refusal.js`; once it exists, the sample test with
`expected 'retry' to be 'failed'` (#146 as filed) and the Typst test with `TypstFailed` thrown where
`TypstRefused` was expected.

- [ ] **Step 3: Write the refusal and let the worker honour it**

`apps/worker/src/refusal.ts`:

```ts
/**
 * A job refused on its merits: what it was given will fail the same way every time, so the worker
 * finishes it at once, recording `code`, rather than trying again (issue #146). Anything else a handler
 * throws - a lost connection, a timeout, a crash - might not happen twice, and is retried.
 */
export class JobRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}
```

In `apps/worker/src/worker.ts`, import `JobRefused`, widen the handler, and fail a refusal at once:

```ts
export interface JobHandler {
  run(tenant: Tenant, job: Job): Promise<void>;
  /** `cause` is what the last attempt threw; absent for a job whose worker never came back. */
  failed(tenant: Tenant, job: Job, cause?: unknown): Promise<void>;
}
```

```ts
  } catch (error) {
    const reason = reasonFor(error);
    // Refused on its merits: the same input fails the same way, so it is finished now (issue #146).
    const refused = error instanceof JobRefused;
    const outcome = await deps.queue.fail(
      refused ? { ...job, attempts: job.maxAttempts } : job,
      reason,
    );
    deps.log.warn(
      { job: job.id, kind: job.kind, tenant: tenant.id, reason, outcome },
      'job did not finish',
    );
    if (outcome === 'failed') await handler.failed(tenant, job, error);
    return outcome;
  }
```

In `apps/worker/src/typst.ts`, a compile that ran and exited non-zero is a refusal; one that could not
run, or was killed at its timeout, is not:

```ts
/**
 * Typst ran and refused the document. The same input is refused the same way every time, so it is not
 * tried again (issue #146). On a document `assemble` passed, it is a defect in the pipeline, and its
 * diagnostic - which quotes content - is never read.
 */
export class TypstRefused extends JobRefused {
  constructor() {
    super('typst_refused', 'Typst refused the document.');
  }
}
```

```ts
      } catch (error) {
        const exit = (error as { code?: unknown }).code;
        const killed = (error as { killed?: unknown }).killed === true;
        if (typeof exit === 'number' && exit !== 0 && !killed) throw new TypstRefused();
        throw new TypstFailed('Typst did not render the document.', { cause: error });
      }
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @alloy-works/worker test`
Expected: PASS. The existing retry test still retries twice: a missing binary is `ENOENT`, a string
code, and is `TypstFailed`.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @alloy-works/trace generate
git add apps/worker/src packages/trace/trace.json
git commit -m "Finish a job refused on its merits at once rather than retrying it (#146)"
```

---

## Task 4: The published document and `assemble`

One pure function from what the request recorded to what Typst reads, or to every failure at once,
checking every character against the pinned faces first.

**Files:**

- Create: `packages/domain/src/publishing/published.ts`, `failures.ts`, `language.ts`, `glyphs.ts`,
  `assemble.ts`, `index.ts`, `assemble.test.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/index.test.ts`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

**Interfaces:**

- Consumes: `resolve`, `conditions`, `number`, `sectionNumbers`, `contributionsOf`, `OutlineDocument`,
  `ContentDocument`, `NumberingScheme`, `NumberingTable` from the domain.
- Produces: `assemble(input: AssembleInput): Assembled`, where `AssembleInput` is `{ outline,
occurrences: ReadonlyMap<string, ContentDocument>, refused: readonly PublishFailure[], scheme, covers:
(codePoint: number) => boolean }` and `Assembled` is `{ ok: true, document: PublishedDocument,
numbering: NumberingTable } | { ok: false, failures: readonly PublishFailure[] }`;
  `PublishFailure` `{ stage, code, node, block, detail }`; `publishFailureCodes`; `DRAFT_NOTICE`;
  `PUBLISHING_SCHEMA` (`'publishing/1'`); the `Published*` types.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/publishing/assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { parseOutlineDocument, type OutlineDocument } from '../structure/outline.js';
import { defaultNumberingScheme } from '../structure/scheme.js';

import { assemble, type AssembleInput } from './assemble.js';
import type { PublishFailure } from './failures.js';

/** A 26-character node identifier, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const positional = {
  numbered: true,
  matter: 'body' as const,
  pageBreak: 'none' as const,
  values: {},
};
const section = (name: string, title: string, children: unknown[] = []) => ({
  type: 'section',
  id: id(name),
  title: [text(title)],
  ...positional,
  children,
});
const reference = (name: string, component = COMPONENT, children: unknown[] = []) => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  ...positional,
  children,
});

const outline = (nodes: unknown[]): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

const component = (content: unknown[], over: Partial<ContentDocument> = {}): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Calibration',
    language: 'en-GB',
    direction: 'ltr',
    content,
    ...over,
  });

const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});

/** Latin, and nothing else: enough to show a character outside it failing. */
const latin = (codePoint: number) => codePoint < 0x250;

const input = (over: Partial<AssembleInput>): AssembleInput => ({
  outline: outline([]),
  occurrences: new Map(),
  refused: [],
  scheme: defaultNumberingScheme,
  covers: latin,
  ...over,
});

describe('assemble', () => {
  it('projects the outline as headings numbered by number, and each occurrence as its paragraphs', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib')]),
          section('scope', 'Scope'),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
      }),
    );

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.document.nodes).toEqual([
      {
        id: id('intro'),
        depth: 1,
        number: '1',
        title: 'Introduction',
        language: null,
        direction: null,
        blocks: [],
        children: [
          {
            id: id('calib'),
            depth: 2,
            number: '1.1',
            title: 'Calibration',
            language: null,
            direction: null,
            blocks: [{ type: 'paragraph', id: 'p1', runs: [{ text: 'Set the tray.' }] }],
            children: [],
          },
        ],
      },
      {
        id: id('scope'),
        depth: 1,
        number: '2',
        title: 'Scope',
        language: null,
        direction: null,
        blocks: [],
        children: [],
      },
    ]);
    expect(assembled.document.language).toEqual({ lang: 'en', region: 'GB' });
    expect(assembled.document.status).toBe('draft');
  });

  it('carries a component whose language differs from the document, as far as the engine can', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('fr'), reference('es')]),
        occurrences: new Map([
          [
            id('fr'),
            component([paragraph('p1', text('Le plateau.'))], {
              language: 'fr-FR',
              title: 'Le plateau',
            }),
          ],
          // A numeric region stops Typst's compile, so it goes (finding 5).
          [
            id('es'),
            component([paragraph('p1', text('La bandeja.'))], {
              language: 'es-419',
              title: 'La bandeja',
            }),
          ],
        ]),
      }),
    );
    expect(assembled.ok && assembled.document.nodes.map((node) => node.language)).toEqual([
      { lang: 'fr', region: 'FR' },
      { lang: 'es', region: null },
    ]);
  });

  it('PUB-052 reports every failure at once: an unreadable place, a mark, a block and a glyph', () => {
    const unreadable: PublishFailure = {
      stage: 'resolve',
      code: 'occurrence_unreadable',
      node: id('hidden'),
      block: null,
      detail: null,
    };
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('hidden', OTHER), reference('calib')]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              paragraph('p1', {
                type: 'text',
                value: 'Bold',
                marks: [{ type: 'strong', id: 'm1' }],
              }),
              { type: 'preformatted', id: 'pre1', text: 'x' },
              paragraph('p2', text('Arabic \u{627} here')),
            ]),
          ],
        ]),
        refused: [unreadable],
      }),
    );

    expect(assembled.ok).toBe(false);
    expect(!assembled.ok && assembled.failures).toEqual([
      unreadable,
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'strong',
      },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: id('calib'),
        block: 'pre1',
        detail: 'preformatted',
      },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p2', detail: 'U+0627' },
    ]);
  });

  it('PUB-086 names the stage of every failure and the place it concerns', () => {
    const assembled = assemble(
      input({
        outline: outline([section('intro', 'Intro \u{627}'), reference('calib')]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('a\u{feff}b'))])]]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('intro'), block: null, detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'character_disallowed',
        node: id('calib'),
        block: 'p1',
        detail: 'U+FEFF',
      },
    ]);
  });

  it('sets what the engine sets without a glyph, and reports a character twice as one failure', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('calib')]),
        occurrences: new Map([
          [
            id('calib'),
            component([paragraph('p1', text('X\u{2011}Y\u{ad}\u{200b}\nZ \u{4e2d}\u{4e2d}'))]),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p1', detail: 'U+4E2D' },
    ]);
  });

  it('answers the same for the same inputs', () => {
    const same = input({
      outline: outline([section('intro', 'Introduction', [reference('calib')])]),
      occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
    });
    expect(assemble(same)).toEqual(assemble(same));
  });
});
```

In `packages/domain/src/index.test.ts`, add to the surface, before exporting anything:

```ts
        // Publishing: the published document, its failures and assemble (publishing.md).
        'DRAFT_NOTICE',
        'PUBLISHING_SCHEMA',
        'assemble',
        'publishFailureCodes',
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @alloy-works/domain test -- src/publishing src/index.test.ts`
Expected: FAIL - `Failed to load url ./assemble.js`, and the surface test missing the four names.

- [ ] **Step 3: Write the published document, the failures and the language**

`packages/domain/src/publishing/published.ts`:

```ts
/**
 * The published document (docs/design/publishing.md, "The published document"): the one intermediate
 * every writer reads, holding everything a writer needs and nothing it must decide. Version
 * `publishing/1` is what `apps/worker/templates/publication/1/` reads. It is never stored - only its
 * digest is, on the publication - so a later shape is a new schema string and a new template version,
 * not a migration.
 */
export const PUBLISHING_SCHEMA = 'publishing/1';

/**
 * A BCP 47 tag as Typst can carry it: a language and, where it is two letters, a region. A script
 * subtag, a numeric region and any variant are not carried (finding 5).
 */
export interface PublishedLanguage {
  readonly lang: string;
  readonly region: string | null;
}

export interface PublishedRun {
  readonly text: string;
}

export interface PublishedParagraph {
  readonly type: 'paragraph';
  readonly id: string;
  readonly runs: readonly PublishedRun[];
}

export type PublishedBlock = PublishedParagraph;

/**
 * One outline node, set as a heading at its depth. `number` is `number`'s, set as text; `language`
 * and `direction` are present only where the node's own words differ from the document's - a
 * reference whose component's base language or direction is not the document's.
 */
export interface PublishedNode {
  readonly id: string;
  readonly depth: number;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock[];
  readonly children: readonly PublishedNode[];
}

/**
 * What every page, and once the tagged text, says of a draft (issue #142). The template's words, in
 * English, until a layout declares its own (issue #144).
 */
export const DRAFT_NOTICE = {
  page: 'Not approved',
  text: 'Not approved. This is a draft publication, not made from an approved baseline.',
} as const;

export interface PublishedDocument {
  readonly schema: typeof PUBLISHING_SCHEMA;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly notice: { readonly page: string; readonly text: string };
  readonly nodes: readonly PublishedNode[];
}
```

`packages/domain/src/publishing/failures.ts`:

```ts
/**
 * Where a failure arose (PUB-086): resolving the document at the request, composing it in `assemble`,
 * the engine, or storing what it made.
 */
export type PublishStage = 'resolve' | 'compose' | 'engine' | 'store';

/**
 * Every failure a publish can end in, closed, and only ever added to: a request's stored failures are
 * read back through the contract's enum, so a code once written is never renamed or removed.
 */
export const publishFailureCodes = [
  // resolve: at the request, as the publisher.
  'occurrence_unreadable',
  'occurrence_unresolved',
  // compose: in `assemble`, before Typst is started.
  'title_not_publishable',
  'block_not_publishable',
  'inline_not_publishable',
  'style_missing',
  'glyph_missing',
  'character_disallowed',
  // engine and store: the platform's, recorded after the last attempt.
  'engine_failed',
  'store_failed',
] as const;

export type PublishFailureCode = (typeof publishFailureCodes)[number];

/**
 * One failure, naming its stage, its code and the place it concerns: the outline node, and the block
 * within that node's component where there is one. `detail` is what the author needs to act and the
 * code does not say - the kind of block or mark that cannot be published yet, the style, or the
 * character as `U+XXXX`, never the character itself - and is `null` where the failure is about
 * something the publisher may not read: **an unreadable occurrence carries its node and nothing else**
 * (issue #143).
 */
export interface PublishFailure {
  readonly stage: PublishStage;
  readonly code: PublishFailureCode;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}
```

`packages/domain/src/publishing/language.ts`:

```ts
import type { PublishedLanguage } from './published.js';

/**
 * A BCP 47 tag as the engine can carry it. Typst takes a language of two or three letters and a region
 * of exactly two, and refuses anything else - `es-419` stops the compile - so a script subtag
 * (`sr-Latn`), a numeric region and any variant are dropped here, before the engine could refuse them.
 * The tag's language is kept whatever else is dropped, and it is what assistive technology chooses a
 * voice by.
 */
export function publishedLanguage(tag: string): PublishedLanguage {
  const [lang = tag, ...rest] = tag.split('-');
  const region = rest.find((subtag) => /^[A-Z]{2}$/.test(subtag)) ?? null;
  return { lang, region };
}
```

- [ ] **Step 4: Write the character check**

`packages/domain/src/publishing/glyphs.ts`:

```ts
/**
 * Characters the pinned Typst sets without a glyph of their own: line and paragraph breaks and a tab,
 * which it lays out as space; the zero-width and joining controls, the soft hyphen and the variation
 * selectors, which it shapes away; and the non-breaking hyphen, which it sets with the face's hyphen.
 * Each was measured against Typst 0.15.1 under PDF/UA-1 with only Liberation Serif available, and the
 * regression corpus holds the measurement, so an engine that changes its mind fails a test rather than
 * a publish.
 */
const SET_WITHOUT_A_GLYPH = new Set([
  0x09, 0x0a, 0x0d, 0x85, 0xad, 0x200b, 0x200c, 0x200d, 0x2011, 0x2028, 0x2029, 0x2060, 0xfe00,
  0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07, 0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c,
  0xfe0d, 0xfe0e, 0xfe0f,
]);

/**
 * Characters PDF/UA-1 forbids in text whatever the face holds. The pinned Typst refuses a byte-order
 * mark between some letters and not others, depending on how it shapes the cluster, so it is refused
 * everywhere here rather than wherever the engine happens to notice (finding 3).
 */
const DISALLOWED = new Set([0xfeff, 0xfffe, 0xffff]);

export type CharacterProblem = 'glyph_missing' | 'character_disallowed';

/** `U+0627`, the spelling a failure's detail uses: never the character itself. */
export const codePointName = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Each character of `text` the engine would refuse, once each, in the order they first appear:
 * disallowed anywhere, or missing from every face the template sets it in (`covers`).
 */
export function characterProblems(
  text: string,
  covers: (codePoint: number) => boolean,
): { readonly problem: CharacterProblem; readonly codePoint: number }[] {
  const seen = new Set<number>();
  const found: { problem: CharacterProblem; codePoint: number }[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    if (DISALLOWED.has(codePoint)) found.push({ problem: 'character_disallowed', codePoint });
    else if (!SET_WITHOUT_A_GLYPH.has(codePoint) && !covers(codePoint)) {
      found.push({ problem: 'glyph_missing', codePoint });
    }
  }
  return found;
}
```

- [ ] **Step 5: Write `assemble`**

`packages/domain/src/publishing/assemble.ts`:

```ts
import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import { contributionsOf, type Contribution } from '../structure/contributions.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberingTable,
} from '../structure/numbering.js';
import type { OutlineDocument, OutlineNode } from '../structure/outline.js';
import type { NumberingScheme } from '../structure/scheme.js';

import type { PublishFailure } from './failures.js';
import { characterProblems, codePointName } from './glyphs.js';
import { publishedLanguage } from './language.js';
import {
  DRAFT_NOTICE,
  PUBLISHING_SCHEMA,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedNode,
} from './published.js';

/**
 * What a publish is assembled from, all of it recorded before the job ran: the document version's
 * outline, the content of the version each occurrence took - **only the occurrences the publisher may
 * read**, keyed by node - the failures the request already found resolving them, the numbering scheme,
 * and which characters the pinned faces can set.
 */
export interface AssembleInput {
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<string, ContentDocument>;
  readonly refused: readonly PublishFailure[];
  readonly scheme: NumberingScheme;
  readonly covers: (codePoint: number) => boolean;
}

export type Assembled =
  | { readonly ok: true; readonly document: PublishedDocument; readonly numbering: NumberingTable }
  | { readonly ok: false; readonly failures: readonly PublishFailure[] };

/** The paragraph style the template sets. Every other is `style_missing` until themes (slice 4). */
const BODY = 'body';

const failure = (
  stage: PublishFailure['stage'],
  code: PublishFailure['code'],
  node: string | null,
  block: string | null,
  detail: string | null,
): PublishFailure => ({ stage, code, node, block, detail });

/**
 * One pure function from the recorded inputs to the published document, or to every failure at once
 * (docs/design/publishing.md, "The order"; PUB-052). Its stages run in the order the design states,
 * each over the last one's answer: **resolve** (the request's), **conditions** (REU's, the identity
 * until then), **number** (`number`, over the conditioned outline), **check** (everything the engine
 * would refuse), **project**. It takes no clock and no randomness, and no stage stops at a failure:
 * each records what it found and the next carries on over what remains, skipping only what a failure
 * makes meaningless.
 */
export function assemble(input: AssembleInput): Assembled {
  const failures: PublishFailure[] = [...input.refused];

  // resolve and conditions: what each readable occurrence contributes, then REU's stage (#148).
  const contributions = new Map<string, readonly Contribution[]>();
  for (const [node, content] of input.occurrences)
    contributions.set(node, contributionsOf(content));
  const numbering = number(conditions(resolve(input.outline, contributions)), input.scheme);
  const numbers = sectionNumbers(numbering);

  // check and project: one walk, collecting every failure.
  const refusedNodes = new Set(input.refused.map((each) => each.node));
  const check = (text: string, node: string | null, block: string | null) => {
    for (const { problem, codePoint } of characterProblems(text, input.covers)) {
      failures.push(failure('compose', problem, node, block, codePointName(codePoint)));
    }
  };

  check(input.outline.title, null, null);

  /** A block the template can set, or a failure naming what it is. */
  const publishable = (block: BlockNode, node: string): PublishedBlock[] => {
    if (block.type !== 'paragraph') {
      failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
      return [];
    }
    if (block.style !== BODY) {
      failures.push(failure('compose', 'style_missing', node, block.id, block.style));
    }
    const runs: { text: string }[] = [];
    for (const inline of block.content) {
      const refusal = unpublishableInline(inline);
      if (refusal !== null) {
        failures.push(failure('compose', 'inline_not_publishable', node, block.id, refusal));
        continue;
      }
      if (inline.type === 'text') {
        check(inline.value, node, block.id);
        runs.push({ text: inline.value });
      }
    }
    return runs.length === 0 ? [] : [{ type: 'paragraph', id: block.id, runs }];
  };

  const project = (node: OutlineNode, depth: number): PublishedNode => {
    const numberText = numbers.get(node.id) ?? null;
    if (numberText !== null) check(numberText, node.id, null);
    const shell = { id: node.id, depth, number: numberText };

    if (node.type === 'section') {
      const title = textOf(node.title);
      if (title === null) {
        failures.push(failure('compose', 'title_not_publishable', node.id, null, null));
      } else {
        check(title, node.id, null);
      }
      const children = node.children.map((child) => project(child, depth + 1));
      return {
        ...shell,
        title: title ?? '',
        language: null,
        direction: null,
        blocks: [],
        children,
      };
    }

    const content = input.occurrences.get(node.id);
    if (content === undefined) {
      // The request recorded why; one it did not is a reference nothing resolved.
      if (!refusedNodes.has(node.id)) {
        failures.push(failure('resolve', 'occurrence_unresolved', node.id, null, null));
      }
      const children = node.children.map((child) => project(child, depth + 1));
      return { ...shell, title: '', language: null, direction: null, blocks: [], children };
    }
    check(content.title, node.id, null);
    const blocks = content.content.flatMap((block) => publishable(block, node.id));
    const children = node.children.map((child) => project(child, depth + 1));
    return {
      ...shell,
      title: content.title,
      language:
        content.language === input.outline.language ? null : publishedLanguage(content.language),
      direction: content.direction === input.outline.direction ? null : content.direction,
      blocks,
      children,
    };
  };

  const nodes = input.outline.nodes.map((node) => project(node, 1));
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    numbering,
    document: {
      schema: PUBLISHING_SCHEMA,
      title: input.outline.title,
      language: publishedLanguage(input.outline.language),
      direction: input.outline.direction,
      status: 'draft',
      notice: DRAFT_NOTICE,
      nodes,
    },
  };
}

/** Why an inline cannot be set yet - its node type, or its first mark - or null when it can. */
function unpublishableInline(inline: InlineNode): string | null {
  if (inline.type !== 'text') return inline.type;
  const [mark] = inline.marks;
  return mark === undefined ? null : mark.type;
}

/** A section title's words, where it holds nothing but unmarked text; null otherwise. */
function textOf(title: readonly InlineNode[]): string | null {
  let words = '';
  for (const inline of title) {
    if (inline.type !== 'text' || unpublishableInline(inline) !== null) return null;
    words += inline.value;
  }
  return words;
}
```

The order of the walk is the order failures are reported in: a node's number, its title, its blocks in
document order, then its children. The test's lists depend on it; keep it.

`packages/domain/src/publishing/index.ts`:

```ts
export { assemble } from './assemble.js';
export type { Assembled, AssembleInput } from './assemble.js';
export { publishFailureCodes } from './failures.js';
export type { PublishFailure, PublishFailureCode, PublishStage } from './failures.js';
export { DRAFT_NOTICE, PUBLISHING_SCHEMA } from './published.js';
export type {
  PublishedBlock,
  PublishedDocument,
  PublishedLanguage,
  PublishedNode,
  PublishedParagraph,
  PublishedRun,
} from './published.js';
```

And at the end of `packages/domain/src/index.ts`:

```ts
// Publishing: the published document, its failures, and assemble (docs/design/publishing.md).
export * from './publishing/index.js';
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm --filter @alloy-works/domain test && pnpm --filter @alloy-works/domain build`
Expected: PASS - `assemble.test.ts` 6 of 6, as this plan's own code was measured in the throwaway, with
no non-ASCII character in the source. The whole package passes once the surface test lists the four
names; the two role tests fail only from task 5, which moves them.

- [ ] **Step 7: Move the citation pin, and commit**

`pnpm --filter @alloy-works/trace generate`; in `packages/trace/src/trace.test.ts` the citations pin
becomes **182**, with the comment:

```ts
// 182, from 180: the first publishing plan (docs/plans/2026-09-19-publishing-01-a-document-to-pdf.md)
// cites PUB-052 and PUB-086 in packages/domain/src/publishing/assemble.test.ts: every failure at
// once, each naming its stage and its place.
```

```bash
git add packages/domain/src packages/trace
git commit -m "Assemble a published document from what a request recorded, or every failure at once"
```

---

## Task 5: The Publisher role, and a request decided as its publisher

Migration 0017, the ninth starter role, and `requestPublication`: `publish` decided on the document,
then every occurrence resolved as the publisher, restricted to what they may read in the query, in the
transaction the permission was decided in.

**Files:**

- Create: `packages/db/migrations/tenant/0017_publishing.sql`, `packages/db/src/publishing.ts`,
  `packages/db/src/publishing-tables.ts`, `packages/db/src/publishing.test.ts`
- Modify: `packages/db/src/tables.ts`, `artifact-kind.ts`, `queue.ts`, `index.ts`, `dev-content.ts`,
  `dev-content.test.ts`, `spaces.test.ts`, `access-listings.test.ts`, `document-migration.test.ts`
- Modify: `packages/domain/src/access/role.ts`, `role.test.ts`

**Interfaces:**

- Consumes: `readableComponents` (the one readable-set predicate), `latestVersion`, `readOutline`,
  `walkOutline`, `enqueueJob`, `PublishFailure`.
- Produces: `resolveOccurrences(trx, outline, principalId): Promise<OccurrenceOutcome[]>`;
  `requestPublication(trx, { documentId, version, formats, requester }):
Promise<PublicationRequestAnswer>` answering `requested` (`{ request: { id, state: 'queued' } }`),
  `version.precondition` (`{ current }`), `format.unsupported` or `document.missing`; `JobKind` gains
  `'publish'`; `spacedKinds`; the five table types.

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/access/role.test.ts`, the starter roles become nine and `publish` is
Publisher's alone:

```ts
it('starts a tenant with nine, each of which passes the same check', () => {
  expect(starterRoles.map((role) => role.name)).toEqual([
    'Reader',
    'Reviewer',
    'Author',
    'Approver',
    'Designer',
    'Definitions manager',
    'Administrator',
    'Editing',
    'Publisher',
  ]);
  for (const role of starterRoles) {
    expect(checkRole(role.permissions), role.name).toBeUndefined();
  }
});

it('gives publish to Publisher alone, because publishing releases content (decision L)', () => {
  expect(
    starterRoles.filter((role) => role.permissions.includes('publish')).map((role) => role.name),
  ).toEqual(['Publisher']);
  const held = new Set(starterRoles.flatMap((role) => role.permissions));
  expect(permissions.filter((permission) => !held.has(permission))).toEqual([]);
});
```

`packages/db/src/publishing.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
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
import { createTenant, type Tenant } from './provision.js';
import { requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { recordVersion, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});
const section = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

describe('requesting and recording a publication', () => {
  let db: TestDatabase;
  let production: Tenant;
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

  const component = async (
    trx: TenantTransaction,
    space: string,
    author: string,
    title: string,
  ) => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  /** A document in General at a second version holding these nodes, or at 0.1 holding none. */
  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    if (nodes.length === 0) return made.version;
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const requested = async (trx: TenantTransaction, version: StoredVersion, requester: string) => {
    const answer = await requestPublication(trx, {
      documentId: version.artifactId,
      version: version.id,
      formats: ['pdf'],
      requester,
    });
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return answer.request.id;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada authors General; Grace authors General and Quality, which Ada may not read.
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

  it('starts every tenant with a Publisher role holding read and publish', async () => {
    const role = await service.withTenant(production, (trx) => findRole(trx, 'Publisher'));
    expect(role?.permissions).toEqual(['read', 'publish']);
  });

  it('refuses a component the publisher may not read, recording its node and nothing of it', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [section('Introduction', [open, hidden])]);

      const id = await requested(trx, version, ada);
      const row = await trx
        .selectFrom('publication_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ state: 'queued', formats: ['pdf'], requested_by: ada });
      expect(row.failures).toEqual([
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden.id,
          block: null,
          detail: null,
        },
      ]);
      expect(JSON.stringify(row)).not.toContain(secret.artifactId);
      expect(JSON.stringify(row)).not.toContain(secret.id);
      const occurrences = await trx
        .selectFrom('publication_request_occurrence')
        .selectAll()
        .where('request_id', '=', id)
        .execute();
      expect(occurrences.map((each) => [each.node, each.version_id])).toEqual([
        [open.id, shared.id],
      ]);
    });
  });

  it('refuses a version that is not the latest, and a format the template cannot make, recording nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      const older = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', version.artifactId)
        .where('id', '<>', version.id)
        .executeTakeFirstOrThrow();
      const asked = (at: string, formats: string[]) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: at,
          formats,
          requester: ada,
        });
      expect((await asked(older.id, ['pdf'])).answer).toBe('version.precondition');
      expect((await asked(version.id, ['docx'])).answer).toBe('format.unsupported');
      expect((await asked(version.id, ['pdf', 'docx'])).answer).toBe('format.unsupported');
      const requests = await trx
        .selectFrom('publication_request')
        .select('id')
        .where('document_id', '=', version.artifactId)
        .execute();
      expect(requests).toEqual([]);
    });
  });
});
```

In `src/dev-content.test.ts`, the seed's grant count moves:

```ts
// Author and Publisher on General, for each of Ada and Grace.
expect(grants).toHaveLength(4);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @alloy-works/domain test -- src/access/role.test.ts` and
`pnpm --filter @alloy-works/db test -- src/publishing.test.ts src/dev-content.test.ts`
Expected: FAIL - the role list missing `Publisher`; `Failed to load url ./publishing.js`; the seed
granting two.

- [ ] **Step 3: The ninth role**

In `packages/domain/src/access/role.ts`, `starterRoles` gains, after Editing, and its comment says
nine:

```ts
  { name: 'Publisher', permissions: ['read', 'publish'] },
```

Build the domain (`pnpm --filter @alloy-works/domain build`).

- [ ] **Step 4: The migration**

`packages/db/migrations/tenant/0017_publishing.sql`:

```sql
-- Publishing (docs/design/publishing.md). A publication is an artifact in its document's space, read
-- on its own grants; what made it is recorded beside it and never changed (PUB-050). A request is the
-- operational row a job works from, and is the only thing here that changes.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check
  check (kind in ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication')) = (space_id is not null));

-- Decision L: a ninth starter role. A tenant that already holds a role of this name keeps its own.
insert into role (name, permissions) values ('Publisher', array['read', 'publish'])
  on conflict (name) do nothing;

-- One publish asked for. The version is the document's by its key, not by a check that could be
-- skipped; the time is truncated to the second because it is compiled into the PDF.
create table publication_request (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  document_version_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  formats text[] not null check (formats = array['pdf']),
  requested_by uuid not null references principal on delete restrict,
  requested_at timestamptz not null default date_trunc('second', now()),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  failures jsonb not null default '[]' check (jsonb_typeof(failures) = 'array'),
  finished_at timestamptz,
  check ((state = 'queued') = (finished_at is null)),
  check (state <> 'failed' or jsonb_array_length(failures) > 0),
  foreign key (document_version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index publication_request_document on publication_request (document_id);

-- Which version each occurrence took, recorded as the publisher resolved it: a component's version, by
-- its key. An occurrence the publisher could not read has no row; the request's failures name it.
create table publication_request_occurrence (
  request_id uuid not null references publication_request on delete cascade,
  node text not null check (node ~ '^[a-z2-7]{26}$'),
  component_id uuid not null,
  version_id uuid not null,
  component_kind text not null default 'component' check (component_kind = 'component'),
  primary key (request_id, node),
  foreign key (version_id, component_id, component_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- A publication. Its id is its artifact's, of kind publication, by the key. It carries its request's
-- id without a key, so the request can be swept once finished; unique, so two workers racing one
-- request make one publication. Every closed column is closed at its first value: T3 widens a check.
create table publication (
  id uuid primary key,
  kind text not null default 'publication' check (kind = 'publication'),
  request_id uuid not null unique,
  document_id uuid not null,
  document_version_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  publisher uuid not null references principal on delete restrict,
  published_at timestamptz not null,
  approval text not null check (approval = 'none'),
  formats text[] not null check (formats = array['pdf']),
  engine text not null check (engine = 'typst'),
  engine_version text not null check (engine_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  template text not null check (template = 'publication'),
  template_version integer not null check (template_version > 0),
  pipeline_version text not null check (pipeline_version ~ '^[0-9]+$'),
  fonts jsonb not null check (jsonb_typeof(fonts) = 'array' and jsonb_array_length(fonts) > 0),
  data_sha256 text not null check (data_sha256 ~ '^[0-9a-f]{64}$'),
  numbering jsonb not null check (jsonb_typeof(numbering) = 'object'),
  foreign key (id, kind) references artifact (id, kind) on delete restrict,
  foreign key (document_version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index publication_document on publication (document_id, published_at desc);

-- Every version a publication read: the document's (no node) and each occurrence's (its node). The
-- key refuses deleting anything a publication pinned, as a baseline's pin does.
create table publication_input (
  publication_id uuid not null references publication on delete restrict,
  version_id uuid not null references artifact_version on delete restrict,
  node text check (node ~ '^[a-z2-7]{26}$'),
  unique (publication_id, node)
);
create unique index publication_input_document on publication_input (publication_id) where node is null;

-- What a publication is, as bytes: one row per format, kept in the tenant's store by content hash. The
-- key names the digest it records, so no row can point at other bytes than it says.
create table publication_output (
  publication_id uuid not null references publication on delete restrict,
  format text not null check (format = 'pdf'),
  object_key text not null check (object_key like '%/sha256/' || sha256),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes > 0),
  standard text not null check (standard = 'ua-1'),
  primary key (publication_id, format)
);

-- PUB-050 as a grant: the runtime role inserts and reads what a publication is made of and nothing
-- else, and changes a request only by finishing it.
do $$
begin
  execute format(
    'revoke update, delete, truncate on publication, publication_input, publication_output, '
    'publication_request_occurrence from %I',
    current_schema()
  );
  execute format('revoke update, delete, truncate on publication_request from %I', current_schema());
  execute format(
    'grant update (state, failures, finished_at) on publication_request to %I',
    current_schema()
  );
end
$$;
```

It alters `artifact`, not `artifact_version`, so 0016's pending-trigger trap does not arise on a fresh
tenant; the whole db suite, which provisions fresh tenants throughout, is the proof.

- [ ] **Step 5: The tables, the kinds and the job kind**

`packages/db/src/publishing-tables.ts`:

```ts
import type { ColumnType } from 'kysely';

/** Operational: a request is finished by the one update its grant allows (0017). */
export interface PublicationRequestTable {
  id: ColumnType<string, string | undefined, never>;
  document_id: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  formats: ColumnType<string[], string[], never>;
  requested_by: ColumnType<string, string, never>;
  requested_at: ColumnType<Date, never, never>;
  state: ColumnType<'queued' | 'done' | 'failed', never, 'done' | 'failed'>;
  /** JSONB in as the text of a JSON document, as a version's content is. */
  failures: ColumnType<unknown[], string | undefined, string>;
  finished_at: ColumnType<Date | null, never, Date>;
}

/** Insert and read, nothing else (0017). */
export interface PublicationRequestOccurrenceTable {
  request_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  component_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  component_kind: ColumnType<'component', never, never>;
}

/** Insert and read, nothing else (PUB-050). */
export interface PublicationTable {
  id: ColumnType<string, string, never>;
  kind: ColumnType<'publication', never, never>;
  request_id: ColumnType<string, string, never>;
  document_id: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  publisher: ColumnType<string, string, never>;
  published_at: ColumnType<Date, Date, never>;
  approval: ColumnType<'none', 'none', never>;
  formats: ColumnType<string[], string[], never>;
  engine: ColumnType<'typst', 'typst', never>;
  engine_version: ColumnType<string, string, never>;
  template: ColumnType<'publication', 'publication', never>;
  template_version: ColumnType<number, number, never>;
  pipeline_version: ColumnType<string, string, never>;
  fonts: ColumnType<{ file: string; sha256: string }[], string, never>;
  data_sha256: ColumnType<string, string, never>;
  numbering: ColumnType<unknown, string, never>;
}

export interface PublicationInputTable {
  publication_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  node: ColumnType<string | null, string | null, never>;
}

export interface PublicationOutputTable {
  publication_id: ColumnType<string, string, never>;
  format: ColumnType<'pdf', 'pdf', never>;
  object_key: ColumnType<string, string, never>;
  sha256: ColumnType<string, string, never>;
  bytes: ColumnType<number, number, never>;
  standard: ColumnType<'ua-1', 'ua-1', never>;
}
```

`src/tables.ts` imports the five and adds them to `TenantTables`:

```ts
publication_request: PublicationRequestTable;
publication_request_occurrence: PublicationRequestOccurrenceTable;
publication: PublicationTable;
publication_input: PublicationInputTable;
publication_output: PublicationOutputTable;
```

`src/artifact-kind.ts`:

```ts
/**
 * Every kind of artifact there is, and the check constraint on `artifact.kind` names the same list. A
 * kind is added with the plan that gives it a shape: a document arrived that way, by 0016 widening the
 * check, and a publication by 0017. A publication has no versions: nothing records one, because
 * `VersionSubstance` has no arm for it.
 */
export const artifactKinds = ['component', 'document', 'publication', ...definitionKinds] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/** Content kinds are authored and versioned, and live in exactly one space. */
export const contentKinds = ['component', 'document'] as const satisfies readonly ArtifactKind[];

export type ContentKind = (typeof contentKinds)[number];

/** The kinds that live in exactly one space: content, and what is published from it (finding 9). */
export const spacedKinds = [
  ...contentKinds,
  'publication',
] as const satisfies readonly ArtifactKind[];
```

`src/queue.ts`: `export type JobKind = 'sample_pdf' | 'publish';`

- [ ] **Step 6: Resolve as the publisher, and request**

`packages/db/src/publishing.ts`, first half:

```ts
import {
  readOutline,
  walkOutline,
  type OutlineDocument,
  type PublishFailure,
} from '@alloy-works/domain';
import { readableComponents } from './documents.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, type StoredVersion } from './versions.js';

/** What resolving one occurrence came to, as its publisher: the version it takes, or why none. */
export type OccurrenceOutcome =
  | {
      readonly node: string;
      readonly outcome: 'resolved';
      readonly component: string;
      readonly version: string;
    }
  | { readonly node: string; readonly outcome: 'unreadable' }
  | { readonly node: string; readonly outcome: 'unresolved' };

/**
 * Every reference in the outline resolved as one principal (decision C; IAM-074): `latest` to the
 * component's head, `pinned` to its pin. **A component the principal may not read is never read** -
 * both version queries are restricted to the readable set in the query itself, as `numberingInputs`'
 * are - and its occurrence is `unreadable`. `approved` resolves to nothing until revisions exist, and a
 * pin that is not the component's is refused again here; both are `unresolved`. The two queries are
 * `numberingInputs`' shape without the content; that function could be built on this one, and is left
 * alone so a publishing plan does not move structure's tested function.
 */
export async function resolveOccurrences(
  trx: TenantTransaction,
  outline: OutlineDocument,
  principalId: string,
): Promise<OccurrenceOutcome[]> {
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
    references.map((each) => each.component),
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
          .selectFrom('artifact as a')
          .where('a.id', 'in', latest)
          .innerJoinLateral(
            (eb) =>
              eb
                .selectFrom('artifact_version as v')
                .select(['v.id', 'v.artifact_id'])
                .whereRef('v.artifact_id', '=', 'a.id')
                .orderBy('v.revision_no', 'desc')
                .orderBy('v.version_no', 'desc')
                .limit(1)
                .as('head'),
            (join) => join.onTrue(),
          )
          .select(['head.id', 'head.artifact_id'])
          .execute();
  // Restricted to the readable set in the query itself, as numberingInputs' pins are (F7).
  const pins =
    pinned.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['id', 'artifact_id'])
          .where('id', 'in', pinned)
          .where('artifact_id', 'in', [...readable])
          .execute();
  const headOf = new Map(heads.map((row) => [row.artifact_id, row.id]));
  const pinOf = new Map(pins.map((row) => [row.id, row.artifact_id]));

  return references.map((reference): OccurrenceOutcome => {
    const { node, component } = reference;
    if (!readable.has(component)) return { node, outcome: 'unreadable' };
    if (reference.approved) return { node, outcome: 'unresolved' };
    if (reference.pinned !== null) {
      return pinOf.get(reference.pinned) === component
        ? { node, outcome: 'resolved', component, version: reference.pinned }
        : { node, outcome: 'unresolved' };
    }
    const head = headOf.get(component);
    return head === undefined
      ? { node, outcome: 'unresolved' }
      : { node, outcome: 'resolved', component, version: head };
  });
}

export type PublicationRequestAnswer =
  | {
      readonly answer: 'requested';
      readonly request: { readonly id: string; readonly state: 'queued' };
    }
  /** The document is not at the version the caller named: they would publish what they have not seen. */
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  /** A format the fixed template cannot make (PUB-014): only `pdf` until the layout slice. */
  | { readonly answer: 'format.unsupported' }
  | { readonly answer: 'document.missing' };

/**
 * One publish asked for, decided and recorded in the caller's transaction (docs/design/publishing.md,
 * "Who may publish"): `publish` has been decided on the document before this runs, under the access
 * epoch's shared lock. It refuses a stale version or an unsupported format before recording anything;
 * otherwise it resolves every occurrence **as the publisher**, records the request with the failures
 * resolving found - each naming its node and nothing else (issue #143) - one row per resolved
 * occurrence, and the job, all in one transaction. A request with failures is still queued: `assemble`
 * adds its own for what the publisher can read, and the author is told once (PUB-052).
 */
export async function requestPublication(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly formats: readonly string[];
    readonly requester: string;
  },
): Promise<PublicationRequestAnswer> {
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document') return { answer: 'document.missing' };
  if (latest.id !== input.version) return { answer: 'version.precondition', current: latest };
  if (input.formats.length !== 1 || input.formats[0] !== 'pdf') {
    return { answer: 'format.unsupported' };
  }
  const read = readOutline(latest.content, { artifact: input.documentId, version: latest.id });
  if (!read.ok) throw new Error(`The document ${input.documentId} at ${latest.id} does not read`);

  const outcomes = await resolveOccurrences(trx, read.outline, input.requester);
  const failures: PublishFailure[] = outcomes.flatMap((each) =>
    each.outcome === 'resolved'
      ? []
      : [
          {
            stage: 'resolve' as const,
            code:
              each.outcome === 'unreadable'
                ? ('occurrence_unreadable' as const)
                : ('occurrence_unresolved' as const),
            node: each.node,
            block: null,
            detail: null,
          },
        ],
  );
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: input.documentId,
      document_version_id: latest.id,
      formats: ['pdf'],
      requested_by: input.requester,
      failures: JSON.stringify(failures),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  const resolved = outcomes.flatMap((each) => (each.outcome === 'resolved' ? [each] : []));
  if (resolved.length > 0) {
    await trx
      .insertInto('publication_request_occurrence')
      .values(
        resolved.map((each) => ({
          request_id: request.id,
          node: each.node,
          component_id: each.component,
          version_id: each.version,
        })),
      )
      .execute();
  }
  await enqueueJob(trx, 'publish', request.id);
  return { answer: 'requested', request: { id: request.id, state: 'queued' } };
}
```

`src/index.ts` exports `requestPublication`, `resolveOccurrences`, `spacedKinds` and the types.

- [ ] **Step 7: The development seed, and the tests the migration moves**

`src/dev-content.ts` grants both roles on General (decision N):

```ts
// Author, and Publisher: an environment granting nobody a role that holds `publish` is one where
// nothing can be published (the first publishing plan, decision N).
for (const name of ['Author', 'Publisher']) {
  const role = await findRole(trx, name);
  if (!role) throw new Error(`This environment has no ${name} role to grant`);
  for (const principal of [ada, grace]) {
    const answer = await grant(trx, {
      roleId: role.id,
      subject: { principal },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: grace,
    });
    if ('refused' in answer && answer.refused !== 'grant.duplicate') {
      throw new Error(`${name} on General was refused: ${answer.refused}`);
    }
  }
}
```

Three existing tests move, each for the reason given:

- `src/spaces.test.ts` imports `spacedKinds` in place of `contentKinds`, and puts a kind in a space when
  `spacedKinds` holds it (finding 9).
- `src/access-listings.test.ts`: the sorted role names gain `'Publisher'` between `'Editing'` and
  `'Reader'`.
- `src/document-migration.test.ts` stands a tenant at 0015 by leaving out **every** tenant migration from
  0016 on (finding 8), and expects both later migrations when it migrates again:

```ts
// Every tenant migration up to 0015 and none after, so a tenant can stand where every environment
// stood - whatever has been added since 0016.
before = await mkdtemp(join(tmpdir(), 'aw-before-0016-'));
await cp(new URL('../migrations/', import.meta.url), before, {
  recursive: true,
  filter: (source) => {
    const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
    return numbered === null || Number(numbered[1]) < 16;
  },
});
```

```ts
expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0016_documents', '0017_publishing']);
```

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/domain test && pnpm --filter @alloy-works/db test`
Expected: PASS - the whole db suite, 297 (294 before this task, and its three).

- [ ] **Step 9: Commit**

```bash
pnpm --filter @alloy-works/trace generate
git add packages/domain/src/access packages/db packages/trace/trace.json
git commit -m "Add the Publisher role, and a publish request resolved as its publisher"
```

---

## Task 6: The record

A publication inserted whole in one transaction once its PDF is stored, never changed, and a request
finished with every failure at once.

**Files:**

- Modify: `packages/db/src/publishing.ts`, `packages/db/src/index.ts`, `packages/db/src/publishing.test.ts`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

**Interfaces:**

- Produces: `publicationInputs(trx, requestId): Promise<PublicationInputs | undefined>` with `{ request:
{ id, documentId, documentVersionId, requestedBy, requestedAt, spaceId }, outline, occurrences:
ReadonlyMap<node, { version, content }>, refused }`; `recordPublication(trx, NewPublication):
Promise<string | undefined>` - the publication's id, or `undefined` when the request had already
  finished; `failPublicationRequest(trx, requestId, failures)`.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/publishing.test.ts`, import `sql` from `kysely`, `defaultNumberingScheme` from the
domain, and `failPublicationRequest`, `publicationInputs`, `recordPublication` beside
`requestPublication`; then add:

```ts
/** What a worker records for a request, over an output the store need not hold. */
const recording = (requestId: string) => ({
  requestId,
  engineVersion: '0.15.1',
  templateVersion: 1,
  pipelineVersion: '1',
  fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
  dataSha256: 'b'.repeat(64),
  numbering: { scheme: defaultNumberingScheme.id, entries: [] },
  output: {
    key: `${production.role}/sha256/${'c'.repeat(64)}`,
    sha256: 'c'.repeat(64),
    bytes: 1000,
  },
});

it('reads back exactly the versions a request recorded, and nothing it refused', async () => {
  await service.withTenant(production, async (trx) => {
    const shared = await component(trx, general, ada, 'Install the printer');
    const secret = await component(trx, quality, grace, 'Calibration');
    const open = reference(shared.artifactId);
    const hidden = reference(secret.artifactId);
    const version = await documentWith(trx, [section('Introduction', [open, hidden])]);
    const adas = await publicationInputs(trx, await requested(trx, version, ada));
    expect([...adas!.occurrences.keys()]).toEqual([open.id]);
    expect(adas!.refused.map((each) => each.node)).toEqual([hidden.id]);
    // Grace may read both.
    const graces = await publicationInputs(trx, await requested(trx, version, grace));
    expect([...graces!.occurrences.keys()]).toEqual([open.id, hidden.id]);
    expect(graces!.refused).toEqual([]);
  });
});

it('PUB-050 records a publication the runtime role can insert and read and never change', async () => {
  const [first, again] = await service.withTenant(production, async (trx) => {
    const version = await documentWith(trx, []);
    const one = await recordPublication(trx, recording(await requested(trx, version, ada)));
    // A second worker racing an expired lease finds the request done and records nothing.
    const request = await trx
      .selectFrom('publication')
      .select('request_id')
      .where('id', '=', one!)
      .executeTakeFirstOrThrow();
    expect(await recordPublication(trx, recording(request.request_id))).toBeUndefined();
    // Correcting it is publishing again: another request, another publication, the first unchanged.
    const two = await recordPublication(trx, recording(await requested(trx, version, ada)));
    return [one!, two!];
  });
  expect(again).not.toBe(first);
  for (const statement of [
    sql`update publication set approval = 'none' where id = ${first}`,
    sql`delete from publication where id = ${first}`,
    sql`delete from publication_output where publication_id = ${first}`,
    sql`update publication_input set node = null where publication_id = ${first}`,
  ]) {
    await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  }
});

it('fails a request with every failure at once, after which it has nothing left to publish', async () => {
  await service.withTenant(production, async (trx) => {
    const id = await requested(trx, await documentWith(trx, []), ada);
    await failPublicationRequest(trx, id, [
      { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
    ]);
    expect(await publicationInputs(trx, id)).toBeUndefined();
    expect(await recordPublication(trx, recording(id))).toBeUndefined();
    // Only finishing it: nothing else about a request can be changed.
    await expect(
      sql`update publication_request set requested_by = ${grace} where id = ${id}`.execute(trx),
    ).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @alloy-works/db test -- src/publishing.test.ts`
Expected: FAIL - `publicationInputs is not a function` (the imports name functions not yet written).

- [ ] **Step 3: Write the reads and the record**

Append to `packages/db/src/publishing.ts` (the imports gain `readContent`, `type ContentDocument`,
`type NumberingTable` and `sql` from `kysely`):

```ts
/** What the worker assembles from: everything recorded at the request, read as the tenant. */
export interface PublicationInputs {
  readonly request: {
    readonly id: string;
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly requestedBy: string;
    readonly requestedAt: Date;
    readonly spaceId: string;
  };
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<
    string,
    { readonly version: string; readonly content: ContentDocument }
  >;
  readonly refused: readonly PublishFailure[];
}

/**
 * A queued request's inputs, or undefined when there is nothing to do - finished by another attempt.
 * The worker has no principal and decides nothing: it reads exactly the versions the request recorded
 * as its publisher resolved them, and no other.
 */
export async function publicationInputs(
  trx: TenantTransaction,
  requestId: string,
): Promise<PublicationInputs | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .innerJoin('artifact_version as v', 'v.id', 'r.document_version_id')
    .select([
      'r.id',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.state',
      'r.failures',
      'a.space_id',
      'v.content',
    ])
    .where('r.id', '=', requestId)
    .executeTakeFirst();
  if (!request || request.state !== 'queued') return undefined;
  const read = readOutline(request.content, {
    artifact: request.document_id,
    version: request.document_version_id,
  });
  if (!read.ok) {
    throw new Error(
      `The document ${request.document_id} at ${request.document_version_id} does not read`,
    );
  }
  const rows = await trx
    .selectFrom('publication_request_occurrence as o')
    .innerJoin('artifact_version as v', 'v.id', 'o.version_id')
    .select(['o.node', 'o.version_id', 'o.component_id', 'v.content'])
    .where('o.request_id', '=', requestId)
    .execute();
  const occurrences = new Map<string, { version: string; content: ContentDocument }>();
  for (const row of rows) {
    const content = readContent(row.content, {
      artifact: row.component_id,
      version: row.version_id,
    });
    // A stored version that does not read is a broken store, not the author's to fix: thrown, and so
    // retried and then recorded as the engine's stage.
    if (!content.ok) {
      throw new Error(`The component ${row.component_id} at ${row.version_id} does not read`);
    }
    occurrences.set(row.node, { version: row.version_id, content: content.document });
  }
  return {
    request: {
      id: request.id,
      documentId: request.document_id,
      documentVersionId: request.document_version_id,
      requestedBy: request.requested_by,
      requestedAt: request.requested_at,
      spaceId: request.space_id!,
    },
    outline: read.outline,
    occurrences,
    // Written only by requestPublication, from the closed vocabulary (the stored-shape check, row 4).
    refused: request.failures as PublishFailure[],
  };
}

/** A request that ended without a publication: its failures, all at once, and nothing else. */
export async function failPublicationRequest(
  trx: TenantTransaction,
  requestId: string,
  failures: readonly PublishFailure[],
): Promise<void> {
  await trx
    .updateTable('publication_request')
    .set({ state: 'failed', failures: JSON.stringify(failures), finished_at: new Date() })
    .where('id', '=', requestId)
    .where('state', '=', 'queued')
    .execute();
}

export interface NewPublication {
  readonly requestId: string;
  readonly engineVersion: string;
  readonly templateVersion: number;
  readonly pipelineVersion: string;
  readonly fonts: readonly { readonly file: string; readonly sha256: string }[];
  readonly dataSha256: string;
  readonly numbering: NumberingTable;
  readonly output: { readonly key: string; readonly sha256: string; readonly bytes: number };
}

/**
 * The publication, inserted whole in one transaction once its output is stored (PUB-053): its
 * artifact in the document's space, its record, every version it read, and its output - and the
 * request marked done. **The request's row is locked first**, so a second worker racing an expired
 * lease waits, then finds it done and inserts nothing. Answers the publication's id, or undefined where
 * the request had already finished.
 */
export async function recordPublication(
  trx: TenantTransaction,
  input: NewPublication,
): Promise<string | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .select([
      'r.id',
      'r.state',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'a.space_id',
    ])
    .where('r.id', '=', input.requestId)
    .forUpdate('r')
    .executeTakeFirst();
  if (!request || request.state !== 'queued') return undefined;
  const artifact = await trx
    .insertInto('artifact')
    .values({ kind: 'publication', space_id: request.space_id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('publication')
    .values({
      id: artifact.id,
      request_id: request.id,
      document_id: request.document_id,
      document_version_id: request.document_version_id,
      publisher: request.requested_by,
      published_at: request.requested_at,
      approval: 'none',
      formats: ['pdf'],
      engine: 'typst',
      engine_version: input.engineVersion,
      template: 'publication',
      template_version: input.templateVersion,
      pipeline_version: input.pipelineVersion,
      fonts: JSON.stringify(input.fonts),
      data_sha256: input.dataSha256,
      numbering: JSON.stringify(input.numbering),
    })
    .execute();
  const occurrences = await trx
    .selectFrom('publication_request_occurrence')
    .select(['node', 'version_id'])
    .where('request_id', '=', request.id)
    .execute();
  await trx
    .insertInto('publication_input')
    .values([
      { publication_id: artifact.id, version_id: request.document_version_id, node: null },
      ...occurrences.map((each) => ({
        publication_id: artifact.id,
        version_id: each.version_id,
        node: each.node,
      })),
    ])
    .execute();
  await trx
    .insertInto('publication_output')
    .values({
      publication_id: artifact.id,
      format: 'pdf',
      object_key: input.output.key,
      sha256: input.output.sha256,
      bytes: input.output.bytes,
      standard: 'ua-1',
    })
    .execute();
  await trx
    .updateTable('publication_request')
    .set({ state: 'done', finished_at: sql<Date>`now()` })
    .where('id', '=', request.id)
    .execute();
  return artifact.id;
}
```

`src/index.ts` exports the three and `NewPublication`, `PublicationInputs`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @alloy-works/db test && pnpm --filter @alloy-works/db build`
Expected: PASS - 300 of 300, as measured.

- [ ] **Step 5: Move the citation pin, and commit**

The citations pin becomes **183**:

```ts
// 183, from 182: the same plan cites PUB-050 in packages/db/src/publishing.test.ts: the runtime role
// inserts and reads a publication and can change none of it, and correcting one is another.
```

```bash
pnpm --filter @alloy-works/trace generate
git add packages/db/src packages/trace
git commit -m "Record a publication whole and immutable, or a request's every failure"
```

---

## Task 7: The template and the publish job

The fixed template's first version, the job that assembles, compiles, stores and records, and #142
landed.

**Files:**

- Create: `apps/worker/templates/publication/1/main.typ`, `apps/worker/src/jobs/publish.ts`,
  `apps/worker/src/publish.test.ts`, `apps/worker/src/template.test.ts`
- Modify: `apps/worker/src/main.ts`, `apps/worker/src/regression.test.ts`, `apps/worker/package.json`
  (`@alloy-works/domain`), `.gitattributes`
- Modify: `docs/specification/requirements/PUB-publishing-and-output.md`,
  `docs/specification/requirements/README.md`, `docs/design/publishing.md`
- Modify: `packages/trace/trace.json`, `src/trace.test.ts`, `src/parse/requirements.test.ts`,
  `CLAUDE.md`, `docs/guides/reading-the-trace.md`

**Interfaces:**

- Consumes: `assemble`, `defaultNumberingScheme`, `DRAFT_NOTICE`; `publicationInputs`,
  `recordPublication`, `failPublicationRequest`; `Typst.compile`; `PinnedFonts`; `JobRefused`.
- Produces: `publishJob({ db, stores, typst, fonts }): JobHandler`; `PUBLICATION_TEMPLATE` `{ name,
version, file }`; `PIPELINE_VERSION`; `PublishRefused`.

- [ ] **Step 1: Land #142 as a row**

```bash
pnpm trace draft 142
```

It prints the next free PUB identifier - **PUB-093** at the time of writing; if another has landed, use
what it prints, here and in every title below. Place the row in PUB section 10, "Publications", after
PUB-047, T1, Specified; add the requirements index's count (1380 to 1381) and, at the end of PUB's
change history, a section:

```markdown
### From building the first publishing slice

Not a review. [The first publishing plan](../../plans/2026-09-19-publishing-01-a-document-to-pdf.md)
landed the two requirements Ken filed from the publishing design.

| What was found                                                                                                                                            | Change                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Nothing said a publication that is not approved must say so, and T1 can make no other kind ([#142](https://github.com/kenhayward/alloy-works/issues/142)) | **PUB-093**: on every page, once where assistive technology reads it, and in its record |
```

In `docs/design/publishing.md`, `## Requirements owned` gains:

```markdown
| **PUB-093** | Decision A: every T1 publication is a draft; the template sets **Not approved** on every page as a pagination artifact and the full sentence once as tagged text, and the record says `approval: 'none'` |
```

- [ ] **Step 2: Write the failing tests**

`apps/worker/src/publish.test.ts` - the whole job, against Postgres, the object store and the pinned
Typst:

```ts
import { randomBytes } from 'node:crypto';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createJobQueue,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  publicationInputs,
  recordVersion,
  requestPublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  assemble,
  blockIdentifierFrom,
  defaultNumberingScheme,
  DRAFT_NOTICE,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts, type PinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, publishJob } from './jobs/publish.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
/** Enough paragraphs that the publication runs to several pages. */
const LONG = Array.from(
  { length: 80 },
  (_, index) =>
    `Step ${index + 1}. Set the tray, and calibrate it before every run of the press, as Ada and Grace agreed when they wrote the procedure.`,
);

describe('publishing a document, from the request to the stored PDF', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let fonts: PinnedFonts;
  let typst: Typst;
  let handlers: Record<string, JobHandler>;
  let ada: string;
  let general: string;
  let quality: string;
  const logged: object[] = [];
  const log: WorkerLog = {
    info: (details) => logged.push(details),
    warn: (details) => logged.push(details),
    error: (details) => logged.push(details),
  };

  const work = (over: Partial<Parameters<typeof processNext>[0]> = {}) =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 60_000,
      log,
      ...over,
    });

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component in a space, at a second version holding these paragraphs; answers its id. */
  const component = async (
    trx: TenantTransaction,
    space: string,
    title: string,
    paragraphs: string[],
  ) => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const substance = substanceOf(made.version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const content: ContentDocument = {
      schemaVersion: 1,
      title,
      language: 'en-GB',
      direction: 'ltr',
      content: paragraphs.map((text, index) => ({
        type: 'paragraph',
        id: `p${index + 1}`,
        style: 'body',
        content: [{ type: 'text', value: text, marks: [] }],
      })),
    };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { ...substance, content },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version.artifactId;
  };

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
    return recorded.version;
  };

  const section = (title: string, children: OutlineNode[]): OutlineNode => ({
    type: 'section',
    id: nodeId(),
    title: [{ type: 'text', value: title, marks: [] }],
    ...base,
    children,
  });
  const reference = (component: string): OutlineNode => ({
    type: 'reference',
    id: nodeId(),
    component,
    mode: { kind: 'latest' },
    ...base,
    children: [],
  });

  /** Ada asks to publish a document of these nodes; answers the request's id. */
  const requested = (nodes: (trx: TenantTransaction) => Promise<OutlineNode[]>) =>
    service.withTenant(tenant, async (trx) => {
      const version = await documentWith(trx, await nodes(trx));
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  const requestRow = (id: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  const publicationOf = (requestId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
        .selectAll()
        .where('p.request_id', '=', requestId)
        .executeTakeFirst(),
    );

  const pdfOf = async (key: string) => {
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    return store.get(key);
  };

  const publicationCount = () =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('kind', '=', 'publication')
        .executeTakeFirstOrThrow()
        .then((row) => Number(row.n)),
    );

  /**
   * One publication most tests read: two chapters, a component of eighty paragraphs - several pages -
   * and a subsection, one paragraph of which would be Typst source if it were ever evaluated.
   */
  let first: Promise<{ request: string; read: ReadPdf; row: Record<string, unknown> }> | undefined;
  const published = () =>
    (first ??= (async () => {
      const request = await requested(async (trx) => {
        const calibration = await component(trx, general, 'Calibration', [
          ...LONG,
          'Then #panic("x") ] [ * _ $ as words.',
        ]);
        return [
          section('Introduction', [reference(calibration), section('Scope', [])]),
          section('Method', []),
        ];
      });
      if ((await work()) !== 'done') throw new Error('The publish did not finish');
      const row = await publicationOf(request);
      return { request, row: row!, read: await readPdf(await pdfOf(row!.object_key)) };
    })());

  beforeAll(async () => {
    fonts = await loadPinnedFonts();
    typst = createTypst({ binary: typstBinaryPath(), fonts });
    db = await freshDatabase();
    objects = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    handlers = { publish: publishJob({ db: worker, stores, typst, fonts }) };
    await service.withTenant(tenant, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors and publishes in General, and may not read Quality.
      for (const role of ['Author', 'Publisher']) {
        const found = await findRole(trx, role);
        await grant(trx, {
          roleId: found!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('PUB-021 bookmarks the outline, each heading with the number the outline panel shows', async () => {
    const { read } = await published();
    expect(read.bookmarks).toEqual([
      {
        title: '1 Introduction',
        items: [
          { title: '1.1 Calibration', items: [] },
          { title: '1.2 Scope', items: [] },
        ],
      },
      { title: '2 Method', items: [] },
    ]);
  });

  it('PUB-093 says on every page and once to assistive technology that it is not approved, and its record says so', async () => {
    const { read, row } = await published();
    expect(read.pages).toBeGreaterThan(1);
    // On every page, as an artifact - where no layout can remove it, and a screen reader skips it.
    expect(read.artifactText).toHaveLength(read.pages);
    expect(read.artifactText.every((page) => page.includes(DRAFT_NOTICE.page))).toBe(true);
    // And once where a screen reader reads it.
    expect(read.taggedText.flat().filter((text) => text === DRAFT_NOTICE.text)).toHaveLength(1);
    expect(row).toMatchObject({ approval: 'none' });
  });

  it('PUB-061 is always tagged PDF/UA-1, in the document title and language', async () => {
    const { read, row } = await published();
    expect(read.marked).toBe(true);
    expect(read.pdfuaPart).toBe('1');
    expect(read.roles).toContain('H1');
    expect(read.title).toBe('The dosing report');
    expect(read.language).toBe('en-GB');
    expect(row).toMatchObject({ standard: 'ua-1' });
  });

  it('PUB-062 sets content that would be Typst source as the words it is', async () => {
    const { read } = await published();
    expect(read.taggedText.flat()).toContain('Then #panic("x") ] [ * _ $ as words.');
  });

  it("PUB-063 records the engine, the engine's version and the template's version that made it", async () => {
    const { request } = await published();
    const row = await publicationOf(request);
    expect(row).toMatchObject({
      engine: 'typst',
      engine_version: '0.15.1',
      template: 'publication',
      template_version: 1,
      pipeline_version: '1',
    });
    expect(row!.fonts.map((each) => each.file)).toEqual([
      'LiberationSerif-Bold.ttf',
      'LiberationSerif-BoldItalic.ttf',
      'LiberationSerif-Italic.ttf',
      'LiberationSerif-Regular.ttf',
    ]);
    expect(await requestRow(request)).toMatchObject({ state: 'done', failures: [] });
  });

  it('fails a document with a character no face can set once, with every failure, and logs none of it', async () => {
    logged.length = 0;
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Arabic \u{627} here'])),
      reference(await component(trx, quality, 'Secret', ['Never read'])),
    ]);
    expect(await work()).toBe('failed');
    const row = await requestRow(id);
    expect(row.state).toBe('failed');
    expect((row.failures as { code: string }[]).map((each) => each.code)).toEqual([
      'occurrence_unreadable',
      'glyph_missing',
    ]);
    expect(await publicationOf(id)).toBeUndefined();
    const [job] = (
      await queryAs(
        db.adminUrl,
        'select attempts, last_error from platform.job where subject_id = $1',
        [id],
      )
    ).rows;
    expect(job).toEqual({ attempts: 1, last_error: 'publish_refused' });
    expect(JSON.stringify(logged)).not.toContain('U+0627');
    expect(JSON.stringify(logged)).not.toContain('\u{627}');
  });

  it('PUB-053 records no publication and no artifact when the store will not take the PDF', async () => {
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    const refusing: ObjectStores = {
      forTenant: async (trx, owner) => ({
        ...(await stores.forTenant(trx, owner)),
        put: async () => {
          throw new Error('the store is down');
        },
      }),
    };
    const before = await publicationCount();
    const broken = { publish: publishJob({ db: worker, stores: refusing, typst, fonts }) };
    const eager = {
      ...queue,
      fail: (job: Parameters<JobQueue['fail']>[0], reason: string) =>
        queue.fail(job, reason, { retryInMs: 0 }),
    };
    // The platform's failure: retried, then recorded with its stage and nothing an author could act on.
    expect(await work({ handlers: broken, queue: eager })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager })).toBe('failed');
    expect(await requestRow(id)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
    expect(await publicationOf(id)).toBeUndefined();
    expect(await publicationCount()).toBe(before);
  });

  it('makes the same bytes from what a request recorded, compiled again', async () => {
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    const inputs = await service.withTenant(tenant, (trx) => publicationInputs(trx, id));
    expect(await work()).toBe('done');
    const row = await publicationOf(id);
    const again = assemble({
      outline: inputs!.outline,
      occurrences: new Map([...inputs!.occurrences].map(([node, each]) => [node, each.content])),
      refused: inputs!.refused,
      scheme: defaultNumberingScheme,
      covers: fonts.covers,
    });
    if (!again.ok) throw new Error('did not assemble');
    const bytes = await typst.compile(
      PUBLICATION_TEMPLATE.file,
      JSON.stringify(again.document),
      inputs!.request.requestedAt,
    );
    expect(bytes.equals(await pdfOf(row!.object_key))).toBe(true);
  });
});
```

`apps/worker/src/template.test.ts` - a template version is immutable:

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PUBLICATION_TEMPLATE } from './jobs/publish.js';

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    const bytes = await readFile(PUBLICATION_TEMPLATE.file);
    // Of the file with LF endings (.gitattributes normalises them). Were this to fail, the template
    // changed: put it back and make templates/publication/2/, never move this hash.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'b47cff20caf996fea010a7f8a10b893291d805a8f3d0a1d8e2c6149d10a0fc82',
    );
    expect(PUBLICATION_TEMPLATE).toMatchObject({ name: 'publication', version: 1 });
  });
});
```

`apps/worker/src/regression.test.ts` - the nine-level case now goes through the template, and a
second case holds `assemble`'s verdict to the engine's for every probe:

```ts
import {
  assemble,
  defaultNumberingScheme,
  parseContentDocument,
  parseOutlineDocument,
  type AssembleInput,
  type OutlineNode,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE } from './jobs/publish.js';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, TypstRefused, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-19T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

/** Nine sections, each inside the last: the depth STR-007 requires an outline to reach. */
const nested = (depth: number): OutlineNode => ({
  type: 'section',
  id: id(`level${String.fromCharCode(96 + depth)}`),
  title: [{ type: 'text', value: `Level ${depth}`, marks: [] }],
  ...positional,
  children: depth === 9 ? [] : [nested(depth + 1)],
});

const outline = (nodes: unknown[]) =>
  parseOutlineDocument({
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

/** One reference whose component is a paragraph of this text. */
const holding = (text: string): AssembleInput => ({
  outline: outline([
    {
      type: 'reference',
      id: id('probe'),
      component: COMPONENT,
      mode: { kind: 'latest' },
      ...positional,
      children: [],
    },
  ]),
  occurrences: new Map([
    [
      id('probe'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Probe',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: text, marks: [] }],
          },
        ],
      }),
    ],
  ]),
  refused: [],
  scheme: defaultNumberingScheme,
  covers: fonts.covers,
});

const depthOf = (bookmarks: readonly Bookmark[]): number =>
  bookmarks.length === 0 ? 0 : 1 + Math.max(...bookmarks.map((each) => depthOf(each.items)));

describe('the publishing regression corpus', () => {
  it('publishes nine heading levels through the template as PDF/UA-1 that veraPDF passes, bookmarked nine deep', async () => {
    const assembled = assemble({
      outline: outline([nested(1)]),
      occurrences: new Map(),
      refused: [],
      scheme: defaultNumberingScheme,
      covers: fonts.covers,
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE.file,
      JSON.stringify(assembled.document),
      at,
    );

    expect(await checkPdfUa1(pdf)).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
    const read = await readPdf(pdf);
    expect(depthOf(read.bookmarks)).toBe(9);
    // Decision A: levels seven to nine are tagged H7 to H9, role-mapped to P. Pinned, so an engine that
    // changes it is noticed; PUB-090 stays unclaimed while it holds.
    expect(read.roles.filter((role) => /^H\d$/.test(role))).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ]);
  }, 120_000);

  it('refuses before the engine runs every character the engine would refuse, and only those', async () => {
    // Each probe measured against the pinned Typst under PDF/UA-1, in the pinned faces alone.
    const probes: [string, string][] = [
      ['a tab', 'a\tb'],
      ['a line break', 'a\nb'],
      ['a line separator', 'a\u{2028}b'],
      ['a non-breaking hyphen the face lacks', 'X\u{2011}Y'],
      ['a zero-width space', 'a\u{200b}b'],
      ['a soft hyphen', 'a\u{ad}b'],
      ['a variation selector', 'V\u{fe0f}W'],
      ['a combining accent', 'e\u{301}'],
      ['Hebrew', '\u{5d0}\u{5d1}'],
      ['Arabic', 'a\u{627}b'],
      ['a CJK ideograph', 'a\u{4e2d}b'],
      ['an emoji', 'a\u{1f600}b'],
      ['a private-use character', 'a\u{e000}b'],
      ['a control character', 'a\u{1}b'],
      ['a byte-order mark between capitals', 'B\u{feff}C'],
      ['a byte-order mark between small letters', 'a\u{feff}b'],
    ];
    // What Typst would be handed had the check not run: a clean document, the probe put back.
    const clean = assemble(holding('PROBE'));
    if (!clean.ok) throw new Error('The stand-in did not assemble');
    const verdicts: Record<string, { assemble: boolean; typst: boolean }> = {};
    for (const [name, text] of probes) {
      const data = JSON.stringify(clean.document).replace(
        '"text":"PROBE"',
        `"text":${JSON.stringify(text)}`,
      );
      const typstRefuses = await typst.compile(PUBLICATION_TEMPLATE.file, data, at).then(
        () => false,
        (error: unknown) => {
          if (error instanceof TypstRefused) return true;
          throw error;
        },
      );
      verdicts[name] = { assemble: !assemble(holding(text)).ok, typst: typstRefuses };
    }

    expect(
      Object.entries(verdicts).flatMap(([name, verdict]) => (verdict.typst ? [name] : [])),
    ).toEqual([
      'Arabic',
      'a CJK ideograph',
      'an emoji',
      'a private-use character',
      'a control character',
      'a byte-order mark between capitals',
    ]);
    // Refused by assemble wherever Typst refuses, and nowhere else but the byte-order mark, which
    // Typst refuses between some letters and not others (finding 3).
    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict.assemble, name).toBe(verdict.typst || name.startsWith('a byte-order mark'));
    }
  }, 120_000);
});
```

The standalone `regression/nine-heading-levels.typ` goes: the case it held is the template's now, and a
corpus case that is not what ships tests something else.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @alloy-works/worker add "@alloy-works/domain@workspace:^" && pnpm --filter @alloy-works/worker test -- src/publish.test.ts src/template.test.ts src/regression.test.ts`
Expected: FAIL - `Failed to load url ./jobs/publish.js`.

- [ ] **Step 4: Write the template**

`apps/worker/templates/publication/1/main.typ` - byte for byte, LF endings, one final newline; the
hash in `template.test.ts` is of exactly this:

```typst
// The publication template, version 1 (docs/design/publishing.md). It reads the published
// document from data.json as values and evaluates nothing: no content reaches Typst as source
// (ADR-0013, PUB-062). A version is immutable - an edit is a new directory, and a test holds each
// version's hash.
#let doc = json("data.json")
#assert(doc.schema == "publishing/1", message: "data.json is not publishing/1")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }

#set document(title: doc.title, author: (), keywords: ())
#set text(font: face, size: 11pt, ..language(doc.language), dir: direction(doc.direction))
#set par(justify: false, leading: 0.65em, spacing: 0.9em)
// Every page carries the status in its header, where no layout can remove it. Typst marks a
// header as a pagination artifact, which assistive technology does not read, so the notice is
// also set once as tagged text below. Its words are the template's, in English.
#set page(
  paper: "a4",
  margin: (x: 2.5cm, y: 2.5cm),
  header: align(end, text(size: 9pt, lang: "en", region: none, dir: ltr, doc.notice.page)),
)
// Numbers are the publisher's (`number`), set as text; Typst numbers nothing.
#set heading(numbering: none)
#show heading: set text(weight: "bold")
#show heading: it => block(above: 1.4em, below: 0.8em, sticky: true, it)
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 2): set text(size: 13pt)

#let paragraph(b) = {
  let words = b.runs.map(r => r.text).join()
  if words != none { par(words) }
}

// A node's own heading and blocks take its language and direction where they differ from the
// document's; what it holds takes its own.
#let node(n) = {
  let own = {
    heading(level: n.depth, if n.number == none { n.title } else { n.number + " " + n.title })
    for b in n.blocks {
      if b.type == "paragraph" { paragraph(b) }
    }
  }
  if n.language == none and n.direction == none {
    own
  } else {
    let lang = if n.language == none { language(doc.language) } else { language(n.language) }
    let dir = direction(if n.direction == none { doc.direction } else { n.direction })
    set text(..lang, dir: dir)
    own
  }
  for c in n.children { node(c) }
}

#title()
#par(text(lang: "en", region: none, dir: ltr, weight: "bold", doc.notice.text))

#for n in doc.nodes { node(n) }
```

Add to `.gitattributes`, so no checkout rewrites a pinned file:

```
*.ttf binary
*.otf binary
*.typ text eol=lf
```

- [ ] **Step 5: Write the job**

`apps/worker/src/jobs/publish.ts`:

```ts
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  failPublicationRequest,
  publicationInputs,
  recordPublication,
  type TenantDatabase,
} from '@alloy-works/db';
import { assemble, defaultNumberingScheme, type PublishFailure } from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { PinnedFonts } from '../fonts.js';
import { JobRefused } from '../refusal.js';
import type { Typst } from '../typst.js';
import type { JobHandler } from '../worker.js';

/**
 * The publication template this worker compiles with. A version is immutable: an edit is a new
 * directory and a new number, and `template.test.ts` holds each version's hash.
 */
export const PUBLICATION_TEMPLATE = {
  name: 'publication',
  version: 1,
  file: fileURLToPath(new URL('../../templates/publication/1/main.typ', import.meta.url)),
} as const;

/** The pipeline's own version (PUB-063): `assemble` and this job, as one. Raised with either. */
export const PIPELINE_VERSION = '1';

/** The document's own failures, every one at once: the job is finished, never tried again. */
export class PublishRefused extends JobRefused {
  constructor(readonly failures: readonly PublishFailure[]) {
    super('publish_refused', 'The document cannot be published as it stands.');
  }
}

/** The store would not take the output. Worth another attempt. */
class StoreFailed extends Error {
  readonly code = 'store_failed';
}

/**
 * One publish: the recorded inputs through `assemble`, the published document through the pinned
 * Typst and the fixed template, the PDF into the tenant's store by its hash, and the publication
 * recorded whole (docs/design/publishing.md, "The request and the job"). The worker decides nothing:
 * the request recorded, as its publisher, which version each occurrence takes and which it could not
 * read, and this reads exactly those.
 */
export function publishJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly typst: Typst;
  readonly fonts: PinnedFonts;
}): JobHandler {
  return {
    async run(tenant, job) {
      const read = await deps.db.withTenant(tenant, async (trx) => ({
        inputs: await publicationInputs(trx, job.subjectId!),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: finished by another attempt.
      if (!read.inputs) return;
      const { request, outline, occurrences, refused } = read.inputs;

      const assembled = assemble({
        outline,
        occurrences: new Map([...occurrences].map(([node, each]) => [node, each.content])),
        refused,
        scheme: defaultNumberingScheme,
        covers: deps.fonts.covers,
      });
      if (!assembled.ok) throw new PublishRefused(assembled.failures);

      // The digest is of the bytes Typst reads, so a reproduction can tell input from engine.
      const data = JSON.stringify(assembled.document);
      const pdf = await deps.typst.compile(PUBLICATION_TEMPLATE.file, data, request.requestedAt);
      const engineVersion = await deps.typst.version();
      let stored;
      try {
        stored = await read.store.put(pdf, 'application/pdf');
      } catch (error) {
        throw new StoreFailed('The store did not take the publication.', { cause: error });
      }
      await deps.db.withTenant(tenant, (trx) =>
        recordPublication(trx, {
          requestId: request.id,
          engineVersion,
          templateVersion: PUBLICATION_TEMPLATE.version,
          pipelineVersion: PIPELINE_VERSION,
          fonts: deps.fonts.files,
          dataSha256: createHash('sha256').update(data).digest('hex'),
          numbering: assembled.numbering,
          output: { key: stored.key, sha256: stored.sha256, bytes: stored.size },
        }),
      );
    },

    /**
     * The request fails with the document's own list, or - after the last attempt, or when a worker
     * never came back - with the platform's stage and nothing an author could act on.
     */
    async failed(tenant, job, cause) {
      if (!job.subjectId) return;
      const failures: readonly PublishFailure[] =
        cause instanceof PublishRefused
          ? cause.failures
          : [
              cause instanceof StoreFailed
                ? { stage: 'store', code: 'store_failed', node: null, block: null, detail: null }
                : { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
            ];
      await deps.db.withTenant(tenant, (trx) =>
        failPublicationRequest(trx, job.subjectId!, failures),
      );
    },
  };
}
```

In `apps/worker/src/main.ts`, beside the sample:

```ts
const handlers: Record<string, JobHandler> = {
  sample_pdf: sampleJob({ db, stores, typst }),
  publish: publishJob({ db, stores, typst, fonts }),
};
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm --filter @alloy-works/worker test`
Expected: PASS - 32 across seven files (31 measured, before task 3's Typst refusal test joined task 2's file); the corpus's veraPDF case about twelve seconds.

- [ ] **Step 7: Move the pins, and commit**

`pnpm --filter @alloy-works/trace generate`; in `packages/trace/src/trace.test.ts` the requirements pin
becomes **1381**, claims **407** and citations **189**, and in `src/parse/requirements.test.ts` the
requirements pin **1381**, each with its comment:

```ts
// 1381, from 1380: PUB-093, a publication not made from a baseline saying it is not approved
// (issue #142), landed by the first publishing plan.
```

```ts
// 407, from 406: publishing.md claims PUB-093, decision A as a requirement.
```

```ts
// 189, from 183: the same plan cites PUB-021, PUB-053, PUB-061, PUB-062, PUB-063 and PUB-093 in
// apps/worker/src/publish.test.ts, over one publish through the queue, the store and Typst.
```

`CLAUDE.md` and `docs/guides/reading-the-trace.md` say 1,381.

```bash
git add apps/worker .gitattributes pnpm-lock.yaml docs/specification docs/design/publishing.md \
  packages/trace CLAUDE.md docs/guides/reading-the-trace.md
git commit -m "Publish a document to a tagged PDF that says it is not approved (#142)"
```

---

## Task 8: The routes

Four routes: asking, following, listing, reading. #143 landed.

**Files:**

- Create: `packages/api-contract/src/publishing.ts`, `apps/service/src/publishing.ts`,
  `apps/service/src/publication-routes.test.ts`
- Modify: `packages/api-contract/src/routes.ts`, `index.ts`, `documents.ts` (`mayPublish`),
  `openapi.json`; `packages/api-client/src/generated/schema.ts`; `packages/objects/src/store.ts`;
  `packages/db/src/publishing.ts`, `index.ts`; `apps/service/src/app.ts`, `documents.ts`,
  `cross-tenant.test.ts`, `access-routes.test.ts`
- Modify: `docs/specification/requirements/PUB-publishing-and-output.md`, `README.md`,
  `docs/design/publishing.md`, `packages/trace/*`, `CLAUDE.md`, `docs/guides/reading-the-trace.md`

**Interfaces:**

- Produces: `POST /v1/documents/{id}/publications` (`requestPublication`, publish on the document,
  body `{ version, formats }`, 200 `PublicationRequestView`); `GET /v1/publication-requests/{id}`
  (`getPublicationRequest`, session, the requester alone); `GET /v1/documents/{id}/publications`
  (`listPublications`, read on the document, `{ items: PublicationSummary[] }`);
  `GET /v1/publications/{id}` (`getPublication`, read on the publication, `PublicationView` with a
  signed link per output named `{id}.pdf`); `DocumentView.mayPublish`; `TenantStore.signedLink(key,
seconds, fileName?)`; in `packages/db`, `readPublicationRequest`, `readPublication`,
  `listPublications`.

- [ ] **Step 1: Land #143 as a row**

```bash
pnpm trace draft 143
```

**PUB-094** at the time of writing. Place it in PUB section 11, "Failure", after PUB-072, T1,
Specified; the index's count 1381 to 1382; a row in the change-history section task 7 began:

```markdown
| Nothing said a publisher could not release what they may not read, and a publication is read on its own grants ([#143](https://github.com/kenhayward/alloy-works/issues/143)) | **PUB-094**: refused, naming each place in the outline and never the component |
```

and in publishing.md's table:

```markdown
| **PUB-094** | Decision C: the request resolves every occurrence restricted to what the publisher may read, in the query; one they may not read is `occurrence_unreadable`, naming its node and nothing else, and compose never reads it |
```

- [ ] **Step 2: Write the failing tests**

`apps/service/src/publication-routes.test.ts`:

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
  recordPublication,
  removeGrant,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { defaultNumberingScheme } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
type Json = Record<string, unknown>;

describe('publishing a document through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let objects: TestObjectStore;
  let stores: ObjectStores;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const grants: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const publish = (as: string, document: { id: string; version: string }, formats = ['pdf']) =>
    call(as, 'POST', `/v1/documents/${document.id}/publications`, {
      version: document.version,
      formats,
    });

  /** A component in a space, at 0.1 as created: one empty paragraph. */
  const componentIn = async (space: string, title: string) => {
    const made = await tenantDb.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version.artifactId;
  };

  /** A document in General referencing these components, made by Grace through the routes. */
  const documentReferencing = async (components: string[]) => {
    const made = (
      await call('grace', 'POST', `/v1/spaces/${general}/documents`, {
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
      })
    ).json<{ id: string; version: { id: string } }>();
    let version = made.version.id;
    for (const component of components) {
      const edited = await call('grace', 'POST', `/v1/documents/${made.id}/outline`, {
        openedFrom: version,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      version = edited.json<{ version: { id: string } }>().version.id;
    }
    const body = (await call('grace', 'GET', `/v1/documents/${made.id}`)).json<{
      outline: { nodes: { id: string }[] };
    }>();
    return { id: made.id, version, nodes: body.outline.nodes.map((node) => node.id) };
  };

  /** A publication recorded straight through the store, as a worker would, for the reading routes. */
  const published = async (requestId: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const store = await stores.forTenant(trx, tenant);
      const stored = await store.put(Buffer.from('%PDF-1.7 a stand-in'), 'application/pdf');
      return recordPublication(trx, {
        requestId,
        engineVersion: '0.15.1',
        templateVersion: 1,
        pipelineVersion: '1',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        output: { key: stored.key, sha256: stored.sha256, bytes: stored.size },
      });
    });

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
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
    await objects.setUp(db.adminUrl, tenant);
    stores = createObjectStores(objects.settings, objects.sealingKey);
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
      objects: stores,
    });
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
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
      const [reader, author] = await Promise.all(
        ['Reader', 'Author'].map((name) => findRole(trx, name)),
      );
      // The seed makes Ada and Grace Authors and Publishers on General; Grace also authors Quality,
      // which Ada may not read. Alice reads General and publishes nothing; Ivy holds nothing yet.
      for (const [key, role, principal, space] of [
        ['graceQuality', author!, ids.grace!, quality],
        ['aliceReads', reader!, ids.alice!, general],
      ] as const) {
        const answer = await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
        if (!('granted' in answer)) throw new Error(JSON.stringify(answer));
        grants[key] = answer.granted.id;
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('PUB-094 refuses a component the publisher may not read, naming its place and nothing of it', async () => {
    const hidden = await componentIn(quality, 'Calibration');
    const document = await documentReferencing([hidden]);
    const answer = await publish('ada', document);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{ id: string; failures: unknown[] }>();
    expect(body.failures).toEqual([
      {
        stage: 'resolve',
        code: 'occurrence_unreadable',
        node: document.nodes[0],
        block: null,
        detail: null,
      },
    ]);
    expect(answer.body).not.toContain(hidden);
    expect(answer.body).not.toContain('Calibration');
    const followed = await call('ada', 'GET', `/v1/publication-requests/${body.id}`);
    expect(followed.body).not.toContain(hidden);
    expect(followed.json()).toMatchObject({ state: 'queued', publication: null });
  });

  it("IAM-074 decides the publisher's read at the publication, whoever placed the reference", async () => {
    const hidden = await componentIn(quality, 'Calibration');
    // Grace placed it while she could read it, and can publish it.
    const document = await documentReferencing([hidden]);
    expect((await publish('grace', document)).json<{ failures: unknown[] }>().failures).toEqual([]);
    // Ada cannot, for she may not read it, though Grace's reference stands.
    const codes = async (as: string) =>
      (await publish(as, document))
        .json<{ failures: { code: string }[] }>()
        .failures.map((each) => each.code);
    expect(await codes('ada')).toEqual(['occurrence_unreadable']);
    // And once Grace may no longer read Quality, neither can she.
    await tenantDb.withTenant(tenant, (trx) => removeGrant(trx, grants.graceQuality!));
    expect(await codes('grace')).toEqual(['occurrence_unreadable']);
  });

  it('refuses a reader who may not publish, a stale version, a format it cannot make, and an unknown document', async () => {
    const document = await documentReferencing([]);
    expect((await publish('alice', document)).statusCode).toBe(403);
    expect((await publish('ivy', document)).statusCode).toBe(404);
    const other = await documentReferencing([await componentIn(general, 'Scope')]);
    const first = (await call('grace', 'GET', `/v1/documents/${other.id}`)).json<{
      version: { id: string };
    }>();
    expect(first.version.id).toBe(other.version);
    const older = { id: other.id, version: document.version };
    expect((await publish('grace', older)).json()).toMatchObject({ code: 'version_precondition' });
    expect((await publish('grace', other, ['docx'])).json()).toMatchObject({
      code: 'format_unsupported',
    });
    const unknown = { id: '11111111-1111-4111-8111-111111111111', version: other.version };
    expect((await publish('grace', unknown)).statusCode).toBe(404);
  });

  it('answers a request to its requester alone', async () => {
    const made = (await publish('grace', await documentReferencing([]))).json<{ id: string }>();
    expect((await call('grace', 'GET', `/v1/publication-requests/${made.id}`)).statusCode).toBe(
      200,
    );
    expect((await call('ada', 'GET', `/v1/publication-requests/${made.id}`)).statusCode).toBe(404);
  });

  it("PUB-048 lists a document's publications, newest first, with who published each and when", async () => {
    const document = await documentReferencing([]);
    const one = await published((await publish('grace', document)).json<{ id: string }>().id);
    const two = await published((await publish('ada', document)).json<{ id: string }>().id);
    const listed = (await call('alice', 'GET', `/v1/documents/${document.id}/publications`)).json<{
      items: {
        id: string;
        publisher: { displayName: string };
        publishedAt: string;
        approval: string;
      }[];
    }>();
    expect(
      listed.items.map((each) => [each.id, each.publisher.displayName, each.approval]),
    ).toEqual([
      [two, 'Ada', 'none'],
      [one, 'Grace', 'none'],
    ]);
    expect(Date.parse(listed.items[0]!.publishedAt)).toBeGreaterThanOrEqual(
      Date.parse(listed.items[1]!.publishedAt),
    );
  });

  it('PUB-047 keeps a publication at its own address, read on its own grants, with no way to delete it', async () => {
    const document = await documentReferencing([]);
    const id = await published((await publish('grace', document)).json<{ id: string }>().id);
    const read = await call('alice', 'GET', `/v1/publications/${id}`);
    expect(read.statusCode, read.body).toBe(200);
    const body = read.json<{ outputs: { download: string }[] }>();
    expect(body).toMatchObject({
      approval: 'none',
      engine: { name: 'typst', version: '0.15.1' },
      template: { name: 'publication', version: 1 },
    });
    // The download is named by the publication's id, never its title: the link reaches the store's logs.
    expect(body.outputs[0]!.download).toContain(`${id}.pdf`);
    expect(body.outputs[0]!.download).not.toContain('dosing');
    // Ivy is granted the document alone (decision D): the publication is not hers to read.
    await tenantDb.withTenant(tenant, async (trx) => {
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.ivy! },
        level: { kind: 'artifact', id: document.id },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    expect((await call('ivy', 'GET', `/v1/documents/${document.id}`)).statusCode).toBe(200);
    expect((await call('ivy', 'GET', `/v1/publications/${id}`)).statusCode).toBe(404);
    expect((await call('ivy', 'GET', `/v1/documents/${document.id}/publications`)).json()).toEqual({
      items: [],
    });
    // A document's id is not a publication's, and nothing deletes one.
    expect((await call('alice', 'GET', `/v1/publications/${document.id}`)).statusCode).toBe(404);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/publications/${id}`,
      headers: { host: HOST, cookie: cookies.grace! },
    });
    expect(deleted.statusCode).toBe(404);
  });
});
```

The two harnesses gain an entry per route. In `cross-tenant.test.ts`, import `recordPublication` and
`requestPublication`, add to `OTHER_TENANT_IDS`:

```ts
  requestPublication: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listPublications: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getPublicationRequest: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).request }),
  getPublication: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).publication }),
```

to the payloads, `requestPublication: { payload: { version: SESSION, formats: ['pdf'] } },`, and after
`documentIdIn`:

```ts
/**
 * A publication in environment B, and the request that made it: asked for through the store and
 * recorded as a worker records one, over an output that need not exist - nothing here fetches it.
 */
const publicationIn = async (tenant: Tenant, db: TenantDatabase) => {
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id'])
      .where('artifact_id', '=', document)
      .executeTakeFirstOrThrow();
    const asked = await requestPublication(trx, {
      documentId: document,
      version: version.id,
      formats: ['pdf'],
      requester: version.author_id!,
    });
    if (asked.answer !== 'requested') throw new Error(`refused: ${asked.answer}`);
    const publication = await recordPublication(trx, {
      requestId: asked.request.id,
      engineVersion: '0.15.1',
      templateVersion: 1,
      pipelineVersion: '1',
      fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
      dataSha256: 'b'.repeat(64),
      numbering: { scheme: 'default/1', entries: [] },
      output: { key: `${tenant.role}/sha256/${'c'.repeat(64)}`, sha256: 'c'.repeat(64), bytes: 1 },
    });
    return { request: asked.request.id, publication: publication! };
  });
};
```

In `access-routes.test.ts`, import the same two, record a publication of `report` where `report` is
made (`let reportPublication: string;`, and in that transaction):

```ts
const asked = await requestPublication(trx, {
  documentId: report,
  version: made.version.id,
  formats: ['pdf'],
  requester: ids.ada!,
});
if (asked.answer !== 'requested') throw new Error(`refused: ${asked.answer}`);
reportPublication = (await recordPublication(trx, {
  requestId: asked.request.id,
  engineVersion: '0.15.1',
  templateVersion: 1,
  pipelineVersion: '1',
  fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
  dataSha256: 'b'.repeat(64),
  numbering: { scheme: 'default/1', entries: [] },
  output: { key: `${tenant.role}/sha256/${'c'.repeat(64)}`, sha256: 'c'.repeat(64), bytes: 1 },
}))!;
```

and add to `HOLDING_NOTHING`:

```ts
    requestPublication: () => ({
      url: `/v1/documents/${report}/publications`,
      status: 404,
      payload: { version: MISSING, formats: ['pdf'] },
    }),
    listPublications: () => ({ url: `/v1/documents/${report}/publications`, status: 404 }),
    getPublication: () => ({ url: `/v1/publications/${reportPublication}`, status: 404 }),
```

No existing test compares a whole document view, so `mayPublish` moves none (measured: the service
suite passed unchanged with it added).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm build && pnpm --filter @alloy-works/service test -- src/publication-routes.test.ts src/cross-tenant.test.ts src/access-routes.test.ts`
Expected: FAIL - every publication route answered 404 as an unknown route, and the harnesses'
`requestPublication has no address` once the contract declares them.

- [ ] **Step 4: The contract**

`packages/api-contract/src/publishing.ts`:

```ts
import { publishFailureCodes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { DocumentParams } from './documents.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** What publishing takes: the version the caller is looking at, and the formats, `pdf` alone for now. */
export const RequestPublicationBody = z.strictObject({
  version: LowercaseUuid.describe(
    'The document version the caller is publishing, which must be the latest',
  ),
  formats: z
    .array(z.string().min(1))
    .min(1)
    .describe('The formats to publish; `pdf` is the only one until a layout declares another'),
});
export type RequestPublicationBody = z.infer<typeof RequestPublicationBody>;

export const PublicationRequestParams = z.object({ id: LowercaseUuid });
export const PublicationParams = z.object({ id: LowercaseUuid });

/** One failure, naming its stage and its place (PUB-086). An unreadable place carries its node alone. */
export const PublishFailureView = z.object({
  stage: z.enum(['resolve', 'compose', 'engine', 'store']),
  code: z.enum(publishFailureCodes),
  node: z.string().nullable().describe('The outline node it concerns'),
  block: z.string().nullable().describe("The block within that node's component"),
  detail: z
    .string()
    .nullable()
    .describe(
      'The kind of block or mark, the style, or the character as U+XXXX; null where the place is one the publisher may not read',
    ),
});

export const PublicationRequestView = z.object({
  id: z.string(),
  document: z.string(),
  state: z.enum(['queued', 'done', 'failed']),
  failures: z.array(PublishFailureView),
  publication: z.string().nullable().describe('The publication it made, once done'),
});
export type PublicationRequestView = z.infer<typeof PublicationRequestView>;

const PublicationSummary = z.object({
  id: z.string(),
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  title: z.string().describe("The document's title at the version published"),
  publisher: z.object({ id: z.string(), displayName: z.string().nullable() }),
  publishedAt: z.string(),
  approval: z.literal('none').describe('`none`: a draft. Nothing in T1 can approve a publication'),
  formats: z.array(z.string()),
});

export const PublicationList = z.object({ items: z.array(PublicationSummary) });
export type PublicationList = z.infer<typeof PublicationList>;

export const PublicationView = PublicationSummary.extend({
  engine: z.object({ name: z.literal('typst'), version: z.string() }),
  template: z.object({ name: z.literal('publication'), version: z.number().int() }),
  pipeline: z.string(),
  outputs: z.array(
    z.object({
      format: z.literal('pdf'),
      bytes: z.number().int(),
      sha256: z.string(),
      standard: z.literal('ua-1'),
      download: z
        .string()
        .describe('A link to the bytes, valid for five minutes, named by the publication id'),
    }),
  ),
});
export type PublicationView = z.infer<typeof PublicationView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Publishing a document, following the request, and reading what was published (publishing.md). */
export const publishingRoutes = {
  requestPublication: {
    operationId: 'requestPublication',
    method: 'POST',
    path: '/v1/documents/{id}/publications',
    summary: 'Publish the latest version of this document',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { artifact: 'id' } },
    params: DocumentParams,
    body: RequestPublicationBody,
    responses: {
      // 200, not 202: a permission-checked handler cannot set a status (finding 12).
      200: {
        description: 'Asked for, and queued; follow the request for its outcome',
        schema: PublicationRequestView,
      },
      400: {
        description: '`format_unsupported`: a format the template cannot make',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: '`version_precondition`: the document has a newer version than the one named',
        schema: ErrorBody,
      },
    },
  },
  getPublicationRequest: {
    operationId: 'getPublicationRequest',
    method: 'GET',
    path: '/v1/publication-requests/{id}',
    summary:
      'A publish the caller asked for: its state, every failure, and its publication once made',
    tenantScoped: true,
    access: { check: 'session' },
    params: PublicationRequestParams,
    responses: {
      200: { description: 'The request', schema: PublicationRequestView },
      401: unauthenticated,
      404: { description: 'No such request, or one somebody else asked for', schema: ErrorBody },
    },
  },
  listPublications: {
    operationId: 'listPublications',
    method: 'GET',
    path: '/v1/documents/{id}/publications',
    summary: "The document's publications the caller may read, newest first",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The publications', schema: PublicationList },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose listing they may read',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getPublication: {
    operationId: 'getPublication',
    method: 'GET',
    path: '/v1/publications/{id}',
    summary: 'A publication: its record, and a link to each output',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: PublicationParams,
    responses: {
      200: { description: 'The publication', schema: PublicationView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a publication the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such publication in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
```

`routes.ts` spreads `...publishingRoutes` after `...documentRoutes`; `index.ts` exports the schemas;
`documents.ts`'s `DocumentView` gains
`mayPublish: z.boolean().describe('Whether the caller may publish the document'),`. Then:

```bash
pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-client generate && pnpm --filter @alloy-works/api-client build
```

- [ ] **Step 5: A signed link that names its file**

In `packages/objects/src/store.ts`, `signedLink(key, seconds, fileName?)`:

```ts
        async signedLink(key, seconds, fileName) {
          return getSignedUrl(
            client,
            new GetObjectCommand({
              Bucket: bucket,
              Key: assertTenantKey(tenant, key),
              // The name a download is saved under. A caller passes an identifier, never a title:
              // the link's query string reaches the store's logs, and a title is content.
              ...(fileName === undefined
                ? {}
                : { ResponseContentDisposition: `attachment; filename="${fileName}"` }),
            }),
            { expiresIn: seconds },
          );
        },
```

- [ ] **Step 6: The reads and the listing**

Append to `packages/db/src/publishing.ts` (imports gain `loadReadableSet` from `./access-facts.js` and
`readableArtifacts` from `./readable-artifacts.js`, and a module-level
`const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;`):

```ts
/** A request as its requester is shown it. */
export interface StoredPublicationRequest {
  readonly id: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly state: 'queued' | 'done' | 'failed';
  readonly failures: readonly PublishFailure[];
  readonly publication: string | null;
}

/** One request, with the publication it made, if any. Undefined when there is none. */
export async function readPublicationRequest(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublicationRequest | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication_request as r')
    .leftJoin('publication as p', 'p.request_id', 'r.id')
    .select([
      'r.id',
      'r.document_id',
      'r.requested_by',
      'r.state',
      'r.failures',
      'p.id as publication',
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  return (
    row && {
      id: row.id,
      documentId: row.document_id,
      requestedBy: row.requested_by,
      state: row.state,
      failures: row.failures as PublishFailure[],
      publication: row.publication,
    }
  );
}

/** A publication as a reader is shown it: its record, and its outputs by key. */
export interface StoredPublication {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersion: { readonly id: string; readonly number: string };
  readonly title: string;
  readonly publisher: { readonly id: string; readonly displayName: string | null };
  readonly publishedAt: Date;
  readonly approval: 'none';
  readonly formats: readonly string[];
  readonly engine: { readonly name: 'typst'; readonly version: string };
  readonly template: { readonly name: 'publication'; readonly version: number };
  readonly pipelineVersion: string;
  readonly outputs: readonly {
    readonly format: 'pdf';
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly standard: 'ua-1';
  }[];
}

const publicationColumns = [
  'p.id',
  'p.document_id',
  'p.document_version_id',
  'p.published_at',
  'p.approval',
  'p.formats',
  'p.engine_version',
  'p.template_version',
  'p.pipeline_version',
  'pr.id as publisher_id',
  'pr.display_name as publisher_name',
  'v.revision_no',
  'v.version_no',
] as const;

/** One publication, or undefined where this environment holds no publication of that id. */
export async function readPublication(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublication | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication as p')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const outputs = await trx
    .selectFrom('publication_output')
    .select(['format', 'object_key', 'sha256', 'bytes', 'standard'])
    .where('publication_id', '=', id)
    .orderBy('format')
    .execute();
  return {
    ...summaryOf(row),
    outputs: outputs.map((each) => ({
      format: each.format,
      key: each.object_key,
      sha256: each.sha256,
      bytes: each.bytes,
      standard: each.standard,
    })),
  };
}

/**
 * A document's publications the principal may read, newest first (PUB-048): filtered by the one
 * readable-set predicate every listing uses, over the **publication** artifacts - so a grant on the
 * document alone reaches none of them (decision D). A publication's time is to the second, so ties
 * are broken by when each was recorded (finding 11). Undefined when the tenant holds no such principal.
 */
export async function listPublications(
  trx: TenantTransaction,
  documentId: string,
  principalId: string,
): Promise<readonly Omit<StoredPublication, 'outputs'>[] | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const rows = await trx
    .selectFrom('publication as p')
    .innerJoin('artifact as a', 'a.id', 'p.id')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .where('p.document_id', '=', documentId)
    .where((eb) => readableArtifacts(eb, readable))
    .orderBy('p.published_at', 'desc')
    .orderBy('a.created_at', 'desc')
    .execute();
  return rows.map(summaryOf);
}

function summaryOf(row: {
  id: string;
  document_id: string;
  document_version_id: string;
  title: string;
  published_at: Date;
  approval: 'none';
  formats: string[];
  engine_version: string;
  template_version: number;
  pipeline_version: string;
  publisher_id: string;
  publisher_name: string | null;
  revision_no: number;
  version_no: number;
}): Omit<StoredPublication, 'outputs'> {
  return {
    id: row.id,
    documentId: row.document_id,
    documentVersion: {
      id: row.document_version_id,
      number: `${row.revision_no}.${row.version_no}`,
    },
    title: row.title,
    publisher: { id: row.publisher_id, displayName: row.publisher_name },
    publishedAt: row.published_at,
    approval: row.approval,
    formats: row.formats,
    engine: { name: 'typst', version: row.engine_version },
    template: { name: 'publication', version: row.template_version },
    pipelineVersion: row.pipeline_version,
  };
}
```

- [ ] **Step 7: The handlers**

`apps/service/src/publishing.ts`:

```ts
import type { DocumentParams, RequestPublicationBody } from '@alloy-works/api-contract';
import {
  listPublications,
  readPublication,
  readPublicationRequest,
  requestPublication,
  type StoredPublication,
  type StoredPublicationRequest,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

/** A download link lasts five minutes: long enough to follow, short enough not to be a share. */
export const DOWNLOAD_SECONDS = 300;

const requestView = (request: StoredPublicationRequest) => ({
  id: request.id,
  document: request.documentId,
  state: request.state,
  failures: request.failures.map((each) => ({ ...each })),
  publication: request.publication,
});

const summaryView = (publication: Omit<StoredPublication, 'outputs'>) => ({
  id: publication.id,
  document: publication.documentId,
  version: { ...publication.documentVersion },
  title: publication.title,
  publisher: { ...publication.publisher },
  publishedAt: publication.publishedAt.toISOString(),
  approval: publication.approval,
  formats: [...publication.formats],
});

/**
 * Publishing a document, following the request, and reading what was published
 * (docs/design/publishing.md, "Routes"). Nothing here is put on the stream: a request is followed by
 * its requester through `GET /v1/publication-requests/{id}`, so no event about a document reaches a
 * viewer who may not read it (issue #147, decision G).
 */
export function publishingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  objects: ObjectStores | undefined,
) {
  return {
    /** `publish` was decided on the document; everything else is decided and recorded here, at once. */
    requestPublication: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const body = request.body as RequestPublicationBody;
      const answer = await requestPublication(trx, {
        documentId: id,
        version: body.version,
        formats: body.formats,
        requester: principalId,
      });
      switch (answer.answer) {
        case 'document.missing':
          throw notFound();
        case 'version.precondition':
          throw new AppError(
            409,
            wireCode('version.precondition'),
            'This document has a newer version than the one this page opened.',
          );
        case 'format.unsupported':
          throw new AppError(
            400,
            'format_unsupported',
            'This document can be published as PDF only.',
          );
        case 'requested':
          return requestView((await readPublicationRequest(trx, answer.request.id))!);
      }
    },

    /** The requester's alone: anybody else is answered as if there were no such request. */
    getPublicationRequest: async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const principal = principalOf(request);
      const found = await db.withTenant(tenantOf(request), (trx) =>
        readPublicationRequest(trx, id),
      );
      if (!found || found.requestedBy !== principal.principalId) throw notFound();
      return requestView(found);
    },

    listPublications: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const listed = await listPublications(trx, id, principalId);
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return { items: listed.map(summaryView) };
    },

    /**
     * `read` was decided on the publication artifact itself, so a grant on its document reaches none of
     * it (decision D). A component's or a document's id authorises, and is then not a publication.
     */
    getPublication: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as { id: string };
      const publication = await readPublication(trx, id);
      if (!publication) throw notFound();
      if (!objects) {
        throw new AppError(
          503,
          'storage_unavailable',
          'This environment has nowhere to keep documents yet. Try again later.',
        );
      }
      const store = await objects.forTenant(trx, tenantOf(request));
      return {
        ...summaryView(publication),
        engine: { ...publication.engine },
        template: { ...publication.template },
        pipeline: publication.pipelineVersion,
        outputs: await Promise.all(
          publication.outputs.map(async (output) => ({
            format: output.format,
            bytes: output.bytes,
            sha256: output.sha256,
            standard: output.standard,
            download: await store.signedLink(
              output.key,
              DOWNLOAD_SECONDS,
              `${publication.id}.${output.format}`,
            ),
          })),
        ),
      };
    },
  };
}
```

In `app.ts`, `...publishingHandlers(db, tenantOf, principalOf, options.objects),` after the document
handlers. In `apps/service/src/documents.ts`, the `Viewer` gains `readonly mayPublish: boolean`,
`documentView` answers `mayPublish: viewer.mayPublish`, and each of the three places a viewer is made
decides it beside `mayEdit`: `mayPublish: decide('publish', facts).allowed`.

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm build && pnpm --filter @alloy-works/service test && pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test`
Expected: PASS - the service suite 272 of 272 as measured (its six new tests included), the contract
25 of 25, the client 4 of 4.

- [ ] **Step 9: Move the pins, and commit**

Requirements **1382**, claims **408**, citations **193**, each with its comment:

```ts
// 1382, from 1381: PUB-094, publishing never containing what its publisher could not read (issue
// #143), landed by the first publishing plan.
```

```ts
// 408, from 407: publishing.md claims PUB-094, decision C as a requirement.
```

```ts
// 193, from 189: the same plan cites IAM-074, PUB-094, PUB-047 and PUB-048 in
// apps/service/src/publication-routes.test.ts: the publisher's read decided at the publication,
// refused by place alone, and a publication kept, addressed, read on its own grants and listed.
```

`CLAUDE.md` and `docs/guides/reading-the-trace.md` say 1,382.

```bash
pnpm --filter @alloy-works/trace generate
git add packages apps/service docs/specification docs/design/publishing.md CLAUDE.md \
  docs/guides/reading-the-trace.md
git commit -m "Publish, follow, list and read publications through the service (#143)"
```

---

## Task 9: Publishing from the page

**Publish as PDF** on the document page for somebody who may publish, the request followed until it is
made or its failures are known, the document's publications beneath the lists, and a publication's own
page.

**Files:**

- Create: `apps/web/src/publishing/failures.ts`, `Publishing.tsx`, `Publishing.test.tsx`,
  `PublicationPage.tsx`, `PublicationPage.test.tsx`
- Modify: `apps/web/src/structure/DocumentPage.tsx`, `DocumentPage.test.tsx`,
  `apps/web/src/editor/Workspace.tsx`, `Workspace.test.tsx`

**Interfaces:**

- Consumes: the four routes and `DocumentView.mayPublish` (task 8); `nodeName`, `Names` from
  `structure/tree.ts`; `number`, `sectionNumbers` from the domain.
- Produces: `<Publishing client document version mayPublish placeOf followMs? />`;
  `<PublicationPage client id />`; `failureWords(failure)`; the address `#/publications/{id}`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/publishing/Publishing.test.tsx`:

```tsx
import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { Publishing } from './Publishing.js';

const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 'dddddddd-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000001';
const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const CALIBRATION = 'cccccccccccccccccccccccccc';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Canned answers by method and path. A list is answered in turn, its last answer repeating; a function
 * answers by state - which is what a fake needs where StrictMode reads a route twice on mounting.
 */
function service(answers: Record<string, unknown[] | (() => unknown)>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ method: request.method, url, body });
    const answer = answers[`${request.method} ${url}`];
    if (typeof answer === 'function') return json(200, answer());
    if (!answer || answer.length === 0) {
      return json(500, { code: 'internal', message: 'x', traceId: 't' });
    }
    return json(200, answer.length > 1 ? answer.shift() : answer[0]);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const open = (fetch: typeof globalThis.fetch, mayPublish = true) =>
  render(
    <StrictMode>
      <Publishing
        client={createApiClient({ baseUrl: 'http://acme.example.test', fetch })}
        document={DOCUMENT}
        version={VERSION}
        mayPublish={mayPublish}
        placeOf={(node) => (node === HIDDEN ? '1.2 A component' : '1.1 Calibration')}
        followMs={0}
      />
    </StrictMode>,
  );

const listed = (items: unknown[]) => ({ items });
const publication = {
  id: PUBLICATION,
  document: DOCUMENT,
  version: { id: VERSION, number: '0.3' },
  title: 'The dosing report',
  publisher: { id: 'p', displayName: 'Ada' },
  publishedAt: '2026-09-19T09:00:00.000Z',
  approval: 'none',
  formats: ['pdf'],
};
const queued = (failures: unknown[] = []) => ({
  id: REQUEST,
  document: DOCUMENT,
  state: 'queued',
  failures,
  publication: null,
});

describe('publishing from the document page', () => {
  it('publishes the version on screen, follows the request, and lists the new publication', async () => {
    let asked = 0;
    let done = false;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed(done ? [publication] : []),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Still queued the first time it is asked about, and made the second.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        done = asked > 1;
        return done ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch);
    expect(
      await screen.findByText('Nothing has been published from this document.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByRole('link', { name: 'Open the publication' })).toHaveAttribute(
      'href',
      `#/publications/${PUBLICATION}`,
    );
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toHaveAttribute('href', `#/publications/${PUBLICATION}`);
    expect(fake.sent.find((each) => each.method === 'POST')?.body).toEqual({
      version: VERSION,
      formats: ['pdf'],
    });
  });

  it('names every failure by its place, and a component the author may not read as nothing more than that', async () => {
    const failures = [
      { stage: 'resolve', code: 'occurrence_unreadable', node: HIDDEN, block: null, detail: null },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: CALIBRATION,
        block: 'b1',
        detail: 'table',
      },
      { stage: 'compose', code: 'glyph_missing', node: CALIBRATION, block: 'b2', detail: 'U+0627' },
    ];
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([])],
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued(failures.slice(0, 1))],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(failures), state: 'failed' }],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent('1.2 A component: A component you may not read is placed here.');
    expect(why).toHaveTextContent('1.1 Calibration: A table cannot be published yet.');
    expect(why).toHaveTextContent(
      '1.1 Calibration: The character U+0627 is in no typeface this publication can use.',
    );
  });

  it('offers no Publish to somebody who may only read, and still lists what was published', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([publication])],
    });
    open(fake.fetch, false);
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish as PDF' })).toBeNull();
  });
});
```

`apps/web/src/publishing/PublicationPage.test.tsx`:

```tsx
import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { PublicationPage } from './PublicationPage.js';

const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const LINK = 'http://store.example.test/t_acme/sha256/abc?X-Amz-Signature=s';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const open = (answer: Response) =>
  render(
    <StrictMode>
      <PublicationPage
        client={createApiClient({
          baseUrl: 'http://acme.example.test',
          fetch: (async () => answer.clone()) as unknown as typeof fetch,
        })}
        id={PUBLICATION}
      />
    </StrictMode>,
  );

describe('a publication at its own address', () => {
  it('says it is not approved, who published which version, and offers its PDF', async () => {
    open(
      json(200, {
        id: PUBLICATION,
        document: DOCUMENT,
        version: { id: 'v', number: '0.3' },
        title: 'The dosing report',
        publisher: { id: 'p', displayName: 'Ada' },
        publishedAt: '2026-09-19T09:00:00.000Z',
        approval: 'none',
        formats: ['pdf'],
        engine: { name: 'typst', version: '0.15.1' },
        template: { name: 'publication', version: 1 },
        pipeline: '1',
        outputs: [
          {
            format: 'pdf',
            bytes: 30_000,
            sha256: 'a'.repeat(64),
            standard: 'ua-1',
            download: LINK,
          },
        ],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
    expect(screen.getByText(/Version 0\.3, published by Ada/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the PDF' })).toHaveAttribute('href', LINK);
    expect(screen.getByRole('link', { name: 'Open the document' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
  });

  it('says there is nothing here where the reader may not read it', async () => {
    open(
      json(404, { code: 'not_found', message: 'There is nothing at this address.', traceId: 't' }),
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
```

In `apps/web/src/editor/Workspace.test.tsx`, before "opens a document at the node its address
names":

```tsx
it('opens a publication at its own address', async () => {
  const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') return json(200, me);
    if (url.pathname === `/v1/publications/${PUBLICATION}`) {
      return json(200, {
        id: PUBLICATION,
        document: 'eeeeeeee-0000-4000-8000-000000000001',
        version: { id: 'v', number: '0.3' },
        title: 'The dosing report',
        publisher: { id: 'p1', displayName: 'Ada' },
        publishedAt: '2026-09-19T09:00:00.000Z',
        approval: 'none',
        formats: ['pdf'],
        engine: { name: 'typst', version: '0.15.1' },
        template: { name: 'publication', version: 1 },
        pipeline: '1',
        outputs: [],
      });
    }
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;

  window.location.hash = `#/publications/${PUBLICATION}`;
  render(
    <StrictMode>
      <Workspace fetch={fetching} />
    </StrictMode>,
  );
  expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
  expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
});
```

Every other document view in `Workspace.test.tsx` and `DocumentPage.test.tsx` gains
`mayPublish: false`, and `DocumentPage.test.tsx`'s fake answers the listing, beside the document:

```ts
if (url === `/v1/documents/${DOCUMENT}/publications`) return json(200, { items: [] });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @alloy-works/web test`
Expected: FAIL - `Failed to load url ./Publishing.js` and `./PublicationPage.js`, and the workspace
showing the component list at `#/publications/...`.

- [ ] **Step 3: Write the words and the panel**

`apps/web/src/publishing/failures.ts`:

```ts
/** One failure as the service answers it (`PublishFailureView`). */
export interface Failure {
  readonly stage: string;
  readonly code: string;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}

const BLOCKS: Readonly<Record<string, string>> = {
  list: 'A list',
  table: 'A table',
  figure: 'A figure',
  preformatted: 'Preformatted text',
  blockquote: 'A quotation',
  equation: 'An equation',
};

/**
 * What a failure says to the author, in words: never a code, never an engine's diagnostic, and never
 * anything of a component they may not read - an unreadable place is named by where it is, which the
 * caller supplies, and this says only that a component is there.
 */
export function failureWords(failure: Failure): string {
  switch (failure.code) {
    case 'occurrence_unreadable':
      return 'A component you may not read is placed here. Only someone who may read every component can publish this document.';
    case 'occurrence_unresolved':
      return 'This reference waits on an approved version, and nothing can approve one yet.';
    case 'title_not_publishable':
      return 'This title holds something that cannot be published yet.';
    case 'block_not_publishable':
      return `${BLOCKS[failure.detail ?? ''] ?? 'This block'} cannot be published yet.`;
    case 'inline_not_publishable':
      return 'This paragraph holds formatting or an inline item that cannot be published yet.';
    case 'style_missing':
      return 'This paragraph uses a style the publication template does not set.';
    case 'glyph_missing':
      return `The character ${failure.detail ?? ''} is in no typeface this publication can use.`;
    case 'character_disallowed':
      return `An invisible character, ${failure.detail ?? ''}, cannot be published. Delete it and publish again.`;
    case 'store_failed':
      return 'The publication could not be stored. Publish again.';
    default:
      return 'The publication could not be made. Publish again.';
  }
}
```

`apps/web/src/publishing/Publishing.tsx`:

```tsx
import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { failureWords, type Failure } from './failures.js';

type Client = ReturnType<typeof createApiClient>;

/** How often a waiting publish is asked about. A publish takes a second or two. */
export const FOLLOW_MS = 1000;

interface Listed {
  readonly id: string;
  readonly version: { readonly number: string };
  readonly publisher: { readonly displayName: string | null };
  readonly publishedAt: string;
}

type Publish =
  | { readonly state: 'idle' }
  | { readonly state: 'working' }
  | { readonly state: 'done'; readonly publication: string }
  | { readonly state: 'failed'; readonly failures: readonly Failure[] }
  | { readonly state: 'refused'; readonly words: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The client's bodies are `any`: each failure is checked member by member, never trusted. */
function failuresIn(value: unknown): Failure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) =>
    isRecord(each) && typeof each.code === 'string'
      ? [
          {
            stage: String(each.stage),
            code: each.code,
            node: typeof each.node === 'string' ? each.node : null,
            block: typeof each.block === 'string' ? each.block : null,
            detail: typeof each.detail === 'string' ? each.detail : null,
          },
        ]
      : [],
  );
}

function listedIn(value: unknown): Listed[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  return value.items.flatMap((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.publishedAt === 'string' &&
    isRecord(item.version) &&
    typeof item.version.number === 'string' &&
    isRecord(item.publisher)
      ? [
          {
            id: item.id,
            version: { number: item.version.number },
            publisher: {
              displayName:
                typeof item.publisher.displayName === 'string' ? item.publisher.displayName : null,
            },
            publishedAt: item.publishedAt,
          },
        ]
      : [],
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

/**
 * A document's publications, and - for somebody who may publish it - **Publish as PDF**: the version
 * on screen, asked for, then followed through its request until it is made or every failure is known,
 * each named by its place in the outline (`placeOf`). Nothing is heard from the stream (issue #147,
 * decision G): the request is asked about every second while this page is open, and only by the person
 * who asked. Its live region is polite and has no `status` role: the page around it has one already
 * (finding 10).
 */
export function Publishing({
  client,
  document,
  version,
  mayPublish,
  placeOf,
  followMs = FOLLOW_MS,
}: {
  readonly client: Client;
  readonly document: string;
  readonly version: string;
  readonly mayPublish: boolean;
  readonly placeOf: (node: string) => string;
  /** Given in tests, which need not wait a second. */
  readonly followMs?: number;
}) {
  const [listed, setListed] = useState<Listed[] | 'failed' | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [publish, setPublish] = useState<Publish>({ state: 'idle' });
  const following = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (following.current !== null) clearTimeout(following.current);
    };
  }, []);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/documents/{id}/publications', { params: { path: { id: document } } })
      .then(({ data }) => {
        if (current) setListed(listedIn(data) ?? 'failed');
      })
      .catch(() => {
        if (current) setListed('failed');
      });
    return () => {
      current = false;
    };
  }, [client, document, listAttempt]);

  const follow = useCallback(
    (request: string) => {
      following.current = setTimeout(() => {
        following.current = null;
        client
          .GET('/v1/publication-requests/{id}', { params: { path: { id: request } } })
          .then(({ data }) => {
            if (!mounted.current) return;
            if (!isRecord(data)) {
              setPublish({
                state: 'refused',
                words: 'The publish could not be followed. Look for it below later.',
              });
            } else if (data.state === 'done' && typeof data.publication === 'string') {
              setPublish({ state: 'done', publication: data.publication });
              setListAttempt((count) => count + 1);
            } else if (data.state === 'failed') {
              setPublish({ state: 'failed', failures: failuresIn(data.failures) });
            } else {
              follow(request);
            }
          })
          .catch(() => {
            if (mounted.current) follow(request);
          });
      }, followMs);
    },
    [client, followMs],
  );

  const start = async () => {
    setPublish({ state: 'working' });
    try {
      const { data, response } = await client.POST('/v1/documents/{id}/publications', {
        params: { path: { id: document } },
        body: { version, formats: ['pdf'] },
      });
      if (!mounted.current) return;
      if (isRecord(data) && typeof data.id === 'string') {
        follow(data.id);
        return;
      }
      setPublish({
        state: 'refused',
        words:
          response.status === 409
            ? 'This document has changed since the page opened. Reload it and publish again.'
            : response.status === 403
              ? 'You may read this document but not publish it.'
              : 'The publish could not be asked for. Try again.',
      });
    } catch {
      if (mounted.current) {
        setPublish({ state: 'refused', words: 'The publish could not be asked for. Try again.' });
      }
    }
  };

  return (
    <section aria-labelledby="publications-title">
      <h3 id="publications-title">Publications</h3>
      {mayPublish && (
        <p>
          <button type="button" disabled={publish.state === 'working'} onClick={() => void start()}>
            Publish as PDF
          </button>
        </p>
      )}
      <div aria-live="polite">
        {publish.state === 'working' && <p>Publishing...</p>}
        {publish.state === 'done' && (
          <p>
            Published. <a href={`#/publications/${publish.publication}`}>Open the publication</a>
          </p>
        )}
        {publish.state === 'refused' && <p>{publish.words}</p>}
        {publish.state === 'failed' && (
          <>
            <p>The document could not be published. Put these right and publish again:</p>
            <ul aria-label="Why it could not be published">
              {publish.failures.map((failure, index) => (
                <li key={`${failure.code}-${failure.node ?? ''}-${failure.block ?? ''}-${index}`}>
                  {failure.node === null ? '' : `${placeOf(failure.node)}: `}
                  {failureWords(failure)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {listed === null && <p>Reading the publications...</p>}
      {listed === 'failed' && (
        <p>
          The publications could not be read.{' '}
          <button type="button" onClick={() => setListAttempt((count) => count + 1)}>
            Try again
          </button>
        </p>
      )}
      {Array.isArray(listed) && listed.length === 0 && (
        <p>Nothing has been published from this document.</p>
      )}
      {Array.isArray(listed) && listed.length > 0 && (
        <ul>
          {listed.map((each) => (
            <li key={each.id}>
              <a href={`#/publications/${each.id}`}>
                Version {each.version.number}, published by{' '}
                {each.publisher.displayName ?? 'somebody'} on {when(each.publishedAt)}
              </a>{' '}
              (not approved)
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Write the publication's page and its address**

`apps/web/src/publishing/PublicationPage.tsx`:

```tsx
import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly title: string;
  readonly document: string;
  readonly version: string;
  readonly publisher: string | null;
  readonly publishedAt: string;
  readonly engine: string;
  readonly template: number;
  readonly download: string | null;
  readonly bytes: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A `PublicationView`, checked member by member: the client's bodies are `any`. */
function shownIn(data: unknown): Shown | undefined {
  if (!isRecord(data) || typeof data.title !== 'string' || typeof data.document !== 'string') {
    return undefined;
  }
  if (!isRecord(data.version) || typeof data.version.number !== 'string') return undefined;
  if (!isRecord(data.publisher) || typeof data.publishedAt !== 'string') return undefined;
  if (!isRecord(data.engine) || typeof data.engine.version !== 'string') return undefined;
  if (!isRecord(data.template) || typeof data.template.version !== 'number') return undefined;
  const [pdf] = Array.isArray(data.outputs)
    ? data.outputs.filter((each) => isRecord(each) && each.format === 'pdf')
    : [];
  return {
    title: data.title,
    document: data.document,
    version: data.version.number,
    publisher: typeof data.publisher.displayName === 'string' ? data.publisher.displayName : null,
    publishedAt: data.publishedAt,
    engine: data.engine.version,
    template: data.template.version,
    download: isRecord(pdf) && typeof pdf.download === 'string' ? pdf.download : null,
    bytes: isRecord(pdf) && typeof pdf.bytes === 'number' ? pdf.bytes : null,
  };
}

/**
 * One publication at its own address, `#/publications/{id}` (PUB-047): what it is, that it is not
 * approved, who published which version and when, what made it, and its PDF. A publication the reader
 * may not read is answered as nothing here, as every other address is.
 */
export function PublicationPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [shown, setShown] = useState<Shown | 'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/publications/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (response.status === 404) setShown('missing');
        else setShown(shownIn(data) ?? 'failed');
      })
      .catch(() => {
        if (current) setShown('failed');
      });
    return () => {
      current = false;
    };
  }, [client, id, attempt]);

  if (shown === null) return <p>Opening...</p>;
  if (shown === 'missing') return <p>There is nothing here, or nothing you may read.</p>;
  if (shown === 'failed') {
    return (
      <>
        <p>The publication could not be opened.</p>
        <button type="button" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </button>
      </>
    );
  }
  return (
    <article aria-labelledby="publication-title">
      <h2 id="publication-title">{shown.title}</h2>
      <p>Not approved. This is a draft publication, not made from an approved baseline.</p>
      <p>
        Version {shown.version}, published by {shown.publisher ?? 'somebody'} on{' '}
        {new Date(shown.publishedAt).toLocaleString(undefined, {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        .
      </p>
      <p>
        Made with Typst {shown.engine} and publication template {shown.template}.
      </p>
      {shown.download !== null && (
        <p>
          <a href={shown.download}>Download the PDF</a>
          {shown.bytes !== null && ` (${Math.max(1, Math.round(shown.bytes / 1024))} KB)`}
        </p>
      )}
      <p>
        <a href={`#/documents/${shown.document}`}>Open the document</a>
      </p>
    </article>
  );
}
```

In `apps/web/src/editor/Workspace.tsx`, import `PublicationPage`, and beside `OPEN`:

```ts
/** A publication's own address (PUB-047). */
const PUBLICATION = /^#\/publications\/([0-9a-f-]{36})$/;
```

and before the document addresses are read:

```tsx
const publication = PUBLICATION.exec(hash)?.[1];
if (publication) {
  return (
    <>
      <Places />
      <PublicationPage key={publication} client={client} id={publication} />
    </>
  );
}
```

- [ ] **Step 5: Put the panel on the document page**

In `apps/web/src/structure/DocumentPage.tsx`, `Opened` gains `readonly mayPublish: boolean`, and
`documentIn` reads it as it reads `mayEdit`:

```ts
const { id, space, version, outline, mayEdit, mayPublish } = data;
if (typeof id !== 'string' || typeof mayEdit !== 'boolean' || typeof mayPublish !== 'boolean') {
  return undefined;
}
```

A failure's place, from the outline the page holds - section numbers depend on the outline alone, so
none is withheld:

```ts
/**
 * Where a node is, in words a failure can be read by: its section number, if it has one, and its
 * name - a section's title, or for a reference its component's, and **A component** wherever the
 * reader may not read it. A node the outline no longer holds is said to be gone.
 */
function placeInOutline(outline: OutlineView, node: string, names: Names): string {
  let found: OutlineViewNode | undefined;
  walkOutline(outline.nodes, (each) => {
    if (each.id === node) found = each;
  });
  if (found === undefined) return 'A part no longer in this document';
  const numbers = sectionNumbers(
    number(conditions(resolve(outline, new Map())), defaultNumberingScheme),
  );
  const numbered = numbers.get(node);
  return numbered === undefined ? nodeName(found, names) : `${numbered} ${nodeName(found, names)}`;
}
```

and after `<GeneratedLists ... />`:

```tsx
<Publishing
  client={client}
  document={document.id}
  version={document.version.id}
  mayPublish={document.mayPublish}
  placeOf={(node) => placeInOutline(document.outline, node, names)}
/>
```

importing `conditions`, `defaultNumberingScheme`, `number`, `resolve`, `sectionNumbers`, `walkOutline`
and `type OutlineViewNode` from the domain, and `Publishing`.

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm --filter @alloy-works/web test`
Expected: PASS - 382 of 382 as measured, `dashes.test.ts` included.

- [ ] **Step 7: Commit**

```bash
pnpm --filter @alloy-works/trace generate
git add apps/web packages/trace/trace.json
git commit -m "Publish from the document page, and open a publication at its own address"
```

---

## Task 10: The whole stack

The worker image is where a font or a template left out of the build turns into a blank page or a
missing file, and nothing in a suite runs it. The end-to-end check publishes through the compose
stack.

**Files:**

- Modify: `tests/e2e/src/stack.test.ts`

- [ ] **Step 1: Write the failing test**

After "hands out documents by signed link only":

```ts
it('publishes a document to a PDF set in the pinned face, and keeps it', async () => {
  const api = client();
  const { data: spaces } = await api.GET('/v1/spaces');
  const general = spaces!.items.find((space) => space.name === 'General')!;
  const { data: components } = await api.GET('/v1/components');
  const printer = components!.items[0]!;
  const { data: made } = await api.POST('/v1/spaces/{space}/documents', {
    params: { path: { space: general.id } },
    body: { title: 'The dosing report', language: 'en-GB', direction: 'ltr' },
  });
  const { data: placed } = await api.POST('/v1/documents/{id}/outline', {
    params: { path: { id: made!.id } },
    body: {
      openedFrom: made!.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: printer.id, mode: { kind: 'latest' } },
      },
    },
  });
  expect(placed?.mayPublish).toBe(true);

  const { data: asked } = await api.POST('/v1/documents/{id}/publications', {
    params: { path: { id: made!.id } },
    body: { version: placed!.version.id, formats: ['pdf'] },
  });
  let publication: string | null = null;
  await vi.waitFor(
    async () => {
      const { data } = await api.GET('/v1/publication-requests/{id}', {
        params: { path: { id: asked!.id } },
      });
      expect(data?.failures).toEqual([]);
      expect(data?.state).toBe('done');
      publication = data!.publication;
    },
    { timeout: 60_000, interval: 250 },
  );

  const { data: kept } = await api.GET('/v1/publications/{id}', {
    params: { path: { id: publication! } },
  });
  expect(kept).toMatchObject({ approval: 'none', engine: { name: 'typst', version: '0.15.1' } });
  const pdf = await followSignedLink(new URL(kept!.outputs[0]!.download));
  expect(pdf.status).toBe(200);
  expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // The image carries the pinned faces and the template: a publication set in anything else, or
  // in nothing, is the failure this test exists for (#145).
  expect(pdf.body.toString('latin1')).toContain('LiberationSerif');
}, 120_000);
```

- [ ] **Step 2: Run it to see it fail, then pass**

Run: `docker compose -f deploy/compose.yaml up -d --build --wait && pnpm test:e2e`
Expected: FAIL before the worker image is rebuilt with this branch (the request stays queued: the
running worker has no `publish` handler and refuses the kind); PASS once it is. This is the one step
that rebuilds the stack's images and so replaces running containers: run it in the build, never
against an environment somebody is using. **Not run while planning** - only typechecked against the
regenerated client, cleanly - because it replaces running containers. Its expectations rest on
`pnpm deploy` copying `apps/worker/fonts/` and `templates/` into the image, as it already copies
`templates/sample.typ`; `loadPinnedFonts` refusing to start is what would say it did not.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/src/stack.test.ts
git commit -m "Publish a document through the whole stack"
```

---

## Task 11: The trace, the docs and the release

**Files:**

- Modify: `docs/design/publishing.md`, `docs/architecture.md`, `docs/features.md`, `README.md`,
  `docs/development.md`, `docs/testing.md`, `docs/plans/README.md`, `CHANGELOG.md`, `version.json`,
  `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Amend the design for what was built**

In `docs/design/publishing.md`:

- the open question on heading levels seven to nine is answered - veraPDF passes, 106 rules; Typst tags
  them `H7`-`H9` role-mapped to `P`; PUB-090 stays unclaimed pending decision A - and the prose beside the
  requirements table says so in place of "is not known";
- "What was run" gains the rows this plan measured: nine levels through veraPDF; the fifteen probe
  characters; 208 pages in 425 ms; veraPDF at 11.1 s for one page and 17.0 s for 208;
- a section **Changed while planning and building the first slice** lists findings 1 to 15 against
  the design and the decisions Ken took on this plan, each with where it changed the text: the request
  answers 200; nothing goes on the stream (decision G, which replaces "The stream tells the requester
  alone"); the glyph check's measured exemptions and U+FEFF; the language carried as language and
  region; `publication_output`'s key check; requests not swept; the development seed; slice 1 without
  marks, languages marks or hyperlinks, and without the theme; PUB-003 and PUB-073 not cited by slice 1;
- the build order's slice 1 says what it cites, and slice 3 gains marks, hyperlinks and language marks.

- [ ] **Step 2: The rest of the docs**

- `docs/architecture.md`: the worker publishes - `jobs/publish.ts`, the pinned fonts and `fonts.ts`,
  `templates/publication/1/`, `JobRefused`; migration 0017 and its tables; the four routes; the panel and
  the page; the regression corpus and veraPDF in its container. The worker's dependency on the domain.
- `docs/features.md` and `README.md` in lockstep: a document can be published as a tagged PDF that says
  it is not approved, kept, listed and downloaded; what is not published yet (formatting, lists, tables,
  figures, footnotes, equations, a layout, a theme, Word, preview).
- `docs/development.md`: `pnpm --filter @alloy-works/worker fetch-verapdf`, Docker for the worker's
  suite, and publishing in the development environment as Ada or Grace.
- `docs/testing.md`: the regression corpus - what a case is, veraPDF by digest, pdf.js reading what a
  screen reader is told - and that a case is added for every publishing defect (PUB-087).
- `docs/plans/README.md`: the Publishing row's status, `Built (PR #n)`, and a paragraph on what was
  built and found, in the house style.
- `CLAUDE.md`'s status paragraph, which says "no publishing": a document publishes to a tagged PDF of
  its outline and paragraphs, and nothing else yet; the component table's worker row says it publishes.

- [ ] **Step 3: The release**

`version.json`, the root `package.json` and `apps/desktop/package.json`: **0.30.0**. At the top of
`CHANGELOG.md`, with the date and the pull request's number once it exists:

```markdown
## 0.30.0 - YYYY-MM-DD (PR #n)

### Added

- **Publish a document as a PDF.** A document's page has **Publish as PDF** for anybody who may
  publish it. A second or two later the publication is ready: a tagged PDF of the version on the page,
  its sections numbered as the outline shows them and bookmarked, each component's paragraphs beneath
  its heading, set in Liberation Serif.
- **Every publication says it is not approved**, on every page and once where a screen reader reads it,
  because nothing can approve one yet. Publications are kept for ever and never changed: publishing
  again makes another.
- **The document's publications are listed beneath its outline**, each with who published which version
  and when, and each has its own page with a download. Who may read a publication is decided on the
  publication, so somebody given a single document does not see its publications unless given them too.
- **A Publisher role**, holding read and publish. In the development environment, Ada and Grace hold it
  on General.
- **When a document cannot be published, you are told every reason at once**, each at its place in the
  outline: a component you may not read (never which one), a block or formatting that cannot be
  published yet, or a character no typeface can set.

### Fixed

- The sample PDF was set in whatever typefaces the engine carried, and with none at all would have
  printed blank pages without a warning. Every PDF is now set in typefaces the product ships and pins,
  and the worker will not start without them (#145).
- A job that failed because of what it was given was tried again, and failed the same way each time.
  It now fails once, at once, with its reason (#146).
```

- [ ] **Step 4: Check everything, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace check && pnpm trace gate
grep -nP '[^\x00-\x7F]' $(git diff --name-only origin/main -- '*.ts' '*.tsx' '*.typ' '*.sql')
```

Expected: every check green; `trace check` reporting **No problems in the corpus.**; the regenerated
model holding **1382 requirements, 408 claims and 193 citations**; the `grep` printing nothing - no
character outside ASCII in any source file this plan touched.

```bash
git add docs README.md CHANGELOG.md version.json package.json apps/desktop/package.json
git commit -m "Publishing 1: a document to PDF (0.30.0)"
```

Open the pull request with `Fixes #145`, `Fixes #146`, `Closes #142` and `Closes #143` on lines of their
own, and put its number and date in the changelog heading.

---

## Trying it by hand

What a person can see, in the development environment after `pnpm dev:setup` (which grants Ada and
Grace Publisher) and the service, the worker and the stand-in provider running:

1. Sign in as Ada. Open **Documents**, make **The dosing report**, and add a section **Introduction**
   and a reference to **Install the printer**.
2. Beneath the lists, **Publications** says nothing has been published. Press **Publish as PDF**:
   **Publishing...**, then **Published.** and a link, and the list shows **Version 0.3, published by
   Ada on ...** (not approved).
3. Open it: the page says **Not approved.**, who published which version, and **Download the PDF**.
   The PDF has **Not approved** at the top of every page, the title, the sentence once in bold, and
   **1 Introduction** and **2 Install the printer** in its bookmarks.
4. As Grace, make a component in a space Ada may not read and place it in the document; as Ada,
   publish again: **2 A component: A component you may not read is placed here.** and nothing else of
   it.
5. Sign in as Alice, who reads General and does not publish: the list is there, and no button.

### What a person can see, and what only a test proves

A screen reader's view of the PDF - the notice read once, levels seven to nine read as paragraphs - is
shown by pdf.js in the suite and by opening the PDF in a screen reader by hand; veraPDF's verdict only
by the suite. That no retry happens is the job row's `attempts`, which only a test reads. That nothing
of an unreadable component reaches the response is the test's `not.toContain`, not something a page
can show.

## What this plan deliberately leaves undone

Named, so the next plan starts from a list: **the layout** - the layout artifact, running heads and
feet, page numbering per matter and outline `front` matter, the cover, the contents and lists, the
layout's scheme to the panel, the words in the layout's language (#144) - publishing 2's; **the rest of
the content** - marks, hyperlinks, language marks, lists, quotations, preformatted text, tables,
figures with assets, footnotes, equations and their mathematics face, citations failing, cross-references
once structure 4 resolves them, the spike's nine regression cases ported (PUB-087's citation) and
PUB-003's citation - publishing 3's; **the theme's projection and typeface artifacts** replacing the
image's faces - publishing 4's; **veraPDF on every publication and its report kept** (PUB-091), the
budget measured (PUB-085, once amended), PUB-090 if decision A is taken as proposed, and floats' reading
order (PUB-031) - publishing 5's; **preview** - publishing 6's; **Word** and PUB-073 - publishing 7's;
**sweeping finished requests** (decision M); **per-viewer events on the stream** (#147's fix, decision
G); **contributions after conditions** (#148), REU's; `numberingInputs` rebuilt on `resolveOccurrences`;
a publication shared outside the tenant (PUB-084); and the end-to-end check (task 10) and the
application itself, which planning did not run.
