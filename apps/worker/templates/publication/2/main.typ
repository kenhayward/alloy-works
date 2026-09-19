// The publication template, version 2 (docs/design/publishing.md). It reads the published
// document under a layout, `publishing/2`, from data.json as values and evaluates nothing: no
// content reaches Typst as source (ADR-0013, PUB-062). A version is immutable - an edit is a new
// directory, and a test holds each version's hash.
#let doc = json("data.json")
#assert(doc.schema == "publishing/2", message: "data.json is not publishing/2")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }
// The layout's own words, set in the layout's language, which need not be the document's.
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)

#set document(title: doc.title, author: (), keywords: ())
#set text(font: face, size: 11pt, ..language(doc.language), dir: direction(doc.direction))
#set par(justify: false, leading: 0.65em, spacing: 0.9em)
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

#let paragraph(b) = {
  let joined = b.runs.map(r => r.text).join()
  if joined != none { par(joined) }
}

// A node's own heading and blocks take its language and direction where they differ from the
// document's; what it holds takes its own. Its heading is labelled `<n-ID>`, by the node.
#let node(n) = {
  let own = {
    let said = if n.number == none { n.title } else { n.number + " " + n.title }
    [#heading(level: n.depth, said) #label("n-" + n.id)]
    for b in n.blocks {
      if b.type == "paragraph" { paragraph(b) }
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
