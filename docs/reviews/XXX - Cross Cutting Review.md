# Cross Cutting Review of Requirements Specifications

This review seeks to answer three questions:

1. Are the 21 areas the right boundary and is the set complete
2. Are there gaps and seams between the documents including any missing or incomplete requirements
3. Are there any inconsistencies between the documents

# 1. Are the 21 areas complete? Are there other full areas that should be separately specified?

## Short answer

The 21 areas are **complete as the core capability decomposition** of this product. I would not split the content domain further: CNT, STR, REU, DAT, TAB, VER, LIF, PUB, STY, TPL, AST, LIB, LOC, SCH, REL, COL, IAM, API, IMP, ADM and GEN are the right top-level areas for what this product is.

However, the requirement set is **not fully closed at the operational/platform layer**. There are three concerns that are currently distributed across several documents but do not have a single clear owner. If the product commitments in those areas remain as written, they should either become separate areas or be promoted into explicit cross-cutting requirements with named owners.

The strongest candidates for separate specification are:

| Candidate area                                            | Why it is a candidate                                                                                                                                                                                                                                                                                                                                                                                                                                 | Current partial ownership                                                                                                                                                                                                                | Recommendation                                                                                                                                                                                                                                                                                         |
| :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notifications and messaging**                           | The product promises in-app inbox, email, digests, budget alerts, review notifications and webhook delivery. But no document fully owns channel configuration, delivery reliability, inbox retention, failure diagnostics, external recipients or tenant-level notification settings.                                                                                                                                                                 | COL owns what is worth notifying; API owns webhooks; ADM owns budget alert policy and observability; PUB/LIF/COL generate events.                                                                                                        | Either create a **NOT** area, or add a substantial cross-cutting section to COL/API/ADM with explicit ownership of delivery mechanics. If email/inbox is a first-class product surface, I would make it a separate area.                                                                               |
| **Security, privacy and data protection / residency**     | The set has strong tenant isolation, secret handling, audit, legal hold and external-boundary statements, but no single owner for encryption/key management, backup/DR, data residency, PII erasure design, vulnerability posture, or a central inventory of outbound data flows. Regulated customers will ask these as one question.                                                                                                                 | IAM owns tenancy/federation; DAT owns connection secrets; AST owns malware scanning; GEN/LIB/LOC own external model/reference/translation boundaries; LIF owns retention/legal hold; ADM owns observability and open residency question. | Create a **SEC/DPA** area, or at least add a cross-cutting “security and data protection” requirement set with named owners in IAM/ADM/LIF. Given the regulated market, I would lean toward a separate area if data residency, backup/DR and erasure are product commitments rather than design notes. |
| **Background / scheduled work and operational jobs**      | Many requirements imply long-running or scheduled system work: review prompts, budget alerts, source re-checks, translation jobs, indexing, derivative rebuilds, scan timeouts, bulk generation, future effective dates, publication reproduction checks. API defines a job contract for user-initiated long-running work, but nothing owns the scheduler/system-task layer.                                                                          | API-040 to API-044 define user-submitted jobs; ADM observes scheduled work; LIF/LOC/LIB/SCH/AST/REU/TPL each imply background tasks.                                                                                                     | Create a **JOB** area, or add explicit cross-cutting requirements that all scheduled/background work follows the API job contract and appears in ADM diagnostics. This is one of the largest operational seams.                                                                                        |
| **Organization administration / commercial entitlements** | IAM-052 introduces an organization grouping several tenants with shared billing, administration and identity-provider configuration. But there are no requirements for organization administrators, cross-tenant administrative actions, organization-level audit, or how this interacts with ADM-N02’s no-cross-tenant-reporting rule. Billing is explicitly out of scope in ADM-N03, but administration of the organization is not fully specified. | IAM owns tenancy and identity; ADM owns tenant administration and cost visibility; README says Organization is owned by IAM and ADM.                                                                                                     | If multi-tenant organizations are a real customer need, add requirements to IAM/ADM or create an **ORG** area. If billing/entitlements become in scope, that would likely need its own area or explicit external boundary.                                                                             |

## Watch items that may become areas later

These do not yet look like full separate areas, but they are worth watching:

1. **Desktop / client runtime**
   The documents mention browser and desktop deliveries in a few places, for example CNT-101 on spelling and STY-039 on typefaces being available in browser, desktop shell and publishing pipeline. But there is no area owning offline behaviour, local storage, auto-update, crash reports, file-system integration or client-side security. If the desktop shell is a first-class delivery rather than a thin wrapper, this may need its own specification.
1. **HTML reading experience / online publication viewer**
   PUB-056 says HTML should be producible as a reading format and subject to accessibility requirements. AST-Q02 and TAB-Q02 also depend on whether HTML becomes a real reading format. If the product will offer an online reader for publications, that is more than a PUB output format: it involves permissions, pagination or non-pagination, supersession notices, external recipients, accessibility and possibly interactive tables. That could become a “distribution” or “reader experience” area.
1. **Billing / entitlements**
   ADM-N03 says this product is not a billing system. But if usage metering becomes pricing (ADM-Q02), then plan limits, trial restrictions, entitlement checks and commercial state may need explicit requirements or a clear external boundary.

---

# 2. Gaps and seams between the documents: missing or incomplete requirements

I have grouped these by priority.

- **P0**: likely to cause two implementers to build different things, or to create an audit/security/reproducibility hole.
- **P1**: should be closed before the affected tranches are planned or built.
- **P2**: watch items / lower-priority seams.

---

## P0 gaps and seams

### 2.1 The “latest approved” reference mode exists in LIF but not in the core reference model

**Affected requirements:**

- LIF-038: a document may reference a component at its **latest approved revision**.
- LIF-041: documents referencing latest approved must see that the reference has moved.
- CNT-108, CNT-110: choosing and displaying referenced version/revision; currently only “pinned or floating at latest.”
- STR-009: component reference records pinned or floating at latest.
- REU-002: each reference independently pins a version/revision or floats at latest.
- REU-041: cohort run resolves floating references once at start.

**Problem:**
LIF introduces a third reference mode, “latest approved,” but the core reference model in CNT/STR/REU only has two modes: pinned and floating at latest. This is not just wording. It changes:

- what an author can choose,
- what the document view must display,
- what a baseline/publication must record,
- what where-used/impact analysis must show,
- how cohort generation pins references,
- what a lifecycle gate may require.

**Missing requirement:**
The reference model should explicitly include “latest approved” as a first-class mode wherever pinned/floating is defined.

**Suggested fix:**

Add or amend requirements in:

- REU-002: each reference may pin a version/revision, float at latest, or track the latest approved revision.
- STR-009: outline component references record which of those modes they use.
- CNT-108/CNT-110: author can choose and view “latest approved” as distinct from pinned/floating.
- REU-041: a cohort run must resolve all movable reference modes once at start, including floating and latest-approved references.
- LIF-039/LIF-041: gates and movement notices should cite the updated reference-mode requirements.

This is one of the most important cross-document fixes because it touches reuse, structure, versioning, lifecycle and bulk generation.

---

### 2.2 Baseline/publication reproducibility does not pin all referenced artifacts

**Affected requirements:**

