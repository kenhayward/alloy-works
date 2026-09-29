# Themes

How one presentation theme drives three renderers - the editor, the PDF and Word - and how they are
kept in agreement.

This realises most of [STY](../specification/requirements/STY-styles-and-presentation-themes.md). It
follows [ADR-0010](../decisions/0010-open-licence-typefaces-only.md) on typefaces and
[ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md) on the PDF
engine, and sits beside [storage-and-versioning.md](storage-and-versioning.md), which stores a theme,
its catalogues and its typefaces as versioned artifacts like everything else.

**A prototype exists and has been measured.** The resolver and all three projections are in
`packages/domain/src/theme/`, written test-first; `spikes/theme-conformance/` renders one fixture
through Chromium, Typst and LibreOffice and compares every baseline. The claims below marked as
measured were measured there, and the decision they support is [ADR-0014](../decisions/0014-themes-resolve-once-project-three-times.md).

## The shape in one paragraph

A theme is data in a fixed, typed schema, never a stylesheet and never code. A resolver in
`packages/domain` flattens it once - inheritance, defaults, applicability - into fully resolved
styles in which every property is concrete. Three projections then translate those resolved styles
and do nothing else: to CSS for the editor, to a `theme.json` read by the fixed Typst template, and to
Word's `styles.xml`. Quantities are geometric and neutral to every target, and where the targets'
rules for combining them differ, Word's rule wins, because Word is the one target we cannot
reprogram. Agreement between the three is not asserted; it is measured, per property, by a
conformance suite.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STY-001** | A style is a record in a catalogue: an identifier, a name, what it applies to, and values from the property set                                                                                                                                                                                                                                                                                     |
| **STY-002** | A catalogue is an artifact (`artifact_kind = catalogue`), versioned by the storage design, referenced by themes rather than owned by one                                                                                                                                                                                                                                                            |
| **STY-003** | Catalogue kinds are fixed: paragraph, character, table, image, admonition, citation                                                                                                                                                                                                                                                                                                                 |
| **STY-004** | Content carries a style identifier and nothing else about appearance; the schema has no field that could hold a property                                                                                                                                                                                                                                                                            |
| **STY-005** | Identifiers are allocated by the catalogue, never reused, and are what every projection keys on - the CSS class, the Typst lookup, the Word style id                                                                                                                                                                                                                                                |
| **STY-006** | Every style declares the node types it applies to; the resolver refuses a style applied outside them, naming both                                                                                                                                                                                                                                                                                   |
| **STY-056** | `basedOn` inheritance, resolved by the resolver alone; the chain is walked with a visited set and a cycle is a named error                                                                                                                                                                                                                                                                          |
| **STY-008** | The paragraph property set below                                                                                                                                                                                                                                                                                                                                                                    |
| **STY-009** | A character catalogue maps each mark in CNT-031 to a rendering                                                                                                                                                                                                                                                                                                                                      |
| **STY-010** | That map belongs to the theme, so `strong` resolves to bold in one theme and small capitals in another                                                                                                                                                                                                                                                                                              |
| **STY-011** | Alignment exists only as a paragraph style property; there is no field for it on a block                                                                                                                                                                                                                                                                                                            |
| **STY-076** | The table property set below, but for alignment by column type                                                                                                                                                                                                                                                                                                                                      |
| **STY-077** | Alignment by column type, a table style property a table may override, once columns have a type (STY-014)                                                                                                                                                                                                                                                                                           |
| **STY-013** | Table break behaviour is part of the table style: header repetition, continuation label, rows kept whole                                                                                                                                                                                                                                                                                            |
| **STY-014** | Default field formats by column type are table style properties, overridable by a table (**TAB**)                                                                                                                                                                                                                                                                                                   |
| **STY-015** | An image style fixes one dimension, as points or as a fraction of the measure                                                                                                                                                                                                                                                                                                                       |
| **STY-016** | The other dimension is derived from the asset's intrinsic proportions at resolution, never declared                                                                                                                                                                                                                                                                                                 |
| **STY-017** | An image style declares a maximum for the free dimension; exceeding it re-derives from that dimension instead                                                                                                                                                                                                                                                                                       |
| **STY-018** | Placement - inline, block, floated - and alignment are image style properties                                                                                                                                                                                                                                                                                                                       |
| **STY-079** | A table style and an image style placing a figure each declare `caption: 'above' \| 'below'`, required at `catalogue/3`, and the editor, the PDF and Word each set the caption on that side ([Where a caption sits](#where-a-caption-sits))                                                                                                                                                         |
| **STR-025** | Where a caption sits is the table or image style's `caption`, and a table or a figure holds only the identifier of its style: the content model has no member for a side ([Where a caption sits](#where-a-caption-sits))                                                                                                                                                                            |
| **STY-078** | An asset version cannot be stored without its intrinsic width and height - AST records them on ingest, and the stored shape refuses a version without them - so resolution always has them. STY-019, which it supersedes, asked for a named failure that could not arise                                                                                                                            |
| **STY-024** | A theme binds one catalogue of each kind, a set of typefaces, and a paper colour, and is itself an artifact                                                                                                                                                                                                                                                                                         |
| **STY-025** | The theme a document uses is the one its template binds; the resolver is given it, never chooses                                                                                                                                                                                                                                                                                                    |
| **STY-026** | Changing a document's theme is a template-level act, audited through the lifecycle log                                                                                                                                                                                                                                                                                                              |
| **STY-027** | A style identifier the theme does not contain is a resolution error, and resolution errors fail the publish                                                                                                                                                                                                                                                                                         |
| **STY-028** | A baseline pins the theme version; the storage design makes the pin a foreign key                                                                                                                                                                                                                                                                                                                   |
| **STY-029** | Adding a style is a catalogue edit - data, validated against the schema - and involves no code                                                                                                                                                                                                                                                                                                      |
| **STY-030** | A new style is honoured everywhere because projections are generic over the property set, not written per style                                                                                                                                                                                                                                                                                     |
| **STY-031** | A style is referenced by identifier, so its uses are a query, and deletion is refused while any exist                                                                                                                                                                                                                                                                                               |
| **STY-032** | Catalogue edits are versions, so what changed is a comparison between two versions                                                                                                                                                                                                                                                                                                                  |
| **STY-033** | A theme may carry an allowed list of style identifiers per kind; the editor offers only those, and the resolver refuses the rest                                                                                                                                                                                                                                                                    |
| **STY-034** | The impact of a style change is the set of documents whose pinned or floating theme version would resolve differently, listed before the change is saved                                                                                                                                                                                                                                            |
| **STY-035** | One resolver, in `packages/domain`, used by the editor and the publisher alike; the projections never resolve anything                                                                                                                                                                                                                                                                              |
| **STY-058** | The CSS projection is generic over the property set (STY-030), so it renders every declared paragraph and character property at the theme's values rather than a chosen few; the pagination-bound properties are the only omission, marked as such in the set and shown by preview instead of approximated (STY-037)                                                                                |
| **STY-037** | Properties that depend on pagination are marked as such in the property set; the CSS projection omits them and preview shows them                                                                                                                                                                                                                                                                   |
| **STY-038** | The resolver is a pure function of theme version, catalogue versions and asset dimensions                                                                                                                                                                                                                                                                                                           |
| **STY-039** | The pinned files are one package, `packages/fonts`, which the worker hands Typst as its only font directory and the renderer bundles for a browser and the desktop shell alike ([The theme in the editor](#the-theme-in-the-editor), ET-C)                                                                                                                                                          |
| **STY-040** | A typeface that cannot be loaded fails resolution; Typst's missing-face warning is also treated as a failure (ADR-0013)                                                                                                                                                                                                                                                                             |
| **STY-041** | The typeface artifact records the licence and whether it permits embedding, separately for PDF and for Word                                                                                                                                                                                                                                                                                         |
| **STY-042** | The PDF projection refuses a face whose licence forbids embedding                                                                                                                                                                                                                                                                                                                                   |
| **STY-043** | A catalogue serialises as its schema's JSON, which is the export format                                                                                                                                                                                                                                                                                                                             |
| **STY-044** | Import validates against the schema and reports every rejected property by name                                                                                                                                                                                                                                                                                                                     |
| **STY-045** | The product's own typefaces are shipped as typeface artifacts carrying their open licence                                                                                                                                                                                                                                                                                                           |
| **STY-046** | A tenant's uploaded face is a typeface artifact in that tenant's schema, so it cannot be served to anyone else                                                                                                                                                                                                                                                                                      |
| **STY-047** | A typeface artifact is the font files themselves, versioned; the baseline pins the files                                                                                                                                                                                                                                                                                                            |
| **STY-074** | The default theme's faces are checked against Latin, Greek, Cyrillic and Hebrew and the mathematics, from their character maps, by the coverage check below                                                                                                                                                                                                                                         |
| **STY-069** | The domain's theme reader refuses a text colour below 4.5:1, or 3:1 for large text, against any background it can stand on, and the store refuses what the reader refuses, so a theme is checked when it is saved ([Themes in the PDF](#themes-in-the-pdf), TH-G)                                                                                                                                   |
| **STY-049** | Glyph coverage is checked at resolution, against the pinned files' character maps, before any renderer runs                                                                                                                                                                                                                                                                                         |
| **STY-050** | Vertical space between two blocks is the first block's space after plus the second block's space before, in every output                                                                                                                                                                                                                                                                            |
| **STY-051** | Line spacing is a minimum baseline-to-baseline distance in points, and means that distance in every output                                                                                                                                                                                                                                                                                          |
| **STY-052** | A typeface whose licence forbids embedding in Word declares a permitted face for Word output, and the publish report names the substitution                                                                                                                                                                                                                                                         |
| **STY-054** | A typeface artifact carries its ascent and descent; the CSS projection and the Typst template both use them to put a line's extra space above it                                                                                                                                                                                                                                                    |
| **STY-055** | `wordRun` computes Word's reading of each run and pins the canonical value directly wherever the two differ                                                                                                                                                                                                                                                                                         |
| **CNT-082** | The CSS projection renders block spacing by the same rule as the output (STY-050)                                                                                                                                                                                                                                                                                                                   |
| **CNT-094** | A block's appearance is its paragraph style; the editor has no free spacing or alignment control                                                                                                                                                                                                                                                                                                    |
| **CNT-097** | The editor loads the theme's typefaces and sets text at the theme's sizes                                                                                                                                                                                                                                                                                                                           |
| **CNT-115** | The editor sets text at the layout's measure, scaled, with zoom                                                                                                                                                                                                                                                                                                                                     |
| **CNT-122** | An image style is resolved to its size by `styledSize`, in `assemble` and in the editor alike, from the asset's pixels and the layout's frame ([The theme in the editor](#the-theme-in-the-editor))                                                                                                                                                                                                 |
| **STY-070** | A style missing or out of place, a face the renderer does not hold and a character its family cannot set are each marked on the text, never set in a silent default ([The theme in the editor](#the-theme-in-the-editor), ET-I)                                                                                                                                                                     |
| **STY-080** | The browser suite measures the editor against the PDF of the same document under the default theme, a contrary one and three generated from seeds: every length within half a point, and every face, weight, posture, colour, underline and fill exactly, with STY-060's list of approved deviations between the two empty ([The theme in the editor, measured](#the-theme-in-the-editor-measured)) |
| **PUB-019** | Embedding in PDF and in Word is decided per face from its licence (STY-041, STY-042, STY-052)                                                                                                                                                                                                                                                                                                       |
| **PUB-027** | The Word projection emits every style as a real Word style, named and identified from the catalogue                                                                                                                                                                                                                                                                                                 |
| **PUB-017** | A table breaks across pages as its table style says - header repeated, rows kept whole, a continuation label - which the template sets from the style ([Themes in the PDF](#themes-in-the-pdf), TH-I)                                                                                                                                                                                               |
| **TAB-032** | The same, from the table's side                                                                                                                                                                                                                                                                                                                                                                     |

**PUB-092 is not claimed: Word's own page breaks are not measured.** Widow and orphan control,
keep-with-next and keep-together are paragraph style properties, each passed to Typst as its own rule -
the two costs, `sticky`, `breakable: false` - and to Word as `w:widowControl`, `w:keepNext` and
`w:keepLines`. The publishing regression corpus (`regression.test.ts`, since W14.3) shows every one of
them holding in the PDF wherever the page allows, and reaching Word as `w:keepNext`, `w:keepLines` and
`w:widowControl`, on or stated off, from the same style. Nothing yet measures where Word itself breaks a
page, which PUB-092's "shown to hold" asks of each engine; the Word check (`word-check.test.ts`), which
opens the writer's documents in Word, is where it could be measured. Until then the claim stands
dropped, as word-output.md says of Word.

**STY-075 is not claimed**: the scripts the supported locales admit have no list until LOC-038
declares one, and which faces answer it is decided then. STY-074, its T1 half, is claimed.

**STY-080 is claimed since issues #331 and #333 were fixed.** STY-053 was split (the W13 plan's
B-M), and STY-080, the editor measured against the PDF, is built in the browser suite
([The theme in the editor, measured](#the-theme-in-the-editor-measured)). W13.4's final review found
the claim partial on two properties both outputs rendered differently - **the step into a line held
open by something taller or deeper than its text** (issue #331) and **where the document view stands a
section's heading** (issue #333) - and it was dropped. Both are fixed in the projection and the
document view, and compared: every property both outputs render is measured and agrees, and what the
comparison leaves out is named there as outside STY-080, with why.

**STY-081 is not claimed: Word is measured against the PDF, and does not agree yet.** Since W15.2
of the [W15 plan](../plans/2026-09-29-w15-word-measured.md), `word-measure.test.ts` sets the
conformance kit's fixture in Word under eight themes, where Word is, and compares Word's own PDF with
the PDF by the kit's comparison at STY-080's tolerances. Every face, weight, posture, colour, underline
and fill is exact but the maths face STY-052 substitutes and twelve table rules' colours; the lengths
are not: 1,186 differences of eight kinds are left, the largest a table's step at 8.12pt, each kind
named with its size and where it goes in word-output.md's
[Word measured](word-output.md#word-measured-w152). The claim waits for them, beside PUB-023, which
word-output.md says waits for it.

**STY-060 is not claimed either**, though both lists it asks for exist and are exact - the editor's
empty, Word's holding STY-052's substitution alone (`EDITOR_DEVIATIONS` and `WORD_DEVIATIONS` in the
conformance kit's `compare.ts`). Its second half, "a deviation not on that list must fail", holds for
the editor's suite and not yet for Word's: Word's measurement holds what W15.2 left by kind, each to
the largest it measured, rather than failing it, so that the Word check's practice can run the whole
worker suite green while the kinds wait for their slices. The claim is made when Word's suite fails
every difference not on its list, which is when STY-081 holds.

**PUB-027's claim has a cost the Word writer pays** (the final review of Word 1, M5). Every style is a
real Word style, and a run names a mark's character style rather than carrying its formatting, but
`wordRun` pins two things on the run itself: a mark's `scale`, since a character style states no size
and Word has none relative to the text around it, so every inline code run carries its own `w:sz`;
and what a second mark sets, since a run names one character style, so a subscript in inline code
names the subscript's style and carries Liberation Mono as its own `w:rFonts`. **Restyling Inline code's size or
face in Word therefore reaches no run.** The claim stands on the projection, which
`theme/ooxml.test.ts` shows; the restyling half, for those two values, waits for a character style
per scaled mark and per pair of marks, which no slice has planned.

Citation styles (STY-020 to STY-023) are bound by a theme but rendered by a citation processor, and
belong to the design that covers citations and references. How numbering looks - heading numbers,
figure numbers - belongs with the layout (PUB-011) and structure (STR), which this design supplies
typefaces and paragraph styles to.

## Three targets, not two

ADR-0013 framed the cost of Typst as a theme existing twice, as CSS for the editor and as Typst for
the output. It is three: **Word is a target too**, and the hardest one, because PUB-027 requires real
Word styles a recipient can restyle. That makes Word's semantics visible to a person in a way the
other two never are. We render CSS and Typst ourselves and can make them do anything; Word's rules are
Word's.

**Agreement cannot mean identical pages.** The browser and Typst break lines with different algorithms,
and the editor has no pages at all. So agreement is defined per property - typeface, size, weight,
colour, baseline-to-baseline distance, space between blocks, indentation - and is measured. The
publishing engine spike showed what one unit mismatch does: its first Typst document came out at 246
pages against CSS's 300, from line spacing alone.

## Resolve once, project three times

```
  theme version ─┐
  catalogues  ───┼─► resolver (packages/domain) ─► resolved styles ─┬─► CSS projection      ─► editor
  asset sizes ───┘      inheritance, defaults,      every property   ├─► Typst projection    ─► theme.json ─► template.typ
                        applicability, units,       concrete         └─► OOXML projection    ─► styles.xml
                        glyph coverage
```

**The resolver is the only place rules live.** It walks `basedOn` chains (STY-056) with a visited set,
so a cycle is an error rather than a hang; fills unstated properties from the kind's defaults; checks
each style's declared applicability against the node it is applied to (STY-006); converts every
value to canonical units; and checks that every character in the document has a glyph in the pinned
faces (STY-049). Its output is a resolved style per identifier with no inheritance left in it.

**A projection is a translation and nothing else.** It never sees inheritance, never applies a
default, and never decides anything. That is STY-035 turned into architecture: the editor and the
publisher cannot resolve a style differently, because neither resolves one at all.

**Projections are generic over the property set**, never written per style. A style an administrator
adds tomorrow (STY-029) is honoured by all three the moment it is saved, because nothing downstream
knows it by name (STY-030).

## The property set

The set is fixed and typed, which is what STY-N03 requires. Every value is a number with a unit, an
enumeration, a colour, or a reference to another artifact - never free text that reaches a renderer
as syntax. Widening the set is how STY-Q02 gets answered when a house style needs something it cannot
express, and each addition arrives with its three projections and its conformance fixtures, or it
does not arrive.

### Paragraph styles

| Property                 | Canonical form                                                | Editor (CSS)                                  | PDF (Typst template)                                                 | Word                                   |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Typeface                 | Reference to a typeface artifact                              | `font-family`, from `@font-face`              | `text(font)`, from the pinned directory                              | `w:rFonts`; the Word face if declared  |
| Size                     | Points                                                        | `font-size` in pt                             | `text(size)`                                                         | `w:sz`, half-points                    |
| Weight, style            | Enumerations                                                  | `font-weight`, `font-style`                   | `text(weight, style)`                                                | `w:b`, `w:i`, stated explicitly        |
| Colour                   | sRGB                                                          | `color`                                       | `text(fill)`                                                         | `w:color`                              |
| Alignment                | start, end, centre, justify                                   | `text-align`                                  | `par(justify)`, `align`                                              | `w:jc`                                 |
| Indentation              | Points: first line, start, end                                | `text-indent`, `padding-inline`               | `par(first-line-indent)`, `pad`                                      | `w:ind`                                |
| Space before, after      | Points, **added together** (STY-050)                          | `padding-block` - which adds                  | An explicit gap: the template sets it between blocks                 | `w:spacing before/after` - which adds  |
| Line spacing             | Minimum baseline distance, points (STY-051)                   | `line-height` in pt, half-leading moved above | Text edges from the face's descender, `leading` = distance minus 1em | `w:spacing line`, `lineRule="atLeast"` |
| Keep with next           | Boolean                                                       | Not rendered (STY-037)                        | `block(sticky)`                                                      | `w:keepNext`                           |
| Keep together            | Boolean                                                       | Not rendered                                  | `block(breakable: false)`                                            | `w:keepLines`                          |
| Widow and orphan control | Boolean - on means two lines, as Word                         | Not rendered                                  | Paragraph costs for widows and orphans                               | `w:widowControl`                       |
| Hyphenation              | Boolean                                                       | Not rendered                                  | `text(hyphenate)`                                                    | Document setting, per style exclusion  |
| Letter spacing           | Em                                                            | `letter-spacing`                              | `text(tracking)`                                                     | `w:spacing` in the run                 |
| Small capitals           | Boolean - **not in T1**: the pinned faces have none, measured | `font-variant-caps`                           | `smallcaps`, which does nothing in a face without them               | `w:smallCaps`                          |

Two rows carry most of the difficulty, and they are covered in the next section. Hyphenation is not
rendered in the editor even though a browser could: its dictionaries break words in different places
from Typst's, and showing a hyphen the output will not have is the silent approximation STY-037
forbids.

### Character styles

A character catalogue maps each mark in CNT-031 to a rendering drawn from the same typographic
properties - weight, style, small capitals, underline, baseline shift for superscript and subscript,
and colour (STY-009). The map is the theme's (STY-010). The mark itself never carries a property.

### Table styles

Header row and header column treatment (fill, weight, rule beneath), banding (fill on alternate
rows), rules (outer, horizontal inside, vertical inside - each a width and colour or none), cell
padding, alignment by column type, default field formats by column type (STY-014), and break
behaviour: whether the header repeats, the continuation label, and whether rows are kept whole
(STY-013); and where its caption sits, above the table or below it (STY-079, since
[W14.5](#where-a-caption-sits)). The editor renders all of it except break behaviour, which is
pagination.

The continuation label matters beyond appearance: the spike found that no engine can express one
without per-document work. In this design it is a table style property the Typst template renders -
`"Table 3 (continued)"` built from data - so the work is done once, in the template. Its words are
the layout's, as the contents' title is, because a theme has no language; the style says whether the
label appears and how it is set ([TH-I](#decisions-for-ken)).

### Image styles

The fixed dimension and its value, as points or as a fraction of the measure; a maximum for the other
dimension; placement and alignment (STY-015 to STY-018), floated meaning a band at the page's head or
foot, the only float the engine has ([TH-J](#decisions-for-ken)); and, for a style placing a figure,
where its caption sits, above the image or below it (STY-079). A style for an image in a line of text
states no side: such an image has no caption. Resolution derives the free dimension from the
asset's intrinsic proportions and re-derives from the maximum where it would be exceeded. It always
has them: an asset version cannot be stored without them (STY-078). Because the editor's column is the
layout's measure (below), an image styled at "column width" is the width it will print.

### Admonition styles

A box: fill, rule, padding, and a label - "Note", "Warning" - with its own character rendering. Kept
deliberately small until a real house style asks for more.

## Where the targets disagree, and which rule wins

**Space between blocks.** CSS and Typst both take the larger of one block's space after and the next
block's space before; this was measured for Typst rather than assumed. Word adds them. The canonical
rule is **Word's - they add** (STY-050), because Word is the one target we cannot reprogram and the one a
recipient restyles, so its styles show the theme's own numbers one-for-one. The CSS projection uses
padding rather than margins, which adds rather than collapsing. The Typst template zeroes block
spacing and inserts the sum itself, as weak spacing so that it disappears at the top of a page, which
it can do because it walks the blocks in order anyway.

**Line spacing.** "1.15" means three different things: Word multiplies the font's natural line height,
CSS multiplies the font size, Typst adds a gap. So the canonical value is a distance - a minimum
baseline-to-baseline distance in points (STY-051) - and each projection states it in its own terms.
Word gets `atLeast`, not `exact`, because exact clips a line holding an inline equation or image, and
CSS and Typst both let such a line grow.

**A distance is not enough on its own; where a line's extra space goes matters too, and it was
measured.** Within a paragraph all three agree at once, because each gap is one line spacing. Between
two blocks whose line spacings differ - a heading into body text - they do not, because each target
puts the extra space somewhere else. Word puts it all above the line, with the baseline one descender
above the line's foot, so the distance from the last baseline of one block to the first of the next is:

> space after + space before + next line spacing + (previous descender - next descender)

For an 18pt heading on 24pt into 11pt body on 14pt, Liberation Serif's descender being 0.216em, that is
6 + 0 + 14 + 0.216 x 7 = **21.51pt**; LibreOffice measured 21.50. CSS puts half the extra space above
and half below, and drifted by 1.1pt at every change of line spacing. So the canonical rule is
**Word's placement** (STY-054), and matching it needs the face's own metrics:

- **CSS** adds each block's half-leading - (line spacing - (ascent + descent) x size) / 2 - as padding
  above, and takes it back below as a negative margin. Margin, because padding cannot go negative;
  and a lone negative margin collapsing against the next block's zero leaves exactly that amount. It
  is plain CSS, so it works in every browser.
- **Typst** makes a line exactly one em tall with its baseline one descender above its foot, so that
  the gap the template inserts between blocks is simply space after + space before + leading, with no
  term that depends on the block before.

**Space at the top of a page.** Typst drops space before a block that starts a page; the editor has no
pages; Word's behaviour depends on the kind of break and a compatibility setting. The canonical rule
is that space before is suppressed at the top of a page. **In Word, measured** (M16 in
[the Word measurements](../../spikes/word-measure/measurements.md)): Word drops a paragraph's
space before at the top of a page a page break began, and keeps it at the top of a page a section
began, so the Word writer writes `w:spacing w:before="0"` on each section's first paragraph and
starts a later appendix's page by `w:pageBreakBefore` on its heading.

**Line breaks and page breaks never agree**, and are not part of agreement. Preview shows them.

## The editor

**The measure is the layout's.** The editor sets text in a column as wide as the publishing layout's
text width, scaled to the screen, with zoom (CNT-115) - the way Word's page view does. Line lengths
are then realistic and relative image widths mean what they will print as. It is the only piece of
page geometry the editor reads (STY-N02 keeps the rest in the layout). The cost is a zoom-out or a
horizontal scroll on a narrow screen, which is the right cost for a tool whose output is a page.

**The canvas is paper.** When the application is in dark mode, its chrome goes dark and the document
canvas stays the theme's paper and ink, as Word and most layout tools behave. A theme's colours were
chosen for paper, and CNT-097 wants an author to see what a reader will see. This settles the editor
half of STY-Q04 without theme variants; whether the HTML reading format (PUB-056) needs a screen
palette is left for when it is designed.

**Typefaces come with the renderer**, as `@font-face` rules pointing at the pinned files, in both
deliveries: TH-B cut typeface artifacts from T1, so the tenant's store holds none, and
[The theme in the editor](#the-theme-in-the-editor) (ET-C) bundles the worker's pinned files instead.
The desktop shell has no special path; it loads the same renderer.

**What the editor does not render**, it does not approximate: keep-with-next, keep-together, widows
and orphans, hyphenation, and table break behaviour. The property set marks each as pagination-bound
and the CSS projection omits it. Preview, which is the Typst pipeline (PUB-006), shows them.

## Typefaces

A typeface artifact is the font files themselves (STY-047), versioned, with the licence recorded and
whether it permits embedding - **separately for PDF and for Word** (STY-041), since a licence can
permit one and not the other.

- **For PDF**, the pinned files are handed to Typst as its only font directory, with system and
  built-in fonts ignored (ADR-0013). A face whose licence forbids embedding is refused (STY-042).
  The pinned set must include a mathematics face, because pinning excludes Typst's built-in one.
- **For Word**, a face whose licence permits it is embedded in the document. A face whose licence
  does not must name a permitted face to use instead (STY-052), which the Word projection uses and
  the publish report states. Declared in the theme and reported at publication, the substitution is
  not the silent kind STY-040 forbids.
- **Vertical metrics** - ascent and descent, as fractions of the em - are read from the font file
  when a typeface is ingested and carried on the artifact (STY-054). They are what place a baseline
  inside a line, and both the CSS projection and the Typst template need them to match Word.
- **Glyph coverage** is checked at resolution (STY-049): every character in the resolved document is
  looked up in the character maps of the faces its styles use, and a missing one fails the publish
  naming the character, the style and the face. The spike showed that no engine setting catches
  this - Typst either borrows a glyph from an undeclared face or sets an empty box, with no warning.

## Word

Every catalogue style becomes a Word style: identifier from the catalogue (STY-005), name as the
catalogue names it, and **every property stated explicitly on every style**. `basedOn` is kept, so
the hierarchy shows in Word's styles pane, but no property is left for Word to inherit. Recipients
restyle individual styles; a change to a parent does not cascade. That is a deliberate cost: Word's
inheritance is not the resolver's, and a Word document that quietly disagrees with its PDF is the
worse outcome.

**Stating every property is not enough on its own, and the first version of this design said it was.**
Word's toggle rule does not act within one style's chain. It acts between a **paragraph style and a
character style** on the same run: bold in both cancels, so a `strong` word in a bold heading comes out
not bold however explicitly each style is written (ECMA-376 17.7.3). And Word lets a run name only
**one** character style, so a word both strong and emphasised cannot be said with styles at all.

Both are handled by `wordRun`, which computes Word's reading of each run - the paragraph style XOR the
first mark's style - and, only where that differs from the canonical rendering, sets the value directly
on the run, which Word treats as absolute (STY-055). Everywhere else the run names its character
style and nothing more, so restyling `Strong` in Word still reaches every run it should.

**Measured with a control.** The same Word document with every pin removed, rendered by LibreOffice:
the strong word in the bold heading came out **regular**, and the strong-and-emphasised word lost its
italic. With the pins, both are right. So the renderer implements Word's rule, the problem is real,
and the pins are what fix it. Word itself was then checked by eye, as PUB-029 requires: the same
two words bold and bold italic, and the spacing matching the PDF.

## Keeping the three in agreement

**The conformance suite is how agreement is kept** (STY-080 for the editor, STY-081 for Word, each
against the PDF). For each property in the set, a fixture
document exercises it at several values, and each projection's output is measured rather than read:

| Target | How a value is measured                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typst  | From the PDF: each character's text matrix gives its baseline, not its bounding box                                                                                                                             |
| Word   | Word itself exports the `.docx` to PDF and it is measured the same way, by the same reader and comparison (W15.2, W15-A); LibreOffice, the prototype's proxy, is not used                                       |
| Editor | Chromium: a zero-size marker at each line's start gives the baseline, and computed styles give size, weight and colour. Built by W13.4 ([The theme in the editor, measured](#the-theme-in-the-editor-measured)) |

The fixtures are generated as well as hand-written: random valid property values, resolved and
projected, with the three measurements compared. A projection that agrees on the values somebody
thought to try and disagrees on the rest is exactly the drift this suite exists to catch.

It runs when the schema or a projection changes. It does not need to run when a tenant edits a theme:
tenant themes are data inside the property set, and a projection correct for every value in the set is
correct for every theme.

## What the prototype measured

One fixture, seven blocks, three styles, rendered through all three targets. Positions are relative
to the first line; tolerance is half a point.

| Claim                                          | Editor | PDF   | Word (LibreOffice) |
| ---------------------------------------------- | ------ | ----- | ------------------ |
| Line spacing inside a paragraph, declared 14pt | 14.00  | 14.00 | 14.00              |
| Body into quote: 6 after + 12 before + 14      | 32.00  | 32.00 | 32.00              |
| Quote into body: 12 + 0 + 14                   | 26.00  | 26.00 | 26.00              |
| Heading into body - Word's formula says 21.51  | 21.38  | 21.51 | 21.50              |
| Body into heading - Word's formula says 40.49  | 40.63  | 40.49 | 40.50              |
| Quote's first-line indent, 18pt                | 18.0   | 18.0  | 18.0               |
| Strong word in a bold heading renders bold     | Yes    | Yes   | Yes, with the pin  |
| Strong and emphasised word renders bold italic | Yes    | Yes   | Yes, with the pin  |

**Every baseline agrees within 0.13pt**, and the PDF and the Word proxy within 0.01pt. Before the
metrics were used, the editor drifted 1.1pt at each change of line spacing; before the template set
its paragraphs explicitly, Typst dropped the quote's indent - since Typst 0.13, inline content alone in
a block is not a paragraph, and first-line indent silently does nothing to it while leading still
applies. Both were caught by the harness, which is also how it is known that the harness can fail.

**Checked in Word, by eye:** the fixture's output opened in Word matches the PDF, including both
pinned words and the spacing. **Still not measured:** Word to the point, and more than one face -
one fixture with one face is not every theme.
The conformance suite this becomes (STY-080 and STY-081) needs generated values, more faces - in particular faces
whose metric tables disagree with each other, where renderers may choose different ones - and Word.

## Themes in the PDF

Designed on 2026-09-24 against the pinned engine, as equations were, to take this design from a
prototype to the publication. What exists: the resolver and its three projections in
`packages/domain/src/theme/`, unexported, over a property set of ten paragraph properties and two
marks; a `style` on every paragraph and table and an `imageStyle` on every figure and inline image,
of which `assemble` accepts only `body`, `table`, `figure` and `inline` and refuses the rest as
`style_missing`; three families pinned in the worker's image by hash - Liberation Serif, Liberation
Mono and STIX Two Math, each under the SIL Open Font Licence; and template 11, which sets every size,
face, weight and space itself, as literals. There is no theme, catalogue or typeface artifact, and
nothing a publication records says how it looked.

### What the pinned Typst does with a theme's properties, measured

Throwaway files compiled by the pinned Typst 0.15.1 with the worker's own arguments - PDF/UA-1,
`--features a11y-extras`, the pinned fonts and no others - read back with the worker's own PDF reader
and checked by the pinned veraPDF where tagging was the question. Each claim ran against a control.

| Case                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`smallcaps` in Liberation Serif**, and `smallcaps(all: true)`, against the same words unchanged                                                                                                                    | **Nothing happens, and nothing says so.** The words set at exactly the widths of the control, in the regular face: neither Liberation face has small capitals, and the engine neither synthesises them nor warns. The same holds for Liberation Mono                                                                  |
| **A table's continuation label**: a first header row spanning every column, holding `context` that sets `pdf.artifact(..)` only on a page after the table's first, the row's inset zero and the label padded instead | The label reads on every continuation page and is an **artifact**, as the repeated header rows are; on the first page the row takes **no height** (the first header row's baseline is where the control's is, 357.54pt); veraPDF passes. What remains is an empty header cell in the structure tree on the first page |
| The same row with the cell's own inset                                                                                                                                                                               | The first page carries a blank row of the inset's height, 10pt, above the header                                                                                                                                                                                                                                      |
| **A table row too tall for what is left of a page**, as it is and with `table.cell(breakable: false)`                                                                                                                | As it is, the row **splits** across the pages, the header repeated above its second half; not breakable, the row moves whole to the next page. veraPDF passes                                                                                                                                                         |
| **A floated figure and a floated box**, `placement: bottom` and `place(top + right, float: true)`                                                                                                                    | Each goes to the **foot or the head of the page as a band of its own**; text never runs beside it, so "right" places the box within the band. The content stream follows the page - the box's text first - while the structure tree keeps the source's order; veraPDF passes                                          |
| **Widow and orphan costs** at 0% and at the engine's default of 100%, a nine-line paragraph moved line by line across a page foot                                                                                    | At 100% neither a first line alone at a page's foot nor a last line alone at its head is ever set - the paragraph moves or two lines go over, Word's two-line rule; at 0% both are set. A boolean in the theme is the two costs                                                                                       |
| **Keep with next**: a heading's block, `sticky: true`, then the template's weak space, then a paragraph, with one line left on the page                                                                              | Sticky, the heading moves to the next page with its paragraph, weak space or not; not sticky, it is left alone at the foot                                                                                                                                                                                            |
| **Keep together**: a nine-line paragraph in `block(breakable: false)` where six lines would fit                                                                                                                      | Moves whole; breakable, six and three                                                                                                                                                                                                                                                                                 |
| **The design's line** - each line one em from the face's descender, `leading` the rest of the line spacing (14pt at 11pt) - with a display-style sum inline                                                          | Lines are 14.00pt apart until the sum; the line holding it is **20.68pt** below the one before and the next **21.42pt** below it. A line grows for what it holds, above and below, as Word's `atLeast` lets it; what Word does with the same line is not measured                                                     |
| **Scripts in the pinned faces**, read from their character maps                                                                                                                                                      | Liberation Serif and Mono each cover Latin, Greek, Cyrillic and Hebrew; **neither has a single Arabic, Devanagari, Thai, Armenian, Georgian or CJK letter** of those checked. STIX Two Math is a maths face                                                                                                           |

**Three corrections to this design follow from the table.** Small capitals are not a property the
pinned faces can set, so the paragraph table's `smallcaps` row is a silent approximation - the thing
STY-037 forbids elsewhere - until a theme declares a face that has them. "Floated" cannot mean text
wrapping beside an image in the PDF, only a band at the page's head or foot; Word's "top and bottom"
wrapping is the same shape, so the two outputs can agree. And the continuation label's words are
words in a language, and a theme has none: they belong to the layout, beside the contents' title, and
the table style says only whether the label appears and how it is set.

### How a theme reaches the PDF

**The theme is stored, versioned and recorded, as the layout is.** A theme and its catalogues are
artifacts - kinds `theme` and `catalogue` - and the product's default theme, with one catalogue of each
kind, is seeded by a migration and made the environment's by a `theme_default` row, as migration 0018
seeded the default layout. A publication request records the theme version it was made under and each
catalogue version that theme binds, as it records the layout's, so a publication says how it looked
and a retry looks the same. The store refuses a theme the domain's reader refuses, the contrast check
among its rules.

**The faces stay in the worker's image, pinned by hash, and the theme names them.** Each typeface in a
theme records its family, the hash of each of its files, its licence, whether that licence permits
embedding in a PDF and in a Word document (STY-041), its ascent and descent, and a Word face where it
cannot be embedded there (STY-052). A publish refuses, by name, a theme naming a face whose PDF
embedding is not permitted (STY-042) or whose files the worker does not hold. The metrics are the
file's: a test reads each pinned file and fails where the theme's numbers differ from it.

**`assemble` resolves; the template reads.** `assemble` resolves the recorded theme once, checks every
style a document uses - that it exists (`style_missing`, STY-027), that it applies where it stands
(`style_not_applicable`, STY-006), that the faces its text needs cover every character (the glyph check
asking the style's face rather than a fixed one) - and puts the Typst projection in `publishing/12`'s
`theme` member. Template 12 sets **every** face, size, weight, posture, colour, space and line from
that member and from nothing else: no literal size, face or colour survives in it, which a test reads
the template for. Template 11 stays frozen for what was made before.

**The paragraph's `body` means the default where it stands.** The editor has written `body` on every
paragraph since the content model was built, in running text, lists, quotations, table cells and
footnotes alike, and a footnote set at the body's size would be wrong. So the theme names the default
paragraph style for each of those places, and a stored `body` is resolved to it; any other identifier
is the style it names. **Everything the template generates is set in a role's style** - headings by
depth, the cover's title, the contents and the lists and their entries, captions, a table's note, an
attribution, preformatted text and its label, running heads and feet, the draft notice - which the
theme maps to paragraph styles an author cannot choose.

**Spacing and lines follow ADR-0014, now in the template.** Space between two blocks is the first's
space after plus the second's space before (STY-050), inserted as weak space so it vanishes at a
page's head; a line is one em from the face's descender and its leading the rest of its line spacing
(STY-051, STY-054); keep-with-next is `sticky`, keep-together `breakable: false`, widow and orphan
control the two costs at 100% or 0%, and hyphenation `hyphenate` in the passage's own language. Every
publication's vertical rhythm changes with template 12, and the default theme's numbers are chosen to
stay close to template 11's.

### Decisions for Ken

| #    | Decision                                                                                                                                                                                                                                                                                                                                                | Recommended                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TH-A | **The theme and its catalogues are stored artifacts**, the default seeded and made the environment's, and a publication records the versions it was made under                                                                                                                                                                                          | Yes, as the layout was. A theme held as a constant in code could not be recorded, and a publication that cannot say how it looked cannot be made again                                                                                                                                                      |
| TH-B | **Cut typeface artifacts from T1.** The faces stay pinned in the worker's image; the theme records each by its files' hashes, with its licence, its two embedding permissions and its metrics                                                                                                                                                           | Yes. Typeface artifacts in the object store exist for a tenant's own faces (STY-046), which are not T1; the product's three faces gain nothing from moving, and the move is a slice of its own - upload, ingest, metrics read on ingest, serving. STY-041 and STY-042 are met by the record and the refusal |
| TH-C | **All six catalogue kinds exist; admonition and citation are empty** in the default theme                                                                                                                                                                                                                                                               | Yes. STY-003 asks for the six, and there is no admonition or citation to style; an empty catalogue costs a row                                                                                                                                                                                              |
| TH-D | **T1's property set**: STY-008's list - face, size, weight, colour, alignment, three indents, the two spaces, line spacing, keep-with-next, keep-together - with posture, widow and orphan control and hyphenation; and a character style for **each** of the nine marks. **No small capitals and no letter spacing**                                   | Yes. Small capitals are measured to do nothing in the pinned faces, and a property that does nothing silently is worse than one that is absent; it arrives with a face that has them and a check that refuses one that does not. STY-010's per-theme map holds without them                                 |
| TH-E | **A stored `body` means the default where it stands**, the theme naming a default per place, and **generated text is set by role**, the template holding no typographic literal                                                                                                                                                                         | Yes. It keeps every paragraph stored so far meaning what its author saw, and makes "the template decides nothing" something a test can check rather than a hope                                                                                                                                             |
| TH-F | **No style picker in the editor yet.** Choosing a paragraph's style arrives with the theme in the editor (STY-058, CNT-097), where choosing one visibly changes the text                                                                                                                                                                                | Yes. A picker now changes nothing an author can see until they publish. Until then only the defaults and the roles are reached, and a stored identifier the theme lacks, or one used where it does not apply, fails the publish by name                                                                     |
| TH-G | **Contrast refused when a theme is saved** (STY-069): every text colour against every background it can stand on - the paper, a table's header and band fills, preformatted text's fill - at 4.5:1, or 3:1 for text of 18pt, or 14pt bold                                                                                                               | Yes, for the product's theme, the only one T1 has. Whether a tenant's own palette is refused or warned (STY-Q05) is still open, and nothing here decides it                                                                                                                                                 |
| TH-H | **Arabic.** The pinned faces cannot set it, and CNT-059 admits it. Pin an Arabic face (Noto Naskh Arabic, OFL) and measure its shaping and tagging; or **narrow STY-048 for T1** to the scripts the faces cover - Latin, Greek, Cyrillic, Hebrew - moving "the scripts the supported locales admit" to T6 beside LOC-038, whose list does not exist yet | **Narrow it**, unless you know of an Arabic-script customer. Until LOC declares its locales, "the scripts the supported locales admit" has no list to meet, and Arabic text is refused by name today rather than set wrongly                                                                                |
| TH-I | **Tables.** A table style: header row and column treatment, banding, rules, padding, whether the header repeats, whether rows are kept whole, and whether a continuation label appears - its words the layout's (`words.continued`, a layout schema 4). **Alignment by column type waits for column types**, which come with STY-014 in T2              | Yes, and **split STY-012**: its T1 half without column types, and alignment by column type moved to T2 beside STY-014. Otherwise STY-012 is a T1 requirement nothing in T1 can demonstrate                                                                                                                  |
| TH-J | **Images.** `figure` and `inline` become the image catalogue's two styles at today's numbers; placement is inline, block or floated, and **floated means the page's head or foot**, aligned start, centre or end within it                                                                                                                              | Yes: measured, there is no other float in the engine, and Word's "top and bottom" wrapping matches it                                                                                                                                                                                                       |
| TH-K | **Two build slices after this one.** Themes 1: TH-A to TH-H - the store, the property set, paragraph and character styles, roles, the line and spacing rules, `publishing/12` and template 12. Themes 2: TH-I and TH-J - table and image styles, and layout schema 4. The Word projection comes with Word; the theme in the editor after that           | Yes. Themes 1 is the size of equations 2; themes 2 is smaller. Each lands something a publication shows                                                                                                                                                                                                     |

**Ken agreed every recommendation on 2026-09-24.** TH-H and TH-I are made in the requirements:
STY-048 is superseded by STY-074, its T1 half, with STY-075 in T6, and STY-012 by STY-076, with
STY-077 in T2 beside STY-014.

**What themes 1 and 2 claim and cite.** STY-001, STY-002, STY-003, STY-005, STY-006, STY-008,
STY-009, STY-010, STY-024, STY-041, STY-042, STY-069 and STY-074 by themes 1, with PUB-019 while the PDF is the
only output; STY-076, STY-013, STY-015, STY-017, STY-018, STY-019, PUB-017 and TAB-032 by
themes 2. **Not cited by either**: STY-025, which needs a template to bind a theme (TPL), the
environment's default standing in as it does for the layout; STY-039, whose browser and desktop half is
the editor's; STY-077 and STY-075, T2's and T6's; PUB-092, which names each engine and so waits for Word; and
STY-058 and STY-070, the editor's. **STY-009 is cited today by a prototype test over a character catalogue
of two marks of the nine**; themes 1's character catalogue covers all nine and its test replaces that citation.

**Since W14.3** themes 1's four pagination cases live in the publishing regression corpus, each also
reading its rule from the same style as Word's; STY-008's keeping half is cited there, as it was in
`themes.test.ts`, and PUB-092 stays uncited for the gap named beside the table above.

### What was built

**TH-A to TH-H are built**, by [themes 1](../plans/2026-09-24-themes-01-the-theme-in-the-pdf.md): the
theme model exported from `packages/domain/src/theme/` - `catalogue/1` and `theme/1`, `readCatalogue`
and `readTheme` returning every refusal at once, contrast, the default theme and its six catalogues as
data, and the Typst projection - migration 0024 seeding them as `theme` and `catalogue` artifacts,
declaring the theme by `theme_default` and recording its version on every request and publication,
`publishing/12` and template 12, which sets the face, size, weight, posture and colour of all its
text, a paragraph's fill, padding, alignment and indents, its line spacing, the space between blocks
and the size of a script from the theme, and holds no typographic literal a test does not allow - not
every value, since what it never sets is still the engine's, below - and the worker refusing a face
it does not hold. Nothing chooses or edits a theme: every environment has the one its migration
seeded. Building it changed these things here:

- **The roles are nineteen**: the six headings, `title`, `notice`, **`noticeSentence`** - the draft
  notice's sentence under the cover's title, which template 11 set in bold at the body's size -
  `contents`, `contentsEntry`, `list`, `listEntry`, `caption`, `tableNote`, `attribution`,
  `preformatted`, `preformattedLabel` and `running`. The places are the five above.
- **Two properties joined TH-D's set.** A character style's **`scale`**, a fraction of the size of
  the text the mark stands in, so inline code is set at 0.8 of it as template 11 set it; and a
  paragraph style's **`padding`**, the room between its fill and its text on every side, drawn only
  where it has a `background`, so preformatted text's panel is inset 6pt from the theme. The CSS
  projection does not yet project either; Word's does since Word 1, `scale` as each run's size and
  `padding` as borders in the fill's colour and indents.
- **The default's numbers are template 11's, measured where the engine chose them**, by ADR-0014's rule
  from template 11's own distances: the body 11pt with 2.75pt after and a 14.35pt line, headings
  16pt, 13pt and 11pt bold, a footnote 9.35pt, text in black on white. Its table cells are set in a
  style of their own, `table-cell`, centred as template 11 centred them, and its captions centred.
  The plan records each number.
- **`assemble` measures from the theme**, and `measure.ts`'s header states what template 12 keeps to:
  a quotation is inset by exactly its style's start and end indents, the engine's own inset stopped; a
  list's indent is in ems of its item's size; preformatted text's columns come from its role's size,
  its face's advance, its indents and its padding; an image in a line of text is 1.2 ems of the style
  it stands in; a caption's height is estimated in the caption's size.
- **Only a paragraph carries its style** into the published document; a stored `body` becomes the
  default of the place that holds it most nearly. A table's and an image's styles are checked, and
  `style_missing` or `style_not_applicable` names them, but carry nothing until themes 2 gives them
  properties.
- **The faces are checked twice.** Before `assemble`, the worker holds every face the theme declares
  to its pinned files **exactly** - every file of its family and no other, the ascent, descent and
  advance it records the files' own, and the maths face a face with an OpenType `MATH` table - and a
  face it does not hold fails `typeface_unavailable`, naming the family and why, `files`, `metrics` or
  `maths`; `assemble` fails `typeface_not_embeddable` for a face the document sets text in whose
  licence forbids embedding in a PDF. The glyph check asks the family that sets the text.
- **The reader bounds what a page can hold, and what a line can.** A size is at most 144pt and a line
  spacing 288pt, not Word's 1638; a style whose line spacing, as it resolves, is below its size is
  refused, `line_spacing_below_size`, since a line is one em tall. Nothing yet holds a theme's sizes,
  padding or spacing to the page a layout declares.
- **Contrast is judged at the size text is set at**: a character style in each paragraph style at the
  paragraph's size times its `scale` and, for a subscript or superscript, the script's size, 1331/2048
  of its text, which the projection states as `script` and template 12 sets rather than leaving to the
  engine; bold from the mark or the paragraph; and a mark with no colour of its own in its
  paragraph's colour, where it asks more than its paragraph does. Marks nested in each other are not
  judged together.
- **Keep-together keeps a paragraph whole where it fits a page**, as Word's `keepLines` does, and
  breaks one taller than the page's text block, which template 12 measures; the engine would have
  painted it off the page.
- **Not every value is the theme's.** What the template never sets is the engine's default, and no
  theme moves it: a list's and an enumeration's indents, a definition list's hanging indent and
  separator, the contents' leader and indents, the underline's offset and thickness, how far a script
  is lowered or raised, and a footnote's separator, clearance and indent, which no property of themes 1
  or 2 names. A table cell's inset and a table's rules, which template 12 left to the engine, are the
  table style's in template 13 (themes 2, below). Template 13's header names each.
- **A quotation is no longer set off.** The theme styles paragraphs, not a block's edges, so the space
  around a quotation is its paragraphs' own: 16.5pt less above it and before its attribution than
  template 11 set, and 9.9pt less after it. A spacing property for a block's edges, as Word's contextual
  spacing is, would restore it, and is a later widening. The other visible moves are small and listed
  in the plan: a heading straight into a heading, a list's space above, a table's rows and its caption
  and note, a note's second paragraph and the page's frame, each by the line model.
- **`spikes/theme-conformance/` no longer runs against the model**: it calls the prototype's
  `resolveTheme`, `exampleTheme` and `resolveStyle`, which the model replaced. It stays the record of
  what ADR-0014 measured, above. The conformance suite's editor half, toward STY-080, is the browser
  suite's since W13.4 ([The theme in the editor, measured](#the-theme-in-the-editor-measured)).

**The Word projection is built**, by Word 1: what it writes and what Word showed of it are in
[the Word output design's "What was built"](word-output.md#what-was-built).

**TH-I and TH-J are built**, by [themes 2](../plans/2026-09-24-themes-02-table-and-image-styles.md):
`catalogue/2`, which gives the table and image catalogues their properties and a paragraph style
`contextualSpacing`, the reader upgrading a `catalogue/1` as it reads it; layout schema 4's
`words.continued`; migration 0025 seeding the default theme's 0.2 - new paragraph, table and image
catalogues and the theme naming them - and the default layout's 0.5, which says _(continued)_; and
`publishing/13` and template 13, which set a table's rules, fills, cells' inset, header weight, header
repetition, rows kept whole and continuation label from its table style, a figure's and an image's
size, placement and alignment from its image style, and contextual spacing between two paragraphs of
one style, in one container, that both ask for it. Still nothing chooses or edits a theme. Building it changed these
things here:

- **The default's tables and images look as template 12 set them**: every rule 1pt black, inside and
  out; cells padded 5pt; the header neither filled nor bold; no banding; the header repeated, rows
  allowed to split, and no continuation label, since a label leaves an empty header cell in the
  structure tree on the table's first page, a cost a theme should choose. A figure fixes its width at the
  measure, at most 0.6 of the text block's height, a centred block; an image in a line its height at 1.2
  ems, at most the measure wide. Compiled without quotations, template 12 under 0.1 and template 13
  under 0.2 paint every run, rule and fill the same to within 0.005pt.
- **A quotation is set off again.** The quotation's style takes 16.5pt before and 12.65pt after and asks
  for contextual spacing, and the attribution's takes 6.6pt before and 12.65pt after - one space after
  on the quotation cannot give both template 11's distance into its attribution and its distance into
  the text after it. Every distance template 11 set around a quotation is back but two: its own
  paragraphs stand a line apart, 2.75pt closer than template 11 set them, and two quotations in a row
  stand 43.5pt apart, 9.9pt further than template 11's 33.6 - the first's space after and the second's
  space before, which add, where template 11's engine took the larger. Contextual spacing reaches only
  within one container - one quotation, one list item, one cell, one note, the top level - and never
  across a list's, a quotation's, a table's or a figure's edge, nor between two notes or a table's
  caption and its cells, so two quotations are never set as one. The plan has the measured table.
- **An image style fixes one dimension** in points, a fraction of the layout's measure (a width), a
  fraction of the text block's height (a height) or ems of the text it stands in (an image in a line);
  the other comes from the pixels, and both are re-derived where the other would pass the maximum. "The
  measure" is the layout's, the editor's column, not the room where the image stands, which caps it
  afterwards: a figure is made smaller to fit its place and what its caption leaves, as before, and an
  image in a line wider than its room is refused, `image_too_wide`. Under the default an image in a line
  at the top level can no longer be too wide, since its maximum is the measure: it is made smaller.
- **An inline image style has no alignment**, rather than one ignored; `block` and `float` require one,
  and a style for both figures and images in a line is refused, since no placement serves both. Floated
  goes to the page's head or foot, whichever the engine finds room at: an author cannot choose which.
- **The continuation label** is a first header row the engine repeats at level 1, with the header rows
  at level 2 repeating or not by the style, set as an artifact in the caption role's style on every page
  after the table's first - "Table 3 (continued)", the layout's words in the layout's language. A table
  style asking for one under a layout with no `continued` fails the publish,
  `continuation_words_missing`, naming the table and the style. On the table's first page the label is
  hidden and its row keeps its room, 27pt under the worker test's ruled style, so the header stands that
  much lower than without a label: the engine sizes a split row's later parts from the page the row
  begins on, and with no room there the row's last line on each continued page stood below the text
  block (found in the final whole-branch review). A table broken across pages is framed in
  the outer rule on each page, as the engine draws it; header bold is applied to the text, so it wins
  over the cell style and marks.
- **Contrast is judged on a table's fills** for every paragraph style that applies to `tableCell` or to
  `listItem` - a paragraph stored in any of them is set in it in a cell - with every mark in each, bold
  where the header is.
- **A table style's rules are held to its padding**: a rule takes no room, so half of it stands inside
  each cell, and one wider than twice the padding would be drawn over the cell's text. The reader
  refuses it, `table_rule_over_text`, naming the style and the rule. A wide outer rule still reaches
  half its width into the margin.
- **A row kept whole is kept only where it fits a page**, as keep-together keeps a paragraph: template 13
  measures each run of rows a spanning cell joins against the text block less the header and label that
  repeat above it, and a row taller than that splits, where the engine would have painted it off the
  page.
- **An image in a line is held to the text block's height**, its width re-derived, whatever its style
  allows, and an image style's ems are held to 4.
- **An environment that recorded its own version of the theme or of the paragraph, table or image
  catalogue keeps the old look**: 0025 moves only the product's own unchanged chain, each on its own,
  and its theme stays 0.1, set by the reader's upgrade as template 12 set it. A `catalogue/1` saved again
  unchanged answers unchanged, judged on the version as the reader reads it.
- **STY-019 was claimed and not cited.** An asset version cannot be stored without its dimensions - AST
  records them on ingest - so the named failure it asked for could not arise. Ken superseded it with
  STY-078, the invariant itself, on 2026-09-26, which the asset version's own test cites.

## The theme in the editor

Designed on 2026-09-27 for W8 of [the rest of T1](../plans/2026-09-25-t1-remainder.md), which asks for
STY-058, STY-039, STY-070, CNT-082, CNT-097, CNT-115, CNT-094, CNT-121, CNT-122 and STR-025. What
exists: the theme is stored, read and recorded, and the PDF and Word are set from it; `projectCss`
is built and tested, and nothing calls it. Everything the editor shows is set by one fixed stylesheet,
`packages/editor/style.css`, in the application's own sans-serif at its own sizes, in a column as wide
as the window. No route returns a theme or a layout's page. The faces live only in the worker's image,
and the editor holds no font file. Nothing lets an author choose a style: the editor writes `body`,
`table`, `figure` and `inline` and nothing else (TH-F). The default theme offers **one** style for
each place, so a chooser over it would offer nothing to choose.

### What the editor is given

**Which theme and layout.** A component has no theme of its own. The theme a document uses is the one
its template binds (STY-025), and one component can stand in documents with different themes. So a
component opened on its own is shown in the **environment's default theme and layout**, and one opened
in place on a document's page is shown in **that document's**, as `documentTheme` and `documentLayout`
already resolve them for a publish.

**The stored theme, read by the same reader** (STY-035). Two routes return the same shape:
`GET /v1/presentation` for the environment's default, and `GET /v1/documents/{id}/presentation` for
a document's, readable by whoever can read that document. The shape is the theme version's stored
content, each catalogue version it binds, and the layout's frame. The renderer calls `readTheme` on
them, the reader the store, `assemble` and the worker use, so the editor and the publisher cannot
resolve a style differently. A resolved theme holds maps and cannot be sent as it stands. The frame is
the two numbers of the page an image style's lengths are shares of, the measure and the text block's
height. The third, the size of the text an image in a line stands in, is the theme's. The service
computes the two with the domain's `textMeasure` and `textBlockHeight` from the layout's PDF format, so
nothing else page-shaped reaches the renderer.

**The faces come with the renderer** (STY-039). TH-B cut typeface artifacts from T1, so the tenant's
store holds no face, and the editor cannot fetch one from there, as [The editor](#the-editor) above
supposed. The pinned files move from `apps/worker/fonts/` to a package of their own,
`packages/fonts`, with their licences and the list of files by hash that `apps/worker/src/fonts.ts`
holds today. The worker reads them from there, and the renderer bundles them, so a browser tab and the
Electron window, which loads the same renderer, have the same files, and neither fetches a face from
anywhere else. The renderer writes one `@font-face` rule for each file a theme names by its hash,
under a family name of its own, `aw-face-<typeface id>`. It never uses the family's real name, so a
"Liberation Serif" installed on the reader's machine is never used in its place, just as Typst is
given no system fonts. The files are 3.5 MB in all, fetched by a browser only when a rule uses them.

**Coverage as data.** `covers`, which the glyph check asks, is built by the worker from each file's
character map. The editor needs the same answers without parsing a font. `packages/fonts` holds the
characters each family covers as ranges, generated from the files, with a test that regenerates them
and fails on a difference, as `openapi.json` is checked. The worker keeps reading the files, and a
test holds the two to each other.

### What the editor renders

**Every declared property** (STY-058, CNT-082, CNT-097). `projectCss` is widened to the whole
property set: a paragraph's background, padding, alignment, three indents and contextual spacing; a
mark's underline, colour, typeface, position and scale; a table style's rules, fills, banding, cell
padding and header weight; and a typeface's `@font-face` families. Only the pagination-bound
properties are left out, as STY-037 says. They are keep-with-next, keep-together, widow and orphan
control, hyphenation, header repetition, rows kept whole and the continuation label. **A test fails
when a property is added to the schema and neither projected nor listed as pagination-bound**, so the
widening cannot stop at a sample again.

- **Contextual spacing** is an adjacent-sibling rule between two paragraphs of one style, which CSS
  keeps within one container, as the template does.
- **The mark classes** are written by the marks' `toDOM`, which today writes bare elements.
- **Equations** are set in the theme's maths face.

**`body` means the default where it stands** (TH-E), in the editor as in the publication. The editor
marks each paragraph with its place, from the nearest container that holds it - a list item, a
quotation, a table's cell, a footnote, or the text - which is `assemble`'s rule. It marks it by a node
decoration rather than by CSS selectors, which cannot say "nearest". What the template sets by role,
the editor sets by the same role: a caption, a table's note, an attribution, preformatted text and its
label.

**The canvas is paper**, as [The editor](#the-editor) above settled: the theme's paper and ink in dark
mode as in light. It is `.aw-canvas`, around the editing surface and around a document's read text
alike, and every rule of the projection is scoped under it. Nothing sets typography on `.ProseMirror`,
which a test already forbids.

**The measure** (CNT-115). The canvas is the layout's measure wide, in points: 451.28pt under the
default layout, which is about 602 CSS pixels at 100%. At 100% it is the printed size. A zoom control
beside the editor steps through 50, 75, 100, 125, 150 and 200%, and Fit makes the measure fill the
column. The zoom is kept per viewer in the browser, as a convenience. It is applied as one CSS custom
property that every length in the projection is multiplied by, not by CSS `zoom` or a transform,
under which ProseMirror's positions from coordinates and the caret can drift. A column narrower than
the canvas scrolls sideways, which is the cost [The editor](#the-editor) accepted.

**Images at their styled size** (CNT-122). The editor sizes a figure and an image in a line by
`styledSize`, the function `assemble` sizes them by, from the asset's pixels and the frame. The asset's
pixels are already on its version (STY-078). A figure then prints as wide as it shows.

### Choosing a style

**A paragraph's style** (CNT-094). The toolbar gains a Style list showing the style of the paragraph
at the cursor.

- It offers only the styles that apply where that paragraph stands (STY-006), with the place's
  default first, labelled as the default.
- Across a selection of several paragraphs, it offers only the styles that apply to every one.
- A role is never offered.
- Choosing the default stores `body`, so a paragraph moved into a list takes the list's default, as
  TH-E has it. Choosing any other stores that style's identifier.
- The choice is one step in the component's history, undone by Undo, and nothing else in the editor
  sets alignment, indentation or spacing.

**A table's and an image's style.** A table is a block, so its style is chosen as CNT-094 asks, from the
Table panel's new Table style list; an image's is CNT-121's. The Figure
dialog, which places a figure or an image in a line, and the Figure panel gain an Image style list,
each over the styles that apply to what is being placed: `figure` or `inlineImage`.

**The default theme gains something to choose.** Its 0.4 - 0.3 being the maths face for Word - adds three paragraph styles for the text,
one table style and one image style. The paragraph styles are _Lead_, larger with more space after;
_Centred_; and _Small print_. The table style is _Banded_, with a filled bold header, banded rows and
no vertical rules. The image style is _Half width_, a centred figure half the measure wide. All five
are held to contrast as every style is. It is a migration, as 0025 was, moving only the product's own
unchanged chain. The PDF and Word projections are generic over the set and need no change for them.

### What will not resolve (STY-070)

Where the editor cannot show what the theme says, it shows that it cannot. It never shows a silent
default:

| What                                                                                                              | What the editor shows                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A paragraph's, table's or image's style that the theme does not hold                                              | The block in its place's default, outlined and labelled with the style's identifier and "not in this theme": what `style_missing` names at publication                          |
| A style that the theme holds but that does not apply where it stands                                              | The same, labelled "does not apply here": `style_not_applicable`                                                                                                                |
| A typeface whose files the renderer does not hold by hash, or whose file fails to load, by the font's load status | A notice on the canvas naming the family, its text set in the application's own face and the notice saying so: never quietly in a fallback (STY-040)                            |
| A character that the family setting it cannot set, by `characterProblems`                                         | The character marked, and its code point named on hover. This is the check the publish fails on (STY-049), asked in the same setting - body, code or maths - of the same family |

The marks are made again when the component's text or the theme changes, and not on a draw that changed neither: one pass over the component, a range lookup per character, which W8.6 found cheap enough that marking only the blocks a change touched was not built.

### Decisions for Ken

Taken as recommended, on Ken's instruction of 2026-09-27 to continue with W8, and his to review.

| #    | Decision                                                                                                                                                                                                                                                                | Recommended                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ET-A | **A component on its own is shown in the environment's default theme and layout; in place on a document's page, in that document's.**                                                                                                                                   | Yes. A component has no theme of its own. The alternative, the theme of the document it was last opened in, would make one component look different depending on how you reached it.                                                                             |
| ET-B | **The stored theme is sent to the renderer and read there by `readTheme`,** with the layout's frame computed on the service.                                                                                                                                            | Yes. It is STY-035 in the plainest form: one reader. Resolving on the service would need a second, serialisable resolved shape to keep in step with the first.                                                                                                   |
| ET-C | **The faces move to `packages/fonts`, and the renderer bundles them,** under family names of their own, never a system face.                                                                                                                                            | Yes. It gives both deliveries the same files with no new route, and the files work offline in the desktop shell. Serving them from the service by hash would be the way once typeface artifacts arrive, and would change only where the `@font-face` URLs point. |
| ET-D | **Coverage is generated data, checked against the files.**                                                                                                                                                                                                              | Yes. Parsing fonts in the browser would be a second cmap reader to keep in step with the worker's.                                                                                                                                                               |
| ET-E | **The canvas is the measure at true size at 100%, with stepped zoom and Fit, kept per viewer;** zoom is a CSS custom property, not CSS `zoom`.                                                                                                                          | Yes. True size makes a relative image width mean what it prints as. A custom property keeps ProseMirror's coordinates exact.                                                                                                                                     |
| ET-F | **The projection covers every property but the pagination-bound, tables and images included, and a test fails on one left out.** `body` is resolved by place, by a decoration.                                                                                          | Yes. It is what STY-058 asks, and the test is what stops a second partial projection.                                                                                                                                                                            |
| ET-G | **Choosing a style.** Paragraphs from the toolbar, tables from the Table panel, images from the Figure dialog and panel; only styles that apply are offered; the default stored as `body`.                                                                              | Yes. It follows TH-E and STY-006. A chooser that offered a style and was then refused would be worse than one that offers only what fits.                                                                                                                        |
| ET-H | **The default theme 0.4 adds Lead, Centred, Small print, Banded and Half width.**                                                                                                                                                                                       | Yes. Nothing edits a theme in T1, so without them the chooser offers one entry in every environment. Five styles show each chooser working without designing a house style.                                                                                      |
| ET-I | **The markers:** a style missing or out of place, a face not held, a character not covered - shown on the text rather than refused.                                                                                                                                     | Yes. STY-070 asks the editor to show the failure while it can still be fixed. Refusing to open the component would hide it.                                                                                                                                      |
| ET-J | **STR-025 waits for K8.** No STY row gives a caption a placement, so no style can meet it.                                                                                                                                                                              | Yes. K8 recommends filing that row, a placement on table and image styles. That is a requirement for Ken to make. Once it exists, it is one property with its three projections.                                                                                 |
| ET-K | **What the tests show.** jsdom reads the declared value each element takes from the projection's stylesheet. It does not measure a baseline.                                                                                                                            | Yes. Measuring in a browser is STY-053's suite, which W13 builds once K4 decides where a browser runs. Until then, the claim that the editor matches the PDF to the point rests on ADR-0014's prototype, and says so.                                            |
| ET-L | **Six build slices after this one.** W8.1: the faces and the presentation reach the renderer. W8.2: the canvas - text set in the theme at the measure. W8.3: tables and images by their styles. W8.4: choosing a style. W8.5: the default theme 0.4. W8.6: the markers. | Yes. Each slice is visible on its own. The slices were three, then four, then six as each was built and found larger than a pull request should be: tables and images from the canvas, and the default theme's new styles and the markers from choosing.         |

**What W8 claims.** STY-070 and CNT-122 are claimed here from this section. The editor half of
CNT-122 was the missing half; the publish half was built by themes 2. STY-039's claim is restated for
the faces in `packages/fonts`. STR-025 was not claimed then (ET-J); W14.5 claims it, with STY-079, in
[Where a caption sits](#where-a-caption-sits).

## The theme in the editor, measured

Built by W13.4 of [W13](../plans/2026-09-28-w13-browser-suite.md), under its decision B-M, for
STY-080, which it answers since issues #331 and #333 were fixed (below): the conformance suite's editor half, which [Keeping the three in agreement](#keeping-the-three-in-agreement)
designed and ADR-0014's prototype seeded. It is `tests/browser/src/styles.test.ts`, in the browser suite
([ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md)), against the whole system
in containers.

**What is measured, and against what.** One component, made through the API, holds a token - a word
no other text holds - at the head of every block and run the theme styles: a paragraph in each style
an author can choose for running text, a run of each of the nine marks, a bulleted list with a list in
it and a numbered one counted from nine, a quotation with its attribution, preformatted text with and
without its label, a table in each table style with a caption, header rows and columns, bands and a
note, a figure in each figure style, an equation, an image in a line of the body and another in a line
of the lead, and a footnote. It is placed, under five nested sections, in a document made from a template naming each of
five themes: the default; _Contrary_, which differs from the default in every property the editor
projects; and three generated from seeds, the seeds in the test's record. Each document is published
through the stack, and its PDF read by pdf.js - a small copy of the worker suite's `readPaint`, which
places every run by its text matrix - and each token is found the last time it is painted outside an
artifact. The same document is opened in the document view's Reading mode, at 100%, in the pinned
Chromium, and each token measured by a zero-size marker set before its first letter - its baseline and
where it starts - and by its element's computed style. The comparison, in points: where each token
starts across the measure, each step from one baseline to the next in the order the page reads them,
each size, each image's size and where it stands, and each table rule's width - as far as it is painted,
the outer rule's half outside the table included - and where it runs against its cell's text, all within
half a point; and each face, weight, posture, colour, underline and what stands behind the text - a fill,
a band, the paper - and the face an equation is drawn in, exactly. It waits for the page to be drawn
whole - its own title the document's, every token, image and face in - so it never measures the screen
before.

**The themes are written into the stack's database** by `@alloy-works/db`'s own writers,
`addCatalogueVersion` and `addThemeVersion`, as B-C's one exception allows: nothing in T1 makes a theme
through a route. The writers refuse whatever the reader refuses, contrast among it, so a generator the
store would not take is narrowed to what it takes: text dark enough on fills and paper light enough
for any size, line spacing at least 1.2 of its size, rules no wider than twice a table's padding.
Nothing creates a theme or a catalogue artifact but a migration, so the suite copies the default's rows
as each new artifact's first version and writes the theme it measures as the next - fixed artifacts,
so a later run writes nothing where a theme has not changed.

**What the measurement found, and what changed.** Its first run, under the default theme alone, found
twenty-eight differences of half a point to twenty points, and the other four themes more. What was the
editor's own is fixed in the projection (`projectCss`), filed as issue #329; what was not is below.

- **A block's spaces were borders**, which a browser snaps to whole device pixels - up to three quarters
  of a point lost at every block whose space was not a whole number of pixels. They are padding, named
  once each as `--aw-before` and `--aw-after` so that contextual spacing can take either away, with the
  fill painted between them as a positioned gradient.
- **A block's first baseline moved with its size**, because a browser rounds a face's ascent and descent
  to whole pixels. Where the renderer knows a face's cap height - `@alloy-works/fonts` records each
  pinned file's, held to the file by a test - and the browser can (`@supports (text-box: trim-both cap
alphabetic)`), each block is trimmed to its first line's cap height and its last line's baseline,
  which a browser measures exactly, and the rest is padding. Elsewhere the half-leading model above
  stands, within the pixel rounding.
- **The application's and the editor stylesheet's own look reached the canvas**: a table header's
  capitals and tracking and its surface, the space around a list, a table and a figure, preformatted
  text in the browser's own monospace. Each stands down on the canvas.
- **Tables** are set as the template sets them: a rule takes no room, half of it drawn by each cell beside
  its line as an inset shadow and the outer rule's other half outside the table; a cell's first block
  takes no space or leading above it and its last none after it; the table stands apart from its
  neighbours as its cells' place does; the header column's rule runs through the header rows; and the
  corner takes the header column's fill and weight where the header row has none.
- **Lists** stand their items their place's leading apart, with that place's spaces around the list as a
  whole, and each item's text where the engine sets it: a column of markers as wide as the widest - a
  bullet, or the widest number right-aligned - then half an em, the list a grid and each item a row of
  it through `subgrid`, found by the final review, 6.4pt out under the default theme; and its markers
  in the place's weight and posture too, which the re-review's measurement of the markers found missing; **a quotation's attribution** stands inside the quotation's indents; **preformatted text's
  label** stands above its block, out of its fill; **a figure** is aligned in its band by its margins and
  stands apart from its neighbours as its caption does; **an image in a line** stands on its baseline;
  and **a mark in another face or at a smaller size** does not open its line (a larger one does, below).
- **The canvas has room either side of the measure**, 6pt at 100%, where a table's outer rule stands half
  outside the table: scrolling sideways clipped it at the measure (the final review).
- **A block's fill is a colour where it has no spaces of its own**, so that axe-core reads it as the
  text's background and checks its contrast; where it has spaces, it is still the gradient painted
  between them, which axe cannot read and hands to a person as `incomplete` (docs/testing.md).

**After W13.4: the two it named, fixed** - each measured red first, and green after. What the
measurement found, and what changed:

- **A line held open by something taller or deeper than its text** (issue #331). The page's line is
  exactly one em of its text tall - an em less the descender above the baseline, the descender below -
  and grows by whatever stands further out: an image in the line by what it stands above that top, a
  run larger than its text by its growth - the size it is set at less the text's - times the same
  fractions above and below, a script by its mark's scale alone, and a list's item by its marker, set in
  the list's place's style, where that stands further out than the item's text. The editor's line is
  its line spacing tall, split about the face's ascent and descent as the browser rounds them to
  pixels, and a block's first line and last are trimmed, and with them whatever held either open. The
  measurement found the step into such a line up to 7.6pt short under the generated themes for an image,
  and 6pt for a run larger than its text once the themes could scale a mark above its text, and a list's
  item after a nested list up to 10.7pt too far (the nested list's space after, below). No length
  the projection writes can say where the browser's own line stands, so what stands out is measured
  against a line of the paragraph's own text, which the browser makes as it makes the paragraph's
  (`projectCss`'s `markRules`, `imageRules`, `growerRules` and `markerRules`):
  - **A mark is three boxes** (the editor's markup, `schema.ts`): its own element and a box inside it
    are each a line of its paragraph's text - its face, size, weight, posture and line spacing - the
    first raised by the run's growth above and the second lowered by its growth below, on every line the
    run is on; the text is set back on the baseline, at no height of its own, in the mark's look and at
    its scale of the run around it, which a registered `--aw-run` carries into a mark inside it.
  - **An image in a line** stands in a holder, as the surface's image view and now a document's read
    text draw it: a block on the text's baseline holding, above the image, a line of the text trimmed
    at its baseline, less the text's own top.
  - **A paragraph holding either** begins and ends with a line of its own text, which the browser trims
    instead, and is lifted by the line it begins with: its padding above less a line, where that is more
    than nothing, and a margin for the rest, which every block's margin above carries and its fill is
    painted clear of. Its first-line indent moves to the text's own first line, after the break.
    Neither invisible line says anything to a screen reader. Lifted, the paragraph reached over the
    foot of the line above it and took its clicks - the lower half of that line put the caret in the
    lifted paragraph (the final review) - so what it lifts is clipped away, which a pointer passes
    through. The clip makes it a stacking context, painted in the order of the text and raised no
    further: raising it had stood it over a footnote opened in the paragraph above and over a
    component's label (the re-review), so the editor stylesheet raises the paragraph whose footnote is
    open instead, and draws a chosen image's outline inside it, clear of the clip. A
    paragraph marked as not resolving (STY-070) is left as it is, so its label stays its first line.
  - **A list's marker** is trimmed to its cap height and its baseline and padded to the list's leading
    and its own top above it and its descender below, so the row of the list's grid its item stands in
    is as tall as the further of the two. A list that ends an item, where the item is not its list's
    last, stands no space after it: the template sets only its leading there (found by the same
    measurement, 2.75pt under the default theme).
- **Where the document view stands a section's heading** (issue #333). The view set its headings in a
  flexible box, with its own gaps between a heading, its number, the sections under it and a
  component's text - two headings 16.9pt too far apart under the default theme and up to 25.5pt under
  the generated ones, a title 3.5 to 4.7pt along from its number, and a heading centred or set to the end
  by its style not aligned at all - and a heading as wide as the measure beside its indents rather than
  inside them. On the canvas each heading is now a block of its heading style, its number
  and a space and its title in one line of it, in its colour, spaced from what stands above and below
  it by that style alone; the view's own gaps stand down; and each heading stands in a holder the
  measure wide, so its indents and alignment stand inside the measure while its section and component
  keep the column's width - where a component's label stands beside its heading and the editor opened
  in place has the column to itself, which making the sections the measure wide had taken from them (the
  final review). Where a heading starts, and every step into and out of one, are compared.

**Outside STY-080, and why.** STY-080 asks that every style property both outputs render be the same
in each, and that a difference be allowed only where STY-060's list names it. That list is empty between
the editor and the PDF - its one entry, the Word face STY-052 substitutes, is Word's and STY-081's - and
the test holds it so (`EDITOR_DEVIATIONS` in the conformance kit's `compare.ts`, beside Word's own list). What the comparison leaves out is not a
difference it forgives: each is something one output does not render as a style property, so outside
what STY-080 asks.

| Left out                                                                                                                                       | Why it is outside STY-080                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How far a script is lowered or raised, and where it starts                                                                                     | No theme sets either: the engine takes both from the face's own tables - an italic face moves its scripts along the line by its own offset, up to 0.45pt in the seeds measured - and the browser from its own rule ([What was built](#what-was-built); issue #332). Which way a script moves, which the theme's `position` says, is compared, and a script opens its line by its mark's scale as the page's does                     |
| A footnote's place, and where the line holding its anchor starts                                                                               | Not a style: the page sets a footnote at its foot, the document view beside its anchor, lengthening that line with its words. A footnote's face, size, weight, posture and colour are compared                                                                                                                                                                                                                                       |
| Where a line holding an equation starts, where its paragraph is centred or set to the end; the step into a line an equation holds open         | The equation's width and height are each renderer's maths engine's, not the theme's: its width moves the start of such a line, and its height and depth, where they stand beyond its text's, the line's step. Where the paragraph is set from its start, where the line starts is compared, and the step into and out of a line holding an equation within its text's height. The equation's face, which is the theme's, is compared |
| A floated figure                                                                                                                               | The editor has no page to float one to (STY-037). The generated themes place figures as blocks                                                                                                                                                                                                                                                                                                                                       |
| An edge of a table's cell where the page breaks the table                                                                                      | Pagination (STY-037): the page frames each part of a broken table in its outer rule and repeats its header; the editor has no page                                                                                                                                                                                                                                                                                                   |
| A caption's and a footnote's fill, padding and indents; a first-line indent on centred or preformatted text, in a list's item, or on a heading | The PDF does not set them (issue #330; a heading's, which the template sets as a heading's text and not a paragraph, found when where a heading starts was first compared), so no output but the editor renders them; the themes measured state none of them until the PDF sets them or refuses them by name                                                                                                                         |
| Which bullet or numbering a list's marker draws                                                                                                | The template's (issue #158), not a style property. Where the marker ends - a number right-aligned in the list's column - and its face, weight, posture, size and colour, which the list's place's style sets, are compared, as is where each item's text starts                                                                                                                                                                      |

**Measured.** Over the five themes, the largest difference each property showed since issues #331 and
#333 were fixed: a step between baselines 0.04pt - headings, the lines an image, a scaled mark and a
list's marker hold open among them; where text starts 0.07pt, headings among it; a size nought; an
image's size and start 0.02pt; a list's marker's end 0.01pt; a rule's position 0.02pt and its width
nought - on Windows. Sixteen further seeds (11 to 88 and 101 to 808) all agreed within half a point, a
step at most 0.05pt and a start 0.09pt. W13.4's own record, before the fixes, was a step 0.04pt and a start 0.29pt, the
latter an italic script's own offset, now outside the comparison (above). On a browser that cannot
trim a line to its cap height, a step can be up to three quarters of a point out, from the rounding
above, and nothing holds a line open as the page does; the desktop shell's Electron and the suite's
pinned Chromium both trim.

**What W13.4 claims, and what claims it now.** W13.4 claimed nothing: STY-080 waited for issues #331
and #333. With both fixed, the test in `styles.test.ts` cites STY-080, which it answers whole. **STY-081
is not claimed**: Word is measured against the PDF by the same kit since W15.2, where Word is, and
does not agree yet (above, [Requirements owned](#requirements-owned)); word-output.md says PUB-023
waits for it.

## Where a caption sits

Built by W14.5 of [W14](../plans/2026-09-28-w14-publishing-finished.md), under its decision W-I, for
STY-079 and STR-025. **Where a caption sits is a property of the style, never of the content**
(STR-025): a table and a figure hold the identifier of their style, as they always did, and nothing
that says a side, which the content model refuses as it refuses any member it does not have.

**`catalogue/3`** is one new version of every kind, as `catalogue/2` was. It gives a table style and
an image style placing a figure - as a block or floated - `caption: 'above' | 'below'`, required as
every other property of theirs is (STY-079); a style for an image in a line of text states none, and
one that does is refused. Nothing else moves. `catalogue/2` is frozen beside it as
`catalogueSchema2`, which every row 0025 and 0034 wrote is still held to, and the reader upgrades a
version 2 catalogue in memory (`upgradeCatalogue2`): **a table's caption above it and a figure's below
it, where every output set them before a style could say**. A version 1 catalogue is upgraded to 2 and
held to version 2's parse on the way, so a property a version never had is refused rather than
upgraded past. The store writes a catalogue as the reader reads it, at 3, and a 0.4 row saved again,
at 2, is the same catalogue and records nothing.

**The default theme's 0.5**, seeded by migration 0043, binds new versions of the table and image
catalogues at `catalogue/3`, each 0.4's with every style stating the side it always had - `table` and
`Banded` above, `figure` and `Half width` below - and is otherwise 0.4. It reads style for style as
0.4 does, so nothing published moves, and a request made under 0.4 still publishes under it. Its guard is 0034's: an environment that
recorded its own table or image catalogue, or its own theme, after 0.4 keeps it, and its catalogue/2
styles read with their captions where they always stood.

**Every output reads the side from the style it already reads.**

- **The PDF.** `publishing/15` carries each table style's `captionPosition` in the theme's
  projection, and a figure's own from its image style, in the engine's terms, `top` or `bottom`.
  Template 15 is template 14 with the caption's `figure.caption(position: ..)` set from it: a table's
  caption below its cells is spaced from them as a block below a block is (`apart`), its note after
  both, and a figure's above its image is its space after from the image, which has no leading. The
  tagging is template 14's either way, measured: the `Caption` stays the `Table`'s first child, which
  keeps it the table's programmatic caption (TAB-039), and a figure stays a `Div` of its `Caption` and
  its `Figure`. veraPDF passes both. Under the default theme, template 15 sets a document exactly as
  template 14 did.
- **Word.** The writer writes the caption paragraph before the table or the figure's image, or after
  it, as the style says, its `SEQ` field unchanged. A caption above is kept with what it captions; a
  table whose caption is below begins with its cells, and the paragraph before it carries the space
  the PDF puts above them, as a caption above does. Such a table is never written straight after
  another table, which Word would read as one: a paragraph a tenth of a point high parts them,
  carrying the PDF's gap. Above, below and its page are read from a bookmark at the head of its first
  cell, where the PDF places the table, rather than from its caption after the cells. A floated
  figure's box holds the caption and the image in the order they stand
  ([word-output.md](word-output.md)).
- **The editor.** The markup stands a table's caption before its cells and a figure's after its image,
  so a style placing a caption there needs nothing; one placing it on the other side stacks the
  block's parts and orders the caption there, a table's note staying last (`projectCss`). The caption is
  typed in place wherever it is shown. **CSS `order` moves the caption only as it is drawn**: the
  document keeps its order, so where a style draws a caption on the other side, the arrow keys still
  move through it in document order - out of a table's caption drawn below it, the down arrow goes into
  its first cell, above. No style in T1 draws one there, so no author meets it yet.

**What this does not do.** Nothing in T1 edits a theme, and the default's styles keep the sides they
always had, so an author sees a caption moved only under a theme whose style moves it - written through
`addCatalogueVersion`, which no route reaches. A caption below a table is not kept on the page with the
table's last row, in the PDF or in Word: the engine lets a breakable figure's caption fall to the next
page, and Word's rule would keep the row with the caption only if every paragraph in the row asked it
to. A floated figure's caption above its image in Word has the leading Word sets above a line's text at
the head of its box, where the PDF's band has none; neither was measured in Word itself.

## Safety

STY-N03 is kept everywhere. Nothing a tenant supplies reaches a renderer as syntax: the CSS projection
writes generated rules from typed values and quotes font family names; the Typst projection writes
JSON for a template that evaluates nothing (ADR-0013); the Word projection writes escaped XML values.
The only strings in a theme that reach any output are style names, typeface names and admonition
labels, and each is emitted as a value, never interpolated into code.

## Open questions

| ID          | Question                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **STY-Q01** | Tenant-wide or per-space catalogues. Nothing here depends on the answer: a theme references catalogue versions, wherever they live                     |
| **STY-Q02** | Whether the fixed property set survives a real house style. The answer, when it comes, is a wider set, each addition with its projections and fixtures |
