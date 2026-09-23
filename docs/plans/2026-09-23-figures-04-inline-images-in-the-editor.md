# Figures 4: Inline images in the editor

> **A sketch**, built inline and test first, with one final whole-branch review before the pull
> request, as figures 1 to 3 were. It builds component-editor.md's
> [Figures](../design/component-editor.md#figures) for **inline images** - "an image in a run of text
> and in a table cell (CNT-086, CNT-087) ... use the same dialog and the same panel" - over the assets
> [figures 1](2026-09-23-figures-01-assets.md) built and the dialog and panel
> [figures 2](2026-09-23-figures-02-the-figure-in-the-editor.md) built.

**Goal:** an author places an image inside a paragraph - in running text, in a list, in a quotation
or in a table's cell - describes it or marks it decorative, changes how it is described, replaces it
and deletes it; and a component holding one opens for editing rather than for reading only.
Publishing one is still refused by name, `inline_not_publishable`, until figures 5.

**Why two pull requests, not the one decision F-O named.** F-O planned the fourth slice as inline
images in a paragraph and a table cell, published. An image in a cell and one in running text are
one node - an inline `image` in a paragraph, whichever paragraph - so the slice is not cut by where the
image stands but, as figures 2 and 3 were, into the editor and then the publication: each is the size
of those. Figures 5 publishes them.

**Requirements:**

- The editor's tests cite **CNT-086** (an image placed in a table's cell) and **CNT-087** (an image
  placed inline within a run of text), each demonstrated by placing one and storing it.
- **Not cited:** CNT-121 (a named image style) is content-model.md's and the stored shape's; AST-013,
  AST-015 and AST-039 are covered by the figure and not demonstrated again for its inline twin.

## Rulings

- **R1. One node, `image`**: inline, an atom, with the attributes the stored node has - `asset`,
  `imageStyle` (`inline`) and `alternative` - and **no marks**, since the stored node carries none. An
  annotation over text either side of an image is two pieces, as it is over any break in its run.
- **R2. Where it may stand**: a **paragraph**, which now holds `(text | image)*`, wherever the
  paragraph is. Not a term, an attribution, a table's caption, a figure's caption or preformatted
  text: each keeps `text*`, and a stored image in one still opens the component read-only by name.
- **R3. The mapping** holds an image both ways in a paragraph's runs; `marksWithNoType` names `image`
  unsupported everywhere but a paragraph's content.
- **R4. It is drawn** as an `img` of the asset version's content route, one line high - 1.2 em, the
  height publishing gives an `inline` image - its width from its proportions, with its `alt` as a
  figure's is. A node view marks one that does not load, _An image you may not see_, as a figure's.
- **R5. Commands** in `packages/editor/src/images.ts`: `imageAt` (an image selected whole),
  `insertImage(asset, alternative)` at the cursor in a paragraph, replacing a selection within it,
  `setImageAlternative`, `replaceImageAsset` and `deleteImage`. An own text of spaces alone is
  refused, as a figure's is.
- **R6. The toolbar's Image button**, after Figure, is the page's, as Figure is: it opens the same
  dialog, titled **Image**, and is unavailable wherever an image could not go.
- **R7. The panel** is the figure's panel for an image selected whole, titled **Image**: the same
  three states, **Replace image** and **Delete image**.
- **R8. Copying** within the product keeps an image, through the product's clipboard type, as it keeps
  a figure. A paste from outside still keeps no image.

## What the build and its review changed

- **R1 said an annotation over text either side of an image is two pieces; it is one.** The stored
  model ends an annotation only at text without it (`claimRange`), and `spansOf` already agreed. The
  final review found `marks: ''` did not keep marks off the image - a paragraph decides what its
  children carry - so the image took a mark on the surface that was never stored, and a link changed
  from one side after a reopen changed half. `imagesUnmarked` takes marks off an image, `annotationAt`
  joins across one, and a mark command sees nothing to mark in an image selected whole.
- **Preformatted text declines over a paragraph holding an image**, rather than dropping it; the seeded
  gesture test now starts from a document holding one.
- **The panel says "image" of an image**, and a publish refused for one says "An image in a line of
  text cannot be published yet." rather than naming formatting.
- **A selected image is outlined**, since a browser draws no selection over a replaced element.
- **Not changed:** an image copied out of the product carries no text - its plain text is nothing, its
  HTML a relative address another program cannot load. Giving it a `leafText` would make `spansOf`
  and the stored model disagree about where an annotation ends; what an image should paste as in
  another program waits for export.

## Tasks

1. **`packages/editor`**: the node and the mapping (R1 to R4), the commands (R5), the node view, and
   the clipboard (R8). Tests cite **CNT-086** and **CNT-087**.
2. **`apps/web`**: the toolbar button, the dialog's title, the panel for an image, and
   `ComponentEditor` wiring.
3. **Docs**: component-editor.md's node table and a note on what building changed, publishing.md's
   F-O note, architecture, features and the README, this plan's status, the version (Minor, 0.59.0)
   and the changelog; trace generate and pins.
