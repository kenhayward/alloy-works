// The publication template, version 12 (docs/design/publishing.md). It reads the published
// document set from its theme, `publishing/12`, from data.json as values and evaluates nothing: no
// content reaches Typst as source (ADR-0013, PUB-062). A version is immutable - an edit is a new
// directory, and a test holds each version's hash. It is version 11 with the face, size, weight,
// posture and colour of all its text, a paragraph's fill, padding, alignment and indents, its line
// spacing and the space between blocks, and the size of a subscript or a superscript, read from the
// document's `theme` (themes 1, ruling R7) and written as no literal here - `template.test.ts` reads
// this file and fails on a typographic literal outside the short list it allows - set by the rules
// ADR-0014 measured: a line one em tall from its face's descender, its leading the rest of its line
// spacing, and between two blocks the first's space after, the second's space before and its leading,
// as weak space. Template 11 and the publications made with it are a record, never migrated.
//
// NOT EVERY VALUE IS THE THEME'S. What this template never sets is still the engine's default, and no
// theme can move it; no literal names it, so the test cannot see it (the final review of themes 1,
// M3). The underline's offset and thickness; a list's and an enumeration's indent and body indent; a
// definition list's hanging indent and its separator; a table cell's inset (5pt) and a table's rules;
// and the contents' leader of dots and an entry's indent at each depth. They stay the template's
// until themes 2's table and list properties give a theme a say in them. Beside them, how far a
// subscript or a superscript is lowered or raised (the face's own OS/2 tables), and a footnote's
// separator, clearance and indent at the foot of its page, which no property of themes 1 or 2 names.
#let doc = json("data.json")
#assert(doc.schema == "publishing/12", message: "data.json is not publishing/12")

// The theme, as `assemble` projected it (`projectTypst`): each paragraph style by identifier with
// every property concrete, the nine marks' renderings, and which style each place and role is set in.
// A stored `body` has already become its place's default, so a paragraph names its style outright.
#let theme = doc.theme
#let style(id) = theme.styles.at(id)
// Named apart from the engine's own `place`, which the equation's number is placed by.
#let place-style(name) = style(theme.places.at(name))
#let role(name) = style(theme.roles.at(name))
// A heading deeper than six is set as the sixth (themes 1, ruling R1).
#let heading-role(level) = role("heading" + str(calc.min(level, 6)))

// The only places a number or a colour from the data becomes one of the engine's: every length in this
// template is a number of points or ems the data gave, multiplied by its unit here, and every colour a
// string the theme holds. `template.test.ts` allows these lines and no other like them.
#let pt(n) = n * 1pt
#let em(n) = n * 1em
#let colour(hex) = rgb(hex)
// Widow and orphan control is a boolean in the theme, and the engine's two costs at 100% or at 0% -
// measured (themes.md, "What the pinned Typst does with a theme's properties"): at 100% neither a first
// line alone at a page's foot nor a last line alone at its head is ever set, Word's two-line rule.
#let share(on) = if on { 100% } else { 0% }
#let alignment(a) = if a == "start" { start } else if a == "center" { center } else { end }

#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }
// The layout's own words, set in the layout's language, which need not be the document's.
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)

// A style's text and lines (ADR-0014, STY-051, STY-054). Each line is exactly one em tall, its top one
// em less the face's descender above the baseline and its foot the descender below it, which is where
// Word puts a baseline; so the leading between two lines is the style's line spacing less one em, and
// a line holding something taller - an inline equation, an image - grows, as Word's `atLeast` lets it.
// Hyphenation in the passage's own language, which the text already carries, and the widow and orphan
// costs from the style's one boolean.
#let lettering(s, body) = text(
  font: s.font,
  size: pt(s.size),
  weight: s.weight,
  style: s.style,
  fill: colour(s.fill),
  hyphenate: s.hyphenate,
  top-edge: em(1 - s.descent),
  bottom-edge: em(-s.descent),
  costs: (widow: share(s.widowControl), orphan: share(s.widowControl)),
  body,
)
// And its paragraphs' leading, justification and first-line indent. A paragraph's own settings changed
// part of the way through it end it there - measured: a footnote's number was left on a line of its
// own above its words - so a style's text inside a paragraph begun in another is `lettering` alone.
#let setting(s, body) = {
  set par(
    leading: pt(s.leading),
    justify: s.justify,
    first-line-indent: (amount: pt(s.firstLineIndent), all: true),
  )
  lettering(s, body)
}

// A block set in a style: its text and lines, its alignment, its fill with the padding inside it, its
// start and end indents, and whether it keeps with what follows (`sticky`) and keeps together
// (`breakable: false` where it fits), both measured (TH-D). `within` is how far the place it stands in already
// stands in at its start and its end - a quotation's indents, for what a quotation holds - so an indent
// is never given twice: a paragraph stands where its style says, and never nearer the edge than the
// place it stands in. The indents follow the text's direction: a start is the right in Hebrew. Its
// spaces before and after are not its own to place: `gap` puts them between blocks.
#let styled(s, body, within: (0, 0)) = {
  let start = calc.max(0, s.startIndent - within.at(0))
  let end = calc.max(0, s.endIndent - within.at(1))
  // Each wrapper only where the style asks for it, and the alignment a rule rather than an element:
  // a list nests as deep as its blocks' realisations let it, and each element here is one more of
  // them at every level (`lists.test.ts`).
  let body = {
    set align(alignment(s.align))
    setting(s, body)
  }
  let body = if s.background == none {
    body
  } else {
    block(width: 100%, fill: colour(s.background), inset: pt(s.padding), body)
  }
  let body = if start == 0 and end == 0 {
    body
  } else {
    context if text.dir == rtl {
      pad(left: pt(end), right: pt(start), body)
    } else {
      pad(left: pt(start), right: pt(end), body)
    }
  }
  // Keep-together is Word's `keepLines`: a paragraph kept whole where it fits a page, and broken where
  // it does not. The engine does not break an unbreakable block that cannot fit on an empty page: it
  // moves it to the next and lets it run off the page's foot, with nothing said - the final review of
  // themes 1 (I1) measured a paragraph of eighty long sentences painting forty lines below its page.
  // So the block is unbreakable only where its height, measured at the width it is set in, is no more
  // than the page's text block: `layout` gives both, its height the whole region's, not what is left
  // of it. Only a style that keeps together pays for the measuring and for the one more realisation
  // `layout` is, so a list of the default's paragraphs nests as deep as it did (`lists.test.ts`). The
  // measured block stands inside the sticky one, which is what the block after it sticks to: measured,
  // a kept heading at a page's foot still goes over with the kept paragraph after it.
  let body = if s.keepTogether {
    layout(size => block(
      width: 100%,
      breakable: measure(body, width: size.width).height > size.height,
      body,
    ))
  } else {
    body
  }
  block(width: 100%, sticky: s.keepWithNext, body)
}

// The space between two blocks (STY-050, ADR-0014): the first's space after, the second's space before,
// and the second's leading, since a line is one em tall and the rest of its line spacing is the gap
// above it. Weak, so it disappears at the top of a page, where space before is suppressed. With the
// descender in the edges, no term depends on the block before but its space after.
#let gap(above, below) = v(pt(above.spaceAfter + below.spaceBefore + below.leading), weak: true)

