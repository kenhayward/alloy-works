# API - API, MCP and extensibility

> **Status: v1, for review.**

## 1. Purpose

How another system drives this one. This area owns the synchronous API and its specification, the
realtime surfaces the specification cannot describe, the MCP facade an agent uses, webhooks, and the
extension points for connectors, formats and styles.

Two decisions govern it, both from scope §9. **OpenAPI is the source of truth** for the synchronous
surface. And **MCP is a curated facade, not a mirror of the API** - a one-to-one mapping would produce
hundreds of thinly-described tools and degrade every model that touched it.

## 2. Depends on

| Rests on                                            | What it fixes                                    |
| --------------------------------------------------- | ------------------------------------------------ |
| [`Project_Scope.md`](../Project_Scope.md) §7.15, §9 | API-first; the curated MCP surface               |
| [IAM](IAM-identity-tenancy-and-access-control.md)   | Service identities, scoped tokens, no escalation |

| Not here                         | There                     |
| -------------------------------- | ------------------------- |
| What a token may do              | **IAM**                   |
| The assistant inside the product | **GEN**                   |
| Which events exist               | **COL**, **LIF**, **PUB** |
| Rate and cost reporting          | **ADM**                   |

## 3. The synchronous API

| ID          | Requirement                                                                                                         | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-001** | The product's own clients must use the same API as any other caller, with no privileged path                        | Constraint | Specified |
| **API-002** | OpenAPI must be the source of truth for the synchronous surface, and client types must be generated from it         | Constraint | Specified |
| **API-003** | Contract tests must fail when the implementation and the specification disagree                                     | T1         | Specified |
| **API-004** | Every capability the interface offers must be reachable through the API                                             | T1         | Specified |
| **API-005** | Errors must be structured, with a stable machine-readable code alongside a human-readable message                   | T1         | Specified |
| **API-006** | An error must name what failed and, where relevant, which requirement or rule refused it                            | T1         | Specified |
| **API-007** | Listing endpoints must page consistently, with a stable order and an opaque cursor                                  | T1         | Specified |
| **API-008** | Mutating requests must be idempotent when given an idempotency key, so that a retry cannot create a second document | T1         | Specified |
| **API-009** | Rate limits must be declared, and a limited response must say when to retry                                         | T2         | Specified |

**API-001 is the requirement everything else here depends on.** An API the product does not itself
use is an API nobody tests, and the gap shows up as the capabilities a customer needs being the ones
that were never exposed.

## 4. Versioning

| ID          | Requirement                                                                                                   | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-010** | The API must be versioned, and a breaking change must require a new version rather than a note in a changelog | Constraint | Specified |
| **API-011** | A deprecated version must be announced with a date, and must keep working until it                            | T3         | Specified |
| **API-012** | Adding a field must never break a caller, and callers must be told to ignore fields they do not know          | T1         | Specified |
| **API-013** | Deprecation must be visible in the response, not only in documentation                                        | T3         | Specified |

## 5. Realtime

| ID          | Requirement                                                                                                                       | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-014** | Presence, locks, notifications and streaming model responses must be specified separately from OpenAPI, which cannot express them | T3         | Specified |
| **API-015** | That specification must be as authoritative as the OpenAPI one, and must be tested the same way                                   | T3         | Specified |
| **API-016** | A realtime connection must authenticate and authorise exactly as a request does, and must re-check on reconnect                   | Constraint | Specified |
| **API-017** | Realtime delivery must be at-least-once with client-side de-duplication, or must state plainly that it is not                     | T3         | Specified |

**API-014 exists because a specification that is complete only on paper is worse than an incomplete
one.** Presence and streaming are the parts a client integrator most needs described, and pretending
OpenAPI covers them means they get described in a support conversation instead.

## 6. MCP

