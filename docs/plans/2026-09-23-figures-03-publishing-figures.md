# Figures 3: Publishing figures

> **A sketch**, built inline and test first, with one final whole-branch review before the pull
> request, as figures 1 and 2 were. It builds publishing.md's [Figures](../design/publishing.md#figures)
> and assets.md's [publisher's half](../design/assets.md#the-publishers-half), the third of the four
> slices [decision F-O](../design/publishing.md#figures) names, over the assets
> [figures 1](2026-09-23-figures-01-assets.md) stored and the figures
> [figures 2](2026-09-23-figures-02-the-figure-in-the-editor.md) lets an author make.

**Goal:** a document whose components hold figures publishes them. The PDF carries each figure:

- sized by `assemble`, so it never runs off its page;
- numbered by the layout's scheme, its caption below it;
- tagged as a `Figure` with its alternative text in the language that text is written in - or, where
  it is decorative, the image an artifact, the caption and number kept (decision F-M).

It also carries a **list of figures** after the contents, before the list of tables (decision F-N). A
figure with no caption, or with no alternative text from itself or its image, is refused by name, and
so is one whose image the publisher may not read. An image in a line of text or a table cell is still
refused until figures 4.

**Requirements:**

- `assemble`'s tests cite **PUB-033** and **AST-014** - publishing fails where neither the figure nor
  its image gives alternative text - demonstrated by the refusal naming the figure.
- The worker's tests cite **AST-015** (decorative, published as an artifact with no `Figure`) and
  **AST-039** (inherited text published in the language it declares), each demonstrated through
  veraPDF and the file's structure elements.
- **Not cited:**
  - PUB-038 asks for lists of equations too, which cannot be published yet - as tables 2 left it.
  - STY-017 is themes.md's resolver's; the fixed `figure` rule here is its behaviour with fixed numbers,
    and publishing.md says so.
  - CNT-017 is covered, and its caption half is what `figure_without_caption` holds, which cites the
    requirement it serves in the refusal's words rather than in a title.

## Rulings

- **R1. `publishing/7`, template `publication/7`.** `publishing/6` is frozen for template 6's sake, as
  each version before it was. Template 7 is template 6 with a figure branch and `figure` among the
  lists, and nothing else.
- **R2. The published figure**:
  - `type: 'figure'`, `id`;
  - `label`: `number`'s label, such as "Figure 1.1", or null where none is given;
  - `caption` as runs;
  - `path`: `assets/<sha256>.<png|jpg>`, from the asset version's key and the extension its format
    declares - the only thing of the asset the template reads;
  - `width` and `height` in points, rounded to hundredths;
  - `alternative`: `{ text, language }` with a published language, or null where decorative.
- **R3. Sizing, the `figure` style** (decision F-K): the width available where the figure stands -
  the text measure less any indent it is inside - and the height from the displayed proportions; where
  that height is over **60 per cent of the text block's height**, that height, and the width from it.
  `textBlockHeight` stands beside `textMeasure` in `measure.ts`. Any other image style is
  `style_missing`, as a paragraph's is.
- **R4. Alternative text, resolved by `assemble`** (PUB-033): `own` in the component's language;
  `inherited` in the language the asset version declares, and `alternative_missing` naming the figure
  where it declares none; `decorative` is null. A language the engine cannot carry is
  `language_not_publishable`, as a run's is.
- **R5. `figure_without_caption`**, naming the figure, when its caption has no words - CNT-017's
  caption, refused at publish and never at save, as a table's is (decision T-F).
- **R6. Assets, resolved at the request as the publisher** (assets.md, "The publisher's half"):
  - `requestPublication` reads the content of each resolved occurrence, finds every figure in it at
    any depth, and decides each asset version by `read` on its asset for the publisher.
  - A readable one is recorded in **`publication_request_asset`**; one the publisher may not read,
    or one naming no asset version, is `asset_unreadable` at the resolve stage, naming the node and
    the figure and never the asset (issue #143's rule).
  - `publicationInputs` hands the job the recorded versions' facts; `assemble` takes them as
    `assets`, and a figure whose asset is absent with no failure recorded is `asset_unreadable` too.
  - `recordPublication` copies them into **`publication_asset`**, so a publication names every image
    it printed. Both tables are insert-only and written only while their request is queued, as 0017's
    are. Migration 0022.
- **R7. The job fetches each image** from the tenant's store, checks its bytes against the hash its key
  names - the check the faces get - and writes it into the compile root at its path. Bytes that do not
  match are a broken store: thrown, retried, then the engine's stage. `compile` takes the files beside
  the template and the data, and the root still holds nothing else (PUB-062).
- **R8. The template, as measured** (publishing.md, "What the pinned Typst does with an image"):
  - a figure is a `figure` of kind `image`, numbering off, the caption **below** with the label set as
    text;
  - the image is `image(path, width:, height:, alt:)` inside `text(lang:, region:)` of its alternative
    text's language, always, so the `Figure` carries its `/Lang`;
  - a decorative image is `pdf.artifact(image(..))` with no alt;
  - `kind-of("figure")` is `image`, so a list of figures is Typst's `outline` over them.
- **R9. The default layout's 0.3** lists **Figures** before **Tables** (decision F-N), inserted by
  migration 0021 only where 0019's own 0.2 is still the latest, with literals `default-layout.test.ts`
  recomputes, as 0019 did.
- **R10. The web's sentences**:
  - `figure_without_caption`: "A figure has no caption. Give it one: the caption names the figure in
    the PDF and to a screen reader."
  - `alternative_missing`: "A figure's image has no description, and the figure is not given one.
    Describe it in the figure's panel, or mark it decorative."
  - `asset_unreadable`: "A figure shows an image you may not see, so you cannot publish it."

## What the build changed

Recorded here as the design documents record them (publishing.md's and assets.md's Figures notes):

- **The template always sets the language around the image** (R8), and the engine writes `/Lang` on
  a `Figure` only where it differs from its parent's: measured, the output is the same as comparing.
- **0018's whole-record check is replaced**, not only extended by triggers, so a publication naming
  fewer images than its request recorded does not commit; a test writes one by hand to show it.
- **`compile` refuses any image path but `assets/<sha256>.<png|jpg>`**, before Typst starts, beside
  the job's hash check.
- **`readPdf` reads each `Figure`'s `/Alt`, `/Lang` and layout box** from the objects, which is
  what shows a tall image kept inside its page's text block.

The final whole-branch review found two things and four smaller; these were changed:

- **A figure's own text of spaces alone publishes as nothing** - refused now as `alternative_missing`,
  held by the PUB-033 test.
- **A long caption ran off the page** - `assemble` now leaves the caption room, shrinking the image,
  and refuses one too long for any image as `caption_too_long` (publishing.md's note says why
  breaking the figure was set aside).
- **The image's path was worked out twice** - `publishedImagePath` is the one rule now.
- **`pdfString`** reads a line continuation and a raw end of line as the PDF standard says.

And these were not, with why:

- **`requestPublication` now reads each resolved component's content**, so a stored version that does
  not read throws at the request rather than in the job. Every stored version was parsed on the way
  in; this cannot happen without a broken store, and failing where it is found is no worse.
- **A panorama of 50,000,000 by 1 pixels prints 0 points high.** Harmless - veraPDF passes it - and an
  author who places one sees a line. A floor would be a design rule, and waits for themes.

## Tasks

1. **`packages/domain` and `packages/db`, the layout.** `defaultLayout` at 0.3 with Figures before
   Tables (R9), `SECOND_DEFAULT_LAYOUT` frozen as 0.2, and migration 0021. Tests: the domain's default
   holds both lists in that order; the row recomputes from `defaultLayout`; a fresh environment's
   default layout is 0.3; one whose layout is its own is left alone.
2. **`packages/domain`, `assemble`.** `publishing/7` with the figure block (R2 to R5), `assets` on its
   input, `textBlockHeight`, the three new failure codes, `publishing/6` frozen. Tests assert the
   shape, the size in each regime, each refusal - citing **PUB-033** and **AST-014** - and that a list
   of figures is published when the layout declares one and a figure has a number.
3. **`packages/db`, the request and the record.** Migration 0022 (R6), `requestPublication` resolving
   assets as the publisher, `publicationInputs` returning them, `recordPublication` recording them.
   Tests: a readable asset is recorded and handed to the job; an unreadable one is refused naming the
   figure and not the asset; a figure inside a list and a quotation is found; the publication names
   its images; a row cannot be added once the request is finished.
4. **`apps/worker`, template 7.** The figure branch and the list (R8), `compile` taking files (R7), the
   job fetching and checking each image, the pipeline version map at 7. A regression case with a
   described figure, one whose text is in another language, a decorative one, one too tall for the
   page and a list of figures, through veraPDF and the structure elements, citing **AST-015** and
   **AST-039**. Template hashes and the literal version maps updated.
5. **The contract and the web.** The three codes in `openapi.json` and the client regenerated, and
   R10's sentences.
6. **The docs.** `docs/architecture.md`, features and the README, publishing.md and assets.md's notes
   on what building changed, component-editor.md's node table, CLAUDE.md, this plan's status, the
   version (Minor, 0.58.0) and the changelog.
