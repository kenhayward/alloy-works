# Testing

## Test-driven development is required

**Write the failing test first, watch it fail, then write the minimal code to pass.** No production
code without a failing test that preceded it. This applies to new features, bug fixes and behaviour
changes alike. When fixing a bug, the first commit-worthy artefact is a test that reproduces it
(red); then the fix (green).

Watching it fail is not ceremony. A test that passes before the implementation exists is testing
nothing, and you only find that out by running it red first.

Exceptions - throwaway spikes, generated code, pure configuration - need a human's sign-off.

## The suites

| Workspace         | Runner | Environment | Covers                                                              |
| ----------------- | ------ | ----------- | ------------------------------------------------------------------- |
| `packages/domain` | Vitest | node        | The content model and its rules                                     |
| `apps/web`        | Vitest | jsdom       | The renderer, via Testing Library                                   |
| `apps/desktop`    | Vitest | node        | The shell's pure decisions - target resolution, the bridge contract |
| `tests/e2e`       | Vitest | node        | The whole system in containers, driven over HTTP                    |
| `tests/browser`   | Vitest | node        | The renderer in a pinned Chromium, against the whole system         |

`pnpm test` runs every suite but the last two, which need a running stack - apart from the browser
workspace's pin tests, which need none; `pnpm test:e2e` and `pnpm test:browser` run those. The reporter is **pinned explicitly** in every `vitest.config`: left
implicit, some runners print nothing a test logged on Windows while the identical run on Linux
prints all of it, which makes a local run look pristine while CI drowns.

## Keep test output pristine

**A passing run has no errors and no warnings.** This is wired as a hard gate rather than left to
discipline: `apps/web/src/test/consoleGate.ts` replaces `console.error` and `console.warn` for the
duration of every test and **throws** from inside them, so the failure names the source line that
produced the noise. An assertion in `afterEach` could only say that noise happened somewhere.

React's `act(...)` warning goes through `console.error`, so the gate catches it too.

A test that provokes an error or warning on purpose opts out explicitly:

```ts
import { allowConsoleNoise } from './test/consoleGate.js';

it('warns when the bridge is missing', () => {
  allowConsoleNoise();
  // ...
});
```

The gate re-arms for the next test. The opt-out is per test, never per file.

## What belongs where

- **Rules expressible over data** belong in `packages/domain` as pure functions, tested in the node
  suite. They are the cheapest tests to write and the most useful when they fail.
- **Anything the shell decides** - which URL to load, what the bridge reports - belongs in a pure
  module (`apps/desktop/src/shell.ts`) rather than inside `main.ts`, so it can be tested without
  booting Electron. `main.ts` stays a thin layer that calls Electron with what those functions
  return.
- **Cross-process contracts** get their channel names and payload shapes pinned by a test. A rename
  on one side without the other is a blank window, not a build error.

Prefer a hand-written fake over reaching for a mocking library, and keep pure logic in separate
modules from the framework calls so it can be unit tested without booting the app.

## Run the app when you change the shell

Some failures in the desktop delivery are invisible to every suite above, because they are about
whether the process starts and what it is allowed to do once it has. Two were found by running the
app and would have passed CI indefinitely:

- The dev server bound `::1` while the shell waited on `127.0.0.1`, so `wait-on` blocked forever and
  the window never opened - **no error, just a hang**.
- The preload was compiled rather than bundled, so its relative `require` threw inside the sandbox,
  the bridge was never injected, and the desktop window silently reported itself as `web`.

Both now have tests, and both tests only exist because someone ran `pnpm app` and looked. So:
**changing the shell, the preload, the dev scripts or the Vite server config means running
`pnpm app` and reading what the window says**, not just watching the suites go green.

A note on that second one: `resolveBridge` falls back to the browser implementation when
`window.alloyWorks` is absent, and it cannot distinguish "no shell injected one" from "the shell
tried and failed". That fallback is right for the web delivery and it is what made the bug quiet.
Graceful degradation hides failures - so where a fallback exists, something else has to be watching.

## Not wired up yet

**Nothing is measured in jsdom.** jsdom has no layout engine, so any question about _rendered_
output - geometry, measurement, what an editor actually draws - cannot be answered there; a test
asserting it would be testing jsdom's polyfill. It belongs in [the browser suite](#the-browser-suite).

**There is no coverage gate.** Adding one before the product exists would measure the scaffolding.

## The database suite

