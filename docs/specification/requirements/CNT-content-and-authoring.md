# CNT - Content and authoring

> **Status: v1, for review.** The first detailed requirements area. It rests on a
> content model that has been built and tested rather than only argued, so it is more settled than
> the areas that follow will be at first draft.

## 1. Purpose

What a component's content **is**, and what an author can do to it. This area owns the shape of
content and the act of writing it. It does not own where content sits in a document, how it is
numbered, who may edit it, or how it is published - those have their own areas, and the boundaries
are stated in section 2 so that nothing falls between them.

The governing constraint, from which most of this document follows: **a component does not know
where it is used.** It carries no heading number, no position, and no knowledge of the documents
that reference it. Everything positional is resolved elsewhere, at publish time, in the context of
the document doing the resolving. That is what makes one component usable in forty reports.

## 2. Depends on

| Rests on                                                                      | What it fixes                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [ADR-0005](../../decisions/0005-purpose-built-node-and-mark-content-model.md) | Nodes and marks, JSON, editor model as storage model, standards at the boundary          |
| [Content model spike findings](../Content_Model_Spike_Findings.md)            | Block ids, mark ids, resolution preserving ids, the settled position on empty paragraphs |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.1                            | The vocabulary, and the intent this document makes precise                               |

Boundaries with neighbouring areas:

| Not here                                                       | There            |
| -------------------------------------------------------------- | ---------------- |
| Where a component sits, numbering, cross-references            | **STR**          |
| Transclusion, variables, conditional profiling                 | **REU**          |
| Tables whose rows come from a query                            | **DAT**, **TAB** |
| Who may edit, locks, threads, accepting suggestions            | **COL**          |
| What a version is, comparison, baselines                       | **VER**          |
| Rendering to PDF, Word or HTML; lists of figures and tables    | **PUB**          |
| Pasting from and exporting to foreign formats at scale         | **IMP**          |
| Style catalogues, themes, and how a named style resolves       | **STY**          |
| The managed assets a figure or an inline image references      | **AST**          |
| Translating a component, and translation status                | **LOC**          |
| The metadata schema a component's values are validated against | **TPL**          |

| ID          | Requirement                                                                                                                                                                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **CNT-116** | The content schema must carry, in the first version ever stored, the node and mark types the neighbouring areas depend on - condition, suggestion and comment-anchor marks among them - even where the features that use them land in a later tranche | Constraint | Specified |

**CNT-116 is why this document specifies things nothing yet uses.** Retrofitting a range annotation
onto stored content is a migration of everything already written, and versions are immutable, so it
is a migration that cannot be skipped. The scope makes the point at the tranche level; this
requirement is where it becomes binding. It was prose before review, which made a binding statement
look like commentary.

**Who owns a component's own title and metadata values is not settled** - **TPL** owns the schema,
**SCH** searches the values, and nothing states where they live. See **CNT-Q12**.

## 3. The content model

Content is a tree of typed **block** nodes. Blocks contain **inline** nodes. Ranges of text carry
**marks**. That third thing is the one that earns its keep: a mark is a member of a set applied to a
range, not an element that must nest, so a profiling condition and a reviewer's redline can cover
overlapping parts of the same sentence without either being split into two things.

Identity is the other load-bearing idea, and it appears twice. **Blocks carry an id** so that
comparison can say "this paragraph moved and was reworded" instead of "one vanished and another
appeared". **Marks carry an id** so that an annotation fragmented by an overlap is still one
annotation, and accepting it is one action. Both were established by the spike rather than assumed,
and both have to be in the schema from the first version ever stored, because versions are
immutable and identity cannot be granted retrospectively.

| ID          | Requirement                                                                                                                                                            | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **CNT-001** | Content must be a tree of typed block nodes, serialised as JSON, structurally identical to what the editor manipulates in memory                                       | T1         | Specified |
| **CNT-002** | Every block node must carry an identifier, allocated when the block is created, unique within its component, and never reused                                          | T1         | Specified |
| **CNT-003** | Every annotation over a range of text must be a mark; marks must be able to cover overlapping ranges without nesting and without being split into separate annotations | T1         | Specified |
| **CNT-004** | Every mark must carry an identifier; an annotation fragmented across several text nodes must remain one annotation under one identifier                                | T1         | Specified |
| **CNT-005** | Accepting, rejecting or excluding a marked annotation must act on every fragment of that identifier in one operation                                                   | T1         | Specified |
| **CNT-006** | The mark vocabulary must be closed. Adding a mark type is a schema change with a migration, not a configuration option                                                 | Constraint | Specified |
| **CNT-007** | The model must contain no mark or node whose only purpose is to represent an overlap, a range start or a range end                                                     | Constraint | Specified |
| **CNT-008** | Marks must be semantic in intent. The model must carry no typeface, font size, colour or spacing                                                                       | Constraint | Specified |
| **CNT-009** | A resolution pass (accepting a suggestion, excluding a condition) must preserve block identifiers                                                                      | T1         | Specified |
| **CNT-010** | Content must be validated on creation, on change, and on read-back from storage                                                                                        | T1         | Specified |
| **CNT-011** | Every stored content document must record the schema version it was written against                                                                                    | T1         | Specified |
| **CNT-012** | A migration path must exist from every schema version ever written to the current one, and must be exercised by a test carrying a fixture of each                      | T1         | Specified |
| **CNT-013** | Content that fails validation on read-back must be quarantined and reported, never silently coerced or partially loaded                                                | T1         | Specified |

**CNT-012 is the expensive one and it is not optional.** Versions are immutable, so a schema change
cannot rewrite what is already stored. Everything ever written stays readable for as long as the
tenant keeps its content, which in this market is measured in decades.

## 4. Block content

The block vocabulary is deliberately small. Every addition is a construct that has to survive
comparison, conditional resolution, translation, and three output formats, so the bar is that a
report cannot be written without it.

