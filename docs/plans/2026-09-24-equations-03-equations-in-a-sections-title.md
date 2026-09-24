# Equations 3: An equation in a section's title

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as equations 1 and 2 were. It builds publishing.md's [Equations](../design/publishing.md#equations)
> EQ-G in the outline: the third of the equations slices, split out of equations 1 because a section's
> title is edited in a plain text field, which cannot hold an equation.

**Goal:** an author retitles a section in the outline panel with words and equations together: the
title field becomes a one-line editor that holds text and inline equations, **Equation** beside it (and
`Mod-Shift-e` in it) opens the equation dialog, and the equation is drawn in the field, in the outline,
and on the document's page, as the publish already sets it. Everywhere a title must be plain text - a
tree's label, a list of documents, an accessible name - the equation is read as its alternative.

**Not in this slice:** a cross-reference or a mark made in a title (a title holding one keeps today's
read-only field and sentence); an equation typed into a new section's title as it is added (added with
words, then retitled); the document's own title.

**Requirements:**

- **CNT-046** (an equation available in every context: running text, a heading, a table cell, a
  footnote and a caption): with the title, every context is made in the editor and set by the publish.
  Cited in a test that places an equation in each of the five contexts the statement names and shows
  each stored - and claimed by component-editor.md, which then answers it whole with publishing.md's
  equations 2. Read it with `pnpm trace show CNT-046` before citing.
- **Not cited:** CNT-045 waits for Word.

## Rulings

- **R1. A title editor** in `packages/editor`: its own small schema - a single line of text and inline
  equations, no marks, no other node - its mapping to and from a section's stored title, and
  `mountTitleEditor(dom, options)` returning a handle to read, replace and destroy it. `Enter` commits
  and never splits; a paste arrives as text on one line (line breaks become spaces); the equation node
  view is equations 1's, drawn the same way, `Enter` on one selected whole opening it in the dialog.
  Undo and redo are the field's own, as a text input's are.
- **R2. The title field** (`OutlinePanel`'s title field) mounts it in place of the text input, for a
  title holding only text and equations; a title holding a mark or a cross-reference keeps the
  read-only field, its sentence saying what it holds. The retitle state machine compares titles by
  their canonical form rather than their words, so a retitle in flight, a refusal, an undo and another
  author's title behave exactly as they do today, equations included - its tests are kept and pass
  over the new field. The store's rule stays: a title must hold text (`hasText`) - an equation alone
  is not a title, and the field says so.
- **R3. Equation beside the field**: a button opening equations 1's `EquationDialog` for the title -
  inline only, the alternative generated in the section's language (the document's, or the section's
  own where it has one), placed at the caret, and committed as a retitle when the dialog places it.
  The dialog is made to take its target from its caller rather than from a component's surface.
- **R4. Titles as text**: `titleText` reads an equation as its alternative wherever a title must be
  plain words - the tree's labels, names in sentences, the documents list, an accessible name - and
  the document's page draws a section's heading with its equations as MathML, as a component's text
  is drawn.

## Tasks

1. **`packages/editor`**: R1, tested in `apps/web` where there is a DOM, as the surface is.
2. **`apps/web`**: R2, R3 and R4 - the field, the dialog's target, `titleText`, the page's headings;
   the CNT-046 test.
3. **Docs**: component-editor.md's claim of CNT-046 and its equation contexts, publishing.md's
   EQ-G, architecture, features and the README, CLAUDE.md's status, this plan's status, the version
   (Minor, 0.67.0) and the changelog; trace generate and pins.