#set document(title: doc.title, author: (), keywords: ())
// The engine's fallback is OFF for every face (template 11's rule): `assemble` asked the face that
// sets each character, and a fallback would set one it refused from a face it never asked.
#set text(fallback: false, ..language(doc.language), dir: direction(doc.direction))
// No space between blocks but what `gap` puts there: the engine's own spacing takes the larger of two
// adjoining spaces, where the theme's add (STY-050).
#set par(spacing: 0pt)
#set block(spacing: 0pt)
// Everything is set in the `text` place's style unless something says otherwise.
#show: setting.with(place-style("text"))
// Raw text - inline code and preformatted text alike - at exactly the size and in exactly the face of
// what surrounds it: the engine's own raw is 0.8 of its surroundings and in a face that is not pinned,
// and a theme says both - inline code's by its mark's face and scale, preformatted text's by its role's
// style. Measured: a size set on raw is multiplied by the engine's 0.8, so the size is read here, where
// the raw is made, and set absolute. `columnsAt` in `assemble` counts columns in the same size.
#let code(t, block: false) = context {
  let around = (size: text.size, font: text.font)
  show raw: set text(..around)
  raw(t, block: block)
}
// Every equation in the theme's maths face (equations 2, EQ-A), with the engine's fallback off, as for
// every face: `assemble` refuses a character the maths face lacks first, as `math_glyph_missing`.
#show math.equation: set text(font: theme.maths)
// The bullet an unordered list takes at each level: disc, then circle, then square, the convention
// every word processor and browser uses, and every one of the three sets in the pinned faces.
// Typst's own defaults are disc, then U+2023 TRIANGULAR BULLET, then an en dash - and U+2023 IS NOT
// IN LIBERATION SERIF, so a two-level unordered list was a REFUSED COMPILE with no fallback and no
// warning of any kind. If a document is ever refused with `TypstRefused` and nothing else, look
// here first. Written as escapes, never as the characters themselves, so a source file carries no
// glyph a diff or a terminal can hide.
// Three markers are not a ceiling on the nesting: Typst CYCLES this array, so a fourth level takes
// the disc again and a seventh the same, and there is no cliff waiting below the third. Confirmed
// at six levels.
// That a marker lives in a template at all, rather than in a named style, is issue #158: CNT-094
// says a block takes its appearance from a style, and a marker is appearance. The home is wrong on
// purpose, and deliberately not fixed here - moving it is the themes subsystem's work, not a
// template's, and the template is where it can be correct today.
#set list(marker: ([\u{2022}], [\u{25E6}], [\u{25AA}]))
// A table is a figure, and a figure is unbreakable by default: a table longer than a page moved whole
// to the next and overflowed it with nothing said. Breakable, it continues on the next page and is
// still one `Table` in the tree (TAB-041). Its caption stands above it, as a table's conventionally
// does; the position changes nothing about the tagging - the `Caption` is the `Table`'s first child
// either way, which is what makes it the table's programmatic caption (TAB-039). All measured
// (publishing.md, "What the pinned Typst does with a table").
#show figure.where(kind: table): set block(breakable: true)
#show figure.where(kind: table): set figure.caption(position: top)
// A caption, a table's or a figure's, is set in the `caption` role's style and aligned by it. Its entry
// in the lists after the contents is the caption's body alone, set in the `listEntry` role's (`listed`).
#show figure.caption: it => {
  let s = role("caption")
  setting(s, align(alignment(s.align), it))
}
// A block quotation stands in by exactly the `quotation` place's style's start and end indents, and
// nothing else (the contract in `publishing/measure.ts`, by which `assemble` measured what it holds):
// the engine's own inset of a quotation, an em each side, and its own space around one, are stopped
// here. Still a `BlockQuote` to a reader: measured, the element carries its role whatever shows it.
// So the space around a quotation is its paragraphs' own, spaced as any two blocks are: template 11's
// set-off - 16.5pt more before and after a quotation, and 9.9pt more after its attribution - is gone,
// since a theme styles paragraphs and has nothing that styles a block's edges alone. Restoring it
// needs a spacing property for those edges, as Word's contextual spacing is: a later widening of the
// property set, not something this template can decide.
#show quote.where(block: true): it => {
  let q = place-style("quotation")
  block(width: 100%, above: 0pt, below: 0pt, context if text.dir == rtl {
    pad(left: pt(q.endIndent), right: pt(q.startIndent), it.body)
  } else {
    pad(left: pt(q.startIndent), right: pt(q.endIndent), it.body)
  })
}
// A footnote's note, at the foot of its page, is set in the `footnote` place's style (themes 1, ruling
// R7), rather than at the engine's own size, 0.85 of the text's; two notes stand apart as two blocks
// of that style do.
#show footnote.entry: it => setting(place-style("footnote"), it)
#set footnote.entry(gap: {
  let s = place-style("footnote")
  pt(s.spaceAfter + s.spaceBefore + s.leading)
})
// A numbered block equation is a figure of its own kind (equations 2, EQ-E), whose caption is
// `number`'s label and nothing else: the figure is what the list of equations lists and what a
// reference's label stands on, and the engine's equation numbering is never used - it sets the number
// INSIDE the `Formula`, where a reader never hears it. The caption's BODY is placed at the right,
// centred on the equation, so the number is tagged a `Span` straight after the `Formula` and read after
// it; placing the whole caption put a `Caption` before the formula, and the formula in a `Div` of its own
// on one page and not on the next. Measured by the equations spike (section 8).
//
// Room for the number, as LaTeX keeps it: the equation is centred in the line less the number's width
// and a gap on EACH side, so it stays centred on the page, and the number is placed in the room on the
// right. An equation wider than that room leaves would run under its number wherever it was centred -
// the room on both sides costs exactly what the number needs on one, so every equation that would
// have met its number overflows the room too - and so, as amsmath does, the number is set on a line of
// its own below it, at the right. Measured against the pinned engine: `measure` gives a block
// equation's own width, and both forms tag the number a `Span` after the `Formula`. A length in `em`
// cannot be compared with one in points, so each is made absolute where it is measured. An equation wider
// than the whole line still runs past its edges, numbered or not; nothing measures that yet.
#show figure.where(kind: "equation"): it => layout(size => {
  let number = it.caption.body
  let room = measure(number).width + 1em.to-absolute()
  if measure(it.body).width + 2 * room <= size.width {
    block(width: 100%, inset: (left: room, right: room), {
      it.body
      place(right + horizon, dx: room, number)
    })
  } else {
    // Placed, as beside the equation, and never set as a paragraph of its own: an aligned paragraph is
    // tagged a `P`, where a placed number is the `Span` after the `Formula` (measured). The space below
    // the equation is the line the number takes, with the leading of the style it stands in between.
    block(width: 100%, {
      it.body
      v(measure(number).height + par.leading.to-absolute())
      place(right + bottom, number)
    })
  }
})
#let f = doc.format
// Every page carries the status in its header, placed by the template outside anything a layout
// fills, so no layout can remove it (decision H). Typst marks a header as a pagination artifact,
// which assistive technology does not read, so the notice is also set once as tagged text below.
// Its words are the layout's, in the layout's language, in the `notice` role's style.
#let notice = styled(role("notice"), words(doc.words.notice))

