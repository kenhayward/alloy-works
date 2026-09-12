## Gaps worth closing

### Relationship lifecycle (biggest cluster)

Modification is unaddressed. REL-010 validates metadata on creation; REL-011 audits creating and removing. Nothing says whether an existing edge's metadata can be edited, or its target re-pinned — and if it can, the edit slips past the audit requirement. Either add a modify-and-audit requirement, or state that change means remove + recreate, which puts it under audit by construction.
No authorization on write. The read side is tightly specified; creating or deleting an edge has no permission requirement at all (must the user be able to see both ends? write both?). If this is deliberately owned by IAM, say so in §2 the way REL-021 does for the API surface — otherwise it's a hole a security review will find.

Type lifecycle asymmetry. REL-006 guards endpoint and cardinality changes but leaves metadata-shape changes unguarded (what happens to existing instances when a required field is added?), and there's no deprecation path. Combined with "not deletable while in use", a misnamed tenant-declared type is stuck forever — which undercuts the self-service intent of REL-005.

Import collisions. REL-007 makes types exportable/importable; two imported types sharing a name with different shapes, or instances violating an imported cardinality, have no stated behaviour.
Semantics pinning

"Cardinality" is used three times and never anchored to a definition. Per-neighbour? total count? Can the same pair carry two edges of one type (duplicate create refused, or idempotent)? One sentence pointing at where it's defined defuses implementer and tester ambiguity.

Version interaction. REL-013 allows pin-or-float but is silent on how a floated edge behaves in impact analysis when "latest" moves, after the target is deleted and recreated, and whether both ends can be pinned independently. Self-loops (artifact → itself) are also neither permitted nor forbidden anywhere, which matters for the cycle story.

Cycles at creation time. REL-018 governs traversal only; nothing stops a tenant from declaring A-supersedes-B and B-supersedes-A. If some types must be acyclic by nature, REL-002's declared-attribute list (name, endpoints, direction, cardinality) has no slot for that — this is an integrity requirement, not just a performance one.

## Behavioural edges

Bulk operations and partial failure. Bulk create/delete with one failing member: all-or-nothing or report? Unstated. "Cardinality enforced when created" implies check-then-insert; concurrent creations racing the limit are unaddressed — arguably below this document's altitude, but a single constraint line would do.

REL-032 reports get depth and permission bounds but no completion/cancellation semantics for the background job. And traversal/view filtering is by type only (REL-015, REL-026) — edge metadata as a filter dimension is never mentioned; if that's deliberate it costs one sentence to say so.
Hygiene / process (small)

REL-009 hard-codes the artifact-kind enumeration ("components, documents, assets…"). If the kind registry is owned by one of the other 20 documents this line will drift — prefer a cross-reference. Similarly, IDs in §5 jump (REL-015–021 then REL-029–031); fine given stable IDs, but a note that numbering is preserved across revisions prevents reviewers assuming typos.

Type name uniqueness/namespacing per tenant is implied by Q04 plus REL-007 but never stated; one sentence removes the ambiguity.
