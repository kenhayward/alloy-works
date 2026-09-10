# Alloy Works - Project Scope

> **Status: v1, for review. Proposed scope, not built.** This document defines what Alloy Works is for, what it
> will and will not do, and which decisions are already settled. It is deliberately intent-level:
> it says what a capability is for and how we will know it worked, not how it is implemented. It is
> the input to a set of detailed requirements documents, which are in turn the input to a proposed
> architecture. Nothing described here exists yet - [`docs/features.md`](../features.md) remains the
> honest inventory of what the repository actually does today.

## 1. Purpose of this document

Alloy Works is a large build spanning several subsystems that are each a product in their own right
elsewhere in the market: structured authoring, data connectivity, collaborative review, publishing,
and generative AI. A top-down scope is the only way to stop those from being specified
independently and then failing to meet in the middle.

This document does three jobs:

1. **Ranks.** It states one positioning claim, and everything else is ordered against it.
2. **Bounds.** Its non-goals section is as load-bearing as its capability section.
3. **Separates settled from open.** Section 9 records decisions that are made and why. Section 10
   records the ones that are not, what each hinges on, and what has to happen before it can be
   taken.

## 2. The problem

Reports that combine narrative judgement with live data are produced today by two incompatible
classes of tool, and organisations pay for the gap between them.

**Document tools do not understand data.** A word processor treats a number as characters. When the
underlying figure changes, somebody re-types it, somebody else re-checks it, and the version that
reached the regulator cannot be traced back to the query that produced it. Every table is a manual
reconciliation, and the reconciliation is repeated in full every cycle.

**Data tools do not understand documents.** A BI platform will bind a table to a query flawlessly
and then have nothing to say about a 200-page assessment with numbered sections, cross-references,
footnotes, citations, an approval chain, and a legally required accessible PDF.

**Neither understands reuse.** The same methodology statement, the same regulatory boilerplate, the
same site description appears in dozens of reports. It is copied. When it changes it is corrected
in one place and stays wrong in the rest, and nobody can list where it was used.

The result is familiar and expensive: reports assembled by copy-and-paste under deadline, numbers
transcribed by hand, review conducted over emailed attachments with conflicting redlines, and an
audit trail reconstructed after the fact from file names.

## 3. What Alloy Works is

**Alloy Works is a component content management system for reports that mix authored narrative with
live data.**

Content is authored as small, typed, independently revisable **components**. Documents assemble
components rather than owning them. Values, tables and figures are **bound** to parameterised
queries against connected data sources, and every bound value carries provenance back to the query
and the moment that produced it. Generative AI participates as a governed contributor: inside
templates as declared prompts with declared context, and alongside the author as a tool-enabled
assistant grounded in the tenant's own content. Publishing produces submission-grade PDF and Word
from the same source.

It is delivered **web-first**, multi-tenant, with a desktop shell for users who would rather have an
application than a browser tab.

## 4. Market position

The capabilities Alloy Works needs are individually mature. No product combines them.

| Benchmark                                          | What they do well                                                             | The gap                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Workiva**                                        | Linked live data, cell-level provenance, audit trail, periodic reporting      | No real component reuse, no conditional profiling, thin narrative structure, not AI-native |
| **Paligo, Heretto, Adobe AEM Guides, IXIASOFT**    | Component reuse, conditional profiling, multi-channel publishing, translation | Essentially no live data binding - content is hand-authored prose                          |
| **Certara CoAuthor, Veeva Vault, Instem**          | Regulated lifecycle, electronic signature, submission-grade output            | Narrow vertical, closed, expensive, thin general-purpose data connectivity                 |
| **Quarto, R Markdown, Jupyter Book**               | Genuinely reproducible data-in-document, excellent maths and citations        | Single-author, file-based, no tenancy, review, permissions or lifecycle                    |
| **Google Docs, Microsoft 365, Confluence, Notion** | Collaboration and review interactions everyone already knows                  | No structure, no reuse, no data binding, no control over published output                  |
| **MadCap Flare, Author-it**                        | Mature single-source publishing, strong output control                        | Desktop-era architecture, weak collaboration, no data binding                              |

**The claim:** _CCMS-grade reuse and lifecycle, plus Workiva-grade live data lineage, plus AI-native
authoring, in one web-first product._

That sentence is the north star. A proposed capability that serves none of its three clauses is a
candidate for the non-goals list; a capability that serves all three is where effort concentrates.

Two things follow from the benchmarks and are entry requirements rather than differentiators,
because a buyer will not consider a product that lacks them:

- **Published output must be indistinguishable from what the organisation produces today.** The
  first thing a prospect does is publish a real report and look at it. Typography, pagination, table
  breaking, running heads, footnote placement and numbering are not polish.
- **Review must feel at least as good as a word processor.** Threads, mentions, and redlines a
  reviewer proposes and an author accepts. Anything worse loses the room regardless of what else the
  product does.

## 5. Who it is for

| Persona                            | What they do                                                                       | What they need most                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Lead author / report manager**   | Owns a report end to end, assembles it, chases contributors, drives it to approval | Status at a glance, structure control, confidence that the numbers are current             |
| **Contributing author (SME)**      | Writes or revises a few components inside somebody else's report                   | To open one thing, edit it, and be unable to break the rest                                |
| **Data owner / analyst**           | Defines connections and queries, guarantees the figures                            | Query definitions as reviewable, versioned artifacts rather than strings inside a document |
| **Reviewer / approver**            | Internal QA, regulatory affairs, or a client-side reviewer                         | Redlines, threads, and a clear record of what they signed and when                         |
| **Template designer / architect**  | Defines report types, metadata, structure, styles and prompts                      | Composable, independently reusable pieces rather than clone-and-edit templates             |
| **Tenant administrator**           | Users, roles, spaces, model endpoints, connection secrets, retention               | Inherited permissions that are legible, and an audit trail                                 |
| **Integrator / agent developer**   | Drives Alloy Works from another system or from an AI agent                         | A stable API and a small, well-described MCP surface                                       |
| **Localisation manager** _(later)_ | Manages translated variants of components and documents                            | Translation status that invalidates when the source changes                                |

