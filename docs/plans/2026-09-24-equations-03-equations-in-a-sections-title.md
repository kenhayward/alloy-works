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

## What the build changed

- **The field compares titles by the domain's canonical form.** `canonicaliseTitle`, exported from
  `packages/domain`'s `structure/outline.ts`, is `canonicalJson` over a title with marks as a set -
  what `canonicaliseOutlineNode` now calls for a section's title too, so the field and the outline's
  digest share one rule. The retitle state machine's model title, what it has sent and the held
  retitle are all compared by it, rather than by a stable JSON of the renderer's own: a retitle the
  store would record as no change is one the field treats as nothing new, and the service and the
  editor need not order an equation's members alike. A mutation test showed the words alone are not
  enough - with the comparison switched to `titleText`, another author changing `x^2` to `x^3` under
  the same alternative went unseen.
- **R1 is two files**, `title.ts` - `titleSchema`, `titleToEditor` and `titleFromEditor`, tested in
  Node - and `titleView.ts` - `mountTitleEditor`, tested in `apps/web` where there is a DOM. The
  schema takes `equation` from the component editor's schema spec rather than a copy of it, and
  `titleToEditor` answers null for a mark or any run but text and an equation, which is what keeps a
  read-only field. `Enter`, `Shift+Enter` and `Ctrl+Enter` all commit, or open the dialog over an
  equation selected whole; a paste is `text/plain` only, every line break a space; `replace` starts a
  fresh history, as setting a text input's value resets its undo. **The equation commands were
  generalised rather than copied**: `equationAt`, `equationPlaceable`, `insertEquation` and
  `changeEquation` look their node types up in the state's own schema by name, since a node type of
  one schema matches nothing in another; the component editor's behaviour is unchanged.
- **R3's dialog needed no new prop.** It already took its target from its caller - the current
  equation, whether a block may be placed, a language, and `onDone` - and touched no surface, so only
  its doc comments changed. The outline panel owns it for a title, lazily loaded as the component
  editor's is, with no block offered and **the document's language**: a section carries no language
  of its own in the outline (`values` is unvalidated metadata), so R3's "the section's own where it
  has one" has nothing to read. **Only the outline panel is inert** while the title's dialog is open,
  not the whole document page as the component editor makes its article: the scrim covers the rest
  and the dialog keeps `Tab`, but a screen reader's virtual cursor could reach the page's text.
  Matching the component editor would lift the dialog to `DocumentPage`.
- **An equation-only title is refused and kept in the field**, with _A section's title needs words as
  well as an equation._ - the author placed that equation, and the field lets them add words to it -
  where an emptied title is put back to the outline's with _A section needs a title._ Leaving the
  field commits and so says the sentence again. Opening the dialog after typing does not commit on its
  own: the field is asking for its dialog, and placing the equation is the one retitle.
- **The 15 retitle tests changed only in how they type and read the field**, not in anything they
  assert: `userEvent.type` and `clear` on an input became helpers that put the caret in the editor
  and press keys, and `toHaveValue` became the field's text. `plainTitle` went, as nothing used it.
- **The CNT-046 test** places an equation in running text, a table's cell, a table's caption and a
  footnote's own editor on a component's surface, by `insertEquation` - the command the dialog answers
  with - and in a section's heading through the title field's own **Equation** button and the
  dialog, and shows each stored. The four component contexts are placed by the command, not by the
  toolbar's button four times: the dialog's path on the surface is CNT-044's test. component-editor.md
  now claims CNT-046, answered with publishing.md's equations 2.
