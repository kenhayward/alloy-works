# Structure 3: navigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document can be found your way round. Every node of its outline has an address - the
document and the node, both by identifier - that opens the document with that node chosen, focused
and marked, survives any reorder, and can be copied from the page in either delivery. Beneath the
outline, the document's figures, tables and equations are listed, each with its number and caption,
numbered in the page by the same function the service numbers with, so a move renumbers them before
anybody asks the service anything; a reader is never shown a number a component they may not read
could have moved. Behind the lists, `GET /v1/documents/{id}/contributions` answers what each
occurrence contributes. And STR-039's missing number lands, narrowed to what a suite can measure, as
a row and a measurement in the suite.

**Architecture:** `packages/domain/src/structure/` gains `lists.ts` - `contents(conditioned,
numbering, depth)` and `listOf(conditioned, numbering, sequence)` - and a `Contribution` gains the
caption a list shows. `packages/api-contract` and `apps/service` gain the contributions route, which
reads through structure 2's `numberingInputs` and so never reads a component the caller may not read.
`apps/web` gains `structure/links.ts` (the addresses), a `#/documents/{id}/nodes/{node}` route in
`Workspace`, an outline panel that goes to a linked node, marks it and shows the chosen node's link,
and `GeneratedLists.tsx`, fed by the contributions route. `apps/service` gains the budget's
measurement at five hundred nodes, cited by the row issue #119 lands. **Nothing is stored**: no
migration, no column, no cache, and no new write path.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`),
Fastify 5, Vitest 5 with jsdom for the renderer. No new dependency and no migration.

**Spec:** [`../design/structure.md`](../design/structure.md) ("Navigation", "Generated lists", "Deep
links", "Who is shown what", "Routes", "Where the code lives" and "Verification"), as task 6 amends
it; read with [access.md](../design/access.md) ("Deciding", "Refusing"),
[service-foundations.md](../design/service-foundations.md),
[the first structure plan](2026-09-18-structure-01-the-document-and-its-outline.md) and
[the second](2026-09-18-structure-02-numbering.md), whose "What this plan deliberately leaves undone"
lists are where this one starts, and [issue #119](https://github.com/kenhayward/alloy-works/issues/119).

Third of the structure plans. It builds the contents panel, generated lists, deep links and the
contributions route, lands issue #119, and resolves no cross-reference - that is **structure 4**,
planned beside the first editor slice that authors or renders one.

**The code below was run before the plan was committed.** It was written in a throwaway worktree
from `origin/main` at 0.28.0 (commit `33e3003`), at a short path (`D:/aws3`), against the compose
Postgres on 127.0.0.1:5432 through the suites' own `aw_test_*` databases - never the development
database, and no running container was stopped or restarted. There:

- **The domain.** `contents` and `listOf` were written and tested, and the caption added to a
  contribution: the domain's structure suites passed **71 of 71**, the whole package **551 of 551**,
  and `tsc --noEmit` was clean, the surface test listing `contents` and `listOf` (task 1 adds them
  to it before exporting them, so it is seen to fail). The contributions test failed on the three
  missing captions before they were carried.
- **The route.** `GET /v1/documents/{id}/contributions` answered Grace, who may read both components,
  every occurrence and each version's contributions once; Alice and Ada, who may not read _Quality_,
  were answered `version: null` for its occurrence, and neither body held its caption, its block, its
  version or its identifier. `cross-tenant.test.ts` and `access-routes.test.ts` failed with
  `OTHER_TENANT_IDS[route.operationId] is not a function` and `getContributions has no address in
HOLDING_NOTHING` until each had its entry. The whole `apps/service` suite then passed **255 of 255**.
- **The budget, at five hundred nodes.** A document of **500 nodes - twenty chapters of four sections
  of five references, 400 occurrences of 150 components of 40 blocks each** - was seeded through the
  store and measured through the real routes with Fastify's `inject`, five warm-up calls and forty
  samples each, on Windows 11, an Intel Core Ultra 7 270K Plus (24 threads), Node 24.16:

  | Route                                     | Answer | p50     | p95     | Maximum |
  | ----------------------------------------- | ------ | ------- | ------- | ------- |
  | `GET /v1/documents/{id}`                  | 102 KB | 15.5 ms | 17.4 ms | 18.1 ms |
  | `GET /v1/documents/{id}/contributions`    | 232 KB | 30.1 ms | 38.5 ms | 40.8 ms |
  | `GET /v1/documents/{id}/numbering`        | -      | 39.0 ms | 44.9 ms | 65.0 ms |
  | `POST /v1/documents/{id}/outline`, a move | 102 KB | 28.8 ms | 31.8 ms | 32.4 ms |

  An earlier shape of the contributions answer, one list per occurrence, was **542 KB** and p95
  36.4 ms; naming each version's contributions once (decision C) took it to 232 KB. The whole file,
  seeding included, took 8.3 s.

- **The renderer, in a real browser.** jsdom has no layout and is no measure of time
  ([`../testing.md`](../testing.md)), so the page was bundled for production over a fake service that
  answers at once and run in Electron's own Chromium, offscreen, from `apps/desktop`'s installed
  `electron`. Over the same 500-node document: **opening** - three answers parsed, the outline read,
  numbered twice, 500 tree items and the lists rendered, one frame - p50 91 ms, p95 110 ms, maximum
  111 ms (ten samples after two); **an arrow key** - the next node chosen and focused, one frame - p50
  16.6 ms, p95 17.9 ms (a frame at 60 Hz); **a move** - sent, answered, the outline read again,
  renumbered, re-rendered - p50 64 ms, p95 73 to 91 ms, maximum 99 ms over two runs. So opening a
  500-node document end to end is roughly 18 + 39 + 110 ms of the three this plan measured, and a move
  roughly 32 + 91 ms: inside the budget, with no windowing (decision L). **This is not a suite**, and
  finding K says why that matters for issue #119.
- **The renderer's suite.** The documents page, the workspace and the new `links.test.ts` passed:
  the whole `apps/web` suite **372 of 372**, every existing test unchanged, and `tsc` and `eslint`
  clean. The fake service answers the contributions route from the outline it models.
- **The trace, simulated.** With STR-063 in the corpus and claimed, STR-034's claim dropped and the
  seven new citations in place, `pnpm trace check` reported **No problems in the corpus.**, and the
  regenerated model held **1369 requirements and 180 citations**; `packages/trace`'s suite failed on
  exactly the three pins task 3 and task 6 move, and on nothing else.
- **The contract.** `packages/api-contract` passed 25 of 25 and `packages/api-client` 4 of 4 once
  `openapi.json` and the client's types were regenerated.

Then the throwaway worktree was removed, and every `aw_test_*` database it made was dropped by the
suites that made it.

**What was not run.** `pnpm lint`, `pnpm format`, `pnpm trace verify` and `pnpm trace gate` over the
whole repository; the worker's and the object store's suites; the page in a browser against the real
service; and the desktop app's **Copy link**, which is the one thing only the desktop can show
(`pnpm app`).

## Where structure.md and the built code are wrong, missing or contradicted, most serious first

Planning and running the code against structure.md found these. Task 6 amends the design for what
this plan builds and records the rest.

1. **STR-034 is claimed and answered only in part.** "A navigable table of contents must reflect the
   live outline, and must update as the outline changes." The panel renders the outline the page
   holds, which is the outline the author's own last act returned; **another person's change reaches
   it only when the author next acts and is refused, or reloads**. The stream carries samples and
   nothing else, and an event for a document version would have to be withheld from every viewer
   who may not read the document - a design of its own. **Built:** nothing; the claim is dropped
   and the gap named beside the table (decision I).
2. **Issue #119, as filed, cannot be demonstrated.** "Opening a document of several hundred outline
   nodes and navigating it must stay within the interactive budget: at or under 250 ms at p95, and
   never above 500 ms." Three things stop it: _navigating_ names no act; _never_ is a statement about
   every future sample, which no measurement proves; and most of the time is the interface's, which
   no suite here can measure - jsdom is not a browser, and [`../testing.md`](../testing.md) forbids
   pretending it is. **Built:** the row lands narrowed to the service's share, at a stated size, as
   "no measured sample above 500 ms" (decision K); the interface's share is measured here by hand
   and a row for it is recommended, not filed.
3. **`contents(numbering, depth)` would drop every unnumbered node.** The numbering table holds a
   section entry only for a numbered node, so a contents read from it has no line for a preface, an
   acknowledgements page or anything beneath an unnumbered node - which a table of contents lists.
   **Built:** `contents(conditioned, numbering, depth)` walks the outline and takes each number from
   the table, `null` where there is none. It also cannot title a reference - a reference's heading is
   its component's title, which the domain does not read - so a reference's line carries `title: null`
   for its caller to name.
4. **`listOf(numbering, sequence)` has no caption to list.** A list of figures is "Figure 2.1 The
   paper tray", and nothing in the numbering table, or in a `Contribution`, carries text. **Built:** a
   `Contribution` for a figure or a table carries its caption, and `listOf(conditioned, numbering,
sequence)` looks it up by occurrence and block. The numbering table and the numbering route still
   carry no text.
5. **"A move is a splice rather than a re-fetch" is not what was built.** Every act is a round trip
   answering the whole document - 102 KB at 500 nodes - which the page parses again. It is fast
   enough (a move p95 32 ms at the service and 91 ms in the page), so nothing changes but the prose.
6. **"Rendering is windowed over the visible depth" was never built, and is not needed.** The panel
   renders every node; at 500 nodes it opens in 110 ms p95 and a key moves the choice in one frame.
   **Built:** nothing; the prose goes (decision L).
7. **The contributions route's `occurrences` parameter cannot carry an outline.** Four hundred node
   identifiers are over ten kilobytes of query string. **Built:** the route answers every occurrence of
   the latest version, as the numbering route does, and takes no parameter.
8. **An answer per occurrence repeats a component placed twice.** One list per occurrence was 542 KB
   at 500 nodes. **Built:** each occurrence names its version, and each version's contributions are
   answered once (decision C).
9. **A shareable address needs a way to share it in the desktop app**, which has no address bar and
   no context menu. **Built:** the chosen node's address in a field that can be selected, and **Copy
   link** (decision G).
10. **The workspace's hash router cannot hear the same address twice.** Once the page rewrites the
    address to follow what is chosen, following a link to the node already named is not a change the
    router's state notices. **Built:** the router counts arrivals, and a link that arrives again is
    taken to its node again.
11. **The renderer now computes caption numbers, which is a second place IAM-073 can fail.**
    Structure 2 cited it at the service. **Built:** the page numbers only from what the contributions
    route answered, which never names what the reader may not read, and a test cites IAM-073 in the
    renderer too.
12. **A `latest` component's new head reaches the lists no sooner than the next act.** The page asks for
    contributions again whenever the version it holds changes (decision E), so an author who makes no
    act is shown the numbers as of their last one - as they are shown the outline. Nothing is
    renderable that was not true at the version the page holds; it may be older than the head.
    Named, not fixed: the fix is the live updates finding 1 needs.

## Decisions for Ken

Each is a choice this plan makes provisionally so that it can be built, with a recommendation. Reject
one and the plan changes where the decision says.

**Ken's answers (2026-09-19):** every recommendation accepted, with three additions. **K**: the
interface's share is filed now, as issue #134, rather than left as a recommendation. **E**: accepted
knowing its cost - every act fetches every contribution again (232 KB at 500 nodes) even when, as with
a move, no contribution changed; nothing caches it yet. **H**: task 6 rewrites STR-045's row in "What
this document does not own" to say the panel's half is built and why the claim waits. The pinned
reference's title (the scope table's last row) is filed as issue #135.

- **A. The outline panel is the contents panel; no second contents is rendered.** It already shows
  every node and its number; this plan adds going to a node, its address, and the lists beneath it.
  `contents()` is built in the domain for PUB, which renders a published contents to PUB-037's depth,
  and nothing on screen calls it. Recommended: accept. **Otherwise**: a read-only "Contents to depth
  N" beside the panel, which repeats the tree and has no reader asking for it.
- **B. The contributions route is built, and the page numbers captions itself.** The page asks what
  each occurrence contributes and calls the same `number` the numbering route calls, so a move
  renumbers every list at once and the page's numbers are the service's by identity. Recommended:
  accept. **Otherwise**: the page reads the numbering route after every act - numbers by agreement,
  a round trip before any number moves, and still no caption, which that route carries none of.
- **C. The contributions answer names each version's contributions once**, and each occurrence its
  version, `null` where the caller may not read the component, where it waits on revisions or where its
  content does not read. Measured: 232 KB rather than 542 KB at 500 nodes. Recommended: accept.
  **Otherwise**: a list per occurrence, simpler to read and twice the size wherever a component is
  reused, which is the product's point.
- **D. A contribution carries its caption.** `contributionsOf` already walks to every figure and
  table; the caption is one member on the two that have one. Recommended: accept. **Otherwise**: a
  second projection, `captionsOf`, walking the same content in the same order, joined to the first by
  block identifier.
- **E. The page asks for contributions again whenever the version it holds changes**: on opening,
  after every act the service records, and when a refusal carries somebody else's version. Between,
  it numbers with the last answer, keyed by occurrence, so a move needs nothing new; an occurrence it
  has not heard about is not known, and every number it could move is withheld rather than guessed.
  Recommended: accept. **Otherwise (i)**: ask only when a new occurrence appears - smaller, and a
  `latest` component's new head never reaches the page until a reload (finding 12, worse). **Otherwise
  (ii)**: ask on a timer - fresher, and a request every few seconds from every open page.
- **F. `contents` and `listOf` take the conditioned stage and the table** (findings 3 and 4):
  `contents(conditioned, numbering, depth)` lists every node to the depth, numbered or not, a
  reference's title `null`; `listOf(conditioned, numbering, sequence)` lists one sequence's entries
  with their captions, an unnumbered equation absent because it is no entry, and a withheld number
  `null`. Recommended: accept. **Otherwise**: the design's signatures, which cannot list a preface or
  a caption.
- **G. A node's address is `#/documents/{document}/nodes/{node}`, and the address follows what is
  chosen.** The same hash routing the workspace already uses, so it never reaches the service, a
  reload keeps it, and the renderer's relative assets are never under a deep path (the "Not yet" in
  [`../architecture.md`](../architecture.md), "The service serves the renderer"). Choosing a node
  rewrites the address with `history.replaceState` - no history entry per arrow key, no `hashchange`
  - and the router counts arrivals so the same link followed again is still news (finding 10). The
    chosen node's address is shown in a field and copied by **Copy link** (finding 9). Opening an
    address chooses, focuses and marks the node with `<mark>`; an address naming a node the document
    does not hold says **The linked part is not in this document.**; one into a document the reader may
    not read is answered as nothing there, as every other address is. Recommended: accept.
    **Otherwise (i)**: path addresses (`/documents/...`), which need the renderer's `base` and the
    desktop's `file://` fallback settled first. **Otherwise (ii)**: `pushState` on every choice, which
    fills Back with arrow keys.