- VER-018: baseline pins component versions, assets, query definitions, themes, typefaces, layouts, citation styles and outline.
- PUB-045: publication records versions of baseline, layout, theme, citation style and pipeline.
- PUB-063: publication records engine/engine version and template version.
- REU-040: publication records resolution inputs: component versions, profile, parameters, overrides.
- LIB-004: library records are versioned and a baseline must pin the versions it used.
- TPL-025: document records producing template/version.
- GEN-023/GEN-046: generated content records model/prompt/context digest and those records must be retained.

**Problem:**
VER-018 is the load-bearing reproducibility requirement, but it does not explicitly include:

- bibliography entries,
- terms,
- vocabulary values,
- template version or at least the versions of the template-owned definitions,
- prompt/model provenance for accepted generated content in a form that makes publication reproducible/auditable.

A document can cite bibliography entries and use terms/vocabularies. LIB-047 says changes reach unpinned references at next publish and never baselines. But if VER-018 does not pin library records, the baseline’s promise is incomplete.

Similarly, a document created from a template may depend on metadata schema and structure outline definitions. TPL-025 records the template version on the document, but VER-018 does not explicitly say the baseline pins that template version or the owned definition versions.

**Missing requirement:**
A baseline must pin every referenced artifact that can affect resolved output, including library records and template-owned definitions. A publication must record enough provenance to answer “what exactly produced this?” for generated content as well as data-bound content.

**Suggested fix:**

Amend VER-018 to say, in effect:

> A baseline must pin the exact version of every artifact that affects resolved output, including components, assets, query definitions, themes, typefaces, layouts, citation styles, outline, bibliography entries, terms and vocabulary values referenced by the document, and the template version recorded on the document.

Also align PUB-045/PUB-063/REU-040 so that publication records are not weaker than baseline pins.

For generated content, add a requirement that a publication report can identify which accepted generated content it contains, with prompt/model/context provenance retained per GEN-023/GEN-046.

---

### 2.3 The audit event taxonomy is incomplete relative to other documents’ “audited” requirements

**Affected requirements:**

- LIF-026: minimum audit events include authentication, refused authorisation, content change, workflow transition, approval/signature, binding resolution/refresh, publication, export, permission change and administrative action.
- LIF-057: adds legal hold, archival, deletion and gate rejection.
- API-023: MCP tool use must be audited with identity, tool, arguments and outcome.
- GEN-024/GEN-040/GEN-041: generated proposal acceptance/discarding must be recorded/reportable.
- DAT-058: data value revision must be audited with what it was and became.
- REL-011/REL-033: relationship creation/removal/change must be audited.
- AST-031/AST-032: asset binary, alt text, source, licence and permitted uses carry history; licence changes surfaced.
- PUB-060: access to shared publication must be recorded/reportable to tenant.
- ADM-024: support access must be audited into the tenant’s own log.

**Problem:**
Many documents say an action is “audited,” but LIF’s minimum event list does not explicitly name all of those event types. That creates a seam where one team implements audit as “content change” or “administrative action” and another expects a distinct queryable event type.

Examples:

- Is MCP tool use a content change, administrative action, or its own event?
- Is accepting/discarding generated content a workflow transition, content change, or AI-specific event?
- Is revising a bound value a binding refresh, content change, or data-revision event?
- Is relationship creation/change/removal a content change or its own event?
- Is shared publication access a publication event or an access event?

**Missing requirement:**
Either LIF’s minimum event list must be expanded, or there must be a cross-cutting rule that every requirement using the word “audited” names the LIF event type and has a test asserting that the event appears in the tenant log.

**Suggested fix:**

Add to LIF-026/LIF-057, at minimum:

- MCP/API tool use where it changes or inspects governed artifacts;
- AI generation run, acceptance and discard;
- data value revision;
- relationship create/change/remove;
- asset ingest/replacement/rights change;
- shared publication access;
- support access grant/use/revoke;
- webhook subscription creation/change/removal, if webhooks are tenant configuration.

Alternatively, add a cross-cutting requirement:

> Every requirement that states an action is audited must identify the audit event type in LIF and be covered by a test asserting that the event is present in the tenant’s own log with who/what/when/version where applicable.

This would prevent “audited” from becoming an untestable adjective.

---

### 2.4 Document profile initialization and validation are not fully specified between TPL and REU

**Affected requirements:**

- REU-022: a document must declare its profile: the value it takes on each axis.
- REU-024: an axis the profile says nothing about must exclude, not include.
- TPL-022: creating a document materialises outline, seeds metadata, resolves variables and establishes bindings.
- LIF-004: transitions may require conditions such as no missing required sections.

**Problem:**
TPL-022 does not say what happens to the document’s profile at instantiation. REU requires a document to declare its profile, but nothing says:

- whether a template declares default profile values,
- whether an author must set the profile before publishing,
- whether a document with conditional content can be published while an axis is unset,
- what “unset” means in the UI,
- whether a lifecycle gate may require a complete profile.

REU-024 gives a safe default: unset excludes. But that can produce a silently incomplete publication if an author forgets to set an axis. In a regulated product, “this section was excluded because nobody set the audience” is a bad failure mode.

**Missing requirement:**
Template instantiation must establish the document’s profile or leave it in a declared incomplete state. Publishing should be able to fail where conditional content would be excluded due to an unset axis unless that outcome is explicitly declared acceptable.

**Suggested fix:**

Add requirements in TPL and REU/LIF:

- A template may declare default profile values or required axes.
- Instantiation must set the document’s profile from those defaults, parameters, metadata or a declared initial state.
- If a document contains conditional content, publishing must either require all relevant axes to be explicitly set or record that exclusion-by-unset was accepted.
- A lifecycle gate may require a complete profile before issue.

This closes a real seam between templates, conditions and publication validation.

---

### 2.5 Notifications, webhooks and scheduled work are under-specified as an operational system

**Affected requirements:**

- COL-033: notifications deliverable in-app inbox and email.
- COL-034: user chooses what/how often.
- COL-035: digestible into single message.
- COL-036/COL-053: no content recipient may not read.
- COL-037: notification events available as webhooks.
- API-025 to API-029: webhook delivery, signing, retries, inspection.
- API-045/API-046: event identity and ordering guarantees.
- ADM-013/ADM-034: budgets/alerts delivered before limit through COL channels.
- ADM-036/ADM-037: diagnostics include webhook delivery state and surfaced failures.
- LIF-017/LIF-059/LIF-060: review prompts, missed-review consequences, future effective dates.
- LIB-035: external source re-checkable.
- LOC-022/LOC-033: translation job trackable.
- SCH-050: indexing interval budget.
- AST-036: scan timeout fails upload.
- REU-049/TPL bulk generation: long-running cohort work.

**Problem:**
The documents specify many events that should notify, webhook or run in the background, but they do not fully specify the operational layer that makes those things happen.

Missing or incomplete areas include:

1. **Notification channel configuration**
   - Who configures email/inbox channels?
   - Can a tenant configure its own email domain/provider?
   - Are notification settings part of ADM-005 configuration export/import?
   - What are the permissions for changing notification policy?
1. **Delivery reliability**
   - Is inbox delivery at-least-once, exactly-once, or best-effort?
   - How are redeliveries deduplicated?
   - What is the retry/backoff behaviour for email?
   - What happens when a channel fails?
   - Are failures visible in ADM-036 diagnostics?
1. **Inbox lifecycle**
   - Retention of notifications.
   - Deletion by user/admin.
   - Behaviour when a user is deprovisioned.
   - Whether notifications are tenant-scoped second copies under IAM-005.
