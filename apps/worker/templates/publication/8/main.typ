// The publication template, version 8 (docs/design/publishing.md). It reads the published
// document under a layout whose runs may be images and whose blocks may be lists, quotations,
// preformatted text, tables and figures, with its generated lists after the contents, `publishing/8`,
// from data.json as values and evaluates nothing: no content reaches Typst as source (ADR-0013,
// PUB-062). A version is immutable - an edit is a new directory, and a test holds each version's hash.
// It is version 7 with an image branch of `run`, and nothing else: template 7 and the publications
// made with it are a record, never migrated.
#let doc = json("data.json")
#assert(doc.schema == "publishing/8", message: "data.json is not publishing/8")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }
// The layout's own words, set in the layout's language, which need not be the document's.
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)

#set document(title: doc.title, author: (), keywords: ())
#set text(font: face, size: 11pt, ..language(doc.language), dir: direction(doc.direction))
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
#let run(r) = if "image" in r { image-run(r.image) } else { text-run(r) }

#let paragraph(b) = {
  if b.runs.len() > 0 { par(b.runs.map(run).join()) }
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
      terms(..b.items.enumerate().map(((i, item)) => terms.item(
        if item.term == none { [] } else { item.term.map(run).join() },
        bodies.at(i),
      )))
    } else if b.kind == "ordered" {
      // `b.start == none` and not a falsy test: 0 IS a start, and the model permits it wherever the
      // numbering is decimal.
      enum(
        start: if b.start == none { 1 } else { b.start },
        numbering: numbering-of(b.format),
        ..bodies.map(enum.item),
      )
    } else {
      list(..bodies.map(list.item))
    }
  } else if b.type == "preformatted" {
    // Each line already has its tabs expanded (`assemble`), because the engine ignores `tab-size`
    // without a language and a language deletes whitespace: so neither is ever given here. The
    // label, where there is one, stands above the block in the body face.
    if b.label != none { block(text(size: 8pt, b.label)) }
    block(fill: luma(240), inset: 6pt, width: 100%, layout(size => {
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
    }))
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
    quote(block: true, {
      b.blocks.map(block-of).join()
      if b.attribution != none {
        block(width: 100%, align(end, par(b.attribution.map(run).join())))
      }
    })
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
    // style says otherwise, so a table is never wider than its column.
    figure(
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
    )
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
    figure(
      kind: image,
      numbering: none,
      caption: {
        if b.label != none { b.label + " " }
        b.caption.map(run).join()
      },
      shown,
    )
  } else {
    panic("unknown block type: " + b.type)
  }
}

// A node's own heading and blocks take its language and direction where they differ from the
// document's; what it holds takes its own. Its heading is labelled `<n-ID>`, by the node.
#let node(n) = {
  let own = {
    let said = if n.number == none { n.title } else { n.number + " " + n.title }
    [#heading(level: n.depth, said) #label("n-" + n.id)]
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
// for a kind it can publish.
#let kind-of(sequence) = if sequence == "figure" { image } else if sequence == "table" { table } else {
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
