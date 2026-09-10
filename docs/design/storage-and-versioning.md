# Storage and versioning

How a component's history is stored, how a baseline pins a document, and where derived data lives.

This is the realisation of [ADR-0006](../decisions/0006-iteration-version-revision.md) - iteration,
version and revision - and of [ADR-0012](../decisions/0012-relational-version-chain-hashed-content.md),
which chose the storage model. It sits inside a per-tenant schema, as
[ADR-0008](../decisions/0008-schema-per-tenant-isolation.md) requires, and everything below is
per-tenant without saying so again.

## The shape in one paragraph

ADR-0006 named three levels, and they are not three levels of one table. They are **two stores and a
designation**: an ephemeral iteration store that autosaves land in and that expires on a timer; a
permanent, append-only version chain that everything else refers to; and a revision, which is a
designation applied to a row in that chain rather than a second history beside it. Content is stored
inline and addressed by hash. Derived data - embeddings above all - hangs off the hash rather than
off the version, because a version is immutable and the things derived from it are not.

## Requirements owned

| ID          | How it is met                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VER-001** | An `iteration` row carries editor, timestamp and content, and is never updated after insert                                                               |
| **VER-002** | Iterations are readable only by the editor holding the component's lock; the lock holder is the only principal the row's visibility rule admits           |
| **VER-003** | Promotion deletes nothing: iterations survive their version and expire on `expires_at`, set from the tenant's window at insert                            |
| **VER-004** | The window is a tenant setting with a product default, applied when `expires_at` is computed rather than at sweep time, so changing it cannot revive rows |
| **VER-005** | Nothing outside the editor's own recovery view joins to `iteration`. No foreign key points at it, which is what keeps it out of comparison and audit      |
| **VER-006** | A version row is inserted by promotion from an iteration, never by the autosave path                                                                      |
| **VER-007** | Author, timestamp and optional note are columns on the version row                                                                                        |
| **VER-008** | `artifact_version` takes inserts only. No update or delete grant exists on it for the application role                                                    |
| **VER-009** | `revision_no` and `version_no` are columns on the version row; the pair renders as `revision.version`                                                     |
| **VER-010** | `schema_version` is a column on the version row, written at insert from the schema the content was authored against                                       |
| **VER-011** | One versioning mechanism parameterised by `artifact_kind`, so documents, outlines, assets, query definitions, themes, layouts and templates share it      |
| **VER-012** | A revision is a designation row referring to an existing version, adding no content of its own                                                            |
| **VER-013** | Only the lifecycle service may insert a designation, and it does so as part of passing a gate                                                             |
| **VER-014** | Designator, timestamp and gate are columns on the designation row                                                                                         |
| **VER-015** | `revision_no` counts from 1 within an artifact; a version never designated carries revision 0                                                             |
| **VER-016** | The designation row is insert-only on the same terms as the version row                                                                                   |
| **VER-017** | A `baseline` row names a document artifact and a moment, and is insert-only                                                                               |
| **VER-018** | `baseline_pin` holds one foreign key per pinned artifact version, covering every kind VER-011 versions                                                    |
| **VER-019** | `baseline_value` holds each bound value and its provenance, pinned at the same instant as the versions                                                    |
| **VER-020** | The condition set in force is stored on the baseline row, because a document has as many resolutions as it has profiles                                   |
| **VER-021** | Baseline creation is an explicit call, made either by a person or by the lifecycle service at a gate                                                      |
| **VER-022** | Everything a baseline pins is reachable by foreign key, and nothing reachable that way is collectable                                                     |
| **VER-023** | `baseline_pin` restricts deletion of the version it references. The database refuses, rather than application code remembering to check                   |
| **VER-032** | Restore reads an earlier version and inserts a new one with matching content. The earlier row is untouched                                                |
| **VER-033** | The new version records the version it was restored from, so the chain reads as a decision                                                                |
| **VER-034** | A restore that would leave a pinned version unreachable is refused by the same constraint as VER-023                                                      |
| **VER-035** | Preview resolves the restore without inserting, using the same code path as the write                                                                     |
| **VER-036** | Versions, revisions and baselines have no expiry of their own; retention is a policy decision applied above this layer                                    |
| **VER-037** | Legal hold marks an artifact, and the mark is checked by the same constraint path that refuses a pinned deletion                                          |
| **VER-038** | The author of a version is a reference to a principal, never a copy of their details, so erasure acts in one place and the record of the act survives     |
| **VER-039** | Derived data records the model and model version that produced it                                                                                         |
| **VER-040** | Re-deriving inserts new derived rows and alters no version                                                                                                |

