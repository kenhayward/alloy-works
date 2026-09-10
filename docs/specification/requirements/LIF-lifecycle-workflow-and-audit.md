# LIF - Lifecycle, workflow and audit

> **Status: draft, for review.**

## 1. Purpose

How something moves from draft to issued, who is allowed to move it, what they attest to when they
do, and the record that survives afterwards. This area owns workflow states and gates, electronic
signature, effective and review dates, retention and legal hold, and the audit log.

It is what a regulated customer buys. The rest of the product is why they would enjoy using it; this
is why they are allowed to.

## 2. Depends on

| Rests on                                            | What it fixes                                        |
| --------------------------------------------------- | ---------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.8, §11 | Workflow state, audit, retention, compliance posture |
| [VER](VER-versioning-baselines-and-comparison.md)   | A gate designates a revision and may take a baseline |
| [IAM](IAM-identity-tenancy-and-access-control.md)   | Who may pass a gate; re-assertable authentication    |

| Not here                                | There   |
| --------------------------------------- | ------- |
| Review rounds and suggestions           | **COL** |
| What a version, revision or baseline is | **VER** |
| Provenance of a bound value             | **DAT** |
| Cost and usage reporting                | **ADM** |

## 3. States and transitions

| ID          | Requirement                                                                                                                                             | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-001** | Workflow states must be declared per artifact type and configurable per tenant, not fixed by the product                                                | T3         | Specified |
| **LIF-002** | Transitions must be declared: from which state, to which, and what they require                                                                         | T3         | Specified |
| **LIF-003** | A transition must be able to require a permission, an approval, or both                                                                                 | T3         | Specified |
| **LIF-004** | A transition must be able to require conditions to be met: no unresolved suggestions, no open threads, no failed bindings, no missing required sections | T3         | Specified |
| **LIF-005** | An artifact must be in exactly one state at a time, and the state must be visible wherever it appears                                                   | T3         | Specified |
| **LIF-006** | A state must be able to make an artifact read-only, so that approved content cannot be edited without a transition back                                 | Constraint | Specified |
| **LIF-007** | Workflow definitions must be versioned, and an artifact must record the definition version it is moving under                                           | T3         | Specified |

**LIF-007 is easy to skip and expensive to add later.** A workflow that changes while documents are
in flight leaves those documents governed by rules nobody can reconstruct, which is precisely the
question an auditor asks.

## 4. Approvals and signature

| ID          | Requirement                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-008** | An approval must record who approved, when, against which version, and against which gate                                              | T3         | Specified |
| **LIF-009** | A gate must be able to require more than one approver, and to require them to be distinct people                                       | T3         | Specified |
| **LIF-010** | A gate must be able to require that the approver is not the author                                                                     | T3         | Specified |
| **LIF-011** | A signing act must be able to require re-authentication (**IAM-012**) and an attributed statement of intent                            | T3         | Specified |
| **LIF-012** | The statement of intent must be recorded verbatim alongside the signature, because what somebody attested to is the point of attesting | T3         | Specified |
| **LIF-013** | Passing a gate must designate a revision (**VER-013**), and must be able to take a baseline (**VER-021**)                              | T3         | Specified |
| **LIF-014** | An approval must be revocable only by a further recorded act, never by deletion                                                        | Constraint | Specified |

**LIF-010 exists because it is the control an auditor looks for first**, and because it cannot be
retrofitted onto a model where an approval is just a permission - it needs the identity of the author
of the version being approved, which means the version has to carry it.

## 5. Dates

| ID          | Requirement                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **LIF-015** | An artifact must be able to carry an effective date, distinct from the date it was approved                        | T3      | Specified |
| **LIF-016** | An artifact must be able to carry a review-by date                                                                 | T3      | Specified |
| **LIF-017** | Periodic review must be promptable, to a named owner, before the date rather than after                            | T3      | Specified |
| **LIF-018** | Content past its review date must be visible as such wherever it is used, including in documents that reference it | T3      | Specified |

**LIF-018 is the reuse consequence of a review date.** A component that has gone stale is stale in
every document using it, and the author of a report that transcludes it has no other way of knowing.

## 6. Retention and hold

