# Definitions and values

How fields, metadata schemas and component types are made and changed, and how the values they
describe are written, shown while an author works and held at publication.

This is the definitions-management service [metadata.md](metadata.md) defers to, and the T1 half of
the values an author writes. What a field, a schema and a component type are, how fields resolve and
what makes a value valid are [metadata.md](metadata.md)'s, reused rather than restated; how a
component's values travel with its iterations and what its metadata panel looks like is
[component-editor.md](component-editor.md)'s ("Metadata alongside"); a document's and a section's
fields come from its template, [templates.md](templates.md)'s; who may manage definitions is
[access.md](access.md)'s (MET-024, `manage_definitions`); and a definition is versioned by
[storage-and-versioning.md](storage-and-versioning.md)'s one mechanism.

## The shape in one paragraph

Definitions are made and changed through the API by whoever holds `manage_definitions` in the
tenant. Every change is a version, cut by `recordVersion` like any artifact's. Before one is cut it is
checked against everything that uses it: a **name** taken by another definition of its kind is
refused; a **component type** assigning a schema whose default disagrees with another's is refused; a
**schema** version whose default would disagree with a schema applied beside it, at any component type
or template that assigns both, is refused naming every such place; and a **field** version that would
make any schema's default for it invalid is refused naming each. **Values** are written with the
artifact they belong to - a component's with its iterations, a document's and a section's through the
routes [templates.md](templates.md) gave them - and the service refuses only what cannot be stored
honestly. Everything else is saved and **shown as it arises**: the metadata panel beside a component,
and the fields of a document and of the selected section on the document's page, validate on every
change with the same `validate` publication uses. **Publication fails** where a component version the
document references is missing a required field or holds an invalid value.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MET-041** | A field, a schema and a component type are each made at 0.1 by `createArtifact` and changed only by `recordVersion` from the version the caller opened; no route changes a stored version, and the chain's grant refuses it anyway                                                                                                                                                              |
| **MET-031** | `definition_name` holds one row per definition: its kind and its name folded for comparison, unique per kind; making one and renaming one write it in the same transaction, and a name taken is refused, `definition_name_taken`, naming the definition that holds it                                                                                                                           |
| **MET-008** | A component type's version is refused where two schemas it assigns disagree about a field's default, `assignment_conflict`, naming the field and both schemas, by `checkAssignment`; a template's is refused the same way already, by `resolveTemplate`'s `conflict` ([templates.md](templates.md))                                                                                             |
| **MET-040** | An assignment names a schema and never a version of it, so it always takes the latest. A schema's next version is refused where its default for a field would differ from that of a schema applied beside it at any place - every component type and every template level assigning both, at their latest versions - `schema_conflict`, naming the field, the other schema and every such place |
| **MET-037** | A field's next version is refused where it would make any schema's default for it invalid - every schema grouping the field, at its latest version, checked by `checkSchema` against the candidate field - `field_breaks_default`, naming the field, each schema and its default                                                                                                                |
| **MET-021** | The metadata panel beside a component, and the fields of a document and of the selected section on the document's page, run `validate` on every change against the fields that apply there, each failure shown beside its field and announced, and none of it blocks a save                                                                                                                     |
| **MET-023** | A publication request validates every component version it resolves against the definition versions that version recorded (MET-017), and each failure is recorded against its node as the request's own, `component_metadata_invalid`, so the publication fails naming the component and the field. Cutting a version validates nothing                                                         |

MET-023's second sentence also says designating a revision may not be refused for a value. Nothing in
T1 designates a revision yet ([storage-and-versioning.md](storage-and-versioning.md) designs it, and it
is not built), so that half is met by nothing refusing it; the day designation is built, it runs no
validation, and this claim is the reason.

## What this document does not own

| Left unclaimed | Why                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MET-033        | [component-editor.md](component-editor.md) claims it: a fixed field read-only in the panel, and an iteration or a cut holding another value refused. Built here, under that claim                                               |
| MET-038        | [metadata.md](metadata.md) claims it: `checkUserValues` on every iteration, refusing `metadata.user`. Built here, under that claim                                                                                              |
| MET-024        | [access.md](access.md) claims it; every route below asks for `manage_definitions` at the tenant                                                                                                                                 |
| MET-025 to 027 | Not T1: where-used counts, deleting and deprecating a definition. The places MET-040 names are found by a query over component types and templates, not by where-used                                                           |
| MET-039        | Not T1: a departed user's value shown as no longer active is [component-editor.md](component-editor.md)'s for a component; the panels here show a user by name, and one no longer active is marked, as the component panel does |

## Managing definitions

### Who, and where

Making and changing a definition asks `manage_definitions` at the tenant (MET-024; the Definitions
manager role holds it): a definition lives in no space, so there is no space to decide on. Reading one
follows [access.md](access.md)'s rule: reading a definition on its own is `read` asked of the definition,
whose chain is itself and the tenant, and listing them is `read` asked of the tenant. Reading a
definition to write a value against it stays access.md's "read through what uses it": an author sees the
fields their component, document or section needs through that artifact's own decision, never through
these routes.

