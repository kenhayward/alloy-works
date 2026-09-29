# W13: A browser suite, and verified accessibility

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W13 of
> [the rest of T1](2026-09-25-t1-remainder.md) under
> [ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md), Ken's K4 of 2026-09-28:
> CI runs a real browser, Playwright over a pinned Chromium against the service's test stack, and what
> only a person can check is verified by attestation. Its decisions, B-A to B-P below, are to be taken
> as recommended and are Ken's to review. B-K, B-M and B-N change the requirements rather than build
> to them, and are the ones to read first.

**Goal:** the renderer is tested where it runs. A browser in CI drives the editor and the document
view against the whole stack, checks them against WCAG 2.2 AA with axe-core, drives the outline by
pointer, by keyboard and through the API, times the views on a document of several hundred
components, and measures what the editor sets against what the PDF prints; and what only a person can
judge - the WCAG audit and the Matterhorn review - has a procedure, a record and a baseline row.

| PR    | Holds                                                                                                                                                          | Version |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W13.0 | This plan                                                                                                                                                      | Build   |
| W13.1 | The suite: `tests/browser`, the pinned Chromium, signing in, the page's console gate, the job and the gate's own job; the outline by pointer, keyboard and API | Minor   |
| W13.2 | Accessibility, verified: axe-core over every state of the editor and the document view, what it finds fixed or filed; the audits a person makes                | Minor   |
| W13.3 | The budgets: a five-hundred-node document made through the API; issue #134 and the view's row landed with numbers; both measured                               | Minor   |
| W13.4 | Measured style: STY-053 split, and the editor measured against the PDF of the same document                                                                    | Minor   |

Four build slices where the remainder plan guessed three: the budgets and the measured style each need
a fixture and a comparison of their own, and together they are larger than a pull request should be.

## What W13 can and cannot close

The remainder plan lists CNT-176, CNT-177, CNT-078, STR-039, CNT-076, STR-006, the editor half of
STY-053 and PUB-023. Read against their statements (`pnpm trace show`, 2026-09-28), four of the eight
cannot be closed by a browser test as they stand:

| ID      | State today | Statement, in short                                                            | What W13 does                                                                                                        |
| ------- | ----------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| CNT-176 | Specified   | CNT-078 verified by an automated suite in CI over the editor in a real browser | Cited by W13.2's axe test; component-editor.md claims it                                                             |
| CNT-177 | Specified   | Before each release, a person audits the editor against WCAG 2.2 AA            | **No test can.** A guide, a record and a baseline row (B-J); claimed, never cited                                    |
| CNT-078 | Specified   | The editor meets WCAG 2.2 AA, verified rather than asserted                    | **No test can.** Met in a baseline by CNT-176 and CNT-177 together (B-J); claimed, never cited                       |
| STR-039 | Specified   | Navigation usable at several hundred nodes, "against the budget in scope §11"  | **Scope §11 states no number.** It names the quantities that get one. Superseded by STR-072, issue #134 landed (B-K) |
| CNT-076 | Specified   | The view usable on several hundred components, "budget in scope §11"           | **The same.** Superseded by CNT-179, a row with numbers (B-K)                                                        |
| STR-006 | Designed    | The outline editable by pointer, by keyboard alone, and through the API        | Cited by W13.1's test, which drives all three; structure.md already claims it                                        |
| STY-053 | Designed    | Every style property the same measured value in the editor, PDF and Word       | **Word's half is not W13's.** Split (B-M): STY-080, the editor as the PDF, cited by W13.4; STY-081, Word, left       |
| PUB-023 | Specified   | Word a first-class output                                                      | **Not W13's.** word-output.md claims it when STY-053's Word half lands and the maths face's coverage is judged (B-N) |