`packages/db` is tested against a real Postgres, never a fake: the thing under test is what Postgres
does with roles, grants and `SET LOCAL`. Start it before `pnpm test`:

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres
```

Each test file creates a database of its own (`aw_test_` and random hex) and drops it afterwards.
Roles are shared by the whole server, so test tenants use ids beginning `test`, which the harness
removes with the database; the files run one at a time because they share the login roles. CI runs
the same suite against a Postgres service container. Point `ALLOY_TEST_DATABASE_URL` at another
server to use one.

**The version chain's load test is not part of `pnpm test`.** `pnpm --filter @alloy-works/db test:load`
seeds a throwaway database with a tenant's worth of components and versions and measures cutting,
opening and reading them against thresholds; `ALLOY_LOAD_COMPONENTS` sets the volume, 20,000 by
default. It takes over the compose Postgres while it runs, so run nothing else against it. Its volumes,
thresholds and last recorded result are in
[the storage plan](plans/2026-09-15-storage-01-the-version-chain.md), decision 9 and task 5.

## The service suite and the contract

`apps/service` is tested in process with Fastify's `inject`, against a real Postgres through the
harness `@alloy-works/db/testing` exports - so it needs the database running, like the db suite.
`packages/api-contract` has no database: its tests check the OpenAPI document it builds, and one of
them fails when the committed `openapi.json` differs from what the contracts generate. Change a route,
run `pnpm --filter @alloy-works/api-contract generate`, and commit both.

Signing in is tested against the stand-in provider, started in process on a free port, so the tests
need no network and no real accounts. `cross-tenant.test.ts` presents a session from one environment
to every authenticated route of another, and fails for any new route that would accept it.

The stand-in plays Google too, `hd` claim and all, so `google-sign-in.test.ts` drives the whole Google
route - the sign-in address, the admission rules and the hand-off - with no Google account.

The suites run against PostgreSQL and the object store, never against the whole compose stack: they
start the service in process, and the worker's own functions directly. The stack itself is checked by
hand, and end to end in CI from plan 5.

The stream's tests are the exception to testing the service with `inject`: a stream is the one thing
`inject` cannot hold open, so they listen on a real socket. Their environments are named
`127.0.0.1` and `localhost`, because a hostname is what names an environment and those are the two
that resolve to the machine running the test. One of them builds a second service whose reads can be
held open, so that an event can be committed while a snapshot is being read - the ordering the
realtime spike paid for. `packages/api-client` regenerates its types in a test and compares them with
the committed ones, as `packages/api-contract` does for the document itself. `packages/trace` follows
the same pattern a third time: a test recompiles the requirements and design documents and fails when
the result differs from the committed `trace.json`.

## Naming the requirement a test verifies

A test that verifies a requirement says so, in one of two ways `packages/trace` scans for:

- **Its `describe` or `it` title names the identifier**, such as `it('IAM-004 refuses a second
tenant's session', ...)`. This is the load-bearing convention: it is how a passing test becomes
  that requirement's evidence, not just a mention of it.
- **A `rule:` field in an assertion names it**, such as `{ code: 'forbidden', rule: 'IAM-019' }` -
  the product citing the requirement it is enforcing, in its own refusal payload. Only where the code
  under test really does enforce it: a fixture that needs a rule identifier for sample data uses
  `ZZZ-001`, the reserved area the scan ignores, because a real one there reads as a citation.

An identifier anywhere else in a test file - a comment, an ordinary variable - is not a citation.
Mentioning a requirement is not claiming to verify it, and `packages/trace` only counts the two
forms above so that the honest count of cited requirements stays smaller than a grep of the test
tree would suggest.

`pnpm trace check` reports a citation naming a requirement no design claims, and a design claiming a
requirement that no longer exists, as problems in the corpus. `pnpm trace verify` goes one step
further than a citation: it reads the JSON reports every `vitest.config.ts` writes to
`.trace-results/` (`git`- and `prettier`-ignored, rebuilt by every `pnpm test`) and only counts a
requirement as **Verified** when a test whose title carries its identifier actually passed - a
`rule:` citation alone is Covered, not Verified, unless the test's own title also carries the
identifier, since verification matches on the test's full name, not its body.

`.trace-results/trace.json` - `packages/trace`'s own report - is read for coherence like every other
report (a failed or stale run there still refuses the whole computation) but is excluded from the
identifiers `parseResults` extracts. Its tests verify the tool, not the product, the same reasoning
`compile.ts` already applies by excluding `packages/trace` from the citation scan; without the same
exclusion here, a trace test titled with a product identifier would let the tool verify that
requirement from its own suite.

## The baseline gate

`pnpm trace gate` decides pass or fail over a hand-written baseline
(`docs/specification/baselines/<version>.md`) - the requirements a release declares itself
answerable for - rather than over the whole corpus. It reads the same `.trace-results/` reports
`verify` does, with the same exclusion of the tool's own `trace.json` from the evidence a requirement
can be verified by, so a baseline can never pass on the strength of a test that merely exercises
`packages/trace` itself. The gate fails closed on a stale or missing report the way `verify` does,
never on a guess. `pnpm trace pack` runs the identical decision before writing anything, and refuses
to write an evidence pack for a baseline that does not pass its own gate.

See [`docs/specification/baselines/README.md`](specification/baselines/README.md) for what a baseline
is and [`docs/trace/0.13.0/`](trace/0.13.0/README.md) for the evidence pack `pack` produces.

## The objects and worker suites

`packages/objects` and `apps/worker` need Postgres and the object store running
(`docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`), and the pinned Typst
fetched once with `pnpm --filter @alloy-works/worker fetch-typst`, and the checkers' images once with
`fetch-verapdf` and `fetch-ooxml-check` (below). Each test file takes a bucket of
its own and removes it afterwards, exactly as it takes a database of its own, so two files never see
each other's objects. The worker's suite renders with the real Typst rather than a stand-in for it:
the binary is the thing being pinned.

**The worker's files run side by side**, which the db, objects and service suites' do not. Login roles
are cluster-wide, so two files bootstrapping at once would write the same rows; the worker's global
setup (`apps/worker/src/testing/database-setup.ts`) sets them once for the run with
`bootstrapTestLoginRoles`, and each file prepares only its own database with `prepareDatabase`, which
creates and alters no role (the one cluster-wide row it can write, an existing tenant's membership of
`aw_tenant`, a fresh database never has). `bootstrapCluster` is still the two together, for everything else.

## The regression corpus and veraPDF

`apps/worker/src/regression.test.ts` holds the corpus, one suite (W14's decision W-F): the publishing
engine spike's nine cases, grown by a case for every publishing defect filed (PUB-087), and the keep
rules' cases. **Every publishing defect gets a case here, named by its issue number in its
title, in the pull request that fixes it**, holding the document that showed it and the outcome that
is now right, so the corpus is the record of what has gone wrong and cannot again. A case is a
document, not Typst source: it goes through `assemble`, under the default layout and theme unless it
says otherwise, and the publication template the worker ships, so what is checked is what a publish
makes. Its documents are built by `apps/worker/src/testing/corpus.ts`: the spike's seeded prose,
ported from `cases.py` on a generator of its own, so the words differ from the spike's and the shapes
do not, and the content model's shapes as a component and an outline store them. Each PDF is read
back by pdf.js, not by our own parser, through `apps/worker/src/testing/pdf.ts`: the bookmarks; per
page, the text in artifacts, such as the draft notice at the top of each page, which a screen reader
skips, and the text in tagged content, which it reads; the structure roles after the role map, which
is what a screen reader is told a thing is, and every structure element in the tree's order with the
text it holds on each page, which is the order it is told them in (a table on two pages is read
twice, a row set on the other page empty on this one); whether it is marked tagged; its PDF/UA part,
title and language; the page as it is set - each page's label as a reader's page box shows it, each
page's width and height in points, and the least x and the extreme baselines of each page's tagged
text, which is where its margins are; and, through `readPaint`, every run as it is painted, with its
face, size and place, and every face the file embeds.

It holds, in its own describe blocks:

- **The first cases**: six heading levels, each tagged a heading, `H1` to `H6`; nine heading levels,
  which a PDF refuses from the seventh by name and Word publishes as its nine heading styles (W14.2,
  ADR-0031); a PDF not made to PDF/UA-1, which proves the checker can say no (the spike's control);
  sixteen character probes, each refused by `assemble` exactly where the pinned Typst would refuse it
  (the byte-order mark aside, which Typst refuses between some letters and not others, and
  `assemble` refuses everywhere); and the letter the engine drops before an invisible character in
  code.
- **The resolution order in the PDF** (PUB-098): a list of tables printing a caption's reference as
  the number it resolved to, the PDF's half of `order.test.ts`'s references-before-generation pair.
- **The spike's nine**, ported from `spikes/publishing-engine` and judged as its checks judged them:
  1, headings, a list, a header row, a described figure and a passage in French, tagged and passing
  veraPDF; 2, twenty footnotes each at the foot of its mark's page, one longer than a page split; 3, a
  forty-row table's header repeated on every page it crosses and a cell's note at its page's foot; 4,
  an edit near the fortieth of some three hundred pages set where it stands inside the worker's
  thirty-second compile limit, moving no body page before it; 5, equations in running text, a heading,
  a cell, a note, a caption and blocks, each a formula with its words, two of three blocks numbered,
  and Typst markup set as the characters it is; 6, each matter's page numbers and the running head's
  chapter, from the cover to the appendix; 7, every face set embedded as a subset, and a face the
  worker does not hold refused by name, where the engine would have set it in another face without a
  word; 8, the spike's long document at its full size - four hundred sections, sixty figures, forty
  tables - every contents entry, every figure listed and every cross-reference printing the right
  page; 9, the same bytes of the same inputs. What the spike had that the corpus does not: case 4's
  timing, which is PUB-102's budget on its declared reference document; case 8's reference list,
  since a citation cannot resolve until LIB in T6; and case 9's second machine, since the suite runs
  on one.
- **The defects fixed**, by issue: #145 (a publication set in the pinned faces alone), #158 (a second
  level of bullets in a glyph the faces have, moved here from `template.test.ts`; the refusal is
  fixed, and the issue stays open for what it asks besides, a theme's markers checked against its
  faces) and #253 (a figure a
  condition hides numbered, listed and referred to as though it were not there); and, in a describe
  of its own citing nothing, since PUB-087 is the PDF's, Word's #7 (a Word publication's heading and
  footnote numbers and a heading's spacing, held against the product's writer, since the defect's
  `exportDocx` publishes nothing).
- **The defects still open**, each pinned as it stands - #162, #163, #164, #165, #232, #233, #234 and
  #235 - so that a change which moves one goes red here, and the pull request that fixes one turns its
  case round to the outcome its issue asks for and moves it among the fixed. These cite no
  requirement: they assert what is wrong.
- **The keep rules**, moved here from `themes.test.ts`: keep-with-next, keep-together where
  the page allows it and not where it does not, and widow and orphan control, each measured across the
  foot of a small page on a grid of 12pt lines, and each read from the same style as the Word writer's
  own rule, `w:keepNext`, `w:keepLines` and `w:widowControl`. They cite STY-008 where they show a
  style's keeping, and not PUB-092, which asks each engine's pages to show the rules holding: nothing
  yet measures where Word itself breaks a page (themes.md names the gap).

A defect that was not in publishing output has no case here: the content model's (#88, a caption held
as a string; #122 to #125), the editor's and the paste's, and the worker's retrying of a job its
content fails (#146), whose case is in `sample.test.ts`. The publishing half of #148 is #253's case; its
other half is the document page's numbering, not a publication's.

The publish job's own suite, `apps/worker/src/publish.test.ts`, reads its publications the same way,
and checks one multi-page publication with veraPDF too. `apps/worker/src/testing/verapdf.ts` runs the
pinned `verapdf/cli` image, fetched once by digest with `pnpm --filter @alloy-works/worker
fetch-verapdf` (needs Docker; it retries the pull three times before failing, since Docker Hub is
outside the repository's control - an outage or an anonymous rate limit fails the step before the
traceability gate even runs). A cold veraPDF run costs about eleven seconds, almost all of it the
container and the JVM starting rather than checking the page, so **the suite keeps one warm for the
whole run**: veraPDF's undocumented `--servermode` reads a PDF's path per line and answers each with
its report, and `apps/worker/src/testing/verapdf-server.ts` starts it on the first check and serves it
to every test file over 127.0.0.1 (the global setup, `verapdf-setup.ts`). After it starts, a check
costs tens of milliseconds. `verapdf.test.ts` pins the flag: an image that dropped it fails there by
name. It runs in the worker's test suite on every change to the template or the engine.

**The worker checks every publication with the same protocol** (W14.1): `startServerMode` in
`apps/worker/src/verapdf.ts` holds it, and the suite's container and the worker's own child process are
two hosts over it. The `check_pdf` job sees a `Checker`, and `check.test.ts` hands it `suiteChecker`,
the run's warm veraPDF, so the job is tested against the pinned veraPDF itself. The worker's own child
process needs a Java runtime no developer's machine or CI runner has, so `verapdf.test.ts` drives it
against `testing/fake-verapdf.ts`, a stand-in speaking the protocol, which Node runs by stripping its
types: what the stand-in answers is decided by the PDF's bytes. That it runs the real veraPDF is shown
by building the worker image, whose build runs `verapdf --version`, and by CI's entry-point step.
Every publication now queues its check ahead of whatever is asked next, so a suite that publishes and
then waits on another job takes it with `processNextBesideChecks` (`testing/work.ts`), which runs each
check it meets and passes over it. In the corpus veraPDF checks against PDF/UA-1 the six heading
levels, the spike's cases 1, 2, 3 and 5, and the keep-together case, which it must pass, and the PDF
not made to PDF/UA-1, which it must fail. The sixteen character probes are not checked against
PDF/UA-1 at all - each is compared only to what the pinned Typst itself would refuse, character by
character.

`apps/worker/src/layout.test.ts` is where template 2 is measured against the layout it was given: one
fixture of several pages compiled under the product's default layout and under a test layout that
differs in every member the template reads, then read back through the same `testing/pdf.ts` - the
page box as it is turned, the margins the text sits inside, each matter's page labels, the cover, the
running heads and feet, the contents, and the draft notice on every page and once to assistive
technology. It checks both layouts with veraPDF as well, because a layout is what sets the page and a
page that no longer passes PDF/UA-1 is the layout's fault, not the engine's.

What a case demonstrates is what a person cannot verify by reading a PDF: the machine rules veraPDF
checks - tagging, a document title, alternative text present - are part of what a screen reader is told
when it reads the structure tree. Passing them is necessary but not sufficient: a nine-level document
passes every one, and its headings at levels seven to nine still reach a screen reader as paragraphs,
because the pinned Typst tags them `H7` to `H9` and role-maps each to `P`. So since W14.2 `assemble`
refuses such a document for the PDF, and the nine-level case compiles the document it publishes for
Word to keep that measurement as a tripwire: the day the engine tags them as headings, it goes red,
and the refusal can lift (ADR-0031). The document's title is set
as a level-one heading for the same reason: Typst's own title is role-mapped to `P`, and the case pins
the whole role tree, so an engine that changed either would be caught. Reading order, and the other Matterhorn checkpoints only a
person can judge - whether a heading sounds like a heading, whether a table's structure matches what it
shows - are read from the same cases by hand when the engine or the template changes; they are not run
by any suite.

## The publishing budget

`apps/worker/src/publishing-budget.test.ts` measures PUB-102: a declared 300-page reference document
published to PDF, from the request to the recorded publication, at or under ten seconds at p95 and no
sample above thirty. The document is 30 chapters, each placing a component of 100 blocks - 150
figures, 150 tables, 150 numbered equations, 150 footnotes and 2,400 paragraphs of prose in all - seeded
through the store; its pages and parts are read back off the PDF, not assumed, and it came to 311 pages
when it was declared. It is published eleven times through the worker suite's own harness,
`requestPublication` and then `processNext` running the publish job to the recorded publication; the
first warms the worker and is reported and held to the maximum of thirty seconds alone, and the other
ten are the samples. With ten samples the nearest-rank p95 is the slowest of them, so every sample is
held to ten seconds. The measured span leaves out the HTTP route that asks for the publish and the
time a request waits in the queue for a worker.

Each publication queues its `check_pdf` as it is recorded (W14.1), which the next `processNext` would
take ahead of the next publish, so each is settled outside the measured span before the next is asked
for. The warm-up's and the last sample's are checked by the run's veraPDF (`suiteChecker`), and the
time from the publication recorded - its request's `finished_at` - to its `publication_check` row's
`checked_at` is PUB-102's other bound, held to five minutes where the budget binds: the warm-up's
includes veraPDF's first start, and the last sample's is warm. Both must pass PDF/UA-1. The other nine
checks are passed over unchecked, since a check of 311 pages takes several seconds and each would tell
no more than the last. W14.2 measured 23.6 seconds for the first and 6.2 warm.

It is part of the ordinary worker suite, since it takes about fifty seconds, and needs nothing the
suite does not. **It binds where `CI` is not `true`, and records only on CI's runner**, as STR-063's
navigation budget does (`apps/service/src/test/budget.ts`): a shared runner's speed is not the declared
reference configuration, and a green CI run does not show the budget met. Either way the
configuration it ran on - CPU, operating system, memory, Node, Typst and PostgreSQL - the document's
pages and parts, the p50, p95, maximum and each sample's request and job times, and the two reports'
times after recording are written into the test's `meta`, which the JSON reporter carries into
`.trace-results/worker.json`, and printed at the end of the run. To measure it alone:

```bash
pnpm turbo run build --filter="@alloy-works/worker^..."   # the packages the worker imports
pnpm --filter @alloy-works/worker exec vitest run src/publishing-budget.test.ts
```

Run alone, on nothing else, when the number is to be quoted: the suite's other files run beside it and
slow it.

### The reference configuration

PUB-102's budget is stated against a declared reference configuration. **The reference configuration
is: Intel Core Ultra 7 270K Plus, 24 logical CPUs, 64 GB, Windows 11, Node 24.16.0, Typst 0.15.1,
PostgreSQL 17 in Docker.** A run on another machine binds as this one does, but its numbers are that
machine's; a number quoted for the budget is quoted from this configuration. W14.2 measured a p95 of
1.4 to 1.6 seconds on it alone, over four runs, and 1.8 seconds beside the rest of the suite.

## The Open XML validator

Every worker test that makes a `.docx` - `apps/worker/src/word.test.ts` and the publish job's Word
tests - asserts that the Open XML SDK's validator finds nothing wrong with it, since Word refuses a
file whose elements are out of order rather than reading past them, and a schema check finds that
without anybody opening Word. `checkOoxml` in `apps/worker/src/testing/ooxml.ts` runs it, beside
veraPDF's checker, from an image of the worker's own: `apps/worker/tools/ooxml-check/` is a small .NET
8 program over `DocumentFormat.OpenXml`'s `OpenXmlValidator` with Office 2019's rules, its package
pinned by a NuGet lock file and its .NET images by digest. There is no image to pull, so
`pnpm --filter @alloy-works/worker fetch-ooxml-check` builds it, once per machine and in CI beside
`fetch-verapdf` (needs Docker; three tries, since mcr.microsoft.com and nuget.org are outside the
repository's control). The image is tagged by a hash of the files it is built from, so changing any of
them names an image no machine has, and the tests then fail saying to run `fetch-ooxml-check` rather
than validating with a stale build. The unit tests in `packages/domain/src/word/` read the parts back
and cannot run the validator, since the domain has no Docker; the worker's tests are where a writer
change meets it.

## The Word check

Passing the validator says Word will open a file, not what it will show. **The Word check opens the
writer's fixtures in Word itself**, as a standing practice (PUB-029):
`apps/worker/src/word-check.test.ts` makes twelve documents through the worker's own path - `assemble`
with the worker's own face files, under the default theme and layout but where a fixture says
otherwise, then `writeDocx` - and `apps/worker/scripts/word-check.ps1` opens each in a hidden Word
through COM, updates its contents and fields, reads every section, paragraph, list string and field
back, has Word export it to PDF, and saves it again. The test then checks ten things: each opens
without an error; each heading's list string is the numbering table's number, its style Word's
heading style for its depth, and its text holds no number; the updated contents lists every heading
to the layout's depth with its number and page, and keeps its section; **Not approved** heads every
page, the cover's included; each running head names the level-one heading the page is in, by its
title alone where it has no number, and in reading order in a right-to-left document; no page is
left blank, where an appendix fills its last page to the foot; the page labels run per matter; the
foot carries the revision on every page but the cover, right to left too; the Liberation faces are
embedded and every visible character is set in them, never Times New Roman, with one exception Word
makes and the test pins (digits alone in a right-to-left heading); and saving again changes no
paragraph's text, style or number.

Since Word 2 it also holds Word to the PDF of the same document. One fixture carries every construct
Word 2 writes - lists of each kind, format and start nested to the ninth level, a definition list,
two attributed quotations in a row, two preformatted blocks in a row and a line as wide as the PDF's
measure holds, a banded table crossing a page, described, decorative and floated figures, images in
a line and in a cell, and two floated figures a paragraph apart - under the default theme with a
banded table style and a floated image style beside its own, which has neither, and is compiled
through template 13 beside it, with the same image bytes; a second numbers its captions under the
third and the ninth levels, by a layout of its own; and the right-to-left fixture holds a numbered
table. Every caption field is prefilled "9" before Word opens it. The test then checks ten things
more, reading both PDFs by baseline and by their operators: every list string is the marker the PDF
prints; every step between two lines of the lists, the quotations and the preformatted text both
PDFs set on one page is the PDF's within a point, but a term above its definition, held at the
3.40pt Word's line adds; two preformatted blocks are two panels; the widest line stays one line; the
table's header rows are marked and repeated on every page its body reaches, and every cell's fill is
the one the PDF paints behind the same words; every caption's label is the numbering table's after
the update; every image is the PDF's size within half a point, described or flagged decorative;
each floated figure and its caption are one text box at the head of its page, the first where the PDF
sets it and the second below it on the same page, no image painted over another in either PDF and
each floated caption read whole; a right-to-left caption's label reads left to right before its
words, as the PDF prints it; and the lists after the contents name every figure and table with the page Word sets it on, which is the
page the PDF's lists name.

Since Word 3 it holds Word's footnotes and cross-references to the numbering table and to what the
PDF prints. One fixture carries footnotes in front matter, the body and an appendix - three on one
page, one in a table's cell, one of two paragraphs, one in German - and every form of reference to
every kind of target - headings at the first and the third levels, in front matter and an appendix,
a table, a figure, a floated figure, a paragraph and a footnote - before and after its target, pages
away, in a paragraph, a note's text, a caption, a header row, a table's note and a section's title,
and relative ones in a German passage; a second, for Word alone, a footnote in a table's header row
Word repeats and references to it; and the right-to-left fixture a Hebrew note and references in a
Hebrew passage. Every reference's result is prefilled "9", a page's among them, before Word opens
it, and the script updates the notes' fields as well as the text's. The test then checks three
things more: every footnote's number, as Word's own `NOTEREF` to its mark reads it on the reopened
copy, is the numbering table's label, and its note begins on its mark's page; every reference's
field, in the text, the notes and a text box, in order, is the instruction the form asks for, linked
exactly where the PDF links, and its result what the PDF prints - Word's own words for above and
below in another language, recorded in the test as measured (`oben` and `unten` in German, the
English ones in Hebrew) - and every page the page Word sets its target on, by the page's own foot;
and every bookmark the writer wrote is `_Ref` and nine digits, hidden, and kept whole by Word, beside
the `_Toc` ones Word makes as it updates the contents.

Since Word 4 it holds Word's equations to the PDF. One fixture, compiled through template 13 beside
it, carries an equation holding every kind of node the maths tree has, in a line and displayed, and
equations in a line in a paragraph, a table's caption, header row and cells - one alone in its cell -
a table's note, a figure's caption, a footnote and a level-one section's title; numbered ones in
front matter, the body and an appendix, one of them too wide for its line; references to them in
every form an equation offers; and the list of equations. Every number's result is prefilled "9"
before Word opens it. The earlier checks take the fixture in: they read an equation in Word's text
as a placeholder - in a heading, a running head, the contents and the lists - allow Cambria Math
exactly where equations are set, and save it again, which found a heading's equation turned bold by
Word's save. The test then checks two things more: every equation is one
of Word's own, displayed or in its line as the published document sets it and in Cambria Math, again
where Word rebuilds the contents and the lists from a heading or a caption holding one, there as its
runs alone; and every
equation's number is the numbering table's after the update - _Equation i_, _1_, _A.1_ - starting
within a point of where the PDF starts it across the page, on the line its equation stands on, and
the too-wide one broken over lines inside its cell with its number beside it. Word 4's final review
added two cases and a check: references forward, number and relative, to the body's second numbered
equation and to the appendix's, with front matter numbering one, which Word numbered one higher before
front matter's equations counted under a name of their own; and a fraction holding a script in a
chapter's title and a listed caption, which the writer reports and which the copy Word saved holds as
a fraction where the heading and the caption stand and as its runs alone in the entries Word rebuilt.

- **Who and when.** Whoever changes the Word writer - `packages/domain/src/word/`, the theme's Word
  projection or `wordRun` - runs it before the change lands, on Windows with Word installed. **A pull
  request that changes the writer pastes its result**: the test run and a summary of what Word showed.
- **How.** `ALLOY_WORD_CHECK=1 pnpm --filter @alloy-works/worker test -- src/word-check.test.ts` (in
  PowerShell, `$env:ALLOY_WORD_CHECK = '1'` first), after `pnpm --filter @alloy-works/domain build`
  if the writer changed, since the worker reads the domain's `dist/`. It takes about two minutes. It leaves the fixtures, Word's PDFs, the copies Word saved and `record.json`, everything
  Word reported, in `alloy-works-word-check` under the system's temporary folder, for a person to
  read and to summarise in the pull request. **Run alone like this, it rewrites
  `.trace-results/worker.json` with that one file's results**, so run the whole worker suite
  (`pnpm --filter @alloy-works/worker test`) after it and before `pnpm trace verify`, which reads
  that file.
- **What CI does with it.** It is skipped: `describe.runIf` runs it only on Windows with the variable
  set, and CI runs Linux and has no Word. So **PUB-029, which it cites, is Covered by the citation and
  Verified only by a local run**; the report CI writes records it as skipped. It cites nothing else,
  for that reason: a skipped citation would demote a requirement another test verifies.
- **What it cannot see.** A file Word repairs in silence opens as if nothing were wrong, so "opens
  without an error" is not proof nothing was repaired; and hidden, with its alerts off, Word takes the
  field-update prompt's default and updates on opening, so the contents as prefilled - what a reader
  who declines the prompt sees - is never looked at.

## The end-to-end suite

`tests/e2e` drives the whole system as a person's browser would meet it, and nothing else does: the
service, a worker, the database, the object store and the sign-in provider, all in containers.

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
pnpm test:e2e
```

