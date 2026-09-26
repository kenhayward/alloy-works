# W1: Test debt, and CI's test time

> **A sketch**, built a task at a time, with one final whole-branch review before each pull request,
> as the Word slices were. It builds W1 of [the rest of T1](2026-09-25-t1-remainder.md): the
> requirements the audit found built and uncited, and the three changes to how CI runs the tests
> that Ken added on 2026-09-25.
>
> **Built** (PRs #239, #241, #243). [What the build changed](#what-the-build-changed) records where it
> departed from the tasks below.

**Goal:** the trace counts everything T1 has built that a test can show, and CI's test step stops
spending most of its time starting Java.

**Three pull requests**, in this order, because the first makes the other two cheaper to run:

| PR   | Holds                                                                                                                                                                | Version |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W1.1 | CI: Turbo's logs streamed, one warm veraPDF for the worker's run, the worker's files in parallel                                                                     | 0.73.1  |
| W1.2 | Tests for fourteen built requirements whose design already claims them, and CNT-124's second sentence (API-003 moved to W2; CNT-061 and CNT-062 wait on a rewording) | 0.73.2  |
| W1.3 | Design claims, then tests, for PUB-069, PUB-031, CNT-160 and CNT-166                                                                                                 | 0.73.3  |

Each is a Build bump: none changes what the product does.

**Not in W1:** STY-019. Its statement asks for a failure the stored shape makes unreachable, and the
audit's K7 asks Ken to reword it to the invariant; its test (a version missing `width` or `height`
refused, in `version.test.ts`) lands with that corpus PR, not before it.

## How a test-debt test is watched fail

