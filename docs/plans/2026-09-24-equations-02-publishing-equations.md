# Equations 2: Publishing equations

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as equations 1 was. It builds publishing.md's [Equations](../design/publishing.md#equations)
> decisions EQ-A, EQ-B, EQ-E, EQ-F and EQ-G's publishing: the second of EQ-H's pull requests.

**Goal:** a publish sets every equation a component holds - in running text, a list, a quotation, a
table's cell, a footnote, a caption, and a section's title where one is stored - in STIX Two Math,
built from the maths tree and never from source, tagged as a formula carrying its alternative in its
own language; a numbered block equation carries `number`'s label beside it, can be the target of a
cross-reference, and is listed after the contents where the layout declares a list of equations. An
equation the converter cannot set, one with no alternative, or one holding a character the maths face
lacks, fails the publish by name.

**Not in this slice:** Word's OMML (with Word output); making an equation in a section's title
(equations 3 - one stored there is published); a maths face on screen; the default layout declaring
a list of equations (it lists figures and tables; a layout that declares one gets one).

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **CNT-049** (an equation that cannot be rendered fails the publish, never source text or a blank):
  each refusal of the converter failing the publish by name, before either writer runs.
- **PUB-038** (lists of figures, tables and equations generatable): a publish whose layout declares
  all three, each listed and linked, read back from the PDF.
- **CNT-080** (reachable and readable by assistive technology through its alternative), the PDF half:
  each equation a `Formula` carrying its `/Alt`, in its language. Equations 1 cited the editor's half;
  cited here only if the test shows the PDF's whole.