### Making and changing

A body carries the kind and the definition's payload without its `id`: the service allocates one, a UUID,
so a caller cannot choose another definition's identifier. A change carries `openedFrom` and the whole
next payload, with no `id` either, and is refused `version_precondition` when the definition has moved
on (API-037), or answered unchanged when it says nothing new, as a template's is. Every payload is read by
the kind's own schema first (`fieldDefinitionSchema`, `metadataSchemaDefinitionSchema`,
`componentTypeDefinitionSchema`): a payload that does not read is `invalid_request`.

Then, in this order, in the one transaction, and nothing is written unless all pass:

1. **What it names exists** (`definition_unresolved`). A schema's every entry names a field; a component
   type's every assignment names a schema, and every `requires` a field that schema groups
   (`checkAssignment`'s `requires` rule). Each missing one is named.
2. **Its own defaults are valid** (`definition_invalid`): a schema's defaults each pass their field, by
   `checkSchema` - the rule a schema already states and nothing yet enforced on write.
3. **Its name is free** (MET-031, below).
4. **The kind's own check against its places** - an assignment's conflicts for a component type
   (MET-008), a schema's places for a schema (MET-040), a field's schemas for a field (MET-037).

Every failure is named in MET-022's shape, and every refusal carries all of them, never the first.

### Names

A name is compared **folded**: trimmed, NFC-normalised and lower-cased, so `Owner` and `owner ` are one
name, while two names differing in anything else are two. `definition_name (artifact_id, kind,
name_key)` holds the folded name of each definition's latest version, unique per `(kind, name_key)`;
making a definition inserts its row and a version that renames it updates the row, both in the version's
transaction, so two people naming two definitions alike at once meet the unique index rather than a race.
The runtime role may insert, and update `name_key`, and nothing else. Migration 0030 makes the table and
fills it from every definition's latest version; an environment holding two alike would fail it, and no
environment does: the only definitions any holds are the starter Topic and, in development, Reviewer
and Review.

### Where a schema applies

In T1 a schema applies at a **place**: a component type assigning it, or a template assigning it at the
document's level or at its sections'. Places are found by a query over the **latest version** of every
component type and every template, reading their assignments from the payload; assignments name a schema
and never a version, so every place takes the schema's latest version (MET-040's first sentence), which
resolution already does.

A **schema's next version** is resolved at each of its places in place of its current one, beside the
place's other schemas at their latest versions, by the resolution every place uses
(`resolveAssignedFields`). Where resolution meets two defaults that differ, the version is refused,
`schema_conflict`, grouping every place by field and other schema. A place that would fail for another
reason - a stranded `requires`, which metadata.md already lets resolution ignore - is not this check's.

A **field's next version** is checked against every schema grouping the field, at their latest versions:
each default the schema gives it must pass the candidate field, by `checkSchema`. Where one does not, the
version is refused, `field_breaks_default`, naming each schema and its default.

## Values

### A component's

A component's values travel with its iterations, as [component-editor.md](component-editor.md) says: an
iteration's body gains `values`, the whole set, and each is stored with the iteration and carried into
the cut by `carryForward`. The service resolves the component's fields from the **current** definitions
of its type, which is what its next version will be cut against, and refuses only what cannot be stored
honestly, `values_invalid`, every failure named:

- a fixed field holding another value than its default (`metadata.fixed`, MET-033);
- a value that is not the JSON its data type takes (`metadata.type`);
- a `user` value naming no principal of this tenant (`metadata.user`, MET-038), over one query of the
  principals named.

Every other failure - a required field empty, a value too long - is saved, shown and fails the
publication (MET-023). A cut is refused the same way where a fixed value differs, and for nothing else;
a required field left empty never refuses a cut.

The component's view carries its **type**, the **fields** that apply at the current definitions - each
with its data type, multiplicity, rules, whether it is required and fixed and by which schemas, and its
default - and the **values** of the iteration the session opened, so the panel needs no second read.

### A document's and a section's

Written through `PUT /v1/documents/{id}/values` and the outline act's `set`, as W4 built them, against the
fields the document's template applies at each level. The document's view gains those fields, as the
component's does, so the page can show and validate them.

### Shown as they arise (MET-021)

One form, `FieldsForm` in `apps/web`, renders a set of fields and their values with
[component-editor.md](component-editor.md)'s inputs per data type, runs `validate` on every change, and
shows each failure beside its field, in a live region. The **metadata panel** holds it beside a
component's surface and saves with the iteration. The **document's fields** hold it on the document
page, saving each change as a version through the values route; a **section's fields** hold it in the
outline panel for the selected section, saving through `set`. A required field is marked, naming the
schemas that require it; a fixed one is read-only, naming the schemas that fix it. Nothing a failure
says blocks a save: an author fills a document in over time, and publication is where it is held.

### Held at publication (MET-023)

