# Structure

The document, its outline, and everything positional computed over it: numbering, captions,
cross-references, the contents panel and deep links.

This realises [STR](../specification/requirements/STR-structure-numbering-and-cross-references.md),
and it exists because of the rule [CNT](../specification/requirements/CNT-content-and-authoring.md)
states first: **a component does not know where it is used.** Its heading number, its figure
numbers, and what "see section 4.2" means are not properties of the component. They are properties
of one document, computed here, and computed again the moment anything about that document changes.

It rests on [content-model.md](content-model.md) (what a component contains, and the identity every
block carries), [storage-and-versioning.md](storage-and-versioning.md) and
[ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md) (the chain a document
versions through), [access.md](access.md) (who may read and edit one),
[component-editor.md](component-editor.md) and
[ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md) (the editor a section title
is edited with), [relationships.md](relationships.md) (the reference index the cycle check walks) and
[service-foundations.md](service-foundations.md) (how every route is written).

> **Part of this is built.** The document artifact, the outline as one tree with every positional
> switch at schema version 1, its canonical form, the five operations, four of the routes, and an
> outline panel with its keymap and an undo stack are in `packages/domain`, `packages/db`,
> `apps/service` and `apps/web`; [`../architecture.md`](../architecture.md) describes them as they
> stand, and [the plan that built them](../plans/2026-09-18-structure-01-the-document-and-its-outline.md)
> changed this document where planning and building found it wrong or silent - see
> [Changed while planning the build](#changed-while-planning-the-build). What is still design here:
> numbering, captions, cross-references, the contents panel, generated lists, deep links, the cycle
> check, a component version resolved for each occurrence, and a title edited as inline content
> rather than as plain text. The content model spike's flat `OutlineSection`, in
> `packages/domain/src/content/outline.ts`, still stands beside the tree for the OOXML reader and
> writer, and goes with the rest of the spike.

## The shape in one paragraph

A **document** is an artifact of its own kind, beside `component`, `field`, `metadataSchema` and
`componentType`. It lives in a space, it versions through the same chain, and **its content is its
outline**: one JSON tree of nodes, each a section or a component reference, stored inline on the
version row exactly as a component's content is, with the same digests and the same insert-only
grant. A node carries a title that is inline content rather than a string, a 128-bit identifier
allocated once and never reused, and the switches that decide whether it is numbered, whether it is
an appendix, and whether it starts a page. **Nothing positional is stored anywhere.** A single pure
function in `packages/domain` takes the outline, the component versions it resolves to and a
numbering scheme, and returns a **numbering table** - one entry per numbered thing, each naming what
produced it - which the contents panel and the publisher both read, so an author is never shown a
number the publisher would not print. Cross-references resolve against that table in the **resolving
document**, keyed by occurrence rather than by component. There is no document lock: a structural act
carries the version it was read at, and a second person's conflicting act is refused against the
current outline rather than silently overwriting it.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-001** | A document artifact's content is one `outline` document; its root holds one ordered array of nodes and there is nowhere to put a second                                                                                                                    |
| **STR-002** | `node` is a closed discriminated union of `section` and `reference`. A third arm is a schema version with a migration                                                                                                                                      |
| **STR-003** | `id` is required on every node, allocated from 128 random bits at insertion, spelled by the domain, and never reused - nothing reissues, because nothing recycles                                                                                          |
| **STR-004** | A section is a node inside one outline document. It has no artifact row, so there is no identity to share it by and no route that could return one                                                                                                         |
| **STR-006** | The outline panel reorders by pointer and by an enumerated keymap, and the same five operations are the routes below. All three go through one set of operations                                                                                           |
| **STR-007** | Nesting is the tree's own; the schema declares no maximum depth, and the numbering scheme's counters are a stack rather than nine named members                                                                                                            |
| **STR-008** | A move names a node, a new parent and a position among its siblings; the subtree travels because it _is_ the subtree, and the whole move is one version and one undo entry                                                                                 |
| **STR-010** | Two nodes may name one component. Each is a node with its own `id`, and every occurrence-bearing thing below - numbering, captions, references - is keyed by the node, not the component                                                                   |
| **STR-012** | The outline is the document version's content, so it is versioned by the act of versioning the document; `baseline_pin` pins a document version like any other (VER-018)                                                                                   |
| **STR-014** | `sequences` is an open map from a name to its rule, with `section`, `figure`, `table` and `equation` always present. A further sequence is a member, not a code change                                                                                     |
| **STR-015** | A sequence's rule carries `restartAt`, an outline depth. The engine's counter stack drops every counter below that depth on entering a node at it                                                                                                          |
| **STR-016** | A top-level node carries `matter`, inherited by its subtree; a sequence declares a rule per matter, so an appendix numbers in its own scheme with its own `restartAt`                                                                                      |
| **STR-017** | A node carries `numbered`, and an unnumbered node is walked for its children and never increments a counter                                                                                                                                                |
| **STR-018** | `number(outline, contributions, scheme)` is pure: no clock, no identifiers minted, no iteration order that depends on anything but the tree                                                                                                                |
| **STR-019** | No number is representable. The content model has no member for one, the outline holds switches rather than values, and the numbering table is returned rather than written                                                                                |
| **STR-021** | The engine walks occurrences, not components. A component referenced twice is two walks over one content document, and its captions take two numbers                                                                                                       |
| **STR-022** | Every entry in the numbering table names the node that produced it, the occurrence and block where it is a caption, the sequence, the counter stack at that point, and the rule applied                                                                    |
| **STR-023** | Each occurrence contributes its component's caption-bearing blocks in document order, and each increments the sequence for its kind                                                                                                                        |
| **STR-026** | The target is a closed union - an outline node, a block, a footnote, or a bibliography entry - each naming an identity, never a position                                                                                                                   |
| **STR-028** | Resolution reads the numbering table, which is built for one document. The component is never consulted: it holds a target, and targets carry no answer                                                                                                    |
| **STR-031** | Nothing caches a number past the inputs that produced it. The table is keyed by the document's version digest, the scheme and the profile, and a change to any of the three discards it                                                                    |
| **STR-032** | A target with no occurrence means the occurrence the reference is in; a target naming an occurrence reaches another component of the same document                                                                                                         |
| **STR-034** | The panel renders the outline the renderer holds, which is the outline every operation returns. There is no second source to fall behind                                                                                                                   |
| **STR-036** | The panel calls the same `number` the publisher calls, with the same scheme, so the two cannot disagree - not by agreement, but by being one function                                                                                                      |
| **STR-037** | Reordering in the panel is the move operation, from the panel's own drag and from its keymap                                                                                                                                                               |
| **STR-040** | `contents(numbering, depth)` returns entries to a depth: node, number, title and depth. **PUB** renders it                                                                                                                                                 |
| **STR-041** | `listOf(numbering, sequence)` returns the entries of one sequence, so figures, tables and equations are three calls to one function and a fourth sequence needs no new one                                                                                 |
| **STR-044** | A node's URL is the document's path and the node's identifier, both identifiers                                                                                                                                                                            |
| **STR-046** | The URL holds no depth, no number and no position, so there is nothing in it for a reorder to invalidate                                                                                                                                                   |
| **STR-048** | A node carries `pageBreak`: none, a new page, or a new recto page                                                                                                                                                                                          |
| **STR-049** | `pageBreak` is a member of the node. The content model has no member for one, so the declaration cannot travel with the component                                                                                                                          |
| **STR-051** | The four stages are one function each, and each takes the previous stage's return type. Calling them out of order does not typecheck                                                                                                                       |
| **STR-053** | An identifier is 128 random bits in the spelling `blockIdentifierFrom` already fixes, validated unique within its outline at every write. Across documents the argument is the one the product already makes for a UUID                                    |
| **STR-057** | Before a version is recorded, a reachability walk from the document over the reference index refuses a cycle with `outline_cycle`, naming the path                                                                                                         |
| **STR-058** | A reference node carries `mode`: `pinned` with a version, `latest`, or `approved`. The three are closed, and absent is not a fourth                                                                                                                        |
| **STR-059** | Every operation carries the version it was read at and is answered `version_precondition` with the current outline when it is not the latest; `component_lock` refuses a document by a check constraint, so no document lock can be introduced by accident |
| **STR-054** | The root is the document artifact, which carries the identity a top-level deep link addresses, and `nodes` has no minimum - unlike content's, which CNT-124 gives one                                                                                      |
| **STR-061** | A document is an artifact of its own kind: its identity is the `artifact` row, `artifact_space_by_kind` puts it in exactly one space, its title lives inside its versioned content as a component's does, and it versions through the one mechanism        |
| **CNT-041** | `footnote` is a sequence in the scheme like any other, counted over the resolved document rather than within a component                                                                                                                                   |
| **CNT-047** | The model's `numbered` decides whether a block equation takes from the equation sequence; an unnumbered one is walked and never increments it                                                                                                              |

## What this document does not own

Forty claims above. The requirements deliberately left out are where this design's edges are, and
each one is a design that does not exist yet rather than a detail.

**The named failure is produced here; failing the publish is PUB's.** This is the split
[content-model.md](content-model.md) already made for CNT-042 and CNT-054, and it applies to three of
STR's sharpest requirements. Reference resolution returns a list of failures, each naming the
reference and its target; PUB-072 already requires publishing to fail on an unresolved
cross-reference. Neither design answers STR-029, STR-030 or STR-055 alone, so neither claims one.

| Left unclaimed            | Why                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR-013                   | The scheme's vocabulary and its application are here; **PUB-011** puts the declaration on the layout artifact, which is not designed. Answered jointly, claimed by neither                                                                              |
| STR-024                   | A caption's label - the word "Figure" - is a member of the scheme, and PUB-011 says the layout declares it. The computation is here, the text is the component's, the label is PUB's: three clauses, two elsewhere                                      |
| STR-025                   | Caption placement is a style property, and **STY-003's six catalogues contain no caption style**. Nothing this design can do makes the requirement true - see the recommendation below                                                                  |
| STR-027                   | Number, title and number-and-title resolve here. A **page** needs the paginator, and a **relative** form needs to know what is above the reader on a page that has not been composed - STR-Q04 says so                                                  |
| STR-029, STR-030, STR-055 | The named failures, above. STR-030 also needs REU's condition evaluation; STR-055 needs a member the content model has no room for yet                                                                                                                  |
| STR-020, STR-042          | Condition evaluation is **REU**'s, and T4. The pipeline's second stage is shaped for it and is the identity function until then                                                                                                                         |
| STR-033                   | What references a node is the reference index read backwards, which [relationships.md](relationships.md) designs and nothing builds. T3                                                                                                                 |
| STR-035                   | Jumping to a node is here; tracking the reader's position as they scroll is the **document view**'s, which is the next slice of the editor and is not designed                                                                                          |
| STR-039                   | **Scope §11 names the quantity and gives no number**, and every neighbouring budget has one. A design that invented one would be writing a requirement - see the recommendation below                                                                   |
| STR-043                   | An index needs marked entries in content, which is a CNT change. T6, and STR-Q03 asks whether it is in scope at all                                                                                                                                     |
| STR-045                   | The permission is access.md's and is applied by the route below. Navigating to the node and highlighting it is the document view's                                                                                                                      |
| STR-047, STR-052          | Both need baselines, which [storage-and-versioning.md](storage-and-versioning.md) designs and nothing builds; STR-052 also needs a publication record, which is PUB's                                                                                   |
| STR-050                   | The declaration is here (STR-048, STR-049); an output writer ignoring it without error is that writer's - PUB's and [word-output.md](word-output.md)'s                                                                                                  |
| STR-060                   | The node carries a title and a `values` member, and a value in it is validated exactly as a component's is ([metadata.md](metadata.md)). **Which** schemas apply comes from the template's section-level assignments (TPL-054), and TPL is not designed |
| CNT-046                   | An equation in a heading is answered - a title is inline content. **An equation in a caption is not representable**, because captions are strings in the model; that half is content-model.md's, raised as issue #88                                    |
| CNT-079, CNT-072          | Exposing structure to assistive technology, and one continuous scroll, are the document view's                                                                                                                                                          |
| TPL-027, TPL-015, TPL-030 | A document owning its outline after instantiation, what a template lets an author change, and a missing required section are all about instantiation, which is **TPL**'s                                                                                |
| API-037, MET-034, VER-018 | Preconditions on every route, where a schema may apply, and what a baseline pins are rules for the whole product, honoured here and owned elsewhere                                                                                                     |

## What this design needs from the content model, and from the corpus

Four things, each a consequence of a decision here and each silent if it is missed.

**A cross-reference's target cannot be a string.** `crossReferenceNodeSchema` carries
`target: z.string().min(1)` today. A bare identifier does not name a target: STR-032 requires a
reference to reach another component of the same document, and STR-056 requires a reference inside a
component to resolve against the occurrence the reader is in. Both hold only if the target is a
structured value with an optional occurrence. Modelled as a string, a cross-component reference
resolves against the first occurrence and nothing errors - the exact failure content-model.md
already predicted and the schema does not yet prevent.

**A cross-reference needs an identifier of its own.** STR-029 requires a failure that names "both the
reference and its target", and an inline node has none. The design's fallback is the weaker form
CNT-107 already uses for a table anchor, the occurrence, the containing block and an index within
it, and it degrades the moment the block is edited. An `id` on the node is the sound answer, and it is
a content-model change.

**A cross-reference needs a member for STR-055's alternative.** A page reference in a format with no
pages must render a declared alternative form. There is nowhere to declare one: the node holds
`target` and `display` and nothing else. Until there is, STR-055 can only fail the publish, which is
half of what it asks.

**A footnote's identifier is not required to be unique within its component.**
`parseContentDocument`'s uniqueness walk descends into list items, blockquote content and table cells
and **not into footnote content**, and it collects block identifiers only. STR-026 targets a footnote
by identity, so the identity has to be unique in the component that holds it. This is a hole in an
existing invariant rather than a new requirement.

**Three things the corpus is missing, recommended for the issue form and not filed here.**

1. **A caption style.** STR-025 sends caption placement to STY, and STY-003's catalogues are
   paragraph, character, table, image, admonition and citation. A caption style catalogue, or a
   placement member on the existing ones, is the requirement STR-025 assumes exists.
2. **A budget for navigation.** STR-039 cites "the budget in scope §11", which names time to open a
   300-page document as a quantity and gives no number. CNT-136, PUB-064, SCH-033 and REL-031 each
   carry one; this does not, so the requirement cannot be verified. The obvious candidate is the
   interactive budget REL-031 and SCH-033 already use - p95 250 ms, never above 500 ms - stated
   against a document of several hundred nodes.
3. **A statement of what a document is.** TPL-001 says a template is "a named, versioned artifact
   belonging to a space". Nothing says the same of a document: STR-001 presumes one, TPL instantiates
   one, VER versions one, and no requirement declares its identity, its title or its space. This
   design answers it by construction, which is exactly the kind of answer that ought to have a row
   behind it.

## The document artifact

**A document is a fifth artifact kind, and its content is its outline.** `artifact.kind`'s check
constraint gains `'document'`, `artifact_space_by_kind` gains it too - a document is content, so it
lives in exactly one space - and `VersionSubstance` gains a third arm beside `ComponentSubstance` and
`DefinitionSubstance`:

```
DocumentSubstance = { kind: 'document'; content: OutlineDocument }
```

Everything else in the chain works unchanged, which is the point of VER-011 being literally true
rather than a promise seven tables make to each other. `recordVersion` numbers it, digests it and
refuses a version that changed nothing; `artifact_version_type_by_kind` already requires a component
type on a component alone, so a document carries none; `artifact_version_schema_version_is_content`
already requires the row's `schema_version` to be the one inside the content, so an outline carries
its own `schemaVersion` and gets its own migration chain through `migrateStored`, on the same terms
as content - a projection on read, never a rewrite.

**One correction to make in the code, which nothing would catch.** `canonicaliseVersionContent`
sends a non-component's content through plain `canonicalJson`, where no array is a set. **A section
title is inline content, and inline content carries `marks`, which CNT-003 makes a set.** An outline
must therefore canonicalise with the content model's rule, not the shared one. Miss it and two
identical outlines whose marks were built in different orders produce different digests, `recordVersion`
records a version that says nothing new, and comparison's short-circuit stops working - all without
an error.

**And the correction must stop at the title.** The content model's rule treats any member named
`marks` as a set, at any depth. A node's `values` sit in the same tree, and a metadata field whose
identifier happens to be `marks` holds its values in the order given (MET-030); sorted as though it were
formatting, two different orders would digest as one and an edit to the order would be refused as
changing nothing. So `canonicaliseOutline` composes a node member by member: its `title` through the
marks-as-a-set rule, and every other member - `values` included - through the plain one, at every
depth. A test holds the composition to the schema, so a member added to a node and left out of the
canonical form fails that test rather than going undigested.

**`artifact_version_values_by_kind` is left alone.** It permits metadata values on a component alone,
and this design puts no values on a document version: a **section's** field values live on its node,
inside the outline, inside the content, where the content hash and the version digest already cover
them. A **document's** own field values (TPL-055) are the template design's, and widening the
constraint is its change to make.

**Why one kind rather than two.** [storage-and-versioning.md](storage-and-versioning.md) and
[access.md](access.md) listed "a document, an outline" among the artifact kinds, following
VER-011's own wording. This design makes them one, and the reason is STR-012: the outline must be
"versioned with the document, and pinned by a baseline like anything else". Two artifacts are two
chains, two version numbers for one thing, and a document version that has to pin an outline version,
which is a baseline in miniature built for a pair that never diverges. VER-011 is satisfied either
way, because it is a statement about the mechanism rather than a mandate on the inventory. The two
documents' prose was corrected by the pull request that built this.

## The outline, and why it is one tree

```
OutlineDocument = {
  schemaVersion: 1,
  title: string,                 // the document's title, inside the versioned content, as a component's is
  language: BCP 47,
  direction: 'ltr' | 'rtl',
  nodes: Node[],                 // may be empty (STR-054)
}
```

| Node        | Carries                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `section`   | `id`, `title` (inline content), `values`, `numbered`, `matter`, `pageBreak`, `children`             |
| `reference` | `id`, `component` (an artifact id), `mode`, `values`, `numbered`, `matter`, `pageBreak`, `children` |

Both arms carry children, so a component reference can have sections beneath it - a chapter that is
one component and whose sub-sections are others. Both carry the same positional switches, because
STR-048 and STR-017 are properties of a node's place rather than of what fills it. **Both carry
`values` too, and on a reference that is deliberate**: STR-060 asks for a section's, and nothing yet
asks for an occurrence's, but removing the member from a reference later would cost a migration of
every stored outline exactly as adding it later would, while an empty `{}` costs nothing and leaves
room for metadata that belongs to one occurrence of a component rather than to the component.

**A title is inline content, not a string.** CNT-046 requires an equation to work in a heading, and
headings are outline nodes. content-model.md named this as the first of two things it requires of
STR; this is it, taken. The cost is the canonical-form correction above, and it is worth paying at
the schema's first version rather than as a migration of every outline ever stored.

**`mode` is the three REU and LIF name, and only one of them resolves today.** `pinned` carries an
artifact version id; `latest` reads the head of the chain; `approved` reads the latest revision, and
revisions are LIF's and do not exist. The node records which mode it takes, which is what STR-058
asks; resolving `approved` waits on a revision to resolve to, and the design refuses to invent one.

### Why one JSONB tree rather than a row per node

This is the decision most likely to be revisited, so the argument is written out.

**The measurement says the tree fits.** [The version chain plan](../plans/2026-09-15-storage-01-the-version-chain.md)'s
load test, at 200,000 components, cut a version at p95 11.92 ms, opened one at p95 4.41 ms, and read
**900 versions' content in one query at p95 148.8 ms against a 1,000 ms threshold**. An outline of
STR-039's several hundred nodes, whose nodes hold a title and a handful of switches rather than a
component's content, is a fraction of that read - and it is read whole, once, by everything that uses
it.

**Nothing reads part of an outline.** Numbering is a pure function of the entire tree (STR-018,
STR-019): a number at depth 1 changes every number under it. The contents panel renders all of it.
The resolver walks all of it. A store optimised for reading a subtree is optimised for a query this
design does not make.

**STR-008 is one splice in a tree and three writes in rows.** Moving a node with its subtree is, in
a tree, a removal and an insertion of one value; the subtree travels because it is not separable. In
rows it is a reparent plus a reordering of two sibling lists, atomic only if the whole statement is,
and undoable only against a before-state - which, to be one undoable action, is a snapshot of the
tree. Rows arrive at this design with extra steps.

**STR-007's nine levels are the tree's own.** A row store reaches them with a recursive CTE, which is
the shape [relationships.md](relationships.md) already found expensive enough to bound and to plan
for. A tree nests because it nests.

**STR-012 is answered by construction.** The outline is the document's content, so it versions when
the document does and a baseline pins it by pinning the document version. Rows need a version chain
of their own, or a snapshot per version - which is this design, again with extra steps - and VER-011
exists to stop a second versioning mechanism being built.

**What rows would have bought, and where each is answered instead.** Finding the document that holds
a node: the deep link carries both (below). Finding what references a node: the `reference` index
[relationships.md](relationships.md) writes from a version at insert, which this design extends with
a row per component reference in the outline. Partial writes on a very large outline: the
measurement, and the note in [Open questions](#open-questions) about where it would stop being true.

## Identity

**A node's identifier is 128 random bits, spelled as 26 lower-case base32 characters** - the spelling
`blockIdentifierFrom` already fixes for a block, used here so the product has one identifier spelling
and not two. It is allocated when the node is inserted, by the service, and it is never reused
because nothing recycles one: the allocator is random and there is no free list to draw from.

**Uniqueness is checked within the outline at every write**, in the parse the way a component's block
identifiers are checked within their component. STR-053 asks for uniqueness within the tenant, and
across documents the guarantee is the one the product already accepts for `gen_random_uuid` and for a
block identifier: 128 bits from the platform's own source. That is stated plainly rather than implied,
because the alternative - a tenant-wide node table with a unique key - is a second store to keep in
step with the outline, and the only question it would answer is one the deep link answers by carrying
the document.

**A node's identity and a block's identity are different things, and the difference is the whole
design.** A block identifier is unique within its **component**, deliberately (CNT-002), because the
same component appears in a document more than once and each appearance holds the same blocks. A node
identifier is unique within the **tenant**, because a node is an occurrence. Everything positional is
keyed by a node, and everything inside a component is keyed by a node **and** a block.

## Editing the outline

**There is no document lock, and there cannot be one by accident.** STR-059 says so, COL-N02 says so,
and `component_lock`'s `kind text not null default 'component' check (kind = 'component')` makes an
attempt fail at the database rather than in review. Component locks keep doing their own job: a node
points at a component, and editing that component's content still claims its lock
([component-editor.md](component-editor.md)).

**Five operations, and each one is a version.**

| Operation | Carries                                                                       | Refuses                                                                                                          |
| --------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Insert    | Parent, position, and the node                                                | A parent that is not in the outline; a position past the end of its children                                     |
| Move      | Node, new parent, position                                                    | A node that is not there; a parent inside the node's own subtree, or not in the outline; a position past the end |
| Remove    | Node                                                                          | A node that is not there. The subtree goes with it                                                               |
| Retitle   | Node, the new title as inline content                                         | A node that is not there, or not a section; a title the content model will not parse                             |
| Set       | Node, and at least one of `numbered`, `matter`, `pageBreak`, `mode`, `values` | A node that is not there; a `set` naming no switch; a `mode` on a section; a `mode` of `pinned` with no version  |

A body the union does not accept - a title that will not parse, `pinned` with no version, a `set`
naming nothing - is refused at the door as `invalid_request`; the rest are the domain's, answered
`outline_invalid` with the domain's own fixed reason. **A move's position counts the new parent's
children once the node has left them**, so moving the first of three siblings to position 2 puts it
last; the keymap and the pointer both compute positions in one module, which a test holds to the
domain's own operation, so the two cannot read the convention two ways.

Every one carries `openedFrom`, the version the renderer read the outline at, and every one goes
through `recordVersion`, which answers `version.precondition` with the current outline when somebody
else moved first, and `version.unchanged` when the act put things back where they were - answered
`200` with the outline as it stands, not as a refusal, because putting something back is not a
mistake. The renderer surfaces the conflict against the outline that came back rather than retrying.
That is API-037 and STR-059 with nothing added.

**A stale caller is told it is stale before anything else.** An operation is applied to the version it
was opened from, so one that does not apply there - removing a node somebody else has since added -
would otherwise be answered `outline_invalid`, which gives the caller nothing to recover from. Once the
body is well formed and the caller may edit, the route answers `version_precondition` with the current
outline whenever `openedFrom` is not the latest - including an `openedFrom` that is not one of this
document's versions at all, as `cutVersion` answers one that is not a component's latest - and
`outline_invalid` only for an operation refused against the latest version. Versions are only ever
appended, so a latest that differs from `openedFrom` stays different, and no lock is needed to say so.

**A version per structural act, and no editing session.** This differs from the component editor
deliberately: an outline is not prose. A drag is one drop, a retitle is one commit, and each is a
decision worth a row in a permanent chain - the chain reads as "Ada moved 4.2 under 4.1" rather than
as keystrokes. The load test's 11.92 ms cut is what makes it affordable, and `version.unchanged`
keeps a move that ends where it started out of the chain. The alternative, an iteration store as a
component has, is weighed in [What was ruled out](#what-was-ruled-out).

**Undo is one entry per operation** (STR-008), held in the renderer as the one operation that takes
each act back, computed from the outline before the act and the outline the service returned after it.
An undo is itself an act, and a version. The stack is cleared when a precondition refuses - because
undoing onto an outline somebody else has changed is the silent overwrite STR-059 forbids - and when an
undo is refused as no longer applying, because every entry beneath it was computed for an outline that
will now never exist.

**A removal is the exception: it cannot be undone.** Its inverse would be an insert of the whole
subtree under the identifiers it had, and an insert takes one node and allocates a fresh identifier,
which STR-003 forbids ever reusing - so no operation, and no sequence of them, restores what a removal
took. The panel therefore asks before it removes, saying that the removal cannot be undone and that
nothing before it can be undone afterwards, and a recorded removal empties the undo stack, because
every entry beneath it was computed against an outline that still held what it took. The subtree is
still in every earlier version, which the chain keeps; nothing yet offers it back from there.

**One act at a time, and what is done while one is in flight.** The page sends one operation and waits
for its answer before it sends another; the tree says it is busy through `aria-busy`, and nothing is
disabled under the focus, because a control disabled under the focus drops it to the page in a real
browser. A retitle committed while an act is in flight is held and sent once that act is answered,
from the version it made - unless the act is refused, whether as a conflict, as not permitted, as
no longer there or as not applying, when the held title gives way to the outline now shown rather than
overwriting it, or the author has been signed out, when it is not sent and the page says so. **Every
act but a retitle - a move by key or pointer, an undo, a page-break change, an add or a remove - made
while an act is in flight is ignored**, with `aria-busy` the only sign; the select goes on showing what
the node holds. That is a known limit, not a rule, and it is left for the browser suite to show
whether anybody meets it - a second `Alt+Down` pressed before the first is answered is the likeliest.

**The cycle check runs before the version is recorded** (STR-057). A reachability walk from this
document over the reference index, in the write transaction, refusing with `outline_cycle` and naming
the path. In T1 no cycle is reachable - a document references components and a component references
no document. **It is not built yet**: there is no reference index to walk, because relationships.md's
is designed and not built, so STR-057 stays claimed here and is cited by nothing until the plan that
builds the index writes the check beside it - see [Changed while planning the build](#changed-while-planning-the-build).

**Accessibility.** Every operation can be done from the keyboard as well as by pointer (STR-006). The
tree's keymap moves and inserts: `Alt+Up` and `Alt+Down` to move among siblings, `Alt+Left` and
`Alt+Right` to promote and demote, `Enter` to insert a sibling, `Delete` for a node and its subtree,
asking first, and `Ctrl+Z` to undo. Retitling and setting a switch are form fields beside the tree -
**Title** and **Starts on** - reached with `Tab` like any other. The tree itself is one tab stop with
arrow-key movement, `Home` and `End`, as component-editor.md's toolbar is, and every act announces
what it did - a move, what moved and where it landed. The pointer drags a
node onto another to make it the last child, onto the gap before one to put it there, or onto **Move
to the end of the document**. `Alt+Left` is the browser's Back on Windows and Linux, so the tree takes
every `Alt` and arrow key it is given, and only a browser can show that this is enough.

## Numbering

**One pure function, called in three places.**

```
number(outline, contributions, scheme) -> NumberingTable
```

`contributions` is what each occurrence's component contributes to the sequences: an ordered list of
`{ blockId, kind, numbered }` per occurrence, and nothing else. It is a small projection of content,
computed in the domain from the content the renderer already has open and answered by the service for
components it does not. **The panel does not need a component's content to show its figure numbers**,
which is what makes STR-036 affordable rather than aspirational.

**Why a pure function in `packages/domain` rather than a service call.** STR-036 requires the contents
panel to show numbering as it will publish. That is true only if the panel and the publisher run the
same code, and the surest way to make two things run the same code is for there to be one function.
STR-031 requires resolution afresh on every outline change, which a round trip cannot keep up with.
STR-018's determinism is a property of a pure function and is tested without booting anything, which
is what `packages/domain` exists for.

**The scheme.**

| Member      | Holds                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sequences` | A map from a name to its rule. `section`, `figure`, `table`, `equation` and `footnote` are always present; more may be added                                                          |
| Each rule   | `label` ("Figure"), `format` (decimal, alphabetic, upper or lower roman), `restartAt` (an outline depth, or none), `separator`, and whether the number is prefixed with its section's |
| `matter`    | A variant of every rule for `appendix`, so an appendix numbers in its own scheme with its own restarts (STR-016)                                                                      |

**The scheme is a value this design defines; the layout is what carries one, and PUB owns that.**
Until a layout artifact exists, **the product's default scheme stands in** - decimal sections, figures
and tables prefixed with their chapter, equations continuous, appendices in upper alphabetic. It is
defined here, it is what T1 numbers against, and PUB replaces it with the layout's without the engine
changing. Naming it as a default rather than leaving numbering undefined is what lets STR-036 be true
before PUB is designed.

**The counter stack.** The engine walks the outline depth-first, holding a stack of counters per
sequence. Entering a node at a sequence's `restartAt` depth drops every counter below it. A node with
`numbered: false` is walked for its children and increments nothing (STR-017). A node whose `matter`
is `appendix` switches every sequence to its appendix rule and restarts it.

**The numbering table is the answer to STR-022.** One entry per numbered thing:

| Member     | Holds                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `node`     | The outline node that produced it                                        |
| `block`    | The block, where the thing is a caption-bearing block or a footnote      |
| `sequence` | Which sequence it took from                                              |
| `counters` | The counter stack at that point                                          |
| `rule`     | The rule applied, naming the restart or the matter switch that shaped it |
| `label`    | The rendered form - "Figure 3.2"                                         |

A wrong number is then diagnosable rather than guessable: the entry names the node, the counters and
the rule, and the view that answers "why is this Figure 7?" reads the same table the publisher does.
**Nothing stores it.** It is keyed in memory by the document's version digest, the scheme's version
and the profile, and discarded when any of the three changes (STR-031).

**The order of the four stages is a constraint, not a convention** (STR-051):

```
resolve(outline, heads)            -> Resolved        which version each occurrence takes
conditions(resolved, profile)      -> Resolved        REU's, T4; the identity function today
number(resolved, scheme)           -> NumberingTable
references(resolved, numbering)    -> Bound | Failure[]
```

Each stage takes the previous stage's return type, so calling `number` before `conditions` does not
typecheck and calling `references` before `number` has nothing to pass. REU-028 to REU-030 state the
same order from the reuse side; this is where it is enforced.

## Captions

**A caption's text is the component's; its label and number are computed here.** The content model
holds `caption` on a `table` and a `figure` and nothing on a block `equation`, which carries
`numbered` alone. The engine takes each occurrence's caption-bearing blocks in document order and
increments the sequence for the kind (STR-023). The label comes from the scheme.

**Where a caption is rendered, and on which side of its block, is not here and is not anywhere.**
STR-025 makes placement a style property; STY's six catalogues have no caption style. The design
carries the number and the label and stops, and the gap is named above rather than filled by
inventing a style kind for another area.

## Cross-references

**The target is a closed union, and an occurrence is part of it.**

| Form                     | Reaches                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `{ node }`               | An outline node - a section, or a component reference's own heading |
| `{ block, occurrence? }` | A caption-bearing block or a footnote inside a component            |
| `{ entry }`              | A bibliography entry (**LIB**)                                      |

**`occurrence` absent means "the occurrence I am in".** That single rule answers STR-056 and STR-028
together: a component saying "see Figure 2" carries a target with no occurrence, and resolution binds
it to whichever occurrence is being resolved - so the same stored sentence resolves to Figure 2 in one
place and Figure 7 in another, which is what STR-021 makes true of the numbers and STR-056 makes true
of the references to them. `occurrence` present names an outline node and reaches another component of
the same document (STR-032).

**Resolution reads the numbering table and never the component.** For each cross-reference in the
resolved document, the key is `(occurrence, block)` or `(node)`; the entry gives the number, and the
node gives the title. A target with no entry is a failure naming the reference and the target it
wanted, and that list is what PUB-072 fails a publish on.

**`display` decides the form, and two of its five are not answerable here.** `number`, `title` and
`numberAndTitle` come from the table. `page` needs the paginator, and `relative` - "above", "below" -
needs to know where the reader is on a page nobody has composed yet, which is STR-Q04's whole point.
Both leave this design as a resolved target with an unresolved form, for the publisher to finish.

**A stale number is not renderable because there is no number to go stale** (STR-031). The
cross-reference node has no member for one; the table is discarded with its inputs; and the renderer
draws from the table it holds, which is the table for the outline it holds.

## Navigation

**The contents panel is the outline, rendered.** It shows every node with the number the engine gives
it (STR-036), it updates because it renders the outline every operation returns rather than a copy of
one (STR-034), and clicking a node takes the reader to it (STR-035's second half). Reordering from the
panel is the move operation (STR-037).

**Tracking the reader's position as they scroll is the document view's**, and the document view is
the next slice of the editor. The panel's half of STR-035 is here and the claim is not, for that
reason.

**Several hundred nodes** (STR-039) is what the panel is built for: the outline is one value the
renderer already holds, rendering is windowed over the visible depth, and a move is a splice rather
than a re-fetch. What is missing is the number the requirement is measured against, and that is named
above rather than assumed.

## Generated lists

Two functions over the numbering table, because every generated list is the same question asked of a
different sequence:

- `contents(numbering, depth)` - the section sequence's entries to a depth, each with its node,
  number, title and depth (STR-040). **PUB** renders it, and PUB-037 declares the depth.
- `listOf(numbering, sequence)` - one sequence's entries in order (STR-041). Figures, tables and
  equations are three calls; a sequence the layout adds is a fourth, with no new function.

Both read the table produced after `conditions`, so STR-042 falls out of the pipeline's order once
conditions exist rather than needing a rule of its own.

## Deep links

**A node's URL names the document and the node, both by identifier.** Nothing in it is positional, so
a reorder cannot invalidate it (STR-046), and the document's presence is what makes the node findable
without a tenant-wide node index.

Opening one is `read` on the **document** artifact, decided by the route helper as any other route's
is, and answered 404 when the caller may not read it - indistinguishable from a document that does not
exist, which is access.md's rule and not a new one. **A node pointing at a component the recipient may
not read still resolves**: access.md is explicit that a document's grants do not reach its components,
so the link opens the document at the node's place with that component withheld. Navigating to the node
and highlighting it in the body is the document view's, which is why STR-045 is not claimed.

## Page breaks

`pageBreak` is a member of the node - `none`, `page` or `recto` - and there is no member for one
anywhere in the content model, which is what makes STR-049 structural rather than a rule somebody
remembers. It settles CNT-Q07 the way STR section 10 settles it: "this section starts on a new page"
is a property of a position and belongs here; "keep these two blocks together" is a property of the
blocks and stays in content, as a block style.

An output format with no pages drops the declaration and reports nothing (STR-050), which is that
writer's behaviour and not this design's.

## Stores

One migration, in each tenant's schema, and no new table:

| Change                             | Why                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact.kind` gains `'document'` | A document is versioned by the one mechanism (VER-011)                                                                                                                     |
| `artifact_space_by_kind` widened   | A document is content, so it lives in exactly one space (access.md)                                                                                                        |
| `reference` gains outline rows     | [relationships.md](relationships.md)'s index, written from a document version at insert, one row per component reference, so the cycle check and where-used read one place |

`artifact_version` gains nothing but a wider author check: 0016 requires an author of a document
version as 0015 required one of a component's. `component_lock` is untouched, and its check
constraint is what enforces COL-N02. **The `reference` row is not built**: there is no `reference`
table in any tenant migration, so migration 0016 widens three checks and adds nothing.

## Routes

Every route follows [service-foundations.md](service-foundations.md) and declares the permission and
target it checks, as `packages/api-contract`'s `RouteAccess` already requires.

| Route                                  | Permission     | Carries                         | Does                                                                                           |
| -------------------------------------- | -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /v1/documents`                    | Signed in      | `cursor`, `limit`               | The documents the caller may read, filtered by the readable set inside the query               |
| `POST /v1/spaces/{space}/documents`    | Create, space  | Title, base language, direction | Creates a document and its version `0.1`, with an empty outline (STR-054)                      |
| `GET /v1/documents/{id}`               | Read, artifact | -                               | The latest version: the outline, its version, and each occurrence's resolved component version |
| `GET /v1/documents/{id}/numbering`     | Read, artifact | -                               | The numbering table, for a caller that has not loaded every component                          |
| `POST /v1/documents/{id}/outline`      | Edit, artifact | `openedFrom`, one operation     | Applies one operation and cuts a version; answers the new outline and its version              |
| `GET /v1/documents/{id}/contributions` | Read, artifact | `occurrences`                   | What each named occurrence's component contributes to the sequences                            |

**Four of the six are built, and two of those short of this table.** `GET /v1/documents` carries
neither `cursor` nor `limit` and answers everything the caller may read at once, which is correct and
linear in the number of documents; `GET /v1/documents/{id}` answers each reference node as it is
stored, naming its component and its mode, with no resolved component version. The numbering and
contributions routes wait for numbering. Creating answers `200` rather than `201`, for the reason
component-editor.md gives: a permission-checked handler cannot set a status.

**One route for five operations, not five routes.** Each is one act against one outline at one
version, they share every refusal, and a sixth operation should be a member of a closed union rather
than a new path with the same preconditions copied into it.

**Each route checks the kind itself.** `authorise` never looks at an artifact's kind, so a
component's id on a document's route is answered `404` by the handler once its permission is
decided, and the other way round. Because `edit` is decided first, a caller who may read that
component but not edit it is answered `403` on `POST /v1/documents/{id}/outline` instead, which tells
them nothing they could not already read; the component routes order it the same way.

**The refusals**, in the one error shape, with underscored wire codes as
`apps/service/src/wire-codes.ts` maps them:

| Code                   | Means                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_precondition` | The outline is not the one the caller opened - somebody else changed it, or `openedFrom` is not this document's; the current one comes back with it |
| `outline_cycle`        | The reference would close a cycle, naming the path (STR-057). Not built                                                                             |
| `outline_invalid`      | The operation does not apply to the latest outline - a parent inside the moved subtree, a node that is not there - with the domain's fixed `reason` |
| `content_invalid`      | Creating: a title that is blank once trimmed, or a language tag that is not one. A title in an operation that will not parse is `invalid_request`   |

## Where the code lives

| Where                   | What                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | The outline schema and its parse, the five operations as pure functions over a tree, `number`, `contents`, `listOf`, reference resolution, and the contribution projection             |
| `packages/db`           | The migration, `createDocument`, `readDocument`, `listReadableDocuments`, and `editOutline`, which applies an operation and records it through `recordVersion`; later, the cycle check |
| `packages/api-contract` | The routes above                                                                                                                                                                       |
| `apps/service`          | The handlers, and the mapping from the store's dotted answers to the wire codes                                                                                                        |
| `packages/editor`       | The title editor: one ProseMirror view per node title, over an inline-only schema. Not built: the panel edits a title as plain text for now                                            |
| `apps/web`              | The contents panel, its keymap, and the undo stack over returned outlines - built as the outline panel in `src/structure/`, with no numbers                                            |

**The operations are pure functions over a tree, and the service applies them.** `packages/domain` is
where a tree operation can be property-tested without a database, and where determinism is provable.
The service's part is the transaction: read the version the caller opened from, apply, check the
cycle once there is an index to walk, and record - never rebasing one person's act onto another's.

## Verification

- **Numbering as a table-driven suite**, one case per scheme feature: restarts at three depths,
  appendices, excluded nodes, a component referenced twice, a sequence the scheme adds. Each asserts
  the **numbering table** - the counters and the rule - and not only the rendered label, because a
  label that happens to be right for the wrong reason is what STR-022 exists to catch.
- **Determinism as a property test** (STR-018): the same outline numbered twice, and numbered again
  after its nodes are rebuilt in a different construction order, produces an identical table.
- **Nine levels** (STR-007): a generated outline at depth nine numbers, renders and round-trips.
- **The operations as property tests**: after any generated sequence of operations, every node has an
  identifier, identifiers are unique, no node is its own ancestor, and every subtree that moved
  arrived whole.
- **The canonical form**: two outlines differing only in the order their marks were built produce one
  string - the correction under [The document artifact](#the-document-artifact), held by a test so it
  cannot be undone by somebody simplifying `canonicaliseVersionContent`.
- **The precondition** (STR-059): two operations against one outline from one version; the second is
  answered `version_precondition` with the first's outline, and the chain holds exactly two versions.
- **The cycle check** (STR-057): refused where a cycle would close, with the path named, written now
  against a hand-built reference index even though T1 cannot reach one.
- **Cross-references** (STR-028, STR-032, STR-056): one component containing "see Figure 2",
  referenced twice, resolves to two different numbers in one document - the case that fails silently
  if the target is a bare identifier.
- **An empty outline** (STR-054): a document created, read, numbered and listed with no nodes, with
  no error anywhere.
- **Accessibility**, which needs a browser: the panel's keymap, its announcements and its focus
  handling, in the suite component-editor.md's build plan introduces. **No release claims STR-006
  without it.**
- **Navigation at several hundred nodes**: measured, on a declared reference configuration, and
  recorded beside the budget the corpus does not yet have.

## What was ruled out

- **A row per outline node.** Argued above. The short version: nothing reads part of an outline, the
  measurement says the tree fits, and rows arrive back at a snapshot per version anyway.
- **The outline as an artifact of its own, beside the document.** Two chains and two version numbers
  for a pair that never diverges, and a document version that pins an outline version - a baseline
  built for two rows.
- **An editing session with iterations, as a component has.** It would need `iteration`'s
  `kind = 'component'` check widened and a visibility rule VER-002 cannot supply, because VER-002
  makes an iteration visible to the lock holder and STR-059 forbids a document lock. Two people would
  each accumulate a session, and the second to cut would lose one. A version per act refuses the
  second act instead, which is smaller and sooner.
- **A tenant-wide outline node table.** It would make STR-053 a constraint rather than an argument,
  and it is a second store to keep in step with the outline. The only question it answers is finding a
  document from a node, which the deep link answers by carrying the document. Named in
  [Open questions](#open-questions) because STR-Q02 could change the answer.
- **Storing the numbering table.** STR-019 forbids storing a number, and a cache of the whole table
  keyed by its inputs is what this design has instead - discarded rather than invalidated, because an
  invalidation somebody forgets is the stale number STR-031 forbids.
- **A number computed on the server for the panel.** It puts a round trip in front of every keystroke
  and makes STR-036 true by agreement rather than by identity.
- **Storing a section's depth on its node**, as the spike's `OutlineSection` did. A depth is a
  position, a position is derivable, and two sources for one fact is how an outline comes to disagree
  with itself.

## Open questions

| ID          | Question                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-Q01** | Whether a number may ever be overridden by hand. This design has nowhere to put one, which is the default answer the question already states                                                                                                        |
| **STR-Q02** | Whether cross-references cross documents. If they do, the target union gains an arm naming a document and a baseline, and the tenant-wide node table ruled out above comes back as a way to resolve one                                             |
| **STR-Q04** | How "above" and "below" resolve. Unchanged by this design: the target resolves here and the form is left for the paginator                                                                                                                          |
| New         | **A version per structural act, at what size does it stop being right?** A 500-node outline restructured over an afternoon is several hundred versions in a permanent chain. Settled by watching a real document being built                        |
| New         | **Where the tree stops fitting in one document.** The measurement covers a component's content at 200,000 components; an outline of several thousand nodes is not measured, and an import of a large book is where it would first appear (**IMP**)  |
| New         | **Whether a section's `values` belong on the node or beside the outline.** On the node they are covered by the version digest for nothing; beside it they are queryable without parsing the tree. Settled by SCH-053's search over section metadata |

## Changed while planning the build

[The first structure plan](../plans/2026-09-18-structure-01-the-document-and-its-outline.md) was
written against this document and proved in code before it was built, and found ten things; building
it, and reviewing each task, found ten more, marked as such. One requirement claim is new, STR-061
(issue #120): nothing in the corpus declared what a document is. No other claim changed. STR-057,
STR-034, STR-036 and STR-037 stay claimed and are cited by nothing, for the reasons in the rows below,
and so does STR-004: its statement is a negative, and what a test can show is the construction that
makes it hold, not the statement itself.

| Found                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The version chain assumes every artifact that is not a component is a definition**, parsing its content by kind and demanding its payload repeat the artifact's id; adding a third kind would not have compiled        | `prepare`, `createArtifact` and `recordVersion` branch on three kinds; a document's identity is its artifact row's, and an outline carries no id of its own                                                                                                                                                                                                                       |
| **Migration 0016 cannot ALTER `artifact_version` on a fresh environment**: every migration of a tenant runs in one transaction, and 0015's insert leaves a pending trigger event on the table (55006)                    | 0016 sets `artifact_version_component_type_recorded` immediate before the ALTER and deferred again straight after, with the reason in the migration - named rather than `set constraints all immediate`, which would stay in force for every later migration in the same transaction. It fails only on a fresh environment, which is the path everybody uses, so a test runs both |
| **STR-057's cycle check has no index to walk**: "Stores" says `reference` gains outline rows, and there is no `reference` table                                                                                          | Not built. In T1 no cycle is reachable at all; STR-057 stays claimed and is cited by nothing until relationships.md's index exists ("Editing the outline", "Stores")                                                                                                                                                                                                              |
| **`artifact_version_component_author` let a document version have no author**                                                                                                                                            | 0016 widens it to `kind not in ('component', 'document')`                                                                                                                                                                                                                                                                                                                         |
| **The canonical-form correction is right, and reachable only by a hand-built value**                                                                                                                                     | Built and held by a test, with the shared rule run against the same pair to show it gives two strings                                                                                                                                                                                                                                                                             |
| **An administrator may read a space they may not create in**, so a page offering every readable space would offer refusals                                                                                               | **New document** offers only what `GET /v1/spaces` says `mayCreate` for, as **New component** does, through one shared loader                                                                                                                                                                                                                                                     |
| **A section's `values` have nowhere to come from**: TPL-054's section-level assignments do not exist                                                                                                                     | The member is stored and validated by nothing, said here. STR-060 stays unclaimed                                                                                                                                                                                                                                                                                                 |
| **`version.unchanged` is not a refusal**                                                                                                                                                                                 | An act that leaves the outline as it was answers `200` with the outline as it stands, the shape `cutVersion` already answers ("Editing the outline")                                                                                                                                                                                                                              |
| **The two content-model holes are free to close today and a migration later**                                                                                                                                            | Named and not closed here: a cross-reference's bare target, and the uniqueness walk that does not descend into footnote content                                                                                                                                                                                                                                                   |
| **The panel is not yet a table of contents**                                                                                                                                                                             | It shows no numbers and jumps nowhere, so STR-034, STR-036 and STR-037 stay claimed and cited by nothing until the navigation plan                                                                                                                                                                                                                                                |
| **Built: the content model's marks rule reached a section's `values`**: applied to the whole tree, it would sort a metadata field whose identifier is `marks`, so two orders of its values (MET-030) would digest as one | The canonical form is composed member by member - the title through the marks rule, everything else through the plain one - and a test fails if a member is added to a node and left out ("The document artifact")                                                                                                                                                                |
| **Built: an operation that does not apply to a stale version would have been answered `outline_invalid`**, which leaves the caller nothing to recover from                                                               | A stale caller is told it is stale first, with the current outline ("Editing the outline")                                                                                                                                                                                                                                                                                        |
| **Built: a stored outline that does not read** had no answer                                                                                                                                                             | It is a broken store rather than the caller's mistake. On the outline route it is thrown, logged, and answered `500` with a fixed message that names neither the document nor why; `GET /v1/documents/{id}` answers the stored content as it is, and the page, parsing it with the domain's `readOutline`, says **This document could not be read.** rather than showing it       |
| **Built: a removal cannot be undone**, so "the inverse of an operation is another operation" is false for one of the five                                                                                                | The panel asks first and says so, and a recorded removal empties the undo stack ("Editing the outline")                                                                                                                                                                                                                                                                           |
| **Built: an act made while another is in flight** had no rule                                                                                                                                                            | A retitle is held and sent after, or given way to behind any refusal; every other act - a move by key or pointer, an undo, a page-break change, an add or a remove - is ignored with only `aria-busy` to say so, a known limit ("Editing the outline")                                                                                                                            |
| **Built: an operation's edges were unsaid** - a `set` naming no switch, a position past the end, and whether a same-parent move reads its position before or after the node leaves                                       | A `set` must name a switch and a position past the end is refused; a move's position counts the children once the node has left them, pinned by a test in the domain and one in the panel ("Editing the outline")                                                                                                                                                                 |
| **Built: two routes fall short of "Routes"**                                                                                                                                                                             | `GET /v1/documents` is not paged, and `GET /v1/documents/{id}` resolves no component version for a reference: both said under "Routes", and left for later plans                                                                                                                                                                                                                  |
| **Built: `content_invalid` meant a title that will not parse**, and a title in an operation is refused by the body's schema before any handler runs                                                                      | `content_invalid` is creating's alone - a blank title or a tag that is not one; an operation's title that will not parse is `invalid_request` ("Routes")                                                                                                                                                                                                                          |
| **Built: a reader naming a component's id on the outline route** would be told something by the order of the checks                                                                                                      | `403` rather than `404`, because `edit` is decided before the kind, which tells them nothing they could not already read ("Routes")                                                                                                                                                                                                                                               |
| **Built: nothing changes a document's own title, language or direction** once it is made: the five operations are over nodes                                                                                             | Not changed here: named in the plan as left undone                                                                                                                                                                                                                                                                                                                                |