## 6. Core concepts

These names are the shared vocabulary for every requirements document that follows.

### The container hierarchy

- **Tenant** - a customer. The isolation boundary for identity, content, connections, model
  endpoints, secrets, audit and billing. Nothing crosses a tenant boundary.
- **Space** - a named repository of content within a tenant, and the primary unit of access control
  below the tenant. A space holds components, documents, templates, assets and the definitions they
  use. Spaces exist so a tenant can separate work by client, programme, department or
  confidentiality without needing a second tenant.

### Content

- **Component** - the atom. A small, typed, titled, independently revisable piece of content that a
  document may reference. It knows its own content and metadata. It does not know its heading
  number, its position, or which documents use it.
- **Iteration** - an interim save of a component. Immutable, timestamped, visible only to the editor
  holding the lock, and retained for a declared recovery window rather than for ever. This is where
  continuous saving goes, and it is not part of the record of what a component said.
- **Component version** - an iteration promoted to the record, cut on a stated boundary. Versions are
  never edited and never deleted. Everything downstream - baselines, comparison, audit, provenance -
  depends on this holding without exception.
- **Component revision** - a version designated as issued, when a component passes a lifecycle gate.
  A marker on a version, not a second history beside it. Written `revision.version`, so `3.14` is the
  fourteenth version since the third issue and `0.7` is something never yet issued. A revision is
  what a reader cites. See [ADR-0006](../decisions/0006-iteration-version-revision.md).
- **Node-and-mark model** - the canonical form of a component's content: a tree of typed **nodes**
  (paragraph, list, table, figure, equation) carrying **marks** applied to ranges of text.
  Conditions, redlines, comment anchors, citations, variables and inline bindings are all marks, and
  each carries an id - which is what lets two of them overlap without nesting, the thing no tree
  markup represents without leaving its own model. See
  [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md).
- **Asset** - a managed, versioned binary: image, vector graphic, embedded object. Assets are
  referenced like components, carry alt text and caption metadata, and are numbered by the document
  that uses them rather than by themselves.

- **Bibliography entry** - a managed record of a source, referenced by a citation rather than typed.
- **Term** - a managed record of what something is called: a preferred label, alternative labels, an
  abbreviation, a definition, a status, and a label per language. Referenced from content and never
  typed, so that first-use expansion and glossaries can be resolved by the document rather than
  baked into the component.
- **Vocabulary** - a named list of the permitted values a metadata field may take.

### Assembly

- **Document** - the unit a reader receives and a publication is made from. A document owns an
  outline and a set of metadata values. It does not own content.
- **Outline** - the ordered tree that gives a document its structure. Each node is either a
  **section** (a structural heading that exists only in this document) or a **component reference**
  (a pointer to a component, pinned to a version or floating at latest). Sections and components
  are therefore independent, as they must be: a component reused at depth 2 in one report and depth
  4 in another cannot carry its own heading level.
- **Numbering, cross-references and captions are properties of the outline, never of the
  component.** They are resolved at publish time in the context of the document doing the resolving.
  This single rule is what makes reuse possible at all.
- **Baseline** - a named, immutable version of a document that pins the exact version of every
  component, asset, definition and bound value it used. A baseline is what "as published", "as
  submitted" and "compare against" actually mean. Without baselines, comparison across time is
  undefined.
- **Publication** - a rendered output artifact produced from a baseline under a given publishing
  layout: retained, addressable and permissioned.

### Definition artifacts

A **template** is a _binding_ artifact. It composes the six definitions below and owns none of them.
Each is independently reusable and independently versioned, so a table look, a query or a prompt can
be shared across templates without cloning anything.

| Definition                                 | What it declares                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Metadata schema**                        | The typed fields a document and its components must or may carry, and their validation rules                                                                              |
| **Structure outline**                      | The starting shape of a document: expected sections, required components, permitted variation                                                                             |
| **Data connections and query definitions** | Where data comes from, and the parameterised queries available against it                                                                                                 |
| **Presentation theme**                     | On-screen and in-output appearance, as named style catalogues an administrator can extend - paragraph, character, table, image, admonition and citation styles. See §7.18 |
| **Publishing layout**                      | Page size, margins, running heads, pagination rules, front and back matter, per output format                                                                             |
| **Prompt library**                         | Declared AI prompts, each with its declared context, permitted output, and governance settings                                                                            |

- **Parameter set** - the values that instantiate a template into a document: the site, the period,
  the product, the jurisdiction. Parameters feed queries, metadata, conditions and prompts, which is
  what lets one template produce forty reports.

### Data

- **Data connection** - a configured, credentialed route to a source system, owned by the tenant.
- **Query definition** - a named, versioned, parameterised query against a connection, reviewable as
  an artifact in its own right rather than buried inside a document.
- **Binding** - the link between a place in the content and a query result. An **inline binding**
  substitutes a scalar into running text; a **block binding** produces a table or a figure.
- **Binding mode** - `live` (resolved on every view), `pinned` (frozen at a recorded moment), or
  `refreshable` (pinned, flagged when the source moves, refreshed on approval). A baseline pins
  everything regardless of mode.
- **Provenance record** - attached to every resolved binding: which query definition at which
  version, which parameters, which connection, when it ran, how many rows, and a checksum of the
  result. This is the evidence behind a number.

### Process

- **Relationship** - a named, schema-declared, directional link between two artifacts, carrying its
  own metadata. Relationship types declare their permitted endpoints and cardinality.
