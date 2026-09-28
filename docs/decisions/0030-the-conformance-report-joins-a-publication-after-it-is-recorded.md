# 0030 - The conformance report joins a publication after it is recorded

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Two T1 requirements pull against each other:

- **PUB-091:** every PDF publication is checked by veraPDF against its PDF/UA-1 profile as part of
  publishing, with the report retained.
- **PUB-085:** a declared 300-page reference document publishes, from the request to the recorded
  publication, at or under ten seconds at p95.

publishing.md measured a cold veraPDF at 11.2 seconds a page, so the check cannot sit inside a
ten-second publication of 300 pages. Ken deferred the choice in the publishing design.
[The T1 audit](<../reviews/T1 - Audit against the code.md>) asked for it again as K5.

A warm veraPDF, as the worker's test suite runs it since W1.1, is much faster, but it is still a second
long-lived service to run in production, and still not inside ten seconds for 300 pages.

## Decision

**A publication is recorded when its PDF is stored, and its veraPDF report joins it afterwards**,
within a stated bound of five minutes.

- The check is still part of publishing: the same job runs it, and the report is retained with the
  publication (PUB-091 unchanged).
- A publication whose report has not arrived says so. One whose report found failures says that too,
  plainly, on its page.
- **PUB-085 is superseded by PUB-102**, which measures from the request to the recorded publication and
  says the conformance report may join it within five minutes.

## What would change the answer

- **A checker fast enough to fit the budget.** Then the report would arrive with the publication.
- **A customer for whom a publication without its report is not yet a publication.** Then the report
  goes inside the measured span, and the budget grows to fit it.

## Consequences

- W14 runs veraPDF on every publication in production, in the worker, after recording.
- Between recording and the report there is a window of at most five minutes in which a publication
  exists unchecked. Its page says so, and nothing in T1 approves a publication in that window: every T1
  publication is a draft.
