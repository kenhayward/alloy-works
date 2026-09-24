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

| ID          | How it is met                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STY-001** | A style is a record in a catalogue: an identifier, a name, what it applies to, and values from the property set                                                                                                                                                                                                      |
| **STY-002** | A catalogue is an artifact (`artifact_kind = catalogue`), versioned by the storage design, referenced by themes rather than owned by one                                                                                                                                                                             |
| **STY-003** | Catalogue kinds are fixed: paragraph, character, table, image, admonition, citation                                                                                                                                                                                                                                  |
| **STY-004** | Content carries a style identifier and nothing else about appearance; the schema has no field that could hold a property                                                                                                                                                                                             |
| **STY-005** | Identifiers are allocated by the catalogue, never reused, and are what every projection keys on - the CSS class, the Typst lookup, the Word style id                                                                                                                                                                 |
| **STY-006** | Every style declares the node types it applies to; the resolver refuses a style applied outside them, naming both                                                                                                                                                                                                    |
| **STY-056** | `basedOn` inheritance, resolved by the resolver alone; the chain is walked with a visited set and a cycle is a named error                                                                                                                                                                                           |
| **STY-008** | The paragraph property set below                                                                                                                                                                                                                                                                                     |
| **STY-009** | A character catalogue maps each mark in CNT-031 to a rendering                                                                                                                                                                                                                                                       |
| **STY-010** | That map belongs to the theme, so `strong` resolves to bold in one theme and small capitals in another                                                                                                                                                                                                               |
| **STY-011** | Alignment exists only as a paragraph style property; there is no field for it on a block                                                                                                                                                                                                                             |
| **STY-012** | The table property set below                                                                                                                                                                                                                                                                                         |
| **STY-013** | Table break behaviour is part of the table style: header repetition, continuation label, rows kept whole                                                                                                                                                                                                             |
| **STY-014** | Default field formats by column type are table style properties, overridable by a table (**TAB**)                                                                                                                                                                                                                    |
| **STY-015** | An image style fixes one dimension, as points or as a fraction of the measure                                                                                                                                                                                                                                        |
| **STY-016** | The other dimension is derived from the asset's intrinsic proportions at resolution, never declared                                                                                                                                                                                                                  |
| **STY-017** | An image style declares a maximum for the free dimension; exceeding it re-derives from that dimension instead                                                                                                                                                                                                        |
| **STY-018** | Placement - inline, block, floated - and alignment are image style properties                                                                                                                                                                                                                                        |
| **STY-019** | Resolution fails, naming the asset, where the asset has no recorded intrinsic dimensions                                                                                                                                                                                                                             |
| **STY-024** | A theme binds one catalogue of each kind, a set of typefaces, and a paper colour, and is itself an artifact                                                                                                                                                                                                          |
| **STY-025** | The theme a document uses is the one its template binds; the resolver is given it, never chooses                                                                                                                                                                                                                     |
| **STY-026** | Changing a document's theme is a template-level act, audited through the lifecycle log                                                                                                                                                                                                                               |
| **STY-027** | A style identifier the theme does not contain is a resolution error, and resolution errors fail the publish                                                                                                                                                                                                          |
| **STY-028** | A baseline pins the theme version; the storage design makes the pin a foreign key                                                                                                                                                                                                                                    |
| **STY-029** | Adding a style is a catalogue edit - data, validated against the schema - and involves no code                                                                                                                                                                                                                       |
| **STY-030** | A new style is honoured everywhere because projections are generic over the property set, not written per style                                                                                                                                                                                                      |
| **STY-031** | A style is referenced by identifier, so its uses are a query, and deletion is refused while any exist                                                                                                                                                                                                                |
| **STY-032** | Catalogue edits are versions, so what changed is a comparison between two versions                                                                                                                                                                                                                                   |
| **STY-033** | A theme may carry an allowed list of style identifiers per kind; the editor offers only those, and the resolver refuses the rest                                                                                                                                                                                     |
| **STY-034** | The impact of a style change is the set of documents whose pinned or floating theme version would resolve differently, listed before the change is saved                                                                                                                                                             |
| **STY-035** | One resolver, in `packages/domain`, used by the editor and the publisher alike; the projections never resolve anything                                                                                                                                                                                               |
| **STY-058** | The CSS projection is generic over the property set (STY-030), so it renders every declared paragraph and character property at the theme's values rather than a chosen few; the pagination-bound properties are the only omission, marked as such in the set and shown by preview instead of approximated (STY-037) |
| **STY-037** | Properties that depend on pagination are marked as such in the property set; the CSS projection omits them and preview shows them                                                                                                                                                                                    |
| **STY-038** | The resolver is a pure function of theme version, catalogue versions and asset dimensions                                                                                                                                                                                                                            |
| **STY-039** | A typeface is served to the editor from the tenant's store, and handed to Typst as a pinned font directory                                                                                                                                                                                                           |
| **STY-040** | A typeface that cannot be loaded fails resolution; Typst's missing-face warning is also treated as a failure (ADR-0013)                                                                                                                                                                                              |
| **STY-041** | The typeface artifact records the licence and whether it permits embedding, separately for PDF and for Word                                                                                                                                                                                                          |
| **STY-042** | The PDF projection refuses a face whose licence forbids embedding                                                                                                                                                                                                                                                    |
| **STY-043** | A catalogue serialises as its schema's JSON, which is the export format                                                                                                                                                                                                                                              |
| **STY-044** | Import validates against the schema and reports every rejected property by name                                                                                                                                                                                                                                      |
| **STY-045** | The product's own typefaces are shipped as typeface artifacts carrying their open licence                                                                                                                                                                                                                            |
| **STY-046** | A tenant's uploaded face is a typeface artifact in that tenant's schema, so it cannot be served to anyone else                                                                                                                                                                                                       |
| **STY-047** | A typeface artifact is the font files themselves, versioned; the baseline pins the files                                                                                                                                                                                                                             |
| **STY-048** | The default theme is tested against the scripts LOC-004 admits and a mathematics face, by the coverage check below                                                                                                                                                                                                   |
| **STY-069** | The domain's theme reader refuses a text colour below 4.5:1, or 3:1 for large text, against any background it can stand on, and the store refuses what the reader refuses, so a theme is checked when it is saved ([Themes in the PDF](#themes-in-the-pdf), TH-G)                                                    |
| **STY-049** | Glyph coverage is checked at resolution, against the pinned files' character maps, before any renderer runs                                                                                                                                                                                                          |
| **STY-050** | Vertical space between two blocks is the first block's space after plus the second block's space before, in every output                                                                                                                                                                                             |
| **STY-051** | Line spacing is a minimum baseline-to-baseline distance in points, and means that distance in every output                                                                                                                                                                                                           |
| **STY-052** | A typeface whose licence forbids embedding in Word declares a permitted face for Word output, and the publish report names the substitution                                                                                                                                                                          |
| **STY-053** | The conformance suite below                                                                                                                                                                                                                                                                                          |
| **STY-054** | A typeface artifact carries its ascent and descent; the CSS projection and the Typst template both use them to put a line's extra space above it                                                                                                                                                                     |
| **STY-055** | `wordRun` computes Word's reading of each run and pins the canonical value directly wherever the two differ                                                                                                                                                                                                          |
| **CNT-082** | The CSS projection renders block spacing by the same rule as the output (STY-050)                                                                                                                                                                                                                                    |
| **CNT-094** | A block's appearance is its paragraph style; the editor has no free spacing or alignment control                                                                                                                                                                                                                     |
| **CNT-097** | The editor loads the theme's typefaces and sets text at the theme's sizes                                                                                                                                                                                                                                            |
| **CNT-115** | The editor sets text at the layout's measure, scaled, with zoom                                                                                                                                                                                                                                                      |
| **PUB-019** | Embedding in PDF and in Word is decided per face from its licence (STY-041, STY-042, STY-052)                                                                                                                                                                                                                        |
| **PUB-027** | The Word projection emits every style as a real Word style, named and identified from the catalogue                                                                                                                                                                                                                  |
| **PUB-017** | A table breaks across pages as its table style says - header repeated, rows kept whole, a continuation label - which the template sets from the style ([Themes in the PDF](#themes-in-the-pdf), TH-I)                                                                                                                |
| **TAB-032** | The same, from the table's side                                                                                                                                                                                                                                                                                      |
| **PUB-092** | Widow and orphan control, keep-with-next and keep-together are paragraph style properties, each passed to Typst as its own rule - the two costs, `sticky`, `breakable: false` - as measured, and to Word as `w:widowControl`, `w:keepNext` and `w:keepLines`; the publishing regression corpus gains a case for each |

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
(STY-013). The editor renders all of it except break behaviour, which is pagination.

The continuation label matters beyond appearance: the spike found that no engine can express one
without per-document work. In this design it is a table style property the Typst template renders -
`"Table 3 (continued)"` built from data - so the work is done once, in the template. Its words are
the layout's, as the contents' title is, because a theme has no language; the style says whether the
label appears and how it is set ([TH-I](#decisions-for-ken)).

### Image styles

The fixed dimension and its value, as points or as a fraction of the measure; a maximum for the other
dimension; placement and alignment (STY-015 to STY-018), floated meaning a band at the page's head or
foot, the only float the engine has ([TH-J](#decisions-for-ken)). Resolution derives the free dimension from the
asset's intrinsic proportions, re-derives from the maximum where it would be exceeded, and fails
naming the asset where no dimensions are recorded (STY-019). Because the editor's column is the
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
is that space before is suppressed at the top of a page. What the Word projection must set to match
is to be confirmed by opening the output in Word, as PUB-029 requires for every material change to
the Word emitter - it is the one row in this design not yet verified.

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

**Typefaces come from the tenant's store**, as `@font-face` rules pointing at the typeface artifact's
files, in both deliveries. The desktop shell has no special path; the renderer fetches from the
service as the browser does. The product's own open faces are typeface artifacts like any other.

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

**The conformance suite is how agreement is kept** (STY-053). For each property in the set, a fixture
document exercises it at several values, and each projection's output is measured rather than read:

| Target | How a value is measured                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Typst  | From the PDF: each character's text matrix gives its baseline, not its bounding box                                    |
| Word   | LibreOffice renders the `.docx` to PDF and is measured the same way - a proxy; confirmed in Word itself under PUB-029  |
| Editor | Chromium: a zero-size marker at each line's start gives the baseline, and computed styles give size, weight and colour |

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
The conformance suite this becomes (STY-053) needs generated values, more faces - in particular faces
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

**What themes 1 and 2 claim and cite.** STY-001, STY-002, STY-003, STY-005, STY-006, STY-008,
STY-009, STY-010, STY-024, STY-041, STY-042 and STY-069 by themes 1, with PUB-019 while the PDF is the
only output; STY-012 (as split), STY-013, STY-015, STY-017, STY-018, STY-019, PUB-017 and TAB-032 by
themes 2. **Not cited by either**: STY-025, which needs a template to bind a theme (TPL), the
environment's default standing in as it does for the layout; STY-039, whose browser and desktop half is
the editor's; STY-048, as TH-H leaves it; PUB-092, which names each engine and so waits for Word; and
STY-058 and STY-070, the editor's. **STY-009 is cited today by a prototype test over a character catalogue
of two marks of the nine**; themes 1's character catalogue covers all nine and its test replaces that citation.

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
| New         | What the Word projection sets to suppress space before at the top of a page. To be confirmed in Word                                                   |
