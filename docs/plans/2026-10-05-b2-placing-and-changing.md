# B2: Placing and changing

> B2 of [bindings.md](../design/bindings.md)'s build order, on what [B1](2026-10-04-b1-the-value-shown.md)
> built. **Full tier with one review**: a final whole-branch review, one independent break per
> citation, and no pre-flight or per-task reviews - the migration only widens an enum, and the new
> writes run in D3's locks, preconditions and re-decision. Ken may overrule.

**Goal:** an author places a binding from the **Value** dialog and changes one, keeping its
identifier. Placed in a document, the page resolves it at once from the author's own editing session
(BI-C). Where a change leaves the question unchanged, **Keep** holds the value already held,
`act: 'confirm'`, querying nothing (BI-J). Before a change that loses values, the dialog says which
documents will hold none, from the holders route. The Data tab (B4) and the publish (B3) are not B2's.

| PR   | Holds                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| B2.0 | This plan, with a change fragment                                                                                             |
| B2.1 | The build: the dialog and the editor's commands, `from: 'session'`, confirm and 0049, the holders route, Keep and the warning |
| B2.2 | B2's close ([ADR-0037](../decisions/0037-change-fragments-and-versions-at-a-close.md))                                        |

## Decisions

| #    | Decision (recommended)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Instead of                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| B2-A | **`Mod-Shift-6`** for **Value**, `prompts: true`, beside the list family's 7 to 0; checked against the registry and the renderer at the build, and recorded in its comment as Equation's was                                                                                                                                                                                                                                                                                                                         | `Mod-Shift-v` (paste as plain text), `Mod-Shift-x` (Firefox's text direction), any Ctrl-Alt chord (AltGr) |
| B2-B | **The listing answers each definition's connection `identity`**, one member added to `QueryDefinitionSummary.connection`, so the dialog names **Runs as** beside every definition from one call (DAT-022); the chosen one is read again from `GET /v1/query-definitions/{id}`                                                                                                                                                                                                                                        | A `GET` per definition listed, up to a hundred calls a page                                               |
| B2-C | **`from: 'session'`** on a resolve item, with a body `session` (lowercase UUID, 400 where an item says session and none is named): the binding is read from the latest iteration of the caller's own session on the node's component, only where the node floats, that session holds the lock now, and the iteration was opened from the component's latest version; otherwise `binding_missing`. `unchangedSince` re-reads from the same place in the recording transaction                                         | Reading any session's iteration, or a stale one opened before the latest cut                              |
| B2-D | **A pinned node**: the dialog places the binding and says _It shows in this document once the node takes a version holding it_, and resolves nothing                                                                                                                                                                                                                                                                                                                                                                 | Resolving against a version that does not hold the binding                                                |
| B2-E | **The question is unchanged** where the held dataset's definition and parameters digest equal the binding's, and the version the binding resolves to (pin, or latest) is the held provenance's version: one pure domain function, `questionUnchanged`, which confirm and the view both call                                                                                                                                                                                                                          | Comparing against the old binding, which no row stores                                                    |
| B2-F | **Confirm** (`POST /v1/documents/{id}/bindings/confirm`, `{ node, binding, replaces, from?, session? }`) in one transaction: `lockBindings`, `edit` on the document and `read` on the definition, `replaces` the version held (`resolution_precondition` otherwise, D3-K), `take_invalid` against the held version's columns, `confirm_not_possible` where the question changed. It records `act: 'confirm'`, the new digest, the held version, `replaces` the same; writes no `dataset_take` (the view's miss does) | An after-commit act as resolve's: confirm asks no source, so nothing needs deciding twice                 |
| B2-G | **The bindings view gains `held.keepable`** (stale and `questionUnchanged`), and the Value panel in a document offers **Keep** there and **Resolve** otherwise; the Data tab's are B4's                                                                                                                                                                                                                                                                                                                              | Waiting for B4 to offer either, which leaves B2's confirm reachable only through `/docs`                  |
| B2-H | **After Change in a document**, the page keeps that document's value where the question is unchanged, or resolves it from the session otherwise, as placing does (BI-C)                                                                                                                                                                                                                                                                                                                                              | Leaving the document the author is in holding nothing until they press Keep                               |
| B2-I | **Holders** are the documents whose latest outline places the component at a node with a latest resolution for the binding, whatever its digest, read by `splitByReading` as the uses routes are                                                                                                                                                                                                                                                                                                                     | Filtering by digest, which needs each document's pins resolved for one warning                            |

## The stored-shape check

One change, migration **`0049_binding_confirm.sql`**: `binding_resolution_act` becomes
`act in ('resolve', 'accept', 'confirm')`, and a new `binding_resolution_confirm_holds` check,
`act <> 'confirm' or replaces = dataset_version`. `binding_resolution_accept_replaces` already
requires `replaces` for every act but resolve, so it stands. The grant is unchanged. **Write paths**:
`recordResolution` alone, from resolve (`'resolve'`), accept (`'accept'`) and confirm (`'confirm'`);
its `act` type, `resolutionsOf`'s and the contract's `act` enum widen together. Content is unchanged:
the dialog writes the binding through `fromEditor`, the content model's parse (D3-C).

## Global constraints

- **Schema-keyed maps keyed by literals**: the dialog's refusal words and the shortcut's entry each a
  `Record` over a literal union with `satisfies`, each key listed in a test.
