# Word output

How the resolved document becomes a `.docx` that Word opens as a real document: styled, numbered,
footnoted and cross-referenced the way Word itself would have done it.

This realises the Word half of [PUB](../specification/requirements/PUB-publishing-and-output.md),
under [ADR-0015](../decisions/0015-word-output-our-own-writer-reflowable.md). It reads the same
resolved document as the PDF ([ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md))
and takes its styles and run formatting from [themes.md](themes.md) (ADR-0014).

## The shape in one paragraph

One writer in `packages/domain`, pure TypeScript, turns the resolved document into the parts of a
`.docx` and zips them with `fflate`. It decides nothing about appearance - styles come from the theme's
Word projection and each run's formatting from `wordRun`. It decides nothing about pagination either:
Word lays out its own pages, anything that shows a page number is a field Word computes, and the
document asks Word to refresh those fields when it opens. Everything the resolver already knows -
section numbers, figure numbers, equation numbers - goes in as fields with the right values already
in them, so a reader who never refreshes still sees correct numbers everywhere except page numbers.

## Requirements owned

| ID          | How it is met                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **PUB-023** | Every construct below is a native Word construct; nothing is flattened to formatted text                                            |
| **PUB-024** | Heading numbering is a `numbering.xml` definition linked from each heading style, in the scheme the layout declares (PUB-011)       |
| **PUB-025** | Footnotes are `footnotes.xml` entries: `w:footnoteReference` in the text, `w:footnoteRef` inside the note, so Word numbers both     |
| **PUB-026** | A cross-reference is a `REF` field to a bookmark on its target, with the resolved number as the field's current result              |
| **PUB-028** | Suggestions become `w:ins` and `w:del` with author and date; comment threads become `comments.xml` anchored by range                |
| **PUB-029** | The writer's output is opened in Word before any change to it lands, and the conformance harness renders and schema-checks it       |
| **PUB-035** | Headings carry outline levels, images carry alternative text, header rows repeat and are marked, and every run carries its language |
| **PUB-065** | No page breaks are imposed to mimic the PDF; the publication record states that page numbers cite the PDF                           |
| **PUB-066** | Contents, lists and page references are `TOC` and `PAGEREF` fields; `settings.xml` asks Word to update fields on opening            |
| **PUB-067** | Equations are OMML, built from the same maths tree as the PDF                                                                       |
| **CNT-045** | One MathML: drawn natively in the editor, and converted once to the maths tree, which the PDF sets and this writer makes OMML from  |
| **CNT-128** | A hyperlink is a PDF link (publishing.md) and a `w:hyperlink` here; every T1 format has links, so no theme rendering stands in      |

PUB-027 - styles as real Word styles - belongs to [themes.md](themes.md), whose Word projection this
writer includes as `styles.xml`.

## Parts

| Part                        | Written from                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `word/document.xml`         | The resolved document: paragraphs, runs, tables, images, equations, fields, the section settings |
| `word/styles.xml`           | The theme's Word projection (ADR-0014), unchanged                                                |
| `word/numbering.xml`        | The layout's numbering schemes (PUB-011): headings, and the lists that use them                  |
| `word/footnotes.xml`        | The resolved footnotes, with the separators Word requires                                        |
| `word/comments.xml`         | Comment threads, when the output includes review                                                 |
| `word/settings.xml`         | `updateFields`, the document's default language, tracked-change settings                         |
| `word/media/*`              | Images, at the resolution the image style needs                                                  |
| `word/fontTable.xml`, fonts | Embedded faces where the licence permits (STY-041), or the Word face declared (STY-052)          |
| `docProps/core.xml`         | Title and language, which Word shows and screen readers announce                                 |

Every part is checked against the ECMA-376 transitional schemas before a test passes, because Word
refuses a file whose elements are out of order rather than reading past them - the spike met this
with paragraph properties, and a schema check finds it without anyone opening Word.

## Pagination is Word's

Word lays out its own pages, with its own line breaking, and a recipient's first edit reflows
everything after it. So the writer imposes no page breaks except the ones the layout declares as
structure - a chapter that starts on a new page, a section break that changes page numbering - and
never ones that exist only because the PDF happened to break there. The PDF is the paged record: a
page number in a citation, an approval or a query cites the PDF, and the publication record says so
(PUB-065).

That puts a hard line between two kinds of number:

