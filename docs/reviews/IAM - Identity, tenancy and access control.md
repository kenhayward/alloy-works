Normative terms are undefined locally. artifact (IAM-001 "every artifact must belong to exactly one tenant"), principal (§11), and template (IAM-018) carry normative weight but are never defined in this document. Even if they're fixed elsewhere, a spec that positions itself as precise should at least cross-reference the defining section for each.

Two load-bearing enforcement claims cite no backing. IAM-042 → ADR-0009 and §11 → ADR-0011 are properly grounded; but IAM-002 ("enforced at the data layer") and IAM-010 / IAM-035 (immediate loss on disable, immediate revocation) make claims that quietly rule out long opaque stateless tokens and demand a revocation/introspection mechanism — with no ADR referenced for either. "Data layer" is doing a lot of work: row-level security in a shared DB? Per-tenant databases? Those are different builds. Until an architecture decision is cited, these two read as intent, not enforcement, which is the exact failure mode §1 says this area exists to prevent.

Asymmetric strictness. IAM-010 demands immediate loss of access on disable ("without waiting for a token to expire"), but IAM-009's group→role mapping has no stated freshness or propagation bound. A disabled user is handled with zero latency; a group change is left unspecified. Pick a stance and state it, or the implementer will get one wrong silently.

Guest capability cap vs §6 grants. IAM-047 says an external principal "must never be able to edit," but IAM-048 says access is granted through the section 6 permission model — which includes edit (IAM-019). The intended reading is clearly that guests are capped at read/comment/suggest regardless of what §6 would grant, but nothing states the cap wins. As written, an implementer could satisfy IAM-048 by assigning a guest a role with edit.

"Stated timetable" is never stated. IAM-006 requires tenant deletion to make everything unreadable "on a stated timetable… and that timetable must be verifiable," but no timetable appears anywhere in the document. That is an underspecified reference, not a requirement.

## In-scope gaps (things this area owns and does not yet cover)

Distinguished deliberately from things already deferred to another doc:

Bootstrap / first-admin provisioning. There is no requirement for how the first administrator of a brand-new tenant gains access before any IdP exists or Google route is configured. IAM-041 (Google fallback) covers small/evaluation deployments, but the initial-provisioning path for a real customer's first go-live is absent — and it is precisely where hardcoded admins or backdoor logins tend to be introduced. This is an access decision owned by this area, not by ADM (which owns day-to-day administration of an already-working tenant).

Role vs direct-grant model. IAM-021 defines a role as "a named bundle of permissions" but never says whether everything is mediated by roles or whether individual users can also hold direct grants outside any role. That choice determines the coherence of §6–§8 (especially IAM-030's "name the grant that produced each answer") and should be stated, not left to the model design.

Atomicity of check + act (TOCTOU). Given the document's own enforcement mandate, it is worth one sentence stating that a permission decision and the action it authorises are taken as a unit — i.e., access cannot change between "check" and "do." IAM-027 (compute at decision point) points this way but does not close the window. If you argue this belongs to API/architecture, say so; as written it is silent.

IdP unavailability / fail-closed behaviour. The document specifies de-provisioning (IAM-010) and multi-IdP (IAM-011) but nothing about what happens when a customer's IdP is down or its certificate rotates: does authentication fail closed, is there a grace window, can cached assertions be trusted? The decision of whether to degrade is an access-control decision owned here; the mechanism may sit in LIF/API. At minimum this belongs in §13 as an open question rather than being absent.

## Concrete defects to fix before review sign-off

IAM-Q04 ends with "See %s" — an unfilled template placeholder where a link (almost certainly ADR-0011) should be. Every other settled answer in §13 carries a real relative link; this one breaks the traceability chain and will look like an editing artifact to whoever reviews it.

Inconsistent reference style in the Depends-on table — row 1 links [Project_Scope.md](../Project_Scope.md), row 2 is plain Scope. Minor, but cheap to make uniform while you're in there.
