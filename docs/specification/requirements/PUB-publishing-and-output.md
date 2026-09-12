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
| The preview surface inside the editor   | **CNT** |
| Closing a tenant, and its grace period  | **ADM** |

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

| ID          | Requirement                                                                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-015** | PDF must be a first-class output and must meet the fidelity bar in scope §4                                                                                                                                                                                                                        | T1         | Specified |
| **PUB-016** | A footnote must appear on the page carrying its anchor                                                                                                                                                                                                                                             | T1         | Specified |
| **PUB-017** | A table breaking across pages must behave as its table style declares (**STY-013**)                                                                                                                                                                                                                | T1         | Specified |
| **PUB-018** | Widow and orphan control, keep-with-next and keep-together must be honoured                                                                                                                                                                                                                        | T1         | Specified |
| **PUB-019** | Typefaces must be embedded, subject to the licence recorded with the theme (**STY-041**, **STY-042**)                                                                                                                                                                                              | T1         | Specified |
| **PUB-020** | PDF/A must be producible where a layout declares it, for archival and submission                                                                                                                                                                                                                   | T3         | Specified |
| **PUB-021** | The document outline must appear as PDF bookmarks                                                                                                                                                                                                                                                  | T1         | Specified |
| **PUB-022** | Cross-references and citations must be internal links                                                                                                                                                                                                                                              | T1         | Specified |
| **PUB-068** | Rendered output must be faithful to the composition that was paginated: line breaking, hyphenation, justification and glyph selection must be those the layout and theme declare (**STY**). A renderer must not re-break, re-hyphenate or choose a different glyph on its own                      | Constraint | Specified |
| **PUB-069** | Hyphenation and line breaking must follow the language of the passage (**CNT-140**), not one language declared for the whole document                                                                                                                                                              | T1         | Specified |
| **PUB-070** | Where a typeface is substituted because its licence forbids embedding (**STY-052**), the document must be composed again against the substitute and the substitution reported on the publication. A substitution must never leave a page whose lines differ from the composition that was approved | Constraint | Specified |

**PUB-068 states the bar this document's purpose already claimed.** Typography, pagination, table
breaking and footnote placement are named as what a prospect tests, and sections 5 and 6 covered
everything on that list except the typography: nothing said that the lines a composition decided are
the lines a renderer draws. It is the difference between a pipeline and a pipeline with a second
opinion in it.

**PUB-070 is the case where a licence quietly changes a page.** A face that cannot be embedded in
Word is substituted by STY-052, and a substitute with different metrics re-breaks every line it
touches. Composing again against the face that will actually be used is the only version of this that
produces a document matching its own approval.

## 6. Word

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                             | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-023** | Word must be a first-class output, not a convenience export                                                                                                                                                                                                                                                                                                                             | T1         | Specified |
| **PUB-024** | Heading numbers must be carried as a numbering definition Word understands, never as literal text in a heading                                                                                                                                                                                                                                                                          | T1         | Specified |
| **PUB-025** | Footnotes must be real Word footnotes, numbered by Word                                                                                                                                                                                                                                                                                                                                 | T1         | Specified |
| **PUB-026** | Cross-references must be fields Word can update, not the numbers they resolved to                                                                                                                                                                                                                                                                                                       | T1         | Specified |
| **PUB-027** | Styles must map to Word styles, so that a recipient can restyle the document rather than receiving direct formatting                                                                                                                                                                                                                                                                    | T1         | Specified |
| **PUB-028** | Suggestions should be exportable as Word tracked changes, and Word tracked changes should be importable as suggestions (**COL**, **IMP**)                                                                                                                                                                                                                                               | T6         | Specified |
| **PUB-029** | Word output must be verified by opening it in Word, as a standing practice rather than a one-off, and every material change to the emitter must be re-verified                                                                                                                                                                                                                          | T1         | Specified |
| **PUB-065** | Word output must carry the resolved document's content, numbering and cross-references and leave pagination to Word; the PDF is the output a page number cites, and the publication record must say so                                                                                                                                                                                  | Constraint | Specified |
| **PUB-066** | Contents, lists of figures and tables, and page references in Word output must be fields that Word refreshes when the document opens, never page numbers copied from the PDF                                                                                                                                                                                                            | Constraint | Specified |
| **PUB-067** | Equations in Word output must be native Word equations built from the same structure as the PDF's, never images and never a second conversion of the source                                                                                                                                                                                                                             | T1         | Specified |
| **PUB-078** | Where a style, a property or a construct has no faithful Word representation, publishing must either refuse it (PUB-014) or report it on the publication exactly as a lossy export reports (PUB-055). Word is not exempt from saying what it could not carry; what makes it first-class is that the answer is normally nothing, and **STY-053**'s conformance suite is what keeps it so | Constraint | Specified |

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

