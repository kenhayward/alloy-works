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

| Not here                                                  | There   |
| --------------------------------------------------------- | ------- |
| Permissions and roles themselves                          | **IAM** |
| Retention policy and legal hold                           | **LIF** |
| Style catalogues and themes                               | **STY** |
| Model endpoints as a capability                           | **GEN** |
| The audit log itself - append-only, queryable, exportable | **LIF** |
| What deletion actually removes                            | **LIF** |
| Provisioning users from an identity provider              | **IAM** |
| Rate limits, including on the administrative surface      | **API** |
| Delivering a notification, in an inbox or by email        | **COL** |

**Three things review asked this document to confirm rather than assume, now confirmed.** The audit
log is append-only and impossible to modify through any product surface (**LIF-025**), and it is
queryable and exportable (**LIF-028**) - so this area needs to say who may read a tenant's own log,
not how the log is kept (ADM-038, ADM-039). Users are provisioned from an identity provider by
**IAM-008**. The administrative API is reachable on the same terms as the interface (ADM-003), which
includes the declared rate limits of **API-009**; there is no separate administrative back door for a
limit to miss.

## 3. Administration

| ID          | Requirement                                                                                                                                                                                                                                                           | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-001** | A tenant administrator must be able to manage users, roles, spaces, connections, model endpoints, workflow definitions, style catalogues, vocabularies and retention policies                                                                                         | T2         | Specified |
| **ADM-002** | Every administrative action must be audited (**LIF-026**)                                                                                                                                                                                                             | Constraint | Specified |
| **ADM-003** | Administration must be reachable through the API on the same terms as the interface (**API-004**)                                                                                                                                                                     | T2         | Specified |
| **ADM-004** | A destructive administrative action must state what it will affect before it is confirmed                                                                                                                                                                             | T2         | Specified |
| **ADM-005** | Configuration must be exportable and importable, so that a tenant can be reproduced (**IMP-018**)                                                                                                                                                                     | T3         | Specified |
| **ADM-027** | A configuration export must carry a reference to each secret rather than its value, and an import must bind every reference to a secret in the receiving tenant. An import with an unbound reference must be refused, naming each one (ADM-005, ADM-008, **IMP-018**) | T3         | Specified |

**ADM-027 states what ADM-005 and ADM-008 together imply.** A tenant that can be reproduced from its
configuration, and an export that carries no secret, only reconcile if the export carries references
and the import rebinds them. That was implicit, which is the condition under which two implementers
build two different things and both believe they are right.

### The tenant's own audit trail

ADM-002, ADM-009 and ADM-024 all write into the tenant's audit log, and nothing said who may read it.
**LIF** owns the log: append-only (LIF-025), queryable and exportable (LIF-028), retained by policy.
Owning the log is not the same as granting a tenant administrator sight of their own.

| ID          | Requirement                                                                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **ADM-038** | A tenant administrator must be able to read and search their own tenant's audit log, filtered by actor, action, date and artifact, without raising a support ticket | T3      | Specified |
| **ADM-039** | A tenant administrator must be able to export their own tenant's audit log, complete rather than a page of results (**LIF-028**), scoped to that tenant alone       | T3      | Specified |

### The life of a tenant

Review found this the largest gap, and it was right: **ADM-Q04** covered the moment before a tenant
has an administrator, and nothing covered any moment after. Suspension, the end of a contract and
offboarding are administrative acts on a running tenant, which is what this area is for. What
deletion then removes is **LIF-024**; how long anything is kept is **LIF**'s retention policy.

| ID          | Requirement                                                                                                                                                                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **ADM-028** | A tenant must be suspendable: sign-in and API access stop, content and configuration are retained untouched, the reason is recorded, and the suspension is reversible without loss                                                                                 | T3      | Specified |
| **ADM-029** | Before a tenant is closed, its administrator must be able to take a complete export of content, configuration and audit (**IMP-018**, ADM-039). Closure must not proceed until that export has been offered, and whether it was taken or declined must be recorded | T3      | Specified |
| **ADM-030** | Closing a tenant must be a deliberate, audited act with a declared grace period before anything is deleted, reversible throughout that period (**ADM-Q06**)                                                                                                        | T3      | Specified |
| **ADM-031** | Suspension and closure must each declare in advance which capabilities stop and which continue - in-flight publications, scheduled work, webhook delivery - as ADM-014 does for an exhausted budget                                                                | T3      | Specified |