- **Not cited:** CNT-045 (Word is missing), CNT-046 (the title cannot be made until equations 3),
  PUB-062 (already covered; the injection test here demonstrates it again but need not cite),
  STY-049 (its other typefaces are the theme's, which does not exist yet).

## Rulings

- **R1. The maths face** (EQ-A): STIX Two Math 2.13 b171, from its tagged source, committed under
  `apps/worker/fonts/` beside the Liberation faces with its licence, pinned by hash as a `math` face in
  `PINNED_FONT_FILES` and the domain's `Face`; named by the worker at start and in every publication's
  record, as the others are.
- **R2. The maths tree** (EQ-B), one converter in `packages/domain`, pure: the stored MathML (read by
  the strict reader) to a tree of the kinds the spike's template function reads - rows, identifiers
  with their variant by MathML Core's rule, numbers, operators (large, fences, a stretchy middle),
  named operators with limits, text, space, fractions and stacks and binomials, roots, scripts in
  their three modes, accents, lines, braces, fences, matrices, cases, aligned rows, primes, phantoms,
  display and inline style. It refuses, naming the construct: `merror`, right-to-left maths, more than
  one pair of scripts on a side, a vertical offset, a spanning cell, an unknown `mathvariant`, and any
  element or attribute the mapping does not know. The alternative is read from `alttext`.
- **R3. Its characters are checked** against the maths face before the engine starts (STY-049's
  rule, as a paragraph's are against Liberation Serif), with the engine's fallback off for maths: one
  the face lacks fails `glyph_missing`, naming the block. Text inside maths (`mtext`) is checked the
  same way.
- **R4. The published document** (`publishing/11`): an equation run - its tree, its alternative and
  the alternative's language - beside text, an image, a footnote and a reference; and an equation
  block of type `equation` with its `id`, `anchor`, tree, alternative, language and `label`, which is
  `number`'s and null where unnumbered. `publishing/10` is frozen.
- **R5. Failures**: `equation_unrenderable` joins the codes, naming the block (an inline equation's
  block is the block it stands in) and the construct in `detail`, never the equation's text. An
  equation with no alternative fails `alternative_missing`, as an image does. A numbered equation the
  scheme gives no number fails as an unnumbered footnote does. Every reason is collected. The refusals
  of equations 1 (`block_not_publishable` and `inline_not_publishable` with detail `equation`) go, and
  the publishing page's sentences with them; the contract and the client are regenerated.
- **R6. The template, version 11** (EQ-A, EQ-E, EQ-F): template 10 plus a show rule setting maths in
  STIX Two Math with the fallback off; the spike's tree function, with its primes and cases fixes; an
  equation always with its `alt`, under `text(lang:)` where its language differs; a numbered block
  equation as a `figure` of kind `equation` - no supplement, no numbering of its own, its caption the
  label - with a show rule placing the caption's body right and centred, and its anchor on the
  figure; an unnumbered block equation as a block alone; and the list of equations by `outline` over
  that figure kind, as figures and tables are. Nothing is evaluated: every symbol is a string handed
  to `symbol()` or `text`. `TEMPLATE_READING` and `PUBLISHING_SCHEMA_CURRENT` move as cross-references
  2 set them up; `PIPELINE_VERSION` is `11`.
- **R7. A cross-reference to an equation**: `ReferenceKind` gains `equation` - number, page and
  relative, no title - resolved from the equation sequence's numbering entries as a table's is, its
  anchor on the equation's figure; the Reference dialog offers numbered block equations.
- **R8. The list of equations**: `assemble` publishes a list for the `equation` sequence where the layout
  declares it and it has an entry, as for figures and tables.
- **R9. The regression**: a worker test compiling equations in every context - running text, a list, a
  quotation, a table's body cell and header row repeated across pages, a footnote, both captions with
  their lists, a section's title with the contents and a running head - numbered and not, with the
  spike's constructs and its injection strings, a cross-reference and a page reference to a numbered
  equation, and all three lists; checked by veraPDF and read back: a `Formula` with `/Alt` each, the
  number after the formula, the injection strings printed literally, each list entry linking to its
  equation's page.

## What the build changed

- **R1's face is the spike's file**: `STIXTwoMath-Regular.otf` from the tag `v2.13b171` of
  stipub/stixfonts, 838,652 bytes, SHA-256 `3a5f3f26...518e8c`, with the tag's `OFL.txt` beside it as
  `LICENSE-STIX.txt`. It is the last row of `PINNED_FONT_FILES`, face `math`, so the start log and every
  publication's record name it with nothing else changed. It is the first pinned face with characters
  beyond U+FFFF - over 900 of them, the mathematical alphanumerics - which `cmap.ts` already read.
- **STIX Two Math covers much of the private-use area from U+E000.** Two worker tests used U+E000 as a
  character no pinned face holds, to make the engine refuse a document; with the maths face in the font
  folder the engine set it from STIX instead, and both now use U+F8FF, which no pinned face covers.
- **Template 11 turns the body text's fallback off too**, which the plan did not say. Until this slice
  the fallback could reach only Liberation Mono, a subset of Serif, so it never set anything; with STIX
  in the folder it set a paragraph's character Liberation Serif lacks from the maths face, while
  `assemble` - asking the body face - refused it, and the regression corpus's character probes, which
  hold `assemble`'s verdict to the engine's, went red. With the fallback off the engine refuses exactly
  the set it did. Templates 1 to 10 keep theirs, being immutable; template 1 still serves a request made
  before layouts, where `assemble`'s check against the body face stands in front of it, but the engine
  alone would now set such a character.
- **R2's tree has exactly the spike's final function's kinds**, `raise` gone with it, and refuses more
  than R2 names. **`\scriptstyle` and `\scriptscriptstyle` are refused** - any `scriptlevel` but 0, or
  one without `displaystyle` beside it - since the tree has no kind for them and adding one departs
  from the spike. **A column whose cells resolve to two alignments is refused**, as the tree gives a
  column one; Temml never writes one. So is an element standing where it cannot or with the wrong number
  of children, an attribute value with no mapping, text directly inside an element that is not a token,
  and MathML the reader cannot read. The converter keeps an allowlist of its own rather than gating on
  the reader's, so a later widening of the reader cannot reach the template unmapped.
- **Some of what MathML asks is accepted and not set**, rather than refused: `minsize` and `maxsize`
  on an operator, so `\big(` and its kin print at their normal size, since Temml writes every `\big`
  that way and refusing it would make each unpublishable; `mpadded`'s width, height, depth and
  `lspace`, so `\mathrlap`, `\smash` and `\hphantom` take their content's room; `mspace`'s height and
  depth, so a strut does nothing; and `intent` and `arg`. A `voffset` of zero moves nothing and is
  accepted. An overline is told from a bar by `stretchy`, not by the spike's size rule;
  `accent="false"` is respected; primes are a kind of their own; and a matrix and cases carry an
  alignment per column.
- **R5's `detail` comes from a fixed list**, `REFUSAL_NAMES` in `assemble.ts`, keyed by the converter's
  reason so a new reason fails to compile until it is named: `unreadable`, `merror`, `rtl`,
  `multiscripts`, `voffset`, `spanningCell`, `mathvariant`, `element`, `attribute` and `text`. The
  element's name and the attribute's value are never carried: an author can reach them through a
  paste, and `detail` must never carry the equation. Every reason is collected - unrenderable,
  alternative missing, each missing character, unnumbered, then the label's characters - once per
  block, except that MathML the reader cannot read says only that.
- **Two codes are new, not one.** A numbered equation the scheme gives no number fails
  `equation_unnumbered`, beside `footnote_unnumbered`, whose words are a footnote's; codes are never
  renamed, so a general code could not replace it. **R3's `glyph_missing` became `math_glyph_missing`**
  (Ken's ruling), named apart as `code_glyph_missing` is: the body face may well have the character,
  and _in no typeface this publication can use_ would be untrue. The check reads the strings the tree
  sets - identifiers, numbers, operators, text, an accent, a fence - not the MathML; what the template
  draws itself (a radical, a brace, a prime, cases' brace) is not asked, and a worker test holds the
  face to having each.
- **R4's section title is runs** - `PublishedTitleRun[]`, text and equations, where it was a string -
  so an equation stored in a section's title is published in its heading and, from there, in the
  contents, the running heads and the bookmarks, where the engine flattens it to its glyphs (EQ-G). A
  mark in a title is still refused. `publishing/1` is unchanged byte for byte, and a request made
  before layouts still refuses a title's equation, `title_not_publishable` with the detail `equation`.
  Its failures name the section node, with no block.
- **A title form of a target whose title or caption holds an equation fails**,
  `cross_reference_form_unavailable` naming the form, and its number still prints: a reference prints
  a title as text, and dropping the equation would print words the author did not write. Refusing is
  the direction that can be undone.
- **R6 aligns a column with an alignment point in each cell**, not `mat(align:)`, which takes one
  alignment for the whole matrix and refuses a list - measured. A point after a cell aligns its column
  right, one before it left, none centres it. **Cases are a matrix too**,
  `mat(delim: ("{", none), column-gap: 1em)`, since `math.cases` ignores the points; rendered beside
  the spike's cases it is indistinguishable where the columns are left, as Temml's always are. Aligned
  rows keep the spike's multi-line form only where the table is bare, in display style and its columns
  alternate right and left - what a multi-line equation's points give - since as a matrix the gap fell
  before the relation.
- **A numbered equation keeps room for its number, and its number drops below where it cannot**, as
  amsmath does. The inset alone moves nothing: insetting both sides by the number's width and a gap
  leaves less room than the number needed on one, so every equation that would have met its number
  overflows the inset too, centred, and its right edge lands under the number where it did before -
  worked through and then measured. So where the equation fits the line less that room on each side it
  is centred there with the number placed in the room on the right, and where it does not, the number
  is placed on a line of its own beneath it, at the right. Placed, not aligned: aligned, it was tagged
  a `P`, where it must be the `Span` after the `Formula`. In a list or a quotation the measure is
  narrower, so the number drops sooner there. The regression holds every number's box clear of its
  equation's, and the injection strings' identifier block is numbered again, as the wide case.
- **The width gap is open.** A block equation wider than its line still runs past the margins,
  numbered or not, and an inline one past its line; nothing measures a tree's width, and nothing
  refuses either. `line_too_wide`'s pattern would answer it, and it is not in this slice.
- **An equation's `/Lang` comes from its container.** The template wraps every equation in its
  alternative's language, as it does an inline image, but `assemble` always gives an alternative the
  language of the text it stands in, which the node already sets: so the engine declares no `/Lang` on
  the `Formula`, and a German one is read as German from its paragraph or its figure's `Div`. The
  regression reads the language a reader is told, inherited. A `Formula` carrying its own waits for an
  alternative that can be in another language than its text.
- **R7's dialog offers only a numbered equation**, in a document and on its own (`ownTargets` skips
  one left unnumbered, as `documentTargets` does): an unnumbered equation has no number and no title,
  so it could be offered only as a page or a position. A reference stored to one still resolves, its
  anchor on the equation itself. The editor names an equation it cannot yet number _Equation_, where it
  said _Paragraph_.
- **R8 needed nothing**: `front.lists` was already general, and `equation` a listed sequence since
  tables 2.
- **The publishing page's sentences**: one per construct for `equation_unrenderable` - an unreadable
  equation, an error mark, maths right to left, more than one pre- or postscript on a side, a raised or
  lowered box, a spanning cell - and one for the rest, _something the typesetter cannot set_, each ending
  _Open it and rewrite it, or delete it._; `equation_unnumbered` worded as `footnote_unnumbered` is;
  `math_glyph_missing` naming the maths typeface; `alternative_missing` now naming an equation with no
  alternative beside an image with no description; and the title forms' sentences naming an equation,
  and a section or caption holding one. The two sentences equations 1 left are reachable only from a
  request made before layouts, and say so as the cross-reference one does: _An equation cannot be
  published from this request. Publish again._
- **Compile time**, the pinned Typst run directly, median of seven: template 11 costs about 1 ms on a
  document with no equation, and forty formulas about 10 ms, about 0.25 ms each; keeping room for the
  number adds about 5 ms to the regression document. The worker also hashes and copies 839 kB more per
  compile. PUB-085 stays unclaimed.
- **Citations**: CNT-049 in `packages/domain`'s `assemble.test.ts`, every refusal of the converter
  failing the publish by name; CNT-080's PDF half and PUB-038 in `apps/worker`'s `equations.test.ts`,
  every equation a `Formula` with its `/Alt` in the language a reader is told, and the three lists read
  back and linked. PUB-038 was claimed by publishing.md and uncited until now, since no list of equations
  could be published. The citations pin moves from 282 to 285.

## Tasks

1. **`packages/domain`, the tree**: R2, with the domain's `Face` gaining `math`.
2. **`packages/domain`, the publish**: R3 to R5, R7 and R8 - `publishing/11`, the checks, the failures,
   `assemble`, the references; the contract and the client regenerated.
3. **`apps/worker`**: R1, R6 and R9 - the face, template 11, the pins, and the regression test.
4. **`apps/web`**: R5's sentences and R7's dialog offering equations.
5. **Docs**: publishing.md's and component-editor.md's what-was-built, architecture, features and the
   README, CLAUDE.md's status, this plan's status, the version (Minor, 0.66.0) and the changelog; trace
   generate and pins.
