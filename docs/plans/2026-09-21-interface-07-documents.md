# Interface 7: Documents

> **A sketch, by request**, built inline and test first. It is slice 7 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** `#/documents` shows `docs/interface/screens/Documents.png` in layout A:

- a filter pane with Space and Publishing, each option with its count;
- `h1` Documents, with `New document` as the primary button opening the existing form in the modal;
- a summary line;
- a table with the columns Title, Space, Version, Sections, Components, Publishing and Changed.

**Requirements:** none claimed. SCH-019 is still only part answered (no sort), and the existing
document list tests keep their citations.

## Rulings

- **The list stays unpaged**, as `listReadableDocuments` already says it deliberately is. Because it
  is whole, **the filters are counted and applied in the renderer**, over rows the service already
  filtered by the readable set. No count can promise a row the reader may not see. Paging, and
  server-side facets with it, arrive together when document counts need them. The build order named
  paging for this slice, and it is deferred here.
- **The publishing state is the reader's own view:**
  - `published` when the latest publication they may read was made from the latest version;
  - `changedSince` when it was made from an earlier one;
  - `neverPublished` when they may read none.

  A publication's readership is its own (the publication screen says so). So a reader who may see no
  publication is told "Never published", which is true of what they can see.

- **Sections and components are counted over the whole outline**, at every depth, from the latest
  version. A component referenced twice counts twice, because the column counts references.
- **No Layout facet.** The listing does not carry the layout, and one layout per environment is all
  that exists.

## Tasks

1. **The store:** `listReadableDocuments` items gain:
   - `changedAt: Date`;
   - `sections: number` and `components: number`, from `jsonb_path_query_array` over
     `$.**.type`;
   - `publishing: 'published' | 'changedSince' | 'neverPublished'`.

   Tests in `documents.test.ts`:
   - `says of each document when it changed and how many sections and component references its outline holds`;
   - `says whether the reader's latest publication of a document is of its latest version, an earlier one, or none`.

2. **The route:** `DocumentList` items gain the same fields, `changedAt` as ISO. Regenerate
   `openapi.json` and the client. Service test:
   `lists each document with its last change, its outline's counts and its publishing state`.
3. **The screen:**
   - `DocumentList` goes into `ListLayout`, with the table, the summary line
     `{n} documents you may read.`, the client-side facets with `Clear`, the primary
     `New document` and the modal;
   - `publishing` renders as a `Lozenge` saying `Published`, `Changed since` or `Never published`.

   `DocumentList.test.tsx`:
   - `shows each document as a row: title linking to it, space, version, sections, components, publishing state and when changed`;
   - `filters by space and by publishing state, counting each, and clears`.

   The workspace test's list fixture fills in the new fields, as slice 3's did.

## Done when

- Lint, typecheck, format, and the db, service, contract, client, web, trace and desktop suites are
  clean.
- `trace.json` is regenerated last.
- The list has been looked at in the running renderer. That view is a proxy.
