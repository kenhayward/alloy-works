# REU - Reuse, variants and conditional profiling

> **Status: draft, for review.**

## 1. Purpose

One component appearing in many documents, and one component saying different things to different
audiences. This area owns transclusion and where-used, local overrides on a reference, variables,
conditional profiling, and generating many documents from one template.

This is the capability that makes the product a component content management system rather than a
good editor with a database attached. Scope §4 names it as one of the three clauses of the
positioning claim, and it is the one Workiva does not have.

## 2. Depends on

| Rests on                                               | What it fixes                                           |
| ------------------------------------------------------ | ------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.3     | Condition, parameter set, transclusion, bulk generation |
| [CNT](CNT-content-and-authoring.md)                    | Condition marks and variable nodes are in the T1 schema |
| [STR](STR-structure-numbering-and-cross-references.md) | Conditions must resolve before numbering and references |

| Not here                                 | There   |
| ---------------------------------------- | ------- |
| The marks themselves in content          | **CNT** |
| Where a reference sits in a document     | **STR** |
| What a version is, and pinning one       | **VER** |
| Template authoring and instantiation     | **TPL** |
| The vocabulary a condition axis draws on | **LIB** |

## 3. References and transclusion

| ID          | Requirement                                                                                                        | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **REU-001** | A component must be referenceable by any number of documents, in any space the referrer may read (**IAM-016**)     | T4         | Specified |
| **REU-002** | Each reference must independently pin a version or revision, or float at latest, and which it does must be visible | T4         | Specified |
| **REU-003** | A component must be referenceable more than once in one document, each occurrence distinct (**STR-010**)           | T4         | Specified |
| **REU-004** | A reference must resolve at read time and at publish time, never by copying content into the referring document    | Constraint | Specified |
| **REU-005** | A reference whose target has been deleted or is no longer readable must fail the publish with a named error        | T4         | Specified |

## 4. Where used

| ID          | Requirement                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **REU-006** | "Where is this used" must be a first-class query over components, assets, query definitions, styles, terms and templates                   | T4         | Specified |
| **REU-007** | It must distinguish references that float from references pinned to a version, because only the first will see a change                    | T4         | Specified |
| **REU-008** | Editing a component used elsewhere must warn before the change is saved, and must show what it will affect                                 | T4         | Specified |
| **REU-009** | The warning must distinguish documents that are drafts from documents that are approved, since the second is where a surprise is expensive | T4         | Specified |
| **REU-010** | Where-used must respect permissions: a user must not learn of a document they may not read                                                 | Constraint | Specified |

**REU-010 is a small requirement with a real leak behind it.** "This component is used in 14
documents" tells a user something about documents they cannot open, and a list of titles tells them
considerably more.

## 5. Local overrides

The spike's case 6 was the honest-comparison case: DITA does this well with `conref` and `keyref`,
and a purpose-built model has to earn the comparison. It was not run, so this section is specified
rather than proven.

| ID          | Requirement                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-011** | A reference must be able to carry a local override, so that one document may differ in a small way without forking the component       | T4         | Specified |
| **REU-012** | An override must live on the **reference**, never on the component, so that no other document is affected                              | Constraint | Specified |
| **REU-013** | An overridden reference must still appear in where-used, and must be marked as overridden                                              | T4         | Specified |
| **REU-014** | Comparison must show an override as an override, not as a fork (**VER**)                                                               | T4         | Specified |
| **REU-015** | An override must survive the component changing, or must fail loudly where it can no longer apply - it must not silently stop applying | T4         | Specified |

**REU-015 is the requirement that decides whether overrides are usable or a trap.** An override
targets something inside a component; when the component changes, that something may be gone. Failing
loudly is the only behaviour that does not produce a document quietly reverting to text somebody
deliberately replaced.

## 6. Variables

| ID          | Requirement                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **REU-016** | A variable must resolve from the document's parameter set, its metadata, or a query result                                     | T4         | Specified |
| **REU-017** | A variable that cannot resolve must fail the publish, and must never render as its own name or as a blank                      | Constraint | Specified |
| **REU-018** | Variables must be declared, so an author selects one rather than typing a name and hoping                                      | T4         | Specified |
| **REU-019** | A variable's rendered form must be able to differ by context - a date written one way in a heading and another in running text | T4         | Specified |

## 7. Conditions and profiles

