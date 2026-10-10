# TF: Table formatting in a tab beside the text

> Building [the table formatting handoff](../interface/handoffs/table-formatting/README.md) under
> [ADR-0052](../decisions/0052-table-formatting-is-a-tab-beside-the-text.md). **Three PRs**, no
> contract or stored shape. Ken agreed TF-A to TF-E on 10 October 2026, its pre-flight; inline values
> are left alone for now.

**Goal:** a table's formatting in a Table tab beside the text, every setting kept, every test's
requirement IDs kept.

## Decisions

| #    | Decision                                                                                                 | Beat                                     |
| ---- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| TF-A | **One width while the tab is offered**: 400px, never widening as the cursor moves                        | The text reflowing as a table is entered |
| TF-B | **In a document, offered while a component holding a table is open in place**; none in Reading           | A second, read-only renderer             |
| TF-C | **A plain table**: Table, then its grid and notes; no column pills                                       | Pills that set nothing                   |
| TF-D | **An inline value keeps its one-line band** under the toolbar                                            | Moving it without a drawing              |
| TF-E | **Several tables: the one the cursor was last in, or the first**; choosing the tab never takes the focus | Typing landing in the panel              |

## The PRs

| #   | PR                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| TF1 | The handoff, ADR-0052, this plan; the Table tab on both pages, chosen as the cursor enters a table; the band removed      |
| TF2 | Value and Table as drawn; Columns as pills and the column in hand; refusals on the pills; the Format dialog's text column |
| TF3 | Sort and Notes as rows; one of Column, Sort and Notes open, the others folded to a summary                                |
| TF4 | The read-only view; the close                                                                                             |

Each holds the tab to axe in Light and Dark. TF1 and TF2 ride one PR: TF1 alone put the band's
980px column grid in a 400px tab, and left the tab live behind the Format dialog.