| ID          | Requirement                                                                                                                                                                                                                                              | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **PUB-030** | PDF output must be tagged and must meet PDF/UA                                                                                                                                                                                                           | T1      | Specified |
| **PUB-031** | Reading order must follow the document's own order, not the order things happen to be laid out in                                                                                                                                                        | T1      | Specified |
| **PUB-032** | Table header cells must be associated with the cells they describe                                                                                                                                                                                       | T1      | Specified |
| **PUB-033** | Publishing must fail where a figure has no alternative text (**CNT-022**)                                                                                                                                                                                | T1      | Specified |
| **PUB-034** | The document's language and the language of any passage that differs must be carried into the output (**CNT-140**, **CNT-084**)                                                                                                                          | T1      | Specified |
| **PUB-035** | Word output must be accessible on the same terms, since a recipient may be reading it rather than the PDF                                                                                                                                                | T1      | Specified |
| **PUB-036** | Accessibility must be checked automatically as part of publishing, and the result must be retained with the publication                                                                                                                                  | T1      | Specified |
| **PUB-080** | Where a preview is untagged by design (PUB-061), the reading context must say so to assistive technology as well as on screen, and must name the tagged output as the accessible path. A preview that is hostile on purpose must not be silently hostile | T1      | Specified |

**PUB-036 is what stops accessibility becoming an assertion.** Scope §11 says both accessibility
requirements are tested rather than asserted; attaching the result to the publication is what makes
that claim inspectable a year later, when somebody asks.

## 8. Generated matter

| ID          | Requirement                                                                                                         | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-037** | A table of contents must be generatable to a depth the layout declares                                              | T1         | Specified |
| **PUB-038** | Lists of figures, tables and equations must be generatable                                                          | T1         | Specified |
| **PUB-039** | A glossary and a list of abbreviations must be generatable from the terms the document actually uses (**LIB**)      | T6         | Specified |
| **PUB-040** | A bibliography must be generated from the citations present, formatted by the selected citation style (**STY-020**) | T6         | Specified |
| **PUB-041** | An index should be generatable where the layout declares one                                                        | T6         | Specified |
| **PUB-042** | All generated matter must describe the **resolved** document, after conditions have been applied                    | Constraint | Specified |

**PUB-042 is a constraint rather than a tranche, which review was right to press on.** It had been
T4 while the table of contents it governs is T1, which would have meant a contents list generated
from the unresolved document for three tranches - correct in a document with no conditions and wrong
in the first one that has any. It governs how generated matter is built whenever it is built, so it
has no delivery position.

**The T6 items around it are deliberate sequencing and are left alone.** A glossary, a bibliography
and an index (PUB-039 to PUB-041) need **LIB** and its citation styles, which arrive in T6; a
contents list and a list of figures need only the outline.

## 9. Determinism

| ID          | Requirement                                                                                                                                                                                                                                                             | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-043** | The same baseline, layout version and theme version must produce the same output                                                                                                                                                                                        | Constraint | Specified |
| **PUB-063** | A publication must record the engine and engine version, and the template version, that produced it                                                                                                                                                                     | T1         | Specified |
| **PUB-064** | A 300-page document must publish in under thirty seconds - a provisional budget, to be confirmed against real content                                                                                                                                                   | T1         | Specified |
| **PUB-044** | Anything that cannot be deterministic - a generation timestamp, an internal identifier - must be confined to places the layout declares                                                                                                                                 | T3         | Specified |
| **PUB-045** | A publication must record the versions of everything that produced it: the baseline, the layout, the theme, the citation style, the pipeline itself                                                                                                                     | T3         | Specified |
| **PUB-046** | Re-publishing a baseline years later must be possible and must produce the same document                                                                                                                                                                                | T3         | Specified |
| **PUB-075** | A change to the pipeline, the engine, or any library either depends on must be checked against the recorded output of a fixed set of baselines, and a difference must fail before release rather than being found by a customer re-publishing (PUB-043, PUB-046)        | T3         | Specified |
| **PUB-076** | An incremental compilation and a clean compilation of the same input must produce byte-identical output, so that reusing layout between compiles cannot introduce a difference nobody would look for (**PUB-Q05**)                                                      | T3         | Specified |
| **PUB-077** | Reproducing a publication must verify that what it pinned is what it got - the typeface files, the theme, the layout, the citation style and the engine version - and must fail rather than proceed with an equivalent (**STY-047**, **VER-018**, **VER-022**, PUB-063) | Constraint | Specified |