1. **Webhook subscription management**
   - API specifies webhook delivery but not clearly how administrators create/update/delete webhook subscriptions.
   - Missing: endpoint URL, signing key distribution/rotation, event type selection, permissioning, audit, rate limits, cost attribution, suspension behaviour.
1. **Scheduled/background work**
   - There is no owner for system tasks such as:
     - making a future effective date become effective (LIF-060),
     - periodic review prompts (LIF-017),
     - budget alert evaluation (ADM-013/ADM-034),
     - external source re-checks (LIB-035),
     - translation job tracking (LOC),
     - indexing (SCH),
     - derivative rebuilds or scan timeouts (AST),
     - bulk generation cohorts (REU/TPL).

API-040 to API-044 define a good contract for user-submitted long-running jobs, but scheduled/system work is not fully covered.

**Missing requirement:**
There should be a cross-cutting operational job/notification model: what can run in the background, how it is initiated, how its state is visible, how failures are surfaced, how it is audited, how it costs, and what happens during suspension/closure.

**Suggested fix:**

Either create a **JOB/NOT** area or add explicit cross-cutting requirements:

- All user-initiated long-running work follows API-040 to API-043.
- Scheduled/system tasks are tenant-visible where they affect the tenant, with state, last run, next due time and failure reason.
- Failures that a user would experience as “nothing happened” are surfaced per ADM-037.
- Notification/webhook delivery uses stable event identifiers and stated retry/deduplication semantics.
- Webhook subscriptions and notification channel settings are administrative configuration, permissioned, audited and exportable/importable under ADM-005/ADM-027 where applicable.
- Suspension/closure declares which scheduled jobs, webhooks and notifications stop or continue per ADM-031.

---

### 2.6 IAM-005’s tenant-scoped list is incomplete for derived copies of content

**Affected requirements:**

- IAM-005: search indexes, caches, secrets, model endpoints, publications and audit log must be tenant-scoped.
- IMP-044: export artifact itself must be tenant-scoped and permissioned.
- SCH-Q04/SCH-013/GEN-038: semantic search vectors/embeddings sit in tenant schema and are model-derived.
- COL notifications/webhooks: notification messages/digests/webhook payloads carry review/content metadata.
- VER derived data: embeddings and other derived data keyed by content.
- AST derivatives: thumbnails/previews are derived copies.

**Problem:**
IAM-005 names several tenant-scoped stores, but the product creates many second copies or derived representations of tenant content:

- search indexes,
- semantic vectors/embeddings,
- caches,
- export artifacts,
- notification inbox messages and email digests,
- webhook payloads,
- asset derivatives,
- backups,
- publication artifacts,
- audit log exports.

The principle is clear from the documents: no second copy may leak across tenants or bypass permissions. But IAM-005 is not generalized enough to cover all of them.

**Missing requirement:**
A cross-cutting tenant-isolation rule should say that every cache, index, derived representation, export artifact, notification message, webhook payload, backup and audit export is tenant-scoped and permissioned like the content it derives from.

**Suggested fix:**

Amend IAM-005 or add a new constraint:

> Every second copy, derived representation or outbound payload of tenant content — including search indexes, caches, embeddings, asset derivatives, export artifacts, notification messages, webhook payloads, audit exports and backups — must be tenant-scoped and permissioned so that it cannot reveal content the recipient may not read.

Then require tests analogous to IAM-004/SCH-010 for each path.

---

### 2.7 AI-proposed edits are not explicitly bound to the same concurrency rules as human edits

**Affected requirements:**

- GEN-052: tool use in conversation may create/update components, with confirmation, proposal and generated marking.
- LIB-040: assistant tools can search external sources and insert citations as proposals.
- COL-041/COL-043: accepting/rejecting a suggestion is an edit requiring the lock; nothing applies suggestions automatically.
- API-037/API-038: version precondition and no unconditional overwrite.
- DAT-072: refreshing/pinning/revising bindings governed by component lock and API version precondition.

**Problem:**
GEN says AI output is a proposal until accepted, and tool calls are authorized as the calling user. But it does not explicitly say that accepting/applying an AI-proposed change to a component is subject to the same concurrency rules as any other edit.

If another user holds the lock, what happens when a user accepts an AI-generated suggestion? The answer should be the same as COL-042: refused, naming holder and expected release; or otherwise governed by API-037 if through the API.

**Missing requirement:**
Any AI-assisted change that writes to a component must be treated as an edit for concurrency purposes.

**Suggested fix:**

Add to GEN or COL:

> Accepting or applying generated content, including assistant-proposed edits and citation insertions, is a write to the target artifact and must obey the same lock and version-precondition rules as any other edit (COL-041, API-037). It must never be applied automatically while another identity holds the relevant lock.

This prevents AI from becoming an accidental bypass of the collaboration model.

---

### 2.8 Outline/document-level concurrency is delegated but not fully specified

**Affected requirements:**

- STR section 2 boundary: “Two editors moving the same node at once — COL, API.”
- COL-005/COL-011: locks are per component, never per document.
- COL-N02: no document-level locking.
- API-037/API-038: version precondition and no unconditional overwrite at the API.
- LIF-058: workflow transitions must be atomic against concurrent transitions/edits, citing COL-005 and API-037.

**Problem:**
Component locks solve concurrent editing of component content. But a document outline is not a component. Two users can move different components in the same outline, reorder sections, or change structure at the same time. COL explicitly does not own document-level locking. API-037 prevents lost updates at the API level, but the interface behaviour for conflicting outline edits is not specified.

This matters because:

- moving an outline node moves its subtree (STR-008),
- numbering depends on outline order,
- cross-references depend on outline identity/order,
- workflow gates may act on documents,
- baselines pin the outline.

**Missing requirement:**
There should be an explicit concurrency model for outline/structure edits and document-level lifecycle actions.

**Suggested fix:**

Add a STR/COL/API requirement such as:

> Concurrent outline edits are governed by optimistic version preconditions at the API (API-037) and by conflict detection in the interface. A conflicting reorder, insert or remove must be refused or surfaced with the current state; it must not silently overwrite another user’s structural change. Where a component lock is relevant to the content being moved, COL-005 still applies to that component.

This does not require document-level soft locks, but it does require a stated answer for structure concurrency.

---

### 2.9 Realtime connections and shared publications are not fully covered by sign-out/revocation requirements

**Affected requirements:**

- IAM-039: signing out invalidates the session everywhere it is active.
- IAM-055: session/token must be checkable against current state on every request; long-lived bearer token cannot be only credential.
- API-016: realtime connection authenticates/authorises exactly as a request and re-checks on reconnect.
- COL-055: presence claims bounded by heartbeat, then stale, then absent.
- PUB-058: shared publication share must expire and be revocable with immediate effect.

**Problem:**
The requirements are strong for requests, but less explicit for long-lived connections and active viewing sessions.

Examples:

- If a user signs out, is their SSE/realtime connection terminated immediately?
- If a token is revoked, does an already-open realtime connection stop receiving events?
- If a shared publication link is revoked while a recipient has it open, what happens to subsequent page loads, asset fetches or API calls?
- How often are permissions re-checked on a live connection that does not reconnect?

**Missing requirement:**
Revocation and sign-out should have stated behaviour for realtime connections and active publication sessions.

**Suggested fix:**

