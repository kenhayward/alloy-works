# 0082 - The Versions panel is a timeline of what the system holds

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Claude Design drew a Versions panel on 4 November 2026 ([the handoff](../interface/handoffs/versions-panel/README.md)):
a timeline by day with compare, one version's view, search and a graph. Parts of it assumed acts and facts the system
does not have. [The plan](../plans/2026-11-04-ls-vp-lifecycle-states-and-versions-panel.md) checked it against the
requirements and the code; D6 to D11 are Ken's rulings. [ADR-0081](0081-lifecycle-states-are-lozenges.md) settled that a
version has no state.

## Decision

1. **Actions are neutral, Compare in accent.** A green compare or an orange Restore would say Approved and Warning, and
   ADR-0046 keeps a status colour to its status (D6).
2. **Nothing is drawn that the system cannot do.** No editing a note (`artifact_version` is insert-only), no pinning to a
   baseline (a baseline is of the latest), no generating a PDF of an old version: Download only follows a publication
   that already names it. Signatures read as Approvals, the rows `workflow_approval` has (D7).
3. **A document's comparison is its outline, values and parameters** (`GET /v1/documents/{id}/comparison`), since that
   is what its version records. The text of a tracking reference has its own chain (D8).
4. **A revision's standing is computed when read**, from every line but a language's, as `effectiveAt` reads them
   (`revisionStanding`), so it cannot disagree with what is effective.
5. **No virtualising until measured** (D9). Older rows come by a button, a cursor at a time. Measured in Chromium on a
   development build at 500 versions and 60 other rows, 400px wide: drawn in about 300ms, every day folded or opened
   in under 400ms, 8,900 nodes. Typing cost 251ms a key until the search box held its own text, then 1ms.
6. **The activity graph is on its own route and is one control** (D10): a slider moved by the arrow keys that says each
   week in words, not 52 buttons. It stands of itself from 20 versions in the last year; hiding or showing it is
   remembered per browser and artifact.
7. **Baselines and publications are rows of a document's timeline, not badges on a version** (D11). A baseline names a
   version but pins the component versions of its own moment, so two on one version may hold different text.
8. **Search, person and only revisions narrow on the service and show versions alone**, as those filters mean nothing
   of the other rows. Only baselines and only publications narrow on the page. Go to a date moves all three, reading
   back up to five pages of publications before leaving the rest to the older button.

## What would change the answer

- **Real histories past a few hundred versions a session** would make a virtual list worth its cost to sticky headers
  and focus. Measure first: rows arrive a page at a time.
- **An act the system gains**, such as generating a past version's PDF, adds its action here. Nothing about the
  timeline's shape stands in the way.
- **A wish to narrow baselines and publications by person or text** would need their routes to take those filters.
- **"Only deliveries"**, drawn in the handoff, was left out: which versions a bridge delivered is not on the list's read,
  and asking per row is not worth one filter. It comes back if a bulk read of it appears.

## Consequences

- The panel reads three streams, versions, baselines and publications, and shows rows only down to the older of the last
  rows read, so a row never appears out of order.
- A narrowed list keeps its old rows until the answer arrives, or the search box would lose focus on each search.
- `GET .../versions` takes `q`, `before`, `author` and `only`, and each artifact gains `GET .../activity`.
