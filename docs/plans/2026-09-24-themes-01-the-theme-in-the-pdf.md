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

## What the build changed

**The model.**

- **R1's roles gained `noticeSentence`.** Template 11 sets the draft notice's sentence under the
  cover's title in bold at the body's size, and R1 had a role for the 9pt notice line at a page's head
  and none for the sentence, so template 12 would have needed a literal weight, which R7's test
  forbids. It is styled `notice-sentence`, the body made bold. Nineteen roles, not eighteen.
- **R1's property set gained two, both on the coordinator's ruling.** A character style's **`scale`**,
  a fraction from 0.5 to 2 of the size of the text the mark stands in, because template 11 sets inline
  code at `0.8em` and a character style had no size: the default's `inline-code` is the mono face at
  0.8. A paragraph style's **`padding`**, in points, the room between a fill's edge and the text on
  every side, drawn only where `background` is not `none`, because template 11 insets the
  preformatted panel `6pt` and a style had nothing to say it with: the default's `preformatted` pads 6,
  and the base 0. The CSS and Word projections name both among what they do not yet project.
- **R3's colours are black, `#000000`, not near-black.** Template 11 printed the engine's black, and
  R3 also asked that the look move only by what the line rules change; a near-black is a one-line
  change in `default.ts`.
- **The six catalogue versions have fixed identifiers**, `DEFAULT_CATALOGUE_VERSIONS` in
  `default.ts`, because the theme's content names its catalogues by version and 0024 must insert the
  versions it names; 0018 let a version's id default and this could not. The catalogue artifacts'
  and the theme artifact's identifiers are fixed in `packages/db/src/themes.ts`; the theme's own 0.1
  version id defaults, as the layout's did, and is found through `theme_default`.
- **R2's reader is two functions returning result unions**, `readCatalogue` and `readTheme`, each
  `{ ok, ... }` with `refusals` rather than a thrown `ThemeError`, as `readLayout` returns, so the
  store can refuse a catalogue version on its own. Both migrate through a chain (current 1, no steps).
  A broken `basedOn` chain is refused once, where it breaks, and a style based on it is left
  unresolved without a refusal of its own. Contrast checks only a character style that states a
  colour, once per background and threshold; a mark that only turns bold off in a 14pt bold style is
  not re-checked at 4.5:1, an edge left. The reader does not check that a typeface holds a file for
  the weight and posture a style asks for.
- **The typeface metrics are exact fractions** of the files' units - Liberation Serif's ascent 1825
  and descent 443 of 2048, Mono's 1705 and 615 with its advance 1229, STIX Two Math's 762 and 238 of
  1000 - so the worker's test compares them without a tolerance. The zod schemas are not exported
  from the package, only the readers, the constants and the types.

**The store.**