| ID          | Requirement                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LIF-019** | Retention policies must be declarable per artifact type and per space                                                          | T3         | Specified |
| **LIF-020** | Archival must be distinct from deletion: archived content must remain retrievable and must stop appearing in ordinary listings | T3         | Specified |
| **LIF-021** | A legal hold must be applicable to an artifact or a space, and must prevent deletion regardless of any retention policy        | Constraint | Specified |
| **LIF-022** | A hold must record who applied it, when and why, and must be removable only by a recorded act                                  | T3         | Specified |
| **LIF-023** | Deletion must be refused where a baseline, a publication or a hold depends on what is being deleted (**VER-023**)              | Constraint | Specified |
| **LIF-024** | What deletion actually removes, and what it leaves in the audit record, must be stated rather than discovered                  | T3         | Specified |

## 7. Audit

| ID          | Requirement                                                                                                                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LIF-025** | The audit log must be append-only, and must be impossible to modify or delete through any product surface                                                                                                                      | Constraint | Specified |
| **LIF-026** | It must record at least: authentication, refused authorisation, content change, workflow transition, approval and signature, binding resolution and refresh, publication, export, permission change, and administrative action | T3         | Specified |
| **LIF-027** | Every entry must record who, what, when, and against which version                                                                                                                                                             | T3         | Specified |
| **LIF-028** | The log must be queryable and exportable by an administrator, and the export must be complete rather than a page of results                                                                                                    | T3         | Specified |
| **LIF-029** | The log must be readable independently of the content it describes, so that it still answers questions after content is archived                                                                                               | Constraint | Specified |
| **LIF-030** | The log must not contain secrets, credentials, or the value of a bound datum - it records that something happened, and **DAT** holds what the value was                                                                        | Constraint | Specified |
| **LIF-031** | Audit entries must be tenant-scoped like everything else (**IAM-005**)                                                                                                                                                         | Constraint | Specified |
| **LIF-032** | Clock skew must not be able to reorder the record: entries must carry a monotonic sequence as well as a timestamp                                                                                                              | T3         | Specified |

**LIF-030 is where audit and provenance divide.** An audit entry saying "this binding resolved" plus
a provenance record saying "to 31.9, from this query, at this time" is two systems each doing one
job. An audit log carrying values becomes a second copy of the data, with none of the access controls
that protect the first.

## 8. Compliance

| ID          | Requirement                                                                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-033** | The product must state which capabilities support a customer's compliance, and must not claim certification it does not hold                          | Constraint | Specified |
| **LIF-034** | Evidence an auditor asks for - who approved what, when, against which version, and can it be reproduced - must be producible without engineering help | T3         | Specified |
| **LIF-035** | Where a capability is built for a named regime, the requirement it satisfies must be recorded, so that a claim can be traced rather than asserted     | T3         | Specified |

**LIF-033 restates scope §11 because it is the requirement most likely to be softened by somebody
writing a sales page.** Capabilities that support compliance, never certifications of the product.

## 9. Non-requirements

| ID          | Not this                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **LIF-N01** | **Not an electronic signature provider.** The product records an attested act; a qualified signature is somebody else's business |
| **LIF-N02** | **No editing or deletion of audit entries**, by anybody, including an administrator                                              |
| **LIF-N03** | **No workflow scripting.** Transitions are declared, not programmed; an escape hatch here becomes an unauditable path            |
| **LIF-N04** | **Not a records management system** for anything other than this product's own content                                           |

## 10. Open questions

| ID          | Question                                                                                                                                                     | What would settle it                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **LIF-Q01** | **Which regimes are targeted first?** 21 CFR Part 11, SOX and GxP overlap but differ in what they require of a signature and a record                        | The first customer. It decides how much of section 4 is needed at once                          |
| **LIF-Q02** | **Is the audit log write-once at the storage layer, or only by policy?** LIF-025 says impossible through any product surface, which is weaker than immutable | The storage decision, and whether an auditor will accept application-enforced immutability      |
| **LIF-Q03** | **How does erasure of personal data work against LIF-025 (see VER-038)?**                                                                                    | One design decision covering both, taken with legal input                                       |
| **LIF-Q04** | **Do components have their own lifecycle, or only documents?** A component approved once and reused in forty reports is attractive and hard                  | Whether customers approve at the component level in practice, which differs sharply by industry |

## 11. Traceability

| This document | Rests on                                                    |
| ------------- | ----------------------------------------------------------- |
| Sections 3, 4 | Scope §7.8                                                  |
| LIF-013       | VER-013, VER-021 - a gate designates a revision             |
| LIF-011       | IAM-012 - re-assertable authentication                      |
| LIF-030       | DAT section 9 - provenance holds values, audit holds events |
| LIF-033       | Scope §11 - capabilities, not certifications                |
