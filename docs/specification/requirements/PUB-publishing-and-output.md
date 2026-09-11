# PUB - Publishing and output

> **Status: v1, for review.**

## 1. Purpose

Turning a document into an artifact somebody receives. This area owns the publishing pipeline, the
layouts that govern the page, the PDF and Word outputs that set the fidelity bar, the accessibility
of what comes out, and the publications kept afterwards.

The scope makes a claim this area either honours or fails: **published output must be
indistinguishable from what the organisation produces today.** It is the first thing a prospect
tests, and typography, pagination, table breaking and footnote placement are not polish.

## 2. Depends on

| Rests on                                               | What it fixes                                        |
| ------------------------------------------------------ | ---------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.10, §11   | The pipeline stages, the fidelity bar, accessibility |
| [STR](STR-structure-numbering-and-cross-references.md) | Numbering and references computed over the outline   |
| [STY](STY-styles-and-presentation-themes.md)           | What things look like; typefaces and their licences  |
| [DAT](DAT-data-connectivity-and-bindings.md)           | Resolved values and their provenance                 |

| Not here                                | There   |
| --------------------------------------- | ------- |
| What a style declares                   | **STY** |
| How numbers and references are computed | **STR** |
| What a baseline is                      | **VER** |
| Which theme and layout a document uses  | **TPL** |
| Whether a reader may open a publication | **IAM** |

## 3. The pipeline

Publishing is a pipeline with named stages, not a print stylesheet. The order is not an
implementation preference: [STR](STR-structure-numbering-and-cross-references.md) shows that
conditions must be applied before numbering, or an audience reads a report whose figures skip a
number, and before references, or a reader is told to consult something they were not sent.

| ID          | Requirement                                                                                                                                               | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-001** | Publishing must run as four named stages - resolve, compose, paginate, render - each able to fail with diagnostics naming the stage                       | T1         | Specified |
| **PUB-002** | Resolve must apply transclusion, conditions, variables and bindings **before** numbering, cross-references and citations                                  | Constraint | Specified |
| **PUB-003** | The resolution order must be fixed, stated, and covered by a test, because every part of it has a failure that is invisible in the output                 | T1         | Specified |
| **PUB-004** | An approved publication must be produced from a baseline, never from a live document                                                                      | Constraint | Specified |
| **PUB-005** | A preview may be produced from a live document, and must say plainly that it is a preview of unapproved content                                           | T1         | Specified |
| **PUB-006** | Preview must use the same pipeline as publication, so that what a preview shows is what publishing will produce                                           | T1         | Specified |
| **PUB-061** | A preview of a page range may be untagged where the engine cannot tag a partial document, but a publication must never be                                 | Constraint | Specified |
| **PUB-062** | Content must reach the publishing engine as data and never as source in the engine's own language, so that no content, however it is written, can execute | Constraint | Specified |

**PUB-006 is the requirement that makes CNT-095 worth having.** A preview rendered by a different
path is a second implementation of the hardest part of the product, and the two will disagree
exactly when it matters.

## 4. Publishing layouts

| ID          | Requirement                                                                                                                                                       | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-007** | A layout must declare page size, orientation, margins and gutter                                                                                                  | T1      | Specified |
| **PUB-008** | A layout must declare running heads and feet, with fields for at least the document title, the current section, the page number, the total pages and the revision | T1      | Specified |
| **PUB-009** | A layout must declare page numbering, including restarts and a different scheme for front matter                                                                  | T1      | Specified |
| **PUB-010** | A layout must declare the front and back matter a document carries: cover, approval page, contents, appendices                                                    | T1      | Specified |
| **PUB-011** | A layout must declare the numbering schemes **STR** applies to sections, figures, tables and equations                                                            | T1      | Specified |
| **PUB-012** | A layout must be able to differ per output format, because a page has no meaning in some of them                                                                  | T1      | Specified |
| **PUB-013** | A layout must be a versioned artifact, and a baseline must pin the layout version it published under                                                              | T3      | Specified |
| **PUB-014** | A layout must declare which output formats it supports, and publishing to one it does not must be refused rather than approximated                                | T1      | Specified |