- **Condition** - a named profiling axis (audience, product, region, jurisdiction,
  confidentiality) whose values are evaluated at publish time to include or exclude content.
- **Review thread** - a conversation anchored to a specific place in specific content, resolvable,
  with mentions.
- **Suggestion** - a proposed change to content, shown as a redline, which an author accepts or
  rejects. Distinct from a thread, and more important in regulated review than live cursors are.
- **Workflow state** - where an artifact sits in its lifecycle, with declared transitions, the
  permissions each requires, and the approvals that gate it.

## 7. Capability scope

Twenty-one areas. Each becomes one detailed requirements document.

### 7.1 Authoring

Components are written in an editor that produces structured content, not formatted characters.
Appearance comes from the presentation theme, so the same component looks right in every document
that uses it.

- Structured prose, lists (ordered, unordered, definition), tables, figures, preformatted blocks,
  block quotes and admonitions.
- Character-level formatting limited to semantic marks - emphasis, strong, subscript, superscript,
  code, term, variable - not arbitrary font control.
- **Footnotes at three anchor levels**: a span of text, a table cell, and a table as a whole.
  Numbered by the document at publish time, never by the component.
- **Mathematical and scientific notation as first-class content**: entered as LaTeX or through an
  equation editor, stored canonically, rendered on screen and in every output format.
- Full Unicode including scientific and technical symbols, with an insertion palette and a
  per-tenant list of preferred characters.
- **Citations as references to bibliography entries**, formatted by a selected standard citation
  style at publish time. Never hand-typed.
- **Paste from Word and Markdown that preserves structure** rather than a wall of styled spans, with
  a visible report of what was normalised or dropped.
- Autosave and recovery. A draft is never lost to a closed tab.
- **The document view is one continuous, visually consistent scroll.** Component boundaries are
  revealed on hover and by an explicit toggle - they are not permanent chrome. The monolithic
  reading experience is the point of the view.

### 7.2 Structure, numbering and cross-references

- An outline tree editable by drag, by keyboard and through the API.
- Numbering schemes declared by the publishing layout and applied at publish time: sections,
  figures, tables, equations, appendices, and continuation across parts.
- **Cross-references target identity and resolve to a number, title or page in the resolving
  document's context.** A reference whose target leaves the document fails the publish loudly.
- A navigable on-screen table of contents reflecting the live outline, tracking position as the
  reader scrolls.
- Generated table of contents, table of figures and table of tables in published output.
- **Deep links**: a stable, shareable URL for a tenant, space, document, outline node, component,
  version, baseline, publication or review thread. Opening one navigates to and highlights the
  target, subject to permission.

### 7.3 Reuse, variants and conditional profiling

The capability that makes this a component CMS rather than a good editor.

- A component may be referenced by any number of documents, in any space the referrer can read.
- Each reference is independently pinned to a version or floating at latest, and which one is
  visible in the editor.
- **"Where used" is a first-class query**, not a report.
- Editing a component used elsewhere warns and shows the impact before the change is saved.
- **Variables**: named values resolved from the parameter set, from metadata or from a query, and
  substituted into running text.
- **Conditions**: content marked with named profiling axes is included or excluded at publish time
  against the document's declared condition values, and a conditional publish is previewable on
  screen before it is produced.
- **Parameterised bulk generation**: instantiate many documents from one template and a set of
  parameter rows, then track and publish them as a cohort.

### 7.4 Data connectivity and bindings

- Connections to relational databases, HTTP and REST endpoints, and file-based sources at minimum,
  extensible by connector.
- **Query definitions are named, versioned, parameterised artifacts** with declared parameters,
  types and permitted values. They are reviewed and permissioned like content.
- **Parameters are bound values, never concatenated into a query.** A parameter cannot change the
  shape of a query.
- **Execution identity is declared per connection** - a tenant service account, or the end user's
  identity passed through so that source-side row-level security applies - and which one is in force
  is visible to the author.
- Secrets live in a tenant secret store, are write-only from the client's perspective, and never
  appear in a response, a log, an export or a crash report.
- Bindings resolve in live, pinned or refreshable mode, and refreshable bindings are flagged when
  the source moves.
- **Every resolved binding writes a provenance record**, inspectable from the value in the document
  and from the published output's audit companion.
- Result caching with declared freshness, per-query row and size limits, and timeouts.
- **A failed or truncated query fails the publish with a named error.** A binding never silently
  publishes a blank.

### 7.5 Tabular presentation

- A block binding renders a result set under a named table look from the presentation theme.
- Column selection, ordering, header text, grouping, sorting, totals and subtotals.
- Per-column field formatting: number, currency, percentage, date, unit, precision, negative and
  null presentation, locale.
- **Pivot and cross-tabulation are pushed into the query layer wherever the source can do it.** The
  presentation layer performs a narrow, declared set of reshaping operations only. Building a
  general pivot engine alongside cell formatting and cell footnotes is a spreadsheet-grade
  subsystem, and it is not what this product is for.
- Cell-level and table-level footnotes.
- Declared page-break behaviour: repeated headers, continuation labels, keep-together rules.
- Conditional presentation rules - thresholds, emphasis, banding - declared in the theme rather than
  authored per document.

### 7.6 Generative AI

Two surfaces: declared prompts inside templates, and a tool-enabled assistant alongside the author.

- **A template prompt declares its context explicitly** - which metadata, which component content,
  which query results. Context is never implicit.
- **Model endpoints are configured at the tenant level**: multiple providers (Anthropic and
  OpenAI-compatible), multiple models, cloud and self-hosted, with a declared default and per-purpose
  routing.
- **Retrieval grounding** over the tenant's own components and assets, filtered by the requesting
  user's permissions. AI never surfaces content the user could not otherwise read.
- **Generated content is marked as generated** and records the model, its version, the prompt, and a
  digest of the context. It is a proposal until a human accepts it, and acceptance is an audited act.