- **H. STR-045 stays unclaimed, though the panel now goes to the node and marks it.** "Opening such a
  URL must navigate to the node and highlight it, subject to the recipient's permissions." The panel
  is the only place a node is shown today, so the plan does exactly that - but the document view, when
  it comes, shows a node's content, and the same link must take the reader there too. Claimed now, the
  claim goes partial the day that view exists. Recommended: accept. **Otherwise**: claim and cite it
  with task 4's test, and drop the claim when the document view arrives.
- **I. STR-034's claim is dropped** (finding 1). Recommended: accept, and let the plan that brings
  document versions onto the stream - withheld per viewer - claim it. **Otherwise (i)**: keep the
  claim, reading "live outline" as the one the author's page holds - which is the reading that makes a
  table of contents disagree with a colleague's without either knowing. **Otherwise (ii)**: poll the
  document every few seconds - which replaces the outline under an author mid-drag or mid-title, and
  every held retitle and undo entry was computed against the outline it replaced.
- **J. STR-036 stays claimed and cited by nothing**, as structure 2 left it. The panel and the lists
  number with the function the service numbers with, over the one scheme anything can number with;
  a test can show the page calls that function, which is not "as it will publish" while nothing
  publishes. Recommended: accept; PUB cites it by comparing a published document's numbers with the
  panel's. **Otherwise**: cite it now with a test comparing the page's numbers with `number`'s.
