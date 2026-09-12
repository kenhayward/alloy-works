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

| Not here                             | There                     |
| ------------------------------------ | ------------------------- |
| What a token may do                  | **IAM**                   |
| The assistant inside the product     | **GEN**                   |
| Which events exist                   | **COL**, **LIF**, **PUB** |
| Rate and cost reporting              | **ADM**                   |
| Bringing foreign content in at scale | **IMP**                   |
| What a lock means, and who holds one | **COL**                   |
| Whether a binding can still resolve  | **DAT**                   |

## 3. The synchronous API

| ID          | Requirement                                                                                                                                                                                                                                      | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **API-001** | The product's own clients must use the same API as any other caller, with no privileged path                                                                                                                                                     | Constraint | Specified             |
| **API-002** | OpenAPI must be the source of truth for the synchronous surface, and client types must be generated from it                                                                                                                                      | Constraint | Specified             |
| **API-003** | Contract tests must fail when the implementation and the specification disagree                                                                                                                                                                  | T1         | Specified             |
| **API-004** | Every capability the interface offers must be reachable through the API                                                                                                                                                                          | T1         | Specified             |
| **API-005** | Errors must be structured, with a stable machine-readable code alongside a human-readable message                                                                                                                                                | T1         | Specified             |
| **API-006** | An error must name what failed and, where relevant, which requirement or rule refused it                                                                                                                                                         | T1         | Specified             |
| **API-007** | Listing endpoints must page consistently, with a stable order and an opaque cursor                                                                                                                                                               | T1         | Specified             |
| **API-008** | Mutating requests must be idempotent when given an idempotency key, so that a retry cannot create a second document                                                                                                                              | T1         | Specified             |
| **API-009** | Rate limits must be declared, and a limited response must say when to retry                                                                                                                                                                      | T2         | Superseded by API-051 |
| **API-037** | A mutating request against a versioned resource must carry a precondition naming the version it was read at, and the server must refuse a mismatch with a distinct machine-readable code (API-005) naming the version the resource is at now     | T1         | Specified             |
| **API-038** | There must be no unconditional overwrite: a mutating request with no precondition must be refused rather than treated as latest-wins                                                                                                             | Constraint | Specified             |
| **API-039** | A component lock (**COL-005**) must hold at the API exactly as it does in the interface: a mutating request against a component another identity holds must be refused, naming the holder and when the lock is expected to release (**COL-007**) | Constraint | Specified             |
| **API-047** | Every response must carry a request identifier, echoing the caller's own where one was given, and that identifier must appear in the server's logs and in any error the response reports (API-005)                                               | T1         | Specified             |
| **API-050** | The synchronous surface must declare availability and latency objectives of its own, and must be measured in production against them (**ADM-016**, **ADM-020**). Realtime already has one in API-036 (**API-Q07**)                               | T3         | Specified             |
| **API-051** | Rate limits must be declared in the API specification itself, so that a contract test can verify them (API-003), and a limited response must say when to retry                                                                                   | T2         | Specified             |
| **API-053** | Authentication and authorisation failures must follow the **IAM** contract and its distinction between unauthenticated and forbidden, rather than inventing a second vocabulary here                                                             | Constraint | Specified             |

**API-037 to API-039 answer what review ranked as the biggest hole: two integrators writing to one
component.** The answer has two halves, and only the first is the usual one. A version precondition
makes a lost update impossible rather than unlikely, and refusing a request that carries no
precondition (API-038) is what stops "latest wins" being reintroduced by a caller who simply omits
it - an optional precondition protects only the careful.

**The second half is that the lock is not advisory, and API-001 is why.** The product's own editor
reaches content through this API, so a rule that applies to the editor applies to every caller or it
applies to nobody. COL-005 says a component is editable by one user at a time; API-039 says that
sentence means the same thing at the API. The two mechanisms answer different questions - the lock
stops two people starting, the precondition stops two writes landing - and a system with multiple
driving systems needs both.

**API-047 is the cheapest requirement in this document.** An integrator's first support message
quotes a request that failed; without an identifier in the response, answering it means guessing from
timestamps. API-014's paragraph says the parts an integrator most needs are the parts that otherwise
get described in a support conversation, and this is the same argument one layer down.

**API-001 is the requirement everything else here depends on.** An API the product does not itself
use is an API nobody tests, and the gap shows up as the capabilities a customer needs being the ones
that were never exposed.

## 4. Versioning