// Running heads and feet (PUB-008): three slots each, of the layout's words and these fields.
// The level-one node a page is in: the first to begin on it, else the last begun before it. Asking
// only for the last begun before the header would name the previous chapter on the page a chapter
// begins, since the header is laid out above it. The cover's title and the contents' are not outlined,
// so neither is ever a section.
#let section = context {
  let all = query(heading.where(level: 1, outlined: true))
  let here-page = here().page()
  let on = all.filter(h => h.location().page() == here-page)
  let before = all.filter(h => h.location().page() < here-page)
  if on.len() > 0 { on.first().body } else if before.len() > 0 { before.last().body }
}
// `page` is the page's label in its matter's numbering; `pages` is the PDF's physical page count, in
// decimal, which is why the default foot prints no "of" (decision I).
#let field(name) = if name == "title" {
  doc.title
} else if name == "revision" {
  doc.revision
} else if name == "page" {
  context counter(page).display()
} else if name == "pages" {
  context str(locate(<aw-end>).page())
} else if name == "section" {
  section
}
#let slot(parts) = for p in parts { if p.kind == "words" { words(p.text) } else { field(p.field) } }
// The slots in the `running` role's style: where each stands - at the start, the centre, the end - is
// the slot's, not the style's.
#let three(slots) = setting(role("running"), grid(
  columns: (1fr, 1fr, 1fr),
  align(start, slot(slots.at(0))),
  align(center, slot(slots.at(1))),
  align(end, slot(slots.at(2))),
))
// The notice is the template's, above the slots, on every page: no layout can remove it. The cover
// carries it alone.
#let header(cover) = {
  notice
  if not cover {
    gap(role("notice"), role("running"))
    three(f.head)
  }
}

// The page the layout declares (PUB-007), in points and in the portrait sense, turned where it is
// landscape, on the theme's paper. The gutter widens the inside margin, which alternates with the
// outside from page to page about the binding edge. No page is numbered until its matter says how
// (PUB-009), and until then the notice is all the template prints in the page's margins: the cover's.
#set page(
  width: pt(f.width),
  height: pt(f.height),
  flipped: f.orientation == "landscape",
  fill: colour(theme.paper),
  margin: (
    top: pt(f.margins.top),
    bottom: pt(f.margins.bottom),
    inside: pt(f.margins.inside + f.gutter),
    outside: pt(f.margins.outside),
  ),
  numbering: none,
  header: header(true),
  footer: none,
)
// Section numbers are the publisher's (`number`), set as text; Typst numbers only the pages. A node's
// heading is set in the role for its depth - its own words, never the engine's heading, whose size,
// weight and space are not the theme's - and is still a heading to a reader, the level its depth says:
// measured, the element carries its role whatever shows it. Only a node's heading is outlined; the
// cover's title and the contents' and the lists' are set by rules of their own.
#set heading(numbering: none)
#show heading.where(outlined: true): it => styled(heading-role(it.level), it.body)

// A mark's appearance, from its character style (STY-009): only what the style states, over whatever
// the text it stands in is set in, and never the engine's `strong` or `emph`, whose defaults are not
// the theme's (`strong` is bolder by a delta, `emph` a toggle). Its position innermost, then its
// underline - inside its colour, so the rule is drawn in it - and its face, size, weight, posture and
// colour around them. A scale is of the text the mark stands in, whatever that is. A subscript or a
// superscript is set at the theme's `script`, a fraction of its text, rather than at the engine's own
// size, so that contrast judges a script at the size it is set at (the final review of themes 1, I3):
// the same fraction today, the engine's for both pinned text faces. Where the face has a glyph of its
// own for every character of a script, the engine sets that at the text's size, as it always has
// (`typographic`, left at its default); how far a script is lowered or raised is still the engine's,
// from the face's own tables.
#let look(kind, body) = {
  let m = theme.marks.at(kind)
  let body = body
  if "position" in m {
    let size = em(theme.script)
    body = if m.position == "subscript" { sub(size: size, body) } else { super(size: size, body) }
  }
  if "underline" in m and m.underline { body = underline(body) }
  if "font" in m { body = text(font: m.font, body) }
  if "scale" in m { body = text(size: em(m.scale), body) }
  if "weight" in m { body = text(weight: m.weight, body) }
  if "style" in m { body = text(style: m.style, body) }
  if "fill" in m { body = text(fill: colour(m.fill), body) }
  body
}
// The marks that are appearance and nothing else, which the theme's styles render alone.
#let appearance = ("emphasis", "strong", "underline", "subscript", "superscript", "inlineCode")

