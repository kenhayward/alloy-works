# Footnotes 2: Publishing footnotes and the table's note

> **A sketch**, built inline and test first, with one final whole-branch review before the pull
> request, as footnotes 1 was. It builds publishing.md's [Footnotes](../design/publishing.md#footnotes) -
> "How a footnote is published" and decisions FN-B, FN-C and FN-D - over the footnotes and notes
> [footnotes 1](2026-09-23-footnotes-01-footnotes-in-the-editor.md) lets an author write. It is the
> second of FN-F's two pull requests.

**Goal:** a document holding footnotes publishes them: each set at the foot of the page its mark is on,
numbered with the outline's number for it, tagged as a note; and a table's note is set beneath the
table, inside its figure. A footnote anywhere but a paragraph, anchored to the table as a whole, with no
text, or anchored to a cell its table does not have, is refused by name.

**Not in this slice** (FN-A): key columns in the editor. A footnote stored anchored to a cell by key or
by position is resolved and published, since publishing.md says so; nothing makes one yet.

**Requirements:**

- `assemble`'s tests cite **CNT-042**: a footnote whose anchor does not resolve fails the publish,
  `footnote_anchor_unresolved`, naming the footnote.
- The worker's regression case cites **PUB-016** (each footnote's text on the page carrying its
  anchor, on a document long enough that notes fall on several pages), **CNT-036** (a footnote anchored
  to a span, published) and **CNT-038** (a table's note, published with its table), each read back
  from the PDF.
- **Not cited:** CNT-079 is claimed by no design; CNT-041 is the outline's and covered there; PUB-051
  and PUB-072 are constraints listing many refusals, of which this slice builds one.

## Rulings

- **R1. `publishing/9`, template `publication/9`.** `publishing/8` is frozen for template 8's sake, as
  each version before it was. Template 9 is template 8 with a footnote branch in `run` and the note in
  a table's figure, and nothing else.
- **R2. A published run may be a footnote**: `{ footnote: { label, paragraphs } }` beside a text run and
  an image, `label` the numbering table's for it and `paragraphs` published paragraphs of text and image
  runs. Only a paragraph's runs hold one.
- **R3. Where a footnote may stand** (FN-B): a paragraph, wherever it is - running text, a list's item, a
  quotation, a table's cell. In a caption, a term, an attribution or a table's note it is refused,
  `footnote_not_publishable_here`, naming the block that holds it; in a section's title the same code
  names the section. So is one anchored to the table as a whole (FN-C), naming the block it stands in.
- **R4. Its paragraphs** are published as a paragraph's are - body style, marks, glyphs, languages - and
  their failures name the footnote. A footnote with no text at all is refused, `footnote_empty`, naming
  the footnote: the editor places one with an empty paragraph, and a numbered mark over nothing would
  publish a note the author never wrote. Its empty paragraphs are dropped, as a component's are.
- **R5. An anchor to a cell resolves against the table the footnote stands in** (CNT-042). By position,
  the grid must hold that row and that column. By key, the table must declare **one** key column and a
  row whose key cell's words are the key: a key over several key columns is not yet defined - nothing
  makes one, and the key-columns slice after footnotes decides how one is spelt - so it does not
  resolve rather than being matched by a rule invented here. One standing outside any table does not
  resolve. Each fails `footnote_anchor_unresolved`, naming the footnote. A resolved footnote is set
  where it stands, since in an authored table it stands in its cell's text already.
- **R6. The label** is the numbering table's for the footnote, never guessed. (The final review found
  it can also be unknown where a scheme prefixes footnotes and no numbered section comes before one; see
  below.)
- **R7. The table's note** (CNT-038, FN-D) is published as runs on the table - `note`, or null where
  there is none or it holds no text - and set inside the table's `figure`, after the table, a point
  smaller than the body. Its tagging is measured in the build; if the engine tags it wrongly inside the
  figure, it is set as a paragraph after the figure instead, and this plan says so.
