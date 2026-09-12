# REU - Reuse, variants and conditional profiling

> **Status: v1, reviewed.**

## 1. Purpose

One component appearing in many documents, and one component saying different things to different
audiences. This area owns transclusion and where-used, local overrides on a reference, variables,
conditional profiling, and generating many documents from one template.

**A reference is a transclusion of a component**: the two words name one thing, and the rows below
say "reference" where the sections say "transclusion". Nothing is copied - a reference resolves
wherever it is read (REU-004).

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

| ID          | Requirement                                                                                                                                                                                                                                                                       | Tranche    | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REU-001** | A component must be referenceable by any number of documents, in any space the referrer may read (**IAM-016**)                                                                                                                                                                    | T4         | Specified             |
| **REU-002** | Each reference must independently pin a version or revision, or float at latest, and which it does must be visible                                                                                                                                                                | T4         | Superseded by REU-050 |
| **REU-003** | A component must be referenceable more than once in one document, each occurrence distinct (**STR-010**)                                                                                                                                                                          | T4         | Specified             |
| **REU-004** | A reference must resolve at read time and at publish time, never by copying content into the referring document                                                                                                                                                                   | Constraint | Specified             |
| **REU-005** | A reference whose target has been deleted or is no longer readable must fail the publish with a named error                                                                                                                                                                       | T4         | Specified             |
| **REU-050** | Each reference must independently take one of three modes, and which it takes must be visible: **pinned** to a version or revision, **floating at latest**, or **tracking the latest approved revision** (**LIF-038**)                                                            | T4         | Specified             |
| **REU-042** | A reference whose target has been deleted, or which the reader may not read, must render an explicit named error in the editor and in the reading view. It must never render as empty, and must never be silently absent (REU-005 is the publish behaviour; this is the read one) | Constraint | Specified             |
| **REU-043** | That error must distinguish a target that is gone from one the reader may not see, without disclosing anything about the second beyond its existence at this position (REU-010)                                                                                                   | T4         | Specified             |
| **REU-044** | A reference that would close a cycle must be refused when it is created, and a cycle found at read or publish time must fail with a named error naming the path (**STR-011**, and **REL-046** is the same rule for relationships)                                                 | Constraint | Specified             |
| **REU-045** | Transitive resolution depth must be bounded by a declared maximum, and a resolution that exceeds it must fail by name rather than expanding until something else breaks                                                                                                           | Constraint | Specified             |
| **REU-046** | How much a reference pulls in - how many components, and how much content - must be reportable before it is accepted, so that a reference into a fifty-component subtree is a visible choice rather than a surprise                                                               | T4         | Specified             |

**REU-042 and REU-043 answer what a reader sees, which only the publish path had covered.** A
reference to something deleted or unreadable fails a publish by name (REU-005) and, until this
revision, could have rendered as nothing at all on screen - which is the silent absence REU-N01 and
REU-017 rule out everywhere else. The two cases are distinguishable to the reader without the second
becoming a disclosure.

**REU-044 to REU-046 are the DITA lesson, and review was right that it belongs here.** A component
referencing another that references the first is expressible today and nothing stopped it; `conref`
cycles have been shipping defects for twenty years. Refusing at creation is the cheap moment, failing
by name is the honest one, and reporting what a reference drags in is what stops a document exploding
quietly.

## 4. Where used

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-006** | "Where is this used" must be a first-class query over components, assets, query definitions, styles, terms and templates                                                                                                                                                                                                                                                                                                               | T4         | Specified |
| **REU-007** | It must distinguish references that float from references pinned to a version, because only the first will see a change                                                                                                                                                                                                                                                                                                                | T4         | Specified |
| **REU-008** | Editing a component used elsewhere must warn before the change is saved, and must show what it will affect                                                                                                                                                                                                                                                                                                                             | T4         | Specified |
| **REU-009** | The warning must distinguish documents that are drafts from documents that are approved, since the second is where a surprise is expensive                                                                                                                                                                                                                                                                                             | T4         | Specified |
| **REU-010** | Where-used must respect permissions: a user must not learn of a document they may not read                                                                                                                                                                                                                                                                                                                                             | Constraint | Specified |
| **REU-052** | Where-used must cover every reference-bearing artifact - components, documents, assets, query definitions, styles and citation styles, terms, bibliography entries, vocabulary values, templates, and baselines and publications - and must distinguish **live references**, which a change would reach, from **pins in a baseline or publication**, which it never will (REU-006, **LIB-005**, **AST-018**, **TPL-032**, **VER-018**) | T4         | Specified |