**PUB-075 is the requirement PUB-003 already demonstrates the need for.** Determinism was stated
three times and tested nowhere: a library update that changes a hyphenation table or a shaping
decision produces different bytes, and the first person to notice is the customer re-publishing a
baseline from two years ago to answer an inspector. Recorded output for a fixed set of baselines is
the cheapest possible version of that test.

**PUB-076 follows from the preview decision.** ADR-0013 makes preview fast by reusing layout between
compiles, which is a cache - and a cache that can differ from a clean build is a stale-page defect
that violates PUB-043 with nothing to catch it. **PUB-Q05** asks whether byte-identity is achievable
or whether publication must always be a clean compile.

**PUB-077 makes "everything is pinned" checkable at the moment it matters.** VER-018 pins the
typeface files themselves rather than the theme version that named them (STY-047), which is what
makes reproduction possible; verifying at reproduction is what makes it true.

**Section 9 is what makes a validated system validatable.** A regulator's question is not "is it
right" but "can you produce it again and show me it is the same", and PUB-045 is the part that
answers it - a publication that does not record what made it cannot be reproduced, only re-attempted.

## 10. Publications

| ID          | Requirement                                                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **PUB-047** | A publication must be retained, addressable by URL, and permissioned (**IAM**)                                                                                                                                                                                                     | T1         | Specified |
| **PUB-048** | A publication must be listed alongside the document that produced it, with who published it and when                                                                                                                                                                               | T1         | Specified |
| **PUB-049** | A publication must be accompanied by the provenance of every bound value in it (**DAT-042**)                                                                                                                                                                                       | T2         | Specified |
| **PUB-050** | A publication must be immutable; correcting one must produce another rather than replacing it                                                                                                                                                                                      | Constraint | Specified |
| **PUB-057** | A publication must be shareable outside the tenant only to a named recipient who has proved who they are, and never anonymously                                                                                                                                                    | Constraint | Specified |
| **PUB-058** | Such a share must expire, and must be revocable with immediate effect                                                                                                                                                                                                              | T4         | Specified |
| **PUB-059** | A recipient opening a publication that a later one has superseded must be told so, rather than reading a corrected document's predecessor without knowing                                                                                                                          | Constraint | Specified |
| **PUB-060** | Every access to a shared publication must be recorded - who, when, and which publication - and must be reportable to the tenant that shared it (**LIF-026**)                                                                                                                       | T4         | Specified |
| **PUB-073** | A publication must be one baseline published by one act into a declared set of formats, and that set must be recorded with it. Publishing the same baseline to other formats later must produce another publication rather than extending this one (PUB-050)                       | Constraint | Specified |
| **PUB-074** | A publication must include the PDF wherever anything in it cites a page (PUB-065). A Word-only publication must be refused where page citations exist, and must otherwise record that it carries no page-cited output                                                              | Constraint | Specified |
| **PUB-081** | What becomes of retained publications when a tenant closes must follow **ADM-029** and **ADM-030** - offered in the export before closure, deleted with everything else after the grace period - and a share outside the tenant (PUB-057) must stop resolving when the tenant does | Constraint | Specified |

**PUB-073 and PUB-074 define the thing this document had been auditing, retaining and sharing
without ever saying what it is.** One baseline, one act, a declared set of formats - which makes
"can you publish Word only" answerable, and makes PUB-065's rule that the PDF is what a page number
cites survive the case where nobody produced a PDF. A publication that carries page citations and no
PDF is a document citing pages that exist nowhere.