- **Prompt injection is treated as a live threat, not a hypothetical.** Component content, imported
  documents and query results are untrusted input to a prompt. They are never treated as
  instructions. The assistant's tool use is constrained by the calling user's permissions, never by
  anything the content asks for.
- **The assistant's tools are the product's own capabilities** - search, read, propose an edit, run
  a defined query - each subject to the same authorisation as the equivalent user action, and each
  mutating action confirmed by the user.
- **Cost governance**: per-tenant budgets and alerts, per-user rate limits, bring-your-own-key,
  prompt and result caching, and visible token accounting.

### 7.7 Collaboration and review

- **Presence**: who is in this document, and where.
- **Soft component locks**: a component is claimed by one editor at a time. The claim is visible,
  auto-releases on idle, and can be taken over with a warning and an audit entry.
- **Review threads** anchored to a span, a component, a table cell or an outline node; resolvable;
  with mentions that notify.
- **Suggestions**: proposed changes rendered as redlines, accepted or rejected individually or in
  bulk, with attribution.
- **Review rounds**: a named review with a defined set of reviewers, a due date and a completion
  state, so "has everyone reviewed this" is answerable.
- Notifications by in-app inbox and email, with per-user preferences and digesting.
- Real-time character-level co-editing inside a single component is explicitly out of scope. See
  section 9 for the reasoning and section 14 for what would reopen it.

### 7.8 Lifecycle, workflow and audit

- Declared workflow states and transitions per artifact type, configurable per tenant.
- Transitions gated by permission and by required approvals. An approval may require
  re-authentication and an attributed statement of intent - an electronic signature.
- Effective dates, review-by dates, and periodic-review prompting.
- Retention policies, archival, legal hold, and deletion that respects a hold.
- **An append-only audit log** covering authentication, denied authorisation, content change,
  workflow transition, approval, binding resolution, publication, export, permission change and
  administrative action. Queryable and exportable.
- Audit records are immutable and readable independently of the content they describe.

### 7.9 Versioning, baselines and comparison

- Immutable component versions with an author, a timestamp and an optional change note, and
  revisions designating the versions that were issued.
- Document baselines pinning every referenced version, definition version and bound value.
- **Comparison at three levels, because they answer three different questions:**
  - **Structural** - what moved, was added or was removed in the outline.
  - **Content** - what changed inside a component, rendered as a redline.
  - **Resolved output** - what changed in the published result, which catches changes caused by
    data, conditions or definition versions rather than by anyone editing anything.
- Comparison between any two versions of a component and any two baselines of a document, including
  across a template version change.
- Restoring an earlier version creates a new version. Nothing is ever rewritten.

### 7.10 Publishing and output

**Publishing is a distinct pipeline, not a print stylesheet:** _resolve_ (transclusion, conditions,
variables, bindings, cross-references, numbering, citations), then _compose_, then _paginate_, then
_render_. Numbering and cross-references cannot be resolved in the editor, because their values
depend on the document doing the resolving.

- **First-class outputs: PDF and Word.** Both are submission-grade, and they set the fidelity bar.
- **Google Docs is an explicitly lossy convenience export, labelled as such in the product.** Its
  API cannot express the pagination, layout and numbering control this product exists to provide, so
  it is not held to the same bar. If it does not earn its maintenance cost, it is cut.
- Publishing layouts declare page size, orientation, margins, running heads and feet, page
  numbering, section restarts, front and back matter, and per-format overrides.
- Generated table of contents, table of figures, table of tables, and optionally an index.
- **Accessible output**: tagged PDF meeting PDF/UA, with document language, reading order, alt text
  and table header associations. Frequently a legal requirement in this market.
- **Deterministic publishing**: the same baseline and layout produce the same output, so a published
  artifact can be independently reproduced and verified.
- Publications are retained, addressable, permissioned and listed alongside the document that
  produced them.
- **An audit companion** available with any publication: the provenance of every bound value in it.

### 7.11 Search, navigation and discovery

- Full-text search over components, documents, publications and threads, permission-filtered at
  query time.
- Faceting on metadata, type, space, workflow state, owner, date and condition values.
- Semantic search over the same corpus, sharing the same permission filter.
- Saved searches and listing views for documents, components, publications and cohorts.
- "Where used", "what does this use" and "what changed since" as first-class queries.

### 7.12 Relationships and the graph

- **Relationship types are declared in a schema**: a name, permitted endpoint types, direction,
  cardinality, and a metadata shape. Unconstrained any-to-any is deliberately not offered - it
  cannot be validated, and in practice it cannot be usefully queried.
- Relationships connect any declared artifact: component to component, component to document,
  document to query definition, component to asset.
- A traversal query surface - neighbours, paths, and impact ("what would changing this affect") -
  exposed through the API and visualised in the product.
- Whether this needs a graph store is an architecture decision, not a scope decision. See section 10.

### 7.13 Import, export and interchange

- Paste from Word and Markdown preserving structure, with a normalisation report.
- **Word import and breakout**: ingest a legacy document, propose a component breakdown from its
  heading structure and content, and let a human accept, adjust, merge and split before anything is
  created. **Always assisted, never automatic.** This is the highest-risk capability in the product;
  an unattended importer that silently produced poor components would poison a repository, and
  poisoned repositories do not recover.
- Import of a bibliography in standard interchange formats.
- **Full tenant export** in a documented, self-describing format: content, metadata, definitions,
  relationships, baselines, publications and audit. Export is a contractual guarantee against
  lock-in, and it is tested rather than asserted.

### 7.14 Identity, tenancy and access control

- Multi-tenant with hard isolation of content, connections, secrets, model endpoints, search indexes
  and audit.
- OAuth 2.1 and OIDC federation with the customer's identity provider, and SCIM provisioning where
  available. Identity-provider group membership maps to roles.
