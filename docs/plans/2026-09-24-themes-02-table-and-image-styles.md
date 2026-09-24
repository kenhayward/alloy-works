# Themes 2: Table and image styles

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as themes 1 was. It builds themes.md's [Themes in the PDF](../design/themes.md#themes-in-the-pdf)
> decisions TH-I and TH-J, the second of TH-K's build slices, and gives back the quotation the set-off
> themes 1 took from it.

**Goal:** a table and an image take their appearance from their style in the theme, as a paragraph
already does. A table style says how its header row and header column are set, whether its body rows
are banded, which rules it draws, how far its cells are padded, whether its header repeats on each page
it crosses, whether a row is kept whole, and whether a label in the layout's words says it continues. An
image style says which dimension it fixes and at what, the most the other may be, and whether the image
stands in its line, as a block, or floated to the head or foot of the page, aligned within it. A
paragraph style may ask for **contextual spacing**, as Word's does, and the default theme's quotation
takes back the space around it that template 11 gave it.

**Not in this slice:** alignment by column type (STY-077, T2, with STY-014's field formats); a list's
indents, a definition list's hanging indent and separator, the contents' leader and the underline's
offset, which stay the engine's; the Word projection (with Word); the theme in the editor.

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **STY-076** (a table style declares header row and column treatment, banding, rules and borders, and
  cell padding): two table styles differing in each, read back from the PDF.
- **STY-013** (a table style declares whether headers repeat, what continuation label appears, and what
  must be kept together), **PUB-017** and **TAB-032** (a table breaking across pages behaves as its
  style declares): a table crossing pages under each setting, read back.
- **STY-015** (an image style declares which dimension it fixes and at what value), **STY-017** (a
  maximum in the other dimension, the image constrained by it where it would be exceeded, proportion
  kept) and **STY-016** (the other dimension derived from the asset's proportions, never distorted):
  `assemble`'s sizes and the PDF's boxes.
- **STY-018** (placement inline, block or floated, with alignment): each placement and alignment read
  back from the PDF.
- **Not cited:** STY-019 - an asset version cannot be stored without its dimensions (AST records them
  on ingest), so the failure it asks for cannot arise; the design says so rather than a test pretending
  to reach it. CNT-122, whose editor half is the theme in the editor's. STY-077.

## Rulings

- **R1. `catalogue/2`**, a second version of the catalogue shape, as the layout has versions; the reader
  reads a `catalogue/1` by upgrading it, filling what version 2 adds with template 12's look, so every
  version stored so far still reads. What it adds:
  - **A table style**: `headerRow` and `headerColumn`, each a `fill` (a colour or `none`), `bold`
    and a `rule` (below the header row, after the header column); `banding`, a `fill` for alternate
    body rows or `none`; `rules`, each of `outer`, `horizontal` and `vertical` a width in points and a
    colour, or `none`; `padding`, a cell's inset in points; and `breaks`: `repeatHeader`,
    `keepRowsWhole` and `continuationLabel`, each a boolean.
  - **An image style**: `fixed`, the dimension it fixes - `width` or `height` - and its value in
    points, as a fraction of the measure (a width), a fraction of the text block's height (a height),
    or in ems of the text it stands in (an inline image); `maximum`, the most the other dimension may
    be, in the same units; `placement`, `inline`, `block` or `float`, `inline` only for a style that
    applies to `inlineImage` and the other two only for `figure`; and `alignment`, `start`, `centre`
    or `end`. A floated figure goes to the head or foot of the page, whichever the engine finds room at,
    aligned within that band (measured in the design: there is no other float).
  - **A paragraph property**, `contextualSpacing`: between two consecutive paragraphs of one style that
    both ask for it, neither's space before or after is added, as Word's `w:contextualSpacing` does.
    The reader checks each text colour a table style can put text on - the header's and the band's fills,
    under the `tableCell` place's style and bold where the header is - by themes 1's contrast rule.
- **R2. The layout's `words.continued`**, by layout schema 4: the words a continued table's label adds
  after its label, in the layout's language, required once version 4 is read, and refused as missing
  under a table style that asks for a label with a layout that has none. The default layout's version
  0.5 says `(continued)`.
- **R3. The default theme's new numbers are template 12's look**: every table ruled 1pt black, inside
  and out, as the engine draws them; padded 5pt; the header neither filled nor bold; no banding; the
  header repeated, rows allowed to split, and **no continuation label** - measured in the design, a label
  leaves an empty header cell in the structure tree on a table's first page, which is a cost a theme
  should choose. A figure fixes its width at the measure, at most 60 per cent of the text block's
  height, as a block, centred; an inline image fixes its height at 1.2 ems, at most the measure wide.
  **The quotation gets its set-off back**: its style's space before and after are template 11's, and it
  asks for contextual spacing, so a quotation's own paragraphs stand a line apart. They were 2.75pt
  further apart in template 11, and that is the one distance this changes, recorded as such.
- **R4. The store**, by migration `0025_table_and_image_styles.sql`: the paragraph, table and image
  catalogues' version 0.2 and the theme's version 0.2 naming them, and the default layout's version
  0.5, each inserted only where the environment still has the product's own chain at the version
  before, guarded on its content hash, as 0019, 0021 and 0023 guarded the layout's; their literals
  recomputed by the default theme's and the default layout's tests.
- **R5. `assemble` and `publishing/13`**. `publishing/12` is frozen. A published table carries its
  resolved table style; a figure and an inline image carry their placement and alignment, and their
  sizes computed from their style: the fixed dimension, the other derived from the asset's pixels,
  re-derived from the maximum where it would exceed it (and, for a figure, from what the caption leaves
  of the page, as today); an inline image no taller than its fixed dimension says. The document's
  `words` carry `continued`. The measures in `assemble` that stood for the engine's table - `CELL_INSET`
  among them - read the table style.
- **R6. Template 13**, a new directory, template 12 frozen, `TEMPLATE_READING`,
  `PUBLISHING_SCHEMA_CURRENT` and `PIPELINE_VERSION` moved as before. It sets a table's strokes, fills,
  inset, header weight, header repetition and each row's breakability from the style, the label
  `pdf.artifact` in a zero-height first header row on a page after the table's first, as the design
  measured; a figure's size, placement and alignment from its style, floated through `figure`'s own
  `placement`; and the contextual spacing between paragraphs. Template 12's header comment names what
  stays the engine's; template 13's names what still does, and the literal test holds it.
- **R7. The worker's test**, `table-and-image-styles.test.ts`: two table styles, differing in every
  property, over a table crossing pages - fills, strokes and weights from the content stream and the
  text, padding from positions, the header repeated or not, a tall row whole or split, the label on
  each continued page and not the first; and every image placement and alignment, a fixed width and a
  fixed height each constrained by its maximum, and proportion kept; each compile passing veraPDF.

## Tasks

1. **The model** (`packages/domain`): R1 - `catalogue/2`, the upgrade from 1, the reader's checks and
   contrast on fills, the Typst projection of table and image styles and contextual spacing; and R2's
   layout schema 4.
2. **The store** (`packages/db`): R3's data and R4 - migration 0025, the literals and their tests.
3. **`assemble` and the template** (`packages/domain`, `apps/worker`): R5, R6 and R7 -
   `publishing/13`, the sizes and placements, template 13, the pins, the worker's test.
4. **Docs**: themes.md's and publishing.md's "What was built", the design's STY-019 note, architecture,
   features and the README, CLAUDE.md's status, this plan's status, the version (Minor, 0.69.0) and the
   changelog; trace generate and pins.