- **K. Issue #119 lands narrowed, as STR-063** (finding 2):

  > **STR-063** A document of five hundred outline nodes, four hundred of them component references,
  > must be opened, numbered and restructured by the service within the interactive budget - at or
  > under 250 ms at p95, and no measured sample above 500 ms - measured by the test suite, which
  > records the configuration it ran on beside the result

  Measured in `pnpm test`, not beside the version chain's load test, so a passing run verifies it and
  a baseline can hold a release to it. STR-039 stays open and unclaimed; the interface's share is a
  recommended row, not filed ([Requirements to file](#requirements-to-file-not-filed-here)).
  Recommended: accept. **Otherwise (i)**: land #119 as written - a row no suite can demonstrate,
  which is the gap the issue was filed to close. **Otherwise (ii)**: the measurement in
  `test:load`, where it is never evidence and the gate never sees it. **Otherwise (iii)**: supersede
  STR-039 by STR-063 now - which drops the interface's share from the corpus.

- **L. No windowing, no collapsing** (finding 6). Measured: 110 ms p95 to open, one frame per key, at
  500 nodes. Recommended: accept; collapse arrives with the accessibility plan if a browser suite shows
  a reader needs it. **Otherwise**: expand and collapse now, which changes what `ArrowLeft` and
  `ArrowRight` do in a keymap 74 tests pin.
- **M. The release is 0.29.0**, a functional enhancement: a reader can link to any node and see a
  document's figures, tables and equations.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. A test cites a requirement only when its own body
  demonstrates that requirement's own statement (`pnpm trace show <ID>`) and structure.md claims it in
  full. [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the whole
  list; every other title carries no identifier.
- **`packages/domain` stays platform-free.** `lists.ts` takes no clock, randomness, `fs` or `window`.
- **A passing run has no errors or warnings**, through the renderer's console gate too.
- **The renderer's tests render under `<StrictMode>`**, the new `Workspace` tests included, and nothing
  reconciles a field by counting renders. When a test waits on the outline panel, it waits for a tree
  item - a React-rendered node - and never only for a field.
- **Refusals.** A document that is missing, another environment's, a component's id, or one the caller
  may not read answers `404`, never `403`. Ids in paths are lowercase uuids (`DocumentParams`). This
  plan adds no wire code.
- **Every read path has a cross-tenant test** (IAM-004): the route in `cross-tenant.test.ts` and
  `access-routes.test.ts`. They do not cite IAM-004.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`).
- **No em or en dashes in user-facing text** - the renderer's strings (`apps/web/src/dashes.test.ts`),
  route summaries and descriptions, and the changelog. Code comments are exempt.
- **No raw control characters in source**, and no real data: `Ada`, `Grace`, `Alice`; **The dosing
  report**, **Introduction**, **Method**, **Scope**, **Install the printer**, **Calibration**,
  **The paper tray**, **Parts**; `example.com`, `alloy.test` and `idp.example` hosts.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>`.
- **`trace.json` is drift-checked and its line numbers move with every test edit.** Each task that
  touches a test file or the corpus runs `pnpm --filter @alloy-works/trace generate` and commits the
  result. The pins in `packages/trace/src/trace.test.ts` move as the tasks say: **citations 173 to
  180** (task 1 +2, task 3 +1, task 4 +2, task 5 +2), **requirements 1368 to 1369** (task 3, with
  `packages/trace/src/parse/requirements.test.ts`), **claims 360 to 361** (task 3) **and back to 360**
  (task 6). Read on `origin/main` at `33e3003`; if main has moved, set each to what the regenerated
  file holds and say so in the comment.
- **A filtered run does not build what it imports.** After changing `packages/domain`,
  `packages/api-contract` or `packages/api-client`, build it (or `pnpm build`) before a filtered run of
  anything importing it.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store
  too.** `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. Never `pnpm
dev:setup` against the development database, never stop or restart a running container, and never
  `turbo run test --continue` or `turbo run test` unfiltered, which reaches the end-to-end suite: use
  the root `pnpm test`, or `pnpm --filter <pkg> test` after building what it imports.
- **Paths.** Run from a checkout at a short path; a worktree under the temporary directory can pass
  Windows' path limit starting `esbuild`.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump (0.29.0) and one changelog entry**, in task 6, headed
  `## 0.29.0 - YYYY-MM-DD (PR #n)` and filled with the date and the number once the pull request
  exists - `apps/desktop/src/version.test.ts` fails on a heading without both. Its body carries
  `Closes #119` on a line of its own. Never commit to `main`.

---

## The stored-shape check

**This plan stores nothing.** No migration, no column, no table, no cache and no new write path. A
contribution, its caption, a contents line and a list entry are derived from a version's content or
the outline whenever they are asked for; an address is a string in the page's hash and never reaches
the service; the row issue #119 lands is corpus, not data. Nothing it produces can be found already
written by a later rule, which is the failure this check exists for.

What it does do is **read for the first time, and send to a reader, a member structure 2 read and
never sent**: a figure's or a table's caption, which is the component's text. So the check here is
the access one:

| #   | Member or value                   | Stored?                                          | Read by                                                                            | Who may be sent it                                                                                                                                          | Recursion                                                                                            |
| --- | --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | A figure's or a table's `caption` | Yes, since content schema version 1, as a string | `contributionsOf`, over content already through `parseContentDocument`             | Only a caller who may read the component: `numberingInputs` selects no row of any other, so there is no caption of one to send (task 2's test probes it)    | Bounded by the content parse, as structure 2's row 2 says; a component that does not read is unknown |
| 2   | A contribution with its caption   | **No.** Derived per request                      | The contributions route, and the page                                              | As row 1                                                                                                                                                    | -                                                                                                    |
| 3   | A contents line, a list entry     | **No.** Derived per render                       | `contents`, `listOf`, the page                                                     | Numbers as the table withholds them (IAM-073); a caption only for what row 1 sent                                                                           | The outline walk is bounded by the parse's 64 levels                                                 |
| 4   | A node's address                  | **No.** A hash                                   | `documentAddress`, which takes a lowercase uuid and a 26-character node identifier | Anybody who has it; opening it is `read` on the document, answered `404` when refused, and a node the document does not hold is said to be absent - nothing | -                                                                                                    |

**Nothing this check found needs changing before anything is stored**, because nothing is.

## The scope, and why

**Built:** a caption on each figure's and table's contribution; `contents` and `listOf`; `GET
/v1/documents/{id}/contributions`; the measurement STR-063 names, and STR-063 itself; a node's address,
going to it, marking it and copying it; and the lists of figures, tables and equations on the document
page.

**Left out, each to a named plan:**

| Left out                                                                                    | Why not here                                                                                     | Whose                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Resolving a cross-reference (STR-028, STR-031, STR-032, STR-056, STR-062)                   | Structure 2's decision A                                                                         | **Structure 4, cross-references**                                                        |
| Another person's outline change reaching an open page (STR-034's "live")                    | Document versions on the stream, withheld per viewer, are a design of their own (decision I)     | **The plan that puts document versions on the stream**                                   |
| Tracking the reader's position as they scroll (STR-035), and a link into the body (STR-045) | There is no document view                                                                        | **The document view**                                                                    |
| The interface's share of STR-039                                                            | Needs a browser suite (decision K)                                                               | **The browser suite, with the recommended row**                                          |
| Expanding and collapsing the tree                                                           | Not needed at 500 nodes (decision L)                                                             | **The accessibility plan**, if its browser suite shows a reader needs it                 |
| Rendering the contents to a declared depth, and the lists, in a publication                 | PUB renders them; PUB-037 declares the depth                                                     | **PUB's plan**                                                                           |
| A pinned reference named by its pinned version's title                                      | The panel names every reference by its component's head title, from the listing it already reads | **Whichever plan resolves a component version for each reference on the document route** |

## Decisions taken before this plan was written

Each is an open shape the design leaves to the plan. A reviewer should be able to reject each on its
own.

**1. `lists.ts` is a module of its own**, beside `numbering.ts`: the table's readers change with PUB,
the table's writer with STR.

**2. The route reuses `numberingInputs` unchanged.** It already resolves every occurrence, reads only
readable components in two queries and projects each version once; the caption rides on the
projection, so the route adds no query.

**3. The page's contributions state is its own**, beside the outline's, and never replaces the
outline: a failure to read contributions leaves the outline, its section numbers and every act
working, and says only that the lists could not be read, with **Try again**.

**4. The address lives in `structure/links.ts`**, and the workspace's route reads it from there rather
than from a second regular expression, so what the page writes and what the router reads are one
spelling, held by one test.

**5. A list entry is a link to the occurrence that holds it**, which is the node's address: choosing a
figure goes to the reference that places it.

**6. The measurement is a committed test in the service suite**, not a load test (decision K), and
prints its report once, after its last sample, with `console.info`, as the version chain's does.

---

## Files

| File                                                                                                       | Responsibility                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/domain/src/structure/contributions.ts`, `contributions.test.ts`                                  | Task 1: a figure's and a table's caption on its contribution              |
| `packages/domain/src/structure/lists.ts`, `lists.test.ts`                                                  | Task 1: `contents`, `listOf`, and two citations                           |
| `packages/domain/src/structure/index.ts`, `src/index.test.ts`                                              | Task 1: the surface, and the test that pins it                            |
| `packages/api-contract/src/documents.ts`, `openapi.json`, `packages/api-client/src/generated/schema.ts`    | Task 2: `ContributionsView` and `getContributions`; both regenerated      |
| `apps/service/src/documents.ts`, `contributions-routes.test.ts`                                            | Task 2: the handler and its tests                                         |
| `apps/service/src/cross-tenant.test.ts`, `access-routes.test.ts`                                           | Task 2: an entry each                                                     |
| `docs/specification/requirements/STR-structure-numbering-and-cross-references.md`, `README.md`             | Task 3: STR-063, its change history, the count                            |
| `apps/service/src/navigation-budget.test.ts`                                                               | Task 3: the measurement, citing STR-063                                   |
| `apps/web/src/structure/links.ts`, `links.test.ts`                                                         | Task 4: the addresses                                                     |
| `apps/web/src/editor/Workspace.tsx`, `Workspace.test.tsx`                                                  | Task 4: the node route, and arrivals                                      |
| `apps/web/src/structure/OutlinePanel.tsx`, `DocumentPage.tsx`, `DocumentPage.test.tsx`                     | Tasks 4 and 5: going to a node, its link; the contributions and the lists |
| `apps/web/src/structure/GeneratedLists.tsx`                                                                | Task 5: the lists of figures, tables and equations                        |
| `packages/trace/trace.json`, `src/trace.test.ts`, `src/parse/requirements.test.ts`                         | Regenerated in every task; the pins moved where the tasks say             |
| `docs/design/structure.md`, `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md` | Tasks 3 and 6                                                             |
| `docs/guides/reading-the-trace.md`, `CLAUDE.md`                                                            | Task 3: the requirement count                                             |
| `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, two `package.json`                                 | Task 6                                                                    |

No migration, no wire code and no new dependency. `packages/db` and `packages/editor` do not change.

## How the design's commitments become tests

| The design says                                                                      | Where                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| A contents to a declared depth: node, number, title and depth (STR-040)              | Task 1, cited                                                       |
| A list of figures, of tables and of equations, three calls to one function (STR-041) | Task 1, cited                                                       |
| A reader is numbered only from what they may read (IAM-073)                          | Task 2 at the route, not cited again; task 5 in the page, cited     |
| Navigation usable at several hundred nodes (STR-039)                                 | Task 3, as STR-063, cited; the interface's share by hand, above     |
| A node's URL is the document's and the node's identifiers (STR-044)                  | Task 4, cited                                                       |
| A deep link survives a reorder (STR-046)                                             | Task 4, cited                                                       |
| Opening a link to a document the reader may not read is a `404`                      | Task 4, not cited: STR-045 is unclaimed (decision H)                |
| Reordering from the panel is the move operation (STR-037)                            | Task 5, cited                                                       |
| The panel shows numbering as it will publish (STR-036)                               | Task 5 shows the page numbering in the page; not cited (decision J) |
| The panel updates as the outline changes (STR-034)                                   | Not claimed after task 6 (decision I)                               |

## Requirements this plan cites, and those it does not

**Seven citations**, taking the pin from 173 to 180. One requirement is added, STR-063, and claimed
(task 3); one claim is dropped, STR-034 (task 6): claims end where they started, at 360, and
requirements at 1369.

| ID          | Statement, in short                                                                    | Claimed by                | Cited in                                  | Task |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------- | ---- |
| **STR-040** | A table of contents generatable to a declared depth                                    | structure.md              | `domain/src/structure/lists.test.ts`      | 1    |
| **STR-041** | A list of figures, of tables and of equations each generatable                         | structure.md              | `domain/src/structure/lists.test.ts`      | 1    |
| **STR-063** | Opened, numbered and restructured by the service within the budget at 500 nodes (new)  | structure.md, from task 3 | `service/src/navigation-budget.test.ts`   | 3    |
| **STR-044** | Every outline node a stable, shareable URL                                             | structure.md              | `web/src/structure/DocumentPage.test.tsx` | 4    |
| **STR-046** | A deep link survives a reorder                                                         | structure.md              | `web/src/structure/DocumentPage.test.tsx` | 4    |
| **IAM-073** | No number a component the reader may not read could have changed is shown them (again) | structure.md              | `web/src/structure/DocumentPage.test.tsx` | 5    |
| **STR-037** | An author reorders the outline from the table of contents directly                     | structure.md              | `web/src/structure/DocumentPage.test.tsx` | 5    |

**STR-044 is the one a reviewer should weigh first.** "Stable" is shown by STR-046's test, "shareable"
by the address being absolute and opening the document at the node in a page that has never seen it -
but the only sharing a suite can do is to hand that string to a fresh page. Whether it reaches a
colleague in the desktop app is **Copy link**, which the suite drives against jsdom's clipboard stub
and nothing but `pnpm app` shows for real.

**IAM-073 is cited a second time on purpose.** Structure 2 demonstrated it where the service numbers.
The page now numbers captions itself, from what the contributions route answered, so the page is a
second place the rule can fail - a gap closed in the list is the leak IAM-073 forbids - and the test
shows it does not.

**Near misses, not cited:**

| ID               | Why not                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR-034          | Answered in part (finding 1); the claim is dropped in task 6                                                                                            |
| STR-035, STR-045 | Unclaimed: the document view's (decision H). Task 4 builds the panel's half of both                                                                     |
| STR-036          | Claimed, cited by nothing (decision J)                                                                                                                  |
| STR-039          | Unclaimed: STR-063 is the service's share, and the interface's has no suite to measure it                                                               |
| STR-042          | T4, and unclaimed: `contents` and `listOf` read the conditioned stage, so it falls out of the order once REU's conditions exist - nothing here shows it |
| STR-054          | The root's own address, `#/documents/{id}`, is structure 1's and already cited                                                                          |
| STR-031          | About cross-references; finding 12 is its spirit and is named, not cited                                                                                |

### Requirements filed for later, not landed here

1. **The interface's share of STR-039**, filed as
   [issue #134](https://github.com/kenhayward/alloy-works/issues/134) before this build (Ken's
   answer to decision K), to land beside STR-063 once a browser suite exists: "Opening a
   document of five hundred outline nodes, four hundred of them component references, and showing the
   result of each structural act on it, must take the interface at or under 250 ms at p95 from the
   request leaving it, with no measured sample above 500 ms, measured in a browser against the running
   service on a declared reference configuration." Measured by hand here at 110 ms p95 to open and
   91 ms for a move, over a service that answers at once. When both STR-063 and it are in the corpus,
   STR-039 is superseded by the pair.

---

## Task 1: Captions, the contents and the lists

**Files:**

- Modify: `packages/domain/src/structure/contributions.ts`, `contributions.test.ts`
- Create: `packages/domain/src/structure/lists.ts`, `lists.test.ts`
- Modify: `packages/domain/src/structure/index.ts`, `packages/domain/src/index.test.ts`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

**Interfaces:**

- Consumes: structure 2's `Conditioned`, `NumberableNode`, `NumberingTable`, `number`, `resolve`,
  `conditions`, `defaultNumberingScheme`, `contributionsOf`
- Produces: `Contribution.caption?: string`; `contents(conditioned: Conditioned, numbering:
NumberingTable, depth: number): ContentsEntry[]`; `listOf(conditioned: Conditioned, numbering:
NumberingTable, sequence: string): ListEntry[]`; the types `ContentsEntry` and `ListEntry`, all
  exported from `@alloy-works/domain`

- [ ] **Step 1: Write the failing test for the caption**

In `packages/domain/src/structure/contributions.test.ts`, the first test's expectation gains the
captions its content already holds:

```ts
expect(contributionsOf(content)).toEqual([
  { block: 'n1', sequence: 'footnote', numbered: true },
  { block: 'f1', sequence: 'figure', numbered: true, caption: 'A caption' },
  { block: 't1', sequence: 'table', numbered: true, caption: 'Parts' },
  { block: 'n2', sequence: 'footnote', numbered: true },
  { block: 'e1', sequence: 'equation', numbered: true },
  { block: 'n3', sequence: 'footnote', numbered: true },
  { block: 'f2', sequence: 'figure', numbered: true, caption: 'A caption' },
  { block: 'e2', sequence: 'equation', numbered: false },
  { block: 'n4', sequence: 'footnote', numbered: true },
]);
```

- [ ] **Step 2: Run it, and watch it fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/contributions.test.ts
```

Expected: FAIL, the diff showing three `"caption"` members expected and not received.

- [ ] **Step 3: Carry the caption**

In `contributions.ts`, the interface gains one member, and its comment one sentence:

```ts
/**
 * What one caption-bearing block (CNT-081) or one footnote contributes to the sequences: its
 * identifier, the sequence it takes from, and whether it takes a number at all - only a block equation
 * can say no (CNT-047). A small projection of content: no position, and no text but a figure's or a
 * table's caption, which a generated list shows beside its number. The numbering table copies none of
 * it, so the table still carries nothing a component holds but the identifiers it already exposes.
 */
export interface Contribution {
  readonly block: string;
  readonly sequence: string;
  readonly numbered: boolean;
  /** A figure's or a table's caption, for a generated list to show beside its number. */
  readonly caption?: string;
}
```

and the two blocks that have one carry it:

```ts
    case 'table':
      // The table takes its number before anything inside it, and its note - rendered below the body -
      // after its cells.
      return [
        { block: block.id, sequence: 'table', numbered: true, caption: block.caption },
        // ...the cells and the note, unchanged
      ];
    case 'figure':
      return [{ block: block.id, sequence: 'figure', numbered: true, caption: block.caption }];
```

- [ ] **Step 4: Run it, and watch it pass**

Same command. Expected: PASS, 2 of 2. Then the whole structure folder, whose other suites build
contributions by hand without a caption and must be unchanged:

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/
```

- [ ] **Step 5: Write the failing tests for the contents and the lists**

Create `packages/domain/src/structure/lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf, type Contribution } from './contributions.js';
import { contents, listOf } from './lists.js';
import { conditions, number, resolve, type NumberableNode } from './numbering.js';
import { defaultNumberingScheme } from './scheme.js';

const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>a</mi></math>';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

const title = (value: string) => [{ type: 'text' as const, value, marks: [] }];

const section = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'section',
  id: id(name),
  numbered: true,
  matter: 'body',
  title: title(name),
  children,
  ...over,
});

const reference = (name: string, over: Partial<NumberableNode> = {}): NumberableNode => ({
  type: 'reference',
  id: id(name),
  numbered: true,
  matter: 'body',
  children: [],
  ...over,
});

const figure = (block: string, caption: string) => ({
  type: 'figure',
  id: block,
  asset: 'asset',
  imageStyle: 'wide',
  caption,
  alternative: { kind: 'decorative' },
});

/** What a component holding these blocks contributes, through the content model's own parse. */
const holding = (...content: unknown[]) =>
  contributionsOf(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content,
    }),
  );

/** The pipeline in its order, and the stage and table both lists read. */
const pipeline = (nodes: NumberableNode[], known: Record<string, readonly Contribution[]> = {}) => {
  const conditioned = conditions(
    resolve({ nodes }, new Map(Object.entries(known).map(([name, list]) => [id(name), list]))),
  );
  return { conditioned, numbering: number(conditioned, defaultNumberingScheme) };
};

describe('a table of contents', () => {
  const outline = [
    section('preface', [], { numbered: false }),
    section('method', [
      section('scope', [section('sample', [section('deeper')])]),
      reference('printer'),
    ]),
    section('glossary', [section('terms')], { matter: 'appendix' }),
  ];

  it('STR-040 is generated to a declared depth, each entry naming its node, number, title and depth', () => {
    const { conditioned, numbering } = pipeline(outline);
    expect(contents(conditioned, numbering, 1)).toEqual([
      {
        node: id('preface'),
        type: 'section',
        depth: 1,
        matter: 'body',
        number: null,
        title: title('preface'),
      },
      {
        node: id('method'),
        type: 'section',
        depth: 1,
        matter: 'body',
        number: '1',
        title: title('method'),
      },
      {
        node: id('glossary'),
        type: 'section',
        depth: 1,
        matter: 'appendix',
        number: 'A',
        title: title('glossary'),
      },
    ]);
    const two = contents(conditioned, numbering, 2);
    expect(two.map((entry) => [entry.node, entry.depth, entry.number])).toEqual([
      [id('preface'), 1, null],
      [id('method'), 1, '1'],
      [id('scope'), 2, '1.1'],
      [id('printer'), 2, '1.2'],
      [id('glossary'), 1, 'A'],
      [id('terms'), 2, 'A.1'],
    ]);
    // A reference's heading is its component's title, which the domain does not read.
    expect(two.find((entry) => entry.node === id('printer'))).toMatchObject({
      type: 'reference',
      title: null,
    });
    expect(contents(conditioned, numbering, 9)).toHaveLength(8);
  });

  it('refuses a depth that is not a whole number of at least one', () => {
    const { conditioned, numbering } = pipeline(outline);
    expect(() => contents(conditioned, numbering, 0)).toThrow(RangeError);
    expect(() => contents(conditioned, numbering, 1.5)).toThrow(RangeError);
  });

  it('is empty for an outline of no nodes', () => {
    const { conditioned, numbering } = pipeline([]);
    expect(contents(conditioned, numbering, 3)).toEqual([]);
  });
});

describe('a list of figures, of tables or of equations', () => {
  const printer = holding(
    figure('f1', 'The tray'),
    {
      type: 'table',
      id: 't1',
      caption: 'Parts',
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [{ type: 'paragraph', id: 'c1', content: [] }] }] }],
    },
    { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
    { type: 'equation', id: 'e2', mathml: MATHML, numbered: false },
    figure('f2', ''),
  );

  it('STR-041 generates a list of figures, a list of tables and a list of equations', () => {
    const { conditioned, numbering } = pipeline(
      [section('one', [reference('first')]), section('two', [reference('again')])],
      { first: printer, again: printer },
    );
    expect(listOf(conditioned, numbering, 'figure')).toEqual([
      { node: id('first'), block: 'f1', number: '1.1', label: 'Figure 1.1', caption: 'The tray' },
      { node: id('first'), block: 'f2', number: '1.2', label: 'Figure 1.2', caption: '' },
      { node: id('again'), block: 'f1', number: '2.1', label: 'Figure 2.1', caption: 'The tray' },
      { node: id('again'), block: 'f2', number: '2.2', label: 'Figure 2.2', caption: '' },
    ]);
    expect(listOf(conditioned, numbering, 'table')).toEqual([
      { node: id('first'), block: 't1', number: '1.1', label: 'Table 1.1', caption: 'Parts' },
      { node: id('again'), block: 't1', number: '2.1', label: 'Table 2.1', caption: 'Parts' },
    ]);
    // An unnumbered equation is not in the list: it takes no number, so it is no entry.
    expect(listOf(conditioned, numbering, 'equation')).toEqual([
      { node: id('first'), block: 'e1', number: '1', label: 'Equation 1', caption: null },
      { node: id('again'), block: 'e1', number: '2', label: 'Equation 2', caption: null },
    ]);
    // Sections are not a list of anything a component holds.
    expect(listOf(conditioned, numbering, 'section')).toEqual([]);
  });

  it('lists what an occurrence nobody here can read would have moved without a number, and nothing it holds', () => {
    const { conditioned, numbering } = pipeline(
      [section('one', [reference('first'), reference('unknown'), reference('again')])],
      { first: printer, again: printer },
    );
    expect(
      listOf(conditioned, numbering, 'figure').map((entry) => [
        entry.node,
        entry.label,
        entry.caption,
      ]),
    ).toEqual([
      [id('first'), 'Figure 1.1', 'The tray'],
      [id('first'), 'Figure 1.2', ''],
      [id('again'), null, 'The tray'],
      [id('again'), null, ''],
    ]);
  });
});
```

- [ ] **Step 6: Run them, and watch them fail**

```bash
pnpm --filter @alloy-works/domain exec vitest run src/structure/lists.test.ts
```

Expected: FAIL, `Cannot find module './lists.js'`.

- [ ] **Step 7: Write the contents and the lists**

Create `packages/domain/src/structure/lists.ts`:

```ts
import type { InlineNode } from '../content/model/inline.js';

import type { Conditioned, NumberableNode, NumberingTable } from './numbering.js';

/**
 * One line of a table of contents (STR-040): a node, how deep it is, and its section number where it
 * has one. **Every node to the depth is a line**, numbered or not - a preface is in the contents with
 * no number, as it is in the outline - so the contents is walked from the outline and numbered from
 * the table, rather than read from the table's section entries, which hold only numbered nodes.
 */
export interface ContentsEntry {
  readonly node: string;
  readonly type: 'section' | 'reference';
  /** 1 for a top-level node. */
  readonly depth: number;
  readonly matter: 'body' | 'appendix';
  /** `null` for a node that takes no section number: unnumbered, or beneath one that is. */
  readonly number: string | null;
  /** A section's title; `null` for a reference, whose heading is its component's title. */
  readonly title: readonly InlineNode[] | null;
}

/** One line of a list of figures, of tables or of equations (STR-041). */
export interface ListEntry {
  readonly node: string;
  readonly block: string;
  /** `null` where the number is not known to whoever is listing (IAM-073), as the table says. */
  readonly number: string | null;
  readonly label: string | null;
  /** The caption the component holds, for a figure or a table; `null` for anything else. */
  readonly caption: string | null;
}

/**
 * A table of contents to a declared depth (STR-040): every node at that depth or above, in document
 * order, with the section number `number` gave it. **PUB** renders it, and PUB-037 declares the depth;
 * the structure comes from here. It reads the stage `number` read and the table it made, so it lists
 * what survives conditions (STR-042) once conditions exist.
 */
export function contents(
  conditioned: Conditioned,
  numbering: NumberingTable,
  depth: number,
): ContentsEntry[] {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`A table of contents is to a depth of at least 1, not ${depth}`);
  }
  const numbers = new Map(
    numbering.entries.flatMap((entry) =>
      entry.sequence === 'section' ? [[entry.node, entry.number] as const] : [],
    ),
  );
  const entries: ContentsEntry[] = [];
  const visit = (node: NumberableNode, at: number, matter: 'body' | 'appendix') => {
    if (at > depth) return;
    entries.push({
      node: node.id,
      type: node.type,
      depth: at,
      matter,
      number: numbers.get(node.id) ?? null,
      title: node.type === 'section' ? (node.title ?? []) : null,
    });
    for (const child of node.children) visit(child, at + 1, matter);
  };
  for (const node of conditioned.resolved.outline.nodes) visit(node, 1, node.matter);
  return entries;
}

/**
 * One sequence's entries, in document order, each with the caption its component holds (STR-041).
 * Figures, tables and equations are three calls; a sequence a layout adds is a fourth, with no new
 * function. An entry is a numbering table entry, so an unnumbered equation - which takes no number and
 * is no entry - is not listed, and a number the table withholds is withheld here too (IAM-073). A
 * caption is looked up by occurrence and block, because one component placed twice is listed twice.
 */
export function listOf(
  conditioned: Conditioned,
  numbering: NumberingTable,
  sequence: string,
): ListEntry[] {
  const captions = new Map<string, Map<string, string>>();
  for (const [node, list] of conditioned.resolved.contributions) {
    const held = new Map<string, string>();
    for (const each of list) if (each.caption !== undefined) held.set(each.block, each.caption);
    captions.set(node, held);
  }
  return numbering.entries.flatMap((entry) =>
    entry.sequence === sequence && entry.block !== null
      ? [
          {
            node: entry.node,
            block: entry.block,
            number: entry.number,
            label: entry.label,
            caption: captions.get(entry.node)?.get(entry.block) ?? null,
          },
        ]
      : [],
  );
}
```

- [ ] **Step 8: Run them, and watch them pass**

Same command. Expected: PASS, 5 of 5.

- [ ] **Step 9: Promote them, test first**

In `packages/domain/src/index.test.ts`, after `'sectionNumbers',` in the surface list:

```ts
        // Generated lists, promoted in the plan that builds them
        // (docs/plans/2026-09-18-structure-03-navigation.md).
        'contents',
        'listOf',
```

Run `pnpm --filter @alloy-works/domain exec vitest run src/index.test.ts`. Expected: FAIL, the
surface lacking `contents` and `listOf`. Then at the end of `packages/domain/src/structure/index.ts`:

```ts
export { contents, listOf } from './lists.js';
export type { ContentsEntry, ListEntry } from './lists.js';
```

Run the whole package, typecheck and build:

```bash
pnpm --filter @alloy-works/domain test
pnpm --filter @alloy-works/domain typecheck
pnpm --filter @alloy-works/domain build
```

Expected: 551 passing, no type error.

- [ ] **Step 10: Move the citation pin, regenerate, commit**

In `packages/trace/src/trace.test.ts`, the citations pin becomes `175`, with a comment above the last
one: `// 175, from 173: the navigation plan (docs/plans/2026-09-18-structure-03-navigation.md) cites
STR-040 and STR-041 in packages/domain/src/structure/lists.test.ts: a contents generated to a declared
depth, and a list of figures, of tables and of equations.`

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm --filter @alloy-works/trace test
pnpm exec prettier --write packages/domain/src/structure packages/domain/src/index.test.ts packages/trace/src
git add packages/domain/src/structure/contributions.ts packages/domain/src/structure/contributions.test.ts \
  packages/domain/src/structure/lists.ts packages/domain/src/structure/lists.test.ts \
  packages/domain/src/structure/index.ts packages/domain/src/index.test.ts \
  packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "A contents to a depth and the lists of figures, tables and equations, with captions"
```

Expected: `No problems in the corpus.`; STR-040 and STR-041 `Covered`.

---

## Task 2: What each occurrence contributes, through the service

**Files:**

- Modify: `packages/api-contract/src/documents.ts`, `packages/api-contract/openapi.json`
- Modify: `packages/api-client/src/generated/schema.ts` (regenerated)
- Modify: `apps/service/src/documents.ts`
- Create: `apps/service/src/contributions-routes.test.ts`
- Modify: `apps/service/src/cross-tenant.test.ts`, `apps/service/src/access-routes.test.ts`
- Modify: `packages/trace/trace.json`

**Interfaces:**

- Consumes: task 1's `Contribution` with its caption; structure 2's `numberingInputs`,
  `readDocument`, `readOutline`, `versionView`, `notFound`
- Produces: `ContributionsView` and the route `getContributions`, `GET
/v1/documents/{id}/contributions`, `read` on the artifact, answering `200 ContributionsView`
  (`document`, `version: { id, number }`, `occurrences: { node, version | null }[]`, `versions: { id,
contributions: { block, sequence, numbered, caption | null }[] }[]`), `401`, `404`

- [ ] **Step 1: Write the failing tests**

Create `apps/service/src/contributions-routes.test.ts`. The harness - imports, `HOST`, `UNKNOWN`,
`Json`, `DocumentBody`, `text`, `call`, `create`, `beforeAll` making Grace, Ada and Alice, the space
_Quality_ and the grants, and `afterAll` - is `numbering-routes.test.ts`'s, word for word, less the
`Entry`, `Numbering`, `MATHML`, `table`, `equation`, `footnoted` and `revise` it does not use; what
differs:

```ts
interface Contributions {
  document: string;
  version: { id: string; number: string };
  occurrences: { node: string; version: string | null }[];
  versions: {
    id: string;
    contributions: { block: string; sequence: string; numbered: boolean; caption: string | null }[];
  }[];
}

const figure = (id: string, caption: string) => ({
  type: 'figure',
  id,
  asset: 'asset',
  imageStyle: 'wide',
  caption,
  alternative: { kind: 'decorative' },
});

describe('what each occurrence contributes, through the service', () => {
  // ...the harness, as above, with this in place of `componentWith`:

  /** A component at 0.2 holding these blocks, made through the store: the editor writes none yet. */
  const componentWith = (space: string, title: string, blocks: unknown[]) =>
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
        substance: { ...substance, content: { ...substance.content, content: blocks } as never },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { id: made.version.artifactId, version: recorded.version.id };
    });

  it('answers each occurrence its version and what it contributes, captions included, and nothing of a component the caller may not read', async () => {
    const shared = await componentWith(general, 'Install the printer', [
      figure('f1', 'The paper tray'),
    ]);
    const secret = await componentWith(quality, 'Calibration', [figure('s1', 'The secret bench')]);
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
    const route = `/v1/documents/${doc.id}/contributions`;
    const tray = { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' };

    const forGrace = await call('grace', 'GET', route);
    expect(forGrace.statusCode, forGrace.body).toBe(200);
    // One component placed twice is two occurrences naming one version, whose contributions are
    // answered once.
    expect(forGrace.json<Contributions>()).toEqual({
      document: doc.id,
      version: { id: doc.version.id, number: '0.5' },
      occurrences: [
        { node: first, version: shared.version },
        { node: hidden, version: secret.version },
        { node: again, version: shared.version },
      ],
      versions: [
        { id: shared.version, contributions: [tray] },
        {
          id: secret.version,
          contributions: [
            { block: 's1', sequence: 'figure', numbered: true, caption: 'The secret bench' },
          ],
        },
      ],
    });

    for (const reader of ['alice', 'ada']) {
      const answer = await call(reader, 'GET', route);
      expect(answer.statusCode, answer.body).toBe(200);
      expect(answer.json<Contributions>()).toMatchObject({
        occurrences: [
          { node: first, version: shared.version },
          { node: hidden, version: null },
          { node: again, version: shared.version },
        ],
        versions: [{ id: shared.version, contributions: [tray] }],
      });
      expect(answer.body).not.toContain('The secret bench');
      expect(answer.body).not.toContain('"s1"');
      expect(answer.body).not.toContain(secret.version);
      expect(answer.body).not.toContain(secret.id);
    }
  });

  it('answers an empty outline with no occurrences, and 404 for what is not a readable document', async () => {
    const doc = await create('Empty');
    const empty = await call('alice', 'GET', `/v1/documents/${doc.id}/contributions`);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json<Contributions>().occurrences).toEqual([]);
    expect((await call('grace', 'GET', `/v1/documents/${UNKNOWN}/contributions`)).statusCode).toBe(
      404,
    );
    const component = await componentWith(general, 'Not a document', [figure('x1', 'A tray')]);
    expect(
      (await call('grace', 'GET', `/v1/documents/${component.id}/contributions`)).statusCode,
    ).toBe(404);
    expect((await call(undefined, 'GET', `/v1/documents/${doc.id}/contributions`)).statusCode).toBe(
      401,
    );
  });
});
```

A component needs at least one block (CNT-124), which is why the one standing in for "not a document"
holds a figure.

- [ ] **Step 2: Run them, and watch them fail**

```bash
pnpm --filter @alloy-works/domain build
pnpm --filter @alloy-works/service exec vitest run src/contributions-routes.test.ts
```

Expected: FAIL, both answered `404` - `{"code":"not_found","message":"There is nothing at this
address."...}: expected 404 to be 200`.

- [ ] **Step 3: Declare the route**

In `packages/api-contract/src/documents.ts`, after `NumberingView`:

```ts
/**
 * What each occurrence of the latest version contributes to the sequences (structure.md,
 * "Numbering"), as the caller is shown it: enough for the renderer to number every caption itself,
 * with the same function the numbering route calls, and to list each with its caption.
 */
export const ContributionsView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  occurrences: z
    .array(z.object({ node: z.string(), version: z.string().nullable() }))
    .describe(
      'Each component reference, in outline order, and the component version it resolved to: null ' +
        'where the caller may not read the component, where it waits on revisions, or where its ' +
        'content does not read, and what it contributes is then not known',
    ),
  versions: z
    .array(
      z.object({
        id: z.string(),
        contributions: z.array(
          z.object({
            block: z.string(),
            sequence: z.string(),
            numbered: z.boolean(),
            caption: z
              .string()
              .nullable()
              .describe("A figure's or a table's caption; null for anything else"),
          }),
        ),
      }),
    )
    .describe(
      'What each version an occurrence resolved to contributes, in document order, each once however ' +
        'many occurrences name it',
    ),
});
export type ContributionsView = z.infer<typeof ContributionsView>;
```

and in `documentRoutes`, before `editOutline`:

```ts
  getContributions: {
    operationId: 'getContributions',
    method: 'GET',
    path: '/v1/documents/{id}/contributions',
    summary: 'What each occurrence of the latest version contributes, as the caller is shown it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'Each occurrence and its contributions', schema: ContributionsView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may number',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
```

- [ ] **Step 4: Answer it**

In `apps/service/src/documents.ts`, `type Contribution` joins the domain import, and before
`getNumbering`:

```ts
    /**
     * What each occurrence of the latest version contributes, as this caller is shown it: the same
     * `numberingInputs` the numbering route reads, so a component they may not read is never read and
     * its occurrence answers `null` twice - no version, and no contributions. The renderer numbers
     * with these and the same `number`, so its numbers are the numbering route's.
     */
    getContributions: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const read = readOutline(document.version.content, {
        artifact: id,
        version: document.version.id,
      });
      if (!read.ok) {
        throw new Error(
          `The document ${id} at ${document.version.id} does not read: ${read.failure}`,
        );
      }
      const inputs = await numberingInputs(trx, read.outline, principalId);
      // Each version once, however many occurrences resolved to it: a known occurrence's version and
      // its contributions are both there, and an unknown one's version is null.
      const versions = new Map<string, readonly Contribution[]>();
      for (const occurrence of inputs.occurrences) {
        const known = inputs.contributions.get(occurrence.node);
        if (occurrence.version !== null && known !== undefined) {
          versions.set(occurrence.version, known);
        }
      }
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        occurrences: inputs.occurrences.map((occurrence) => ({ ...occurrence })),
        versions: [...versions].map(([version, contributions]) => ({
          id: version,
          contributions: contributions.map((each) => ({
            block: each.block,
            sequence: each.sequence,
            numbered: each.numbered,
            caption: each.caption ?? null,
          })),
        })),
      };
    },
```

- [ ] **Step 5: Run them, and watch them pass; then the two route-wide tests fail**

```bash
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/service exec vitest run src/contributions-routes.test.ts src/cross-tenant.test.ts src/access-routes.test.ts
```

Expected: the new file passes 2 of 2; `cross-tenant.test.ts` fails with `OTHER_TENANT_IDS[route.
operationId] is not a function` and `access-routes.test.ts` with `getContributions has no address in
HOLDING_NOTHING`. Give each its entry, beside `getNumbering`'s:

```ts
// apps/service/src/cross-tenant.test.ts
  getContributions: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
```

```ts
// apps/service/src/access-routes.test.ts
    getContributions: () => ({ url: `/v1/documents/${report}/contributions`, status: 404 }),
```

Run the same command. Expected: PASS, 75 of 75.

- [ ] **Step 6: Regenerate the document and the client, run the suites, commit**

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/api-client test
pnpm --filter @alloy-works/api-client build
pnpm --filter @alloy-works/service test
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm exec prettier --write packages/api-contract/src apps/service/src
git add packages/api-contract/src/documents.ts packages/api-contract/openapi.json \
  packages/api-client/src/generated/schema.ts apps/service/src/documents.ts \
  apps/service/src/contributions-routes.test.ts apps/service/src/cross-tenant.test.ts \
  apps/service/src/access-routes.test.ts packages/trace/trace.json
git commit -m "Answer what each occurrence contributes, each version once, withholding the unreadable"
```

Expected: the contract 25 of 25 once regenerated, the client 4 of 4, the service 251 of 251. No
citation moves.

---

## Task 3: STR-063, and the budget measured at five hundred nodes

**Files:**

- Modify: `docs/specification/requirements/STR-structure-numbering-and-cross-references.md`
- Modify: `docs/specification/requirements/README.md`, `docs/guides/reading-the-trace.md`, `CLAUDE.md`
- Modify: `docs/design/structure.md`
- Create: `apps/service/src/navigation-budget.test.ts`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`,
  `packages/trace/src/parse/requirements.test.ts`

**Interfaces:**

- Consumes: task 2's route; structure 1's `createDocument` and `recordVersion` over a document
  substance; `blockIdentifierFrom`
- Produces: STR-063 in the corpus, claimed by structure.md and cited by the measurement

- [ ] **Step 1: Draft the row, and narrow it**

```bash
pnpm trace draft 119
```

It prints STR-063 with the issue's wording. **Do not paste that wording** (decision K); paste this row
into section 7, "Navigation on screen", after STR-039:

```markdown
| **STR-063** | A document of five hundred outline nodes, four hundred of them component references, must be opened, numbered and restructured by the service within the interactive budget - at or under 250 ms at p95, and no measured sample above 500 ms - measured by the test suite, which records the configuration it ran on beside the result | T1 | Specified |
```

and at the end of the document's change history, a section in the shape "From planning the document
and its outline" has:

```markdown
### From planning navigation

Not a review. [Issue #119](https://github.com/kenhayward/alloy-works/issues/119), filed while designing
documents and outlines, was landed by
[the third structure plan](../../plans/2026-09-18-structure-03-navigation.md), narrowed.

| What was found                                                                                                                                            | Change                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR-039 cites "the budget in scope Â§11", which names opening a 300-page document as a quantity and gives no number, so nothing could ever demonstrate it | **STR-063**: the service's share, at a stated size - five hundred nodes, four hundred of them references - opened, numbered and restructured at or under 250 ms at p95, with no measured sample above 500 ms, measured by the suite and recorded beside its configuration        |
| The issue asked that opening and _navigating_ never exceed 500 ms                                                                                         | Narrowed: _navigating_ named no act, so the row names three; _never_ is no measurement's to prove, so the row says no measured sample; and the interface's share has no browser suite to measure it, so it is left to a row filed with that suite. STR-039 stays open until then |

| Counts           | Before                    | After                     |
| ---------------- | ------------------------- | ------------------------- |
| Requirements     | 62, of which 3 superseded | 63, of which 3 superseded |
| Non-requirements | 5                         | 5                         |
| Open questions   | 4                         | 4                         |
```

(Read the "Before" counts off the section above it; if another row landed first, carry its "After".)

- [ ] **Step 2: Move every count of the corpus**

`docs/specification/requirements/README.md`, `docs/guides/reading-the-trace.md` (three places) and
`CLAUDE.md` say 1,368; each becomes 1,369. In `packages/trace/src/parse/requirements.test.ts` the
total becomes `1369`, with `// 1369, from 1368: STR-063, the service's share of STR-039's budget
(issue #119), narrowed.` above the last comment; in `packages/trace/src/trace.test.ts`,
`model.requirements` becomes `1369` with the same line, and the claims pin `361`, with `// 361, from
360: structure.md claims STR-063, which the navigation plan measures in the service suite.`

- [ ] **Step 3: Claim it**

In `docs/design/structure.md`'s `## Requirements owned`, after STR-037's row:

```markdown
| **STR-063** | The document route, the contributions route, the numbering route and an outline act are each measured in the service suite over a document of 500 nodes and 400 occurrences, against p95 250 ms and a maximum of 500 ms, with the configuration recorded beside the result |
```

and STR-039's row in "What this document does not own" becomes:

```markdown
| STR-039 | **The interface's share has no number and no suite.** STR-063 gives the service's share a number and is claimed; the time the page takes to show an answer needs a browser to measure, and a row for it is recommended beside the browser suite ([the navigation plan](../plans/2026-09-18-structure-03-navigation.md)) |
```

The recommendation "A budget for navigation" in "What this design needs from the content model, and
from the corpus" gains, at its end: "Landed as STR-063 (issue #119), narrowed to the service's share."

- [ ] **Step 4: Write the measurement, and watch it fail**

Create `apps/service/src/navigation-budget.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { arch, cpus, platform } from 'node:os';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createDocument,
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
import { blockIdentifierFrom, type OutlineDocument, type OutlineNode } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>a</mi></math>';

/** The reference configuration: the document STR-063 states its budget against. */
const CHAPTERS = 20;
const SECTIONS_PER_CHAPTER = 4;
const REFERENCES_PER_SECTION = 5;
const COMPONENTS = 150;
const BLOCKS_PER_COMPONENT = 40;
const WARM_UP = 5;
const SAMPLES = 40;
const BUDGET = { p95: 250, max: 500 };

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const summary = (samples: readonly number[]) => ({
  n: samples.length,
  p50: Number(percentile(samples, 50).toFixed(1)),
  p95: Number(percentile(samples, 95).toFixed(1)),
  max: Number(Math.max(...samples).toFixed(1)),
});

const newId = () => blockIdentifierFrom(randomBytes(16));
const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];

/** One block of a component, a tenth each figures, tables, equations and footnotes, the rest prose. */
const block = (component: number, index: number) => {
  const id = `b${component}x${index}`;
  const words = `Step ${index} of procedure ${component}: `.padEnd(220, 'lorem ipsum ');
  switch (index % 10) {
    case 0:
      return {
        type: 'figure',
        id,
        asset: 'asset',
        imageStyle: 'wide',
        caption: `Figure caption ${index}`,
        alternative: { kind: 'decorative' },
      };
    case 3:
      return {
        type: 'table',
        id,
        caption: `Table caption ${index}`,
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [{ type: 'paragraph', id: `${id}c`, content: text('A') }] }] }],
      };
    case 5:
      return { type: 'equation', id, mathml: MATHML, numbered: true };
    case 7:
      return {
        type: 'paragraph',
        id,
        content: [
          { type: 'text', value: words },
          {
            type: 'footnote',
            id: `${id}n`,
            anchor: { kind: 'span' },
            content: [{ type: 'paragraph', id: `${id}p`, content: text('A note') }],
          },
        ],
      };
    default:
      return { type: 'paragraph', id, content: [{ type: 'text', value: words }] };
  }
};

describe('STR-063 opens, numbers and restructures a document of five hundred nodes within the interactive budget', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie: string;
  let document: string;
  let version: string;
  let chapters: string[];
  // The configuration the budget was measured on, recorded beside the result (STR-063).
  const report: Record<string, unknown> = {
    configuration: {
      platform: `${platform()} ${arch()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpus: cpus().length,
      node: process.version,
    },
  };

  const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { host: HOST, cookie }, ...(payload ? { payload } : {}) });

  const timed = async <Answer extends { statusCode: number; body: string }>(
    work: () => Promise<Answer>,
  ) => {
    const started = performance.now();
    const answer = await work();
    const elapsed = performance.now() - started;
    expect(answer.statusCode, answer.body.slice(0, 200)).toBe(200);
    return { elapsed, answer };
  };

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
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const grace = (await call('GET', '/v1/me')).json<{ id: string }>().id;

    // Seeded through the store, not through five hundred acts: what is measured is reading and acting
    // on a document this size, not building one.
    await tenantDb.withTenant(tenant, async (trx) => {
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: grace,
      });
      const components: string[] = [];
      for (let index = 0; index < COMPONENTS; index += 1) {
        const made = await createComponent(trx, {
          spaceId: general,
          title: `Procedure ${index}`,
          language: 'en-GB',
          direction: 'ltr',
          author: grace,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const content = Array.from({ length: BLOCKS_PER_COMPONENT }, (_, at) => block(index, at));
        const recorded = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: grace,
          substance: { ...substance, content: { ...substance.content, content } as never },
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        components.push(made.version.artifactId);
      }
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const switches = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;
      let placed = 0;
      const nodes: OutlineNode[] = Array.from({ length: CHAPTERS }, (_, chapter) => ({
        type: 'section',
        id: newId(),
        title: text(`Chapter ${chapter + 1}`),
        ...switches,
        children: Array.from({ length: SECTIONS_PER_CHAPTER }, (_, section) => ({
          type: 'section',
          id: newId(),
          title: text(`Section ${chapter + 1}.${section + 1}`),
          ...switches,
          children: Array.from({ length: REFERENCES_PER_SECTION }, () => ({
            type: 'reference',
            id: newId(),
            component: components[(placed++ * 7) % COMPONENTS]!,
            mode: { kind: 'latest' },
            ...switches,
            children: [],
          })),
        })),
      }));
      const outline: OutlineDocument = {
        schemaVersion: 1,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes,
      };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      document = made.version.artifactId;
      version = recorded.version.id;
      chapters = nodes.map((node) => node.id);
    });
  }, 300_000);

  afterAll(async () => {
    console.info(`Navigation budget report\n${JSON.stringify(report, null, 2)}`);
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  /** Warm-up calls first, then the samples; the p95 and the largest held to the budget. */
  const measure = async (name: string, work: () => Promise<{ elapsed: number }>) => {
    for (let index = 0; index < WARM_UP; index += 1) await work();
    const samples: number[] = [];
    for (let index = 0; index < SAMPLES; index += 1) samples.push((await work()).elapsed);
    report[name] = summary(samples);
    expect(percentile(samples, 95), name).toBeLessThanOrEqual(BUDGET.p95);
    expect(Math.max(...samples), name).toBeLessThanOrEqual(BUDGET.max);
  };

  it('opens the document within the budget', async () => {
    const opened = (await call('GET', `/v1/documents/${document}`)).json<{
      outline: { nodes: unknown[] };
    }>();
    const count = (list: { children?: unknown[] }[]): number =>
      list.reduce((total, node) => total + 1 + count((node.children ?? []) as never), 0);
    report.nodes = count(opened.outline.nodes as never);
    expect(report.nodes).toBe(500);
    report.bytes = (await call('GET', `/v1/documents/${document}`)).body.length;
    await measure('document', () => timed(() => call('GET', `/v1/documents/${document}`)));
  });

  it('answers what every occurrence contributes within the budget', async () => {
    report.contributionsBytes = (
      await call('GET', `/v1/documents/${document}/contributions`)
    ).body.length;
    await measure('contributions', () =>
      timed(() => call('GET', `/v1/documents/${document}/contributions`)),
    );
  });

  it('numbers the document within the budget', async () => {
    await measure('numbering', () =>
      timed(() => call('GET', `/v1/documents/${document}/numbering`)),
    );
  });

  it('answers a move within the budget', async () => {
    let down = true;
    await measure('move', async () => {
      const result = await timed(() =>
        call('POST', `/v1/documents/${document}/outline`, {
          openedFrom: version,
          operation: {
            operation: 'move',
            node: chapters[0]!,
            parent: null,
            position: down ? 1 : 0,
          },
        }),
      );
      version = result.answer.json<{ version: { id: string } }>().version.id;
      down = !down;
      return result;
    });
  });
});
```

Watch it fail against a budget it cannot meet, so the assertion is known to bite: set `BUDGET` to `{
p95: 1, max: 1 }` and run

```bash
pnpm --filter @alloy-works/service exec vitest run src/navigation-budget.test.ts
```

Expected: FAIL four times, `document: expected 17.4 to be less than or equal to 1` and its three
neighbours. Put `BUDGET` back to `{ p95: 250, max: 500 }`. (The routes it measures were built by
tasks 1 and 2 and structures 1 and 2, so there is no production code for this test to precede; what
it must be seen to do is fail.)

- [ ] **Step 5: Run it, and watch it pass**

Same command. Expected: PASS, 4 of 4, in about eight seconds, printing the report - on the machine
this plan was proved on, p95 17.4, 38.5, 44.9 and 31.8 ms. **If CI's runner fails it**, it is a
failing gate, not a flake to rerun: open an issue with the report, and quarantine it in its own pull
request as CLAUDE.md requires. Never widen `BUDGET`; the budget is the row's.

- [ ] **Step 6: Regenerate, check and commit**

In `packages/trace/src/trace.test.ts` the citations pin becomes `176`: `// 176, from 175: the same plan
cites STR-063, landed by it, in apps/service/src/navigation-budget.test.ts, which measures the
service's routes over a document of five hundred nodes.`

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show STR-063
pnpm --filter @alloy-works/trace test
pnpm exec prettier --write docs/specification docs/design/structure.md docs/guides apps/service/src packages/trace/src CLAUDE.md
git add docs/specification/requirements/STR-structure-numbering-and-cross-references.md \
  docs/specification/requirements/README.md docs/guides/reading-the-trace.md CLAUDE.md \
  docs/design/structure.md apps/service/src/navigation-budget.test.ts packages/trace/trace.json \
  packages/trace/src/trace.test.ts packages/trace/src/parse/requirements.test.ts