It is **left out of `pnpm test` on purpose**, because a suite that needs the whole stack up first
would otherwise fail on every machine that has not run it. CI runs it as its own job, which is also
where the stack's logs are kept when it fails.

Besides a sample, **it publishes a document and downloads it.** The development environment's seed
lets Ada publish, so the check makes a document holding the seeded component, asks for a PDF, follows
the request until it is done, finds the publication in the document's list, and downloads it: the bytes
must be a PDF, hash to the digest the record holds, and name the pinned face - which is what catches an
image built without its fonts, since Typst with no fonts at all compiles and warns about nothing. Then
it reads the publication back: `tests/e2e/src/pdf.ts` opens the downloaded bytes with pdf.js - the
suite's only dependency beyond the client and the sign-in provider, `pdfjs-dist` in
`tests/e2e/package.json` - and checks that the whole stack laid the document out under its layout:
each page's label, set per matter, the running heads over the front matter and the body, the draft
notice on every page, and a contents naming the front section. It is a second, smaller reader rather
than `apps/worker/src/testing/pdf.ts` reused, because `tests/e2e` cannot import an app's internal
source; it reads only the four things this suite asserts, and leaves the bookmarks, the structure
roles and the margins to the worker's own. What it makes stays in the database the stack serves, as a
sample does - locally, the development database; in CI, a fresh volume removed afterwards.

