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
  - **Contrast**: the reader checks each text colour a table style can put text on - the header's and the band's fills,
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

## What the build changed

**The model.**

- **The default theme states two chains, and the plain names are the newer.** As the layout's are,
  `DEFAULT_THEME`, `DEFAULT_CATALOGUES`, `DEFAULT_CATALOGUE_VERSIONS` and `DEFAULT_CATALOGUES_BY_VERSION`
  are the current version, 0.2, and 0.1 is frozen under `FIRST_*`, byte for byte what 0024 seeded, with
  a header comment in `default.ts` stating both. 0.2 gives the paragraph, table and image catalogues a
  second version each at `catalogue/2`, under fixed identifiers, and the theme's own 0.2, whose
  identifier is fixed too (`DEFAULT_THEME_VERSION`), names them; the character, admonition and citation
  catalogues keep 0.1's rows, still at `catalogue/1`. Tests pinning 0024's rows and template 12's
  measures use `FIRST_*`.
- **`catalogue/2` is one version for every kind**, and `catalogue/1` is kept as `catalogueSchema1`,
  frozen. The reader holds a version 1 catalogue to it first and upgrades it in memory with
  `upgradeCatalogue1`, the chain's one step, filling what version 2 adds with template 12's look. A
  table style and an image style are **whole**: every property required, nothing inherited, no
  `basedOn`. Bounds: a fraction of the measure or of the text block's height in (0, 1], ems in (0, 10],
  points in (0, 1584], the theme's own point bound, a rule's width 0.25 to 12 and padding 0 to 36. A
  shape error is `catalogue_malformed`; three new codes name the rest - `image_unit_wrong_dimension` (a
  fraction of the measure for a height, of the text block's height for a width), `image_unit_not_applicable`
  (ems on a style for a figure) and `image_placement_not_applicable`. A style applying to both `figure`
  and `inlineImage` can never hold, since no placement serves both, and is refused; none is stored.
- **An inline image style states no alignment** (accepted). The image style is a union on `placement`:
  `inline` refuses `alignment`, and `block` and `float` require it, by TH-D's rule that a property which
  does nothing silently is worse than one that is absent. R1 said the alignment would be ignored.
- **The quotation's spacing is split with its attribution** (accepted). One `spaceAfter` on the quotation
  cannot give both template 11's 33.6 into its attribution and its 27.0 into the text after it, and R3's
  "space before and after" would have put a bare quotation 6.6pt further from what follows than template
  11 did, measured. So the quotation takes **16.5** before and **12.65** after, and the attribution
  **6.6** before and **12.65** after; its alignment stays `end` and the quotation's indents 11 and 11. Template
  11's distances were measured from a copy of its quotation settings compiled by the pinned Typst and read
  with `typst query`, which reproduced themes 1's four and gave the one it had not measured, a bare
  quotation into text. Template 13's are its baseline-to-baseline rule, the first's space after, the
  second's space before and the second's line spacing, 14.35 for every 11pt style here, and were then
  read from compiled PDFs of both templates:

  | Distance, baseline to baseline        | Template 11 | Template 12 | Template 13                         |
  | ------------------------------------- | ----------- | ----------- | ----------------------------------- |
  | Text into a quotation                 | 33.60       | 17.10       | 33.60 (2.75 + 16.5 + 14.35)         |
  | One quotation paragraph into the next | 17.10       | 17.10       | **14.35** (contextual: the leading) |
  | Quotation into its attribution        | 33.60       | 17.10       | 33.60 (12.65 + 6.6 + 14.35)         |
  | Attribution into text                 | 27.00       | 17.10       | 27.00 (12.65 + 0 + 14.35)           |
  | Text into a bare quotation            | 33.60       | 17.10       | 33.60                               |
  | Bare quotation into text              | 27.00       | 17.10       | 27.00 (12.65 + 0 + 14.35)           |

  Every template 11 distance is back but one, a quotation's own paragraphs, 2.75pt closer than template
  11 set them, which is R3's recorded move. Everything after a quotation moves down by the sum and
  paginates differently. Nothing else moves: the same document without quotations, compiled by
  template 12 under 0.1 and by template 13 under 0.2, paints every run, stroke and fill identically to
  within 0.005pt.

- **Contrast is judged on a table's fills for a list in a cell too** (the coordinator's ruling). The
  reader judges the `tableCell` place's style, and the `listItem` place's where that is another style,
  on every header row, header column and band fill that is not `none` - bold where the header is, else
  the style's own - unless the style has a background of its own; a mark by themes 1's rule, once per
  mark, colour, fill and ratio across both styles.
