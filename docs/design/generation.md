# Generation

A model as a governed contributor (Project Scope §7.6): endpoints a tenant configures, prompts
declared and reviewed, an assistant drafting against the open document, and everything it makes a
proposal a person accepts or discards, with the run behind it kept. T5's design, built a slice at a
time (below); embeddings for meaning are [search.md](search.md)'s and
[storage-and-versioning.md](storage-and-versioning.md)'s, and arrive in G7.

> Ken answered GN-A, GN-C, GN-D and GN-F on 2026-10-18, each as recommended. The rest, marked
> **(default)**, are recommendations each slice's plan may revisit.

## Requirements owned

| Requirement | How                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GEN-027** | `model_endpoint`, any number, each speaking one of two protocols (GN-B)                                                                                 |
| **GEN-028** | `model_route`: each purpose names one endpoint (GN-B)                                                                                                   |
| **GEN-029** | The endpoint's key sealed and opened by the connector alone, write-only from the renderer, as a connection's is (GN-A)                                  |
| **GEN-030** | Every endpoint is the tenant's own account; no platform key (GN-C)                                                                                      |
| **GEN-031** | `boundary` is required when an endpoint is made, and shown wherever the endpoint is named (GN-B)                                                        |
| **GEN-032** | `model_unavailable`, never another endpoint (Failures)                                                                                                  |
| **IAM-076** | Endpoints, routes and runs are tenant schema tables                                                                                                     |
| **GEN-006** | `generation_run` (The run)                                                                                                                              |
| **GEN-023** | A generated suggestion names its run, which holds the model, its version, the prompt version and the digest                                             |
| **GEN-039** | One digest, over the request as sent, canonical (The run)                                                                                               |
| **GEN-046** | A run is kept while anything it produced is, and never by a sweep (The run)                                                                             |
| **GEN-043** | `context_too_large` before the call, and the same code where the provider refuses for length (The context)                                              |
| **GEN-003** | The request is assembled from the resolved declaration alone; nothing is added after (The context)                                                      |
| **GEN-057** | The resolved set, by artifact, version and block, is recorded on the run and read back (The context)                                                    |
| **GEN-058** | Resolution reads as the requester (The context)                                                                                                         |
| **GEN-059** | Nothing resolved fails `context_empty`; too much, `context_too_large` (The context)                                                                     |
| **GEN-007** | The assistant's tools are four product reads and one proposal (The assistant)                                                                           |
| **GEN-008** | Each tool runs in the service as the requester, through the route's own authorisation                                                                   |
| **GEN-009** | A proposal changes nothing until the requester accepts or keeps it (Proposals)                                                                          |
| **GEN-010** | Every tool call, its arguments and its result are events of the run's stream, and kept on the run                                                       |
| **GEN-011** | Citations by component and block, checked against what the run retrieved (The assistant)                                                                |
| **GEN-012** | G2 is drafting against the open document, before prompts, chat or retrieval at large (The order)                                                        |
| **GEN-013** | Retrieval is the tenant's own search and reads, filtered by them                                                                                        |
| **GEN-014** | Every read a tool makes is the requester's read                                                                                                         |
| **GEN-015** | A run lives in one tenant's schema and reads through `withTenant`                                                                                       |
| **GEN-016** | The run's page lists what was retrieved, by version                                                                                                     |
| **GEN-017** | Content reaches the model only inside tool results and context blocks marked as data (Injection)                                                        |
| **GEN-018** | What content says changes no tool, permission or confirmation (Injection)                                                                               |
| **GEN-019** | Authority comes from the requester's session alone (Injection)                                                                                          |
| **GEN-020** | The compliant stand-in model, through each of the four paths (Injection)                                                                                |
| **GEN-021** | A declined instruction said aloud: a conversation's `declined` tool, its step kept and a `notice` streamed (Injection)                                  |
| **GEN-022** | A generated suggestion is marked until accepted (Proposals)                                                                                             |
| **GEN-024** | A suggestion made from a run; acceptance is `suggestion.accepted`, naming the person (Proposals)                                                        |
| **GEN-040** | Discarding is a rejection, recorded with who and when                                                                                                   |
| **GEN-041** | Suggestions and runs are insert-only; a discard purges nothing                                                                                          |
| **GEN-042** | Only an open generated suggestion blocks a publish (Proposals)                                                                                          |
| **GEN-025** | `generated_unaccepted` at publish, and a gate condition requiring none (Proposals)                                                                      |
| **GEN-026** | `GET /v1/documents/{id}/generated`: each version a run produced and who accepted it (Proposals)                                                         |
| **GEN-060** | Acceptance is `acceptSuggestion`, which writes as any edit does, the lock first                                                                         |
| **PUB-082** | `publication_generated`: each accepted suggestion and creation it printed, with its run, written as it is recorded (Proposals)                          |
| **API-064** | The run's stream is a message set of the AsyncAPI document, apart from OpenAPI (The assistant)                                                          |
| **GEN-033** | Each run records tokens with tenant, user, purpose and document (Cost)                                                                                  |
| **ADM-010** | The same record                                                                                                                                         |
| **GEN-035** | `model_rate_limited`, per user per hour (Cost)                                                                                                          |
| **GEN-034** | `generation_budget`: a monthly limit, its rising thresholds, alerts as each run ends (Cost)                                                             |
| **ADM-013** | The same; an alert before the limit, at a threshold below 100 (Cost; its gap beside the table)                                                          |
| **ADM-014** | Declared in advance on the budget's view and page: nothing stops, every capability continues (Cost)                                                     |
| **GEN-036** | The Anthropic adapter's cache breakpoints, cached tokens priced; a prompt run reuses its requester's own identical run (Cost; its gap beside the table) |
| **ADM-034** | A `budget` notification in the inbox, COL-063's channel, to recipients an administrator names (Cost)                                                    |
| **GEN-038** | Embedding routed to an OpenAI-protocol endpoint alone, which a self-hosted model inside the boundary speaks; none routed, no meaning search (Meaning)   |
| **GEN-044** | Embedding runs attributed and budgeted as generation's; a model not serving waits, its estimate shown, until an administrator confirms it (Meaning)     |
| **GEN-037** | The run's cost shown to its requester as it ends, and their month on the assistant panel (Cost)                                                         |
| **GEN-001** | A prompt: an artifact kind in a space, versioned, listed by a library, the fourth workflow kind (Prompts)                                               |
| **GEN-005** | `models`: a purpose and the models accepted; another fails `model_mismatch` before any call (Prompts)                                                   |
| **GEN-004** | `output.componentType`: a part of another type fails `prompt_output_mismatch` before any call; listed only where it fits (Prompts)                      |
| **GEN-045** | Approving a prompt version needs a finished trial run of it, which no tenant's workflow lifts (GN-F)                                                    |
| **GEN-056** | `context`: the part, its section or the document; related components; a field's value; parameters                                                       |
| **TPL-061** | A template names one library, `prompts`; a library is a versioned list of prompts by identity                                                           |
| **TPL-071** | `prompt_library_default`, seeded empty, is the library of a template naming none                                                                        |
| **GEN-047** | A conversation: a person's turns, each a run, the earlier turns' words sent with the next (G5-A)                                                        |
| **GEN-048** | A turn runs the assistant's loop: its instructions, tools as the requester, proposals, a run (G5-B)                                                     |
| **GEN-050** | Nothing filters a turn on its subject; only a guardrail refuses (G5-B, G5-F)                                                                            |
| **GEN-051** | A turn names an endpoint in use, the chat route's by default, its name and boundary shown (G5-C)                                                        |
| **GEN-049** | `guardrail`: phrases forbidden in what is sent and what returns, a reply held where one watches it, a refusal naming the rule and reason (G5-F)         |
| **GEN-053** | `conversation_context`: a tray each turn re-reads as the person, a part they no longer read left out and named; added and removed by them (G5-D)        |
| **GEN-052** | `propose_component` in a conversation: made at 0.1 as the person only once accepted, never kept, reported as generated (G5-E)                           |
| **GEN-054** | `personal_prompt`: its owner's alone, never an artifact, so no template binds one and nobody else reads or runs it (G5-G)                               |
| **GEN-055** | Promotion, the one path: a new prompt at draft in a space its owner may edit, reviewed and tried like any other (G5-G)                                  |
| **API-018** | Seven tools over the API, each the `/v1` route it wraps, never a mirror of it (MCP)                                                                     |
| **API-019** | Each tool's description: what it is for, when to use it, what it returns (MCP)                                                                          |
| **API-020** | A tool is its route, called in process with the caller's token: no other path (MCP)                                                                     |
| **API-021** | A changing tool's annotations say it is not read-only and its title starts `Changes:`; the route refuses what the token may not (MCP)                   |
| **API-022** | A result is the route's JSON, never prose made from content, every description saying so (MCP)                                                          |
| **API-023** | `tool.used`: the identity, the tool, its arguments as identifiers and digests, the outcome (MCP)                                                        |
| **API-024** | The tools are rows in the G8 plan; adding one is a row there first (MCP)                                                                                |
| **API-052** | Every tool wraps a `/v1` route; a `/v2` names in its ADR what moves (ADR-0065)                                                                          |
| **REL-021** | `related` is `/v1/artifacts/{id}/relationships` and `/path`, as the caller (MCP)                                                                        |

