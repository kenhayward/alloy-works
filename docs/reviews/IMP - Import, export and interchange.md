## Gaps and weaknesses

The scale tension is this spec's biggest risk, and it lives in two open questions. IMP-003 forbids unattended import, IMP-N04 pushes estates into projects, yet IMP-Q01 concedes a customer will have four thousand reports. Neither answer — assistance made fast enough per document, or most of an estate never migrating — is tied to what would change in T6 scope if it lands one way or the other. Acceptable as open questions, but this gates tranche planning; worth stating what decision or customer signal settles them and by when.

The assisted loop is thinnest where it matters most (IMP-002/IMP-004). IMP-002 says a person "accepts, adjusts, merges and splits" but says nothing about how that works at size — no requirement for per-component review context or navigation of the proposal. And if IMP-Q02 lands yes (a model proposes the breakdown), there is no constraint on proposal quality or reviewability; a confidently wrong model proposal is the same poisoning failure as unattended import, wearing different clothes. A testable line would help: each proposed component must be checkable for its split decision without loading the whole source document, whatever produced it.

Sections 4 and 3 have an unstated ordering. IMP-009 surfaces identities before acceptance; IMP-010's policy may discard them entirely; but IMP-005 mandates tracked changes arrive "attributed to the Word author." Read flatly these conflict. The intended sequence is presumably attribution visible during review, mapping or discarding applied at commit — state it in one line so nobody has to infer it.

Unresolved references are unhandled. IMP-006 requires cross-references, footnotes and captions to arrive as structure rather than resolved text, but never says what happens when the target isn't in the imported document. "Unresolvable" is not covered by IMP-007's "dropped," and IMP-017 (nothing invalid created) forces a choice: reject, resolve-by-default, or surface-and-decide. Given this spec's own diagnostic standards, it should be explicit and reported.

No story for updated source documents. If the Word file changes next quarter, re-importing is a fresh assisted import with no link to what was imported last time — no diff, no idempotency, no "this document has been imported before." It may belong in CNT or VER rather than here, but it must land somewhere in the set; as written, nothing owns it. At minimum a cross-reference line stating which document does.

Sub-tenant export completeness is undefined. IMP-024 allows exporting individual documents, spaces and publications while IMP-020 mandates completeness with omissions stated. Does a space-level export include entities referenced from outside the space — by value, by reference, or omitted-and-stated? A real decision, currently silent.

The product's own export format is not listed as importable, and it interacts with IMP-021: an in-product reader proves round-trip, while an independent external reader against the documented format proves self-describing (IMP-019). Those are materially different guarantees. Worth deciding both — should export be re-importable at all, and which reader does the read-back test use?

Validation covers only the machine path. IMP-017 says import "must never be able to create" content that fails validation, but per IMP-002 humans are inside the import loop, and a person can merge two components into one that fails validation. State that acceptance is validated too, or reference CNT-013 within IMP-002.

## Two small silences worth closing:

Personal data in body content (customer names in report text) is neither promised nor excluded. A one-line non-goal — identities are the scope; content scanning is not — stops silence being read as a promise at review time.

Failure mid-import (corrupt file, parse dies halfway): IMP-007 and IMP-008 imply nothing-behind but state it only for user abandonment. One line covering system failure closes it.

## Deliberately not flagged

Multi-tenant isolation on the export path, which administrators may request exports, and delivery mechanics of an artifact that egresses a whole tenant's content — these plausibly live in platform or governance documents. Worth checking those cross-references when this spec is re-reviewed, but I haven't assumed them missing here.
