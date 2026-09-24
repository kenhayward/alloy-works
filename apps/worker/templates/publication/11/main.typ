// The publication template, version 11 (docs/design/publishing.md). It reads the published
// document under a layout whose runs may be images, footnotes, cross-references or equations, whose
// blocks may be lists, quotations, preformatted text, tables with their notes, figures, equations and
// the empty markers a reference can name, and whose nodes' titles are runs, with its generated lists
// after the contents, `publishing/11`, from data.json as values and evaluates nothing: no content
// reaches Typst as source (ADR-0013, PUB-062). A version is immutable - an edit is a new directory,
// and a test holds each version's hash. It is version 10 with the maths face, the maths tree, an
// equation branch of `run` and of `block-of`, a numbered equation's figure and the list of equations,
// and a node's title set from its runs, and nothing else: template 10 and the publications made with
// it are a record, never migrated.
#let doc = json("data.json")
#assert(doc.schema == "publishing/11", message: "data.json is not publishing/11")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }
// The layout's own words, set in the layout's language, which need not be the document's.
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)

#set document(title: doc.title, author: (), keywords: ())
// The engine's fallback is OFF for the body text too, from this version: until equations 2 pinned a
// maths face, every face beside Liberation Serif was Liberation Mono, a strict subset of it, so a
// fallback could reach nothing the body face lacked, and was never used. STIX Two Math holds many
// characters Liberation Serif does not - the private-use area among them - and left on, a paragraph's
// character the body face lacks would be set from the maths face, where `assemble` asked the body face
// and refused it. Off, the engine refuses exactly what it refused before (`regression.test.ts`).
#set text(
  font: face,
  fallback: false,
  size: 11pt,
  ..language(doc.language),
  dir: direction(doc.direction),
)
#set par(justify: false, leading: 0.65em, spacing: 0.9em)
// Every `raw` - an inline code run and preformatted text alike - in the pinned Liberation Mono
// (editor 5, decision B), and with the engine's fallback OFF (decision C): left on, a character Mono
// lacks is quietly set from Liberation Serif and the column is wrong with nothing said. `assemble`
// refuses such a character first, as `code_glyph_missing`; this is what keeps the engine from
// papering over one that got past it. Preformatted text is set at 8.8pt, the size `CODE_SIZE` names
// in `packages/domain/src/publishing/measure.ts`, explicitly rather than inherited, because the
// column measure is computed from it.
#show raw: set text(font: "Liberation Mono", fallback: false)
#show raw.where(block: true): set text(size: 8.8pt)
// Every equation in the pinned STIX Two Math (equations 2, EQ-A) - its identifiers, its operators and
// the text inside it alike - and with the engine's fallback OFF, as for `raw`: left on, a character
// the maths face lacks is set from Liberation Serif, which is no maths face, or refused with nothing
// said. `assemble` refuses such a character first, as `math_glyph_missing`. Without this rule there is
// no maths face at all: `--ignore-embedded-fonts` removes the engine's own, and every equation is a
// refused compile (measured by the equations spike).
#show math.equation: set text(font: "STIX Two Math", fallback: false)
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
    // the equation is the line the number takes, with the leading between.
    block(width: 100%, {
      it.body
      v(measure(number).height + 0.65em.to-absolute())
      place(right + bottom, number)
    })
  }
})
#let f = doc.format
// Every page carries the status in its header, placed by the template outside anything a layout
// fills, so no layout can remove it (decision H). Typst marks a header as a pagination artifact,
// which assistive technology does not read, so the notice is also set once as tagged text below.
// Its words are the layout's, in the layout's language.
#let notice = align(end, words(text(size: 9pt, doc.words.notice)))

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
#let three(slots) = {
  set text(size: 9pt)
  grid(
    columns: (1fr, 1fr, 1fr),
    align(start, slot(slots.at(0))),
    align(center, slot(slots.at(1))),
    align(end, slot(slots.at(2))),
  )
}
// The notice is the template's, above the slots, on every page: no layout can remove it. The cover
// carries it alone.
#let header(cover) = {
  notice
  if not cover { three(f.head) }
}