PUB-104, the Matterhorn review a person makes, is not on W13's row, but ADR-0029 made it an attestation
beside CNT-177 and nothing gives it a procedure yet, so W13.2's guide takes it too.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Instead of                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-A | **The browser runs against the compose stack, in the whole-system job, after the end-to-end suite and against the same containers.** It addresses the development environment as `http://dev.acme.localhost:8088`, which Chromium resolves itself, and the stand-in provider as `idp.localhost:9090`, as a person's browser does. ADR-0029's "a separate job" is read as separate from the jsdom suites' job, which it is. The stack takes about 1 minute 50 seconds to build on CI and the end-to-end suite 16 seconds, so a third job building the same images again would add two minutes to every run for nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The service started in process by the test with a database of its own, which has no worker, so no publication for W13.4 to measure against, and is a second harness beside the service suite's; or a third job building the stack again                                                                                                                       |
| B-B | **Signing in happens once per run, in the browser, through the stand-in's own page as Ada**: the global setup opens the renderer, follows the service to the stand-in, chooses Ada, and saves the context's storage state, which each test's fresh context starts from. Each test gets a context of its own, so nothing one test leaves in the page reaches the next                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A session made in Node and added to the context as a cookie, which skips the one path only a browser takes, and the `__Host-` cookies' handling is what could differ                                                                                                                                                                                          |
| B-C | **Fixtures are made through the API, by the generated client, from Node**, signed in as e2e signs in (`completeAtStandIn`, at `127.0.0.1`, an address of the same environment), **once per stack**: each fixture's title carries its shape's version, and the global setup finds it by title or makes it. **One exception**: the themes W13.4 measures are written into the stack's database by `@alloy-works/db`'s own theme writer, because no route makes a theme in T1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Seeding through the store, as the navigation budget does, which is faster and is not the path a person's content takes; or a fixture per test, which makes hundreds of requests per test                                                                                                                                                                      |
| B-D | **Vitest is the runner, in `node`, over `playwright-core` as a library; Playwright Test is not used.** `packages/trace` reads only Vitest's JSON report shape (`parseResults`, `checkCoherence`), every suite pins its reporter in a `vitest.config`, and the console gate is Vitest's. A test is `it('STR-006 ...', async () => {...})` with a page from a small fixture of the suite's own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `@playwright/test`, whose JSON report `parseResults` would refuse, so a reporter translating it to Vitest's shape - a second runner and a translation the gate would depend on; or Vitest's browser mode, which runs the test inside a page and cannot drive the stack's own renderer                                                                         |
| B-E | **Chromium is pinned as Typst is.** `tests/browser/src/chromium-release.ts` names Chrome for Testing's `chrome-headless-shell` 153.0.8010.12, the build `playwright-core` 1.63.0's `browsers.json` names (revision 1243), with a sha256 per platform (`linux64`, `win64`, `mac-arm64`, `mac-x64`); `pnpm --filter @alloy-works/browser fetch-chromium` downloads it from Google's public Chrome for Testing bucket, checks the hash and unpacks it into `tests/browser/.tools/`, and the suite launches it by `executablePath`. A test holds the pinned version equal to the installed `playwright-core`'s `browsers.json`, so a Playwright bump without a new pin fails by name. CI caches `tests/browser/.tools` keyed on the pin file's hash                                                                                                                                                                                                                                                                                                                             | `playwright install`, which checks no hash and ties the suite to Playwright's own download location and cache layout; the runner image's installed Chrome, which moves with the image, unannounced, which is what ADR-0029 forbids; or Playwright's Docker image, which a Windows machine cannot point at a stack on its own loopback without host networking |
| B-F | **The suite is its own workspace, `tests/browser` (`@alloy-works/browser`)**, beside `tests/e2e`: `.test.ts` files, since `packages/trace` scans only `*.test.ts(x)` for citations; its report at `.trace-results/browser.json`; its files one at a time (`fileParallelism: false`), since the budgets want a quiet machine; left out of `pnpm test` as e2e is, and run by `pnpm test:browser`. `checkCoherence` exempts it from "no report at all" as it exempts e2e, and still refuses a stale or failed one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Folding it into `tests/e2e`, whose report would then mix two suites that fail for different reasons; or into `apps/web`, whose `pnpm test` runs on every machine without a stack                                                                                                                                                                              |
| B-G | **The traceability gate moves to a job of its own**, needing the build job and the whole-system job, which each upload their `.trace-results`; it downloads both and runs `pnpm trace gate` over all of them, not continue-on-error. The browser step is not continue-on-error either. So a failing browser test fails the gate, as a failing `pnpm test` does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Leaving the gate in the build job, where no browser test could ever be Verified in CI - the end-to-end suite's two citations today (AST-005, PUB-005) never reach it                                                                                                                                                                                          |
| B-H | **The page's console is gated as the jsdom suite's is**: a `console.error`, a `console.warn` or an uncaught error in the page fails the test that caused it, naming the message; `allowPageNoise()` opts one test out and re-arms for the next. No retries: a flaky test is fixed or quarantined in its own pull request with an issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Collecting the page's console into the run's output, where nobody reads it; or retries, which is rerunning until green by configuration                                                                                                                                                                                                                       |
| B-I | **axe-core checks WCAG 2.2 AA's automatable criteria**: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, over the whole page in every state W13.2 lists, at a desktop viewport. What axe marks `incomplete` - needing a person - is written into the test's `meta` and handed to the audit (CNT-177), never failed on. **A violation is fixed in W13.2 where it is small; one needing a design is filed as an issue and held in an allow-list the test compares exactly** - rule, target and issue - so a new violation fails and a fixed one fails until it is taken off. CNT-078 cannot be attested while the list holds anything                                                                                                                                                                                                                                                                                                                                                                                                                          | `best-practice` tags failing a pull request, which are not WCAG; a suite that fails every pull request on a violation needing a design; or a clean axe run counted as conformance, which automated checks find only a minority of                                                                                                                             |
| B-J | **Attestation.** CNT-176 is cited by W13.2's test. CNT-177 and PUB-104 are verified in each release's baseline by `attestation`, naming who and when, after the procedure in a new guide, `docs/guides/auditing-a-release.md`, whose record is committed as `docs/audits/<version>/wcag.md` and `docs/audits/<version>/matterhorn.md` before the baseline cites it. **CNT-078 is cited by no test**: a baseline declares it `inherited` from CNT-177, with CNT-176 and CNT-177 both included, so it is met only when the suite passed and a person looked. component-editor.md claims CNT-078, CNT-176 and CNT-177; publishing.md claims PUB-104                                                                                                                                                                                                                                                                                                                                                                                                                            | Citing CNT-078 on axe's pass; keeping the audit's record only inside the evidence pack, which `pnpm trace pack` writes and a person does not; or `inherited` from CNT-176, which would let a release claim conformance nobody audited                                                                                                                         |
| B-K | **STR-039 and CNT-076 get numbers.** Scope §11 lists the quantities that get a number in the requirements and gives none, so "against the budget in scope §11" can never be demonstrated. **Issue #134 lands as STR-072**, the interface's share as Ken filed it, and STR-039 is superseded by it (with STR-063, the service's share, already claimed). **CNT-076 is superseded by CNT-179**: a document assembling four hundred components in a five-hundred-node outline opens in the document view with its outline and first screen of text shown at or under 1 second at p95, no sample above 2, and a jump to any node brings its text into view at or under 250 ms at p95, none above 500 - measured in a browser against the running service on a declared reference configuration. 1 and 2 seconds are CNT-136's preview numbers; 250 and 500 are STR-063's interactive budget. **If the view as built misses them, W13.3 stops and brings the number to Ken**: scope §11 says a capability that cannot meet its budget is a scope question, not a tuning exercise | Citing STR-039 and CNT-076 against a number the plan made up, which the rows do not say; or leaving both unclosable in T1                                                                                                                                                                                                                                     |
| B-L | **The interface's share (STR-072) is the act's time less the service's.** From the act - the navigation, the key - to the result painted, taken in the page by an init script at the first frame after the result is in the DOM (never by the test's polling), less `requestStart` to `responseEnd` of each request the act waits on, from the Resource Timing API. The whole time is recorded beside it. CNT-179 is the whole time, since a reader waits for all of it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The whole time for STR-072 too, which counts STR-063's 250 ms twice                                                                                                                                                                                                                                                                                           |
| B-M | **STY-053 is split, as CNT-139 was**, through the requirement form: **STY-080**, every style property the editor renders measured at the value the PDF measures, by an automated suite, cited by W13.4; and **STY-081**, the same for Word, left open with PUB-023. STY-053 is superseded by STY-080. W13.4 measures as themes.md's conformance section says: in Chromium, a zero-size marker at each line's start for the baseline and computed style for size, weight, posture, colour and face; in the PDF of the same document, published through the stack, each token's baseline and face read by pdf.js; within half a point, with STY-060's list of approved deviations. It measures the default theme, a second theme differing in every property, and three seeded generated ones                                                                                                                                                                                                                                                                                 | Citing STY-053 on a test measuring two formats of three; or measuring the editor and citing nothing, which leaves W13's half of STY-053 invisible to the trace                                                                                                                                                                                                |
| B-N | **PUB-023 leaves W13.** word-output.md already says it is claimed when STY-053's Word half lands and the maths face's coverage is judged or reported; neither is W13's. It stays a named gap there, beside STY-081                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Claiming it on the editor's measurement, which says nothing about Word                                                                                                                                                                                                                                                                                        |
| B-O | **The job runs on every push and pull request**, as ADR-0029 decides, and feeds the gate. Expected wall time: the whole-system job grows from about 2.5 minutes to about 8 to 10 (fixtures about 1 to 2 minutes the first time on a fresh stack, Chromium from the cache in seconds, axe about 1 minute, the budgets about 2, the outline and the measured style about 2 with their publications), finishing beside the build job's 7 and the gate's job adding about a minute after it. ADR-0029's fallback - nightly and on a tag - is Ken's to take, with an issue, if the job proves too slow or flaky                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Nightly from the start, which would let a pull request break the editor's accessibility unseen until the next morning                                                                                                                                                                                                                                         |
| B-P | **The budgets bind where `CI` is not `true` and are recorded on CI**, as STR-063's and PUB-102's are, each sample and the configuration written into the test's `meta`: CPU, count, memory, operating system, Node, Chromium's version from the browser itself, the stack's versions and the fixture's shape. The reference configuration is docs/testing.md's, with the stack in Docker Desktop and the pinned Chromium beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A budget binding on a shared runner, whose speed has already varied by more than the budget (issues #179, #188)                                                                                                                                                                                                                                               |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title - never
  `it.each` or a built string, which cite nothing.