| ID          | Requirement                                                                                                                                                                                                                                                                                | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **CNT-014** | Paragraphs must be supported, as the default block                                                                                                                                                                                                                                         | T1         | Specified             |
| **CNT-015** | Lists must be supported - **ordered (numbered)**, unordered, and definition - nestable to at least six levels, with an author-settable start number and numbering format (decimal, alphabetic, roman) on an ordered list                                                                   | T1         | Superseded by CNT-117 |
| **CNT-117** | Lists must be supported, in three kinds - **ordered (numbered)**, unordered and definition                                                                                                                                                                                                 | T1         | Specified             |
| **CNT-118** | A list must nest to at least six levels, in every kind and in any mixture of kinds                                                                                                                                                                                                         | T1         | Specified             |
| **CNT-119** | An ordered list must carry an author-settable start number and numbering format - decimal, alphabetic or roman - local to that list and independent of the outline's numbering (**STR**)                                                                                                   | T1         | Specified             |
| **CNT-016** | Authored tables must be supported, with header rows and columns, merged cells, and a caption                                                                                                                                                                                               | T1         | Specified             |
| **CNT-017** | Figures must be supported, carrying a caption and alternative text, and referencing a managed asset rather than embedding one                                                                                                                                                              | T1         | Specified             |
| **CNT-018** | Preformatted blocks must be supported, with an optional language label, preserving whitespace exactly                                                                                                                                                                                      | T1         | Specified             |
| **CNT-019** | Block quotations must be supported, with an optional attribution that may carry a citation                                                                                                                                                                                                 | T1         | Specified             |
| **CNT-020** | Admonitions must be supported, from a closed vocabulary declared by the presentation theme                                                                                                                                                                                                 | T2         | Superseded by CNT-120 |
| **CNT-120** | Admonitions must be supported, from the closed vocabulary the admonition style catalogue declares (**STY-003**)                                                                                                                                                                            | T2         | Specified             |
| **CNT-021** | Block-level equations must be supported                                                                                                                                                                                                                                                    | T1         | Specified             |
| **CNT-022** | A figure's alternative text must be required, and publishing must fail when it is absent                                                                                                                                                                                                   | T1         | Specified             |
| **CNT-023** | Empty blocks used for vertical spacing must not be representable. Separation is a property of the presentation theme                                                                                                                                                                       | Constraint | Specified             |
| **CNT-124** | A component must always hold at least one block. A newly created component must hold exactly one empty paragraph, as somewhere for the cursor to be                                                                                                                                        | T1         | Specified             |
| **CNT-081** | Every caption-bearing block - figure, table, block equation - must carry a stable identity, so the outline can number it and a cross-reference can target it (**STR** owns the sequences; **PUB** owns lists of figures and tables)                                                        | T1         | Specified             |
| **CNT-125** | Every block must be addressable by its identifier, and any block must be able to be the target of a cross-reference (**STR** owns the reference itself). Carrying a caption is what makes a block numbered, not what makes it addressable                                                  | T1         | Specified             |
| **CNT-086** | An image must be placeable inside a table cell                                                                                                                                                                                                                                             | T1         | Specified             |
| **CNT-088** | An image reference must carry a named **image style** chosen from a catalogue - `thumbnail`, `inline`, `column-width`, `full-width`, and whatever an administrator has added - and the publisher must resolve that style to real dimensions. The model must not carry pixel or point sizes | T1         | Superseded by CNT-121 |
| **CNT-121** | An image reference must carry a named **image style**, chosen from the image style catalogue (**STY**)                                                                                                                                                                                     | T1         | Specified             |
| **CNT-122** | A named image style must be resolved to real dimensions at publish time, by the rules **STY** owns (STY-015 to STY-019, CNT-091, CNT-092), and the editor must resolve it by those same rules (STY-035)                                                                                    | T1         | Specified             |
| **CNT-123** | An image reference must carry no pixel, point, millimetre or percentage dimension of its own                                                                                                                                                                                               | Constraint | Specified             |
| **CNT-091** | Resolving an image style must preserve the image's intrinsic aspect ratio. A style that fixes a width must derive the height from the image, and must never distort it                                                                                                                     | T1         | Specified             |
| **CNT-092** | A style whose resolved height would exceed a declared maximum must be constrained by height instead, still preserving ratio. That maximum must be declared in the style, not discovered at publish time                                                                                    | T1         | Specified             |
| **CNT-093** | Style catalogues must be configuration-extensible: an administrator must be able to add a style - "small thumbnail" - without a code change, and it must then be selectable by authors and honoured by every output format                                                                 | T2         | Specified             |
| **CNT-094** | A block must take its appearance from a named style chosen from a catalogue. Alignment, indentation and spacing must be properties of a style, never a free per-block toggle                                                                                                               | T1         | Specified             |

**CNT-015 answers a review question directly:** _ordered_ means numbered. A list's numbering is local
to that list and independent of the outline's numbering of headings, figures, tables and equations -
a numbered list restarts at 1 wherever it appears, which is exactly why it cannot be the same
mechanism.

**CNT-081 keeps numbering out of the component while making it possible.** Captions are authored
here; numbers are not, because a figure that is figure 3 in one report and figure 11 in another
cannot store either. The component supplies identity, the outline supplies the number, and the list
of figures or tables is assembled at publish time from both.

**CNT-088 answers "who does the layout formatting" for an image, and review sharpened the
answer.** The author picks a named style; the publisher decides millimetres. This matters most for
the case raised - instructions for use, where a step's illustration has to sit at a known size for
the page to be readable - and it also lets one component render at a different size in a different
document, because the catalogue is what differs.

**CNT-091 is the part that experience says gets forgotten.** A style fixes one dimension, never two:
column width implies a height, taken from the image's own ratio. Fixing both distorts the picture,
and it distorts it silently, which is worse. **CNT-092 covers what that then exposes** - a very tall
image at column width runs off the page, so a style declares a maximum height and constrains by
height instead, still preserving the ratio.

**And the idea does not stop at images.** A named, administrator-extensible catalogue is the right
shape for paragraphs, tables and citations too (CNT-093, CNT-094, CNT-102): the author selects
`Thumbnail` or `Small thumbnail`, `Data table` or `Summary table`, `Harvard` or `Vancouver`, and the
publisher resolves each. That gives authors real control without giving them a font picker, and it
gives an administrator somewhere to put a house style. It also raises a structural question the
scope has not answered - see **CNT-Q09**.

**CNT-022 has a cost and is deliberate.** Alternative text is a legal requirement for accessible
output in this market, and the only moment anyone knows what a figure means is when it is placed.
Making it a publish-time failure rather than a warning is the difference between an accessible
product and one that reports itself as accessible.

**CNT-023 was contested and is settled** - but review is right that losing the blank lines can be
jarring, and the answer is **CNT-082**: the editor renders the theme's spacing, so the author sees
the separation rather than losing it. The blank lines go; the gap they were making stays.

## 5. Inline content and marks