**ADM-029 is the requirement a customer will judge the product by, once.** Getting content out at the
end of a contract is the moment a component content management system either proves that the content
was always the customer's or reveals that it was not. Offering the export as part of closure, rather
than as a support request during a notice period, is the difference.

## 4. Secrets

| ID          | Requirement                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **ADM-006** | Secrets must be held in a tenant-scoped store, write-only from any client's perspective (**DAT-003**)                                    | Constraint | Specified |
| **ADM-007** | A secret must be replaceable without being read, and rotation must not require a period where both values are invalid                    | T3         | Specified |
| **ADM-008** | Secrets must never appear in a log, a metric, a trace, an export, a crash report or an error, and each path must have a test             | Constraint | Specified |
| **ADM-009** | Access to a secret must be audited by the fact of access, never by its value                                                             | Constraint | Specified |
| **ADM-032** | An administrator must be able to see what consumes a secret - which connections, model endpoints and scheduled work - before rotating it | T3         | Specified |

**ADM-032 closes the other half of rotation.** ADM-007 makes a secret replaceable without a gap
where neither value works; ADM-032 makes it possible to know what to smoke-test afterwards. An
administrator who rotates a credential and then waits to find out what broke has been given a
capability and not a tool.

## 5. Usage and cost

| ID          | Requirement                                                                                                                                                                                                                                 | Tranche | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **ADM-010** | AI token use must be attributable to a tenant, a user, a purpose and a document (**GEN-033**)                                                                                                                                               | T5      | Specified             |
| **ADM-011** | Query execution, storage, publication volume and asset storage must each be measured and attributable                                                                                                                                       | T3      | Specified             |
| **ADM-012** | A tenant administrator must be able to see cost trends, not only a current total                                                                                                                                                            | T5      | Superseded by ADM-033 |
| **ADM-013** | Budgets and alerts must be settable, and an alert must arrive before a limit rather than after                                                                                                                                              | T5      | Specified             |
| **ADM-014** | Where a budget is exhausted, what stops must be declared in advance: which capabilities degrade and which continue                                                                                                                          | T5      | Specified             |
| **ADM-033** | Cost and usage must be presented as a trend over time, broken down per capability (ADM-010, ADM-011) and per period, with at least twelve months of history kept where the tenant has been running that long                                | T5      | Specified             |
| **ADM-034** | A budget alert (ADM-013) must be delivered to named recipients through the notification channels **COL** owns (**COL-033**), and who receives it must be configurable by a tenant administrator                                             | T5      | Specified             |
| **ADM-035** | The precision at which usage is recorded, and how long usage records are kept, must be declared before measurement begins rather than inferred from the data afterwards (**LIF** owns retention policy; **ADM-Q02** can only raise the bar) | T3      | Specified             |

**ADM-033 replaces ADM-012 because "cost trends" was not a thing anybody could fail.** Review was
right that ADM-012 and ADM-017 were the two an implementer would argue hardest about. A trend per
capability, per period, with a stated history, is the same intent with a floor under it - and the
breakdown is the part that answers the question an administrator actually has, which is not "what do
we spend" but "on what".

**ADM-035 is ADM-Q02 feeding backwards.** Whether usage is metered for pricing or only for
visibility changes how precisely it must be measured and how long each record must survive a
dispute. That cannot be decided after the measurements start, because the records that would settle
an argument are the ones taken before anybody knew there would be one.

**ADM-014 is the requirement that turns a budget from a surprise into a policy.** A tenant that hits
a limit mid-review needs to know beforehand whether publishing still works, and a product that simply
stops answering has made its pricing model the customer's outage.

## 6. Observability

| ID          | Requirement                                                                                                                                                                                                                                                                                 | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **ADM-015** | Health, latency and error rate must be measured per capability, not only for the service as a whole                                                                                                                                                                                         | T3         | Specified             |
| **ADM-016** | The performance budgets in scope §11 must be measured in production as well as in tests, and the measurements must be reported against those budgets                                                                                                                                        | T3         | Specified             |
| **ADM-017** | A tenant administrator must be able to see diagnostics for their own tenant without raising a support ticket                                                                                                                                                                                | T3         | Specified             |
| **ADM-018** | Diagnostics visible to a tenant must contain no other tenant's data, and no content the viewer may not read                                                                                                                                                                                 | Constraint | Specified             |
| **ADM-019** | Failures that a user would experience as "nothing happened" - an index not updating, a webhook not delivering, a query timing out - must be surfaced rather than logged                                                                                                                     | T3         | Superseded by ADM-037 |
| **ADM-020** | Availability, recovery point and recovery time objectives must be stated, and actual availability, recovery point and recovery time must be measured against them                                                                                                                           | T3         | Specified             |
| **ADM-021** | Degradation must be visible rather than silent: where a data source is unavailable, the product must say so (**scope §11**)                                                                                                                                                                 | Constraint | Specified             |
| **ADM-036** | The diagnostics a tenant administrator can see (ADM-017) must include at least: health, latency and error rate per capability (ADM-015), the state of the search index, the delivery state of webhooks, the outcome of recent scheduled work, and the tenant's position against its budgets | T3         | Specified             |
| **ADM-037** | Failures a user would experience as "nothing happened" - an index not updating, a webhook not delivering, a query timing out - must be surfaced to the tenant administrator in those diagnostics (ADM-036), and to the user waiting on the result where there is one                        | T3         | Specified             |