**PUB-081 closes a gap review found by looking outward.** A publication outlives the document that
made it, is addressable by URL, and may be in a client's hands - and nothing said what happens to any
of that when the tenant is closed. It follows the tenant: offered in the export, gone after the grace
period, and a share that stops resolving rather than pointing at a tenant that no longer exists.

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

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **PUB-051** | Publishing must fail on any unresolved cross-reference, failed binding, unresolved citation, unresolvable footnote anchor, missing alternative text, missing style or unavailable typeface                                                                                                                                                                                                                                                                                                                          | Constraint | Superseded by PUB-072 |
| **PUB-052** | Failures must be reported together, so that fixing a document is one pass rather than a sequence of single discoveries                                                                                                                                                                                                                                                                                                                                                                                              | T1         | Specified             |
| **PUB-053** | A failed publish must produce no artifact at all, so that a partial document cannot be mistaken for a finished one                                                                                                                                                                                                                                                                                                                                                                                                  | Constraint | Specified             |
| **PUB-071** | Publishing must fail wherever the resolved document cannot be faithfully rendered under its declared layout, styles and engine. The cases listed in PUB-072 are examples of that rule, never the whole of it                                                                                                                                                                                                                                                                                                        | Constraint | Specified             |
| **PUB-072** | Publishing must fail on at least: an unresolved cross-reference, a failed binding, an unresolved citation, an unresolvable footnote anchor, missing alternative text, a missing style, an unavailable typeface, a missing glyph (**STY-049**), content that cannot be laid out - an unbreakable block taller than the area that must hold it, a figure that fits on no page at its declared size - and an equation neither output format can render. Each must name the block and the layout that could not take it | Constraint | Specified             |
| **PUB-079** | A resolved document with no body content must publish the front and back matter its layout declares, and must fail with a named error only where the layout declares none - never produce an empty artifact                                                                                                                                                                                                                                                                                                         | T1         | Specified             |

**PUB-071 is the requirement that makes PUB-072 a list rather than a limit.** An enumeration invites
the reading that anything not on it is fine, and the dangerous case in a compliance-grade product is
exactly the one nobody enumerated: content that simply cannot flow. A table taller than the page area
does not fail any of the original checks, and silently violating the fidelity bar is worse than
refusing to publish - the refusal is visible.

**PUB-079 stops a test suite deciding a question the specification should.** An empty document against
a layout carrying a cover and an approval page publishes those and no body; a layout with neither
fails by name. Either answer is defensible and the silence was not.

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
| **PUB-Q05** | **Can an incremental compilation be made byte-identical to a clean one (PUB-076)?** Reusing layout between compiles is what makes preview fast; producing the same bytes either way is what makes PUB-043 checkable                                                                                                                                                                                                                            | Measurement against the engine. If it cannot, the answer is that preview compiles incrementally and publication always compiles clean - which costs seconds on a path that already takes thirty                                                                                                                    |

## 15. Traceability

| This document      | Rests on                                                                        |
| ------------------ | ------------------------------------------------------------------------------- |
| PUB-002, PUB-003   | STR-020 and STR-030 - conditions before numbering and references                |
| PUB-029            | Content model spike findings, the standing lesson about self-consistent tests   |
| PUB-019, PUB-051   | STY-040 to STY-042, typefaces and their licences                                |
| PUB-030 to PUB-036 | Scope §11 accessibility, tested rather than asserted                            |
| Section 9          | Scope §7.10 deterministic publishing                                            |
| PUB-054 to PUB-056 | Scope §9 decision 7, Google Docs as a labelled lossy export                     |
| PUB-005, PUB-006   | CNT-095, CNT-096 - preview in the editor, and its budget                        |
| PUB-013            | VER-018 - the baseline's side of the same pin                                   |
| PUB-028            | COL - suggestions; IMP - tracked changes arriving as them                       |
| PUB-033, PUB-034   | CNT-022 alternative text; CNT-140 and CNT-084, the language of a passage        |
| PUB-039, PUB-040   | LIB - the terms and citations generated matter is built from                    |
| PUB-060            | LIF-026 - access to a shared publication in the audit log                       |
| PUB-068 to PUB-070 | STY-049, STY-052, STY-053 - glyphs, substitution, and the conformance suite     |
| PUB-077            | STY-047, VER-018, VER-022 - what a baseline pins, and that it stays retrievable |
| PUB-081            | ADM-029, ADM-030 - the export before closure, and the grace period after it     |
| PUB-068 to PUB-081 | [The v1 review](<../../reviews/PUB - Publishing and output.md>); section 16     |