- **Numbers the resolver knows** - sections, figures, tables, equations - are fields (`REF`, and `SEQ`
  where Word numbers the sequence) whose current result is the resolved value. They are right when
  the document opens, and stay right if a reader refreshes them.
- **Numbers only Word knows** - pages - are fields with no value we could honestly supply: `TOC`,
  `PAGEREF`, lists of figures and tables. `settings.xml` sets `w:updateFields`, so Word offers to
  refresh them when the document opens (PUB-066). Page numbers in headers and footers are `PAGE` and
  `NUMPAGES`, which Word keeps current without asking.

Copying the PDF's page numbers into these fields would look finished and be wrong, which is the one
outcome worse than a prompt.

## Equations

Word's equations are OMML, and they are built from the same structural maths tree the Typst template
assembles (ADR-0013): MathML from the content model ([content-model.md](content-model.md)), then the
tree. Neither Microsoft's
MathML-to-OMML stylesheet - not redistributable - nor an image of the equation is used.

| Tree node                          | OMML                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Identifier, number                 | `m:r` - Word sets single-letter identifiers italic and digits upright itself |
| Upright identifier                 | `m:r` with `m:sty m:val="p"`                                                 |
| Operator                           | `m:r`; Word applies operator spacing from the character                      |
| Fraction                           | `m:f` with `m:num` and `m:den`                                               |
| Scripts                            | `m:sSub`, `m:sSup`, `m:sSubSup`                                              |
| Sum, product, integral with limits | `m:nary`, with `m:chr`, `m:sub`, `m:sup` and **`m:e` holding the operand**   |
| `lim`, `max` and the like          | `m:func` whose name is an `m:limLow`, with **`m:e` holding the argument**    |
| Square root, root                  | `m:rad`, with `m:degHide` or `m:deg`                                         |
| Stretchy brackets                  | `m:d` with `m:begChr` and `m:endChr`                                         |
| Text                               | `m:r` with `m:nor`                                                           |

**The two bold rows are where Word and MathML disagree.** MathML sets a sum's operand beside the sum
(`∑ᵢ` then `xᵢ`); OMML puts it inside (`m:nary` contains `m:e`). The converter therefore takes the
element that follows a large operator or a limit into it - which the Typst side never needed, because
Typst, like MathML, sets them side by side.

A display equation is an `m:oMathPara`; an inline one an `m:oMath` inside the paragraph. A numbered
equation carries its number as a `SEQ` field, so that a `REF` to it updates like any other - set
beside the equation in a row of two cells, not at a right tab stop, which measured to break (WO-H,
below). Word's own equation-array numbering (`#` inside an `m:eqArr`) was tried beside it and also
worked in Word, but nothing can refer to its number, and LibreOffice - which the conformance harness
renders with - does not support it.

## Accessibility (PUB-035)

- Heading styles carry `w:outlineLvl`, so Word's navigation pane and screen readers see structure.
- Images carry their alternative text in `wp:docPr/@descr`; publishing already refuses an image
  without one (PUB-033).
- Table header rows carry `w:tblHeader`, which both repeats them across pages and marks them as
  headers.
