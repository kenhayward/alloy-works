# The content model

The canonical stored shape of a component's content: a tree of typed nodes, ranges of text carrying
marks, and the rules that decide what may enter it and what it means once inside.

This realises sections 3 to 10 of
[CNT](../specification/requirements/CNT-content-and-authoring.md) under
[ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md), which
[`Content_Model_Spike_Findings.md`](../specification/spikes/Content_Model_Spike_Findings.md)
validated against its four gate cases. It is stored by
[storage-and-versioning.md](storage-and-versioning.md) (ADR-0024), its appearance is resolved by
[themes.md](themes.md) (ADR-0014), and its equations reach Word through
[word-output.md](word-output.md) (ADR-0015) and PDF through the Typst template
([ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md)).

> **Part of this is built.** The stored shape - the nodes, the marks, the root a version holds, the
> canonical serialisation, the migration chain and the output mapping - is in
> `packages/domain/src/content/model/`, and the admission pipeline's five non-reading stages, its report
> and the product clipboard's reader are in `packages/domain/src/content/admission/`. Validation refuses
> an equation whose MathML the pipeline's reader would not keep as it stands.
> [`../architecture.md`](../architecture.md) describes both as they stand rather than as they were
> planned. What is still design here: the Word, Markdown and HTML readers, resolution, and the round-trip
> test CNT-001 is satisfied by, which needs an editor. This document keeps the argument and the
> requirements it owns, because the reasoning is not a thing the code records.

## The shape in one paragraph

