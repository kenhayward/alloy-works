# 0032 - Word's fidelity to the PDF leaves T1

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

T1 asked Word to be held to the PDF as the editor is. **STY-081** asks every style property both
render to be verified, by an automated suite, at the PDF's value in Word, within STY-080's tolerances;
**PUB-023** asks Word to be a first-class output, which PUB-078 says STY-081's suite keeps so; and
**PUB-092** asks the keep rules - widow and orphan control, keep-with-next, keep-together - to be shown
by the regression corpus holding in each engine's pages, Word's included. The
[W15 plan](../plans/2026-09-29-w15-word-measured.md) set out to close all three in four slices.

W15.1 built the kit and the evidence: `packages/conformance`, the reader and comparison the editor's
suite already used, shared by both suites; the Word check's export-only mode; and a baseline
verification kind, `local-run`, for what only a run on a machine with Word can verify. W15.2 built the
measurement: `apps/worker/src/word-measure.test.ts` sets one fixture under eight themes, has Word export
its own PDF, and compares it with the PDF of the same content by the kit.

**What it measured**, in Word 16.0 build 16.0.20326, 343 to 516 values a theme: 1,673 differences
beyond STY-080's tolerances before any fix. Four fixes on Word's side (the writer's `word/6`: the
theme's paper as Word's page, a fill of `auto` stated where a style has none, a panel's indents at its
padding, a header column's rule written on both sides of its line) brought that to **1,186, every one
of ten kinds**. Every face, weight, posture, colour, underline and fill is exact but the maths face
STY-052 substitutes and twelve table rules' colours; the lengths are not:

| Kind                                                                                          | How many | Largest (pt)                     | Route                                                               |
| --------------------------------------------------------------------------------------------- | -------: | -------------------------------- | ------------------------------------------------------------------- |
| Tables: a cell's text, rules, fill and steps                                                  |      631 | a step 8.12, a rule's place 6.10 | Word's side, a slice of its own                                     |
| Panels: a fill's edges against its text                                                       |      239 | a fill's top 3.66                | Word's side, a slice of its own                                     |
| Where a line set to the centre or the end starts, at sizes Word rounds to half points         |       87 | 2.50                             | W15.3 (the PDF and the editor at half points), or Ken's             |
| A line holding an image, or a run larger than its text, in another face, or raised or lowered |       83 | a step 6.57                      | W15.3: the PDF and the editor take Word's rule (ADR-0014)           |
| A step into or out of a filled paragraph                                                      |       53 | 4.38                             | Word's side, with the panels                                        |
| A list item's number beside text set to the centre or the end                                 |       34 | its end 390.22                   | Ken's: a report under PUB-078, or an entry on STY-060's list        |
| A heading's start after its number                                                            |       23 | 6.25                             | Word's side, open: the suffix Word sets in Arial                    |
| A list item's fill before its text                                                            |       18 | 28.40                            | Ken's, as the number                                                |
| A table's rule Word draws in the colour of the wider rule on its line                         |       12 | colours only                     | Word's side, with the tables                                        |
| The fill above and below the line holding an equation                                         |        6 | its top 4.09                     | Outside STY-081: an equation's height is the maths engine's (W15-H) |

**What closing it would take**: three or four more slices. Two on Word's side, the tables and the
panels, each its own; **W15.3**, in which the PDF and the editor take Word's rule where Word has no
other, a new template version that changes what a publication of the same content prints; W15.4,
Word's pages kept by the keep rules and Cambria Math's coverage judged; and a decision of Ken's on
each of the kinds routed to him. W15.3 is the costly one: it changes what the PDF prints, the output
T1 already holds to its regression corpus and the editor to, in a new template version, so a
publication made after it prints the same content differently from one made before.

Ken decided on 2026-09-29 that W15 stops after W15.2.

## Decision

**Word's fidelity to the PDF leaves T1.** T1's Word output is the one it has: every construct a T1
document holds carried as Word's own structure, opened in Word by the Word check, and measured against
the PDF where Word is, with what is left recorded exactly.

- **STY-081 and PUB-023 move to T2** whole, keeping their identifiers.
- **PUB-092 is split.** **PUB-106**, its PDF half, stays T1: the rules declared by style, passed to
  the PDF's engine as its own, and shown by the regression corpus to hold in the PDF wherever the page
  allows, which the corpus's four keep cases already show. **PUB-107**, its Word half, is T2: the rules
  passed to Word as Word's own and shown holding in Word's own pages. PUB-092 is marked
  `Superseded by PUB-106`, the corpus's rule for a split row, and the change history names both.
- **The measurement stays**, as an exact characterization: each kind held by how many differences it
  holds and the largest of each length, two of them difference by difference, and anything else -
  one more, one fewer, one grown, a difference of no kind - failing. It approves nothing and cites
  nothing. It runs where the Word check runs, behind the same switch, and is re-run whenever the Word
  writer, the theme's projections or the template change, as the Word check is.
- **W15 closes after W15.2.** W15.3 and W15.4 are not started; their routes are recorded for T2.
- **The conformance kit and `local-run` stay.** The kit serves the editor's suite in CI as well as
  Word's; `local-run` is how a baseline verifies a requirement only a machine with Word can, and
  PUB-029, Word output opened in Word as a standing practice, can be verified by it.

## What would change the answer

- **A T1 customer receives Word as their deliverable**, where the Word document rather than the PDF is
  what a reader sees, so Word's pages matching the PDF's styles is the product. Then the two slices on
  Word's side come back into T1 first, since they change nothing the PDF prints.
- **Word closes a kind on its own side cheaply.** A fix found while doing other Word work that takes a
  kind to none is made and the characterization tightened, whatever the tranche; T2 is where the rest
  is owed, not where a fix is forbidden.
- **A Word update moves the numbers.** Word cannot be pinned, and the characterization is exact, so a
  change of Word's build that moves a kind fails the run. That is found, filed and re-measured, never
  tuned away; if Word itself closes a kind, the question of T1 is asked again with the new numbers.

## Consequences

- T1 has no requirement asking Word's rendering to match the PDF's, and none asking Word's pages to keep
  what the styles keep. The Word writer still passes every keep rule to Word as its own
  (`w:keepNext`, `w:keepLines`, `w:widowControl`), which the corpus's keep cases read from the style.
- themes.md claims PUB-106 on the corpus's keep cases, which cite it; STY-081 and PUB-107 stay
  unclaimed, and word-output.md's PUB-023 is T2's.
- **STY-060 and PUB-078 are constraints and keep their rows.** STY-060's Word half - a deviation on
  neither of Word's lists failing - is met when STY-081's suite holds, in T2; the editor's half holds
  now. PUB-078 is met with STY-081.
- **Word's maths face is not judged.** W15.4 would have kept Cambria Math's coverage as data and refused
  a maths character it lacks for Word by name; it is not built, so Word still draws such a character
  from another face, and the report says once for a document setting an equation that its maths face
  was not checked (`maths_coverage_unchecked`). The W15 plan read themes.md's STY-049 claim as partial
  for Word for this reason (W15-K), so themes.md no longer claims STY-049 and names the gap.
- The ADR the W15 plan named for `local-run` (W15-M) is left for when a real run's report has been
  through the gate; this record takes the number it had named.
- A T1 release's baseline carries no `local-run` row for STY-081 or PUB-107. PUB-029 may carry one.
