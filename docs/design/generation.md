# Generation

A model as a governed contributor (Project Scope §7.6): endpoints a tenant configures, prompts
declared and reviewed, an assistant drafting against the open document, and everything it makes a
proposal a person accepts or discards, with the run behind it kept. T5's design, built a slice at a
time (below); embeddings for meaning are [search.md](search.md)'s and
[storage-and-versioning.md](storage-and-versioning.md)'s, and arrive in G7.

> Ken answered GN-A, GN-C, GN-D and GN-F on 2026-10-18, each as recommended. The rest, marked
> **(default)**, are recommendations each slice's plan may revisit.

## Requirements owned

| Requirement | How                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| **GEN-027** | `model_endpoint`, any number, each speaking one of two protocols (GN-B)                                                |
| **GEN-028** | `model_route`: each purpose names one endpoint (GN-B)                                                                  |
| **GEN-029** | The endpoint's key sealed and opened by the connector alone, write-only from the renderer, as a connection's is (GN-A) |
| **GEN-030** | Every endpoint is the tenant's own account; no platform key (GN-C)                                                     |
| **GEN-031** | `boundary` is required when an endpoint is made, and shown wherever the endpoint is named (GN-B)                       |
| **GEN-032** | `model_unavailable`, never another endpoint (Failures)                                                                 |
| **IAM-076** | Endpoints, routes and runs are tenant schema tables                                                                    |
| **GEN-006** | `generation_run` (The run)                                                                                             |
| **GEN-023** | A generated suggestion names its run, which holds the model, its version, the prompt version and the digest            |
| **GEN-039** | One digest, over the request as sent, canonical (The run)                                                              |
| **GEN-046** | A run is kept while anything it produced is, and never by a sweep (The run)                                            |
| **GEN-043** | `context_too_large` before the call, and the same code where the provider refuses for length (The context)             |
| **GEN-003** | The request is assembled from the resolved declaration alone; nothing is added after (The context)                     |
| **GEN-057** | The resolved set, by artifact, version and block, is recorded on the run and read back (The context)                   |
| **GEN-058** | Resolution reads as the requester (The context)                                                                        |
| **GEN-059** | Nothing resolved fails `context_empty`; too much, `context_too_large` (The context)                                    |
| **GEN-007** | The assistant's tools are four product reads and one proposal (The assistant)                                          |
| **GEN-008** | Each tool runs in the service as the requester, through the route's own authorisation                                  |
| **GEN-009** | A proposal changes nothing until the requester accepts or keeps it (Proposals)                                         |
| **GEN-010** | Every tool call, its arguments and its result are events of the run's stream, and kept on the run                      |
| **GEN-011** | Citations by component and block, checked against what the run retrieved (The assistant)                               |
| **GEN-012** | G2 is drafting against the open document, before prompts, chat or retrieval at large (The order)                       |
| **GEN-013** | Retrieval is the tenant's own search and reads, filtered by them                                                       |
| **GEN-014** | Every read a tool makes is the requester's read                                                                        |
| **GEN-015** | A run lives in one tenant's schema and reads through `withTenant`                                                      |
| **GEN-016** | The run's page lists what was retrieved, by version                                                                    |
| **GEN-017** | Content reaches the model only inside tool results and context blocks marked as data (Injection)                       |
| **GEN-018** | What content says changes no tool, permission or confirmation (Injection)                                              |
| **GEN-019** | Authority comes from the requester's session alone (Injection)                                                         |
| **GEN-020** | The compliant stand-in model, through each of the four paths (Injection)                                               |
| **GEN-022** | A generated suggestion is marked until accepted (Proposals)                                                            |
| **GEN-024** | A suggestion made from a run; acceptance is `suggestion.accepted`, naming the person (Proposals)                       |
| **GEN-040** | Discarding is a rejection, recorded with who and when                                                                  |
| **GEN-041** | Suggestions and runs are insert-only; a discard purges nothing                                                         |
| **GEN-042** | Only an open generated suggestion blocks a publish (Proposals)                                                         |
| **GEN-025** | `generated_unaccepted` at publish, and a gate condition requiring none (Proposals)                                     |
| **GEN-026** | `GET /v1/documents/{id}/generated`: each version a run produced and who accepted it (Proposals)                        |
| **GEN-060** | Acceptance is `acceptSuggestion`, which writes as any edit does, the lock first                                        |
| **PUB-082** | A publication's record lists the accepted runs its versions came from (Proposals)                                      |
| **API-064** | The run's stream is a message set of the AsyncAPI document, apart from OpenAPI (The assistant)                         |
| **GEN-033** | Each run records tokens with tenant, user, purpose and document (Cost)                                                 |
| **ADM-010** | The same record                                                                                                        |
| **GEN-035** | `model_rate_limited`, per user per hour (Cost)                                                                         |
| **GEN-037** | The run's cost shown to its requester as it ends, and their month on the assistant panel (Cost)                        |
| **GEN-001** | A prompt: an artifact kind in a space, versioned, listed by a library, the fourth workflow kind (Prompts)              |
| **GEN-005** | `models`: a purpose and the models accepted; another fails `model_mismatch` before any call (Prompts)                  |
| **GEN-045** | Approving a prompt version needs a finished trial run of it, which no tenant's workflow lifts (GN-F)                   |
| **GEN-056** | `context`: the part, its section or the document; related components; a field's value; parameters                      |
| **TPL-061** | A template names one library, `prompts`; a library is a versioned list of prompts by identity                          |
| **TPL-071** | `prompt_library_default`, seeded empty, is the library of a template naming none                                       |