| ID          | Requirement                                                                                                                                                        | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **API-010** | The API must be versioned, and a breaking change must require a new version rather than a note in a changelog                                                      | Constraint | Specified |
| **API-011** | A deprecated version must be announced with a removal date, and must keep working until that date                                                                  | T3         | Specified |
| **API-012** | Adding a field must never break a caller, and callers must be told to ignore fields they do not know                                                               | T1         | Specified |
| **API-013** | Deprecation must be visible in the response, not only in documentation                                                                                             | T3         | Specified |
| **API-052** | A new major API version must state what happens to the MCP surface: which tools move with it, which stay pinned to the older version, and when the older ones stop | T5         | Specified |

**API-011 was truncated** - it ended "must keep working until it" - and now names the removal date it
was reaching for. A reworded requirement keeps its identifier; the obligation has not changed.

**API-052 closes a question the two surfaces raise together.** MCP is a curated facade (API-018), so
it does not follow the API version automatically, and an agent holding a tool through a version
change needs to know whether its tool changed under it. The requirement is not which answer a
particular version gives, but that every version gives one.

## 5. Realtime

| ID          | Requirement                                                                                                                                                              | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **API-014** | Presence, locks, notifications and streaming model responses must be specified separately from OpenAPI, which cannot express them                                        | T3         | Specified |
| **API-015** | That specification must be as authoritative as the OpenAPI one, and must be tested the same way                                                                          | T3         | Specified |
| **API-016** | A realtime connection must authenticate and authorise exactly as a request does, and must re-check on reconnect                                                          | Constraint | Specified |
| **API-017** | Realtime delivery must be at-least-once with client-side de-duplication, or must state plainly that it is not                                                            | T3         | Specified |
| **API-035** | A realtime client must converge on the current state from a snapshot on every connect and reconnect, so that no missed event can leave it wrong                          | T3         | Specified |
| **API-036** | A change to presence, a lock or the inbox must reach every connected viewer entitled to it within a stated interval - provisionally p95 of 250ms, never above one second | Constraint | Specified |

**API-035 is how API-017 is answered.** Individual realtime events are not guaranteed and are not
replayed; the picture on a screen is, because it is rebuilt from a snapshot whenever the connection
is. Anything a person must not miss - a notification - is a row in their inbox, not an event.

**API-014 exists because a specification that is complete only on paper is worse than an incomplete
one.** Presence and streaming are the parts a client integrator most needs described, and pretending
OpenAPI covers them means they get described in a support conversation instead.

## 6. Long-running work

Some of what another system will ask for cannot finish inside a request: generating a hundred
documents from a parameter set (**REU**), exporting a tenant (**IMP-018**), publishing a long report
(**PUB**), a connector run over a slow source (**DAT**). Review found this silent - neither
specified nor ruled out - which leaves the first integrator to meet it inventing a polling convention
of their own.

| ID          | Requirement                                                                                                                                                    | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **API-040** | Work that can outlive a request must be submitted as a job and must return a job identity immediately, rather than holding the request open until it finishes  | T3      | Specified |
| **API-041** | A job's state must be pollable - accepted, running, succeeded, failed or cancelled - with when it started and, where it is knowable, how far it has got        | T3      | Specified |
| **API-042** | A job must be cancellable, and a cancelled job must state what it had already done and what it had not                                                         | T3      | Specified |
| **API-043** | A failed job must report its failure in the same structured shape as a synchronous error (API-005, API-006), and must remain inspectable after it has finished | T3      | Specified |
| **API-044** | Exporting at scale must be a job (**IMP-018**, **IMP-020**) rather than something a caller assembles by paging every resource                                  | T3      | Specified |

**API-042 asks for more than a cancel button.** Cancelling a publication halfway leaves a question -
what exists now - and a job that simply reports "cancelled" makes the caller find out by looking.
Saying what was done is what lets an integrator decide whether to retry or to clean up.

**API-044 and API-N05 are the two halves of "moving content at scale".** Out is a job, because a
whole-tenant export is defined once in **IMP** and should not be re-derived by a caller paging
endpoints. In is not an API operation at all: **IMP-003** says import never runs unattended, at any
scale, for any customer, and an unattended bulk-create endpoint would be that rule with a different
door. Whether native content - content this product already holds, moving between tenants or systems
that both speak its own format - needs batch endpoints is a different question, and an open one
(**API-Q05**).

## 7. MCP

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

## 8. Webhooks