- **R8. The template, as measured** (publishing.md, "What the pinned Typst does with a footnote"):
  `footnote(numbering: _ => label, body)`, the body the footnote's paragraphs with a paragraph break
  between each; a language inside keeps its region, as a run's already does.
- **R9. The web's sentences**: `footnote_not_publishable_here` - _A footnote stands where it cannot be
  published. A footnote can stand only in a paragraph's text; a note on a whole table is the table's
  note._; `footnote_anchor_unresolved` - _A footnote is anchored to a cell its table does not have._;
  `footnote_empty` - _A footnote has no text. Write it, or delete its mark._ The codes join the
  contract's enum, and `openapi.json` and the client are regenerated.

## What the build changed

- **R7's note is set after the table's figure, not inside it.** Measured: a figure whose body is more
  than its table is tagged a `Div` holding the `Caption` beside a second `Div` of the `Table` and the
  note, so the caption stops being the table's own first child and the table loses its programmatic
  caption (TAB-039). After the figure the note is a `P` straight after the `Table`, which the regression
  case holds, with the caption still the `Table`'s first child. It no longer travels with the table: at
  a page's end the note can begin the next page.
- **R8's body is not a `par` per paragraph.** The regression case caught it: the engine sets the number
  before the note's body, and a body opening with a `par` put the number in a paragraph of its own
  above the words, so at the foot of a page the number stayed beneath its anchor while the words went
  to the next page. Keeping each note whole instead was measured and rejected - a note taller than a
  page left its anchor's page and ran off the foot of another. Joined by paragraph breaks, the number
  opens the first paragraph and a long note begins on its anchor's page and carries on; the regression
  case holds an eighty-paragraph note to both.
- **The measurements were made with throwaway spikes** that printed the structure tree with the text
  under each element; none is kept.

The final whole-branch review found three things and seven smaller; these were changed, each test
first:

- **A footnote in a table's header row made the engine refuse a table that crosses a page** - the
  repeated header is an artifact, and a link in one is refused outright, naming nothing. `assemble`
  refuses it, `footnote_not_publishable_here`, naming its paragraph; a header column is published.
- **A note was tagged in the document's language**, not its component's: the engine lays it out at the
  foot of the page. Template 9 carries the language and direction at the mark into the note, and
  `readPdf` gains each `Note`'s spoken language, read up the tree as a figure's is.
- **R6 was wrong**: a scheme that prefixes footnotes with their chapter gives none a number in a part
  with no numbered section before it, and the footnote printed with an empty mark. It is refused,
  `footnote_unnumbered`, naming it, with a sentence on the publishing page. The layout's parse is not
  tightened instead: layout versions are insert-only.
- **Smaller**: spaces alone make a footnote empty and a note none; every reason a footnote is refused
  is said; a request made before layouts keeps its old sentence for a title's footnote; template 9's
  header comment and a split doc comment corrected; and the docs no longer say footnotes are numbered
  straight through without saying the front matter and each appendix count on their own, and say that
  a table's note can begin the next page.
- **Not changed**: a cell anchor resolves against any cell the table has, not only the footnote's own
  (R5, and publishing.md now says so for the key-columns slice); and near a page's end a table's caption
  stops being its `Table`'s first child whatever it holds - template 8 does the same, so it is not this
  slice's, and is raised on its own.

## Tasks

1. **`packages/domain`, `assemble`**: `publishing/9` with a footnote run and a table's note (R1, R2,
   R7), the refusals and the anchor (R3 to R6), the three codes. Tests for the shape, each refusal and
   each anchor, citing **CNT-042**.
2. **`apps/worker`, template 9** (R8), the version maps at 9, and the regression case citing
   **PUB-016**, **CNT-036** and **CNT-038**, with the note's tagging measured.
3. **The contract and the web**: the codes, `openapi.json` and the client regenerated, R9's sentences.
4. **Docs**: publishing.md's and component-editor.md's notes, architecture, features, the README,
   CLAUDE.md, this plan's status, the version (Minor, 0.62.0) and the changelog; trace generate and
   pins.