Add requirements in IAM/API/PUB:

> Sign-out, token revocation or share revocation must stop further authorised data flow on active realtime connections and shared-publication sessions within a stated bound. Reconnection must re-authenticate and re-authorise per API-016. Where immediate termination is not possible, the connection must stop delivering new events/data and surface an authenticated-state failure rather than continuing silently.

This closes a security seam that is easy to miss until production.

---

### 2.10 Where-used / impact analysis scope is incomplete across artifact types and baselines/publications

**Affected requirements:**

- REU-006: “Where is this used” first-class query over components, assets, query definitions, styles, terms and templates.
- LIB-005: every library record’s where-used must be listable.
- AST-018: asset use listable across components, documents and baselines.
- STY-031/STY-034: style uses listable; changing a style shows what it affects.
- TPL-032: list documents created from template version.
- REL-022 to REL-024: impact combines declared relationships with REU references.
- VER-018/VER-023: baselines pin artifacts and prevent deletion.
- PUB publications depend on baselines.

**Problem:**
REU-006 is the central where-used requirement, but its list does not explicitly include all artifact types that other documents say must have where-used visibility:

- bibliography entries,
- vocabulary values,
- citation styles maybe,
- baselines/publications as dependents or immutable records.

Also, “where used” has two different meanings:

1. live references in editable documents/components;
1. immutable pins in baselines/publications.

A user asking “what would changing this affect?” needs both, but they have different consequences. Changing a component may break live documents, while old baselines remain valid because they pinned the earlier version.

**Missing requirement:**
Where-used and impact analysis should cover all reference-bearing artifacts and distinguish live dependents from baseline/publication pins.

**Suggested fix:**

Amend REU-006 or add a cross-cutting requirement:

> Where-used must be answerable for components, documents, assets, query definitions, styles, citation styles, terms, bibliography entries, vocabulary values, templates and publications/baselines where applicable. It must distinguish live references from immutable baseline/publication pins, and impact analysis must state which dependents would break versus which historical records remain valid.

Then align REL-022/REL-023 so hard dependencies include both live references and baseline pins where relevant.

---

## P1 gaps and seams

### 2.11 Organization-level administration is introduced but not specified

**Affected requirements:**

- IAM-052: customer can hold several tenants grouped by an organization sharing billing, administration and identity-provider configuration, never content.
- IAM-053: each tenant reachable at own hostname; customer domain addable without code change.
- ADM-N02: no cross-tenant reporting except aggregates that identify nobody.
- ADM-N04: no configuration only reachable by vendor.

**Problem:**
The README ownership table says Organization is owned by IAM and ADM, but the requirements mostly stop at tenant level. There is no specification for:

- organization administrator roles,
- creating/suspending tenants under an organization,
- shared IdP configuration across tenants,
- shared billing/admin metadata,
- organization-level audit,
- API surface for organization administration,
- how this interacts with ADM-N02’s no-cross-tenant-reporting rule.

**Missing requirement:**
If organizations are a real product concept, they need administrative requirements and permissions.

**Suggested fix:**

Add to IAM/ADM:

- An organization may group tenants without sharing content.
- Organization-level actions (create tenant, change shared IdP config, suspend tenant under org) are permissioned and audited.
- Organization administrators see only the metadata they are entitled to see; content remains tenant-isolated.
- ADM-N02 should explicitly permit organization-level administrative/billing aggregates for tenants in the same customer organization, while still forbidding cross-tenant product analytics that identify individuals or unrelated tenants.

---

### 2.12 Data residency and external data flows need a central declaration

**Affected requirements:**

- ADM-Q01: data residency commitments open.
- GEN-031/GEN-038: model endpoints outside tenant boundary must be stated; embedding is a model call.
- LIB-037: searching external reference sources sends author terms outside boundary; configured and stated.
- LOC-026: sending content to external translation service is tenant policy.
- AST-Q03: malware scanning may leave tenant boundary.
- DAT connections: source systems obviously external.
- API webhooks: outbound payloads leave tenant.

**Problem:**
The documents handle many individual external boundaries well, but there is no single requirement that gives a tenant administrator a complete picture of what leaves the tenant and where.

A regulated customer will ask: “What data can leave this tenant, to which vendors, for which purposes, under which settings?” Currently the answer is scattered across GEN, LIB, LOC, AST, DAT, API and ADM.

**Missing requirement:**
There should be a tenant-visible inventory of external data flows and boundary declarations.

**Suggested fix:**

Add cross-cutting requirements in IAM/ADM or a security area:

> The product must provide a tenant-visible declaration of all configured outbound data paths, including model endpoints, translation services, reference-source searches, malware scanning, webhooks and notification delivery where applicable. For each path it must state what categories of data may leave the tenant boundary, whether that is enabled by default, who can change it, and any residency or vendor constraints.

If ADM-Q01 is settled with actual residency commitments, add requirements for:

- storage region for tenant schema/backups/indexes/embeddings/derived data,
- region pinning or refusal where commitment cannot be met,
- audit of cross-region access if applicable.

---

### 2.13 Support access is required but not administratively specified

**Affected requirements:**

- ADM-022: support diagnoses without reading content by default.
- ADM-023: where content access needed, granted by tenant, time-bounded, scoped, revocable.
- ADM-024: every support access audited into tenant’s own log.
- ADM-025: tenant can see whether support access is active and what it covers.
- ADM-026: support tooling makes metadata/content difference obvious.
- IAM-061: no standing vendor access after bootstrap; later vendor action through support-access path.

**Problem:**
The principles are excellent, but the administrative mechanics are missing:

- Who in the tenant grants support access?
- What scopes can be selected?
- How is expiry set?
- How is revocation performed?
- Is there a request/approval flow?
- Can support access be limited to metadata/diagnostics only?
- Does granting support access create an external principal, service identity, or temporary role?
- How does this appear in IAM effective-permissions views (IAM-029/IAM-030)?

**Missing requirement:**
ADM should specify the administrative surface for support access grants.

**Suggested fix:**

Add ADM requirements:

> A tenant administrator must be able to grant, review and revoke time-bounded support access. Each grant must declare scope (metadata only, diagnostics, content read, etc.), expiry, purpose and recipient identity or service identity. Grants and revocations are audited into the tenant’s own log and visible in ADM-025. Support access must appear in IAM effective-permission explanations where it affects what support can see.

This turns a strong principle into an operable control.

---

### 2.14 High-risk administrative permissions are too coarse under “administer”

**Affected requirements:**

- IAM-019: permission set includes read, create, edit, comment, suggest, approve, publish and administer.
- IAM-062: every permission held through a role.
- ADM-001: tenant administrator can manage users, roles, spaces, connections, model endpoints, workflow definitions, style catalogues, vocabularies and retention policies.
- IMP-022/IMP-023: whole-tenant export requestable by tenant admin and permissioned as whole tenant content.
- ADM-038/ADM-039: tenant audit log read/search/export.
- LIF-021/LIF-022: legal hold apply/remove.
- ADM-028/ADM-030: suspension/closure.
- AST/DAT/GEN secret rotation and external service configuration.

**Problem:**
“Administer” is too broad for a regulated multi-tenant product. A tenant may want separate roles for:

- content administrator,
- security/compliance officer,
- finance/cost viewer,
- export requester,
- legal hold officer,
- support access approver,
- secret rotator,
- external service configurator.

