# Handoff: connection and query definition detail pages

The connection and query definition detail pages, redrawn as a header, a state strip and tabs in
the Ledger shell. They replace today's long single-column scrolls. Drawn in the design canvas on
8 and 9 October 2026. Connection option A was chosen from four; the query definition follows it.

**Drawings, not code**, as for [`../ledger/`](../ledger/README.md) and [`../admin/`](../admin/README.md):
colour comes from `tokens.css`, layout from the HTML, and wording from the strings already in
`apps/web` (mainly `QueryDefinitionPage.tsx`). Each screen has a `-light` and a `-dark` `.html`,
each self-contained, and a `.png` of each at 1440x900. The links between files work: the tabs, the
connection link in the strip, and the rail.

Intended home: `docs/interface/handoffs/details/`. It was delivered as a zip and is not in the
repo yet.

## Screens

| Files             | Screen                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `connection-*`    | LIMS staging connection, Settings tab                                          |
| `query-details-*` | Batch release limits, Details tab: connection, title, description              |
| `query-builder-*` | Query tab, Builder: table, columns to return, filters, parameters, its SQL     |
| `query-sql-*`     | Query tab, SQL: the SQL text, parameters, and a fragment parameter's fragments |
| `query-columns-*` | Columns tab, two columns still to confirm, so Save version is held             |
| `query-rows-*`    | Rows tab: key, order, empty result and maximums                                |
| `query-sample-*`  | Sample tab: a value, the first rows, the SQL that ran                          |
| `query-used-by-*` | Used by tab: components and documents, paged                                   |

## Decisions to record (one ADR)

1. **A detail page has three bands**, top to bottom: the header (breadcrumb, title, chips, the
   primary action, then a more-actions menu); a **state strip** of three cells; and tabs. One tab
   panel shows at a time and fills the rest of the height. The page itself never scrolls at
   1440x900. A long list pages inside its panel.
2. **The tabs are the steps the page has today.** Connection: Settings, Credential, Tables, Used
   by. Query definition: Details, Query, Columns, Rows, Sample, Used by. Each tab is a
   `role="tab"` with `aria-selected`, and the active tab sits in the URL
   (`#/queries/<id>/<tab>`) so a link opens the right one.
3. **Save version moves to the header**, so it is reachable from every tab. While a column is
   unconfirmed it is disabled, with "Confirm every column to save." beside it. The strip's
   Columns cell turns to warn, and the Columns tab turns to `--warn` text and underline. The tab
   carries no count badge; its accessible name is "Columns, 2 to confirm".
4. **The state strip** shows what the page depends on, never something new. Connection:
   Credential, Last test, Used by. Query definition: Runs against (links to the connection),
   Columns confirmed, Used by.
5. **Builder or SQL is a two-way switch** in the Query panel header, not a separate step. SQL is
   offered only where the rule in the Details hint allows it.
6. **Narrow columns get exact widths**: a checkbox column 34px, a row number column 34px (room for
   three digits, right aligned), and an icon-only remove column 36px with a 28px bin button.
7. **Technical values stay out of the way.** The sample's checksum is a "Checksum" chip; the value
   shows in a tooltip on hover or focus (`aria-describedby`).
8. **Used by is two full-height lists**, components and documents. Each item is one row: name,
   space, pinned version (or "Latest"). Each list shows 10 per page, with "1 to 10 of 148",
   previous, "Page 1 of 15" and next.

## Tokens and measures

No new colours. These are the existing Ledger tokens in `apps/web/src/theme/tokens.css`, plus
`--on-danger` from the admin handoff. New measures:

```css
:root {
  --tab: 42px; /* tab height; 2px underline, --accent, or --warn when held */
  --strip-icon: 28px; /* the rounded square in each strip cell: ok, warn or muted */
  --col-check: 34px;
  --col-index: 34px;
  --col-icon: 36px; /* holds a 28px icon button */
  --pager-button: 28px;
  --list-row: 38px; /* Used by rows */
}
```

The tooltip is `--text` on `--bg` (inverted), in Plex Mono 12px, with a 6px radius and
`--shadow`. A strip cell's icon square takes `--ok-bg`/`--ok`, `--warn-bg`/`--warn` or
`--sunken`/`--muted`.

## Wording

Kept from the code: the Details hint ("Only connections you may use are offered. SQL is offered
only on one you may write SQL against, and runs only on one whose latest test found its account
read-only."), "Confirm every column to save.", "5 columns proposed. Confirm the type of each.",
"No rows is a valid answer", the Used by hint ("A binding that does not pin a version runs the
latest one the next time it is resolved or checked."), "No component binds this query definition
yet." (the empty state, not drawn), Retire and Reinstate.

New, check each: "Runs against", "SQL is offered because you may write SQL on LIMS staging",
"Saving makes version 4.", "A sample runs the definition exactly as a document would, and keeps
nothing.", "The value of product was sent apart from the SQL, as $1.", "The environment may lower
each limit; a run takes the lower of the two.", the "Maximum" panel with its Rows, Bytes and
Seconds labels, and the pager wording.

## Drawn ahead of the product

Check each, or take it off the screen:

- **Paging on Used by**: needs the bindings listing to page, or the client to page a full list.
  Confirm what the API returns. 148 components is example volume.
- **Pinned version per binding** in Used by: the hint implies bindings can pin, but confirm the
  listing returns the pinned version.
- **Counts in the strip and on the Used by tab**: one read each, from the same listing.
- **Columns confirmed, "3 of 5"** in the strip: derived from the column list the page already
  holds.
- **Checksum and row count on a sample**: shown today? If the sample does not return a checksum,
  drop the chip.
- **Read-only mode** (when `mayEdit` is false, or the builder cannot show the query) is not drawn.
  It should render the same tabs with inputs read-only, and with no Save version.
- Names, products, values and dates are invented.

Not drawn: a new query definition. It should open on Details, with Space shown as it is today,
then the other tabs become available once a connection is chosen.

## Order of work

1. The ADR, and `../../README.md` pointing here.
2. The measures in `tokens.css`. A `Tabs` component (keyboard: arrows move, Home and End, the
   panel labelled by its tab), a `StateStrip`, a `Tooltip`, and a `Pager`, each with tests.
3. The connection page on the new shape, keeping its existing tests' requirement IDs.
4. The query definition page, one PR per tab group: Details and Query; Columns, with Save version
   held in the header; Rows; Sample; Used by with paging. Each keeps its tests' requirement IDs.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing:
take sizes, spacing and structure from it, but build with the app's components and tokens, not by
copying markup. Raise every "Drawn ahead" item before building it.
