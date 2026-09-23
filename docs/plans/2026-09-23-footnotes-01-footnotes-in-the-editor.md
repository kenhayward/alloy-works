# Footnotes 1: Footnotes and the table's note in the editor

> **A sketch**, built inline and test first, with one final whole-branch review before the pull
> request, as the figures slices were. It builds publishing.md's
> [Footnotes](../design/publishing.md#footnotes) decisions FN-A, FN-B, FN-C and FN-E, and
> component-editor.md's [Tables and footnotes](../design/component-editor.md#tables-and-footnotes), in
> the editor: the first of FN-F's two pull requests.

**Goal:** an author places a footnote at the cursor in a paragraph - in running text, a list's item, a
quotation or a table's cell - from the toolbar or with `Ctrl+Alt+F`, writes its paragraphs in an editor
opened beneath the text, formats them, and deletes the footnote by deleting its mark; and adds a note
to a table, writes it beneath the table and removes it, from the Table panel. A component holding a
footnote in a paragraph opens for editing rather than for reading only. Publishing either is refused
by name until footnotes 2.

**Not in this slice** (FN-A, and Ken on 2026-09-23): key columns, and a footnote anchored to a cell by
key or by position. One stored that way is opened and saved as it was stored; nothing makes one.

**Requirements:**

- The editor's tests cite **CNT-036** (a footnote anchored to a span of text), demonstrated by placing
  one at the cursor and storing it anchored to its span, and **CNT-038** (a note on a table as a whole,
  FN-C), demonstrated by adding a table's note, typing into it and storing it.
- **Not cited:** CNT-026 and CNT-129 are the content model's and are covered there; the editor holds
  both, and demonstrating them again would claim what content-model.md already answers. CNT-041 is the
  outline's, CNT-042 and PUB-016 are footnotes 2's, and CNT-037 and CNT-107 wait for key columns.

## Rulings

- **R1. Three nodes.** `footnote`: inline, an atom, with `id` and `anchor` - the stored anchor, kept
  whatever its kind, `{ kind: 'span' }` for one the editor makes - and content `footnoteParagraph+`.
  `footnoteParagraph`: a textblock of `text*` with every mark, `id` and `style`, outside the `block`
  group, so nothing but a footnote holds one. `tableNote`: `text*` with every mark, the optional last
  child of `tableFigure` (`tableCaption table tableNote?`), which loses its `note` attribute. The
  restriction is structural (FN-E): no image, footnote, list or table can be placed in a footnote,
  because nothing in its content expression admits one.
- **R2. Where a footnote stands** (FN-B): a `paragraph`, which now holds `(text | image | footnote)*`.
  The mapping names a footnote unsupported in every other inline home - a term, an attribution, a
  caption, a table's note - so a component holding one there opens read-only, naming it, as an image
  does. Inside a footnote's paragraphs, whatever the editor has no node or mark for is named too.
- **R3. The mapping** holds a footnote both ways: stored paragraphs become `footnoteParagraph`s and
  back, with their identifiers and styles, and a stored table's note becomes a `tableNote`. A note of
  no text is stored as none, as an attribution is, and reopens as none.
- **R4. A footnote and an image carry no marks**, and neither breaks an annotation: `imagesUnmarked`
  and `marksPastImages` take in the footnote, and take a mark off the node itself
  (`removeNodeMark`) rather than over its range, which would reach the footnote's text.
- **R5. A footnote's text is a range of its own** (the stored model's `claimRange`). `spansOf` walks a
  footnote's paragraphs as a separate range, and the outer range carries on across its mark, so an
  annotation either side of a footnote stays one annotation. `annotationsInOnePiece` renames a piece
  text node by text node, never over a range, which would mark the footnote's text. A mark applied,
  changed or taken off over a range holding a footnote leaves the footnote's text as it was
  (`sparingFootnotes`), and `markThroughout` and `markAt` read past it.
- **R6. Identity and adjacency reach inside** (FN-E): a footnote and its paragraphs carry identifiers,
  allocated as a block's are, unique across the component; two adjacent empty paragraphs are
  refused in a footnote as anywhere else, and `Enter` in an empty footnote paragraph does nothing.
- **R7. Commands** in `packages/editor/src/footnotes.ts`: `insertFootnote(newIdentifier)` places a
  footnote with one empty paragraph at the selection's end in a paragraph, leaving what is selected in
  place, and selects it whole; `footnoteAt(state)` answers the footnote selected whole. **Footnote**
  is a registry command like **Table** - `kind: 'block'`, action `footnote`, `Mod-Alt-f`, said
  "Ctrl or Cmd, Alt and F" - so its button and its shortcut cannot drift. Deleting the mark deletes
  the footnote, and `Ctrl+Z` brings it back whole.
- **R8. The footnote's editor** (FN-E), `footnoteView` in `packages/editor/src/footnoteView.ts`: the
  mark is a small raised marker with no number, named _Footnote_ to a screen reader. Selected whole,
  it opens a nested `EditorView` over the node's own content, beneath the paragraph, named
  _Footnote text_. `Enter` on the selected mark puts the focus in it, and so does placing a footnote;
  `Escape` puts the focus back on the mark. Its transactions are mapped into the component's, so
  identity, adjacency and the annotation repair run over them and the component's one history holds
  them: `Ctrl+Z` and `Ctrl+Y` in it undo and redo the component. It is editable exactly while the
  component is. `openFootnote(view)` answers the nested editor open in a surface, or null.