| ID          | Requirement                                                                                                                                                                                                                                                                                                          | Tranche | Status                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **CNT-024** | Text must be the base inline node                                                                                                                                                                                                                                                                                    | T1      | Specified             |
| **CNT-025** | Inline equations must be supported                                                                                                                                                                                                                                                                                   | T1      | Specified             |
| **CNT-026** | Footnote anchors must be inline nodes (section 6)                                                                                                                                                                                                                                                                    | T1      | Specified             |
| **CNT-027** | Cross-references must be inline nodes carrying a target identity and what to display, never a resolved number or title                                                                                                                                                                                               | T1      | Specified             |
| **CNT-028** | Citations must be inline nodes (section 8)                                                                                                                                                                                                                                                                           | T1      | Specified             |
| **CNT-029** | Variables must be supported, carrying a name resolved at publish time (**REU** owns resolution)                                                                                                                                                                                                                      | T1      | Specified             |
| **CNT-030** | Inline data bindings must be supported, carrying a query reference (**DAT** owns resolution)                                                                                                                                                                                                                         | T1      | Specified             |
| **CNT-031** | Character-level marks must be supported: **emphasis, strong, underline, subscript, superscript**, inline code, defined term and quoted phrase                                                                                                                                                                        | T1      | Specified             |
| **CNT-032** | Condition marks must be supported, carrying an axis and permitted values (**REU** owns evaluation)                                                                                                                                                                                                                   | T1      | Specified             |
| **CNT-033** | Suggestion marks must be supported, carrying an operation and an author (**COL** owns the review workflow)                                                                                                                                                                                                           | T1      | Specified             |
| **CNT-034** | Comment anchor marks must be supported, carrying a thread identity (**COL** owns the thread)                                                                                                                                                                                                                         | T1      | Specified             |
| **CNT-035** | The author must be able to apply and remove every mark in CNT-031 directly, from a toolbar and by keyboard shortcut. The editor must offer no control over typeface, font size or colour                                                                                                                             | T1      | Specified             |
| **CNT-083** | Every component must declare a base language, and any run whose language differs from its surrounding context must carry its own language tag                                                                                                                                                                        | T1      | Superseded by CNT-140 |
| **CNT-084** | A run's language must be carried through to every output format as the language of that passage                                                                                                                                                                                                                      | T1      | Specified             |
| **CNT-140** | Every component must declare a base language, and any run whose language differs from its surrounding context must carry its own language tag. Every such tag must be a **BCP 47** language tag, carrying a region wherever the region changes the content - `pt-BR` distinct from `pt-PT`, `zh-Hans` from `zh-Hant` | T1      | Specified             |
| **CNT-085** | An underline mark must be supported, and must be understood as the one mark named for its appearance rather than its meaning                                                                                                                                                                                         | T1      | Specified             |
| **CNT-087** | An image must be placeable inline within a run of text                                                                                                                                                                                                                                                               | T1      | Specified             |
| **CNT-126** | Hyperlinks must be supported, as a mark over a range of text carrying an absolute target and an optional title                                                                                                                                                                                                       | T1      | Specified             |
| **CNT-127** | A hyperlink's target must be validated against a declared allowlist of schemes - `http`, `https` and `mailto` at minimum - and a target with any other scheme must be refused on entry and never stored                                                                                                              | T1      | Specified             |
| **CNT-128** | A hyperlink must be carried to every output format: as a live link where the format has one, and otherwise as the rendering the theme declares (**STY**, **PUB**)                                                                                                                                                    | T1      | Specified             |

**CNT-031 and CNT-035 answer the strongest objection in review, and it was right.** "Appearance is
the theme's, always" is true of blocks and false of characters. An author writing a report must be
able to bold a phrase, italicise a term, underline a fragment and set a subscript - and telling them
to express that as a semantic abstraction they did not ask for is how structured authoring tools
earn their reputation.

The line that survives is narrower and defensible: **the author chooses from a closed set of marks;
the theme decides what each one looks like.** By way of illustration, binding on nothing: strong
would render bold in most themes, and could render as small capitals in a house style that says so.
What the author cannot pick is a typeface, a point size or a colour, because those are the choices
that make two components in one document look like they came from two documents.

**CNT-126 to CNT-128 close a gap review found: there was no hyperlink.** The inline vocabulary had
equations, footnotes, cross-references, citations, variables, bindings, marks and images, and no way
to link to a page on the web - which no report in this market can do without. A hyperlink is a mark
rather than a node because it covers a range and can overlap a condition or a suggestion, exactly
like the others. Its target is external by construction: a link to content inside the product is a
cross-reference (CNT-N10), because a cross-reference survives a move and a URL does not. Admitting a
target at all is what makes CNT-130 necessary - pasted HTML now carries something that can be
hostile, not merely ugly.

**CNT-085 is honest about the exception.** Underline has no semantic meaning - it is named for its
appearance, and it is here because house styles in this market require it. Calling it `emphasis-2`
and pretending otherwise would fool nobody.

**CNT-140 replaces CNT-083 to say what shape a language tag is.** The original recorded a language
and left the form of it open, which is enough for spelling (CNT-099) and not enough for anything that
distinguishes one region from another: **LOC-002** formats a date, **LOC-003** collates a list, and
**LOC-007** holds a Brazilian variant beside a European one. None of those is implementable against a
bare two-letter code, and a tag's shape cannot be narrowed after content has been stored against it -
which is why this is a change made now rather than when translation ships in T6.

**CNT-140 answers a review point precisely: there is no such thing as a foreign language.** The
earlier wording said "foreign phrase", which describes a relation to a reader rather than a property
of text. The model records **language**, never foreignness: a component declares its base language,
and a run that differs declares its own. This is not decoration - tagged PDF and accessible Word
both require the language of a passage to be known, and it cannot be recovered at publish time from
the text alone.

## 6. Footnotes

Footnotes are where this market differs from general document tooling, and where the model earns or
loses credibility. A note may hang off a phrase, off a single cell of a table, or off a table as a
whole, and all three occur in the same report.

| ID          | Requirement                                                                                                                                                                                                                                                                                                                         | Tranche | Status                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **CNT-036** | A footnote must be anchorable to a span of text                                                                                                                                                                                                                                                                                     | T1      | Specified             |
| **CNT-037** | A footnote must be anchorable to a cell of an authored table                                                                                                                                                                                                                                                                        | T1      | Specified             |
| **CNT-038** | A footnote must be anchorable to a table as a whole                                                                                                                                                                                                                                                                                 | T1      | Specified             |
| **CNT-039** | A footnote anchored into generated content must identify its target by data, never by position (**DAT** owns the binding case)                                                                                                                                                                                                      | T2      | Specified             |
| **CNT-040** | Footnote content must support paragraphs, the character marks in CNT-031, citations, inline equations and cross-references. It must **not** support tables or images                                                                                                                                                                | T1      | Superseded by CNT-129 |
| **CNT-041** | Footnote numbering must be a property of the outline, not of the component (**STR** owns it)                                                                                                                                                                                                                                        | T1      | Specified             |
| **CNT-042** | A footnote whose anchor cannot be resolved must fail the publish with a named error identifying the footnote                                                                                                                                                                                                                        | T1      | Specified             |
| **CNT-107** | An authored table must be able to declare a key column, or set of columns. Where declared, a footnote must anchor to a cell by key value exactly as it does in a bound table. Where not declared, the anchor must fall back to row and column position, and must be marked as the weaker form because it does not survive a reorder | T1      | Specified             |
| **CNT-129** | Footnote content must support paragraphs, the character marks in CNT-031, citations, inline equations, cross-references, hyperlinks, variables (CNT-029) and inline data bindings (CNT-030). The list is closed, and must **not** include tables or images                                                                          | T1      | Specified             |

