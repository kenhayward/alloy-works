# Word 4: Equations in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as Words 1 to 3 were. It builds the last of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M), as Word
> 3 left it: equations, and with them Word as a first-class output. Ken agreed the design's
> recommendations on 2026-09-25, and kept Word 3's two refusals on 2026-09-26.
>
> **Built** (PR #PRNUM). [What the build changed](#what-the-build-changed) records where it departed
> from the rulings below.

**Goal:** every equation reaches Word as a native Word equation - OMML built from the same maths tree
the PDF sets, never an image and never a second conversion of the source - inline in any text,
displayed in its own paragraph, numbered by Word beside it in a row of two cells, referenced by a
field, listed after the contents. With it, nothing a T1 document holds is refused for Word but the
three things Word cannot say (a footnote's or a float's relative reference, a caption quoting a
reference by title, and numbering Word cannot compute), and Word is a first-class output.

**Not in this slice:** anything past T1. PUB-028 (review in Word) is T6.

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **PUB-067** (equations native Word equations built from the same structure as the PDF's, never
  images, never a second conversion): the converter over the maths tree, and the writer.
- **CNT-045** (an equation renders on screen, in PDF and in Word from that one representation): with
  the editor's and the PDF's existing tests.
- **PUB-065** (Word carries the content, numbering and cross-references, leaves pagination to Word;
  the record says so): now whole - cite it where one test shows a Word output carrying every kind of
  reference and number with `pages_cite_the_pdf` (the job's test).
- **PUB-023** (Word a first-class output, not a convenience export): cite only where a test shows
  every construct a T1 document can hold reaching Word natively - the whole of Words 1 to 4 - and
  record the argument.
- **PUB-035**: its test extended to equations (Word's own maths reading; no image, no alternative text
  of ours needed).

## Rulings

- **R1. Off `word_not_yet`**: block equations, inline equations wherever the PDF carries them (a
  section's title included), a reference to an equation, and the list of equations. `word_not_yet`
  then refuses nothing; remove it, or keep the code with no constructs - decide and record.
- **R2. The maths tree's refusals, per engine.** `mathsTree`'s refusals (`unreadable`, `error`,
  `rightToLeft`, `scripts`, `offset`, `spanningCell`, `variant`, `element`, `attribute`, `text`,
  `space`, `accent`, `empty`) and `equation_unrenderable`'s reasons: those that are wrong whatever
  sets them stay refused for both; those that are Typst's alone are the PDF's, and **the trap** - for a
  Word-only request the equation stays in the document - where Word sets the construct, measured.
  Where Word cannot set one either, it stays refused for Word by name. Record each reason's ruling.
- **R3. The converter**, `packages/domain/src/word/omml.ts`: every `MathsNode` kind (maths.ts) to
  OMML, as M11 measured - identifiers with their variants (`m:sty`, `m:scr`), numbers, operators, a
  large operator as the base of an `attach` becoming `m:nary` holding **the next sibling in its row as
  its operand**, a named operator with limits as `m:func` with `m:limLow`/`m:limUpp` holding the next
  sibling as its argument, fractions (`noBar` for `stack`), binomials, roots, scripts and prescripts
  (`m:sPre`), accents (`m:acc`), lines (`m:bar`), braces (`m:groupChr` in `m:limLow`/`m:limUpp`),
  fences (`m:d`, empty sides, `mid` as separators), matrices (`m:m` in `m:d`, column alignment),
  cases with `&` alignment points (M11: without them rows centre), aligned multi-line equations
  (`m:eqArr` with `&`), phantoms (`m:phant`), primes as characters, spaces as the space characters
  Word sets; `display`/`inline`/`script`/`sscript` approximated (record how). Pure, tested per node.
- **R4. The writer.** An inline equation an `m:oMath` in its run's place; a displayed one an
  `m:oMathPara` in its own paragraph; `m:mathPr` naming the theme's maths face's Word face (Cambria
  Math) and the display defaults the PDF uses; **a numbered displayed equation** a borderless row of
  two cells (WO-H) - the equation in the wide cell, its number right-aligned in a fixed cell as a
  `SEQ` field prefilled with the numbering table's label, in a hidden bookmark so a `REF` names it -
  the equation's number rule judged by `numbering_not_in_word`'s equation sequence (M3's fields;
  the scheme's equation rules, per matter; a prefix by `STYLEREF n \s`); a reference to an equation
  as Word 3's forms; the list of equations as the lists of figures and tables are. An equation's
  language and its alternative: Word reads its own maths aloud; record what, if anything, the
  alternative becomes (nothing, per the design).
- **R5. The maths face reported.** A document that sets an equation reports `face_substituted` for
  the maths face (STIX Two Math, set in Cambria Math), as the design says.
- **R6. The Word check** gains equations: every construct inline and displayed, a numbered one, one
  too wide (it breaks inside its cell and the number stays right, M17), references to equations and
  the list of equations, each field prefilled wrong first. It checks each equation opens as an `OMath`
  (count), is set in Cambria Math, and the number and references read as the numbering table's after
  an update; it looks at the equations in Word's PDF beside the PDF's.

## What the build changed

Built a task at a time, the Word check (task 4) finding one thing the writer then fixed. What the
design took from it is word-output.md's [What was built](../design/word-output.md#what-was-built),
with a dated note beneath its decisions table and, closing it,
[Word output as it stands](../design/word-output.md#word-output-as-it-stands); what follows is where
the build departed from the rulings above, and why.

**Rulings decided or moved during the build.**

- **R1: `word_not_yet` is kept, producing nothing.** A request refused under it since Word 1 still
  stores its failures and reads them back through the closed code list, so the code, the contract's
  place for it and the web's sentences stay; `assemble` names nothing with it now.
- **R2: every `equation_unrenderable` reason is refused for both formats**, none taking the trap. A
  refusal is the absence of a maths tree, and Word is written from the tree alone (PUB-067), so a
  refused equation has nothing for Word to set, whatever Word itself could draw; the reasons Word 1
  had made the PDF's own - `element`, `text`, `space`, `rtl`, `multiscripts`, `voffset`,
  `spanningCell`, `accent`, `mathvariant` and `attribute` - are said for every format, each ruled on
  in the design. `alternative_missing` stays for every format, since the published document drops an
  equation without one, and `math_glyph_missing` is still judged against STIX Two Math, since the
  worker cannot ask Cambria Math's coverage.
- **R4's equation number restarts at a matter's first equation**: `\s 1` on it where the scheme's
  rule never restarts, since the scheme counts each matter on counters of its own and Word's one
  `SEQ Equation` counts through them all; measured in Word, _Equation i_, _1_ to _3_ and _A.1_ from
  fields prefilled "9". A matter entered a second time whose count carries on is refused, `restart`.
- **R3's "next sibling" is the next node of a spliced row**, a group's nodes read as the row's own,
  spaces before the operand kept inside it, a bracket taken to its match and an operator taken with
  what it takes; read literally, `\sin x` gave `\sin` its own space as its argument. **A large
  operator is known by its character** as well as by the tree's `large`, since Temml never marks
  one. `script` and `sscript` state sizes from Cambria Math's own script scales, and a negative space
  is dropped, Word having none.
- **Text in an equation is set in the maths face** (the ledger's ruling, correcting the design's
  table): an `m:nor` run names the maths face's Word face, since Word sets one that names none in the
  body face.
- **R4 gained two measured fixes and a third found by the Word check.** An equation alone in its
  paragraph has a zero-width space before it, or Word displays it; the numbered row's cells turn
  contextual spacing off where their style asks for it, or Word drops the equation's space facing the
  label and lifts the label off its line; and every maths run in a bold style states bold off, or Word
  bolds a heading's equation as it saves. The row's space stands on both its cells, not after it as a
  table's does, and its label is template 13's _Equation 1_, not M17's _(1)_, in a cell as wide as the
  label and an em, the equation's paragraph standing in by the same width.
- **R6's number place is read from Word's PDF**, not COM, whose horizontal reading is Word's layout
  grid, 11pt from where Word draws the text.
- **The citations moved as planned, and CNT-045 has two.** PUB-067 on the converter's and the
  writer's tests; CNT-045 on the editor's test, retitled, for the screen, and the worker's for the PDF
  and Word from one tree; PUB-065 on the job's test; PUB-023 on the worker's everything document; and
  PUB-035's test extended to equations. The design records the arguments for PUB-023 and PUB-035, with
  what Word has no structure for: a numbered equation read as a one-row table, and quotations,
  preformatted text and quoted phrases as styles. The citations pin moved from 331 to 337.
- **`WORD_WRITER_VERSION` is `word/4`**, since the writer now writes equations `word/3` refused.

**What Word showed**, and the design records: a sum's limits in a line beside it; a too-wide numbered
equation broken inside its cell where the PDF runs past the page; two numbered equations in a row read
as one table of two rows; an equation array in a line centred on it; and a running head's equation
printed as linear text.

**Left**: word-output.md's "Left, for anyone after T1" - nothing of WO-M, the open questions and the
cases measured only as XML.

## Tasks

1. **`assemble`** (`packages/domain`): R1, R2, and `numbering_not_in_word` for equations.
2. **The converter** (`packages/domain/src/word/omml.ts`): R3.
3. **The writer** (`packages/domain/src/word/`): R4, R5, with the worker's `word.test.ts` extended.
4. **The Word check** (`apps/worker`): R6, one recorded run; PUB-035's test extended; PUB-065 and
   PUB-023 decided.
5. **Docs**: word-output.md's "What was built" for Word 4 and the whole design's close (what Word
   output is now, as built), publishing.md, architecture, features and the README, CLAUDE.md's status,
   this plan's status and the T1 remainder plan's W3 row, the writer's version (`word/4`), the version
   (Minor, 0.73.0) and the changelog; trace generate and pins.
