# CP: Comparison

> T3's fourth phase ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)),
> under [comparison.md](../design/comparison.md) and [ADR-0058](../decisions/0058-suggestions-are-proposals-beside-the-content.md),
> accepted by Ken on 2026-10-11. **Full tier**: new contracts, permissions over content, an index
> migration, a budget; a pre-flight review (folded in) and a final review. Decisions marked
> **(default)** are recommendations he may overturn.

**Goal:** an author compares any two versions of a component, or their unsaved work with the version
it opened from, as a redline; anyone compares two baselines of a document, or one with the document
now, at three levels, told why each difference arose; the result is anchored changes that suggestions
(phase 6) will stand on.

| PR  | Holds                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CP1 | This plan, the design, ADR-0058 accepted; the comparison in `packages/domain`, replacing the spike's, and its counted budget (Task 1) |
| CP2 | The routes: a component's versions; two baselines or one and now, structure and content (Task 2)                                      |
| CP3 | The redline: the editor's Compare and My changes; a baseline comparison page; the export (Task 3)                                     |
| CP4 | Resolved output and its causes; what changed since and its index; the whole system, docs and the close (Task 4)                       |

## Decisions

comparison.md's, and:

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP-A | **Anchored changes are the result** (ADR-0058): `compareContent(older, newer)` answers the change list; every rendering reads it. Pure, deterministic, in `packages/domain/src/compare/`; the spike's `content/compare.ts` retired and its case 7 gate test ported to it                                                                                                             |
| CP-B | **Units**: blocks by identifier; a list item keyed by its first block's identifier (`item:<id>`), its term compared as the item's inline field; a table cell by `cell:<table>:<row>:<col>`, a row or column added or removed reported as the table `changed: shape`; a footnote's content under `footnote:<id>`. Order by the longest increasing run of matched positions per parent |
| CP-C | **Words** for the redline: words, spaces and punctuation kept; a non-text inline node one token (a footnote by identifier); LCS, bounded per block, past which the block is `changed: text` whole, said so. **Similarity** keeps the spike's tokens (lower-cased, no punctuation), which 0.4 was tuned on                                                                            |
| CP-D | **`now` resolves without the publish's gate**: every reference to its version as the caller reads it, every binding to its latest resolution, an unresolved one compared as no value. Any reader of the document may compare                                                                                                                                                         |
| CP-E | **My changes is the browser's**: the editor holds the version it opened and what it shows now, and `compareContent` runs there (CNT-113, COL-026). No route reads an iteration for it                                                                                                                                                                                                |
| CP-F | **Withheld is withheld**: a component the caller may not read appears as its node, moved or not, never edited, never with a version, in every answer and the export                                                                                                                                                                                                                  |
| CP-G | **Resolved output** (CP4) compares, per node, the resolved text a publish prints; causes by comparing the two sides' pins; nodes whose pins are all equal skipped unread; a number not known to the caller is unknown, never a change                                                                                                                                                |
| CP-H | **Export is one HTML file** **(default)**: the redline with its key, the two sides named, match methods shown, nothing withheld. Word with tracked changes is ADR-0058's later case                                                                                                                                                                                                  |
| CP-I | **What changed since** reads versions cut, and resolutions accepted, after the instant, by artifact, as the caller may read them; migration 0075 indexes `artifact_version (created_at)` and `binding_resolution (resolved_at)`; the record begins at the artifact's creation                                                                                                        |
| CP-J | **The budget** (VER-051) **(default, provisional)**: content and structure counted in CI - matching and LCS operations for 300 components of 20 blocks with 10 changes, and a component of 300 versions - and timed in the service's log; resolved output has its own, set in CP4 when measured                                                                                      |

## Task 1: The comparison - CP1

- `packages/domain/src/compare/`: `tokens`, `diffWords`, `units`, `matchUnits`, `compareContent`,
  `compareOutlines`, the change types; `content/compare.ts` retired, case 7 ported.
- Tests: **`VER-027`** moved past two others and reworded is one change; shifted blocks unchanged.
  **`VER-028`** no shared identifier: matched by similarity at 0.4; below it, deleted and inserted.
  **`VER-029`** every change names its method. **`VER-024`** structure: a section moved, a reference
  added. Items, cells, a footnote edited once, split and joined. **`VER-051`** counted.

## Task 2: The routes - CP2

- `GET /v1/components/{id}/comparison?from=&to=`; `GET /v1/baselines/{id}/comparison?with=` (a
  baseline of the same document, or `now`), structure and content; `resolveNow`; the access, cross-tenant,
  refusal and audit census entries; `openapi.json` and the client regenerated.
- Tests: **`VER-025`**, **`CNT-112`**, **`VER-050`** (a withheld node never edited, never versioned).

## Task 3: The redline - CP3

- The redline view: inserted, deleted, moved, split, joined and similarity matches drawn apart, with a
  key; the editor's **Compare** (versions listed, who and when) and **My changes**; the Baselines tab's
  **Compare with**; a comparison page; **Export**.
- Tests: **`CNT-111`**, **`CNT-113`**, **`COL-026`**, **`VER-030`** (the export holds the redline, nothing
  withheld), **`VER-029`** drawn apart. Axe in Light and Dark; the whole browser suite.

## Task 4: Resolved output, what changed since; the close - CP4

- `compareResolved`; `level=resolved`; migration 0075; `GET /v1/changes?since=`, and `changedSince` on
  the listings; `features.md`, `README.md`; content-model.md's CNT-005 and CNT-033 noted as ADR-0058's;
  the close (0.154.0).
- Tests: **`VER-031`** same component versions, a new dataset version: changed by data. **`VER-045`** two
  template versions: a definition, told from an edit. **`SCH-025`**, **`SCH-048`**.

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format; CP3 and CP4 the whole browser
suite. The final review hunts a comparison showing what its reader may not read, a move reported as a
deletion and an insertion, a cause misnamed, and the budget.

## Risks

- **Q05**: 0.4 is tuned on one case. Every similarity match says so (VER-029); the number is one
  constant.
- **Resolved output's cost**: bound values read results from the object store; skipped where both
  sides pin the same dataset version.