- A citation needs a design claiming the requirement first: `pnpm trace check` fails otherwise. Each
  slice adds its claims before its tests.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture - Ada and
  Grace, as the stand-in's own.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, the stack up and `pnpm
test:browser`, then `pnpm trace generate` after Prettier and `pnpm trace pins`; the full suite before
  each pull request, and its CI log read, the browser step's included.
- The suite drives the stack over HTTP and through the page, and imports nothing from an app's
  source; what it needs from one (the budget rule, a PDF reader) it keeps a small copy of, as
  `tests/e2e/src/pdf.ts` does.
- Pins are taken from the tools, never from memory: `npm view` for the packages, `browsers.json` for
  Chromium's version, the downloaded archives for their hashes.

## Pins, taken on 2026-09-28

| What                   | Pin                                              | From                                                                                       |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `playwright-core`      | 1.63.0, exact                                    | `npm view playwright-core version` (published 2026-09-04)                                  |
| `@axe-core/playwright` | 4.13.0, exact                                    | `npm view @axe-core/playwright version` (2026-08-11)                                       |
| `axe-core`             | 4.13.0, exact, a direct dependency               | `npm view axe-core version` (2026-08-05); the above asks `~4.13.0`                         |
| Chromium               | `chrome-headless-shell` 153.0.8010.12, rev. 1243 | `playwright-core@1.63.0/browsers.json`; the four archives answer 200 at Chrome for Testing |

Exact specifiers, not ranges, for all three packages: a new axe-core can add a rule, and a new
Playwright names a new Chromium, and either would change a result through a lock file refresh. The
archives' sha256 are taken by `fetch-chromium --print-hashes` in W13.1, from the downloads themselves.

## Questions a slice answers before it builds

Only these could change the plan; everything else is built as written.

1. **W13.1: does `playwright-core` 1.63.0 drive the pinned headless shell by `executablePath` on
   Windows and on `ubuntu-latest` without system packages?** The runner image carries Google Chrome,
   so its libraries are expected to be there. If they are not, the job adds
   `pnpm exec playwright install-deps chromium` before the suite, and nothing else changes.
2. **W13.3: does the document view as built meet CNT-179's numbers on the reference machine?** Measured
   before the row lands. If not, the slice stops and brings the number to Ken (B-K).
3. **W13.4: can the suite write a theme into the stack's database** with `addThemeVersion` under the
   development environment's tenant, and does STY-069's contrast rule refuse any of the generated
   ones? A generator that the store refuses is narrowed to what it accepts, and the seed recorded.

## W13.1: The suite

1. `tests/browser`, `@alloy-works/browser`: `vitest.config.ts` in `node`, reporters `['default',
'json']` into `../../.trace-results/browser.json`, `fileParallelism: false`, a global setup, and a
   test timeout fit for a browser. Dependencies: `playwright-core`, `@axe-core/playwright`, `axe-core`
   (B-D, the pins above), `@alloy-works/api-client`, `@alloy-works/stand-in-idp`.
2. `src/chromium-release.ts` and `scripts/fetch-chromium.ts`, after `apps/worker`'s Typst pair: the
   version, the four platforms' archive names and hashes, and a `--print-hashes` mode that downloads
   all four and prints them, which is how the hashes are taken. `tests/browser/.tools/` is already
   ignored by the root `.gitignore`'s `.tools/`.
3. The harness, as interfaces:
   - `launchPinned(): Promise<Browser>` - the pinned executable, headless, with
     `--font-render-hinting=none`, so a measurement does not move with the platform's hinting.
   - The global setup: wait for `/health` as e2e does; sign in through the stand-in's page (B-B) and
     save the storage state; make the fixtures this slice needs (B-C). Addresses from
     `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API`, `ALLOY_BROWSER_IDP`, defaulting to the compose
     stack's; turbo passes them through.
   - `withPage(test)` - a fresh context from the storage state, the console gate (B-H) and
     `allowPageNoise()`.
   - `checkAxe(page, state)` - axe with B-I's tags, violations compared to the allow-list, the
     `incomplete` results written to `meta`.
4. `packages/trace`: `checkCoherence` exempts `browser` from "no report at all" beside `e2e`, test
   first in `results.test.ts`.
5. Root scripts: `test` filters out `@alloy-works/browser` as it does e2e; `test:browser` runs it
   through turbo, with a `@alloy-works/browser#test` task passing its variables through.
