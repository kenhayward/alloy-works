# ADM - Administration, cost and observability

> **Status: v1, for review.**

## 1. Purpose

Running a tenant, knowing what it costs, and knowing whether the product is working. This area owns
the administrative surfaces, the secret store, usage and cost reporting, operational observability,
and the one thing every multi-tenant product gets wrong at least once: how support helps a customer
without being able to read their content.

## 2. Depends on

| Rests on                                             | What it fixes                                               |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.17, §11 | Administration, cost visibility, observability, reliability |
| [IAM](IAM-identity-tenancy-and-access-control.md)    | The tenant boundary this must not cross                     |

| Not here                         | There   |
| -------------------------------- | ------- |
| Permissions and roles themselves | **IAM** |
| Retention policy and legal hold  | **LIF** |
| Style catalogues and themes      | **STY** |
| Model endpoints as a capability  | **GEN** |

## 3. Administration

| ID          | Requirement                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-001** | A tenant administrator must be able to manage users, roles, spaces, connections, model endpoints, workflow definitions, style catalogues, vocabularies and retention policies | T2         | Specified |
| **ADM-002** | Every administrative action must be audited (**LIF-026**)                                                                                                                     | Constraint | Specified |
| **ADM-003** | Administration must be reachable through the API on the same terms as the interface (**API-004**)                                                                             | T2         | Specified |
| **ADM-004** | A destructive administrative action must state what it will affect before it is confirmed                                                                                     | T2         | Specified |
| **ADM-005** | Configuration must be exportable and importable, so that a tenant can be reproduced (**IMP-018**)                                                                             | T3         | Specified |

## 4. Secrets

| ID          | Requirement                                                                                                                  | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-006** | Secrets must be held in a tenant-scoped store, write-only from any client's perspective (**DAT-003**)                        | Constraint | Specified |
| **ADM-007** | A secret must be replaceable without being read, and rotation must not require a period where both values are invalid        | T3         | Specified |
| **ADM-008** | Secrets must never appear in a log, a metric, a trace, an export, a crash report or an error, and each path must have a test | Constraint | Specified |
| **ADM-009** | Access to a secret must be audited by the fact of access, never by its value                                                 | Constraint | Specified |

## 5. Usage and cost

| ID          | Requirement                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **ADM-010** | AI token use must be attributable to a tenant, a user, a purpose and a document (**GEN-033**)                      | T5      | Specified |
| **ADM-011** | Query execution, storage, publication volume and asset storage must each be measured and attributable              | T3      | Specified |
| **ADM-012** | A tenant administrator must be able to see cost trends, not only a current total                                   | T5      | Specified |
| **ADM-013** | Budgets and alerts must be settable, and an alert must arrive before a limit rather than after                     | T5      | Specified |
| **ADM-014** | Where a budget is exhausted, what stops must be declared in advance: which capabilities degrade and which continue | T5      | Specified |

**ADM-014 is the requirement that turns a budget from a surprise into a policy.** A tenant that hits
a limit mid-review needs to know beforehand whether publishing still works, and a product that simply
stops answering has made its pricing model the customer's outage.

## 6. Observability

| ID          | Requirement                                                                                                                                                             | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-015** | Health, latency and error rate must be measured per capability, not only for the service as a whole                                                                     | T3         | Specified |
| **ADM-016** | The performance budgets in scope §11 must be measured in production, not only in tests, and reported against                                                            | T3         | Specified |
| **ADM-017** | A tenant administrator must be able to see diagnostics for their own tenant without raising a support ticket                                                            | T3         | Specified |
| **ADM-018** | Diagnostics visible to a tenant must contain no other tenant's data, and no content the viewer may not read                                                             | Constraint | Specified |
| **ADM-019** | Failures that a user would experience as "nothing happened" - an index not updating, a webhook not delivering, a query timing out - must be surfaced rather than logged | T3         | Specified |
| **ADM-020** | Availability, recovery point and recovery time objectives must be stated and measured against                                                                           | T3         | Specified |
| **ADM-021** | Degradation must be visible rather than silent: where a data source is unavailable, the product must say so (**scope §11**)                                             | Constraint | Specified |

**ADM-019 collects a failure mode this specification keeps meeting.** A search over a broken index, a
webhook that never arrives, a binding that quietly did not refresh - each looks to a user like an
absence rather than a fault, and the person who could tell the difference is not looking.

## 7. Support access

| ID          | Requirement                                                                                                                     | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-022** | Support must be able to diagnose a tenant's problem without reading that tenant's content by default                            | Constraint | Specified |
| **ADM-023** | Where access to content is genuinely needed, it must be granted by the tenant, time-bounded, scoped, and revocable              | Constraint | Specified |
| **ADM-024** | Every support access must be audited into the **tenant's own** audit log, visible to that tenant, not only into an internal one | Constraint | Specified |
| **ADM-025** | A tenant must be able to see, at any time, whether support access is currently active and what it covers                        | T3         | Specified |
| **ADM-026** | Support tooling must make the difference between metadata and content obvious, so that reading content is a deliberate act      | T3         | Specified |

**Section 7 is the part most products bolt on after an incident.** An engineer helping a customer at
speed will use whatever access they have, so the design decision is to make the useful access the
narrow one: identifiers, timings, error codes and configuration answer most questions, and content
answers few of them. Putting the access in the customer's own audit log is what makes the promise
checkable rather than cultural.

## 8. Non-requirements

| ID          | Not this                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **ADM-N01** | **No standing support access to tenant content** (ADM-023)                                                                    |
| **ADM-N02** | **No cross-tenant reporting**, including for the product's own analytics, other than aggregates that identify nobody          |
| **ADM-N03** | **Not a billing system.** Usage is measured and reported here; invoicing is somewhere else                                    |
| **ADM-N04** | **No configuration only reachable by the vendor.** Anything a tenant is entitled to change, a tenant administrator can change |

## 9. Open questions

| ID          | Question                                                                                                                                    | What would settle it                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **ADM-Q01** | **What data residency commitments are made?** It interacts with tenant isolation, model endpoints, malware scanning and translation vendors | The first customer who asks, which in this market is early                        |
| **ADM-Q02** | **Is usage metered for pricing, or only for visibility?** Metering for pricing makes every measurement a billing dispute waiting to happen  | The commercial model                                                              |
| **ADM-Q03** | **How much can support diagnose from metadata alone (ADM-022)?** The aspiration is most things; the practice will find the exceptions       | Experience. It should be revisited after the first hundred support cases          |
| **ADM-Q04** | **Who administers a tenant before it has an administrator?** Bootstrapping needs vendor action, which ADM-N04 is uncomfortable with         | A decision on onboarding, taken deliberately rather than by whoever builds signup |

## 10. Traceability

| This document      | Rests on                                        |
| ------------------ | ----------------------------------------------- |
| Section 4          | DAT-003 to DAT-005, scope §11 on secrets        |
| ADM-010            | GEN-033, token attribution                      |
| ADM-016, ADM-020   | Scope §11, performance budgets and reliability  |
| ADM-018, section 7 | IAM-001, the tenant boundary                    |
| ADM-021            | Scope §11, degrade visibly rather than silently |