| ID          | Requirement                                                                                                                                                                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **API-025** | Content, workflow, review and publication events must be deliverable as webhooks                                                                                                                                                                                                            | T5         | Specified |
| **API-026** | A webhook payload must say that something happened and identify it, and must not carry content the endpoint may not receive                                                                                                                                                                 | Constraint | Specified |
| **API-027** | Deliveries must be signed, so that a receiver can verify the sender                                                                                                                                                                                                                         | Constraint | Specified |
| **API-028** | Failed deliveries must be retried with backoff, and a persistently failing endpoint must be disabled and reported                                                                                                                                                                           | T5         | Specified |
| **API-029** | Deliveries must be inspectable by an administrator, including what was sent and what came back                                                                                                                                                                                              | T5         | Specified |
| **API-045** | Every delivery of one event must carry the same event identifier, so that a receiver which has already processed a delivery can discard a redelivery of it (API-028)                                                                                                                        | Constraint | Specified |
| **API-046** | Webhook delivery must state plainly what ordering it guarantees. Where it guarantees none across event types, each event must carry what is needed to order it - the version or sequence it belongs to - so that a receiver can order what matters to it rather than trusting arrival order | T5         | Specified |

**API-045 and API-046 are both about what a receiver is entitled to assume.** A delivery that times
out after the receiver has processed it will be sent again, so without a stable event identifier the
only safe receiver is one that can process everything twice - which is a requirement nobody told the
integrator about. Ordering is the same shape of problem: an integrator will assume a publication
event arrives after the review event that preceded it, and retries with backoff mean it may not.
Saying so, and giving them something to sort by, costs one field.

## 9. Extension points

| ID          | Requirement                                                                                                                                                                                                                                      | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **API-030** | Data source connectors must be addable without changing the product (**DAT-054**)                                                                                                                                                                | T5         | Specified |
| **API-031** | Output formats should be addable as extensions                                                                                                                                                                                                   | T5         | Specified |
| **API-032** | Citation styles must be addable without a code change (**STY-023**)                                                                                                                                                                              | T6         | Specified |
| **API-033** | An extension must declare what it needs and must run with no more authority than that                                                                                                                                                            | Constraint | Specified |
| **API-034** | An extension failure must be attributable to the extension, never reported as a defect in the product                                                                                                                                            | T5         | Specified |
| **API-048** | An extension must be updatable and removable, and removing one must state what depends on it before it is removed                                                                                                                                | T5         | Specified |
| **API-049** | Removing a connector must not alter or delete the content produced while it was installed. What becomes of bindings that depended on it must be stated - refused refresh, reported as unavailable (**DAT**) - and must never be silent staleness | Constraint | Specified |

**API-049 is the question a customer asks after they have already removed it.** A connector's output
is content the tenant owns, so removing the connector cannot reach back into it - but the bindings
that pointed at the source now cannot resolve, and a binding that quietly keeps showing the last
value it saw is exactly the silent staleness this specification rules out everywhere else.

## 10. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-N01** | **No MCP surface generated from the API** (API-018)                                                                                                                                                                                          |
| **API-N02** | **No privileged internal API** that the product's own clients use and others cannot (API-001)                                                                                                                                                |
| **API-N03** | **No arbitrary code execution as an extension point.** Extensions are declared and sandboxed, or they are not extensions                                                                                                                     |
| **API-N04** | **No GraphQL surface alongside the REST one**, unless something forces it. Two APIs are two contracts and two sets of bugs                                                                                                                   |
| **API-N05** | **No unattended bulk import through the API.** Bringing foreign content in is **IMP**'s attended flow (IMP-001 to IMP-003): a proposal a person accepts, and a report of what was dropped. An endpoint that skipped it would skip the person |

## 11. Open questions

| ID          | Question                                                                                                                                                                                                                                      | What would settle it                                                                                                                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-Q01** | **Which realtime transport, and is it one channel or several?** Open decision 7 in scope §10                                                                                                                                                  | **Settled** by a spike. One Server-Sent Events stream per open document for presence, locks and notification nudges, fanned out through Postgres `LISTEN`/`NOTIFY`; model output streams on the request that asked for it. See [ADR-0018](../../decisions/0018-realtime-one-push-channel-postgres-fan-out.md) |
| **API-Q02** | **How many MCP tools is the right number (API-024)?** Too few and an agent cannot do the job; too many and it does none of them well                                                                                                          | Evaluation against real tasks, which is the only way to find out                                                                                                                                                                                                                                              |
| **API-Q03** | **Where do extensions run?** In-process is fast and dangerous; out-of-process is safe and slow, and both are a support burden                                                                                                                 | The architecture, and how much a connector is expected to do                                                                                                                                                                                                                                                  |
| **API-Q04** | **Is the API public, or for integrators under contract?** It changes what deprecation costs and how much the specification must promise                                                                                                       | A commercial decision as much as a technical one                                                                                                                                                                                                                                                              |
| **API-Q05** | **Do batch create and update endpoints exist for native content?** API-N05 rules out unattended import of foreign documents; content this product already holds, moving between tenants or systems that speak its format, is a different case | The first integration that needs it. The risk of adding it early is that it becomes the bulk-import door API-N05 closed                                                                                                                                                                                       |
| **API-Q06** | **Are extensions versioned and pinned per tenant (API-048)?** An extension updated under a tenant that depended on its old behaviour is the same failure as an unversioned API, one layer out                                                 | The architecture decision in API-Q03. Where extensions run largely decides whether pinning is cheap                                                                                                                                                                                                           |
| **API-Q07** | **What are the synchronous surface's availability and latency numbers (API-050)?** Scope §11 budgets opening, publishing, keystrokes and search, and names an availability target, but no number covers an ordinary API request               | The first load testing against real content, and the commercial answer to API-Q04 - what is promised depends on who it is promised to                                                                                                                                                                         |

