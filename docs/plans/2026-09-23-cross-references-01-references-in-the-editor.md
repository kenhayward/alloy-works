# Cross-references 1: References in the editor

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as the footnotes slices were. It builds structure.md's
> [Making, showing and printing a reference](../design/structure.md#making-showing-and-printing-a-reference)
> decisions XR-A, XR-B, XR-C and XR-E, and XR-F's half in the editor: the first of XR-G's two pull
> requests.

**Goal:** an author places a cross-reference at the cursor from the toolbar or with `Ctrl+Alt+X`,
choosing its target and its form in a dialog: in a document's page, any of that document's sections
and any figure, table or footnote its components hold; in a component opened on its own, the
component's own figures, tables and footnotes. The reference shows what it will print - "Table 1.1",
a section's title, "above" - or, on its own, the target's kind and caption; one whose target has gone
shows as broken. Selecting it and asking again changes its target or form; deleting it deletes it.
Deleting a table and undoing, or cutting a figure and pasting it back, leaves every reference in the
component pointing at it. A component holding a reference opens for editing rather than for reading
only. Publishing one is refused by name until cross-references 2.

**Not in this slice:** publishing a reference, its anchors and its two failures (XR-D, XR-F's publish
half: cross-references 2); Word's fields (PUB-026, with Word output); choosing a form for an output with
no pages (STR-055's `withoutPages`: one stored is kept, and dropped only when the form stops being
`page`); pointing at a paragraph, a list or a quotation from the dialog (XR-A offers sections,
figures, tables and footnotes; one stored by another route is shown and kept); an equation; a
reference in preformatted text; and re-pointing a reference in **another** component when its target
is cut and pasted - that one is named at publish (STR-029).

**Requirements:** none cited. Each one this slice touches is answered only when a reference resolves
at publish - STR-028, STR-031, STR-032, STR-056 and STR-062 - or is the content model's and covered
there: CNT-027 (the node) and CNT-129 (a reference in a footnote). STR-026 stays unclaimed, its
bibliography entry still missing. Nothing here demonstrates any of them in full.

## Rulings

- **R1. A component may hold a `node` target** (XR-B): `checkInlineContent` stops refusing one in a
  component; a title keeps its rule. Nothing stored changes. Every reader of stored references is
  checked for an assumption that a component's never names a node (admission, the Word reader and
  writer, `assemble`).