## What this document does not own

| Left unclaimed                                                                     | Why                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GEN-002, GEN-004                                                                   | A prompt declares components, metadata and parameters, and writes a part's text: a query's results as context, and a field as output, are later slices' |
| GEN-047 to GEN-054, GEN-021, GEN-049, GEN-050, GEN-055                             | The conversation (G5), resting on what G2 teaches                                                                                                       |
| GEN-034, GEN-036, GEN-044, ADM-013, ADM-014, ADM-033, ADM-034                      | Budgets, alerts, caching and trends (G6)                                                                                                                |
| ADM-048                                                                            | Translation, scanning, email and webhooks cost nothing yet; it is claimed when the last of them exists                                                  |
| SCH-013, SCH-014, SCH-035, VER-039 (designed elsewhere), SCH-067, GEN-038, GEN-044 | Meaning (G7)                                                                                                                                            |
| API-019, API-021, API-023, API-052, REL-021, IAM-033, LIF-071                      | The MCP surface and service identities (G8), with the token design ([access.md](access.md))                                                             |
| API-028, API-029, API-046, API-055, API-060, COL-037                               | Webhooks: their own design (GN-D)                                                                                                                       |
| API-030, API-031, API-034, API-048, API-059, DAT-054, DAT-073, DAT-079             | Extensions: their own design (GN-D)                                                                                                                     |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GN-A | **Model calls leave through the connector** (Ken, 2026-10-18). A self-hosted endpoint is a host a tenant administrator chose, which is what the data spike's case 1 found the caller must never reach itself ([ADR-0034](../decisions/0034-data-connectors-run-apart-as-a-declared-identity.md)): its guard, its network and its sealing key already exist. The connector gains a model request and a streamed answer, the child writing each chunk as a line. [ADR-0064](../decisions/0064-model-calls-leave-through-the-connector.md) records it, and [system.md](system.md) follows. The cost: one more hop and a process per call (41 ms at the spike). |
| GN-B | **Two protocols, routes by purpose** (default). `anthropic` (the Messages API) and `openai` (chat completions, which vLLM, Ollama, LM Studio and most hosts speak). An endpoint is a name, a protocol, a base URL, a model id, a context window, prices per million tokens in and out, and `boundary`: `inside` or `outside` the tenant's data boundary, chosen by the administrator and never inferred. Purposes: `drafting`, `chat`, `summarising`, `embedding`; each routes to one endpoint, or to none, which turns that capability off.                                                                                                                |
| GN-C | **The tenant's own accounts only** (Ken, 2026-10-18). The platform holds no provider key and resells nothing, so cost is the tenant's provider bill, and Alloy Works counts it (Cost) rather than charging it. A hosted offering with a platform account is a later product decision.                                                                                                                                                                                                                                                                                                                                                                       |
| GN-D | **Webhooks and extensions get designs of their own, after G2** (Ken, 2026-10-18). They share the connector's egress with model calls, nothing else. An extension is a **protocol**, not code run inside the product: a tenant's own service that answers the connector's declared calls (a source's read and its capabilities, DAT-079; an output format), registered like a connection. Running third-party code in the product is a sandbox and a supply chain this tranche does not need.                                                                                                                                                                |
| GN-E | **A prompt is an artifact kind like a query definition** (default, designed in G4). In a space, on the version chain, the fourth workflow kind (`WORKFLOW_KINDS` gains `prompt`). A prompt library is a versioned list of prompts by identity, each following its latest approved version; a template names exactly one (`prompts`, beside `theme` and `layout`), and every tenant holds an empty default library a template names until it has its own (TPL-071).                                                                                                                                                                                          |
| GN-F | **What approval means** (GEN-Q03; Ken, 2026-10-18). The product does not judge a prompt's output; evaluation sits beside it. Approving a version attests that a person read its declarations (context, output, models) and at least one recorded **trial run** of that version, which the approval transition requires. Who may approve is the workflow's transition permission, as for any kind.                                                                                                                                                                                                                                                           |
| GN-G | **A proposal is a suggestion** (default). T3's suggestion is a whole-component draft against a version, accepted by a three-way merge and audited; a generated one is the same row with its run, `made_by` the requester. Nothing new decides acceptance, the lock or staleness.                                                                                                                                                                                                                                                                                                                                                                            |
| GN-H | **The mark ends at acceptance; the record never does** (GEN-Q01, default). An accepted version reads as authored; which versions came from a model, and who accepted them, is answered from runs and resolutions for as long as the version exists.                                                                                                                                                                                                                                                                                                                                                                                                         |
| GN-I | **No memory across runs** (GEN-Q04, default). A run starts from its declaration and the open document. **A transcript is kept with its run** (GEN-Q06, default): the requester's words and the model's, visible to the requester and in the tenant's audit export, kept as the run is; the content it read is kept by reference, not copied.                                                                                                                                                                                                                                                                                                                |
| GN-J | **Guardrails: a product floor a tenant adds to** (GEN-Q05, default, G5). The floor (content as data, tools by identity, writes as proposals) cannot be weakened; a tenant may forbid more, on what is sent and what returns, and a refusal says it refused and why.                                                                                                                                                                                                                                                                                                                                                                                         |
| GN-K | **Tested against a stand-in model** (default). `packages/stand-in-model`, as `stand-in-idp`: both protocols, streamed, each reply scripted by the test, tool calls included. No suite calls a real provider; a real model is Ken's local run, recorded as evidence.                                                                                                                                                                                                                                                                                                                                                                                         |