## 5. PDF

| ID          | Requirement                                                                                           | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-015** | PDF must be a first-class output and must meet the fidelity bar in scope §4                           | T1      | Specified |
| **PUB-016** | A footnote must appear on the page carrying its anchor                                                | T1      | Specified |
| **PUB-017** | A table breaking across pages must behave as its table style declares (**STY-013**)                   | T1      | Specified |
| **PUB-018** | Widow and orphan control, keep-with-next and keep-together must be honoured                           | T1      | Specified |
| **PUB-019** | Typefaces must be embedded, subject to the licence recorded with the theme (**STY-041**, **STY-042**) | T1      | Specified |
| **PUB-020** | PDF/A must be producible where a layout declares it, for archival and submission                      | T3      | Specified |
| **PUB-021** | The document outline must appear as PDF bookmarks                                                     | T1      | Specified |
| **PUB-022** | Cross-references and citations must be internal links                                                 | T1      | Specified |

## 6. Word

| ID          | Requirement                                                                                                                                                                                            | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **PUB-023** | Word must be a first-class output, not a convenience export                                                                                                                                            | T1         | Specified |
| **PUB-024** | Heading numbers must be carried as a numbering definition Word understands, never as literal text in a heading                                                                                         | T1         | Specified |
| **PUB-025** | Footnotes must be real Word footnotes, numbered by Word                                                                                                                                                | T1         | Specified |
| **PUB-026** | Cross-references must be fields Word can update, not the numbers they resolved to                                                                                                                      | T1         | Specified |
| **PUB-027** | Styles must map to Word styles, so that a recipient can restyle the document rather than receiving direct formatting                                                                                   | T1         | Specified |
| **PUB-028** | Suggestions should be exportable as Word tracked changes, and Word tracked changes should be importable as suggestions (**COL**, **IMP**)                                                              | T6         | Specified |
| **PUB-029** | Word output must be verified by opening it in Word, as a standing practice rather than a one-off, and every material change to the emitter must be re-verified                                         | T1         | Specified |
| **PUB-065** | Word output must carry the resolved document's content, numbering and cross-references and leave pagination to Word; the PDF is the output a page number cites, and the publication record must say so | Constraint | Specified |
| **PUB-066** | Contents, lists of figures and tables, and page references in Word output must be fields that Word refreshes when the document opens, never page numbers copied from the PDF                           | Constraint | Specified |
| **PUB-067** | Equations in Word output must be native Word equations built from the same structure as the PDF's, never images and never a second conversion of the source                                            | T1         | Specified |

**PUB-065 and PUB-066 are the price of Word being editable, stated rather than discovered.** Word lays
out its own pages and a recipient's first edit reflows the rest, so the Word document can never be
relied on to share the PDF's pages - and a page number copied across from the PDF would look finished
and be wrong. See [ADR-0015](../../decisions/0015-word-output-our-own-writer-reflowable.md).

**PUB-029 is a process requirement in a requirements document, deliberately.** The content model
spike learned it the expensive way: a round-trip test that reads its own output can only prove that
our reader and our writer agree with each other, and it passed while producing a document any reader
would have called wrong. For a format whose consumer is another vendor's application, self-consistency
is not the bar and never becomes it.

## 7. Accessibility

| ID          | Requirement                                                                                                                     | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-030** | PDF output must be tagged and must meet PDF/UA                                                                                  | T1      | Specified |
| **PUB-031** | Reading order must follow the document's own order, not the order things happen to be laid out in                               | T1      | Specified |
| **PUB-032** | Table header cells must be associated with the cells they describe                                                              | T1      | Specified |
| **PUB-033** | Publishing must fail where a figure has no alternative text (**CNT-022**)                                                       | T1      | Specified |
| **PUB-034** | The document's language and the language of any passage that differs must be carried into the output (**CNT-083**, **CNT-084**) | T1      | Specified |
| **PUB-035** | Word output must be accessible on the same terms, since a recipient may be reading it rather than the PDF                       | T1      | Specified |
| **PUB-036** | Accessibility must be checked automatically as part of publishing, and the result must be retained with the publication         | T1      | Specified |