Currently the permission set does not name these high-risk actions.

**Missing requirement:**
High-risk administrative acts should be separately grantable and explainable in IAM-029/IAM-030/IAM-031.

**Suggested fix:**

Either extend IAM-019 or add a cross-cutting requirement:

> The permission model must distinguish high-risk administrative actions, including whole-tenant export, audit-log export, legal hold apply/release, tenant suspension/closure initiation, support-access grant/revoke, secret rotation, external-service configuration and webhook/notification channel configuration. Each such action must be grantable through roles and explainable in the effective-permission view.

This does not require a fixed product role list, but it prevents “admin” from becoming an unexamined superpower.

---

### 2.15 Whole-tenant export/import completeness needs to cover administrative configuration and identity remapping

**Affected requirements:**

- IMP-018: whole tenant exportable: content, metadata, definitions, assets, relationships, versions, baselines, publications and audit.
- ADM-005/ADM-027: configuration exportable/importable; secrets as references; import rebinds or refuses unbound references.
- IMP-039: product’s own export format importable into a tenant.
- IAM users/provisioning: users come from identity provider, not local credentials.
- AST-030/LIB-028/STY-043/REL-007: individual artifact interchange.

**Problem:**
“Definitions” is doing a lot of work in IMP-018. A whole-tenant export that can reproduce the tenant should also include, or explicitly reference:

- data connections with secret references,
- model endpoint configurations with secret references,
- external reference source configurations,
- translation service policies,
- workflow definitions,
- retention policies,
- notification settings,
- webhook subscriptions,
- organization/tenant grouping metadata where applicable.

Also, importing a whole tenant into another tenant or new environment raises identity questions:

- How are user identities mapped?
- What happens to audit log actor names if the receiving tenant has different users?
- Are external principals re-created, refused, or remapped?
- Are service identities re-bound?
- Are hostnames/domains reconfigured?

**Missing requirement:**
Export/import should explicitly cover administrative configuration and state what identity remapping is required.

**Suggested fix:**

Add requirements:

> A whole-tenant export must include all configuration necessary to reproduce the tenant’s governed behaviour, with secrets carried as references per ADM-027. This includes connections, model endpoints, external service configurations, workflow definitions, retention policies, notification/webhook settings and other administrative configuration owned by ADM/IAM/DAT/GEN/LIB/LOC/API.

And:

> Importing a whole-tenant export into another tenant must either require an explicit identity mapping for users, groups, external principals and service identities, or refuse where required identities cannot be resolved. It must never silently reassign actor identities in audit records.

This makes the anti-lock-in guarantee realistic rather than merely file-level.

---

### 2.16 Backup, disaster recovery and integrity verification are implied but not fully specified

**Affected requirements:**

- ADM-020: availability, RPO and RTO objectives stated and measured.
- AST-042: stored original verifiable against hash on read; re-verification on schedule is storage layer’s responsibility.
- VER-042/VER-043: content digests for versions/baselines.
- LIF-055: audit export carries hash chain/signature.
- IAM-058: deletion timetable stated and proven by test.

**Problem:**
The documents require objectives to be stated and measured, but they do not fully specify the operational controls behind them:

- backup frequency,
- point-in-time recovery,
- restore testing cadence,
- corruption detection schedule for stored bytes,
- DR failover behaviour,
- tenant-specific restore versus whole-system restore,
- how legal hold interacts with backups,
- how deletion timetable is proven in practice.

**Missing requirement:**
ADM should own a minimum set of backup/DR/integrity requirements, or defer them to a platform/security area with explicit boundary.

**Suggested fix:**

Add ADM/platform requirements:

> The product must declare and test backup frequency, RPO and RTO per artifact class where applicable. Restore capability must be exercised on a stated schedule. Stored artifacts must have declared integrity re-verification schedules, including assets (AST-042), version digests (VER-042) and audit exports (LIF-055). Failure of integrity verification must be surfaced in ADM diagnostics and audited.

If this becomes large, it is another argument for a security/platform area.

---

### 2.17 Publication sharing needs an explicit external-recipient lifecycle

**Affected requirements:**

- PUB-047: publication retained, addressable by URL, permissioned.
- PUB-057: share outside tenant only to named recipient who proved identity, never anonymously.
- PUB-058: share expires and revocable immediately.
- PUB-059: superseded publication tells recipient.
- PUB-060: every access recorded/reportable to tenant.
- IAM section 11: external principals can read/comment/suggest, with caps/expiry/listing.
- IAM-Q03 settled: link-based, never anonymous; named recipient proves identity once.

**Problem:**
The publication sharing model is strong, but the lifecycle of the recipient is not fully specified:

- How does a tenant share a publication?
- Is the recipient created as an external principal in the host tenant, or as a separate identified-link identity?
- What exact permission do they receive: read one publication only?
- Can they see related publications or documents?
- How is identity proof performed?
- What happens on expiry/revocation for active sessions?
- How does this appear in IAM external-principal listings (IAM-051)?

**Missing requirement:**
Publication sharing should have an explicit grant model tied to IAM.

**Suggested fix:**

Add PUB/IAM requirements:

> Sharing a publication outside the tenant creates a named, time-bounded grant scoped to that publication artifact only, unless the tenant explicitly grants broader access through the normal permission model. The recipient must prove identity before first access. Expiry or revocation stops further access within a stated bound. Publication shares appear in IAM external-access listings where they create an external principal, and all access is recorded per PUB-060.

Also amend IAM-048 to cover publications/artifacts explicitly, not only spaces/documents.

---

### 2.18 Suspension/closure/legal hold interaction needs explicit rules

**Affected requirements:**

- ADM-028: tenant suspendable; sign-in/API stop; content/config retained; reversible without loss.
- ADM-030: closure deliberate, audited, grace period before deletion, reversible throughout.
- ADM-031: suspension/closure declare which capabilities stop/continue.
- IAM-058: deletion timetable same clock as ADM-030.
- LIF-021: legal hold prevents deletion regardless of retention policy.
- PUB-081: retained publications follow tenant closure; external shares stop resolving when tenant does.

**Problem:**
The lifecycle rules are mostly clear, but the interaction between normal deletion refusal and tenant termination is not explicit.

Examples:

- LIF-023/VER-023 say deletion is refused while a baseline/publication depends on an artifact.
- VER-049 says baselines accumulate by design and nothing deletes one.
- But ADM-030/IAM-058/PUB-081 imply that tenant closure eventually deletes or makes unreadable everything, including publications and baselines.

Also:

- What happens to shared publication links during suspension?
- What happens if a legal hold exists when a tenant is closed?
- Does closure pause the deletion timetable for held items?
- Who can access held data after tenant sign-in stops?
- Is held data retained in a special post-closure state?

**Missing requirement:**
There should be explicit rules for suspension, closure and legal hold interacting.

**Suggested fix:**

Add LIF/ADM/IAM requirements:

> Normal deletion refusal applies to live tenant operations. Tenant closure under ADM-030 may delete or render unreadable baselines, publications and pinned artifacts only after the declared grace period and export offer, except items subject to legal hold (LIF-021). Held items remain retained and accessible only through a declared post-closure access path, with all access audited.

Also require ADM-031 to explicitly cover:

- shared publication links,
- webhooks,
- scheduled jobs,
- realtime connections,
- model endpoints,
- search indexes,
- notification delivery.

---

