# CNT - Content and authoring

> **Status: draft, for review.** The first detailed requirements area. It rests on a content model
> that has been built and tested rather than only argued, so it is more settled than the areas that
> follow will be at first draft.

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

| Not here                                               | There            |
| ------------------------------------------------------ | ---------------- |
| Where a component sits, numbering, cross-references    | **STR**          |
| Transclusion, variables, conditional profiling         | **REU**          |
| Tables whose rows come from a query                    | **DAT**, **TAB** |
| Who may edit, locks, threads, accepting suggestions    | **COL**          |
| Rendering to PDF, Word or HTML                         | **PUB**          |
| Pasting from and exporting to foreign formats at scale | **IMP**          |

**The model here must accommodate what those areas need from day one**, even where their features
land in a later tranche. Marks for conditions, suggestions and comments exist in the T1 schema
because retrofitting a range annotation onto stored content is a migration of every revision ever
written. The scope makes this point at the tranche level; this document is where it becomes concrete.

## 3. The content model

Content is a tree of typed **block** nodes. Blocks contain **inline** nodes. Ranges of text carry
**marks**. That third thing is the one that earns its keep: a mark is a member of a set applied to a
range, not an element that must nest, so a profiling condition and a reviewer's redline can cover
overlapping parts of the same sentence without either being split into two things.

Identity is the other load-bearing idea, and it appears twice. **Blocks carry an id** so that
comparison can say "this paragraph moved and was reworded" instead of "one vanished and another
appeared". **Marks carry an id** so that an annotation fragmented by an overlap is still one
annotation, and accepting it is one action. Both were established by the spike rather than assumed,
and both have to be in the schema from the first revision ever stored, because revisions are
immutable and identity cannot be granted retrospectively.

| ID          | Requirement                                                                                                                                                            | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-001** | Content must be a tree of typed block nodes, serialised as JSON, structurally identical to what the editor manipulates in memory                                       | T1      | Specified |
| **CNT-002** | Every block node must carry an identifier, allocated when the block is created, unique within its component, and never reused                                          | T1      | Specified |
| **CNT-003** | Every annotation over a range of text must be a mark; marks must be able to cover overlapping ranges without nesting and without being split into separate annotations | T1      | Specified |
| **CNT-004** | Every mark must carry an identifier; an annotation fragmented across several text nodes must remain one annotation under one identifier                                | T1      | Specified |
| **CNT-005** | Accepting, rejecting or excluding a marked annotation must act on every fragment of that identifier in one operation                                                   | T1      | Specified |
| **CNT-006** | The mark vocabulary must be closed. Adding a mark type is a schema change with a migration, not a configuration option                                                 | -       | Specified |
| **CNT-007** | The model must contain no mark or node whose only purpose is to represent an overlap, a range start or a range end                                                     | -       | Specified |
| **CNT-008** | Marks must be semantic. The model must carry no presentational property - no font, size, colour, alignment or spacing                                                  | -       | Specified |
| **CNT-009** | A resolution pass (accepting a suggestion, excluding a condition) must preserve block identifiers                                                                      | T1      | Specified |
| **CNT-010** | Content must be validated on creation, on revision, and on read-back from storage                                                                                      | T1      | Specified |
| **CNT-011** | Every stored content document must record the schema version it was written against                                                                                    | T1      | Specified |
| **CNT-012** | A migration path must exist from every schema version ever written to the current one, and must be exercised by a test carrying a fixture of each                      | T1      | Specified |
| **CNT-013** | Content that fails validation on read-back must be quarantined and reported, never silently coerced or partially loaded                                                | T1      | Specified |

**CNT-012 is the expensive one and it is not optional.** Revisions are immutable, so a schema change
cannot rewrite what is already stored. Every version ever written stays readable for as long as the
tenant keeps its content, which in this market is measured in decades.

## 4. Block content

The block vocabulary is deliberately small. Every addition is a construct that has to survive
comparison, conditional resolution, translation, and three output formats, so the bar is that a
report cannot be written without it.

| ID          | Requirement                                                                                                                                            | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **CNT-014** | Paragraphs must be supported, as the default block                                                                                                     | T1      | Specified |
| **CNT-015** | Lists must be supported - ordered, unordered and definition - nestable to at least six levels, with an author-settable start number on an ordered list | T1      | Specified |
| **CNT-016** | Authored tables must be supported, with header rows and columns, merged cells, and a caption                                                           | T1      | Specified |
| **CNT-017** | Figures must be supported, carrying a caption and alternative text, and referencing a managed asset rather than embedding one                          | T1      | Specified |
| **CNT-018** | Preformatted blocks must be supported, with an optional language label, preserving whitespace exactly                                                  | T1      | Specified |
| **CNT-019** | Block quotations must be supported, with an optional attribution that may carry a citation                                                             | T1      | Specified |
| **CNT-020** | Admonitions must be supported, from a closed vocabulary declared by the presentation theme                                                             | T2      | Specified |
| **CNT-021** | Block-level equations must be supported                                                                                                                | T1      | Specified |
| **CNT-022** | A figure's alternative text must be required, and publishing must fail when it is absent                                                               | T1      | Specified |
| **CNT-023** | Empty blocks used for vertical spacing must not be representable. Separation is a property of the presentation theme                                   | -       | Specified |

