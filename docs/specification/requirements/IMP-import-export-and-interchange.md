# IMP - Import, export and interchange

> **Status: draft, for review.**

## 1. Purpose

Getting content in from elsewhere, and getting everything back out. This area owns bulk import of
legacy documents, the assisted breakout that turns one of them into components, interchange with
standard formats, and the tenant export that is the product's answer to lock-in.

Scope §13 names Word import as the highest-risk capability in the product, and the reason is stated
plainly: an unattended importer that silently produces poor components would poison a repository, and
poisoned repositories do not recover.

## 2. Depends on

| Rests on                                                           | What it fixes                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.13                    | Assisted import, the export guarantee                                         |
| [Content model spike findings](../Content_Model_Spike_Findings.md) | Import must split into an outline plus components; and the silent-drop defect |
| [CNT](CNT-content-and-authoring.md) CNT-060 to CNT-065             | Paste at the editor, and its normalisation report                             |

| Not here                                 | There   |
| ---------------------------------------- | ------- |
| Pasting into the editor                  | **CNT** |
| Producing PDF and Word output            | **PUB** |
| Bibliography and terminology interchange | **LIB** |
| Asset import                             | **AST** |

## 3. Word import

| ID          | Requirement                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-001** | Importing a Word document must produce an **outline plus components**, never one undivided blob of content                                    | Constraint | Specified |
| **IMP-002** | The proposed breakdown must be presented to a person, who accepts, adjusts, merges and splits before anything is created                      | Constraint | Specified |
| **IMP-003** | Import must never run unattended, at any scale, for any customer                                                                              | Constraint | Specified |
| **IMP-004** | The proposal must be derived from heading structure and content, and must explain why it split where it did                                   | T6         | Specified |
| **IMP-005** | Tracked changes must arrive as suggestions attributed to the Word author, and comments as threads (**COL**)                                   | T6         | Specified |
| **IMP-006** | Numbering, cross-references, footnotes and captions must arrive as structure, not as the text they had resolved to                            | T6         | Specified |
| **IMP-007** | Nothing may be discarded without appearing in a report shown at the time, and the tests must assert what was dropped as well as what survived | Constraint | Specified |
| **IMP-008** | Import must be abandonable at any point before acceptance, leaving nothing behind                                                             | T6         | Specified |

**IMP-001 and IMP-002 are the same finding twice.** Word puts headings inline; this product puts them
in the outline, so importing has to split - and **the split is exactly the judgement a human has to
make.** No heuristic over heading levels knows whether two sections are one reusable component or two.
That is the mechanical reason import is assisted, rather than a caution about quality.

**IMP-007 is written the way it is because of how it failed.** The spike's importer dropped three
empty paragraphs and never counted them, because they were written in a form the reader was not
looking for - and every assertion in the test was about what came through. An importer is judged on
its diagnostics as much as on its output.

## 4. Personal data in imports

| ID          | Requirement                                                                                                                                  | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **IMP-009** | Import must surface the identities a document carries - authors of tracked changes, comment authors, document metadata - before accepting it | T6      | Specified |
| **IMP-010** | A tenant must be able to choose, as policy, whether those identities are mapped to its own users, retained as text, or discarded             | T6      | Specified |
| **IMP-011** | Which policy was applied must be recorded on what was imported                                                                               | T6      | Specified |
| **IMP-012** | Embedded metadata that is not content - device, location, account identifiers - must be handled by declared policy (**AST-007**)             | T6      | Specified |

**Section 4 exists because importing a customer's documents ingests the identity of everyone who
ever tracked a change in them.** That is a data-protection decision the customer has to make, and it
cannot be made after the fact.

## 5. Other inbound formats

| ID          | Requirement                                                                                                                  | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-013** | Markdown and HTML must be importable with the same reporting requirements as Word                                            | T6         | Specified |
| **IMP-014** | Bibliography entries must be importable in standard interchange formats (**LIB-009**)                                        | T6         | Specified |
| **IMP-015** | Terms and vocabularies must be importable (**LIB-028**)                                                                      | T6         | Specified |
| **IMP-016** | Structured content in a standard XML vocabulary should be importable, with a mapping the importer states rather than assumes | T6         | Specified |
| **IMP-017** | An import must never be able to create content that fails validation (**CNT-013**)                                           | Constraint | Specified |