## 16. Change history

One row per change, against [the review](<../../reviews/PUB - Publishing and output.md>) that
prompted it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### Gaps and issues, in the review's order

| Point                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fidelity bar has no typography requirement | **PUB-068**: rendered output is faithful to the composition that was paginated - line breaking, hyphenation, justification and glyph selection as the layout and theme declare, with no second opinion in the renderer. **PUB-069** makes hyphenation follow the language of the passage, and **PUB-070** covers the case where a licence substitution changes the metrics: compose again against the face that will be used, and report it |
| PUB-051 is not exhaustive                      | **PUB-071** is the catch-all - publishing fails wherever the resolved document cannot be faithfully rendered under its declared layout, styles and engine - and **PUB-051 is superseded by PUB-072**, which adds content that cannot be laid out, a missing glyph and an unrenderable equation, and says "at least" so the list reads as examples                                                                                           |
| "Publication" as a multi-format unit           | **PUB-073** defines it: one baseline, one act, a declared set of formats recorded with it, and another publication rather than an extension if more formats are wanted later. **PUB-074** keeps PUB-065 true - a publication carrying page citations must include the PDF, or it cites pages that exist nowhere                                                                                                                             |
| Determinism is never verified                  | **PUB-075** (pipeline and library changes checked against recorded output for fixed baselines, failing before release), **PUB-076** (incremental and clean compilation byte-identical, with **PUB-Q05** if that proves impossible) and **PUB-077** (reproduction verifies what was pinned rather than accepting an equivalent)                                                                                                              |
| Tranche inconsistency                          | **PUB-042 is now a Constraint.** At T4 it would have allowed three tranches of contents lists generated from the unresolved document. The T6 items around it are deliberate - a glossary and a bibliography need LIB - and the prose now says so                                                                                                                                                                                            |
| Word's first-class claim against lossiness     | **PUB-078**: anything with no faithful Word representation is refused or reported exactly as a lossy export reports. Word is first-class because the answer is normally nothing, kept so by STY-053's conformance suite, not because it is exempt from saying                                                                                                                                                                               |

### Craft notes

| Note                    | Change                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Traceability traced six | Ten rows added, covering the CNT, VER, COL, IMP, LIB, STY, LIF and ADM identifiers the tables actually cite                                                                                                                                                        |
| Degenerate inputs       | **PUB-079**: an empty document publishes the front and back matter its layout declares, and fails by name only where the layout declares none. Either answer was defensible; the silence was not                                                                   |
| Preview accessibility   | **PUB-080**, and this document keeps it: a preview that is untagged by design must say so to assistive technology as well as on screen, and name the tagged output as the accessible path. The preview surface itself is **CNT**'s, and a boundary row now says so |

### Cross-document checks

| Check                                       | Finding                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STY pins font files immutably               | **Confirmed: STY-047** pins the exact files a baseline published with rather than the theme version that named them, and VER-018 carries the baseline's side. PUB-077 makes it verified at reproduction rather than assumed                                                                 |
| A closed style mapping per output format    | **Confirmed by a different mechanism than expected.** STY-053 requires every style property to render the same measured value in each format, verified by a suite - so the inventory is closed by conformance rather than by an enumeration. PUB-078 covers what happens where it cannot be |
| VER's side of the layout pin                | **Confirmed: VER-018** pins the layout, typeface, theme and citation style; PUB-013 is the same pin stated from this side                                                                                                                                                                   |
| CNT-095, CNT-096, CNT-022, CNT-083, CNT-084 | All present with matching semantics - and CNT-083 has since been superseded by **CNT-140**, which makes a language tag BCP 47. PUB-034 now cites CNT-140                                                                                                                                    |
| Retained publications when a tenant closes  | **A real gap, and now closed here: PUB-081.** ADM-029 and ADM-030 own the export and the grace period; nothing said what happens to a publication in a client's hands, and now it stops resolving with the tenant                                                                           |
| PUB-N02 against PUB-057                     | **Consistent.** Both draw the line in the same place: a named recipient who has proved who they are, never an anonymous URL, and a public report goes on somebody's web server                                                                                                              |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 67     | 81, of which 1 superseded |
| Non-requirements | 4      | 4                         |
| Open questions   | 4      | 5                         |
