## Ambiguities worth resolving

The Tranche column mixes two axes. "Constraint" (non-negotiable) and T1–T3 (delivery order) live in one cell per requirement. If Project_Scope defines the convention, fine; otherwise a one-line legend prevents misreading what ships first.

"Rests on" is not exhaustive against its own inline references. VER-011/VER-023 (AST-016, AST-019), REU-006 (AST-018) and PUB via PUB-033 (AST-014) are load-bearing but absent from the table. Either make it exhaustive or label it "primary dependencies".

Versioning granularity is unstated. AST-016 versions the binary; nothing says whether alt text, source and licence version with it. A re-licence picked up silently by a floating reference (AST-017) feels like something that should be visible. Related: there is no requirement saying superseded versions are retained and retrievable — AST-019 protects baseline-dependent assets, but the fate of an orphaned old version has no stated rule. Superseded versions and their relationships must be maintained for inspection purposes

The quarantine state doesn't exist. AST-003 requires scanning "before it can be referenced", so an asset can be accepted but unusable; Q03 (third-party scanner) makes that window longer and more visible. No requirement names the state or its feedback/timeout.

"duration" in T1's AST-005 reaches into video/audio scope that AST-Q02 leaves open. Either gate that clause on Q02 or annotate it, so a T1 implementation doesn't build for formats the platform may not admit.

"embedded objects" in Purpose outstrips the requirements. Nothing distinguishes an embedded object from the attachment locker AST-N03 excludes beyond "content references it". One line naming which classes are in scope — or an explicit deferral to a Q-style decision — would close that gap.

Alt text language. If CNT content fields carry a language dimension, AST-012's default alt should too; worth checking against CNT rather than assuming.
Missing within the declared remit

Decoded-size validation. AST-004 caps file bytes; it says nothing about what the file expands to (image bombs, decompression). That is squarely "validated rather than stored" territory and pairs naturally with AST-002's content-based determination.

Integrity of originals. No requirement records a content hash at ingest or verifies the stored original later. AST-029 needs some content identity anyway, and AST-010's "never the only copy" story is weaker without it. Recording the hash belongs here; periodic re-verification may belong to storage — state that boundary once rather than letting it float.

Unknown-licence posture. AST-023 can refuse known unpermitted uses, but assets with no recorded source or licence at all (AST-021 records, doesn't enforce) sail through. The chain needs a default: unrecorded equals internal-use-only, or publish refused — and it should say whether upload requires the declaration or merely flags its absence.

Attribution as a permission dimension. AST-022's list (internal use, publication, redistribution, modification) omits credit requirements, which many stock and CC licences carry. Recording "requires attribution" fits rights data here even if rendering it sits elsewhere. Related: AST-011's format conversion is plausibly a modification under a licence — that link is never made explicit.

Derivative lifecycle. AST-010 makes derivatives regenerable, but nothing says they may be discarded and rebuilt (the storage payoff of that clause), or who triggers rebuild after an original is replaced. One line would do it. Colour-space shift in conversion (wide-gamut to sRGB) is also a change of content as much as format — a candidate for AST-011's declared-and-recorded pattern.

Orphan surfacing. After AST-020, assets referenced by nothing and no baseline accumulate silently; AST-018 makes listing possible, so "list orphans" is cheap to add or worth an open question.
