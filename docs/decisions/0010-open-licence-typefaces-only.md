# 0010 - Open-licence typefaces only

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 carried fonts as an open question from
the earliest architecture work, with two halves. The technical half: one typographic system has to
work in a browser tab, in the Electron shell loading over `file://`, and in whatever renders the PDF.
The commercial half:
[STY-041 and STY-042](../specification/requirements/STY-styles-and-presentation-themes.md) require a
theme to record the licence a typeface is held under and to refuse to embed one where the licence
does not permit it - which raises the question of who holds that licence.

Embedding a typeface in a published document is a licensed act. A desktop licence does not usually
cover it; a server or embedding licence does, and is priced per application, per domain or per title.

That is the same shape as the decision already taken in
[ADR-0007](0007-no-per-server-licensing-in-the-publishing-pipeline.md): a recurring,
deployment-scaled licence in the rendering path.

## Decision

**Typefaces the product supplies are open-licence, and nothing else. A customer's brand typeface is
supplied by the customer, under the customer's own licence.**

- **Product-supplied faces are SIL Open Font Licence**, which permits embedding in published output
  and redistribution with the software.
- **A tenant may upload its own faces**, asserting the licence it holds them under. STY-041 records
  it and STY-042 refuses to embed where it does not permit embedding. The product never
  redistributes an uploaded face beyond the tenant that supplied it.
- **The default theme's faces are chosen for coverage as much as for looks.** Body and heading faces
  from the open ecosystem; **Noto for script coverage**, because a face that cannot set Arabic makes
  LOC-004 undeliverable; and **STIX Two Math**, because CNT requires equations in running text, in
  headings, in cells and in footnotes.
- **Faces are self-hosted and referenced relatively.** A content delivery network is unavailable to
  the desktop delivery over `file://` and unreliable offline, so the files ship with the renderer and
  are read from disk by the publishing pipeline.

## What would change the answer

- **The bar moving from "as good as Word" to "as good as a design studio".** Scope §4 sets the
  fidelity bar at what the organisation produces today, and that is Word. A customer who wants
  better typography than open faces allow can supply their own.
- **A customer's brand licence forbidding upload to a hosted service.** Some foundry licences do.
  That is a conversation between the customer and their foundry, and the product's position is to
  record what they assert rather than to arbitrate it.
- **An open face turning out to be encumbered.** Rare and not impossible, and the answer is the same
  as for any dependency: replace it.

## Consequences

- **A gap in the requirements is exposed and must be closed.** STY-028 pins a theme version in a
  baseline, and PUB-046 requires re-publishing a baseline years later to produce the same document.
  Those two are only compatible if **the baseline pins the typeface files themselves** - a theme
  version pointing at a font file that has changed or gone away breaks reproducibility silently,
  which is exactly the class of failure this specification keeps finding. Typefaces become versioned
  artifacts that a baseline pins.
- **The open ecosystem constrains what a theme can promise**, and STY's requirements are written
  against something real rather than aspirational.
- **Unit economics stay independent of what is published**, consistent with ADR-0007. There is no
  per-title or per-domain fee in the path between a document and a reader.
- **Font licence metadata is a real field with real behaviour**, not documentation. STY-042 refusing
  to publish is the enforcement, and it needs a licence recorded to enforce against.
