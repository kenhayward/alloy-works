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
| **PUB-026** | A cross-reference is a `REF`, `NOTEREF` or `PAGEREF` field at a bookmark on its target, prefilled with what the PDF prints          |
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

**Ken agreed every recommendation on 2026-09-25**, and gave permission to download the Open XML SDK
for validating in CI (WO-L).

**What building Word 2 found, 2026-09-25.** The table above is the record of what was decided, and
stands as it was agreed; three of its lines are no longer what was built, and
[What was built](#what-was-built) says why at length:

- **WO-F's banding is `band1Horz`, not `band2Horz`.** Template 13 fills the first body row and every
  other one after it (`calc.even(row - headerRows)`, which `table-and-image-styles.test.ts` asserts).
  M14 measured `band2Horz` filling the second, fourth and sixth body rows, which is right, and read that
  as the template's banding, which it is not; `band1Horz` counts from the first row after the header
  rows and fills exactly the PDF's rows. The writer writes `band1Horz` with `w:tblStyleRowBandSize 1`,
  and the Word check holds every banded cell to the fill the PDF paints behind the same words. The
  measured table's row for a table style ("as the PDF does") and "Tables, figures and lists as Word has
  them" above carry the same misreading.
- **WO-G's floated figure is a frame, not an anchor.** The head of the page's text area holds; the way
  there changed. An anchor put the image at the head of its page and left its caption in the text
  where the figure stood, 226pt below it in the measuring document, where the PDF sets the two as one
  band; one `w:framePr` shared by the image's paragraph and the caption's keeps them together, within
  0.06pt of the PDF's band.
- **...and then a text box, not a frame (Word 2's final review, I1).** Two floats on one page were two
  frames at one place, image on image and caption on caption: Word does not move a frame off another.
  Five forms were measured in Word 16 on the review's document, a square and a one by three floated a
  paragraph apart, both falling on page 6. **The frame**: both images at y 72, both captions at 293.33
  on one line. **A frame placed from its paragraph** (`w:vAnchor="text"`, `w:y="0"`): apart, the first
  at 72 only because its paragraph opened the page, the second in the flow at 326.10, and the text
  between them set below the second. **The second frame at the foot** (`w:yAlign="bottom"`): apart,
  546.00 and its caption 757.20, but a third float on the page would stand on the first again. **The
  second a block figure**: in the flow at 326.10, the head of the page for the first alone, and a
  report entry wanted to say so. **A text box holding image and caption**, `wp:anchor` with
  `allowOverlap="0"` and `wrapTopAndBottom`, at the head of the text area: Word stood the second box
  below the first on the same page, its image 15.52 below the first caption's baseline, the text after
  both 27.60 below the second caption as it stood after the frame, each caption with its image, and
  each image's description and decorative flag read through COM inside its box; with
  `allowOverlap="1"` the two stood on each other again. **The text box is taken.** Its costs, each
  measured: Word lists a caption in a text box with no page where the list links its entries
  (`\h`), and with its page where it does not, so a list with a floated figure in it is written
  without links; the box is anchored in an empty paragraph of its own a tenth of a point high, since
  one a point high moved the text below it 0.96; Word fits the box to what it holds
  (`spAutoFit`, a box written 20pt high came up 223.70), so its written height is only a start; and
  the fields in a box number in the order of their anchors, prefilled wrong and updated. The PDF set
  the second float at the foot of the page in both documents measured, where it had room; Word has no
  choice of head or foot (WO-G) and stacks it at the head.
- **WO-M's second and third slices moved.** Captions as fields came into Word 2 (its ruling R1), since
  tables and figures arrive there and M3 had measured the fields; so did the lists of figures and of
  tables after the contents, since the default layout lists both and without them no document holding
  a figure or a table could reach Word under it. Word 3 is footnotes, cross-references and their
  bookmarks; Word 4 is equations and the list of equations.

**What building Word 3 found, 2026-09-26.** WO-B and WO-C stand as agreed, and
[What was built](#what-was-built) says where Word 3 departed from its plan. Two things here read
differently now. A scheme is not the only thing Word may compute otherwise than the PDF prints: three
kinds of reference - above or below across a story's boundary (a footnote's, or a floated figure's
text box), a caption's words named inside it, and a caption's words holding a reference that is not
a number - are Word's fields printing other words, and are refused by name as
`cross_reference_not_in_word`, two of them open for Ken. And WO-C's Word words are the passage's
language's only where the Word opening the document has words for it: in a Hebrew passage the one
Word 16 measured, with an English interface, printed the English ones.

**What Word 1 to Word 4 claim and cite.** Word 1: PUB-023 once the rest have landed rather than
first, PUB-027 (themes.md), PUB-034's and CNT-084's Word halves, CNT-128's, PUB-092's, PUB-012, PUB-065
and PUB-074, STY-052's report. Word 2: TAB-039's and TAB-049's Word halves, PUB-035. Word 3: PUB-024,
PUB-025, PUB-026, PUB-066. Word 4: PUB-067 and CNT-045. PUB-029 by the Word check, from Word 1. STY-053's
Word half needs its measurements automated where Word runs; the Word check is where they will live, and
the claim waits for them.

### What was built

**Word 1 is built**, by [Word 1](../plans/2026-09-25-word-01-a-publication-in-word.md): WO-A, WO-J,
WO-K and WO-L, and the styles, paragraphs, headings, marks, links, languages, faces and page of WO-M's
first slice. A request may name `docx`, alone or beside `pdf`, where the layout has a Word page;
`assemble` is told the formats; the Word writer, `writeDocx` in `packages/domain/src/word/`, makes the
`.docx` - the theme's styles as Word styles, headings numbered by Word from the layout's scheme, the
cover, the contents as a `TOC` field, running heads and feet, **Not approved** on every page, marks,
links and languages, and the Liberation faces embedded - with a report of what Word could not carry;
and the publication holds one output per format, each with its producer and its report. Every `.docx`
a test makes is valid by the Open XML SDK, and the Word check opened the fixtures in Word 16. What it
does not write yet it refuses by name, below. Building it changed these things here:

- **There is no `publishing/14`.** Nothing the Typst template reads changed, so the published
  document, `PUBLISHING_SCHEMA_CURRENT`, template 13 and `PIPELINE_VERSION` stay; what the writer
  needs beside the document - the layout's `docx` member, the resolved theme, the numbering scheme and
  image sizes against the Word page (none yet) - is `assemble`'s `word: WordInput`, returned exactly
  where `docx` is asked for, as the numbering table is returned beside it. A schema whose PDF half is
  byte for byte 13's would have bought a template copy and nothing else. The PDF made beside a Word
  output is byte for byte the PDF made alone, which the job's test compiles to show.
- **`assemble` is told its formats**, required, at least one. The PDF engine's own refusals -
  `line_too_wide`, `caption_too_long`, `image_too_wide`, `table_header_spans_body`, a footnote or a
  reference target in a table's header rows, `continuation_words_missing`, and every
  `equation_unrenderable` reason but `unreadable`, `merror` and `empty`, which are wrong whatever sets
  them - are said only where `pdf` is asked for; a failure is the PDF's only where its every cause is.
  `typeface_not_embeddable` is judged per format: for the PDF by `embedding.pdf`, for Word only where a
  face may not be embedded and declares no Word face. A request that reaches `assemble` asking for Word
  under a layout with no Word page fails `format_unsupported`, a new compose failure, though the door
  refuses it first (PUB-014).
- **What Word 1 does not write is refused by name**, `word_not_yet`, naming where the construct stands
  and what it is: a list, a quotation, preformatted text, a table, a figure and a block equation, an
  image, an equation, a footnote and a cross-reference in a line or a section's title, and each list
  after the contents. Refused at the stored construct, before its PDF checks; a PDF-only request is
  unchanged. **The trap each later slice inherits**: a PDF engine refusal also drops its construct from
  the published document - a figure whose caption is too long, an image too wide, a reference into a
  header row - and filtering the refusal out for a Word-only request is safe today only because
  `word_not_yet` refuses the same construct. When Word 2 takes figures, images and tables off the list,
  those refusals must stop dropping the construct for Word, or a Word-only publication loses it in
  silence. The comment on `pdfsOwn` in `assemble.ts` says so.
- **A scheme Word cannot compute fails `numbering_not_in_word`**, `detail` `section:<matter>:<why>`: a
  separator holding `%`, letters past _z_ (Word doubles them, _aa_, _bb_, where the scheme counts on,
  from the 28th), a roman numeral past 3999, and a heading numbered past a ninth level. Only the
  section sequence is checked, since captions, equations and footnotes do not reach Word yet. The
  default scheme passes.
- **Two migrations, not one.** 0026 seeds the default theme's 0.3 alone - 0.2 with STIX Two Math
  declaring `embedding.word: false` and **Cambria Math** as its `wordFamily` - where the theme is still
  0025's 0.2. 0027 seeds the default layout's 0.6, at **layout schema 5**, 0.5 with a `docx` member
  copying the PDF's page, where the layout is still 0025's 0.5, and widens the store: `formats` any of
  `{pdf}`, `{docx}` and `{pdf, docx}`, spelled PDF first; `engine` and `template` null exactly where
  there is no PDF; `publication_output` taking `docx`, with `producer` (`typst` or `word`),
  `producer_version` (the template's version, or `word/1`), and `report`, empty for a PDF, backfilled
  for every existing output; and the whole-record trigger holding one output per format. `docx` is
  optional in schema 5, so a layout without it still refuses Word, and a Word page is at most 22 inches
  (1584pt) each way, Word's own limit, where a PDF page may be 200 inches.
- **The theme's reader refuses a face Word may not embed that names no Word face**,
  `typeface_word_face_missing`. `embedding.word` now means that a Word document can carry the face,
  which STIX Two Math's licence allows and its CFF outlines do not.
- **The projection writes every property, and Word showed three things the design did not say.**
  Every style states `w:outlineLvl` - its depth for a heading's, 9 for the rest - because the default's
  Title and Contents heading are based on heading 1, and Word listed them in its contents without it;
  and `numId 0` for the same reason, or they would take heading 1's number. A style whose catalogue
  name is _heading N_ and which is not that heading is written `<name> (<id>)`, since Word takes such a
  name as its built-in heading whatever the identifier. And a panel's indents are its padding and 2pt
  more, measured, since Word's fill reaches about 2pt past its border's spacing: so a preformatted
  panel's measure is 4pt narrower in Word than in the PDF. Word's sizes are half points, so 8.8pt
  preformatted text is 9pt in Word and a 9.35pt footnote 9.5pt; together a preformatted line that just
  fits the PDF's measure can wrap in Word, which Word 2's check should include. `w:bCs` and `w:iCs`
  stand beside `w:b` and `w:i` by the reading M15 measured for `w:szCs`, not measured themselves. A
  character style states no size: a mark's `scale` reaches Word as each run's size. `wordRun` names the
  first mark whose character style states anything, which under the default skips the link, the
  language and the quoted phrase.
- **Headings and the page, as built.** A heading's number is followed by a space, not M2's tab, with
  no indent of its own, as the PDF prints it; three numbering definitions, the body's linked from the
  heading styles and front matter's and appendices' given by direct `w:numPr`. The contents stands in
  a section of its own, so its running head can leave out the section, which before any level-1 heading
  Word would print as an error. The section is the heading's number, a space and its title: `IF
"{STYLEREF "Heading 1" \n}" = "0" "" "{STYLEREF "Heading 1" \n} "` and `STYLEREF "Heading 1"`. Word's
  number for a heading with none is 0, which the PDF does not print, so the `IF` prints neither it nor
  its space; a section's number is never 0 (the final review, I1). In a right-to-left document the
  number and its space are a right-to-left embedding, U+202B to U+202C, inside the `IF` (M1). **A
  heading is written in the style Word names for its depth** (I2): Word takes a style named _heading
  N_ as its built-in Heading N and **ignores a paragraph's own `w:outlineLvl` there**, so a heading at
  depth 7 in Heading 6 with an outline level of its own was a Heading 6 to Word. Each depth to the
  ninth has one: the heading role's style where the projection names it Heading N at that depth, and
  otherwise one of the writer's own, `Heading7` named _heading 7_ and so on - at the seventh to ninth
  depths, and at a depth whose role shares a shallower role's style - based on the role's style, and
  stating only its place on the body's list, which the list links back to, and the outline level its
  name gives. A recipient who sets a paragraph in Heading 7 gets a seventh-level number, measured. **A
  later appendix starts its page by `w:pageBreakBefore` on its heading** (M2), where Word drops the
  heading's space before as the PDF does; a break in a paragraph of its own took a line after the
  appendix before, which where that appendix filled its last page flowed on and left a page blank. A
  header and a footer stand half their margin from the edge, since the layout says nothing. A matter
  entered a second time continues the page numbers before it, since Word cannot resume a chain; the
  PDF resumes.
- **M1 d8 is not written, and is Word 2's.** No two same-style paragraphs of different containers face
  each other in Word 1: each component's paragraphs follow its own heading, and template 13 sets the
  top level as one flow, which Word's own contextual spacing already matches. Writing d8 there would
  contradict the PDF. It belongs to the containers Word 2 brings - quotations, list items and cells.
- **Faces are embedded as used.** Each Word family is named once in the font table; the files the
  text is set in are embedded, obfuscated by a key taken from the file's hash, so the bytes are the
  same every time. A face with a Word face is named by it, not embedded, and reported,
  `face_substituted` - **but only for a face the text is set in**, so the default theme's maths face,
  which `m:mathFont` names as Cambria Math, reports nothing until Word 4 sets an equation.
- **The report** holds `face_substituted`, `no_page_cited_output` where no PDF stands beside the Word
  output, and `pages_cite_the_pdf` on every Word output, each a closed shape checked on the way into
  and out of the store; the publication's page says each in a sentence.
- **Verification is two tools.** The Open XML SDK's validator (3.5.1, Office 2019 rules) runs in a
  .NET 8 image built from digest-pinned images and a NuGet lock file, tagged by its sources' hash and
  built by `fetch-ooxml-check`, in CI beside veraPDF; every worker test that makes a `.docx` asserts it
  finds nothing. The Word check is a worker test, `src/word-check.test.ts`, skipped unless it runs on
  Windows with `ALLOY_WORD_CHECK=1`, driving `scripts/word-check.ps1` through COM over seven fixtures:
  the full document, opening with a front-matter section with no number, one without a cover, one
  without a contents, one for Word alone, a right-to-left one, one with headings to the ninth level
  under a contents of depth six, and one whose first appendix fills its page to the foot. It checks
  ten things: each opens without an error; the headings' list strings are the numbering
  table's, each in Word's heading style for its depth; the updated contents lists every heading to the
  layout's depth with its number and page and keeps its section; **Not approved** heads every page;
  each running head, a heading with no number named by its title alone and a right-to-left one read in
  its own direction; no page left blank; each page label and foot; the Liberation faces embedded and
  every visible character set in them; and a save changes no paragraph.
  [`docs/testing.md`](../testing.md#the-word-check) says how it is run.
- **What Word showed that the design did not foresee.** In a right-to-left document the foot read
  "0.7Revision": the revision carried `w:rtl`, which forces digits right to left where Typst's bidi
  places them by their characters; it is now written in no direction, as the page number is, and reads
  as the PDF's does. In a right-to-left heading, **a number of digits alone is drawn in Times New Roman
  Bold** where Liberation Serif is embedded; seven variants of the markup changed nothing and COM
  reports Liberation Serif throughout, so it is Word's, the metrics are the same and nothing moves, and
  the check pins it exactly so a change either way shows. And **Word hidden, with its alerts off,
  updated the contents and fields on opening by itself**, taking the prompt's default: the prefilled
  contents, which a reader who declines the prompt would see, was never seen. Word rebuilds an entry
  as number, space, title, tab and page, and the writer now prefills number, space, title (the final
  review, M3), where it first put a tab, which the contents styles give no stop; the field's end
  moves to an empty paragraph after the last entry, which now carries the section break. Saving adds
  Word's own theme, `Normal`, `Hyperlink` and Aptos beside the Liberation faces, and renames style
  identifiers, keeping every paragraph's text, style and number.
- **What the final review found in Word, and the fixes measured there.** `STYLEREF "Heading 1" \n`
  answers 0 for a heading with no number, so a Foreword's pages were headed "0 Foreword" (I1). A
  heading past the sixth level took Heading 6's outline level whatever the paragraph stated, so a
  contents of depth six listed depths seven and eight in Word and not in the PDF (I2). A right-to-left
  running head set its number after the title in reading order (M1): `w:rtl` on the fields' runs
  placed it, but Word then drew the number and the title in Times New Roman, not the embedded face; a
  right-to-left mark before the number placed digits and not an appendix's letter; the embedding
  places both, to the PDF's point, in the embedded face. And an appendix ending at a page's foot was
  followed by a blank page (M2). The Word check holds a fixture for each, and each of its new
  assertions failed against the writer before the fixes.

**What each claim now stands on.** The chain for each requirement Word 1 touched, as `pnpm trace show`
reports it:

| ID          | Claimed by    | Cited                                                                                                                                                                                                                                                                       |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PUB-012** | publishing.md | `layout.test.ts`: a Word page apart from its PDF page, each read back as its own                                                                                                                                                                                            |
| **PUB-024** | this document | `word/write.test.ts`: three numbering definitions, headings referring to them by style or `w:numPr`, no number in a heading's text. **Moved from Word 3 to Word 1**, since a heading cannot be written without its number                                                   |
| **PUB-027** | themes.md     | `theme/ooxml.test.ts`, every style a Word style, every property stated; that runs name them rather than carrying direct formatting is the writer's use of `wordRun`, less a scaled mark's size and a second mark's face, which it pins on the run: themes.md names the cost |
| **PUB-034** | publishing.md | `word/write.test.ts`'s languages test, the document's, a component's and a mark's, beside the PDF's in `marks.test.ts`                                                                                                                                                      |
| **CNT-084** | publishing.md | The same test                                                                                                                                                                                                                                                               |
| **CNT-128** | this document | `word/write.test.ts`'s link test, beside the PDF's in `marks.test.ts`                                                                                                                                                                                                       |
| **STY-052** | themes.md     | `theme/ooxml.test.ts`, the Word face declared and used, and `word/write.test.ts`, the substitution reported                                                                                                                                                                 |
| **PUB-074** | publishing.md | `publish.test.ts`: a Word-only request of a document citing a page refused, and one citing none recording `no_page_cited_output`                                                                                                                                            |
| **PUB-029** | this document | `word-check.test.ts`, so Covered; **Verified only by a local run**, since CI skips it and a skipped test verifies nothing. The Word check carries no PUB-024 citation for the same reason: a skipped citation would demote a requirement shown elsewhere                    |

**Not cited, and why.** PUB-092: the Word styles carry `w:keepNext`, `w:keepLines` and
`w:widowControl`, but it asks for the regression corpus to show them holding, and nothing measures
Word's pagination. PUB-065: it asks Word to carry cross-references, which Word 1 refuses; every Word
output's `pages_cite_the_pdf` is its record half, for Word 3 to cite beside a carried reference.
PUB-066: the contents is a `TOC` field that Word refreshes, but the lists and page references are Word
3's. PUB-023 waits for Word 4, PUB-073 for T3's baselines, and STY-053 for the Word check to measure
style properties.

**Left for Word 2 to 4.** Word 2: lists, quotations, preformatted text, tables, figures and images
off `word_not_yet`, each with the trap above undone for it; M1 d8 in its containers; `WordInput.images`,
whose key is left for the first figure; the report's table entries (TAB-049's header columns,
unrepeated headers and omitted labels); TAB-039's and TAB-049's Word halves, and PUB-035; and a
full-measure preformatted line in the Word check; and **a theme's background panel, which Word joins
across paragraphs the PDF keeps apart** (the final review, M4): Word sets one panel around consecutive
paragraphs of one style with the same borders, and around Heading 1 and Heading 2, which is based on
it, and around a header's notice and running line, both based on the body's style, where the PDF sets
a panel per paragraph and the notice's alone. Unreachable in Word 1, since the default theme fills
only preformatted text, but **Word 2's two consecutive preformatted blocks meet it with the default
theme**: the PDF sets two panels and Word will join them, unless `w:pBdr`'s `w:between` or a spacing
that differs decides it, to be measured. Word 3: footnotes, captions, cross-references and
the lists after the contents, with bookmarks named Word's way and `numbering_not_in_word` extended to
their sequences; PUB-025, PUB-026, PUB-065 and PUB-066. Word 4: equations, deciding which of the maths
tree's refusals Word sets, and reporting the maths face's substitution; PUB-067 and CNT-045, then
PUB-023. Open for any of them: how a reader who declines the prompt sees the contents; and a cover
running to a second page, and a matter entered twice, which the check has not looked at.
`typeface_not_embeddable` now names a Word document where Word refused the face, its `detail` the
family and `: docx` (the final review, M6).

**Word 2 is built**, by [Word 2](../plans/2026-09-25-word-02-lists-tables-and-figures.md): WO-F, WO-G
and WO-I, and what WO-M's second slice holds, with captions as fields and the lists of figures and of
tables after the contents brought forward from the third. Everything a document holds but footnotes,
cross-references and equations now reaches Word: lists of every kind nested to nine levels, definition
lists, quotations, preformatted text, tables in their table styles, figures, and images in a line of
text or a table's cell, each figure and table numbered by Word's own fields and listed after the
contents where the layout lists them. The writer is `word/2`. Building it changed these things here:

- **Off `word_not_yet`, and the trap undone.** A list, a quotation, preformatted text, a table, a
  figure and an image in a line are written; what stays refused by name is an equation, a footnote, a
  cross-reference and the list of equations. Word 1's trap is closed for what left the list:
  `caption_too_long` and `image_too_wide`, which dropped their figure and image from the published
  document, now keep them, still the PDF's refusals alone, so a Word-only publication carries a figure
  whose caption the PDF's measure refuses; `line_too_wide`, `table_header_spans_body` and
  `continuation_words_missing` never dropped anything. Three refusals still drop their construct, each
  still `word_not_yet` for Word: a footnote in a header row, a reference to a header-row target, and an
  equation the maths tree refuses. **The comment on `pdfsOwn` says so, for Word 3 and 4.**
- **Captions are Word's fields** (R1):
  `{word} {STYLEREF n \s}{separator}{SEQ Figure \* <format> \s n}` where the layout's rule prefixes the number of the chapter at depth `n`, `SEQ` alone where it
  does not, no field where the scheme gives the caption no number, one `SEQ` name per sequence
  across every matter, each prefilled with the numbering table's label. `captionField` in
  `word/numbering.ts` is the one shape the writer writes and the refusal reads.
  **`numbering_not_in_word` follows Word's fields through the document as Word reads it** - every
  node a heading at its depth to the ninth, numbered or not, `STYLEREF` the last heading at its
  level, `SEQ \s n` counting again after any heading at `n` or above - and refuses a figure's or a
  table's number Word would print otherwise, `detail` `figure:<matter>:<why>` or
  `table:<matter>:<why>`: a prefix Word finds elsewhere or not at all (after an unnumbered chapter,
  Word printed 0.1), a restart past the ninth level or one Word counts differently, a separator Word
  cannot hold, letters from the 28th (Word _bb_, the PDF _ab_) and roman past 3999. The default
  scheme passes. A problem now names its block, so the author is sent to the caption.
- **The lists of figures and of tables are this slice's.** Each is one `TOC \h \z \c "<SEQ name>"`
  field after the contents - without `\h` where one of its figures floats, the notes above say why -
  in its section, its title in the `list` role and on a page of its own,
  prefilled with the captions the writer wrote a field for and no page, its entries in the writer's
  `TableofFigures` style, which is the one Word rebuilds them in (M9). Without a contents they stand in
  a front section of their own. Measured, Word's pages for every entry are the PDF's.
- **Image sizes are resolved against the Word page** (R3), by the PDF's own functions, `figureSize` and
  `inlineSize`, against the layout's Word page and each place's indents, into `WordInput.images`,
  keyed by `figureImageKey(node, block)` and `inlineImageKey(node, site, index)`, the site a paragraph
  (a cell's included), a term, an attribution or a table's note, and the index the image's place among
  the published runs. An image in a line too wide for Word's line is refused `image_too_wide` for Word
  too, said once where both formats refuse it. The job reads the images once, held to their hashes,
  and hands the same bytes to Typst and to the writer, which writes each once as
  `word/media/<sha256>.<ext>`, whatever the number of places it stands in.
- **Lists** (R4, WO-I): each list a numbering definition of its own, nine levels, its format and
  start at its level and the rest a step in or out, bullets disc, circle and square by the unordered
  lists it stands in, as the engine counts them. **A marker's width is read from the face file**,
  `faceAdvances` in `word/advances.ts`, since the engine stands an item after its widest marker as
  the face sets it; an estimate put items 7 to 14pt off, the face puts every one within 0.07pt, but
  for roman numerals, which the engine kerns and Word does not (0.73pt on _iv._). Numbers are
  right-aligned where the widest ends, as the engine's are. An item opening with anything but a
  paragraph, and an empty one, carries its number on an empty numbered paragraph of its own. A term
  is bold, as the engine sets it, with its definitions indented 2em. A tenth level, a list numbered
  in letters from the 28th and one past roman 3999 fail **`list_not_in_word`**, a new code naming
  the list, rather than `numbering_not_in_word`, whose sentence is the layout's: a list is the
  document's.
- **Quotations and M1 d8** (R5, R6). A quotation's blocks are in the quotation's style and its
  attribution a paragraph after them; where two quotations meet with no attribution between them, the
  writer turns contextual spacing off on the pair and drops the facing spaces, as M1 measured: 43.44
  against the PDF's 43.50. The spacing pass states over a style only what Word would read differently,
  so nothing is written where Word already agrees, and Word 1's documents are byte for byte as they
  were.
- **Preformatted text** is its label, then a paragraph a line, spaces kept. **Two blocks in a row
  joined into one panel in Word** (15.60pt apart, where the PDF sets two panels 27.70 apart); of five
  ways measured to part them, the writer takes the invisible one, standing the second **a twentieth
  of a point further in on each side**, alternating, so that a third stands where the first does: two panels, 28.56 apart.
  `w:between` was not tried, since it draws a rule between a block's own lines. And **a line as wide as
  the PDF's measure holds wrapped in Word**, as Word 1 foresaw: 8.8pt text is 9pt in Word, in a panel
  4pt narrower, so Word held 80 columns where the PDF holds 83. The writer sets every line of such a
  block the least whole twentieths of a point closer that fit it (4, at the default), and none where
  the line fits or where more than the next half point down's narrowing would be needed; the Word
  check found it, the line wrapping before the fix and not after. **A block whose text ends in a line
  feed** is written without the empty line after it, since the engine drops one line feed that ends
  raw text (measured, the pinned Typst: `x\n` as tall as `x`, `\n` one empty line, `\n\n` two), where
  Word had stood 11.7pt taller (the final review, M3).
- **Tables** (R7, WO-F): a Word table style per theme table style, `Table-<id>`, its rules, padding,
  header row and header column conditions and **banding by `band1Horz`**, the note beneath the
  decisions table says why; equal fixed columns; merged cells by `w:gridSpan` and `w:vMerge`; header
  rows `w:tblHeader`, body rows `w:cantSplit` where the style keeps rows whole. A header's weight is
  stated in the style both ways and set bold on its runs too, since Word toggles a style's bold over a
  bold cell style to regular. **A table with two or more header columns** draws them on its cells,
  since Word's first column is one column. The caption is a paragraph above it with `w:keepNext`, its
  words the table's `w:tblCaption`; the note a paragraph after it. A section never ends in a table:
  an empty paragraph a point high closes it, since Word ends a section with a paragraph.
- **Figures and images** (R8, WO-G): a figure's image in a paragraph of its own in the caption's style,
  aligned by its image style, as a `wp:inline`, described in `descr` or flagged decorative by M7's
  extension, its caption below; the space above it the PDF's leading, which Word does not set above a
  line an image fills. A floated figure is a text box holding its image and its caption, the notes
  above say why. An image in a line is a `wp:inline` in its run, in a cell too. **A caption's label**
  - its word, its fields' results and its separator - is the layout's words, set left to right in the
    layout's language as the running head is, whatever its caption's direction, and the list after the
    contents is prefilled so (the final review, M2).
- **The report's table entries**, closed shapes stored and served as Word 1's are, each a sentence on
  the publication's page: `header_column_lost`, `header_repeated` for a table whose style does not
  repeat its header, since Word repeats every marked header, and `continuation_label_omitted` for one
  whose style asks for a label, since Word sets none - for every such table, since the writer cannot
  know where Word breaks the page. An unnumbered table is said as _A table with no number_.
- **The Word check holds Word to the PDF.** Two fixtures join Word 1's seven: every construct above,
  compiled through template 13 beside it with the same image bytes, and captions prefixed and
  restarted at the third and the ninth levels, every caption field prefilled wrong; since the final
  review, two floats a paragraph apart and a right-to-left numbered table. It checks ten things more, [`docs/testing.md`](../testing.md#the-word-check) lists them, and each ran green in
  Word 16; its bite was checked by rebuilding the writer with `band2Horz`, no panel parting and the
  frame at the foot, and four of them failed; the final review's two checks each failed on the writer
  before its fix, the floats' with two frames at y 72, the caption's reading "1.1 Table".

**What Word showed that the design did not foresee**, measured against the PDF of the same document:

- **A term stands 3.40pt further from its definition** (14.40 against 11.00): the engine sets a
  definition an em below its term, less than a line, and Word cannot set less than its line. The
  engine's 11pt looks like an artefact of how `terms` lays out an inline term before a block, and may
  be the template's to change rather than Word's to copy; the check holds the difference at 3.40.
- **An item opening with a nested list or preformatted text takes a line more** (14.40): the engine
  sets two markers on one line, or a marker beside a panel's first line, and a Word paragraph carries
  one number, so the item's number stands on a paragraph of its own.
- **Two panels are parted by a twentieth of a point**, and stand 0.98pt further apart than the PDF's
  (28.68 against 27.70), inside the check's point, but only just.
- **A cell's top margin takes the line's leading.** Word sets a cell's line whole, its leading above
  the text, so with the style's padding on every side rows stepped 24.84 where the PDF's step 21.00.
  The table's own `w:tblCellMar` gives up the cell style's leading at the top (1.65pt of 5 at the
  default) and the caption's space after takes it: rows step 21.48, the half point the difference
  being Word's room for a half-point rule, which the PDF does not give. A recipient sees a top cell
  margin of 1.65pt where the style says 5.
- **Preformatted text is narrowed where its widest line would wrap**, above: 0.2pt a character at the
  default, still wider a glyph than the PDF's.
- **The float**: the anchor left the caption behind, the frame kept it and stood two on each other,
  the text box keeps it and stands two apart; its space below the engine's clearance less the text's
  leading (13.15pt), inside the box at its foot, the first caption's baseline 309.65 against the PDF's
  309.61, as the frame's was.
- **A float that does not fit on the page its anchor falls on takes the text after it to the next
  page**, leaving the foot of the page empty: Word sets a float on its anchor's page and cannot hold
  it back while the text after it runs on, as the engine does. In the review's document page 5 ended
  at 667.18 of a text area reaching 770, where the PDF kept three paragraphs more on it. The frame did
  the same, as does every form measured above. Pages differ between the outputs by design (PUB-065);
  left, and said here.
- **A table style whose padding is less than its cell's leading leaves Word's rows taller**, by up to
  the leading: the table's top cell margin gives up the leading only as far as the padding goes. The
  review's bare style, padding 0, stepped its rows 14.40 in Word (204.9 to 219.3) against about 11.4
  in the PDF, 3pt a row. An exact line height on a cell's first paragraph was not tried: it would set
  that line on a height the writer cannot know for a cell holding an image in a line or a list. Left.
- **A caption's label is tagged in the layout's language in Word, and in its caption's in the PDF**,
  which sets it inside the caption: the label is the layout's words, and in a right-to-left caption
  Word printed it after the caption's words, right to left in the component's language, each field's
  result an island of its own ("ספר 1.1 Table" where the PDF prints "ספר Table 1.1"). Left to right in
  the layout's language it prints as the PDF's. In a left-to-right document the label is tagged `en`
  under the default layout where its caption is `en-GB`.
- **An empty preformatted block is a line high in Word** and only its panel's padding in the PDF:
  the engine sets no line for empty raw text, and a Word panel needs a paragraph. Not measured.
- **A line holding an image in a line stands 3.44pt nearer the line above** (18.24 against 21.68):
  Word grows the line to the image and adds no leading above it, where the PDF adds its leading above
  the image. It is per line, so no paragraph property fixes it without moving every line; in a cell,
  the image's row is 2.17pt shorter. Left.
- **Caption fields hold at the third and the ninth levels** and under an appendix's letter, where
  Word 2's first task had measured the first and second: Figure 1.1.1.1.1.1.1.1.1.1 and Table
  1.1.1.1 after the update, from "9" prefilled. Rules take room in Word where the PDF's do not, and
  a width Word lacks is drawn at its nearest (2pt as 2.25).
- **The outline's page break is not published**, found by the check's fixture: a reference with
  `pageBreak: 'page'` ran on in the PDF as in Word. Outside Word's scope; filed as
  [issue #234](https://github.com/kenhayward/alloy-works/issues/234), and publishing.md says so.

**What each claim now stands on**, as `pnpm trace show` reports it; the citations pin moved from 325
to 328:

| ID          | Claimed by    | Cited                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TAB-039** | publishing.md | `apps/worker/src/word.test.ts`, one test reading one publication's two outputs together: the PDF, compliant by veraPDF, its `Caption` the `Table`'s first child; the Word document, its caption the paragraph straight above the table in the caption role with `w:keepNext`, its words the table's `w:tblCaption`. "In every output" is both halves                                                                       |
| **TAB-049** | publishing.md | The same test: in the PDF, `TH` for both header rows and the header column; in Word, both header rows `w:tblHeader` and none other, and the report naming the table whose header column Word cannot mark                                                                                                                                                                                                                   |
| **PUB-035** | this document | `apps/worker/src/word.test.ts`, one test over the whole Word 2 document reading every item [Accessibility](#accessibility-pub-035) lists: every heading in Word's style for its depth with its outline level; every drawing described by its alternative text or flagged decorative; every table's header rows marked and its caption associated; the header column named in the report; every run of text in its language |

**PUB-035 is whole only while equations, footnotes and cross-references are refused for Word.** No
Word document carries one today, so none carries one inaccessibly, and the two things Word cannot
carry are named gaps, not hidden ones: a description's language, which Word has nowhere to put and
this document says, and a header column, which the report names. **Word 3 and Word 4 must extend
this test** as footnotes, cross-references and equations reach Word, or the citation goes stale.

**Not cited, and why.** CNT-117, CNT-118, CNT-153, CNT-018 and CNT-019, the lists' kinds, depth,
start and format: the content model's statements, already covered, which ask nothing of every output,
so a Word test would be a second citation, not a completion. AST-013, AST-015 and AST-039, a figure's
alternative text, the decorative flag and the description's language: none asks it of every output,
and AST-039's Word half cannot be shown at all. PUB-066: the lists after the contents are `TOC`
fields Word refreshes, but page references are Word 3's. PUB-038 is covered by the PDF. PUB-023 waits
for Word 4.

**Left for Word 3 and 4.** Of Word 1's list for Word 2, all is done but what is below. Word 3:
footnotes, cross-references and their bookmarks, named Word's way, and `numbering_not_in_word`
extended to footnotes; PUB-025, PUB-026, PUB-065 and PUB-066; and the trap above for a footnote in a
header row and a reference to a header-row target, which must stop dropping them for Word as they
leave `word_not_yet`. Word 4: equations and the list of equations, which alone of the lists after
the contents is still refused, deciding which of the maths tree's refusals Word sets and undoing the
trap for the rest, reporting the maths face's substitution; PUB-067 and CNT-045, then PUB-023. Both
extend PUB-035's test. **Not measured in Word**, each tested for its XML only: a right-to-left list
(a right-aligned number in a `w:bidi` paragraph), a table's cells (`w:bidiVisual`), whose caption
the check now reads, and a figure in a right-to-left passage; a style with a first-line indent on an item's first paragraph, which the
hanging indent replaces; a table, a figure or a frame in a list item or a quotation; preformatted
text narrowed inside one; and a header cell spanning into the body, which the PDF refuses and Word
merges. **Known and left**: a kept row taller than a page splits in Word and loses its header on
that page, as M6 found, where the PDF splits it in place; a header's and a footer's paragraphs are
not parted as panels, which the default theme cannot reach, since it fills only preformatted text;
an unnumbered figure may be listed in the PDF's list, which was not measured, and is not in Word's,
since Word's list is its `SEQ` fields; the report names the same words for every unnumbered table;
and `apps/web/src/publishing/failures.ts` still says `listOf:figure` and `listOf:table`, which
stored failures may name. Still open from Word 1: how a reader who declines the prompt sees the
contents, a cover running to a second page, and a matter entered twice.

**Word 3 is built**, by [Word 3](../plans/2026-09-26-word-03-footnotes-and-cross-references.md): the
third of WO-M's slices, as Word 2 left it. Every footnote reaches Word as Word's own, numbered by
Word, and every cross-reference as a field Word updates, at a hidden bookmark on its target named
Word's way; with them, a Word document carries everything a document holds but its equations, which
stay refused by name, `word_not_yet`, with a reference to one and the list of equations. The writer is
`word/3`. Building it changed these things here:

- **Off `word_not_yet`, and the trap undone.** A footnote - in text, in a table's cell and in a
  table's header row - and a cross-reference in every place the PDF prints one, a section's title
  included, are written. The two constructs Word 2 left dropped by a PDF engine refusal now stay in
  the published document: a footnote in a header row and a reference to a target in one are still
  refused for the PDF alone (`footnote_not_publishable_here`, `cross_reference_form_unavailable`),
  and a Word-only publication carries them - the header row's note numbered once, its mark repeating
  with the row on every page Word sets it, measured. What still drops its construct is an equation
  the maths tree refuses, which is still `word_not_yet`: Word 4's.
- **Footnotes are Word's** (R2, M5). `footnotes.xml` holds the separator and continuation separator
  Word requires, in the footnote place's style with no space about them, and each note in the order
  the text meets its mark; a mark is a `w:footnoteReference` run in Word's own **Footnote Reference**
  style, superscript, with no text of its own, and a note opens with `w:footnoteRef` in the same
  style, then a space scaled by `w:w` to the engine's 0.05em (Word ignored `w:spacing` on that run,
  measured at 0.00), its first line indented an em as the PDF's. A note's paragraphs are written
  through the writer's own flow - their styles, runs, marks, links and images, in the passage where
  its mark stands - and relate their links and images from `footnotes.xml.rels`, so the writer now
  keeps relationships per part. M1 d8 is written between notes where the footnote style asks for
  contextual spacing, since Word applies contextual spacing across footnotes: without it two notes
  under such a style stood 10.80 apart where the PDF sets 14.62. None of this, the footnotes part,
  its settings and the reference style, is written where a document holds no footnote.
- **Each matter's section restarts its notes, and `continuous` is never written.** Each matter's
  sections carry `w:footnotePr`, `w:numRestart eachSect` and the format of the matter's footnote
  rule's own counter, each section counting from 1 as Word does unasked (no `w:numStart`). The
  plan's R2 would have written `continuous` for a rule that runs on through the document; **measured in Word 16, a continuous section numbers
  a note by its place among every note in the document**, not on from the section before - the body
  entered again after an appendix printed 5 where the scheme counts 3 - so it is the scheme's count
  only where `eachSect` is too. `numbering_not_in_word` extends to footnotes, `detail`
  `footnote:<matter>:<why>`, once per matter and naming the first note that meets it, following
  Word's count through the writer's sections as captions' is: `label`, a word the rule writes before
  the number, which Word's mark cannot carry; `prefix`, a chapter's number before it; `restart`,
  Word's count not the scheme's - a rule restarting at a chapter, where Word's section is the whole
  run of the matter, and **a matter entered a second time whose earlier run held notes**, whose count
  the scheme carries on; and `letters` and `roman` as a heading's. `w:numStart` could carry the
  second, and would pin the PDF's number where Word's is asked for. The default scheme passes.
- **A section's title reaches Word through `WordInput`**, not a change to the published document: the
  published title carries a reference as the words it prints, which the writer could not tell from
  the title's own, so `WordInput.titles` holds, for each section whose title holds a reference, its
  words as runs and each reference as the published reference run. The PDF's document is byte for
  byte what it was, and `publishing/13`, template 13 and `PIPELINE_VERSION` stay.
- **Each reference's form reaches Word through `WordInput.references`**, `{ display, label, title }`
  keyed by `inlineReferenceKey(node, site, index)`, its place among the published runs as an image
  in a line is keyed - a caption now a site of its own - since a form read back from the printed words
  is ambiguous (a title that is its number).
- **Bookmarks** (R3, M4): every anchor a reference names gets `_Ref` and nine digits, numbered in the
  order the writer writes, 13 characters, one set per anchor however many references name it; the
  writer holds the map, and `assemble` knows no name. A heading's stands around its title's runs,
  since its number is Word's; a caption's are two, around its label and around its words; a
  footnote's around its mark. **A block's - a paragraph, a list, a quotation, preformatted text - is
  a bookmark holding nothing where its first paragraph begins**, not R3's bookmark around that
  paragraph: a block is named only for its page and for above or below, and Word refuses a relative
  field inside the bookmark it names, "Error! Not a valid bookmark self-reference.", measured for a
  paragraph naming itself; empty at its start, `PAGEREF` and `REF \p` print what the PDF does before
  it, after it and inside it. A table's and a figure's page and place are its caption's label
  bookmark, since nothing stands between a figure and its kept caption - and **where the caption has
  no label**, a bookmark holding nothing where the caption begins, for the same reason: its place
  had been the bookmark around its words, and a relative field in the caption naming its own place
  printed "Error! Not a valid bookmark self-reference." (M1 of the final review); measured after, a
  table's and a figure's caption naming their own place, and the text naming both, print the PDF's
  words and pages. **A floated figure a
  reference names gets a third bookmark**, holding nothing, in its anchor paragraph after the box: its
  caption's bookmarks stand in the text box, another story, where `REF \p` printed the bookmark's
  words ("Figure 1.2"), found by the Word check; its number, title and page stay on the caption,
  measured right. A target that publishes nothing is a bookmark holding nothing at the end of the
  paragraph before it, else at the start of the next, else in an empty paragraph of its place's style.
- **Every form is a field** (R4, M4), prefilled with what the PDF prints and carrying the text's run
  properties on every run, since Word takes the updated result's formatting and a relative field's
  language from them: a heading's number `REF _Ref \r`, a caption's `REF` on its label, a footnote's
  `NOTEREF` **without `\f`** - the PDF prints the number as text, and `\f` made it superscript in
  Footnote Reference, measured; a title `REF` on the heading's or the caption's words; both, the two
  fields with a space between, as the PDF joins them; above or below `REF _Ref \p`, prefilled with the
  layout's word; a page `PAGEREF _Ref`, **prefilled empty** (PUB-066). **`\r` for heading numbers**,
  as planned: measured, `\r`, `\w` and `\n` print the same full number (`1.2.1`, `A.1.1`, `i`) from
  every context tried, since each level's text writes the levels above it. `\h` stands exactly where
  the published run links - a paragraph's text and a note's - and not in a header row, a caption, a
  term, an attribution, a table's note or a title (XR-D).
- **Word's own words for above and below in another language** (WO-C): a relative field's runs carry
  the passage's language, so Word's update prints its own word in it - `oben` and `unten` in a German
  passage where the PDF prints the layout's _above_ and _below_. **In a Hebrew passage Word 16 here
  printed the English words**, having no Hebrew words in the language resources installed here - one
  Word 16 with an English interface; a Word with Hebrew proofing or a Hebrew interface may print
  Hebrew ones, which this machine cannot show, and the Word check would say so where it runs on one.
- **A new refusal, `cross_reference_not_in_word`** (R5), where Word is asked for, naming the reference
  as the other reference failures do, `detail` `<form>:<why>`, for a reference Word's field prints
  otherwise than the PDF, each found in Word 16, and the PDF unaffected. R5 said to refuse by name
  rather than report; a new code rather than `cross_reference_form_unavailable`, whose sentences say
  what the target or the layout lacks, which is false here:
  - `relative:footnote` - above or below between a footnote's text and the text outside it, either
    way. Word writes the notes in a story of their own and `REF \p` compares positions only within one
    story: from a note to a table in the text it printed the bookmark's words, `Table 1.1`, and to
    the note's own mark nothing; from the text to a note's paragraph, that paragraph's words or
    nothing. Between two paragraphs of the notes it is right, and is written, as are a number, a title
    and a page across the two.
  - `relative:float` - above or below in a floated figure's caption, found by the final review
    (I1). Word writes the caption in a text box, a story of its own too, and `REF \p` there printed
    nothing, to a paragraph before the figure and one after it, where the PDF prints _above_ and
    _below_; Word's list of figures copied the gap. Its number and its page in the box, and a relative
    reference from the text to the floated figure, which names its anchor in the text, are right.
    Refused only where the figure's image style floats it: the same caption on a figure set as a
    block stands in the text and is written. One across a note's boundary as well is named once,
    `relative:footnote`. **A footnote and a text box are the only stories the writer puts a reference
    in**: a header's and a footer's words are the layout's, the document's title as text, and Word's
    own `PAGE`, `NUMPAGES` and `STYLEREF` fields, and the titles `STYLEREF` copies hold a reference
    only as a number, never above or below.
  - `title:caption` and `numberAndTitle:caption` - a caption's own words named inside it. Word's `REF`
    refused it as a reference to itself, "Error! Not a valid bookmark self-reference."; a caption's own
    number and its own place, `above`, were right, and are written.
  - `title:nested` and `numberAndTitle:nested` - a caption's words named where they hold a reference
    in any form but its number. The PDF prints each reference inside a caption as its target's number
    or kind ("Readings as in 1, Paragraph", by cross-references 2's design); Word's `REF` copies the
    nested field and updates it, printing "... above", found by the Word check. A number copies
    right, measured - a heading's `1` and a table's `Table 1.2` - and is written. Two captions naming
    each other's words fall under the same rule.

**Two decisions for Ken, open.** Each refusal below narrows what Word can publish where Word's
fields cannot print what the PDF does, and was taken as R5 says, refusing by name; each has another
answer, and the pull request asks for his:

| #    | What Word does                                                                                                                                                                                                                                                                                                              | Built                                                                           | The alternatives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W3-A | A relative reference across a story's boundary - a footnote's, "see the table above" in a note or "the note below" in the text naming a note's paragraph, and a floated figure's text box, "compare the table below" in its caption - prints the bookmark's words or nothing, since `REF \p` compares only within one story | Refused for Word, `relative:footnote` and `relative:float`; the PDF publishes   | **Plain text with a report entry**, for both: the layout's word written as text, which Word never updates, and the publication's report naming the reference, so the document publishes and the author is told. PUB-026 asks for fields Word can update; this one would not be, and would be named. For the float alone, **set the figure as a block in Word**, reported: its caption then stands in the text and its fields are right, and the figure stands where its anchor is rather than at the head of the page, where the PDF's band stands. Floating the image alone and keeping the caption in the text, which Word 2 measured, parts the caption from its image |
| W3-B | A caption's words named as a title, where they hold a reference that is not a number, print as Word's own form of it ("... above") where the PDF prints the target's kind ("... Paragraph")                                                                                                                                 | Refused for Word, `title:nested` and `numberAndTitle:nested`; the PDF publishes | **Accept Word's reading**, reporting that the two differ - arguably the better words; or **change what the PDF prints** for a reference inside a caption named by a title, to the reference's own form as Word prints it, which is cross-references 2's design to reopen and a change to every PDF of such a document                                                                                                                                                                                                                                                                                                                                                     |

**Ken kept both refusals on 2026-09-26**: a relative reference across a story's boundary and a title
form of a caption holding a reference stay refused for Word by name, and the PDF publishes both.

**What Word showed that the design did not foresee**, measured in Word 16 against the PDF of the same
document compiled through template 13:

- **A footnote's mark and number are Word's superscript**, not the engine's: a mark in 11pt text is
  6.96pt raised 4.56 in Word against 7.15 raised 4.98 in the PDF, 0.19 smaller and 0.42 lower; a note's
  number in its 9.5pt note 6.00 raised 3.48 against 6.08 raised 4.24. The reference style states
  superscript, the plan's word, rather than a size and a raise pinned to the engine's. Typst sets some
  marks with the face's own superscript glyphs; Word always synthesises them.
- **The note step is Word's line**: two notes, and two lines of one, step 11.64 to 11.76 in Word
  against the PDF's 11.62, and a wrapped line 10.92 against 10.80, Word's 9.5pt line being taller than
  the style's 10.8 at least. The number's left edge (81.38 against 81.35) and the text after it (84.86
  both) are the PDF's. The separator is Word's own line, not the PDF's, and is not matched: pagination
  is Word's (PUB-065).
- **Digits alone in a right-to-left run are drawn in Times New Roman**, as Word 1 found in a heading's
  number: in the Hebrew passage the results of `PAGEREF`, `NOTEREF` and `REF \r` were set in it where
  Liberation Serif is embedded. The same fields without `w:rtl` are set in the embedded face at the
  same place, measured, so those three are written without it, their `w:lang w:bidi` kept; a caption's
  number, a title and a relative field keep the passage's direction.
- **Hidden, Word had already updated every `REF` as it opened**, from `w:updateFields`, before COM read
  them, and a `PAGEREF` read `1` until the document was paginated: so the check prefills every result
  wrong, a page's empty prefill among them, and what proves the update is the wrong document reading
  right.

**What the final review found in Word, and the fixes measured there**, each test first and measured
in Word 16 through the check's own script against the PDF of the same document:

- **I1**, a relative reference in a floated figure's caption printing nothing: refused,
  `relative:float`, above, and part of W3-A.
- **M1**, a caption with no label naming its own place: its place is a bookmark holding nothing where
  the caption begins, above; measured right. `REF \p` inside the bookmark it names was the only form
  Word could not compute: `PAGEREF` there printed the page, and a title of its own words is refused
  (`title:caption`).
- **M2**, right to left. **References side by side read in another order than the PDF's**: in a
  Hebrew paragraph the PDF sets "Table 1.1 above 1 1 above 1" as one left-to-right run, and Word set
  each field's result apart, "1 above 1 1 above Table 1.1" from the left. Measured over eleven
  variants of the paragraph: the same words as one run of text, with `w:rtl`, set as the PDF does;
  the fields' own runs without `w:rtl` changed nothing; and the spaces between them, each a run of
  its own with `w:rtl`, were what Word read as right to left. So **a space between two fields that
  print nothing right to left** - between two references, and between a number and its title - is
  written without `w:rtl`, the fields keeping theirs; Word then set the paragraph as the PDF does. And
  **the notes' separator** stood at the left of a right-to-left document, where the PDF draws its
  line at the right: its paragraph, and the continuation separator's, are `w:bidi` in a right-to-left
  document, and Word drew it at the right. **Left as it is**: a word of the author's own written
  left to right beside a reference, "see Table 1.1" in a Hebrew passage, still stands apart from it
  in Word - the space ending the author's run is inside a right-to-left run of words, which the
  writer does not split (measured); punctuation between two references (", "), and a relative field
  that a Word with Hebrew words would print in Hebrew, beside which the writer judges a space by the
  PDF's word, are not measured.

**The Word check** gained two fixtures and three checks, now eleven documents and 23 checks, all
green in Word 16 on the final code: footnotes in front matter, the body and an appendix, four to a
page, in a cell, of two paragraphs with a link, in German, in a header row Word repeats for Word
alone, and in Hebrew; and every form to every kind of target - headings at the first and third
levels, in front matter and an appendix, a table, a figure, a floated figure, a paragraph, a footnote
and a note's paragraph - before and after it, pages away, in a paragraph, a note, a caption, a header
row, a table's note and a section's title, in German and in Hebrew. The references fixture holds 93
fields on 11 pages and 17 bookmarks. Every footnote's number, read by a `NOTEREF` Word inserts on a
copy closed unsaved, is the numbering table's, on its mark's page; every field, prefilled "9", updates
to what the PDF prints and every page to the page Word sets its target on, by that page's own foot; and
every bookmark is `_Ref` and nine digits, hidden, and kept whole. It found the three things above the
writer then fixed - the right-to-left digits, the floated figure's place and the nested caption - each
test first. [`docs/testing.md`](../testing.md#the-word-check) lists what it checks.

**What each claim now stands on**, as `pnpm trace show` reports it; the citations pin moved from 328
to 331:

| ID          | Claimed by    | Cited                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PUB-025** | this document | `word/write.test.ts`, on the XML: every mark a `w:footnoteReference` in Word's Footnote Reference style with no text of its own and no `w:customMarkFollows`, in text, a cell and a header row; every note opening with Word's `w:footnoteRef`. Each section's `w:footnotePr` is asserted beside it, uncited. That Word numbers them as the numbering table does is the Word check's, which does not cite it |
| **PUB-026** | this document | `word/write.test.ts`, on the XML: every form to every kind of target a `REF`, `NOTEREF` or `PAGEREF` field at its target's hidden bookmark, prefilled with what the PDF prints and a page left empty. That Word updates each to the PDF's words is the Word check's, which does not cite it                                                                                                                  |
| **PUB-066** | this document | `apps/worker/src/word.test.ts`: the contents and the lists of figures and of tables each one `TOC` field with every entry prefilled without a page, every `PAGEREF` in the text and the notes with no result, and `w:updateFields` - the whole statement, now page references exist. Shown to bite by prefilling a `PAGEREF` with "9"                                                                        |
| **PUB-035** | this document | `apps/worker/src/word.test.ts`, extended as Word 2 said it must be: every footnote Word's own, numbered in the published order, every note opening with `w:footnoteRef`; every reference a field of the instruction its form asks for, linked exactly where the PDF links, prefilled with the PDF's words, its runs in its passage's language, a German passage's relative field among them                  |

The Word check cites PUB-029 alone, as before: CI skips it, and a skipped citation of PUB-025 or
PUB-026 would demote a requirement the unit tests show. **PUB-035 is whole only while equations are
refused for Word**: no Word document carries one, so none carries one inaccessibly, and footnotes and
references, now carried, are now read. Word 4 must extend it again.

**Not cited, and why.** PUB-065 asks Word to carry the resolved document's content, numbering and
cross-references and leave pagination to Word, and the publication record to say the PDF is what a
page cites. Its record half is `pages_cite_the_pdf` on every Word output, which the job's test holds;
its carrying half is not yet whole while Word refuses equations and a reference to one, and no one
test shows both. It stays Designed, to be cited in the job's Word test once Word 4 lands - or now, if
"carry" is read as "never drop in silence", which the refusals by name already meet. PUB-067, CNT-045
and PUB-023 are Word 4's.

**Left for Word 4.** Equations - inline and displayed, numbered in a row of two cells (WO-H) - a
reference to one, which is `word_not_yet` today with `detail` `crossReference`, and the list of
equations, the last list after the contents still refused; deciding which of the maths tree's refusals
Word sets and undoing the trap for the rest; reporting the maths face's substitution; PUB-067 and
CNT-045, then PUB-023, and PUB-065 as above; and PUB-035's test extended to equations. **Not measured in Word**, tested for
its XML only: a floated figure whose box Word sets on another page than its anchor, whose relative
place would then be its anchor's. The final review measured the rest this list held: a reference in
a definition's term or an attribution and a target that publishes nothing (its empty bookmark), each
printing as the PDF, and a reference inside a floated figure's caption, whose relative form is now
refused, `relative:float`. The fixtures of Word 3's checks are compared with the
resolved document rather than a compiled PDF, since what the PDF prints and where it links is the
published run's, which the template's own tests hold. Still open from Word 1 and 2: how a reader who
declines the prompt sees the contents, a cover running to a second page, and a matter entered twice,
which for footnotes is now refused where its earlier run held notes. Word 2's known differences
stand.

## Open questions

| ID  | Question                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New | Whether recipients accept Word's field-update prompt. The prompt works; whether a client's reader trusts it is a question for real recipients. If not, ADR-0015 names the fallback   |
| New | Whether the output includes review - suggestions and comments - by default, or only when the publisher asks. PUB-028 is T6, and a client copy with internal comments in it is a leak |