**CNT-129 replaces CNT-040, which was a question review closed and then found incomplete.** Text and
citations yes; tables and images no - and variables, bindings and hyperlinks too, which the original
list omitted while reading as though it were closed. It is closed now, and says so. That is a simplification rather than a deferral: footnote content stays a restricted block
sequence instead of becoming the full recursive model, which keeps the schema smaller and footnote
rendering tractable in all three output formats. The spike's unrun case 4 - a citation inside a
footnote inside a table cell - remains required and remains supported, because a citation is inline.

## 7. Mathematics and scientific notation

| ID          | Requirement                                                                                                                         | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-043** | Equations must have one canonical stored representation, independent of how they were entered                                       | T1      | Specified |
| **CNT-044** | An author must be able to enter an equation as LaTeX                                                                                | T1      | Specified |
| **CNT-045** | An equation must render on screen, in PDF and in Word, from that one representation                                                 | T1      | Specified |
| **CNT-046** | An equation must be available in every context: running text, a heading, a table cell, a footnote and a caption                     | T1      | Specified |
| **CNT-047** | A block equation must be numbered or explicitly unnumbered; unnumbered equations must consume no number (**STR** owns the sequence) | T1      | Specified |
| **CNT-048** | An equation must carry an accessible textual alternative, generated where possible and author-editable                              | T1      | Specified |
| **CNT-049** | An equation that cannot be rendered in a target format must fail the publish, never render as source text or a blank                | T1      | Specified |

## 8. Citations

| ID          | Requirement                                                                                                            | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-050** | A citation must be a reference to a bibliography entry by identity. Typed citation text must not be representable      | T1      | Specified |
| **CNT-051** | Bibliography entries must be managed artifacts within a space, referenceable from any component in it                  | T1      | Specified |
| **CNT-052** | A citation must be able to carry a locator - page, section, figure - alongside its reference                           | T1      | Specified |
| **CNT-053** | Citation and bibliography formatting must be applied at publish time from a selected style (**PUB** owns rendering)    | T6      | Specified |
| **CNT-054** | A citation whose entry cannot be resolved must fail the publish, naming the citation and the component holding it      | T1      | Specified |
| **CNT-102** | Citation styles must include at least CSE, Vancouver and Harvard, and the set must be extensible without a code change | T6      | Specified |

**The split between CNT-050 and CNT-053 is the T1/T6 pattern again.** The reference is in the model
from the start; the style engine that turns it into text arrives with the interchange tranche.
Storing formatted citation text would make a change of style a rewrite of every document.

## 9. Characters and text

| ID          | Requirement                                                                                                                               | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-055** | The full Unicode range must be storable and renderable, including characters outside the Basic Multilingual Plane                         | T1      | Specified |
| **CNT-056** | Text must be normalised to a single Unicode normalisation form on ingest, so that two visually identical strings compare and search alike | T1      | Specified |
| **CNT-057** | An insertion palette must offer mathematical, Greek, and scientific and technical symbols                                                 | T1      | Specified |
| **CNT-058** | A tenant must be able to declare a list of preferred characters, surfaced first in that palette                                           | T2      | Specified |
| **CNT-059** | Right-to-left and bidirectional text must be supported, with direction expressed in the model rather than left to styling                 | T1      | Specified |

**CNT-056 is quiet and important.** Composed and decomposed forms of an accented character look
identical and compare unequal. Without normalisation at the boundary, search misses, comparison
reports phantom edits, and a bound value fails to match a key that looks the same.

## 10. Paste, sanitisation and copying

| ID          | Requirement                                                                                                                                                                           | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-060** | Paste from Word must preserve structure - headings, lists, tables, footnotes, emphasis - rather than producing styled runs                                                            | T1      | Specified |
| **CNT-061** | Paste from Markdown must preserve structure                                                                                                                                           | T1      | Specified |
| **CNT-062** | Paste from HTML must preserve structure                                                                                                                                               | T1      | Specified |
| **CNT-063** | Every paste must produce a report naming what was normalised and what was discarded, shown to the author at the time                                                                  | T1      | Specified |
| **CNT-064** | Nothing discarded on paste may be absent from that report; the tests for paste must assert what was dropped as well as what survived                                                  | T1      | Specified |
| **CNT-065** | Pasted content must never carry typeface, size or colour into the model                                                                                                               | T1      | Specified |
| **CNT-130** | Pasted HTML must be sanitised before it reaches the model: scripts, event handlers, embedded objects, and link targets whose scheme is not allowlisted (CNT-127) must never be stored | T1      | Specified |
| **CNT-131** | A hyperlink dropped or rewritten on paste must be named individually in the paste report (CNT-063), with the target it had                                                            | T1      | Specified |

**CNT-064 is written the way it is because of how it failed in the spike.** The Word importer
dropped three empty paragraphs and did not count them, because they were written in a form the
reader was not looking for. Every assertion in that test was about what came through, and nothing
asserted about what did not. **An importer is judged on its diagnostics as much as on its output**,
and the tests for CNT-060 to CNT-065 must assert both halves.

**CNT-130 is not CNT-065 restated, and neither covers the other.** CNT-065 keeps appearance out of
the model, which is a cleanliness problem. CNT-130 keeps executable and navigable content out of it,
which is a security one. Before hyperlinks existed there was nothing in the model a hostile paste
could aim at; there is now.

### Copying within the product

Foreign paste was specified; moving a block from one component to another was not, and it is the
operation an author performs most. It lands directly on identity, which is why it cannot be left for
the implementation to decide.

| ID          | Requirement                                                                                                                                                                                                             | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-132** | Content copied within the product must be re-identified when it is pasted: every block must receive a newly allocated identifier, unique within the receiving component and never one used before (CNT-002)             | T1      | Specified |
| **CNT-133** | An annotation whose owning artifact does not travel with the content - a comment anchor, a suggestion - must be dropped when that content is pasted into another component, and named in the report (**COL** owns both) | T1      | Specified |
| **CNT-134** | Content written against an earlier schema version must be migrated to the current one before it enters the receiving component (CNT-012), or refused with a named error. It must never be stored unmigrated             | T1      | Specified |
| **CNT-135** | Copying within the product must produce a report to the same standard as a foreign paste, naming what was re-identified and what was dropped (CNT-063, CNT-064)                                                         | T1      | Specified |

