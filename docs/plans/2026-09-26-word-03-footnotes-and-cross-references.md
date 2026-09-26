# Word 3: Footnotes and cross-references in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as Words 1 and 2 were. It builds the third of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M), as Word
> 2 left it: footnotes and cross-references, with their bookmarks named Word's way. Ken agreed the
> design's recommendations on 2026-09-25.
>
> **Built** (PR #237). [What the build changed](#what-the-build-changed) records where it departed
> from the rulings below.

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

## What the build changed

Built a task at a time, the Word check (task 4) finding three things the writer then fixed. What the
design took from it is word-output.md's [What was built](../design/word-output.md#what-was-built),
with a dated note beneath its decisions table; what follows is where the build departed from the
rulings above, and why.

**Rulings that moved during the build.**

- **R2's `continuous` is never written; every matter's section restarts** (`eachSect`). Measured in
  Word 16, a continuous section numbers a note by its place among every note in the document, not on
  from the section before: the body entered again after an appendix printed 5 where the scheme
  counts 3. So `eachSect` is the scheme's count wherever `continuous` would be, and **a matter
  entered a second time whose earlier run held notes is refused**, `footnote:<matter>:restart`;
  `w:numStart` could carry it, and would pin the PDF's number where Word's is asked for.
- **R3's block bookmark holds nothing, at the start of the block's first paragraph**, not around it:
  Word refused a relative field inside the bookmark it names, "Error! Not a valid bookmark
  self-reference.", measured for a paragraph naming itself; empty at its start, a page and above or
  below print what the PDF does before, after and inside it.
- **R4's `NOTEREF` is written without `\f`**: the PDF prints a footnote reference's number as text,
  and `\f` set it superscript in Word's Footnote Reference style, measured.
- **R5 has a refusal**, where it said none unless a form could not be carried: three kinds of
  reference Word's field prints otherwise than the PDF, refused for Word by name as a new code,
  `cross_reference_not_in_word` - `relative:footnote`, `title:caption` and `numberAndTitle:caption`,
  and, found by the Word check, `title:nested` and `numberAndTitle:nested`. A new code rather than
  `cross_reference_form_unavailable`, whose sentences say what the target or the layout lacks. **Two
  of them are decisions for Ken** (word-output.md's W3-A and W3-B): a relative reference across a
  footnote's boundary, refused, or plain text with a report entry; and a caption's words named as a
  title where they hold a reference that is not a number, refused, or Word's reading accepted and
  reported, or the PDF changed.
- **PUB-065 is not cited**, where the plan said it would be whole: its record half is the job's
  `pages_cite_the_pdf`, and its carrying half is not whole while Word refuses equations. It stays
  Designed, for the job's Word test once Word 4 lands.
- **`WORD_WRITER_VERSION` is `word/3`**, since the writer now writes footnotes and cross-references
  `word/2` refused.

**`assemble` (R1, R2, R5).**

- **A reference in a section's title reaches Word through `WordInput`**, not a published-document
  change: `WordInput.titles` holds each such title's words and its reference runs, since the
  published title carries a reference as the words it prints, which the writer could not tell from
  the title's own. `WordInput.references` holds each printed reference's form and its target's number
  and title, keyed by `inlineReferenceKey(node, site, index)` as an image in a line is, a caption a
  site of its own. The published document is byte for byte what it was.
- **The trap is undone for both**: a footnote in a header row and a reference to a header-row target
  are still the PDF's refusals alone, and now stay in the published document for Word. A reference to
  an equation is `word_not_yet`, `detail` `crossReference`, named where the reference stands.
- **Footnote refusals are judged per note met**, following Word's count through the writer's sections
  as captions' are, once per matter: `prefix`, `restart`, `letters` and `roman` as planned, and
  `label`, a word the rule writes before the number, which Word's mark cannot carry.

**Footnotes (R2).** The note's number is followed by a space scaled by `w:w` to the engine's 0.05em,
since Word ignored `w:spacing` on the `w:footnoteRef` run; the reference style states superscript, not
a size and raise pinned to the engine's, which leaves Word's mark 0.19pt smaller and 0.42pt lower in
11pt text; a header row's mark is bold where the table style's header is. M1 d8 is written between
notes where the footnote style asks for contextual spacing, since Word applies it across footnotes.
The writer keeps relationships per part, a note's links and images related from `footnotes.xml.rels`.

**Bookmarks and fields (R3, R4).** `\r` holds for a heading's number, measured beside `\w` and `\n`,
which print the same full number from every context tried. A table's and a figure's page and place are
its caption's label bookmark; **a floated figure a reference names has a third bookmark** in its anchor
paragraph after the box, which `REF \p` names, since its caption's bookmarks stand in the text box,
another story, where Word printed the bookmark's words (the Word check). A target that publishes
nothing is a bookmark holding nothing beside the nearest paragraph of its flow. Every run of a field
carries the text's run properties, and **a number Word computes - `REF \r`, `NOTEREF`, `PAGEREF` - is
written without `w:rtl` in a right-to-left passage**, since Word drew those digits in Times New Roman
where the embedded face stood without it (the Word check). `\h` stands in a note's text as in a
paragraph's.

**The Word check (R6).** Eleven documents and 23 checks, green in Word 16: a references fixture of 93
fields, 17 bookmarks and footnotes in every matter, a Word-alone fixture with a note in a repeated
header row, and the right-to-left fixture with a Hebrew note and references. It found the right-to-left
digits, the floated figure's place and the nested caption. **In a Hebrew passage Word printed the
English above and below**, having no Hebrew words, where WO-C expected the passage's language; the
check records Word's words per language. Its new fixtures are compared with the resolved document, not
a compiled PDF, since what the PDF prints and where it links is the published run's.

**Citations.** PUB-025 and PUB-026 in `word/write.test.ts` on the XML, PUB-066 in
`apps/worker/src/word.test.ts`, and PUB-035's test there extended to footnotes and references; the
Word check cites PUB-029 alone, since CI skips it. The citations pin moved from 328 to 331.

**Left**: word-output.md's "Left for Word 4" - equations, a reference to one and the list of
equations, PUB-065 and PUB-035 with them, the two decisions for Ken, and the cases measured only as
XML.

## Tasks

1. **`assemble`** (`packages/domain`): R1 and R2's refusal - off `word_not_yet`, the trap undone for
   each, `numbering_not_in_word` for footnotes.
2. **Footnotes** (`packages/domain/src/word/`): R2.
3. **Bookmarks and cross-references** (`packages/domain/src/word/`): R3, R4, R5.
4. **The Word check** (`apps/worker`): R6, one recorded run; PUB-035's test extended.
5. **Docs**: word-output.md's "What was built" for Word 3, publishing.md, architecture, features and
   the README, CLAUDE.md's status, this plan's status, the writer's version (`word/3`), the version
   (Minor, 0.72.0) and the changelog; trace generate and pins.
