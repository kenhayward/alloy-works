# Publishing engine spike

> **Status: gates run; cases 5 to 9 not yet run.** Findings are in
> [`Publishing_Engine_Spike_Findings.md`](Publishing_Engine_Spike_Findings.md). The brief for the
> second irreversible decision named in [`Project_Scope.md`](Project_Scope.md) §10. It follows the shape of
> [`Content_Model_Spike.md`](Content_Model_Spike.md), which worked: hard cases, named gates, a
> written finding per case, and a decision record either way.

## 1. What this spike decides

Which open-source engine paginates and renders this product's PDF, and what has to be built around
whichever one wins.

[ADR-0007](../decisions/0007-no-per-server-licensing-in-the-publishing-pipeline.md) has already
removed the commercial options. So the question is not "which engine is best" - it is:

> **Which of WeasyPrint, PagedJS, Typst and headless Chrome gets closest to the fidelity bar, what
> does it fail at, and is what remains something we can build rather than something we have to buy?**

The last clause matters. A finding that no candidate reaches PDF/UA without a tagging layer of our
own is a legitimate outcome, and it is the finding most likely to send ADR-0007 back for review.

## 2. Candidates

| Engine              | Consumes                 | Known strength                      | Known doubt                                                         |
| ------------------- | ------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| **WeasyPrint**      | HTML + CSS Paged Media   | Tagged PDF and PDF/UA support exist | CSS support behind a browser; maths needs pre-rendering             |
| **PagedJS**         | HTML + CSS, in a browser | Browser-grade CSS fidelity          | Tagging is whatever the browser's PDF export gives, which is little |
| **Typst**           | Typst markup             | Typography and native maths         | Tagging immature; **does not consume XHTML** - see §6               |
| **Headless Chrome** | HTML + CSS               | CSS fidelity, ubiquity, speed       | Effectively no tagging; footnotes unsupported                       |

## 3. Inputs, not questions

- **ADR-0005**: XHTML is the defined publishing intermediate.
- **ADR-0007**: no per-server licence.
- **[PUB](requirements/PUB-publishing-and-output.md)**, particularly PUB-002 (resolution order),
  PUB-006 (preview shares the pipeline), PUB-016 to PUB-022 and PUB-030 to PUB-036.
- **[STY](requirements/STY-styles-and-presentation-themes.md)** §11: typefaces available in a
  browser, in the desktop shell, and in the pipeline, and failing rather than substituting.

## 4. The cases

Each is built against every candidate, with a written finding. Four are **gates**: a candidate that
fails one is not viable without something being built, and what that something costs is the finding.

### Case 1 - Tagged PDF meeting PDF/UA _(gate)_

A section with headings, a list, a table with header cells, a figure with alternative text, and a
passage in a second language.

- **Tests:** reading order, table header association, alt text, document and passage language, and
  structure exposed as structure.
- **Pass:** an automated PDF/UA checker reports conformance. Not "mostly" - the requirement in
  PUB-030 has no partial credit.

### Case 2 - Footnote on the page carrying its anchor _(gate)_

A footnote anchored near a page break, and a second footnote long enough to split.

- **Tests:** whether the engine places footnotes at all, and what it does when one does not fit.
- **Pass:** the note appears on the page carrying its anchor, and a note that does not fit continues
  rather than being dropped or moved wholesale.

### Case 3 - A table breaking across pages _(gate)_

A forty-row table with a header row, crossing three pages, with a caption and a cell-anchored
footnote.

- **Tests:** repeated headers, continuation labelling, keep-together, and whether the cell footnote
  lands on the right page.
- **Pass:** headers repeat, the caption is not orphaned, and the footnote is on the page carrying its
  cell.

### Case 4 - Incremental rendering for preview _(gate)_

Render page 40 of a 300-page document without rendering the first 39 for the reader.

- **Tests:** the tension between PUB-006 and CNT-096 head-on. Pagination is inherently sequential, so
  the question is whether an engine can be driven to produce a range, or resume from cached layout
  state.
