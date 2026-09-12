# Potential Market Expanding Capabilities

If I were adding **new** features specifically to expand market access further, I would not add more point capabilities inside the existing document model. I would add features that either:

1. remove enterprise procurement blockers,
1. open adjacent document/data workflows, or
1. unlock large existing content estates without breaking the trust model.

The highest-value additions would be these five.

| Priority | New feature to add | Why it expands market access most |
| ---: | :--- | :--- |
| **1** | **Residency, deployment flexibility and customer-managed keys** | Removes one of the biggest blockers in pharma, public sector, EU/global and multi-region enterprise deals. It lets the product be hosted at scale without forcing every customer into the same cloud region or vendor boundary. |
| **2** | **Federated collaboration workspaces / controlled cross-tenant projects** | Opens multi-organization regulated workflows: sponsor/CRO, client/vendor, affiliate/central organization, public-sector consortia. It expands the product from a single-tenant document system into a multi-party governed documentation platform. |
| **3** | **Governed spreadsheet/workbook integration** | Opens financial reporting, management reporting, clinical/regulatory data tables and operations reporting. Many of these documents still start life in Excel; this brings those sources under provenance without turning the product into BI or a spreadsheet. |
| **4** | **Controlled HTML publication reader / digital distribution** | Expands distribution beyond PDF/Word file exchange into client portals, web submissions, intranet reading, mobile access and modern review workflows. It improves recipient experience and makes publications easier to consume without weakening the controlled-document model. |
| **5** | **Legacy estate migration accelerator / DITA-XML bridge** | Opens replacement of incumbent DITA/XML CCMS estates and large Word-based document estates. Migration cost is often the main reason customers stay with legacy tools; a productized migration path makes “modernize our controlled documents” a realistic commercial motion. | {: col-widths="7,25,68" }

Below is why each one matters and how I would keep it consistent with the existing specification.

---

## 1. Residency, deployment flexibility and customer-managed keys

### What to add

A tenant should be able to declare and enforce where its data lives and how it is protected:

- region-pinned tenant storage;
- sovereign cloud, private VPC or air-gapped deployment options where required;
- customer-managed keys or bring-your-own-key encryption;
- region controls for backups, search indexes, derived embeddings and publication artifacts;
- declared outbound data flows for model endpoints, translation vendors, reference-source searches, malware scanning and webhooks;
- the ability to use self-hosted or local model endpoints where content cannot leave a boundary;
- residency attestations and exportable evidence for procurement/security review.

This would partly settle what is currently an open question in ADM-Q01 and turn data residency from a sales conversation into a product capability.

### Why it expands market access

This is probably the most important “boring” feature to add if the product is hosted at scale.

Many regulated or global enterprises will not shortlist a SaaS document platform until they can answer questions like:

- Where does the tenant schema live?
- Where are backups stored?
- Can we pin the tenant to EU, US, UK, Australia, etc.?
- Can we use our own keys?
- Can support access be constrained by residency?
- Can model calls stay inside our boundary?
- Can we deploy into our VPC or a sovereign cloud?
- Can you prove where derived data such as embeddings and search indexes live?

Without this, the product may be technically excellent but commercially unavailable to large portions of the regulated market.

It expands access into:

- pharma/medtech with strict data-location requirements;
- public sector and government-adjacent customers;
- EU/global enterprises with data-protection constraints;
- defense-adjacent or highly controlled environments where private deployment matters;
- customers who want hosted SaaS but require customer-managed encryption.

### How to keep it consistent with the specification

The key is that residency must not become a second, weaker permission model.

It should reinforce the existing invariants:

- tenant isolation remains absolute;
- search, caches, exports, notifications, webhooks and derived data remain tenant-scoped;
- external services are declared rather than discovered;
- if a capability requires content to leave a boundary, that must be visible and configurable;
- audit evidence should show which residency mode was in force.

This feature would not change the core document model. It would make the trust story deployable across more enterprise environments.

---

## 2. Federated collaboration workspaces / controlled cross-tenant projects

### What to add

The current model is deliberately safe: outsiders participate as guests inside the host tenant, and true cross-tenant sharing is deferred. That is correct for early regulated-market trust, but it limits multi-organization workflows.