// A run and the marks over it. `assemble` writes them in one fixed order, outermost first
// (PUBLISHED_MARK_ORDER), so the fold runs the array backwards and each mark wraps what the marks
// inside it have already made: one document sets one way, whatever order the author applied them in.
// `inlineCode` is settled BEFORE the fold rather than inside it. Typst's `raw` takes text, not a
// body, so a branch that called it in the fold would REPLACE everything applied so far - a run marked
// as code and emphasised would lose the emphasis with nothing said, and the page would say something
// the author did not write. Computed first, it is the innermost thing here and can lose nothing.
// Every mark takes its appearance from its character style; a link, a quoted phrase and a language
// also carry their meaning, which is the template's. A quoted phrase is set with `quotes: false`: the
// author's own quotation marks are in the text, and the editor shows them once, so the role is what
// the mark carries into the PDF and not a second pair of characters. An unknown kind stops the
// compile: a publish failure the author is told about is worth more than a run that is quietly set as
// plain text.
#let text-run(r) = {
  let kinds = r.marks.map(m => m.kind)
  let body = if "inlineCode" in kinds { code(r.text) } else { r.text }
  for m in r.marks.rev() {
    if m.kind in appearance {
      body = look(m.kind, body)
    } else if m.kind == "quotedPhrase" {
      body = quote(quotes: false, look(m.kind, body))
    } else if m.kind == "hyperlink" {
      body = link(m.href, look(m.kind, body))
    } else if m.kind == "language" {
      body = text(..language(m.language), look(m.kind, body))
    } else {
      panic("unknown mark kind: " + m.kind)
    }
  }
  body
}
// An image in a run of text (figures 5): in a box, so it stands in the line, at the size `assemble`
// worked out - 1.2 ems of the style it stands in, and never wider than the room it stands in. Its
// alternative text is set with the language it is written in, around the image alone, so its `Figure`
// carries its own `/Lang` inside the paragraph or the cell; a decorative image is an artifact. As a
// figure's, and measured (publishing.md, "What the pinned Typst does with an image").
#let image-run(i) = {
  let size = (width: pt(i.width), height: pt(i.height))
  if i.alternative == none {
    pdf.artifact(box(image(i.path, ..size)))
  } else {
    text(..language(i.alternative.language), box(image(i.path, ..size, alt: i.alternative.text)))
  }
}
// The maths tree (equations 2, EQ-B): `assemble` has converted the stored MathML - through
// `mathsTree` in the domain, never here - into nodes of the kinds below, and this builds each from its
// strings with the engine's maths functions. Nothing is evaluated: every symbol is a string handed to
// `symbol()`, and every other string to a maths function or to `text`, so `#panic("x")` in an
// equation is those ten characters (PUB-062, measured by the spike). An unknown kind or variant stops
// the compile, as an unknown block does: `assemble` builds only these.
//
// Two traps the spike paid for. A string placed in maths as markup is set UPRIGHT, so an identifier is
// always wrapped in `math.italic` or `math.upright` by its variant. And content is joined with `.join()`
// alone: `[#a #b]` puts a space element between them, which maths sets as a space.
//
// No public constructor makes an alignment point (`math.align-point` is not in 0.15.1's maths module),
// so one is taken from the one place the engine makes it. Written here, in the template, not read
// from the data.
#let amp = $&$.body
#let braces = (
  underbrace: math.underbrace,
  overbrace: math.overbrace,
  underbracket: math.underbracket,
  overbracket: math.overbracket,
  underparen: math.underparen,
  overparen: math.overparen,
)
// One grapheme is a symbol; `symbol()` refuses more with `invalid variant value`, so anything longer -
// an operator written as a word - is set as an operator's name.
#let sym(t) = if t.clusters().len() == 1 { symbol(t) } else { math.op(t) }
#let fence(t) = if t == "" { none } else { t }
// A column of a matrix, or of cases, aligned as MathML said (`columns`, one per column). The engine's
// `mat(align:)` takes ONE alignment for the whole matrix, and `cases` none at all, so each cell carries
// an alignment point of its own instead: one before the cell's content aligns the column at its left,
// one after at its right, and none centres it. Measured against the pinned engine: a matrix's cells
// are aligned column by column this way, left, right and centre in one matrix. `cases` ignores the
// points and sets every column at its left, so cases is set as a matrix fenced by a brace on its left
// alone, with the gap between columns `cases` takes (1em, the spike's fix) - measured to set the
// same as `cases` where every column is left, which is what an editor's cases always are.
#let aligned(cells, columns) = cells.enumerate().map(((i, c)) => {
  let a = columns.at(i, default: "center")
  if a == "left" { amp + c } else if a == "right" { c + amp } else { c }
})
// Whether a bare table's columns alternate right and left from the first, as `aligned` and `alignat`
// write them: exactly the alignment a multi-line equation's alignment points give.
#let alternating(columns) = columns.len() > 1 and columns.enumerate().all(((i, a)) => {
  a == if calc.even(i) { "right" } else { "left" }
})
#let maths(n) = {
  let k = n.k
  if k == "row" {
    n.c.map(maths).join()
  } else if k == "i" {
    let t = n.t
    let v = n.v
    if v == "italic" {
      math.italic(t)
    } else if v == "upright" {
      math.upright(t)
    } else if v == "bold" {
      math.bold(math.upright(t))
    } else if v == "bold-italic" {
      math.bold(math.italic(t))
    } else if v == "bb" {
      math.bb(t)
    } else if v == "cal" {
      math.cal(t)
    } else if v == "frak" {
      math.frak(t)
    } else if v == "sans" {
      math.sans(t)
    } else if v == "mono" {
      math.mono(t)
    } else {
      panic("unknown maths variant: " + v)
    }
  } else if k == "n" {
    math.upright(n.t)
  } else if k == "o" {
    if n.at("large", default: false) { math.class("large", sym(n.t)) } else { sym(n.t) }
  } else if k == "mid" {
    math.mid(sym(n.t))
  } else if k == "op" {
    math.op(n.t, limits: n.limits)
  } else if k == "primes" {
    // The engine's own primes, which it kerns and raises as one: two U+2032 symbols in a row set apart.
    math.primes(n.count)
  } else if k == "text" {
    math.upright(text(n.t))
  } else if k == "space" {
    h(em(n.em))
  } else if k == "frac" {
    math.frac(maths(n.n), maths(n.d))
  } else if k == "stack" {
    math.vec(delim: none, maths(n.n), maths(n.d))
  } else if k == "binom" {
    math.binom(maths(n.n), maths(n.d))
  } else if k == "sqrt" {
    math.sqrt(maths(n.body))
  } else if k == "root" {
    math.root(maths(n.index), maths(n.body))
  } else if k == "attach" {
    let base = maths(n.base)
    let base = if n.mode == "scripts" {
      math.scripts(base)
    } else if n.mode == "limits" {
      math.limits(base)
    } else {
      math.limits(base, inline: false)
    }
    let scripts = (:)
    for key in ("t", "b", "tl", "bl", "tr", "br") {
      if key in n { scripts.insert(key, maths(n.at(key))) }
    }
    math.attach(base, ..scripts)
  } else if k == "accent" {
    math.accent(maths(n.body), n.a)
  } else if k == "line" {
    if n.which == "overline" { math.overline(maths(n.body)) } else { math.underline(maths(n.body)) }
  } else if k == "brace" {
    let brace = braces.at(n.which)
    if "label" in n { brace(maths(n.body), maths(n.label)) } else { brace(maths(n.body)) }
  } else if k == "lr" {
    let open = fence(n.open)
    let close = fence(n.close)
    math.lr((
      if open == none { none } else { sym(open) },
      maths(n.body),
      if close == none { none } else { sym(close) },
    ).join())
  } else if k == "mat" {
    let rows = n.rows.map(r => r.map(maths))
    if n.open == "" and n.close == "" and n.display and alternating(n.columns) {
      // Aligned rows, as a multi-line equation: its alignment points alternate right and left, which
      // is exactly what the columns say, and a relation after a point keeps its spacing - a matrix
      // cell would set it as the first thing in the cell, with the column's gap before it.
      rows.map(r => r.join(amp)).join(linebreak())
    } else {
      math.mat(delim: (fence(n.open), fence(n.close)), ..rows.map(r => aligned(r, n.columns)))
    }
  } else if k == "cases" {
    math.mat(
      delim: ("{", none),
      column-gap: 1em,
      ..n.rows.map(r => aligned(r.map(maths), n.columns)),
    )
  } else if k == "phantom" {
    hide(maths(n.body))
  } else if k == "script" or k == "sscript" {
    // A script level smaller and two, as MathML's `scriptlevel` sets them (`\substack`, `smallmatrix`,
    // `subarray`, `\scriptstyle`; the final review of equations 2, I2): an absolute size, so a
    // substack in a limit, already at the script size, stays there. Not cramped, as TeX's
    // `\scriptstyle` is not; MathML would keep whatever the content around it had, so a superscript
    // inside a substack sits a little higher than a browser draws it. Measured with the pinned engine
    // and veraPDF before it was written here.
    let size = if k == "script" { math.script } else { math.sscript }
    size(maths(n.body), cramped: false)
  } else if k == "display" {
    math.display(maths(n.body))
  } else if k == "inline" {
    math.inline(maths(n.body))
  } else {
    panic("unknown maths node: " + k)
  }
}
// An equation: its tree, always with its alternative (EQ-D) - the engine refuses one without under
// PDF/UA-1 - set in the language the alternative is in, around the equation alone, so the `Formula`
// is read in it, as an image's alternative is. `assemble` gives it the language of the text it stands
// in, so this changes nothing where that is already the language around it, and says so where it is
// not. A block equation stands as a paragraph would; an inline one in its line.
#let equation(e, block: false) = text(
  ..language(e.alternative.language),
  math.equation(block: block, alt: e.alternative.text, maths(e.tree)),
)
// A label on an element a reference names (cross-references 2, ruling R8). `anchor` is `assemble`'s,
// `b-<node>-<block>` or `n-<node>`, and it is set only on what some reference in the document points
// at, so the file carries a label for each reference's target and no more; `none` sets the element
// bare. Made with `label(..)`, never the `<..>` literal: a block's identifier is any stored string, and
// may hold a character the literal does not take.
#let labelled(anchor, body) = if anchor == none { body } else [#body #label(anchor)]
// A cross-reference (cross-references 2): `assemble` has resolved it and says what it prints, so
// only a page is the engine's. A page is the target's page number in the numbering of the matter it
// stands in - roman in front matter, as the page's own foot prints it - read where the target is set:
// `counter(page).at` gives the number and the location's own `page-numbering` the pattern. A link
// wherever `assemble` says one may stand - a paragraph's text, a list's item, a quotation, a table's
// body cell, a footnote's text - and text anywhere else: a running head sets a section's title again as
// an artifact, where a link refuses the compile, and a caption is set again in the lists after the
// contents, where it would nest inside the entry's own link. A reference carries no marks. Every
// target's label is in the file (`assemble` fails a reference it cannot resolve, and emits a marker
// for a named target that publishes nothing), so `locate` and `link` never meet a missing one. As
// measured (structure.md, "What the pinned Typst does with a reference"). Above and below are the
// layout's own words (`relative`), set in the layout's language with `words`, as its other words are:
// a French paragraph's "earlier" is read to a reader in the English of the layout that gave it (the
// final review of cross-references 2). A number and a title are the document's, and set bare.
#let reference-run(r) = {
  let target = label(r.anchor)
  let said = if r.page {
    context {
      let at = locate(target)
      // A BACKSTOP that must never fire: nothing a reference can name stands on the cover, the one
      // page with no number. The message names the anchor and nothing the document says.
      assert(at.page-numbering() != none, message: "reference to " + r.anchor + " has no page number")
      numbering(at.page-numbering(), ..counter(page).at(at))
    }
  } else if r.relative {
    words(r.text)
  } else {
    r.text
  }
  if r.link { link(target, said) } else { said }
}
// An equation in a run of text (equations 2): wherever a run is set - a paragraph, a table's cell and
// its header rows, a footnote's text, a caption, a term, an attribution, a table's note and a node's
// title - and so wherever those are set again: the lists after the contents, the contents, a running
// head. Measured by the spike in every one of those places.
#let base-run(r) = if "image" in r {
  image-run(r.image)
} else if "reference" in r {
  reference-run(r.reference)
} else if "equation" in r {
  equation(r.equation)
} else {
  text-run(r)
}
// A footnote (footnotes 2): numbered with the label `number` gave it - the outline's number, never the
// engine's counter - which the engine sets as the mark in the text and before the note at the foot of
// the page, where the engine begins a note on its anchor's page and carries a long one on to the next
// (PUB-016). Its paragraphs are runs of text and images, as a paragraph's are, and hold no footnote.
// They are NOT each wrapped in `par`: the engine sets the number before the note's body, and a body
// that opens with a `par` puts the number in a paragraph of its own above the words - a line with a
// number and nothing else, which at a page's foot the engine left there and carried the words over to
// the next page. Joined by paragraph breaks, the number opens the first paragraph, and two paragraphs
// stand apart as two blocks do. Each paragraph's text is set in its own style, which `assemble` made the
// `footnote` place's default for a stored `body`; the note as a whole, its number included, is set in
// that place's style by the rule on `footnote.entry` above. Only a paragraph's runs hold a footnote:
// `assemble` refuses one in a caption or a title, which the lists after the contents and the running
// heads would set a second time. The note is laid out at the foot of the page, where the engine gives
// it the DOCUMENT's language: so the language and direction where its mark stands are read there and
// set around its body, and a German component's note is read in German, not in the document's English
// (final review of footnotes 2). As measured (publishing.md, "What the pinned Typst does with a
// footnote", and footnotes 2's plan). A reference in a note's text is a link, as in any paragraph's;
// the footnote itself carries its label, where its mark stands, when a reference names it. So does
// each of its paragraphs a reference names (CNT-125), on an empty marker where the paragraph begins -
// the paragraph is no element of its own here, and one a reference names may hold no runs. Measured
// (the final review of cross-references 2): a page reference to it prints the page the note's text
// stands on, a note carried on to the next page included, a link to it lands there, and the label is
// set once.
#let note-paragraph(p) = {
  let body = lettering(style(p.style), p.runs.map(base-run).join())
  if p.anchor == none { body } else [#metadata(none) #label(p.anchor)#body]
}
#let footnote-run(n) = context labelled(n.anchor, footnote(
  numbering: _ => n.label,
  text(
    lang: text.lang,
    region: text.region,
    dir: text.dir,
    n.paragraphs.map(note-paragraph).join(parbreak() + {
      let s = place-style("footnote")
      gap(s, s)
    }),
  ),
))
#let run(r) = if "footnote" in r { footnote-run(r.footnote) } else { base-run(r) }

