# BT: The Bound table band

> Building [the bound table handoff](../interface/handoffs/bound-table/README.md) under
> [ADR-0051](../decisions/0051-the-bound-table-panel-is-a-band-of-tabs.md). **Three PRs**, no
> contract or stored shape. Ken agreed BT-A to BT-E on 9 October 2026, its pre-flight.

**Goal:** the Bound table panel as a band of tabs, in Light and Dark, every setting it has today kept,
no requirement that passes today failing.

## Decisions

| #    | Decision                                                                                                                                                                                                 | Beat                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| BT-A | **Drawn ahead, taken**: the table outlined (CSS), the focused column highlighted (a `data-column` on the drawn table and a rule), the status line (`describe`), the definition a link with its row count | Leaving the drawing untrue               |
| BT-B | **No toolbar chip**: the band says where the cursor is                                                                                                                                                   | A second sign of the same thing          |
| BT-C | **One value line** for a bound table and an inline value alike                                                                                                                                           | Two ways of showing one value            |
| BT-D | **The band is `min(300px, 38vh)`**, so a 1280x800 window keeps its text                                                                                                                                  | A flat 300px leaving about 250px of text |
| BT-E | **A wrong field stays `aria-invalid`** beside the quiet marker; the Format dialog says "shown under its name"                                                                                            | A refusal found only by hovering         |

## The PRs

| #   | PR                                                                                                                                              | Cites, in literal titles |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| BT1 | The handoff, ADR-0051, this plan; the four measures, the band's glyphs, `Segmented`                                                             | Nothing new              |
| BT2 | The band at its height; the value line (BT-C); the table's toggles; tabs with counts; Sort and Notes as rows; the outline and the status line   | TAB-, TB2, TB3 as today  |
| BT3 | The column grid with its segments; the quiet refusal and its live region; the focused column highlighted; the Format dialog at 600px; the close | As today                 |

Each checks 1440x900 and 1280x800 in both themes, with axe over each tab and the dialog.

## Risks

- **F6 and focus**: the band is one region, as the panel is today; its tabs and lists must keep the
  focus where a removal or a move leaves it (the move tests hold this today).
- **Test churn**: the bound table tests find checkboxes and selects that become toggles and radios;
  a helper per control keeps that to the queries.