// The page the layout declares (PUB-007), in points and in the portrait sense, turned where it is
// landscape. The gutter widens the inside margin, which alternates with the outside from page to page
// about the binding edge. No page is numbered until its matter says how (PUB-009), and until then the
// notice is all the template prints in the page's margins: the cover's.
#set page(
  width: f.width * 1pt,
  height: f.height * 1pt,
  flipped: f.orientation == "landscape",
  margin: (
    top: f.margins.top * 1pt,
    bottom: f.margins.bottom * 1pt,
    inside: (f.margins.inside + f.gutter) * 1pt,
    outside: f.margins.outside * 1pt,
  ),
  numbering: none,
  header: header(true),
  footer: none,
)
// Section numbers are the publisher's (`number`), set as text; Typst numbers only the pages.
#set heading(numbering: none)
#show heading: set text(weight: "bold")
#show heading: it => block(above: 1.4em, below: 0.8em, sticky: true, it)
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 2): set text(size: 13pt)

// A run and the marks over it. `assemble` writes them in one fixed order, outermost first
// (PUBLISHED_MARK_ORDER), so the fold runs the array backwards and each mark wraps what the marks
// inside it have already made: one document sets one way, whatever order the author applied them in.
// `inlineCode` is settled BEFORE the fold rather than inside it. Typst's `raw` takes text, not a
// body, so a branch that called it in the fold would REPLACE everything applied so far - a run marked
// as code and emphasised would lose the emphasis with nothing said, and the page would say something
// the author did not write. Computed first, it is the innermost thing here and can lose nothing.
// A quoted phrase is set with `quotes: false`: the author's own quotation marks are in the text, and
// the editor shows them once, so the role is what the mark carries into the PDF and not a second
// pair of characters. An unknown kind stops the compile: a publish failure the author is told about
// is worth more than a run that is quietly set as plain text.
#let text-run(r) = {
  let kinds = r.marks.map(m => m.kind)
  let body = if "inlineCode" in kinds { raw(r.text) } else { r.text }
  for m in r.marks.rev() {
    if m.kind == "inlineCode" {
    } else if m.kind == "emphasis" {
      body = emph(body)
    } else if m.kind == "strong" {
      body = strong(body)
    } else if m.kind == "underline" {
      body = underline(body)
    } else if m.kind == "subscript" {
      body = sub(body)
    } else if m.kind == "superscript" {
      body = super(body)
    } else if m.kind == "quotedPhrase" {
      body = quote(quotes: false, body)
    } else if m.kind == "hyperlink" {
      body = link(m.href, body)
    } else if m.kind == "language" {
      body = text(..language(m.language), body)
    } else {
      panic("unknown mark kind: " + m.kind)
    }
  }
  body
}
// An image in a run of text (figures 5): in a box, so it stands in the line, at the size `assemble`
// worked out - one line high, and never wider than the room it stands in. Its alternative text is set
// with the language it is written in, around the image alone, so its `Figure` carries its own `/Lang`
// inside the paragraph or the cell; a decorative image is an artifact. As a figure's, and measured
// (publishing.md, "What the pinned Typst does with an image").
#let image-run(i) = {
  let size = (width: i.width * 1pt, height: i.height * 1pt)
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
    h(n.em * 1em)
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
// the next page. Joined by paragraph breaks, the number opens the first paragraph. Only a paragraph's
// runs hold a footnote: `assemble` refuses one in a caption or a title, which the lists after the
// contents and the running heads would set a second time. The note is laid out at the foot of the page,
// where the engine gives it the DOCUMENT's language: so the language and direction where its mark stands
// are read there and set around its body, and a German component's note is read in German, not in the
// document's English (final review of footnotes 2). As measured (publishing.md, "What the pinned Typst
// does with a footnote", and footnotes 2's plan). A reference in a note's text is a link, as in any
// paragraph's; the footnote itself carries its label, where its mark stands, when a reference names it.
// So does each of its paragraphs a reference names (CNT-125), on an empty marker where the paragraph
// begins - the paragraph is no element of its own here, and one a reference names may hold no runs.
// Measured (the final review of cross-references 2): a page reference to it prints the page the note's
// text stands on, a note carried on to the next page included, a link to it lands there, and the
// label is set once.
#let note-paragraph(p) = {
  let body = p.runs.map(base-run).join()
  if p.anchor == none { body } else [#metadata(none) #label(p.anchor)#body]
}
#let footnote-run(n) = context labelled(n.anchor, footnote(
  numbering: _ => n.label,
  text(
    lang: text.lang,
    region: text.region,
    dir: text.dir,
    n.paragraphs.map(note-paragraph).join(parbreak()),
  ),
))
#let run(r) = if "footnote" in r { footnote-run(r.footnote) } else { base-run(r) }

