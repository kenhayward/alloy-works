# CT Studio sink

How a document decomposed by CT Studio, and the data tables it extracts, land in Alloy Works
unattended: a second sink for CT Studio's delivery bridge, beside 3ds-sink, but served by the Alloy
Works service itself rather than as a service of its own. Ken's answers of 2026-10-29 shaped it, and
[ADR-0071](../decisions/0071-ct-studio-delivers-straight-in-as-a-service-identity.md) records them.
Built by [the CS plan](../plans/2026-10-29-cs-ct-studio-sink.md); [As CS built it](#as-cs-built-it)
says where the build settled what this design left open.

## The shape in one paragraph

CT Studio never talks to Alloy Works directly: its **delivery bridge** drives every sink through one
contract, the `@kenhayward/bridge-contract` package, and checks each sink with the conformance suite
that package ships. Alloy Works serves that contract under `/bridge` on a tenant's own hostname. Every
request is signed by the bridge's key for this sink, and acts as a **service identity** whose token
the bridge holds as the target's credential, so a delivery can do exactly what that identity's grants
allow and no more. A **decomposed document** becomes one Alloy Works `document` whose outline has a
section per CT Studio section and a `component` per section's text, each referenced at the version
the delivery wrote, with images as `asset` versions, footnotes and table notes as `footnote` nodes,
and properties as metadata values. A **data package** becomes rows in real Postgres tables in a
delivery store apart from the platform's database, which the space reads through an ordinary
`connection` and SQL `queryDefinition`s. A delivery is **all or nothing** (one tenant transaction), is
written **at most once per key** and answers a replay with the first receipt, keeps its identifiers
stable from one delivery to the next, refuses an update whose expected versions have moved on in
Alloy Works, and reads back what it wrote before it says it succeeded. Delivery is
**language-neutral**: content is recorded as `und` until the contract carries a language.

## Requirements owned

| ID          | How it is met                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **API-065** | The bridge contract served under `/bridge`, signed, acting as a service identity; ADR-0071 carves it out         |
| **API-066** | The published conformance suite run in process in the service's tests, and against a running stack               |
| **API-067** | Images checked first, then everything in one tenant transaction; a refusal or failure writes nothing             |
| **API-068** | `bridge_delivery` keyed by the delivery key; a replay answers the stored first receipt                           |
| **API-069** | `update.expected` checked against the latest versions under each artifact's lock; any difference refuses all     |
| **API-070** | Identifiers derived from the document's persistent id and CT Studio's own element ids, the same every delivery   |
| **API-071** | Each version's note and `bridge_delivery` record the source, its hash, the decomposer and the user delivered for |
| **API-072** | Data rows in a delivery store's tenant schema, read through a `connection` and SQL query definitions             |
| **API-073** | What could not be carried listed in the receipt and the delivery record, never dropped silently                  |

It also leans on, without changing: **IMP-N03** (content still passes `parseContentDocument` and
admission), **VER-008** (versions stay insert-only), **IAM-033** (service identities), **API-037**
to **API-039** (version preconditions and the component lock), **DAT-085** (provenance of a result)
and **AST-001** (the asset door).

## Where it lives

- **A Fastify plugin in `apps/service`**, `apps/service/src/bridge/`, mounted at `/bridge` when
  `SINK_BRIDGE_KEYS` is set. It is not a `RouteContract` in `packages/api-contract`: its shapes,
  errors (`{class, code, message, details?}`) and signing are the bridge contract's, not ours, so it
  has its own raw-body parser, error handler and not-found handler, as 3ds-sink's does. It is not a
  privileged internal API (API-N02): nothing of Alloy Works' own uses it, and it can do nothing the
  identity behind its token could not do through `/v1`.
- **The contract is consumed, never copied**: `@kenhayward/bridge-contract` from GitHub Packages,
  pinned to exactly 0.10.0, the version CT Studio has published (3ds-sink is still on 0.9.0),
  through a scoped registry line in `.npmrc` and a `read:packages` token in CI and the image build. Its
  zod schemas, `verifyRequest`, comparison forms and `conformanceSuite` are used as they are.
- **The worker does the slow part**: a delivery is a job, `bridge_deliver`, on the existing Postgres
  queue, so it survives a restart (3ds-sink keeps its jobs in memory and loses them). A job carries
  no content, so the accepted **package is stored in the tenant's object store by its SHA-256**,
  named by `bridge_delivery`, and deleted once the delivery is written or refused; the bridge keeps
  its own copy for its retention period. Tenant erasure reaches it as it reaches any object.
- **Who the job acts as**: at accept, the token is resolved to its service identity and the token's
  id is recorded with the delivery, never the token. The job checks again, as the request would
  have, the identity's grants masked by that token's scopes; a token revoked or expired in between
  refuses the delivery, `credential_rejected`.
- **The mapping is pure** and lives in `packages/domain/src/bridge/`: a decomposed document in, a
  `ContentDocument` per component, an outline and a list of what was not carried out, with no
  database or network. It is tested on its own against CT Studio's wire fixtures.

## The contract as served

`describe` declares **contract version 2**:

| Member              | Value                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | `Alloy Works`                                                                                                                                           |
| `connectionKind`    | `shared`: the target's connection holds the service identity's token                                                                                    |
| `instances`         | One: the tenant the hostname resolves to, `{ id: <tenant slug>, label: <tenant name> }`                                                                 |
| `credentialFields`  | `token`, secret: an `awt_` token issued to a service identity                                                                                           |
| `destinationFields` | `space` (fixed, required, browse); `documentName` (pattern, optional, overridable); `tableSet` (pattern, optional)                                      |
| `capabilities`      | `browse`, `replace`, `readBack` true; `withdraw` false; `accepts` files, data, document, images; `decomposedDocuments` with equations `mathml`, `image` |

- **One registration per tenant.** The bridge's `BRIDGE_SINKS` entry for a tenant names that
  tenant's hostname, for example `https://acme.alloy.example/bridge`, because Alloy Works resolves the
  tenant from the hostname (ADR-0020). A second tenant is a second sink id with its own key.
- **Signing**: the bridge's HMAC over method, path, timestamp, nonce and body hash, with the path
  **relative to `/bridge`** (`/describe`, not `/bridge/describe`), as the bridge's `HttpSink` and the
  conformance suite sign it. This settles the ambiguity 3ds-sink leaves open by accepting both. The
  keys are a comma-separated `SINK_BRIDGE_KEYS`, so a key can be rotated. `verifyRequest` checks
  the signature and window with a store that admits every nonce, since its store is synchronous;
  the nonce is then inserted into a platform table under a unique constraint, and a conflict is the
  replay refusal (`credential_rejected`, `details.reason: "replayed"`). Rows older than 600
  seconds are swept: twice the window, since a timestamp is taken up to 300 seconds either way. Two service replicas therefore cannot both accept one nonce.
- **The credential is checked on every call**: the `token` must be a live token of a service
  identity in this tenant; a person's token is refused, `credential_rejected`. It is never stored or
  logged; the connection holding it lives on the bridge.
- **`connections:test`** answers `{ ok: true, identity: "<service identity> on <tenant>" }`.
- **`browse`** answers the spaces the identity holds `create` in, for the `space` field only.
- **`deliveries`** checks the instance, credential and destination, starts the job and answers
  `pending` with the job's id; `GET /deliveries/{id}` answers from the job and `bridge_delivery`.
  Since jobs are durable, an unknown id is a real `not_found`, never the `sink_unavailable` 3ds-sink
  needs after a restart.
- **`files`** is accepted and not written, as 3ds-sink does, because conformance demands a sink take
  `files` with `data`. `rdf` and the version 3 administration calls are not offered: Alloy Works
  administers its own service identities.
- **`tableSet` is optional**, since one target takes both families and the contract has no default
  for a field. A data package whose `tableSet` is absent or empty uses its provenance's recipe id.

## A decomposed document

### What is made

| CT Studio                           | Alloy Works                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The document                        | A `document` in the target's space; its artifact id is the **persistent id** CT Studio keeps                                                                                                |
| Its title                           | `documentName` when resolved, else the source file's stem                                                                                                                                   |
| Leading `blocks`                    | A lead component, referenced first                                                                                                                                                          |
| Each section                        | An outline `section` node with its title, `matter: body`, `numbered: false`: CT Studio sends no number, and a title keeps any number the source wrote into it, which numbering would double |
| A section with an empty title       | Titled with the first words of its first paragraph, else `Section <n>` by its position; reported                                                                                            |
| A section's own `blocks`            | One component, referenced as the section's first child, titled with the section's title as plain text; nested sections follow it                                                            |
| A section with no blocks of its own | The section node alone, with no component                                                                                                                                                   |
| Images                              | `asset` versions in the same space, by the asset door; figures and inline images pin the asset **version**                                                                                  |
| `properties`                        | Metadata values ([Metadata](#metadata))                                                                                                                                                     |
| `report` flags                      | Kept in `bridge_delivery`, not in the content                                                                                                                                               |
| Provenance                          | Each version's note and `bridge_delivery` ([Provenance](#provenance))                                                                                                                       |

- **References are pinned** to the version this delivery wrote, so a document version is exactly
  what was delivered and its read-back is exact. A person in Alloy Works moves a reference to latest
  when they choose to.
- **Components take the target's component type** ([Metadata](#metadata)), the starter type when
  none is set.
- **Language-neutral**: every `ContentDocument` and the outline record `language: "und"`, which the
  language tag schema already admits, and `direction: "ltr"`. Ken, 2026-10-29: language stays out of
  this design until the contract carries one.

### Blocks and inlines

| CT Studio                                                    | Alloy Works                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`                                                  | `paragraph`, style `body`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `list`                                                       | `list`, ordered or unordered, its items' blocks carried                                                                                                                                                                                                                                                                                                                                                                                                          |
| `table`                                                      | `table`: caption, `headerRows`, cells with `colspan` and `rowspan`, `numbered`; `wide` as `rotate`                                                                                                                                                                                                                                                                                                                                                               |
| A cell marked `header` outside the header rows               | `headerColumns` when every such cell is a leading column; otherwise an ordinary cell, reported                                                                                                                                                                                                                                                                                                                                                                   |
| `columnWidths`, `hAlign`, `vAlign`, `captionPosition`        | Not carried: they are presentation, which a theme owns here (CNT-094); reported                                                                                                                                                                                                                                                                                                                                                                                  |
| Table `notes`                                                | A `footnote` anchored to the cell whose superscript marker names it; when no cell, or more than one, names it, plain text in the table's `note` (marker, a space, the words), reported                                                                                                                                                                                                                                                                           |
| `figure`, `image`                                            | `figure` pinning the asset version, its caption and alternative                                                                                                                                                                                                                                                                                                                                                                                                  |
| `equation` with MathML                                       | `equation` with `mathml`, `latex` kept when sent, `numbered`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `equation` that is an image only                             | A `figure` of that image, its alternative the equation's text where CT Studio has one; reported                                                                                                                                                                                                                                                                                                                                                                  |
| `figure`, `image`, `equation` or `table` in a table cell     | The model allows only paragraphs and lists in a cell, so each becomes paragraphs rather than a refusal: an image or figure a paragraph of its caption (if any) and an inline image; an equation a paragraph with an inline equation; a table, flattened, its caption (if any), then one paragraph per cell in row then column order, then each note as `marker: words`, reported `table_flattened`. The cell's text is the same, unit by unit, as CT Studio sent |
| `text` marks bold, italic, underline, superscript, subscript | `strong`, `emphasis`, `underline`, `superscript`, `subscript`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `note_ref`                                                   | An inline `footnote` holding the note's content as paragraphs; anything else in a note is flattened to its text, reported                                                                                                                                                                                                                                                                                                                                        |
| `xref`                                                       | A `crossReference` to the block or outline node it names, `display: number`; one to an element outside the document becomes its text, reported; one to a block the mapping dropped or flattened takes its section's node                                                                                                                                                                                                                                         |
| `link`                                                       | A `hyperlink` mark for `http`, `https` and `mailto`; any other scheme kept as text, reported                                                                                                                                                                                                                                                                                                                                                                     |
| `inline_equation`                                            | An inline `equation` with MathML; an image-only one an inline `image`                                                                                                                                                                                                                                                                                                                                                                                            |
| `inline_image`                                               | An inline `image`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `break`                                                      | Splits the paragraph in two, since the model has no line break; in a title or caption a space                                                                                                                                                                                                                                                                                                                                                                    |

- **The note markers are matched as 3ds-sink and CT Studio's readers match them**: a superscript run
  whose parts, split on whitespace, commas, semicolons, parentheses and brackets, are all markers of
  the table's notes (`1)`, `1)2)`, `1,2`, `a`). A run with any other part stays text. Two notes with
  one marker refuse the delivery, `content_rejected`, before anything is written. Unlike 3ds-sink, a
  note whose marker is in no cell is **not refused**: it is carried as plain text in the table's own
  `note` (the marker, a space, the note's words; several are run on in order) and reported. The same
  goes for a note named in more than one cell. A `footnote` anchored to the table is not used, since
  publishing refuses one. The markers of a note anchored to one cell are removed from the cell text,
  since a theme draws a footnote's callout; the markers of a note carried in the table's `note` stay in
  the cells as written, so a reader can match them.
- **Everything is held to the model by `parseContentDocument` and `parseOutlineDocument`**
  (IMP-N03). `admit()` is not used: it always runs `reidentify`, and identifiers here are derived
  ([Identifiers](#identifiers)). The mapping builds model nodes directly, so the sanitising admission
  would do is the mapping's: every string NFC, control characters dropped, link schemes allowlisted,
  MathML read by the model's own strict reader. A refusal by the model is a `content_rejected` naming
  the element, never a partial write.

### Images

- **Checked in the worker, recorded in the transaction**, as an accepted import's images are: each
  image is decoded whole by the worker's `checkImage`, then, inside the delivery's transaction, held,
  stored by hash and recorded as an asset version (`holdObject`, `createAssetUpload`,
  `receiveAssetBytes` unqueued, `recordAsset`), with no `ingest` job to wait for. One image refused
  refuses the delivery, `content_rejected` naming the image, and nothing is written.
- **Reused by hash**: an image whose bytes an asset in the target space already holds at its latest
  version reuses that asset version, found by its object key, since the door itself makes a new
  asset each time.
- **SVG**, which the asset door does not admit, is rasterised to PNG in the worker by `sharp`
  (already the worker's) at 300 dpi for the width CT Studio gives (`widthMm`), and that PNG is what
  is checked and recorded. The original SVG is kept by its hash in the tenant's object store and
  named in `bridge_delivery`, so a later decision to admit SVG as an asset can recover it.
- **Alternative text**: CT Studio's `alt` becomes `{ kind: "own" }`; an image with none is
  `{ kind: "inherited" }` and reported.

### Identifiers

The model wants 26-character base32 identifiers for blocks and nodes and UUIDs for artifacts;
CT Studio's are deterministic paths. Both are derived the same way every time:

- **A component's artifact id** is a name-based UUID (version 5) over the document's persistent id
  and the CT Studio section id (`~lead` for the lead component), so the same section in a later
  delivery finds the same component.
- **A block, footnote, node or mark id** is the first 16 bytes of SHA-256 over
  `ct-studio`, the owning artifact id and the CT Studio element id, as base32.
- **`bridge_element`** records each CT Studio element id against the Alloy Works id it became, for
  the receipt's `element` and for an update's look-ups.

### Versions, updates and the receipt

- **Create** (no `update`): a new document and its components, each a first version `0.1` by the
  service identity, and a document version pinning them, in one transaction.
- **Update** (`update: { persistentId, expected }`): every artifact named is locked in id order, and
  each expected `{ kind, id, version }` is compared with the artifact's latest version. **Any
  difference refuses the whole update, changing nothing**: `changed_in_target`, its details built
  with the contract's `changedInTargetDetails`. A component locked by a person is refused,
  `content_rejected` with `details.reason: "component_locked"` naming it and its holder (API-039):
  the contract's own `locked` means an entry in a sink's configuration, so it is not borrowed. A document that no longer exists is `not_found` with the contract's
  `documentMissing` marker. Then each component records a version through `recordVersion`; one whose
  digest has not changed is `version.unchanged` and keeps its version. A new section makes a new
  component; a section CT Studio no longer sends leaves the outline, and its component stays, unretired.
- **Revisions and workflow are untouched**: a delivery records versions only. Promoting one to a
  revision is a person's act in Alloy Works.
- **The receipt** lists the document (`kind: document`, its version id, `url` its page), each
  component (`kind: component`, its version id, `element` the CT Studio section id) and each asset
  (`kind: asset`). The document entry is what CT Studio links to.
- **`receipt.document.components` holds all three**: the document (`kind: map`, so CT Studio's
  `linkOf` finds it, `element` null), every component and every asset, each at the version this
  delivery left it at. CT Studio sends that list back as `update.expected`, so **any edit in Alloy
  Works since** - to a component, to the outline, or a new version of an image - refuses the next
  update rather than being overwritten. This is how 3ds-sink treats its map, and the register's
  `changed` state then shows CT Studio's person what happened.
- **Read-back**: after the transaction, the service reads the stored versions, projects them to the
  contract's comparison forms (`textForm`, `gridForms`) and compares them with the package's.
  `readBack.ok` is false, with the first difference in `detail`, when they differ, which can only
  mean a mapping defect. A table flattened into a cell (`table_flattened`) is compared through the
  outer cell's text, which holds its words; its own grid has no counterpart in Alloy Works and is
  left out of the comparison, and the report names it.

### Idempotency and atomicity

- **`bridge_delivery`** (tenant schema): the delivery key, the target space, the state (`running`,
  `written`, `refused`), the token and the service identity it was asked with, the receipt, the
  report and the provenance. Its key is unique; a delivery
  with a key already `written` answers that first receipt and writes nothing (API-068), and one
  already `running` answers the same job.
- **No part-way state**: images are checked first, then everything, images' assets included, is one
  `withTenant` transaction. A failure rolls it back and clears the key, so a retry is a fresh attempt and
  `delivery_part_way` never arises. This is the main thing Postgres buys over 3ds-sink, whose writes
  span many platform calls.
- **Limits**: a body up to 100 MiB, above CT Studio's 50 MiB default; the document limits
  `parseContentDocument` already sets (depth 128); a component per section, so no one component
  carries a whole long document.

## Metadata

CT Studio sends a document's `properties` as `{ name, value, origin }` pairs; Alloy Works holds
typed metadata against definitions. Nothing is created on the fly:

- **A space's bridge settings** say, per target space, which component type delivered components
  take, which template delivered documents are made from, and which of that template's document
  fields each property name fills. A document's fields come only from its template here, so with no
  template set every property is unmapped. An administrator edits the settings through a route; a
  page comes later.
- **A mapped property is converted to its field's data type**: text as is, number as a canonical
  decimal, date, time and date-time from ISO 8601, boolean from `true`/`false`/`yes`/`no`. One that
  does not convert is left unset and reported; it does not refuse the delivery.
- **An unmapped property is not lost**: it is kept with the provenance in `bridge_delivery`.
- **`user` fields are never filled** from a property: a name in a file is not a principal.

## Data tables

3ds-sink writes CT Studio's extracted `data` as CSV files that the other sink's data platform loads
for querying. Alloy Works has no such platform; its equivalent is an SQL query definition over a Postgres
connection (DAT). So a data package becomes **rows in real Postgres tables** (Ken, 2026-10-29), read
the way any source is read.

- **A delivery store apart from the platform**: a Postgres database of its own, `delivered`, on a
  server the connector can reach on its own network. It is not the platform's database because the
  connector has no route to the platform, by design ([Data](data.md#the-connector)), and a query
  definition is run by the connector.
- **A schema per tenant**, `t_<tenant>`, written by one role the service holds and read by one
  read-only role per tenant. From then on the tables are a source like any other, and a
  `queryDefinition` with an SQL fetch reads them.
- **Provisioned when an administrator turns delivery on for a space** through the bridge settings
  route: the service, connecting to `delivered` as its owner role (`SECRET_DELIVERED_URL`), creates
  the tenant's schema and read role if they do not exist, generates the read role's password, and
  makes the space's `connection` with that credential sealed by the connector (`seal`), as a
  connection's credential always is. No person sees the password. Turning delivery on for a second space reuses the schema and makes
  that space's own connection.
- **TLS, as every Postgres connection needs** (no `disable`): `delivered-postgres` serves a
  certificate the connector trusts, the deployment's own in production and the snakeoil one in
  development, as `source-postgres` does. The service also connects with TLS.
- **One table per CT Studio table**, `<tableSet>_<table id>`, both made safe as Postgres identifiers
  (lower case, `[a-z0-9_]`, at most 63 bytes), and `<tableSet>_fields` for the package's fields
  (`id`, `title`, `type`, `value`, `unit`). Two tables that become one name refuse the delivery,
  `name_conflict` with `details.field: "tableSet"`.
- **Columns** take CT Studio's column ids, made safe, typed from its column type: number as
  `numeric`, integer as `bigint`, date as `date`, date-time as `timestamptz`, boolean as `boolean`,
  anything else `text`. Every table also carries the provenance columns 3ds-sink writes:
  `ct_source_sha256`, `ct_source_filename`, `ct_job_id`, `ct_recipe_id`, `ct_recipe_version`,
  `ct_approved_by`, `ct_published_at`, `ct_row`. A CT Studio column whose id starts `ct_` is refused.
- **Replace by source and recipe**: in one transaction the rows with this source hash and recipe id
  (any recipe version) are deleted and the package's rows inserted, so a later recipe version
  replaces the earlier one and other sources' rows stay. This is the `replace` capability for data.
- **The tables follow the recipe**: a new column is added; a column the package no longer has is
  kept, null in new rows; a column whose type changes is refused, `content_rejected` naming it,
  because changing a column under queries that read it is a person's decision.
- **The receipt** lists each table written (`kind: table`, `id` the qualified name, no `url`).
- **The bridge settings name the delivery store's connection** for the space, so a delivery to a
  space with none is refused, `content_rejected` with `details.reason: "not_configured"`, before
  anything is written.

## Provenance

- **On each version**, its note, of the form
  `Delivered by CT Studio from <source file> (<decomposer version>) for <acting user>`. The author is
  the service identity; Alloy Works does not backdate authorship, and the person CT Studio delivered
  for is not a principal here.
- **In `bridge_delivery`**: the source hash and file name, the source key, the batch, the decomposer
  version, `startedBy`, `decomposedAt`, `publishedAt`, the acting user, the delivery key, the
  report flags and unmapped properties, and what was not carried.
- **Audit**: one `bridge.delivered` or `bridge.refused` event per delivery, as the service identity,
  naming the document or tables, so a webhook subscriber can follow deliveries.

## Errors

The contract's version 2 codes, with their classes, and none of the version 3 administration codes
(`locked`, `forbidden`, `not_configured`), whose meanings are a sink's configuration's (the
`not_configured` below is a `content_rejected` reason, never that code): an unknown
hostname or tenant `instance_not_allowed`; a bad, expired or person's token, or an identity without
`create` and `edit` in the space, `credential_rejected` (CT Studio then points its person at the
connection); the space gone `not_found`; a model or mapping refusal, a person's lock or a space not
set up for delivery `content_rejected` with a `details.reason`; moved versions `changed_in_target`;
the delivery store or object store down `sink_unavailable`. `needs_user` answers 422 and `retryable` 503.
Anything unexpected is `internal` with a fixed message; a credential, token or SQL never appears in an
error.

The `content_rejected` reasons, each answered before anything is written:

- `component_deleted` - a component the delivery writes was deleted in Alloy Works; it stays deleted.
- `component_type_missing` - the space's component type is not in this environment.
- `template_unresolved` - the space's template cannot be resolved, or declares a parameter a delivery cannot give.
- `mapping_refused` - the package holds something the mapping cannot map.
- `content_invalid` - a component's content as mapped is refused by the content model.
- `outline_invalid` - the outline as mapped is refused by the outline model.
- `metadata_incomplete` - the document's values fail its template's rules, or a required field has none.
- `component_locked` - a person holds a lock on a component the delivery writes (API-039).
- `document_in_another_space` - an update names a document that is in another space than the delivery is for; a document gone is `not_found` with the contract's `documentMissing` marker instead.
- `not_configured` - a space with no bridge settings, for a document or a data package, or a data package for a space whose settings name no delivery store (or a worker given none).
- `invalid_request` - the request is not the contract's shape, its body not JSON, or its destination names no space; or a package whose provenance is not its family's (a document's decomposition, a data package's extraction).
- `image_refused` - an image does not pass the check an upload is held to, an SVG cannot be drawn, or the document does not describe it; `details.image` names it.
- `name_conflict` - two of a data package's tables, or two columns of one, become one name; `details.field` is `tableSet`.
- `reserved_column` - a data package's column id starts `ct_`, which the provenance columns take.
- `type_changed` - a column of a delivered table would change type; `details.table` and `details.column` name it.
- `value_invalid` - a value its column's type cannot hold; `details.table`, `details.column` and `details.row` (1-based, as `ct_row`) name it.
- `too_large` - the request body is over the 100 MiB limit.
- `key_reused` - the idempotency key names a delivery to another space, or by another service identity; it never answers that delivery's receipt.

## Deployment

- **The service** mounts `/bridge` when `SINK_BRIDGE_KEYS` is set; nothing is published that is not
  already, since `/bridge` is on the service's own port.
- **The delivery store** is a Postgres service in `deploy/compose.yaml`, `delivered-postgres`, on
  `connector-egress` (where the connector reaches `source-postgres`) and `delivered`, a network of its
  own shared with the service and worker alone, with its own volume and certificate. A deployment whose `CONNECTOR_DENY` refuses private addresses must
  allow this one.
- **Who may sign in to the delivery store** is held by its pg_hba, written on every start by
  `deploy/delivered/start.sh`: from anywhere, only members of the group role `delivered_readers`
  (each tenant's read role joins it when it is provisioned) to the database `delivered`, over TLS,
  with a password; the owner only from the `delivered` network, whose subnet compose fixes
  (`DELIVERED_SUBNET`, `10.213.71.0/24` by default); everything else is rejected. The connector is
  not on `delivered`, so it can never sign in as the owner, whatever password it is given.
- **CT Studio's side** needs no code: an entry in the bridge's `BRIDGE_SINKS` per tenant, a shared
  connection holding the service identity's token, and a target naming the space. The bridge must
  reach the tenant's hostname.

## Verification

- **Conformance**: the contract's `conformanceSuite` run in process against the plugin in the
  service's tests, all checks including the seven document ones, as 3ds-sink does; and once,
  before merge, from CT Studio's `ct-bridge-conformance` image against a throwaway stack built from
  this branch's compose file (Ruling 32), not the staging stack. A run against staging is the
  owner's to make, since that stack runs from another checkout with its own configuration.
- **The mapping**: CT Studio's published fixtures, and the decomposed fixtures, through
  `packages/domain/src/bridge/` to stored shapes; each row of the tables above a test citing its
  requirement.
- **Atomicity and idempotency**: a failure injected after the first component refuses the delivery
  with nothing written; a replayed key answers the first receipt after an update.
- **Data**: a delivery read back through a connection and an SQL query definition by the connector.
- **Cross-tenant**: one tenant's key, token or hostname never reaches another's documents or tables.

## As CS built it

What the build settled where this design left a choice, or changed what it said. Each is how the
system behaves now.

### Documents

- **A table's notes.** A note whose superscript marker is in exactly one cell is a `footnote`
  anchored to that cell, and its marker is removed from the cell's text. A note whose marker is in no
  cell, or in several, is plain text in the table's `note` (the marker, a space, the words, several
  run on in order), reported, and its markers stay in the cells as written so a reader can match
  them. A footnote anchored to the table itself is never made, because publishing refuses one.
- **What a cell cannot hold is converted, not refused.** CT Studio's own decomposed fixture puts
  images, equations and a table in cells, and conformance requires it to be delivered. An image or
  figure becomes a paragraph of its caption then an inline image; a block equation an inline
  equation; a quotation or preformatted block a paragraph; a table in a cell is flattened to
  paragraphs (caption, one per cell in grid order, each note as `marker: words`) and reported
  `table_flattened`.
- **Read-back is honest.** It compares text forms in full and leaves out the grid of a table
  flattened into a cell, naming it in the report. A mapping that loses words - a note referenced by
  no marker, a flattened note's content, a marker repeated in one cell - reports `readBack.ok`
  false rather than the comparison being loosened, so CT Studio shows a warning on that document.
- **A cross-reference to a block the mapping dropped or flattened** targets that block's component,
  or its section's node, never a missing id. A lead with no blocks of its own makes the reference
  fall back to its text, reported `xref_outside`.
- **The delivered outline is CT Studio's structure alone.** A template's starting sections and
  required components are not added to it, so a template rule can be unmet on a delivered document.
- **The template governs the metadata.** The document is made through the space's template, bound as
  `createDocument` binds it, with the identifier CT Studio's persistent id gives. A required field
  left without a value refuses the delivery, `content_rejected` reason `metadata_incomplete`; a
  template with a parameter that has no default refuses every delivery, `template_unresolved`, since
  a delivery has no one to ask. A property value that does not convert, or is only white space,
  leaves its field unset and is reported `property_unconverted`; a property no field takes is kept
  with the provenance in `bridge_delivery`.
- **`bridge_element` holds the lead, the sections and the images.** A block's identifier is derived
  and needs no record.
- **A column type CT Studio names that is not known is `text`**; the contract keeps the type an open
  string. `ct_approved_by` is the approver's name.
- **An update compares more than it was told.** The document's map, and a component the delivery
  derives that is in the target, are compared even when they are not among `expected`: each is held
  to the version its last delivery left it at (by `bridge_delivery`'s receipts alone), and if a
  person changed it since, the update is refused, `changed_in_target`, rather than overwriting it.
  A document no CT Studio delivery wrote has no such version, so an update to it is refused
  `changed_in_target` before anything is written.
- **A document in another space is not gone.** An update naming a document that exists in another
  space is refused `content_rejected` reason `document_in_another_space`; `documentMissing` stays for
  a document that is no longer in Alloy Works, which CT Studio answers by forgetting the link.
- **Grants are checked by the job.** At run time, for the token's identity in the space, the job
  requires `create` for every delivery, and `create` and `edit` both for one with `update`, document
  or data alike, as the route does at accept, before anything is written. A grant removed since the
  delivery was accepted refuses it, `credential_rejected`, as does a token revoked or expired in
  between; a space archived or no longer readable answers `not_found`.
- **A last attempt that found a store down is `sink_unavailable`.** When the object store, the
  platform database or the delivery store is out of reach on the job's last attempt, the delivery is
  refused `sink_unavailable` (retryable), as the route answers; anything else unexpected is
  `internal`.
- **Images.** An SVG original the delivery keeps is held against release like any referenced
  object: `objectInUse` counts it, so a release elsewhere cannot delete bytes the delivery says it
  kept. Finding the originals in use is by a GIN index on `bridge_delivery.provenance`. An SVG
  that cannot be drawn refuses the delivery.

### The service

- **The instance** `describe` answers is `{ id: <tenant slug>, label: <tenant name> }`, the
  platform tenant's readable id and its display name.
- **The body limit** is 100 MiB on the route itself, over the default; a larger body answers
  `too_large`. A store or database that is down answers `sink_unavailable` (503), not `internal`.
- **A reused key is refused.** An idempotency key already used for another space, or by another
  service identity, refuses `content_rejected` with reason `key_reused`; it never answers that
  delivery's receipt. The identity is the one `bridge_delivery` recorded at accept
  (`principal_id`), so the same identity under a rotated token, the first revoked and gone, gets its
  first answer.
- **A package with neither document nor data** (files or images only) is accepted and written as
  nothing, its receipt empty, as `files` are; it is never `not_configured`.
- **`not_configured` is for both families.** A document delivery to a space with no bridge
  settings is refused too, since it has no component type or template to write with; and so is a
  data package to a space whose settings name no delivery store (or to a worker given none).
- **Webhooks and audit.** `bridge.delivered` and `bridge.refused` are webhook event types. A
  webhook's readability check needs an artifact or a space, so `bridge.refused` takes the space as
  its subject, and `bridge.delivered` the document for a document delivery and the space for data.
  `bridge.settings_changed` is audit only. The job queue sweeps the nonce table, and the runtime
  role cannot delete or truncate `bridge_delivery`.
- **Browse** reads at most 20 pages of spaces a call.

### Data

- **A person's data is not an internal error.** A value its column's type cannot hold refuses the
  delivery, `content_rejected` reason `value_invalid` naming the table, column and row (1-based, as
  `ct_row`) and rolling the transaction back; an empty value is null in every column but text.
- **A table the recipe no longer produces keeps its old rows.** A replace acts on the tables a
  package names; removing tables under a person's queries is theirs to decide.
- **Names.** A table or column name that would begin with a digit takes a leading `_`; a tenant name
  that had to be cleaned gets a hash suffix, and provisioning returns the names it made. A
  column-level `name_conflict` also answers `details.field: tableSet`, the one thing the person can
  change.
- **Provisioning and the password.** Turning data on provisions only when the space has no delivery
  connection or its schema is not yet recorded; a settings change that touches only the mapping
  rotates nothing. When it does rotate, the service chooses the tenant role's password, seals it for
  every delivery connection of the tenant, writes them in the tenant transaction and sets the role's
  password last, so a seal that fails changes nothing. Turning data off clears the schema and keeps
  the connection and the tables. One advisory lock serialises provisioning, and `connect` is revoked
  from `PUBLIC` on the delivered database.
- **The host check.** A delivery connection is reused or resealed only while its source settings
  (host, port, database, TLS, account) equal the delivery store's own. One that was edited is never
  resealed - it loses access - and the space gets a new connection, so an administrator who points
  a connection at a server of their own is never handed the tenant's read password.
- **The public schema** is untouched (Postgres 17 gives `PUBLIC` no create there).
- **Deployment.** The delivery store is the platform's own pgvector Postgres 17 image, pinned by
  digest; the contract package installs from GitHub Packages through a build secret. Its pg_hba
  admits only `delivered_readers` from anywhere and the owner only from the `delivered` subnet
  (Deployment, above); provisioning makes the group, `NOLOGIN`, if it is absent and grants it to
  each tenant's read role.

## Decisions

### Ken's answers, 2026-10-29

- Deliveries land straight in as content, overriding API-N05 and IMP-003 for this integration.
- The sink lives inside Alloy Works, with the same capabilities through the contract as 3ds-sink.
- Data tables are real Postgres tables queried with SQL, not datasets.
- Delivery is language-neutral for now.
- Accepted as proposed: stable identifiers derived across deliveries, and SVG rasterised to PNG with
  the original kept.

### Settled while writing, for Ken to check

- One sink registration per tenant hostname, a shared connection holding a service identity's
  token, the signed path relative to `/bridge`.
- One component per section's own text, sections `numbered: false`, references pinned.
- The receipt's components include the document and its assets, so any edit in Alloy Works refuses
  the next update.
- Table notes whose marker is in no cell carried in the table's own `note`, not refused (a
  table-anchored footnote cannot be published).
- Properties fill metadata only through an administrator's mapping; unconvertible values reported,
  not refused.
- The delivery store provisioned by the service when delivery is turned on for a space, its read
  credential sealed in a connection no person sees.
- Only version 2 error codes; a person's lock and an unconfigured space are `content_rejected` with a
  reason, missing grants `credential_rejected`.
- `tableSet` defaults to the recipe id; empty section titles take their first words.
- Tranche T6 for API-065 to API-073.

## Ruled out

- **A separate service, as 3ds-sink is**: everything it would write is Alloy Works' own content, and
  a separate process would need a privileged path in (API-N02) or a long chain of `/v1` calls with no
  transaction around them.
- **A proposal a person accepts** (IMP-003's import): Ken, 2026-10-29, deliveries land straight in.
  CT Studio's own review is the attended step.
- **Datasets for data tables**: a dataset is a stored result with no SQL over it; Ken wants SQL over
  real tables (2026-10-29).
- **Tables in the platform's database**: the connector cannot reach it, and should not.
- **New ids each delivery** (admission's `reidentify`): every update would rewrite every block.

## Open questions

- **Language**: when the contract carries a document language, components take it instead of `und`.
- **Withdrawing**: the contract defines no withdraw call, and the bridge forces `withdraw` off for
  external sinks, so a delivered document stays until a person in Alloy Works removes it.
- **SVG as an asset**: whether the asset door admits SVG, which would let a figure hold the original.
- **Cross-document references**: an `xref` to another delivered document becomes text for now.