- **The Reference dialog names a section by its title's words without its equation, and offers no
  title form of it.** `titleWords` in `structure/references.ts` drops an equation, so _Growth as x^2_
  is offered as _Growth as_, trimmed. The words only name the section in the list: a publish refuses
  both title forms of a title holding an equation (equations 2's `cross_reference_form_unavailable`),
  so `documentTargets` marks such a section `titleHoldsEquation` and `targetForms` offers it a number,
  a page and a place alone - the dialog offers nothing the PDF refuses. The name keeps the words,
  rather than reading the alternative as the tree does, because it is the reading resolution takes:
  `referenceResolver` reads a section's title with `captionText`, which drops an equation as it does
  from a caption, so the dialog and the publish read one title alike. The tree's labels and the
  panel's sentences read the alternative, through `titleText`, and the page's heading draws the
  equation as MathML.
- **Not run in a real browser**: the field's look, the caret after an equation that ends the title,
  input through an IME, and the focus going back from the dialog under a real `inert` are unverified;
  jsdom lays nothing out, and no screen reader has been run over the field.
- **Issue #224 is fixed here.** Equations 2's last commit, in PR #223, left the worker's tests failing
  `pnpm typecheck` - `'family' is possibly 'undefined'` in `typst.test.ts`'s pinned-font test - unseen
  because CI's typecheck step is `continue-on-error`. `families` now keeps strings only.

The final whole-branch review found a title placed through the dialog lost without a word when its save
failed, a Change that could rewrite another author's equation, and a Reference dialog offering a title
form the publish refuses; these were changed:

- **M1. The focus goes back to the title field whenever its dialog closes**, placed or cancelled,
  whoever opened it. **Equation** keeps the focus where it was, so a dialog opened after choosing the
  section in the tree gave it back to the tree item; a title placed from there that came back unsent
  had no field to leave, and choosing another node dropped it silently. The dialog's request now
  carries `back`, which puts the focus in the field and answers whether it could; only where the field
  has gone does the focus go to what had it, and a retitle answered unsent after its field has gone
  is already named in the page's notice. Tested by the review's reproduction: chosen in the tree,
  **Equation**, placed, refused, another node chosen - and the retry is sent.
- **L1. A title given way under its dialog closes the dialog, placing nothing.** The request kept the
  position of the equation it was opened on, so a refusal that gave the field another author's title
  let **Change** rewrite whatever equation stood there. Any title put into the field from outside
  while its dialog stands - and the field going, or turning read-only - now withdraws the dialog, and
  the page says _The title changed while the Equation dialog was open, so nothing was placed._ after
  the refusal's own sentence. Tested by the review's reproduction, and by another author removing
  the section while its dialog stands.
- **L2. The Reference dialog offers no title form of a section whose title holds an equation**, as the
  publish refuses both, and names it by its words trimmed of the space the equation left. The flag
  (`titleHoldsEquation`) is set by `documentTargets`, and the forms are read from one domain function,
  `targetForms`, rather than from the kind alone. The paragraph above, which argued the words-only
  naming from what a `title` reference prints, gives the reason that now holds, and the changelog's
  bullet describes the change this branch made. **A caption holding an equation still offers its
  title forms**: its contribution carries only `captionText`'s words, and the publish refuses those
  forms as it does a title's; that is equations 2's precedent, not this slice's to change.

**Left as found**, both recorded rather than changed here: a figure's or a table's **caption** holding
an equation still offers the Reference dialog's title forms, which the publish refuses as it does a
section's - the caption's words reach the page from the service with nothing marking the equation, so
matching the section's rule means widening that answer; and a retitle can still be lost without a word
when the author leaves the field for a checkbox or a list and then picks another section while the save
comes back unsent - the old text input had the same gap, and it is its own fix.

## Tasks

1. **`packages/editor`**: R1, tested in `apps/web` where there is a DOM, as the surface is.
2. **`apps/web`**: R2, R3 and R4 - the field, the dialog's target, `titleText`, the page's headings;
   the CNT-046 test.
3. **Docs**: component-editor.md's claim of CNT-046 and its equation contexts, publishing.md's
   EQ-G, architecture, features and the README, CLAUDE.md's status, this plan's status, the version
   (Minor, 0.67.0) and the changelog; trace generate and pins.