#let paragraph(b) = {
  if b.runs.len() > 0 { labelled(b.anchor, par(b.runs.map(run).join())) }
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

// ONE self-recursive function over every block kind. Typst resolves a name among the bindings
// ALREADY MADE, so two top-level `let`s cannot call each other: a `block-of` calling a later
// `list-of` fails with `unknown variable`. The list branch therefore lives inside `block-of` and
// calls `block-of` itself. That is also why this binding stands exactly here - after `run` and
// `paragraph`, which it calls, and before `node`, which calls it.
//
// An unknown kind stops the compile, as an unknown mark kind does. Be exact about what that buys:
// the author is told the publish failed and nothing more - `TypstRefused` carries no cause and no
// diagnostic, by design, since a diagnostic quotes content - so nothing names the block, and
// finding it is a developer's job from the document itself. It is still worth more than a block
// quietly set as nothing, which would publish under the author's name with a piece missing and say
// so nowhere.
#let block-of(b) = {
  if b.type == "paragraph" {
    paragraph(b)
  } else if b.type == "list" {
    // An item that came out of `assemble` with nothing in it is KEPT rather than dropped - dropping
    // it would renumber every item below it - so a body here can be empty, and each branch below
    // must make a valid item from one.
    let bodies = b.items.map(i => i.blocks.map(block-of).join())
    if b.kind == "definition" {
      // `terms` is the closest Typst 0.15.1 has. It tags L / LI / Lbl / LBody, NOT PDF/UA's
      // DL / DI / DT / DD, and the engine offers no way to ask for another role: the term reaches a
      // reader as the item's label and the definition as its body. Said in the changelog's Known
      // limits rather than claimed as the structure the format has.
      // `term` is `none` where the author has not typed one yet, which the model permits for the
      // same reason it permits an empty paragraph - it is where a cursor stands - so the label is
      // empty rather than the compile refused.
      labelled(b.anchor, terms(..b.items.enumerate().map(((i, item)) => terms.item(
        if item.term == none { [] } else { item.term.map(run).join() },
        bodies.at(i),
      ))))
    } else if b.kind == "ordered" {
      // `b.start == none` and not a falsy test: 0 IS a start, and the model permits it wherever the
      // numbering is decimal.
      labelled(b.anchor, enum(
        start: if b.start == none { 1 } else { b.start },
        numbering: numbering-of(b.format),
        ..bodies.map(enum.item),
      ))
    } else {
      labelled(b.anchor, list(..bodies.map(list.item)))
    }
  } else if b.type == "preformatted" {
    // Each line already has its tabs expanded (`assemble`), because the engine ignores `tab-size`
    // without a language and a language deletes whitespace: so neither is ever given here. The
    // label, where there is one, stands above the block in the body face. A reference's label, where
    // one names the block, is on the lines themselves.
    if b.label != none { block(text(size: 8pt, b.label)) }
    labelled(b.anchor, block(fill: luma(240), inset: 6pt, width: 100%, layout(size => {
      // A BACKSTOP that must never fire: `assemble` refuses a line wider than its place before the
      // engine runs (`line_too_wide`), and an engine refusal on a document the checks passed is a
      // pipeline defect. The message names the block and nothing it holds, because a diagnostic
      // that quoted a line would carry the author's text somewhere it should not go.
      for line in b.lines {
        assert(
          measure(raw(block: true, line)).width <= size.width,
          message: "preformatted " + b.id + " is wider than its measure",
        )
      }
      raw(block: true, b.lines.join("\n"))
    })))
  } else if b.type == "blockquote" {
    // The attribution is set HERE, as a paragraph at the end of the quotation aligned to its end,
    // with no character of any kind before it - never through the engine's own attribution
    // parameter, which writes an em dash before the name that the author never typed and tags it a
    // bare Span (editor 5, decision D). The author types whatever they want before a name.
    //
    // In a block of the FULL width, because the engine sizes a quotation to its content: aligned to
    // the end of the quotation alone, the attribution ended where the quotation's longest line did,
    // which is the page's edge only when a paragraph happens to wrap. Measured by task 9's test, which
    // quotes two short paragraphs.
    labelled(b.anchor, quote(block: true, {
      b.blocks.map(block-of).join()
      if b.attribution != none {
        block(width: 100%, align(end, par(b.attribution.map(run).join())))
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
      let body = c.blocks.map(block-of).join()
      let spanned = table.cell(colspan: c.colspan, rowspan: c.rowspan, if body == none { [] } else { body })
      if c.scope == "row" or c.scope == "both" { pdf.header-cell(scope: c.scope, spanned) } else { spanned }
    }
    let heading = b.rows.slice(0, b.headerRows).map(row => row.cells.map(cell-of)).flatten()
    let rest = b.rows.slice(b.headerRows).map(row => row.cells.map(cell-of)).flatten()
    // Numbering off: the label is `number`'s, set as text before the caption's runs (decision F of
    // the first slice), and never Typst's counter. Columns share the measure equally until a table
    // style says otherwise, so a table is never wider than its column. A reference's label, where
    // one names the table, is on its figure.
    labelled(b.anchor, figure(
      kind: table,
      numbering: none,
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
    // The table's note (CNT-038, footnotes 2): a paragraph straight after the table's figure, a point
    // smaller than the body text, with no label of its own. NOT inside the figure, where FN-D put it:
    // measured, a figure whose body is more than its table is tagged a `Div` holding the `Caption`
    // beside a second `Div` of the `Table` and the note, so the caption stops being the table's own
    // first child and the table loses its programmatic caption (TAB-039).
    if b.note != none {
      block(width: 100%, above: 0.6em, text(size: 10pt, par(b.note.map(run).join())))
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
      pdf.artifact(image(b.path, width: b.width * 1pt, height: b.height * 1pt))
    } else {
      text(
        ..language(b.alternative.language),
        image(b.path, width: b.width * 1pt, height: b.height * 1pt, alt: b.alternative.text),
      )
    }
    // Numbering off, as a table's: the label is `number`'s, set as text before the caption's runs.
    // The caption stands below, where a figure's conventionally does (decision F-L).
    labelled(b.anchor, figure(
      kind: image,
      numbering: none,
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
    // can locate, and the language around it is not one. Measured (the spike, sections 5 and 8).
    if b.label == none {
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
    }
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
#let node(n) = {
  let own = {
    let title = n.title.map(base-run).join()
    let title = if title == none { [] } else { title }
    let said = if n.number == none { title } else { [#n.number #title] }
    labelled(n.anchor, heading(level: n.depth, said))
    for b in n.blocks {
      block-of(b)
    }
  }
  if n.language == none and n.direction == none {
    own
  } else {
    let lang = if n.language == none { language(doc.language) } else { language(n.language) }
    let dir = direction(if n.direction == none { doc.direction } else { n.direction })
    set text(..lang, dir: dir)
    own
  }
  for c in n.children { node(c) }
}

// The document's title as a heading a screen reader announces: Typst's `title()` is tagged Title
// and role-mapped to P under PDF/UA-1. Kept out of the outline and the bookmarks, which are the
// document's sections; the PDF's own title is `set document` above. The notice's sentence follows it.
#let opening = {
  heading(level: 1, outlined: false, bookmarked: false, doc.title)
  par(words(text(weight: "bold", doc.words.noticeSentence)))
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
// artifact. The title is the layout's word, as a heading neither outlined nor bookmarked.
#show outline.entry: it => link(
  it.element.location(),
  it.indented(none, [#it.body() #box(width: 1fr, repeat[.]) #it.page()]),
)
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
    outline(
      title: words(doc.words.contents),
      target: heading.where(outlined: true),
      depth: doc.front.contents.depth,
    )
  }
  for list in doc.front.lists {
    pagebreak(weak: true)
    outline(title: words(list.title), target: figure.where(kind: kind-of(list.sequence)))
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
  // Without a cover, the title and the notice's sentence open the first page.
  if i == 0 and not doc.front.cover { opening }
  // The contents always ends its page, so the front matter after it starts one. A segment of the
  // contents alone ends where the next segment's page begins.
  if s.contents {
    contents
    if s.nodes.len() > 0 { pagebreak() }
  }
  for (j, n) in s.nodes.enumerate() {
    // Each later appendix starts a page where the layout says so (PUB-088); the first starts one as
    // every matter does.
    if j > 0 and s.matter == "appendix" and doc.appendices.newPage { pagebreak(weak: true) }
    node(n)
  }
  context last-in(s.chain).update(counter(page).get().first())
}

// Where the document ends: its page is the physical page count a running head or foot's `pages` prints.
#metadata(none) <aw-end>
