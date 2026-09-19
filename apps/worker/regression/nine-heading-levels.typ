// Regression corpus: nine heading levels, the depth STR-007 requires an outline to reach, each with
// its number set as text, as the publication template sets them.
#set document(title: "Nine heading levels")
#set text(lang: "en")
#set heading(numbering: none)
#for level in range(1, 10) [
  #heading(level: level)[#level Level #level]
  A paragraph beneath level #level.
]