- **R9. The toolbar and the prompts act on the open footnote.** While a footnote's editor is open, the
  toolbar, a prompting shortcut and **Paste as Markdown** act on its text: the nine marks and links
  apply there, and every other button is unavailable, because each is asked of the footnote's own
  state and nothing else fits there. The panels still read the component's selection.
- **R10. A paste into a footnote goes through admission** as every paste does (`pasteInto`):
  what arrives must be paragraphs of runs, which become the footnote's paragraphs; a list, a table,
  an image or a footnote is refused, and the paste report says what was not placed. A drop is
  refused, as it is in the component.
- **R11. The table's note** (FN-C): **Add note** and **Remove note** in the Table panel, each
  unavailable where it would do nothing. Adding one puts the cursor in it; it is typed beneath the
  table with a placeholder, _Note_; `Enter` in it leaves the table for a paragraph after it, as an
  attribution does; it is isolating, so `Backspace` at its start never reaches into the table.
- **R12. Publishing refuses both by name until footnotes 2**: a footnote as it is already refused,
  `inline_not_publishable` with the detail `footnote`, and now a table's note too, with the detail
  `note`, rather than publishing the table without it. The publishing page says _A footnote cannot be
  published yet._ and _A table's note cannot be published yet._
- **R13. Read-only rendering** (`renderContent`) shows a footnote's text where its mark stands, in
  brackets and smaller, and a table's note beneath the table, so nothing a component holds is hidden
  from a reader.

## What the build changed

- **R7's undo brings a footnote back whole, under new identifiers.** What an undo puts back is placed,
  and ADR-0023's descent rule names whatever is placed, as it does a block brought back the same way.
  A command's own identifiers are renamed by the identity plugin for the same reason.
- **`Enter` on a footnote selected whole is always taken** (`enterFootnote`): left to the split, it
  replaced the selected footnote with a paragraph break. With a view it puts the focus in the
  footnote's text.
- **R8: a transaction that only moves the footnote's caret is sent on to the surface empty**, kept out
  of the history, so the toolbar reading the footnote's marks hears of it. A change of the same size
  coming back from the surface - an identifier allocated, a mark renamed - keeps the footnote's caret
  where it was rather than mapping it to the end of what was replaced.
- **R10's paste into a footnote is a plain replace of the selection**: `replaceSelection` widened the
  range to where the pasted paragraph would fit, which from inside a footnote was past its edge.
- **A footnote copied within the product pastes as one**, newly named, through the product's clipboard
  and admission's re-identify, as an image does; a test holds it.
- **R13's rendering test passed on its first run**: the `toDOM` it reads came with task 1's schema.

The final whole-branch review found three things and five smaller; these were changed:

- **A mark put on or taken off around a footnote renamed its later paragraphs**: `sparingFootnotes`
  put the footnote's text back with a replace, which the identity plugin read as paragraphs placed
  anew. It now gives each text node back its marks, which moves nothing.
- **A component made read-only still took undo, redo and a paste through an open footnote**: the
  footnote's editor never heard that the surface's props had changed. A plugin view on the surface now
  refreshes it on every update, and the three keys and the paste check the component's own `editable`.
- **A toggled mark could not be taken off a selection holding a footnote or an image**, though its
  button showed it on: `toggleMark` counts either as missing the mark. The toggle now takes it off
  wherever `markThroughout` - the button's own answer - says it is on. Figures 4's inline image had the
  same fault, and is fixed with it.
- **The link and language dialogs named the whole footnote's text**, not the words selected in it; an
  undo from a footnote that closed it left the focus nowhere, and now gives it to the surface; a paste
  over all of a footnote's text warned; and a stored table note of no text was refused at publish, and
  now is not. Architecture's count of block actions is nine.
- **The re-review found the toggle deciding from one cell of a cell selection**: `markThroughout` read
  the selection's first range alone, so Strong over two cells, one bold, took it off both. It now reads
  every range, which also makes the pressed button right over cells.

## Tasks

1. **`packages/editor`, the model half**: the nodes (R1, R2), the mapping (R3), marks and ranges
   (R4, R5), identity and adjacency (R6), the commands and the registry (R7), the note's commands and
   keys (R11), and a paste into a footnote (R10). Node tests, in `packages/editor`, cite **CNT-036**
   and **CNT-038**.
2. **`packages/editor`, the view half**: `footnoteView` and `openFootnote` (R8), its paste and drop
   (R10), `mountEditor`'s node view, and the stylesheet. Tested in `apps/web`, where there is a DOM.
3. **`packages/domain` and the publishing page**: a table's note refused by name, and both sentences
   (R12).
4. **`apps/web`**: the toolbar's target and the Footnote icon (R9), the Table panel's two buttons
   (R11), and **Paste as Markdown** into a footnote; a component holding a footnote opens for editing.
5. **Docs**: component-editor.md's node table and what building changed, publishing.md's note on
   FN-F, architecture, features and the README, this plan's status, the version (Minor, 0.61.0) and
   the changelog; trace generate and pins.