- **Layout schema 4 is as R2 said.** `words.continued` is required of a layout written at version 4 and
  absent from one read at versions 1 to 3; the step from 3 is the identity. The default layout's 0.4 is
  frozen as `FOURTH_DEFAULT_LAYOUT`, and `defaultLayout` is 0.5.

**The store.**

- **A `catalogue/1` saved again unchanged answers unchanged** (the coordinator's ruling). The reader
  returns a version 1 catalogue upgraded, and the store writes what it returns, so its digest differs
  from the stored row's and a save of the same catalogue would have recorded a version. So
  `addCatalogueVersion` passes the latest version as the reader read it - its id and its digest as
  upgraded - to `recordReadVersion` as `latestAsRead`, and the chain compares against it only while that
  id is still the latest, keeping its own order: artifact missing, stale, kind, then unchanged.
- **Migration 0025 guards each chain on its own.** The paragraph, table and image catalogues' 0.2 each
  go in only where that catalogue is still 0024's own 0.1 - unauthored, its content hash 0024's literal,
  nothing after it; the theme's 0.2 only where the theme is still 0024's 0.1 by the same test **and** all
  three catalogue 0.2s exist, which only 0025 writes; the layout's 0.5 only where it is 0023's 0.4, as
  0023 guarded 0.3. The literals were computed from the domain's data by a script whose hashes for 0.1
  and 0.4 matched 0024's and 0023's. Two consequences, accepted:
  - **Where an environment has its own theme version, the catalogue 0.2s it gets are unused**: nothing
    names them, and its catalogues' latest versions are ones its theme does not bind.
  - **An environment that recorded its own version of any of the four keeps the old look** for good:
    its theme stays 0.1, its tables and images set as template 12 set them through the reader's upgrade,
    until its own theme is changed.
- **The saved-0.1 half of the guard is not tested** for the catalogues and the theme. No environment can
  hold another 0.1 under the default's identifiers - 0024 inserts only where none exists - and faking one
  is 0018's heavy rigging. The own-version cases test the "nothing after 0.1" half; the hash half is
  written as 0023's is, and neither 0023's tests nor 0021's rig one.
- A request made at 0024 and still waiting keeps 0.1, and is handed it resolved; one made after 0025
  records 0.2.

**`assemble` and `publishing/13`.**

- **`publishing/13`'s shape.** `theme` is `projectTypst`'s `TypstTheme`: every paragraph style **with its
  `id`**, so the template can tell one style from two with equal values for contextual spacing, and
  `contextualSpacing` on each; `tables` and `images`, by id. `projectTypst12` and its types are
  `publishing/12`'s, frozen, and `PUBLISHING_SCHEMA_12` beside them. `words.continued` is a string or
  null, null for a layout read at schema 3. A `PublishedTable` carries `style`, its table style's id,
  which the template looks up; a `PublishedFigure` `placement`, `block` or `float`, and `alignment`, in
  the engine's spelling; an image in a line `placement: 'inline'` and no alignment.
- **`continuation_words_missing`** is a new failure: a table whose style applies and asks for a label,
  under a layout with no `continued`, naming the table and, in `detail`, the style. The publishing page
  says the layout or the theme has to change. The continued words are glyph-checked as a layout word,
  `layout_glyph_missing`, against the caption role's family, whether or not a table asks for them, as
  the contents' title is.
- **Sizes are the style's.** The fixed dimension from its unit - points; a fraction of the layout's
  measure; a fraction of the text block's height; ems of the style or role the image stands in - the other
  from the pixels, and both re-derived from the maximum where the other exceeds it (`imageLength`,
  `styledSize` in `measure.ts`). A figure is then held to the room where it stands and to what its
  caption leaves, as before; `FIGURE_HEIGHT_SHARE`, `CELL_INSET`, `INLINE_IMAGE_EMS` and
  `inlineImageHeight` are gone, and a cell's room is its share less twice the table style's padding.
- **"Measure" is the layout's measure**, the text block's width, which is the editor's column as the
  design says, not the room where the image stands; the room caps after. So every existing figure's
  size is kept, the 429.28pt figure in a quotation among them.
- **A very wide image in a line at the top level is shrunk to the measure, not refused.** The default
  inline style's maximum of 1 measure and R5's re-derivation make a 6000 by 100 image 451.28 by 7.52
  where it was `image_too_wide`. That is STY-017's rule, but it changes a refusal, so two domain tests
  were rewritten openly rather than loosened: each now stands its image in a quotation, whose 429.28 is
  narrower than the maximum. An image in a line still wider than its room - a quotation's, a cell's - is
  refused as it was.
- A figure whose image style says `inline` is refused by the reader, so `assemble` throws on one as a
  caller's defect.

**The template.**

- **Header rows repeat by `repeatHeader`; the label by a two-level header.** Without a label a table's
  header is `table.header(repeat: repeatHeader, ..)`, template 12's structure. With one, a label header
  at level 1 always repeats, and the header rows at level 2 repeat by the style - measured: the label
  goes on while the header rows do not. The label is `pdf.artifact`, set in the caption role's style and
  alignment, padded by the table's inset, reading "Table 3 (continued)", or the words alone for a table
  with no number, in the layout's language; the page test compares the page with the table's own by
  `query(selector(table).before(here()))`, which relies on no table standing in a table, as the model
  holds.
- **The label leaves an empty header cell on page 1**, as the design measured: its row takes no height
  there - the header's baseline is where an unlabelled table's is - but the structure tree holds an
  empty `TH`, which the worker's test counts. This is why the default asks for no label.
- **A table broken across pages is framed on each page.** The engine draws the first and last lines of
  each page's part in the outer rule, measured and kept. Each rule is decided once, by the cell after it;
  the header row's rule is a `table.hline` inside the header, so it repeats with it; the foot and the
  far side are drawn in the outer rule. A table's rules take no room: text starts at exactly the
  padding, 3pt rules and all.
- **Header bold is applied to the text**, `show text: set text(weight: ..)`, so it wins over the cell
  style's weight and a mark's, measured; the corner takes the row's weight, else the column's. Fills: the
  header row's, the corner included, then the header column's, then the band, which starts on the first
  body row. A header that is not bold leaves the cell style's weight alone.
- **Contextual spacing is applied wherever template 12 summed spaces**: between blocks, between a
  footnote's paragraphs and two footnotes, between contents and list entries, and between a table's
  caption and its cells. Nothing but the quotation asks for it under the default.
- **Every figure is wrapped in a full-width block** aligned by its style, centre included, measured to
  move nothing under the default; under another theme a caption not centred now aligns to the measure,
  not to the figure's box. A float is `figure(placement: auto)`: the engine chooses head or foot, and an
  author cannot.
- **The literal test's allowlist is unchanged.** It now reads templates 12 and 13, and 13 still needs
  every entry; its new lines use only `pt()`, `colour()`, `0pt` and `width: 100%`. Template 13's header
  names what is still the engine's: a list's and an enumeration's indents, the definition list's hanging
  indent and separator, the contents' leader and indents, the underline's offset and thickness, a
  script's raise, and a footnote's separator, clearance and indent.
- The worker's PDF reader reports a stroke's `width`, the line width times the matrix's scale, which the
  table test reads rules by.

**The record.**

- **Citations.** STY-015 with STY-016, and STY-017, in the domain's `assemble.test.ts`; STY-076, STY-013
  with PUB-017 and TAB-032, and STY-018 in the worker's `table-and-image-styles.test.ts`, each compile
  passing veraPDF. `default-theme.test.ts`'s STY-024 title now says 0.2.
- **STY-019 stays claimed and is not cited.** It asks a publish to fail, naming the asset, where no
  dimensions are recorded; an asset version cannot be stored without its dimensions, which ingest
  records, so the failure cannot arise and a test could only pretend to reach it. themes.md says so.

The final whole-branch review found three ways a theme other than the default publishes a wrong PDF
that veraPDF passes and nothing names - a row kept whole painted off its page, an image in a line
taller than its page, and a rule drawn over its cells' text - a contrast check that judged only the
places' default styles on a table's fills, and, on the default theme, two quotations in a row set as
one, which the docs did not record. These were changed:

- **I1, a row is kept whole only where it fits a page**, as Word's `cantSplit` gives way and as
  keep-together keeps a paragraph (themes 1's I1). Where a style keeps rows whole, template 13 wraps
  the table in `layout`, measures each run of body rows a spanning cell joins - as a table of the same
  columns and inset holding those cells alone, at the width the table stands in - and makes its cells
  unbreakable only where that height is no more than the text block's, less the header rows where they
  repeat and the label's row where there is one. One unbreakable cell keeps every row it spans on one
  page, so a run is kept, or not, together. The worker test compiles a row of forty lines under a kept
  style with a label, the same without one, and a labelled style that lets rows split: every baseline
  inside the text block, every line set once, the row begun on the table's page beneath the row before
  it, and veraPDF passing; the eight-line row that fits still moves whole.
  Template 13's hash moved.
- **I2, an image in a line is held to the text block's height.** `assemble` makes one its style would
  set taller the text block's height, its width re-derived, the proportion kept, before the width is
  held to its room as before; the reviewer's 1584pt style is the domain test's case. **An image style's
  ems are held to 4**, not 10: nothing released holds an image style, so no migration is written, and
  the default's 1.2 still reads.
- **I3, a rule is never wider than twice the cells' padding.** A rule takes no room, so half of it
  stands inside the cell each side of it; the reader refuses a table style any of whose rules - outer,
  horizontal, vertical, or a header's - is wider than twice its padding, a new code,
  `table_rule_over_text`, naming the style and its widest rule. An unpadded domain test's style is
  now unruled too. The outer rule reaching half its width into the margin is recorded, not fixed.
- **I4, contrast on a table's fills judges every style a cell's text can be set in**: each paragraph
  style that applies to `tableCell` or to `listItem`, the places' own first, and every mark in each,
  not only the two places' defaults; the reviewer's 3.01:1 is the reader test's case. The reader
  tests that judge the cell's own style make `body` apply to running text alone, so they judge the one
  style they change.
- **I5, contextual spacing applies only within one container**: between two blocks of one flow - one
  quotation's, one list item's, one cell's, one note's, the top level's - neither of which is a list,
  a quotation, a table or a figure. Across a container's edge both spaces add, whatever the styles ask,
  and so between two notes, and between a table's caption and its cells. Two consecutive paragraphs of
  one style at the top level that both ask for it still stand only their leading apart, as Word sets
  them. **Two quotations in a row now stand 43.50 apart, not template 11's 33.60**: the first's 12.65
  after, the second's 16.5 before and its 14.35, which add where template 11's engine took the larger.
  No pair of spaces gives template 11's three distances at once - 33.60 from text into a quotation
  needs 16.5 before, 27.00 out of one into text 12.65 after, and those two together are 43.50 - so
  the table above gains a seventh row, a second distance that moves, and themes.md, the changelog and
  features say so. The worker test measures both quotations under the default and the top-level pair
  under a theme whose running text asks for it. **Word will see two consecutive quotations as one run
  of Quote paragraphs**, since its contextual spacing does not know where one quotation ends: the Word
  projection must pin the space at that boundary directly, as `wordRun` pins a run.

  | Distance, baseline to baseline   | Template 11 | Template 12 | Template 13                      |
  | -------------------------------- | ----------- | ----------- | -------------------------------- |
  | One bare quotation into the next | 33.60       | 17.10       | **43.50** (12.65 + 16.5 + 14.35) |

Left as found:

- **M1, padding is not held against narrow columns.** A padding of 36 on four columns of the small
  page's 62.5 leaves each cell -9.5pt, and `assemble` measures the negative width without refusing, so
  ordinary words overrun each other and the table's edge. Overlong words in narrow columns could
  already do so at the default's 5pt; bounding a padding against a column needs the column, which only
  a table has, and waits for a check at publish time where the theme and the layout meet, as themes 1's
  M2 does.
- **M2, a float inside a list item or a quotation stays in the flow.** The engine's float is relative
  to its container, so a figure floated there is set as a block where it stands, and nothing puts it at
  the page's head or foot. The default's figure style is a block, so the default path is unaffected;
  STY-018, themes.md and features describe the float at the top level.
- **M3, a `catalogue/1` image style applying to both figures and images in a line is now refused**,
  `image_placement_not_applicable`, where themes 1's reader accepted it. No stored row can hold one:
  only the migrations write catalogues, and the product's default names its two apart. `schema.ts`'s
  rule that a later reader accepts whatever a parse accepted stands for every row that can exist.
- **M4, a table style has no text colour**, so a dark header with light text cannot be expressed: a
  header's fill is judged against the cell styles' colours, which must also pass on the paper. It waits
  for a widening, with the Word projection's header text colour.

Found while I1 was fixed, and fixed on the coordinator's ruling: **a row the engine split beneath a
continuation label was set as though the label took no room on the pages it continued onto.** The
label's row took no height on the table's first page, as designed above, and the engine sizes a split
row's later parts from the page the row begins on, so each continued page's last line of the row stood
below the text block by up to the label's height - measured, one line of forty at 47.0 where the text
block ends at 54, on each continued page, kept whole or not; whole rows were unaffected. **The first
page now carries the label's room**: template 13 sets the label there hidden, `hide` inside the same
`pdf.artifact`, so the row is as tall on every page and the structure tree is as it was - one empty
`TH` on the first page, veraPDF passing. The header row on the first page stands exactly the label's
row lower than without a label, **27pt** under the worker test's ruled style, as on a continued page; the STY-013 test measures both and holds them equal, and
the I1 test runs under the labelled styles, kept and splitting. Template 13's hash moved again.

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
