# Interface 10: Publications, and a publication

> **A sketch, by request**, built inline and test first. It is slice 10 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:**

- `#/publications` lists every publication the reader may read, in layout A.
- `#/publications/{id}` shows one in layout D (`Publication.png`): the publication itself on the
  document canvas, and what it was made from beside it.
- The module switcher offers Publications.

**Requirements:** none claimed. PUB-047 (a publication's own address) keeps its existing tests. The
list and the view are presentation over what `publishing.md` already answers.

## Rulings

- **Q5, settled as recommended: show the stored PDF, not an HTML rendition**, because it is exactly
  what was published.
  - It is shown by the browser's own PDF viewer in an `iframe`, not by pdf.js. A PDF viewer is
    built into every browser and Electron's Chromium, and pdf.js would add a dependency and its
    worker to the renderer for what the browser already does.
  - The bookmarks of the tagged PDF are the contents, so layout D's contents pane is left to the
    viewer.
  - This departs from the build order's pdf.js recommendation, for the reason above.
- **A second link, for viewing.** A publication's `download` link is signed with
  `Content-Disposition: attachment`, which a browser saves rather than shows. Each output gains
  `view`, signed for the same five minutes with no disposition. The object is stored as
  `application/pdf`, so it opens in place.
- **`GET /v1/publications` is unpaged**, as the documents list is. It is filtered by the one readable
  set, newest first, and each item is the existing `PublicationSummary`.

## Tasks

1. **Store and route:**
   - `listReadablePublications(trx, principal)` in `packages/db/src/publishing.ts`: the per-document
     query without the document;
   - `GET /v1/publications` (`listPublicationsEverywhere`), with rows in the route tables;
   - `view` beside `download` on each output.

   Tests in `publication-routes.test.ts`:
   - `lists every publication the caller may read, across documents, newest first`;
   - `opens a publication with a link that shows the PDF in place, beside the one that saves it`.

2. **Screens:**
   - `publishing/PublicationList.tsx` in `ListLayout`: Title, Version, Published, By and Approval
     (`Not approved`), with a Document facet counted in the renderer. Test in
     `PublicationList.test.tsx`: `lists each publication as a row, filters by document, and links each to its page`.
   - `PublicationPage` in layout D: the viewer `iframe` titled with the publication's title, on
     `--doc-canvas`, and the record on the right. Test:
     `shows the publication itself in the page, and what it was made from beside it`.
   - `Workspace` routes `#/publications`, and the header's module switcher gains Publications.

## Done when

- Lint, typecheck, format, and the db, service, contract, client, web, trace and desktop suites are
  clean.
- `trace.json` is regenerated last.
