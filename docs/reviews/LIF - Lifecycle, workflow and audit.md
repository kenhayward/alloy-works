## One primary question ANSWERED#

IF-Q04 Do components have their own lifecycle, or only documents? A component approved once and reused in forty reports is attractive and hard - This has been very clear from customers, components must have lifecycles , the "approved" or "released" version of a component (e.g. a conclusion in a stability report) has high value and may remain approved while the surrounding document is still being polished, iterative approval of components leading to final overall approval of the finished document is a key value.

## One Gap worth documenting now

There is no mention of branch and merge - this is important in a couple of use cases - SOPs where different revisions (not version or iterations) may be effective different plants at one time and for the difference between a biopharma label CCDS and an updated component that contains revised, approved labelling text but is not yet accepted by an affiliate.

## One concrete internal inconsistency

Section 2 understates the dependencies. The traceability table (§11) itself lists LIF-030 → DAT section 9, yet DAT appears nowhere in "Rests on". Likewise COL is absent from "Rests on" even though LIF-004 makes gate conditions depend on it ("no unresolved suggestions, no open threads") and the "Not here" table concedes that review rounds live in COL. A document can declare what something is not while still depending on its data — but the dependency row should exist. This is fixable with two table rows and would make §2 consistent with §11.

## Gaps, ranked

1. Where does state live relative to revisions? LIF-005 says an artifact is in exactly one state; LIF-013 says a gate designates a revision. The working model is inferable (state belongs to the artifact, transitions fork new revisions), but it is never stated. The awkward case: artifact at Approved with rev 3 baselined — when does a rework transition create rev 4, and what state does the artifact occupy in between? One or two sentences pinning down state ownership (per artifact vs per branch/revision) would remove the document's largest ambiguity. Q04 (component lifecycle) sharpens this further but doesn't settle it for documents.

2. Publication is referenced, never owned. "From draft to issued" is in the purpose; "publication" appears twice in LIF-026 and as a deletion blocker in LIF-023 — yet no requirement defines what publication is (a state? an act?), and the "Not here" table doesn't assign it to another area. Either this needs its own small requirement cluster, or §2 must name where it lives. As written, audit records an event whose subject is defined nowhere in this document's declared scope.

3. Rejection has no requirements. LIF-026 covers refused authorisation (permission level), but a gate-level rejection — approver says no, artifact returned to author — isn't clearly covered by any listed audit event, and nothing requires that rework paths be expressible at all. LIF-002 permits them implicitly; in practice a regulator's first question after "who approved" is "what happened when it was sent back."

4. Old workflow definitions must survive. LIF-007 records which definition version an artifact moves under and the rationale paragraph worries about rules that "nobody can reconstruct" — but there is no requirement that retired versions of a workflow definition remain available indefinitely for reconstruction. Recording the version number is only half the control.

5. The log's own integrity and retention. LIF-028 requires complete exports, but nothing lets a recipient verify an export (hash chain, signature), which matters precisely when "can it be reproduced" (LIF-034) is asked of somebody else. Q02 covers immutability; verifiability of the export artifact is adjacent and separate. Also: retention policies are declarable per artifact type/space — say whether that includes the audit log itself, since LIF-029 implies it outlives its content forever.

## Smaller items worth a line or an open question

- LIF-026's event list likely leaves hold applied/removed (LIF-021/022), archival (LIF-020) and deletion to interpretation as "administrative action". If that's the intent, say so; otherwise add them.
- Concurrency: nothing addresses two simultaneous gate actions or a transition racing an edit. One requirement on transition atomicity would close it.
- Missed review date: LIF-017 prompts before the deadline; there is no stated consequence when nobody acts by it (escalation, state flag). Visibility is handled by LIF-018, but "what happens next" is open — a good Q05 candidate.
- Approval-to-effective window: LIF-015 separates the dates without saying what may change in between. A future effective date implies scheduled issuance semantics that are currently unspecified.
- "Why": LIF-027 captures who/what/when/version but not a reason for transitions. That's likely deliberate until Q01 settles, but if 21 CFR Part 11 lands first this comes back to section 4 or 7 — flagging it now so it isn't discovered in review round two.
- Timestamps: no UTC/timezone convention; Part 11-style regimes care about this at signature time.

## What I would not change

- The "able to" phrasing, the tranche/Constraint split, LIF-N03 (workflow scripting as an escape hatch is exactly right), and LIF-012's verbatim statement of intent are all well-chosen — resist later pressure to convert capability requirements into prescribed behaviour; that would break consistency with the other 20 documents.