**PUB-036 is what stops accessibility becoming an assertion.** Scope §11 says both accessibility
requirements are tested rather than asserted; attaching the result to the publication is what makes
that claim inspectable a year later, when somebody asks.

## 8. Generated matter

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-037** | A table of contents must be generatable to a depth the layout declares                                              | T1      | Specified |
| **PUB-038** | Lists of figures, tables and equations must be generatable                                                          | T1      | Specified |
| **PUB-039** | A glossary and a list of abbreviations must be generatable from the terms the document actually uses (**LIB**)      | T6      | Specified |
| **PUB-040** | A bibliography must be generated from the citations present, formatted by the selected citation style (**STY-020**) | T6      | Specified |
| **PUB-041** | An index should be generatable where the layout declares one                                                        | T6      | Specified |
| **PUB-042** | All generated matter must describe the **resolved** document, after conditions have been applied                    | T4      | Specified |

## 9. Determinism

| ID          | Requirement                                                                                                                                         | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-043** | The same baseline, layout version and theme version must produce the same output                                                                    | Constraint | Specified |
| **PUB-063** | A publication must record the engine and engine version, and the template version, that produced it                                                 | T1         | Specified |
| **PUB-064** | A 300-page document must publish in under thirty seconds - a provisional budget, to be confirmed against real content                               | T1         | Specified |
| **PUB-044** | Anything that cannot be deterministic - a generation timestamp, an internal identifier - must be confined to places the layout declares             | T3         | Specified |
| **PUB-045** | A publication must record the versions of everything that produced it: the baseline, the layout, the theme, the citation style, the pipeline itself | T3         | Specified |
| **PUB-046** | Re-publishing a baseline years later must be possible and must produce the same document                                                            | T3         | Specified |

**Section 9 is what makes a validated system validatable.** A regulator's question is not "is it
right" but "can you produce it again and show me it is the same", and PUB-045 is the part that
answers it - a publication that does not record what made it cannot be reproduced, only re-attempted.

## 10. Publications

| ID          | Requirement                                                                                                                                                  | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **PUB-047** | A publication must be retained, addressable by URL, and permissioned (**IAM**)                                                                               | T1         | Specified |
| **PUB-048** | A publication must be listed alongside the document that produced it, with who published it and when                                                         | T1         | Specified |
| **PUB-049** | A publication must be accompanied by the provenance of every bound value in it (**DAT-042**)                                                                 | T2         | Specified |
| **PUB-050** | A publication must be immutable; correcting one must produce another rather than replacing it                                                                | Constraint | Specified |
| **PUB-057** | A publication must be shareable outside the tenant only to a named recipient who has proved who they are, and never anonymously                              | Constraint | Specified |
| **PUB-058** | Such a share must expire, and must be revocable with immediate effect                                                                                        | T4         | Specified |
| **PUB-059** | A recipient opening a publication that a later one has superseded must be told so, rather than reading a corrected document's predecessor without knowing    | Constraint | Specified |
| **PUB-060** | Every access to a shared publication must be recorded - who, when, and which publication - and must be reportable to the tenant that shared it (**LIF-026**) | T4         | Specified |

**PUB-057 reads like a weaker thing than an account, and it is a stronger thing than what it
replaces.** The realistic alternative is not that a client signs in; it is that somebody emails them
a PDF, which carries no reader identity, cannot be revoked, and cannot tell them the version in their
hand has been superseded. PUB-059 and PUB-060 are what a file in an inbox can never do, and they are
the reason this is worth building rather than leaving to the customer. See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md).

**PUB-062 is the engine decision's security requirement, and it outlives the engine.** Typst
markup is a programming language, so an emitter that writes it turns every escaping slip into code
execution inside the publishing pipeline - demonstrated in the spike, where one unescaped line read
a file from the compile root. Handing the engine data instead of source removes the class rather
than the instance. **PUB-063 closes a gap the spike found:** every other input to a publication was
already pinned, and the engine that turned them into pages was not. See [ADR-0013](../../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md).

