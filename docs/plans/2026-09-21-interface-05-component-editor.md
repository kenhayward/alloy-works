# Interface 5: the component editor

> **A sketch, by request**, built inline and test first. It is slice 5 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** `#/components/{id}` takes layout B from `docs/interface/screens/ComponentEditor.png`:

- a 260px space pane listing the components of the open one's space, the open one marked;
- the editor as a card:
  - a header strip with the title and fields on the left, and the save state, Done editing and
    Save version on the right;
  - the Formatting toolbar;
  - the surface;
  - a status strip.

**Requirements:** none claimed. The editor's own behaviour and the requirements its tests cite
(CNT-068, CNT-070 and the rest) are untouched, and this is a restyle around them.

## Rulings

- **No facet dock.** The build order (A3) builds the dock only when it has a panel, and none exists
  yet: the list and preformatted panels stay inline under the toolbar, as drawn.
- **The DOM order inside the editor does not change.** It is the F6 ring's order and the tab order
  that the editor's tests pin. The strip is a CSS grid that places the header, the save state and
  the Component toolbar on one row. The markup does not move.
- **The space pane lives in `Workspace`, not in `ComponentEditor`.** The editor's tests pin the exact
  requests it makes, and a list read inside it would change them. The editor reports the space it
  opened through a new optional `onSpace`, and the workspace draws the pane.
- **The pane is quiet on failure.** It is a convenience beside the editor. A second `Try again` on
  the page would make the editor's own ambiguous, so a failed read shows the space's name and no
  list.
- **No unsaved dot in the pane yet.** It needs the save state of components other than the open one.
- **The status strip says what is true today:**
  - `F6 moves between the header, the toolbar, the list panel and the text` (the drawing's
    words);
  - `{n} blocks, {m} words`, counted from the surface. A block is a top-level block.
  - The caret's position is left for later.

## Tasks

1. **`editor/SpacePane.tsx`**: `SpacePane({ client, space, current })` reads
   `GET /v1/components?spaces={id}&limit=100`. It renders a `nav` labelled by the space's name, with
   one link per component (title and version) and `aria-current="page"` on the open one. Its test is
   `SpacePane.test.tsx`: `lists the components of the space, marking the one open`.
2. **`ComponentEditor`:**
   - `onSpace?: (space: { id, name }) => void`, called once on open;
   - the module classes: the card, the strip grid and the surface frame;
   - the status strip under the surface.

   New test in `ComponentEditor.test.tsx`:
   `says how many blocks and words it holds, and how F6 moves between regions`.

3. **`Workspace`:** the component route becomes a two-column grid: the pane, and the existing back
   link, Manage access and editor.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean.
- The editor has been looked at in the running renderer, without claiming a lock: reading only,
  because opening one to edit writes to the shared database. That view is a proxy.
