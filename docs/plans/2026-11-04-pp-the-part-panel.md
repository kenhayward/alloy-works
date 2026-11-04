# PP: the Part panel, grouped and folding

> From [the handoff](../interface/handoffs/part-panel/README.md). **One PR**, Ken's call, with a small contract change, so
> a plan and no separate pre-flight beyond the review below. No migration. **R1 to R8 are Ken's rulings, 2026-11-04.**
> Decisions are in [ADR-0084](../decisions/0084-the-part-panel-is-grouped-and-folds.md).

**Goal:** a part's panel says what it is and how it is set up on one screen, every kind of part, nothing it did lost.

## Where the handoff was overruled

| #   | The handoff                          | Ruling                                                                                |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| R1  | Number it as one undoable step       | `set` takes `title`: the two were separate operations, two saves that could half fail |
| R2  | Any typed number, match undecided    | A dot required, and only where it equals what the part would take                     |
| R3  | "Here and {n} more"                  | "Only here" only with nothing hidden; "Here and elsewhere" where something is         |
| R4  | Counts in one call                   | No route: read as rows come into view, four at a time                                 |
| R5  | A new 420px centred modal            | `ConfirmDialog`, as every removal; 480px, 120px from the top (ADR-0049)               |
| R6  | An unreadable component: Layout only | Keeps Referenced by and Readers                                                       |
| R7  | The link row goes                    | Head icon only, but a field to copy by hand where the clipboard refuses               |
| R8  | Open groups "per person"             | Per browser, across documents: `aw.part.groups`                                       |

## Tasks

1. `set` names a title, its inverse (`tree.ts`), the contract. STR-076.
2. `partSummary.ts`: the typed number, the would-be number, where a part sits, where else it is used.
3. `PartPanel.tsx`: moved out of `OutlinePanel.tsx` with behaviour unchanged, tests green, before anything changed.
4. The head, the identity, the groups and what they remember.
5. Layout: Starts on from `Segmented` with icons over words, the Numbered line, the lock, Number it.
6. Fields' kinds, Readers, Links' compact rows, the pills.
7. Removal into `ConfirmDialog`, which gains `waiting`.
8. Tests moved (`DocumentPage.*`, the walks), axe states added; rendered at 280, 320 and 360px in both themes.

## Built

Differs from the above: at 280px the render found rows pushing the page sideways, which `minmax(0, 1fr)` on each grid
holds. A key the catalogue already held (`document.shown-as`) was caught by the same render, as `JSON.parse` keeps the last.
Rendered through a harness with invented data, removed after; the walks ran on a rebuilt stack.
