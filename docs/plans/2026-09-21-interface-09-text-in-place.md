# Interface 9: the document's text, and each component edited in place

> **A sketch, by request**, built inline and test first. It is slice 9 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** the document page's middle column (slice 8) shows each component's text under its number,
not only its title. Any one of them can be edited there in place, with the editor the component page
already uses. Structure and content are one screen (decision A5).

**Requirements:** none claimed. Editing in place reuses `ComponentEditor` unchanged, so its CNT
citations and its lock and save behaviour are the ones already verified. What is new is a read route
and a render.

## Rulings

- **One call for the whole text:** `GET /v1/documents/{id}/texts`.
  - It resolves occurrences with the same `numberingInputs` the contributions and numbering routes
    use, so a component the reader may not read is never read, and its occurrence answers `null`.
  - It answers each resolved version once, with its content:
    `{ document, version, occurrences: [{ node, version }], versions: [{ id, content }] }`.
- **The text is rendered, not mounted.** `packages/editor` gains `renderContent(content)`: the
  content document through `toEditor` and ProseMirror's `DOMSerializer`, into a fragment. No
  `EditorView` is made, so a hundred cards cost no more than their markup.
  - Content the editor cannot show says `This component holds content this editor cannot show yet.`
- **One editor at a time.** A card's `Edit` puts `ComponentEditor` in the card. `Close` puts the text
  back and reads the texts again. Editing another card closes the first, whose editor flushes on
  unmount as it always has.
  - The lock is the editor's own. It is claimed on the first change, never on opening.
  - A reference the reader may not edit still opens: the editor says it is read-only in its own
    words.
- **`DocumentPage` takes `principalId`** from the workspace, for the editor.

## Tasks

1. **Route.** The contract gets `getDocumentTexts` and `DocumentTextsView`. The db gets
   `versionContents(trx, ids)`, one query. The service handler uses `numberingInputs`.
   - Tests in `document-routes.test.ts`:
     `answers each readable occurrence's version with its content, and null for one the caller may not read`.
   - The route-table tests (access and cross-tenant) gain their rows.
2. **`renderContent`** in `packages/editor`. Test:
   `renders a component's content as markup, marks and lists included, without a view`.
3. **`DocumentText`** takes `texts` (node to rendered content, or unknown), `editing` and `onEdit`. It
   renders the text in each card, with `Edit` and `Close`. `DocumentPage` reads the texts and holds
   which card is being edited. Tests:
   - `DocumentText.test.tsx`: `shows each component's text in its card, and a component's editor in place of its text when asked`;
   - `DocumentPage.test.tsx`: `reads the document's text in one call and edits one component in place at a time`.

## Done when

- Lint, typecheck, format, and the db, service, contract, client, editor, web, trace and desktop
  suites are clean.
- `trace.json` is regenerated last.