### 2.19 Performance budgets need a central governance mechanism

**Affected requirements:**

- ADM-016: performance budgets in scope §11 measured in production and reported against budgets.
- ADM-020: availability/RPO/RTO stated and measured.
- API-Q07: synchronous surface availability/latency numbers open.
- CNT-136/CNT-Q13: preview budget with declared reference configuration.
- PUB-064: 300-page publish under thirty seconds, provisional.
- REL-031: traversal budgets for million-component tenant.
- SCH-033/SCH-036: search and embedding budgets.
- REU-049: bulk generation budget.
- VER-051: comparison budget.

**Problem:**
The documents do a good job of attaching budgets to specific capabilities, but there is no central owner for the set of budgets as a whole. Several are provisional and “to be confirmed against real content,” but nothing says:

- who confirms them,
- when they must be confirmed,
- what reference configuration is used,
- how production measurement reports are presented to tenants/administrators,
- what happens when a budget is missed in production.

**Missing requirement:**
A cross-cutting non-functional requirements governance mechanism.

**Suggested fix:**

Add an ADM or README-level requirement:

> All performance budgets must be registered with their owner, reference configuration, provisional status, confirmation date and production measurement method. ADM-016/ADM-020 reporting must include whether each budget is met in production. Provisional budgets must have a stated tranche by which they are confirmed or replaced.

This would also force API-Q07 to be settled before the synchronous API surface is considered complete.

---

### 2.20 A global error and correlation-ID contract should apply across all surfaces

**Affected requirements:**

- API-005: structured errors with stable machine-readable code plus human message.
- API-006: error names what failed and which requirement/rule refused it.
- API-047: every response carries request identifier, echoed if given, appears in logs/errors.
- STY-061: named errors in STY carry stable machine-readable identifiers per API-005.
- ADM-036/ADM-037: tenant diagnostics and surfaced failures.

**Problem:**
API has a good error contract, but many other documents use the phrase “named error” without explicitly binding to API-005/API-006/API-047. Since API-001 says the product’s own clients use the same API, the intent is probably that this applies everywhere. But it should be stated corpus-wide.

Also, correlation identifiers are specified for synchronous API responses, but not explicitly for:

- jobs,
- webhooks,
- realtime events,
- notification messages,
- publishing pipeline stages,
- background/scheduled tasks.

**Missing requirement:**
A global diagnostic contract for all user/admin-facing failures and asynchronous work.

**Suggested fix:**

Add cross-cutting requirements:

> Every failure surfaced to a user, administrator or integrator must use the structured error contract in API-005/API-006, including a stable machine-readable identifier where applicable. Every request, job, event, webhook delivery and realtime message that can be diagnosed must carry a correlation identifier that appears in logs, diagnostics and any related error.

This would make ADM-036/ADM-037 much more testable.

---

### 2.21 Idempotency and pagination need to cover jobs, bulk operations and large lists

**Affected requirements:**

- API-008: mutating requests idempotent with idempotency key.
- API-040 to API-043: job contract.
- REL-048: bulk create/delete atomic or reported per member.
- TPL bulk generation/REU cohort work.
- AST-050, LIB-048, STY-034, TPL-032, REU where-used: various “listable” requirements.

**Problem:**
API-008 covers mutating requests, but not explicitly job submission or bulk operations. A retried job submission should not create a second export, publication, bulk generation run or impact report.

Also, many requirements say something is “listable,” but do not state paging/caps/stable order. For large tenants, where-used, orphan assets, changed library records, style impact and template-derived documents can be huge.

**Missing requirement:**
Idempotency for asynchronous/bulk work and a list contract for all potentially large listings.

**Suggested fix:**

Add requirements:

> Job submission and bulk operations must support idempotency keys or equivalent safe-retry semantics so that a retry cannot create duplicate work. Where an operation is inherently non-idempotent, the API must say what happens on retry.

And:

> Any requirement stating that something is listable must be paged, capped or budgeted where size can grow with tenant scale, using stable ordering consistent with API-007/SCH/REL requirements.

---

### 2.22 Secret dependency visibility should cover all outbound service credentials

**Affected requirements:**

- ADM-032: administrator can see what consumes a secret — connections, model endpoints and scheduled work — before rotating it.
- DAT-066: rotating connection credentials must not silently break dependent queries; report once naming dependents.
- GEN-029/GEN-030: model endpoint credentials are secrets/BYO account.
- LIB-038: external source credentials in secret store.
- LOC translation service likely needs credentials/policy.
- API webhook signing keys likely need rotation.

**Problem:**
ADM-032 names connections, model endpoints and scheduled work, but not all possible consumers of secrets:

- external reference sources,
- translation vendors,
- malware scanning services,
- notification/email providers,
- webhook signing keys,
- search/semantic embedding providers if external.

**Missing requirement:**
Secret dependency visibility should be generalized to all tenant secrets and outbound service credentials.

**Suggested fix:**

Amend ADM-032 or add a cross-cutting requirement:

> Before rotating any tenant secret, an administrator must be able to see what consumes it, including connections, model endpoints, external reference sources, translation services, scanning services, notification channels, webhook signing keys and scheduled work. Rotation failures must be reported once against the secret/service, naming dependent capabilities rather than surfacing one broken document at a time.

---

## P2 watch items / lower-priority seams

### 2.23 Inbound document import sanitization is not as explicit as paste sanitization

**Affected requirements:**

- CNT-130: pasted HTML sanitized; scripts, event handlers, embedded objects and non-allowlisted link schemes never stored.
- IMP-013/IMP-016: Markdown/HTML/XML importable with reporting/mapping.
- AST-Q01: SVG may carry script; decision needed.

**Problem:**
Paste sanitization is explicit for HTML, but bulk import of Word/HTML/Markdown could also bring hostile or executable content. The documents require validation and drop reports, but not an explicit security-sanitization rule for imported document formats.

**Suggested fix:**

Add IMP requirement:

> All inbound untrusted document imports must be sanitized before entering the model. Scripts, macros, event handlers, embedded objects and non-allowlisted link targets must never be stored unless explicitly permitted by a declared policy, and anything removed must appear in the import report.

Also settle AST-Q01 before SVG is enabled: refuse, sanitize or rasterise.

---

### 2.24 Extension governance needs more administrative detail

**Affected requirements:**

- API-030 to API-034: connectors/formats/styles addable; extensions declare needs and run with least authority; failures attributable.
- API-048/API-049: updatable/removable; removing connector does not alter produced content; bindings fail visibly.
- DAT-054/DAT-055/DAT-073: data connectors addable, capabilities declared.
- LIB-032: external reference sources declared/versioned list following API extension rules.

**Problem:**
The extension model is sound, but the administrative lifecycle is thin:

- Who can install/update/remove an extension?
- Does a tenant administrator approve it?
- Is there a sandboxing requirement beyond “declared and sandboxed or not extensions”?
- How are extension data-boundary declarations shown to tenants?
- Are extension updates version-pinned per tenant (API-Q06)?

**Suggested fix:**

Add API/ADM requirements for extension installation/update/removal permissions, audit, data-boundary declaration and tenant-visible status. If third-party extensions become real, this may need more detail.

---

### 2.25 Several `should` requirements need explicit decision records if not implemented

The README says `must` is binding and `should` is a strong default that an implementer may argue against in a decision record. That is the right rule, but cross-cutting review should track the `should` items so they are not silently dropped.