git commit -m "STR-063: the service's share of the navigation budget, measured at five hundred nodes"
```

Expected: `No problems in the corpus.`; STR-063 `Covered`, claimed by structure.md and tested in
`navigation-budget.test.ts`; requirements 1369, claims 361, citations 176.

---

## Task 4: The address of every node

**Files:**

- Create: `apps/web/src/structure/links.ts`, `links.test.ts`
- Modify: `apps/web/src/editor/Workspace.tsx`, `Workspace.test.tsx`
- Modify: `apps/web/src/structure/OutlinePanel.tsx`, `DocumentPage.tsx`, `DocumentPage.test.tsx`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

**Interfaces:**

- Consumes: the existing `Workspace` hash routing, `OutlinePanel`, `DocumentPage`, `placeOf`,
  `nodeName`
- Produces: `documentAddress(hash): DocumentAddress | null`, `documentLink(document)`,
  `nodeLink(document, node)`; `DocumentPage`'s `linked?: { node: string; arrival: number } | null`;
  `OutlinePanel`'s `linked`, `linkOf?: (node: string) => string` and `onSelected?: (node: string) =>
void`

- [ ] **Step 1: Write the failing test for the addresses**

Create `apps/web/src/structure/links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { documentAddress, documentLink, nodeLink } from './links.js';

