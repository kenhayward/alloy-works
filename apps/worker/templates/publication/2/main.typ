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
// The page the layout declares (PUB-007), in points and in the portrait sense, turned where it is
// landscape. The gutter widens the inside margin, which alternates with the outside from page to page
// about the binding edge. No page is numbered until its matter says how (PUB-009), and the notice is
// all the template prints in the page's margins.
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
  header: notice,
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
// document's; what it holds takes its own.
#let node(n) = {
  let own = {
    heading(level: n.depth, if n.number == none { n.title } else { n.number + " " + n.title })
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
// page, which has no number (decision J). `assemble` publishes nothing with neither a cover nor a node
// (decision K), so the title is set once whichever opens the document.
#if doc.front.cover or doc.nodes.len() == 0 {
  opening
}

// Segments: consecutive top-level nodes of one matter. Every change of matter starts a page, since
// a page's numbering is the page's own (decision J).
#let segments = doc.nodes.fold((), (acc, n) => {
  if acc.len() > 0 and acc.last().matter == n.matter {
    acc.at(-1).nodes.push(n)
    acc
  } else {
    acc.push((matter: n.matter, nodes: (n,)))
    acc
  }
})

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
  set page(numbering: s.pattern)
  if s.start == "restart" {
    counter(page).update(1)
  } else if s.start == "resume" {
    context counter(page).update(last-in(s.chain).get() + 1)
  }
  // Without a cover, the title and the notice's sentence open the first page.
  if i == 0 and not doc.front.cover { opening }
  for n in s.nodes { node(n) }
  context last-in(s.chain).update(counter(page).get().first())
}