| ID          | Requirement                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-018** | The MCP surface must be a small set of task-shaped tools over the API, never a generated mirror of it                                  | Constraint | Specified |
| **API-019** | Each tool must be described for a model rather than for a developer: what it is for, when to use it, and what it returns               | T5         | Specified |
| **API-020** | A tool must act with the calling identity's permissions, with no path to exceeding them (**IAM-036**)                                  | Constraint | Specified |
| **API-021** | A tool that changes anything must be distinguishable from one that reads, and the distinction must be visible to the calling agent     | T5         | Specified |
| **API-022** | Content returned to a model through MCP must be data, never instructions, on the same terms as **GEN-017**                             | Constraint | Specified |
| **API-023** | Tool use must be audited with the identity, the tool, the arguments and the outcome                                                    | T5         | Specified |
| **API-024** | The number of tools must be kept small deliberately, and adding one must be a decision rather than a consequence of adding an endpoint | Constraint | Specified |

**API-024 is the requirement that keeps decision 6 from eroding.** Nothing stops an MCP surface
growing one tool at a time until it is the mirror it was not supposed to be, and each addition will
be individually reasonable.

## 7. Webhooks

| ID          | Requirement                                                                                                                 | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-025** | Content, workflow, review and publication events must be deliverable as webhooks                                            | T5         | Specified |
| **API-026** | A webhook payload must say that something happened and identify it, and must not carry content the endpoint may not receive | Constraint | Specified |
| **API-027** | Deliveries must be signed, so that a receiver can verify the sender                                                         | Constraint | Specified |
| **API-028** | Failed deliveries must be retried with backoff, and a persistently failing endpoint must be disabled and reported           | T5         | Specified |
| **API-029** | Deliveries must be inspectable by an administrator, including what was sent and what came back                              | T5         | Specified |

## 8. Extension points

| ID          | Requirement                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-030** | Data source connectors must be addable without changing the product (**DAT-054**)                     | T5         | Specified |
| **API-031** | Output formats should be addable as extensions                                                        | T5         | Specified |
| **API-032** | Citation styles must be addable without a code change (**STY-023**)                                   | T6         | Specified |
| **API-033** | An extension must declare what it needs and must run with no more authority than that                 | Constraint | Specified |
| **API-034** | An extension failure must be attributable to the extension, never reported as a defect in the product | T5         | Specified |

## 9. Non-requirements

| ID          | Not this                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| **API-N01** | **No MCP surface generated from the API** (API-018)                                                                        |
| **API-N02** | **No privileged internal API** that the product's own clients use and others cannot (API-001)                              |
| **API-N03** | **No arbitrary code execution as an extension point.** Extensions are declared and sandboxed, or they are not extensions   |
| **API-N04** | **No GraphQL surface alongside the REST one**, unless something forces it. Two APIs are two contracts and two sets of bugs |

## 10. Open questions

| ID          | Question                                                                                                                                | What would settle it                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **API-Q01** | **Which realtime transport, and is it one channel or several?** Open decision 7 in scope §10                                            | A spike once the collaboration requirements are being built      |
| **API-Q02** | **How many MCP tools is the right number (API-024)?** Too few and an agent cannot do the job; too many and it does none of them well    | Evaluation against real tasks, which is the only way to find out |
| **API-Q03** | **Where do extensions run?** In-process is fast and dangerous; out-of-process is safe and slow, and both are a support burden           | The architecture, and how much a connector is expected to do     |
| **API-Q04** | **Is the API public, or for integrators under contract?** It changes what deprecation costs and how much the specification must promise | A commercial decision as much as a technical one                 |

## 11. Traceability

| This document    | Rests on                                            |
| ---------------- | --------------------------------------------------- |
| API-002, API-003 | Scope §9 decision 5, OpenAPI as the source of truth |
| API-018, API-024 | Scope §9 decision 6, a curated facade               |
| API-020, API-022 | IAM-036, GEN-017                                    |
| API-014          | Scope §7.15, realtime specified separately          |
| Section 8        | Scope §7.15 extension points, in priority order     |