- **R2. `admit` answers what it renamed**: its successful outcome gains
  `renamed: ReadonlyMap<string, string>` - each block's and footnote's new identifier by the one it
  arrived with, leaving out any that arrived on more than one (reidentify's `renamed`).
- **R3. What a document offers, and what a reference prints**, in
  `packages/domain/src/structure/references.ts`, pure:
  - `type ReferenceKind = 'section' | 'figure' | 'table' | 'footnote' | 'block'` - `block` for any
    other block (a paragraph, a list), which only content written by another route points at.
  - `formsFor(kind): readonly CrossReferenceDisplay[]` (XR-C): a section, a figure and a table have all
    five; a footnote `number`, `page`, `relative`; any other block `page` and `relative`.
  - `ReferenceTarget`: `target`, as a reference in the component being edited stores it; `kind`;
    `label` and `title`, each a string or null; and `relative`, `'above'`, `'below'` or null.
  - `documentTargets({ outline, numbering, contributions, editing: { component, node } })`: in document
    order, every section - `node` target, its number's label and its title's words - then, in each
    reference node's place, every figure, table and footnote its occurrence contributes: a `block`
    target where the occurrence is `editing.node`, a `component` target where the component occurs
    once in the document, and **nothing** where another component occurs more than once, since that
    reference cannot resolve (STR-062). `relative` is by outline order against `editing.node`, a section
    holding it counting as above; null for the editing occurrence's own blocks, whose order is the
    editor's.
  - `printed(target: ReferenceTarget, display, relative: 'above' | 'below' | null): string`: `number`
    is the label; `title` the title; `numberAndTitle` both, a space between, as a generated list sets
    them; `page` is _page of_ and the label or title - the page is known only when typeset; `relative`
    is _above_ or _below_, or _above or below_ where the order is unknown. English words: the layout's
    own arrive with cross-references 2.
- **R4. The node** (XR-C): `crossReference`, inline, an atom, selectable, not draggable, `marks: ''`,
  attributes `id`, `target`, `display` and `withoutPages` (default null). It stands wherever inline
  content does - a paragraph (and so a list's item, a quotation and a table's cell), a footnote's
  paragraph, a term, an attribution, a table's or a figure's caption and a table's note - and never in
  preformatted text. `toDOM` is a `span.aw-reference` with `data-reference`, holding the text a reader
  sees; no `parseDOM`, for a footnote's reason.
- **R5. The mapping** holds a reference in every one of those homes, both ways, with every stored
  attribute, `withoutPages` included where there is one. A component holding one opens for editing.
- **R6. A reference carries no marks and breaks no annotation**, as an image and a footnote do: the
  helpers that let a mark run past those (`imagesUnmarked`, `marksPastImages`, `markThroughout`,
  `markAt`, the toggle) take it in, in every home it stands in.
- **R7. Identity** (XR-E): a reference's identifier is allocated as a block's is - the identity plugin
  names every node with an `id` attribute. **The plugin keeps an identifier no other node holds** in a
  transaction that is an undo or a redo (`isHistoryTransaction`) or that says it has named what it
  places (a `keepsIdentifiers` meta, set by `pasteInto`); everything else is judged by the descent rule
  as now. ADR-0023's rule re-identifies a block holding an identifier another block keeps, which this
  still does, so no new record is needed; component-editor.md's "Identity, by operation" says it.
  Footnotes 1's undo, which brought a footnote back under new identifiers, now keeps them.
- **R8. A paste re-points the references left behind** (XR-E): after placing, `pasteInto` points every
  reference in the component whose `block` target the component no longer holds at the identifier
  `admit` renamed it to, where the paste brought one. So a cut and a paste re-points; a copy and a
  paste changes nothing, the original still standing; and CNT-132 stands, every pasted block newly
  named. Identifiers are 128 random bits, so a paste from another component cannot match by chance.
  The paste report counts the references re-pointed.
- **R9. Commands**, in `packages/editor/src/references.ts`: `insertReference({ target, display })`
  places a reference at the selection's end in an inline home, leaving what is selected in place, and
  selects it whole; `referenceAt(state)` answers the reference selected whole, with its position and
  attributes, or null; `changeReference(pos, { target, display })` changes one, keeping its identifier
  and dropping `withoutPages` unless the form is `page`. **Reference** is a registry command like
  **Footnote** - action `reference`, `Mod-Alt-x`, said "Ctrl or Cmd, Alt and X" - available where
  either command can act, in a footnote's open editor included.
- **R10. What a reference shows** (XR-C, XR-F), by `referencesPlugin`: its state is the host's
  `ReferenceContext` - `{ targets: readonly ReferenceTarget[] }` in a document, null on its own - set by
  `setReferenceContext(view, context)`. A node decoration on every reference carries its text and
  whether it is broken, and `referenceView` draws it, so a reference re-draws when its target or the
  context changes. The text:
  - a `block` target the component no longer holds: _Broken reference_, and broken;
  - one it holds, found in the context: `printed`, with `relative` by position in the component;
  - one it holds, not in the context (on its own, or added since the page last numbered): the target's
    kind and caption - _Table: Readings_, _Figure_, _Footnote_, _Paragraph_;
  - a `node` or `component` target in a document: `printed` where the context has it, else _Broken
    reference_, broken; on its own: _Section_ or _In another component_, not broken - it cannot be
    judged there.
    A broken reference is drawn apart and says so to a screen reader. A footnote's open editor draws its
    references the same way, from the surface's context.
- **R11. The dialog and the toolbar** (XR-A): **Reference** on the toolbar opens `ReferenceDialog`, a
  list of the targets offered - in a document `documentTargets` for the occurrence being edited, with
  the component's own figures, tables and footnotes the page has not numbered yet added from the live
  document; on its own, those alone - each named as the reader will see it; the forms the chosen
  target has (`formsFor`), and a line saying what it will print. With a reference selected whole it
  opens on that reference and changes it. Worked by keyboard as the other dialogs are (CNT-077);
  nothing is placed on Cancel or Escape. The document page passes its context to an editor opened in
  place and refreshes it as it re-reads the numbering.
- **R12. Read-only rendering** shows each reference's text: `renderContent` takes an optional context
  and draws references as R10 does, so the document page's text shows "Table 1.1" where a reference
  stands.
- **R13. Publishing refuses one by name until cross-references 2**, as it already does
  (`inline_not_publishable`, detail `crossReference`); the publishing page says _A cross-reference
  cannot be published yet._

## What the build changed

- **R3 offers sections alone as `node` targets**: a reference node is a numbered heading too, but its
  title is the component's, which the domain does not hold, so "see 1.2" at an occurrence's heading is
  not offered. Nor is a section title's own footnote, which no target kind can name, nor an equation.
  Another occurrence of the component being edited offers nothing, even where the occurrence being
  edited is missing from the outline: a `component` target naming the component that holds it is not
  something to store. `printed`'s `page` form reads _page of 2.1_ until the layout's words arrive, and
  a `block` target's kind word is _Paragraph_, whatever the block is.
- **R1 needed no reader changed**: re-identify leaves a `node` target as it arrived and counts it as
  nothing, since whether it resolves is the document's question, and the Word reader and writer work
  on the scaffolding's model, which stores no target. `assemble` refuses a reference whatever it
  targets; a test now holds that for all three kinds.
- **R7 reaches further than what admission named.** The identity plugin keeps any identifier one node
  holds in a transaction carrying `keepsIdentifiers`, so a paste over blocks keeps the name of a
  receiving block's tail ProseMirror left standing away from its heir position, where before it was
  renamed. Nothing else holds that name, so nothing is lost; narrowing it to the names `admit` gave
  is the alternative. The last paragraph of a paste now keeps admission's name rather than the
  plugin's, and is still newly named (CNT-132). **A redo of a split gives the second half back the
  name it had**, since the history replays the document as it was left after the split renamed it.
- **Footnotes 1's undo test passed either way**: it stripped every identifier before comparing. It now
  asserts the footnote comes back under its own identifiers, and was watched failing on the plugin
  before R7; the preformatted command's comment and its undo test, which said a paragraph put back
  took a new identifier, say it keeps its own.
- **R8's report is a sentence of its own**, `crossReferenceRepointed` - _Cross-references to what was
  cut were pointed at where it was pasted._ - rather than a second entry under the copy's subject,
  whose sentence says the references were pointed at the copy, which is untrue of one left behind. A
  paste into a footnote's text now admits a paragraph holding a reference, where it refused every
  child that was not text.
- **R9's Reference is a block row that prompts**: the registry's `prompts` already meant "the author
  supplies a value first", so no third kind of row was made. `blockCommand('reference')` answers
  whether one could be placed and places nothing, and the keymap hands the key to the host only where
  one could be. The toolbar announces every prompting command as opening a dialog. With no
  decoration, a reference draws _Section_ for a `node` target and _Reference_ for anything else.
- **R10's decorations are in the surface's one decorations plugin**, beside spellcheck and the
  placeholders, not on `referencesPlugin`, which holds the context alone: the state's test pins one
  plugin that decorates, so one set is one thing to test. The text rides in the decoration's spec,
  where a change of it redraws the reference, and the broken class in its attributes. The initial
  context is `createEditorState`'s option, since it is plugin state, and every fresh state the
  component editor makes - a refused claim, a version cut - is given the page's current one. A
  footnote's editor decorates its own document from the surface's context rather than mapping the
  surface's decorations into it.
- **R11's own targets come from the live document**, through `ownTargets` in `referenceText.ts`, and
  the page's numbering only names them: one the page has numbered takes its label and title, one it
  has not keeps its kind and caption, and one the page numbered and the author has since deleted is not
  offered. **The dialog's line says what the surface will draw**: an unnumbered target shows its
  name - _Table: Readings_ - whatever the form, since that is what the reference shows until the page
  numbers it, and the relative form reads _above_ or _below_ from where the reference stands. A
  reference whose target is not offered - broken, a paragraph, a section in a component on its own -
  is listed first, named as the surface shows it, and kept by **Change**. The context is computed once,
  in the document's text, and reaches the editor opened in place through `Place`; the page passes its
  contributions. The targets are two groups of radio buttons, not a listbox, and the dialog's button
  says **Insert** or **Change**. Two targets of the same kind and caption, or with none, share a name.
- **R10's broken reference names what it pointed at only where the editor can know it**: XR-F asks
  for its target named, and a `node` target says _Broken reference to a section_, a `component`
  target _Broken reference to another component_. A `block` target's kind cannot be named once it is
  gone: the kind and the caption went with the block, and the stored target holds only its
  identifier, so it says _Broken reference_ alone. Naming it is publish's, whose
  `cross_reference_unresolved` names the reference and its target, or a later slice's.

The final whole-branch review found one thing and five smaller; these were changed:

- **A click in the document's text after a reference put the caret too far along**, by the length of
  the reference's drawn words, into a later block even: the click's offset counted the words
  `renderContent` draws, and the editor's document, where a reference is an atom, holds none.
  `textOffsetIn` now counts nothing inside a reference's span, as it counts nothing for an image, so
  a click lands where it was made and one on the reference just before it.
- **A broken reference said only _Broken reference_**, where XR-F asks it to name what it pointed
  at: it now does for a section and another component, and the one it cannot name is recorded above.
- **A copy to another application lost each reference's words**: the plain text left a gap and the
  HTML said _Reference_. The surface's copy now fills both with what the surface shows, from its
  context, as `renderContent` fills a span; the product's own type, which a paste back reads, is
  unchanged. A footnote's open editor copies as ProseMirror does, as before.
- **The dialog gave two targets of the same name the same name**, two footnotes on their own both
  _Footnote_: the second and later now take a count, _Footnote (2)_, the list's alone, while the
  line saying what it will show stays what the surface draws.
- **The identity plugin's comment said a redo of a split renames its second half**, which the tests
  show it does not: the redo brings back the name the split was left with. The comment says so, and
  component-editor.md's footnotes 1 bullet, which said an undo brings a footnote back under new
  identifiers, is now in the past tense and points at this plan's R7.

## Tasks

1. **`packages/domain`**: R1, R2 and R3, with tests; the exports and the index test.
2. **`packages/editor`, the model half**: the node (R4), the mapping (R5), marks (R6), identity and the
   paste (R7, R8), the commands and the registry (R9).
3. **`packages/editor`, the view half**: `referencesPlugin`, `setReferenceContext`, `referenceView`,
   the footnote editor's references, `renderContent`'s context (R10, R12), and the stylesheet. Tested
   in `apps/web`, where there is a DOM.
4. **`apps/web`**: `ReferenceDialog`, the toolbar's button and icon (R11), the document page's
   context, the document text's rendering (R12), and the publishing sentence (R13).
5. **Docs**: component-editor.md's node table, its identity section and what building changed;
   structure.md's note that XR-A to XR-C and XR-E are built in the editor; architecture, features and
   the README; CLAUDE.md's status; this plan's status; the version (Minor, 0.63.0) and the changelog;
   trace generate and pins.
