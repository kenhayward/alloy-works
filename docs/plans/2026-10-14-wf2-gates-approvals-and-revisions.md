# WF2: Gates, approvals and revisions

> T9's second phase ([ADR-0061](../decisions/0061-t9s-order.md)), extending
> [workflow.md](../design/workflow.md). **Full tier**: stored shapes (migrations 0096 on), new routes,
> the publishing pipeline. Built inline, one final review at the phase's end (Ken, 2026-10-14).
> Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** a transition can be a gate: it passes once enough distinct approvers, none an author if it
says so, approve the current version; any approver can reject it, with a reason, back to a declared
state; passing designates a revision, and may take a baseline and request its publication, which is
then approved, with an approval page (LIF-003, LIF-008 to LIF-010, LIF-013, LIF-036, LIF-050 to
LIF-052, LIF-074, LIF-075, VER-012 to VER-015, VER-059, PUB-004, PUB-089, DAT-121).

| PR   | Holds                                                                                         |
| ---- | --------------------------------------------------------------------------------------------- |
| WF2a | This plan; gates, approvals, rejection, revisions; their routes, audit and interface (Task 1) |
| WF2b | A baseline and a publication at a gate; approved publications; the approval page (Task 2)     |
| WF2c | Query definitions under workflow (DAT-121); the final review; the close, 0.167.0 (Task 3)     |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF2-A | **A gate is a transition with `gate`** (LIF-003): `{ approvals: 1 to 10, notAuthor, reject: { name, to }, designates, baseline, publication: 'none' \| 'permitted' \| 'required' }`. Its permission is `approve`. A transition without `gate` is a permission alone, as in WF1. Validation: a gate's `reject.to` a state, `baseline` and `publication` on the document kind only, `publication` needing `baseline`.                                                                                                           |
| WF2-B | **The seed's version 2** (0096), written only where a tenant's newest is still version 1 unedited (default): Approve becomes a gate of one approver, not an author, rejecting to Draft as **Return**, designating; the separate Return transition goes. An edited workflow is the tenant's, and gains no gate.                                                                                                                                                                                                                |
| WF2-C | **Approvals** (LIF-008, LIF-009): insert-only `workflow_approval (artifact_id, kind, version_id, definition_id, transition, decision approved/rejected, reason, by, at)`, by `POST /v1/{components\|documents}/{id}/approvals { transition, version, decision, reason? }` under `lockArtifact`. One counts while the artifact is in the gate's from-state since it last entered it, and only for its current version: a save during review starts the count again (default). A second approval by the same person is refused. |
| WF2-D | **Not the author** (LIF-010) (default): nobody who recorded a version of it since its last revision, or since it was made where it has none. Refused `approval.author`.                                                                                                                                                                                                                                                                                                                                                       |
| WF2-E | **Passing** (LIF-013): the approval that makes the count moves the artifact along the gate in the same transaction, by that approver, and designates a revision where the gate says so. **Rejecting** (LIF-051, LIF-052): any one approver, a reason required, moves it to `reject.to`; audited `gate.rejected` (LIF-074).                                                                                                                                                                                                    |
| WF2-F | **Revisions** (VER-012 to VER-015): insert-only `revision_designation (artifact_id, version_id, revision_no, definition_id, transition, by, at)`, `revision_no` from 1 per artifact; a version inserted after carries the latest number in `revision_no` (VER-009), so versions read `revision.version`; none designated is revision 0. Views carry the latest revision. The approved version itself stays served to "latest approved" references in phase 4 (LIF-040).                                                       |
| WF2-G | **Audited** (LIF-075): `approval.given { kind, transition, version, count, required }`, `gate.rejected { kind, transition, version, reason }`, `revision.designated { kind, revision }`. `approval.rejected`, declared and never emitted, is withdrawn: a rejection is the gate's (default).                                                                                                                                                                                                                                  |
| WF2-H | **A baseline at a gate** (VER-059): a document gate with `baseline` takes one, named "Revision N", by the approver who passed it, `baseline.gate` naming the transition (0072's check widened).                                                                                                                                                                                                                                                                                                                               |
| WF2-I | **Approved publications** (PUB-004, LIF-050): a publication from a gate's baseline records `approval: 'approved'` and prints no **Not approved** notice; one from a person's baseline stays a draft. `publication: 'required'` requests one (the layout's default formats) as the gate passes; `'permitted'` offers **Approve and publish** beside **Approve**.                                                                                                                                                               |
| WF2-J | **The approval page** (PUB-089): a layout's matter declares `approvals`; an approved publication prints a page listing each approval of the revision (who, when, version, gate) in the PDF and Word; a draft prints none. A new layout schema version, older layouts unchanged.                                                                                                                                                                                                                                               |
| WF2-K | **Query definitions** (DAT-121): a third workflow kind, `queryDefinition`, seeded as the others, its state and gates on the definition's page; a definition in force is its newest version, approved or not, until phase 4 brings "latest approved" (default).                                                                                                                                                                                                                                                                |
| WF2-L | **The interface**: in both headers, the revision ("Revision 2") and, in a gate's from-state, "1 of 2 approvals" with **Approve** and **Return** for an approver; an Approvals list (who, when, version, decision, reason) on the History tab; Administration > Workflows edits a transition's gate.                                                                                                                                                                                                                           |

## Task 1: Gates, approvals, rejection, revisions - WF2a

- The gate in domain; 0096 (both tables, the seed's version 2, the audit kinds); `workflow.ts`'s
  approvals, passing, rejecting and designating; the routes and views; the interface (WF2-L).
- Tests: a gate passing at its count, by distinct people; an author refused; a second approval
  refused; a save restarting the count; a rejection to its state, with a reason, audited; a revision
  designated, numbered, and later versions carrying it; revision 0; the seed's version 2 only where
  unedited; a gate refused validation; the browser walks.

## Task 2: A baseline and a publication at a gate - WF2b

- `baseline.gate`; the publication's `approval: 'approved'` and status; the gate's publication request;
  the approval page in the layout, Typst and Word.
- Tests: a gate's baseline named and pinned; an approved publication without the notice, a person's
  baseline's with it; publication required and permitted; the approval page listing each approval;
  older layouts unchanged; the conformance suites.

## Task 3: Query definitions, the review and the close - WF2c

- `queryDefinition` as a kind; the definition page's state and gate.
- The final review hunts an approval counted that should not be, a revision designated without a gate,
  an approved publication not from a gate's baseline, and a state or approval leaked to a reader.
  `features.md`, `README.md`, `architecture.md`, the CHANGELOG, the version (0.167.0), the baseline.

## Changed while building

| Found                                                                                                                       | Change                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Approve and Return were each a transition in version 1                                                                      | The seed's version 2 (0096) and, for documents, version 3 (0097), written only where a tenant never edited its workflow |
| `approval.rejected` and `gate.rejected` named one act                                                                       | `approval.rejected` withdrawn                                                                                           |
| An approved publication's notice cannot be omitted by template 21                                                           | `publishing/22` and template 22, pipeline 25; the approval page added to layouts at schema 7 in place                   |
| A gate's publication refused after its baseline was made                                                                    | Thrown, so the transaction keeps nothing; a gate's own formats never refuse but by a broken store                       |
| WF2b and WF2c as two PRs                                                                                                    | One, after WF2a merged (ADR-0039)                                                                                       |
| The final review: approved again on an unchanged version, the gate's baseline name was taken, and the gate refused for good | The gate keeps the baseline it took of that version; a name taken by a person's gives "Revision N (2)"                  |
| The final review: the approval page listed approvals of earlier rounds, and an address where a person had no display name   | The round that passed alone, by display name                                                                            |
| The final review: an approver without `publish` passes a gate taking a baseline or requiring a publication                  | Recorded as the gate's act in workflow.md; asking for a permitted one needs `publish`                                   |
| The final review: Return was hidden from an approver who had approved                                                       | Shown; only Approve is withheld                                                                                         |

## Built

WF2a #617, and WF2b with WF2c and the close (0.167.0) #619, one PR rather than two (ADR-0039). LIF-005
stays unclaimed, and a reference following the latest approved revision is phase 4's.