**REU-052 makes one question answerable instead of six.** Five documents require where-used for
their own artifact kind and REU-006 listed six kinds, so "what would changing this affect" depended
on which document somebody had read. The second half matters more: a change reaches live references
and never reaches a baseline's pins, and an impact list that mixes them tells an author that
correcting a component will alter a report issued two years ago.

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

| ID          | Requirement                                                                                                                                                                                                                                         | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-016** | A variable must resolve from the document's parameter set, its metadata, or a query result                                                                                                                                                          | T4         | Specified |
| **REU-017** | A variable that cannot resolve must fail the publish, and must never render as its own name or as a blank                                                                                                                                           | Constraint | Specified |
| **REU-018** | Variables must be declared, so an author selects one rather than typing a name and hoping                                                                                                                                                           | T4         | Specified |
| **REU-019** | A variable's rendered form must be able to differ by context - a date written one way in a heading and another in running text                                                                                                                      | T4         | Specified |
| **REU-036** | A variable inside a referenced component must resolve against the **referring document's** parameter set, metadata and query results - the same rule as conditions (REU-030) - so that one component serves two reports with two sets of parameters | Constraint | Specified |
| **REU-037** | Where a chain of references crosses more than one document context, the nearest referring document must supply the value, and any name it shadows must be reported in the resolution record rather than resolved silently                           | T4         | Specified |
| **REU-038** | Where more than one source could supply a variable (REU-016), precedence must be declared - parameter set, then document metadata, then a query result - and the resolution record must say which supplied the value                                | T4         | Specified |

**REU-036 closes what review called the biggest semantic hole, and the answer is symmetry.**
REU-030 already says a transcluded component's conditions are evaluated in the referring document's
profile; nothing said the same about its variables, and "the document's parameter set" (REU-016) did
not say which document. It is the referrer's, for the same reason and to the same end: a component
reused in two reports picks up each report's parameters, or it is not reuse.

**REU-037 and REU-038 make the collisions loud.** Shadowing and precedence are where a resolution
quietly produces the wrong number, and both are reported rather than merely decided.

## 7. Conditions and profiles

| ID          | Requirement                                                                                                                                                                                                                                                                                                         | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REU-020** | A condition axis must be a named, managed artifact with declared permitted values, held as a controlled vocabulary (**LIB**)                                                                                                                                                                                        | T4         | Specified             |
| **REU-021** | Content must be markable with one or more conditions (**CNT-032**), and marks must be able to cover overlapping ranges                                                                                                                                                                                              | T4         | Specified             |
| **REU-022** | A document must declare its profile: the value it takes on each axis                                                                                                                                                                                                                                                | T4         | Specified             |
| **REU-023** | Content whose conditions the profile does not select must be excluded at publish time, and must not be present in the output in any form                                                                                                                                                                            | Constraint | Superseded by REU-048 |
| **REU-024** | An axis the profile says nothing about must exclude, not include: inclusion must be stated rather than inferred                                                                                                                                                                                                     | Constraint | Specified             |
| **REU-025** | A conditional resolution must be previewable on screen for any profile, before anything is published                                                                                                                                                                                                                | T4         | Specified             |
| **REU-026** | An author must be able to see, while writing, which of their content is conditional and on what                                                                                                                                                                                                                     | T4         | Specified             |
| **REU-027** | A single document must be publishable once per profile, producing distinct publications that each record their profile                                                                                                                                                                                              | T4         | Specified             |
| **REU-053** | Where a document contains conditional content, publishing must fail while any axis that content depends on is unset, unless exclusion-by-unset has been explicitly accepted and recorded on the document. REU-024's default protects the reader; this stops it silently removing a section nobody meant to withhold | Constraint | Specified             |
| **REU-048** | Content whose conditions the profile does not select must be excluded at publish time and must not be present in the output in any form. Every publication must be scanned automatically - its text and its metadata - for content that was excluded, and a match must fail the publish                             | Constraint | Specified             |
| **REU-047** | Where a component's wording must differ per profile, it must be expressible as conditional alternatives inside the component, evaluated against the referring document's profile (REU-030). The authoring interface must make that path discoverable rather than leaving an author to infer it (**REU-Q05**)        | T4         | Specified             |

