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
assembles (ADR-0013): LaTeX from the content model, MathML, then the tree. Neither Microsoft's
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
equation carries its number as a `SEQ` field at a right tab stop, so that a `REF` to it updates like
any other.

## Accessibility (PUB-035)

- Heading styles carry `w:outlineLvl`, so Word's navigation pane and screen readers see structure.
- Images carry their alternative text in `wp:docPr/@descr`; publishing already refuses an image
  without one (PUB-033).
- Table header rows carry `w:tblHeader`, which both repeats them across pages and marks them as
  headers.
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
  Word output was.
- **Word itself** (PUB-029), before any change to the writer lands. Two mechanics are decided and not
  yet seen there: fields refreshed on opening, and equations built from the tree.

## Open questions

| ID  | Question                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New | Whether recipients accept Word's field-update prompt. If not, ADR-0015 names the fallback: refresh on the server with LibreOffice, with its layout's page numbers                    |
| New | Whether the output includes review - suggestions and comments - by default, or only when the publisher asks. PUB-028 is T6, and a client copy with internal comments in it is a leak |
