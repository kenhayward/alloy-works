# Word 4: Equations in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as Words 1 to 3 were. It builds the last of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M), as Word
> 3 left it: equations, and with them Word as a first-class output. Ken agreed the design's
> recommendations on 2026-09-25, and kept Word 3's two refusals on 2026-09-26.

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
