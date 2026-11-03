# 0052 - Table formatting is a tab beside the text

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

[ADR-0051](0051-the-bound-table-panel-is-a-band-of-tabs.md) put a bound table's formatting in a band
of fixed height under the editor's toolbar. The band still takes a third of a short window from the
text, and a plain table's panel stands there too. Ken had table formatting redrawn on 10 October
2026 ([the handoff](../interface/handoffs/table-formatting/README.md)), layout C, "the column in
hand", chosen from three.

## Decision

1. **Table formatting is a tab**, "Table", first in the panel beside the text: the component's
   panels on its own page, the document's panels in a document. The band under the toolbar goes, so
   the text keeps its width and height; the table being edited is outlined, 2px of the accent at 45%.
   The editor sets the tab's contents through a host the page gives it, as it sets a component's
   fields in Attributes.
2. **It is chosen for you**: each time the cursor enters a table while editing. Leaving the table
   switches nothing back, and the reader's own choice of tab stands until the next table is entered.
   Choosing it never moves the focus from the text.
3. **Offered only where there is a table**: on a component's page while the component holds one; in
   a document while a component holding one is open in place. Reading mode has no cursor, so no tab
   (TF-B).
4. **The panel keeps one width while it offers the tab**: 400px, so the text never reflows as the
   cursor moves (TF-A).
5. **Read only otherwise**: viewing, or editing with the cursor in no table, the tab shows the
   formatting as text, Provenance the only act.
6. **Inside the tab**, from the handoff: Value; Table (style, Wide, what it shows); Columns as pills
   and the column in hand; Sort; Notes; Delete table. One of Column, Sort and Notes is open at a
   time, the others folded to a summary. A plain table has Table and its grid and notes, and no
   columns to set (TF-C). ADR-0051's refusals, widths and Format dialog stand.

## What would change the answer

- **Inline values formatted beside the text too**: a Value tab, which this leaves for later (TF-D).
- **Tables of many columns becoming common**: the pills would need a list past two rows.

## Consequences

- ADR-0051's band is superseded; its rulings on refusals, the Format dialog and the column focused
  in the text carry over.
- `ComponentEditor` takes `tableHost` and tells the page `onTable` whether it holds a table and when
  the cursor enters one; `ComponentDock` and the document's panels offer the tab and choose it.
- Tests find the table's panel in the tab; where a test opens the editor alone, it stands under the
  toolbar as before.