// How far a place stands in already, at its start and its end: a quotation by its style's indents,
// which its own paragraphs are not given again.
#let within(at) = if at == "quotation" {
  let q = place-style("quotation")
  (q.startIndent, q.endIndent)
} else {
  (0, 0)
}

// An explicit paragraph in every block that sets text: since Typst 0.13 inline content alone in a
// block is not a paragraph, and a first-line indent silently does nothing to it while leading still
// applies (measured by the prototype, ADR-0014). A paragraph with no runs sets nothing, and takes no
// space: `assemble` puts a marker where a reference names one.
#let paragraph(b, at) = {
  if b.runs.len() > 0 {
    styled(style(b.style), labelled(b.anchor, par(b.runs.map(run).join())), within: within(at))
  }
}

// An ordered list's numbering, as `enum` takes a pattern. `format` is `none` where the author set
// none, which is decimal - the fall-through, so a format this template has never heard of would set
// as decimal rather than stopping the compile. That is the opposite of the rule `block-of` follows
// below, and deliberately: an unknown BLOCK is content a reader would silently not be shown, while
// an unknown FORMAT is a list a reader is shown with the wrong marker beside it.
#let numbering-of(format) = if format == "alphabetic" {
  "a."
} else if format == "roman" {
  "i."
} else {
  "1."
}