**ADM-037 collects a failure mode this specification keeps meeting, and now says who is told.** A
search over a broken index, a webhook that never arrives, a binding that quietly did not refresh -
each looks to a user like an absence rather than a fault, and the person who could tell the
difference is not looking. ADM-019 said such a failure must be "surfaced rather than logged" without
saying to whom, which review pointed out is a promise that can be kept by writing to a screen nobody
opens.

**ADM-036 puts a floor under ADM-017.** "Diagnostics" granted access to something the document never
described; a list of what must be in it is what makes the requirement refutable. It is a minimum and
not a maximum - the point is that a tenant administrator can answer "is it us or is it you" without
a support ticket, and each item is one they would otherwise have raised one about.

**ADM-016 and ADM-020 read as though they had been cut off mid-sentence.** They had not - both put
the object first - but a careful reader called them truncated, which is enough. Both are reworded to
say the same thing forwards.

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

| ID          | Not this                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADM-N01** | **No standing support access to tenant content** (ADM-023)                                                                                                                     |
| **ADM-N02** | **No cross-tenant reporting**, including for the product's own analytics, other than aggregates that identify nobody                                                           |
| **ADM-N03** | **Not a billing system.** Usage is measured and reported here; invoicing is somewhere else                                                                                     |
| **ADM-N04** | **No configuration only reachable by the vendor.** Anything a tenant is entitled to change, a tenant administrator can change                                                  |
| **ADM-N05** | **Not a notification system.** This area decides what is worth alerting on and who should receive it; the inbox, the email and the delivery are **COL**'s (COL-033 to COL-036) |

## 9. Open questions

| ID          | Question                                                                                                                                                                                  | What would settle it                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADM-Q01** | **What data residency commitments are made?** It interacts with tenant isolation, model endpoints, malware scanning and translation vendors                                               | The first customer who asks, which in this market is early                                                                                                                                                                                       |
| **ADM-Q02** | **Is usage metered for pricing, or only for visibility?** Metering for pricing makes every measurement a billing dispute waiting to happen                                                | The commercial model. Settling it feeds straight back into ADM-010, ADM-011 and ADM-035: metering for pricing raises the precision each measurement needs and the time each record must survive, neither of which can be applied retrospectively |
| **ADM-Q03** | **How much can support diagnose from metadata alone (ADM-022)?** The aspiration is most things; the practice will find the exceptions                                                     | Experience. It should be revisited after the first hundred support cases                                                                                                                                                                         |
| **ADM-Q04** | **Who administers a tenant before it has an administrator?** Bootstrapping needs vendor action, which ADM-N04 is uncomfortable with                                                       | A decision on onboarding, taken deliberately rather than by whoever builds signup                                                                                                                                                                |
| **ADM-Q05** | **Who may close a tenant (ADM-030)?** ADM-N04 says nothing is vendor-only, but ending a contract is a commercial act and a customer cannot be the sole author of an irreversible deletion | The commercial model, taken with ADM-Q04 - the two are the same decision at opposite ends of a tenant's life                                                                                                                                     |
| **ADM-Q06** | **How long is the grace period in ADM-030, and what survives it?** A legal hold (**LIF-021**) prevents deletion regardless of retention policy, which a closing tenant has to reckon with | Legal input, taken with **LIF**. The hold question is the one that decides whether closure can ever be final                                                                                                                                     |

## 10. Traceability

