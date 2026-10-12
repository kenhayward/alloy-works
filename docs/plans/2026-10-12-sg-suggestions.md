# SG: Suggestions

> T3's sixth phase, its first half ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)),
> under [collaboration.md](../design/collaboration.md)'s Suggestions,
> [ADR-0058](../decisions/0058-suggestions-are-proposals-beside-the-content.md) and
> [ADR-0059](../decisions/0059-a-suggestion-merges-by-whole-block.md) (proposed). **Full tier**: a
> migration, stored shapes, new contracts, a write to content by somebody other than its author; a
> pre-flight review (its findings folded in) and a final review. Ken asked for the run on 2026-10-12;
> decisions marked **(default)** are recommendations he may overturn. Revised values (DAT-057 to
> DAT-063, DAT-115), phase 6's other half, are designed already
> ([bindings.md](../design/bindings.md#a-value-revised-by-hand)) and are the RV slice after this one.

**Goal:** a reviewer suggests a change to a component by editing a draft of it, with no lock; the
suggestion is drawn as a redline over the current version, and accepted, rejected or withdrawn, one at
a time or in bulk; accepting applies it to the component as it is then, as the accepter's version,
keeping every block's identifier, or says where and why it no longer applies.

| PR  | Holds                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SG1 | This plan, the design and ADR-0059; `applySuggestion` in the domain (Task 1)                                                          |
| SG2 | Migration 0077; suggestions made, listed with stale and counted, read with their redline, resolved one at a time and in bulk (Task 2) |
| SG3 | Review: **Suggest changes**, the draft editor, the Suggestions panel; the final review and the close (0.156.0) (Task 3)               |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SG-A | **Tables**: `suggestion` (component, the version made against, author, when, the proposed content, its digest; unique on component, author, version and digest, so a second send returns the first) and `suggestion_resolution` (one row per suggestion: `accepted`, `rejected` or `withdrawn`, by whom, when, and for an acceptance the version it stands in). Insert-only, update, delete and truncate revoked; state derived. At most 20 pending per author per component **(default)**. The audit check rebuilt with `suggestion.made` and `suggestion.withdrawn`, and strict detail for `suggestion.accepted` and `.rejected` (suggestion, its author, the version) |
| SG-B | **Making checks what a save checks**: the content schema, a title with text, every string storable (`storableEverywhere`), and a bound table naming only columns the maker may read (`mayNameColumns`), hoisted from `editing.ts` into one shared check; refused `suggestion_empty` where the draft equals the version made against, which must be the component's and need not be its latest                                                                                                                                                                                                                                                                            |
| SG-C | **The merge** is ADR-0059's, `applySuggestion(base, proposed, current, fresh)`: the current order; the suggestion's removals, changes, moves and additions; title, language and direction (never `schemaVersion`); an added block's identifiers - blocks, footnotes, marks, any `id` - fresh where taken; the whole parsed, or stale `invalid`. The comparison draws by identity and similarity, the merge by identity alone: a paragraph a reviewer retyped under a new identifier is a removal and an addition, said in the redline as the comparison says it                                                                                                          |
| SG-D | **Stale is computed when listed**, against the current version, never stored, with each place and why (COL-052); lists page at 50                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SG-E | **Who may**: read with `read`; make with `suggest`; accept and reject with `edit`; withdraw as its author with `read`, while pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SG-F | **The lock** (COL-041 to COL-043): accepting or rejecting serialises on the component (`serialise`), then refuses `lock_held`, naming the holder and expected release, where another holds it (COL-042); where it is free, the act holds it for its transaction, which is the automatic claim COL-041 asks, ending with it; where the caller holds it, refused `edits_pending` while they have saved work after the current version (make a version or discard first) **(default)**. Nothing applies one but that act (COL-043)                                                                                                                                          |
| SG-G | **Accepting cuts a version as a cut does**: the merge, the current version's values carried forward with `fixed` checked again (`values_invalid`), definitions taken as `cutVersion` takes them, SG-B's checks run again for the accepter; authored by the accepter, `suggestion.accepted` beside `content.version_cut`. A merge equal to the current version is accepted, standing in the current version. Stale refuses `suggestion_stale` with the places. Every resolving act reads the resolution after serialising, so a second answers `suggestion_resolved`                                                                                                      |
| SG-H | **Bulk** (COL-022): `POST /v1/suggestions/resolutions` with `act` and a scope - a component, or a document's placed components - and optionally an author; decided per component, each needing `edit`; at most 200 per call **(default)**, components locked in identifier order, suggestions applied oldest first, each its own version. One that is stale by then, or on a component another holds or the caller may not edit, is left pending and reported with why                                                                                                                                                                                                   |
| SG-I | **The redline**: `GET /v1/suggestions/{id}` answers the version it is drawn over and the content drawn: for a pending one that applies, the current version and the merge; otherwise the version made against and the draft, with its stale places. The client compares them with the comparison's own renderer                                                                                                                                                                                                                                                                                                                                                          |
| SG-J | **The draft editor is the component editor in a draft mode** - no lock, no iterations, its every command (toolbar, tables, figures, footnotes, references, bindings), images only where the reviewer may `create` - held in the tab's `sessionStorage` under `alloy-works:editing-` so signing out forgets it, until **Send suggestion**                                                                                                                                                                                                                                                                                                                                 |
| SG-K | **Not live**, as TH-L                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SG-L | **The `suggestion` mark stays refused** (ADR-0058); CNT-005, CNT-009 and CNT-033 stay content-model.md's: CNT-005's excluding is REU's, so the proposal cannot answer it whole                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SG-M | **Reported, not gated**: the document view and each occurrence say how many suggestions are pending, and whether the caller may suggest (`maySuggest`); the gate is T9's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Task 1: Apply - SG1

- `packages/domain/src/review/suggestions.ts`: `applySuggestion`.
- Tests: **`CNT-009`** kept identifiers, fresh where taken. **`COL-052`** **`COL-023`** each stale
  place, a result that would not parse, and nothing applied. A split, a join, a move, the author's
  reordering kept, two acceptances after one block in order, title and language.

## Task 2: Suggestions - SG2

- Migration 0077; `packages/db/src/suggestions.ts`; the shared save check; routes
  `POST /v1/components/{id}/suggestions`, `GET /v1/components/{id}/suggestions`,
  `GET /v1/documents/{id}/suggestions` (each placed component decided as the outline withholds one),
  `GET /v1/suggestions/{id}`, `POST /v1/suggestions/{id}/acceptance`, `.../rejection`,
  `.../withdrawal`, `POST /v1/suggestions/resolutions`; the `{ suggestion }` target; the document
  view's counts and `maySuggest`; audit; wire codes and rules; the sweeps.
- Tests: **`COL-020`**, **`COL-021`**, **`COL-022`**, **`COL-024`**, **`COL-025`**, **`COL-041`**,
  **`COL-042`**, **`COL-043`**, **`COL-048`**, **`COL-052`**; accept racing withdraw; a merge already
  applied; values carried; a suggestion on a component the caller may not read is not found, its
  author and version too; the runtime role cannot delete one.

## Task 3: Review, and the close - SG3

- **Suggest changes** on a card in Review, for `suggest`; the component editor's draft mode; the
  panel's **Suggestions**: pending, stale with its places, resolved; each drawn as a redline; Accept,
  Reject, Withdraw; Accept all and Reject all, for the document or a component, by author.
- Tests: the draft sent; the redline; accept and its refusal under a lock; stale said; axe in Light
  and Dark; the whole browser suite.
- The final review hunts a suggestion applied in part, an identifier lost, an acceptance passing a
  lock, and a suggestion leaking what its reader may not read. `features.md`, `README.md`,
  `architecture.md`, the CHANGELOG, the version (0.156.0) and the baseline.

## Final review

Fixed in SG3: a resolved suggestion drawn against the version it was made against; a bulk act leaving
one the save's checks refuse, or one resolved meanwhile, rather than undoing the rest; the same draft
sent again after it was resolved refused, not answered as pending; a title, language or direction
changed by hand to the draft's taken as done; a draft never written after sign-out, kept against the
version it was made from rather than dropped when a newer one is cut, its values left the
component's; a cross-reference renamed with the added block it names; the version checked before
anything is read against it. Known: a reviewer who refines a draft and sends it again has two
suggestions, both adding the block; accepting both adds it twice (withdraw the first). COL-041 is
answered by the act holding the component for its transaction; COL-043 is designed and not yet shown
by a test, so the baseline leaves it out.

## Risks

- **Coarse merges** (ADR-0059): a suggestion on a block its author also edited is stale there.
- **The draft mode** is the component editor's largest change since its split: its lock, session and
  iterations are held apart from its surface. If it will not part cleanly, SG3 claims COL-020 for
  what the draft offers and names the rest.
- **Not claimed here**: COL-027's gate (T9), COL-026 and CNT-113 (built in CP).