A new feature would allow a **federated collaboration workspace** or project that spans multiple tenants under explicit governance:

- each organization remains a separate tenant;
- a project declares participating tenants and their roles;
- artifacts remain owned by their home tenant;
- shared references are scoped, time-bounded and revocable;
- participants see only what the grant permits;
- audit logs remain tenant-owned, with optional project-level metadata that does not leak unauthorized content;
- legal hold applies per tenant;
- residency constraints of each participating tenant are respected;
- no implicit cross-tenant search, reporting or analytics.

This would be a deliberate extension of IAM’s current boundary, not a weakening of it.

### Why it expands market access

This opens a much larger and strategically important set of workflows:

- sponsor and CRO collaborating on regulatory submissions;
- client and vendor reviewing the same controlled document;
- central organization and affiliates working on labelling or SOP variants;
- public-sector bodies collaborating with contractors;
- multi-site quality teams contributing to one submission family;
- consortium documentation where several organizations contribute sections but retain ownership.

Today, many of those workflows are forced into awkward patterns:

- exporting files back and forth;
- giving broad guest access that is harder to control than it should be;
- maintaining duplicate documents in different tenants;
- using email/Word as the collaboration layer even though the system of record lives elsewhere.

A governed cross-tenant workspace would make the product relevant to **multi-party regulated documentation**, not just single-tenant document management. That expands both account size and network effects: if one organization uses it, its collaborators may need access too.

### How to keep it consistent with the specification

This is the riskiest of the five because tenant isolation is one of the product’s core trust properties.

It should be designed as a new governed container, not as arbitrary sharing between tenants. For example:

- a collaboration project is itself permissioned and audited;
- an artifact does not become “shared” in the global sense; it is referenced within a declared project scope;
- each tenant’s audit log remains readable by that tenant;
- a participant cannot infer the existence of content they may not read;
- legal hold, retention and deletion remain under the owning tenant’s policy unless explicitly extended by project governance.

If done well, this becomes a major differentiator. If done poorly, it undermines the security story. So I would add it only after the single-tenant trust model is rock solid.

---

## 3. Governed spreadsheet/workbook integration

### What to add

Many regulated and enterprise reports still depend heavily on Excel or CSV-based schedules. The current specification has file-based sources, but not a full governed workbook integration.

I would add a read-only, provenance-preserving workbook layer:

- connect to Excel/CSV files or approved workbook locations;
- declare mappings from sheets, ranges and cells to tables or bindings;
- create versioned snapshots of the source workbook with content hashes;
- extract declared values as governed data artifacts;
- reconcile published tables against the source schedule;
- record cell-level provenance for imported values: file identity, sheet, range, extraction time, extractor identity;
- support refresh/reconciliation when the source changes;
- refuse or report ambiguous mappings rather than silently guessing.

Importantly, this would not make the product a spreadsheet or BI tool. Formulas and computation would remain in the source system. The product would consume declared values and explain where they came from.

### Why it expands market access

This opens a very large adjacent market: documents that are narrative plus schedules.

Examples include:

- financial reporting packages;
- management reports;
- clinical study data summaries;
- regulatory submission tables;
- operations and quality metrics reports;
- engineering calculation summaries;
- budget, forecast and variance narratives;
- site performance reports.

Many of these workflows currently live in a hybrid world:

- numbers are produced in Excel;
- narrative is written in Word;
- versions are managed manually;
- audit trails are weak;
- reconciliation between the schedule and the report is done by hand.

A governed workbook integration would let the product own the **controlled document** while respecting the fact that the customer’s numbers often start in Excel.

This is especially valuable against Workiva-like or regulated-reporting incumbents. It does not try to replace their spreadsheet workflow entirely; it brings the spreadsheet output under document provenance and controlled publishing.

### How to keep it consistent with the specification

The boundary must remain clear:

- no writing back to the workbook;
- no live formulas in content;
- no dashboards or exploratory analysis;
- no arbitrary cell scripting;
- workbook extraction is a governed artifact, not free-form data entry;
- permission to see source values remains separate from permission to read the document;
- provenance records what the source returned, not merely what was displayed.

