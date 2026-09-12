# IMP - Import, export and interchange

> **Status: v1, reviewed.**

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

| Not here                                                     | There   |
| ------------------------------------------------------------ | ------- |
| Pasting into the editor                                      | **CNT** |
| Producing PDF and Word output                                | **PUB** |
| Bibliography and terminology interchange                     | **LIB** |
| Asset import                                                 | **AST** |
| Who may request an export, and the boundary it may not cross | **IAM** |
| Where an export artifact is stored, and what it costs        | **ADM** |
| What a version is, once a re-import produces one             | **VER** |
| Governing a model that proposes a breakdown                  | **GEN** |

## 3. Word import

| ID          | Requirement                                                                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-001** | Importing a Word document must produce an **outline plus components**, never one undivided blob of content                                                                                                                                                                                                                               | Constraint | Specified |
| **IMP-002** | The proposed breakdown must be presented to a person, who accepts, adjusts, merges and splits before anything is created                                                                                                                                                                                                                 | Constraint | Specified |
| **IMP-003** | Import must never run unattended, at any scale, for any customer                                                                                                                                                                                                                                                                         | Constraint | Specified |
| **IMP-004** | The proposal must be derived from heading structure and content, and must explain why it split where it did                                                                                                                                                                                                                              | T6         | Specified |
| **IMP-005** | Tracked changes must arrive as suggestions attributed to the Word author, and comments as threads (**COL**)                                                                                                                                                                                                                              | T6         | Specified |
| **IMP-006** | Numbering, cross-references, footnotes and captions must arrive as structure, not as the text they had resolved to                                                                                                                                                                                                                       | T6         | Specified |
| **IMP-007** | Nothing may be discarded without appearing in a report shown at the time, and the tests must assert what was dropped as well as what survived                                                                                                                                                                                            | Constraint | Specified |
| **IMP-008** | Import must be abandonable at any point before acceptance, leaving nothing behind                                                                                                                                                                                                                                                        | T6         | Specified |
| **IMP-028** | The proposal must be reviewable one component at a time: for each proposed component, a person must be able to see the source content it came from and the reason for the split, and act on it without reading or scrolling the whole source document                                                                                    | Constraint | Specified |
| **IMP-029** | A proposal must be navigable and resumable at size - searchable, filterable, and returnable to across sessions - so that a long document can be worked through in more than one sitting. A proposal in progress creates no content, so IMP-008 still holds                                                                               | T6         | Specified |
| **IMP-030** | Whatever produces the proposal, each split must carry its reason and be checkable on its own (IMP-028). A proposal produced by a model (**IMP-Q02**) must be marked as one, must be governed as **GEN** governs model output (**GEN-024**), and must be no harder to check than a heuristic one                                          | Constraint | Specified |
| **IMP-031** | How much of a proposal a person accepted unchanged must be recorded, so that a change to whatever produces proposals can be judged against what it does to a reviewer's work rather than argued about                                                                                                                                    | T6         | Specified |
| **IMP-033** | A cross-reference, footnote or caption reference whose target is not in what is being imported must be listed individually in the proposal before acceptance, with the text it had in the source                                                                                                                                         | Constraint | Specified |
| **IMP-034** | Acceptance must never create an unresolvable reference. Each must be retargeted by the person, or converted to plain text with that conversion named in the report (IMP-007), or the import refused. Resolving one silently to the number or title it had in the source is forbidden (IMP-006, IMP-017)                                  | Constraint | Specified |
| **IMP-041** | Acceptance must validate what a person's adjustments produced, on the same terms as what the importer proposed (**CNT-013**, IMP-017). A merge or a split that would produce content failing validation must be refused at the moment of the adjustment, not at the end of the import                                                    | Constraint | Specified |
| **IMP-042** | An import that fails part-way - a corrupt file, a parse that dies, a service restart - must leave nothing behind, exactly as abandonment does (IMP-008), and must report what happened rather than leaving half a document to be discovered later                                                                                        | Constraint | Specified |
| **IMP-047** | Every inbound document must be sanitised before it enters the model, on the same terms as a paste (**CNT-130**): scripts, macros, event handlers, embedded objects and link targets whose scheme is not allowlisted must never be stored, and anything removed must appear in the import report (IMP-007)                                | Constraint | Specified |
| **IMP-048** | IMP-003's prohibition applies to foreign content, which needs the split judgement only a person can make. Restoring the product's own export format (IMP-039) is a permissioned, audited job initiated by an entitled principal, needs no assisted review, and must not become a general bulk-create endpoint (**IMP-N06**, **API-N05**) | Constraint | Specified |