A component's content is one JSON document: a root carrying the schema version, the title, the base
language and the direction, and under it a sequence of typed block nodes. Blocks contain inline
nodes; `text` is the only leaf, and every annotation over a range of text is a **mark** held in a set
on that text rather than an element wrapping it, which is what lets a condition and a redline cover
overlapping parts of one sentence with no construct standing for the overlap. Every block and every
mark carries a required identifier, so comparison can say a paragraph moved and was reworded, and so
accepting an annotation fragmented by an overlap is one operation. Nothing in the model carries a
typeface, a size, a colour or a dimension. Everything entering the model - a paste, a copy from
another component, an imported document - goes through one admission pipeline that sanitises,
migrates, normalises, re-identifies, validates and reports, in that order, and a stage that discards
or rewrites anything must say so in the report. Migration never rewrites what is stored: it projects
on read, because versions are immutable and `content_hash` is the hash of what was written.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-001** | A tree of typed block nodes, JSON-serialised, validated in `packages/domain`. Read as same-family with the editor rather than object-identical - see "How CNT-001 is read"                                                                                                                                                                                                                                                                      |
| **CNT-002** | `id` is required on every block, allocated at creation and unique within the component                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-003** | A mark is a member of a set on a text node, never an element, so two marks cover overlapping ranges with nothing between them                                                                                                                                                                                                                                                                                                                   |
| **CNT-004** | `id` is required on every mark; an annotation fragmented across text nodes repeats one id                                                                                                                                                                                                                                                                                                                                                       |
| **CNT-005** | Resolution acts on a mark id rather than a position, so every fragment of one annotation resolves in one operation                                                                                                                                                                                                                                                                                                                              |
| **CNT-006** | The mark schema is a closed discriminated union. A new type is a schema version with a migration and a fixture, not a setting                                                                                                                                                                                                                                                                                                                   |
| **CNT-007** | No milestone, no range-start, no range-end, no standoff table. The overlap needs no construct because marks are sets                                                                                                                                                                                                                                                                                                                            |
| **CNT-008** | No node and no mark has a member for a typeface, a size, a colour or spacing. There is nowhere to put one                                                                                                                                                                                                                                                                                                                                       |
| **CNT-009** | Resolution rewrites content and preserves `id` on every block it keeps                                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-010** | One parse entry point validates on creation, on change and on read-back. No other path constructs a document                                                                                                                                                                                                                                                                                                                                    |
| **CNT-011** | `schemaVersion` is a member of the root, so content describes itself once it leaves the database. VER-010's column is derived from it at insert and the two must agree                                                                                                                                                                                                                                                                          |
| **CNT-012** | A fixture directory per schema version, never deleted, and one test migrating every fixture to current                                                                                                                                                                                                                                                                                                                                          |
| **CNT-013** | A failed read returns a named quarantine result identifying the artifact, the version and the failure. No path yields partial content                                                                                                                                                                                                                                                                                                           |
| **CNT-142** | `title` is a member of the root                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **CNT-143** | `title` and `language` are inside the versioned content, so they are inside `content_hash` and a version records what the component was called when it was cut                                                                                                                                                                                                                                                                                  |
| **CNT-146** | The root's members are closed - `schemaVersion`, `title`, `language`, `direction`, `content` - and a metadata value is never one of them. Adding a member is a schema version                                                                                                                                                                                                                                                                   |
| **CNT-014** | `paragraph`, the default block                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **CNT-117** | `list` carries `kind`: ordered, unordered or definition. A definition list's item also carries the `term` it defines, as inline content, so a term can be emphasised, linked or given its own language - see "A definition list reaches a reader as a list"                                                                                                                                                                                     |
| **CNT-118** | A list item holds block content, so a list nests by construction and six levels is a floor rather than a limit, in any mixture of kinds                                                                                                                                                                                                                                                                                                         |
| **CNT-153** | An ordered list carries `start` and `format` - decimal, alphabetic or roman - local to that list and unrelated to the outline's numbering. `start` is an integer of 0 or more in the shape, and a start of 0 under a lettered or roman numbering is refused by the walk - see "Where a list's start number is held"                                                                                                                             |
| **CNT-016** | `table` declares header rows and header columns, carries cell spans, and carries a caption                                                                                                                                                                                                                                                                                                                                                      |
| **CNT-017** | `figure` carries an asset reference and a caption, and never asset bytes                                                                                                                                                                                                                                                                                                                                                                        |
| **CNT-018** | `preformatted` holds text with whitespace significant and an optional language label                                                                                                                                                                                                                                                                                                                                                            |
| **CNT-019** | `blockquote` holds block content and an optional attribution, which may carry a citation inline                                                                                                                                                                                                                                                                                                                                                 |
| **CNT-021** | `equation` as a block                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **CNT-022** | Alternative text is a three-state and absent is not one of them, so publishing cannot find it missing because it cannot be missing                                                                                                                                                                                                                                                                                                              |
| **CNT-023** | There is no spacer construct, and validation refuses two adjacent empty paragraphs - see "What CNT-023 forbids, exactly"                                                                                                                                                                                                                                                                                                                        |
| **CNT-124** | Validation requires at least one block, and a newly created component is exactly one empty paragraph                                                                                                                                                                                                                                                                                                                                            |
| **CNT-081** | A caption-bearing block carries the same required `id` as any other block, which is the identity the outline numbers by                                                                                                                                                                                                                                                                                                                         |
| **CNT-125** | Every block carries `id` whether or not it carries a caption, so any block can be a cross-reference target                                                                                                                                                                                                                                                                                                                                      |
| **CNT-086** | A table cell holds inline content and `image` is an inline node, so an image in a cell needs no construct of its own                                                                                                                                                                                                                                                                                                                            |
| **CNT-121** | A figure and an inline image each carry `imageStyle`, a name drawn from the catalogue STY owns                                                                                                                                                                                                                                                                                                                                                  |
| **CNT-123** | Neither carries a width, a height or a unit of any kind. There is no member to hold one                                                                                                                                                                                                                                                                                                                                                         |
| **CNT-024** | `text` is the only leaf node, and marks apply to it                                                                                                                                                                                                                                                                                                                                                                                             |
| **CNT-025** | `equation` inline                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **CNT-026** | `footnote` is an inline node placed at the span it annotates, carrying the note's content                                                                                                                                                                                                                                                                                                                                                       |
| **CNT-027** | `crossReference` carries an identifier of its own, a target identity - a closed union of a block of its own component, a block of another, or an outline node - and a display kind, and has no member for a number or a title                                                                                                                                                                                                                   |
| **CNT-028** | `citation` inline                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **CNT-029** | `variable` carries a name and no value                                                                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-030** | `binding` carries a query reference and no value                                                                                                                                                                                                                                                                                                                                                                                                |
| **CNT-031** | Eight character marks: emphasis, strong, underline, subscript, superscript, inline code, defined term, quoted phrase                                                                                                                                                                                                                                                                                                                            |
| **CNT-032** | `condition` carries an axis and permitted values, present in the first schema version stored as CNT-116 requires                                                                                                                                                                                                                                                                                                                                |
| **CNT-033** | `suggestion` carries an operation and an author, present from the first schema version                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-034** | `comment` carries a thread identity, present from the first schema version                                                                                                                                                                                                                                                                                                                                                                      |
| **CNT-140** | The root carries a BCP 47 base language; a `language` mark carries a BCP 47 tag, validated on entry rather than on use                                                                                                                                                                                                                                                                                                                          |
| **CNT-085** | `underline` is in the set, and this document says plainly that it is the one mark named for its appearance                                                                                                                                                                                                                                                                                                                                      |
| **CNT-087** | `image` is an inline node, so it sits inside a run of text                                                                                                                                                                                                                                                                                                                                                                                      |
| **CNT-126** | `hyperlink` is a mark rather than a node, so it overlaps a condition or a suggestion exactly as the others do                                                                                                                                                                                                                                                                                                                                   |
| **CNT-127** | The scheme allowlist is enforced in validation and again in the pipeline's sanitise stage, so a target with another scheme is refused before it can be stored                                                                                                                                                                                                                                                                                   |
| **CNT-036** | A `footnote` inline node sits at the span it annotates                                                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-037** | A cell holds inline content, so a cell-anchored note is the same construct as a span-anchored one                                                                                                                                                                                                                                                                                                                                               |
| **CNT-038** | `table` carries an optional table-level note. It is not an inline anchor, because a table is not a span                                                                                                                                                                                                                                                                                                                                         |
| **CNT-107** | A table may declare key columns. Where declared an anchor names the key value; where not, it names row and column and is marked as the weaker form                                                                                                                                                                                                                                                                                              |
| **CNT-129** | Footnote content is paragraphs, holding no table, no image and no footnote. The schema admits paragraphs alone, so a table is refused there; the image and the footnote are refused by the walk `parseContentDocument` runs, which a section title runs too. The `condition`, `language`, `comment` and `suggestion` marks, which the closed list does not name, are admitted in a footnote, because they annotate text rather than add content |
| **CNT-043** | MathML is the one stored representation, whatever the entry route                                                                                                                                                                                                                                                                                                                                                                               |
| **CNT-044** | LaTeX entry converts to MathML at the boundary, the same discipline CNT-056 applies to Unicode. The LaTeX typed is kept beside it as a non-authoritative input record                                                                                                                                                                                                                                                                           |
| **CNT-050** | `citation` carries an entry identity and has no text member, so typed citation text is not representable                                                                                                                                                                                                                                                                                                                                        |
| **CNT-051** | The entry is an artifact in the space; a citation holds its identity and never a copy of it                                                                                                                                                                                                                                                                                                                                                     |
| **CNT-052** | `citation` carries an optional locator beside its reference                                                                                                                                                                                                                                                                                                                                                                                     |
| **CNT-056** | NFC is applied in the pipeline's normalise stage and asserted by validation, so no un-normalised string can be stored                                                                                                                                                                                                                                                                                                                           |
| **CNT-059** | Direction is explicit on the root and on any run that differs, never derived from the language tag - see "Why direction is not derived"                                                                                                                                                                                                                                                                                                         |
| **CNT-061** | A Markdown reader feeds the same pipeline                                                                                                                                                                                                                                                                                                                                                                                                       |
| **CNT-062** | An HTML reader feeds the same pipeline                                                                                                                                                                                                                                                                                                                                                                                                          |
| **CNT-063** | The report is a collector threaded through all six stages, returned with the admitted content rather than logged                                                                                                                                                                                                                                                                                                                                |
| **CNT-064** | A stage that discards or rewrites must append to the report; the verification rule below requires every admission test to assert the report as well as the output                                                                                                                                                                                                                                                                               |
| **CNT-065** | The normalise stage drops typeface, size and colour, and there is no member in the model for any of them to survive into                                                                                                                                                                                                                                                                                                                        |
| **CNT-130** | The sanitise stage runs before normalise, so scripts, event handlers, embedded objects and disallowed link targets are gone before anything else touches the content                                                                                                                                                                                                                                                                            |
| **CNT-131** | Each dropped or rewritten hyperlink is a report entry of its own, naming the target it had                                                                                                                                                                                                                                                                                                                                                      |
| **CNT-132** | The re-identify stage allocates a new `id` for every block, so copying cannot duplicate an identifier                                                                                                                                                                                                                                                                                                                                           |
| **CNT-133** | The re-identify stage drops annotations whose owning artifact does not travel, and appends one report entry each                                                                                                                                                                                                                                                                                                                                |
| **CNT-134** | The migrate stage runs before validate: content at an earlier schema version is brought to current or refused with a named error, and is never stored unmigrated                                                                                                                                                                                                                                                                                |
| **CNT-135** | One pipeline serves a foreign paste and an internal copy, so the report is to one standard because it is one implementation                                                                                                                                                                                                                                                                                                                     |
| **LIB-015** | The defined-term mark carries a term identity and has no text member, so a term cannot be typed as text                                                                                                                                                                                                                                                                                                                                         |
| **LOC-009** | A component declares a base language and any run may declare its own, so a language variant is a component in its own right rather than a shape the model has to gain later                                                                                                                                                                                                                                                                     |
| **LOC-020** | Structure, marks, references, bindings and terms are nodes and members rather than text, so a round-trip has nothing to lose and nothing translatable to mistake them for                                                                                                                                                                                                                                                                       |
| **AST-012** | A figure's alternative text may be inherited, which is the state that reads the asset's default                                                                                                                                                                                                                                                                                                                                                 |
| **AST-013** | A figure's own text is one of the three states, and it overrides the asset's default                                                                                                                                                                                                                                                                                                                                                            |
| **AST-015** | Decorative is a state of its own rather than an empty string, so no alternative text is a declaration rather than an omission                                                                                                                                                                                                                                                                                                                   |
| **AST-039** | Inherited alternative text carries the asset's language; a figure's own text takes the language of the component holding it                                                                                                                                                                                                                                                                                                                     |