**CNT-132 is the one that would otherwise have been found in production.** Copying a block is the
obvious way to duplicate an identifier, and a duplicate identifier is not a visible defect:
comparison reports a paragraph as moved when it was copied, a resolution pass acts on two blocks
when it meant one, and nothing errors. Paste is also where a condition axis the receiving space does
not have would arrive - see **CNT-Q14**.

## 11. The editing session

Review raised a real gap: if edits save continuously, and a snapshot is not cut on every keystroke,
**where does the save go?** The answer needs three levels rather than two, and the vocabulary is
settled in [ADR-0006](../../decisions/0006-iteration-version-revision.md).

- An **iteration** is an interim save. Immutable, timestamped, visible only to the editor holding the
  lock, and retained for a declared recovery window rather than for ever. This is where continuous
  saving goes - which is what closes the gap - and it is not part of the record of what the component
  said.
- A **version** is an iteration promoted to the record, cut on a stated boundary. Minor, numerous,
  and the unit that comparison, baselines and reuse work over.
- A **revision** is a version designated as issued when a component passes a lifecycle gate. Major,
  few, and what a reader cites - a marker on a version, not a second history beside it.

Written `revision.version`: `3.14` is the fourteenth version since the third issue, `0.7` something
never yet issued.

**Undo and iterations answer different questions, and review was right to ask how they relate.**
Undo walks the editing session's own history and dies with the session. Iterations are durable and
survive it. The two meet at a boundary: undo reaches back to the version the session opened from and
no further (CNT-069, CNT-103). Going back beyond that is not undoing, it is restoring an earlier
version - a deliberate, audited act rather than a keystroke.

**A version is only ever cut by a positive act** (CNT-070). Inactivity does not cut one, because a
version records that somebody decided something and time passing is not a decision. That would leave
a gap - a lock timing out with work in no version - except that iterations are retained _until the
next version is cut_ rather than for a fixed window from when they were written (CNT-089). Nothing is
lost by walking away; nothing is recorded as a decision that nobody made.

Iterations being discardable is the part that pays for the rest. An interim save is a keystroke
buffer, not an authored act, and keeping every one of them for the decades this market keeps content
would be storage spent on something nobody will read.

| ID          | Requirement                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **CNT-066** | Edits must be saved continuously and without an explicit save action, as iterations                                                                                                                                                                           | T1         | Specified |
| **CNT-067** | An interrupted session - closed tab, lost connection, crash - must be recoverable to the last edit the author saw accepted                                                                                                                                    | T1         | Specified |
| **CNT-068** | The editor must state plainly whether the current draft is saved, saving, or failing to save                                                                                                                                                                  | T1         | Specified |
| **CNT-069** | Undo and redo must be scoped to the component being edited, must survive a reload within the session, and must reach back at least to the state the session opened from                                                                                       | T1         | Specified |
| **CNT-070** | A version must be cut on a **positive act** - an explicit save, or a deliberate release of the lock - and never on a keystroke, and never on the passage of time                                                                                              | T1         | Specified |
| **CNT-071** | Concurrent access is governed by soft component locks (**COL**); this area must not assume single-writer access                                                                                                                                               | Constraint | Specified |
| **CNT-089** | An iteration must not be a version: it must be immutable, timestamped, and visible only to the editor holding the lock. Iterations must be retained until the component's next version is cut, and for a declared window after that (**VER** owns the window) | T1         | Specified |
| **CNT-090** | An author must be able to see the iterations retained for the component they are editing, and restore any of them within that window                                                                                                                          | T1         | Specified |
| **CNT-103** | Undo must not cross a version boundary. Reaching further back than the version the session opened from is restoring an earlier version, which is a separate and audited act                                                                                   | T1         | Specified |

### Spelling

| ID          | Requirement                                                                                                                                                                                 | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-098** | The editor must check spelling as the author types                                                                                                                                          | T1      | Specified |
| **CNT-099** | Spelling must be checked against the language of the run being edited (CNT-083), not against one language for the whole editor                                                              | T1      | Specified |
| **CNT-100** | A tenant must be able to maintain custom dictionaries, so that domain vocabulary is not flagged in every document                                                                           | T2      | Specified |
| **CNT-101** | Spelling must behave identically in both deliveries. The browser supplies it; the desktop shell must wire the platform's checker through the platform bridge rather than silently losing it | T1      | Specified |

**Spelling is the one thing here the web gives away and the desktop does not** (CNT-101). A
browser checks spelling in a contenteditable region without being asked; an Electron renderer does
not unless the shell wires it up. That asymmetry is exactly what the platform bridge exists for, and
it is the kind of thing that ships as "works in the web build" and is discovered by the first
desktop user. **CNT-099 makes it language-aware** rather than editor-wide, which falls out of
CNT-083 for free and would be awkward to add later.

## 12. The document view

| ID          | Requirement                                                                                                                                                                                                                                              | Tranche | Status                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **CNT-072** | A document must render as one continuous, visually consistent scroll, with its components inline                                                                                                                                                         | T1      | Specified             |
| **CNT-073** | Component boundaries must be revealed on hover and by an explicit toggle, and must not be permanent chrome                                                                                                                                               | T1      | Specified             |
| **CNT-074** | The view must always show which component the cursor is in, whether this user may edit it right now, and **when they may not, why** - naming who holds the lock and when it is expected to release                                                       | T1      | Specified             |
| **CNT-075** | Read-only rendering must be typographically identical to the editing view                                                                                                                                                                                | T1      | Specified             |
| **CNT-076** | The view must remain usable on a document assembling several hundred components (budget in scope §11)                                                                                                                                                    | T1      | Specified             |
| **CNT-082** | The editing view must render the presentation theme's block spacing, so that the separation an author sees is the separation the output will have                                                                                                        | T1      | Specified             |
| **CNT-097** | The editing view must render the theme's typefaces at the sizes the theme declares, so that an author sees the type a reader will see                                                                                                                    | T1      | Specified             |
| **CNT-115** | The editing view must set text at the measure of the document's publishing layout, scaled to the screen and zoomable, so that line lengths and relative image sizes are those of the output                                                              | T1      | Specified             |
| **CNT-095** | An author must be able to preview the document as it will be published, in a selectable output format, without leaving the editor                                                                                                                        | T1      | Specified             |
| **CNT-096** | Preview must be fast enough to use while writing rather than as a separate step, against the budget in CNT-136, tested                                                                                                                                   | T1      | Specified             |
| **CNT-114** | Preview must reflect an edit within one second, and never more than two, in a 300-page document - a provisional budget, to be confirmed against real content                                                                                             | T1      | Superseded by CNT-136 |
| **CNT-136** | Preview must reflect an edit within one second, and never more than two, in a 300-page document, measured on a declared reference configuration recorded alongside the budget - a provisional number, to be confirmed against real content (**CNT-Q13**) | T1      | Specified             |