**REU-053 is REU-024's safe default made visible.** Unset excluding is the right behaviour and it
is also how a section quietly fails to reach an audience nobody decided to withhold it from. Failing
the publish while an axis the content depends on is unset puts the decision in front of somebody, and
accepting exclusion-by-unset is available and recorded rather than assumed.

**REU-024 is the default that has to be the safe one.** The failure of the opposite default is
publishing something to an audience it was written to be withheld from, and it happens silently the
first time somebody adds a new axis and forgets to set it everywhere.

**REU-048 replaces REU-023 by carrying its own enforcement.** "Must not be present in the output in
any form" is right, total, and untestable as written - "present" means something different in a
hidden HTML attribute, a PDF metadata field and a collapsed element. The scan is in the requirement
now, so it survives into a test suite rather than being paraphrased out of one. Excluded content that
is present but hidden is a disclosure, and in this market the recipient may be a regulator with a
text extractor.

**REU-047 documents a path that existed and was unwritten.** Per-profile wording is reachable today -
conditional alternatives inside the component, resolved against the referrer's profile - and nothing
told an author so. Whether parameter sets can be per profile, which would let variables do the same
job, is **REU-Q05**.

## 8. Resolution order

| ID          | Requirement                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REU-028** | Conditions must be resolved before numbering, so that excluded content consumes no number (**STR-020**)                                                                                                                                                                                  | Constraint | Specified |
| **REU-029** | Conditions must be resolved before cross-references, so that a reference to excluded content fails rather than renders (**STR-030**)                                                                                                                                                     | Constraint | Specified |
| **REU-030** | Transclusion must be resolved before conditions, so that a referenced component's own conditional content is evaluated in the referring document's profile                                                                                                                               | Constraint | Specified |
| **REU-039** | The result of resolving a document must be determined entirely by the component versions resolved, the referring document's profile, its parameter set and the overrides on its references. No ambient state - a clock, an execution order, a user - may change what resolution produces | Constraint | Specified |
| **REU-040** | A publication must record the inputs resolution used: the version of every component resolved, the profile, every parameter value and every override applied, so that what it contained can be reconstructed rather than re-derived (**PUB-045**, **VER-018**)                           | Constraint | Specified |

**REU-030 is subtle and matters.** A component's conditions are evaluated against the profile of the
document using it, not against anything the component knows - which is the same rule as numbering,
for the same reason. A component in two reports with different profiles says different things in
each, and that is the point.

**REU-039 is the constraint that makes the rest of this document testable.** Resolution is a
function, and saying so out loud rules out the implementations that would have made REU-031 to
REU-035 impossible to verify: one that consults the clock, one whose answer depends on the order
rows were processed, one that reads anything not in that list.

**REU-040 is what a baseline does not cover.** VER-018 pins component versions for a baselined
document; a publication also depended on a profile, a parameter set and a set of overrides, and none
of those were recorded anywhere. Without them a publication can be re-attempted and not reproduced.

## 9. Bulk generation

| ID          | Requirement                                                                                                                                                                                                                                                                                       | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REU-031** | Many documents must be creatable from one template and a set of parameter rows (**TPL**)                                                                                                                                                                                                          | T4         | Specified             |
| **REU-032** | The parameter rows must be supplyable from a file or from a query result, since forty sites are already a list somewhere                                                                                                                                                                          | T4         | Specified             |
| **REU-033** | Generation must report per row, and must leave nothing partial behind for a row that failed (**TPL-039**)                                                                                                                                                                                         | T4         | Specified             |
| **REU-034** | A cohort must be identifiable afterwards, so that a set of reports can be reviewed, approved and published together                                                                                                                                                                               | T4         | Specified             |
| **REU-035** | A cohort must be re-runnable for rows that failed, without disturbing those that succeeded                                                                                                                                                                                                        | T4         | Specified             |
| **REU-051** | A cohort run must resolve every movable reference once, at the start - floating and latest-approved alike (REU-050) - and apply that resolution to every row, recording the pinned set with the cohort (REU-034)                                                                                  | Constraint | Specified             |
| **REU-041** | A cohort run must resolve its floating references once, at the start, and apply that resolution to every row, recording the pinned set with the cohort. Forty documents generated over an hour must be one document forty times over, never a set that drifted under its own generation (REU-034) | Constraint | Superseded by REU-051 |
| **REU-049** | Bulk generation must have a stated budget - provisionally four hundred documents from one template within an hour, to be confirmed against real content - measured in production like every other budget (**ADM-016**)                                                                            | T4         | Specified             |