GEN-004 is claimed for a part's text of a declared component type (the GC plan, GC-C); a field as a
prompt's output is not built, and is the gap.

## What this document does not own

| Left unclaimed                                                            | Why                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GEN-002                                                                   | A prompt declares components, metadata and parameters: a query's results as context are a later slice's |
| ADM-033                                                                   | T7: the trend lacks ADM-011's storage, publication and asset measures                                   |
| ADM-048                                                                   | T7: translation, scanning, email and webhooks cost nothing yet                                          |
| SCH-013, SCH-014, SCH-035, VER-039 (designed elsewhere), SCH-067, GEN-044 | Meaning (G7's later PRs)                                                                                |
| LIF-071                                                                   | Tool use is `tool.used`; webhook subscription changes wait for webhooks (GN-D)                          |
| API-028, API-029, API-046, API-055, API-060, COL-037                      | Webhooks: their own design (GN-D)                                                                       |
| API-030, API-031, API-034, API-048, API-059, DAT-054, DAT-079             | Extensions: their own design (GN-D)                                                                     |

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

An endpoint also holds (0182) its `kind`, `llm` or `embedding`: `embedding` is routed to an embedding
model alone, every other purpose and every conversation to an LLM (`endpoint_kind_mismatch`); its
`timeout_seconds`, every call's deadline (`modelDeadlineMs`), 120 s where null, at most the connector's
240 s, a run's own time left still bounding each turn; and `supports_tools` and `supports_images`. A
model that calls no tools is sent none and answers from what its turn was given; nothing sends images
yet, so `supports_images` gates nothing until something does.

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

A conversation's turn may also declare `context`: `component`, the component open, or `document`,
every component of the document the requester may read, each at the version placed there and sent
as data before the ask with the tray's parts, the whole kept to about half the endpoint's window at
four characters a token, the parts past it counted and named as left out.

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
endpoint its purpose routes to refused where its model is not one the prompt accepts; a part of
another component type than the prompt's output refused `prompt_output_mismatch`, and a document's
prompts listed for a part only where they fit it (GEN-004); one call, no
tools; the reply the part's whole text, a proposal. A **trial** is the same run of any version,
recorded with purpose `trial`, its output kept on the run. **What approval means** (GEN-045): the
prompt workflow's approving transition requires a finished trial of the version approved, and a
prompt workflow saved without that requirement is refused (`trial_required`), so the statement holds
for every tenant; who approves is the transition's permission.

What a run reads (G4-H): an outline source always holds the part written, so `context_empty`
(GEN-059) fires only where every source a prompt declares is a related, field or parameter source
and each found nothing. A related component is read at the version its relationship pins, else at
its latest, as a floating relationship reads (REL-043), not at its approved revision. A parameter's
value is placed in the instructions wrapped as data: whoever sets a document's parameters is not the
prompt's approver. A blank reply proposes nothing.

What a conversation sends (G5): each turn the earlier finished turns' asks and replies, and the tray,
re-read part by part as the person. A reply is the person's own record, replayed as written: one that
quoted a part they may no longer read is not re-filtered, as the tray is; where it was on a document
they may no longer read, the whole conversation is closed to them. Erasing a person deletes their
personal prompts and leaves their conversations and runs, which only they could read, with them.
Two turns sent at once can both start: one turn at a time is checked, not locked.

A conversation is kept by choice (the DQ plan): `kept`, false when one starts, true once its owner
keeps or names it (`PATCH /v1/conversations/{id}`), and only those kept are listed. One not kept is
held with its runs, never deleted (0127), and the panel holds it for as long as it is open; those
made before 0183 are kept. Its title and `kept` are all of it that changes.

## The assistant

**Drafting against the open document** (GEN-012), on the document page's **Assistant** panel. The
requester asks; the service starts a run (`POST /v1/documents/{id}/assistant/runs`), whose response is
`text/event-stream` (realtime.md's model output): `text`, `tool_call`, `tool_result`, `proposal`,
`citation`, `ended` and `failed`, declared as AsyncAPI messages beside the stream's (API-064). Closing
the request cancels the run.

The loop runs in the service: each model turn goes through the connector (GN-A); each tool call runs
in the service as the requester, through the same functions its route uses (GEN-008). At most a hundred
tool calls over forty model turns a run, within its four minutes. The tools (GEN-007):

| Tool                | Does                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `read_outline`      | The document's outline, as the requester reads it                                                                                        |
| `read_component`    | One component's latest version, by id                                                                                                    |
| `search_document`   | The words search, limited to this document's components                                                                                  |
| `read_values`       | The document's bound values, as the page shows them                                                                                      |
| `propose_edit`      | A whole-component draft against the version it read: a proposal, never a write; a table's cell, or its rows, too (never a bound table's) |
| `search_references` | A reference source searched with the person's terms (reference-sources.md, XRc)                                                          |
| `cite_reference`    | A citation of a source's work proposed; its entry matched or made on acceptance                                                          |

**Citations** (GEN-011): the model is asked to cite as `[component#block]`; the service keeps a
citation only where that block was in what the run read, shows it as a link, and drops any other,
saying so.

**The panel** (the DP and DQ plans, issue #864): three rows. One line on top names the panel and holds
its toolbar: the model, a menu that says
whether each endpoint sits outside the boundary (GEN-051); a gauge of the last turn's tokens in over
the endpoint's `contextWindow` (`/v1/conversation-endpoints`), in three bands at 50% and 75%; and the
conversation's tools: **Prompts**, a popup of the personal and library prompts; earlier
conversations, a menu nearly the panel's width; name, keep, new. The middle scrolls: a turn is a ledger
line, what was asked over its answer, each kept citation a numbered button and the answer's cited
parts stepped through in a bar above the text. The composer is fixed at the bottom edge: **Document** or
**Component** as chips, the parts it reads, **Add a part** opening a finder over the conversation
(parts added before the first ask are given to the conversation it begins), and the box, which grows
upward with its lines. While it runs, one line names the last step and **Stop** stands where **Ask**
was. The part asked about is held from when the box is entered until the ask is sent.

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
that the document places, the run, and who accepted it (GEN-026). A publication records its own list
as it is made, `publication_generated` (0143; the GC plan, GC-B): each accepted suggestion and
creation in a version it printed, by the report's history rule, with its run; its report reads
whether an acceptance is in it from that list, so one accepted afterwards never is (PUB-082).

## Injection

Content is data by construction, not by a model's restraint: it reaches the model only in tool
results and context blocks, each wrapped and labelled with its artifact; the instructions are the
product's alone. What the defence rests on is that obeying injected text achieves nothing: every
read is the requester's (GEN-014), nothing leaves through a tool but `search_references`' terms to a
source the tenant has left on (XRc), and every change waits on a person (GEN-009).

**The test** (GEN-020) is the stand-in model in **compliant** mode, obeying any instruction it finds,
fed one through each path: a component, a pasted import, a query result, a comment. Each must fail:
no write without acceptance, no read the requester could not make, nothing to any host but the
endpoint, no tool beyond the five. Through a component, a pasted import, a query result and a prompt
run's context, each fails; a comment reaches no model at all, so its path is shown empty: a comment
on the very part read is in no request sent.

**Declining aloud** (the GC plan, GC-E; GEN-021): a conversation's model is given `declined`
`{ where, instruction }` and asked to call it when content asks something of it (a prompt run has no
tools, GEN-003). The loop records it as a step, answers the model `noted`, and streams `notice`, which
the panel shows beside the turn as text. It does nothing else; a model that never calls it is
refused nothing.

## Cost

Each run records its tokens and their cost with tenant, user, purpose and document (GEN-033,
ADM-010). **Rate limits** (G6-A): runs an hour per person, the environment's and one person's own in
place of it, set by `administer` (`/v1/model-limits`). Counted over the requester's runs of the last
hour, the endpoint test's excluded; checked in the route's transaction, refusing 429
`model_rate_limited` with `resetsAt`, and again as the run starts under the person's advisory lock,
so runs started at once cannot all pass (GEN-035).

**The budget** (G6-B to G6-D; GEN-034, ADM-013, ADM-014, ADM-034): one a month for the environment
(`/v1/model-budget`), in one currency, with up to five rising thresholds, at least one below 100. It
sums every ended run's cost in that currency this UTC month, whatever its purpose or outcome, the
endpoint test's among them. `endRun` checks it in its own transaction, under the budget's advisory
lock, in a savepoint: each threshold crossed and not yet alerted at that limit is told once, a
`budget` notification in the inbox of each recipient an administrator names, decided again when told
(from inside, administering the environment). A failed alert never un-ends a run. It is never digested
or muted by a cadence, a departure from COL-034, since spend is not a person's own to opt out of.
**Nothing stops** when it is spent: the view's `whenSpent` and the page declare it (ADM-014). ADM-013's
gap: one costly run can cross a threshold below 100 and the limit together, so the alert leads the
limit only where runs are smaller than a threshold's step.

**Caching** (G6-E; GEN-036). The provider's: the Anthropic adapter marks the instructions (the tools
before them) and the first message, which carries the context, as cache breakpoints; OpenAI caches
unasked. Each reports the tokens it read from its cache, `usage.cached`, a part of those in, kept as
`tokens_cached` and priced at an endpoint's `priceCached`, else at its input price; a cache write is
priced as any input, an approximation. The result's: a prompt run, once its context is resolved and
authorised and the sent guardrails pass, reuses the requester's own finished run of the last 24 hours
with the same prompt version, call digest, parameters and endpoint, pointing where it did with the
same boundary. The new run names it (`cached_from`), calls nothing, costs nothing, is counted in no
rate limit, has its reply checked again by the returned guardrails and its proposal made anew.
Keyed by requester: no other person's result is reachable, and an erased requester's runs match
nobody. `fresh` calls regardless. GEN-036's gap: trials, which are run to be seen again, and
conversations, whose turns are never repeated, are never result-cached. DAT-026 is not claimed here:
it is the query cache's (DAT-052, T7).

**The trend** (G6-F; towards ADM-033): `/v1/model-usage`, at most 13 months, by UTC month and purpose:
runs ended, tokens in, out and from the cache, and cost by currency; and query runs by month with
their rows and bytes. Runs are never deleted, so every month a tenant has run is there; query runs are
kept 13 months. ADM-033 is left unclaimed: storage, publication and asset volume are ADM-011's (T7). The requester sees a run's tokens and cost when it
ends, and their month's on the panel (GEN-037). Budgets, alerts before a limit, what stops when one is
spent, and twelve months of trend are G6's.

## Meaning

G7 ([plan](../plans/2026-10-19-g7-meaning.md)). Embedding is a model call on the OpenAI protocol's
`/embeddings` alone, which Azure OpenAI and self-hosted servers speak too, so a tenant embeds inside
its boundary or has no meaning search (GEN-038); routing embedding to another endpoint is refused
`embedding_unsupported`. The connector's `/v1/embed` takes the endpoint's sealed key as `/v1/model`
does, and a second key, `CONNECTOR_EMBED_KEY`, opens that route alone, for the worker. Vectors are
kept in `embedding` by the hash of a block's words, the model and the model version the reply named,
written once (VER-039); [search.md](search.md) finds by them. Indexing a latest version copies a
passage for each block whose words' vector the serving (or a confirmed pending) model holds, and
queues the artifact (`embedding_queued`, once however often it is saved) for the rest; the worker's
`embed` job embeds them in batches of at most 96, each batch a run of the version's author on its
document, in the budget and in no rate limit, and writes the passages. A block's text past 8,000
characters is embedded from its first 8,000.

Routing embedding to a model the store does not serve makes it pending: nothing is embedded for it,
and `/v1/embedding` shows what embedding the latest texts it lacks would cost, about four characters a
token at its endpoint's input price (GEN-044). An administrator's confirmation embeds one sample, a
run of theirs, to learn its dimensions (`embedding_dimensions_unsupported` past the five), and queues
every artifact; the serving model answers searches meanwhile, and the worker switches the moment the
new one holds every latest text, deleting the old model's passages and never its vectors (VER-040).
Routed to the model that serves, it goes on serving through the new endpoint; routed to none, nothing
serves. SCH-067's interval is measured and claimed in [search.md](search.md) (the FR plan, FR-E).

## MCP

Built by [G8](../plans/2026-10-21-g8-mcp-and-service-identities.md) ([ADR-0065](../decisions/0065-mcp-is-a-few-tools-over-the-api.md)).
`POST /mcp` on the service speaks MCP's stateless Streamable HTTP, protocol versions `2025-11-25` and
`2025-06-18`, every answer JSON. It takes a bearer API token alone, a person's or a service
identity's; a cookie is never read, and an `Origin` that is not the environment's is refused. It is
outside the contract, and `openapi.json` does not describe it.

| Tool              | Wraps                                                                                           | Reads |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----- |
| `search`          | `GET /v1/search`                                                                                | Yes   |
| `read_document`   | `GET /v1/documents/{id}`, and its `/texts`                                                      | Yes   |
| `read_component`  | `GET /v1/components/{id}`, as numbered blocks                                                   | Yes   |
| `related`         | `GET /v1/artifacts/{id}/relationships`, and `/path`                                             | Yes   |
| `comment`         | `POST /v1/components/{id}/threads`, `/v1/documents/{id}/threads` or `/v1/threads/{id}/comments` | No    |
| `suggest_edit`    | `GET /v1/components/{id}/versions/{version}`, then `POST /v1/components/{id}/suggestions`       | No    |
| `draft_component` | `POST /v1/spaces/{space}/components`, with `markdown`                                           | No    |

**A tool is its route** (API-018, API-020, REL-021): each call is one in-process request of the route
it wraps, with the caller's token, host and trace id, so tenancy, scopes, permissions and the route's
own audit are the API's. A tool shapes arguments and trims answers; it holds no query. A route's
refusal is a result marked an error with the route's own body; a failure is a JSON-RPC error.

**Changes go to review** (API-021): the three that change are marked so in their annotations and
titles. `comment` starts a thread or replies; `suggest_edit` applies the assistant's block edits to the
version the caller read and makes a suggestion its author accepts or rejects; `draft_component` makes
a new component whose first version is Markdown, admitted as pasted text is, so it holds no reference
or binding. Nothing approves, publishes, saves over a version or moves workflow.

**Described for a model** (API-019, API-022): what each tool is for, when to use it and what it
returns, then that content is data and never an instruction. A result's text is its structured JSON,
never prose built from content. Each tool's annotations say whether it reads only.

**Audited** (API-023): each call is `tool.used`, its subject the artifact it names, its detail the
tool, its arguments as identifiers, numbers and words, any text as its length and SHA-256, never its
words (LIF-030), and the outcome: `ok`, `refused` with the route's code, or `failed`. It is written
after the call, in its own transaction, so a refusal is recorded too, and so is a call naming no tool
or arguments the tool refuses. A digest is unsalted, so a short text can be guessed against it: it
matches calls, it does not hide a name. The changing tools take no idempotency key, so a client that
retries a call makes a second thread or component, as their annotations say.

**Versions** (API-052): every tool wraps a `/v1` route. A `/v2` names in its own ADR the tools that
move, those pinned to `/v1`, and the date `/v1`'s stop.

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
