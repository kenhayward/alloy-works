# Interface 3: Components

> **A sketch, by request**, built inline and test first. It is slice 3 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** `#/` shows `docs/interface/screens/Components.png` in layout A:

- a filter pane of the spaces the reader may read, each with its count;
- the page title and a summary line;
- a table with the columns Title, Type, Space, Version, Language, Changed and By;
- `Show more`.

**Requirements:** none claimed. SCH-019 (listing views with sorting and filtering) is answered
only in part: there is no sort, and only one facet. SCH-052 (component type as a facet) is not
answered at all. Both stay unclaimed, which is what the build order's rule asks.

## Rulings

- **No search field, and no type, language or changed facets** (build order A2, A1): the service
  answers the space facet only. Those facets arrive with their filters.
- **No sort control, and the order stays by identifier.** The cursor is an id, so sorting by
  when-changed needs a compound cursor. That is its own change, and it is named for Ken's refinement
  pass.
- **New component stays the inline form above the table** until slice 4 makes it a modal with the
  primary button.
- **The row line `- version 0.2 in General` gives way to the table's columns.** That is a sentence
  the redesign replaces, not rewords. `Workspace.test.tsx`'s one assertion on it moves to the Version
  cell.
- **`By` says `You`** when the last version's author is the reader.

## Tasks

1. **The store** (`packages/db/src/components.ts`).
   - `listReadableComponents(trx, principal, request, filter?: { spaces?: readonly string[] })`. Each
     item also carries:
     - `type: string | null`: the component type's name at the version the component was written
       against, `content->>'name'` of `component_type_version_id`;
     - `language: string`: `content->>'language'`;
     - `changedAt: Date`: the latest version's `created_at`;
     - `changedBy: { id, name } | null`: the latest version's author, named by `display_name`, else
       `email`.
   - `countReadableComponents(trx, principal)` returns `{ id, name, count }[]` per space, over the
     readable set, ordered by name. It is undefined for an unknown principal.
   - Tests:
     - `says of each its component type, its base language, and who changed it last and when`;
     - `narrows to the spaces asked for, and to nothing for a space it may not read`;
     - `counts what a principal may read in each space, leaving out what is refused it`.
2. **The route.**
   - `ComponentListQuery` gains `spaces`: comma-separated lowercase UUIDs, 1 to 50, `400` otherwise.
   - `ComponentList` items gain `type`, `language`, `changedAt` (ISO) and
     `changedBy: { id, name } | null`.
   - The body gains `total`, the count for the spaces asked for (or all of them), and `spaces`, the
     facet over everything readable.
   - Regenerate `openapi.json` and the client.
   - Tests in `component-routes.test.ts`:
     - `lists with each component's type, language and last change, a total and the spaces it may filter by`;
     - `narrows to the spaces named, and refuses a space list that is not one`.
3. **The screen.**
   - `apps/web/src/layouts/ListLayout.tsx` and its module: `ListLayout({ filter, children })`.
     - The filter pane is 240px on `--surface-2` and collapses to a 40px rail with the vertical label
       `Filter`.
     - The collapse button is labelled `Hide the filter`; the rail's button is labelled `Show the filter`.
     - Collapsed or not is remembered in `localStorage` under `aw.filter.collapsed`.
     - Test: `hides the filter to a rail, and shows it again`.
   - `apps/web/src/editor/changed.ts`: `whenChanged(at, now, locale?)` returns:
     - `Just now` under a minute;
     - `N minutes ago` under an hour;
     - `N hours ago` today;
     - `Yesterday, HH:MM`;
     - `D Mon, HH:MM` this year;
     - `D Mon YYYY` before that.

     Tests pin each band.

   - `ComponentList` becomes:
     - `h1` `Components`;
     - the line `{total} components you may read. Showing 1 to {shown}.`, plus `Space: {names}` when
       filtered;
     - the table;
     - `Show more`.

     The filter lists each space as a checkbox with its count, and `Clear`. Changing the filter
     reloads from the first page. It takes `principalId` for `You`.

   - `ComponentList.test.tsx`:
     - `shows each component as a row: title linking to it, type, space, version, language, when changed and by whom`;
     - `filters by space, and clears the filter`;
     - `says You for the reader's own change`.

## Done when

- Lint, typecheck, format, and the db, service, web, trace and desktop suites are clean.
- The running renderer shows the list against a service rebuilt from this branch. That view is a
  proxy.
