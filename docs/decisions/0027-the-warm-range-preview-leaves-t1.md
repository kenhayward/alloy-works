# 0027 - The warm range preview leaves T1

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

T1 asks for two previews. **The whole-document preview** (CNT-150, PUB-005, PUB-006) is a PDF of the
document as it will be published, made by the publishing pipeline and marked as unapproved.
**The warm range preview** (CNT-151, with CNT-096 and PUB-080) must reflect a saved edit within one
second, and never more than two, in a 300-page document.

[ADR-0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md) and
[ADR-0019](0019-platform-typescript-service-publishing-workers-object-storage.md) shaped the warm range
preview as `typst watch` kept running for every open document, on a preview worker. publishing.md
measured what that costs and what it forces:

- **Memory.** ADR-0013 measured about 1.7 MB a page. A warm 300-page document holds about half a
  gigabyte, so a preview worker holds a handful of open documents and needs a cap and an eviction
  order. Nothing else in T1 runs a process per open document.
- **Tagging.** `--pages` makes Typst drop tagging, and PDF/UA-1 then refuses the compile. A range's
  pages have to reach the renderer as images, each with alternative text saying it is an untagged
  preview and naming the tagged PDF (PUB-061, PUB-080).
- **The measurement.** CNT-151's number is provisional until the reference configuration is named
  (CNT-Q13). T1's baseline would be answerable for a budget that nobody has settled.

Three things were measured or found that make the warm preview worth less than it costs in T1:

- **The editor saves two seconds after the author stops typing** (component-editor.md). A preview fed
  from saved state already trails the last keystroke by two seconds before any compile starts, which
  is why CNT-151 measures from the save.
- **A cold compile is fast.** The first publishing slice compiled 432 pages with contents and
  footnotes in 1.3 seconds, container start included. What a whole-document preview adds to that is
  assembling the document and a job being claimed, not Typst.
- **The whole document is tagged.** A whole-document preview is a tagged PDF like a publication, so
  it needs none of PUB-080's accessibility workaround.

[The T1 audit](<../reviews/T1 - Audit against the code.md>) asked for this decision as K2 and
recommended taking the warm range preview out of T1. Ken took that option on 2026-09-27.

## Decision

**The warm range preview leaves T1.** T1's preview is the whole-document preview alone: a request
of its own kind, run by the publishing job, compiled whole and tagged, marked **Preview - not
approved**, and shown on the document page.

- **CNT-151 and PUB-080 move to T3** whole, keeping their identifiers. T3 is where the editor next
  changes, with presence and soft locks. That is when many authors hold one document open at once,
  and when the number of warm compilations a worker can hold becomes a capacity question.
- **CNT-096 is withdrawn.** It asks for a preview fast enough to use while writing, against
  CNT-151's budget. That is CNT-151 again, so it adds nothing to test.
- **No preview worker is built in T1.** system.md's preview workers stay the design for T3.
  ADR-0013 and ADR-0019 still hold: this record defers what they chose, and does not reverse it.

## What would change the answer

- **The whole-document preview proves too slow to use.** W10 measures it on a 300-page document. If an
  author waits long enough to stop using it, a faster preview is back in T1's scope. The first thing to
  try would be a cold range compile, before any warm process.
- **A customer for T1 edits long documents against a page count**, where seeing pagination as they type is
  the work itself. Then the warm preview is the product, and it comes back with its cost accepted.
- **Typst learns to tag a page range.** Then a range preview is a tagged PDF, the image path and
  PUB-080 both fall away, and only the memory cost is left to weigh.

## Consequences

- W10 is one design slice and the whole-document preview, not a preview worker. The half gigabyte per
  open document, its eviction and its measurement harness are T3's.
- CNT-Q13, the reference configuration, stays open, and moves with CNT-151.
- PUB-061 stays a constraint. Nothing in T1 makes an untagged preview, so nothing in T1 tests it
  beyond the publication path's refusal of `--pages`.
- An author sees the document as it will print by asking for a preview and waiting for a compile.
  They do not see it change as they type.