This extends the product’s strongest idea—defensible numbers—into one of the most common real-world source formats.

---

## 4. Controlled HTML publication reader / digital distribution

### What to add

The specification already treats PDF and Word as first-class outputs and says HTML should be producible as a reading format. I would promote that into a proper controlled digital publication experience:

- HTML as a declared publication format;
- accessible output on the same terms as other formats;
- identified-link access with expiry and revocation;
- supersession notices when a newer publication exists;
- optional PDF companion where page citations matter;
- responsive layout for desktop/tablet/mobile reading;
- permission-filtered assets and media where allowed;
- no anonymous public URLs unless explicitly declared;
- same publishing pipeline, determinism and accessibility checks as other outputs.

This would not make HTML an editing surface or a website CMS. It would be a controlled reading format for issued documents.

### Why it expands market access

PDF and Word are essential, but file exchange is increasingly awkward for modern review and distribution.

A controlled HTML reader expands access into:

- client portals;
- web-based submission workflows;
- intranet document distribution;
- mobile-first reviewers;
- external recipients who should not receive a permanent file;
- accessibility-focused organizations;
- customers who want a better reading experience than a large PDF;
- future interactive or media-rich controlled documents, if policy allows.

It also improves the recipient experience for one of the product’s strongest existing features: identified publication sharing. Instead of “here is a PDF,” the customer gets “here is a controlled, revocable, supersession-aware reading link.”

That is a meaningful commercial upgrade.

### How to keep it consistent with the specification

The key constraint is that HTML must not become a weaker permission or accessibility surface.

It should inherit the same rules as other publications:

- produced from a baseline;
- immutable once published;
- permissioned and revocable;
- accessible;
- lossy features reported where applicable;
- page citations still anchored to the PDF where pagination is authoritative;
- excluded conditional content absent in all forms, including HTML metadata.

This feature would expand distribution without changing the core publishing model.

---

## 5. Legacy estate migration accelerator / DITA-XML bridge

### What to add

The largest barrier to replacing an incumbent CCMS or a large Word-based document estate is not usually the new editor. It is migration: inventory, mapping, review, validation and cutover.

I would add a productized migration module rather than just generic import:

- estate scanner that inventories existing Word/DITA/XML documents;
- assessment reports showing structure, reuse potential, conditions, references, tables, footnotes, images and unresolved dependencies;
- mapping templates from legacy structures to components, outlines, conditions, terms, citations and assets;
- batch assisted-import queues with a dedicated reviewer workbench;
- model-assisted breakdown proposals governed by the existing AI rules;
- accepted-unchanged metrics so migration quality becomes measurable;
- cutover validation reports comparing source and imported content;
- optional export to standard XML vocabularies where customers require interoperability rather than full platform replacement.

This would not mean becoming a DITA authoring tool. It would mean making it practical to move valuable legacy estates into the new model safely.

### Why it expands market access

This opens the largest existing installed base: organizations that already have controlled documents but are stuck in legacy systems.

It helps against:

- incumbent DITA/XML CCMS tools;
- Madcap/PTC/Arbortext-style technical documentation estates;
- large Word-based regulatory or quality document collections;
- XML-heavy structured content environments where customers do not want to abandon all existing interchange needs.

Migration is often the difference between a pilot and an enterprise rollout. If a customer has four thousand reports, they will not move unless the path is productized, measurable and safe.

This feature also strengthens the anti-lock-in story. The product already says it can export the whole tenant in a self-describing format. A strong migration accelerator makes that promise more credible by showing that the vendor understands how hard content migration really is.

### How to keep it consistent with the specification

The existing assisted-import model should remain central:

- foreign content import remains human-reviewed;
- nothing is silently bulk-created;
- dropped or unrepresentable content is reported;
- source file identity and hash are recorded;
- model-assisted proposals are marked and governed like other AI output;
- mapping decisions are declared, not inferred.

The goal is not to make migration invisible. It is to make it safe, measurable and repeatable.

---

# Supporting feature I would also add if the business model requires scale

## Organization administration, entitlements and usage metering

This is less of an end-user differentiator and more of a commercial/platform enabler, but at hosted scale it matters:

- organization-level grouping of tenants;
- environment management: production, sandbox, validation;
- plan limits and entitlement checks;
- precise usage metering for AI, query execution, storage, publications and search/embedding workloads;
- cost allocation by tenant/user/capability where customers need chargeback or budget control;
- self-service tenant creation/suspension under organization governance.

### Why it matters

Large enterprises often do not buy one tenant. They buy:

- production plus sandbox;
- multiple business units;
- trial environments;
- client-specific tenants;
- validation and audit environments;
- departmental cost centers.

Without organization-level administration and clear metering, the product may be technically attractive but commercially awkward for large accounts.

This would not be my top end-user market-expansion feature, but it would expand access to larger enterprise deals and make multi-tenant commercial packaging viable.

---

# How I would sequence them

If the goal is maximum market access with acceptable risk, I would sequence them roughly like this:

## Phase 1: Make enterprise procurement possible

Add or complete:

1. **Residency/deployment flexibility**
1. **Organization administration and usage metering**, if multi-tenant commercial packaging is needed

These do not create the most exciting demo, but they remove blockers in large regulated deals.

## Phase 2: Expand daily document workflows

Add:

1. **Governed spreadsheet/workbook integration**
1. **Controlled HTML publication reader**

These increase the range of documents and distribution patterns the product can own. They also make the platform more useful day to day, which improves retention and expansion inside existing accounts.

## Phase 3: Unlock legacy estates

Add:

1. **Legacy estate migration accelerator / DITA-XML bridge**

This is often services-heavy at first, but it opens the largest existing content estates. It can start as a productized assessment and assisted-migration offering before becoming a fully self-service capability.

## Phase 4: Open multi-organization workflows

Add:

1. **Federated collaboration workspaces / controlled cross-tenant projects**

This has high strategic value but also high design risk because it touches the tenant boundary. I would pilot it with a narrow, well-understood use case—such as sponsor/CRO or client/vendor review—before generalizing it.

---

# What I would deliberately not add first

To preserve the product’s market position, I would avoid adding these early:

| Tempting addition | Why I would resist it |
| :--- | :--- |
| Real-time character-level co-editing as the default model | It could undermine the deliberate component-lock and review model. If demand is overwhelming, it may deserve a separate optional mode later, but not as the core editing paradigm. |
| BI dashboards or exploratory analysis | That would turn the product into a different category and dilute the controlled-document/provenance story. |
| Prepress/print production | The specification correctly rules this out. Adding it would expand a smaller market at the cost of focus and complexity. |
| Full translation management system | Better to integrate with TMS vendors through XLIFF and terminology controls than to become a TMS. |
| Arbitrary style code or tenant-supplied rendering scripts | That creates injection, security and cross-format consistency risks. Declarative styles are the right boundary. |
| True cross-tenant sharing before federated workspaces are proven | Arbitrary sharing would weaken the tenant-isolation story that much of the product’s trust depends on. | {: col-widths="27,73" }

---

# Bottom line

The new features I would add to expand market access most are:

1. **Residency, deployment flexibility and customer-managed keys**
Removes enterprise procurement blockers and opens regulated/global markets.
1. **Federated collaboration workspaces / controlled cross-tenant projects**
Opens multi-organization regulated documentation workflows without breaking tenant isolation.
1. **Governed spreadsheet/workbook integration**
Brings Excel-based schedules under provenance and opens financial, operational and data-heavy report markets.
1. **Controlled HTML publication reader / digital distribution**
Expands modern reading, client review and web-based distribution while keeping publications controlled and revocable.
1. **Legacy estate migration accelerator / DITA-XML bridge**
Makes it practical to replace incumbent CCMS or large Word/XML estates, which is often the biggest barrier to enterprise adoption.

If I had to narrow it to the three highest-leverage additions, I would choose:

1. **Residency/deployment flexibility**
1. **Governed spreadsheet/workbook integration**
1. **Legacy estate migration accelerator**

Those three expand access into regulated enterprise procurement, adjacent data-heavy reporting workflows and existing legacy content estates respectively. Federated cross-tenant collaboration has the highest strategic upside, but I would introduce it carefully after the single-tenant trust model is fully proven.



