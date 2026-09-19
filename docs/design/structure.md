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
> [Changed while planning the build](#changed-while-planning-the-build). **Numbering is built too**, by
> [the second structure plan](../plans/2026-09-18-structure-02-numbering.md): the scheme and the
> product's default, what a component's content contributes, `resolve`, `conditions` and `number`,
> the numbering route, which resolves each occurrence to a component version, and section numbers in
> the outline panel. **Navigation is built too**, by
> [the third structure plan](../plans/2026-09-18-structure-03-navigation.md): the contents panel with
> its lists, `contents` and `listOf`, a node's address, and the contributions route. What is still
> design here: caption numbers shown in the renderer, resolving a cross-reference, the cycle check, a
> component version resolved for each occurrence on `GET /v1/documents/{id}`, and a title edited as
> inline content rather than as plain text. A cross-reference's stored shape - its identifier, its
> target and `withoutPages` - is built, by
> [the third content-model plan](../plans/2026-09-18-content-model-03-footnotes-and-cross-references.md).
> The content model spike's flat `OutlineSection`, in
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

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-001** | A document artifact's content is one `outline` document; its root holds one ordered array of nodes and there is nowhere to put a second                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **STR-002** | `node` is a closed discriminated union of `section` and `reference`. A third arm is a schema version with a migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **STR-003** | `id` is required on every node, allocated from 128 random bits at insertion, spelled by the domain, and never reused - nothing reissues, because nothing recycles                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **STR-004** | A section is a node inside one outline document. It has no artifact row, so there is no identity to share it by and no route that could return one                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **STR-006** | The outline panel reorders by pointer and by an enumerated keymap, and the same five operations are the routes below. All three go through one set of operations                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **STR-007** | Nesting is the tree's own, bounded by the parse at 64 levels - far above nine - so no stored outline is too deep to read; the numbering scheme's counters are a stack rather than nine named members                                                                                                                                                                                                                                                                                                                                                                                                      |
| **STR-008** | A move names a node, a new parent and a position among its siblings; the subtree travels because it _is_ the subtree, and the whole move is one version and one undo entry                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **STR-010** | Two nodes may name one component. Each is a node with its own `id`, and every occurrence-bearing thing below - numbering, captions, references - is keyed by the node, not the component                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **STR-012** | The outline is the document version's content, so it is versioned by the act of versioning the document; `baseline_pin` pins a document version like any other (VER-018)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **STR-014** | `sequences` is an open map from a name to its rule, with `section`, `figure`, `table` and `equation` always present. A further sequence is a member, not a code change                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **STR-015** | A sequence's rule carries `restartAt`, an outline depth. The engine's counter stack drops every counter below that depth on entering a node at it                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **STR-016** | A top-level node carries `matter`, inherited by its subtree; a sequence declares a rule per matter, so an appendix numbers in its own scheme with its own `restartAt`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **STR-017** | A node carries `numbered`, and an unnumbered node is walked for its children and never increments a counter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **STR-018** | `number(conditioned, scheme)` is pure: no clock, no identifiers minted, no iteration order that depends on anything but the tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **STR-019** | No number is representable. The content model has no member for one, the outline holds switches rather than values, and the numbering table is returned rather than written                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **STR-021** | The engine walks occurrences, not components. A component referenced twice is two walks over one content document, and its captions take two numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **STR-022** | Every entry in the numbering table names the node that produced it, the block where it is a caption or a footnote, the sequence and the matter, the section counter stack at that point, its own counter's value and the node that last restarted it; the rule applied is named by the table's scheme with the entry's sequence and matter                                                                                                                                                                                                                                                                |
| **STR-028** | Resolution reads the numbering table, which is built for one document. The component is never consulted: it holds a target, and targets carry no answer                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **STR-031** | Nothing caches a number. The numbering table is computed from the outline, each occurrence's resolved component version and the scheme whenever it is asked for, and every answer names each occurrence's version. A cache, when one is needed, is keyed by the document version, every occurrence's resolved component version, the scheme and the profile - the document's digest alone misses a `latest` component's new head. That a stale number cannot be rendered is answered in [Cross-references](#cross-references): a cross-reference has no member for a number, so there is none to go stale |
| **STR-032** | A `block` target reaches a block or footnote of the reference's own component; a `component` target reaches a block or footnote of another component of the same document                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **STR-056** | A `block` target carries no occurrence, and resolution binds it to the occurrence being read, so one stored reference resolves once per occurrence                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **STR-062** | Resolution binds a `block` target to the occurrence being read and a `component` target to that component's one occurrence, and returns a failure naming the reference and its target where there are none or several - never the first                                                                                                                                                                                                                                                                                                                                                                   |
| **STR-036** | The panel calls the same `number` the publisher calls, with the same scheme, so the two cannot disagree - not by agreement, but by being one function                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **STR-037** | Reordering in the panel is the move operation, from the panel's own drag and from its keymap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **STR-063** | The document route, the contributions route, the numbering route and an outline act are each measured in the service suite over a document of 500 nodes and 400 occurrences, against p95 250 ms and a maximum of 500 ms, after five warm-up calls that are not measured samples, with the configuration recorded beside the result                                                                                                                                                                                                                                                                        |
| **STR-040** | `contents(conditioned, numbering, depth)` lists every node to the depth, numbered or not, a reference's title left to its caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **STR-041** | `listOf(conditioned, numbering, sequence)` lists one sequence's entries with their captions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **STR-044** | A node's URL is the document's path and the node's identifier, both identifiers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **STR-046** | The URL holds no depth, no number and no position, so there is nothing in it for a reorder to invalidate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **STR-048** | A node carries `pageBreak`: none, a new page, or a new recto page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **STR-049** | `pageBreak` is a member of the node. The content model has no member for one, so the declaration cannot travel with the component                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **STR-051** | The four stages are one function each, and each takes the previous stage's return type. Calling them out of order does not typecheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **STR-053** | An identifier is 128 random bits in the spelling `blockIdentifierFrom` already fixes, validated unique within its outline at every write. Across documents the argument is the one the product already makes for a UUID                                                                                                                                                                                                                                                                                                                                                                                   |
| **STR-057** | Before a version is recorded, a reachability walk from the document over the reference index refuses a cycle with `outline_cycle`, naming the path                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **STR-058** | A reference node carries `mode`: `pinned` with a version, `latest`, or `approved`. The three are closed, and absent is not a fourth                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **STR-059** | Every operation carries the version it was read at and is answered `version_precondition` with the current outline when it is not the latest; `component_lock` refuses a document by a check constraint, so no document lock can be introduced by accident                                                                                                                                                                                                                                                                                                                                                |
| **STR-054** | The root is the document artifact, which carries the identity a top-level deep link addresses, and `nodes` has no minimum - unlike content's, which CNT-124 gives one. The deep link itself (STR-044) is not built, so the cited test shows the empty outline and the root's identity and no link: that clause is answered by the design and demonstrated by nothing yet                                                                                                                                                                                                                                  |
| **STR-061** | A document is an artifact of its own kind: its identity is the `artifact` row, `artifact_space_by_kind` puts it in exactly one space, its title lives inside its versioned content as a component's does, and it versions through the one mechanism                                                                                                                                                                                                                                                                                                                                                       |
| **CNT-041** | `footnote` is a sequence in the scheme like any other, counted over the resolved document rather than within a component                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **CNT-047** | The model's `numbered` decides whether a block equation takes from the equation sequence; an unnumbered one is walked and never increments it                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **IAM-073** | Numbering never reads a component the reader may not read (`numberingInputs`), so its occurrence is unknown and `number` answers `null` for each number it could have moved: every counter in its matter, until that counter next restarts, whatever it holds ([Who is shown what](#who-is-shown-what)). A section number depends on the outline alone                                                                                                                                                                                                                                                    |

STR-062 is answered here as
resolution returning the named failure; failing the publish on it is STR-029's, left unclaimed with
PUB (below).

**STR-023 is not claimed, because one case is unanswered.** Every caption-bearing block takes the
next number in the sequence for its kind ("Captions"), except **a caption met in appendix matter
before any numbered appendix has begun a chapter**: its rule wants a chapter prefix and there is none
to give it, and a bare number would repeat a body caption's label, so it takes no number at all and
uses up none. STR-017's exclusion does not cover it - an unnumbered node loses its section numbers
alone, and a figure in an unnumbered body preface is still `Figure 1` - so the claim would answer
"every caption-bearing block" in part. Issue #129 reopens STR-023: its superseding row answers both
this case and a figure or table explicitly unnumbered, and this design claims that row once it does.

**STR-036 is claimed on two terms that are not built yet.** The panel numbers with the same function
the service does, over the default scheme, so it shows numbering as it will publish only while the
publisher uses that scheme too, and only while no condition hides a node. When PUB brings a layout's
scheme, the panel must be given it; when REU brings conditions and profiles, the panel must number
under the profile being published. Both are named where they land ("Numbering", and the change
history); until then there is one scheme and no condition, and the claim holds in full.

## What this document does not own

Forty-one claims above. The requirements deliberately left out are where this design's edges are, and
each one is a design that does not exist yet rather than a detail.

**The named failure is produced here; failing the publish is PUB's.** This is the split
[content-model.md](content-model.md) already made for CNT-042 and CNT-054, and it applies to three of
STR's sharpest requirements. Reference resolution returns a list of failures, each naming the
reference and its target; PUB-072 already requires publishing to fail on an unresolved
cross-reference. Neither design answers STR-029, STR-030 or STR-055 alone, so neither claims one.

| Left unclaimed            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR-023                   | Answered for every caption-bearing block but one kind of place - a caption before any numbered appendix, which takes no number - named beside the claims above. Issue #129 reopens it                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| STR-013                   | The scheme's vocabulary and its application are here; **PUB-011** puts the declaration on the layout artifact, which is not designed. Answered jointly, claimed by neither                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| STR-024                   | A caption's label - the word "Figure" - is a member of the scheme, and PUB-011 says the layout declares it. The computation is here, the text is the component's, the label is PUB's: three clauses, two elsewhere                                                                                                                                                                                                                                                                                                                                                                                                                                |
| STR-025                   | Caption placement is a style property, and **STY-003's six catalogues contain no caption style**. Nothing this design can do makes the requirement true - see the recommendation below                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| STR-026                   | The target union is built without two of the targets it needs, so it is not claimed. **A bibliography entry**: no `entry` arm until **LIB** says what an entry's identity is. **A component's reference to a section**: a `node` target stands in a section title alone, because a node belongs to one document's outline and a component is used in many - so body text cannot say "see Section 4.2", the most common cross-reference there is. The likely answer is an arm meaning the heading of the node that places the component, resolved per occurrence as a `block` target is. Both are additions to the union and change nothing stored |
| STR-027                   | Number, title and number-and-title resolve here. A **page** needs the paginator, and a **relative** form needs to know what is above the reader on a page that has not been composed - STR-Q04 says so                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| STR-029, STR-030, STR-055 | The named failures, above. STR-030 also needs REU's condition evaluation; STR-055's member exists (`withoutPages`), and rendering it is the publisher's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| STR-020, STR-042          | Condition evaluation is **REU**'s, and T4. The pipeline's second stage is shaped for it and is the identity function until then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| STR-033                   | What references a node is the reference index read backwards, which [relationships.md](relationships.md) designs and nothing builds. T3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| STR-034                   | **Answered for the author's own acts, not another person's.** The panel renders the outline the page holds, so it updates with every act the author makes; a colleague's change reaches it only when the author next acts and is refused, or reloads. The stream carries no document version, and one would have to be withheld from every viewer who may not read the document - a design of its own                                                                                                                                                                                                                                             |
| STR-035                   | Jumping to a node is here; tracking the reader's position as they scroll is the **document view**'s, which is the next slice of the editor and is not designed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| STR-039                   | **The interface's share has no number and no suite.** STR-063 gives the service's share a number and is claimed; the time the page takes to show an answer needs a browser to measure, and is filed as [issue #134](https://github.com/kenhayward/alloy-works/issues/134), to land beside the browser suite                                                                                                                                                                                                                                                                                                                                       |
| STR-043                   | An index needs marked entries in content, which is a CNT change. T6, and STR-Q03 asks whether it is in scope at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| STR-045                   | **The panel's half is built and the claim is not.** Opening a node's link opens the document with that node chosen, focused and marked in the outline, and a document the reader may not read is answered as nothing there (access.md). But a reader following a shared link expects to land on the node's content, and there is no document view to show it; claimed now, the claim would go partial the day that view exists. The document view claims it, going through the same `nodeLink`                                                                                                                                                    |
| STR-047, STR-052          | Both need baselines, which [storage-and-versioning.md](storage-and-versioning.md) designs and nothing builds; STR-052 also needs a publication record, which is PUB's                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| STR-050                   | The declaration is here (STR-048, STR-049); an output writer ignoring it without error is that writer's - PUB's and [word-output.md](word-output.md)'s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| STR-060                   | The node carries a title and a `values` member, and nothing may write into it yet; once something does, a value in it is validated exactly as a component's is ([metadata.md](metadata.md)). **Which** schemas apply comes from the template's section-level assignments (TPL-054), and TPL is not designed                                                                                                                                                                                                                                                                                                                                       |
| CNT-046                   | An equation in a heading is answered - a title is inline content. **An equation in a caption is not representable**, because captions are strings in the model; that half is content-model.md's, raised as issue #88                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CNT-079, CNT-072          | Exposing structure to assistive technology, and one continuous scroll, are the document view's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| TPL-027, TPL-015, TPL-030 | A document owning its outline after instantiation, what a template lets an author change, and a missing required section are all about instantiation, which is **TPL**'s                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| API-037, MET-034, VER-018 | Preconditions on every route, where a schema may apply, and what a baseline pins are rules for the whole product, honoured here and owned elsewhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## What this design needs from the content model, and from the corpus

What this design needed from the content model is built; what it needs from the corpus is listed
after it.

**Built by [the third content-model plan](../plans/2026-09-18-content-model-03-footnotes-and-cross-references.md).**
A cross-reference carries an identifier of its own, unique in its component, so a failure can name
the reference and its target (STR-029); a target that is a closed union of `block`, `component` and
`node`; and `withoutPages`, STR-055's declared alternative on a page reference. Every identifier in a
component - a block's, a footnote's, a footnote paragraph's and a cross-reference's - is unique within
it, and a footnote holds no image and no footnote. The plan changed the target this design first
drew, `{ block, occurrence? }`: an occurrence exists in one outline, so a component that named one
would reach another component's block in one document only, and the product is for reuse.

**Three things the corpus is missing, recommended for the issue form and not filed here.**

1. **A caption style.** STR-025 sends caption placement to STY, and STY-003's catalogues are
   paragraph, character, table, image, admonition and citation. A caption style catalogue, or a
   placement member on the existing ones, is the requirement STR-025 assumes exists.
2. **A budget for navigation.** STR-039 cites "the budget in scope §11", which names time to open a
   300-page document as a quantity and gives no number. CNT-136, PUB-064, SCH-033 and REL-031 each
   carry one; this does not, so the requirement cannot be verified. The obvious candidate is the
   interactive budget REL-031 and SCH-033 already use - p95 250 ms, never above 500 ms - stated
   against a document of several hundred nodes. Landed as STR-063 (issue #119), narrowed to the
   service's share.
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
room for metadata that belongs to one occurrence of a component rather than to the component. **That
argument holds only while every stored `values` is `{}`**, so nothing may write into one yet: `set`
refuses anything but `{}`, and `insert` carries no `values` at all, until TPL-054 - or a requirement
for an occurrence's metadata - says what they hold. Until then nothing validates or reads one, and a
value written now would be a value a later rule might have to refuse in an immutable version.

**A title is inline content, not a string.** CNT-046 requires an equation to work in a heading, and
headings are outline nodes. content-model.md named this as the first of two things it requires of
STR; this is it, taken. The cost is the canonical-form correction above, and it is worth paying at
the schema's first version rather than as a migration of every outline ever stored.

**A title is held to the content model's own rules, not to the shape of an inline node.**
`inlineNodeSchema` leaves a footnote's `content` open, because the recursion between blocks and
inlines closes in the content model's `blocks.ts`; CNT-129's restriction - a footnote holds
paragraphs - is applied by the walk `parseContentDocument` runs, and a section title runs that same
walk, exported from `content/model/` rather than copied, so one rule governs inline content wherever
it is stored. **A heading may hold whatever the content model allows** - a footnote, an image, a
binding, an equation (CNT-046), a variable (REU-019) - validated identically. Word allows a footnote
in a heading, and nothing in the corpus or in this design narrows it; a narrower rule would be a
second inline vocabulary to keep in step with the first. The title schema is one schema, used by the
node, by an inserted section and by a retitle, so a title the store would refuse is refused at the
wire body instead.

**A title has text, and nothing Postgres cannot store.** Its text runs, joined, are not blank once
trimmed - `hasText`, which the editor's `titleAccepted` now is rather than a second spelling of it -
so an API caller cannot store the untitled section the panel refuses. A title of only an equation or
an image is refused with the rest: a title is also what names a node in the contents, in an
announcement and to a screen reader, and those read its words. The document's own title is held to
the same rule. And every string in a title, at any depth, is one a `jsonb` column takes: a NUL, or
half of a surrogate pair, fails the insert, which was answered `500` rather than as the caller's
mistake.

**`matter` is set at the top level alone.** A top-level node carries it and its subtree inherits it
(STR-016), so a node below the top level is `body` and never says otherwise. The parse refuses any
other, which covers `set`, `insert` and `move` in one rule: an operation's result comes back through
the same parse.

**The depth is bounded at 64.** STR-007 asks for nine levels. A recursive parse of an unbounded tree
overflows the stack - between 500 and 800 levels in Node, and fewer in a browser - so a stored
outline deep enough would be unreadable to everyone, on every read, for ever. The parse checks the
bound first, without recursing, so a value of any depth is refused by the bound and never by the
stack.

**The base language is the content model's rule**, `contentDocumentSchema.shape.language`, as
creation and the editor's header already read it - not a restated pattern.

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

| Operation | Carries                                                                       | Refuses                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insert    | Parent, position, and the node                                                | A parent that is not in the outline; a position past the end of its children; a node past the 64th level; a reference to anything but a component the author may read, or pinned to a version of another artifact |
| Move      | Node, new parent, position                                                    | A node that is not there; a parent inside the node's own subtree, or not in the outline; a position past the end; a subtree reaching past the 64th level; an appendix moved below the top level                   |
| Remove    | Node                                                                          | A node that is not there. The subtree goes with it                                                                                                                                                                |
| Retitle   | Node, the new title as inline content                                         | A node that is not there, or not a section; a title the content model will not parse, with no text, or holding a character Postgres cannot store                                                                  |
| Set       | Node, and at least one of `numbered`, `matter`, `pageBreak`, `mode`, `values` | A node that is not there; a `set` naming no switch; a `mode` on a section; a `mode` of `pinned` with no version, or with a version of another artifact; `values` other than `{}`; `matter` below the top level    |

A body the union does not accept - a title that will not parse, is blank or cannot be stored,
`pinned` with no version, `values` other than `{}`, a `set` naming nothing - is refused at the door
as `invalid_request`; the rest are the domain's, answered `outline_invalid` with the domain's own
fixed reason. **A reference's target is checked in the store**, in the write transaction and before
the operation is applied: an inserted reference, or a `set` to `pinned`, must name a **component**
in this environment that the **author may read** - decided with the same facts and the same `decide`
every route uses - and a pinned version must **belong to that component**. Anything else - the nil
uuid, another environment's component, a definition, a document, this one included, a component the
author may not read, a version of some other artifact - is refused `outline_invalid` with one fixed
reason, whatever was wrong with it, so the refusal cannot be used to learn whether an identifier
exists. A document's own id is refused with the rest, which is what keeps a self-reference - the one
cycle T1 could otherwise reach - out of the store. **A move's position counts the new parent's
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

**One pure function, called wherever a number is needed.** The service calls it for a document's
numbering, the outline panel for its section numbers, and the publisher will for what it prints:

```
number(conditioned, scheme) -> NumberingTable
```

It takes the pipeline's second stage (below) rather than an outline and a map, so whatever it numbers
has been through `resolve` and `conditions`, in that order.

**What an occurrence contributes.** `contributionsOf` projects a component version's content to an
ordered list of `{ block, sequence, numbered }` - each figure, table and block equation, and each
footnote, in document order wherever it is nested: a list item, a blockquote, a table cell, a table's
note. A block equation carries `numbered` (CNT-047); every figure and every table is numbered, an
empty caption included. `resolve(outline, contributions)` takes those lists **keyed by occurrence** -
the reference node - and never by component, because one component placed twice is two occurrences
(STR-010, STR-021). **An occurrence absent from the map is one nobody numbering can read**: a
component the reader may not read, an `approved` reference, which resolves to nothing until revisions
exist, or content that does not read.

**The panel needs no contribution.** No section number depends on what an occurrence holds, which a
test holds, so the panel numbers sections from the outline alone, knowing nothing of any occurrence,
and reads no component to do it. A caption's number does depend on one, and nothing in the renderer
shows one yet, so `GET /v1/documents/{id}/contributions` waits for whatever first does.

**Why a pure function in `packages/domain` rather than a service call.** STR-036 requires the contents
panel to show numbering as it will publish. That is true only if the panel and the publisher run the
same code, and the surest way to make two things run the same code is for there to be one function.
STR-031 requires resolution afresh on every outline change, which a round trip cannot keep up with.
STR-018's determinism is a property of a pure function and is tested without booting anything, which
is what `packages/domain` exists for.

**The scheme.**

| Member        | Holds                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | The scheme's name - `default/1` for the product's default - so anything keyed by numbering's inputs can key by it                                                                                                                    |
| `sequences`   | A map from a name to its rules. `section`, `figure`, `table`, `equation` and `footnote` are always present; more may be added                                                                                                        |
| Each sequence | A rule for `body` and a rule for `appendix`, so an appendix numbers in its own scheme with its own restarts (STR-016)                                                                                                                |
| Each rule     | `label` ("Figure", or empty), `format` - a list, one per part of the number from the top, the last repeating, each decimal, alphabetic or roman in either case - `restartAt` and `prefix` (outline depths, or none), and `separator` |

`format` is a list because one format cannot write `A.1`: an appendix's top-level part is alphabetic
and the parts beneath it decimal. A caption's prefix is the section number to `prefix`'s depth,
written with the section rule's formats. **The scheme refuses two things.** A section number is its
counter stack, so the section sequence neither restarts nor takes a prefix. And a rule that restarts
must prefix with the section number down to at least the depth it restarts at, or two restarts of its
counter could print the same label - except a footnote's, because a house style restarting footnotes
per chapter means its labels to repeat.

**The scheme is a value this design defines; the layout is what carries one, and PUB owns that.**
Until a layout artifact exists, **the product's default scheme stands in** - decimal sections;
figures and tables prefixed with their chapter and restarting with it, `Figure 2.4`; equations and
footnotes continuous; appendices `A`, `B`, their sections `A.1`, their figures `Figure A.1` and their
equations `Equation A.1`, each restarting per appendix, and their footnotes from 1 again, running
through every appendix. A section's label is empty, so a section is
`2.1` and not `Section 2.1`. It is defined here, it is what T1 numbers against, and PUB replaces it
with the layout's without the engine changing. Naming it as a default rather than leaving numbering
undefined is what lets STR-036 be true before PUB is designed - **provided PUB brings the layout's
scheme to the panel too**, since the panel's numbers are otherwise the default's while the
publication's are the layout's.

**The counter stack.** The engine walks the outline depth-first in document order, and **each matter
keeps its own counters**: the first appendix is `A` and the second `B`, and a body chapter after them
carries on the body's numbering. For each node, in order:

1. **Its section number**, where it and every ancestor are numbered - **a reference takes one too**,
   being a heading in the outline. A node with `numbered: false` takes none and consumes none
   (STR-017), and **nothing beneath it takes one either**: a number formed from an ancestor that has
   none would be a guess. Taking a section number restarts every other sequence whose `restartAt` is
   that depth or deeper (STR-015).
2. **A section title's footnotes**, which count at their node, before anything beneath it.
3. **An occurrence's contributions**, each taking the next number in its sequence (STR-023). An
   unnumbered equation takes none.
4. **Its children.** What an unnumbered node holds carries on the counters of the numbered node before
   it and restarts nothing: a figure in an unnumbered interlude after chapter 2 is `Figure 2.4`,
   continuing chapter 2's, and one in a preface before any chapter is `Figure 1`, with no chapter to
   prefix it.

A top-level node whose `matter` is `appendix` - and only a top-level node may carry one - numbers its
whole subtree by the appendix rules and the appendix counters. A caption whose rule wants a chapter
prefix, met in appendix matter before any numbered appendix has begun one, has no count to continue
and takes no number rather than a bare one that would repeat a body caption's own label - and uses up
no value of its counter, so the first numbered appendix's first figure is still `Figure A.1`. An
occurrence nobody numbering can read makes every other counter in its matter unknown until that
counter next restarts, whatever the occurrence holds ([Who is shown what](#who-is-shown-what)).

**The numbering table is the answer to STR-022.** It names its scheme, and holds one entry per
numbered thing, a `NumberingEntry`:

| Member        | Holds                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `node`        | The outline node that produced it                                                                     |
| `block`       | The block or footnote, where the thing is a caption-bearing block or a footnote; `null` for a section |
| `sequence`    | Which sequence it took from                                                                           |
| `matter`      | `body` or `appendix`                                                                                  |
| `sections`    | The section counter stack at that point                                                               |
| `value`       | This sequence's own counter                                                                           |
| `restartedAt` | The node whose entry last restarted that counter - for a section, its numbered parent                 |
| `number`      | The number written - `3.2`                                                                            |
| `label`       | The number with its label - "Figure 3.2"                                                              |

The rule applied is not copied into every entry: it is named by the table's scheme with the entry's
sequence and matter. `value`, `number` and `label` are `null` where the number could not be computed
without a guess - a counter an unreadable occurrence has made unknown, or a caption before any
numbered appendix. A section's never is.

A wrong number is then diagnosable rather than guessable: the entry names the node, the counters and
the rule, and the view that answers "why is this Figure 7?" reads the same table the publisher does.
**Nothing stores it, and nothing caches it.** It is computed from the outline, each occurrence's
resolved component version and the scheme whenever it is asked for, and every answer names each
occurrence's version (STR-031). A cache keyed by the document's version digest alone would serve a
stale figure number the moment a `latest` component gained a version, so one, when a measurement asks
for it, is keyed by the document version, every occurrence's resolved component version, the scheme
and the profile. Numbering 330 nodes holding 300 occurrences of 150 components took a median 19.6 ms,
reading them included, so none is built.

**The order of the four stages is a constraint, not a convention** (STR-051):

```
resolve(outline, contributions)      -> Resolved          each occurrence's contributions, by occurrence
conditions(resolved)                 -> Conditioned       REU's, T4; the identity function today
number(conditioned, scheme)          -> NumberingTable
references(conditioned, numbering)   -> Bound | Failure[] structure 4's, and not built
```

Each stage takes the previous stage's return type, and each is a type of its own, so handing `number`
a `Resolved` does not typecheck and `references` has nothing to be passed until `number` has run.
`conditions` takes no profile yet; REU gives it one. REU-028 to REU-030 state the same order from the
reuse side; this is where it is enforced.

## Captions

**A caption's text is the component's; its label and number are computed here.** The content model
holds `caption` on a `table` and a `figure` and nothing on a block `equation`, which carries
`numbered` alone. The engine takes each occurrence's caption-bearing blocks in document order and
increments the sequence for the kind (STR-023). The label comes from the scheme. **Every figure and
every table takes a number**, an empty caption and a table used for layout included, because only a
block equation can say it is unnumbered; issue #129 asks for a figure or a table to be able to say so
too, which is a content schema change for a later plan. The numbering route answers a caption's
number, and nothing in the renderer shows one yet.

**Where a caption is rendered, and on which side of its block, is not here and is not anywhere.**
STR-025 makes placement a style property; STY's six catalogues have no caption style. The design
carries the number and the label and stops, and the gap is named above rather than filled by
inventing a style kind for another area.

## Cross-references

**The target is a closed union of three kinds.**

| Kind                                      | Reaches                                                                                                | May stand in    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| `{ kind: 'block', block }`                | A block or footnote of the component the reference is in, in the occurrence being read                 | A component     |
| `{ kind: 'component', component, block }` | A block or footnote of another component, in that component's one occurrence in the resolving document | A component     |
| `{ kind: 'node', node }`                  | An outline node - a section, or a component reference's own heading                                    | A section title |

**A `block` target has no occurrence, and means the one being read.** That single rule answers STR-056
and STR-028 together: a component saying "see Figure 2" resolves to Figure 2 in one place and Figure 7
in another, which is what STR-021 makes true of the numbers. **A `component` target names the
component, not an occurrence of it**, so it survives the component being used in a second document;
where the resolving document holds that component in no occurrence or in several, resolution fails by
name rather than taking the first (STR-062). A way to say which of several - a key held in the
outline, as DITA's keys are - is a widening for later. **A title's reference names a node and nothing
else**: a title is in no component, and a `component` target in a title would carry a component's
identity past the withholding "Who is shown what" requires. A bibliography entry (**LIB**) joins the
union when LIB says what an entry's identity is.

**A title's reference shows a number or a page, and nothing that could be a title.** Resolving a
title that shows a title resolves that title, so a section whose heading shows its own title, or two
headings showing each other's, would recurse without end. Until resolution can refuse a cycle by name,
the parse refuses a reference in a section title whose `display` is `title`, `numberAndTitle` or
`relative`, and a `page` reference whose `withoutPages` is anything but `number` - the form it falls
back to where there are no pages would otherwise loop the same way. A number and a page are drawn from
the numbering table and the paginator, never from a title, so neither can. Widening this later, once
a cycle fails by name, changes nothing stored.

**Resolution reads the numbering table and never the component.** For each cross-reference in the
resolved document, the key is `(occurrence being read, block)` for a `block` target,
`(that component's one occurrence, block)` for a `component` target, and `(node)` for a `node` target;
the entry gives the number, and the node gives the title. A target with no entry, or a `component`
target whose component the document holds in no occurrence or in several, is a failure naming the
reference and the target it wanted, and that list is what PUB-072 fails a publish on.

**`display` decides the form, and two of its five are not answerable here.** `number`, `title` and
`numberAndTitle` come from the table. `page` needs the paginator, and `relative` - "above", "below" -
needs to know where the reader is on a page nobody has composed yet, which is STR-Q04's whole point.
Both leave this design as a resolved target with an unresolved form, for the publisher to finish.

**A stale number is not renderable because there is no number to go stale** (STR-031). The
cross-reference node has no member for one; the table is computed afresh from its inputs and kept by
nothing; and the renderer
draws from the table it holds, which is the table for the outline it holds.

## Navigation

**The contents panel is the outline, rendered.** It shows every node with the number the engine gives
it (STR-036), and clicking a node takes the reader to it (STR-035's second half). It updates with
every act the author makes, because it renders the outline every operation returns rather than a copy
of one; so STR-034 is answered only for the author's own acts, as "What this document does not own"
says. Reordering from the panel is the move operation (STR-037). **The panel goes to a linked node, chooses it, focuses it and
marks it**, following a deep link (below).

**Tracking the reader's position as they scroll is the document view's**, and the document view is
the next slice of the editor. The panel's half of STR-035 is here and the claim is not, for that
reason.

**Measured, not assumed.** Every node is rendered - nothing is windowed over the visible depth - and a
move is a round trip answering the whole outline rather than a splice. At 500 nodes, opening a document
measured 110 ms p95 and a move in the page measured 91 ms p95; the service's own share is held to
STR-063 in the suite.

## Generated lists

Two functions over the numbering table, because every generated list is the same question asked of a
different sequence:

- `contents(conditioned, numbering, depth)` - every node to a depth, in document order, numbered or
  not: a preface is in the contents with no number, as it is in the outline. A section's title is its
  own; a reference's is left to its caller, because a reference's heading is its component's title
  (STR-040). **PUB** renders it, and PUB-037 declares the depth.
- `listOf(conditioned, numbering, sequence)` - one sequence's entries in order, each with the caption
  its component holds (STR-041). Figures, tables and equations are three calls; a sequence the layout
  adds is a fourth, with no new function.

Both read the table produced after `conditions`, so STR-042 falls out of the pipeline's order once
conditions exist rather than needing a rule of its own.

**The document page lists its figures, tables and equations beneath the outline**, numbered in the
page by the same pipeline: the outline the page holds, run through `resolve`, `conditions` and
`number` over each occurrence's contributions as `GET /v1/documents/{id}/contributions` last answered
them, so a move renumbers every entry before the page hears back from the service. Each entry is a
caption and a link to the occurrence that holds it (below); an occurrence the page has heard nothing
about withholds every number it could have moved, exactly as the numbering route does (IAM-073).

## Deep links

**A node's URL names the document and the node, both by identifier.** Nothing in it is positional, so
a reorder cannot invalidate it (STR-046), and the document's presence is what makes the node findable
without a tenant-wide node index. The address is `#/documents/{document}/nodes/{node}`, the same hash
routing the rest of the workspace uses.

Opening one is `read` on the **document** artifact, decided by the route helper as any other route's
is, and answered 404 when the caller may not read it - indistinguishable from a document that does not
exist, which is access.md's rule and not a new one. **A node pointing at a component the recipient may
not read still resolves**: access.md is explicit that a document's grants do not reach its components,
so the link opens the document at the node's place with that component withheld.

**The address follows what is chosen in the panel, without a history entry per choice and without a
hash change**, so a reload or a copy of the address returns to the same node; choosing another node
replaces it again. Beneath the tree, **Link to** the chosen node's name shows the whole address in a
field, with **Copy link** beside it, which says **Copied the link to** the node's name. Arriving at a
document by a node's link **chooses it, focuses it and marks it** in the outline (STR-045's panel
half) - navigating to the node's content and tracking the reader's position there is the document
view's, which is why the claim stays with it. A link followed a second time to the same node is a new
arrival, and is taken to it again. **A node the address names that is no longer in the document** - one
a colleague removed, or one from another document entirely - says **The linked part is not in this
document.**, and the address keeps what was followed, so a reload shows the same message again.

## Who is shown what

**A reader is never shown the identity of a component they may not read.** access.md says so twice:
"An artifact the caller may not read is indistinguishable from one that does not exist" (access.md,
"Refusing", line 489), and "A document's grants do not reach the components it references"
(access.md, "Deciding", line 404). So every answer that carries an outline -
`GET /v1/documents/{id}`, an act's answer and a `409`'s `current` - carries it as the caller is shown
it: a reference whose component they may not read has `component: null` and, when pinned,
`mode.version: null`. Its `id`, its `type`, its mode's `kind` and its switches stay, so the panel can
still move it, remove it and give it a page break; the panel names it **A component**, the same words it uses
before the components are read, and never says the reader may not read it. Which components they may
read is the readable set, filtered by the one predicate every listing uses (`readableComponents`,
`readableArtifacts`).

**A reader is numbered only from what they may read (IAM-073).** A gap in the numbers says as much
as a number: Figure 1.2 followed by Figure 1.4 tells a reader the component between them holds a
figure. So `GET /v1/documents/{id}/numbering` never reads a component the caller may not read -
`numberingInputs` selects no row of one - and answers its occurrence `version: null`, as it answers
an `approved` reference or content that does not read. `number` treats an occurrence it was given
nothing for as unknown, not empty: every counter in its matter is unknown from there until that
counter next restarts, whatever the component holds, and each number it would have printed is
`null`. A counter that restarts with a chapter is known again in the next one; one that never
restarts - the default scheme's equations and footnotes - stays unknown to the end of the matter.
Section numbers depend on the outline alone and are always shown. So everybody shown a number is
shown the same one, and a missing number says nothing about what the component contains.
`GET /v1/documents/{id}/contributions` answers what the numbering route reads, so a reader is sent no
caption, block or version of a component they may not read, and the page numbers from nothing else.
What the page was sent while the reader could read a component stays on the page until the version it
holds next changes, as the outline does (finding 12).

**Only the view is withheld.** The stored outline is unchanged, and its digests, its versions and
every operation's result are computed on it, never on a view; the domain's `readOutlineView` reads a
view, and a stored-outline parse refuses one. An outline that does not read is shown as nothing at
all - an empty member - because what cannot be parsed cannot have a reference withheld from it; the
page says it could not be read.

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

| Route                                  | Permission     | Carries                         | Does                                                                                                                   |
| -------------------------------------- | -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/documents`                    | Signed in      | `cursor`, `limit`               | The documents the caller may read, filtered by the readable set inside the query                                       |
| `POST /v1/spaces/{space}/documents`    | Create, space  | Title, base language, direction | Creates a document and its version `0.1`, with an empty outline (STR-054)                                              |
| `GET /v1/documents/{id}`               | Read, artifact | -                               | The latest version: the outline and its version, as the caller is shown it                                             |
| `GET /v1/documents/{id}/numbering`     | Read, artifact | -                               | The latest version's numbering table, as the caller is shown it, and the component version each occurrence resolved to |
| `POST /v1/documents/{id}/outline`      | Edit, artifact | `openedFrom`, one operation     | Applies one operation and cuts a version; answers the new outline and its version                                      |
| `GET /v1/documents/{id}/contributions` | Read, artifact | -                               | What each occurrence of the latest version contributes to the sequences, as the caller is shown it                     |

**All six are built.** `GET /v1/documents` carries neither `cursor` nor `limit` and answers everything
the caller may read at once, which is correct and linear in the number of documents. `GET
/v1/documents/{id}` answers each reference node as the caller is shown it
([Who is shown what](#who-is-shown-what)), naming its mode; it resolves no component version, and
**the numbering route does instead**, beside the numbers that version produced: each occurrence's
version, or `null` where the caller may not read the component, where it is `approved` and waits on
revisions, or where its content does not read. The numbering route numbers the latest version alone:
numbering an earlier one waits for baselines (STR-052). **The contributions route takes no
parameter**: it resolves each occurrence itself, as the numbering route does, and names each version
an occurrence resolved to once - however many occurrences name it - rather than once per occurrence,
so a component used many times is not sent many times. It is what the renderer numbers a caption with
(above). Creating answers `200` rather than `201`, for the reason component-editor.md gives: a
permission-checked handler cannot set a status.

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

| Code                   | Means                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version_precondition` | The outline is not the one the caller opened - somebody else changed it, or `openedFrom` is not this document's; the current one comes back with it                            |
| `outline_cycle`        | The reference would close a cycle, naming the path (STR-057). Not built                                                                                                        |
| `outline_invalid`      | The operation does not apply to the latest outline - a parent inside the moved subtree, a node that is not there, a reference target the store refuses - with a fixed `reason` |
| `content_invalid`      | Creating: a title that is blank once trimmed, or a language tag that is not one. A title in an operation that will not parse is `invalid_request`                              |

## Where the code lives

| Where                   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | The outline schema and its parse, the five operations as pure functions over a tree; in `src/structure/`, `scheme.ts` - the scheme, the product's default and the formats - `contributions.ts` - the contribution projection - `numbering.ts` - `resolve`, `conditions`, `number` and `sectionNumbers` - and `lists.ts` - `contents` and `listOf`. Not built: reference resolution                                                                                                  |
| `packages/db`           | The migration, `createDocument`, `readDocument`, `listReadableDocuments`, `readableComponents`, and `editOutline`, which checks a reference's target, applies an operation and records it through `recordVersion`; `numberingInputs`, which resolves each occurrence and reads what the readable ones contribute; later, the cycle check                                                                                                                                            |
| `packages/api-contract` | The routes above                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/service`          | The handlers, and the mapping from the store's dotted answers to the wire codes                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/editor`       | The title editor: one ProseMirror view per node title, over an inline-only schema. Not built: the panel edits a title as plain text for now                                                                                                                                                                                                                                                                                                                                         |
| `apps/web`              | The contents panel, its keymap, and the undo stack over returned outlines - built as the outline panel in `src/structure/`, which shows each node's section number, computed with `number` on every render, and offers **Numbered** and **Appendix** beside each node; `links.ts`, a node's address and the `#/documents/{id}/nodes/{node}` route; the panel's **Link to** field and **Copy link**; and `GeneratedLists.tsx`, the figures, tables and equations beneath the outline |

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
- **Cross-references** (STR-028, STR-032, STR-056, STR-062): one component containing "see Figure 2",
  referenced twice, resolves to two different numbers in one document - the case that fails silently
  if a block identifier alone is resolved - and a `component` target whose component the document
  holds twice fails by name rather than resolving against the first.
- **An empty outline** (STR-054): a document created, read, numbered and listed with no nodes, with
  no error anywhere.
- **Accessibility**, which needs a browser: the panel's keymap, its announcements and its focus
  handling, in the suite component-editor.md's build plan introduces. **No release claims STR-006
  without it.**
- **Navigation at several hundred nodes**: the service's share, STR-063, is measured in
  `apps/service/src/navigation-budget.test.ts`, at a declared reference configuration of 500 nodes and
  400 occurrences, against p95 250 ms and a maximum of 500 ms, in every `pnpm test`. **The interface's
  share** waits for the browser suite, and is filed as
  [issue #134](https://github.com/kenhayward/alloy-works/issues/134).

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
- **Storing the numbering table.** STR-019 forbids storing a number. Nothing caches one either, and
  a cache of the whole table, when a measurement asks for one, is keyed by all its inputs (STR-031's
  row) - discarded rather than invalidated, because an invalidation somebody forgets is the stale
  number STR-031 forbids.
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
it, and reviewing each task, found ten more, marked as such; the final review of the whole branch
found eleven more, all of one kind - the stored outline accepted what a later rule would refuse,
free to fix while nothing is stored and a migration of immutable versions afterwards - marked
**Final review**. One requirement claim is new, STR-061 (issue #120): nothing in the corpus declared
what a document is. No other claim changed. STR-057, STR-034, STR-036 and STR-037 stay claimed and
are cited by nothing, for the reasons in the rows below, and so does STR-004: its statement is a
negative, and what a test can show is the construction that makes it hold, not the statement itself.

| Found                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The version chain assumes every artifact that is not a component is a definition**, parsing its content by kind and demanding its payload repeat the artifact's id; adding a third kind would not have compiled        | `prepare`, `createArtifact` and `recordVersion` branch on three kinds; a document's identity is its artifact row's, and an outline carries no id of its own                                                                                                                                                                                                                                                           |
| **Migration 0016 cannot ALTER `artifact_version` on a fresh environment**: every migration of a tenant runs in one transaction, and 0015's insert leaves a pending trigger event on the table (55006)                    | 0016 sets `artifact_version_component_type_recorded` immediate before the ALTER and deferred again straight after, with the reason in the migration - named rather than `set constraints all immediate`, which would stay in force for every later migration in the same transaction. It fails only on a fresh environment, which is the path everybody uses, so a test runs both                                     |
| **STR-057's cycle check has no index to walk**: "Stores" says `reference` gains outline rows, and there is no `reference` table                                                                                          | Not built. In T1 no cycle is reachable at all; STR-057 stays claimed and is cited by nothing until relationships.md's index exists ("Editing the outline", "Stores")                                                                                                                                                                                                                                                  |
| **`artifact_version_component_author` let a document version have no author**                                                                                                                                            | 0016 widens it to `kind not in ('component', 'document')`                                                                                                                                                                                                                                                                                                                                                             |
| **The canonical-form correction is right, and reachable only by a hand-built value**                                                                                                                                     | Built and held by a test, with the shared rule run against the same pair to show it gives two strings                                                                                                                                                                                                                                                                                                                 |
| **An administrator may read a space they may not create in**, so a page offering every readable space would offer refusals                                                                                               | **New document** offers only what `GET /v1/spaces` says `mayCreate` for, as **New component** does, through one shared loader                                                                                                                                                                                                                                                                                         |
| **A section's `values` have nowhere to come from**: TPL-054's section-level assignments do not exist                                                                                                                     | The member is stored and validated by nothing, said here. STR-060 stays unclaimed                                                                                                                                                                                                                                                                                                                                     |
| **`version.unchanged` is not a refusal**                                                                                                                                                                                 | An act that leaves the outline as it was answers `200` with the outline as it stands, the shape `cutVersion` already answers ("Editing the outline")                                                                                                                                                                                                                                                                  |
| **The two content-model holes are free to close today and a migration later**                                                                                                                                            | Named and not closed here: a cross-reference's bare target, and the uniqueness walk that does not descend into footnote content                                                                                                                                                                                                                                                                                       |
| **The panel is not yet a table of contents**                                                                                                                                                                             | It shows no numbers and jumps nowhere, so STR-034, STR-036 and STR-037 stay claimed and cited by nothing until the navigation plan                                                                                                                                                                                                                                                                                    |
| **Built: the content model's marks rule reached a section's `values`**: applied to the whole tree, it would sort a metadata field whose identifier is `marks`, so two orders of its values (MET-030) would digest as one | The canonical form is composed member by member - the title through the marks rule, everything else through the plain one - and a test fails if a member is added to a node and left out ("The document artifact")                                                                                                                                                                                                    |
| **Built: an operation that does not apply to a stale version would have been answered `outline_invalid`**, which leaves the caller nothing to recover from                                                               | A stale caller is told it is stale first, with the current outline ("Editing the outline")                                                                                                                                                                                                                                                                                                                            |
| **Built: a stored outline that does not read** had no answer                                                                                                                                                             | It is a broken store rather than the caller's mistake. On the outline route it is thrown, logged, and answered `500` with a fixed message that names neither the document nor why; `GET /v1/documents/{id}` answers an empty outline member rather than the stored content (**Final review**: what cannot be parsed cannot have a reference withheld from it), and the page says **This document could not be read.** |
| **Built: a removal cannot be undone**, so "the inverse of an operation is another operation" is false for one of the five                                                                                                | The panel asks first and says so, and a recorded removal empties the undo stack ("Editing the outline")                                                                                                                                                                                                                                                                                                               |
| **Built: an act made while another is in flight** had no rule                                                                                                                                                            | A retitle is held and sent after, or given way to behind any refusal; every other act - a move by key or pointer, an undo, a page-break change, an add or a remove - is ignored with only `aria-busy` to say so, a known limit ("Editing the outline")                                                                                                                                                                |
| **Built: an operation's edges were unsaid** - a `set` naming no switch, a position past the end, and whether a same-parent move reads its position before or after the node leaves                                       | A `set` must name a switch and a position past the end is refused; a move's position counts the children once the node has left them, pinned by a test in the domain and one in the panel ("Editing the outline")                                                                                                                                                                                                     |
| **Built: two routes fall short of "Routes"**                                                                                                                                                                             | `GET /v1/documents` is not paged, and `GET /v1/documents/{id}` resolves no component version for a reference: both said under "Routes", and left for later plans                                                                                                                                                                                                                                                      |
| **Built: `content_invalid` meant a title that will not parse**, and a title in an operation is refused by the body's schema before any handler runs                                                                      | `content_invalid` is creating's alone - a blank title or a tag that is not one; an operation's title that will not parse is `invalid_request` ("Routes")                                                                                                                                                                                                                                                              |
| **Built: a reader naming a component's id on the outline route** would be told something by the order of the checks                                                                                                      | `403` rather than `404`, because `edit` is decided before the kind, which tells them nothing they could not already read ("Routes")                                                                                                                                                                                                                                                                                   |
| **Built: nothing changes a document's own title, language or direction** once it is made: the five operations are over nodes                                                                                             | Not changed here: named in the plan as left undone                                                                                                                                                                                                                                                                                                                                                                    |
| **Final review, critical: a section title skipped the content model's footnote rule** (CNT-129): a retitle could store a footnote holding anything, or nothing, in an immutable version                                  | A title runs the walk `parseContentDocument` runs, exported rather than copied, through one schema for the node, an insert and a retitle; a heading may hold what the content model allows ("The outline, and why it is one tree")                                                                                                                                                                                    |
| **Final review: a reference's target was never checked**: the nil uuid, another environment's component, a definition, a version of another artifact or the document's own id was stored                                 | The store requires a component the author may read, and a pinned version of it, and refuses anything else with one fixed reason ("Editing the outline")                                                                                                                                                                                                                                                               |
| **Final review: a reader learned the id of a component they may not read**, and the page called it one they may not read, which access.md forbids saying                                                                 | Every answer carrying an outline withholds the component and pinned version; the page says **A component** ("Who is shown what")                                                                                                                                                                                                                                                                                      |
| **Final review: the title rule lived only in the renderer**, so an API caller could store an untitled section                                                                                                            | The stored schema requires text, by `hasText`, which the editor's `titleAccepted` now is ("The outline, and why it is one tree")                                                                                                                                                                                                                                                                                      |
| **Final review: two held retitles on two sections lost one**: only one retitle could be held, so the second took the first's place and the first was never sent                                                          | One retitle is held per section and sent in order, each keeping its own rules, and every title not saved is named ("Editing the outline")                                                                                                                                                                                                                                                                             |
| **Final review: nothing bounded the depth**, and a recursive parse overflows the stack between 500 and 800 levels                                                                                                        | Bounded at 64 by the parse, checked without recursing (STR-007's row, "The outline, and why it is one tree")                                                                                                                                                                                                                                                                                                          |
| **Final review: the BCP 47 pattern was restated** for the outline                                                                                                                                                        | The outline uses `contentDocumentSchema.shape.language`. The contract's `CreateComponentBody` still carries its own copy, left as the plan says                                                                                                                                                                                                                                                                       |
| **Final review: `set` wrote arbitrary JSON into `values`**, which nothing validates or reads, on both kinds of node                                                                                                      | Refused unless `{}` until TPL-054 says what they hold, so the one-migration argument for keeping the member stays true ("The outline, and why it is one tree")                                                                                                                                                                                                                                                        |
| **Final review: `matter` could be set on any node**, where STR-016 makes it a top-level node's, inherited by its subtree                                                                                                 | The parse refuses it below the top level, which covers set, insert and move; "Numbering" says the same                                                                                                                                                                                                                                                                                                                |
| **Final review: a NUL or half of a surrogate pair in a title answered `500`**, failing the insert into a `jsonb` column                                                                                                  | Refused in the schema, so it is the caller's `400`. A component's content accepts the same characters, left as the plan says                                                                                                                                                                                                                                                                                          |
| **Final review: a retitle refused as a conflict never named its title**, though the not-saved and signed-out paths did                                                                                                   | The title is named after the refusal's sentence, for a retitle refused itself and for one given way to behind a refusal                                                                                                                                                                                                                                                                                               |

[The second structure plan](../plans/2026-09-18-structure-02-numbering.md) built numbering and
captions and left resolving a cross-reference to structure 4, with its first consumer. Planning it
found thirteen things; building it, and reviewing each task, found nine more, marked **Built**. One
claim is new, IAM-073 (issue #130): nothing in the corpus said a number is held to the rule an
identity is, so decision C was a design answer with no row behind it. The row landed narrowed to the
numbers an outline produces, because a count or an order derived elsewhere - a search count, where a
component is used, a sort - is not answered here. One claim is dropped, STR-023: the build gave a
caption before any numbered appendix no number, which the row then answered only in part, so the gap
is named beside the claims and issue #129 reopens it. No other claim changed. **STR-036 and STR-031 stay
claimed and are cited by nothing** (the plan's decision F). STR-036 asks for numbering "as it will
publish": the panel's section numbers are what `number` gives with the one scheme anything can number
against, but no publisher exists to show it, and the panel is not yet a table of contents, so
structure 3 cites it with STR-034 and STR-037. STR-031 is about cross-references resolving afresh,
and nothing resolves one until structure 4; what numbering contributes to it - nothing cached, every
answer naming each occurrence's version - is in its row. STR-019 is cited by nothing for the same
kind of reason: no layout and no conditions exist to change.

| Found                                                                                                                                                                                  | Change                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **STR-031's cache key missed the component versions**: a `latest` reference's new head moves a figure without moving the digest                                                        | Nothing is cached, every answer names each occurrence's version, and the key a cache would need is written into STR-031's row                                                                                            |
| **"Who is shown what" was silent on numbers**, and a gap in them counts what a reader may not read                                                                                     | An unreadable occurrence is never read, and every number it could move is withheld whatever it holds ("Who is shown what"). Filed as issue #130 and landed as IAM-073, narrowed to the numbers an outline produces       |
| **`number` had two signatures**                                                                                                                                                        | The pipeline's: `resolve` carries contributions by occurrence, `conditions` and `number` take the stage before, and the order is a type                                                                                  |
| **The panel has no component open**                                                                                                                                                    | It needs none: no section number depends on a contribution, which a test holds. The contributions route is not built                                                                                                     |
| **Beneath an unnumbered node was unsaid**                                                                                                                                              | Nothing beneath it takes a section number; what it holds carries on the counters before it and restarts nothing                                                                                                          |
| **An appendix "restarting every sequence" was ambiguous**                                                                                                                              | Each matter keeps its own counters: `A`, then `B`, and a body chapter after them carries on the body's numbering                                                                                                         |
| **One format could not write `A.1`**                                                                                                                                                   | `format` is a list, one per part, the last repeating                                                                                                                                                                     |
| **A title's footnotes and a reference's heading were never placed**                                                                                                                    | Both are numbered: a title's footnotes at their node, a reference in the section sequence                                                                                                                                |
| **`approved` resolves to nothing**                                                                                                                                                     | Its occurrence is not known to anybody, so the numbers it could move are withheld from everybody until revisions exist                                                                                                   |
| **The entry copied its rule**                                                                                                                                                          | It names the rule by scheme, sequence and matter, and carries `matter`, `value`, `restartedAt` and `number`                                                                                                              |
| **Each occurrence's resolved version was on `GET /v1/documents/{id}`**                                                                                                                 | It is on the numbering route, beside the numbers it produced                                                                                                                                                             |
| **Every table is numbered, one used for layout included**                                                                                                                              | Every one is numbered, as STR-023 asks. A figure or table explicitly unnumbered is filed as issue #129, a content schema change for a later plan                                                                         |
| **PUB must bring its scheme to the panel**                                                                                                                                             | Recorded: the panel is right only while every document numbers against the scheme the panel uses                                                                                                                         |
| **Built: a scheme could print one label twice**: a figure rule restarting per chapter with no prefix makes every chapter's first figure `Figure 1`                                     | The scheme refuses a rule that restarts without prefixing to at least that depth, except a footnote's, whose labels a per-chapter house style means to repeat ("Numbering")                                              |
| **Built: a caption before any numbered appendix printed a bare number**, repeating a body caption's label                                                                              | It takes no number and uses up no value of its counter, so the first numbered appendix still starts at `Figure A.1`. STR-023 is no longer claimed, since it now goes unanswered for this one case; issue #129 reopens it |
| **Built: the pinned-version query could select a version of a component the reader may not read**, and discard it only afterwards - reachable only past the write-time check           | Both of `numberingInputs`' queries are restricted to the readable set in the query itself, and a test recording every row they return fails if one names such a component                                                |
| **Built: each component's head was found by sorting every version of every referenced component**                                                                                      | One index probe per component, a lateral join with `limit 1`, the rule `latestVersion` reads one head by                                                                                                                 |
| **Built: an appendix was offered moves that would nest it**, which the parse refuses                                                                                                   | The panel offers none: `Alt+Right` says **An appendix stays at the top level.**, and no drop that would nest one is offered                                                                                              |
| **Built: a ticked Numbered box beneath an unnumbered node shows no number**, as if the tick were ignored                                                                               | The panel says **Not numbered while** the ancestor **is not.** beside the box                                                                                                                                            |
| **Built: a drag started before the outline panel's first effects ran was cancelled** (issue #131) - structure 1's code, found by this plan's tests under load                          | Under `<StrictMode>`, the simulated unmount cleared the drag's timer; that cleanup is gone, and a test starts a drag before the effects run                                                                              |
| **Built: the property test numbered almost nothing**: its generator lost precision after two calls, so two hundred runs made two nodes                                                 | An exact generator, a floor on what the runs contain, and an independent oracle for every section number and figure label                                                                                                |
| **Built: `Ctrl+Z` did nothing while Numbered, Appendix or Starts on had the focus**, straight after the act made from it, because the panel left the key to every `input` and `select` | Only a text field keeps `Ctrl+Z` as its own undo; from a checkbox or a select it undoes the last act                                                                                                                     |

[The third structure plan](../plans/2026-09-18-structure-03-navigation.md) built the contents panel,
the generated lists, a node's address and the contributions route. It found twelve things. One
requirement is new and claimed, STR-063 (issue #119), narrowed to the service's share of the
navigation budget. One claim is dropped, STR-034, answered for the author's own acts and not for
another person's. STR-036 stays claimed and cited by nothing, as the plan's decision J says - not with
STR-034 and STR-037, as structure 2 expected: the panel is now the contents, but nothing publishes to
compare it with.

| Found                                                                         | Change                                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **STR-034 is answered only for the author's own acts**                        | The claim is dropped and the gap named: another person's change needs document versions on the stream, withheld per viewer |
| **Issue #119 as filed could not be demonstrated**                             | Landed as STR-063, the service's share, measured in the suite; the interface's share is filed as issue #134                |
| **`contents` read from the table would drop every unnumbered node**           | It walks the outline and numbers from the table; a reference's title is its caller's                                       |
| **`listOf` had no caption to list**                                           | A figure's and a table's contribution carries its caption; the numbering table carries none                                |
| **"A move is a splice" was not what was built**                               | Every act answers the whole outline; measured, and fast enough                                                             |
| **"Windowed over the visible depth" was never built**                         | Not needed at 500 nodes; the prose is gone                                                                                 |
| **The contributions route's `occurrences` parameter cannot carry an outline** | The route answers every occurrence of the latest version and takes no parameter                                            |
| **An answer per occurrence repeated a reused component**                      | Each version's contributions are answered once: 232 KB rather than 542 KB at 500 nodes                                     |
| **The desktop app has no address bar to share a link from**                   | The chosen node's address in a field, and **Copy link**                                                                    |
| **The hash router could not hear the same address twice**                     | It counts arrivals                                                                                                         |
| **The page now numbers captions itself**                                      | IAM-073 is cited in the renderer too                                                                                       |
| **A `latest` component's new head reaches the lists at the next act**         | Named: the page asks again whenever its version changes, and no sooner                                                     |