- **Web tests wait for the surface's own content**, and a dialog's test for its own heading.
- **Security, from D3**: `from: 'session'` reads only the caller's own session; confirm and holders
  answer nothing a reader could not already see; a definition not readable is _a query definition you
  cannot read_ and can only be kept or replaced.

## Task 1: Domain and editor

- `packages/domain/src/data/question.ts`: `questionUnchanged(binding, held, latestVersion)` (B2-E).
  Tests: each member that changes the question false, a take or a mode alone true.
- `packages/editor/src/bindings.ts`: `bindingPlaceable(state)`, `insertBinding(attrs)` (a fresh
  identifier, selected whole), `changeBinding(pos, attrs)` (its identifier kept); `marks.ts` gains the
  `value` entry (B2-A). Tests: placeable in each of the seven homes, refused in preformatted text, an
  equation and the title schema; Change keeps the identifier through an undo; the registry's chord
  unique.

## Task 2: Migration, store and contract

- `packages/db`: 0049 (above); `recordResolution`'s `act`; `documentsHolding(trx, principal,
component, binding)` (B2-I). Tests: a confirm whose `replaces` is not its version refused by the
  check, red with the check removed; holders counted readable and others.
- `packages/api-contract`: `from`, `session` on `ResolveBindingsBody`; `confirmBinding`;
  `getBindingHolders` (`GET /v1/components/{id}/bindings/{binding}/holders`, `read` on the
  component); `keepable`; `identity` on the summary (B2-B); `confirm_not_possible`. Each documented
  and tagged; `openapi.json` and the client regenerated.

## Task 3: Service

- `apps/service/src/data/bindings.ts`: `bindingsPlaced` takes an optional session source (B2-C), used
  by prepare and by `unchangedSince`; `confirmAct` (B2-F); the view's `keepable`; the holders handler.
- `apps/service/src/data/query-definitions.ts`: the summary's `identity`.
- Tests: a session's binding resolved before any version is cut; another principal's session, a
  pinned node and a stale session each `binding_missing`; the resolution's digest matching once the
  version is cut; confirm red for a changed definition, parameters, pin and a definition moved on,
  green for a take or a mode; a precondition lost to a concurrent accept; holders by `read`.
  **`DAT-022 the listing names the identity each definition runs as, to a reader of the definition
who may not read its connection`**.

## Task 4: The page

- `apps/web/src/editor/ValueDialog.tsx` (on ReferenceDialog's model): the five steps, Runs as beside
  each definition and on the chosen one, parameters through `checkParameterValues`, From the document
  shown unavailable, the pinned-node and on-its-own words, Insert and Change; Change's warning from
  holders, unless `questionUnchanged`. `ValuePanel.tsx` gains **Change**, **Keep** and **Resolve**
  (B2-G). `DocumentPage.tsx` resolves after Insert and keeps or resolves after Change (B2-H).
- Tests: **`DAT-022 the Value dialog says whose identity each definition runs as, beside it and on
the one chosen`**; the warning names readable holders and counts the rest; an author without
  `use_connection` told who may resolve it; Cancel and Escape place nothing; keyboard alone.
- `component-editor.md`'s binding row, `features.md` and the README, bindings.md's status note.

## Task 5: Whole system and browser

- `tests/e2e`: place through the routes, resolve from the session, change the take, confirm,
  holders. `tests/browser`: the dialog by keyboard to a placed value; axe on the dialog and the
  warning. **`DAT-022 the browser shows Runs as in the Value dialog`**, its break the summary's
  identity dropped.

## Verification

- Each suite alone, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`; `pnpm trace
check` and `pins` after `generate`, which runs after prettier.
- `pnpm test:e2e` and `pnpm test:browser` against a compose project of the build's own
  (`-p alloy-b2 --profile sources`, its own ports), setting every target explicitly:
  `ALLOY_TEST_DATABASE_URL`, `ALLOY_TEST_OBJECT_STORE`, `ALLOY_TEST_SOURCE_PORT`,
  `ALLOY_E2E_COMPOSE_PROJECT`, `ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP`, `ALLOY_E2E_IDP_ISSUER`,
  `ALLOY_E2E_STORE_AT`, `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API`, `ALLOY_BROWSER_IDP`,
  `ALLOY_BROWSER_DATABASE`, `ALLOY_BROWSER_STORE_AT`. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation independently (B2-B's identity, the dialog's line, the
  browser's) and each of 0049's checks, each red.
- **By hand**, on that project: a value placed in a document showing at once, its take changed and
  kept, its definition changed with the warning, and Publish still refused. The pull request says
  which the tests prove and which stand in for Ken's look.

## The close

B2.2: the fragments folded, the Minor bump, `docs/architecture.md` (0049, confirm, holders, the
session read), and the baseline drafted adding DAT-022, checked with `pnpm trace verify` first.

## Questions for Ken

Answered by Ken on 2026-10-05, with the decisions: every one as recommended.

1. **B2-H, keeping or resolving the open document on Change without a second click?**
   Recommended: yes; it is BI-C's rule applied to a change.
2. **B2-A, `Mod-Shift-6`?** Recommended: yes; no browser or registry entry takes it, and the toolbar
   is the way in wherever a layout does.

## Changed while building

| Found | Change |
| ----- | ------ |