// The style whose space before a block's top takes, and the style whose space after its foot gives,
// for `gap`; `none` for a block that sets nothing - an empty paragraph, a marker - and so stands
// between nothing. A list stands as its items' place does; preformatted text begins with its label
// where it has one; a quotation begins as its place does and ends with its attribution where it has
// one; a table and a figure stand as their captions do, a table ending with its note where it has one,
// or with its cells; an equation stands as the text of the place it is in.
#let ends(b, at) = if b.type == "paragraph" {
  if b.runs.len() == 0 { none } else { (style(b.style), style(b.style)) }
} else if b.type == "list" {
  (place-style("listItem"), place-style("listItem"))
} else if b.type == "preformatted" {
  (if b.label == none { role("preformatted") } else { role("preformattedLabel") }, role("preformatted"))
} else if b.type == "blockquote" {
  (place-style("quotation"), if b.attribution == none { place-style("quotation") } else { role("attribution") })
} else if b.type == "table" {
  (role("caption"), if b.note == none { place-style("tableCell") } else { role("tableNote") })
} else if b.type == "figure" {
  (role("caption"), role("caption"))
} else if b.type == "equation" {
  (place-style(at), place-style(at))
} else {
  none
}
// The style the last of these blocks that sets anything ends in, or `none` where none does.
#let last-of(blocks, at) = {
  let last = none
  for b in blocks {
    let e = ends(b, at)
    if e != none { last = e.at(1) }
  }
  last
}
// The style a node ends in: its last child's, else its last block's, else its heading's.
#let last-of-node(n) = if n.children.len() > 0 {
  last-of-node(n.children.last())
} else {
  let last = last-of(n.blocks, "text")
  if last == none { heading-role(n.depth) } else { last }
}