const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
const NODE = 'iiiiiiiiiiiiiiiiiiiiiiiiii';

describe('the addresses of a document and its nodes', () => {
  it('reads the list, a document and a node of a document, and nothing else', () => {
    expect(documentAddress('#/documents')).toEqual({ kind: 'documents' });
    expect(documentAddress(`#/documents/${DOCUMENT}`)).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: null,
    });
    expect(documentAddress(`#/documents/${DOCUMENT}/nodes/${NODE}`)).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: NODE,
    });
    for (const other of [
      '',
      '#/',
      `#/components/${DOCUMENT}`,
      `#/documents/${DOCUMENT}/nodes/`,
      `#/documents/${DOCUMENT}/nodes/${NODE.toUpperCase()}`,
      `#/documents/${DOCUMENT}/nodes/${NODE}/more`,
      `#/documents/${DOCUMENT}/nodes/${NODE.slice(1)}`,
    ]) {
      expect(documentAddress(other), other).toBeNull();
    }
  });

  it('writes an address that reads back as what it names', () => {
    expect(documentAddress(documentLink(DOCUMENT))).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: null,
    });
    expect(documentAddress(nodeLink(DOCUMENT, NODE))).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: NODE,
    });
  });
});
```

Run `pnpm --filter @alloy-works/web exec vitest run src/structure/links.test.ts`. Expected: FAIL,
`Cannot find module './links.js'`.

- [ ] **Step 2: Write the addresses**

Create `apps/web/src/structure/links.ts`:

```ts
/**
 * The addresses a document and its nodes have (structure.md, "Deep links"), after the `#` - the same
 * hash routing the rest of the workspace uses, so an address never reaches the service or a reload's
 * path, and the renderer's relative asset paths are never put under a deep one.
 *
 * **A node's address names its document and itself, both by identifier, and nothing else** (STR-044,
 * STR-046): no depth, no number and no position, so there is nothing in it a reorder could make wrong,
 * and the document in it is what finds the node without a tenant-wide index of nodes.
 */