**CNT-022 has a cost and is deliberate.** Alternative text is a legal requirement for accessible
output in this market, and the only moment anyone knows what a figure means is when it is placed.
Making it a publish-time failure rather than a warning is the difference between an accessible
product and one that reports itself as accessible.

**CNT-023 was contested and is settled.** A Word round-trip through this product will not reproduce
an author's blank lines, and that is the product working rather than failing - see the spike
findings. The layout supplies the separation instead.

## 5. Inline content and marks

| ID          | Requirement                                                                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **CNT-024** | Text must be the base inline node                                                                                                                                  | T1      | Specified |
| **CNT-025** | Inline equations must be supported                                                                                                                                 | T1      | Specified |
| **CNT-026** | Footnote anchors must be inline nodes (section 6)                                                                                                                  | T1      | Specified |
| **CNT-027** | Cross-references must be inline nodes carrying a target identity and what to display, never a resolved number or title                                             | T1      | Specified |
| **CNT-028** | Citations must be inline nodes (section 8)                                                                                                                         | T1      | Specified |
| **CNT-029** | Variables must be supported, carrying a name resolved at publish time (**REU** owns resolution)                                                                    | T1      | Specified |
| **CNT-030** | Inline data bindings must be supported, carrying a query reference (**DAT** owns resolution)                                                                       | T1      | Specified |
| **CNT-031** | Semantic character marks must be supported: emphasis, strong, subscript, superscript, inline code, defined term, quoted phrase, foreign phrase with a language tag | T1      | Specified |
| **CNT-032** | Condition marks must be supported, carrying an axis and permitted values (**REU** owns evaluation)                                                                 | T1      | Specified |
| **CNT-033** | Suggestion marks must be supported, carrying an operation and an author (**COL** owns the review workflow)                                                         | T1      | Specified |
| **CNT-034** | Comment anchor marks must be supported, carrying a thread identity (**COL** owns the thread)                                                                       | T1      | Specified |
| **CNT-035** | The editor must offer no control over font, size, colour or alignment                                                                                              | T1      | Specified |

**CNT-029 to CNT-034 are in T1 and their features are not.** Their marks and nodes are in the
schema from the start precisely because they are not needed yet: adding a range annotation to a
model whose content is already stored and immutable is a migration of everything.

**CNT-031 includes a foreign phrase with a language tag** because tagged PDF and accessible Word
both need the language of a run to be known, and an author switching language mid-sentence is
ordinary in this market. It is cheap here and impossible to retrofit at publish time.

## 6. Footnotes

Footnotes are where this market differs from general document tooling, and where the model earns or
loses credibility. A note may hang off a phrase, off a single cell of a table, or off a table as a
whole, and all three occur in the same report.

| ID          | Requirement                                                                                                                    | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **CNT-036** | A footnote must be anchorable to a span of text                                                                                | T1      | Specified |
| **CNT-037** | A footnote must be anchorable to a cell of an authored table                                                                   | T1      | Specified |
| **CNT-038** | A footnote must be anchorable to a table as a whole                                                                            | T1      | Specified |
| **CNT-039** | A footnote anchored into generated content must identify its target by data, never by position (**DAT** owns the binding case) | T2      | Specified |
| **CNT-040** | Footnote content must support paragraphs, lists, citations, inline equations and cross-references                              | T1      | Specified |
| **CNT-041** | Footnote numbering must be a property of the outline, not of the component (**STR** owns it)                                   | T1      | Specified |
| **CNT-042** | A footnote whose anchor cannot be resolved must fail the publish with a named error identifying the footnote                   | T1      | Specified |

**CNT-040 is the unresolved one.** It makes footnote content recursive - a citation inside a
footnote inside a table cell is an ordinary occurrence in a regulated report, and the spike's case
4 was never run. The schema draft currently holds footnote content as text runs only. See open
questions.

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

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-050** | A citation must be a reference to a bibliography entry by identity. Typed citation text must not be representable   | T1      | Specified |
| **CNT-051** | Bibliography entries must be managed artifacts within a space, referenceable from any component in it               | T1      | Specified |
| **CNT-052** | A citation must be able to carry a locator - page, section, figure - alongside its reference                        | T1      | Specified |
| **CNT-053** | Citation and bibliography formatting must be applied at publish time from a selected style (**PUB** owns rendering) | T6      | Specified |
| **CNT-054** | A citation whose entry cannot be resolved must fail the publish, naming the citation and the component holding it   | T1      | Specified |

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

## 10. Paste and normalisation

| ID          | Requirement                                                                                                                          | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **CNT-060** | Paste from Word must preserve structure - headings, lists, tables, footnotes, emphasis - rather than producing styled runs           | T1      | Specified |
| **CNT-061** | Paste from Markdown must preserve structure                                                                                          | T1      | Specified |
| **CNT-062** | Paste from HTML must preserve structure                                                                                              | T1      | Specified |
| **CNT-063** | Every paste must produce a report naming what was normalised and what was discarded, shown to the author at the time                 | T1      | Specified |
| **CNT-064** | Nothing discarded on paste may be absent from that report; the tests for paste must assert what was dropped as well as what survived | T1      | Specified |
| **CNT-065** | Pasted content must never carry presentational formatting into the model                                                             | T1      | Specified |