## 11. Failure

| ID          | Requirement                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **PUB-051** | Publishing must fail on any unresolved cross-reference, failed binding, unresolved citation, unresolvable footnote anchor, missing alternative text, missing style or unavailable typeface | Constraint | Specified |
| **PUB-052** | Failures must be reported together, so that fixing a document is one pass rather than a sequence of single discoveries                                                                     | T1         | Specified |
| **PUB-053** | A failed publish must produce no artifact at all, so that a partial document cannot be mistaken for a finished one                                                                         | Constraint | Specified |

## 12. Lossy exports

| ID          | Requirement                                                                                                               | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-054** | Google Docs export must be labelled in the interface as lossy, and must not be presented beside PDF and Word as an equal  | T6      | Specified |
| **PUB-055** | Any lossy export must report what it could not carry, at the time it is produced                                          | T6      | Specified |
| **PUB-056** | HTML should be producible as a reading format, and is subject to the same accessibility requirements as the other outputs | T6      | Specified |

## 13. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PUB-N01** | **Not a prepress system.** No imposition, colour separation, trapping or bleed management                                                                                                                                                                                                      |
| **PUB-N02** | **No web publishing channel, and no anonymous distribution.** The output is documents, not a site. A report meant for the public goes on a web server, and the product's involvement ends at the file ([ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md)) |
| **PUB-N03** | **No editing of output.** A published artifact is produced from a baseline; correcting it means correcting the document and publishing again                                                                                                                                                   |
| **PUB-N04** | **Google Docs is not held to the fidelity bar**, and must not be sold as though it were                                                                                                                                                                                                        |

## 14. Open questions

| ID          | Question                                                                                                                                                                                                                                                                                                                                                                                                                                       | What would settle it                                                                                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PUB-Q01** | **Which pagination and PDF engine?**                                                                                                                                                                                                                                                                                                                                                                                                           | **Settled.** Typst, rendering the resolved content model through one fixed template. See [ADR-0013](../../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md)                                                                                                                                |
| **PUB-Q02** | **Does Google Docs export survive at all?** It exists because customers ask for it and cannot express what the product is for, and it now has a second problem: writing to a user's Google Docs needs Drive scopes, which are restricted, which means app verification and a periodic security assessment - exactly what IAM-044 and [ADR-0009](../../decisions/0009-federation-and-google-accounts-no-local-passwords.md) were taken to avoid | Whether a customer wants it enough to accept both that it is visibly worse and that it carries a compliance cost nothing else in the product does                                                                                                                                                                  |
| **PUB-Q03** | **Is PDF/A required, and at which conformance level?** Archival and submission requirements differ by regime, and the levels are not interchangeable                                                                                                                                                                                                                                                                                           | The first customer with a submission requirement that names one                                                                                                                                                                                                                                                    |
| **PUB-Q04** | **How is preview made fast enough (CNT-096) while using the same pipeline (PUB-006)?**                                                                                                                                                                                                                                                                                                                                                         | **Settled.** Typst compiles incrementally, reusing unchanged layout between compiles: an edit reaches page 40 of a 300-page document in under half a second, whatever page it is on. The one difference is PUB-061. See [ADR-0013](../../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md) |

## 15. Traceability

| This document      | Rests on                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| PUB-002, PUB-003   | STR-020 and STR-030 - conditions before numbering and references              |
| PUB-029            | Content model spike findings, the standing lesson about self-consistent tests |
| PUB-019, PUB-051   | STY-040 to STY-042, typefaces and their licences                              |
| PUB-030 to PUB-036 | Scope §11 accessibility, tested rather than asserted                          |
| Section 9          | Scope §7.10 deterministic publishing                                          |
| PUB-054 to PUB-056 | Scope §9 decision 7, Google Docs as a labelled lossy export                   |