- **Word has no header column.** A table whose header columns the PDF tags as row headers loses them
  in Word, so the publication's report names each such table (TAB-049, decision T-G of
  [publishing.md](publishing.md#tables)), and the author is told rather than finding out from a reader.
- Every run carries `w:lang` where its language differs from the document's, and the document's
  language is set in `settings.xml` and the styles (PUB-034) - the thing WeasyPrint failed at in the
  engine spike, which the Word writer must not repeat.
- Native equations are read by Word's own maths accessibility; they need no image and no alternative
  text of ours.

## Verification

- **Unit tests** read the writer's parts back and assert on structure and values, as the theme tests
  do - necessary, and never sufficient, because a reader we wrote agreeing with a writer we wrote
  proves only that they agree (the content model spike learned this at the cost of four defects).
- **Schema checks** against ECMA-376 in the conformance harness.
- **Rendering** through LibreOffice in the conformance harness, measured the way the theme prototype's
  Word output was - replaced by the Word check (WO-L, below), since Word itself is the renderer that
  matters and LibreOffice measured to differ from it.
- **Word itself** (PUB-029), before any change to the writer lands.

### The two mechanics ADR-0015 left unseen

ADR-0015 decided two things nobody had yet watched Word do. A probe document
([`spikes/word-probe/`](../../spikes/word-probe/)) put both in front of Word on 2026-09-11, and both
worked:

| Mechanic                                | What Word did                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields refreshed on opening (PUB-066)   | Asked once whether to update the document's fields; accepted, the contents, the list of figures and "Figure 1, on page N" were all correct                     |
| Equations from the maths tree (PUB-067) | Every equation correct: the sum, integral and limit holding their operands, the fraction, root and stretchy brackets, both inline and display, both numberings |

**LibreOffice differs, and that matters for the fallback.** Converting the same document, it
refreshed the `REF` and `PAGEREF` fields but not the contents or list of figures, set an integral's
limits above and below the sign rather than beside it, and did not number the equation array. So
ADR-0015's fallback - refreshing fields on the server with LibreOffice - would need the indexes
updated explicitly, not merely the document opened and saved, and the harness's LibreOffice
rendering is a check on structure, not on how an equation looks.

## Word output on publishing/13

Designed on 2026-09-25 against Word itself, as themes were against the pinned engine, to take this
design from the probe of 2026-09-11 to a publication. What exists: the published document that
`assemble` makes for template 13, whose every number and reference arrives as finished text; the
theme's Word projection, `projectStylesXml` and `wordRun` in `packages/domain/src/theme/`, which
project the prototype's ten properties and nothing else; the maths tree the PDF sets; `fflate` in
`packages/domain`; and storage, a contract and a job that know one output, a PDF. A request naming
`docx` is refused `format_unsupported`, and the layout refuses a `docx` member.

### What Word does with a writer's parts, measured

Each probe was a document built by hand from its parts, opened in Word 16 (the one installed here,
English UI) through COM, read back - positions on the page, fields as opened and after updating,
list strings, fonts, languages - and exported by Word to PDF, which was read and looked at. Liberation
Serif, Liberation Mono and STIX Two Math are not installed on the machine, so it stands where a
recipient's does. The probes and every number are in
[`spikes/word-measure/`](../../spikes/word-measure/). One limit of the method: a file Word silently
repairs opens as if nothing were wrong, so "opens" below means it opened without an error and laid
out as measured.

| Case                                                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space between paragraphs**: A with 12.65pt after, B with 16.5pt before (the default theme's quotation spaces)                                                                        | Word sets **the larger, 16.5**, in compatibility modes 12 and 15 alike - not the sum STY-050 asks for. With `w:doNotUseHTMLParagraphAutoSpacing` in `w:compat` the two **add**: 29.10 for 29.15                                                                                                                                                                                                                                                                  |
| **Contextual spacing**, two paragraphs of one style asking for it, with and without that flag                                                                                          | With the flag, each paragraph drops only its own space on the side facing a same-style neighbour. **Two quotations in a row** are then two runs of same-style paragraphs, and Word closes the gap between them to nothing; `contextualSpacing` off with `before` 0 on the last paragraph of the first and off with `after` 0 on the first of the second gives every one of the PDF's gaps within 0.2pt, the quotations' own paragraphs still contextually spaced |
| **Heading styles** with `w:styleId="heading-1"` and `w:name="Heading 1"`                                                                                                               | Word takes them as its built-in Heading 1, whatever the identifier and whatever the name's case, with the outline level implied; a style named otherwise is not, and needs `w:outlineLvl`                                                                                                                                                                                                                                                                        |
| **Heading numbers**: one list linked from the heading styles, and direct `w:numPr` to a lower-roman list in front matter and an upper-letter one in appendices                         | i, ii, 1, 1.1, 1.2, 2, 2.1, A, A.1, A.2, B - the default scheme's numbers; a `TOC \o` field lists them with their numbers                                                                                                                                                                                                                                                                                                                                        |
| **Captions as fields**: `Figure {STYLEREF 1 \s}.{SEQ Figure \s 1}`, prefilled wrong                                                                                                    | Until updated, **exactly what was prefilled**; updated, Figure i.1, 1.1, 1.2, 1.3, 2.1, A.1, A.2 - restarting at every level-1 heading, its number in its matter's format                                                                                                                                                                                                                                                                                        |
| **References**: `REF` and `PAGEREF` to hidden `_Ref` bookmarks, prefilled wrong                                                                                                        | Prefill shown until updated; updated, the label, a heading's number (`\r`) or its text, and the page. `\p` gives **"above" or "below" by document order**, even pages away, **in the language of the field's run** (a German run gave "oben", "unten")                                                                                                                                                                                                           |
| **Bookmark names** of 45 characters, and with hyphens                                                                                                                                  | Word refuses neither: the long one is **cut to 40 in silence**, the hyphenated one kept. The product's anchors are 29 characters and more, hyphenated                                                                                                                                                                                                                                                                                                            |
| **Footnotes**, three in text and one in a table's cell, in two sections                                                                                                                | Numbered by Word in order, the cell's among them; restarted per section by `w:numRestart`; a note with `w:customMarkFollows` shows its own mark and takes no number                                                                                                                                                                                                                                                                                              |
| **A table style** with rules, padding, a filled bold header row, a filled first column and banding, and a header row marked `w:tblHeader` on a table crossing two pages                | Every condition reads back through COM and shows in the PDF; the header row **repeats and is marked a heading row**, by the one element. `band1Horz` bands body rows 1, 3, 5; **`band2Horz` with `w:tblStyleRowBandSize` 1 bands 2, 4, 6**, as the PDF does, and with no band size it bands nothing. `w:tblCaption` reads back as the table's title                                                                                                              |
| **A row that may not split** (`w:cantSplit`) and is taller than a page                                                                                                                 | Pushed to a new page, **split anyway**, and that page carries no repeated header                                                                                                                                                                                                                                                                                                                                                                                 |
| **Images**: inline with a description, one flagged decorative, one floated `wrapTopAndBottom` aligned top and one bottom, `relativeFrom="margin"`                                      | The description and the decorative flag both read back; the float goes to the **head or foot of the text area of its anchor's page**, as a band, pushing the text below it down                                                                                                                                                                                                                                                                                  |
| **Page furniture**: a cover section, then front, body and appendix sections; "Not approved" in every header; a running head of `STYLEREF "Heading 1"`; a foot of `PAGE` and `NUMPAGES` | With the cover in a section of its own and no numbering, the front matter prints i, ii, the body 1, 2 and the appendix continues the body; the head names the first level-1 heading on the page or else the last before it; `NUMPAGES` counts every page, as the PDF's `pages` does. **A heading's space before is kept at the top of a page a section break began**, where the PDF drops it                                                                     |
| **Contents and a list of figures** as `TOC` fields, prefilled with entries but no pages                                                                                                | Updated, both are rebuilt completely - entries, numbers and pages - whatever was prefilled                                                                                                                                                                                                                                                                                                                                                                       |
| **Fonts**: Liberation Serif embedded as an obfuscated font part; STIX Two Math the same                                                                                                | Liberation Serif is used and carried into Word's own PDF. **STIX Two Math cannot be**: its outlines are CFF (`OTTO`), which Word does not embed - embedded, Word sets the equations in Calibri, and without it in Cambria Math. Without embedding, Liberation Serif becomes Times New Roman                                                                                                                                                                      |
| **Equations**: every construct the maths tree has, inline and displayed, as OMML                                                                                                       | All 49 open and set correctly in Cambria Math - scripts, prescripts, sums and integrals holding their operands, `lim`, fractions with and without bars, binomials, roots, accents, bars, a labelled brace, fences with an empty side and a middle bar, a matrix, an aligned equation, a phantom, primes, spaces, every identifier variant. **Cases need `&` alignment points** or their rows centre                                                              |
| **A numbered displayed equation**, number at a right tab, then too wide                                                                                                                | Short, right; too wide, it wraps as text and the number lands mid-line. In a **borderless row of two cells** - the equation, then the number right-aligned in a fixed cell - a too-wide equation breaks at its operators within its cell and the number stays at the right, and a `REF` to it updates. Word's own `#` numbering in an equation array breaks outright                                                                                             |
| **Language and direction**: an `en-GB` document with a `de-DE` run and a Hebrew paragraph                                                                                              | Each run's language reads back; the Hebrew paragraph is set right to left. **Right-to-left text takes its size from `w:szCs` and is 10pt without it**                                                                                                                                                                                                                                                                                                            |
| **A background with padding**: `w:shd` and borders in the fill's colour spaced by the padding                                                                                          | The fill is padded on every side, but **outside the text column** unless indents of the padding pull it back; consecutive paragraphs of the style join into one panel, as the PDF's preformatted block is one                                                                                                                                                                                                                                                    |

**Four corrections to this design follow.** The spaces between paragraphs need a compatibility flag,
or every gap in every Word publication is the larger space rather than the sum. The equations cannot be
set in the PDF's maths face, so a Word publication declares a maths face of its own and says so
(STY-052). A numbered equation's number cannot stand at a right tab as the section above says, because
a long equation throws it into the line. And the anchors the PDF uses cannot be Word's bookmark names.

### How a publication reaches Word

**One `assemble`, told what it is for.** A request names its formats, and `assemble` learns them. Its
refusals that are the engine's own - a line or a caption too wide for the PDF's measure, an image too
wide for it, a reference into a table's header rows, a header row spanning the body - apply where a
PDF is asked for and not otherwise; the rest apply to both, the glyph check among them, because the
faces Word embeds are the same files. A request for both fails if either would. The published document
becomes `publishing/14`: what it holds for the PDF - the page and the theme's Typst projection - stays,
and what the Word writer needs beside it - the layout's Word page, and the theme resolved - is carried
beside it rather than in it, as the numbering table already is.

**Word computes every number, and the writer fills in what it will compute.** A heading's number is
the numbering definition linked from its style, a caption's is `STYLEREF` and `SEQ`, a footnote's is
Word's own, a reference is a `REF` or `PAGEREF` field, and the contents and the lists are `TOC`
fields, as PUB-024, PUB-025, PUB-026 and PUB-066 ask. Every field is **prefilled with what the PDF
prints**, from the numbering table and the resolved references, so a recipient who never lets Word
update sees the right numbers everywhere but on page references, and one who does sees the same
numbers Word computed for itself. Page references and the contents' pages are the only thing left
empty: copying the PDF's would be wrong the moment Word reflows (PUB-066), and `w:updateFields` asks
Word to fill them as the document opens.

**Where the scheme says something Word cannot compute, the Word publication is refused by name.** A
layout's scheme can number what Word's fields cannot: a footnote number with a chapter's prefix, a
restart Word has no switch for. The writer knows the difference and refuses `numbering_not_in_word`,
naming the sequence and its rule, rather than printing a number Word would replace with another. The
default scheme is inside what Word computes; a layout author meets the refusal only by asking for more.

**Bookmarks are named Word's way.** Each target the document references gets a hidden bookmark,
`_Ref` and nine digits in document order - deterministic, so the same document makes the same file -
and the writer holds the map from the product's anchors to those names. A reference in a paragraph's
text is a field with `\h`, so it is a link, as in the PDF; one in a caption, a title, a term, an
attribution, a header row or a table's note is the same field without it (XR-D).

**Spacing is the theme's, and it adds.** Every Word publication sets compatibility mode 15 and
`w:doNotUseHTMLParagraphAutoSpacing`, so a paragraph's space after and the next one's space before add,
as STY-050 says and the PDF does. Contextual spacing is the style's; where two same-style paragraphs
stand in different containers - two quotations in a row, two footnotes, a caption and a cell - the
writer turns it off on the pair and drops the facing spaces the PDF drops, as measured. The first
paragraph of a section that starts a page sets no space before, since Word keeps it there and the PDF
does not. Every size is written as `w:szCs` beside `w:sz`.

**Styles are the theme's, all of them, every property.** `projectStylesXml` grows from the prototype's
ten properties to all of them: alignment, the three indents, background and padding (the fill, borders
of its colour spaced by the padding, and indents that keep it in the column), keep-together, widow and
orphan control, hyphenation and contextual spacing; each mark's underline, colour, face, position and
scale; a document default carrying the language; a table style per table style; and the outline
levels, which the heading styles' names already give (a theme's "Heading 1" is Word's). `wordRun`
names the character style of the first mark that carries appearance - not `language` or `hyperlink`,
which lead the published order - and pins what Word's toggling would lose.

**Faces are embedded where Word can embed them.** A face whose licence permits Word embedding and whose
outlines are TrueType is embedded, obfuscated as the standard says, so the recipient sees Liberation
Serif and not Times New Roman. STIX Two Math cannot be: the default theme declares **Cambria Math** as
its Word face (STY-052), which Word and Office carry, and a Word publication's report says its
equations were set in it. The theme's reader refuses a face that Word cannot embed and that declares
no Word face, which STY-052's "must declare" asks and nothing enforces today.

**Tables, figures and lists as Word has them.** A table is a Word table in its table style - rules,
padding, header fills and weight, banding by `band2Horz` - its header rows marked, its caption a
paragraph above it in the caption role with the label as fields, and the same words as the table's
title (TAB-039); its note a paragraph after it. A figure is its image in a paragraph of its own,
aligned, its description in `descr` or flagged decorative, its caption below; a floated one is anchored
to the head of its page's text area, a band as in the PDF. A list is a numbering definition of its own,
its start and format, bullets by level as the PDF's; a definition list is its terms and its
definitions as paragraphs, indented, because Word has no definition list. Image sizes are resolved
against the Word page, as the PDF's are against its own.

**What Word cannot carry is said, not dropped in silence.** Word marks header rows only by repeating
them, has no header column, no continuation label, and no language on an image's description. So a
table whose style does not repeat its header repeats it in Word anyway - a marked header is the
accessible one - and the publication's report says so, as it says which tables lost their header
column (TAB-049), which labels were left out, and which faces Word substituted.

**The page is the layout's Word page.** Layout schema 5 adds a `docx` member: the page, its
orientation and margins, the running heads and feet, and each matter's page numbering - the PDF's,
copied, in the default layout's next version, and free to differ (PUB-012). The cover is a section of
its own, unnumbered; front matter, body and appendices are sections, as the PDF's matters start pages;
the contents and each list stand on pages of their own; "Not approved" heads every page, the cover's
included; the running slots are a paragraph with a centre and a right tab stop, their fields `PAGE`,
`NUMPAGES` and `STYLEREF` by the level-1 heading style's name.

**A publication holds one output per format, each saying what made it.** The store widens from one PDF
to one output per requested format; each output records what produced it (Typst with template 13, or
the Word writer and its version) and carries its own report; a request without `pdf` is refused
where a reference cites a page, and otherwise its report says it carries no page-cited output
(PUB-065, PUB-074). One job makes every requested output from one `assemble`, and records all or none.
The documents page asks which formats to publish, and a publication offers each output to download.

### Decisions for Ken

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Recommended                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WO-A | **One `assemble`, told its formats**: the engine's own refusals only where a PDF is asked for; `publishing/14`, with the Word page and the resolved theme carried beside the document                                                                                                                                                                                                                                                                                                                   | Yes. A Word-only request refused for a caption too wide for the PDF would be refused for nothing, and a second assembly for Word would be a second resolution of the same document - two answers to one question                                                                            |
| WO-B | **Numbers are Word's fields, prefilled with the PDF's values**, and a scheme Word cannot compute refuses the Word publication by name. Or: numbers as text, as the PDF has them - simpler, and a recipient's first edit leaves every later number wrong                                                                                                                                                                                                                                                 | Fields. PUB-024 to PUB-026 ask for exactly this, and measured, every field reads right as opened and stays right when updated. The default scheme is wholly inside what Word computes                                                                                                       |
| WO-C | **A relative reference is `REF \p`**, which prints "above" or "below" in the passage's language by Word's own words, where the PDF prints the layout's. Or: the layout's word as plain text, which never updates                                                                                                                                                                                                                                                                                        | `REF \p`. The layout's default words are Word's, so the two agree as published; a layout choosing other words ("earlier", "later") gets Word's in Word, and the design says so                                                                                                              |
| WO-D | **Spacing adds in Word** by the compatibility flag, with contextual spacing turned off across containers and the space before dropped at a section's first page                                                                                                                                                                                                                                                                                                                                         | Yes. Without it every gap in every Word publication is wrong by the smaller space, measured - the quotation pair by 12.65pt                                                                                                                                                                 |
| WO-E | **Faces**: embed each TrueType face the licence permits; the default theme's maths face declares **Cambria Math** for Word, in a theme version 0.3; the reader refuses a face Word cannot embed that declares none; the report names every substitution                                                                                                                                                                                                                                                 | Yes. The embedded face is measured to reach the recipient; STIX cannot, and a maths face that silently becomes Calibri is the failure STY-052 exists to prevent. Embedding adds about 1.5 MB for a document in the serif and one mono face, 2.7 MB for all eight files, before compression  |
| WO-F | **Tables**: the table style as a Word table style with `band2Horz`; header rows always marked, so always repeated; rows kept whole by `cantSplit`; no continuation label; the report names each table that lost its header column, its unrepeated header or its label                                                                                                                                                                                                                                   | Yes. Word ties marking a header to repeating it, and the accessible choice wins. A row taller than a page splits in Word regardless and loses its header on that page - Word's own behaviour, measured, recorded rather than worked around                                                  |
| WO-G | **Floated figures go to the head of the page's text area**. The PDF puts one at the head or the foot, whichever is nearer; Word needs one fixed                                                                                                                                                                                                                                                                                                                                                         | Head. It is where a reader looks, and the only way to choose "nearer" in Word is to lay out the page, which the writer does not do                                                                                                                                                          |
| WO-H | **A numbered displayed equation is a borderless row of two cells**, the equation and its number. Or: the number on the equation's line at a right tab, which breaks when the equation is too wide; or always on its own line below                                                                                                                                                                                                                                                                      | The two cells. Measured, it is the only form that keeps the number at the right when Word breaks the equation, and a reference to it updates. A screen reader meets a one-row table; the equation keeps Word's own maths reading                                                            |
| WO-I | **Lists up to nine levels** in Word, which has nine; a deeper one refuses the Word publication by name (the model admits any depth, T1 asks for six)                                                                                                                                                                                                                                                                                                                                                    | Yes. A tenth level would flatten silently otherwise                                                                                                                                                                                                                                         |
| WO-J | **Layout schema 5 with a `docx` member**, the default layout's next version copying the PDF's page; the cover a section of its own; each matter a section                                                                                                                                                                                                                                                                                                                                               | Yes. PUB-012 asks for it, image sizes need a page to resolve against, and the cover measured to need its own section for the front matter to start at i                                                                                                                                     |
| WO-K | **Storage**: one output per requested format, each with its producer and its report; both formats from one job, all or none; the report also carries STY-052's substitutions and PUB-065's statement                                                                                                                                                                                                                                                                                                    | Yes. The report has nowhere to live today, and four requirements need it                                                                                                                                                                                                                    |
| WO-L | **Verification (PUB-029)**: the writer's unit tests read its parts back, and a **Word check** in the repository - this design's harness, grown - opens every fixture in Word, updates its fields, and checks the numbers against the numbering table, the faces embedded, and that a save changes nothing; it runs on Windows with Word before every change to the writer lands, its result in the pull request. **Schema validation in CI** needs the ECMA-376 schemas or the Open XML SDK, a download | Word check: yes - CI runs Linux and has no Word, so the standing practice is local, recorded, and cannot be skipped by a green build. Schema validation: yes if you agree to pinning the Open XML SDK's validator in CI, which also knows Word's extensions; otherwise the Word check alone |
| WO-M | **Four build slices.** Word 1: the plumbing (WO-A, WO-J, WO-K), the styles, paragraphs, headings, marks, links, languages, faces and the page. Word 2: lists, quotations, preformatted text, tables and figures, with the report. Word 3: footnotes, captions, cross-references and the contents and lists. Word 4: equations                                                                                                                                                                           | Yes. Word 1 is the largest and publishes a real, if plain, document; each later slice adds what a reader sees                                                                                                                                                                               |

**What Word 1 to Word 4 claim and cite.** Word 1: PUB-023 once the rest have landed rather than
first, PUB-027 (themes.md), PUB-034's and CNT-084's Word halves, CNT-128's, PUB-092's, PUB-012, PUB-065
and PUB-074, STY-052's report. Word 2: TAB-039's and TAB-049's Word halves, PUB-035. Word 3: PUB-024,
PUB-025, PUB-026, PUB-066. Word 4: PUB-067 and CNT-045. PUB-029 by the Word check, from Word 1. STY-053's
Word half needs its measurements automated where Word runs; the Word check is where they will live, and
the claim waits for them.

## Open questions

| ID  | Question                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New | Whether recipients accept Word's field-update prompt. The prompt works; whether a client's reader trusts it is a question for real recipients. If not, ADR-0015 names the fallback   |
| New | Whether the output includes review - suggestions and comments - by default, or only when the publisher asks. PUB-028 is T6, and a client copy with internal comments in it is a leak |
