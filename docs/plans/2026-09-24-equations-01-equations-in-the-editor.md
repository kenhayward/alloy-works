# Equations 1: Equations in the editor

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as the cross-references slices were. It builds publishing.md's
> [Equations](../design/publishing.md#equations) decisions EQ-C and EQ-D and the editor's half of the
> design, with component-editor.md's [Equations](../design/component-editor.md#equations): the first of
> EQ-H's pull requests.

**Goal:** an author places an equation from the toolbar or the keyboard, typing LaTeX in a dialog and
seeing it drawn as the browser draws MathML, inline in any text or as a block where a block may stand,
numbered or not; its spoken alternative is written for them in the component's language and is
theirs to change; selecting it and asking again reopens it on its LaTeX. A component holding an
equation opens for editing rather than for reading only. Publishing one is refused by name until
equations 2.

**Not in this slice:** publishing (EQ-A, EQ-B, EQ-E, EQ-F: equations 2), and with it a cross-reference
to an equation and the list of equations; **an equation in a section's title** - EQ-G said it would
cost the outline one control, but a title is edited in a plain text field, and holding an equation
there makes that field an inline editor of its own, so it is its own slice after equations 2
(equations 3); pasting MathML or an equation from outside the product (only the product's own
clipboard carries one); Word's OMML (with Word output); a maths face on screen - the editor draws
text in the reader's own fonts today, and equations are drawn the same way.

**Requirements:**

- **CNT-044** (an equation entered as LaTeX): demonstrated by typing LaTeX in the dialog and storing
  the MathML with the LaTeX as its record.
- **CNT-048** (an accessible alternative, generated where possible and author-editable): demonstrated
  by the dialog generating it in the component's language, the author changing it, and the change
  stored; and by a language the generator does not speak leaving it empty and marked.
- **CNT-080** (reachable and readable by assistive technology through its alternative), in the editor:
  demonstrated by an equation drawn as native MathML carrying its `alttext`, reached and opened by
  keyboard. Cited only if the test shows both halves.
- **Not cited:** CNT-043 and CNT-021 are the content model's and covered there; CNT-045, CNT-046 and
  CNT-049 wait for equations 2 (and CNT-046's title for equations 3); CNT-047's numbering is covered.

## Rulings

- **R1. Temml, pinned and strict** (EQ-C): Temml at an exact version, called with `xml: true`,
  `throwOnError: true` and `annotate: false`, so an unknown command or a parse error is an error the
  dialog shows, never text stored in an equation.
- **R2. Temml's output rewritten before the reader** (EQ-C), in `packages/domain`, pure, beside the
  strict reader (`content/admission/mathml.ts`): `menclose` drawing a line over its content becomes a
  `mover` of that content and a stretchy overline, under it a `munder` and a stretchy low line; any
  other `menclose` (`\cancel`, `\boxed`) is refused, naming the command; and Temml's alignment classes
  on a table, a row or a cell become `columnalign`, which the reader already keeps. Then the reader
  writes the one stored form. Tested over the spike's samples: `\overline{z}` keeps its `z`, `cases`
  keeps its left alignment, nothing else changes.
- **R3. The nodes**: an inline `equation`, an atom with `mathml` and `latex` (null where none was
  typed), standing wherever inline content does but preformatted text - a paragraph, a footnote's
  paragraph, a term, an attribution, a caption, a table's note; and a block `equationBlock` with `id`,
  `mathml`, `latex` and `numbered`, standing wherever a block may. Neither carries marks, and neither
  breaks an annotation, as an image and a reference do. The block is named by the identity plugin as
  any block is.
- **R4. The mapping** holds both, both ways, with every stored member - `latex` absent stays absent -
  so a component holding one opens for editing. The alternative is the MathML's `alttext`; nothing is
  stored beside it.
- **R5. Drawn as native MathML** (CNT-080): the stored MathML, which the strict reader has already
  judged, parsed as XML and placed in the page as MathML elements - never as HTML - by a node view for
  each, and by `renderContent` for a reading. An equation with no alternative is drawn marked, with
  words a screen reader hears (_No description_). Selected whole, `Enter` opens it in the dialog. A
  footnote's open editor draws them the same way.
- **R6. Commands**, in `packages/editor/src/equations.ts`: `insertEquation(attrs)` - its MathML, LaTeX, display
  and numbering - places an inline equation at the selection's end in an inline home, or a block
  equation after the block the selection is in where a block may stand, and selects it whole;
  `equationAt(state)` answers the equation selected whole, inline or block, with its position and
  attributes; `changeEquation(pos, ..)` changes one in place, keeping a block's identifier. **Equation**
  is a registry command like **Reference** - action `equation`, prompting, `Mod-Shift-e` if the
  registry and the browsers leave it free (the plan's task checks; `Ctrl+Alt` is avoided, since AltGr
  types `€` and `é` with it on common layouts) - available wherever an inline equation may stand.
- **R7. The alternative** (EQ-D): generated by the speech rule engine, pinned, when the dialog's LaTeX
  changes, in the component's base language where the engine has that language, and not otherwise -
  the field is then empty and says why. Once the author edits it, it is theirs: a later change of
  LaTeX does not overwrite it, and **Generate again** does, on asking. Never generated on load. The
  engine is loaded the first time the dialog needs it, with its language data from the product's own
  built files, never a CDN.
- **R8. The dialog** (`EquationDialog`): the LaTeX field, the equation drawn beneath it as it is typed
  (or the converter's error in words), the alternative, inline or block - block offered only where a
  block may stand - and **Numbered** for a block. It opens on the equation selected whole and changes
  it; an equation stored without LaTeX opens with the field empty and says that typing LaTeX replaces
  the equation. Worked by keyboard as the other dialogs are; nothing placed on Cancel or Escape. The
  toolbar's button and the shortcut open it, in a footnote's open editor too.
- **R9. Publishing refuses an equation by name until equations 2**, as it does today; the publishing
  page's words for it are checked.

## What the build changed

- **R2 refuses more than `\cancel` and `\boxed`**, and not all of it arrives as `menclose`. `\boxed`
  and `\fcolorbox` are an `mrow` whose style draws a border, which the reader drops, so the box would
  have gone in silence; they are refused by that style. `\cancelto` is refused, since its arrow is only
  a class. **An equation number Temml draws** - `\tag`, a numbered `align` - is refused with a reason
  of its own, which the dialog words as _make it a block and choose Numbered, and use a starred
  environment_: a block's number is the product's (EQ-E), and stored, `\tag{3}` would be "(3)" as
  maths. **A line broken with `\\` outside an environment** is refused too, in both kinds, and a
  block's break had to be found by rendering the same LaTeX inline: in display mode Temml writes a
  top-level `\\` as an empty `mo`, exactly as it writes `\pmod`'s permitted break, so only the inline
  rendering, which marks the break `linebreak="newline"`, tells them apart. `\colorbox` is admitted
  with its colour dropped, as `\color` is. **An array's column rules and `\hline` are dropped
  silently**: Temml writes them as styles on a cell, which the reader removes, and they are not
  content; whether to refuse them by name is a question for equations 2's template. The rewrite reads
  with the reader's own parser and hands its result to the unchanged `sanitiseMathml`, so there is one
  parser and one gate, and a `menclose` arriving by paste is still removed and reported.
- **The domain gained two more functions**: `equationAlternative`, the root `math`'s `alttext`
  decoded by the reader's parser, since the stored form escapes characters and writes combining marks
  as references and only that parser reads them back right; and `withAlternative`, which sets or
  removes it and writes the result back in the reader's form, refusing words the reader cannot hold.
  Temml's real output is kept as fixtures in `temml.fixture.ts`, excluded from the domain's build,
  and `apps/web`'s own test renders every fixture with the pinned Temml and compares, so a Temml bump
  that changes its output fails there.
- **R3's block equation may not stand in a table's cell**, at any depth, since the content model
  refuses one there (tables 1, decision T-D); the context table in component-editor.md said otherwise
  and is corrected. **Equation** places a block after the paragraph the caret is in, or in place of
  an empty one, as **Figure** does, and places nothing as a block from a term, an attribution, a
  caption, a note or a footnote's editor. **A block equation that would end its parent is followed by
  an empty paragraph**, so there is somewhere to write after it.
- **The caret passes a block equation by ProseMirror's gap cursor** - `prosemirror-gapcursor` 1.4.1,
  pinned - registered ahead of `tableEditing`, so an arrow on an equation that ends or begins the
  component stands the caret beside it without changing the document, and a key typed there makes a
  paragraph. The first draft inserted a paragraph when an arrow pointed past one, which made moving
  the caret an edit, and was replaced. **A table's figure takes `allowGapCursor: false`**, found by
  test: without it the gap cursor stood inside the figure, between a table and where its note would
  go, and typing there made a note only the Table panel should. The side effect is new and welcome:
  the caret now stands after a figure or a table that ends the component, and before one that begins
  it. **The empty paragraph after a block equation is kept**, because a gap position must be closed
  all the way up the tree: after an equation that ends a list's item with anything after the item or
  the list there is none, and the paragraph is the only way to write there. An equation that arrives
  in that place without one - from storage, a paste, or with its paragraph deleted - still has no
  caret position after it within the item. The gap cursor's arrows are its own, forward to the right
  whatever the component's direction.
- **R5's drawing names the `math` element with `aria-label`, its alternative, and wraps it in no
  role.** A `math` or `img` role around it would make the MathML beneath presentational and hide its
  structure from a reader that walks it, and `alttext` alone is not reliably read; the two carry the
  same words. An equation with no alternative is marked by text a screen reader hears, not by CSS,
  a numbered block carries a `(#)` marker announced as _Numbered_, and MathML the reader would not
  keep is drawn as _An equation that cannot be shown_. **No screen reader was run**: that NVDA and
  Narrator announce the alternative in the surface, and that NVDA with MathCAT can still explore the
  structure, is to be checked in the application; dropping the `aria-label` is a one-line change if
  it stops MathCAT. **The overline does not stretch in Windows' maths font**: Cambria Math has no
  horizontal construction for the stretchy overline and low line the rewrite writes, so Chromium draws
  the glyph unstretched, short over `a+b`; STIX Two Math, which publishing will set them in, stretches
  both. Recorded in the stylesheet, not worked around.
- **`Enter` over an equation selected whole opens the dialog**, and takes the key whatever the dialog
  answers, since the Enter behind it would delete an inline equation or put a paragraph beside a block
  one - in a footnote's open editor too.
- **R6's shortcut is `Mod-Shift-e`**, checked against the registry, Chromium's accelerators and
  Firefox's, where `Ctrl+Shift+E` opens the Network Monitor but is not reserved, so the page takes it.
  **IBus's emoji hotkey took it before IBus 1.5.25**, before the page can; that is an old Linux input
  method, and the toolbar's button is the way in there. The registry is twenty rows, **Equation** the
  last, and available where an inline equation may be placed or an equation is selected whole.
  **`changeEquation` does not turn an inline equation into a block or back**: moving one is a placing,
  not a change, so the dialog offers **Place as** only for a new equation where a block may stand.
- **R7's engine is the speech rule engine 4.1.4**, Apache-2.0, the newest release that is not a
  candidate - `latest` on npm is 5.0.0-rc.4. It speaks 13 languages - Afrikaans, Catalan, Danish,
  German, English, Spanish, French, Hindi, Italian, Korean, Norwegian Bokmal and Nynorsk, and
  Swedish - and always loads English's data as its fallback beside the one asked for. Its locale data
  are chunks of the product's own build, handed to it by a loader it must be given as the global
  `SREfeature` before it loads, since on import it sets itself up and fetches from a CDN otherwise; a
  test watches every request and script. Its ES module build carries an `eval('require')` reached
  only under Node, which the build warns of. **Temml is in the main chunk**, about 50 kB compressed,
  imported statically since the preview is drawn on every keystroke; only the engine is loaded when
  the dialog first asks for words. jsdom speaks `x^2` as "x raised to the 2 power" where Chromium says
  "x squared", so the tests use a fraction wherever the words matter.
- **R8's description is owned by who wrote it last, inferred at the first change.** An equation opened
  with a description is asked about as it was: the engine's own words mean the engine wrote them, and
  they are written again; anything else is the author's, and kept with a sentence saying so. **Enter
  in the LaTeX field is a new line**, since a `%` comment needs one, and `Ctrl` or `Cmd` and `Enter`
  applies. Temml's own message is shown for a parse error, after where it is; Temml throws something
  other than a parse error for `x^`, which gets the dialog's own words. An equation stored without
  LaTeX, changed with the field left empty, keeps its MathML.
- **R9 found a gap**: an inline equation fell to the publishing page's general sentence for an
  inline item; it now reads _An equation cannot be published yet._, as a block one did.
- **Copy to another application** carries an equation's alternative in its HTML and nothing in its
  plain text, as the node's placeholder rendering has it; a copy within the product keeps it whole.
- **Tests that used a block equation as what the editor cannot hold** - two in the mapping, one in the
  clipboard and one in `apps/web` - now use a paragraph holding a citation, still unsupported.

## Tasks

1. **`packages/domain`**: R2, with tests over Temml's real output kept as fixtures (strings, not the
   library: the domain has no dependency on Temml).
2. **`packages/editor`, the model half**: R3, R4, R6 - the nodes, the mapping, marks, identity, the
   commands, the registry, and a copy and paste within the product.
3. **`packages/editor`, the view half**: R5 - the node views, `renderContent`, the footnote editor,
   the stylesheet. Tested in `apps/web`.
4. **`apps/web`**: R1, R7, R8, R9 - Temml and the speech rule engine as pinned dependencies, the
   dialog, the toolbar's button and icon.
5. **Docs**: component-editor.md and publishing.md (what was built, EQ-G's title moved to equations
   3), architecture, features and the README, CLAUDE.md's status, this plan's status, the version
   (Minor, 0.65.0) and the changelog; trace generate and pins.
