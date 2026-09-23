# Figures 5: Publishing inline images

> **A sketch**, built inline and test first, with one final whole-branch review before the pull
> request, as figures 1 to 4 were. It builds publishing.md's [Figures](../design/publishing.md#figures)
> for an image in a run of text and in a table cell - the `inline` image style and the measured
> `box(image(..))` - over the images [figures 4](2026-09-23-figures-04-inline-images-in-the-editor.md)
> lets an author place and the publishing of images [figures 3](2026-09-23-figures-03-publishing-figures.md)
> built. It is the last of the figures slices.

**Goal:** a document holding images in a line of text publishes them: each one line high, its width
from its proportions, tagged as a `Figure` with its alternative text in the language that text is
written in - or, decorative, an artifact - inside the paragraph or the table cell it stands in.

**Requirements:**

- The worker's regression case cites **CNT-086** (an image in a table's cell) and **CNT-087** (an
  image in a run of text), each demonstrated through veraPDF and the file's structure elements - the
  placing the editor's tests already demonstrate, carried into the output.
- **Not cited:** PUB-033, AST-014, AST-015 and AST-039 are figures 3's and hold for an inline image by
  the same code, `alternativeOf`, which this slice does not duplicate.

## Rulings

- **R1. `publishing/8`, template `publication/8`.** `publishing/7` is frozen for template 7's sake, as
  each version before it was. Template 8 is template 7 with an image branch in `run`, and nothing else.
- **R2. A published run may be an image**: `{ image: { path, width, height, alternative } }` beside the
  `{ text, marks }` a run is, wherever runs are published - a paragraph, a term, an attribution, a
  caption. The path and the alternative text are a figure's, by the same functions
  (`publishedImagePath`, `alternativeOf`).
- **R3. Sizing, the `inline` style** (decision F-K): **1.2 em of the body text high**, 13.2 points, and
  the width from the displayed proportions. Wider than the room where it stands is refused,
  `image_too_wide`, naming the block that holds it, as a preformatted line too wide is. In a table's
  cell the room is the cell's share of the measure, less the engine's inset of 5 points each side; any
  other image style is `style_missing`.
- **R4. Refusals** as a figure's, naming the block that holds the image - a paragraph's own, and for a
  term, an attribution or a caption the list's, the quotation's, the table's or the figure's:
  `alternative_missing` (its own text of spaces alone included), `language_not_publishable`,
  `asset_unreadable`.
- **R5. The request resolves an inline image as the publisher**, wherever it stands, as it does a
  figure, and records it; the job fetches it and holds it to its hash as it does a figure's.
- **R6. The template, as measured** (publishing.md, "What the pinned Typst does with an image"): an
  image is `box(image(path, width:, height:, alt:))` inside `text(lang:, region:)` of its alternative
  text's language; a decorative one `pdf.artifact(box(image(..)))`.
- **R7. The web's sentence** for `image_too_wide`: "An image in a line of text is wider than the room it
  stands in. Use a narrower image, or make it a figure."

## What the build changed

- **The language of an inline image's description is not always on its `Figure`.** Measured in the
  regression case: the engine hoists a `/Lang` to an ancestor where that is shorter - a table row whose
  first cell holds a German description declares German once - so the flag's `Figure` declares none
  and is read in German all the same. `readPdf` gains each `Figure`'s `spoken` language, read up the
  tree, and its `parent`, and the test asserts on those.
- **A block is named once** however many of its images the publisher may not read, so an author is not
  told the same sentence twice.
- **The text either side of an image** is compared without its spaces: pdf.js drops the space at the
  edge of a run an image breaks, which the page itself still sets.

## Tasks

1. **`packages/domain`, `assemble`**: `publishing/8` with an image run (R2 to R4), the room in a table's
   cell, `image_too_wide`, `publishing/7` frozen. Tests for the shape, the size, each refusal and the
   room in a cell.
2. **`packages/db`, the request**: inline images resolved and recorded wherever they stand (R5).
3. **`apps/worker`, template 8** (R6), the version maps at 8, and the regression case citing
   **CNT-086** and **CNT-087**.
4. **The contract and the web**: the code, `openapi.json` and the client regenerated, R7's sentence.
5. **Docs**: publishing.md's and component-editor.md's notes, architecture, features, the README,
   CLAUDE.md, this plan's status, the version (Minor, 0.60.0) and the changelog; trace generate and
   pins.
