// The publication template, version 1 (docs/design/publishing.md). It reads the published
// document from data.json as values and evaluates nothing: no content reaches Typst as source
// (ADR-0013, PUB-062). A version is immutable - an edit is a new directory, and a test holds each
// version's hash.
#let doc = json("data.json")
#assert(doc.schema == "publishing/1", message: "data.json is not publishing/1")

#let face = "Liberation Serif"
#let language(of) = (lang: of.lang, region: of.region)
#let direction(of) = if of == "rtl" { rtl } else { ltr }

#set document(title: doc.title, author: (), keywords: ())
#set text(font: face, size: 11pt, ..language(doc.language), dir: direction(doc.direction))
#set par(justify: false, leading: 0.65em, spacing: 0.9em)
// Every page carries the status in its header, where no layout can remove it. Typst marks a
// header as a pagination artifact, which assistive technology does not read, so the notice is
// also set once as tagged text below. Its words are the data's - DRAFT_NOTICE in packages/domain,
// carried by assemble - in English, and set as English whatever the document's language.
#set page(
  paper: "a4",
  margin: (x: 2.5cm, y: 2.5cm),
  header: align(end, text(size: 9pt, lang: "en", region: none, dir: ltr, doc.notice.page)),
)
// Numbers are the publisher's (`number`), set as text; Typst numbers nothing.
#set heading(numbering: none)
#show heading: set text(weight: "bold")
#show heading: it => block(above: 1.4em, below: 0.8em, sticky: true, it)
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 2): set text(size: 13pt)

#let paragraph(b) = {
  let words = b.runs.map(r => r.text).join()
  if words != none { par(words) }
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
// document's sections; the PDF's own title is `set document` above.
#heading(level: 1, outlined: false, bookmarked: false, doc.title)
#par(text(lang: "en", region: none, dir: ltr, weight: "bold", doc.notice.text))

#for n in doc.nodes { node(n) }
