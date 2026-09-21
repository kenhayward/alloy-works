# Interface 8: the document, outline and properties

> **A sketch, by request**, built inline and test first. It is slice 8 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Decision A5, settled by Ken (2026-09-21):** structure and content are one screen. The outline, the
document's text, and each component edited in place under its number all sit on one page. This
slice builds the frame and the reading half. Slice 9 puts each component's editor in place.

**Goal:** `#/documents/{id}` takes layout C from `docs/interface/screens/DocumentOutline.png`, in
three columns:

- **left:** the outline pane, 300px, draggable between 220 and 520, hiding to a 46px rail, its width
  and state remembered;
- **middle:** the document's text in reading order. Each section is a numbered heading. Each
  component reference is a card under its number, with a link to open the component;
- **right:** _This part of the outline_, the chosen node's details, its link, and the removal
  confirmation, with the figures, tables and equations and the publications beneath.

**Requirements:** none claimed. The page's STR and PUB tests keep their citations and their
assertions. This moves what exists into columns and adds a reading view.

## Rulings

- **The outline panel keeps its DOM order and its behaviour.** It gains two wrappers:
  - `data-part="outline"`: the toolbar, the add forms, the key hint, the tree, the end drop target
    and the status line;
  - `data-part="details"`: the details, the confirmation and the link.

  The panel's root takes `display: contents`, so the page's grid places the two parts in their own
  columns.

- **The text is read-only here.** A card names its component, how it resolves (latest, pinned) and
  its number, and offers `Open`, which goes to `#/components/{id}`. A reference whose component the
  reader may not read says `A component`, with the `Not yours to read` lozenge.
- **Numbers come from the panel's own function** (`sectionNumbers(number(...))`), so the tree and the
  text cannot disagree.
- **No facet rail yet**, as in slice 5. The right column is a plain stack.
- **Remembered per browser**, in `localStorage`, under `aw.outline.width` and
  `aw.outline.collapsed`. The README asks for per person, and the service holds no preference store
  yet. That gap is named here.

## Tasks

1. **`layouts/ResizablePane.tsx`:** `ResizablePane({ label, storageKey, min, max, initial, collapsedWidth, children })`.
   - A `role="separator"` with `aria-orientation="vertical"` and `aria-valuemin`, `aria-valuemax` and
     `aria-valuenow`, labelled `Resize the {label}`.
   - The separator moves with the pointer, and with the arrow keys 10px a press.
   - `Hide the {label}` and `Show the {label}` buttons.

   Tests:
   - `resizes with the arrow keys within its bounds, and remembers the width`;
   - `hides to a rail and shows again, remembering which`.

2. **`structure/DocumentText.tsx`:** `DocumentText({ outline, scheme, names })`. Test:
   `sets out the document in reading order: numbered sections, and each component reference under its number with a link to open it`.
3. **`OutlinePanel`** gains the two part wrappers. **`DocumentPage`** lays out the header strip and the
   three columns. Test in `DocumentPage.test.tsx`:
   `puts the outline, the document's text and the chosen part's details in three columns`.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean, with the whole existing
  `DocumentPage.test.tsx` passing unchanged.
- `trace.json` is regenerated last.
- The page has been looked at in the running renderer. That view is a proxy.