Comparison (VER-024 to VER-031) reads this store but is not designed here - it is an algorithm, it
was prototyped in the content model spike, and it deserves its own document.

## Stores

**`artifact`** is the identity of a versioned thing: a kind and an id. A component, a document, an
outline, an asset, a query definition, a theme, a layout or a template are all artifacts, and
VER-011 is satisfied by that being literally true rather than by seven tables agreeing to behave the
same way. Seven bespoke version tables would be seven implementations of the same rules, and they
would drift - one would forget the immutability grant or the schema-version column, and the failure
would not be an error. It would be a baseline that resolves slightly differently in four years.

**`artifact_version`** is the permanent chain. One row per version: the artifact, `revision_no` and
`version_no`, author, timestamp, `schema_version`, an optional note, the content, and the content
hash. The application role holds `INSERT` and `SELECT` on it and nothing else, so VER-008 is a grant
rather than a convention.

**`revision_designation`** refers to a version row and adds who designated it, when, and against
which gate. ADR-0006 said a revision is a marker on a version rather than a second history; this is
that sentence as a table.

**`iteration`** is the separate ephemeral store. Same content shape, different lifecycle: editor,
timestamp, content, `expires_at`. **No foreign key points at it from anywhere**, which is how VER-005
is enforced rather than asserted - a row nothing can reference cannot appear in comparison, in audit,
or in anything a reader sees. Promotion copies an iteration's content into a new version row and
leaves the iteration alone to expire on its own clock.

Keeping iterations out of `artifact_version` is the decision in this document most likely to be
undone by somebody tidying up, so it is worth being plain about why. Autosave is continuous
(CNT-066): a write every few seconds per author with a component open. Putting that traffic into the
table every baseline, every comparison and every audit query joins against means the permanent record
is a hot table, and expiry becomes a delete against it. Separated, the version chain takes writes
only when somebody decides something, and expiring iterations is a sweep over a table nothing else
touches.

## Content, and the hash

Content is JSON conforming to the node-and-mark model of
[ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md), stored inline on the
version row, with `content_hash` beside it.

The hash is not there in anticipation. It earns its place immediately:

- **Refusing a version that changed nothing.** A positive act that produces an identical hash is a
  mistake, and saying so is better than putting a meaningless row into a permanent chain.
- **Short-circuiting comparison.** Equal hashes need no diff, which matters most for the case that is
  otherwise most expensive: comparing two baselines of a long document where almost nothing moved.
- **Keying derived data**, below.

It also makes moving payloads into a separate content-addressed store later a move rather than a
migration, if authoring volumes make deduplication worth having. That is the reason it is not being
built now: the requirements do not need it yet, and the hash keeps it cheap to reach for.

## Baselines

A baseline is a row naming the document and the moment, plus `baseline_pin` - one foreign key per
pinned artifact version - and `baseline_value` for every bound value with its provenance.

The pins being real foreign keys is the point. VER-023 says deleting anything a baseline pins must
be refused, and a foreign key with restricted deletion is that refusal. This is the same argument
[ADR-0008](../decisions/0008-schema-per-tenant-isolation.md) made about tenant isolation: the
enforcing mechanism should be the database's rather than the application's, because a boundary that
depends on four hundred call sites remembering is not a boundary. Using the reasoning twice is
deliberate.

