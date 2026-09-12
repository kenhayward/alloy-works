## Gaps worth closing (ranked by weight)

1. Applying a suggestion vs. an active lock (§4 × §6) — the main underspecified interaction. COL-025 keeps suggestions visible against a locked component, and COL-006 says a lock never blocks suggesting. But accepting a suggestion writes content into that component, which collides head-on with "editable by one user at a time" (COL-005). The spec doesn't say whether accept/reject needs the lock, bypasses it as a review act, or queues until release. This is the intersection where two of your own sections read independently; pin down the mechanism before it's a design decision made in code review.

2. In-flight work at every lock transition except timeout. The COL-010 note reassures us that timeout loses nothing (iterations retained), but says nothing about what happens to unsaved edits when a component is stolen (COL-009) or lost in a claim race (two users auto-claiming an unlocked one at once under COL-005). Given N01 rules out co-editing, the claim race is the reason locks exist — define the loser's experience: immediate notice, and where their draft goes.

3. The COL-008 / COL-009 relationship is ambiguous. Auto-release after "a declared period of inactivity" vs. takeable "from an idle holder, with a warning." Is stealing only possible once that same period has elapsed, or can you force-take earlier? If the latter, what distinguishes "idle enough to steal" from "about to time out," and does the stolen holder's work fall under gap 2?

4. Deletion / withdraw semantics, and audit retention. You define resolve (COL-013) but never delete or withdraw: can a proposer retract a suggestion? Can an author or admin purge a thread? And "attributable" (N04) isn't the same as retained and immutable — for a document you call audited, say explicitly that review metadata (comments, suggestions, accept/reject, round state) is retained against its version and non-destructively editable by no one including admins. If deletion exists anywhere, it contradicts your own "audited" language; if it doesn't, say so.

5. Does COL-017's principle extend to suggestions? You're emphatic that a lost thread is silently discarded feedback (COL-017). The equivalent case — two overlapping suggestions on one span where accepting A makes B unapplicable — has no stated handling: surface as stale/orphaned like threads, or auto-reject? Part of this may live in CNT's marks (T1 schema), but the workflow consequence is a review requirement. State which doc owns it rather than leaving the symmetry to be inferred.

6. The leak principle stops at notifications. COL-036 correctly treats "a leak that arrives by email" as a constraint, but only for notification events. A report of unresolved suggestions (COL-027) or any export carrying suggestion text has the same exfiltration surface if it reaches someone who shouldn't read another locked component. Either generalize the principle or state its scope boundary.

## Smaller precision points

Time semantics are everywhere but unspecified. Expected-release, when-resolved, suggestion time and round due-date all depend on "when," yet nothing says timestamps (vs relative), timezone handling, or what a due date means across regions — notable for an audited system with external clients.

Presence staleness while connected isn't bounded. COL-004 covers the dropped connection; it doesn't bound how long a "editing component X" mode can be asserted before being presumed gone when the heartbeat is merely slow.

Anchor deletion mid-collaboration. COL-017 handles threads whose anchor vanishes; say what happens to locks and presence on a deleted/renamed component (they should degrade as safely as COL-004). A one-line cross-reference suffices.
"Complete" in COL-029 — can it reopen, and does "has everybody reviewed" (COL-030) require an explicit complete or is absence of activity the default? Testability depends on it being unambiguous.

## Traceability nits

Inline cross-references to IAM-045 (COL-038), LIF (COL-027) and API (COL-037) are real dependencies, but IAM/LIF/API never appear in §2 Rests on or the §11 table. The traceability section is otherwise good; just make it match the references you actually use.

## Likely-delegated, verify rather than assume

External/guest reviewer participation feels heavier in your prose (internal threads, ADR-0011) than in the requirement set — COL-028 and COL-039/040 presuppose a guest can be named in a round, but "who may comment/suggest/approve" is handed to IAM. That's probably correct; just confirm the boundary so rounds explicitly accept external principals rather than assuming it.

None of this is structural — the shape and scoping are right. Items 1, 2 and 4 are the ones I'd close before implementation, because each one is currently a decision waiting to be made by whoever builds it first.
