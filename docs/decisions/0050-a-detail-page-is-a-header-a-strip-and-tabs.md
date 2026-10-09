# 0050 - A detail page is a header, a state strip and tabs

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

A connection and a query definition each open as one long column of numbered steps, Save version
at a step of its own near the foot, and Used by in an aside. A query definition runs to six steps
and several screens; nothing says from the top whether it can be saved, or what it runs against.
Ken had both redrawn on 8 and 9 October 2026 in the Ledger shell
([the handoff](../interface/handoffs/details/README.md)); connection option A was chosen from four.

## Decision

1. **Three bands**: a header (breadcrumb, title, chips, the primary action, a more-actions menu), a
   **state strip** of three cells, then tabs, one panel showing and filling the rest of the height.
   At 1440x900 and 1280x800 the page does not scroll; a long list scrolls or pages in its panel.
2. **The tabs are today's steps.** Connection: Settings, Credential, Tables (PostgreSQL only), Used
   by. Query definition: Details, Query, Columns, Rows, Sample, Used by. The tab is in the address,
   `#/connections/<id>/<tab>` and `#/query-definitions/<id>/<tab>`; no tab means the first. A
   draft belongs to the page, not the tab, so moving between tabs loses nothing.
3. **A query definition's Save version is in the header**, reachable from every tab. While a column
   is unconfirmed it is disabled, with "Confirm every column to save." beside it, the strip's
   Columns cell in warn and the Columns tab in warn, named "Columns, 2 to confirm". A connection
   saves only its settings, so its Save version stays at the foot of Settings, and Test is its
   primary action.
4. **The strip shows what the page depends on**, never anything new. Connection: Credential, Last
   test, Used by. Query definition: Runs against (a link), Columns confirmed, Used by.
5. **Builder or SQL is a switch** in the Query panel's header, offered only where it is today.
6. **Retire and Reinstate move to the more-actions menu.** Retiring is undone by Reinstate, so it
   does not ask first ([ADR-0049](0049-administration-is-a-page.md)'s rule is for removals).
7. **Technical values stay out of the way**: a sample's checksum is a chip with the value in a
   tooltip, on hover or focus.
8. **Used by is two lists**, components and documents (a connection's: query definitions and
   documents), ten to a page.

## What would change the answer

- **A definition with more than one source**, or a connection type with many more settings: a
  fourth strip cell or a sub-tab, decided then.
- **Bindings in their thousands**: the Used by lists page on the service, not in the page.

## Consequences

- `PanelTabs` gains a warn tone and an accessible name apart from its label; `parts` gains
  `StateStrip`, `Tooltip` and `Pager`; `tokens.css` gains seven measures.
- The two pages' tests find their controls through a tab first; every requirement they cite today
  is still cited.
- The handoff's own route, `#/queries/`, and rail label, Queries, are not taken: the product's are
  `#/query-definitions/` and Query definitions.