- **Role-based access control with permissions declared at tenant, space, template, document and
  component level, inherited down that hierarchy** with explicit overrides at any level.
- Permissions cover read, create, edit, comment, suggest, approve, publish and administer, plus the
  separately grantable right to see a data connection's results.
- **An effective-permissions view answering "why can this person do this"**, because an inherited
  permission system without one is unusable in practice and unauditable in principle.
- Service identities with scoped tokens for API and MCP consumers, separate from user identities.

### 7.15 API, MCP and extensibility

- **API-first.** The product's own clients use the same API. **OpenAPI is the source of truth** for
  the synchronous surface, client types are generated from it, and contract tests fail when the
  implementation and the specification diverge.
- **Realtime surfaces are specified separately.** Presence, locks, notifications and streaming AI
  responses cannot be expressed in OpenAPI, and pretending otherwise produces a specification that
  is complete only on paper.
- **The MCP server is a curated facade, not a mirror of the API.** A one-to-one mapping would
  produce hundreds of thinly-described tools and degrade every model that touched it. The MCP
  surface is a small set of task-shaped tools over the API, each described for a model rather than
  for a developer, and each subject to the calling identity's permissions.
- Webhooks for content, workflow, review and publication events.
- Extension points, in priority order: data source connectors, output formats, citation styles, AI
  model endpoints.

### 7.16 Localisation and translation

- **UX localisation**: interface text, dates, numbers, collation and text direction, including
  right-to-left.
- **Content translation, which is the larger half and the one that carries commercial value**:
  per-language variants of a component, a translation status that is invalidated when the source
  version changes, XLIFF round-trip to translation vendors, and machine translation as an assist
  with human review.
- A document is published in a language, and the publishing layout may vary by language.
- Phased after the core, but **the content model must accommodate it from the start.** Retrofitting
  language variants onto a monolingual version model is a rewrite.

### 7.17 Administration, cost and observability

- Tenant administration: users, roles, spaces, connections, model endpoints, secrets, workflow
  definitions, retention policies.
- Usage and cost visibility: AI tokens by user and purpose, query execution, storage, publication
  volume.
- Operational observability: health, latency and error budgets per capability, with tenant-scoped
  diagnostics an administrator can read without raising a support ticket.

### 7.18 Styles and presentation themes

Appearance is named, catalogued and extensible, rather than chosen freely by an author or hard-coded
by a developer. This area exists because style catalogues turned out to span the editor and the
publisher and to belong to neither: an author selects a style while writing, and the publisher
resolves it while rendering, so the catalogue itself is a third thing.

- **Style catalogues** for paragraphs, character marks, tables, images, admonitions and citations. A
  style names an appearance; content selects a style by name; nothing in content describes how the
  style looks.
- **Configuration-extensible by a tenant administrator.** Adding "Small thumbnail" beside "Thumbnail"
  is configuration, not a release. A catalogue nobody can extend becomes a queue of change requests.
- **One catalogue, two consumers.** The editor and the publisher resolve the same style, so what an
  author sees is what a reader gets - within the limits of a scrolling view, which has no pages.
- **Image styles fix one dimension and derive the other** from the image's own proportions, with a
  declared maximum in the other direction. Fixing both distorts the picture, and does it silently.
- **A presentation theme binds a set of catalogues**, and a template binds a theme. Themes are
  versioned like every other definition artifact, and a baseline pins the theme version it published
  under - otherwise re-publishing an approved document could change how it looks.
- **Separate from the publishing layout.** A theme decides what things look like; a layout decides
  page size, margins, running heads and pagination. They are configured independently because a
  house style outlives a page format.
- **Catalogues must be exportable and importable**, so a house style can move between spaces and
  tenants rather than being rebuilt by hand.

### 7.19 Templates and document instantiation

A template is the artifact that binds the others, and instantiating one is how most documents in
this product will begin. Neither had an owner: §6 defined a parameter set and §7.3 specified
generating many documents at once, but nothing covered a single document being created, and the
template designer named in §5 had no area serving them.

- **Template authoring.** A template designer creates, edits and versions a template, and binds to
  it the six definitions in §6. Two of those - the **metadata schema** and the **structure
  outline** - are owned here, because nothing else owns them; the other four belong to **DAT**,
  **STY**, **PUB** and **GEN**, and a template only references them.
- **Declared parameters.** A template declares what it needs to be instantiated: each parameter's
  name, type, permitted values, and whether it is required. A document cannot be created until the
  required ones are supplied.
- **Instantiation.** Creating a document from a template and a parameter set: materialising the
  starting outline, seeding metadata, resolving variables, and binding the queries the template
  declares. Whether a query runs at creation and is pinned, or stays live, follows the binding mode
  in §7.4 rather than being decided here.
- **Divergence is expected.** After instantiation a document owns its own outline and may depart from
  the template it came from. That is the point of a starting shape rather than a cage - but the
  document records which template and which template version produced it, so the departure is
  visible rather than merely absent.
- **A template changes after documents exist.** Existing documents must not change underneath their
  authors. What a template version change gives is an answer to "which documents came from this
  version", and a decision about whether a document can be moved forward to a newer one - which is a
  migration, with everything that implies, rather than a setting.
- **Validation.** A document must satisfy the metadata schema its template binds, and a template
  whose definition bindings do not resolve must not be usable to create anything. A broken template
  discovered at publish time has already cost somebody a day.
- **Bulk generation rests on this.** §7.3 instantiates many documents from one template and a set of
  parameter rows; that is the same act repeated, and the guarantees it needs are the ones here.

### 7.20 Assets and media

An asset is a managed, versioned binary a space holds and content references. It gets its own area
because binaries carry a set of concerns nothing else in this product does, and because something
downstream now depends on getting them right: §7.18 resolves an image style by deriving one
dimension from the picture's own proportions, which requires knowing them.