**IMP-001 and IMP-002 are the same finding twice.** Word puts headings inline; this product puts them
in the outline, so importing has to split - and **the split is exactly the judgement a human has to
make.** No heuristic over heading levels knows whether two sections are one reusable component or two.
That is the mechanical reason import is assisted, rather than a caution about quality.

**IMP-028 is the requirement the assisted loop was missing, and review put it exactly right.** A
person who has to read the whole source document to check one proposed split is doing the importer's
job twice, and at four thousand reports they will stop checking - which produces the poisoned
repository IMP-003 exists to prevent, by a slower route. The testable line is the one review
suggested: each proposed component is checkable without loading the source.

**IMP-030 says the same thing about a model.** A confidently wrong proposal that nobody can check
cheaply is unattended import wearing different clothes. So the constraint is on the proposal rather
than on what produced it: reasons attached, checkable individually, marked when a model made it, and
governed by GEN like any other model output. **IMP-031 makes the argument about proposal quality
settleable** - accepted-unchanged is a number, and a proposer that lowers it is worse whatever its
demonstrations looked like.

**IMP-033 and IMP-034 close a case IMP-006 created.** References arrive as structure rather than as
the text they had resolved to, which is right, and it leaves the reference whose target was never in
the file. Three outcomes are available and the wrong one is the tempting one: silently resolving to
the text the source showed would produce a document that reads correctly and is no longer a
cross-reference at all.

**IMP-041 covers the half of IMP-017 that was about the machine.** People are inside this loop by
design, and a person merging two proposed components can produce something that fails validation as
easily as a parser can. Refusing at the adjustment is what makes that fixable while somebody is still
looking at it.

**IMP-007 is written the way it is because of how it failed.** The spike's importer dropped three
empty paragraphs and never counted them, because they were written in a form the reader was not
looking for - and every assertion in the test was about what came through. An importer is judged on
its diagnostics as much as on its output.

## 4. Personal data in imports

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **IMP-009** | Import must surface the identities a document carries - authors of tracked changes, comment authors, document metadata - before accepting it                                                                                                                                                                                               | T6         | Specified |
| **IMP-010** | A tenant must be able to choose, as policy, whether those identities are mapped to its own users, retained as text, or discarded                                                                                                                                                                                                           | T6         | Specified |
| **IMP-011** | Which policy was applied must be recorded on what was imported                                                                                                                                                                                                                                                                             | T6         | Specified |
| **IMP-012** | Embedded metadata that is not content - device, location, account identifiers - must be handled by declared policy (**AST-007**)                                                                                                                                                                                                           | T6         | Specified |
| **IMP-032** | The order must be: identities are shown as the source carries them while a person reviews (IMP-009), and the tenant's policy (IMP-010) is applied once, at acceptance. So a tracked change is attributed to its Word author during review (IMP-005) and mapped, retained or discarded on commit, with which was applied recorded (IMP-011) | Constraint | Specified |

**Section 4 exists because importing a customer's documents ingests the identity of everyone who
ever tracked a change in them.** That is a data-protection decision the customer has to make, and it
cannot be made after the fact.

**IMP-032 states an ordering that was only ever implied, and read flatly the document contradicted
itself.** IMP-005 says a tracked change arrives attributed to its Word author; IMP-010 lets a tenant
discard those identities entirely. Both are true in sequence and neither is true at the same moment:
attribution is what a reviewer needs to judge a suggestion, and the policy is what the tenant applies
to what gets kept.

## 5. Other inbound formats

| ID          | Requirement                                                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-013** | Markdown and HTML must be importable with the same reporting requirements as Word                                                                                                                                                                                                  | T6         | Specified |
| **IMP-014** | Bibliography entries must be importable in standard interchange formats (**LIB-009**)                                                                                                                                                                                              | T6         | Specified |
| **IMP-015** | Terms and vocabularies must be importable (**LIB-028**)                                                                                                                                                                                                                            | T6         | Specified |
| **IMP-016** | Structured content in a standard XML vocabulary should be importable, with a mapping the importer states rather than assumes                                                                                                                                                       | T6         | Specified |
| **IMP-017** | An import must never be able to create content that fails validation (**CNT-013**)                                                                                                                                                                                                 | Constraint | Specified |
| **IMP-039** | The product's own export format must be importable, so that an export can be restored into a tenant. IMP-003's attended rule exists for the split judgement a legacy document needs; content that is already components needs no such judgement and must not be forced through one | T2         | Specified |