## What this document does not own

Seventy-nine requirements above, and the ones deliberately left out matter as much.

**Answered jointly, so claimed by neither half.** A claim in the table above says this document
answers that requirement in full. Several of CNT's rows are two requirements in one sentence, where
the model answers one clause and the outline or the publisher answers the other. Claiming them would
say this design holds ground it does not.

| Left unclaimed            | Why                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-041, CNT-047          | The model carries no number and no sequence; **STR** owns the numbering the other clause requires                                                                                                                                                   |
| CNT-045, CNT-048, CNT-049 | One stored representation is here; rendering it on screen, in PDF and in Word, and failing a publish that cannot, are the publisher's                                                                                                               |
| CNT-042, CNT-054          | The model produces the named failure; making a publish fail on it is **PUB**'s                                                                                                                                                                      |
| CNT-084, CNT-128          | The mark is here; carrying a language and a hyperlink into every output format is the publisher's                                                                                                                                                   |
| CNT-166                   | Text is JSON strings, so the whole Unicode range is storable, astral planes included. Showing it in the editor is the editor's, and failing a publish on a character the typefaces cannot set is the publisher's (STY-049)                          |
| CNT-167                   | Word's paste is read from the HTML Word puts on the clipboard, by the HTML reader in `packages/readers`, not by an OOXML reader. Lists, tables and emphasis come through; **Word's footnotes are not read**, so the row's footnotes clause is unmet |
| CNT-035, CNT-057, CNT-058 | A toolbar, a keyboard shortcut and an insertion palette are the editor's                                                                                                                                                                            |
| CNT-053, CNT-102          | Citation style rendering is T6, in **PUB**                                                                                                                                                                                                          |
| CNT-039                   | The strict data anchor is here in shape, but generated content needs a bound table, which is T2. Claiming it would claim the T2 case                                                                                                                |
| CNT-120                   | Admonitions are T2, and the block is deliberately absent from the vocabulary                                                                                                                                                                        |
| CNT-122                   | Resolving an image style to real dimensions is **STY**'s, and the editor resolves it by those same rules                                                                                                                                            |
| CNT-094                   | Already claimed by [themes.md](themes.md)                                                                                                                                                                                                           |
| CNT-145                   | Claimed by [storage-and-versioning.md](storage-and-versioning.md), which records the component type on the version rather than in content                                                                                                           |
| CNT-046                   | Claimed by [component-editor.md](component-editor.md), since every context is made in the editor; a heading being inline content is **STR**'s                                                                                                       |
| AST-005, AST-006          | Asset ingest, and refusing an asset whose intrinsic properties cannot be read, belong to [assets.md](assets.md) rather than to a figure's reference                                                                                                 |

**A definition list reaches a reader as a list, and that is a named limit rather than a claim.** The
stored shape is right: a definition list's item carries the term it defines as inline content, so the
term is a thing of its own rather than the first words of its definition. What the model cannot make
the output do is carry that distinction into a PDF. **Typst 0.15.1 tags a definition list as `L`,
`LI`, `Lbl` and `LBody` - an ordinary list with a label - and offers no way to ask for PDF/UA's `DL`,
`DI`, `DT` and `DD`.** This was measured on the pinned engine, reading the compiled PDF's own roles
back, not inferred from its documentation. So a reader with a screen reader hears the term and then
its definition, in the right order and with the right emphasis, and is told "list" where the content
says "definition list". The term is not lost and nothing is invented; what is missing is the
structure the format has and the engine does not emit. It is one of the reasons **CNT-079 is left
unclaimed by every design** - a claim that structure is exposed as structure would be untrue of the
one block family that is built - and it is written into the changelog's Known limits, where an author
reads it, as well as here. The publishing template's own comment says the same thing at the line that
makes the choice, and the test that compiles a definition list asserts that no `DL` role appears, so
the day the pinned engine grows the structure the assertion goes red and says so.

