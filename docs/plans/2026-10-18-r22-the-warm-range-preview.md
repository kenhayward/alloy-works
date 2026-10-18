# R22: The warm range preview

> T4's twenty-second slice, extending [publishing.md](../design/publishing.md). **Full tier**: a
> migration (0119), a new request kind, a process per open document in the worker, and new routes.
> Built inline, one final review at the slice's end. Decisions marked **(default)** are
> recommendations Ken may overturn; the rest are his answers of 2026-10-18.

**Goal:** a saved edit reflected in a preview of the section being edited within a budget on a
300-page document (CNT-151, then CNT-186), its incremental compile byte-identical to a clean one (PUB-076), untagged
by design and saying so (PUB-080), and bulk generation's budget stated (REU-049).

Two PRs: R22a (the warm compile, the range preview's job and routes, the budgets), R22b (the document
page's range pane, PUB-080 on screen) with the close.

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R22-A | **A warm `typst watch` per open range** (ADR-0013), PNG pages; the creation time pinned so a warm and a clean compile are the same bytes (PUB-076), tested page by page and for the tagged PDF.                                                                                                                                                                                           |
| R22-B | **The range is the section being edited and one page either side** (Ken): found once by compiling the document with the occurrence emptied and as it is; then the warm compile draws that window alone (default), its pages kept in Postgres and swept an hour after the last change (default).                                                                                           |
| R22-C | **Measured on CI's Linux runner** (Ken): GitHub Actions `ubuntu-latest`, 4 vCPU and 16 GB; every run records the time beside the machine, and over budget fails. From the save's commit to the pages recorded. CNT-151's second measured 1.2 s there, so Ken raised it to three seconds at p95, none above six (CNT-186), until every budget is weighed at the end of the implementation. |
| R22-D | **Untagged, and saying so** (Ken; PUB-080, PUB-061): each page's alternative text and the pane on screen say the pages are untagged and name Preview, which makes the tagged PDF.                                                                                                                                                                                                         |
| R22-E | **REU-049 claimed on the reference runner** (Ken): the 400-document run recorded beside the machine; production reporting arrives with ADM-016 (T7).                                                                                                                                                                                                                                      |

## Tasks

- **R22a**: `warm.ts`; 0119; the range job and pool; the four routes; the CNT-151 budget and the REU-049 record. Tests: PUB-076 page for page and the PDF; the range around the occurrence, the saved edit shown; the budget; PUB-080's words.
- **R22b**: the document page's range pane beside the text while editing, refreshed after each save; the browser walk; the final review; the close (0.193.0).

## Built

R22a #704 and R22b with the close (0.193.0) #705, as planned. Departures: `typst watch` rewrites pages
whose pixels did not change and lays the whole document out again at every save, so the warm compile
draws the occurrence's window alone (`--pages`), found once at the range's making; on CI's runner a
save took 1.2 s against CNT-151's one, and Ken raised the budget to three seconds (CNT-186) until every
budget is weighed at the end of the implementation. The final review found a failed range that never
recovered on the page, a warm compile reused after a failed attempt, closes that could leak a process,
a failure that swallowed a newer save, a stale page total, and the page asking for two ranges at once;
all fixed. Left: the window stays where it was found; the page total is the one the range was made
with; one job at a time per worker, so a publish delays a refresh; a range whose first job never runs is
never swept; the page's follow and reading of the pictures are outside the measure.