- **A request made before layouts keeps no theme** (the coordinator's ruling, over the first cut).
  0024's backfill gives the declared theme only to a request still `queued` that has a layout, since
  template 1 sets one that has none and reads no theme; `publicationInputs`' `theme` is null exactly
  when its `layout` is, and such a publication records none. "Still waiting" is `state = 'queued'`: a
  queued request cannot have a publication.
- **The backfill disables `publication_request_finish_once` for its one statement**, since that
  trigger refuses any update that leaves a request queued, and enables it again in the same
  transaction; widening the function for ever was worse, and `session_replication_role` needs a
  superuser. A test holds every trigger enabled afterwards. A request made from 0024 on is refused
  without a theme by a before-insert trigger, `publication_request_made_under_a_theme`, rather than a
  check Postgres would apply to every update. A publication's theme is its request's, null for null,
  in `publication_recorded_whole` redefined from 0022's body.
- **`recordVersion` and `createArtifact` refuse both kinds**; `addCatalogueVersion` and
  `addThemeVersion` reach the chain through `recordReadVersion`, exported from `versions.ts` and not
  from the package, so numbering, the precondition and the unchanged digest stay the chain's. A
  catalogue version of another kind is refused with the reader's `catalogue_wrong_kind`; `style_reused`
  is the store's one code of its own. `defaultTheme` returns the stored content beside the resolved
  theme, and `themeAt(trx, versionId)` reads a recorded one. `ThemeSubstance` and `CatalogueSubstance`
  joined the domain's `VersionSubstance`, types only, so the chain can digest them.
- **The store's migration and writer tests were written after the code**, not before: the red was
  taken by cutting the code out - the writers from `themes.ts`, and the backfill, the trigger and the
  two redefined functions from 0024 - and watching each test fail for its reason before restoring it.
  Accepted as it stood; every other test in the slice was red first.

**`assemble` and `publishing/12`.**

- **`theme` carries every paragraph style**, not "each used" as R6 said: `projectTypst(theme)` with no
  filter, so the member is the theme's alone and the same for every document it sets.
- **Only a paragraph carries `style`**, on `PublishedParagraph`, wherever one is published, a
  footnote's included; a stored `body` becomes the place that holds it **most nearly** - a quotation's
  paragraph in a list's item is `quotation`, a list's in a cell `listItem`. A table's and an image's
  styles are checked and not carried, their catalogues holding no properties until themes 2; what is
  set by role carries no identifier, the template finding each in `theme.roles`. A definition list's
  term is set in the `listItem` place's style, no role naming one.
- **The glyph check asks a family.** `Covers` is `(codePoint, family) => boolean`, answered by the
  worker from every pinned file of that family and false for a family it holds none of; `Face` became
  `Setting` (`body`, `code`, `math`), which decides the no-glyph rules and the code, and
  `PINNED_FONT_FILES` carries `family`. A run asks its innermost mark's face, else its style's. **A
  preformatted block's language label is checked now**, against `preformattedLabel`; it was not checked
  at all, and would have failed in the engine unnamed. A request made before layouts asks
  `SLICE_ONE_FAMILY`, Liberation Serif, frozen in `assemble.ts` so template 1's check cannot move with
  the default theme's data.
- **`typeface_not_embeddable` names the family**, with no node or block, once: a face is needed the
  first time a glyph check asks it, and the maths face when an equation converts, and the running
  role's when a slot has anything in it, so the mono face in a document with no code is never refused.
  A layout without a theme, or a theme without a layout, throws, a caller's defect.
- **The measures in `assemble` read the theme** (the coordinator's ruling), and the contract is
  written at the head of `measure.ts`, which template 12 keeps: `line_too_wide` measures by the
  `preformatted` role's size and face's advance less its start and end indents and, where it has a
  fill, twice its padding - 83 columns and 79 in a quotation under the default, as before; a quotation
  is inset by its style's start and end indents, the engine's own inset stopped; a list's indent is in
  ems of the `listItem` place's size; a caption's estimated height is in the `caption` role's size.
  `CODE_SIZE`, `CODE_ADVANCE`, `PANEL_INSET` and `QUOTATION_INDENT` are gone; `BODY_SIZE` stays for the
  maths tree, which turns points into ems of 11pt, and for a request with no theme.
- **An inline image is 1.2 ems of the style it stands in** (the coordinator's ruling), template 11's
  rule in the theme's sizes, not the line spacing, which would have made it 14pt where it was 13.2:
  `inlineImageHeight(size)`, the size a paragraph's style's, a term's, an attribution's, a table note's
  or a caption's. 13.2 by 17.6 under the default, unchanged.
- **`style_missing`'s sentence blames the theme**: _This paragraph, table or figure uses the style
  {detail}, which the publication's theme does not have._ `style_not_applicable`'s ends at _cannot be
  used where it stands_: _Choose another style for it_ was dropped, since nothing lets an author
  choose one yet (TH-F).

**The template and the faces.**

- **`typeface_unavailable` is checked for every face the theme declares**, used or not, at stage
  `compose`, naming the family, with no node or block, before `assemble` runs, so an unheld face is
  refused by name rather than flooding the list with `glyph_missing`. `typefacesNotHeld` in
  `apps/worker/src/fonts.ts` answers it: a face is held when each of its recorded files is a pinned
  file of that family.
- **`MATHS_CHARACTERS` is exported from the domain** - the fences, accents, lines, braces and primes
  the maths tree itself sets - so STY-074's test holds the maths face to it rather than to a copy.
- **The default's numbers are measured**, from one document compiled through template 11 and read
  back by pdf.js, and solved by ADR-0014's rule. Template 11's line is its 0.65em leading and the
  serif's cap height, 1.3048 of the size, and its space between blocks the larger of the two. The
  base states space after **2.75** and line spacing **14.35**; heading 1 is 16pt bold, **10.33**
  before, **4.57** after, **20.88** line; heading 2 13pt, **7.43**, **2.82**, **16.96**; heading 3 to
  6 11pt, **5.5**, **1.65**, **14.35**; the footnote **9.35**pt, **0.82** after, **10.8** line; the
  quotation's indents **11** and **11**, the engine's inset; a contents entry **0** after; the notice
  and the running slots **11.74** line, the notice **2.25** after; the table's note 10pt, **0**
  before, **2.97** after, **13.05** line; the preformatted panel **1.69** before, **2.49** after,
  **11.52** line, and its label **1.3**, **3.4**, **10.44**. The caption is centred, as template 11's
  figure centred it. 0024's paragraph catalogue literals moved with them.
- **Table cells keep centred, by a `table-cell` style** (the coordinator's ruling): body, centred,
  applying to `tableCell` alone, the place's default. Template 11 centred a cell only because a figure
  centres what it holds, and without the style every cell would have moved to its start. `body`
  applies to `text` and `listItem`, so each place has one default. The theme's literals moved with it.
- **What a reader can see move**, template 11 against template 12 under the default, baseline to
  baseline. Within a paragraph, between paragraphs, heading into text and text into heading, the
  space between two footnotes and within one, the contents, the preformatted panel and its label, and every figure's and note's
  distance to the text around it hold to within 0.005pt. These move:
  - **A quotation loses its set-off**: text into a quotation and a quotation into its attribution
    **16.5pt closer** (33.6 to 17.1), and the attribution into text **9.9pt closer** (27.0 to 17.1).
    The theme styles paragraphs and not a block's edges, so the space around a quotation is its
    paragraphs' own; keeping template 11's would have put 50pt between a quotation's own paragraphs.
    Accepted and recorded at template 12's `show quote` rule: it comes back with a spacing property for
    a block's edges, as Word's contextual spacing is, a later widening.
  - A heading straight into a heading, **2.90pt** further (heading 1 into 2) and **0.50pt** (2 into
    3); text into a list **2.75pt** further; a table's caption into its header row **2.75pt**, its last
    row into its note **2.87pt**, and each row to the next **3.80pt** further, a cell's line now a full
    line inside its 5pt inset; a note's second paragraph **2.92pt** closer; a figure's caption **2.38pt**
    closer to its image.
  - The page's frame, by the line model: the header's baselines **1.95pt** higher, the footer's
    **1.16pt** lower, and a page's first line lower, **1.42pt** at 11pt and **2.06pt** at 16pt.
- **Items of one list stand a line apart**, `spacing` the item's leading, the style's spaces around
  the whole list, as template 11's tight lists and Word's contextual spacing for list paragraphs;
  ADR-0014's rule between items would have added 2.75pt to each.
- **The template was mended three times by the suites it already had.** A helper named `place` shadowed
  the engine's and broke the equation number (`equations.test.ts`), so it is `place-style`. A wrapper
  on every element was one more nested realisation per list level, and the 29-level list stopped
  compiling with "maximum show rule depth exceeded" (`lists.test.ts`), so each wrapper is added only
  where it changes something. A marker straight after something shown was a bare tag the engine carried
  to the next page where the page ended there (`references.test.ts`), so it is a block of no height.
  And two found by measuring: a size set on `raw` is multiplied by the engine's own 0.8, so code is
  made at exactly its surrounding size and face; and a paragraph's settings changed part-way through
  end it, so a footnote's number was left on a line of its own, and a note's paragraphs take only the
  lettering (face, size, fill, edges) and not the paragraph settings.
- **Headings, captions, contents entries, the running slots and the notice are set without a `par` of
  their own**, as template 11 set them, so a first-line indent on those roles does nothing; the body,
  an attribution, notes, labels and the notice sentence have theirs. A heading keeps its `H` tag
  whatever shows it, measured.
- **R7's allowlist** is `n * 1pt` and `n * 1em` (the units a number from the data is multiplied by),
  `rgb(hex)` (the one place a theme's colour becomes the engine's), `100%` or `0%` for the widow and
  orphan costs, `0pt`, `width: 100%`, and the equation's `1em` beside its number and between cases'
  columns (maths layout); each must still occur, so a stale entry fails too.

**The record.**

- **Citations.** STY-001, STY-003, STY-006 and STY-041 in the domain's `read.test.ts`; STY-024,
  STY-005, STY-069 and STY-002 in `packages/db`, STY-024 moved there from the reader's test, since the
  theme's being a versioned artifact is the store's to show; STY-008, STY-009, STY-010, STY-074,
  STY-042 and PUB-019 in the worker's `themes.test.ts`. STY-009's prototype citation in `runs.test.ts`
  is gone with the test. **STY-027 and STY-038 stay cited**, on the reader's `style_missing` for a place
  or role and on its purity, because baseline 0.13.0 includes both and `pnpm trace gate` reads the
  newest baseline; the frozen baseline row still names `resolveStyle`, which is the record. The
  citations pin moves from 286 to 299.
- **`spikes/theme-conformance` no longer runs against the model**: its `emit.mjs` calls
  `resolveTheme`, `exampleTheme` and `resolveStyle`, which are gone. It is the record of what ADR-0014
  measured, as the other spikes are, and is not brought onto the model here.

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