The code exists, so red comes from breaking it (the remainder plan's rule): each task names the
**break** - the smallest edit to production code that the new test must catch. Make the break, run
the test, see it fail for the stated reason, undo the break, see it pass. A test that stays green
under its break is testing nothing and is rewritten, not committed. Record each break and its
failure message in the task's commit body, one line each, so the review can re-run any of them.

**A citation cites only what its test shows** (`pnpm trace show <ID>` beside the title): each task
below says which clause a test must assert before its title may carry the identifier.

## Measured before planning

**CI today** (run 36222743642, PR #237's merge): the Test step took **9 min 14 s**, and the worker's
suite **550 s** of it, serial (`fileParallelism: false`). The worker's tests call `checkPdfUa1` **31
times**, each a fresh `docker run` of the pinned veraPDF, about 11 s on CI: roughly 340 s of the 550.

**A warm veraPDF, in the image already pinned.** veraPDF 1.30.2's CLI has an undocumented
`--servermode`: one JVM reads a PDF path per line on stdin, writes each report to a file under
`java.io.tmpdir`, and prints that file's path on stdout. At start it prints one path for the empty
run of its `FILES` argument - a ready signal. Measured on this machine against the pinned digest, a
compliant 8 KB PDF:

| Checks in one process | Wall clock |
| --------------------: | ---------: |
|                     1 |  16,200 ms |
|                     6 |  16,350 ms |

So after start a check costs tens of milliseconds, and the JSON report is the one `verdictOf`
already reads (`--format json` holds in server mode). No new image, no new download.

**Roles.** Only five of the worker's 25 test files open a database (`ingest`, `publish`, `sample`,
`sweep`, `themes`); every one calls `bootstrapCluster`, which touches cluster-wide login roles and
then prepares its own database. `retryOnRoleConflict` already absorbs a collision, but "set up once"
removes the collision rather than retrying through it.

**Turbo.** `turbo.json` sets `"ui": "stream"`, but Turbo's `--log-order` defaults to `grouped` when it
detects CI, holding a task's output until the task ends. That is why the worker's 550 s looks like a
hang.

## Decisions for Ken

| #    | Decision                                                                                                                                                                                                              | Recommendation                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1-A | **How veraPDF is kept warm.** The pinned CLI's hidden `--servermode`, or the separate `verapdf/rest` image (a documented HTTP API, a second pinned download, and a second veraPDF build to keep level with the first) | **`--servermode`**, pinned by a test that starts it and checks one compliant and one non-compliant PDF, so an image bump that drops the flag fails that test by name |
| W1-B | **Where a publication's own check goes.** PUB-085 and PUB-091 (K5) need a warm checker in the worker itself, not only in its tests. The server-mode client written here could serve both                              | **Tests only, now.** Write the client so the worker could hold one later, but decide K5 first: it changes what the worker must do on each publication                |

## Global constraints

- Test titles cite only what they show; each task says what that is.
- No user-facing string changes in W1; if one does, no em or en dash.
- `pnpm typecheck`, `pnpm lint`, `pnpm format` locally after the last commit of each PR: CI's steps
  are `continue-on-error` and read "success" when failing.
- `pnpm --filter @alloy-works/trace generate` after prettier, then `pnpm trace pins` for every count
  the trace tests pin; never hand-count.
- Every PR: `version.json`, the root `package.json` and `apps/desktop/package.json` bumped together,
  one `CHANGELOG.md` entry at the top, the tracking row in the remainder plan updated.

---

## W1.1: CI's test time

### Task 1: Turbo's logs streamed in CI

**Files:** `.github/workflows/ci.yml`; `docs/ci-and-releases.md` (one sentence where the steps are
described).

- Set `TURBO_LOG_ORDER: stream` in the `env` of both jobs, so every `turbo run` in CI (build,
  typecheck, test, the end-to-end suite) prints each line as it comes, prefixed with its task.
- Pure configuration: no failing test is possible. Its evidence is the PR's own CI log, in which the
  worker's per-file lines arrive while other suites are still running. Say so in the PR body.

### Task 2: A warm veraPDF for the worker's run

**Files:**

- Create `apps/worker/src/testing/verapdf-server.ts`: the server-mode process and a local HTTP front.
- Create `apps/worker/src/testing/verapdf-setup.ts`: the vitest `globalSetup`.
- Modify `apps/worker/src/testing/verapdf.ts`: `checkPdfUa1` posts to the warm checker.
- Modify `apps/worker/vitest.config.ts`: `globalSetup`.
- Test: `apps/worker/src/testing/verapdf.test.ts`.

**Interfaces** (`verapdf-server.ts`):

```ts
/** One veraPDF JVM in server mode, started on the first check and kept for the run. */
export interface WarmVeraPdf {
  /** The report veraPDF wrote for this PDF, as JSON text, with the exit `verdictOf` expects. */
  check(pdf: Uint8Array): Promise<{ stdout: string; exit: 0 | 1 }>;
  close(): Promise<void>;
}
export function startWarmVeraPdf(): WarmVeraPdf;

/** An HTTP front on 127.0.0.1, an ephemeral port: POST /check with the PDF's bytes answers the report. */
export function serveWarmVeraPdf(
  checker: WarmVeraPdf,
): Promise<{ url: string; close(): Promise<void> }>;
```

- **The process:** `docker run -i --rm --network none --name aw-verapdf-<pid>-<random> -e
JAVA_OPTS=-Djava.io.tmpdir=/checked/reports -v <dir>:/checked <VERAPDF_IMAGE> --servermode
--flavour ua1 --format json`. `<dir>` is `mkdtemp` chmod `0o777` (the image runs as uid 100 and
  must write `reports/` there; a bind mount keeps the host's permissions on Linux - the same trap
  `checkPdfUa1`'s comment records). Started on the first `check`, not at setup, so a run filtered to
  files that never check pays nothing.
- **Ready:** the first stdout line is the empty run's report path; discard it and delete the file.
- **A check:** write `<n>.pdf` (`0o644`), write `/checked/<n>.pdf\n` to stdin, read the next stdout
  line (a path under `/checked/reports/`), read that file from the host side of the mount, delete
  both. **One at a time**, chained on a promise: the protocol answers in order and has no ids.
- **The exit:** server mode has none per file. `compliant` from the report is the verdict; answer
  `exit: 1` when the report's first validation result is not compliant, `0` otherwise, so
  `verdictOf(stdout, exit)` is unchanged. A report with no validation result still throws there.
- **Failure:** the process exiting, or a line not arriving in 120 s, rejects the pending check and
  every later one with the process's stderr tail; the HTTP front answers 500 with that message, and
  `checkPdfUa1` throws it. A check never falls back to a cold run in silence.
- **Teardown:** end stdin, wait 10 s for exit, then `docker rm -f` by name; remove `<dir>`.
- **globalSetup** starts the front and `provide('verapdf', url)`; `checkPdfUa1` reads it with
  `inject('verapdf')` and POSTs. Its signature and `VeraPdfVerdict` do not change, so none of the 31
  call sites changes.

**Tests** (in `verapdf.test.ts`, beside the existing `verdictOf` cases):

- `the pinned veraPDF answers in server mode: a PDF/UA-1 PDF passes and one without tags fails` -
  both through one `startWarmVeraPdf()`; asserts `compliant` true then false and the second names a
  failed rule. This is W1-A's pin. **Red:** before `verapdf-server.ts` exists it fails to import;
  then break it by dropping `--servermode` from the arguments and watch it time out naming the
  missing line.
- `two checks sent together are answered each with its own report` - `Promise.all` of the passing
  and failing PDF; each verdict matches its own PDF. **Break:** remove the promise chain.
- `a veraPDF that exits rejects the check in progress and the next one, naming its stderr` - start
  it with a bad image digest; both checks reject.

Cite nothing: these test the harness, not a requirement.

**Measure:** the worker suite's wall clock before and after, locally, and record both in the PR body
beside CI's figures.

### Task 3: The worker's login roles once, and its files in parallel

**Files:**

- Modify `packages/db/src/bootstrap.ts`: split into `bootstrapLoginRoles(adminUrl, passwords)` (the
  three login roles and `aw_tenant` - cluster-wide) and `prepareDatabase(adminUrl)` (the `platform`
  and `extensions` schemas, the extension, the `aw_tenant` grants to this database's tenants,
  `revoke create on schema public`). `bootstrapCluster` stays, calling both, so `dev:setup`, the
  deployment and every other suite are unchanged.
- Modify `packages/db/src/index.ts` (or `testing/index.ts`, wherever `bootstrapCluster` is exported
  from): export both.
- Modify `apps/worker/src/testing/verapdf-setup.ts` - or a sibling `database-setup.ts` in the same
  `globalSetup` array - to call `bootstrapLoginRoles(serverAdminUrl, TEST_PASSWORDS)` once.
- Modify the five worker files' `beforeAll`: `bootstrapCluster` becomes `prepareDatabase`.
- Modify `apps/worker/vitest.config.ts`: remove `fileParallelism: false` and its comment; leave
  `maxWorkers` at vitest's default and write down what it resolves to on a 4-vCPU runner.
- Test: `packages/db/src/bootstrap.test.ts` (create it if absent; else extend).

**Tests:**

- `prepareDatabase makes a database ready for migration without touching a login role` - with the
  roles already present, record `pg_authid`'s `xmin` for `aw_service`, `aw_worker`, `aw_migrator`,
  run `prepareDatabase` on a fresh database, migrate it, and assert the three `xmin` values are
  unchanged. **Red:** fails to import first; **break:** move one `alter role` into `prepareDatabase`.
- `bootstrapCluster still does both` - the existing bootstrap tests stay green unchanged.

**Then:** run the worker suite three times in a row locally; any failure that appears only in
parallel (a shared temporary path, a port, a fixed object key, a 30 s timeout under load) is fixed
in its own file, with the finding in the commit body. If Typst under contention breaks the 30 s
test timeout, cap `maxWorkers` rather than raising timeouts, and say which in the PR.

**Docs:** `docs/testing.md` (the veraPDF paragraph near line 225: a warm process for the run, not one
per check; the worker's files in parallel), `docs/architecture.md` if it describes the worker's
test harness or `bootstrapCluster`, and `publishing.md`'s "Where the code lives" note that veraPDF
runs only in tests (still true).

**The PR body** gives CI's Test step and the worker suite before (9 min 14 s; 550 s) and after, from
the PR's own run.

---

## W1.2: Built, claimed, uncited

Each task: write the test, make the break, watch it fail, undo, watch it pass, commit. The suites
are named so each task runs only its own.

### Task 4: The content model's own statements

`packages/domain/src/content/model/` and `packages/editor/src/`.

| ID      | Test, and what it must assert                                                                                                                                                                                                                                                                                                                                                                                                  | Break                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| CNT-014 | `packages/editor/src/schema.test.ts`: `CNT-014 a paragraph is supported and is the default block` - a stored paragraph round-trips through the mapping; the schema's first block type (ProseMirror's default) is `paragraph`; Enter at the end of a quotation's last empty paragraph and Mod-Enter out of preformatted text each land in a paragraph                                                                           | reorder the schema so another block comes first |
| CNT-019 | `packages/domain/src/content/model/document.test.ts`: `CNT-019 a quotation parses with no attribution, and with one holding text and a citation` - both parse and round-trip byte for byte                                                                                                                                                                                                                                     | make `attribution` required                     |
| CNT-026 | `packages/domain/src/content/model/inline.test.ts`: `CNT-026 a footnote anchor is an inline node, never a block` - a footnote in a span, a cell, a cell position and a table note parses where inline content does; a footnote standing in a document's block sequence is refused                                                                                                                                              | add the footnote to the block union             |
| CNT-124 | `packages/db/src/creation.test.ts:81`: add `CNT-124` to the title of `writes version 0.1 holding exactly one empty paragraph, with a fresh identifier`. The existing `document.test.ts:74` keeps its citation for the first sentence; together they show the statement                                                                                                                                                         | create with an empty block list; the test fails |
| CNT-164 | `apps/web/src/editor/EditorToolbar.test.tsx`: `CNT-164 each of the seven marks is applied and removed by its button and by its shortcut` - a table over emphasis, strong, underline, subscript, superscript, inline code, quoted phrase, each toggled on then off both ways; and `CNT-164 the toolbar offers no typeface, size or colour` - no control or registered command whose name or label mentions font, size or colour | drop one mark's shortcut from the keymap        |
| CNT-169 | `apps/web/src/editor/ComponentEditor.test.tsx`: `CNT-169 undo after Save version changes nothing` - type, Save version, type again, undo twice: the text is the saved version's, not the opened one's; and undo in a fresh session does nothing                                                                                                                                                                                | keep the history across Save version            |

Mind the web harness's answered-save table (eight saves; memory: a typing test goes read-only
mid-word on CI's slower runner) and that the surface mounts before the header commits: wait for the
header before typing.

### Task 5: Structure and numbering

| ID      | Test                                                                                                                                                                                                                                                                                                                                         | Break                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CNT-081 | `packages/domain/src/publishing/assemble.test.ts`, beside STR-031's: `CNT-081 a figure, a table and a block equation keep their identity when blocks move, so a reference follows its target's new number` - reference each by id, insert a block before them and reorder two, assemble again; each reference prints its target's new number | resolve a reference by position instead of by identifier   |
| STR-024 | `assemble.test.ts` beside STR-013's (`:832`): `STR-024 a caption's label comes from the layout and its text from the component` - a layout whose figure rule's `label` is `Fig.` publishes `Fig. 1.1` with the caption text unchanged; the same for a table rule                                                                             | hard-code the default scheme's word                        |
| STR-068 | `packages/domain/src/structure/references.test.ts`: `STR-068 a cross-reference targets an outline node, a caption-bearing block and a footnote, by identity` - one test, all three target kinds offered and resolved by id, and a target named by anything but its id refused                                                                | drop the footnote arm from the offered targets             |
| TAB-050 | `apps/worker/src/tables.test.ts`: `TAB-050 a table is tagged in reading order, row by row, and stays one table across pages` - a table long enough to break: the structure tree holds one `Table`, its `TR`s in document order, each row's cells left to right, and header rows `TH`. Uses the existing `readPdf` structure reader           | the template emitting the continued part as a second table |

### Task 6: Versions, tenancy, the API

| ID      | Test                                                                                                                                                                                                                                                                                                                                                                                     | Break                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| VER-009 | `apps/service/src/editing-routes.test.ts`: `VER-009 a component's versions are numbered 1, 2, 3 in its revision, presented as 0.1, 0.2, 0.3` - three saves; the version list and each version read show the number and the pair. Only the first revision exists in T1; say so in a comment, not the title                                                                                | number from the chain length plus two                         |
| IAM-053 | `apps/service/src/app.test.ts`: `IAM-053 a customer's own domain is reachable once added, with no restart` - the running app answers `GET /v1/tenant` for `docs.customer.example` with 404 (or its unknown-host answer), `addHostnames(db.adminUrl, tenant.id, ['docs.customer.example'])`, the same app answers `Production`; and a two-level name (`sandbox.acme.alloy.test`) resolves | cache the hostname map at start                               |
| IAM-078 | `packages/db/src/provision.test.ts`: `IAM-078 an organisation groups several tenants and holds no content` - two tenants under one organisation, each with its own schema and hostnames; the platform `organisation` table's columns are only its identity and name (read from `information_schema`), and no tenant table references it                                                  | add a content column to `organisation` in a scratch migration |
| API-003 | `apps/service/src/app.test.ts`: `API-003 the service registers exactly the routes the contract declares` - collect `onRoute`, compare with `allRoutes` both ways. `apps/service/src/http.test.ts`: `API-003 a status the contract does not declare fails rather than being sent unvalidated`                                                                                             | register one extra route; answer an undeclared 418            |
| API-005 | `http.test.ts`: `API-005 every failure is a structured error with a stable code, a message and a trace id` - table-driven over validation, a refusal, an unexpected throw, a response breaking its schema, an unknown route, an unparseable body; and extend `packages/api-contract/src/openapi.test.ts:21` to assert every operation declares the error body                            | drop `code` from one path's body                              |

API-003's second half may show that an undeclared status **is** sent unvalidated today (the audit
says Fastify has no schema for it). Then it is a defect, not debt: stop, file the issue with the
symptom, and move the fix to W2 rather than fixing it inside a test-debt PR.

### Task 7: Paste keeps structure

CNT-064 asks each paste test to assert what was dropped as well as what survived, so both halves
are asserted: the admitted content and the paste report.

| ID      | Test                                                                                                                                                                                                                                                                                                                                                                                             | Break                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| CNT-061 | `packages/readers/src/markdown.test.ts`, through admission: `CNT-061 Markdown keeps every structure a component can hold` - one document with nested and started lists, a table with a header row, a quotation, fenced code with a language, strong, emphasis, code and a link; the admitted content holds each, and the report names the heading rewritten to a paragraph and the image dropped | drop the fenced code's language in the reader |
| CNT-062 | `packages/readers/src/html.test.ts`, under "HTML through the admission pipeline": `CNT-062 HTML keeps every structure a component can hold` - nested lists, a definition list, a quotation, `pre` with a language, a table with a caption, header cells and merged cells, marks and a link; admitted content and report both asserted                                                            | drop `colspan` in the reader                  |

A heading is an outline section, not a component's block, so "structure" here means every structure
a component can hold (the audit's reading, CNT-060's split); say so in a comment above each.

### Task 8: The mark in the output

| ID      | Test                                                                                                                                                                                                                                                                                                                                | Break                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| CNT-085 | `apps/worker/src/marks.test.ts`: `CNT-085 an underlined run is drawn with a rule beneath it, and no other run is` - the page's drawn lines, read from its content stream, lie under the underlined run's glyphs only; and `packages/domain/src/word/write.test.ts`: the run carries `<w:u w:val="single"/>` and its neighbours none | drop the underline arm from the template's mark switch |

CNT-085 is "an underline mark must be supported": the model, the editor and both outputs. Its title
goes on the worker test; the Word assertion joins the same `describe` so one citation shows the
output half whole.

---

## W1.3: Claimed, then cited

Four requirements have no design claim, so no test may cite them yet. Each task adds the claim
first, in the design named, **claiming only what the test beside it shows** - both outputs where the
statement says "every output" and Word now exists.

### Task 9: PUB-069, hyphenation by the passage's language

- **Claim** in `docs/design/publishing.md`: the language of every run reaches Typst's `lang` and
  Word's `w:lang`; each engine hyphenates and breaks lines by its own patterns for that language.
- **First, one question:** which of the product's languages the pinned Typst 0.15.1 has hyphenation
  patterns for. Answer it by compiling one long word under each tag the language list admits;
  record the table in publishing.md. The test uses two it has (`en-GB` and `de-DE`, if so).
- **Test** `apps/worker/src/themes.test.ts`: `PUB-069 a passage hyphenates by its own language, not
the document's` - a hyphenating style in a narrow measure; the same long word in an `en-GB` run and
  a `de-DE` run of an `en-GB` document; the break points read back differ as each language's
  patterns say. **Break:** set every run's `lang` to the document's.
- **Word half** in `packages/domain/src/word/write.test.ts`: the `de-DE` run carries
  `<w:lang w:val="de-DE"/>`, the `en-GB` run none (it is the document's), and settings hold
  `<w:autoHyphenation/>` when a style hyphenates. Word's own hyphenation is Word's; the claim says so.

### Task 10: PUB-031, reading order is the document's order

- **Claim** in `publishing.md`: tags follow the assembled document's order, whatever the layout
  moves; a float is tagged at its logical place. Word: a floated figure's text box is anchored in the
  paragraph at its logical place.
- **Test** `apps/worker/src/table-and-image-styles.test.ts`: `PUB-031 a floated figure is read where
the document puts it, not where it is drawn` - a head-floated figure between two paragraphs: in the
  structure tree's order its `Figure` falls after the first paragraph and before the second, though
  drawn above both; the same for a foot float. `readPdf` may need a structure-order-with-text
  reader; add it to `testing/pdf.ts` with its own test. **Break:** emit the float's tag at the page
  head.
- **Word half** in `write.test.ts`: the text box's anchor run sits in the document's body between
  the same two paragraphs.

### Task 11: CNT-160, repointing a reference is a document version

- **Claim** in `docs/design/structure.md`: an outline `set` changing a reference's `mode` records a
  new document version with its author and time; the version before holds the old mode.
- **Test** `apps/service/src/document-routes.test.ts`: `CNT-160 changing which version a document
references records a new document version, naming who and when` - a reference `latest`, then
  pinned to 0.1, then pinned to 0.2, each a `set` by Ada; the document's versions read back each
  mode in turn, each version naming Ada and a time after the last. **Break:** apply a `set` of `mode`
  in place without a new version.

### Task 12: CNT-166, the whole of Unicode

- **Claim** in `docs/design/content-model.md`, moving CNT-166 out of "Left unclaimed" with the
  table's prose adjusted: stored as JSON strings, shown by the editor, and a character the faces
  cannot set refused by `assemble`'s glyph check, which serves the PDF and Word alike.
- **Tests**, one `describe('CNT-166 ...')` in `apps/service/src/editing-routes.test.ts`: an astral
  character (U+1D400, mathematical bold A) and an emoji (U+1F600) saved through the iteration route
  and read back byte for byte; `packages/editor/src/mapping.test.ts`: both reach the view's text
  unchanged; `packages/domain/src/publishing/assemble.test.ts`: a character no face has fails the
  publish as `glyph_missing` naming it, for a PDF request and a Word-only one. **Break:** the
  mapping splitting surrogate pairs (`.split('')`).

---

## What the build changed

**W1.1 (PR #239, merged).** CI's Test step went from 9 min 14 s to 2 min 57 s. The warm veraPDF
reads each report back with `docker exec`, since the image writes them as its own user; a check
whose answer names another file, or none in time, ends the process for good; and `close()` removes
the container by name and waits until it is gone. The first review found a timer holding every run
open ten seconds and the role test flaking against the other suites' bootstraps; both were fixed test
first.

**W1.2 (PR #241).**

- **API-003 moved to W2.** The probe the plan asked for showed an undeclared status sent unchecked,
  undeclared fields included (issue #240). A citation now would claim a contract test that does not
  exist, so API-003, its routes-both-ways test and the fix land together in W2.
- **A title `it.each` builds cites nothing.** The trace's static scan reads literal titles, so
  CNT-164's and API-005's table-driven tests were rewritten as one literal test each, looping over
  their cases, every assertion naming its case.
- **CNT-014** is shown by the schema's content match - the block ProseMirror makes wherever it must
  make one is its `defaultType`, which is the paragraph for a document, a quotation and a list item -
  beside a round trip, rather than by driving each exit key, which the editor's own tests already do.
- **CNT-085's Word half** was already demonstrated (the run's `mark-underline` style, and the style's
  `w:u single`); the style test now carries the citation beside the PDF's.
- **TAB-050** needed a reading-order reader: `readPdf` gains `reading`, every structure element in the
  tree's order with its text, which PUB-031 (W1.3) reads too.
- **CNT-061 and CNT-062 are not cited.** Their tests show every structure a component can hold
  surviving a paste, and the report naming what did not - but a heading is kept as a paragraph, and
  "paste from Markdown (HTML) must preserve structure" makes no such exception. CNT-167 was reworded
  to say so for Word; the same rewording for these two is Ken's, beside K7. The tests stay, uncited,
  and the HTML one gained a header column and a cell spanning two rows after the review found a
  rowspan break it did not catch. By the same reasoning content-model.md no longer claims them either (design
  claims 434 to 432): the gap is named in prose beside its table until they are reworded.
- **The final review broke four citations the implementer's breaks had not**, each fixed test first:
  CNT-169 passed with undo removed altogether (it now shows undo working up to each version and
  stopping there); CNT-164's typeface test read buttons only (it now reads every control, every
  command and every mark the schema holds); CNT-081 could not tell a reference by identity from one
  taking the last block of its kind (blocks after the targets as well as before); and STR-024 varied
  the word but not the number (the counter's form and separator too).
- Citations 335 to 352, counted once per requirement per file.

**W1.3 (PR #243).**

- **Each claim was measured before it was written.** PUB-069's: Typst 0.15.1 compiled one long
  compound under 47 language tags. Latin-script text hyphenates by the passage's own patterns, which
  differ (English breaks _...fahrtsge|sellschaft_, German _...gesell|schafts_), and a language the
  engine has none for is not hyphenated at all - never as the document's. publishing.md records which
  languages have patterns. PUB-031's: the structure tree reads a head float between the paragraphs
  either side of it and a foot float before the one after it, however they are drawn.
- **Both publishing claims hold for Word too**: each passage's `w:lang` under automatic hyphenation,
  and a floated figure's box anchored between the same blocks.
- **CNT-160 is read from the chain**: no route reads an older document version, so the test reads the
  version chain the store keeps - four versions, each author and each reference in turn.
- **CNT-166 is not claimed.** Its three tests (the store, the editor, the publish) show the astral
  planes stored, shown and saved, and refused by name where no face has them. But the final review
  found two things short of "the full Unicode range": U+0000 is refused, since Postgres cannot store
  it, and text is kept in NFC (CNT-056), so 1,120 code points - 555 of them in the supplementary
  planes, 542 of those CJK compatibility ideographs - are stored as their canonical equivalents. The tests stay,
  uncited; rewording CNT-166 is Ken's, beside K7. The editor's test is a jsdom proxy for "shown": it
  reads the surface's text, not what is drawn.
- **The final review broke CNT-160 twice** where the first test could not see it: a re-pin from one
  version to another dropped (the component had one version) and every version stamped with one
  old time. The test now re-points 0.1 to 0.2, bounds each time, and reads each version with the
  store's own `readVersion`. W9 no longer lists CNT-160. **PUB-069's** PDF test gained a component
  written in German, which a break ignoring a component's own language passed; its claim now says
  what line breaking beyond hyphenation was measured to do - corrected after the re-review found six
  languages repeating a hyphen at a line's start, which a second PDF test now shows for Polish and
  Spanish against English. **PUB-031's** claim and test name the
  footnote, the other thing drawn out of the document's order.
- Design claims 432 to 435; citations 352 to 357.

## Done when

- `pnpm trace tranche T1`: the eighteen named here Covered (fourteen in W1.2, four in W1.3; API-003 went to W2, CNT-061 and
  CNT-062 wait on their rewording),
  CNT-124 cited for both sentences, STY-019 still waiting on K7.
- CI's Test step on W1.1's own run, beside 9 min 14 s.
- The remainder plan's tracking row reads W1 built, with the three PR numbers; this plan's status
  reads Built, with what the build changed.
