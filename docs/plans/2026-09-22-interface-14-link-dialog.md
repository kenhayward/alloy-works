# Interface 14: The link and language dialog, as a modal

> **A sketch, by request**, built inline and test first. It builds designs 3a and 3b of the handoff
> kept in [`docs/interface/handoffs/link-dialog/`](../interface/handoffs/link-dialog/README.md). The
> build order's global constraints bind it.

**Goal:** `MarkPrompt`, the dialog that asks for a link's address or a run's language tag, today
lands unstyled at the foot of the page. It becomes a modal over the editor, in the app's own modal
shell: the scrim, a 600px surface 40px from the top, and a close button. It gains a heading with the
toolbar's own icon for the command, a line saying which text the mark goes on, and a footer with
**Cancel** (and **Remove link** or **Remove language tag**) at the left and **OK** at the right.

**Requirements:** none claimed. CNT-152 (the warning before a tag a publication cannot carry) keeps
its tests, with the button renamed.

## Rulings

- **One dialog role, one focus trap.** `MarkPrompt` keeps its own `role="dialog"`, trap, `Escape`
  and form, and wears `Modal.module.css`'s scrim, surface and close classes rather than being mounted
  inside `Modal`, which would bring a second dialog and a second trap. The promise and settle
  plumbing in `ComponentEditor` is untouched.
- **The renames are the handoff's:** `Apply` becomes **OK**, `Apply anyway` becomes **OK anyway**
  (and the warning sentence says so), and `Remove` becomes **Remove link** or **Remove language tag**.
- **The close button draws a stroked cross** from the toolbar's icon family, in `Modal` too, so every
  modal closes with the same mark.
- **The selected text is captured when the dialog opens**, never read from the live view while it
  stands. It is said only when the selection is within one block and not empty, and is cut to 40
  characters with an ellipsis.
- **No placeholder in the title box.** The prototype's example value reads as a value.

## Tasks

1. `Icon` gains `Close`. `Modal`'s close button uses it.
2. `MarkPrompt`: the shell classes, the heading with its icon tile, full-width fields with their
   hints, the complaint under the first box, the selection line, and the footer. The renames, and a
   `selected` prop. Styles in `MarkPrompt.module.css`.
3. `ComponentEditor`: `askFor` captures the selection's text into `asking` and passes it on.
4. Tests: the renamed buttons, and a test for the shell, the icon, the selection line, and the close
   button cancelling.
5. The handoff kept in `docs/interface/handoffs/link-dialog/`, the docs, the version (Minor) and the
   changelog.