**REU-051 is the finding with the most teeth in this review.** A cohort exists so that a set of
reports can be reviewed, approved and published together (REU-034), and a run lasting an hour against
movable references could resolve different component versions for row 1 and row 40. That set is not
reviewable, because no two of its documents were necessarily built from the same components - and
nobody would see it. Pinning once at the start costs nothing and is the difference between a cohort
and forty documents that happen to share a template.

**The where-used requirements come before the override warnings, and that is the only intra-T4
ordering that matters.** REU-008 and REU-009 warn using what REU-006 computes, so the query is built
first. Everything else in T4 may land in any order, which is a conscious non-decision rather than an
oversight.

## 10. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REU-N01** | **No copying content to reuse it.** A reference resolves; it does not duplicate                                                                                                                                                             |
| **REU-N02** | **No overrides that live on the component.** An override belongs to one reference (REU-012)                                                                                                                                                 |
| **REU-N03** | **No inferred inclusion.** A condition axis a profile does not set excludes (REU-024)                                                                                                                                                       |
| **REU-N04** | **No conditional content in an output, hidden.** Excluded means absent, and every publication is scanned to prove it (REU-048, which superseded REU-023)                                                                                    |
| **REU-N05** | **No ambient input to resolution.** What a document resolves to is a function of its components, profile, parameters and overrides, and of nothing else - no clock, no execution order, no identity of whoever pressed the button (REU-039) |

## 11. Open questions

| ID          | Question                                                                                                                                                                                                                  | What would settle it                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **REU-Q01** | **Does the override mechanism actually hold (section 5)?** The spike's case 6 was never run, and it is the case where the discarded alternative is stronger                                                               | Running case 6: one component in two documents where one needs a single word different                                                      |
| **REU-Q02** | **May a condition apply to a whole component reference, as well as to content inside one?** "Include this section only for the regulator" is an obvious want                                                              | Whether it is expressible as an outline-node condition in **STR** instead, which may be cleaner                                             |
| **REU-Q03** | **How many profiles does one document have in practice?** Two is easy; twelve makes preview, comparison and publication counts awkward                                                                                    | Real customer profiles. It affects whether publishing per profile is a routine act or a batch job                                           |
| **REU-Q04** | **Can conditions nest or combine with logic?** "UK and not draft" is asked for the moment two axes exist                                                                                                                  | Whether simple set membership survives a real house style. Boolean conditions are easy to add and very hard to review                       |
| **REU-Q05** | **May a parameter set be declared per profile, so that variables rather than conditions carry per-profile wording?** REU-047 makes conditional alternatives the documented path; parameters would make it a table instead | Real house wording differences. Conditions suit a sentence that differs; parameters suit a value that differs, and customers will have both |

## 12. Traceability

| This document      | Rests on                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Section 3          | Scope §7.3; CNT's reuse requirements                                                            |
| Section 5          | Spike case 6, unrun - the honest comparison against DITA `conref`                               |
| REU-023, REU-024   | Scope §7.3 conditional profiling                                                                |
| Section 8          | STR-020, STR-030, PUB-002 - the resolution order                                                |
| Section 9          | Scope §7.3 parameterised bulk generation; TPL section 11                                        |
| REU-036 to REU-038 | REU-030's rule, applied to variables as it already was to conditions                            |
| REU-039, REU-040   | PUB-045 and VER-018 - what a publication and a baseline already record                          |
| REU-044            | STR-011; REL-046 - the same cycle rule in two other graphs                                      |
| REU-049            | ADM-016 - budgets measured in production rather than in tests                                   |
| REU-036 to REU-049 | [The v1 review](<../../reviews/REU - Reuse, variants and conditional profiling.md>); section 13 |

## 13. Change history