**IMP-039 makes IMP-018 a route out and back rather than a file nobody can use.** An export that
only this product's absence can read is a guarantee against lock-in; an export this product can also
restore is a guarantee plus a migration, a sandbox refresh and a recovery. The two are not in
tension, and IMP-N06 says so where somebody would otherwise read IMP-N01 as forbidding it.

## 6. Re-importing a source that has changed

A Word document imported this quarter will be edited and offered again next quarter, and nothing in
this specification knew that. Review was right that it had to land somewhere; it lands here, because
importing is the act, with **VER** owning the versions the result becomes.

| ID          | Requirement                                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-035** | An import must record what it came from: the source file's name, its content hash, when it was imported and by whom, against everything it created                                                                                                                            | T6         | Specified |
| **IMP-036** | Importing a source that has been imported before must say so before anything else happens, must show what has changed in the source since, and must offer to apply those changes to the components that came from it rather than silently creating a second set (**IMP-Q05**) | T6         | Specified |
| **IMP-037** | Applying a re-import to existing components must go through the same assisted review as a first import (IMP-002, IMP-028), and what it changes must become versions of those components (**VER**) rather than replacing their history                                         | Constraint | Specified |

**IMP-035 is cheap now and impossible later.** Recording where content came from costs a hash and
three fields at import; reconstructing it afterwards, across a repository somebody has been editing
for a year, cannot be done at all. **IMP-036 is deliberately modest** - it recognises, it shows, and
it offers. How far the offer goes, up to and including a three-way merge between the old source, the
new source and what an author has since changed, is **IMP-Q05** and is a larger piece of work than
this area should commit to before a customer has asked for it.

## 7. Export

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                    | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IMP-018** | A whole tenant must be exportable: content, metadata, definitions, assets, relationships, versions, baselines, publications and audit                                                                                                                                                                                                                          | Constraint | Specified |
| **IMP-019** | The export format must be documented and self-describing, so that it can be read without this product                                                                                                                                                                                                                                                          | Constraint | Specified |
| **IMP-020** | The export must be complete rather than a best effort, and anything omitted must be stated in the export itself                                                                                                                                                                                                                                                | Constraint | Specified |
| **IMP-021** | The export must be tested by a test that reads it back and compares, rather than asserted in a contract                                                                                                                                                                                                                                                        | T2         | Specified |
| **IMP-022** | An export must be requestable by a tenant administrator without asking anybody                                                                                                                                                                                                                                                                                 | T2         | Specified |
| **IMP-023** | An export must be permissioned as the whole tenant's content, and its production must be audited                                                                                                                                                                                                                                                               | Constraint | Specified |
| **IMP-024** | Single documents, spaces and publications must be exportable individually as well                                                                                                                                                                                                                                                                              | T2         | Specified |
| **IMP-038** | IMP-020's completeness rule applies to a partial export too: everything it contains must be readable without the product, everything it references from outside its scope must be listed by identity, and whether each was included by value or named by reference must be stated in the export itself                                                         | Constraint | Specified |
| **IMP-040** | The requester must be able to choose whether a partial export follows references outside its scope, and the export must record which choice was made                                                                                                                                                                                                           | T2         | Specified |
| **IMP-043** | The read-back test in IMP-021 must use a reader written against the documented format (IMP-019), not the product's own import path. An in-product reader proves a round trip; an independent one proves the format is self-describing, which is the guarantee scope §7.13 actually makes                                                                       | Constraint | Specified |
| **IMP-044** | An export artifact must itself be tenant-scoped and permissioned as the tenant's content, must be expirable or deletable, and its download must be audited (**IAM-005**, **ADM**)                                                                                                                                                                              | Constraint | Specified |
| **IMP-045** | A whole-tenant export (IMP-018) must include the administrative configuration needed to reproduce the tenant's governed behaviour - connections, model endpoints, external reference sources, translation policy, workflow definitions, retention policies, notification channels and webhook subscriptions - with secrets carried as references (**ADM-027**) | Constraint | Specified |
| **IMP-046** | Importing a whole-tenant export into another tenant must require an explicit mapping for users, groups, external principals and service identities, or must refuse where one cannot be resolved. It must never silently reassign the actor of an audit record to somebody who did not act                                                                      | Constraint | Specified |

**IMP-038 and IMP-040 answer what a space-level export contains**, which was silent and is a real
decision. A partial export that omits what it references is not readable; one that follows every
reference becomes a tenant export by another name. So the rule is that it says which it did, entity
by entity, and the requester chooses.

**IMP-043 separates two guarantees that IMP-021 had rolled into one**, which review put precisely. A
reader inside the product proves that what went out comes back; a reader written from the
documentation proves that somebody else could have written it. Only the second is the promise made
in scope §7.13, and only the first is the one an in-product test naturally ends up making.

