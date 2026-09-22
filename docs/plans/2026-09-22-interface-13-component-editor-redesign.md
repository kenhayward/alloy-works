# Interface 13: The component editor, redesigned

> **A sketch, by request**, built inline and test first, after the build order's twelve slices. The
> build order's global constraints bind it. It builds the handoff kept in
> [`docs/interface/handoffs/component-editor/`](../interface/handoffs/component-editor/README.md),
> design 2a, "Editing in place", and it is a first draft for Ken to refine by looking at it.

**Goal:** the editor's chrome above the text shrinks from about 200px to two strips, a 34px title
strip and a 33px row of icons. Every capability stays. The title is said once. And a component in a
document is opened for editing by clicking its text, not by an **Edit** button (Ken's direction with
the handoff).

**Requirements:** none claimed. CNT-068 (the save state in words) and CNT-077 (the toolbar and F6)
keep their tests, which are rewritten to find the same things in their new places.

## Rulings

- **Click to edit.** A card's text in the document is the way in. A click opens the component's
  editor in place, with the caret where the click landed: the character offset under the pointer in
  the rendered text maps to the same offset in the editor's document. A drag that selected text opens
  nothing. The text can be reached with Tab and opened with Enter, with the caret at the start. The
  **Edit** and **Close** buttons go, and **Open** stays in the card's head while it is being read.
- **Done closes the card.** In place, the card head is not rendered while editing, so **Done** is the
  way out. It releases the lock when this author holds one, and then closes. When nothing has been
  typed it just closes. Opening an editor claims nothing, as today: the first keystroke does.
  Standalone, **Done** keeps today's meaning, releasing the lock, and is disabled outside editing.
- **The title stays a heading for assistive technology.** The one visible title is a borderless
  input labelled `Title`. A visually hidden `h2 id="component-title"` still names the article, so
  the page's heading outline keeps the component.
- **Language and direction are chips that open popovers**, holding the existing field and select
  with their existing rules and refusals. A chip's name is `Base language: en-GB` or
  `Base direction: left to right`, so a chip is never mistaken for its field.
- **The save chip has three words:** `Not saved` (`stopped` and `failing`), `Saving` and `Saved`.
  The time of the last save moves into its tooltip, `Saved at 09:41`. Before any save it says
  `Saved`, with no tooltip: the version as opened is saved.
- **The toolbar's labels become the buttons' names** (`aria-label`), with an icon, the label and its
  shortcut in the `title`, and two dividers between marks, lists and blocks.
- **The size moves to a tooltip:** on the section number in place, and on the version and space text
  standalone, where there is no number. The F6 hint line goes.
- **Deferred:** the overflow popover under 700px. The strip wraps instead. So do the RTL mirror and a
  second theme, which the handoff does not design either.

## Tasks

1. **`SaveIndicator`** becomes the chip. Its tests are rewritten, and the CNT-068 citation is kept.
2. **`editor/Icon.tsx`**: the twelve paths and six letterforms from the handoff, keyed by command
   label and by the two acts. **`EditorToolbar`** renders them with `aria-label`, the `title` and the
   dividers. Its test asserts every command has an icon and keeps its name.
3. **`ComponentHeader`**: the title input, the hidden heading, and two chips with popovers.
4. **`ComponentEditor`**: the title strip (number, title, version and space, chips, save chip,
   **Done**, **Save version**), the toolbar row, then the notices, the panels and the surface. It
   gains `number`, `onDone` and `openAt`. The status strip goes, and the tests move to the new
   places.
5. **`editor/caret.ts`**: `textOffsetIn(root, node, offset)` for the rendered text and
   `positionAtTextOffset(doc, offset)` for the editor's document, each unit tested.
6. **`DocumentText`** and **`DocumentPage`**: click or Enter on a card's text opens it, the head goes
   while editing, and **Done** closes it.
7. Docs, the version (Minor) and the changelog.
