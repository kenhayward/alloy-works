# 0047 - Workflow leaves T3 for T9

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

[ADR-0045](0045-t3-is-the-collaboration.md) left T3 holding 186 rows, three quarters of them not yet
designed. Read by the work they imply, about a third were still not collaboration. The largest piece
was workflow: states and transitions declared per artifact type and configurable per tenant, with
versioned definitions (LIF-001, LIF-002, LIF-007), gates, approvals and rejection, component
lifecycles and effective and review-by dates - a product in its own right. Jobs in the API (API-040
to API-044, API-057) and query cost attributed and limited (DAT-053, DAT-071) serve bulk work. Home's
recently opened list (SCH-069) is navigation.

Ken decided on 2026-10-08 to move workflow out of T3 whole, and the rest as below.

## Decision

**Workflow is a tranche of its own, T9 - The workflow**, built after T3 and before T4. T4's
revisions that diverge, more than one effective at once, rest on T9's revisions and effective dates,
so T9 cannot follow T4. It is numbered T9, not inserted as T4, so that no row, baseline or record
renumbers; [Project_Scope.md](../specification/Project_Scope.md) section 12 lists it after T3. Every
row moved keeps its identifier; only its tranche changes.

**To T9, 33 rows**: LIF's states, transitions, gates, approvals, rejection, component lifecycles and
dates (25: LIF-001 to LIF-005, LIF-007 to LIF-010, LIF-013, LIF-015 to LIF-018, LIF-036, LIF-038,
LIF-039, LIF-041, LIF-050 to LIF-052, LIF-059 to LIF-061, LIF-065); revisions, which exist only as
a gate's designation (VER-012 to VER-015); choosing a revision and showing the latest approved one
(CNT-159, CNT-163); the approval page (PUB-089); narrowing search by workflow state (SCH-060).

**To T4, 8 rows**: API-040 to API-044 and API-057, jobs, beside parameterised bulk generation; DAT-053
and DAT-071, query cost attributed and limited, which bulk generation is what strains.

**To T7, SCH-069**, beside saved searches. SCH-068, what is waiting on a person, stays.

**Kept in T3:** the audit log (LIF-026 to LIF-028, LIF-032, LIF-056, LIF-057, LIF-064) and
retention, archival, hold and deletion (LIF-019, LIF-020, LIF-022, LIF-024), which are records, not
workflow. Rows with a gate half keep their other half in T3: COL-027 and DAT-061 report unresolved
suggestions and outstanding revisions; VER-021's baselines are explicit acts. Each gate half waits for
T9. API-050, the synchronous surface's objectives, is not a job and stays.

## What would change the answer

- **A customer needs approvals before T3 closes.** Then a fixed default workflow (draft, in review,
  approved) comes forward as one slice, LIF-008 to LIF-010, LIF-013 and VER-012 to VER-015, leaving
  per-type and per-tenant configuration (LIF-001, LIF-002, LIF-007) in T9.
- **Regulated sign-off is needed.** ADR-0045's slice now sits on T9's approvals rather than T3's.

## Consequences

- T3 holds 144 rows, from 186; T4 121, from 113; T7 152, from 151; T9 33. The trace accepts T9.
- Claims move with their rows: storage-and-versioning.md's on VER-012 to VER-015 now answer T9 rows.
- LIF-026's list names workflow transitions and approvals as audit events; T3's log records them once
  T9 produces them.
- T3 no longer delivers an approved document, so a T3 publication is still marked **Not approved**.