6. CI (B-A, B-G): the whole-system job restores the cached `.tools`, runs `fetch-chromium`, and after
   the end-to-end step runs `pnpm test:browser` whenever the stack came up; both jobs upload
   `.trace-results` as artifacts; a `gate` job, needing both and running unless cancelled, downloads
   them and runs `pnpm trace gate`. The build job loses its gate step.
7. **STR-006**, in `outline.test.ts`, over a small document made through the API:
   - by keyboard alone, with no pointer event sent: every one of the five operations - insert with
     `Enter`, move with `Alt+Up` and `Alt+Down`, promote and demote with `Alt+Left` and `Alt+Right`,
     retitle in **Title**, set **Starts on**, remove with `Delete` after its question - each read back
     from the service; and what only a browser shows: `Alt+Left` taken by the tree and not by the
     browser as Back (the page's URL and history unchanged), the focus staying in the tree after each
     act, and each act's announcement in the live region, read from the accessibility tree;
   - by pointer: a node dragged onto another, onto the gap before one and onto **Move to the end of
     the document** with the browser's own drag and drop, each read back from the service;
   - through the API: the same five operations by the client, each a version;
   - axe over the outline panel in each of those states, with no violation.
     A second, citing nothing: two `Alt+Down` pressed before the first is answered send one move
     (structure.md's known limit, which it left "for the browser suite to show").
8. Docs: docs/testing.md's "There is no browser suite" becomes "The browser suite" (what it runs
   against, how to run it, the pin, the console gate); docs/architecture.md and CLAUDE.md's component
   table and commands gain `tests/browser`, `pnpm test:browser` and `fetch-chromium`;
   docs/ci-and-releases.md and docs/guides/reading-the-trace.md say where the gate now runs and what it
   reads; deploy/README.md says how to run the suite against the stack.
9. Tests: STR-006; and, citing nothing, the pin held to `browsers.json`, and the trace exemption.

**W13.1, as built** (PR #326). Two departures from the above:

- **B-C's fixtures are not found by title once per stack.** Every STR-006 test changes the outline it
  is given, so a shared fixture would be left in whatever shape the last run made it, and a failed run
  would leave the next one a different outline to start from. Each test makes its own small document
  through the API instead - a handful of requests - titled with what it is for and the moment it was
  made. B-C's find-or-make still suits a fixture nothing changes, which W13.3's five-hundred-node
  document is, and that slice takes it up.
- **The pin's tests run in `pnpm test`**, from a second configuration, `vitest.pin.config.ts`, with no
  global setup, so a Playwright upgrade without a new pin fails on every machine and not only in the
  whole-system job. `pnpm test:browser` is the workspace's `test:browser` script.

## W13.2: Accessibility, verified

1. The states, each a test step reached by the keyboard or the pointer as a person would, axe run in
   each (B-I):
   - **The component editor**: a component holding every block and mark the editor makes - nine marks,
     nested bulleted, numbered and definition lists, a quotation with its attribution, preformatted
     text, a table with a caption, header rows and columns and merged cells, a figure, an inline
     image, a footnote, a cross-reference, inline and block equations - with the focus in each; each
     dialog open (Link, Language, Figure, Image, Reference, Equation, the symbol palette, the paste
     report); each panel open (Table, Figure, List, Preformatted, Recovery, the metadata panel); the
     title strip's fields; a failed save's notice.
   - **The document view**: Reading and Authoring; Show boundaries on; a node chosen and one arrived
     at by link; the version chooser open; the remove question; a section's title editor with the
     Equation dialog; the generated lists; the Preview pane open; the Publishing panel.
   - The home page and the components list, which every route into the editor passes.
2. What axe finds: fixed in this slice where small, test first; the rest filed, one issue each, and
   held in the allow-list (B-I). The pull request lists what was found and what became of each.
3. Claims (B-J): component-editor.md moves CNT-078, CNT-176 and CNT-177 from "Left unclaimed" into its
   table, saying CNT-078 is verified by the other two and never by a test title; publishing.md moves
   PUB-104 into its table the same way. The remainder of component-editor.md's "Accessibility, which
   needs a browser" and structure.md's "No release claims STR-006 without it" are brought up to date.
4. `docs/guides/auditing-a-release.md`, for a person who has not done it before, every claim in it
   checked against the tool it names: **the WCAG 2.2 AA audit** (CNT-177) - which build, the browsers
   and assistive technology to use, the states W13.2 lists and the criteria no automated check reaches
   (keyboard traps, focus order and visibility, reflow at 320 pixels, text spacing, meaningful
   sequence, what a screen reader announces), axe's `incomplete` results from the run beside it, and
   the allow-list, which must be empty; **the Matterhorn review** (PUB-104) - the regression corpus's
   PDFs, the checkpoints docs/testing.md says only a person can judge, how to read the structure in a
   reader; and **the record and the row**: `docs/audits/<version>/wcag.md` and `matterhorn.md`, one
   row per criterion or checkpoint with its verdict, then the baseline's `## Verification` rows -
   `CNT-177 | attestation | <name>, <YYYY-MM-DD>, docs/audits/<version>/wcag.md`, the same for
   PUB-104, and `CNT-078 | inherited | CNT-177`. `docs/specification/baselines/README.md` points at the
   guide.
5. docs/features.md and the README say the editor is checked against WCAG 2.2 AA in a real browser on
   every change, and what that does not mean without the audit.
6. Tests: CNT-176, on the test that runs axe over every state; the allow-list's exactness citing
   nothing.

**W13.2, as built** (PR #327). What it found, and what departs from the above:

- **What axe found**, on the first run over 82 states: five violations, all small, all fixed in the
  slice with the axe test as the failing test, so **the allow-list is empty** and nothing was filed.
  `--muted` (#6b7280) measured 4.44:1 on `--accent-weak` and 4.41 on `--chip-bg` - the current
  component in the space pane, the selected text a Link or Language dialog quotes, the saving chip -
  so the token is darkened to #646b78, 4.9 on both, rather than each place patched; the environment's
  name on Home measured 2.2 on the panel's translucent white over the dark backdrop, and takes the
  text's colour; the account chip under the pointer took base.css's pale hover behind its white text,
  1.08; and the Reference dialog's radio buttons stood 23 pixels apart where 2.5.8 asks 24. CI's first run found a sixth, which the local runs had not reached: the publication page's "Not approved" notice in `--warn` (#d97706), 3.2:1 on white, so warning words take a new `--warn-text` (#b45309, 5.0:1) while `--warn` stays for borders and dots, where 3:1 suffices. What axe
  left undecided - 98 elements' contrast over something it cannot measure, and two links in text - is
  in each test's `meta`, and `undecided` prints it for the audit.
- **The fixture is a component made through the API as the editor makes one**: created, its lock
  claimed, an iteration saved and Done editing cutting the version (`testing/component.ts`), its
  figure and inline image uploaded and proved by the worker first, and its content every block and
  mark (`testing/every-block.ts`), the equations' MathML taken once from the pinned Temml. A fresh one
  per test, as W13.1's documents are.
- **Five tests, not one**: the screen signed out and the screens around the editor, cited by nothing,
  since they are not the editor; the editor; a save that failed; and the document view. The screen
  signed out and the failed save stand alone because the browser reports a refused request in the
  page's console - the renderer's `/v1/me` answered 401, each save 503 - which only those two tests
  allow.
- **The Matterhorn review needed the corpus's PDFs**, which the suite kept nowhere a person could open
  them: `ALLOY_CORPUS_PDFS` now keeps each, named by its case (`apps/worker/src/testing/keep.ts`), and
  the guide runs the corpus so.
- **`docs/audits/` has a README** saying what the folder holds and that a record is never edited, as
  `docs/reviews/`'s does; the records themselves arrive with the first audited release.
- **The final review found states checked vacuously**, and CI's sixth violation was one of them. The
  first version waited for the network and the faces after each move, which return at once after a
  move inside the app, so axe checked the screen before: the documents, publications and templates
  lists (the components list was checked four times), Search's results, API tokens, Administration's
  sections, the Recovery panel, the cursor in a quotation with the Table panel still up, and the
  publication page; and "a figure chosen" never opened its panel, because a click on a figure's
  picture selects nothing (issue #335) - the panel opens from its caption. Each state is now waited
  for by its own content, and `checkAxe` takes what the state is known by (`shows`) and what it
  leaves behind (`hides`) and refuses to run without them, before axe and after; run on the old
  waits, it failed in the first state each of three tests moved to by a click. `outline.test.ts` names
  each state by the tree it draws, and showed no race.
- **`allowPageNoise` takes the patterns a test provokes**, and still fails on anything else the page
  says; the two tests that use it name a 401 from `/v1/me` and a 503 from a save.
- **CNT-078 is inherited from two**: `pnpm trace gate` now meets a requirement whose `inherited` row
  names several identifiers only when every one is included and met, so a baseline declares
  `CNT-078 | inherited | CNT-177, CNT-176` and cannot meet it from the audit alone; and it refuses an
  attestation naming a record under `docs/audits/` that is not there.
- **PUB-104 is not claimed.** Its statement asks for the review whenever the engine, the template or
  the pipeline changes; the guide makes it before each release, so a change merged between releases
  waits for it. publishing.md names the gap; superseding PUB-104 with a per-release row is Ken's.

## W13.3: The budgets

1. Question 2 first, on the reference machine: the view opened and jumped in, measured as step 4 will.
   The numbers are carried to Ken if it misses, and nothing below is built until he answers.
2. The rows, through the requirement form: issue #134 drafted with `pnpm trace draft 134` and landed as
   STR-072, STR-039 marked `Superseded by STR-072`; a new issue for CNT-179, landed, CNT-076 marked
   `Superseded by CNT-179`; each document's change history and the requirements index's counts.
   structure.md claims STR-072 and drops its STR-039 row's issue link; document-view.md claims CNT-179.
3. The fixture, through the API (B-C): STR-063's reference shape - five hundred nodes, four hundred of
   them references to four hundred components, a hundred sections in ten chapters - each component a
   heading's worth of prose with a list, and a table and an equation in every tenth, so the view sets
   what a document holds. Its shape is declared in docs/testing.md and read back, not assumed.
4. The measurement (B-L, B-P): an init script records the time the condition first holds and the next
   frame after it; one warm-up, reported, then twenty samples, nearest-rank p95 and the maximum; the
   configuration in `meta` and printed.
   - STR-072: the page opened at the document, to the outline's five hundred nodes and the text's
     first screen shown; and a move by `Alt+Down`, to the moved node's new number shown.
   - CNT-179: the view opened, to the outline and the first screen of text; and a jump to a node
     chosen at random from a seeded sequence, to its heading in view.
5. docs/testing.md: the budgets, the fixture, how to run them alone, and the reference configuration
   with the stack and Chromium named.
6. Tests: STR-072 and CNT-179, each on its measuring test.

## W13.4: Measured style

1. The rows, through the requirement form: STY-080 and STY-081 landed, STY-053 marked
   `Superseded by STY-080`, and a change history row saying STY-081 carries Word's half; themes.md
   claims STY-080 and names STY-081 as the gap beside its table; word-output.md's PUB-023 paragraph
   names STY-081.
2. Question 3, then the themes (B-C's exception): the default theme; a second differing in every
   property the editor projects; three generated from a seeded generator within the catalogue's
   schema, the seed in `meta`. Each is given to a template made through the API, and a document made
   from it.
3. The fixture: a component whose blocks each open with a token, one block per paragraph style and
   one run per character style, with a table and an image in their styles; placed in each document.
4. The editor's measurement, in the document view's Reading mode, which CNT-075 holds identical to
   the editing view: a zero-size marker beside each token for its baseline and start, and computed
   style for size, weight, posture, colour and face, as the ADR-0014 prototype measured.
5. The PDF's: each document published through the stack, downloaded by its signed link, and each
   token's baseline, start, size and face read by pdf.js - a reader of the suite's own, beside
   `tests/e2e/src/pdf.ts`.
6. The comparison: every step between two baselines, every start and every size within half a
   point; weight, posture, colour and face exactly; a difference on STY-060's list of approved
   deviations passes and is reported, and one not on it fails.
7. docs/testing.md and themes.md: what is measured, where, and against what.
8. Tests: STY-080, on the comparison over the five themes.

**W13.4, as built** (PR #334). The rows arrived as issue #328. Departures from the above, each in
[themes.md](../design/themes.md#the-theme-in-the-editor-measured):

- **Question 3's answer: yes, and not by `addThemeVersion` alone.** The store takes every theme the
  generator makes once it is narrowed to contrast, a line at least 1.2 of its size and a rule no wider
  than twice its table's padding. But `addThemeVersion` writes a version of a theme that exists, and
  nothing creates a theme or a catalogue artifact but a migration, so the suite copies the default's
  rows as each new artifact's first version and writes the theme it measures as the next, through the
  store's own writers. Fixed artifacts, so a later run writes nothing where a theme is unchanged.
- **The first run found the editor half a point to twenty points from the PDF in twenty-eight places
  under the default theme, and more under the others.** What was the editor's own is fixed in this
  slice, in the projection (issue #329): spaces as padding rather than snapped borders, each block's
  baseline placed from its face's cap height where the browser can trim a line to it - which needed each
  pinned file's cap height in `@alloy-works/fonts` - tables with rules that take no room, lists, an
  attribution, a preformatted block's label, figures, inline code and the application's own table and
  `code` styles.
- **STY-080 is worded over what both outputs render**, as STY-053 was over each output that renders a
  property. What the PDF does not set - a caption's and a footnote's fill, padding and indents, the
  first-line indent of centred or preformatted text (issue #330) - is outside it, and the themes state
  none of it until the PDF does.
- **Named and not compared**, each with its issue: the step into a line held open by something taller
  than its text (#331), how far a script moves (#332), and where the document view places a section's
  heading (#333); and without issues, a footnote's place, equations' layout and floated figures.
- **Measured beyond step 6**: a table's rules, their width, colour and where each runs against its cell's
  text, and what stands behind each token - a fill, a band or the paper.

**W13.4's final review** (PR #334) found the STY-080 claim partial, and four other defects, each fixed
test first:

- **STY-080 is not claimed, and the test cites nothing.** Issues #331 and #333 are properties both
  outputs render and which differ, so the claim was partial; themes.md names them beside its table,
  and says plainly what the comparison leaves out as outside STY-080 and why. STY-060's list of approved
  deviations stays empty between the editor and the PDF, and the test holds it so.
- **A list's items** stood where the editor stylesheet put them, 6.4pt out under the default theme and
  9pt under Contrary, and a list's start was not compared. The projection now sets a list as the engine
  does - a column of markers as wide as the widest, then half an em - and the fixture holds a nested
  list and a numbered one counted from nine, whose starts are compared.
- **The equation's face and the preformatted label's start** are measured.
- **A table's outer rule** was clipped at the canvas's edge, and the measurement read the rule it meant
  to draw rather than the one painted: it reads the painted one now, and the canvas has room either
  side of the measure.
- **A block's fill** is a colour where it has no spaces of its own, so axe-core checks its contrast.
- The test waits for the page to be drawn whole before it measures, and fails where the screen is not
  the document's.

**After W13.4** (0.125.1). Issues #331 and #333 were fixed as bugs, each measured red first: the step
into a line held open by an image, a run larger than its text or a list's marker, and where the
document view stands a section's heading, are now compared and agree, and `styles.test.ts` cites
STY-080, which themes.md claims. The generated themes scale marks above their text too, the fixture
holds a second image in a line, and a script's start - an italic face's own offset - joined #332's
row of what is outside STY-080 ([themes.md](../design/themes.md#the-theme-in-the-editor-measured)).

## Left, named

- **STY-081 and PUB-023**: Word measured as the PDF is, which themes.md designed as LibreOffice's
  rendering of the `.docx` - a proxy - confirmed in Word by the Word check; and the maths face's
  coverage. Neither is in T1's remaining workstreams; they are the next thing to plan after W13.
- **The desktop delivery**: the suite drives the web delivery. The Electron window loads the same
  renderer, and what differs is the platform bridge, whose decisions are `shell.ts`'s and tested
  there.
- **Autosave under load** (component-editor.md's testing section) needs a browser too, and is not on
  W13's row.
