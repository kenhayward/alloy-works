# Interface 4: New component and the row menu

> **A sketch, by request**, built inline and test first. It is slice 4 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** the components list matches `docs/interface/screens/NewComponent.png`:

- `New component` is the page's one primary button, and it opens the existing form as a modal;
- each row has a menu offering `Open`, `Copy link` and, where the reader may administer it,
  `Manage access`.

**Requirements:** none claimed. CNT-149 and MET-011 stay with `NewComponent.test.tsx`, which does
not change: the form's behaviour is untouched, only where it sits.

## Rulings

- **The form keeps every word and every behaviour.** It moves into the modal whole, with its own
  heading naming the dialog. Its two-column grid comes from the modal's CSS, not from a rewrite.
- **No `Where this is used`, `Version history` or `Delete`** (build order A4 and A7): nothing answers
  them.
- **`Manage access` is asked about when the menu opens**, one `GET /v1/access` per menu, not per row
  per page. It is shown only when the answer says `administer`, as `ManageAccessLink` already does.
- **`Copy link` reuses the outline's words:** `Copied the link to {title}.` and
  `The link could not be copied. Select it and copy it instead.`, said in the list's status region.
- **The modal is not a route** (README): it opens over the list, 40px from the top, and Escape
  closes it. Focus starts on its first field and returns to the button that opened it.
- **Seam for review:** creating from the modal navigates to the new component, as the inline form
  did, so the modal closes by being unmounted with the list.

## Tasks

1. **`apps/web/src/layouts/Modal.tsx`** and its module:
   - `Modal({ labelledBy, onClose, children })`;
   - a `role="dialog"` with `aria-modal`, over the `--overlay` scrim, on `--surface`, radius 10,
     `--shadow-modal`, 40px from the top;
   - a close button labelled `Close`;
   - Escape closes; Tab stays inside.

   `Modal.test.tsx`:
   - `opens as a dialog named by its heading, focusing its first field`;
   - `closes on Escape and on its close button, returning focus to what opened it`;
   - `keeps Tab inside the dialog`.

2. **`apps/web/src/editor/RowMenu.tsx`**: `RowMenu({ client, id, title, onNotice })`.
   - A kebab button labelled `Actions for {title}` opens a menu of links and buttons.
   - Escape closes the menu and returns focus to the kebab button.
3. **`ComponentList`:**
   - the `h1` row holds the primary `New component` button;
   - the modal wraps `<NewComponent>`;
   - a last, unlabelled column holds each row's `RowMenu`;
   - the status region (`role="status"`) sits under the summary line.

   `ComponentList.test.tsx`:
   - `opens New component as a dialog from the primary button`;
   - `offers Open and Copy link in a row menu, and Manage access only where it is allowed`;
   - `copies a component's link, and says so`.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean.
- The running renderer shows the dialog and the menu. That view is a proxy.