- **Validated on the way in, not inspected later.** An upload is checked against a declared list of
  permitted formats and refused if it does not match, and scanned for malware before it can be
  referenced by anything.
- **Intrinsic properties recorded on ingest** - dimensions, colour space, page count. Discovering an
  image's proportions at publish time is too late for a layout that depends on them.
- **Derivatives generated on ingest**: thumbnails and preview renditions, so that browsing a library
  of several thousand images does not fetch several thousand originals.
- **Alt text belongs to the use, not only the asset.** The same photograph means different things in
  two documents. An asset carries a default; the figure that places it may override, and §7.1 makes
  the figure's alt text a publish-time requirement either way.
- **Versioned, with references pinned or floating** exactly as component references are. Replacing
  an asset creates a version; it does not silently change every document that used the old one.
- **Where-used, and deletion that respects it.** An asset referenced by a baseline cannot be deleted,
  because a published document that no longer renders is worse than a storage bill.
- **Rights and provenance.** An asset records its source and the licence it is held under, and
  publishing can be refused where a licence does not permit the use. Content credentials, where an
  asset carries them, are either preserved or deliberately stripped - and which one happened is
  recorded rather than left to chance.
- **Import and export**, with the metadata above, so an asset library can move between spaces.

### 7.21 Reference libraries

A library is a set of small structured records a space holds and content references by identity:
bibliography entries, terms, and controlled vocabularies. They are grouped because they behave
identically - referenced rather than typed, versioned, permissioned, searchable, and answerable to
"where is this used" - and separated from assets because none of them is a binary.

- **Bibliography entries**, referenced by a citation rather than typed (§7.1), importable in standard
  interchange formats, and deduplicated so that one source does not become four records.
- **Terms.** A term entry carries a preferred label, alternative labels, an abbreviation, a
  definition, a status, and a label per language. **A term is referenced from content, never typed**
  - the same rule as a citation, and for the same reason.
- **First use is a property of the document, not the component.** "Marketing Authorisation Holder
  (MAH)" on first mention and "MAH" thereafter can only be resolved at publish time, because a
  component reused in two reports may be the first mention in one and the fortieth in the other.
  This is why a term has to be a reference: expanding it into text would bake a document-level fact
  into reusable content.
- **Glossaries and lists of abbreviations** are generated from the terms a document actually uses,
  by the publishing pipeline, the same way a list of figures is.
- **Controlled vocabularies** - named lists of permitted values a metadata field draws on. §7.19
  declares which vocabulary a field uses; the vocabulary itself lives here, so two templates can
  share one.
- **A thesaurus, not an ontology.** Broader, narrower and related relations between terms, so that
  searching for one finds the others (§7.11). Inference is deliberately excluded: §7.12 already gives
  a declared, queryable relationship graph, and in a regulated market "the system inferred it" is a
  liability rather than a feature.
- **Versioned, with where-used and import and export**, as for assets.

## 8. Non-goals

Stated explicitly so nobody has to infer them.

- **Not a BI or analytics tool.** No dashboards, no ad-hoc chart exploration. It consumes queries;
  it does not replace the tool that writes them.
- **Not a spreadsheet.** No free-form cell formulas, no arbitrary grid.
- **Not a data warehouse, ETL or transformation platform.** It reads from sources it does not own.
- **Not a digital asset management system.** It manages the assets used in its documents, not a
  media library.
- **Not a website or web publishing channel.** The output is documents.
- **Not a general wiki or knowledge base.**
- **Not an XML editor for arbitrary customer schemas.** The content model is the product's own.
- **Not offline-first.** The desktop delivery is a convenience shell over the same service.
- **Not a prepress or print production system.** No imposition, no colour separation, no bleed
  management.
- **Not an identity provider, an electronic signature provider, a translation agency or a model
  host.** It integrates with each.
- **Not a records management system** for anything other than its own content.

## 9. Decisions already taken

| #   | Decision                                                                                     | Why                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Wedge: regulated data-driven reports**                                                     | It is the one market where every capability on the list coexists naturally, and it is the least well served. A narrow wedge is what makes the ranking rule in section 4 usable                                                                                                                                                           |
| 2   | **Web-first; the service is the system of record; desktop is a convenience shell**           | Tenancy, audit, RBAC, review and collaboration cannot live in a renderer. One storage backend, one auth model, no offline sync problem                                                                                                                                                                                                   |
| 3   | **Component repository, with the template as a binding artifact**                            | A template that owns structure, metadata, queries, styles, layouts and prompts is a god-object, and reuse of any one of them degrades to copy-and-paste                                                                                                                                                                                  |
| 4   | **Soft component locks and presence, not real-time co-editing; suggestions are first-class** | Character-level CRDT editing fights immutable versions, comparison, approval gates and audit. The parallelism authors want is across components. Workiva, Paligo and Heretto all lock                                                                                                                                                    |
| 5   | **OpenAPI is the source of truth for the synchronous API**                                   | The product's own clients use the same API, and a generated-and-contract-tested specification is the only kind that stays true                                                                                                                                                                                                           |
| 6   | **MCP is a curated task-shaped facade over the API**                                         | A mirrored API becomes hundreds of poorly-described tools that degrade the models using them                                                                                                                                                                                                                                             |
| 7   | **PDF and Word set the fidelity bar; Google Docs is a labelled lossy export**                | The Google Docs API cannot express the pagination, layout and numbering control the product exists to provide                                                                                                                                                                                                                            |
| 8   | **Relationship types are schema-declared**                                                   | Unconstrained any-to-any relationships cannot be validated and cannot be usefully queried                                                                                                                                                                                                                                                |
| 9   | **AI output is a proposal until a human accepts it**                                         | Required by the regulated wedge, and the only defensible position when generated content enters a document that somebody signs                                                                                                                                                                                                           |
| 10  | **Content is a purpose-built node-and-mark model, with standards at the boundary**           | Conditions and redlines overlap without nesting, and no tree markup represents that without abandoning its own model. A standard's main benefit here is the output chain, which 7.10 already owns. XHTML, OOXML, Markdown and DITA serve at the boundary. See [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) |