One row per change, against
[the review](<../../reviews/REU - Reuse, variants and conditional profiling.md>) that prompted it.
The rules for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Gaps inside REU's remit

| Point                                         | Change                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables across a reference edge             | **REU-036 to REU-038**, and the answer is symmetry with REU-030: a variable in a referenced component resolves against the **referring** document's parameter set, because a component reused in two reports must pick up each report's parameters or it is not reuse. Shadowing is reported, and precedence between REU-016's three sources is declared       |
| No determinism or provenance of resolution    | **REU-039** makes resolution a function of the component versions, the profile, the parameters and the overrides - and of nothing else - which is what makes REU-031 to REU-035 testable. **REU-040** records those inputs on a publication, which VER-018 does not: a baseline pins versions, and the profile, parameters and overrides were recorded nowhere |
| A cohort that drifts under its own generation | **REU-041**, the finding with the most teeth. A cohort exists to be reviewed and approved as a set, and an hour-long run against floating references could build row 1 and row 40 from different component versions with nobody seeing it. Floating references resolve once, at the start, and the pinned set is recorded                                      |
| Read-time failure states                      | **REU-042 and REU-043**: an explicit named error in the editor and the reading view for a target that is gone or unreadable, distinguishable to the reader without the second becoming a disclosure                                                                                                                                                            |
| Cycles and resolution depth                   | **REU-044** (refused at creation, named at read and publish), **REU-045** (a declared depth bound) and **REU-046** (what a reference pulls in, reportable before it is accepted). The DITA comparison section 5 invites is the comparison this closes                                                                                                          |
| Per-profile wording is unreachable in print   | **REU-047** documents the path that already existed - conditional alternatives inside the component, resolved against the referrer's profile - and **REU-Q05** asks whether parameter sets should be per profile so variables could do the same job                                                                                                            |
| REU-023 is not verifiable                     | **Superseded by REU-048**, which carries its own enforcement: every publication is scanned, text and metadata, for content that was excluded, and a match fails the publish. "In any form" is right and means something different in every format, so the scan belongs in the requirement rather than in the prose beside it                                   |

### Boundary checks

| Check                           | Finding                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication input provenance    | **Partly covered, now complete.** VER-018 pins component versions and PUB-045 records the artifacts that produced a publication; neither recorded the profile, the parameter values or the overrides. REU-040 does                                                               |
| Deleting a referenced component | **Covered from two sides.** VER-023 refuses deleting anything a baseline pins and LIF-023 refuses where a publication or hold depends on it; a pinned reference outside a baseline dies visibly by REU-005 at publish and REU-042 on screen, rather than being orphaned silently |
| The read-time error marker      | **CNT** owns how something renders in the editor; the requirement that there **be** a marker is this document's, and is now REU-042                                                                                                                                              |

### Minor notes

| Note                           | Change                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transclusion against reference | One sentence in section 1: a reference is a transclusion of a component, and the rows say "reference"                                                                                                                                                                                                                                     |
| REU-016's precedence           | **REU-038** declares it                                                                                                                                                                                                                                                                                                                   |
| Status nuance for section 5    | **Not done, deliberately.** The status vocabulary is fixed by [the index](README.md#columns) at `Specified`, `Withdrawn` and `Superseded by`, and a document inventing a fourth value would break the check that keeps all twenty-one honest. The section's own prose says it is specified rather than proven, and **REU-Q01** carries it |
| No non-functional anchor       | **REU-049** gives bulk generation a provisional budget, measured under ADM-016 like the others                                                                                                                                                                                                                                            |
| Intra-T4 ordering              | Stated in the prose: where-used comes before the override warnings that use it, and the rest is a conscious non-decision                                                                                                                                                                                                                  |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 35     | 49, of which 1 superseded |
| Non-requirements | 4      | 5                         |
| Open questions   | 4      | 5                         |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1, 2.4, 2.10, 3.1.5, 3.2.7 | **REU-002 superseded by REU-050**, adding tracking the latest approved revision as a third reference mode. **REU-041 superseded by REU-051**, which resolves every movable reference once for a cohort rather than only floating ones. **REU-052** widens where-used to every reference-bearing artifact and separates live references from baseline pins. **REU-053** stops an unset axis silently withholding a section. REU-N04 now cites REU-048 |