## Endpoints

`model_endpoint` (GN-B) is administered as connections are: made, changed and retired by a tenant
administrator, its key set by `PUT /v1/model-endpoints/{id}/credential`, sealed by the connector's
`/v1/seal` with purpose `model-credential`, held as `model_credential`, returned by no route; each
change audited. **Test** sends one short request and records the model the reply names. `model_route`
holds a purpose and an endpoint. An endpoint `outside` is labelled so in the endpoint list, the
route, the assistant panel and the run (GEN-031); a tenant that keeps content inside routes only
endpoints marked `inside`, or none.

## The run

Every model call belongs to a `generation_run`, insert-only but for its ending:

| Column                            | Holds                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `purpose`, `endpoint_id`          | What it was for and where it went, the endpoint's settings as they were (copied, not referenced)           |
| `prompt_version`                  | The prompt version run, or none for the assistant's own instructions, which are versioned with the product |
| `model`                           | The model the reply named, with its version where the provider gives one                                   |
| `parameters`                      | Temperature, the token limit and the rest, as sent                                                         |
| `context_digest`                  | SHA-256 over the request body as sent, canonical JSON (RFC 8785), key removed                              |
| `context`                         | What it resolved to: each artifact, version and block                                                      |
| `steps`                           | Each tool call, its arguments and its result; the transcript (GN-I)                                        |
| `tokens_in`, `tokens_out`, `cost` | As the provider reported them, priced by the endpoint                                                      |
| `requested_by`, `document_id`     | Who and on what                                                                                            |
| `outcome`                         | `finished`, `cancelled` or a failure code                                                                  |

