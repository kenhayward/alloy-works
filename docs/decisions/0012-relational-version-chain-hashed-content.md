# 0012 - A relational version chain with hashed content

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 carried the storage and version model as
the first of the irreversible decisions, with three candidates: relational rows with version history,
event sourcing, or content-addressed objects. It was deliberately deferred until the content model
spike had run, because case 7 was a storage question as much as a model one.

Three things settled since then narrow it more than the original framing suggests.

**Case 7 of the content model spike found that a step log is not required.** Telling a move from a
delete-plus-insert needs block identity and a longest-stable-run calculation, not the editor's
persisted transform steps - and it works between any two versions rather than only along a linked
history. That was the strongest argument for event sourcing, and it is gone.

**[ADR-0006](0006-iteration-version-revision.md) split history into three levels**, of which one -
the iteration - is ephemeral, private and explicitly not part of the record, while being written
continuously (CNT-066). Those two facts pull in opposite directions inside a single table.

**[ADR-0008](0008-schema-per-tenant-isolation.md) put everything in a per-tenant Postgres schema**,
and argued that an enforcing mechanism should be the database's rather than the application's.
VER-023, which refuses deletion of anything a baseline pins, is the same class of rule.

## Decision

**A relational, append-only version chain, with content stored inline and addressed by hash. Two
stores and a designation, not three levels of one table.**

- **The version chain is relational.** One row per version of an artifact, with a real foreign key
  from each baseline pin to the version it pins, so VER-023 is a constraint the database enforces
  rather than a check application code must remember. This is ADR-0008's argument applied a second
  time, on purpose.
- **Iterations are a separate store with a time to live**, that nothing holds a foreign key into.
  Autosave traffic never touches the table every baseline, comparison and audit query joins against,
  and VER-005 - iterations appear in no comparison, no audit, nothing a reader sees - is enforced by
  there being no way to reference one.
- **A revision is a designation row against a version**, adding no content. ADR-0006 said a revision
  is a marker rather than a second history; this is that as a table.
- **One versioning mechanism parameterised by artifact kind.** VER-011 versions documents, outlines,
  assets, query definitions, themes, layouts and templates by the same rules, and seven bespoke
  implementations of the same rules would drift.
- **Content is inline JSON with a content hash beside it.** The hash earns its place immediately: it
  refuses a version that changed nothing, short-circuits comparison, and keys derived data. Extracting
  payloads into a separate content-addressed store later, if authoring volumes justify deduplication,
  is then a move rather than a migration.
- **Derived data hangs off the hash, never off the version.** Embeddings are keyed by content hash,
  block, model and model version. A version is immutable and the things derived from it are not, and
  identical content should be embedded once however many versions and documents contain it.

**Event sourcing is ruled out**, its main argument having been disproved, and its remaining cost
being that reading a version means folding a stream - so snapshots return as a cache, which is this
design with extra steps - while CNT-011's schema versioning would mean replaying retired event types
for as long as the tenant keeps its content.

**Pure content addressing is ruled out** as the system of record, while its useful half is kept.
Objects addressed by hash give deduplication and intrinsic immutability but no query, no referential
integrity and no permission filter, and VER-023 would become application code again.

## What would change the answer

- **Inline JSONB not holding up at authoring volumes.** This is the likeliest, it is a sizing question
  rather than an argument, and the hash is what makes the answer cheap: payloads move out, the chain
  does not change.
- **Audit coming to require every interim save.** ADR-0006 already names this as its most likely
  reversal. An iteration that must be kept is not an iteration, and the separate store with a time to
  live would become a second permanent chain.
- **Real-time co-editing arriving.** A step log becomes load-bearing again for convergence, though
  still not for comparison, and the iteration store's "visible to the lock holder" rule has no meaning
  without a lock.
- **A tenant needing physical separation of vectors from content.** The permission argument below
  depends on them sitting in the same schema.

## Consequences

- **A permission-filtered semantic search is a join rather than a post-filter**, because the vectors
  are in the tenant's schema beside the content. This settles SCH-Q04: semantic search does not need
  its own permission story, and must not have one. A separate vector service would force asking for
  the nearest twenty, discarding the sixteen the user may not read, and returning four - which is
  slow, degrades unpredictably, and makes the size of the gap a signal about content the user cannot
  see.
- **The search infrastructure decision is constrained rather than settled.** Vectors live in
  Postgres; how full-text works and how the two are ranked together remains SCH-Q01.
- **Embedding is a model call, and inherits the boundary rules.** GEN-031 requires a tenant to be
  told when a model endpoint sits outside its data boundary; that applies to embedding as much as to
  generation, and GEN-038 now says so rather than leaving it to be inferred.
- **Two requirements are added to VER** for derived data: what produced it must be recorded, and
  re-deriving must alter no version.
- **Erasure is unaffected either way.** VER-008 already forbids editing a version, so rewriting
  history was never available in any candidate. VER-038's answer - the author of a version is a
  reference to a principal rather than a copy of their details - is orthogonal to this choice, and
  this design adopts it.
- **`docs/design/storage-and-versioning.md` is the first design document**, and the folder it starts
  is described in [`docs/design/README.md`](../design/README.md).
