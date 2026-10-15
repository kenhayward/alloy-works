# R1: Where a component is used

> T4's first slice, extending [relationships.md](../design/relationships.md). **Full tier**: a new
> route and contract, a new publish failure code. Built inline, one final review at the slice's end
> (Ken, 2026-10-14). Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** a component's readers see every document that places it, how each reference follows it, and
the baselines and publications that pin it; saving a version warns first where it will reach a
document, approved ones apart from drafts; and a publish tells a component that is gone from one the
publisher may not read (REU-001, REU-003, REU-005, REU-007, REU-008, REU-009, REU-043).

| PR  | Holds                                                                            |
| --- | -------------------------------------------------------------------------------- |
| R1a | This plan; the uses read and route; `occurrence_gone` (Task 1)                   |
| R1b | The Used in tab; the warning on Save version; the final review; 0.172.0 (Task 2) |

## T4's order (sketch)

Each slice is designed when the last is built. R1 where-used; R2 impact before a change and the
reference index it walks (REL-022 to REL-024, REL-032, REL-050), and REU-046 and REU-054, which report
what a reference pulls in; R3 local overrides (REU-011 to REU-015); R4 variables (REU-016 to REU-019,
REU-037, REU-038); R5 conditions and profiles (REU-020 to REU-027, REU-047); R6 bulk generation
(REU-031 to REU-035, REU-049); R7 relationship types and the graph (REL). The rest of T4's areas join
the slice they serve.

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-A | **Computed when asked, not indexed yet** (default). Where-used reads each document's latest outline with `jsonb_path`, as `deletion.ts` and the dataset uses do (the D3 plan's Q1). The design's `reference` index arrives with R2, whose traversal and pre-save budget need it; one read moves onto it then.                                                                                                                                                                                      |
| R1-B | **`GET /v1/components/{id}/uses`**, on read of the component (else 404): each document whose latest version places it, those the caller may read named with their state and whether it is approved, and each reference there by node with its mode (`latest`, `approved`, or `pinned` with the version number), the rest flagged, never counted (SCH-032, REL-020); and the baselines and publications that pin a version of it, named or flagged the same way. A deleted document is never named. |
| R1-C | **What a change reaches** (REU-007): `latest` now, `approved` once a revision is approved, `pinned` never. Said per reference, so the page and the warning share one reading.                                                                                                                                                                                                                                                                                                                      |
| R1-D | **The warning is at Save version** (REU-008, REU-009): working changes reach no document; a version reaches every `latest` reference at once and every `approved` one at its next approval. Before saving, the editor reads the uses; where any `latest` or `approved` reference exists it asks first, approved documents listed apart from drafts, the unreadable flagged. Pinned references alone ask nothing. A warning, not a refusal: the service enforces nothing new.                       |
| R1-E | **Gone, or not yours to see** (REU-005, REU-043): `occurrence_unreadable` splits; a referenced component deleted, or no artifact at all, fails `occurrence_gone`. One that exists and the publisher may not read stays `occurrence_unreadable`, naming the node alone. Appended to the closed enum, never renamed.                                                                                                                                                                                 |
| R1-F | **REU-001 and REU-003 are claimed by tests**: a reference across spaces to a component the author may read, and one component placed twice, each publishing with both occurrences distinct. Both already hold.                                                                                                                                                                                                                                                                                     |
| R1-G | **REU-052 stays specified.** It asks where-used over terms, bibliography entries, vocabulary values and styles, which do not exist yet. REU-006 stays designed until R2's index.                                                                                                                                                                                                                                                                                                                   |

## Task 1: The uses read - R1a

- Db: `componentUses(trx, principal, id)`. `workflowStates` gains `approved`. Publishing: `gone` beside
  `unreadable`. Contract, route, documentation, census lists.
- Tests: named and flagged; each mode; a deleted document unnamed; baselines and publications; 404 to
  a non-reader; gone against unreadable; REU-001 and REU-003.

## Task 2: The page - R1b

- The component page's **Used in** tab; Save version's confirmation; failure words.
- Tests: the tab; the warning, approved apart, and none for pins alone; the browser walks. The final
  review hunts a name leaked to a non-reader and a reference a change reaches that the warning misses.
  The close: 0.172.0.