**One digest** (GEN-039): computed once, over the bytes the model was given, and the value a
suggestion carries is read from the run, never recomputed. **Kept** (GEN-046): a run is outside every
sweep; erasing its requester (LIF) replaces the name, as the audit log does.

## The context

A context is declared, resolved, then sent, in that order. The assistant's declaration is fixed: the
open document's outline and the component the requester has chosen. Resolution reads as the
requester (GEN-058), so what they cannot read is absent, never flagged to the model. The resolved set
is recorded before the call (GEN-057). Nothing is added after resolution: tool results are the only
later content, and each is a recorded step.

Size: the request is measured against the endpoint's declared window at three bytes a token, which
overestimates for prose; above it the run fails `context_too_large`, naming both sizes, before any
call (GEN-043). A provider's own refusal for length is the same code.

## Prompts

Built in G4 ([the plan](../plans/2026-10-18-g4-prompts-and-libraries.md)). A prompt version holds a
title, a description, **instructions** placing the document's declared parameters as `{{name}}`,
its **context** (G4-C), its **output** (a part's text, of a component type or any) and its
**models** (a routed purpose and the model identifiers it accepts). Every write checks that each
place names a declared parameter and that what it names is the tenant's: nothing undeclared reaches a
model (GEN-003). A library lists prompts by identity, each at its latest approved version (G4-F).

A run of a prompt is on a part of a document, the prompt one its template's library lists at its
latest approved revision: the context resolved first, as the requester reads it, and recorded; the
endpoint its purpose routes to refused where its model is not one the prompt accepts; one call, no
tools; the reply the part's whole text, a proposal. A **trial** is the same run of any version,
recorded with purpose `trial`, its output kept on the run. **What approval means** (GEN-045): the
prompt workflow's approving transition requires a finished trial of the version approved, and a
prompt workflow saved without that requirement is refused (`trial_required`), so the statement holds
for every tenant; who approves is the transition's permission.

## The assistant

**Drafting against the open document** (GEN-012), on the document page's **Assistant** panel. The
requester asks; the service starts a run (`POST /v1/documents/{id}/assistant/runs`), whose response is
`text/event-stream` (realtime.md's model output): `text`, `tool_call`, `tool_result`, `proposal`,
`citation`, `ended` and `failed`, declared as AsyncAPI messages beside the stream's (API-064). Closing
the request cancels the run.

The loop runs in the service: each model turn goes through the connector (GN-A); each tool call runs
in the service as the requester, through the same functions its route uses (GEN-008). At most twelve
tool calls a run. The tools (GEN-007):

| Tool              | Does                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `read_outline`    | The document's outline, as the requester reads it                              |
| `read_component`  | One component's latest version, by id                                          |
| `search_document` | The words search, limited to this document's components                        |
| `read_values`     | The document's bound values, as the page shows them                            |
| `propose_edit`    | A whole-component draft against the version it read: a proposal, never a write |

**Citations** (GEN-011): the model is asked to cite as `[component#block]`; the service keeps a
citation only where that block was in what the run read, shows it as a link, and drops any other,
saying so.

## Proposals

A `propose_edit` appears in the panel as a redline against the version it read. The requester
**accepts** it, which makes and accepts a suggestion at once; **keeps** it, which makes a suggestion
for review; or **discards** it, which records the proposal discarded on the run (GEN-009, GEN-040).
A generated suggestion carries `run_id` and is marked **Generated** wherever suggestions show until it
is resolved (GEN-022). Acceptance is `acceptSuggestion`: the lock, the three-way merge, `suggestion.stale`
and `suggestion.accepted` naming the person, as for any suggestion (GEN-024, GEN-060).

Publishing fails `generated_unaccepted` while an open generated suggestion targets a component the
version places, and a workflow gate may require none; a rejected or withdrawn one blocks nothing
(GEN-025, GEN-042). `GET /v1/documents/{id}/generated` lists each component version a run produced
that the document places, the run, and who accepted it (GEN-026), and the publication record carries
the same list for what it published (PUB-082).

## Injection

Content is data by construction, not by a model's restraint: it reaches the model only in tool
results and context blocks, each wrapped and labelled with its artifact; the instructions are the
product's alone. What the defence rests on is that obeying injected text achieves nothing: every
read is the requester's (GEN-014), nothing leaves through a tool (none fetches, sends or writes
elsewhere), and every change waits on a person (GEN-009).

**The test** (GEN-020) is the stand-in model in **compliant** mode, obeying any instruction it finds,
fed one through each path: a component, a pasted import, a query result, a comment. Each must fail:
no write without acceptance, no read the requester could not make, nothing to any host but the
endpoint, no tool beyond the five.

## Cost

Each run records its tokens and their cost with tenant, user, purpose and document (GEN-033,
ADM-010). A per-user limit of runs an hour, set by the administrator, refuses with
`model_rate_limited` and when it resets (GEN-035). The requester sees a run's tokens and cost when it
ends, and their month's on the panel (GEN-037). Budgets, alerts before a limit, what stops when one is
spent, and twelve months of trend are G6's.

## Failures

| Code                   | When                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `model_unconfigured`   | No endpoint routes this purpose                                                             |
| `model_unavailable`    | The endpoint did not answer, refused the key, or failed; never retried on another (GEN-032) |
| `model_mismatch`       | The reply names a model the endpoint or the prompt does not declare (GEN-005)               |
| `context_empty`        | The declaration resolved to nothing (GEN-059)                                               |
| `context_too_large`    | Above the endpoint's window (GEN-043)                                                       |
| `model_rate_limited`   | The requester's hourly limit (GEN-035)                                                      |
| `generated_unaccepted` | At publish, an open generated suggestion remains (GEN-025)                                  |

## The order

Each slice is planned when the last is built.

| Slice | Holds                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| G1    | Endpoints and routes, their keys through the connector, the connector's model call, the stand-in model, the run, Test   |
| G2    | The assistant: the stream, the five tools, proposals as suggestions, citations, the injection suite, a run's cost shown |
| G3    | Generated content reaching publishing: the refusal and gate, the report, the publication record                         |
| G4    | Prompts and libraries: the kind, its review and trial runs, context by specification (GEN-056), templates' one library  |
| G5    | The conversation: open prompts, choosing an endpoint, personal prompts, retrieval a person edits, guardrails            |
| G6    | Budgets, alerts, what stops, rate limits, caching, the trend                                                            |
| G7    | Meaning: the embedding job, `search_passage`, semantic search and its budget, re-embedding costed first                 |
| G8    | The MCP surface and service identities                                                                                  |

Webhooks and extensions follow under their own designs (GN-D).

## Not decided here

| Kind | Question                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New  | Whether customers' proxies pass the run's stream promptly (realtime.md's question, now with a paying use)                                                     |
| New  | GEN-Q02: content a person may read but should not send outside the boundary. `boundary` names the question per endpoint; a per-space rule waits on a customer |