| This document      | Rests on                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| Section 4          | DAT-003 to DAT-005, scope §11 on secrets                                         |
| ADM-010            | GEN-033, token attribution                                                       |
| ADM-016, ADM-020   | Scope §11, performance budgets and reliability                                   |
| ADM-018, section 7 | IAM-001, the tenant boundary                                                     |
| ADM-021            | Scope §11, degrade visibly rather than silently                                  |
| ADM-002, ADM-009   | LIF-026, what the audit log records; LIF-025, that it is append-only             |
| ADM-003            | API-004, administration on the same terms as the interface; API-009, rate limits |
| ADM-005, ADM-027   | IMP-018, the whole-tenant export                                                 |
| ADM-027 to ADM-039 | [The v1 review](<../../reviews/ADM - Administration.md>); section 11             |
| ADM-034, ADM-N05   | COL-033 to COL-036, notification delivery                                        |
| ADM-038, ADM-039   | LIF-025, LIF-028, the audit log itself                                           |

## 11. Change history

One row per change, against [the review](<../../reviews/ADM - Administration.md>) that prompted it. A material change to a
requirement gets a new identifier and supersedes the old one rather than being edited in place;
rewording for clarity is an edit. The rules are in
[the index](README.md#how-a-requirement-is-written).

### From the v1 review

| Review point                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADM-016 and ADM-020 end mid-sentence        | Neither was truncated - both put the object first - but a reviewer read them as cut off, so both are **reworded** to say the same thing forwards. An edit, not a new identifier                                                                                                                                                                                                                                         |
| Traceability is incomplete                  | Rows added for API-004 (ADM-003), IMP-018 (ADM-005), LIF-025 and LIF-026 (ADM-002, ADM-009), and for everything this revision adds                                                                                                                                                                                                                                                                                      |
| ADM-012 is directional rather than testable | **Superseded by ADM-033**: a trend per capability, per period, with at least twelve months of history. Same intent, with a floor under it                                                                                                                                                                                                                                                                               |
| ADM-017 is directional rather than testable | **ADM-036** lists what the diagnostics view must contain at minimum - per-capability health, latency and error rate, index state, webhook delivery, recent scheduled work, budget position. ADM-017 keeps granting the access; ADM-036 says what is behind it                                                                                                                                                           |
| ADM-019 does not say surfaced to whom       | **Superseded by ADM-037**: to the tenant administrator in the diagnostics view, and to the user waiting on the result where there is one                                                                                                                                                                                                                                                                                |
| Tenant view of its own audit trail          | **ADM-038** (read and search, filtered, without a support ticket) and **ADM-039** (export, complete and tenant-scoped). **LIF** owns the log; this area owns who may look at their own                                                                                                                                                                                                                                  |
| Budget alert delivery                       | **ADM-034**: delivered to configurable named recipients through **COL**'s notification channels, with **ADM-N05** stating plainly that this area is not a notification system                                                                                                                                                                                                                                           |
| Configuration export versus secrets         | **ADM-027** states what ADM-005 and ADM-008 implied: exports carry a reference per secret, imports rebind them, and an unbound reference refuses the import by name                                                                                                                                                                                                                                                     |
| Tenant lifecycle beyond bootstrapping       | The largest gap, and it was real. **ADM-028** (suspension, reversible, content retained), **ADM-029** (a complete export offered before closure, recorded either way), **ADM-030** (closure deliberate, audited, with a reversible grace period), **ADM-031** (what stops and what continues). **ADM-Q05** asks who may close a tenant, **ADM-Q06** how long the grace period runs and whether a legal hold survives it |
| Usage-data retention and precision          | **ADM-035**: precision and retention declared before measurement begins. ADM-Q02 now records that settling it feeds back into ADM-010, ADM-011 and ADM-035, none of which can be applied retrospectively                                                                                                                                                                                                                |
| Secret dependency visibility                | **ADM-032**: an administrator can see what consumes a secret before rotating it, so what to check afterwards is known rather than guessed                                                                                                                                                                                                                                                                               |

### Cross-document checks the review asked for, and what they found

| Check                                   | Finding                                                                                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit-log integrity                     | **Confirmed, and not where the review guessed.** LIF-025 makes the log append-only and impossible to modify through any product surface; LIF-026 is what it records. LIF-Q02 asks whether that is enforced at the storage layer or only by policy, which is the harder half |
| SCIM and identity-provider provisioning | **Confirmed: IAM-008**, with a documented manual path where a customer has no SCIM. Boundary row added                                                                                                                                                                      |
| Throttling of the administrative API    | **Confirmed by construction.** ADM-003 puts administration on the same terms as the interface, so API-009's declared rate limits apply to it; there is no separate administrative surface for a limit to miss. Boundary row added                                           |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 26     | 39, of which 2 superseded |
| Non-requirements | 4      | 5                         |
| Open questions   | 4      | 6                         |