### Read, review and author

| ID          | Requirement                                                                                                                                                                            | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-104** | The document view must operate in one of three modes - **read**, **review** or **author** - and must make the current mode obvious                                                     | T1      | Specified |
| **CNT-105** | The modes available to a user must be determined by their permissions (**IAM**), and a user must be able to drop to a less privileged mode deliberately                                | T1      | Specified |
| **CNT-106** | Each mode must offer only what it is for: read offers navigation and no editing affordances; review offers comments and suggestions but not direct edits; author offers direct editing | T1      | Specified |

### The version a document references, and comparison

| ID          | Requirement                                                                                                                                                            | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-108** | An author must be able to choose which version or revision of a component a document references, from the document view, without leaving it                            | T1      | Specified |
| **CNT-109** | Changing which version or revision a document references must be an audited act, recording who changed it, when, and from which to which                               | T1      | Specified |
| **CNT-110** | The view must show which version or revision of a component is referenced, and whether the reference is pinned or floating at latest                                   | T1      | Specified |
| **CNT-111** | An author must be able to compare a component against an earlier version or revision from within the editor, choosing from a list that shows who changed each and when | T3      | Specified |
| **CNT-112** | That comparison must be available between any two versions and between any two revisions, rendered as a redline (**VER** owns the comparison itself)                   | T3      | Specified |
| **CNT-113** | An author must be able to see what they have changed in the current session, as a tracked-changes view over the version the session opened from                        | T1      | Specified |

**CNT-072 and CNT-073 are in tension by design.** The monolithic reading experience is the point of
the view; the component boundary is what an author needs and a reader does not. Permanent chrome
would make the product look like an authoring tool rather than a document, which is the first thing
a prospect judges.

**CNT-097 and CNT-095 are not the same requirement, and both are needed.** The editor can show
the theme's type, spacing and styles, so an author sees the words a reader will see. It cannot show
pagination, because a continuous scroll has no pages - where a table breaks, whether a heading
strands, what lands on page 12. That is what preview is for, and it is why preview has to be fast
enough to use while writing (CNT-096) rather than being a publish step in disguise.

**The three modes (CNT-104 to CNT-106) are an interface consequence of a permission model.** A
reader wants no editing affordances at all; a reviewer wants to comment and suggest but must not
alter the text directly; an author wants to type. Showing one interface with two thirds of it
disabled teaches everybody to ignore the parts that are greyed out. **IAM** decides which modes a
user may have; this area decides what each one looks like, and that a user may deliberately drop to
a lesser one - reading your own document without the risk of typing into it is a real thing to want.

**CNT-108 to CNT-110 are the audited step back and step forward.** A document references a
component at a version, and an author must be able to move that reference - to an earlier version
they trust, or forward to the latest - from the document rather than from an administration screen.
It is an audited act because it changes what a reader sees without changing a word of content, which
is exactly the kind of change that is invisible in a diff of the text.

**CNT-111 to CNT-113 are two different questions that look like one.** "What changed between these
two versions" is comparison, and **VER** owns it; this area owns only the affordance - reachable
from the editor, listing who changed what and when. "What have _I_ changed since I sat down" is a
different question with a different answer, because the interesting boundary is the session rather
than a version, and an author asks it constantly while writing. Both render as a redline; only the
first needs two versions chosen.

**CNT-074 exists because "you cannot edit this" without a reason is an error message, not an
interface.** "Locked by Grace Hopper, idle 6 minutes, releases at 14:20" tells an author what to do
next. A greyed-out box does not.

## 13. Editor accessibility

| ID          | Requirement                                                                                                                                                                                                                                                                        | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-077** | Every editing action must be reachable from the keyboard alone                                                                                                                                                                                                                     | T1      | Specified |
| **CNT-078** | The editor must meet WCAG 2.2 AA, verified rather than asserted                                                                                                                                                                                                                    | T1      | Specified |
| **CNT-079** | Structure - headings, lists, tables, footnotes - must be exposed to assistive technology as structure, not styling                                                                                                                                                                 | T1      | Specified |
| **CNT-080** | Equations must be reachable and readable by assistive technology through their textual alternative                                                                                                                                                                                 | T1      | Specified |
| **CNT-137** | Inserting and resolving a suggestion or a comment must be announced to assistive technology, naming which annotation it was and what happened to it                                                                                                                                | T1      | Specified |
| **CNT-138** | Suggestions, comment anchors and redlines must be distinguishable without colour - by shape, border, marker or text - and must stay distinguishable in a high-contrast mode                                                                                                        | T1      | Specified |
| **CNT-139** | CNT-078 must be verified by an automated accessibility suite run in continuous integration over the editor, and by a recorded manual audit against the WCAG 2.2 AA criteria before each release, the result kept as evidence. Conformance asserted without both is not conformance | T1      | Specified |

**Review was right that this section was thin, and right about where.** Four requirements covered an
entire editor while footnotes had seven. The three added are the ones whose absence would have
shipped: **CNT-137**, because inserting and resolving annotations are the central acts of review and
a screen reader user who cannot tell whether a suggestion landed cannot review; **CNT-138**, because
a redline distinguished only by colour fails WCAG 1.4.1 and is the most common way an otherwise
accessible editor fails it; and **CNT-139**, because "verified rather than asserted" (CNT-078) named
no acceptance path, and a requirement nobody can fail is a requirement nobody has met.

**Automated checks alone are not what CNT-139 asks for.** They catch contrast, names and roles;
they do not catch whether the reading order of a document with suggestions in it makes sense, which
is the thing this editor can most easily get wrong.

