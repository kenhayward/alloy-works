// The publication template, version 4 (docs/design/publishing.md). It reads the published
// document under a layout whose blocks may be lists, `publishing/4`, from data.json as values and
// evaluates nothing: no content reaches Typst as source (ADR-0013, PUB-062). A version is immutable -
// an edit is a new directory, and a test holds each version's hash. It is version 3 with `block-of`,
// and nothing else: template 3 and the publications made with it are a record, never migrated.
#let doc = json("data.json")
#assert(doc.schema == "publishing/4", message: "data.json is not publishing/4")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }
// The layout's own words, set in the layout's language, which need not be the document's.
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)

#set document(title: doc.title, author: (), keywords: ())
#set text(font: face, size: 11pt, ..language(doc.language), dir: direction(doc.direction))
#set par(justify: false, leading: 0.65em, spacing: 0.9em)
// The bullet an unordered list takes at each level: disc, then circle, then square, the convention
// every word processor and browser uses, and every one of the three sets in the pinned faces.
// Typst's own defaults are disc, then U+2023 TRIANGULAR BULLET, then an en dash - and U+2023 IS NOT
// IN LIBERATION SERIF, so a two-level unordered list was a REFUSED COMPILE with no fallback and no
// warning of any kind. If a document is ever refused with `TypstRefused` and nothing else, look
// here first. Written as escapes, never as the characters themselves, so a source file carries no
// glyph a diff or a terminal can hide.
// That a marker lives in a template at all, rather than in a named style, is issue #158: CNT-094
// says a block takes its appearance from a style, and a marker is appearance. The home is wrong on
// purpose, and deliberately not fixed here - moving it is the themes subsystem's work, not a
// template's, and the template is where it can be correct today.
#set list(marker: ([\u{2022}], [\u{25E6}], [\u{25AA}]))
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
#let run(r) = {
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
// An unknown kind stops the compile, as an unknown mark kind does: a publish failure the author is
// told about is worth more than a block quietly set as nothing.
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
#let contents = if doc.front.contents != none {
  outline(
    title: words(doc.words.contents),
    target: heading.where(outlined: true),
    depth: doc.front.contents.depth,
  )
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
