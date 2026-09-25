# Word 2: Lists, tables and figures in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as Word 1 was. It builds the second of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M): lists,
> quotations, preformatted text, tables and figures, with the report - and what Word 1's
> [What was built](../design/word-output.md#what-was-built) left for Word 2. Ken agreed the design's
> recommendations on 2026-09-25.

**Goal:** everything a document holds but footnotes, cross-references and equations reaches Word. A
list is a Word list, numbered or bulleted as the PDF's, nested to nine levels; a definition list is its
terms and definitions; a quotation and preformatted text are set as the PDF sets them, spaced as it
spaces them; a table is a Word table in its table style, its header rows marked, its caption above it
numbered by Word, its note after it; a figure is its image with its description or flagged decorative,
placed and sized by its image style against the Word page, its caption numbered by Word; an image
stands in a line of text or a table's cell. What Word cannot carry of a table - a header column, an
unrepeated header, a continuation label - is named in the report.

**Not in this slice:** footnotes, cross-references and their bookmarks, and the lists of figures,
tables and equations after the contents (Word 3); equations (Word 4). Each stays refused by name,
`word_not_yet`, and its PDF is unaffected.

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **TAB-039** (a caption programmatically associated with its table in every output): the Word half,
  `w:tblCaption` and the caption paragraph beside the PDF's existing test.
- **TAB-049** (header rows associated in every output; header columns where the format can, and the
  report naming each table that lost them): the Word half and the report.
- **PUB-035** (Word output accessible on the same terms): only if a test shows every construct Word
  2 carries accessible - headings' outline levels, a figure's description or decorative flag, a table's
  header rows marked and its caption associated, each run's language. Equations are refused until Word
  4, so a Word document never carries an inaccessible one; decide whether that makes the statement
  whole, and record it.
- **CNT-117, CNT-118, CNT-153** (lists of three kinds, nesting six levels, start and format) are
  Covered by the PDF; a Word test naming them is a second citation, not a completion - cite only if
  the trace's convention wants every output shown, and say which.
- **Not cited:** PUB-025, PUB-026, PUB-065, PUB-066 (Word 3); PUB-067, CNT-045, PUB-023 (Word 4);
  PUB-092 and STY-053 (as Word 1 said).

## Rulings

- **R1. Captions as fields, here.** The design put captions in Word 3; tables and figures arrive in
  this slice and a caption belongs with them, and M3 measured the fields. A figure's and a table's
  label is `{label word} {STYLEREF n \s}{separator}{SEQ <Sequence> \* <format> \s n}` where the
  layout's rule prefixes the chapter's number at depth `n`, or `{SEQ <Sequence> \* <format>}` where it
  does not, prefilled with the numbering table's label (M3); `numbering_not_in_word` is extended to the
  figure and table sequences - a rule Word cannot compute (a prefix at a depth with no heading style,
  a restart Word has no switch for, a separator Word cannot write, letters past _z_) refuses the Word
  publication by name. The default scheme passes. Word 3 keeps footnotes, cross-references and the
  lists after the contents. The design's WO-M line is corrected in this slice's docs.
- **R2. Off `word_not_yet`**: list, blockquote, preformatted, table, figure, inline image. Each one's
  PDF engine refusal - `line_too_wide` for preformatted text, `caption_too_long`, `image_too_wide`,
  `table_header_spans_body`, and whatever else drops a construct - must **stop dropping the construct
  for a Word-only request** (the trap Word 1 recorded): the failure is still the PDF's alone, but the
  construct stays in the published document when no PDF is asked for. A request for both still fails.
  Tested for each: a Word-only publication of a document that the PDF refuses carries the construct.
- **R3. Image sizes against the Word page.** `WordInput.images` is filled: each figure's and inline
  image's size resolved by its image style against the Word page's text block (width, the text
  block's height, the style's `em` against the paragraph's size), by the same function the PDF's sizes
  use; keyed by the published node and block for a figure and by the node, block and the image's
  place among the block's inlines for an inline one - choose the exact key and record it. The job
  hands the writer each asset's bytes by its path, as it hands it the faces.
- **R4. Lists** (WO-I): each list its own numbering definition, its kind and its format (`decimal`,
  `lowerLetter`, `lowerRoman`) at its level, `w:start` from its start, bullets by level as the PDF's
  (`• ◦ ▪` cycled, template 13's), its indents the PDF's (read the template's engine
  defaults - list indent and body indent - and state them, measured in both), nested lists at the next
  `w:ilvl`; nine levels, a deeper list refused by name (`list_too_deep` for Word, or folded into
  `numbering_not_in_word` - record it); an empty item kept as an empty numbered paragraph so the
  numbers below it stay the author's. A definition list is its term, set as template 13 sets a term (the same style and weight), and
  its definitions as paragraphs indented by the list's indent. List
  items' paragraphs take the `listItem` place's style.
- **R5. Quotations and preformatted text.** A quotation's blocks in the `quotation` place's style, its
  attribution a paragraph after them in the `attribution` role. Preformatted text: its label, if any,
  in `preformattedLabel`, then one paragraph per line in `preformatted`, spaces kept (`xml:space`),
  the panel as Word 1's projection sets it. **Two consecutive preformatted blocks, or a panel beside
  another paragraph of the same borders, stay separate panels as the PDF's are** (the final review's
  M4): measure what does it (`w:pBdr`'s `w:between`, or a spacing that differs, or another way) and
  write it.
- **R6. M1 d8 in the containers.** Where two same-style paragraphs of different containers meet - two
  quotations in a row, a list item's last paragraph and the next item's first, a quotation's last
  paragraph and the paragraph after it where their styles match, two cells' paragraphs never (cells are
  apart) - the writer turns contextual spacing off on the pair and drops the facing spaces the PDF
  drops, measured in M1 (d8), so every gap is the PDF's within a point. The Word check measures the
  quotation pair.
- **R7. Tables** (WO-F): the table style projected into `styles.xml` as a Word table style - rules
  (`w:tblBorders` outer and inside, widths and colours), padding (`w:tblCellMar`), header row fill and
  weight (`w:tblStylePr firstRow`), header column fill and weight (`firstCol`), banding by `band2Horz`
  with `w:tblStyleRowBandSize` 1 (M14); the table naming it with the matching `w:tblLook`; columns equal
  (`w:tblW` 5000 pct and an equal `w:tblGrid`); merged cells by `w:gridSpan` and `w:vMerge`; every
  header row `w:tblHeader` (so it repeats: WO-F); `w:cantSplit` on each body row where the style keeps
  rows whole; cells holding paragraphs (in `tableCell`) and lists. The caption a paragraph **above** the
  table in the `caption` role, `w:keepNext`, its label by R1, and the same words as `w:tblCaption`
  (TAB-039); the note a paragraph after it in `tableNote`. **Report entries**: `header_column_lost`
  naming each table with header columns, `header_repeated` naming each whose style does not repeat its
  header, and `continuation_label_omitted` naming each whose style asks for a label - closed shapes
  added to the report's kinds, stored and served as Word 1's are, each a sentence on the publication
  page.
- **R8. Figures and images** (WO-G): a figure's image in a paragraph of its own in the `figure`
  image style's alignment, as a `w:drawing` `wp:inline` with its size from R3, its description in
  `wp:docPr`'s `descr` (the language cannot be carried - Word has none - which the report does not
  name, being true of every Word document) or the decorative extension (M7); a floated one as
  `wp:anchor` `wrapTopAndBottom` at the head of the text area (`relativeFrom="margin"`, `align="top"`,
  M7); its caption a paragraph **below** in the `caption` role, its label by R1. An inline image as a
  `wp:inline` in its run, sized by R3, in text and in cells. Media parts `word/media/` by the asset's
  hash and extension, each once, related from the document; content types for PNG and JPEG.
- **R9. The Word check** gains fixtures for every construct above: lists of each kind, format and
  start, nested to nine; a definition list; a quotation pair with attributions; two consecutive
  preformatted blocks and a preformatted line that just fits the PDF's measure (Word 1's note: Word's
  half-point sizes and narrower panel can wrap it - measure and either fix it or record what Word does);
  a table crossing a page with header rows, a header column, merged cells, banding, a note; a figure
  inline and floated, decorative and described; inline images in text and a cell. It checks the list
  strings against the PDF's numbers, the quotation gap, the separate panels, the header rows repeated,
  the caption labels after an update against the numbering table, the images' sizes and alt texts.

## Tasks

1. **`assemble`** (`packages/domain`): R2 and R3, and R1's `numbering_not_in_word` for figures and
   tables - the constructs off `word_not_yet`, the trap undone for each with a test, `WordInput.images`
   filled.
2. **Lists, quotations and preformatted text** (`packages/domain/src/word/`): R4, R5, R6.
3. **Tables** (`packages/domain/src/word/`, `packages/domain/src/theme/`, the report through
   `packages/db`, `apps/service` and `apps/web` as Word 1's entries go): R1's table captions, R7.
4. **Figures and images** (`packages/domain/src/word/`, `apps/worker`): R1's figure captions, R8, the
   job handing the writer the assets' bytes.
5. **The Word check** (`apps/worker`): R9, one recorded run.
6. **Docs**: word-output.md's "What was built" for Word 2 (and WO-M's captions line), publishing.md,
   architecture, features and the README, CLAUDE.md's status, this plan's status, the version (Minor,
   0.71.0) and the changelog; trace generate and pins.