**On the existing repository.** [ADR-0003](../decisions/0003-one-renderer-two-deliveries.md) still
stands, but decision 2 narrows its premise: the desktop delivery no longer has a capability
justification, only a convenience one. Its own "what would change the answer" section anticipates
this, and the platform bridge should be re-examined against it when the service arrives. The
`topic | concept | task` types in `packages/domain` are scaffolding that proved the workspace path
end to end; they carry no weight here.

## 10. Decisions still open

Each becomes an architecture decision record when it is taken. The content representation used to
head this list; it is now settled in [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md).
The first two below are the remaining irreversible ones, and they are **spiked together** rather
than separately - see [`Content_Model_Spike.md`](Content_Model_Spike.md) for why, and for the ten
cases that decide them.

| #   | Decision                      | What it hinges on                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Storage and version model** | Relational rows with version history, event sourcing, or content-addressed objects. Follows from [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) and from the comparison and audit requirements. Case 7 of the spike is a storage question as much as a model one, which is why the two are settled in one pass                       |
| 2   | **Pagination and PDF engine** | Constrained by [ADR-0007](../decisions/0007-no-per-server-licensing-in-the-publishing-pipeline.md) to open-source candidates: WeasyPrint, PagedJS, Typst, headless Chrome. Hinges on PDF/UA tagging, footnote placement, table breaking, maths, and whether preview can share the pipeline. Spiked in [`Publishing_Engine_Spike.md`](Publishing_Engine_Spike.md) |
| 3   | **Word generation approach**  | Direct OOXML or an intermediate representation. Constrained by ADR-0005's commitment to design the schema against the OOXML mapping, and by the engine decision above                                                                                                                                                                                            |
| 4   | **Tenant isolation model**    | Pooled, schema-per-tenant, or database-per-tenant. Hinges on data residency commitments and expected customer size                                                                                                                                                                                                                                               |
| 5   | **Search infrastructure**     | Whether full-text and semantic search are one system or two, and how the permission filter is applied at query time without leaking existence                                                                                                                                                                                                                    |
| 6   | **Relationship storage**      | Recursive SQL or a graph store. Hinges on realistic traversal depth and volume                                                                                                                                                                                                                                                                                   |
| 7   | **Realtime transport**        | Presence, locks, notifications and streaming, and whether one channel serves all four                                                                                                                                                                                                                                                                            |
| 8   | **Fonts and design tokens**   | Carried forward as an open question. The typographic system has to work identically in a browser, in the Electron shell over `file://`, and in the publishing pipeline. Licensing for fonts embedded in published PDF is part of this                                                                                                                            |
| 9   | **Identity strategy**         | Pure federation, or a first-party identity provider with federation as an option                                                                                                                                                                                                                                                                                 |

## 11. Cross-cutting requirements

**Security.** The threat model in one paragraph: content and model output are data, never
instructions; query parameters are bound, never concatenated; tenant isolation is enforced at the
data layer rather than by a `WHERE` clause that application code could forget; secrets are
write-only from the client's perspective; the renderer is untrusted in both deliveries. The two
places a serious breach would come from are multi-tenant data connections and prompt injection
through ingested content, and both get dedicated attention in their requirements documents.

**Compliance.** Audit, electronic signature, retention, legal hold and data residency. Claims about
named regimes - 21 CFR Part 11, SOX, GxP, ISO 27001 - are made only where validated, and are stated
as capabilities that support a customer's compliance rather than as certifications of the product.

**Privacy.** Personal data handling, subject access and erasure. Erasure conflicts with an
append-only audit log and immutable versions; that tension is real and is resolved by design in the
requirements, not by exception at run time.

**Accessibility.** WCAG 2.2 AA for the application and PDF/UA for published output. Both tested.

**Internationalisation.** As section 7.16, and the content model constraint stated there.

**Performance.** These are the quantities that get a number in the requirements documents, and the
numbers are budgets rather than aspirations: time to open a 300-page assembled document, time to
publish it, editor keystroke latency, search latency, concurrent editors per document, components
per space. A capability that cannot meet its budget is a scope question, not a tuning exercise.

**Reliability.** Availability target, recovery point and recovery time objectives, and defined
behaviour when a data source is unavailable - degrade visibly, never silently.

**Cross-platform.** Windows, macOS and Linux for the desktop shell; current evergreen browsers for
the web delivery. Where a platform lags, say so plainly rather than implying parity.

## 12. Phasing

Six tranches, ordered by dependency and by risk. Each is a usable increment, not a layer.

| Tranche                    | Contains                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 - The spine**         | Tenancy, identity, RBAC, spaces, components with immutable versions, documents with outlines, the editor, numbering and cross-references, search, PDF and Word publishing, the OpenAPI surface |
| **T2 - The data**          | Connections, query definitions, parameters, inline and block bindings, provenance, tabular presentation and field formatting                                                                   |
| **T3 - The collaboration** | Presence, soft locks, threads, mentions, suggestions, notifications, baselines, comparison, workflow and audit                                                                                 |
| **T4 - The reuse**         | Transclusion, where-used, variables, conditions and profiling, parameterised bulk generation, relationships and graph queries                                                                  |
| **T5 - The intelligence**  | Template prompts, the tool-enabled assistant, retrieval grounding, AI governance and cost controls, the hardened MCP facade                                                                    |
| **T6 - The interchange**   | Word import and breakout, citation styles, translation and XLIFF                                                                                                                               |

