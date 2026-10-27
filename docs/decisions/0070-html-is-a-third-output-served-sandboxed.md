# 0070 - HTML is a third output, served sandboxed

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

PUB-056 asks for HTML as a reading format. Every output so far is a PDF or a Word document, which a
browser shows in its own viewer or saves. An HTML publication is tenant content a browser renders as a
page, so where it is served decides what it can reach. [ADR-0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md)
named XHTML the natural source of an HTML format; [ADR-0015](0015-word-output-our-own-writer-reflowable.md)
set the model of a second writer from the same published document. The
[HT plan](../plans/2026-10-27-ht-html-reading.md) holds the detail.

## Decision

- **A third writer, platform-free**: `writeHtml` in `packages/domain`, from the published document
  and an input beside it, as Word's. One self-contained file: styles, images and faces inline,
  nothing fetched, no script, a meta CSP in the file.
- **Pagedness is a format's kind**, not a stored flag: `pdf` and `docx` are paged, `html` is not.
- **Served inline only through the service, sandboxed**: the output route answers `html` inline, to
  readers inside the organisation, under a CSP with `sandbox` and `default-src 'none'`, never cached.
  The object store's signed links always carry `attachment`, so no tenant's HTML renders on the
  store's origin, and the desktop window never loads it.

## What would change the answer

- **A reader needing interaction** (search, collapsible notes) that cannot be done without script.
- **Size**: if inlined faces make files too large to read on a phone, a zip or subsetting.

## Consequences

- Any later output a browser renders (EPUB, a web view of a document) goes through the same route and
  headers.
- The desktop app offers HTML as a download, not a view.