**CNT-064 is written the way it is because of how it failed in the spike.** The Word importer
dropped three empty paragraphs and did not count them, because they were written in a form the
reader was not looking for. Every assertion in that test was about what came through, and nothing
asserted about what did not. **An importer is judged on its diagnostics as much as on its output**,
and the tests for CNT-060 to CNT-065 must assert both halves.

## 11. The editing session

| ID          | Requirement                                                                                                                | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-066** | Edits must be saved without an explicit save action                                                                        | T1      | Specified |
| **CNT-067** | An interrupted session - closed tab, lost connection, crash - must be recoverable to the last edit the author saw accepted | T1      | Specified |
| **CNT-068** | The editor must state plainly whether the current draft is saved, saving, or failing to save                               | T1      | Specified |
| **CNT-069** | Undo and redo must be scoped to the component being edited and must survive a reload within the session                    | T1      | Specified |
| **CNT-070** | A revision must be cut on an explicit act, not on every keystroke; the rule for when must be stated and testable           | T1      | Specified |
| **CNT-071** | Concurrent access is governed by soft component locks (**COL**); this area must not assume single-writer access            | -       | Specified |

**CNT-070 is unsettled in its detail and it matters.** Revisions are immutable and comparison is
built on them, so a revision per keystroke makes history unreadable and a revision per session loses
the intermediate states a reviewer needs. See open questions.

## 12. The document view

| ID          | Requirement                                                                                                      | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **CNT-072** | A document must render as one continuous, visually consistent scroll, with its components inline                 | T1      | Specified |
| **CNT-073** | Component boundaries must be revealed on hover and by an explicit toggle, and must not be permanent chrome       | T1      | Specified |
| **CNT-074** | The view must always show which component the cursor is in, and whether it is editable by this user right now    | T1      | Specified |
| **CNT-075** | Read-only rendering must be typographically identical to the editing view                                        | T1      | Specified |
| **CNT-076** | The view must remain usable on a document assembling several hundred components (**budget in §11 of the scope**) | T1      | Specified |

**CNT-072 and CNT-073 are in tension by design.** The monolithic reading experience is the point of
the view; the component boundary is what an author needs and a reader does not. Permanent chrome
would make the product look like an authoring tool rather than a document, which is the first thing
a prospect judges.

## 13. Editor accessibility

| ID          | Requirement                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **CNT-077** | Every editing action must be reachable from the keyboard alone                                                     | T1      | Specified |
| **CNT-078** | The editor must meet WCAG 2.2 AA, verified rather than asserted                                                    | T1      | Specified |
| **CNT-079** | Structure - headings, lists, tables, footnotes - must be exposed to assistive technology as structure, not styling | T1      | Specified |
| **CNT-080** | Equations must be reachable and readable by assistive technology through their textual alternative                 | T1      | Specified |

## 14. Non-requirements

Stated so nobody has to infer them.

- **No arbitrary styling.** Appearance is the presentation theme's, always.
- **No page layout in content.** Page breaks, margins and running heads belong to the publishing
  layout.
- **No free-form drawing or diagramming.** A figure references a managed asset produced elsewhere.
- **No embedded spreadsheets or live formulas.** Computation belongs in the query layer.
- **No arbitrary HTML or raw markup escape hatch.** It would defeat every guarantee in section 3.
- **No per-author formatting preferences.** Two authors editing the same document must produce
  content that looks the same.

## 15. Open questions

| Question                                                                                                       | What would settle it                                                                   |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Is footnote content fully recursive (CNT-040)?** Currently text runs only in the schema draft                | Spike case 4 - a citation inside a footnote inside a table cell - which was never run  |
| **When is a revision cut (CNT-070)?** Per session, per idle period, per explicit save, or per lock release     | A decision informed by what comparison and audit need, then a decision record          |
| **Does the mark vocabulary need an extension point?** CNT-006 closes it, which may not survive a real customer | The first customer requirement that cannot be expressed with the closed set            |
| **What is the canonical equation representation (CNT-043)?** MathML, LaTeX, or a structured form               | The publishing engine decision - it constrains what can be rendered to PDF faithfully  |
| **How is an authored table's cell identified for a footnote anchor (CNT-037)?** Bound tables use a data key    | Whether authored tables gain stable cell identity, or anchors use block-relative paths |

## 16. Traceability

| This document               | Rests on                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| Section 3                   | ADR-0005; spike findings cases 1, 3, 7                           |
| CNT-023                     | Spike findings, "Settled: a Word round-trip is lossy by design"  |
| CNT-039                     | Spike findings case 3                                            |
| CNT-064                     | Spike findings, the silent-drop defect found under symptom three |
| CNT-041, CNT-047            | Scope §6, "numbering is a property of the outline"               |
| CNT-022, CNT-078 to CNT-080 | Scope §11, accessibility                                         |
| Section 4, 5                | Scope §7.1                                                       |