Two things it deliberately does not ask of the machine running it:

- **It addresses the stack as `127.0.0.1`**, not `dev.acme.localhost`, because how a machine
  resolves `*.localhost` is not a thing worth testing. The compose stack gives the development
  environment that extra address.
- **It follows a signed link without resolving the store's name.** The store signs the name it calls
  itself by, so that name stays in the `Host` header and only the socket is pointed somewhere
  reachable. `completeAtStandIn` does the same for the sign-in provider. Every address it uses can
  be overridden: `ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP`, `ALLOY_E2E_IDP_ISSUER`, `ALLOY_E2E_STORE_AT`.

What it does **not** cover, and where that lives instead: refusing another environment's session,
which is `cross-tenant.test.ts` in the service, because Node's `fetch` will not let a test set the
`Host` header; and anything a browser does, which is [the browser suite](#the-browser-suite)'s.

## The browser suite

`tests/browser` drives the renderer where it runs: a real Chromium, against the whole system in
containers, the same stack the end-to-end suite drives
([ADR-0029](decisions/0029-a-browser-suite-in-ci-and-attested-audits.md), and the W13 plan's
decisions B-A to B-H). What jsdom cannot show is shown here - the browser's own drag and drop, where
the focus really goes, what a live region says in the accessibility tree, a key the page takes from
the browser, and axe-core's checks of WCAG 2.2 AA.

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
pnpm --filter @alloy-works/browser fetch-chromium   # once per machine, and after the pin moves
pnpm test:browser
```

It is **left out of `pnpm test`** for the reason the end-to-end suite is, and `packages/trace` exempts
its report from "no report at all" as it exempts e2e's, while still refusing one that failed or is
stale; CI's gate job refuses to run without it, and without e2e's. Its report is
`.trace-results/browser.json`. Its files run one at a time, since every file drives the one stack.
The workspace has two configurations: `vitest.config.ts`, the suite, run by its `test:browser` script,
and `vitest.pin.config.ts`, the pin's tests alone, which need no stack and are its `test` script - so
`pnpm test` runs them on every machine, into `.trace-results/browser-pin.json`.

**Vitest runs it, over `playwright-core` as a library** - not Playwright Test, whose report
`packages/trace` would not read. A test takes a page from `withPage` (`src/testing/page.ts`): a fresh
browser context, signed in, at a desktop viewport, closed after the test.

**The browser is pinned as Typst is.** `src/chromium-release.ts` names Chrome for Testing's
`chrome-headless-shell` at the build the installed `playwright-core` names in its own `browsers.json`,
with a sha256 per platform; `fetch-chromium` downloads it from Google's public Chrome for Testing
bucket, checks the hash (`checkArchive`) and unpacks it into `tests/browser/.tools/`, and the suite
launches that executable by path and no other. Once it has unpacked a checked archive it writes the
hash beside it, and a later run - or a CI cache restored - is trusted only while that marker names the
pin (`isFetched`); otherwise it fetches again. `chromium-release.test.ts` holds the pin equal to
`browsers.json`, so a Playwright upgrade without a new pin fails `pnpm test` by name. To move the pin: upgrade `playwright-core`, set
the version and revision its `browsers.json` names, run `fetch-chromium --print-hashes`, which
downloads every platform's archive and prints each one's hash, and copy those in. CI caches `.tools`
keyed on the pin file, so a new pin downloads once. On Linux the build needs the shared libraries
Google Chrome needs, which the CI runner's image carries with its own Chrome; a bare Debian image
does not, and the launch then names the first one missing.

**It signs in once per run, the way a person does**: the global setup (`src/testing/setup.ts`) opens
the renderer, follows **Sign in** to the stand-in provider's own page, chooses Ada, and saves what the
browser context holds; every test's context starts from that. It signs in from Node too, as the
end-to-end suite does, and **every fixture is made through the API** by the generated client
(`src/testing/api.ts`), the path a person's content takes. A test that changes what it is given makes
its own - a small document is a handful of requests - titled with what it is for and when it was made.

**The page's console is gated** as the jsdom suite's is: a `console.error`, a `console.warn` or an
uncaught exception in the page fails the test that caused it, naming what was said and where. A test
that provokes one on purpose calls `allowPageNoise()`, and the gate re-arms for the next test. There
are no retries: a flaky test is fixed, or quarantined in its own pull request with an issue. The gate
found one on its first run - a section's title field had no `white-space` rule, so ProseMirror warned
and collapsed the spaces an author typed - which jsdom, computing no style, never could.

**axe-core checks WCAG 2.2 AA's automatable criteria** - the tags `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa` and `wcag22aa` - through `checkAxe` (`src/testing/axe.ts`), with the pinned `axe-core`
injected by its own source. A violation fails the test unless it is on the allow-list in that file,
which is compared exactly - a violation not on it fails, and one on it that axe no longer finds fails
until it is taken off - and is empty. What axe marks `incomplete`, needing a person, is written into
the test's `meta` for the audit, never failed on.

**Where it finds the stack.** Three variables, each defaulting to the compose stack's own address, and
passed through by turbo:

| Variable                 | Default                                                         | What it is                                                                 |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ALLOY_BROWSER_SERVICE`  | `http://dev.acme.localhost:8088`                                | The environment as the browser meets it                                    |
| `ALLOY_BROWSER_API`      | `http://127.0.0.1:8088`                                         | The same environment as Node reaches it for fixtures                       |
| `ALLOY_BROWSER_IDP`      | `http://idp.localhost:9090`                                     | The stand-in provider, by the name it calls itself                         |
| `ALLOY_BROWSER_DATABASE` | `postgres://aw_service:aw_service_dev@127.0.0.1:5432/alloy_dev` | Where the measured style writes its themes (below)                         |
| `ALLOY_BROWSER_STORE_AT` | `127.0.0.1`                                                     | Where Node follows a link the object store signed, its name kept in `Host` |

Chromium resolves any `*.localhost` name to this machine itself, so the browser needs nothing from
the machine's resolver; Node reaches the provider at `127.0.0.1` on the port its name carries. To
drive a second stack beside one already running - on ports of its own, under a project name of its
own, so the first is never touched:

```bash
SERVICE_PORT=8188 IDP_PORT=9190 STORE_PORT=8433 POSTGRES_PORT=5532 \
  docker compose -p aw-browser -f deploy/compose.yaml up -d --build --wait
ALLOY_BROWSER_SERVICE=http://dev.acme.localhost:8188 ALLOY_BROWSER_API=http://127.0.0.1:8188 \
  ALLOY_BROWSER_IDP=http://idp.localhost:9190 \
  ALLOY_BROWSER_DATABASE=postgres://aw_service:aw_service_dev@127.0.0.1:5532/alloy_dev pnpm test:browser
docker compose -p aw-browser -f deploy/compose.yaml down -v
```

**CI runs it in the whole-system job**, after the end-to-end suite and against the same containers,
whenever the stack came up; neither step is `continue-on-error`. Its report goes to the traceability
gate's own job with the rest ([CI, branches and releases](ci-and-releases.md)).

**What it covers so far.** `outline.test.ts` edits a document's outline the three ways STR-006 names,
each act read back from the service: by keyboard alone - insert, move, promote and demote, retitle in
**Title**, **Starts on**, and remove after its question - with no pointer press sent, the focus kept
where the act was made, each act's announcement read from the live region, and every `Alt` and arrow
key taken by the tree before the browser can act on it; by pointer - moves by the browser's own drag
and drop onto a node, onto the gap before one and onto **Move to the end of the document**, then a
node chosen by a click, **Add section**, **Title** clicked into and left, **Starts on** and
**Remove section** with its question's **Remove**; and through the API. axe checks the outline panel in
each state. Another test shows structure.md's known limit: two `Alt+Down` pressed before the first is
answered send one move. And one holds issue #325 fixed: two spaces typed in a section's title are
stored, computed as `break-spaces` and drawn as two.

**The measured style** (`styles.test.ts`, STY-080; [themes.md](design/themes.md#the-theme-in-the-editor-measured))
measures the editor against the PDF of the same document. One component holding a token at the head of
every block and run a theme styles is placed in a document under each of five themes - the default, one
differing from it in every property the editor projects, and three generated from seeds - and each
document is published through the stack, downloaded by its signed link and read by pdf.js
(`src/testing/pdf.ts`, a small copy of the worker suite's `readPaint`), and opened in the document
view's Reading mode at 100%. Each token is measured in both (`src/testing/measure.ts`): in the page by a
zero-size marker set before its first letter and its element's computed style, in the PDF by the text
matrix of the run that paints it. The comparison (`src/testing/compare.ts`) fails on any length more
than half a point apart - where a token starts, each step between baselines in the order the page reads
them, a size, an image's size, a table rule's width and where it runs - and on any face, weight,
posture, colour, underline or fill that differs; what it leaves out, and why, is in its own description
and in themes.md. The largest difference each property showed is written into the test's `meta`, with
the seeds.

- **Its themes are written into the stack's database**, the W13 plan's one exception to fixtures made
  through the API, since no route makes a theme in T1: by `@alloy-works/db`'s own `addCatalogueVersion`
  and `addThemeVersion` (`src/testing/store.ts`), as the development environment's tenant, logged in as
  the service logs in. Nothing creates a theme artifact but a migration, so each is seeded with a copy of
  the default's rows and the theme measured is its next version - fixed artifacts, so a later run writes
  nothing where a theme has not changed. `ALLOY_BROWSER_DATABASE` says where the stack's database is.
- **Other seeds** can be tried without changing the test: `ALLOY_BROWSER_STYLE_SEEDS=11,22,33` measures
  those instead, up to eight. `ALLOY_BROWSER_STYLE_DUMP=<folder>` writes every token's two measurements,
  and every difference with the largest found, into that folder as JSON, which is where a failure is
  read.
- **The generator is narrowed** to what the store takes (contrast, a line at least 1.2 of its size, a
  rule no wider than twice its table's padding) and to what both outputs render: no mark larger than its
  text, no floated figure, and none of what the PDF does not set yet (issue #330).

**What it cannot see.** Headless Chromium has no browser interface, so `Alt+Left` is never Back there
whatever the page does: the test shows the tree prevented the key's default, which is what keeps it
from a browser that has one, and that the address and the history did not move - the second half
alone passes without the tree doing anything, as a run with the tree's `preventDefault` taken out
showed. The suite drives the web delivery only: the desktop window loads the same renderer, and what
differs there is the platform bridge, tested in `apps/desktop`.
