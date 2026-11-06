# 0095 - A row offers its page's acts, and a copy keeps its identities

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Ken asked for a document's acts on its row in the list, for components and templates too, and for Duplicate, keeping the
components or copying them (SCH-075, REU-056 to REU-058; [the RM plan](../plans/2026-11-06-rm-row-menus-and-duplicate.md)).
[ADR-0049](0049-administration-is-a-page.md) decision 4 already gives a row at most two icons, then More actions.

## Decision

1. **A row's More actions is the menu bar's `Flyout`, under its button**, so it has submenus (Lifecycle) and works as every
   other menu does. It is not a hamburger, which means navigation.
2. **The row reads its item when the menu opens**, from the item's own view: its permissions and standing in one answer, not
   one request a row. What the caller may not do stays in the menu, unavailable, as on the item's page; the routes decide
   again.
3. **The acts are the page's own**, mounted per row through their `act` refs: the workflow's transitions in its own words,
   Move, Hold, Archive, Delete, Relationships, Used in, Publish in a dialog. No list invents an act its page lacks.
4. **A document's copy keeps its outline's node ids.** They are unique within an outline only (STR-003) and every table keys a
   node by its document, so cross-references, section titles and bound parts' resolutions hold in the copy unchanged.
5. **One copy route for every kind**, `POST /v1/artifacts/{id}/copy` with a preview, as moving has.

## What would change the answer

- A node id needing to be unique across documents, which would make a copy remap every `node` target.
- Reading each item proving too slow for a menu that opens at once, which would put the permissions on the listing.

## Consequences

- Templates' rows offer only what a template has: no lifecycle, archive or delete until a template gains them.
- A copy into another space says first what moving there would cost, since the same things stop working.
