# Workflow

Where a component or a document stands in its working life: one state of its kind's workflow, moved
along declared transitions by whoever each permits ([ADR-0061](../decisions/0061-t9s-order.md), phase
one). Built by [the WF1 plan](../plans/2026-10-14-wf1-workflow-definitions-and-states.md); its
decisions, WF-A to WF-K, are the detail. Gates, approvals and revisions are
[the WF2 plan](../plans/2026-10-14-wf2-gates-approvals-and-revisions.md)'s (WF2-A to WF2-L).

## Requirements owned

| Requirement | How                                                                                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIF-001** | Definitions, below: per kind, per tenant, saved by an administrator, seeded but never fixed; "per artifact type" read as per kind, as LIF-019's is (Ken, 2026-10-14)                                                                                                  |
| **LIF-002** | Each transition declares from, to, the permission it needs and whether it asks for a reason                                                                                                                                                                           |
| **LIF-007** | Every save a new version; every move records the version that decided it (WF-E)                                                                                                                                                                                       |
| **LIF-054** | Every version kept, insert-only, and read by `GET /v1/workflows/{kind}/versions/{n}`                                                                                                                                                                                  |
| **LIF-061** | A transition may require a reason, refused without one (`reason_required`), kept on its move's row                                                                                                                                                                    |
| **LIF-005** | One state at a time (the transition table's latest row), shown wherever the artifact appears: both headers, both lists, search, the picker, the Part panel, Home's attention, the inbox and a baseline's page (the document's state now) ([In the interface](#state)) |
| **SCH-060** | Search, below: a filter and a facet on the state's key, the artifact's state now                                                                                                                                                                                      |
| **LIF-003** | Gates, below: a transition needs a permission alone, or is a gate needing approvals by whoever may approve                                                                                                                                                            |
| **LIF-008** | Each approval a row: who, when, the version, the gate (`workflow_approval`)                                                                                                                                                                                           |
| **LIF-009** | A gate's `approvals`, each by a distinct person                                                                                                                                                                                                                       |
| **LIF-010** | A gate's `notAuthor`: whoever recorded a version since the last revision is refused (`approval_author`)                                                                                                                                                               |
| **LIF-036** | Both kinds have workflows and gates; a component passes its own                                                                                                                                                                                                       |
| **LIF-051** | Any approver rejects, with a reason, kept with who, when, the version and the gate                                                                                                                                                                                    |
| **LIF-052** | A rejection returns it to the gate's declared `reject.to`, the rework path in the definition                                                                                                                                                                          |
| **LIF-074** | `gate.rejected`, an event of its own                                                                                                                                                                                                                                  |
| **LIF-075** | `workflow.transitioned` and `approval.given`, each an event of its own                                                                                                                                                                                                |
| **LIF-013** | Passing a gate designates a revision, and a document's gate may take a baseline                                                                                                                                                                                       |
| **LIF-050** | A document's gate may permit or require an approved publication of its baseline; the request is audited as any is                                                                                                                                                     |
| **VER-059** | A document's gate with `baseline` takes one as it passes, named for its revision, naming the gate                                                                                                                                                                     |
| **DAT-121** | Query definitions, below: a workflow of their own, gated as content's, a change after approval a draft                                                                                                                                                                |
| **LIF-004** | What a transition requires, below: no unresolved suggestions, no open threads, no failed bindings, no missing required sections, checked as it is taken                                                                                                               |
| **LIF-039** | A document's transition may require every component it assembles at an approved revision, naming each that is not                                                                                                                                                     |
| **COL-066** | `suggestions`: none unresolved on a component, or on any component a document assembles                                                                                                                                                                               |
| **DAT-123** | `revisions`: no value revised by hand standing in front of a binding's result                                                                                                                                                                                         |
| **LIF-038** | A reference may track its component's latest approved revision, beside pinned and latest: [The latest approved revision](#the-latest-approved-revision)                                                                                                               |
| **REU-050** | Each reference takes one of the three modes, shown on its label and in the outline                                                                                                                                                                                    |
| **LIF-041** | A reference tracking the latest approved revision says when a newer one is approved than the document's last publication carried, and compares them                                                                                                                   |
| **LIF-077** | A save of an approved component starts a draft (WF-F), its revision stays designated and effective, and every reference tracking the latest approved revision is served it ([The latest approved revision](#the-latest-approved-revision))                            |
| **LIF-015** | Dates, below: an effective date set apart from approval, an act (`artifact_dates`)                                                                                                                                                                                    |
| **LIF-016** | A review-by day, set beside it with its owner                                                                                                                                                                                                                         |
| **LIF-017** | Home's **Review due** for the owner, from the days the workflow's review policy says before the day                                                                                                                                                                   |
| **LIF-018** | **Past review** on the artifact's header and in the lists, and on the label of every reference to it in a document                                                                                                                                                    |
| **LIF-059** | The workflow's `review.lapse`: shown alone, a move to a state by nobody, or an escalation to a person, acted on once per day passed                                                                                                                                   |
| **LIF-060** | A future effective date fixed to the revision approved, served only from that instant, its taking effect `revision.effective` by the system                                                                                                                           |

VER-012 to VER-015 are [storage-and-versioning.md](storage-and-versioning.md)'s, built below. LIF-040
was superseded by LIF-077, claimed below: a reference floating at latest takes a draft by its author's
choice.

## Definitions

**Per kind** (WF-A): one workflow for components, one for documents, and since WF2 one for query definitions. A **definition** is an
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
save of an approved one, the page says a save starts a new draft. Home's attention, the inbox and a
baseline's page show it too (LIF-005): the inbox only of what its reader may read, a baseline's page
the document's state now, beside what it pins. No relationships panel exists yet; one shows it too.
Administration > Workflows edits each kind's states and transitions and saves the next version.

## Search

**The artifact's state now** (WF-H), as `archived` is: `search_entry.workflow_state` and
`search_history`'s, set by indexing and by every move; a section's row carries its document's. Not on
`search_earlier`: an earlier version's row reads its artifact's state when searched, so a baseline's
search filters on the current state. `state=` filters by key and `facets.states` counts each, named
by the definitions in force. Indexed on both tables (0095), on the bounded roads as #605's filters.

## Gates

**A gate is a transition with `gate`** (WF2-A; LIF-003): `{ approvals, notAuthor, reject { name, to },
designates, baseline, publication }`, its permission `approve`. Validated beside the body: a gate's
permission `approve`, its `reject.to` a state, a baseline or a publication on the document kind only, a
publication only with a baseline. A rejection's state counts as reached. The seed's **version 2**
(0096; WF2-B), written only where a kind's newest was still version 1: Approve a gate of one, not an
author, rejecting to Draft as Return; Return no transition of its own. A plain move along a gate is
refused (`transition_gated`).

**Approvals** (WF2-C; LIF-008, LIF-009): `POST /v1/{components|documents}/{id}/approvals
{ transition, version, decision, reason? }`, on `approve`, under `lockArtifact`. Each is a
`workflow_approval` row (0096), insert-only, in the **round** that began with the move into the gate's
from-state, against the version the approver saw (`version_moved` where it was replaced). One counts
while it is in the round and for the current version alone, so a save during review starts the count
again; a second by the same person is refused (`approval_given`). **Not its authors** (WF2-D;
LIF-010): whoever recorded a version since its latest revision, or since it was made.

**Passing and rejecting** (WF2-E): the approval that makes the count moves it along the gate in the
same transaction, by that approver, and designates a revision where the gate says so. Any one approver
rejects, with a reason, to `reject.to` (LIF-051, LIF-052). Audited (WF2-G): `approval.given`, then
`workflow.transitioned`, then `revision.designated`; a rejection `gate.rejected` and the move.
`approval.rejected` is withdrawn: a rejection is the gate's.

**Revisions** (WF2-F; VER-012 to VER-015): `revision_designation` (0096), insert-only, a version
designated once, numbered from 1 per artifact. A version recorded after one carries its number and
counts again from 1 (VER-009), so versions read `revision.version`; none designated is revision 0.
Approved again unchanged, a version keeps its revision. Views carry `revision { number, versionId, at }`
and `gates`, each with its count, what it needs, whether the caller approved and may decide.

**In the interface** (WF2-L): a header shows **Revision N** beside the state, and at a gate its count
("1 of 2 approvals") with **Approve** and the rejection's name for whoever may decide, a rejection
asking why. Who decided what, newest first, is listed under a component's and a document's Versions panel; a query definition's is read through the API.
`GET /v1/{components|documents}/{id}/approvals` reads it, on `read`. Administration > Workflows makes a
transition a gate and sets its approvers, its author rule and where a rejection returns.

## A baseline and a publication at a gate

**A baseline** (WF2-H; VER-059): a document's gate with `baseline` takes one as it passes, by the
approver who passed it, named "Revision N" for the revision it designates, `baseline.gate` its
transition (0097 widened 0072's check). It is made before anything is recorded, so a gate whose
baseline cannot be made - a part the approver may not read, a failure a publish would record -
records nothing and refuses the approval (`gate_baseline_refused`).

**A publication** (WF2-I; LIF-050, PUB-004): `publication: 'required'` requests one of that baseline
as the gate passes, in every format its layout makes; `'permitted'` offers **Approve and publish** to
an approver who may also publish (`publish: true`). A publication from a gate's baseline records
`approval: 'approved'` and prints no notice; one from a person's baseline stays a draft. The document
seed's **version 3** (0097), only where its newest was still the seed's version 2: Approve takes a
baseline and permits a publication.

**The gate's acts** (the WF2 final review, 3): a baseline a gate takes, and a publication it requires,
are the gate's, as its definition, set by an administrator, declares: an approver passes such a gate
without `publish`. Asking for a publication a gate only permits is publishing, and needs `publish`.
Passed again on an unchanged version, a gate keeps the baseline it took of it; a name a person's
baseline holds first gives the gate's "Revision N (2)". The approval page lists the round that passed
alone, by display name, never an address.

**The approval page** (WF2-J; PUB-089) is [publishing.md](publishing.md)'s: a layout's
`matter.approvals`, listing each approval of the version published.

## Query definitions

**Their own workflow** (WF2-K; DAT-121): `queryDefinition` is a third kind (0098 widened every table's
check), seeded at version 1 as the component seed's version 2, Approve a gate; every query definition
there was starts in draft. A definition moves, is approved and is rejected as content is, by
`/v1/query-definitions/{id}/transitions` and `/approvals`, its view carrying its state, gates and
revision, its page showing them beside its version. A version saved after approval starts a draft.
Which version a binding resolves stays its newest, approved or not: a binding has no mode to track an
approved one, which WF4 left as it was.

## What a transition requires

**`requires`** (the WF3 plan; LIF-004): a transition, a gate or not, may name conditions, each at most
once: `suggestions` (none unresolved, COL-066), `threads` (none open), `bindings` (every binding
resolved and current, as a publish asks), `sections` (no required section missing, TPL-013),
`revisions` (no value revised by hand outstanding, DAT-123) and `components` (every component
assembled at an approved revision, LIF-039). A component's may require the first two; a document's
any; a query definition's none, which has neither suggestions nor threads (`condition_kind`). A body
stored before it has none.

**Checked as it is taken** (WF3-B): a move, and every approval at a gate, so a gate never collects
approvals it cannot pass on; a rejection and the draft a save starts never are. Refused
`conditions_unmet`, nothing recorded, the refusal listing each condition with a count, and its message
saying them ("Not yet: 1 open thread.").

**Read as whom** (WF3-C, WF3-D): a document's suggestions and threads, its own and every assembled
component's, are counted whoever may read them, and never shown. Bindings, revisions and components
are read as the person taking it, as a gate's baseline is: a component they may not read leaves those
unproven, so unmet, counted and never named. Sections and components not approved are named by title.

**At an approved revision** (WF3-E): the version a reference resolves to is a designated revision; an
`approved` reference resolves to its latest revision (WF4), so is met, and one with none is not. Every placement is
judged, so a component placed twice passes only if both do (the final review).

## The latest approved revision

**Resolved** (the WF4 plan, WF4-A; LIF-038, REU-050): an `approved` reference takes the version its
component's latest revision designates, in `resolveOccurrences` and `numberingInputs`, so every reader
of a reference - publishing, previews, baselines, the view's texts, numbering, comparison, bindings -
reads it, of a component the reader may read. None designated is unresolved, as it always was: a
publish fails it `occurrence_unresolved`, and a transition requiring `components` fails it (WF4-F).

**Moved** (WF4-E; LIF-041): the view's texts carry, for an `approved` occurrence, its `revision`, and
`moved`, the version the document's latest publication not failed carried for that node, where it is
of the same component and older than the one shown now: a publication that carried a newer version,
at the latest or pinned, has not been moved past (the final review). Never published, nothing has
moved. A baseline's publication counts as the document's last, as a gate's approved one is.

**LIF-077** (LIF-040 superseded): a save of an approved component starts a draft and leaves its
revision designated, and effective once its date passes (WF5), served to every reference tracking the
latest approved revision; a reference at the latest takes the draft, by the mode its author chose.

## Dates

**Set as acts** (the WF5 plan, WF5-A; LIF-015, LIF-016): `PUT /v1/{components|documents}/{id}/dates`
on edit inserts an `artifact_dates` row (0099), its latest the artifact's dates: an effective instant
with the offset it was set in (LIF-062), a review-by day, and an owner who may read it. Audited
`dates.set`. Components and documents only.

**Effective** (WF5-B to WF5-D; LIF-060): a gate designating a revision while the effective instant is
still to come records it in `revision_effective`, fixed; the version itself never changes, and any
change is a new version, a draft through the gate again (WF-F). `latestRevisionsOf`, which every
`approved` reference resolves through, takes the latest revision in effect, so a reference serves the
revision before until the instant. One
effective date governs every approval until it passes; to approve one to take effect at once, clear
or change the date first (the final review). The worker's `sweepDates` records `revision_effected` and
`revision.effective` once, as the system; serving does not wait for it.

**Reviewed** (WF5-E to WF5-H; LIF-017, LIF-018, LIF-059): a body's optional `review { remind, lapse }`,
absent 30 days and visibility alone (ADR-0061). Home tells the owner **Review due** from `remind`
days before the day. Once the day has passed, `sweepDates` acts once per day passed (`review_lapse`,
`review.lapsed`): nothing more, a move by nobody (`transition: null`), or **Review overdue** on the
named person's Home while that day stands. A move goes only to a state the definition deciding the
artifact's next move has, else the lapse is shown alone. Two sweeps at once act once: the first
`review_lapse` or `revision_effected` row wins. A review-by day passes at midnight UTC. **Past review** is computed when read, from the day, on
the views, the lists and each occurrence in a document's texts.