| ID          | Requirement                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-020** | A condition axis must be a named, managed artifact with declared permitted values, held as a controlled vocabulary (**LIB**)             | T4         | Specified |
| **REU-021** | Content must be markable with one or more conditions (**CNT-032**), and marks must be able to cover overlapping ranges                   | T4         | Specified |
| **REU-022** | A document must declare its profile: the value it takes on each axis                                                                     | T4         | Specified |
| **REU-023** | Content whose conditions the profile does not select must be excluded at publish time, and must not be present in the output in any form | Constraint | Specified |
| **REU-024** | An axis the profile says nothing about must exclude, not include: inclusion must be stated rather than inferred                          | Constraint | Specified |
| **REU-025** | A conditional resolution must be previewable on screen for any profile, before anything is published                                     | T4         | Specified |
| **REU-026** | An author must be able to see, while writing, which of their content is conditional and on what                                          | T4         | Specified |
| **REU-027** | A single document must be publishable once per profile, producing distinct publications that each record their profile                   | T4         | Specified |

**REU-024 is the default that has to be the safe one.** The failure of the opposite default is
publishing something to an audience it was written to be withheld from, and it happens silently the
first time somebody adds a new axis and forgets to set it everywhere.

**REU-023 says "in any form" deliberately.** Excluded content that is present but hidden - a
collapsed element, a white-on-white run, a comment in the file - is a disclosure. In this market the
recipient may be a regulator with a text extractor.

## 8. Resolution order

| ID          | Requirement                                                                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-028** | Conditions must be resolved before numbering, so that excluded content consumes no number (**STR-020**)                                                    | Constraint | Specified |
| **REU-029** | Conditions must be resolved before cross-references, so that a reference to excluded content fails rather than renders (**STR-030**)                       | Constraint | Specified |
| **REU-030** | Transclusion must be resolved before conditions, so that a referenced component's own conditional content is evaluated in the referring document's profile | Constraint | Specified |

**REU-030 is subtle and matters.** A component's conditions are evaluated against the profile of the
document using it, not against anything the component knows - which is the same rule as numbering,
for the same reason. A component in two reports with different profiles says different things in
each, and that is the point.

## 9. Bulk generation

| ID          | Requirement                                                                                                              | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **REU-031** | Many documents must be creatable from one template and a set of parameter rows (**TPL**)                                 | T4      | Specified |
| **REU-032** | The parameter rows must be supplyable from a file or from a query result, since forty sites are already a list somewhere | T4      | Specified |
| **REU-033** | Generation must report per row, and must leave nothing partial behind for a row that failed (**TPL-039**)                | T4      | Specified |
| **REU-034** | A cohort must be identifiable afterwards, so that a set of reports can be reviewed, approved and published together      | T4      | Specified |
| **REU-035** | A cohort must be re-runnable for rows that failed, without disturbing those that succeeded                               | T4      | Specified |

## 10. Non-requirements

| ID          | Not this                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- |
| **REU-N01** | **No copying content to reuse it.** A reference resolves; it does not duplicate             |
| **REU-N02** | **No overrides that live on the component.** An override belongs to one reference (REU-012) |
| **REU-N03** | **No inferred inclusion.** A condition axis a profile does not set excludes (REU-024)       |
| **REU-N04** | **No conditional content in an output, hidden.** Excluded means absent (REU-023)            |

## 11. Open questions

| ID          | Question                                                                                                                                                     | What would settle it                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **REU-Q01** | **Does the override mechanism actually hold (section 5)?** The spike's case 6 was never run, and it is the case where the discarded alternative is stronger  | Running case 6: one component in two documents where one needs a single word different                                |
| **REU-Q02** | **May a condition apply to a whole component reference, as well as to content inside one?** "Include this section only for the regulator" is an obvious want | Whether it is expressible as an outline-node condition in **STR** instead, which may be cleaner                       |
| **REU-Q03** | **How many profiles does one document have in practice?** Two is easy; twelve makes preview, comparison and publication counts awkward                       | Real customer profiles. It affects whether publishing per profile is a routine act or a batch job                     |
| **REU-Q04** | **Can conditions nest or combine with logic?** "UK and not draft" is asked for the moment two axes exist                                                     | Whether simple set membership survives a real house style. Boolean conditions are easy to add and very hard to review |

## 12. Traceability

| This document    | Rests on                                                          |
| ---------------- | ----------------------------------------------------------------- |
| Section 3        | Scope §7.3; CNT's reuse requirements                              |
| Section 5        | Spike case 6, unrun - the honest comparison against DITA `conref` |
| REU-023, REU-024 | Scope §7.3 conditional profiling                                  |
| Section 8        | STR-020, STR-030, PUB-002 - the resolution order                  |
| Section 9        | Scope §7.3 parameterised bulk generation; TPL section 11          |
