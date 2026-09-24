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

## Tasks

1. **`packages/domain`, the tree**: R2, with the domain's `Face` gaining `math`.
2. **`packages/domain`, the publish**: R3 to R5, R7 and R8 - `publishing/11`, the checks, the failures,
   `assemble`, the references; the contract and the client regenerated.
3. **`apps/worker`**: R1, R6 and R9 - the face, template 11, the pins, and the regression test.
4. **`apps/web`**: R5's sentences and R7's dialog offering equations.
5. **Docs**: publishing.md's and component-editor.md's what-was-built, architecture, features and the
   README, CLAUDE.md's status, this plan's status, the version (Minor, 0.66.0) and the changelog; trace
   generate and pins.
