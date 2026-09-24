# Themes 1: The theme in the PDF

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as equations 2 was. It builds themes.md's [Themes in the PDF](../design/themes.md#themes-in-the-pdf)
> decisions TH-A to TH-H: the first of TH-K's two build slices. Ken agreed every recommendation on
> 2026-09-24.

**Goal:** every publication is set from a stored theme. The product's default theme - a paragraph, a
character, a table, an image, an admonition and a citation catalogue, and the three pinned faces - is
seeded, made the environment's, and recorded on every publication request; `assemble` resolves it
once and hands its Typst projection to the template in `publishing/12`; template 12 sets every face,
size, weight, posture, colour, space and line from it and from nothing else, by the rules ADR-0014
measured. A style a document uses that the theme lacks, or uses where it does not apply, and a face
the theme may not embed or the worker does not hold, fail the publish by name.

**Not in this slice:** table and image style properties, the continuation label and layout schema 4
(themes 2 - their catalogues exist here, holding today's identifiers with no properties); small
capitals and letter spacing (TH-D); a style picker, the theme in the editor, and serving faces to a
browser (TH-F); typeface artifacts in the object store (TH-B); the Word projection (with Word);
choosing or editing a theme, and any route that writes one.

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **STY-001** (a style is a named appearance definition belonging to a catalogue), **STY-003** (a
  catalogue of each of six kinds) and **STY-024** (a theme binds one catalogue of each kind, and is a
  versioned artifact): the reader and the seeded default.
- **STY-002** (a catalogue is a versioned artifact within a tenant, usable by more than one space):
  publications from two spaces recording the one default theme and its catalogues.
- **STY-005** (a stable identifier, allocated once and never reused): the store refusing a catalogue
  version that brings back an identifier an earlier version dropped.
- **STY-006** (a style declares what it applies to, and anything else is refused): `assemble` failing
  `style_not_applicable`, and the reader refusing a place or role given a style that does not apply.
- **STY-008** (a paragraph style declares every property it names) and **STY-009** (a character style
  for each mark in CNT-031): the worker test measuring each in the PDF. STY-009's prototype citation
  (`runs.test.ts`, two marks) is removed from that title.
- **STY-010** (the mark map is per-theme): two themes setting `strong` differently, read back.
- **STY-041** and **STY-042** (the licence and embedding recorded; publishing refuses a face that may
  not be embedded): the reader and `typeface_not_embeddable`.
- **STY-069** (contrast checked when the theme is saved): the store refusing a theme the reader
  refuses on contrast.
- **STY-074** (the default theme covers Latin, Greek, Cyrillic, Hebrew and the mathematics): the
  pinned files' character maps against the ranges, and the maths face against what the tree sets.
- **PUB-019** (typefaces embedded, subject to the licence recorded): every face embedded in the PDF,
  and the refusal - while the PDF is the only output.
- **Not cited:** STY-025 (no template binds a theme; the environment's default stands in), STY-039
  (the browser half), STY-050, STY-051 and STY-054 (every output, and Word is missing), PUB-092 (each
  engine), STY-076 and STY-013 (themes 2).

## Rulings

- **R1. The theme model**, in `packages/domain/src/theme/`, exported from the package for the first
  time (ADR-0014's consequence). The prototype's `schema.ts` and `resolve.ts` become the model below;
  `css.ts` and `ooxml.ts` are brought onto it and project what they already did, the properties they do
  not yet project named in their doc comments, since the editor and Word slices finish them. Two
  stored shapes, each closed at its first version:
  - **`catalogue/1`**: a `kind` - `paragraph`, `character`, `table`, `image`, `admonition`,
    `citation` - and that kind's styles. A **paragraph** catalogue has a `base` stating every property
    and styles of `id`, `name`, optional `basedOn`, `appliesTo` and `properties`. A **character**
    catalogue has exactly one style for each of the nine marks. A **table** and an **image** catalogue
    hold styles of `id`, `name` and `appliesTo` only - `table`, or `figure` and `inlineImage` - until
    themes 2 widens them. **Admonition** and **citation** catalogues must be empty.
  - **`theme/1`**: a `name`, the `paper` colour, its `typefaces`, the six `catalogues` by artifact
    version, the default paragraph style for each **place** - `text`, `listItem`, `quotation`,
    `tableCell`, `footnote` - and the paragraph style for each **role**: `heading1` to `heading6` (a
    deeper heading takes `heading6`), `title` (the cover), `notice`, `contents`, `contentsEntry`,
    `list` and `listEntry` (the lists after the contents), `caption`, `tableNote`, `attribution`,
    `preformatted`, `preformattedLabel` and `running` (heads and feet).
  - **A typeface** records its `id`, `family`, each file with its `sha256`, weight and posture, its
    `licence` (an SPDX identifier), `embedding` as `{ pdf, word }` (STY-041), an optional `wordFamily`
    (STY-052), `ascent` and `descent` in ems, and, for a monospaced face, its `advance` in ems. One
    typeface is the theme's `maths` face.
  - **Paragraph properties** (TH-D): `typeface`, `size`, `bold`, `italic`, `colour`, `background`
    (a colour or `none`), `alignment` (`start`, `end`, `centre`, `justify`), `firstLineIndent`,
    `startIndent`, `endIndent`, `spaceBefore`, `spaceAfter`, `lineSpacing` (a minimum baseline
    distance), `keepWithNext`, `keepTogether`, `widowControl` and `hyphenate`. **Character
    properties**, each optional: `bold`, `italic`, `underline`, `colour`, `typeface` and `position`
    (`subscript`, `superscript`). A mark's meaning that is not appearance - a link's target, a quoted
    phrase's marks from its language - stays the template's.
- **R2. The reader**, `readTheme(theme, catalogues)` returning a `ResolvedTheme` or every refusal at
  once, never the first: each shape parsed; the catalogues the theme names, one of each kind; every
  `basedOn` chain walked with a visited set; every typeface, place and role reference found; a place's
  or role's style one that `appliesTo` it (STY-006); a monospaced face on `preformatted`; and
  **contrast** (STY-069, TH-G): each resolved paragraph style's colour against its `background`, or
  the paper where it has none, and each character style's colour against both, at WCAG's relative
  luminance, 4.5:1, or 3:1 at 18pt or at 14pt bold. The refusals are codes, each with its message
  (STY-061). The same reader serves the store, `assemble` and the tests.
- **R3. The default theme**, as data in `packages/domain/src/theme/default.ts`: Liberation Serif,
  Liberation Mono and STIX Two Math with their hashes, `OFL-1.1`, embedding permitted in both, and
  their metrics; admonition and citation catalogues empty; table and image catalogues holding `table`,
  and `figure` and `inline`. **Its numbers are template 11's where template 11 has one** - body 11pt,
  headings 16pt and 13pt bold, preformatted 8.8pt on a grey of `#f0f0f0`, the label 8pt, the table's
  note 10pt, the notice and running slots 9pt - and where template 11 left a value to the engine
  (line spacing, a footnote's size, space between blocks), the value is **measured from a template 11
  PDF** and the default states it, so a publication's look moves only by what the line rules change.
  Colours are near-black on white and pass R2.
- **R4. The store**, by migration `0024_themes.sql`, as 0018 did for the layout: `theme` and
  `catalogue` artifact kinds; the six catalogues and the theme seeded as literals, with their content
  hashes and version digests, and a test recomputing them from R3's data; a `theme_default` singleton
  made the environment's, the runtime role unable to change it; and `theme_id`, `theme_version_id`
  and `theme_kind` on `publication_request` and `publication`. A request made from now must name a
  theme version, and a publication's must be its request's. **A request still waiting when the
  migration runs** is given the default theme's version, since nothing has been made under it; one
  already answered keeps none. The theme's version is what is recorded: it names its catalogue
  versions, and both are immutable, so the one key records all seven.
  `packages/db/src/themes.ts` holds `defaultTheme(trx)`, reading the theme and its catalogues through
  R2 as `defaultLayout` reads through `readLayout`, and `addCatalogueVersion` and `addThemeVersion`,
  the only TypeScript writers, which refuse what R2 refuses (STY-069) and a catalogue version bringing
  back an identifier an earlier version of that catalogue dropped (STY-005).
- **R5. The request and the job.** `requestPublication` records the environment's theme at its latest
  version beside the layout's; `publicationInputs` returns it resolved; the job hands it to
  `assemble`. Before `assemble`, the worker holds the theme's typefaces to its pinned files: a family
  or a hash it does not hold fails the publish `typeface_unavailable`, naming the typeface.
- **R6. `assemble` and `publishing/12`** (TH-E). `publishing/11` is frozen. The published document
  gains `theme`: the Typst projection - the paper; each paragraph style used, by identifier, with every
  property concrete, its face's family, descent and the leading its line spacing leaves; the nine marks'
  renderings; the places and the roles. Each block carries the style it is set in: a stored `body` the
  default for its place, any other identifier itself. **Failures, all collected**: `style_missing` for
  an identifier the theme's catalogue of that kind lacks, a table's and an image's included (STY-027);
  `style_not_applicable` for one used where its `appliesTo` does not reach, naming the block and the
  style (STY-006); `typeface_not_embeddable` for a face a used style needs whose `embedding.pdf` is
  false, naming the typeface (STY-042). **The glyph check asks the face that sets the text**: a run's
  face is its mark's `typeface` where it has one, else its style's; `Covers` becomes a question about a
  typeface's family, answered by the worker from the pinned files, and the codes stay as they are.
  `line_too_wide` measures with the `preformatted` role's size and its face's `advance` rather than
  `CODE_SIZE`. The new codes join `publishFailureCodes`; the contract and the client are regenerated;
  the publishing page says each in a sentence.
- **R7. Template 12**, a new directory; template 11 frozen; `TEMPLATE_READING`,
  `PUBLISHING_SCHEMA_CURRENT` and `PIPELINE_VERSION` moved as equations 2 moved them. It sets the
  page's fill to the paper, and every block and every generated piece of text from its style:
  - **Lines and spaces** (ADR-0014): text edges from the face's descender, `leading` the line
    spacing less one em, `spacing` zero, and between blocks weak space of the first's space after and
    the second's space before and leading; an explicit `par` in every block, since inline content
    alone is no paragraph and a first-line indent would do nothing to it (measured by the prototype).
  - **Pagination** (measured, TH-D): `sticky` for keep-with-next, `breakable: false` for
    keep-together, the widow and orphan costs 100% or 0%, `hyphenate` in the passage's language.
  - **Marks**: each from its character style, never `strong` or `emph`, whose engine defaults are
    not the theme's.
  - **Footnotes** set by the `footnote` place's style through `footnote.entry`, rather than the
    engine's default size.
    **No typographic literal survives**: `template.test.ts` reads template 12 and fails on a face name,
    a colour or a size, weight or length literal, but for an allowlist each entry of which says why -
    maths layout, zero, the unit a number from the data is multiplied by.
- **R8. The worker's test**, `themes.test.ts`: the default theme and a second theme differing in
  every paragraph property and every mark - `strong` as colour and underline rather than bold,
  justified, indented, spaced, coloured, on a tinted paper - each compiled with veraPDF passing and read
  back: faces, sizes, weights, postures and colours from the text and the content stream; alignment
  and indents from positions; spaces and line spacing from baselines; keep-with-next, keep-together and
  widow control across a page foot as measured in the design; every face embedded. The typefaces'
  recorded metrics and advances are held to the files, and their character maps to STY-074's ranges.

## Tasks

1. **The model** (`packages/domain`): R1, R2 and R3's data - the shapes, the reader and its refusals,
   contrast, the default theme and its catalogues, the Typst projection over them, the prototype's CSS
   and Word projections brought onto them, the package export.
2. **The store** (`packages/db`, `apps/service`): R4 and R5's request half - the migration, the
   seeded literals and their recomputing test, `themes.ts`, the request recording the theme,
   `publicationInputs` returning it.
3. **`assemble`** (`packages/domain`, `packages/api-contract`, `packages/api-client`, `apps/web`):
   R6 - `publishing/12`, the style failures, places and roles, the glyph check by face,
   `line_too_wide` by the role; the contract, the client and the sentences.
4. **The template** (`apps/worker`): R5's faces check, R7 and R8 - template 12, the maps, the pins,
   the job handing the theme on, `themes.test.ts`.
5. **Docs**: themes.md's "What was built", publishing.md's build order, architecture, features and the
   README, CLAUDE.md's status, this plan's status, the version (Minor, 0.68.0) and the changelog;
   trace generate and pins.