VER-018 makes the pin set wide - components, assets, query definitions, themes, typefaces, layouts,
citation styles and the outline. Because all of those are artifacts, `baseline_pin` needs no column
per kind and no special case for the one added next.

## Derived data

Embeddings for search and retrieval are stored here, and **they do not live on the version row**.

A version is immutable (VER-008); an embedding is not. Models are replaced, and re-embedding a corpus
is a normal operation rather than an exception. A mutable value on an immutable row is a
contradiction that resolves badly in exactly one direction, so derived data is its own store:
`embedding`, keyed by **content hash, block id, model and model version**, holding the vector.

Keying by hash rather than by version buys something specific. Identical content is embedded once
however many versions and documents contain it, and in a component CMS that is the common case, not
the rare one: a component reused across forty documents, or a version cut after changing one word,
shares a hash with what it came from. Embedding is the expensive operation in this subsystem, and the
hash removes most of the work rather than caching it.

Keying by model as well means several models' vectors can exist at once, which is what makes
migrating between them an operation rather than an outage. VER-039 and VER-040 exist so that this is
a requirement rather than an implementation habit.

**The permission consequence is the important one.** Because embeddings sit in the tenant's own
schema alongside the content they derive from, a permission-filtered search is a **join**, evaluated
before ranking. The alternative - a separate vector service - forces a post-filter: ask for the
nearest twenty, discard the sixteen the user may not read, return four. That is slow, it degrades
unpredictably, and the size of the gap between what was asked for and what came back is itself a
signal about content the user cannot see. **SCH-Q04 asked whether semantic search needs its own
permission story; this is the answer, and the answer is that it must not need one.**

It follows that the vector index lives in Postgres beside the content. That constrains the search
infrastructure decision rather than settling it: how full-text works, and how the two are ranked
together, remains open as SCH-Q01.

**Computing an embedding is a model call.** GEN-031 requires a tenant to be told when a model
endpoint sits outside its data boundary, and that applies to embedding exactly as it applies to
generation - a tenant that will not send content to a hosted model needs a self-hosted embedding
model (GEN-027) or no semantic search. GEN-038 makes that explicit rather than leaving it to be
inferred from the fact that both are model calls.

## What was ruled out

**Event sourcing.** The strongest argument for it was comparison, and case 7 of the content model
spike removed it: block identity plus a longest-stable-run calculation tells a move from a
delete-plus-insert, between any two versions rather than only along a linked history. What remains
against it is durable. Reading a version means folding a stream, so snapshots come back as a cache,
which is this design with extra steps. And CNT-011 requires every version to record its schema
version, which over the decades this market keeps content means being able to replay retired event
types for ever. The step log is still wanted for the CRDT upgrade path ADR-0005 reserves, but it is
not the system of record.

**Pure content addressing.** Storing versions as immutable objects addressed by hash, with the chain
as references, gives deduplication and intrinsic immutability - both of which this design keeps. What
it does not give is query, referential integrity, or a permission filter, and VER-023 would become
application code rather than a constraint. Taking the hash without the object store is taking the
half that pays.

## Open questions

| ID          | Question                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VER-Q01** | The iteration retention window still has no number behind it, and this design makes the cost of getting it wrong concrete: the sweep is cheap, the storage is not                                                       |
| **VER-Q03** | Erasure against immutable history. VER-038 points at the resolution - the author is a reference, not a copy - and this design adopts it, but the legal question of what else must go is not answered here               |
| **SCH-Q01** | Whether full-text and semantic search are one system or two. This design places the vectors; it does not decide the rest                                                                                                |
| New         | Whether inline JSONB holds up at authoring volumes, which decides when the content store is extracted. A sizing question, answerable by load rather than by argument, and needed before build rather than before design |
