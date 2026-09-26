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

`pnpm test` runs every suite but the last, which needs a running stack; `pnpm test:e2e` runs that
one. The reporter is **pinned explicitly** in every `vitest.config`: left
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

**There is no browser suite.** jsdom has no layout engine, so any question about _rendered_ output -
geometry, measurement, what an editor actually draws - cannot be answered there; a test asserting it
would be testing jsdom's polyfill. When the product grows a surface that needs it, add a Playwright
suite as `pnpm test:browser` and run it as a separate CI step. Until then, do not fake it in jsdom.

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

`apps/worker/src/regression.test.ts` holds the corpus - meant to be the publishing spike's cases,
grown by a case for every publishing defect found (PUB-087). **Every publishing defect gets a case
here, in the pull request that fixes it**, holding the outline that showed it and the outcome that is
now right, so the corpus is the record of what has gone wrong and cannot again. A case is an outline,
not Typst source: it goes through `assemble`, under the default layout, and the publication template
(`apps/worker/templates/publication/2/`), so what is checked is what ships. Each PDF is read back by
pdf.js, not by our own parser, through `apps/worker/src/testing/pdf.ts`: the bookmarks; per page, the
text in artifacts, such as the draft notice at the top of each page, which a screen reader skips, and
the text in tagged content, which it reads; the structure roles after the role map, which is what a
screen reader is told a thing is; whether it is marked tagged; its PDF/UA part, title and language;
and the page as it is set - each page's label as a reader's page box shows it, each page's width and
height in points, and the least x and the extreme baselines of each page's tagged text, which is
where its margins are. It holds three cases today: nine heading levels; a PDF not made to PDF/UA-1, which proves the checker can say no; and
sixteen character probes, each refused by `assemble` exactly where the pinned Typst would refuse it
(the byte-order mark aside, which Typst refuses between some letters and not others, and `assemble`
refuses everywhere). The spike's other cases arrive with what they exercise.

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
name. It runs in the worker's test suite on every change to the template or the engine - not on every
publication, which is a later slice's. Of the corpus's three cases, veraPDF checks two against PDF/UA-1: nine
heading levels, which it must pass, and the PDF not made to PDF/UA-1, which it must fail. The sixteen
character probes are not checked against PDF/UA-1 at all - each is compared only to what the pinned
Typst itself would refuse, character by character.

`apps/worker/src/layout.test.ts` is where template 2 is measured against the layout it was given: one
fixture of several pages compiled under the product's default layout and under a test layout that
differs in every member the template reads, then read back through the same `testing/pdf.ts` - the
page box as it is turned, the margins the text sits inside, each matter's page labels, the cover, the
running heads and feet, the contents, and the draft notice on every page and once to assistive
technology. It checks both layouts with veraPDF as well, because a layout is what sets the page and a
page that no longer passes PDF/UA-1 is the layout's fault, not the engine's.

What a case demonstrates is what a person cannot verify by reading a PDF: the machine rules veraPDF
checks - tagging, a document title, alternative text present - are part of what a screen reader is told
when it reads the structure tree. Passing them is necessary but not sufficient: the nine-level case
passes every one, and its headings at levels seven to nine still reach a screen reader as paragraphs,
because the pinned Typst tags them `H7` to `H9` and role-maps each to `P`. The document's title is set
as a level-one heading for the same reason: Typst's own title is role-mapped to `P`, and the case pins
the whole role tree, so an engine that changed either would be caught. Reading order, and the other Matterhorn checkpoints only a
person can judge - whether a heading sounds like a heading, whether a table's structure matches what it
shows - are read from the same cases by hand when the engine or the template changes; they are not run
by any suite.

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
`Host` header; and anything a browser does, which waits for an interface with something to click.
