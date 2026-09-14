# 0024 - A version digest over the whole version, and a content hash beside it

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

[ADR-0012](0012-relational-version-chain-hashed-content.md) chose a relational, append-only version
chain with content stored inline and a content hash beside it, and gave the hash three jobs: it
"refuses a version that changed nothing, short-circuits comparison, and keys derived data". All
three rested on one assumption nobody had stated, because it was true when it was written: **a
version is its content.**

[MET](../specification/requirements/MET-metadata-and-component-types.md) made that false. A
component's metadata values belong to its version (MET-015) and are held beside its content rather
than inside it (MET-016), because the content document's root is closed (CNT-146) and that closure
is what a content hash rests on. A version also records its component type (CNT-145), the versions of
the fields, schemas and type it was written against (MET-017), and each value it did not carry forward
(MET-036).

So a version that corrects a mistyped study number and touches no content has a content hash
identical to its predecessor's. As ADR-0012 decided, the store refuses it as a version that changed
nothing, comparison of the two reports no difference, and VER-042's tamper-evident digest would not
notice the value being altered. That is the failure recorded in
[#82](https://github.com/kenhayward/alloy-works/issues/82), found by checking the metadata
specification against the storage design before any of either was built. It is what this record has
survived contact with: not a spike, but a requirement change that made a stated consequence of
ADR-0012 wrong, which a record that is never edited cannot correct itself.

## Decision

**Two digests, each with one meaning.** The rest of ADR-0012 stands, and is restated here so this
record can be read without it.

- **A version digest over the whole version decides whether a version changed.** It is SHA-256, as
  lowercase hexadecimal, over the canonical serialisation of the version's substance: its content,
  its component type, its metadata values, the definition versions it was written against, and the
  values it did not carry forward. The canonical rules are the content's own - members in
  lexicographic order, strings in NFC, no insignificant whitespace - with the definition versions
  sorted, because they are a set. A new version whose digest equals its predecessor's is refused.
  VER-042's digest is this one: recomputable by anybody holding the row.
- **The content hash keeps its derived-data job, and only that.** It is SHA-256 over the canonical
  content alone, and it keys embeddings, because an embedding is of content, and identical content
  should be embedded once however many versions, types and metadata values it appears under.
- **Comparison skips in two stages.** Equal version digests need no comparison at all. Equal content
  hashes with different version digests skip the content diff and still compare the rest - which is
  what makes a metadata-only change visible rather than silently equal.
- **Authorship is not in the digest.** Author, timestamp, note and the `revision.version` numbering
  are not the version's substance, and including them would make every version differ from its
  predecessor and the refusal meaningless. The integrity of who did what, when, is the audit log's
  hash chain (LIF-055).
- **Fields, metadata schemas and component types are artifact kinds**, versioned by the same
  mechanism as everything else, so a version records its definitions by foreign key and a baseline
  pins them without a special case.

**Restated from ADR-0012, unchanged:**

- **The version chain is relational and append-only**, with real foreign keys from each baseline pin
  to the version it pins, so VER-023 is a constraint rather than a check.
- **Iterations are a separate store with a time to live** that nothing holds a foreign key into. An
  iteration now carries the same substance as a version - content, type and metadata values - so a
  value set while editing autosaves like any other edit.
- **A revision is a designation row against a version**, adding no content.
- **One versioning mechanism parameterised by artifact kind.**
- **Content is inline JSON.** Extracting payloads into a content-addressed store later remains a move
  rather than a migration, because the content hash is still there to address them by.
- **Derived data hangs off the content hash, never off the version.**
- **Event sourcing and pure content addressing stay ruled out**, for the reasons ADR-0012 gives.

## What would change the answer

- **Metadata values moving back inside the content document.** If MET-016 were superseded, content
  and version would coincide again and one hash would do both jobs. The closed root (CNT-146) is what
  makes that unlikely: it is the reason values were put beside content.
- **A regime requiring authorship inside the version's integrity evidence.** If a signature must
  cover who authored a version as well as what it holds, the digest's scope widens - and the refusal
  of an unchanged version then needs its own comparison over the substance, rather than reusing the
  digest.
- **Comparison needing to skip at a finer grain than content and the rest** - per block, or per
  field. That is a derived structure beside the version, not a change to either digest.
- **The reasons ADR-0012 gave, all still live:** inline JSONB not holding up at authoring volumes,
  audit coming to require every interim save, real-time co-editing arriving, and a tenant needing its
  vectors held physically apart from its content.

## Consequences

- **A metadata-only change is a version**, compares as a change, and is covered by the version's
  integrity digest.
- **The version row gains columns**: the component type's version, the metadata values, the values
  not carried forward, and the version digest; and a table relating a version to the definition
  versions it was written against. [storage-and-versioning.md](../design/storage-and-versioning.md)
  designs them and claims MET-015, MET-016, CNT-145 and VER-042.
- **The domain package owes a canonical serialisation of the version record**, applying the rules
  `canonicalise` already applies to content. It is plan work, and it is small: the rules exist, and
  the record is one more object to emit.
- **Comparing metadata is now reachable but not yet required.** Nothing in VER says a comparison
  reports a changed value; [#85](https://github.com/kenhayward/alloy-works/issues/85) proposes the
  requirement. This record makes such a comparison possible without deciding what it shows.
- **ADR-0012 is superseded, and its reasoning stays readable there.** Its argument for the relational
  chain, the separate iteration store and derived data keyed by hash is this record's argument too.