Examples:

- API-031: output formats should be addable as extensions.
- IMP-016: structured XML vocabulary import should be possible.
- PUB-041: index should be generatable where layout declares one.
- STR-043: index should be generatable from marked entries.

**Suggested fix:**

For each `should` that is not implemented in a tranche, require an ADR citing the requirement and explaining the deferral or refusal.

---

### 2.26 Cost attribution is strong for AI/data but incomplete for other external operations

**Affected requirements:**

- ADM-010/ADM-011: AI token use and query/storage/publication/asset storage attributable.
- GEN-033/GEN-044: generation/embedding cost attributable/budgeted.
- DAT-053: query execution volume/cost attributable.

**Missing or incomplete:**

Cost attribution is less explicit for:

- external reference source searches,
- translation vendor jobs,
- malware scanning,
- notification/email delivery,
- webhook delivery,
- bulk generation,
- indexing/embedding operations not directly model calls.

If ADM-Q02 settles that usage is metered for pricing, this becomes much more important. Even if only for visibility, the product should attribute these operations to tenant/user/document/capability where feasible.

---

# 3. Inconsistencies between the documents

I split these into two kinds:

1. **Direct citation/status inconsistencies** — stale references, typos, status mismatches.
1. **Semantic tensions** — places where two documents can be read as giving different answers or leaving a seam unresolved.

---

## 3.1 Direct citation and status inconsistencies

### 3.1.1 README says reviewed; area headers still say “for review”

**README:**
“Status: v1, reviewed.” It also says all twenty-one documents are carrying change history against their first review.

**Area documents:**
Most headers still say:

> Status: v1, for review.

This is not fatal, but it is inconsistent if the cross-cutting pass is considered part of the reviewed state. Either update the area status lines or clarify in README that they remain “for review” pending this cross-cutting pass.

---

### 3.1.2 ADM cites superseded API-009 for rate limits

**Location:**
ADM section 2 prose and traceability.

**Issue:**
ADM says the administrative API is reachable on same terms as interface, including declared rate limits of **API-009**. But in the API document, API-009 is superseded by **API-051**, which requires rate limits to be declared in the API specification itself so contract tests can verify them.

**Fix:**
Update ADM citations and prose from API-009 to API-051.

---

### 3.1.3 AST-039 cites superseded CNT-083; traceability has a typo

**Location:**
AST section 5, AST-039; AST traceability table.

**Issue:**
AST-039 says default alternative text must carry the language it is written in, citing **CNT-083**. But CNT-083 is superseded by **CNT-140**, which requires BCP 47 tags with region where relevant. The AST traceability row also appears to say “CNT-008,” which is likely a typo.

**Fix:**
Update AST-039 and traceability to cite **CNT-140** and **CNT-084**.

---

### 3.1.4 CNT-N07 cites superseded CNT-040

**Location:**
CNT non-requirements, CNT-N07.

**Issue:**
CNT-N07 says “No tables or images inside footnotes (CNT-040).” But CNT-040 is superseded by **CNT-129**, which is the current closed list for footnote content.

**Fix:**
Update CNT-N07 to cite CNT-129.

---

### 3.1.5 REU-N04 cites superseded REU-023

**Location:**
REU non-requirements, REU-N04.

**Issue:**
REU-N04 says “Excluded means absent (REU-023).” But REU-023 is superseded by **REU-048**, which adds the publication scan enforcement.

**Fix:**
Update REU-N04 to cite REU-048.

---

### 3.1.6 LOC-N04 cites superseded LOC-011

**Location:**
LOC non-requirements, LOC-N04.

**Issue:**
LOC-N04 says “No mixed-language output by accident (LOC-011).” But LOC-011 is superseded by **LOC-037**, which makes fallback a document-level policy and requires untranslated fallback to be marked in output.

**Fix:**
Update LOC-N04 to cite LOC-037.

---

### 3.1.7 PUB traceability cites superseded PUB-051 for failure/typeface issues

**Location:**
PUB traceability table.

**Issue:**
A row links **PUB-019, PUB-051** to STY typeface licence requirements. But PUB-051 is superseded by **PUB-072**, which is the current exhaustive failure list including unavailable typeface and missing glyph.

**Fix:**
Update that traceability row to cite PUB-072 where appropriate, while keeping PUB-019 for embedding subject to licence.

---

### 3.1.8 STY traceability has a likely typo and stale image-style citations

**Location:**
STY traceability table, row for STY-015 to STY-019.

**Issue:**
The row says “CNT-008, CNT-091, CNT-092.” CNT-008 is about marks being semantic and not carrying typeface/size/colour; it is probably a typo for an image-related requirement. Also, the current image-style requirements in CNT are CNT-121/CNT-122/CNT-123 after CNT-088 was superseded.

**Fix:**
Correct the traceability row to cite the current CNT image-reference/image-style requirements and STY’s own image-style rules.

---

### 3.1.9 STY-048 cites LOC-004 for scripts, but LOC-004 is about RTL interface layout

**Location:**
STY-048.

**Issue:**
STY-048 says the default theme must cover “the scripts LOC-004 admits.” But LOC-004 requires right-to-left interface layout support, not a list of content scripts. The more appropriate dependencies are CNT-059 for RTL/bidirectional text, CNT-140/LOC-038 for language tags/supported locales, and possibly LOC-004 only for interface layout.

**Fix:**
Reword STY-048 to cite the content-language/script requirements rather than LOC-004 alone.

---

## 3.2 Semantic tensions between documents

### 3.2.1 LIF’s “latest approved” reference mode is not present in CNT/STR/REU

This is both a gap and an inconsistency.

**Documents:**

- LIF-038/LIF-041 introduce latest-approved references.
- CNT-108/CNT-110, STR-009 and REU-002 only define pinned or floating at latest.

**Tension:**
LIF assumes a reference mode that the core reference model does not define.

**Fix:**
Update the reference model as described in section 2.1.

---

### 3.2.2 IAM external access is scoped to spaces/documents, but publication sharing needs artifact-level grants

**Documents:**

- IAM-048: external access granted against named spaces or documents through permission model.
- PUB-057 to PUB-060: publications shareable outside tenant to named recipients.
- IAM section 2 defines “artifact” to include publication.

**Tension:**
A publication recipient may need read access to a publication artifact, but IAM-048 only names spaces or documents.

**Fix:**
Amend IAM-048 to say external access may be granted against named artifacts, including publications, or add an explicit publication-sharing grant model in PUB/IAM.

---

### 3.2.3 IMP’s unattended-import rule conflicts with own-format restore unless carefully scoped

**Documents:**

- IMP-003: import must never run unattended, at any scale, for any customer.
- IMP-N01: no unattended import at any scale.
- IMP-N06: no unattended import of a foreign document; product’s own export format is not a foreign document and is importable per IMP-039.
- API-N05: no unattended bulk import through API.

**Tension:**
Read flatly, IMP-003 forbids all unattended import, while IMP-N06/IMP-039 imply own-format restore may not need the same attended split judgement. This needs explicit scoping.

**Fix:**
Reword to say:

> The prohibition on unattended import applies to foreign content that requires human split/judgement decisions. Restoring the product’s own export format is an authorized, permissioned, audited job and does not require the assisted split review, but it must still be initiated by an entitled principal and must not become a general bulk-create endpoint.