**Component metadata is not here, and it has since been specified.** A component is of one component type, whose metadata schemas decide the fields its values are validated against - [MET](../specification/requirements/MET-metadata-and-component-types.md), which settled **CNT-Q12**. None of it enters the content document: the type and the values belong to the version, beside its content (MET-015, MET-016). That is why this document claims **CNT-146**, the root it built, and not **CNT-145**, which superseded CNT-144 by adding the type to what every component carries. No member is reserved in the root for either, which the specification now requires rather than merely allows.

**Two things this document requires of STR.** Both are consequences of decisions here, and both fail
silently if STR is written without them.

- **A section title cannot be a string.** CNT-046 requires an equation to work in a heading; headings
  are outline nodes rather than content, so a title has to be inline content. Modelled as text,
  CNT-046 fails at exactly the point the publishing engine spike proved was reachable.
- **A cross-reference to a block is resolved against an occurrence and a block together, and never
  against the block identifier alone.** CNT-002 scopes a block identifier to its component,
  deliberately, because STR-056 requires a component referenced twice to resolve "see Figure 2"
  against the occurrence the reader is in. STR-062 now says so; the stored target says which kind of
  block it means, and resolution finds the occurrence.

**CNT-Q14 is recommended, not settled.** Content carrying a condition whose axis the receiving space
does not have: **drop the condition and report it**. It is consistent with CNT-133, refusing the paste
punishes an author for a taxonomy difference they did not cause, and creating the axis is, as the
question says, how a taxonomy becomes whatever anybody pasted. **REU** owns axes and records the
decision.

**CNT-Q04 stays closed.** The mark vocabulary is closed by CNT-006 and this design adds no extension
point. What would open it is a customer requirement the closed set cannot express, which is what the
question already says.

## How CNT-001 is read

CNT-001 requires content "structurally identical to what the editor manipulates in memory", and **no
decision record chooses an editor framework.** This document therefore states its reading rather than
leaving an auditor to infer one.

Same family, not the same objects: a typed block tree, inline nodes, marks as sets carrying
identifiers - the shape every credible collaborative editor of this kind uses, and the reason
ADR-0005 chose it. What satisfies CNT-001 is a **lossless total mapping** between this model and the
editor's in-memory representation, held by a round-trip test. Byte identity with a framework's
internal objects is not required and would be the wrong thing to commit to, because this model also
serves comparison, Word export and decades of migration, none of which involve an editor.

**The editor framework decision is a named prerequisite for the editor design, not for this one.** It
is recorded here because the requirement names something that does not exist yet, and an unrecorded
gap becomes an assumption.

## The component, and what a version holds

One JSON document per version, stored inline on the version row with `content_hash` beside it
([storage-and-versioning.md](storage-and-versioning.md)). Its root is closed:

| Member          | Holds                                                               |
| --------------- | ------------------------------------------------------------------- |
| `schemaVersion` | The schema this content was written against (CNT-011)               |
| `title`         | The component's own title, not the heading that places it (CNT-142) |
| `language`      | The base language, a BCP 47 tag (CNT-140)                           |
| `direction`     | The base direction (CNT-059)                                        |
| `content`       | The sequence of block nodes                                         |

The component's **identifier** is the artifact's, not the content's. Everything else a component has
that is not its content - its component type and its metadata values - belongs to the version rather than to the content (CNT-145, CNT-146, MET-016).

**A canonical serialisation, which nothing else states.** `content_hash` is load-bearing: VER refuses
a version whose hash is unchanged, and equal hashes skip a comparison. Both break if two identical
documents can serialise differently, so the format is canonical - members in a declared order, no
insignificant whitespace, strings already NFC by CNT-056 - and one function produces it. The hash is
over that function's output and nothing else.

