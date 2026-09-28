# W14: Publishing, finished

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W14 of
> [the rest of T1](2026-09-25-t1-remainder.md), under Ken's decisions of 2026-09-28:
> [ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md),
> [ADR-0030](../decisions/0030-the-conformance-report-joins-a-publication-after-it-is-recorded.md),
> [ADR-0031](../decisions/0031-t1-publishes-headings-to-six-levels.md) and STY-079. Its decisions, W-A to
> W-L below, were taken as recommended on his instruction of 2026-09-28 to work through W14, and are his
> to review. W-M was the lead's, from W14.7's final review.

**Goal:** every PDF publication is checked and says so; a heading too deep for PDF/UA-1 is refused by
name; the regression corpus holds the engine's cases and every defect's; a figure or table may be
unnumbered, and a style says where its caption sits; Word names everything it cannot carry; and the
last of the editor's T1 features, a spelling checker in the desktop app and a symbol palette, exist.

| PR    | Holds                                                                                                                                 | Version |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W14.0 | This plan                                                                                                                             | Build   |
| W14.1 | veraPDF on every publication: the checker in the worker image, a `check_pdf` job the record enqueues, `publication_check`, the page   | Minor   |
| W14.2 | Six heading levels, refused by name for PDF; the 300-page budget measured                                                             | Minor   |
| W14.3 | The regression corpus: the engine spike's cases and every publishing defect's, the keep rules among them; the resolution order's test | Minor   |
| W14.4 | A figure or table explicitly unnumbered (issue #129): the stored member, the editor, numbering, the PDF and Word                      | Minor   |
| W14.5 | A style says where its caption sits (STY-079, STR-025): the catalogue, the default theme, template 14, Word and the editor            | Minor   |
| W14.6 | Word names what it cannot carry (PUB-100); IAM-075 and IAM-080 claimed and cited                                                      | Minor   |
| W14.7 | The desktop's spelling checker through the platform bridge (CNT-178), and the symbol palette (CNT-057)                                | Minor   |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                     | Instead of                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| W-A | **veraPDF is copied into the worker image from its pinned image** (`/opt/verapdf` and its JRE, by digest), and each worker keeps one in server mode, warm, as the test suite does                                                                                                                            | A sidecar service, a second container to run and reach; or a download at build time from a URL nothing pins |
| W-B | **The check is a job of its own, `check_pdf`, enqueued in the transaction that records the publication**, so a worker that dies after recording leaves the check queued, never lost                                                                                                                          | A step after recording in the same job, which a crash between the two would skip for ever                   |
| W-C | **The report is a row of its own, `publication_check`**, insert-only, one per PDF output: the checker and its version, the profile, compliant or not, and the failed rules. A publication's page says checked and passed, checked and failed, or not yet checked                                             | Updating `publication_output`, which the runtime role may never update                                      |
| W-D | **The 300-page budget is measured in the worker's suite on a declared reference document and recorded beside the result**, binding locally and record-only on CI's runner, as STR-063's navigation budget is                                                                                                 | A budget binding on CI, whose shared runners are not the declared reference configuration                   |
| W-E | **A heading deeper than six levels is refused for PDF alone**, `heading_too_deep`, naming the section; Word publishes it                                                                                                                                                                                     | Refusing every format, which Word does not need                                                             |
| W-F | **The regression corpus is one suite**, `regression.test.ts`: a case for each of the engine spike's nine, ported from `spikes/publishing-engine`, and a case for each publishing defect filed, named by its issue; the keep rules' cases join it                                                             | Leaving the spike's cases in Python, which CI never runs                                                    |
| W-G | **The resolution order's test swaps adjacent stages where the code lets a test swap them**, and where the types forbid a swap, the test says so and shows the compile-time refusal instead                                                                                                                   | Claiming the order is tested where only the types keep it                                                   |
| W-H | **A figure or table carries `numbered`, true by default and stored only when false**, as an equation's does; an unnumbered one takes no number and is left out of the lists of figures and tables                                                                                                            | A separate block type for an unnumbered figure, which every place that handles a figure would have to learn |
| W-I | **Caption placement is `caption: 'above' \| 'below'` on a table style and an image style**, in catalogue schema 3; the default theme keeps today's (a table's above, a figure's below), so nothing already published changes                                                                                 | A document-level setting, which STR-025 rules out: placement is the style's                                 |
| W-J | **Word's report names every structure Word does not carry**, one kind each: a description's language, a quotation, preformatted text and a quoted phrase as structure, a numbered equation set as a table, and a character the maths face lacks                                                              | Claiming PUB-100 on the five kinds reported today                                                           |
| W-K | **The desktop's spelling checker is set through one bridge call, `setSpellCheckLanguages(languages)`**, which the shell answers with a pure function in `shell.ts` mapping a component's languages to the dictionaries Electron has; suggestions come from the window's own context menu                     | Enabling every dictionary at once, which marks correct words in the wrong language                          |
| W-L | **The symbol palette is a dialog of three groups** - mathematical, Greek, and scientific and technical - a keyboard-navigable grid that inserts a character at the cursor and gives the focus back                                                                                                           | A character map of all of Unicode, which is the operating system's                                          |
| W-M | **The palette dims what the typeface at the cursor lacks, pointing to an equation**: the family set there - the paragraph's style, or code's in preformatted text and inline code - is asked by the publish's glyph check, and a character it lacks stays in the grid, disabled, named as not in that family | Offering only covered characters, which hides the maths an author came for                                  |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; the full suite before each pull request, and its CI log read.
- A stored shape is checked against every write path it admits (W14.4, W14.5).
- Every trigger or function reading a table reads it by `tg_table_schema`.
- A publication already recorded publishes the same again: a new template version is added, never an
  old one changed.

## W14.1: veraPDF on every publication

1. `deploy/Dockerfile`'s worker stage copies veraPDF and its JRE from the pinned image; the image's
   entry-point check runs it.
2. A migration: `publication_check`, insert-only, deleted with its publication; the job kind
   `check_pdf`, enqueued in `recordPublication`'s transaction for each PDF output.
3. The worker keeps one warm veraPDF, as the test harness's server mode does, without Docker.
4. The publication's routes and page show the check.
5. Tests: PUB-091 (a publication's PDF checked and its report kept; a failing PDF's rules named); the
   check re-queued when a worker dies after recording.

**W14.1, as built.** Migration 0040 adds `publication_check`, keyed to the PDF output it checked (so it
names only a PDF the publication has, and goes with it) as well as to the publication, insert-only for
the runtime role by its found columns alone, `checked_at` the database's, `failed_rules` held to its
shape and to 200 entries, a compliant check holding none, and veraPDF's whole report - its JSON, as it
wrote it, which PUB-091 asks to be retained, not a summary of it - as `report_key`, `report_sha256` and
`report_bytes`, kept by the job in the tenant's store by its hash before the row names it, the key held
to its digest by a check and to the tenant's own prefix by a trigger reading `tg_table_schema`, as
0017's is for an output. `recordPublication` queues `check_pdf`,
subject the publication, inside its savepoint, for a publication with a PDF; `publicationToCheck`,
`recordPublicationCheck` (answering `recorded` or `already`) and `readPublication`'s `check` on each
output read and write it; `GET /v1/publications/{id}` offers the report as a link signed for
`DOWNLOAD_SECONDS` that saves it as `{id}-verapdf.json`, and the page as **Download the full report**.
The worker's `src/verapdf.ts` now holds the server-mode protocol,
`startServerMode`, over a `ServerModeHost` - how the process starts, how a PDF reaches it and a report
comes back, and what it leaves - with `verdictOf`, which reads veraPDF's version from its own report
and each failed rule with its words, and keeps the report's text whole; the suite's warm veraPDF (`testing/verapdf-server.ts`) is a Docker
host over it, and the worker's, `startLocalVeraPdf`, a child process whose reports are held to a
`java.io.tmpdir` of its own, started again after it dies. The seam the job sees is `Checker`, a
`check(pdf)` answering a verdict; `check.test.ts` gives the job the suite's (`suiteChecker`), and
`verapdf.test.ts` drives the local one against a stand-in veraPDF run by Node, since no Java runtime is
on a developer's machine or CI's. Two things were found by inspecting the pinned image rather than
assumed: it is Alpine, so its Java runtime is built against musl, and it is published for x86-64 alone.
The first build copied that runtime and musl's loader into the worker image, which made an arm64
worker's veraPDF an x86-64 one; review sent it back, since the worker image is built for both
architectures. So W-A is answered in part otherwise than it was written: **only `/opt/verapdf`, the
jars and the launcher, is copied from the pinned image**, taken as `VERAPDF_PLATFORM`, `linux/amd64`,
and they run on Debian's `openjdk-17-jre-headless`, installed in the worker stage with
`--no-install-recommends` for whichever architecture it is built for; veraPDF 1.30.2 asks for Java 11
or later, and its launcher finds `java` on the path. Built locally for x86-64, the image ran
`verapdf --version` and, as the `node` user, the worker's own `startLocalVeraPdf` passed a PDF/UA-1
PDF and failed an untagged one (5-1, 7.1-9, 7.1-10) - a cold check in about 0.7 seconds, a warm one in
about 30 milliseconds. Built for arm64 under emulation, the whole worker target built, its
`verapdf --version` among it, and the same runtime and jars passed and failed the same two PDFs; no
arm64 machine has run the worker natively. The image's `VERAPDF_IMAGE` build argument is the one place
its digest is written in `deploy/`, and `image.test.ts` holds it equal to the suite's, and holds the
worker stage to copying `/opt/verapdf` alone and installing Debian's runtime. **The worker image grew
by about 238 MB uncompressed** - Debian's runtime 220 MB of it, where the musl runtime was 51 MB - to
230 MB compressed from 135 MB before veraPDF. The suites that publish and then take the next job
(`publish.test.ts`, `themes.test.ts`) run each check they meet and pass over it (`testing/work.ts`),
since every publication now queues one ahead of the next job. **A check that gives up is queued
again**: after its last attempt, the worker's interval sweep, `sweepUncheckedPublications`, queues
another for each publication with a PDF, no check, recorded more than five minutes ago (ADR-0030's
bound, `CHECK_WITHIN_MS`) and no `check_pdf` waiting or running for it - asked of the queue as the
worker, `JobQueue.waiting`, since a tenant's own role may insert into `platform.job` and never read it,
and neither grant is widened. A check that gives up every time is queued again at every sweep, ten
minutes apart by default, which the log says; that is the cost of never leaving one unchecked for good.

**From the final review:** six findings, each answered in this slice. **veraPDF no longer inherits
the worker's environment**: `startLocalVeraPdf` started it with `...process.env`, the database URL
and the store's key among it; it now gets `PATH`, `JAVA_HOME`, the locale and `JAVA_OPTS` alone
(`veraPdfEnvironment`), which the stand-in veraPDF, now noting the names it was given, shows against
a parent holding `DATABASE_URL`, `SECRET_*`, `PG*`, `AWS_*` and `NODE_OPTIONS`. **A check that can
never succeed stops being queued**: the reverse of the paragraph above. `JobQueue.givenUp` counts
each subject's given-up jobs, and once a publication's checks have given up three times
(`CHECK_GIVE_UPS`) the sweep leaves it and records so in migration 0041's
`publication_check_given_up`, written as the tenant because the count is in a queue no tenant's role
may read; `GET /v1/publications/{id}` gives the PDF a `checkState`, `pending`, `passed`, `failed` or
`gave_up`, held by the contract to agree with `check`, and the page says **Could not be checked for
accessibility.** The same sweep checks the publications recorded before 0040, a hundred in each tenant
per sweep, now tested with 101 of them. **A check cannot outlive its lease**: veraPDF was given two
minutes to start and two to check under a two-minute lease; it now gets a third of `LEASE_MS` for
each (`veraPdfTimeouts`). **The JVM is given a heap limit**, `-XX:MaxRAMPercentage=50`, where
`JAVA_OPTS` names none, and `JAVA_OPTS` and `LEASE_MS` are documented in `deploy/`; a worker starting
removes the `aw-verapdf-<pid>-*` directories a gone worker left, its directories now named by its
process id. The reviewer's check that veraPDF's XMP parser refuses an external DTD, an external
general entity and a parameter entity, with no request made, is written into the architecture and
`deploy/README.md`, beside the note that Debian's runtime floats with its updates. **The e2e publish
now waits for the check** and asserts it passed, polling for up to two minutes; CI's whole-system job
runs it, and it has not been run locally. The stale design and architecture text - veraPDF inside the
publish job, the answered open questions, "nothing runs veraPDF over a publication yet" - is
corrected, and the version is 0.115.0, since W14.7 took 0.114.0 as #311.

## W14.2: Six levels, and the budget

1. `assemble` refuses a heading deeper than six for PDF, `heading_too_deep`, naming the section.
2. The regression corpus's nine-level case becomes a document refused for PDF and published to Word.
3. The budget: a declared 300-page reference document of prose, figures, tables, equations and
   footnotes, published a stated number of times, its p95 and slowest recorded beside the
   configuration.
4. Tests: PUB-103, PUB-102.

**W14.2, as built.** `assemble`'s `project` refuses every node nested deeper than `HEADINGS`' six,
`pdfOnly(failure('compose', 'heading_too_deep', node.id, null, null))`, a component's reference as well
as a section, since the template makes each node a heading at its depth, whatever its kind; each node
is named, not only the first, because moving the seventh up leaves its children too deep. Kept in the
published document, as every PDF-only refusal is, so a Word-only request publishes it at Word's
Heading 7 to Heading 9, which the writer already had. `heading_too_deep` is appended to
`publishFailureCodes` and worded on the page: "This heading is nested more than six levels deep,
which a PDF cannot tag as a heading. Move it up a level, or publish this document to Word alone."
Neither numbering nor the contents changed: a deeper node is numbered as before, and the contents
reach the layout's depth. A preview is a PDF and is refused the same way. The regression corpus's
nine-level case became two: six levels, through the template, which veraPDF passes with `H1` to `H6`
(PUB-103, alongside W14.1's check on every publication); and nine, refused for the PDF by name at the
seventh, eighth and ninth, and published to Word, where the Open XML SDK finds nothing wrong and each
heading is in the style named "heading N" at outline level N - 1. That case compiles the document
assembled for Word through the template once more and pins its last roles, `H6` then three `P`: the
reason for the refusal, kept as a tripwire for lifting it (ADR-0031). The Word writer's report test
asked for the PDF too over a fixture seven levels deep, and now leaves that section out.
**The budget** (PUB-102, W-D) is `apps/worker/src/publishing-budget.test.ts`: 30 chapters, each placing
a component of 100 blocks in a cycle of twenty - a figure, a table of a header row and four rows, a
numbered displayed equation, a paragraph with a footnote, and sixteen of prose - seeded through the
store, one image shared by the figures. Read back off the PDF: 311 pages, 150 each of `Figure`,
`Table`, `Formula` and `Note`, asserted, and the pages held to 270 to 330. It is published eleven
times from `requestPublication` to `processNext`'s recorded publication, with the publish job the only
handler, so no other job runs in the span; the first is reported and not held, and the p95 and the
maximum of the other ten bind where `CI` is not `true` and are recorded only on CI, as
`bindingBudget` does in the service. The configuration (platform and release, CPU and count,
parallelism, memory, Node, Typst, PostgreSQL's version, load) and the document's pages and parts are
written into the test's `meta`, carried into `.trace-results/worker.json`. There was no `check_pdf`
to keep out of the span, since W14.1 had not landed. Measured on the reference machine - an Intel
Core Ultra 7 270K Plus, 24 logical CPUs, 64 GB, Windows 11, Node 24.16.0, Typst 0.15.1, PostgreSQL
17.11 in Docker - at a p95 of 1.43 to 1.61 seconds alone over four runs, about 1.3 of each in the job
and 0.1 in the request, and 1.82 beside the rest of the worker suite. The test takes about twenty
seconds, so it runs in the ordinary suite rather than behind an opt-in.

**W14.2's final review.** The Word check's `deep` and `deep-captions` fixtures, nine levels deep, asked
for the PDF and Word and so were refused by `assemble`; each now asks for Word alone, which nothing it
asserts depended on. The warm-up publish is held to the maximum too, since PUB-102 allows no measured
sample above thirty; with ten samples the nearest-rank p95 is the slowest. The reference configuration
is declared in `docs/testing.md`, and publishing.md points at it and says, as STR-063 does, that a
green CI run does not show the budget met, and that the span leaves out the HTTP route and the queue.
The refusal's words offer Word alone only to a publish under a layout with a Word page:
`failureWords` takes whether Word is offered, `Publishing` passes its layout's, and a preview, always a
PDF, passes nothing. A request made before layouts is not refused `heading_too_deep`, as its other
refusals under a layout are gated, since template 1 is frozen and a request queued before W14.2 keeps
saying what it always said.

**After W14.1 merged.** Each publication now queues a `check_pdf` as it is recorded, which the budget
test's next `processNext` took ahead of its next publish; the test settles each outside the measured
span, checking the warm-up's and the last sample's with the run's veraPDF and passing over the rest.
It measures PUB-102's other bound, the report joining within five minutes of the record: 23.6 seconds
for veraPDF's first check and 6.2 warm, both passing PDF/UA-1. Under the worker's defaults a check
whose first attempt fails ends its second by 120 + 2 + 5 + 120 = 247 seconds, which `config.test.ts`
now holds; a third attempt may take 376, and a check that gives up all three waits for the sweep, so
publishing.md says the bound holds to the second attempt and names the rest. No timing of W14.1's was
changed. PUB-103 is cited on `check.test.ts`'s test of a publication recorded with its check queued
and checked against PDF/UA-1, and its row says how each clause is met, a failure found after the
record shown on the page, never refused.

## W14.3: The regression corpus, and the order

1. The spike's nine cases ported; a case for each publishing defect filed; the keep rules' cases moved
   in.
2. The resolution order's test (W-G).
3. docs/testing.md's account of the corpus brought up to date.
4. Tests: PUB-087, PUB-092, PUB-098.

**W14.3, as built.** `regression.test.ts` keeps its first four cases where they were, for W14.2's
change to the nine-level one, and gains four describe blocks, their documents built by
`apps/worker/src/testing/corpus.ts` (the spike's seeded prose on mulberry32, and the model's shapes).
**The spike's nine**, cited PUB-087, each judged as its checks judged it: case 3's caption check fails
on the very document, which is issue #235, so case 3 keeps its header and cell-note checks and #235's
case reads the same PDF; case 4 keeps no timing, which is PUB-102's, but compiles inside the worker's
thirty-second limit and moves no body page before its edit (the change is taken up within a page or
two, so later pages are not asserted to move); case 7 measured that a family the worker does not hold,
reaching Typst, is set in the serif's regular without a word, which is why the job asks
`typefacesNotHeld` first; case 8 runs at the spike's full size in seconds; case 9 on one machine only.
**The defects fixed**, cited PUB-087 and named by issue: #145, #253, and #158, whose refusal is fixed
and which stays open for a theme's markers (moved from `template.test.ts`); and Word's #7 in a
describe of its own citing nothing, since PUB-087 is the PDF's, held against `writeDocx`, the product's
Word writer, since the defect's `exportDocx` publishes nothing. **The defects still open** - #162,
#163, #164, #165, #232, #233, #234, #235 - each pinned as it stands and citing nothing; #163's label
measured as a `P` under template 13, not the `Span` the issue saw. Not in publishing output, so not
here: #88, #122 to #125, #146 (`sample.test.ts`), #148's other half, #156, #159. **The keep rules**,
moved from `themes.test.ts` with their helpers, each also reading the rule from the same style as
Word's (`projectStylesXml`), three of them citing STY-008, whose describe in `themes.test.ts` no longer
names keeping. **PUB-092's claim is dropped** (the final review, its option a): the cases show the
PDF's pagination and Word's keep properties, not Word's pages, and themes.md names that gap beside its
table, as word-output.md already said. **The order** is `packages/domain/src/publishing/order.test.ts`,
citing PUB-098 on each of its seven adjacent pairs: four swapped by composing the stage functions the
other way round, with what `assemble` publishes held to the order's answer; three `@ts-expect-error`
refusals (an unresolved occurrence handed to a condition, `number` given a `Resolved`, a refused
assembly's `document`); and the check for something to publish shown reading the generated matter,
which `assemble` makes after the walk that checks and projects each block. The corpus adds the PDF's
half of references before generation: a list of tables prints a caption's reference as its number.
publishing.md's PUB-098 row and "The order" say so. Each case was watched fail under a break of the
code beneath it, and each `@ts-expect-error` under a type widened to allow its swap.

## W14.4: Unnumbered figures and tables (issue #129)

1. The requirement row from issue #129, landed by this pull request, which closes it.
2. `numbered` on figure and table blocks, the editor's toggle in the Figure and Table panels, numbering,
   the lists, the PDF and Word.
3. Tests: TAB-034, and the new row.

## W14.5: Caption placement

1. Catalogue schema 3 with `caption` on table and image styles; the default theme's next version.
2. Template 14 and `publishing/14`; the Word writer; the editor's projection.
3. Tests: STY-079, STR-025.

## W14.6: Word's report whole, and two claims

1. The report kinds W-J names, written by the Word writer and worded on the publication's page.
2. IAM-075's claim, in service-foundations.md, with a test of each store's tenancy: the search
   projection, objects, secrets, publications and caches.
3. IAM-080 cited by the W9 test that shows it.
4. Tests: PUB-100, IAM-075, IAM-080.

**W14.6, as built.** Nine report kinds, `outputReportSchema`'s new members, written by `writeDocx`
and worded on the publication's page: `description_language_lost`, `quotation_not_structure`,
`preformatted_not_structure`, `definition_list_not_structure`, `quoted_phrase_not_structure` and
`inline_code_not_structure`, each by its place - the node and the block, a quoted phrase's or inline
code's the block of runs, a heading's none - and said once for each; `equation_numbered_as_table`,
by its place and label; and, once for a document setting an equation, `equation_alternative_lost` and
`maths_coverage_unchecked`, the Word family named. Three are more than W-J named, found by reading
every construct template 13 tags against the writer: a **definition list**, which the PDF tags as a
list and Word sets as paragraphs; **inline code**, which the PDF tags `Code`; and an **equation's
alternative**, which the PDF's `Formula` carries and OMML has no place for. **The maths face's
characters are reported once per document, not per character**: Cambria Math is not a face the
product ships and its coverage is not kept as data, so which characters Word draws from another face
cannot honestly be said here. The page says each kind named by a place alone once, counting its
places (`reportLines`), rather than a sentence per place. **PUB-100 is claimed** by word-output.md,
read clause by clause in its Accessibility section, and cited by `word/write.test.ts`'s three report
tests, the web page's and the worker's two tests over the whole document, which carry every clause
and name every kind. **IAM-075 is not claimed**: service-foundations.md's "Tenant scope of every
store" shows the search projection, objects, publications, the object store's credentials, sessions,
tokens and the caches scoped, but a sign-in client secret is read from the service's one secret store
by the name a tenant's row gives, and the OpenID Connect configurations are kept by issuer and client
with the secret they were discovered with, so two tenants naming one client share one secret. The
stores' new tests cite nothing but SCH-008, since citing an unclaimed requirement fails `trace
check`; each is ready to cite IAM-075 when the claim is made. **IAM-080** is cited by the W9 test
that offers Authoring only where the permissions give it.

**From the final review:** the claim said the report named every structure Word does not carry, and
two were missing. Template 13 tags the document's title, the contents' title and each list's title
as `H1`s, which Word sets as body text in their roles' styles (`w:outlineLvl` 9) so that its `TOC`
field does not list them: now `titles_not_headings`, once for every document, naming which of the
three stand in it, rather than headings, which would put them in Word's contents. And a list of
figures holding a floated figure is written without `\h`, where every entry of the PDF's is a link:
now `list_not_linked`, by its sequence, which only a figure's can be. `quoted_phrase_not_structure`
and `inline_code_not_structure` accepted a null block no writer produces, since a heading carries no
mark (`wordTitle`): both now take a block, as the other placed kinds do, and the writer's branch for
a heading is gone. An image's description in another language is now written on the run holding its
drawing, `w:lang`, as template 13 sets the image in `text(lang)`, and the Open XML SDK accepts it;
but whether a screen reader reads `descr` in it is not measured, so `description_language_lost`
stays, worded as written but unchecked. The tenant-scope tests of the search projection and the
publications read their tables unqualified, which the `search_path` would answer from `public` too,
and their refusal half is refused at the schema before any table is looked up, so pointing them at
a table that does not exist stayed green; each now lists, as the migrator, every schema holding each
table from the catalogue - exactly the two tenants' - and keeps the refusal as its own assertion.
Pointed at a table that does not exist, and at `platform.tenant`, each went red.

## W14.7: The spelling checker and the symbol palette

1. `setSpellCheckLanguages` on the platform bridge; the shell's pure mapping, pinned by a test; the
   browser's delivery a no-op, since it uses the browser's own checker.
2. The symbol palette: a toolbar button and a shortcut, the dialog, insertion at the cursor.
3. Tests: CNT-178 (CNT-148 until the final review superseded it), CNT-057.

**W14.7, as built.** `PlatformBridge` gained `setSpellCheckLanguages(languages)`. Every component
editor holds its base language in `spellingFor(bridge)` (`apps/web/src/platform/spelling.ts`) while it
is open and as it changes, and the bridge is told the list of every component open whenever it changes,
but never emptied, since setting no dictionary would switch the desktop's checker off for the page's
other fields, and never the list it was last told, which StrictMode's second opening would be. Only the
base language is asked for, not a marked run's: CNT-147 already stops a run in another language being
checked, so its dictionary would check nothing. The browser's bridge does nothing. The preload sends the
list on `alloy-works:spell-check-languages`, pinned in `shell.test.ts`, and is typed as the renderer's
own `PlatformBridge`, so the contract binds the shell. The main process decides with
`spellCheckerChoice` in `shell.ts`: a request that is not an array of at most eight tags in the stored
model's shape is refused whole and logged without its content; macOS is left to the system's checker,
where Electron's `setSpellCheckerLanguages` does nothing; each tag maps by `spellCheckerLanguages` to the
tag's own dictionary, its language's, that language's usual one (`en-US` for English, `xx-XX`
otherwise) or any of that language, else is dropped; and a request mapping to none leaves the
dictionaries as they were. The window's `context-menu` offers up to five suggestions and **Add to
dictionary**, structured by `spellingMenu` and carried out by `main.ts`. The palette is a registry row,
**Symbols** on `Mod-Shift-m`, prompting as **Equation** does: `canInsertSymbol` and `insertSymbol` in
`packages/editor/src/symbols.ts` type one code point at the selection in one transaction, anywhere text
is typed. `SymbolPalette` draws the three groups of `apps/web/src/editor/symbols.ts` - 66 mathematical,
53 Greek and 19 scientific and technical characters, each by its code point, NFC-stable, named by its
Unicode name in plain words taken from the Unicode Character Database - as grids of twelve to a row,
one tab stop each, and gives the focus back to the view it was opened over, the surface or a footnote's
text. The icon is an omega, as a letterform. Not run: the packaged app, so no dictionary Electron
downloads or marks with was watched, and nothing on macOS.

**From the final review:** 50 of the palette's 138 characters - most of the logic and set symbols,
the double-struck number sets, degrees Celsius and Fahrenheit and the Planck constants - are not in
the default theme's Liberation Serif or Mono, so inserting one failed the publish (STY-049). Under
W-M the palette asks `typefaceAt` (`apps/web/src/theme/check.ts`) of the family set where
`textWhereAt` (`packages/editor/src/resolution.ts`) says the cursor stands, by the same
`characterProblems` and `covers` the surface's marks use, and dims what it lacks: `aria-disabled`,
still reachable by the arrows, named "..., not in <family>; use an equation", with one line above
the grids saying so; with no presentation every character is offered, as before. The CNT-057 test
names the degree sign rather than degrees Celsius, and a data test holds the Greek group and that
test's characters to the default serif. `insertSymbol` now refuses what its doc said it refused -
the line and paragraph separators, a lone surrogate, a format character and private use - and its
range test counts one transaction and one undo. CNT-148 was superseded by CNT-178, because macOS
chooses its checker's languages itself and an application cannot set them; features.md already said
so, which is what CNT-178 asks. A word added to the desktop's dictionary is kept in the app's own
and cannot yet be removed, which the docs now say.
