## Primary Gaps

The biggest gao is references to external sources, for example pubmed, there is limited benefit in ingesting the entirety of pubmed when it has excellent searching and referencing via its API, we must support external reference sources both natively in the app and with search and citation confirmation capabilities. During design or implememntation we should provide ad definitive but extensible list of external sources. Access to these should also be available via tools in the interactive chat

## Other Gaps and weaknesses

Identity and identifiers. LIB-002 guarantees stability but not form or scope. With sharing between spaces (LIB-030) alongside per-space permissioning (LIB-001), you need one explicit rule: are record IDs space-scoped, tenant-scoped, or globally unique? If a house glossary is shared across two spaces, do those spaces see the same value identity, and can a private term in Space A collide by label with the shared one? This is currently the least-specified area relative to what depends on it.

Bibliographic dedupe. LIB-010 binds import only; nothing stops an author hand-creating a fourth copy of the same paper — the exact failure the rationale paragraph describes. Either extend detection to create-time or state explicitly that manual duplicates are tolerated and reconciled later. "Detects an existing record" also needs identity fields: DOI/ISBN are the obvious canonical keys and none appear, so as written a reviewer could legitimately implement dedupe on title+author string match only. In-text citation key (uniqueness/stability of the author-year or numeric token) is likewise absent and sits awkwardly between LIB and STY — rendering is STY's, but generating the key from held fields looks like it belongs here; one line in either direction would settle it.

Versioning consequences. Delegating mechanics to VER-011 (LIB-004) is fine, but the local effects are missing: if a term's preferred label or a bibliography entry changes, what happens to (a) drafts referencing it unpinned and (b) published baselines that pinned the old version? One sentence — "changes propagate at next publish for unpinned references" — would close most downstream ambiguity.

## Term model.

Status is referenced by LIB-013 and LIB-018 but its value-set is undefined pending Q01. Flag this as a T6 scheduling dependency, not just an open question.
Relationship between the preferred label (LIB-013) and per-language labels (LIB-014) is unstated; you need a fallback rule when the requested locale has no label.

Relations validation: broader/narrower can cycle after edits, and whether related is symmetric is unstated. Cheap to specify now, expensive to migrate after data exists.

A single definition slot may be thin for glossaries where one term carries multiple senses; one line stating that's deliberate (paralleling LIB-N04) would keep it from surfacing as a defect later.

Vocabularies. No display-order requirement for permitted values (dropdowns need deterministic sort), no optional description field, and deprecation handling is asymmetric with terms: values retire-and-flag (LIB-023) but there's no "deprecated, still offered" intermediate state that the term side has. Whether a metadata field can draw from more than one vocabulary is silent — likely TPL's to specify, worth a pointer either way.

## Cross-cutting.

Roles: LIB-001 says permissioned by space via IAM but not which roles edit library records versus read them; if that lives globally in IAM, cite it in traceability so the gap isn't discovered at build time.

Audit: regulated signoff will need "who changed term X to Y, when"; confirm this is covered by VER or IAM and reference it here rather than assuming it.
Authoring-time feedback: publish failure (LIB-007, LIB-012) is well specified; authoring-time behaviour for referencing a deprecated term or retired value is only implied by LIB-018 — "flagged wherever used" should explicitly include the insert moment, which is when it's cheapest to act on.

Traceability table omits LIB-010 and LIB-023 even though they're arguably the two highest-value constraints in the doc; adding them with "no upstream dependency — self-contained invariant" makes the absence deliberate rather than accidental.

## Consolidated missing-area list

Identifier format and scope rule (space/tenant/global), including its interaction with LIB-030 sharing.
Create-time duplicate detection for bibliography entries, or an explicit decision that only import is guarded; canonical identity fields named (DOI etc.).
Citation-key generation and uniqueness — assigned to LIB here, or explicitly pushed to STY in the "Not here" table.
Version-change propagation semantics for unpinned versus pinned references.
Term status value-set, or an explicit note that T6 build is blocked on Q01 resolution.
Locale fallback when a requested language label doesn't exist.
Thesaurus structural validation (acyclicity of broader/narrower; related symmetry).
Vocabulary display order and optional description; intermediate "deprecated" state for values to match term behaviour.
Audit-trail citation via VER/IAM if not already guaranteed elsewhere in the 21-doc set.
Authoring-time flagging when inserting a reference to a deprecated/retired record, distinct from publish-time failure.
Two open questions worth adding
LIB-Q05 — How are record identities scoped (space / tenant / global), and does a shared vocabulary expose one identity or per-space views? Settled by: IAM model plus LIB-030 permissioning design.
LIB-Q06 — Is bibliography dedupe enforced at manual creation as well as import, and on which fields? Settled by: whether early customers import or key entries in by hand.