**What is serialised is the parse's output, never what arrived.** A default the schema fills in - a
paragraph's `style`, a text run's `marks` - is filled in before anything is stored, so leaving it out
and spelling it out are one document, one string and one hash. That holds inside a footnote too: its
content is parsed by the walk rather than by the inline schema, which cannot name a paragraph, and
the walk hands back what it parsed rather than checking it and keeping what arrived (issue #124). A
section title, which runs the same walk, is stored the same way.

**And one visible text carrying one set of marks is one run** (issue #154). The same walk drops a run
holding no text and joins two adjacent runs whose marks are equal, so a text has one stored spelling
as well as one hash, in every place inline content is stored. "Equal" is equal in the canonical form:
the two mark arrays go through the marks-as-a-set rule (CNT-003) and are then compared member by
member, a mark's identifier included - so a set written in two orders is one set, while two
annotations of one type, which differ only by identifier (CNT-004), stay apart as the two annotations
they are. Nothing had stored a mark when this was tightened, so there is no migration; it is a rule
about what is written, and a version already stored is read back exactly as it was written.

A run's value is put in NFC by the same walk (CNT-056), on the way in and again after a join: two
strings each in NFC need not join into one, so a merge could otherwise write a spelling the hash
does not cover. Text is normalised where an identifier is refused, because an identifier is compared
and resolved by exact string and folding one would change what it names, while a run's value is
prose the hash already reads in NFC.

**A mark identifier carries one value.** CNT-004 makes an annotation fragmented across runs one
annotation under one identifier, so within one scope - a component, or a section title - an
identifier stands for exactly one mark: one kind, one set of attributes. The same identifier reading
two ways, or worn by two kinds of mark, is two annotations sharing a name, and CNT-005's one
operation over every fragment of that identifier cannot then mean anything; the parse refuses such a
document by name, saying which identifier and that it carries two values, and nothing of the text.
The comparison is the mark's canonical form, and the identifier is keyed in NFC, because the
canonical form folds its two spellings into one. This was tightened while nothing had stored a mark,
which is the only moment it could be: admitting more later needs no migration, admitting it then
could never have been undone.

**And it covers one range.** The runs carrying one identifier are contiguous in document order:
once an identifier has appeared and a later text run does not carry it, it may not appear again in
that scope. An emphasis over `alp`, nothing over the words between, and the same identifier again
over `amma` is one annotation in two visually separate pieces, and CNT-005's one operation over
every fragment would change the document in two places an author never joined. **Only a text run
closes an identifier**, which is what keeps an ordinary gesture from making a document that will
not save: the runs one edit splits an annotation into all carry it; a block boundary is not a run,
so an annotation runs from the end of one paragraph into the start of the next and an empty
paragraph between them breaks nothing; and a node that is not a run carries no marks, so an
equation or a cross-reference inside an emphasised phrase leaves it whole. A footnote's content is
a range of its own: its anchor never breaks an annotation it stands in, and an annotation in the
main text is not the annotation inside the note. The editor is written to the same predicate and
holds it after **every** transaction rather than inside each command, because the gestures that
split an annotation are not all commands - typing one character at the end of a language run is
not one, and the mark is not inclusive, so the typed run carries no mark and stands between two
pieces of one annotation. The later pieces are renamed and the first keeps the identifier, so text
nobody touched is not renamed. Within a mark type an editing session therefore cannot reach this
refusal. What it still stands between a version and is content from somewhere else, and the two
cases the editor's repair leaves out on purpose: one identifier worn by two kinds of mark, which
the value rule answers and no command can mint, and a document opened into a state already in two
pieces, which nothing produces.

**And what the parse accepts, it accepts again unchanged.** Once the walk returns something other
than what it was given, every rule about a sequence has to be judged on what that sequence became -
CNT-023's adjacency over the blocks the walk returned, because a paragraph holding one empty run is
an empty paragraph once the run is dropped. Judged on what arrived, two of them would be accepted,
stored, and then refused on read-back, which is a version an author can never cut.

That the schema version sits inside the JSON makes the hash shortcut sound as well as fast: equal
bytes implies equal schema version, so two versions with equal hashes cannot be two different schemas
that happen to say the same thing.

## Blocks

Seven, and the vocabulary is closed. Every addition is a construct that has to survive comparison,
conditional resolution, translation and three output formats.

| Node           | Carries                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`    | Inline content, and a style name                                                                                                                                                                                |
| `list`         | A kind - ordered, unordered, definition - and items holding block content, each item on a definition list also carrying the `term` it defines as inline content. An ordered list carries start and format       |
| `table`        | Rows and cells, declared header rows and columns, cell spans, a caption, optional key columns, an optional note. [Tables, before the first is stored](#tables-before-the-first-is-stored) proposes what changes |
| `figure`       | An asset reference, an image style name, a caption, and an alternative-text state                                                                                                                               |
| `preformatted` | Text with whitespace significant, and an optional language label                                                                                                                                                |
| `blockquote`   | Block content, and an optional attribution that may carry a citation                                                                                                                                            |
| `equation`     | MathML, and numbered or explicitly unnumbered                                                                                                                                                                   |

Two are absent on purpose. **`admonition`** is CNT-120, which is T2 and takes its closed vocabulary
from an admonition style catalogue that does not exist yet. **A bound table** arrives with T2's
bindings; the spike built one for gate case 3, and what transferred from that case is the key-column
anchoring CNT-107 now requires of an authored table.

**What CNT-023 forbids, exactly.** CNT-023 says empty blocks used for vertical spacing must not be
representable; CNT-124 says a new component is exactly one empty paragraph. Both hold, and the rule
that makes them hold is narrower than "no empty paragraph": there is **no spacer node type at all**, a
single empty paragraph is permitted because a cursor needs somewhere to be, and **two adjacent empty
paragraphs are refused** by validation and collapsed by the pipeline's normalise stage. What CNT-023
is about is a block whose only purpose is the gap after it, and a lone empty paragraph is not that.
Both hold it in every sequence of blocks the model has - the top level, a list item, a blockquote, a
table cell and a footnote - because a rule the two write paths disagree on is one of them breaking it.

**Where a list's start number is held.** CNT-153 requires a start of 1 or more, and 0 only where the
numbering is decimal, and this design answers it in **two places rather than one**, deliberately.
`listNodeSchema` keeps `start` at 0 or more; it is not narrowed to 1, because a stored shape is
insert-only and a tightening of it can never be taken back - it would refuse a document somebody has
stored, in a version nobody can rewrite. The other half - that 0 is decimal's alone - is a rule in
the walk `parseContentDocument` runs, beside the rule that a start and a numbering belong to an
ordered list and to nothing else. A narrowing in the walk is the same shape of answer the definition
list's `term` takes, and for the same reason: it is safe to add while nothing has stored a list, and
it refuses every producer rather than only the author in front of the editor - an import, a paste and
a future API client included. The publisher asks the **same predicate**, exported rather than copied,
as a publish-time backstop, so content assembled by any path is refused by name rather than numbered
from something nobody wrote. Two spellings of one rule would be two rules; there is one, and each
side's comment points at the other.

**What a quotation and preformatted text are held to, beyond their shapes.** The editor quotations
and preformatted plan
([editor 5](../plans/2026-09-21-editor-05-quotations-and-preformatted-text.md), decision G) adds six
rules to the walk, for the reason the list's rules sit there: nothing has stored either block yet, and
after the first one is stored a narrowing is a migration. **An attribution that is there holds
text** - `[]` and an absent attribution would be two digests of one quotation - judged after
`mergeRuns`, as a term is. **A quotation's content is walked before its attribution**, which is
reading order and the order the editor holds them: walked the other way, an annotation running from
the paragraph before a quotation into its body was one piece to the editor and two to `claimRange`,
refused on save. **Preformatted text is put in NFC**, because the canonical form digests every string
in NFC and the stored text must be what the digest covers; NFC changes no whitespace. **It holds no
control character but tab and line feed** - a carriage return would make `\r\n` a second spelling of
a line break, and the pinned engine breaks a line at U+000B, U+000C, U+0085 and U+2028 as it does at
U+000A. **A language label is a token** of letters, digits and `+ # . _ -`, at most 32 characters,
one exported predicate the editor asks too. And **a preformatted block with text closes a mark's
range**, which is what the editor's `spansOf` already says: readable text stands between the two
pieces.

**Two spellings of one visible list, chosen rather than missed.** `{kind: 'ordered'}` and
`{kind: 'ordered', start: 1, format: 'decimal'}` publish identically, because the template defaults an
absent start to 1 and an absent numbering to decimal - but they canonicalise to different strings, so
they carry different version digests for a list no reader can tell apart. Folding the defaults in is
left undone deliberately, and this is the last slice in which it could be done at all without
rewriting a stored version: absence and a default are not the same statement, an author who chose
`1, 2, 3` said so and a later change to what the default is would silently restyle every list that had
only omitted it, and a digest records what was written rather than what was seen.

## Tables, before the first is stored

The table was designed with the rest of the model and stored by nothing, because nothing authored one.
Designing the editor and the publication that make one (publishing.md, [Tables](publishing.md#tables))
found four things the shape does not yet say, and **every one of them is free to fix only until the
first table is stored**: a version is insert-only, so after that each is a schema version and a
migration. Decisions T-A to T-D of that section, **taken as recommended by Ken on 2026-09-22**.

- **A caption is inline content (T-A).** `caption` is a string today, so a caption cannot hold a mark, a
  link, an equation (CNT-046) or a cross-reference - issue #88. It becomes inline content, walked as a
  paragraph's is, for **both** caption-bearing blocks, the table and the figure, since neither has ever
  been stored. The plan confirms that with a read-only count before it changes anything, as content
  model 3 did for footnotes: the change is made in place, at schema version 1, only on that evidence.
  What a caption contributes to the numbering (structure.md) is its inline content, and a list of
  tables sets it as a caption is set.
- **A table carries a `style` (T-B)**, defaulting to the theme's default table style, because CNT-094
  gives every block its appearance from a named style and a table is the one block that has none.
- **The grid is a rule of the walk (T-C).** Every row covers the same number of columns once spans are
  counted; no two cells cover one place; no span reaches past the last row or column; `headerRows` and
  `headerColumns` stay inside the grid, and so does every key column, each named once; there is at
  least one row, and every cell holds at least one block, as a list item does. Each is a narrowing of
  a shape nothing has stored, which is the only time a narrowing is free.
- **A cell holds paragraphs and lists, and nothing else, in T1 (T-D).** Today a cell holds any block -
  another table among them. An image in a cell is an inline image (CNT-086) and an equation an inline
  one (CNT-046), so neither needs a block; a table in a table, a quotation, preformatted text, a figure
  and a block equation are refused by the walk. Widening the list later is additive; narrowing it after
  something is stored is not.

Key columns (CNT-107) and the table's note (CNT-038) stay as they are. Both exist for footnotes, and
nothing edits either until the footnotes slice.

## Inlines and marks

`text` is the only leaf. Eight inline nodes: `text`, `equation`, `footnote`, `crossReference`,
`citation`, `variable`, `binding`, `image`.

Thirteen marks, closed by CNT-006, and every one carries an identifier.

| Group      | Marks                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| Character  | emphasis, strong, underline, subscript, superscript, inline code, defined term, quoted phrase |
| Annotation | condition (axis and values), suggestion (operation and author), comment (thread identity)     |
| Reference  | hyperlink (an absolute target with an allowlisted scheme, and an optional title)              |
| Linguistic | language (a BCP 47 tag)                                                                       |

**Why the annotation marks are here in T1.** CNT-116 requires the schema to carry, in the first
version ever stored, the types neighbouring areas depend on "even where the features that use them
land in a later tranche". Conditions are T4; suggestions and comments are T3. Retrofitting any of
them is a migration of everything stored, so this design builds the carrier without building the
capability - the line `Project_Scope.md` section 12 draws, and a design that crossed it would be
designing T3 early.

**`underline` is the exception and this document does not pretend otherwise.** It has no semantic
meaning and is named for its appearance. It is in the set because house styles in this market require
it, and calling it something else would fool nobody.

**`definedTerm` carries a term identity.** LIB-015 is a constraint and is in force now: a term is
referenced from content and never typed as text. The mark holds the identity; **LIB** owns the entry,
**PUB** the glossary, **LOC** the labels.

**Why direction is not derived.** CNT-059 requires direction to be in the model rather than left to
styling. Deriving it from the language tag is tempting and wrong for any language written in more than
one script, so `direction` is explicit on the root and a run whose direction differs carries its own.
A tag implies a default, never the answer.

## Identity

Two kinds of identifier, both required, and required is a change from the prototype: one on every
block, footnote and cross-reference, and one on every mark.

**Blocks.** `id` on every block, allocated at creation, unique within its component, never reused
(CNT-002). The spike made it optional, "only because imported content has no identity to carry" - and
the admission pipeline allocates on entry, so no stored block ever lacks one. An optional identifier
would be absent in production exactly where comparison needs it most, so this design requires it, and
the import path is what makes that possible.

Uniqueness is scoped to the **component**, not the document and not the tenant, and that is
deliberate: STR-056 requires a component referenced twice in one document to resolve against the
occurrence the reader is in, so the same identifier appearing once per occurrence is the intended
state rather than a collision.

**Every identifier a component's blocks, footnotes and cross-references carry shares one namespace.**
A block's, a footnote's, a footnote paragraph's and a cross-reference's are unique together within
the component, because a cross-reference names a block or a footnote by identity (STR-026) and one
shared would name two things, and because STR-029's failure names the reference by its own. The
parse first checked blocks alone, which left a footnote's out (issue #122). A mark's identifier is
outside it: fragments of one annotation repeat theirs on purpose (CNT-004).

**Every one of them is in NFC, and so is the block a target names.** The canonical form writes every
string in NFC (CNT-056), so two spellings of one identifier, composed and decomposed, would pass a
comparison of raw strings as two and be stored and digested as one - and a reference spelled one way
would resolve where the other would not. The parse refuses an identifier, or a target's `block`, that
is not already in NFC, rather than normalising it: what a caller stores is exactly what the digest
covers. Admission puts pasted text in NFC before it allocates, and the identifiers the editor
allocates are ASCII.

**Marks.** `id` on every mark (CNT-004). An annotation fragmented by an overlap repeats one identifier
across its fragments, which is what makes accept, reject and exclude one operation on one identity
(CNT-005) rather than several operations on several ranges. Resolution preserves block identifiers
(CNT-009), because a block that lost its identity to a resolution pass would compare as a deletion for
ever afterwards.

**Copying re-identifies.** Every block entering a component through the pipeline gets a newly
allocated identifier (CNT-132). A duplicate identifier is not a visible defect - comparison reports a
copy as a move, a resolution pass acts on two blocks when it meant one, and nothing errors - which is
why it is the pipeline's job rather than a caller's discipline. Footnotes and cross-references are
re-identified with the blocks, and a cross-reference copied with the block it names is pointed at
the copy. One whose block did not travel, or whose block's old identifier arrived on two blocks in
one paste - so which one it meant cannot be known - is left as it stands rather than guessed. The
admission report counts it, as kept rather than rewritten, where the receiving component does not
hold its target; one copied within a component, whose target stayed where it was, resolves as the
original does and is not counted. **Nothing is allocated that is already named**, in the receiving
component or in what arrived, as an identifier or as a reference's `block` target: a reference can
outlive its block, and a new block given the name it still holds would silently become its target.

## Schema version, and migration as a projection

**Migration never rewrites what is stored.** Version rows take inserts only (VER-008) and
`content_hash` is the hash of what was written, so migrating a stored version would either invalidate
its hash or require a new version row: one corrupts the record, the other puts a row nobody authored
into a permanent chain. Content is migrated on the way **out** of storage, on every read, into the
current schema. The stored bytes never change.

Three consequences:

- The migration chain is **total and pure** - from every schema version ever written to the current
  one. A fixture directory per version, never deleted, and one test walking every fixture to current
  (CNT-012).
- Comparison compares migrated projections, so two versions written years apart under different
  schemas are comparable without either being touched.
- Content arriving from outside the database carries its own version, which is why CNT-011 puts it in
  the JSON. A clipboard has no version row to read, and CNT-134 requires pasted content to be migrated
  or refused.

**Quarantine is a typed result, not an exception** (CNT-013). A read that fails validation returns a
named outcome identifying the artifact, the version and the failure, and no path yields partial
content. A generic error swallowed by a handler is the silent coercion CNT-013 forbids, with extra
steps.

## The admission boundary

**One pipeline, not one per source.** CNT-167, CNT-061 and CNT-062 admit Word, Markdown and HTML; CNT-132 to
CNT-135 admit content copied within the product; and IMP-047 requires every inbound document to be
sanitised "on the same terms as a paste". That phrase is only true if there is one implementation, so
there is: a reader per source, feeding one pipeline. It is the rule [`CLAUDE.md`](../../CLAUDE.md)
already states for the workspace boundary - one shared module, never re-implemented per backend.

| Stage           | Does                                                                                                                                      | Requirements              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Read**        | Source-specific: HTML - a web page's, and Word's, which reaches the clipboard as HTML - Markdown, plain text, the product's own clipboard | CNT-167, CNT-061, CNT-062 |
| **Sanitise**    | Scripts, event handlers, embedded objects, and any hyperlink whose scheme is not allowlisted - never stored                               | CNT-130, CNT-127          |
| **Migrate**     | Content at an earlier schema version brought to current, or refused with a named error                                                    | CNT-134                   |
| **Normalise**   | NFC; typeface, size and colour dropped; adjacent empty paragraphs collapsed                                                               | CNT-056, CNT-065          |
| **Re-identify** | A new identifier for every block and every mark; annotations whose owning artifact does not travel dropped                                | CNT-132, CNT-133          |
| **Validate**    | The whole admission refused rather than partly stored                                                                                     | CNT-010                   |

The order is load-bearing. **Sanitise before normalise**, so a hostile target cannot survive
normalisation. **Migrate before re-identify**, so identifiers are allocated in the current schema's
terms. **Validate last**, over what the other five produced rather than over what arrived.

**The report is a collector threaded through all six stages, not a seventh stage.** Each stage appends,
and no stage may discard or rewrite without appending. It returns with the admitted content rather
than going to a log, because CNT-063 requires it shown to the author at the time.

That shape is the spike's most expensive lesson made structural. Its Word importer "dropped three
empty paragraphs and did not count them, because they were written in a form the reader was not
looking for. Every assertion in that test was about what came through." A reader that cannot represent
something appends rather than shrugging, and the verification rule below closes the other half.

## Equations

**MathML is the canonical stored form.** Every consumer except a human reads MathML: the Typst
template assembles its structural maths tree from it, Word's OMML is built from it
([word-output.md](word-output.md)), browsers render it natively, and screen readers consume it, which
is what makes CNT-048's textual alternative tractable. Word import in T6 arrives as OMML, which
converts to MathML losslessly and to LaTeX badly.

**LaTeX is kept beside it as a non-authoritative input record.** CNT-044 requires LaTeX entry, and an
author who typed one thing should get that thing back to edit. The record is explicitly not a second
canonical form: **MathML wins any disagreement**, and editing regenerates the MathML from the LaTeX so
the two cannot drift. Absent that sentence the pair becomes two canonical representations, which is
what CNT-043 exists to prevent.

Choosing MathML shortens the route the publishing engine spike measured rather than changing it: the
spike's chain was LaTeX to MathML to the tree, and the measured part - MathML to the tree - is
untouched. [word-output.md](word-output.md) is corrected to match.

## Figures, and three states of alternative text

CNT-022 requires alternative text and fails a publish without it. AST-012 lets an asset carry a
default, AST-013 lets a figure override it "because the same photograph means different things in two
documents", and AST-015 requires a purely decorative asset to be "correctly given no alternative
text".

Those cannot all hold if alternative text is an optional string, because empty then means both "nobody
supplied it" and "deliberately decorative" - and that ambiguity is how an inaccessible document passes
its own check. So it is a **three-state**, and absent is not one of them:

| State        | Means                                                               |
| ------------ | ------------------------------------------------------------------- |
| `own`        | The figure carries its own text, in the component's language        |
| `inherited`  | The text is the asset's default, in the language the asset declares |
| `decorative` | Deliberately none, and published as an artifact marked decorative   |

A figure with no state is not representable, so CNT-022's publish-time failure guards against an asset
with no default rather than against an author who forgot.

## Every node has a way out

ADR-0005 commits to the schema being "designed against the OOXML and PDF/UA mappings from the start",
because "a mapping retrofitted onto a schema that did not anticipate it is where publishing fidelity
dies." That commitment lands here as a **completeness table**: one row per node and per mark, with the
OOXML construct and the tagged-PDF structure type it becomes, one line each.

It is a completeness check rather than a mapping specification. The detailed mappings stay with
[word-output.md](word-output.md) and the Typst template, so each has one owner - two documents stating
one rule is the condition that lets them drift apart while each looks correct, which is what settling
CNT-Q15 removed from this area once already.

**A cell that cannot be filled blocks the node from the vocabulary.** That is what makes the table
worth having rather than decorative, and **a test asserts the table is complete** - every node and mark
type in the schema has a row - in the same way `design.test.ts` asserts every design document appears
in its index. Add a node with no way out and the build fails.

## Where the code lives

**The model stays in `packages/domain`**: the schema, validation, the migration chain, the canonical
serialisation, resolution, and the admission pipeline's five non-reading stages. All of them are model
rules, and the package already forbids React, Electron, `fs` and the DOM - the right home for the one
part of the product that has to be testable without booting anything (ADR-0005). One exception: an
equation's MathML is the one string the model renders as markup, so sanitise reads it with a strict
reader of its own - hand-written, not a general parser, no dependency - and validation asks the same
reader on save and on read-back (the admission plan's decisions 7 and 17).

The spike schema was not exported from the package's public surface, and the findings say promoting a
schema "is a deliberate act for whoever starts the authoring work, not something that should happen by
drift". **That act has happened**, and it promoted this model rather than the spike's:
`packages/domain/src/content/model/index.ts` is the barrel, the package root re-exports it, and
`index.test.ts` pins the whole surface so the next export is a decision and not an accident. The spike
schema stays where it was, unexported.

**Every format reader and writer moves out.** The spike recommended it for the OOXML pair - "an OOXML
adapter is a boundary translator that happens to need the model" - and the admission pipeline makes it
necessary rather than tidy: an HTML reader needs a parser and a sanitiser, which `packages/domain`
exists to exclude. The OOXML reader and writer move to their own workspace, and a Markdown and an HTML
reader join them there rather than in the domain package.
[`docs/architecture.md`](../architecture.md) records the move in the pull request that makes it, not in
this one.

The pipeline itself stays in the domain package and takes a reader's output as its input, which is what
lets five of the six stages be tested with no parser in the room - sanitise is the exception, carrying
the MathML reader described above.

## Verification

- **The four gate-case tests keep passing**, because they are the evidence ADR-0005 stands on. With one
  exception, stated rather than quietly absorbed: **gate case 3 asserts a cell-anchored footnote in a
  bound table**, and a bound table is T2. Its finding transferred into CNT-107's key columns, so the
  case is re-pointed at an authored table rather than kept green against a node the T1 vocabulary does
  not contain.
- **A fixture directory per schema version**, never deleted, with one test migrating every fixture to
  current (CNT-012). **Built**, at schema version 1, with a second test asserting the every-node fixture
  really does carry every construct - without which its name is a claim rather than a property, and a
  node added to the schema and forgotten in the fixture would leave the next migration untested against
  a shape that by then has stored content in it.
- **A canonical-serialisation test**: two documents differing only in construction order produce one
  hash. **Built**, over the string rather than a hash, because the property is the string and hashing
  here would cost the package its platform-freedom.
- **Every admission test asserts the report as well as the output** (CNT-064). A test that asserts only
  what came through is the spike's silent-drop defect waiting to happen again.
- **A completeness test** over the mapping table: every node and mark type has a row. **Built**, and it
  fails on a blank cell as well as a missing row. Filling it found one thing worth recording: `Em` and
  `Strong` are PDF 2.0 structure types, so under PDF/UA-1 emphasis is a `Span` carrying the face the
  theme declares.
- **A round-trip test for CNT-001's mapping** arrives with the editor design, because it needs an
  editor. Named here so it is not forgotten.

## What was ruled out

- **Storing LaTeX as canonical.** The publishing engine spike assumed it, and it is the cheaper start.
  The cost lands in stored content rather than in code: Word import in T6 arrives as OMML, and OMML to
  LaTeX is the lossy direction, so every imported equation would be degraded at the moment it was
  stored, permanently.
- **Storing MathML alone, with no LaTeX record.** Strictly one representation, and the friction lands on
  the people writing the reports: an author who typed one source gets a different correct one back.
- **Reserving a member for typed component metadata.** An empty member resolving to nothing is exactly
  the accidental field CNT-Q12 warns about, and CNT-012's migration path is a T1 deliverable built for
  precisely this.
- **A mark or node standing for an overlap.** CNT-007 forbids it and the spike proved it unnecessary:
  case 1 passed with "no construct of its own".
- **Naming an editor framework here.** That is a decision record's job, it needs its own argument, and
  writing a schema first would be choosing a framework by having already written its schema.

## Open questions

| ID          | Question                                                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CMD-Q01** | **What is the schema version identifier?** A monotonic integer is enough for a migration chain and says nothing else; a date or a product version says something and invites meaning being read into it. Settled by writing the second schema version |
| **CMD-Q02** | **Does the canonical serialisation belong in the schema or beside it?** Generating it from the schema keeps one source of member order; writing it by hand keeps the hash's input readable. Settled by the first schema change that reorders a member |
| **CMD-Q03** | **How large may one component's content be before the pipeline needs streaming?** It validates a whole document in memory, which is right for a component and wrong for an imported book. Settled by the first import of a real document, in **IMP**  |