const DOCUMENTS = /^#\/documents(?:\/([0-9a-f-]{36})(?:\/nodes\/([a-z2-7]{26}))?)?$/;

/** What a `#/documents...` address names: the list, one document, or one node of one document. */
export type DocumentAddress =
  | { readonly kind: 'documents' }
  | { readonly kind: 'document'; readonly document: string; readonly node: string | null };

export function documentAddress(hash: string): DocumentAddress | null {
  const matched = DOCUMENTS.exec(hash);
  if (!matched) return null;
  const [, document, node] = matched;
  if (document === undefined) return { kind: 'documents' };
  return { kind: 'document', document, node: node ?? null };
}

/** The address of a document itself: its outline's root (STR-054). */
export function documentLink(document: string): string {
  return `#/documents/${document}`;
}

/** The address of one node of one document. */
export function nodeLink(document: string, node: string): string {
  return `#/documents/${document}/nodes/${node}`;
}
```

Run the same command. Expected: PASS, 2 of 2.

- [ ] **Step 3: Write the failing tests for going to a node**

At the end of `apps/web/src/structure/DocumentPage.test.tsx`, a helper that opens the page as the
workspace will, and the tests. `afterEach` joins the `vitest` import.

```tsx
/** The page at an address naming one of its nodes, as `Workspace` opens it. */
function openAt(fetch: typeof globalThis.fetch, node: string, arrival = 0) {
  const page = (at: number) => (
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} linked={{ node, arrival: at }} />
    </StrictMode>
  );
  const rendered = render(page(arrival));
  return { ...rendered, arriveAgain: (at: number) => rendered.rerender(page(at)) };
}