`requestPublication` already reads every component version it resolves. Each is validated against the
definition versions **it recorded** (MET-017) - never the current ones - and each failure is recorded as
the request's own, `component_metadata_invalid`, with the node and the field's name, like an unreadable
occurrence's. The request is queued, as one with failures always is, and the job fails it before
assembling; the page lists each failure in words, as it does every other. A component the publisher may
not read fails as unreadable already and is never validated, so no value of it is read.

## Routes

| Route                                                     | Permission                   | Does                                                                                        |
| --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /v1/definitions`                                     | `read`, tenant               | Every field, schema and component type at its latest version: id, kind, name and version    |
| `GET /v1/definitions/{id}`                                | `read`, the definition       | One definition at its latest version, with its payload                                      |
| `POST /v1/definitions`                                    | `manage_definitions`, tenant | Makes a definition at 0.1 from its kind and payload, checked as above                       |
| `POST /v1/definitions/{id}/versions`                      | `manage_definitions`, tenant | Cuts its next version from `openedFrom` and the whole payload, checked as above             |
| `PUT /v1/components/{id}/iterations/{session}/{sequence}` | As today                     | Gains `values`                                                                              |
| `GET /v1/people`                                          | Signed in                    | The tenant's people who have signed in, by name, for a `user` field's picker. Not yet paged |

## Where the code lives

| Where                                             | What                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `domain: src/metadata/`                           | `nameKey`; `schemaConflicts` and `brokenDefaults`, pure over the places and schemas they are given |
| `db: migrations/tenant/0030_definition_names.sql` | `definition_name`, filled from every definition's latest version                                   |
| `db: src/definitions.ts`                          | Making, reading, versioning and listing definitions; `placesOf` over component types and templates |
| `db: src/editing.ts`, `promotion.ts`              | Values with an iteration, and the cut's fixed check                                                |
| `db: src/publishing.ts`                           | Each resolved component version validated against its recorded definitions                         |
| `service: src/definitions.ts`                     | The routes; the refusals, each with its rule                                                       |
| `web: src/metadata/FieldsForm.tsx`                | The form, its inputs and its live validation; the panel, the document's fields and a section's     |

## Verification

- `packages/domain`: a conflict found at every place and grouped; a field version breaking each default
  found; names folded alike and apart.
- `packages/db`: a definition made, read and versioned by the one mechanism; each refusal writing
  nothing; a name taken refused under a race; values with an iteration and the cut's fixed check; a
  publication request recording each component's failures.
- `apps/service`: every write decided by `manage_definitions`, and every read by `read`; each refusal with its code and rule; an
  iteration refused for a fixed value, a wrong type and an unknown user, and saved for a required field
  empty.
- `apps/web`: the panel validating as values change; the document's and a section's fields saving.

## Decisions

Taken as recommended on Ken's instruction of 2026-09-27 ("continue with W5 ... while I review"), each
open to reversal at his review.

| #    | Decision                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DE-A | Definitions are made and changed through the API by `manage_definitions`; a definitions page comes later, as a template's does (TE-J). The panels write values only                                                                                                                                             |
| DE-B | The service allocates a definition's identifier; a caller never names one                                                                                                                                                                                                                                       |
| DE-C | Names are unique per kind compared folded - trimmed, NFC, lower-cased - held by a table with a unique index rather than a check under a lock                                                                                                                                                                    |
| DE-D | A place is a component type or a template level, at its latest version, found by a query over their payloads; MET-040 and MET-037 check every place and every schema and name them all                                                                                                                          |
| DE-E | Each check has its own refusal and rule: `definition_name_taken` (MET-031), `assignment_conflict` (MET-008), `schema_conflict` (MET-040), `field_breaks_default` (MET-037); `definition_unresolved` and `definition_invalid` name none                                                                          |
| DE-F | An iteration carries its whole values; the service refuses a fixed value changed, a value of the wrong type and an unknown user, and saves every other failure                                                                                                                                                  |
| DE-G | The component's view carries its type, its fields at the current definitions and the opened iteration's values; a session re-reads them when it opens and after a refusal. The digest of the definitions on every acknowledgement, which [component-editor.md](component-editor.md) designs, is not built in W5 |
| DE-H | A component's failures at publication are recorded against its node and fail the publication, as an unreadable occurrence's do, rather than refused at the door as a template's are: the component is not the document's to change there                                                                        |
| DE-I | One form renders fields everywhere - a component's panel, a document's fields and a section's - and validates with the one `validate`                                                                                                                                                                           |
| DE-J | A `user` field's picker lists the tenant's active people by name to anyone signed in, through a route of its own; `GET /v1/principals` stays the administrators', since it also lists who was invited                                                                                                           |

## What was ruled out

- **Refusing a required value on a save.** It would stop an author saving half-finished work, which
  MET-023 and component-editor.md both rule out; publication is where it is held.
- **Checking MET-040 by where-used.** MET-025 is T7; the places are few and all in payloads.
- **Unique names by a query under an advisory lock.** A unique index cannot be raced; a query can.
