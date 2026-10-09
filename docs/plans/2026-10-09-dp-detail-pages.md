# DP: Connection and query definition detail pages

> Building [the details handoff](../interface/handoffs/details/README.md) under
> [ADR-0050](../decisions/0050-a-detail-page-is-a-header-a-strip-and-tabs.md). **Full tier, five
> PRs**, a contract change only if DP-D is taken. Ken's answers to DP-C to DP-G are its pre-flight.

**Goal:** both pages as a header, a state strip and tabs, in Light and Dark, with no string reworded
that the handoff keeps and no requirement that passes today failing.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                           | Beat                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| DP-A | **`PanelTabs` is the tabs**, already a tablist with arrows, Home and End; it gains `tone="warn"`, an `aria-label` per tab and the 42px measure. No second `Tabs` part                                                                                                                              | The handoff's new `Tabs`                                  |
| DP-B | **The tab is a suffix on today's addresses** (`/settings`, `/query`...), parsed in `data/links.ts`; the page stays mounted across a tab change, so the draft and `useLeftAt` hold. Connection's `/access` keeps its meaning                                                                        | `#/queries/<id>/<tab>`, a new route family                |
| DP-C | **Used by pages in the page**: the uses routes return every readable item and a count of the rest, so the Pager pages that list, ten to a page, and the counts are `readable + others`. No contract change                                                                                         | A paged uses route, before any tenant has 148 bindings    |
| DP-D | **Space and pinned version per row: off the screen for now.** The uses routes return `{id, title}` only, and a component can bind a definition more than once, at different pins, so "its version" is not one value. Adding them is an additive contract change, waiting for a reader who needs it | Adding `space` and `pins` to `UsesView` now               |
| DP-E | **The SQL text stays a plain, full-height monospace textarea**: no line numbers, no highlighting, and The SQL it runs a plain `pre`. Both are drawn but not listed as ahead; each needs a code editor dependency                                                                                   | CodeMirror for one field                                  |
| DP-F | **Below 800px high the page scrolls**, rather than squeezing a panel to nothing; at 1280x800 and above it does not                                                                                                                                                                                 | Panels a few rows high on a laptop with the taskbar shown |
| DP-G | **No count on the Columns tab**: the strip says 5 of 5, and decision 3 drops the badge when held anyway. Used by keeps its count                                                                                                                                                                   | Two badges saying what the strip says                     |
| DP-H | **Kept, each backed today**: Credential set by and on, Last test by, on and result, the sample's row count and checksum (`SampleView`), the per-definition maximums and the environment lowering them (`effectiveLimits`), read-only mode (`mayEdit`) as the same tabs with no Save version        | -                                                         |
| DP-I | **A new query definition** opens on Details with Space, as today; the other tabs are `aria-disabled` until a connection is chosen                                                                                                                                                                  | Hiding them, which moves the tab strip under the reader   |

## The PRs

| #   | PR                                                                                                                                                                                                              | Cites, in literal titles |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| DP1 | The handoff, ADR-0050, this plan, `docs/interface/README.md` pointing at the handoff                                                                                                                            | Nothing                  |
| DP2 | Parts: the measures; `PanelTabs`' warn tone and names (DP-A); `StateStrip`, `Tooltip`, `Pager`; a `DetailPage` frame of the three bands, sized per DP-F; the tab suffix in `links.ts` (DP-B)                    | Nothing new; axe on each |
| DP3 | The connection page on the frame: Test in the header, Retire in its menu, the strip, Settings, Credential, Tables, Used by paged                                                                                | As today                 |
| DP4 | The query definition on the frame, every step moved into its tab as it is; Details and Query redrawn (the Builder or SQL switch, parameters beside, DP-E); Columns redrawn, Save version in the header and held | As today                 |
| DP5 | Rows, Sample (the checksum tooltip) and Used by paged, redrawn; the close                                                                                                                                       | As today                 |

Each PR checks 1440x900 and 1280x800, both themes, and the read-only page.

## Requirements this must keep

`apps/web/src/data/connections.test.tsx` and `query-definitions.test.tsx` cite the D-tranche's
requirements; they will find controls through a tab first, citing the same IDs. The browser suite's
`accessibility.test.ts` gains a state per tab in both themes (CNT-176, CNT-078). Nothing is newly
claimed.

## Risks

- **Test churn**: the two unit suites are large and find controls by role across the whole page.
  DP3 and DP4 open the tab first; a test helper per page keeps that to one line.
- **The Workspace keeps a page per module** ([architecture](../architecture.md#the-interface)): a
  tab change must not read as a new page, or the draft is lost. DP2 tests that first.
