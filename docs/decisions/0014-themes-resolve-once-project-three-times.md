# 0014 - Themes: resolve once, project three times

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

A presentation theme has to drive three renderers: the editor's CSS, the fixed Typst template
[ADR-0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md) chose for the PDF, and
Word's styles, which PUB-027 makes visible to a recipient who restyles. STY-035 requires the editor
and the publisher to resolve a style the same way, and STY-N03 forbids a theme being a stylesheet or
code.

[`docs/design/themes.md`](../design/themes.md) proposed a shape and named its riskiest claims: that
space between blocks could mean the same thing in all three, although CSS and Typst take the larger of
two adjoining spaces and Word adds them; that line spacing could be one distance, although "1.15"
means something different in each; and that Word's styles could be made to agree with the others,
although Word has rules of its own. A prototype was built to test them - a resolver and three
projections in `packages/domain/src/theme/`, test-first, and a harness in `spikes/theme-conformance/`
that renders one fixture through Chromium, Typst and LibreOffice and measures every baseline.

The claims held, two of them only after the prototype corrected them:

- **Additive spacing held exactly**: body into quote was 32.00pt in all three.
- **Line spacing as a distance held inside a paragraph, and not between blocks.** Where adjacent line
  spacings differ, each target places the extra space differently. Word puts it above the line; CSS
  splits it. The editor drifted 1.1pt at every change until the rule was stated precisely and the
  face's own metrics were used - after which every baseline agreed within 0.13pt, and the PDF with
  the Word proxy within 0.01pt.
- **Word's styles did not agree by being explicit alone.** Bold and italic are toggles between a
  paragraph style and a character style, so a strong word in a bold heading comes out not bold; and a
  run can name only one character style. A control - the same document with the fix removed - showed
  both failures in the Word-model renderer; with the fix, both are right.

## Decision

**A theme is typed data from a fixed property set. One resolver in `packages/domain` turns it into
fully resolved styles, and three projections translate those and decide nothing.**

- **Resolution happens once.** Inheritance, defaults, applicability, units and references are the
  resolver's; a projection never sees inheritance and never applies a default. The editor and the
  publisher cannot resolve a style differently, because neither resolves one.
- **Where the targets' rules differ, Word's wins**, because Word is the one target that cannot be
  reprogrammed and the one a recipient edits. Space between blocks is space after plus space before
  (STY-050). A line's extra space sits above it, with its baseline one descender above its foot
  (STY-054), and line spacing is the distance between baselines (STY-051).
- **A typeface carries its vertical metrics**, read from the font file on ingest, because placing a
  baseline the way Word does needs them. The CSS projection moves each block's half-leading above
  with padding and takes it back below with a negative margin; the Typst template sets each line's
  edges from the descender.
- **Every Word style states every property**, with `basedOn` kept only for the hierarchy, and **a run
  is pinned directly wherever Word's reading of its styles would differ** from the resolved
  rendering (STY-055) - only there, so restyling still reaches the rest.
- **Agreement is measured, not asserted.** The harness is the seed of the conformance suite STY-053
  requires.

## What would change the answer

- **Word disagreeing with LibreOffice.** LibreOffice is the Word-model renderer the harness could run;
  it implements the toggle rule and matches Word's line placement to a hundredth of a point. Word
  itself has not been measured. If it differs, the Word projection changes and this record does not.
- **A face whose metric tables disagree.** Fonts carry more than one set of vertical metrics, and
  renderers do not all read the same one. Liberation Serif's agree; a face whose do not may need its
  metrics chosen per target, which the conformance suite would show.
- **A house style the property set cannot express** - STY-Q02. The answer is a wider set, each property
  arriving with its three projections and its fixtures.
- **The editor needing to be exact rather than within a fifth of a point.** The editor is not paginated
  and preview is; if authors notice the residual, the CSS projection's rounding is the place to look.

## Consequences

- **Typeface ingestion must read ascent and descent from the font file**, and a typeface without them
  cannot be used.
- **The theme module stays unexported** from the domain package until editor or publishing work
  starts, as the content model draft did.
- **`spikes/theme-conformance/` grows into the conformance suite**: generated property values, more
  faces, the remaining properties - tables, images, admonitions - and, eventually, CI.
- **The Word output must be opened in Word** (PUB-029), and one row of the design is still unverified
  anywhere: what Word needs set to drop space before at the top of a page.
- The design's own first draft of the Word section was wrong about the toggle, and is corrected in
  place with the control that showed it.
