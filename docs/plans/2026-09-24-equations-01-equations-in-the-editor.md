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
