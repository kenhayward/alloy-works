# 0051 - The Bound table panel is a band of tabs

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The Bound table panel (TB2, TB3) is a long column of labelled fields stacked between the editor's
toolbar and its text: the table's settings, then every column's eight fields, its sort keys and its
notes, then Delete table, with the Value panel as a second section beneath. A table of eleven
columns pushes the text off the screen, and the page jumps as the cursor enters and leaves the
table. Ken had it redrawn on 9 October 2026 ([the handoff](../interface/handoffs/bound-table/README.md));
two other layouts, an inspector beside the text and controls on the table itself, were set aside.

## Decision

1. **A band of fixed height**, `min(var(--bound-panel), 38vh)`, the same on every tab, so the text
   below never jumps. Its lists scroll inside it.
2. **Its first line is the value and the table.** On the left, one line for the value - its
   definition as a link, version, row count, mode, when fetched, then Provenance, Change and Resolve
   or Keep as icons - which replaces the Value panel for an inline value as well. On the right, Table
   style, then Numbered, First column heads its row, Empty statement, Note and Source as pressed
   toggles, Wide, and Delete table.
3. **Tabs: Columns, Sort, Notes**, each counted, each add action at the right of the tabs.
4. **A column, a sort key and a note are each one row** of fixed widths. Alignment and where a unit
   stands are segmented controls, each segment named in full, its face a short word or an icon.
5. **Refusals are quiet**: a removal refused is marked on its row's number, the reason in a tooltip
   and said once in a live region; the rest go under the tabs. A field that is wrong stays marked
   invalid. Not reading the definition is a grey line, not an error.
6. **The text shows where the panel is**: the bound table outlined while the cursor is in it, the
   column whose row has the focus highlighted, and the status bar saying "Bound table, column 3 of
   11". No chip on the toolbar: the band says it.
7. **The Format dialog is 600px**, an exception to the 480px rule: it is a form of name and field
   pairs, each name with the table style's value under it.

## What would change the answer

- **Drag to reorder columns or sort keys, or bulk column actions**: each needs its own drawing.
- **A short window becomes common** (below 700px high): the band would need to collapse to its first
  line.

## Consequences

- `parts` gains `Segmented`; `Icon` gains the band's glyphs; `tokens.css` four measures.
- Checkboxes become pressed toggles and two selects become segmented controls, so the bound table
  tests find them by those roles, citing the same requirements.
- `ValuePanel` becomes one line, shared by an inline value and a bound table.