// ONE self-recursive function over every block kind, and over a flow of them. Typst resolves a name
// among the bindings ALREADY MADE, so two top-level `let`s cannot call each other: a `block-of`
// calling a later `list-of` fails with `unknown variable`. The list branch therefore lives inside
// `block-of` and calls `block-of` itself, and so does the flow - an array of blocks, each apart from
// the one before by `gap`, beginning after `before` where something stands above the first. That is
// also why this binding stands exactly here - after `run` and `paragraph`, which it calls, and before
// `node`, which calls it. `at` is the place the blocks stand in: `text`, `listItem`, `quotation` or
// `tableCell`.
//
// An unknown kind stops the compile, as an unknown mark kind does. Be exact about what that buys:
// the author is told the publish failed and nothing more - `TypstRefused` carries no cause and no
// diagnostic, by design, since a diagnostic quotes content - so nothing names the block, and
// finding it is a developer's job from the document itself. It is still worth more than a block
// quietly set as nothing, which would publish under the author's name with a piece missing and say
// so nowhere.
#let block-of(b, at, before: none) = {
  if type(b) == array {
    let above = before
    let shown = false
    for each in b {
      let e = ends(each, at)
      if e != none and above != none { gap(above, e.at(0)) }
      if each.type == "marker" and shown {
        // A marker after something this flow has set stays on that thing's page, in a block of no
        // height: alone, it is a tag, which the engine carries to the next page where a page ends
        // before what follows it - measured, a reference to an empty paragraph printed the page after
        // the one its paragraph ends. At a flow's start it goes with what follows, as a tag does.
        block(height: 0pt, block-of(each, at))
      } else {
        block-of(each, at)
      }
      if e != none {
        above = e.at(1)
        shown = true
      }
    }
  } else if b.type == "paragraph" {
    paragraph(b, at)
  } else if b.type == "list" {
    // An item that came out of `assemble` with nothing in it is KEPT rather than dropped - dropping
    // it would renumber every item below it - so a body here can be empty, and each branch below
    // must make a valid item from one.
    //
    // The list is set in its items' place's style, its markers included, and its items stand a line
    // apart - only the leading between them, as template 11's did and as Word sets the paragraphs of
    // one list - while the style's spaces before and after stand around the list as a whole.
    let item = place-style("listItem")
    let spacing = pt(item.leading)
    // A loop, not a `map` over a closure: each level of nesting costs the engine's call depth one
    // frame fewer, so a list nests as deep here as it did in template 11 (`lists.test.ts`).
    let bodies = ()
    for i in b.items { bodies.push(block-of(i.blocks, "listItem")) }
    let shown = if b.kind == "definition" {
      // `terms` is the closest Typst 0.15.1 has. It tags L / LI / Lbl / LBody, NOT PDF/UA's
      // DL / DI / DT / DD, and the engine offers no way to ask for another role: the term reaches a
      // reader as the item's label and the definition as its body. Said in the changelog's Known
      // limits rather than claimed as the structure the format has.
      // `term` is `none` where the author has not typed one yet, which the model permits for the
      // same reason it permits an empty paragraph - it is where a cursor stands - so the label is
      // empty rather than the compile refused. The term is set in the item's place's style.
      labelled(b.anchor, terms(spacing: spacing, ..b.items.enumerate().map(((i, item)) => terms.item(
        if item.term == none { [] } else { item.term.map(run).join() },
        bodies.at(i),
      ))))
    } else if b.kind == "ordered" {
      // `b.start == none` and not a falsy test: 0 IS a start, and the model permits it wherever the
      // numbering is decimal.
      labelled(b.anchor, enum(
        spacing: spacing,
        start: if b.start == none { 1 } else { b.start },
        numbering: numbering-of(b.format),
        ..bodies.map(enum.item),
      ))
    } else {
      labelled(b.anchor, list(spacing: spacing, ..bodies.map(list.item)))
    }
    setting(item, shown)
  } else if b.type == "preformatted" {
    // Each line already has its tabs expanded (`assemble`), because the engine ignores `tab-size`
    // without a language and a language deletes whitespace: so neither is ever given here. The
    // label, where there is one, stands above the block in the `preformattedLabel` role's style, and
    // the lines in the `preformatted` role's, on its fill with its padding inside - the style
    // `assemble` counted the columns by. A reference's label, where one names the block, is on the
    // lines themselves.
    let s = role("preformatted")
    if b.label != none {
      let l = role("preformattedLabel")
      styled(l, par(b.label), within: within(at))
      gap(l, s)
    }
    labelled(b.anchor, styled(s, within: within(at), layout(size => {
      // A BACKSTOP that must never fire: `assemble` refuses a line wider than its place before the
      // engine runs (`line_too_wide`), and an engine refusal on a document the checks passed is a
      // pipeline defect. The message names the block and nothing it holds, because a diagnostic
      // that quoted a line would carry the author's text somewhere it should not go.
      for line in b.lines {
        assert(
          measure(code(line, block: true)).width <= size.width,
          message: "preformatted " + b.id + " is wider than its measure",
        )
      }
      code(block: true, b.lines.join("\n"))
    })))
  } else if b.type == "blockquote" {
    // The attribution is set HERE, as a paragraph at the end of the quotation in the `attribution`
    // role's style, with no character of any kind before it - never through the engine's own
    // attribution parameter, which writes an em dash before the name that the author never typed and
    // tags it a bare Span (editor 5, decision D). The author types whatever they want before a name.
    //
    // In a block of the FULL width, because the engine sizes a quotation to its content: aligned to
    // the end of the quotation alone, the attribution ended where the quotation's longest line did,
    // which is the page's edge only when a paragraph happens to wrap. Measured by task 9's test, which
    // quotes two short paragraphs.
    labelled(b.anchor, quote(block: true, {
      block-of(b.blocks, "quotation")
      if b.attribution != none {
        let a = role("attribution")
        let last = last-of(b.blocks, "quotation")
        if last != none { gap(last, a) }
        styled(a, par(b.attribution.map(run).join()), within: within("quotation"))
      }
    }))
  } else if b.type == "table" {
    // A cell is its blocks - paragraphs and lists, published as they are anywhere else - inside
    // `table.cell` with its spans. A cell with nothing in it is kept, as an empty list item is, since
    // dropping it would move every cell after it along its row.
    //
    // `scope` is `assemble`'s, from where the cell starts in the grid. A header row's cells need
    // nothing more: `table.header` makes each a `TH` of a column. A header column's are wrapped in
    // `pdf.header-cell`, which exists only under the engine's `--features a11y-extras`
    // (`typstArguments`), and the wrapper goes AROUND the spanning cell: the other way round, a
    // spanning header cell loses its `TH` and is tagged a `TD`, with nothing said. Measured.
    let cell-of(c) = {
      let body = block-of(c.blocks, "tableCell")
      let spanned = table.cell(colspan: c.colspan, rowspan: c.rowspan, if body == none { [] } else { body })
      if c.scope == "row" or c.scope == "both" { pdf.header-cell(scope: c.scope, spanned) } else { spanned }
    }
    let heading = b.rows.slice(0, b.headerRows).map(row => row.cells.map(cell-of)).flatten()
    let rest = b.rows.slice(b.headerRows).map(row => row.cells.map(cell-of)).flatten()
    let caption = role("caption")
    let cell = place-style("tableCell")
    // Numbering off: the label is `number`'s, set as text before the caption's runs (decision F of
    // the first slice), and never Typst's counter. Columns share the measure equally until a table
    // style says otherwise, so a table is never wider than its column. A reference's label, where
    // one names the table, is on its figure. The caption stands above its table as a block above a
    // block does: its space after, the cells' space before and their leading between them.
    labelled(b.anchor, figure(
      kind: table,
      numbering: none,
      gap: pt(caption.spaceAfter + cell.spaceBefore + cell.leading),
      caption: {
        if b.label != none { b.label + " " }
        b.caption.map(run).join()
      },
      table(
        columns: (1fr,) * b.columns,
        // One header, repeated on every page the table reaches, and still one header row to a
        // reader: the tree holds it once however many pages repeat it (TAB-040).
        ..if heading.len() > 0 { (table.header(repeat: true, ..heading),) } else { () },
        ..rest,
      ),
    ))
    // The table's note (CNT-038, footnotes 2): a paragraph straight after the table's figure, in the
    // `tableNote` role's style, with no label of its own. NOT inside the figure, where FN-D put it:
    // measured, a figure whose body is more than its table is tagged a `Div` holding the `Caption`
    // beside a second `Div` of the `Table` and the note, so the caption stops being the table's own
    // first child and the table loses its programmatic caption (TAB-039).
    if b.note != none {
      let n = role("tableNote")
      gap(cell, n)
      styled(n, par(b.note.map(run).join()), within: within(at))
    }
  } else if b.type == "figure" {
    // The image at the size `assemble` worked out, in points, never a share of the page: the engine
    // lets an image run off its page and says nothing. Its path is `assemble`'s too - the image's hash
    // in the compile root, which holds nothing else - so no content names a file. Its alternative text
    // is set with the language it is written in, around the image alone, so the `Figure` carries its
    // own `/Lang` and the caption keeps the component's. A decorative image is an artifact, with no
    // `Figure` and nothing read to a screen reader; its caption and number are kept (decision F-M).
    // All measured (publishing.md, "What the pinned Typst does with an image").
    let shown = if b.alternative == none {
      pdf.artifact(image(b.path, width: pt(b.width), height: pt(b.height)))
    } else {
      text(
        ..language(b.alternative.language),
        image(b.path, width: pt(b.width), height: pt(b.height), alt: b.alternative.text),
      )
    }
    // Numbering off, as a table's: the label is `number`'s, set as text before the caption's runs.
    // The caption stands below, where a figure's conventionally does (decision F-L), as a block below
    // an image does: its space before and its leading between them, the image having none of its own.
    let caption = role("caption")
    labelled(b.anchor, figure(
      kind: image,
      numbering: none,
      gap: pt(caption.spaceBefore + caption.leading),
      caption: {
        if b.label != none { b.label + " " }
        b.caption.map(run).join()
      },
      shown,
    ))
  } else if b.type == "equation" {
    // A numbered equation (equations 2, EQ-E): a figure of the kind "equation", with no supplement and
    // no numbering of its own, whose caption is `number`'s label, which the show rule above sets beside
    // it; its anchor on the figure, where a reference's link lands and its page is read, and what the
    // list of equations lists. An unnumbered one is the equation alone, carrying its anchor where a
    // reference names it - on the equation itself, since the label must stand on an element the engine
    // can locate, and the language around it is not one. Measured (the spike, sections 5 and 8). Set
    // in the style of the text of the place it stands in.
    setting(place-style(at), if b.label == none {
      text(
        ..language(b.alternative.language),
        labelled(b.anchor, math.equation(block: true, alt: b.alternative.text, maths(b.tree))),
      )
    } else {
      labelled(b.anchor, figure(
        kind: "equation",
        supplement: none,
        numbering: none,
        caption: b.label,
        equation(b, block: true),
      ))
    })
  } else if b.type == "marker" {
    // A target that publishes nothing - an empty paragraph, a list with nothing in it - which a
    // reference names (XR-D): `assemble` emits this in its place so the label is in the file. Metadata
    // is set as nothing and tagged as nothing, and a link to it and its page both work. Measured.
    [#metadata(none) #label(b.anchor)]
  } else {
    panic("unknown block type: " + b.type)
  }
}