This reconciles IMP-003, IMP-N06, IMP-039 and API-N05.

---

### 3.2.4 Normal deletion refusal conflicts with tenant closure unless an exception is stated

**Documents:**

- LIF-023: deletion refused where baseline/publication/hold depends on what is being deleted.
- VER-023: deleting anything a baseline pins refused while baseline exists.
- VER-049: baselines accumulate by design; nothing deletes one.
- ADM-030/IAM-058/PUB-081: tenant closure eventually deletes or makes unreadable publications and everything else after grace period.

**Tension:**
Live-operation rules say baselines/publications/pinned artifacts cannot be deleted, but tenant termination must make everything unreadable/deleted on a timetable.

**Fix:**
Add an explicit tenant-termination exception, with legal hold carve-out, as described in section 2.18.

---

### 3.2.5 ADM-N02’s no-cross-tenant-reporting rule may conflict with organization administration

**Documents:**

- IAM-052: organization groups several tenants sharing billing, administration and IdP configuration.
- ADM-N02: no cross-tenant reporting, including product analytics, other than aggregates that identify nobody.

**Tension:**
An organization administrator may need to see per-tenant administrative or billing metadata across tenants in the same customer organization. ADM-N02 as written could be read to forbid even that.

**Fix:**
Add an exception for organization-level administration/billing within the same customer organization, while preserving the ban on cross-tenant content reporting and analytics that identify individuals or unrelated tenants.

---

### 3.2.6 CNT and STY currently both own image-style resolution rules

**Documents:**

- CNT-091/CNT-092: aspect ratio preservation and maximum-height constraint.
- STY-016/STY-017: same rules from the style side.
- CNT-Q15: asks whether CNT-091 to CNT-093 should be superseded by STY equivalents.

**Tension:**
This is already flagged as open, but until it is resolved there are two owners of the same rule. That is exactly the condition under which the two documents drift.

**Fix:**
Resolve CNT-Q15 before T1 image-style implementation. The cleanest answer is probably:

- CNT owns that an image reference carries a named style and no absolute dimensions.
- STY owns how the style resolves to dimensions, aspect ratio and maximum constraints.
- Supersede or narrow CNT-091/CNT-092 accordingly.

---

### 3.2.7 REU where-used scope is narrower than other documents’ where-used requirements

**Documents:**

- REU-006 lists components, assets, query definitions, styles, terms and templates.
- LIB-005 requires every library record’s where-used to be listable, including bibliography entries and vocabulary values.
- AST-018 includes baselines for asset use.
- TPL-032 requires listing documents created from a template version.
- VER/PUB imply baseline/publication dependencies matter for impact.

**Tension:**
The central where-used query does not explicitly cover all artifact types or dependency kinds that other documents require.

**Fix:**
Broaden REU-006 or add a cross-cutting where-used/impact requirement as described in section 2.10.

---

### 3.2.8 API webhook event list omits notification events required by COL

**Documents:**

- API-025: content, workflow, review and publication events must be deliverable as webhooks.
- COL-037: notification events must also be available as webhooks.

**Tension:**
API’s explicit event list does not mention notification events, even though COL requires them to be webhook-deliverable.

**Fix:**
Amend API-025 to include notification events, or say that the event inventory is owned by COL/LIF/PUB and includes all events those areas declare deliverable as webhooks.

---

### 3.2.9 STR delegates outline concurrency to COL, but COL does not own document-level locking

**Documents:**

- STR section 2 says two editors moving the same node at once is owned by COL and API.
- COL-011/COL-N02 say locks are per component and there is no document-level locking.
- API-037/API-038 provide version preconditions/no unconditional overwrite at the API.

**Tension:**
The delegation points to COL for a concurrency problem that COL explicitly does not solve with document locks. API covers the wire protocol, but the interface behaviour for conflicting outline edits is still unspecified.

**Fix:**
Add an explicit STR/COL/API concurrency rule for outline/structure edits, as described in section 2.8.

---

# Recommended next actions

If I were prioritizing the cross-cutting revision, I would do this in three waves.

## Wave 1: low-effort consistency fixes

These are mostly citation/status corrections and should be done first because they reduce noise in later reviews.

1. Update stale citations to superseded requirements:
   - ADM → API-051 instead of API-009.
   - AST-039/traceability → CNT-140/CNT-084.
   - CNT-N07 → CNT-129.
   - REU-N04 → REU-048.
   - LOC-N04 → LOC-037.
   - PUB traceability → PUB-072 where appropriate.
   - STY traceability typo and image-style citations.
   - STY-048 script dependency citation.
1. Reconcile README status with area document status lines.
1. Add a short cross-cutting note that every “audited” requirement must map to a named LIF event type.

## Wave 2: P0 semantic fixes

These should become new requirements or amendments before implementation planning for the affected tranches.

1. Add **latest approved** as a first-class reference mode across CNT/STR/REU/LIF.
1. Expand baseline/publication pinning to include LIB records and template version/owned definitions.
1. Expand LIF audit event taxonomy or add the mapping rule.
1. Specify document profile initialization/validation between TPL, REU and LIF.
1. Add tenant-scoped derived-copy rule covering indexes, embeddings, exports, notifications, webhooks, backups and derivatives.
1. Bind AI-proposed edits to COL/API concurrency rules.
1. Specify outline/document-level concurrency.
1. Specify realtime/shared-publication revocation behaviour for active sessions.
1. Broaden where-used/impact to cover all reference-bearing artifacts and baseline/publication pins.

## Wave 3: decide the operational architecture seams

These may become new areas or large cross-cutting sections.

1. Decide whether to create **NOT** for notifications/messaging, or expand COL/API/ADM.
1. Decide whether to create **SEC/DPA** for security/privacy/residency/backup-DR, or add cross-cutting requirements in IAM/ADM/LIF.
1. Decide whether to create **JOB** for background/scheduled work, or extend API+ADM with a scheduler/job model.
1. Decide how much organization administration is in scope and update IAM/ADM accordingly.
1. Settle the open questions that block these decisions:
   - ADM-Q01 data residency,
   - ADM-Q02 metering for pricing,
   - API-Q04 public vs integrator API,
   - AST-Q01 SVG handling,
   - GEN-Q05 guardrail ownership,
   - LIF-Q01 target regimes,
   - VER-Q03/LIF-Q03 erasure versus immutability,
   - CNT-Q15 STY/CNT image-style ownership.

---

## Bottom line

The 21 areas are the right top-level decomposition for this product. I would not fragment the content domain further. The main cross-cutting risks are:

1. **Reference mode inconsistency** around LIF’s “latest approved.”
1. **Reproducibility gaps** in baseline/publication pinning, especially library records and template versions.
1. **Audit event taxonomy** not fully matching all documents’ “audited” requirements.
1. **Operational seams** for notifications, webhooks, scheduled/background work and external data flows.
1. **Tenant-isolation completeness** for derived copies such as embeddings, exports, notification payloads, webhook payloads and backups.
1. **Lifecycle edge cases** where normal immutability/deletion-refusal rules meet tenant suspension/closure/legal hold.
1. A number of **stale citations to superseded requirements**, especially around CNT-140 language tags, API-051 rate limits, REU-048 conditional exclusion and LOC-037 fallback policy.

Fixing those seams would make the requirement set much harder to misimplement and much easier to audit as a single product rather than twenty-one separately reasonable documents.
