# Interface 15: The outline pane as a tabbed panel, and a status bar

> **A sketch, by request**, built inline and test first. It builds designs 4a and 4b of the handoff
> kept in [`docs/interface/handoffs/outline-pane/`](../interface/handoffs/outline-pane/README.md).
> The build order's global constraints bind it.

**Goal:** the document page's left pane becomes a tabbed panel at the top of its column. It holds:

- a tab strip: back to documents, **Contents**, and the collapse toggle;
- an icon toolbar;
- the document as the tree's root row, its title and version number;
- an indented tree with a triangle on each section, a document glyph on each component, and a
  filled selected row.

The header strip above the page and the keymap paragraph go. Every one-line notice lands in a new
**status bar** along the foot of the application, with the counts, version and space at its right.

**Requirements:** none claimed. The outline's STR tests keep theirs. What they find moves, and what
it says does not.

## Rulings

- **The toolbar sits above the root row**, as the screenshot draws it. The README's numbered list puts
  it below. The root row reads as the top of the tree only when it is directly above the tree.
- **The triangles are drawn and do nothing.** No section can be collapsed today, and every section
  says `aria-expanded="true"`. Collapsing is a feature of its own, not a restyle.
- **One live region per page, in the status bar.** A `StatusProvider` in the app shell owns the bar.
  The document page and the component editor say their notices through `useStatus()`. Outside the
  shell - every page test, which renders a page on its own - `useStatus()` answers null, and the page
  renders the same `StatusBar` itself. So a test finds the same markup the app shows, and the
  existing assertions on the notices and on `Version 0.2 in General` stand.
- **The bar keeps a notice until the next one replaces it**, and clears what a page said when that
  page goes away.
- **A move notice carries the move glyph**: any notice beginning `Moved `. Refusals and the rest go
  without it.
- **The document title stays the page's `h2 id="document-title"`**, now in the root row, so the
  article is still named by it.
- **Back to documents** moves from above the page into the tab strip, as an arrow named by those
  words.
- **The tab strip is a real `tablist`** with one tab, its `tabpanel` beneath, arrow keys, `Home` and
  `End`. The chosen tab is remembered per browser beside the pane's width.
- **Deferred:** hiding the bar's right-hand context under 700px. It wraps instead.

## Tasks

1. **`Icon`** gains the handoff's glyphs: back, contents, the two chevrons, add section, add
   component, undo, folder, document, the filled triangle, and move.
2. **`shell/Status.tsx`**: `StatusProvider`, `useStatus()` and `StatusBar`, a `role="status"`
   notice at the left and the context at the right. `App` wraps the page in the provider and puts the
   bar at its foot, sticky to the bottom of the window. Tested in `Status.test.tsx`.
3. **`OutlinePanel`**:
   - it takes `head` (the tab strip) and `root` (the root row), and wraps what it shows in the tab's
     `tabpanel`;
   - the toolbar's buttons become icons, each named by `aria-label` and `title`;
   - each tree row gets its own element, indented `8px + depth × 18px`;
   - the keymap paragraph is visually hidden, and the in-panel status paragraph goes.
4. **`DocumentPage`**:
   - the header strip and `.paneHead` go;
   - the tab strip (`OutlineTabs`), the root row and the collapsed rail come in;
   - its notices and context go to the bar.

   **`Workspace`** drops the Back to documents link above a document.

5. **`ComponentEditor`** says its notices through the bar where there is one.
6. `PaneToggle` draws the chevrons, 30 × 26.
7. The handoff kept in `docs/interface/handoffs/outline-pane/`, the docs, the version (Minor) and
   the changelog.