## 14. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-N01** | **No typeface, font size or colour _chosen by the author_.** The editor renders the theme's typefaces at the theme's sizes (CNT-097) - what the author cannot do is pick a different one. Narrower than "no styling" on purpose - see CNT-035            |
| **CNT-N02** | **No page geometry in content.** Page size, margins, running heads and columns belong to the publishing layout. Whether a forced page break is an exception is **CNT-Q07**                                                                               |
| **CNT-N03** | **No free-form drawing or diagramming.** A figure references a managed asset produced elsewhere                                                                                                                                                          |
| **CNT-N04** | **No embedded spreadsheets or live formulas.** Computation belongs in the query layer                                                                                                                                                                    |
| **CNT-N05** | **No arbitrary HTML or raw markup escape hatch.** It would defeat every guarantee in section 3                                                                                                                                                           |
| **CNT-N06** | **No per-author formatting preferences.** Two authors editing one document must produce content that looks the same                                                                                                                                      |
| **CNT-N07** | **No tables or images inside footnotes** (CNT-040)                                                                                                                                                                                                       |
| **CNT-N08** | **No per-document override of a theme's styles.** Where a document needs a different look it uses a different theme, which an administrator configures. Otherwise every document drifts into being its own theme                                         |
| **CNT-N09** | **No headings in component content.** A component carries no heading, because the outline owns structure and its titles (**STR**) - and because a component that knew its own heading level could not be used at two depths. A decision, not an omission |
| **CNT-N10** | **No link to content inside the product expressed as a URL.** An internal target is a cross-reference (CNT-027), which survives a move, a rename and a renumber. A URL to a component would be a second, weaker way of doing the same thing              |

## 15. Open questions

| ID          | Question                                                                                                                                                                                                                                                                                                                                                                                  | What would settle it                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-Q01** | **What is the canonical equation representation (CNT-043)?** MathML, LaTeX, or a structured form                                                                                                                                                                                                                                                                                          | The publishing engine decision - it constrains what can be rendered to PDF faithfully                                                                                                                                                                                                        |
| **CNT-Q02** | **Is the three-level vocabulary in section 11 adopted, and what are the interim saves called?**                                                                                                                                                                                                                                                                                           | **Settled.** Adopted as iteration / version / revision in [ADR-0006](../../decisions/0006-iteration-version-revision.md); the scope, the domain package and the spike findings are reconciled                                                                                                |
| **CNT-Q03** | **What exactly is the boundary that cuts a version (CNT-070)?**                                                                                                                                                                                                                                                                                                                           | **Settled.** A positive act only - an explicit save or a deliberate lock release. Never inactivity: a version records that somebody decided something, and time passing is not a decision. Iterations are retained until the next version, so nothing is lost when a lock times out          |
| **CNT-Q04** | **Does the mark vocabulary need an extension point?** CNT-006 closes it, which may not survive a real customer                                                                                                                                                                                                                                                                            | The first customer requirement that cannot be expressed with the closed set                                                                                                                                                                                                                  |
| **CNT-Q05** | **How is an authored table's cell identified for a footnote anchor (CNT-037)?**                                                                                                                                                                                                                                                                                                           | **Settled.** An authored table is data too: it may declare key columns, and anchoring then works exactly as it does for a bound table (CNT-107). Positional fallback where no key is declared, marked as the weaker form                                                                     |
| **CNT-Q06** | **May a document override the theme's resolution of an image's size (CNT-088)?**                                                                                                                                                                                                                                                                                                          | **Settled: no.** Only styles the configuration provides. An administrator adds a style; a document picks one. See CNT-N08                                                                                                                                                                    |
| **CNT-Q07** | **Is a forced page break content or structure?** "This section starts on a new page" reads like an outline property; "keep these two blocks together" reads like a content one. Recommendation: the first in **STR**, the second here                                                                                                                                                     | A decision in **STR**, since the outline is where the first half would live                                                                                                                                                                                                                  |
| **CNT-Q09** | **Do style catalogues need their own capability area?**                                                                                                                                                                                                                                                                                                                                   | **Settled: yes.** Added as `STY`, the eighteenth area, with scope §7.18. Style catalogues span the editor and the publisher and belonged to neither                                                                                                                                          |
| **CNT-Q10** | **How do review and authoring interact for a user who may do both?** Note what is _not_ open: suggestions with accept and reject are settled by scope decision 4 and specified in §7.7 and CNT-033. What is open is whether a reviewer who also holds authoring rights may edit directly instead of suggesting, and whether an author may suggest to themselves rather than simply typing | A decision in **COL**, informed by whether review in this market is expected to be a separate pass or a mode anyone can drop into                                                                                                                                                            |
| **CNT-Q11** | **Which area owns a document being created from a template?**                                                                                                                                                                                                                                                                                                                             | **Settled: a new one.** Added as `TPL`, the nineteenth area, with scope §7.19 - template authoring, the metadata schema and structure outline definitions nothing else owned, declared parameters, instantiation, divergence, and what happens when a template changes after documents exist |
| **CNT-Q12** | **Who owns a component's own metadata - its title, its tags?** **TPL** owns the metadata schema a document declares and **SCH** searches the values, but no area states where a component's own title and values live, or what validates them                                                                                                                                             | A decision between **CNT**, **TPL** and **LIF**. Until it is taken nobody writes requirements for it, which is how a field arrives in the schema by accident rather than by design                                                                                                           |
| **CNT-Q13** | **What is the reference configuration the preview budget is measured on (CNT-136)?** Two seconds on what, rendering what content                                                                                                                                                                                                                                                          | The first performance harness, which has to name a machine before it can report a number. A budget with no baseline can be neither confirmed nor refuted                                                                                                                                     |
| **CNT-Q14** | **What happens when content carrying a condition arrives in a space whose axis does not exist (CNT-132 to CNT-135)?**                                                                                                                                                                                                                                                                     | A decision in **REU**, which owns axes. Three candidates - refuse the paste, drop the condition and report it, or create the axis - and the third is how a taxonomy quietly becomes whatever anybody pasted                                                                                  |
| **CNT-Q15** | **Should CNT-091 to CNT-093 be superseded by their STY equivalents?** They now say what STY-016, STY-017, STY-029 and STY-030 say, and two owners of one rule is how the two drift apart                                                                                                                                                                                                  | A decision with **STY**, taken together with `docs/design/themes.md`, which currently claims all three. Left open rather than acted on here because it moves requirements a design document already answers                                                                                  |
| **CNT-Q08** | **Is block alignment ever the author's?**                                                                                                                                                                                                                                                                                                                                                 | **Settled.** Alignment comes from a named style, chosen from a catalogue - and so do paragraph, table, image and citation appearance generally (CNT-094)                                                                                                                                     |

## 16. Traceability