**IMP-044 is a gap found by checking rather than by reading.** Review set aside isolation and
delivery of the export artifact as plausibly belonging to a platform document - IAM-005 names search
indexes, caches, secrets, model endpoints, publications and the audit log as things that must be
tenant-scoped, and does not name an export. A file containing an entire tenant's content is the last
artifact that should be missing from that list.

**IMP-021 is what makes the export guarantee mean anything.** Scope §7.13 calls export a contractual
guarantee against lock-in; a guarantee nobody exercises is discovered to be broken at the moment a
customer is leaving, which is the worst possible time to find out.

## 8. Round-tripping

| ID          | Requirement                                                                                                                                      | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **IMP-025** | A Word round-trip must not be presented as lossless, because it cannot be: appearance comes from a theme, and blank lines are layout             | Constraint | Specified |
| **IMP-026** | What a round-trip preserves and what it does not must be stated in the product, not only in documentation                                        | T6         | Specified |
| **IMP-027** | Import must be judged on content fidelity - nothing said is lost, and anything dropped is named - rather than on visual identity with the source | Constraint | Specified |

**Section 7 records a decision rather than a capability.** A round-trip through a component CMS is
lossy by design, and that is the product working: the premise is that appearance comes from a theme
rather than from the document. Saying so in the product is what stops somebody selling it as
something else.

## 9. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMP-N01** | **No unattended import**, at any scale (IMP-003)                                                                                                                                                                                                                              |
| **IMP-N02** | **No claim of lossless Word round-tripping** (IMP-025)                                                                                                                                                                                                                        |
| **IMP-N03** | **No import that bypasses validation** (IMP-017)                                                                                                                                                                                                                              |
| **IMP-N04** | **No migration service disguised as a feature.** Bulk conversion of a legacy estate is a project, and it is a person's job                                                                                                                                                    |
| **IMP-N05** | **No scanning of body content for personal data.** Section 4's scope is the identities a document carries as metadata and annotations. A customer's name inside the prose of a report is content the customer wrote, and this product does not inspect, classify or redact it |
| **IMP-N06** | **No unattended import _of a foreign document_** (IMP-003, IMP-N01). The product's own export format is not a foreign document: it is already components, needs no split judgement, and is importable (IMP-039)                                                               |

## 10. Open questions

| ID          | Question                                                                                                                                                                                                                          | What would settle it                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMP-Q01** | **How does assisted import scale to a legacy estate of thousands?** IMP-003 forbids unattended import and a customer will have four thousand reports                                                                              | **A measured number, from the first customer migration: documents converted per person per day, with IMP-031's accepted-unchanged rate beside it.** It settles before T6 is planned, because the two answers build different things - throughput work in the product (queued proposals, reviewer tooling, IMP-029), or a stated boundary saying an estate is a services project (IMP-N04) |
| **IMP-Q02** | **Should a model propose the breakdown (IMP-004)?** It is a good use of one and it is exactly where a bad proposal is expensive                                                                                                   | Whether the proposal is reviewed faster than the breakdown could be made by hand, measured the same way as IMP-Q01. IMP-030 means the answer changes who proposes and nothing else: the constraints on a proposal hold whatever produced it                                                                                                                                               |
| **IMP-Q03** | **Which XML vocabularies are worth importing (IMP-016)?** DITA is the obvious one and it is a large mapping                                                                                                                       | A customer with an existing structured estate. Until then it stays a `should`                                                                                                                                                                                                                                                                                                             |
| **IMP-Q04** | **Does export include iterations?** They are recovery rather than record, and a customer leaving may still want everything                                                                                                        | A decision with **VER**, probably no, stated in the export                                                                                                                                                                                                                                                                                                                                |
| **IMP-Q05** | **How far does a re-import go (IMP-036)?** Recognising the source and showing what changed is settled; reconciling a changed source against components an author has since edited is a three-way merge, and a large piece of work | A customer who re-imports rather than edits in place. Until one exists, IMP-036 recognises, shows and offers, and a person decides component by component                                                                                                                                                                                                                                 |

## 11. Traceability

| This document      | Rests on                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| IMP-001, IMP-002   | Spike findings, case 8 - the importer must split                                     |
| IMP-007            | Spike findings, the silent-drop defect                                               |
| Section 4          | Spike findings, real Word documents carry personal data                              |
| Section 7          | Scope §7.13, export as a contractual guarantee                                       |
| Section 8          | Spike findings, "a Word round-trip is lossy by design"                               |
| Section 6          | Nothing yet - re-import was unowned until this revision                              |
| IMP-030            | GEN-024, model output is a proposal until a person accepts it                        |
| IMP-037            | VER - what a re-import's changes become                                              |
| IMP-044            | IAM-005, what must be tenant-scoped; ADM, where the artifact lives                   |
| IMP-028 to IMP-044 | [The v1 review](<../../reviews/IMP - Import, export and interchange.md>); section 12 |

