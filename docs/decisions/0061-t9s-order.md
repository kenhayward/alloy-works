# 0061 - T9's order

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

T3 closed at 0.164.0, and SV3 at 0.165.0. [ADR-0047](0047-workflow-leaves-t3-for-t9.md) builds T9,
the workflow, next and before T4, whose divergent revisions and "latest approved" references rest on
it. T9 holds 45 rows: 27 LIF, 5 TPL, 5 VER, 3 CNT, 2 DAT, and one each of COL, PUB and SCH.

Read as a build order, they fall into phases with clear dependencies. A workflow definition comes
before any gate. A gate comes before the revision it designates, the conditions it checks and the
approvals it records. A component's approved revision comes before a reference can track it. Dates
and template governance rest on the rest, and nothing rests on them.

Three rows reach past T9:

- **LIF-065**: a gate requires a complete profile, and profiles are T4's (REU-022, REU-053).
- **LIF-068**: an audit event for a transition, an approval and a signature. Signatures are
  regulated sign-off, T7's (ADR-0045).
- **REU-050**, in T4, is the three reference modes. Pinned and floating are built. The third,
  tracking the latest approved revision, is LIF-038's, which is T9's.

## Decision

**T9 in six phases**, each designed when its turn comes ([ADR-0033](0033-t2-is-the-data-spine.md)'s
slices), each a slice with its own plan:

| #   | Phase                           | Rows                                                                                                             |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Workflow definitions and states | LIF-001, LIF-002, LIF-005, LIF-007, LIF-036, LIF-061; SCH-060; LIF-075 (a transition)                            |
| 2   | Gates, approvals and revisions  | LIF-003, LIF-008 to LIF-010, LIF-013, LIF-050 to LIF-052, LIF-074; VER-012 to VER-015, VER-059; PUB-089; DAT-121 |
| 3   | What a gate requires            | LIF-004, LIF-039; COL-066; DAT-123                                                                               |
| 4   | The latest approved revision    | LIF-038, LIF-041; REU-050; CNT-159, CNT-163, CNT-183                                                             |
| 5   | Effective and review-by dates   | LIF-015 to LIF-018, LIF-059, LIF-060                                                                             |
| 6   | Template governance             | TPL-028, TPL-029, TPL-033, TPL-034, TPL-058                                                                      |

**Every tenant starts with one workflow**: draft, in review, approved, for documents and components
alike, editable on the administration page (ADR-0049). LIF-001 asks for workflows declared and
configurable, not that a tenant writes one before it can work.

**Archival, holds and deletion stay outside workflow states.** They are records (ADR-0047, ADR-0060),
not steps in a workflow, so an archived document keeps the state it was archived in, and LIF-005's
one state at a time is the workflow's alone.

**LIF-Q06 is answered "visibility alone"**: a review date passing with nobody acting changes nothing
but what is shown, unless the workflow definition declares more (LIF-059).

**Moves, each keeping its identifier:**

- **LIF-065 to T4**, beside the profiles it checks.
- **REU-050 to T9**, phase 4, which builds its third mode.
- **LIF-068 is split**: superseded by **LIF-075** (T9: a transition and an approval) and **LIF-076**
  (T7: a signature, with regulated sign-off).

## What would change the answer

- **A customer needs approvals before the whole tranche.** Phases 1 and 2 are a fixed workflow with
  approvals: they release alone, before T9 closes.
- **A customer needs a regime's signature (LIF-Q01).** ADR-0045's regulated slice comes forward onto
  phase 2's approvals, with LIF-076.
- **A tenant needs a document moved to a newer template version first.** Phase 6 rests on nothing
  here and comes forward.

## Consequences

- T9 holds 46 rows, 45 neither withdrawn nor superseded; T4 still holds 125, REU-050 out and LIF-065
  in; T7 gains LIF-076.
- A publication of an approved document stops being marked **Not approved** in phase 2
  (publishing.md's PUB-093).
- T4's REU-009, approved versus draft, and REU-034's cohort approval rest on phase 2.
