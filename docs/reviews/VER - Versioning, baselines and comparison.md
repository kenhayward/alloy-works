## Quality issues in the current text

Immutability is never defined. It appears in VER-006, -008, -012, -016, -017 and the whole document rests on it, but no requirement states what immutability guarantees: bit-for-bit identity, a verifiable content digest, or merely "we don't write to this row"? Given that §1 says every audited claim rests on this area, there is no requirement anywhere in VER demanding that a version's integrity be independently checkable. If ADR-0012's hash chain supplies it, the traceability matrix should say so, or a requirement like "a version must record a content digest enabling third-party verification of non-tampering" belongs here.

VER-034's refusal condition is opaque. "Refused where it would leave a baseline unable to resolve" — but if VER-022 guarantees everything pinned stays retrievable and VER-023 forbids deleting it, an implementer cannot tell when restoration would ever fail resolution. The trigger case is real but invisible from this document; it needs one sentence of condition or a pointer to where the model makes it clear.

VER-026 is the least clear requirement. "Comparison must be possible across a template version change" — two versions of what are being compared? It reads like a special case of VER-031 (resolved output differing by definition version) rather than of VER-025, but as written it doesn't say.

The VER-028 threshold warning has no ID. The prose after the §7 table flags "the least defensible number the spike produced," yet Section 12 tracks four open questions (Q01–Q04) and not this one. An acknowledged unresolved parameter that isn't tracked is the most likely thing to get silently relied on. It deserves a Q-row.

VER-Q04 partially overlaps VER-021. The requirement already mandates that baselines "must be possible automatically at a lifecycle gate," so "is a baseline ever created automatically" is not fully open; what's actually undecided is which gates and the default state. Rewording Q04 would sharpen it.

Minor: §2 uses two differently-labelled tables ("Rests on / What it fixes" vs "Not here / There"); VER-017 says a baseline is "named" but sets no rule for names; and the purpose sentence enumerates iterations, versions, revisions, baselines and comparison — omitting restore, retention and derived data, which the document then spends three sections on.

## Missing areas (within this area's scope)

Ranked by importance:

Verifiable integrity / tamper-evidence. As above — the single biggest gap relative to the audit positioning in §1.

Fate of history on deletion. VER-036 says versions persist while the tenant keeps its content, and iteration expiry is covered, but nothing states what happens to a version chain when a component or document itself is deleted. If it's destroyed, immutability (VER-N01) and retention contradict; if it's orphaned, you need a garbage-collection rule stating when unreferenced versions may go away. Either answer should be a requirement here, not an implementation detail.

Baseline lifecycle beyond creation. There is a positive act to create, immutability, deletion refusal and retention — but no "superseded" state or retirement path. Q04 itself worries about "thousands nobody wanted," yet the document's only control on proliferation is that they can't be deleted. At minimum, say whether baselines accumulate indefinitely by design.

Visibility of versions, baselines and comparisons. VER-002 handles iteration privacy, but no requirement states who may read version history or run/export a comparison. Redline export (VER-030) implies the diff leaves the system; for an audited platform that deserves one line on access rules — even if it's "owned by X."

Any non-functional floor. Comparison is required between any two versions/baselines with no scale statement. If NFRs live in another of the 21 documents, a pointer; otherwise comparison-at-scale (long histories, large component counts) will be decided by whoever builds it first.

Time semantics. "Timestamped" and "the time" recur but no document line says which clock is authoritative or how ordering survives skew. Fine if another spec owns clocks — worth confirming one does.

## Boundary checks rather than new requirements

Given this is one of 21 documents, the following are better verified as pointers than added here: provenance-record linkage (purpose mentions it as a consumer, but no VER requirement produces or consumes a provenance ID), redline export format (likely CNT/PUB), the gate that designates revisions (LIF — already deferred correctly), and engine-version retention for VER-041, which imposes a real operational obligation to keep old engines runnable with no companion requirement stating how.