## 12. Change history

One row per change, against
[the review](<../../reviews/IMP - Import, export and interchange.md>) that prompted it. The rules
for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Gaps and weaknesses

| Point                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scale tension gates tranche planning       | **IMP-Q01 and IMP-Q02 now name the signal and the deadline**: documents converted per person per day in the first customer migration, with IMP-031's accepted-unchanged rate beside it, settled before T6 is planned - because the two answers build different things, throughput work in the product or a stated services boundary                                                                            |
| The assisted loop is thinnest where it matters | **IMP-028** is review's own testable line: each proposed component checkable without loading the source document. With **IMP-029** (navigable and resumable at size), **IMP-030** (the constraints hold whatever produced the proposal, and a model's is marked and governed by GEN) and **IMP-031** (accepted-unchanged recorded, so proposal quality is a number rather than an argument)                    |
| Sections 3 and 4 have an unstated ordering     | **IMP-032**: identities shown as the source carries them during review, policy applied once at acceptance. IMP-005 and IMP-010 were both true and never at the same moment                                                                                                                                                                                                                                     |
| Unresolved references are unhandled            | **IMP-033** (listed individually before acceptance, with the text they had) and **IMP-034** (retargeted, converted to plain text with the conversion named, or the import refused - never silently resolved to what the source displayed)                                                                                                                                                                      |
| No story for updated source documents          | **A new section 6**, owned here because importing is the act, with **VER** owning the versions: **IMP-035** (record the source and its hash at import), **IMP-036** (recognise, show what changed, offer to apply) and **IMP-037** (re-import goes through the same assisted review, and produces versions rather than replacing history). **IMP-Q05** keeps the three-way merge out until a customer needs it |
| Sub-tenant export completeness is undefined    | **IMP-038** (completeness applies to a partial export: readable without the product, outside references listed by identity, by-value or by-reference stated per entity) and **IMP-040** (the requester chooses whether references are followed, and the export records the choice)                                                                                                                             |
| The product's own format is not importable     | **IMP-039**, with **IMP-N06** so nobody reads IMP-N01 as forbidding it - the attended rule exists for a split judgement that components do not need                                                                                                                                                                                                                                                            |
| IMP-021's reader proves the wrong thing        | **IMP-043**: the read-back test uses a reader written against the documented format, not the product's import path. An in-product reader proves a round trip; an independent one proves self-describing, which is the guarantee scope §7.13 makes                                                                                                                                                              |
| Validation covers only the machine path        | **IMP-041**: acceptance validates what a person's adjustments produced, refused at the adjustment rather than at the end of the import                                                                                                                                                                                                                                                                         |

### The two small silences

| Silence                       | Change                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Personal data in body content | **IMP-N05** says it plainly: section 4's scope is the identities a document carries as metadata and annotations, and prose a customer wrote is not inspected |
| Failure mid-import            | **IMP-042**: a corrupt file, a dead parse or a restart leaves nothing behind, exactly as abandonment does, and says what happened                            |

### The cross-references review set aside, checked

| Check                                      | Finding                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which administrators may request an export | **Covered**: IMP-022 and IMP-023, with **IAM** owning who an administrator is. A boundary row now says so                                                                                                                                                                                                                           |
| Multi-tenant isolation of the export path  | **Partly a gap, and now closed here.** IAM-005 names search indexes, caches, secrets, model endpoints, publications and the audit log as things that must be tenant-scoped, and does not name an export. **IMP-044** does - a file containing an entire tenant's content is the last artifact that should be missing from that list |
| Delivery mechanics of the artifact         | **ADM**, which owns where things are stored and what they cost. A boundary row now says so                                                                                                                                                                                                                                          |

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 27     | 44    |
| Non-requirements | 4      | 6     |
| Open questions   | 4      | 5     |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections   | Change                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.15, 2.23, 3.2.3 | **IMP-045** puts administrative configuration inside the whole-tenant export. **IMP-046** requires an explicit identity mapping on import and forbids silently reassigning an audit actor. **IMP-047** sanitises every inbound document on the same terms as a paste. **IMP-048** scopes IMP-003 to foreign content, reconciling it with IMP-039, IMP-N06 and API-N05 |