## 6. Export

| ID          | Requirement                                                                                                                           | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-018** | A whole tenant must be exportable: content, metadata, definitions, assets, relationships, versions, baselines, publications and audit | Constraint | Specified |
| **IMP-019** | The export format must be documented and self-describing, so that it can be read without this product                                 | Constraint | Specified |
| **IMP-020** | The export must be complete rather than a best effort, and anything omitted must be stated in the export itself                       | Constraint | Specified |
| **IMP-021** | The export must be tested by a test that reads it back and compares, rather than asserted in a contract                               | T2         | Specified |
| **IMP-022** | An export must be requestable by a tenant administrator without asking anybody                                                        | T2         | Specified |
| **IMP-023** | An export must be permissioned as the whole tenant's content, and its production must be audited                                      | Constraint | Specified |
| **IMP-024** | Single documents, spaces and publications must be exportable individually as well                                                     | T2         | Specified |

**IMP-021 is what makes the export guarantee mean anything.** Scope §7.13 calls export a contractual
guarantee against lock-in; a guarantee nobody exercises is discovered to be broken at the moment a
customer is leaving, which is the worst possible time to find out.

## 7. Round-tripping

| ID          | Requirement                                                                                                                                      | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **IMP-025** | A Word round-trip must not be presented as lossless, because it cannot be: appearance comes from a theme, and blank lines are layout             | Constraint | Specified |
| **IMP-026** | What a round-trip preserves and what it does not must be stated in the product, not only in documentation                                        | T6         | Specified |
| **IMP-027** | Import must be judged on content fidelity - nothing said is lost, and anything dropped is named - rather than on visual identity with the source | Constraint | Specified |

**Section 7 records a decision rather than a capability.** A round-trip through a component CMS is
lossy by design, and that is the product working: the premise is that appearance comes from a theme
rather than from the document. Saying so in the product is what stops somebody selling it as
something else.

## 8. Non-requirements

| ID          | Not this                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| **IMP-N01** | **No unattended import**, at any scale (IMP-003)                                                                           |
| **IMP-N02** | **No claim of lossless Word round-tripping** (IMP-025)                                                                     |
| **IMP-N03** | **No import that bypasses validation** (IMP-017)                                                                           |
| **IMP-N04** | **No migration service disguised as a feature.** Bulk conversion of a legacy estate is a project, and it is a person's job |

## 9. Open questions

| ID          | Question                                                                                                                                             | What would settle it                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **IMP-Q01** | **How does assisted import scale to a legacy estate of thousands?** IMP-003 forbids unattended import and a customer will have four thousand reports | Whether the assistance can be made fast enough per document, or whether the answer is that most of an estate is never migrated |
| **IMP-Q02** | **Should a model propose the breakdown (IMP-004)?** It is a good use of one and it is exactly where a bad proposal is expensive                      | Whether the proposal can be reviewed faster than it could be made by hand                                                      |
| **IMP-Q03** | **Which XML vocabularies are worth importing (IMP-016)?** DITA is the obvious one and it is a large mapping                                          | A customer with an existing structured estate. Until then it stays a `should`                                                  |
| **IMP-Q04** | **Does export include iterations?** They are recovery rather than record, and a customer leaving may still want everything                           | A decision with **VER**, probably no, stated in the export                                                                     |

## 10. Traceability

| This document    | Rests on                                                |
| ---------------- | ------------------------------------------------------- |
| IMP-001, IMP-002 | Spike findings, case 8 - the importer must split        |
| IMP-007          | Spike findings, the silent-drop defect                  |
| Section 4        | Spike findings, real Word documents carry personal data |
| Section 6        | Scope §7.13, export as a contractual guarantee          |
| Section 7        | Spike findings, "a Word round-trip is lossy by design"  |