## 12. Traceability

| This document      | Rests on                                                                        |
| ------------------ | ------------------------------------------------------------------------------- |
| API-002, API-003   | Scope §9 decision 5, OpenAPI as the source of truth                             |
| API-018, API-024   | Scope §9 decision 6, a curated facade                                           |
| API-020, API-022   | IAM-036, GEN-017                                                                |
| API-014            | Scope §7.15, realtime specified separately                                      |
| Section 9          | Scope §7.15 extension points, in priority order                                 |
| API-037 to API-039 | COL-005, COL-007 - one editor at a time, and who holds it                       |
| API-040 to API-044 | IMP-018, IMP-020; REU section 9; PUB - the work that outlives a request         |
| API-049            | DAT - what a binding does when its source is gone                               |
| API-050            | ADM-016, ADM-020; scope §11                                                     |
| API-053            | IAM - the authentication and authorisation contract                             |
| API-037 to API-053 | [The v1 review](<../../reviews/API - api and mcp specification.md>); section 13 |

## 13. Change history

One row per change, against [the review](<../../reviews/API - api and mcp specification.md>) that
prompted it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### Substantive gaps

| Gap                                              | Change                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent mutation on the synchronous API       | **API-037** (a version precondition, refused with a machine-readable conflict naming the current version), **API-038** (no unconditional overwrite - a request without a precondition is refused, not treated as latest-wins) and **API-039** (the component lock holds at the API exactly as in the interface, because API-001 means the editor takes the same path) |
| Long-running operations                          | A new section 6: **API-040** (submitted as a job, identity returned immediately), **API-041** (pollable state and progress), **API-042** (cancellable, saying what was and was not done), **API-043** (failure in the same structured shape, inspectable afterwards)                                                                                                  |
| Bulk import and export                           | **API-044** (export at scale is a job over IMP-018, not a caller paging every resource) and **API-N05** (no unattended bulk import: IMP-003 says import never runs unattended, and an endpoint that skipped it would skip the person). **API-Q05** keeps the native-content case open rather than silent                                                              |
| Webhook ordering and identity across retries     | **API-045** (every delivery of one event carries the same identifier, so a receiver can discard a redelivery) and **API-046** (what ordering is guaranteed must be stated, and each event must carry enough to be ordered where none is)                                                                                                                              |
| Sync-API traceability                            | **API-047**: a request identifier on every response, echoing the caller's, appearing in the logs and in the error. The cheapest requirement here                                                                                                                                                                                                                      |
| Extension lifecycle                              | **API-048** (updatable and removable, saying what depends on it first) and **API-049** (removing a connector alters no content it produced, and bindings that depended on it fail visibly rather than going quietly stale). **API-Q06** asks whether extensions are versioned and pinned                                                                              |
| Where availability and latency targets are owned | **A real hole, and not this document's alone.** Scope §11 budgets opening, publishing, keystrokes and search, and names an availability target; no number covers an ordinary API request. **API-050** requires the surface to declare its own and be measured against them (ADM-016, ADM-020), and **API-Q07** is the number itself                                   |

### Smaller issues

| Issue                                          | Change                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-011 is truncated                           | **Confirmed and fixed.** It ended "must keep working until it"; it now names the removal date. Reworded, so it keeps its identifier                                                                                          |
| API-009 does not say where limits are declared | **Superseded by API-051**: declared in the API specification itself, so a contract test under API-003 can verify them. Where a thing is declared changes what must be built, so this is a new identifier rather than an edit |
| MCP against API versioning                     | **API-052**: a new major API version must state which tools move with it, which stay pinned, and when the old ones stop                                                                                                      |
| The 401/403 distinction                        | **API-053** takes the sentence of ownership the review asked for: authentication and authorisation failures follow IAM's contract rather than inventing a second vocabulary                                                  |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 36     | 53, of which 1 superseded |
| Non-requirements | 4      | 5                         |
| Open questions   | 4      | 7                         |
