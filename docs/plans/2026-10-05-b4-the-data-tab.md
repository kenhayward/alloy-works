# B4: The Data tab

> B4 of [bindings.md](../design/bindings.md)'s build order, on what B1 and B2 built and B3's
> `publication_binding` (#395). **Full tier, one review**: a final review that breaks each citation
> and probes the waiting rule and Accept; no per-task reviews. Ken may overrule.

**Goal:** a document's outline pane gains **Data** beside Contents, listing every binding the reader
can see with its state and its acts (BI-H). The page checks once on opening and on **Check now**
(BI-I), a waiting value shows beside the held one until accepted, a floating binding is flagged when
its definition moves on and its same-rows result is still a revision (BI-K), and each binding says
how it differs from what the latest publication printed.

| PR   | Holds                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| B4.0 | This plan, with a change fragment                                                                                              |
| B4.1 | The build: the waiting rule, Accept's precondition, the view's new members, the Data tab and the check on opening              |
| B4.2 | B4's close ([ADR-0037](../decisions/0037-change-fragments-and-versions-at-a-close.md)): fragments folded, the Minor bump, docs |

**Depends on B3.** Changed since published reads `publication_binding` (0050); B4.1 branches from
`main` after #395 merges. Everything else needs only B1 and B2.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                             | Beat                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| B4-A | **Waiting is decided against the definition version the binding asks** - its pin, or the definition's latest where it floats. `resolutionsOf` takes that per node and binding and answers the newest dataset version that _ran_ it; it waits where it is later than the held one and its checksum differs **or** its definition version is not the held one's (BI-K) | D3's newest version of the dataset regardless, offered on checksum alone                                              |
| B4-B | **A fix found planning**: a dataset is one question across definition versions (DAT-084), so today a binding pinned to 1.0 is offered, and Accept takes, another document's check of 2.0. B4-A's rule ends it, and **Accept refuses `resolution_precondition` any version that is not the binding's waiting one**, by the same function                              | Accept's "any newer version of the dataset" (`acceptBinding`'s `newer`)                                               |
| B4-C | **The state is the page's, by a pure `dataState(view, checkFailure)`** in `apps/web/src/structure/dataStates.ts`, in the design's order, first that holds; the service answers facts (`definitionChanged`, `sincePublished`, `mayCheck`, `mayResolve`)                                                                                                               | A state computed in the service, which cannot see the page's check failures (DAT-086 records none)                    |
| B4-D | **Changed since published compares with the document's latest publication** (not a preview), per binding: its digest (by the resolution), dataset version, and definition version (from that version's provenance); `sincePublished` is `null` (same, or never published), `'new'`, or the members that differ. Revision is B5's                                     | Comparing per output format, or with the latest publication of the version open                                       |
| B4-E | **DAT-091's warning waits for D7.** `provenanceSchema`'s identity is `service` alone, so no stored result can be a person's view; B4 builds no `sharesOwnView` and cites nothing for DAT-091                                                                                                                                                                         | A route member and a dialog for a value no stored shape can hold, testable only through a test-only identity arm      |
| B4-F | **The check on opening is one `POST .../bindings/check` after the view answers, only where some binding is `checked` and `mayCheck`**; its per-binding failures held in page state for the page's life, then the view read again; **Check now** does the same                                                                                                        | A check per binding as each is drawn, which would run a question once per binding instead of once per document (D3-I) |

## The stored-shape check

No table, column, constraint or content schema changes. The bindings view's response gains four
members; the accept body is unchanged (`revision` is B5's). `resolutionsOf` reads, never writes.

## Task 1: The waiting rule (`packages/db`, `apps/service`)

- `datasets.ts`: `resolutionsOf(trx, document, asked: ReadonlyMap<string, string>)`, keyed
  `node binding` to the definition version id asked; the lateral picks the newest version of the
  dataset whose `content->'queryDefinition'->>'version'` is the one asked; `waiting` per B4-A. A
  binding absent from `asked` waits on nothing.
- `bindings.ts`: `heldBy` builds `asked` from `bindingsPlaced` (pin, else `readQueryDefinition`'s
  latest, read once per definition); `acceptBinding` requires `body.version === held.waiting.version`.
- Tests (`datasets.test.ts`, `bindings.test.ts`): **`DAT-070`** a floating binding's check of a newer
  definition version returning the same rows is waiting, and accepted moves the value; a pinned
  binding is offered no result of another version (B4-B), and Accept of that version is refused 409;
  a floating binding is offered nothing of an older version another document pinned. **`DAT-082`**
  a check recording a different result moves nothing until accepted.

## Task 2: The view (`apps/service`, `packages/api-contract`)

- `viewer`: `definitionChanged` (floats, and the latest definition version is not the held
  provenance's), `mayCheck` (`checked`, `read` on the document, `use_connection` on the held
  connection), `mayResolve` (`edit` and `use_connection`), `sincePublished` per B4-D over
  `publishedBindings(trx, document)` in `packages/db/src/publishing.ts` (the latest publication's
  rows with each resolution's digest and each dataset version's definition version).
- Contract: `BindingStateView` gains the four members with descriptions; `openapi.json` and the
  client regenerated.
- Tests: **`DAT-070`** `definitionChanged` set when the definition advances and unset for a pin;
  `sincePublished` new, same, and each of digest, dataset and definition differing after a publish;
  `mayCheck` false without `use_connection`.

## Task 3: The Data tab and the check on opening (`apps/web`)

- `OutlineTabs.tsx`: `OUTLINE_TABS` gains `data`, offered only where `holdsBinding`; a chosen
  `data` falls back to Contents where it is not.
- `dataStates.ts`: `dataState` (B4-C) and `DATA_STATE_WORDS`; `DataTab.tsx`: rows in outline order
  grouped by node number and title, each with its value as shown, definition, mode, state and the
  waiting value beside the held one; a state filter; acts **Resolve** and **Keep** through
  `settleBinding`, **Accept** through `.../accept`, **Check now**, **Go to** by `reveal.ts`; a note
  where no binding is `mayCheck` that values were not checked for this reader; a 409 said as the
  value changing meanwhile, as B2's.
- `DocumentPage.tsx`: the check on opening per B4-F, its failures passed to the tab and the status bar.
- Tests (`dataStates.test.ts`, `DataTab.test.tsx`, `DocumentPage.test.tsx`, fake client):
  **`DAT-039`** one document's bindings listed as waiting, failed and never resolved, filtered by
  each; **`DAT-082`** the page checks once on opening, never for a pinned binding or a reader
  without `mayCheck`, shows waiting beside held, and the held value stays until Accept; **`DAT-070`**
  definition changed and changed since published listed with what differs. Every user-facing string
  dash-free.

## Task 4: The whole system, and docs

- `tests/browser`: a document on `source-postgres` opened, its source changed, the check on opening
  showing the revision, Accept by keyboard alone, the tab through axe; uncited, as B1's and B2's.
- `tests/e2e/src/bindings.test.ts`: the B4-B case over HTTP, two documents, pinned and floating.
- Docs: bindings.md's "not built" note and the changed-by row; features.md and the README; this
  plan's row; `pnpm trace pins` for the citation and `.tsx` counts, from the tool.

## Verification

- Each suite alone, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`; `pnpm trace
check` and `pins` after `generate`, which runs after prettier.
- `pnpm test:e2e` and `pnpm test:browser` against the build's own compose project
  (`-p alloy-b4 --profile sources`, its own ports), every target set: `ALLOY_TEST_DATABASE_URL`,
  `ALLOY_TEST_OBJECT_STORE`, `ALLOY_TEST_SOURCE_PORT`, `ALLOY_E2E_COMPOSE_PROJECT`,
  `ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP`, `ALLOY_E2E_IDP_ISSUER`, `ALLOY_E2E_STORE_AT`,
  `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API`, `ALLOY_BROWSER_IDP`, `ALLOY_BROWSER_DATABASE`,
  `ALLOY_BROWSER_STORE_AT`. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation independently, each red; probes B4-A's rule (pinned,
  floating, an older version, same rows, a dataset shared by two documents) and Accept's
  precondition and rights (`edit`, `read` on the definition, `use_connection`).
- **By hand**, on that project: open a document after its source and its definition move on, see
  both flagged, accept one, publish, change a take and see changed since published. The pull
  request says which the tests prove and which stand in for Ken's look.

## Questions for Ken

Answered by Ken on 2026-10-05, with the decisions: every one as recommended. B4-B's bug is issue #396, closed by B4.1.

1. DAT-091's warning: defer it to D7 with the person's identity it needs (B4-E)? **Recommended: yes.**
2. B4-B changes what Accept takes today; fix it in B4.1 rather than its own issue and PR first?
   **Recommended: in B4.1**, since B4-A rewrites the same lines; the issue is opened for the record.

## Changed while building

| Found | Change |
| ----- | ------ |
