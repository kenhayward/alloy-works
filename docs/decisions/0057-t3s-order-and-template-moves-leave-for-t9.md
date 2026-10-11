# 0057 - T3's order, and template moves leave for T9

- **Status:** Proposed
- **Date:** 2026-10-11

## Context

T2 closed at 0.149.0 with seven TAB rows in T3 that are not collaboration: grouping (TAB-008,
TAB-042, TAB-043), transposition (TAB-021, TAB-022), emphasis rules (TAB-028) and column width by
the table style (TAB-053). [ADR-0042](0042-grouping-totals-transposition-and-emphasis-rules-move-to-t3.md)
moved them there and [ADR-0045](0045-t3-is-the-collaboration.md) kept them, so the table style is
extended once.

Read as a build order, T3's remaining rows fall into phases with clear dependencies: a baseline
before comparison, review rounds and restore; the inbox before mentions; locks before suggestions,
which may not be accepted against another holder's lock (COL-042). Five TPL rows - departures from a
template (TPL-028, TPL-029) and moving a document to a newer template version (TPL-033, TPL-034,
TPL-058) - depend on none of it and nothing in T3 depends on them. They are template governance:
reasons recorded, a move refusable, reported before it runs.

Ken decided on 2026-10-11 to finish the table rows first, then build T3 in the order below.

## Decision

**The table rows are built first, as the slice TG** ([the TG plan](../plans/2026-10-11-tg-groups-transposition-and-widths.md)),
keeping tranche T3. They do not move to T2: T2's baseline is declared and frozen, and a row moved into
it would disagree with its evidence pack.

**Then T3 in eight phases**, each designed when its turn comes ([ADR-0033](0033-t2-is-the-data-spine.md)'s
slices):

| #   | Phase                                           | Rows, chiefly                                                                                     |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | The log read, sessions and the regression guard | ADM-038, ADM-039, LIF-028, IAM-040; PUB-075, early as ADR-0045 asks                               |
| 2   | Presence and locks                              | COL-001 to COL-009, COL-044 to COL-047, COL-055, COL-056; API-014, API-015; STR-038, STR-066      |
| 3   | Baselines                                       | VER-017, VER-021, VER-046, VER-049; PUB-013, PUB-045, PUB-046, PUB-082; STY-028; DAT-038; STR-047 |
| 4   | Comparison                                      | VER-024 to VER-031, VER-045, VER-051; CNT-111 to CNT-113; SCH-025, SCH-048                        |
| 5   | Threads, mentions, the inbox, review mode       | COL-012 to COL-018, COL-051, COL-063, COL-034, COL-035, COL-062; CNT-155, CNT-157; IAM-081        |
| 6   | Suggestions and revised values                  | COL-020 to COL-027, COL-042, COL-048, COL-052; CNT-005, CNT-009; DAT-057 to DAT-063               |
| 7   | Review rounds                                   | COL-028 to COL-032, COL-057; SCH-068                                                              |
| 8   | Restore, retention and holds                    | VER-033 to VER-038, VER-044, VER-048; LIF-019 to LIF-024; CNT-161, CNT-170                        |

Phase 6 is spiked during phase 3 or 4: tracked changes that keep block identity are T3's schedule
risk, and the redline it draws decides how phase 4 renders one.

**To T9, five TPL rows**: TPL-028, TPL-029, TPL-033, TPL-034 and TPL-058, beside workflow's other
governed acts. Each keeps its identifier.

## What would change the answer

- **A tenant needs a document moved to a newer template version before T9.** TPL-033, TPL-034 and
  TPL-058 come forward together; they rest on nothing in T3.
- **The phase 6 spike finds suggestions need a different editor model.** Phases 4 to 7 are
  re-ordered around it before phase 4 is designed.

## Consequences

- T3 holds 139 rows, T9 38.
- T3's first close is TG's; its baseline carries 0.149.0's rows.