| This document               | Rests on                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Section 3                   | ADR-0005; spike findings cases 1, 3, 7                                                                              |
| CNT-023, CNT-082            | Spike findings, "Settled: a Word round-trip is lossy by design"                                                     |
| CNT-039                     | Spike findings case 3                                                                                               |
| CNT-064                     | Spike findings, the silent-drop defect found under symptom three                                                    |
| CNT-041, CNT-047, CNT-081   | Scope §6, "numbering is a property of the outline"                                                                  |
| CNT-022, CNT-078 to CNT-080 | Scope §11, accessibility                                                                                            |
| CNT-083, CNT-084, CNT-140   | Scope §7.16 and §11; PDF/UA requires the language of a passage; LOC-002, LOC-003 and LOC-007 need the region        |
| Sections 4, 5               | Scope §7.1                                                                                                          |
| CNT-116 to CNT-139          | [The v1 review](<../../reviews/CNT - Content and Authoring.md>), section 17                                         |
| CNT-N09, CNT-N10            | [The v1 review](<../../reviews/CNT - Content and Authoring.md>), section 17                                         |
| CNT-126 to CNT-128, CNT-130 | [The v1 review](<../../reviews/CNT - Content and Authoring.md>), "Missing areas": hyperlinks and their sanitisation |
| CNT-132 to CNT-135          | [The v1 review](<../../reviews/CNT - Content and Authoring.md>), "Missing areas": internal copy and paste           |
| CNT-137 to CNT-139          | [The v1 review](<../../reviews/CNT - Content and Authoring.md>), "Accessibility is thin"                            |

## 17. Change history

One row per change, against [the review](<../../reviews/CNT - Content and Authoring.md>) that
prompted it. A material change to a requirement gets a new identifier and supersedes the old one
rather than editing it in place, which is why the count grows faster than the content does - the
rules for that are in [the index](README.md#how-a-requirement-is-written).

### From the v1 review

| Review point                                   | Change                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Some IDs bundle several facets                 | **CNT-088 split** into CNT-121 (the reference carries a named style), CNT-122 (the style resolves at publish time, by STY's rules) and CNT-123 (no absolute dimension in the model). CNT-088 is `Superseded by CNT-121`                                                                                                                                                                    |
| Some IDs bundle several facets                 | **CNT-015 split** into CNT-117 (three kinds of list), CNT-118 (nesting to six levels) and CNT-119 (start number and numbering format). CNT-015 is `Superseded by CNT-117`                                                                                                                                                                                                                  |
| Normative prose without IDs                    | The binding sentence in section 2 is now **CNT-116**, and the paragraph around it is rationale. "Strong renders bold in most themes" is reworded to say plainly that it illustrates and binds nothing                                                                                                                                                                                      |
| Accessibility is thin                          | **CNT-137** (assistive technology is told when a suggestion or comment is inserted and resolved), **CNT-138** (redlines and anchors distinguishable without colour) and **CNT-139** (what verifying CNT-078 means: an automated suite in CI plus a recorded manual audit, kept as evidence)                                                                                                |
| The STY boundary is not reflected              | **CNT-020 superseded by CNT-120**: the admonition vocabulary is the admonition style catalogue's (STY-003), not the theme's. A boundary row for **STY** added to section 2                                                                                                                                                                                                                 |
| The STY boundary is not reflected              | CNT-091 to CNT-093 duplicate STY-016, STY-017, STY-029 and STY-030. **Raised as CNT-Q15 rather than acted on**, because `docs/design/themes.md` claims all three and moving them is a change to the design layer as well as this one                                                                                                                                                       |
| Navigability                                   | Section 10 renamed **Paste, sanitisation and copying**; spelling (CNT-098 to CNT-101) given its own subsection; section 12 split into the view, the three modes, and version references and comparison. No identifier moved                                                                                                                                                                |
| CNT-040 omits variables, bindings              | **Superseded by CNT-129**, which lists variables (CNT-029), inline data bindings (CNT-030) and hyperlinks, and states that the list is closed                                                                                                                                                                                                                                              |
| Can a cross-reference target a plain paragraph | **CNT-125** states the addressable set once: every block is addressable by its identifier and may be a cross-reference target. Carrying a caption makes a block numbered, not addressable                                                                                                                                                                                                  |
| CNT-096 defers to a budget                     | CNT-096 now cites the budget by identifier. **CNT-114 superseded by CNT-136**, which requires a declared reference configuration recorded with the number; what that configuration is becomes **CNT-Q13**                                                                                                                                                                                  |
| Missing: hyperlinks                            | **CNT-126** (a mark carrying an absolute target), **CNT-127** (a scheme allowlist, refused on entry and never stored), **CNT-128** (carried to every output format) and **CNT-130** (HTML sanitised on paste: no scripts, handlers, objects or non-allowlisted schemes), with **CNT-131** naming dropped links in the paste report. **CNT-N10** keeps internal targets as cross-references |
| Missing: internal copy and paste               | A new subsection in section 10: **CNT-132** (every pasted block re-identified), **CNT-133** (comment anchors and suggestions dropped and reported when they cross a component), **CNT-134** (older schema versions migrated before entry, or refused) and **CNT-135** (the same report standard as a foreign paste). **CNT-Q14** covers a condition axis the receiving space does not have |
| Missing: headings' absence unstated            | **CNT-N09** says it: no headings in component content, because **STR** owns the outline and its titles                                                                                                                                                                                                                                                                                     |
| Missing: minimum component shape               | **CNT-124**: a component always holds at least one block, and a new component holds exactly one empty paragraph - which is not the spacing empty CNT-023 forbids                                                                                                                                                                                                                           |
| Unowned neighbours                             | Boundary rows added for **AST** (the managed assets a figure references), **LOC** (translation) and **TPL** (the metadata schema). Component-level metadata - a component's own title and tags - has no owner, and is now **CNT-Q12** rather than a silence                                                                                                                                |

### What the review raised and this revision did not change

| Point                                                  | Why not                                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID allocation follows review rounds rather than topics | Identifiers are contiguous as a set and deliberately out of order down the page; renumbering would break every citation. The fix for navigability is document structure, and that is what changed |
| CNT-091 to CNT-093 move to STY                         | CNT-Q15. It is a decision with STY and with the design that already claims them, not an edit to this document                                                                                     |

### From the LOC review

A later review, of [LOC](LOC-localisation-and-translation.md), reached back into this document.

| Point                                | Change                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A language tag has no declared shape | **CNT-083 superseded by CNT-140**: the tag must be BCP 47, with a region wherever the region changes the content. LOC stated the dependency in LOC-034 because this document did not carry it; it carries it now, and LOC-034 cites CNT-140. A tag's shape cannot be narrowed once content has been stored against it, which is why it changed at T1 rather than when translation ships |

### Counts

|                  | Before | After                      |
| ---------------- | ------ | -------------------------- |
| Requirements     | 115    | 140, of which 6 superseded |
| Non-requirements | 8      | 10                         |
| Open questions   | 11     | 15, of which 7 settled     |