- **Pass:** a page range renders in a time that would be usable while writing, from the same pipeline
  as a full publish. **If no candidate passes, PUB-006 or CNT-096 has to change**, and saying which
  is part of the finding.

### Case 5 - Mathematics

An equation in running text, in a heading, in a table cell and in a footnote, one of them numbered.

- **Tests:** whether maths renders natively, or must be pre-rendered to SVG, and whether the
  pre-rendered form survives tagging and text extraction.
- **Pass:** all four positions render correctly, and the equation is reachable by assistive
  technology through its textual alternative (CNT-048, PUB-030).

### Case 6 - Running heads, numbering and front matter

A document with roman-numbered front matter, arabic body numbering restarting at the first chapter,
running heads carrying the current section, and an appendix in its own scheme.

- **Tests:** the layout requirements in PUB-007 to PUB-011 against what CSS Paged Media or the
  engine's own model actually supports.
- **Pass:** every element of a realistic layout is expressible without a workaround that would have
  to be repeated per document.

### Case 7 - Typefaces and embedding

A theme declaring two typefaces, one of them unavailable.

- **Tests:** embedding, subsetting, and behaviour when a face cannot be loaded.
- **Pass:** faces embed, and a missing one **fails** rather than silently substituting (STY-040).

### Case 8 - The 300-page document

A realistic report: 400 components, 60 figures, 40 tables, 200 footnotes, a generated contents, a
list of figures and a bibliography.

- **Tests:** wall-clock time, memory, and whether time grows worse than linearly with length.
- **Pass:** inside the publish budget in scope §11, at whatever provisional number exists.

### Case 9 - Determinism

The same input rendered twice, on two machines.

- **Tests:** PUB-043. Fonts resolving differently, timestamps, and internal identifiers are the usual
  culprits.
- **Pass:** byte-comparable output once declared non-deterministic fields are excluded, and the set
  of those fields is short and stated.

## 5. Scoring

| Cases          | Role        | Rule                                                                                                                       |
| -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| **1, 2, 3, 4** | Gates       | A failure is not disqualifying by itself - it is a cost. The finding must say what would have to be built, and estimate it |
| **5, 6, 7, 9** | Correctness | May pass with work. Record the cost                                                                                        |
| **8**          | Budget      | A miss is a scope question, not a tuning exercise                                                                          |

**This differs from the content model spike deliberately.** There, a gate failure superseded the
decision record. Here, ADR-0007 has already fixed the candidate set, so a gate failure is
information about what remains to be built - and if every candidate fails the same gate, that is the
finding that sends ADR-0007 back rather than any single engine.

## 6. The structural question the spike must surface

**ADR-0005 makes XHTML the publishing intermediate.** WeasyPrint, PagedJS and headless Chrome all
consume HTML and CSS, so they sit behind that intermediate naturally. **Typst does not** - it
consumes its own markup.

Choosing Typst would therefore mean either emitting Typst directly from the content model, bypassing
the intermediate, or carrying two intermediates. Neither is free, and both touch a decision already
taken. The spike must state this cost explicitly in Typst's finding rather than leaving it to be
discovered by whoever implements it.

## 7. What the spike produces

1. A worked artifact per case per candidate, as tests, reusable afterwards as a **regression suite**
   for whichever engine wins.
2. A written finding per case per candidate: pass, pass with cost, or fail - with the cost named.
3. **A recommendation**, with what has to be built around it and a rough size for that work.
4. An answer to PUB-Q04: whether preview can share the pipeline, and if not, which of PUB-006 and
   CNT-096 changes.
5. A statement of what the choice costs the typography, so that STY's promises are made against
   something real.
6. An architecture decision record, and either a confirmation of ADR-0007 or a case for revisiting it.

## 8. Out of scope

A publishing pipeline, a real layout, the resolve stage, Word output, and any code beyond the test
harness and the artifacts. The engine decision is the deliverable; everything built to reach it is
throwaway except the case set.
