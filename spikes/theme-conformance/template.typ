// Throwaway. The PDF target for the conformance harness: theme.json from projectTypst, doc.json
// from the fixture, laid out by rules written once here - the shape ADR-0013 prescribes.
//
// Two rules from docs/design/themes.md are implemented here and nowhere else:
//   - A line is exactly one em tall, with its baseline one descender above its foot - the face's
//     own descender, as Word places it - so leading is the rest of the baseline distance (STY-051).
//   - Space between blocks is placed by hand as space after plus space before (STY-050), plus the
//     next block's leading, so its first line has its extra space above it as Word gives it. Weak,
//     so it disappears at the top of a page. With the descender in the edges, no term depends on
//     the block before.

#let theme = json("theme.json")
#let doc = json("doc.json")

#set page(paper: "a4", margin: 25mm, fill: rgb(theme.paper))
#set text(hyphenate: false)
#set par(spacing: 0pt)

#let format(style, marks) = {
  let weight = style.weight
  let posture = style.style
  for mark in marks {
    let m = theme.marks.at(mark)
    if "weight" in m { weight = m.weight }
    if "style" in m { posture = m.style }
  }
  (weight: weight, style: posture)
}

#for (i, b) in doc.blocks.enumerate() {
  let s = theme.styles.at(b.style)
  if i > 0 {
    let prev = theme.styles.at(doc.blocks.at(i - 1).style)
    v((prev.spaceAfter + s.spaceBefore + s.leading) * 1pt, weak: true)
  }
  block(sticky: s.keepWithNext, above: 0pt, below: 0pt, {
    set text(font: s.font, size: s.size * 1pt, fill: rgb(s.fill), weight: s.weight, style: s.style,
             top-edge: (1 - s.descent) * 1em, bottom-edge: -s.descent * 1em)
    set par(
      leading: s.leading * 1pt,
      first-line-indent: (amount: s.firstLineIndent * 1pt, all: true),
    )
    // An explicit paragraph: since Typst 0.13, inline-only content in a block is not one, and
    // first-line-indent silently does nothing to it (leading still applies, which hides it).
    par({
      for (j, line) in b.lines.enumerate() {
        if j > 0 { linebreak() }
        for run in line {
          let f = format(s, run.at("marks", default: ()))
          text(weight: f.weight, style: f.style, run.text)
        }
      }
    })
  })
}
