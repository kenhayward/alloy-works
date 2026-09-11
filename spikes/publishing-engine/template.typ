// The fixed template. It renders a resolved document from data and never changes per document.
//
// Every string in doc.json arrives here as a value and is set as text. Nothing is evaluated, so no
// content - however much it looks like Typst - can become code. That is the property the whole
// shape exists for, and it is why there is no eval anywhere in this file.

#let doc = json("doc.json")
#let book = doc.layout == "book"

#set document(title: doc.title)
#set page(paper: "a4", margin: (top: 25mm, bottom: 28mm, x: 22mm), numbering: "1")
#set text(font: doc.body_font, size: 11pt, lang: doc.lang, hyphenate: false)
#set par(leading: 0.62em, spacing: 6pt)
#show heading: set text(font: doc.heading_font)
#show heading.where(level: 1): set text(size: 18pt)
#show heading.where(level: 2): set text(size: 14pt)
#show figure.where(kind: table): set figure.caption(position: top)
// Tables may run across pages; an image must never be parted from its caption.
#show figure.where(kind: table): set block(breakable: true)
#show table.cell: set text(size: 9.5pt)
#show footnote.entry: set text(size: 9pt)
#show heading.where(level: 1): it => if book { pagebreak(weak: true); it } else { it }

// Running head: the chapter in force, suppressed on the page a chapter starts.
#let running = context {
  let p = here().page()
  let hs = query(heading.where(level: 1))
  if not hs.any(h => h.location().page() == p) {
    let prev = hs.filter(h => h.location().page() < p)
    if prev.len() > 0 { align(center, text(size: 9pt, prev.last().body)) }
  }
}

// Operators arrive as strings, and a string set in maths is just text: a bare "=" gets no relation
// spacing, an integral stays small with its limits stacked, and a bracket never stretches. Turning
// the character into a symbol gives it everything Typst knows about that character natively -
// class, spacing, display size, stretch - which a hand-kept table of classes did not.
#let limit-ops = ("lim", "max", "min", "sup", "inf", "limsup", "liminf", "det")
#let operator(v) = {
  if v.clusters().len() > 1 { math.op(v, limits: v in limit-ops) } else { symbol(v) }
}

// An equation, assembled from a structural tree. Strings stay strings; nothing is parsed.
#let mathnode(n) = {
  if n.t == "row" { n.c.map(mathnode).join() }
  else if n.t == "lr" { math.lr(n.c.map(mathnode).join()) }
  else if n.t == "i" {
    if n.v.clusters().len() > 1 { operator(n.v) }
    else if n.upright { math.upright(n.v) } else { math.italic(n.v) }
  }
  else if n.t == "n" { math.upright(n.v) }
  else if n.t == "o" { operator(n.v) }
  else if n.t == "text" { math.upright(text(n.v)) }
  else if n.t == "space" { h(0.167em) }
  else if n.t == "frac" { math.frac(mathnode(n.a), mathnode(n.b)) }
  else if n.t == "sqrt" { math.sqrt(mathnode(n.c)) }
  else if n.t == "root" { math.root(mathnode(n.i), mathnode(n.c)) }
  else if n.t == "attach" {
    let base = mathnode(n.base)
    math.attach(
      if n.limits { math.limits(base) } else { base },
      t: if "top" in n { mathnode(n.top) },
      b: if "bottom" in n { mathnode(n.bottom) },
    )
  }
  else { panic("unknown math node " + n.t) }
}

#let inline(parts) = {
  if type(parts) == str { parts } else {
    for p in parts {
      if type(p) == str { p }
      else if p.t == "fn" { footnote(inline(p.parts)) }
      else if p.t == "lang" { text(lang: p.lang, p.text) }
      else if p.t == "math" { math.equation(block: false, alt: p.alt, mathnode(p.tree)) }
      else if p.t == "xref" [#ref(label(p.target)) on #ref(label(p.target), form: "page")]
      else { panic("unknown inline " + p.t) }
    }
  }
}

#let render(b) = {
  if b.t == "h" { heading(level: b.level, inline(b.parts)) }
  else if b.t == "p" { inline(b.parts); parbreak() }
  else if b.t == "ul" { list(..b.items.map(inline)) }
  else if b.t == "eq" {
    math.equation(block: true, numbering: if b.numbered { "(1)" } else { none }, alt: b.alt,
                  mathnode(b.tree))
  }
  else if b.t == "table" {
    figure(caption: inline(b.caption), table(
      columns: b.header.len(), align: left,
      table.header(..b.header.map(h => strong(h))),
      ..b.rows.map(row => row.map(inline)).flatten(),
    ))
  }
  else if b.t == "figure" {
    let f = figure(image(b.src, width: 60mm, alt: b.alt), caption: inline(b.caption))
    if b.id != "" [#f#label(b.id)] else { f }
  }
  else if b.t == "toc" { outline(title: b.title, depth: 2) }
  else if b.t == "lof" { outline(title: b.title, target: figure.where(kind: image)) }
  else if b.t == "refs" { heading(level: 1)[References]; enum(..b.entries) }
  else if b.t == "region" {
    let body = b.blocks.map(render).join()
    if not book { body }
    else if b.kind == "title" { set page(numbering: none, header: none); body }
    else if b.kind == "front" {
      set page(numbering: "i", header: none); counter(page).update(2); body
    }
    else if b.kind == "body" {
      set page(numbering: "1", header: running); counter(page).update(1); body
    }
    else if b.kind == "appendix" {
      set page(numbering: (..n) => "A-" + str(n.pos().first()), header: running)
      counter(page).update(1)
      body
    }
  }
  else { panic("unknown block " + b.t) }
}

#for b in doc.blocks { render(b) }
