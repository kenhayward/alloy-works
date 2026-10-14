# Workflow

Where a component or a document stands in its working life: one state of its kind's workflow, moved
along declared transitions by whoever each permits ([ADR-0061](../decisions/0061-t9s-order.md), phase
one). Built by [the WF1 plan](../plans/2026-10-14-wf1-workflow-definitions-and-states.md); its
decisions, WF-A to WF-K, are the detail. Approvals, gates and revisions are phase 2's.

## Requirements owned

| Requirement | How                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIF-001** | Definitions, below: per kind, per tenant, saved by an administrator, seeded but never fixed; "per artifact type" read as per kind, as LIF-019's is (Ken, 2026-10-14) |
| **LIF-002** | Each transition declares from, to, the permission it needs and whether it asks for a reason                                                                          |
| **LIF-007** | Every save a new version; every move records the version that decided it (WF-E)                                                                                      |
| **LIF-054** | Every version kept, insert-only, and read by `GET /v1/workflows/{kind}/versions/{n}`                                                                                 |
| **LIF-061** | A transition may require a reason, refused without one (`reason_required`), kept on its move's row                                                                   |
| **SCH-060** | Search, below: a filter and a facet on the state's key, the artifact's state now                                                                                     |

**Not claimed:** LIF-005, one state shown wherever the artifact appears: the interface shows it in
the headers, both lists, search, the picker and the Part panel (below), but not in Home's attention,
whose items carry no state, nor the inbox, the relationships panel or baselines (WF-G). LIF-036 asks for a component approvable on its own, and LIF-075 for an
approval's own event: both need phase 2's approvals. `workflow.transitioned` is emitted here and
[audit.md](audit.md) lists it. LIF-040's approved revision staying designated waits for phase 2's
designation; the move to draft on a save is here.

## Definitions

**Per kind** (WF-A): one workflow for components, one for documents. A **definition** is an
insert-only `workflow_definition` row (0095): kind, version, body, who and when; the newest per kind
is in force. Version 1 of each is seeded, by nobody: Draft (initial), In review, Approved (approved);
Submit (Draft to In review, `edit`), Return (In review to Draft, `approve`, reason), Approve (In
review to Approved, `approve`), Reopen (Approved to Draft, `edit`, reason). Return and Approve need
`approve`, so whoever reviews does both and an editor alone cannot approve.

**The body** (`packages/domain/src/workflow/`): states with a key, a name, `initial` and `approved`;
transitions with a key, a name, `from`, `to`, `permission` (`edit` or `approve`) and
`reasonRequired`. Refused, each problem named (`workflow_invalid`): a key used twice, not one initial
state, an initial state that counts as approved (every save would leave and re-enter it), a transition naming no state or moving to its own, a state unreachable from the initial one.

**Saved** by `POST /v1/workflows { kind, basedOn?, states, transitions }` (`workflow_behind`, 409, where another version was saved since `basedOn`), `administer` at the tenant, under the kind's advisory lock,
so two saves take turns and make two versions; the body in force again changes nothing. Audited as
`workflow.defined` `{ kind, version }`. `GET /v1/workflows` lists each kind's definition in force and
how many of the kind, deleted ones aside, sit in each state.

## State

**The latest move is the state** (WF-D): `workflow_transition` (0095), insert-only and guarded as
`artifact_archival` is, holds each move: the artifact, its kind, the version current, the transition
key, from, to, the definition version that decided it, the reason, who and when. `(definition_id,
kind)` references the definition, so a component never moves under the document workflow; a
trigger refuses a row whose `from` is not the state before it. `createArtifact` writes the first row,
the initial state with no transition and no version yet, before the first version is indexed; 0095
wrote one per existing artifact, in Draft under version 1, at its latest version.

**The newest definition decides** (WF-E): a move, and the transitions offered, come from the newest
version wherever it has the artifact's state, so a tightened permission applies at once; an artifact
in a state the newest dropped moves under its recorded version. Nothing moves an artifact silently.

**Moving** (WF-F): `POST /v1/{components|documents}/{id}/transitions { transition, from, reason? }`,
`read` by the route, then the transition's permission on the artifact; under the artifact's lock,
refused by name if it moved since (`state_moved`, with where it is), the transition is not one from
its state (`transition_unknown`), it is archived (`artifact_archived`, WF-K), or a required reason is
missing (`reason_required`). A deleted one is gone, as everywhere. Audited as `workflow.transitioned`
`{ kind, transition, from, to, definition, reason }`, `reason` saying whether one was given: the
reason is a value, so the row keeps it, never the log (LIF-030).

**A save of an approved one starts a draft** (WF-F; LIF-040): every version the chain records after
the first (`record` in `versions.ts`: the editor's save, a document's outline, values and
parameters, a restore, an accepted suggestion) moves an artifact in a state marked `approved` to the
initial state in the save's transaction, with no transition key, audited naming the version that was
approved. A save in any other state leaves it.

**Shown** (WF-G): a component's and a document's view carry `state { key, name, approved }` and the
transitions the reader may take (none while archived); both lists and search results carry
`{ key, name }`. A `workflow` stream event, `{ artifact, state }`, reaches a document's or a
component's stream for the artifact itself or a component in it the viewer may read, and nobody else
(`stream.ts`).

**In the interface** (WF1b): a lozenge (`StateLozenge`; the seed's three in their tones, any other
state neutral) in the document and component headers beside Archived, both lists, the space pane,
search results, beside the component Add component would place, and in the Part panel for a placed
component the reader may read (from the listing of what they may, so never another). Each transition
offered is a header button sending the state it was seen in; a reason asked for first where required;
a refusal said in the service's words, the state read again where it moved. A page reads its state
again on the `workflow` event; a placed component's comes from the event itself. Before the first
save of an approved one, the page says a save starts a new draft. Home's attention carries no state
and shows none; the inbox, the relationships panel and baselines stay out (WF-G).
Administration > Workflows edits each kind's states and transitions and saves the next version.

## Search

**The artifact's state now** (WF-H), as `archived` is: `search_entry.workflow_state` and
`search_history`'s, set by indexing and by every move; a section's row carries its document's. Not on
`search_earlier`: an earlier version's row reads its artifact's state when searched, so a baseline's
search filters on the current state. `state=` filters by key and `facets.states` counts each, named
by the definitions in force. Indexed on both tables (0095), on the bounded roads as #605's filters.