// A node's own heading and blocks take its language and direction where they differ from the
// document's; what it holds takes its own. Its heading carries its anchor, `n-<id>`, where a reference
// names the node, and no label where none does. Its title is runs (equations 2): its words, carrying
// no mark, and any equation among them, set in the heading - and so in the contents, the running heads
// and the bookmarks, which read the heading's body. A running head sets an equation as an artifact,
// where a link would refuse the compile, and a bookmark flattens it to its glyphs (the spike, EQ-G).
// `before` is the style of what the node follows, whose space after stands above its heading, or
// `none` where it opens a page.
#let node(n, before) = {
  let role-of = heading-role(n.depth)
  let own = {
    if before != none { gap(before, role-of) }
    let title = n.title.map(base-run).join()
    let title = if title == none { [] } else { title }
    let said = if n.number == none { title } else { [#n.number #title] }
    labelled(n.anchor, heading(level: n.depth, said))
    block-of(n.blocks, "text", before: role-of)
  }
  if n.language == none and n.direction == none {
    own
  } else {
    let lang = if n.language == none { language(doc.language) } else { language(n.language) }
    let dir = direction(if n.direction == none { doc.direction } else { n.direction })
    set text(..lang, dir: dir)
    own
  }
  let above = last-of(n.blocks, "text")
  let above = if above == none { role-of } else { above }
  for c in n.children {
    node(c, above)
    above = last-of-node(c)
  }
}

// The document's title as a heading a screen reader announces: Typst's `title()` is tagged Title
// and role-mapped to P under PDF/UA-1. Kept out of the outline and the bookmarks, which are the
// document's sections; the PDF's own title is `set document` above. It is set in the `title` role's
// style, and the notice's sentence after it in the `noticeSentence` role's.
#let opening = {
  {
    show heading: it => styled(role("title"), it.body)
    heading(level: 1, outlined: false, bookmarked: false, doc.title)
  }
  gap(role("title"), role("noticeSentence"))
  styled(role("noticeSentence"), par(words(doc.words.noticeSentence)))
}

// The cover, where the layout declares one: the title and the notice's sentence alone on the first
// page, which has no number (decision J). Where the layout declares none, the first node opens the
// document instead; `assemble` publishes nothing with neither a cover nor a node (decision K), so
// this is the only place the title is set and no node-less document reaches here without a cover.
#if doc.front.cover {
  opening
}

// The contents (PUB-037): Typst's outline over the outlined headings to the layout's depth, which a
// screen reader is told is a table of contents (TOC, TOCI). Each entry's number is the heading's own
// text, so `number`'s (decision F); Typst supplies only the page, as its label. The leader is an
// artifact. The title is the layout's word, as a heading neither outlined nor bookmarked, in the
// `contents` role's style, and each entry in the `contentsEntry` role's; the lists after it are set
// the same way by the `list` and `listEntry` roles. The title stands above the first entry, and one
// entry above the next, as a block above a block does.
#let listed(title, entry, body) = {
  show heading.where(outlined: false): it => {
    styled(title, it.body)
    gap(title, entry)
  }
  show outline.entry: set block(spacing: pt(entry.spaceAfter + entry.spaceBefore + entry.leading))
  show outline.entry: it => setting(entry, link(
    it.element.location(),
    it.indented(none, [#it.body() #box(width: 1fr, repeat[.]) #it.page()]),
  ))
  body
}
// Each generated list the layout declares and `assemble` found an entry for (PUB-038), after the
// contents and each on a page of its own: Typst's outline again, over the figures of its kind, so it
// too is a table of contents to a screen reader and each entry links to what it lists. The entry is
// the figure's caption, which already begins with `number`'s label; only the page is the engine's.
// An unknown sequence stops the compile, as an unknown block does: `assemble` publishes a list only
// for a kind it can publish. The list of equations lists the numbered equations' figures, whose entry
// is the label alone; an unnumbered equation has no figure and no entry.
#let kind-of(sequence) = if sequence == "figure" {
  image
} else if sequence == "table" {
  table
} else if sequence == "equation" {
  "equation"
} else {
  panic("unknown list: " + sequence)
}
// The contents and the lists together are what the front matter opens with, so this is `none` only
// where the layout declares no contents and no list has an entry.
#let contents = {
  if doc.front.contents != none {
    listed(role("contents"), role("contentsEntry"), outline(
      title: words(doc.words.contents),
      target: heading.where(outlined: true),
      depth: doc.front.contents.depth,
    ))
  }
  for list in doc.front.lists {
    pagebreak(weak: true)
    listed(role("list"), role("listEntry"), outline(
      title: words(list.title),
      target: figure.where(kind: kind-of(list.sequence)),
    ))
  }
}

// Segments: consecutive top-level nodes of one matter. Every change of matter starts a page, since
// a page's numbering is the page's own (decision J). The contents is front matter: it heads the first
// segment where that is front matter, and is a front segment of its own where the outline has none.
#let segments = doc.nodes.fold((), (acc, n) => {
  if acc.len() > 0 and acc.last().matter == n.matter {
    acc.at(-1).nodes.push(n)
    acc
  } else {
    acc.push((matter: n.matter, nodes: (n,), contents: false))
    acc
  }
})
#let segments = if contents == none {
  segments
} else if segments.len() > 0 and segments.first().matter == "front" {
  (segments.first() + (contents: true),) + segments.slice(1)
} else {
  ((matter: "front", nodes: (), contents: true),) + segments
}

// Page numbers run in chains, since Typst has one page counter and an outline may return to a matter
// it left (body after an appendix, as schema 1 allowed). A matter whose rule restarts begins a chain
// of its own on its first entry, at one; one that does not joins the chain of the page before it and
// carries on. A matter entered again resumes its chain one past that chain's last page, whatever its
// rule says, so no two pages of a chain share a label.
#let chained = {
  let chain-of = (:)
  let before = "none"
  let planned = ()
  for s in segments {
    let rule = f.pageNumbering.at(s.matter)
    let start = if s.matter in chain-of {
      "resume"
    } else if rule.restart {
      chain-of.insert(s.matter, s.matter)
      "restart"
    } else {
      chain-of.insert(s.matter, before)
      "continue"
    }
    let chain = chain-of.at(s.matter)
    planned.push((..s, pattern: rule.pattern, chain: chain, start: start))
    before = chain
  }
  planned
}
// Each chain's last page number so far.
#let last-in(chain) = state("aw-chain-" + chain, 0)

#for (i, s) in chained.enumerate() {
  // The `set page` is what starts each segment on a page of its own (decision J): a page rule in
  // the flow always breaks the page. The weak break before it says so, and adds no page of its own.
  pagebreak(weak: true)
  set page(numbering: s.pattern, header: header(false), footer: three(f.foot))
  if s.start == "restart" {
    counter(page).update(1)
  } else if s.start == "resume" {
    context counter(page).update(last-in(s.chain).get() + 1)
  }
  // What the first node follows: the notice's sentence where the title and the sentence open the
  // first page, and nothing where a page opens with it, where space before is suppressed anyway.
  let above = none
  // Without a cover, the title and the notice's sentence open the first page.
  if i == 0 and not doc.front.cover {
    opening
    above = role("noticeSentence")
  }
  // The contents always ends its page, so the front matter after it starts one. A segment of the
  // contents alone ends where the next segment's page begins.
  if s.contents {
    contents
    if s.nodes.len() > 0 { pagebreak() }
    above = none
  }
  for (j, n) in s.nodes.enumerate() {
    // Each later appendix starts a page where the layout says so (PUB-088); the first starts one as
    // every matter does.
    if j > 0 and s.matter == "appendix" and doc.appendices.newPage { pagebreak(weak: true) }
    node(n, above)
    above = last-of-node(n)
  }
  context last-in(s.chain).update(counter(page).get().first())
}

// Where the document ends: its page is the physical page count a running head or foot's `pages` prints.
#metadata(none) <aw-end>