T1 alone is a single-author product that already publishes better than a word processor, which is
what makes it a shippable increment rather than a foundation nobody can evaluate.

Two things cut across the order:

- **The content model spike runs before T1 starts.**
  [`Content_Model_Spike.md`](Content_Model_Spike.md) validates [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md)
  against its ten hardest cases and settles the version store in the same pass. T1 builds on the
  schema draft it produces.
- **The content model must accommodate reuse, conditions, translation and tracked changes from T1**,
  even where the user-facing capability lands in T4 or T6. Retrofitting any of the four is a
  rewrite, which is why cases 1, 6 and 7 of the spike exist.
- **Word export is a T1 deliverable and Word import is a T6 one.** They are different problems, and
  only the export is on the critical path: it is the stated fidelity bar, and ADR-0005 commits to
  designing the schema against its mapping - so that mapping has to be exercised while the schema
  can still change cheaply.
- **A thin AI slice rides along from T2** - draft assistance in the editor, grounded in the current
  document - so the governance model in 7.6 is exercised against real use early rather than designed
  in the abstract and discovered to be wrong at T5.

## 13. Risks

| Risk                                             | Why it matters                                                                                                                                                                                                                                                                          | Mitigation                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**                                        | This is five products. Undisciplined, it never ships                                                                                                                                                                                                                                    | Tranches, the non-goals list, and the ranking rule in section 4                                                                                                                  |
| **The content model is decided but unvalidated** | ADR-0005 was argued, not tested, and everything downstream depends on it                                                                                                                                                                                                                | The ten-case spike, run before T1. Its four gates supersede the record rather than patch the schema, so a failure is visible instead of absorbed                                 |
| **Word fidelity, in both directions**            | The classic killer in this category                                                                                                                                                                                                                                                     | Publish fidelity is a maintained test suite against real report shapes; import is assisted only, never unattended                                                                |
| **Publishing fidelity with an open engine**      | [ADR-0007](../decisions/0007-no-per-server-licensing-in-the-publishing-pipeline.md) rules out the two engines that reliably meet the bar, so what they did for free is now something to build. PDF/UA tagging is the likeliest gap, and the least negotiable requirement in the product | The engine spike, whose four gates measure the gap rather than guess it. Every candidate failing the same gate is what sends ADR-0007 back, which section 14 already anticipates |
| **Prompt injection through ingested content**    | The product ingests untrusted documents and query results directly into prompts                                                                                                                                                                                                         | Content is never instructions; tools are permission-bound; mutating actions are confirmed by a human                                                                             |
| **Loose compliance claims**                      | Expensive to make, dangerous to make wrongly                                                                                                                                                                                                                                            | Capabilities, not certifications, until validated                                                                                                                                |
| **The soft-lock bet**                            | Users may reject anything short of live co-editing                                                                                                                                                                                                                                      | Measure it in early evaluations, and keep the content model compatible with an upgrade                                                                                           |
| **Multi-tenant data connection security**        | The most likely source of a serious breach                                                                                                                                                                                                                                              | One shared enforcement module, execution identity always explicit, escape cases tested directly                                                                                  |
| **AI cost unpredictability**                     | Usage-based cost against seat-based pricing is how margins disappear                                                                                                                                                                                                                    | Budgets, caching, routing and visible accounting from the first AI feature                                                                                                       |
| **Go-to-market**                                 | Competing with Workiva and Veeva means an enterprise sales motion, not a product                                                                                                                                                                                                        | Out of scope for this document, and the reason the wedge is deliberately narrow                                                                                                  |

## 14. What would change the answer

- **The wedge shifts to technical documentation.** DITA interchange becomes close to mandatory,
  translation moves far forward, and the data-binding subsystem drops in priority. Decisions 1 and 3
  in section 9 both change, and [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) reopens -
  DITA's interchange value goes from near zero to substantial the moment procurement starts scoring
  it.
- **A customer requires genuine offline field authoring.** The local-first question reopens,
  ADR-0003's premise changes again, and the desktop delivery reacquires a capability justification.
- **Evaluations show live co-editing is table stakes.** T3 moves forward and decision 4 in section 9
  is reversed. It does **not** reopen the content model: node-and-mark is the family CRDT
  implementations are built for, so this outcome strengthens ADR-0005 rather than threatening it.
- **A spike gate fails.** Cases 1, 3, 7 or 8 needing a workaround that leaks into the schema
  supersedes ADR-0005, and T1 does not start until a replacement record exists. This is the most
  likely of anything on this list, which is why the spike comes first.
- **Customer data cannot leave the network.** Either the desktop shell becomes an edge connector for
  on-premises sources, or the deployment model gains a self-hosted option. Both are significant, and
  both are much cheaper decided early.
- **Early customers do not need regulated sign-off.** Electronic signature and parts of the audit
  surface drop down the order, and T3 shortens considerably.
- **Publishing fidelity proves unreachable with an open engine.** A commercial licence enters the
  cost model, which raises the minimum viable customer size and changes the go-to-market.

## 15. What comes next

1. **Run the content model spike** - [`Content_Model_Spike.md`](Content_Model_Spike.md) - which
   validates [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) and settles the
   version store in the same pass.
2. **Detailed requirements**, one document per capability area in section 7, under
   `docs/specification/requirements/`. Authoring, versioning and comparison, and publishing all
   depend on what the spike finds; the rest do not, and can be written alongside it.
3. **The publishing engine spike** - [`Publishing_Engine_Spike.md`](Publishing_Engine_Spike.md) -
   against the open-source candidates ADR-0007 leaves, informed by what cases 3, 5 and 8 of the
   content model spike turned up about what the engine has to provide.
4. **A proposed architecture**, informed by all of it.

No implementation before the spike. The content model is decided once, and everything in section 7
is downstream of it.