describe('the address of every node', () => {
  // Choosing a node rewrites the address; put it back so no later test starts somewhere else.
  afterEach(() => window.history.replaceState(null, '', '#'));

  it('STR-044 gives every node an address naming its document and itself, which opens the document at that node', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    const first = open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    for (const [id, name] of [
      [INTRODUCTION, 'Introduction'],
      [METHOD, 'Method'],
      [SCOPE, 'Scope'],
    ] as const) {
      await userEvent.click(item(name));
      const field = screen.getByRole('textbox', { name: `Link to ${name}` }) as HTMLInputElement;
      expect(field.value).toBe(
        `${window.location.origin}${window.location.pathname}#/documents/${DOCUMENT}/nodes/${id}`,
      );
      // The address follows what is chosen, so a reload or a copy of it comes back here.
      expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${id}`);
    }
    first.unmount();

    // Somebody else, given the address: the document opens with that node chosen, focused and marked.
    openAt(fake.fetch, SCOPE);
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    expect(item('Scope')).toHaveAttribute('aria-selected', 'true');
    expect(within(item('Scope')).getByText('Scope').closest('mark')).not.toBeNull();
  });

  it('STR-046 keeps a node at its address when the outline is reordered around it', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    const page = openAt(fake.fetch, SCOPE);
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    const before = (screen.getByRole('textbox', { name: 'Link to Scope' }) as HTMLInputElement)
      .value;
    expect(item('Scope')).toHaveAccessibleDescription('2.1');

    // Method, and Scope with it, moves to the front: Scope's number and position both change.
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Scope')).toHaveAccessibleDescription('1.1'));
    await settled();

    // The same address, arriving again, still finds Scope; and Scope's address has not changed.
    page.arriveAgain(1);
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    expect(within(item('Scope')).getByText('Scope').closest('mark')).not.toBeNull();
    expect((screen.getByRole('textbox', { name: 'Link to Scope' }) as HTMLInputElement).value).toBe(
      before,
    );
  });

  it('says so when the address names nothing this document holds, and keeps the first node chosen', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    openAt(fake.fetch, SCOPE);
    expect(await screen.findByText('The linked part is not in this document.')).toBeInTheDocument();
    expect(item('Introduction')).toHaveAttribute('aria-selected', 'true');
  });

  it("copies the chosen node's address, and says it did", async () => {
    const user = userEvent.setup();
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await user.click(await screen.findByRole('treeitem', { name: 'Introduction' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied the link to Introduction.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}${window.location.pathname}#/documents/${DOCUMENT}/nodes/${INTRODUCTION}`,
    );
  });
});
```

and at the end of `apps/web/src/editor/Workspace.test.tsx`'s `describe`, two tests; `waitFor` joins
the Testing Library import, and `import { StrictMode } from 'react';` is added:

```tsx
it('answers a link into a document the caller may not read as nothing there, saying nothing of the node', async () => {
  window.location.hash =
    '#/documents/eeeeeeee-0000-4000-8000-000000000001/nodes/iiiiiiiiiiiiiiiiiiiiiiiiii';
  render(
    <StrictMode>
      <Workspace fetch={serviceThat({})} />
    </StrictMode>,
  );
  expect(
    await screen.findByText('There is nothing here, or nothing you may read.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('The linked part is not in this document.')).toBeNull();
});

it('opens a document at the node its address names, and again when that address arrives again', async () => {
  const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
  const node = (id: string, title: string) => ({
    type: 'section',
    id,
    title: [{ type: 'text', value: title, marks: [] }],
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  });
  const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
  const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') return json(200, me);
    if (url.pathname === '/v1/components') return json(200, { items: [], next: null });
    if (url.pathname === `/v1/documents/${DOCUMENT}`) {
      return json(200, {
        id: DOCUMENT,
        space: { id: 's1', name: 'General' },
        version: {
          id: 'dddddddd-0000-4000-8000-000000000001',
          number: '0.2',
          author: 'p1',
          createdAt: '2026-09-18T09:00:00.000Z',
          note: null,
        },
        outline: {
          schemaVersion: 1,
          title: 'The dosing report',
          language: 'en-GB',
          direction: 'ltr',
          nodes: [node(INTRODUCTION, 'Introduction'), node(METHOD, 'Method')],
        },
        mayEdit: false,
      });
    }
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;

  window.location.hash = `#/documents/${DOCUMENT}/nodes/${METHOD}`;
  render(
    <StrictMode>
      <Workspace fetch={fetching} />
    </StrictMode>,
  );
  const method = await screen.findByRole('treeitem', { name: 'Method' });
  await waitFor(() => expect(method).toHaveFocus());

  // Choosing Introduction rewrites the address without a `hashchange`...
  await userEvent.click(screen.getByRole('treeitem', { name: 'Introduction' }));
  expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${INTRODUCTION}`);
  // ...so a link to Method, followed again, is still news, and takes the reader back to it.
  window.location.hash = `#/documents/${DOCUMENT}/nodes/${METHOD}`;
  fireEvent(window, new HashChangeEvent('hashchange'));
  await waitFor(() =>
    expect(screen.getByRole('treeitem', { name: 'Method' })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  expect(screen.getByRole('treeitem', { name: 'Method' })).toHaveFocus();
});
```

- [ ] **Step 4: Run them, and watch them fail**

```bash
pnpm --filter @alloy-works/web exec vitest run src/structure/DocumentPage.test.tsx -t "address of every node"
pnpm --filter @alloy-works/web exec vitest run src/editor/Workspace.test.tsx
```

Expected: FAIL - `Unable to find an accessible element with the role "textbox" and name "Link to
Introduction"`, the linked tests timing out waiting for focus on **Scope**, **The linked part is not
in this document.** not found, and no **Copy link** button; in the workspace, the node address
answered as no address at all - the component list, not **The dosing report** - so `Method` is never
found. The first workspace test passes already (the document is answered `404`); it stays, to pin
that a node in the address changes nothing about that answer.

- [ ] **Step 5: The route, and arrivals**

In `apps/web/src/editor/Workspace.tsx`: import `documentAddress` from `'../structure/links.js'`, delete
the `DOCUMENTS` regular expression, and replace `useHash`:

```tsx
/**
 * The address after `#`, followed as it changes: a hash never reaches the service or a reload's path.
 * `arrivals` counts every change, so an address that arrives again - a link to the node already named,
 * after the document page rewrote the address to another without a `hashchange` - is still news.
 */
function useHash(): { readonly hash: string; readonly arrivals: number } {
  const [followed, setFollowed] = useState(() => ({ hash: window.location.hash, arrivals: 0 }));
  useEffect(() => {
    const follow = () =>
      setFollowed((previous) => ({
        hash: window.location.hash,
        arrivals: previous.arrivals + 1,
      }));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return followed;
}
```

`const hash = useHash();` becomes `const { hash, arrivals } = useHash();`, and the documents branch:

```tsx
  const documents = documentAddress(hash);
  if (documents?.kind === 'document') {
    return (
      <>
        <p>
          <a href="#/documents">Back to documents</a>
        </p>
        <DocumentPage
          key={documents.document}
          client={client}
          id={documents.document}
          linked={documents.node === null ? null : { node: documents.node, arrival: arrivals }}
        />
      </>
    );
  }
  if (documents) {
```

- [ ] **Step 6: The page passes the link down, and follows what is chosen**

In `apps/web/src/structure/DocumentPage.tsx`, import `nodeLink` from `'./links.js'`; the props gain

```tsx
  /**
   * The node the address names, and which arrival of an address this is: a link followed a second
   * time to the same node is a new arrival, and is taken to it again.
   */
  readonly linked?: { readonly node: string; readonly arrival: number } | null;
```

the signature becomes `DocumentPage({ client, id, linked = null }: DocumentPageProps)`, and the panel
is given three more props:

```tsx
        linked={linked}
        linkOf={(node) =>
          `${window.location.origin}${window.location.pathname}${nodeLink(document.id, node)}`
        }
        onSelected={(node) => {
          // The address follows what is chosen, without a history entry per arrow key and without a
          // `hashchange`, so a reload or a copy of the address comes back to it.
          window.history.replaceState(window.history.state, '', nodeLink(document.id, node));
        }}
```

- [ ] **Step 7: The panel goes to the node, marks it, and shows its link**

In `apps/web/src/structure/OutlinePanel.tsx`, the props gain

```tsx
  /** The node a link names, and which arrival of it this is: each arrival is taken to the node. */
  readonly linked?: { readonly node: string; readonly arrival: number } | null;
  /** A node's shareable address (STR-044), shown for the selected node. */
  readonly linkOf?: (node: string) => string;
  /** Told whenever the author chooses a node, so the page's address can follow. */
  readonly onSelected?: (node: string) => void;
```

destructured as `linked = null, linkOf, onSelected = () => {},`. After `openField`'s declaration:

```tsx
// The node a link took the reader to, marked until they choose another (STR-045's panel half).
const [highlighted, setHighlighted] = useState<string | null>(null);
// The arrival of a link already taken to its node: under `<StrictMode>` the effect below runs twice
// on mount, and a ref survives the simulated unmount between, so one arrival is taken once.
const taken = useRef<number | null>(null);
useEffect(() => {
  if (linked === null || taken.current === linked.arrival) return;
  taken.current = linked.arrival;
  if (placeOf(nodes, linked.node)) {
    setActive(linked.node);
    setHighlighted(linked.node);
    // Focus, which in a browser scrolls the node into view: the reader asked to be taken here.
    setFocusTarget(linked.node);
  } else {
    onNotice('The linked part is not in this document.');
  }
}, [linked, nodes, onNotice]);
```

`choose` clears the mark and says what was chosen:

```tsx
const choose = (id: string, focus: boolean) => {
  setActive(id);
  setHighlighted(null);
  onSelected(id);
  if (focus) items.current.get(id)?.focus();
};
```

and so do the two other places that choose a node: `insert`, after `setActive(added);`, and `remove`,
after `setActive(focus);`, each gain `onSelected(...)` with the same argument. The label is marked:

```tsx
<span id={labelId} data-drop={`into:${node.id}`}>
  {node.id === highlighted ? <mark>{nodeLabel(node, names)}</mark> : nodeLabel(node, names)}
</span>
```

Before `<p role="status">`, for everybody who may read the document:

```tsx
{
  selected && linkOf && confirming === null && (
    <NodeLink address={linkOf(selected.id)} name={nodeName(selected, names)} onNotice={onNotice} />
  );
}
```

and after `OutlinePanel`:

```tsx
/**
 * The selected node's shareable address (STR-044), for everybody who may read the document: in a field
 * that can be selected and copied by hand, and a button that copies it - the one way to share it from
 * the desktop app, which has no address bar.
 */
function NodeLink({
  address,
  name,
  onNotice,
}: {
  address: string;
  name: string;
  onNotice: (message: string | null) => void;
}) {
  return (
    <p>
      <label>
        Link to {name}
        <input readOnly value={address} onFocus={(event) => event.target.select()} />
      </label>{' '}
      <button
        type="button"
        onClick={() => {
          const copying = navigator.clipboard?.writeText(address);
          if (!copying) {
            onNotice('The link could not be copied. Select it and copy it instead.');
            return;
          }
          copying.then(
            () => onNotice(`Copied the link to ${name}.`),
            () => onNotice('The link could not be copied. Select it and copy it instead.'),
          );
        }}
      >
        Copy link
      </button>
    </p>
  );
}
```

The mark and the field change nothing any existing test reads: a tree item's name is its
`aria-labelledby` text, which `<mark>` does not alter, and the field's label is **Link to** a name no
existing query asks for.

- [ ] **Step 8: Run them, and watch them pass; then the whole renderer**

The two commands from step 4, then:

```bash
pnpm --filter @alloy-works/web test
pnpm --filter @alloy-works/web typecheck
```

Expected: every new test passing, and every existing one unchanged.

- [ ] **Step 9: Move the pin, regenerate, commit**

The citations pin becomes `178`: `// 178, from 176: the same plan cites STR-044 and STR-046 in
apps/web/src/structure/DocumentPage.test.tsx: every node's address names its document and itself and
opens the document there, and the same address finds the same node after a reorder.`

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm --filter @alloy-works/trace test
pnpm exec prettier --write apps/web/src packages/trace/src
git add apps/web/src/structure/links.ts apps/web/src/structure/links.test.ts \
  apps/web/src/editor/Workspace.tsx apps/web/src/editor/Workspace.test.tsx \
  apps/web/src/structure/OutlinePanel.tsx apps/web/src/structure/DocumentPage.tsx \
  apps/web/src/structure/DocumentPage.test.tsx packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Every node has an address that opens its document there, marks it and can be copied"
```

---

## Task 5: The lists of figures, tables and equations

**Files:**

- Create: `apps/web/src/structure/GeneratedLists.tsx`
- Modify: `apps/web/src/structure/DocumentPage.tsx`, `DocumentPage.test.tsx`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

**Interfaces:**

- Consumes: task 1's `listOf`; task 2's route through the generated client; task 4's `nodeLink`;
  `conditions`, `resolve`, `number`, `defaultNumberingScheme`, `placeOf`, `nodeName`
- Produces: `GeneratedLists` and its `Known` state

- [ ] **Step 1: Teach the fake service the route**

In `DocumentPage.test.tsx`, `service`'s options gain

```tsx
    /** What each component's head contributes, by component; nothing where it is not named. */
    holds?: Record<
      string,
      { block: string; sequence: string; numbered: boolean; caption: string | null }[]
    >;
```

and its `fetch`, after the document's own path:

```tsx
if (url === `/v1/documents/${DOCUMENT}/contributions`) {
  // As `getContributions` answers: every reference of the latest version, in outline order, and
  // a version the caller may read named once with what it holds - never one they may not.
  const occurrences: { node: string; version: string | null }[] = [];
  const versions = new Map<string, unknown>();
  const walk = (nodes: readonly OutlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'reference') {
        const readable = (options.mayRead ?? (() => true))(node.component);
        const version = readable ? `vvvvvvvv${node.component.slice(8)}` : null;
        occurrences.push({ node: node.id, version });
        if (version !== null) {
          versions.set(version, {
            id: version,
            contributions: options.holds?.[node.component] ?? [],
          });
        }
      }
      walk(node.children);
    }
  };
  walk(latest().outline.nodes);
  return json(200, {
    document: DOCUMENT,
    version: { id: latest().id, number: latest().number },
    occurrences,
    versions: [...versions.values()],
  });
}
```

Nothing asks for it yet, so every existing test still passes: run the file to see.

- [ ] **Step 2: Write the failing tests**

After task 4's tests:

```tsx
const SECRET = 'cccccccc-0000-4000-8000-000000000002';
const AGAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';

/** A reference to a named component, at latest. */
function referenceTo(id: string, component: string): OutlineNode {
  return { ...reference(id, 'latest'), component } as OutlineNode;
}

const tray = { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' };
const parts = { block: 't1', sequence: 'table', numbered: true, caption: 'Parts' };
const sum = { block: 'e1', sequence: 'equation', numbered: true, caption: null };
const aside = { block: 'e2', sequence: 'equation', numbered: false, caption: null };

const listed = (heading: string) =>
  within(screen.getByRole('region', { name: heading }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);

describe('the lists of figures, tables and equations', () => {
  afterEach(() => window.history.replaceState(null, '', '#'));

  it('lists what each occurrence holds, numbered in the page, and renumbers a move without asking for a number', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method', [referenceTo(AGAIN, PRINTER)]),
      ]),
      { holds: { [PRINTER]: [tray, parts, sum, aside] } },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    const at = (node: string) => `#/documents/${DOCUMENT}/nodes/${node}`;
    expect(listed('Figures')).toEqual([
      ['Figure 1.1 The paper tray', at(RESULTS)],
      ['Figure 2.1 The paper tray', at(AGAIN)],
    ]);
    expect(listed('Tables')).toEqual([
      ['Table 1.1 Parts', at(RESULTS)],
      ['Table 2.1 Parts', at(AGAIN)],
    ]);
    // An unnumbered equation takes no number, so it is no entry.
    expect(listed('Equations')).toEqual([
      ['Equation 1', at(RESULTS)],
      ['Equation 2', at(AGAIN)],
    ]);

    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() =>
      expect(listed('Figures')).toEqual([
        ['Figure 1.1 The paper tray', at(AGAIN)],
        ['Figure 2.1 The paper tray', at(RESULTS)],
      ]),
    );
    expect(fake.sent.some((request) => request.url.endsWith('/numbering'))).toBe(false);
  });

  it('IAM-073 shows a reader no number a component they may not read could have moved, and nothing it holds', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [
          referenceTo(RESULTS, PRINTER),
          referenceTo(HIDDEN, SECRET),
          referenceTo(AGAIN, PRINTER),
        ]),
        section(METHOD, 'Method', [referenceTo(SCOPE, PRINTER)]),
      ]),
      {
        mayRead: (component) => component !== SECRET,
        holds: {
          [PRINTER]: [tray],
          [SECRET]: [{ block: 's1', sequence: 'figure', numbered: true, caption: 'The bench' }],
        },
      },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    // The figure after the component they may not read has no number, and the next chapter's, which
    // restarts, has its own; nothing of what the unreadable component holds is shown at all.
    expect(listed('Figures').map(([text]) => text)).toEqual([
      'Figure 1.1 The paper tray',
      'Figure The paper tray',
      'Figure 2.1 The paper tray',
    ]);
    expect(screen.queryByText(/The bench/)).toBeNull();
    expect(document.body.textContent).not.toContain('Figure 1.2');
  });

  it('STR-037 reorders the outline from the contents, by key and by pointer, and every number follows at once', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method', [referenceTo(AGAIN, PRINTER)]),
        section(SCOPE, 'Scope'),
      ]),
      { holds: { [PRINTER]: [tray] } },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    const figures = () => listed('Figures').map(([text, href]) => [text, href?.slice(-26)]);

    // By key: Method goes up, taking its component with it.
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('1'));
    expect(item('Introduction')).toHaveAccessibleDescription('2');
    expect(figures()).toEqual([
      ['Figure 1.1 The paper tray', AGAIN],
      ['Figure 2.1 The paper tray', RESULTS],
    ]);
    await settled();

    // By pointer: Method dropped at the end of the document.
    fireEvent.dragStart(item('Method'));
    const end = await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(end);
    fireEvent.drop(end);
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('3'));
    expect(item('Introduction')).toHaveAccessibleDescription('1');
    expect(item('Scope')).toHaveAccessibleDescription('2');
    expect(figures()).toEqual([
      ['Figure 1.1 The paper tray', RESULTS],
      ['Figure 3.1 The paper tray', AGAIN],
    ]);
    expect(
      fake.edits().map((request) => (request.body as { operation: unknown }).operation),
    ).toEqual([
      { operation: 'move', node: METHOD, parent: null, position: 0 },
      { operation: 'move', node: METHOD, parent: null, position: 2 },
    ]);
  });

  it('says a document holds no figures, tables or equations, and says so when they could not be read', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    fake.refuseNext(`/v1/documents/${DOCUMENT}/contributions`, 500);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('This document has no figures, tables or equations.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them, and watch them fail**

```bash
pnpm --filter @alloy-works/web exec vitest run src/structure/DocumentPage.test.tsx -t "lists of figures"
```

Expected: FAIL four times, `Unable to find role="region" and name "Figures"` and, in the last, no
**Try again** button.

- [ ] **Step 4: The lists**

Create `apps/web/src/structure/GeneratedLists.tsx`:

```tsx
import {
  conditions,
  defaultNumberingScheme,
  listOf,
  number,
  resolve,
  type Contribution,
  type OutlineView,
} from '@alloy-works/domain';
import { useId, useMemo } from 'react';

import { nodeLink } from './links.js';
import { nodeName, placeOf, type Names } from './tree.js';

/** What the page knows of each occurrence's contributions, keyed by the occurrence's node. */
export type Known =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly signedOut: boolean }
  | {
      readonly state: 'loaded';
      readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
    };

const NOTHING: ReadonlyMap<string, readonly Contribution[]> = new Map();

/** The lists a document generates, in the order a publication prints them (STR-041). */
const LISTS = [
  { sequence: 'figure', heading: 'Figures' },
  { sequence: 'table', heading: 'Tables' },
  { sequence: 'equation', heading: 'Equations' },
] as const;

export interface GeneratedListsProps {
  readonly document: string;
  readonly outline: OutlineView;
  readonly known: Known;
  readonly names: Names;
  readonly onRetry: () => void;
}

/**
 * The list of figures, of tables and of equations, numbered in the page by the same pipeline the
 * service numbers with, over the outline the page holds and each occurrence's contributions as the
 * service last answered them - so a move renumbers every entry before anybody asks the service
 * anything. An occurrence the page has heard nothing about is not known, so every number it could
 * have moved is shown as none rather than guessed (IAM-073), exactly as the numbering route withholds
 * it. Each entry is a link to the occurrence that holds it.
 */
export function GeneratedLists({ document, outline, known, names, onRetry }: GeneratedListsProps) {
  const prefix = useId();
  const contributions = known.state === 'loaded' ? known.contributions : NOTHING;
  const lists = useMemo(() => {
    const conditioned = conditions(resolve(outline, contributions));
    const numbering = number(conditioned, defaultNumberingScheme);
    return LISTS.map((list) => ({
      ...list,
      word: defaultNumberingScheme.sequences[list.sequence]?.body.label ?? list.heading,
      entries: listOf(conditioned, numbering, list.sequence),
    }));
  }, [outline, contributions]);

  if (known.state === 'loading') return <p>Reading the figures, tables and equations...</p>;
  if (known.state === 'failed') {
    return known.signedOut ? (
      <p>You are signed out. Sign in again to see the figures, tables and equations.</p>
    ) : (
      <>
        <p>The figures, tables and equations could not be read.</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </>
    );
  }
  if (lists.every((list) => list.entries.length === 0)) {
    return <p>This document has no figures, tables or equations.</p>;
  }
  return (
    <>
      {lists.map((list) =>
        list.entries.length === 0 ? null : (
          <section key={list.sequence} aria-labelledby={`${prefix}-${list.sequence}`}>
            <h3 id={`${prefix}-${list.sequence}`}>{list.heading}</h3>
            <ul>
              {list.entries.map((entry) => {
                const holder = placeOf(outline.nodes, entry.node)?.node;
                const shown = [entry.label ?? list.word, entry.caption]
                  .filter((part) => part !== null && part !== '')
                  .join(' ');
                return (
                  <li key={`${entry.node} ${entry.block}`}>
                    <a href={nodeLink(document, entry.node)}>{shown}</a>
                    {holder && <> in {nodeName(holder, names)}</>}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </>
  );
}
```

- [ ] **Step 5: The page asks for contributions whenever its version changes**

In `DocumentPage.tsx`, `type Contribution` joins the domain import, `GeneratedLists` and `type Known`
are imported from `'./GeneratedLists.js'`, and after `documentIn`:

```tsx
/**
 * What each occurrence contributes, from a `ContributionsView` checked member by member: an occurrence
 * whose version is null, or names a version the answer does not hold, is left out - not known, so
 * every number it could have moved is withheld rather than guessed. `undefined` is a body that is not
 * one at all.
 */
function contributionsIn(data: unknown): ReadonlyMap<string, readonly Contribution[]> | undefined {
  if (!isRecord(data) || !Array.isArray(data.occurrences) || !Array.isArray(data.versions)) {
    return undefined;
  }
  const versions = new Map<string, Contribution[]>();
  for (const version of data.versions as unknown[]) {
    if (!isRecord(version) || typeof version.id !== 'string') return undefined;
    if (!Array.isArray(version.contributions)) return undefined;
    const list: Contribution[] = [];
    for (const each of version.contributions as unknown[]) {
      if (
        !isRecord(each) ||
        typeof each.block !== 'string' ||
        typeof each.sequence !== 'string' ||
        typeof each.numbered !== 'boolean'
      ) {
        return undefined;
      }
      list.push({
        block: each.block,
        sequence: each.sequence,
        numbered: each.numbered,
        ...(typeof each.caption === 'string' ? { caption: each.caption } : {}),
      });
    }
    versions.set(version.id, list);
  }
  const known = new Map<string, readonly Contribution[]>();
  for (const occurrence of data.occurrences as unknown[]) {
    if (!isRecord(occurrence) || typeof occurrence.node !== 'string') return undefined;
    const list = typeof occurrence.version === 'string' ? versions.get(occurrence.version) : null;
    if (list) known.set(occurrence.node, list);
  }
  return known;
}
```

In the component, before `names`:

```tsx
// What each occurrence contributes, asked again whenever the version the page holds changes - an
// act of the author's, a refusal carrying somebody else's - so a component's new head is heard about
// no later than the next act. Until the answer arrives the page numbers with the last one, keyed by
// occurrence, so a move renumbers at once; an occurrence it has not heard about is not known.
const [known, setKnown] = useState<Known>({ state: 'loading' });
const [knownAttempt, setKnownAttempt] = useState(0);
const heldVersion = loaded.state === 'open' ? loaded.document.version.id : null;
useEffect(() => {
  if (heldVersion === null) return;
  let current = true;
  client
    .GET('/v1/documents/{id}/contributions', { params: { path: { id } } })
    .then(({ data, response }) => {
      if (!current) return;
      const read = contributionsIn(data);
      setKnown(
        read === undefined
          ? { state: 'failed', signedOut: response.status === 401 }
          : { state: 'loaded', contributions: read },
      );
    })
    .catch(() => {
      if (current) setKnown({ state: 'failed', signedOut: false });
    });
  return () => {
    current = false;
  };
}, [client, id, heldVersion, knownAttempt]);
```

and after the `OutlinePanel`, inside the `<article>`:

```tsx
<GeneratedLists
  document={document.id}
  outline={document.outline}
  known={known}
  names={names}
  onRetry={() => setKnownAttempt((count) => count + 1)}
/>
```

- [ ] **Step 6: Run them, and watch them pass; then the whole renderer**

```bash
pnpm --filter @alloy-works/web exec vitest run src/structure/DocumentPage.test.tsx
pnpm --filter @alloy-works/web test
pnpm --filter @alloy-works/web typecheck
pnpm lint
```

Expected: the four new tests pass and every existing one is unchanged - an existing test's fake now
answers the contributions route with empty lists, so the page says **This document has no figures,
tables or equations.** beneath its outline, which no existing assertion reads.

- [ ] **Step 7: Move the pin, regenerate, commit**

The citations pin becomes `180`: `// 180, from 178: the same plan cites IAM-073 a second time, in
apps/web/src/structure/DocumentPage.test.tsx, where the page now numbers captions itself and shows a
reader none a component they may not read could have moved; and STR-037, reordering from the
contents by key and by pointer.`

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm --filter @alloy-works/trace test
pnpm exec prettier --write apps/web/src packages/trace/src
git add apps/web/src/structure/GeneratedLists.tsx apps/web/src/structure/DocumentPage.tsx \
  apps/web/src/structure/DocumentPage.test.tsx packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "List a document's figures, tables and equations, numbered in the page"
```

---

## Task 6: The trace, the docs and the release

**Files:**

- Modify: `docs/design/structure.md`
- Modify: `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md`
- Modify: `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`, `CLAUDE.md`
- Modify: `packages/trace/trace.json`, `packages/trace/src/trace.test.ts`

- [ ] **Step 1: Drop STR-034's claim**

In `docs/design/structure.md`, STR-034's row leaves `## Requirements owned`, and "What this document
does not own" gains:

```markdown
| STR-034 | **Answered for the author's own acts, not another person's.** The panel renders the outline the page holds, so it updates with every act the author makes; a colleague's change reaches it only when the author next acts and is refused, or reloads. The stream carries no document version, and one would have to be withheld from every viewer who may not read the document - a design of its own |
```

and STR-045's row in the same table (decision H, as Ken accepted it) becomes:

```markdown
| STR-045 | **The panel's half is built and the claim is not.** Opening a node's link opens the document with that node chosen, focused and marked in the outline, and a document the reader may not read is answered as nothing there (access.md). But a reader following a shared link expects to land on the node's content, and there is no document view to show it; claimed now, the claim would go partial the day that view exists. The document view claims it, going through the same `nodeLink` |
```

The claims pin in `packages/trace/src/trace.test.ts` becomes `360`: `// 360, from 361: structure.md
stopped claiming STR-034, which the panel answers for the author's own acts and not for another
person's - named in prose beside the table (the navigation plan, decision I).`

- [ ] **Step 2: Check the corpus and pass the gate**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace tranche T1 STR
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/worker fetch-typst   # once per machine
pnpm test
pnpm trace verify
pnpm trace gate
```

Expected: `No problems in the corpus.`; STR-037, STR-040, STR-041, STR-044, STR-046 and STR-063
`Covered`; STR-034 `Specified` and unclaimed; STR-036 `Designed`.

- [ ] **Step 3: Amend structure.md**

1. **The "Part of this is built" note**: navigation is built - the contents panel with its lists,
   `contents` and `listOf`, a node's address, and the contributions route - and what is still design
   loses "the contents panel, generated lists, deep links".
2. **STR-040's and STR-041's rows**: `contents(conditioned, numbering, depth)` lists every node to the
   depth, numbered or not, a reference's title left to its caller; `listOf(conditioned, numbering,
sequence)` lists one sequence's entries with their captions.
3. **"Navigation"**: the panel goes to a linked node, chooses it, focuses it and marks it; the
   paragraph on several hundred nodes is replaced by what was measured - every node rendered, a move a
   round trip answering the whole outline, 110 ms p95 to open and 91 ms for a move in the page at 500
   nodes, and the service's share held to STR-063 in the suite.
4. **"Generated lists"**: the two signatures as built, the caption on a contribution, and the lists
   on the document page, numbered in the page from the contributions route.
5. **"Deep links"**: `#/documents/{document}/nodes/{node}`, the address following what is chosen
   without a history entry, arrivals, **Copy link**, and **The linked part is not in this document.**
6. **"Who is shown what"** gains a sentence: the contributions route answers what the numbering
   route reads, so a reader is sent no caption, block or version of a component they may not read,
   and the page numbers from nothing else.
7. **"Routes"**: `GET /v1/documents/{id}/contributions` is built, taking no parameter and naming each
   version's contributions once.
8. **"Where the code lives"**: `lists.ts` in the domain; `links.ts`, `GeneratedLists.tsx` and the node
   route in the renderer.
9. **"Verification"**: "Navigation at several hundred nodes" says where STR-063 is measured, and that
   the interface's share waits for the browser suite.
10. **"Changed while planning the build"** gains a paragraph and rows, in the shape the section has:

```markdown
[The third structure plan](../plans/2026-09-18-structure-03-navigation.md) built the contents panel,
the generated lists, a node's address and the contributions route. It found twelve things. One
requirement is new and claimed, STR-063 (issue #119), narrowed to the service's share of the
navigation budget. One claim is dropped, STR-034, answered for the author's own acts and not for
another person's. STR-036 stays claimed and cited by nothing, as the plan's decision J says.

| Found                                                                         | Change                                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **STR-034 is answered only for the author's own acts**                        | The claim is dropped and the gap named: another person's change needs document versions on the stream, withheld per viewer |
| **Issue #119 as filed could not be demonstrated**                             | Landed as STR-063, the service's share, measured in the suite; the interface's share is a recommended row                  |
| **`contents` read from the table would drop every unnumbered node**           | It walks the outline and numbers from the table; a reference's title is its caller's                                       |
| **`listOf` had no caption to list**                                           | A figure's and a table's contribution carries its caption; the numbering table carries none                                |
| **"A move is a splice" was not what was built**                               | Every act answers the whole outline; measured, and fast enough                                                             |
| **"Windowed over the visible depth" was never built**                         | Not needed at 500 nodes; the prose is gone                                                                                 |
| **The contributions route's `occurrences` parameter cannot carry an outline** | The route answers every occurrence of the latest version and takes no parameter                                            |
| **An answer per occurrence repeated a reused component**                      | Each version's contributions are answered once: 232 KB rather than 542 KB at 500 nodes                                     |
| **The desktop app has no address bar to share a link from**                   | The chosen node's address in a field, and **Copy link**                                                                    |
| **The hash router could not hear the same address twice**                     | It counts arrivals                                                                                                         |
| **The page now numbers captions itself**                                      | IAM-073 is cited in the renderer too                                                                                       |
| **A `latest` component's new head reaches the lists at the next act**         | Named: the page asks again whenever its version changes, and no sooner                                                     |
```

- [ ] **Step 4: Describe what is built**

In `docs/architecture.md`: `lists.ts` in the domain's `src/structure/` row; the contributions route
in the service's; in the renderer's, `links.ts`, the `#/documents/{id}/nodes/{node}` route and
arrivals, the panel going to a node and its **Copy link**, and `GeneratedLists.tsx`; and in "The
service serves the renderer", the "Not yet" paragraph becomes: "A deep link is a hash, so the
renderer's relative asset paths are never under a deep path and the `file://` fallback serves one as
it serves the root." No stored shape changed, and it says so. In `docs/development.md`: how to see a
node's address, copy it, and open it after a reorder, and the lists, as "Trying it by hand" below sets
out.

- [ ] **Step 5: The features, in lockstep**

In `docs/features.md`, under the documents entry, "Nothing resolves a cross-reference yet, and there
is no table of contents." becomes:

```markdown
**Every part of a document has a link.** Choose a section or a component in the outline and its link
is shown beneath it, with **Copy link**; the address in the browser follows too. Opening the link
opens the document with that part chosen and marked, however the outline has been reordered since.
Beneath the outline, the document lists its **figures, tables and equations**, each with its number
and caption and a link to where it is placed, renumbered at once when you move anything. A number
that would depend on a component you may not read is left off. Nothing resolves a cross-reference
yet, and nothing tracks where you are as you read - there is no reading view.
```

and in "What does not exist", "No cross-references resolved, no table of contents, no list of
figures" becomes "No cross-references resolved, and no reading view". In `README.md`'s Features
table, the documents row becomes:

```markdown
| Documents and outlines | Make a document in a space, build its outline out of sections and components, and restructure it a version at a time. Sections are numbered as you go, every part has a link, and figures, tables and equations are listed |
```

- [ ] **Step 6: Mark the plan built**

In `docs/plans/README.md`, this plan's row becomes `Built (PR #n)` once the number is known, and the
prose below the structure table gains a paragraph in the shape plan 2's has. In `CLAUDE.md`, the
status paragraph's "no document view" sentence says the outline now has addresses and lists of
figures, tables and equations - for a person to accept in the pull request.

- [ ] **Step 7: Bump the version and write the changelog**

`version.json`, the root `package.json` and `apps/desktop/package.json` all become `0.29.0`. At the
top of `CHANGELOG.md`:

```markdown
## 0.29.0 - YYYY-MM-DD (PR #n)

### Added

- **A link to every part of a document.** Choose a section or a component in the outline to see its
  link, or copy it with Copy link. Opening the link opens the document there, with that part marked,
  even after the outline has been reordered.
- **Figures, tables and equations listed.** Beneath the outline, a document lists its figures, tables
  and equations with their numbers and captions, each a link to where it is placed. Move anything and
  the numbers change at once. A number that would depend on a component you may not read is left off.
- **A time limit for large documents.** A document of five hundred sections and components now has to
  open, number and restructure within a quarter of a second on the service, and every test run checks
  it.
```

- [ ] **Step 8: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs CHANGELOG.md README.md CLAUDE.md packages/domain packages/api-contract apps/service apps/web packages/trace
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add docs/design/structure.md docs/architecture.md docs/features.md README.md docs/development.md \
  docs/plans/README.md CHANGELOG.md version.json package.json apps/desktop/package.json CLAUDE.md \
  packages/trace/trace.json packages/trace/src/trace.test.ts
git commit -m "Release 0.29.0: navigation"
git push -u origin <branch>
gh pr create --base main --title "Navigation: a link to every node, and the lists of figures, tables and equations"
```

The pull request body says what changed for a person, names the seven citations, says STR-034's claim
was dropped and why (decision I), that STR-036 stays uncited (decision J), and that STR-063 lands
narrowed (decision K), names issue #134 for the interface's share, and carries `Closes #119` on a
line of its own.
Then fill the changelog heading's `YYYY-MM-DD (PR #n)` and the plans index's `Built (PR #n)`, commit,
and push. After the merge, check that issue #119 closed.

---

## Trying it by hand

After task 6, with Docker running and the whole system in containers:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

Nothing is migrated.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation`, choose **Ada**,
   and open **The dosing report** with **Introduction**, **Method** and **Scope** under **Method**
   (make it as structure 1's steps do if it is not there).
2. Choose **Scope**. The address bar ends `#/documents/<id>/nodes/<scope's id>`, and beneath the tree
   **Link to Scope** shows the whole address. Press **Copy link**: the page says **Copied the link to
   Scope.**
3. Choose **Method** and press `Alt+Up`, so **Scope** becomes `1.1`. Paste the copied link into a new
   tab: the document opens with **Scope** chosen, focused and marked.
4. Edit the address to name a node that is not there (change one letter of the last part): the page
   says **The linked part is not in this document.**
5. Sign in as **Alice** in another private window, with no **Reader** on the document's space, and open
   the same link: **There is nothing here, or nothing you may read.**
6. **Figures, through the API**, because the editor writes paragraphs alone: give **Install the
   printer** two figures with structure 2's step 7, place it under **Introduction** and under
   **Method**, and reload. Beneath the outline, **Figures** lists `Figure 1.1 A caption` and
   `Figure 1.2 A caption` in **Install the printer**, then `Figure 2.1` and `Figure 2.2`. Move
   **Method** up: the list renumbers before the page has heard back. Choose a figure's link: the
   reference that places it is chosen and marked.
7. As structure 2's step 8, place a component Alice may not read between the two occurrences and give
   her **Reader** on the space: signed in as Alice, the figures after it in that chapter show `Figure`
   and their caption, with no number, and nothing of the component she may not read is listed.
8. **The desktop app.** `pnpm app`, open the document, choose a node, press **Copy link**, and paste
   the link into a browser signed in to the same environment.

### What a person can see, and what only a test proves

| Claim                                                                | Seen by hand | Proven only by a test                                                              |
| -------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| Every node has an address that opens the document there (STR-044)    | Steps 2, 3   | The address for every node, and a fresh page: `DocumentPage.test.tsx`              |
| The address survives a reorder (STR-046)                             | Step 3       | The same address before and after, arriving again: `DocumentPage.test.tsx`         |
| A link to a document the reader may not read is nothing there        | Step 5       | `Workspace.test.tsx`                                                               |
| Figures, tables and equations listed, numbered in the page (STR-041) | Step 6       | Captions, an unnumbered equation absent, no numbering request                      |
| Reordering from the contents renumbers everything (STR-037)          | Step 6       | By key and by pointer: `DocumentPage.test.tsx`                                     |
| No number a component the reader may not read could move (IAM-073)   | Step 7       | Its caption and block absent from the route's body: `contributions-routes.test.ts` |
| The service's share of the budget at 500 nodes (STR-063)             |              | `navigation-budget.test.ts`, in every `pnpm test`                                  |
| The contents to a depth (STR-040)                                    |              | `lists.test.ts`: PUB renders it                                                    |
| **Copy link** in the desktop app                                     | Step 8       | Nothing: the suite drives jsdom's clipboard stub                                   |

Steps 1 to 8 were **not** done before this plan was committed. The page was run in jsdom and, over a
fake service, in Electron's Chromium for its timing; the routes on the wire.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Resolving a cross-reference**, and a component's reference to a section. **Structure 4.**
- **Another person's outline change reaching an open page**, which STR-034's "live" asks for: document
  versions on the stream, withheld from every viewer who may not read the document (decision I).
  **The plan that puts document versions on the stream**, which claims STR-034.
- **The interface's share of the navigation budget**: a row recommended above, and the browser suite
  to measure it. When both are in, STR-039 is superseded. **The browser suite.**
- **Tracking the reader's position as they scroll (STR-035) and a link into the body (STR-045).** The
  panel does the half it can - it goes to the node, focuses it and marks it. **The document view.**
- **A published contents and published lists** - rendering `contents` to PUB-037's depth, and the
  lists, in a publication - and citing STR-036 against what it prints. **PUB's plan.**
- **Expanding and collapsing the tree** (decision L). **The accessibility plan**, if its browser suite
  shows a reader needs it.
- **A pinned reference named by its pinned version's title.** The panel and the lists name every
  reference by its component's head title, from the listing the page already reads, so a reference
  pinned to an older version under an older title shows the new one. Filed as
  [issue #135](https://github.com/kenhayward/alloy-works/issues/135). **Whichever plan resolves a
  component version for each reference on the document route.**
- **Keeping the lists fresh between acts** (finding 12): a `latest` component's new head reaches them
  at the next act. **The same stream plan.**

Found while planning, and left rather than widened into this one:

- **The measurement's own risk.** It runs in `pnpm test`, beside every other suite on CI's runner.
  The margin measured here is five times at p95 and seven at the maximum; if CI finds less, the rule
  is CLAUDE.md's - an issue and a quarantine in its own pull request, never a wider budget.
- **The document view's `Copy link`** must go through the same `nodeLink` and the same field, or a
  second spelling of the address appears. **The document view.**
