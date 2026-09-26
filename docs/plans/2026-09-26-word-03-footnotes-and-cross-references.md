# Word 3: Footnotes and cross-references in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as Words 1 and 2 were. It builds the third of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M), as Word
> 2 left it: footnotes and cross-references, with their bookmarks named Word's way. Ken agreed the
> design's recommendations on 2026-09-25.

**Goal:** a Word document carries every footnote as a real Word footnote, numbered by Word, and every
cross-reference as a field Word can update - a heading's number or title, a caption's label or text or
both, "above" or "below", a footnote's number, a page - each prefilled with what the PDF prints and
pointing at a hidden bookmark named Word's way. With it, a Word document carries the resolved
document's content, numbering and cross-references, and leaves pagination to Word.

**Not in this slice:** equations, a reference to one, and the list of equations (Word 4), which stay
refused by name, `word_not_yet`.

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **PUB-025** (footnotes real Word footnotes, numbered by Word): the writer's `footnotes.xml` and the
  Word check's numbers against the numbering table.
- **PUB-026** (cross-references fields Word can update, not the numbers they resolved to): each form,
  and the Word check updating them.
- **PUB-065** (Word carries content, numbering and cross-references, leaves pagination to Word; the PDF
  is the paged record and the record says so): now whole - `pages_cite_the_pdf` beside carried
  references.
- **PUB-066** (contents, lists and page references are fields Word refreshes, never page numbers
  copied from the PDF): now whole with `PAGEREF` - no page number from the PDF anywhere in the file.
- **PUB-035**: its test extended to footnotes and references (Word 2 cited it on condition).
- **Not cited:** PUB-067, CNT-045, PUB-023 (Word 4).

## Rulings

- **R1. Off `word_not_yet`**: a footnote (in text and in a table's cell, where the PDF sets it), and a
  cross-reference in every place the PDF carries one. **The trap**: a footnote in a table's header row
  and a reference whose target stands in one are refused by the PDF engine alone (Typst's labels) -
  for a Word-only request they must stay in the document; a request for both fails as today. A
  reference to an equation, and the list of equations, stay refused (Word 4).
- **R2. Footnotes** (M5): `footnotes.xml` with the separator and continuation separator Word requires;
  a footnote's mark a `w:footnoteReference` run in the footnote reference character style, and inside
  the note a `w:footnoteRef` run; the note's paragraphs in the `footnote` place's style, their runs,
  marks, links and languages written as the text's are (a note in another language as the PDF sets it,
  in the language where its mark stands). **Numbered by Word**: the scheme's footnote rule decides
  `w:footnotePr` - continuous, or restarting per section where the rule restarts at a matter (each
  matter is a section) - with `w:numFmt` from its format; a rule Word cannot compute (a prefix, a
  restart at a depth below the matter, letters past _z_, roman past 3999) refuses the Word publication,
  `numbering_not_in_word`, `footnote:<why>`, in `assemble`'s docx path. The default scheme passes.
- **R3. Bookmarks** (M4): each target a reference names gets hidden bookmarks named `_Ref` and nine
  digits, in document order, deterministic, at most 40 characters: a heading's around its title text
  (its number is Word's, `\r` reads it); a caption's two, around its label and number and around its
  text, so the forms can name each; a block target (a paragraph, a list item, a quotation, preformatted
  text, a table or a figure named for its page or relative position) around the block's first
  paragraph; a footnote's around its reference mark. The writer holds the map from the product's anchors
  to these names.
- **R4. Cross-references** (M4, WO-C): each form as a field prefilled with the resolved reference's
  text - `number`: a heading `REF _Ref \r \h`, a caption `REF _Ref \h` on its label bookmark, a footnote
  `NOTEREF _Ref \h` (with `\f` if Word's footnote-reference formatting should apply - measure);
  `title`: `REF _Ref \h` on the title or caption-text bookmark; `numberAndTitle`: the two, joined as the
  PDF joins them; `relative`: `REF _Ref \p \h`, prefilled with the layout's word - Word's own
  "above"/"below" in the passage's language replace it on update (WO-C; record where the layout's
  words differ); `page`: `PAGEREF _Ref \h`, **prefilled empty** (PUB-066). `\h` only where the PDF
  links (a paragraph's text outside header rows, XR-D); elsewhere the same field without it. A
  reference to a target in another component, a list item or a cell, as the PDF resolves them. Measure
  every form after an update against the resolved text.
- **R5. The report and PUB-065.** `pages_cite_the_pdf` stands on every Word output as now; with
  references carried it is PUB-065's record half. No new entry kinds unless a form cannot be carried -
  then refuse by name rather than report.
- **R6. The Word check** gains footnotes (in text, in a cell, in a header row for Word alone, several
  per page, across matters under a restarting rule if one can be built), and every reference form to
  every target kind (heading, figure, table, block, footnote), before and after its target, on other
  pages, in a caption and a note (not linked), and a relative one in a German passage (Word's words in
  its language). It checks each field's result after an update against the resolved text (prefill each
  wrong first, as Word 2 did, to prove the update), every `PAGEREF` against the page Word laid the
  target on, each footnote's number and page, and every hidden bookmark name's shape.

## Tasks

1. **`assemble`** (`packages/domain`): R1 and R2's refusal - off `word_not_yet`, the trap undone for
   each, `numbering_not_in_word` for footnotes.
2. **Footnotes** (`packages/domain/src/word/`): R2.
3. **Bookmarks and cross-references** (`packages/domain/src/word/`): R3, R4, R5.
4. **The Word check** (`apps/worker`): R6, one recorded run; PUB-035's test extended.
5. **Docs**: word-output.md's "What was built" for Word 3, publishing.md, architecture, features and
   the README, CLAUDE.md's status, this plan's status, the writer's version (`word/3`), the version
   (Minor, 0.72.0) and the changelog; trace generate and pins.
