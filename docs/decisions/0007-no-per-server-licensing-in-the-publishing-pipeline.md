# 0007 - No per-server licensing in the publishing pipeline

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §4 states an entry requirement rather than a
differentiator: **published output must be indistinguishable from what the organisation produces
today.** §11 adds that PDF output must be tagged and meet PDF/UA, which in this market is frequently
a legal requirement rather than a preference. [PUB](../specification/requirements/PUB-publishing-and-output.md)
turns both into fifty-six requirements.

The two engines that reliably do PDF/UA tagging, footnote placement on the page carrying the anchor,
table breaking with repeated headers, and mathematics together are **Prince** and **Antenna House**.
Both are licensed per server, at a cost that can run to five figures a year and scales with
deployment rather than with revenue.

The open alternatives - **WeasyPrint**, **PagedJS**, **Typst**, headless Chrome - are free and each
falls short somewhere that matters here. Which of those shortfalls is fatal is not known, and is the
subject of a spike.

Scope §13 named publishing engine licensing as a risk in its own right, with the note that a
commercial engine's cost can dominate unit economics. §14 records the reverse: that a commercial
licence entering the cost model raises the minimum viable customer size.

## Decision

**The publishing pipeline uses open-source components. No per-server, per-document or per-seat
commercial licence enters the rendering path.**

Consequences that follow directly:

- **The candidate set is WeasyPrint, PagedJS, Typst and headless Chrome**, and a spike decides
  between them against the cases the fidelity bar actually depends on.
- **Whatever a chosen engine does not do, this product builds.** The likeliest candidate for that is
  PDF/UA tagging, which is where open engines are weakest and where the requirement is least
  negotiable.
- **Self-hosting stays possible.** A per-server licence would have made an on-premises deployment a
  commercial negotiation as well as a technical one, which matters given that
  [IAM-Q04](../specification/requirements/IAM-identity-tenancy-and-access-control.md) and
  ADM-Q01 both point at customers with data residency requirements.
- **Unit economics stay clean.** Cost per tenant does not carry a licence, so the minimum viable
  customer is set by what the product does rather than by what it pays to render a page.

## What would change the answer

- **PDF/UA proves unreachable, or reachable only by building a tagging layer that is itself a
  project.** This is the likeliest of the three, and §14 of the scope already anticipates it: a
  commercial licence entering the cost model raises the minimum viable customer size, which is a
  commercial change rather than only a technical one.
- **A customer contract names a conformance level only a commercial engine reaches.** PDF/A levels
  and some submission profiles are specific, and "close enough" is not a category regulators use.
- **The build cost of the gap exceeds the licence.** Building and maintaining a tagging layer has an
  ongoing cost that a licence does not, and a year of it may buy several years of Prince.

Note what does **not** change the answer: typographic taste. A commercial engine sets better type,
and that is not the bar - the bar is what the organisation produces today, which is Word.

## Consequences

- **The fidelity bar becomes the dominant risk in the product**, replacing licensing cost. Scope §13
  is updated to say so, because a risk that has been traded for another risk should not read as one
  that has been retired.
- **The spike's test set becomes a permanent regression suite**, whichever engine wins. The cases
  that discriminate between engines are the same cases that catch a regression in the one chosen.
- **A structural question is opened rather than settled.** ADR-0005 makes XHTML the defined
  publishing intermediate, which suits WeasyPrint and PagedJS and does not suit Typst - Typst
  consumes its own markup. Choosing Typst would mean either emitting it directly from the content
  model or carrying a second intermediate, and neither is free. The spike must surface this rather
  than discover it.
- **[PUB-Q04](../specification/requirements/PUB-publishing-and-output.md) becomes a gate rather than
  a question.** PUB-006 requires preview to use the same pipeline as publishing and CNT-096 requires
  preview to be fast; an engine that cannot render a page range incrementally makes those two
  incompatible, and resolving that with a second rendering path is what PUB-006 exists to forbid.
