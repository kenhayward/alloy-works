# Templates

What a template is, what making a document from one does, and what the document keeps of it.

This realises the T1 half of [TPL](../specification/requirements/TPL-templates-and-document-instantiation.md)
and its T2 half, [parameters](#parameters),
and STR-060's section values. A template is stored by [storage-and-versioning.md](storage-and-versioning.md)'s
one mechanism (VER-056, claimed there); who may design one and make a document from one is
[access.md](access.md)'s (TPL-006, IAM-018, claimed there); the theme a document takes is
[themes.md](themes.md)'s rule (STY-025, claimed there) and the layout [publishing.md](publishing.md)'s;
which fields apply and what makes a value valid are [metadata.md](metadata.md)'s, reused rather than
restated; and the outline a document owns is [structure.md](structure.md)'s.

## The shape in one paragraph

A **template** is an artifact of its own kind, in one space, versioned by the one mechanism. Its
payload binds a **theme** and a **layout** by reference, **assigns metadata schemas** by reference,
each at the document's level or its sections', and **owns a starting outline**: sections, each with a
key that is stable across the template's versions and a `required` flag, and one statement of what an
author may change - whether sections may be added, removed or reordered. **Making a document from a
template** resolves every reference against its latest version and refuses where one does not resolve,
records the template version it used, writes the starting sections as the document's first outline -
each section remembering the key it came from - and seeds document and section values from the
fields' defaults. **From then on the document owns its outline** and departs from the template as far as
the template's changes allow; it publishes under the template's theme and layout, and its request is
refused while a required section is missing or a field its template applies is not satisfied.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TPL-001** | `template` is an artifact kind whose artifact belongs to exactly one space; its payload carries a `name`, and each change is a version cut by `recordVersion` under the rules every artifact follows                                                                                 |
| **TPL-059** | A template definition has exactly one `theme`, one `layout` and one `outline` member, each required, and a `schemas` array of zero or more assignments                                                                                                                               |
| **TPL-053** | The outline is held inside the definition, so it is versioned with the template and changes only with it; the theme, the layout and every schema are named by artifact identifier and resolved where they are used, never copied                                                     |
| **TPL-004** | Making a document resolves the template's theme, layout and schemas to their latest versions, and each `requires` against its schema's latest version; any that does not resolve refuses the request, `template_unresolved`, naming what did not, and nothing is written             |
| **TPL-012** | The starting outline is an ordered tree of sections; making a document writes them as its first outline, in that order                                                                                                                                                               |
| **TPL-013** | A starting section may be `required`; a publication request for a document with no section carrying that section's key is refused, `section_required`, naming each missing section by its title                                                                                      |
| **TPL-015** | A definition's `changes` says whether sections may be added, removed and reordered; the outline act reads the document's recorded template version and refuses an insert, a removal or a move of a section that `changes` forbids, naming the rule                                   |
| **TPL-054** | Each assignment is `{ schema, level, requires }`: `level` is `document` or `section`, and `requires` names fields the schema groups, which is the component type's MET-009 shape and so can make a field required and do nothing else                                                |
| **TPL-062** | Making a document from a template writes its starting outline and seeds the document's values and each starting section's from their effective fields' defaults and fixed values, by the same `carryForward` a component's first version uses                                        |
| **TPL-025** | Making a document records, beside the document, the template and the template version it was made from, once and never changed                                                                                                                                                       |
| **TPL-027** | After it is made, the document's outline is its own: every outline act changes the document and none reaches the template, and a template's later versions change no document already made                                                                                           |
| **TPL-055** | A publication request resolves the document-level fields its template applies and validates the document's values, then each section's against the section-level fields, and is refused, `metadata_invalid`, listing every failure in MET-022's shape with the section it belongs to |
| **TPL-017** | A template's `parameters` declare name, type, whether required, and permitted values or range, by the query definition's own declaration ([Parameters](#parameters))                                                                                                                 |
| **TPL-018** | Making a document refuses a required parameter without a value, `parameter_invalid`, and writes nothing                                                                                                                                                                              |
| **TPL-020** | A document version holds its `parameters`; the Parameters panel and its route show each value and every change with who made it and when                                                                                                                                             |
| **TPL-021** | Each parameter declares `changeable`; changing one that is not is `parameter_fixed`                                                                                                                                                                                                  |
| **TPL-026** | Making a document, its parameters included, is the same route for the form and for any other client, and refuses alike                                                                                                                                                               |
| **TPL-045** | Every value is checked by the definitions' `checkParameterValues` at creation, change and resolve, and refused naming the parameter, the rule and the value                                                                                                                          |
| **TPL-066** | A parameter seeds its declared document field when the document is made, and supplies a binding's `{ document }` argument at resolve and check, a changed value marking the binding changed                                                                                          |
| **TPL-068** | `feeds` declares the field a parameter seeds and whether it supplies arguments; one feeding nothing is `parameter_unused`                                                                                                                                                            |
| **STR-060** | A section carries its title, as it does, and field values in its `values`, written by the outline act's `set`, each checked against the section-level fields of the document's template and refused by name where it is not one of them or does not pass                             |

## What this document does not own

| Left unclaimed   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TPL-006, IAM-018 | [access.md](access.md) claims both: `design` decides a template, and a grant can be made on one. This document names the routes and which permission each asks for                                                                                                                                                                                                                                                                     |
| STY-025          | [themes.md](themes.md) claims it: a document takes its template's theme. This document says where the binding is read                                                                                                                                                                                                                                                                                                                  |
| VER-056          | [storage-and-versioning.md](storage-and-versioning.md) claims it; a template is versioned by `recordVersion` like any artifact                                                                                                                                                                                                                                                                                                         |
| TPL-056, TPL-057 | Not T1. A document records no definition versions, so its values are validated against the current definitions (TE-K)                                                                                                                                                                                                                                                                                                                  |
| TPL-014          | T4: a starting outline holds sections and no component references                                                                                                                                                                                                                                                                                                                                                                      |
| MET-019          | **A named gap.** Nothing records the definition versions a document's or a section's values were written against (TE-K), so a later change to a field or a schema can make a document that satisfied its template fail its next publication - what MET-019 forbids for documents and sections. Recording them is TPL-056 and validating against them TPL-057, both outside T1; [metadata.md](metadata.md) already defers these to them |

## The template

### The artifact

`template` joins `artifactKinds` as a **spaced** kind (TPL-001): the space rule `artifact_space_by_kind`
and `spacedKinds` gain it, and `createArtifact` takes a space for it as it does for a document. It is a
content artifact in [access.md](access.md)'s sense, living in one space, and its versions carry no
values, no type and no definitions: everything it says is its payload.

### The definition

In `packages/domain/src/template/`, a zod schema and a check, as the metadata definitions are:

```ts
{
  schemaVersion: 1,
  name: string,                       // 1 to 200 characters, trimmed, what the chooser shows
  theme: string,                      // a theme artifact's identifier
  layout: string,                     // a layout artifact's identifier
  schemas: {                          // zero or more
    schema: string,                   // a metadata schema's identifier
    level: 'document' | 'section',
    requires: string[],               // fields the schema groups, made required (MET-009)
  }[],
  outline: { sections: StartingSection[] },
  changes: { add: boolean, remove: boolean, reorder: boolean },
}

StartingSection = {
  key: string,                        // stable across the template's versions; unique in the outline
  title: InlineNode[],                // a section title's content, with no cross-reference
  required: boolean,
  numbered: boolean, matter: 'front' | 'body' | 'appendix', pageBreak: 'none' | 'page' | 'recto',
  children: StartingSection[],
}
```

`checkTemplate` - the definition schema's own refinement, not a function beside it - holds what the
schema's members cannot: keys unique across the tree; matter as an outline holds it (STR-064), set at
the top level with front matter first there and every section below it body; each title passing the
section title's inline rules with no cross-reference anywhere in it, a footnote's paragraphs
included; one assignment per schema and level; and `requires` naming no field twice. It checks
nothing that needs another artifact; that is resolution's.

**A key, not a node identifier.** A starting section is not a node of any document. The key names it
across the template's versions and in every document made from one, so a required section is found
by it however the document's own identifiers run (TE-C).

**No cross-reference in a starting title.** A starting outline has no targets, and a title's reference
names an outline node, which does not exist until a document is made.

### Resolving a template

`resolveTemplate(definition, found)` takes the definition and what the service found for each
identifier - the theme and layout artifacts' kinds, and each schema's latest definition and the fields
it groups - and answers either the resolved template or every reference that did not resolve: an
identifier naming no artifact, or one of another kind, and a `requires` naming a field its schema no
longer groups (TPL-004). It then answers the **effective fields at each level**, by the resolution
[metadata.md](metadata.md) already has, given the assignments at that level in place of a component
type's - so a field reached through two schemas is one field, required if either requires it (MET-007).

## Making a document from a template

`POST /v1/spaces/{space}/documents` takes an optional `template`. With one, in one transaction:

1. **The template is read** at its latest version, and refused as not found where the caller may not
   read it (TE-I).
2. **It is resolved** (TPL-004). Anything unresolved refuses the request, `400 template_unresolved`,
   naming each reference, and nothing is written.
3. **The outline is written**: each starting section becomes a section node with a new identifier, its
   title, its switches, `values` seeded from the section-level effective fields by `carryForward`, and
   `origin`, the key it came from (TPL-012, TPL-062).
4. **The document's values are seeded** from the document-level effective fields, the same way, into
   its version 0.1 (TPL-062).
5. **The link is recorded**: `document_template (document_id, template_id, template_version_id)`,
   insert-only (TPL-025).

The document's title, language and direction are the request's, as for a blank document. Without a
`template`, a document is made blank, as today, and records no link.

## What the document keeps

### The link

`document_template` is written once, beside the artifact, and never changed: the grant that revokes
UPDATE and DELETE on the version chain revokes them here too. A document has at most one row. It is
read wherever a document's template matters - its rules, its fields, its theme and layout - **at the
recorded version**, so a template's later version changes nothing about a document already made
(TPL-027).

### Where each section came from

A section node gains an optional `origin`, the key of the starting section it was written from. The
outline's schema goes to version 3, whose migration from 2 adds nothing: an outline made before
templates has no origins. **No outline act writes `origin`**: `insert`'s node refuses the member, and
`set` has none, so a section the author adds is never taken for a required one, and a required one
keeps its key however it is retitled or moved (TE-E).

### What an author may change

The outline act reads the document's recorded template version and passes its `changes` to
`applyOutlineOperation`, which refuses, before anything else, an `insert` of a section when `add` is
false, a `remove` of a section when `remove` is false, and a `move` of a section when `reorder` is false

- each as `outline_invalid` with a reason saying which, in the words FRONT_FIRST uses. **References are
  never held by `changes`**: placing, moving and removing components is what writing a document is -
  except a reference carrying a section beneath it, whose removal or move takes that section too and
  is held as the section is, so a reference is no way round the rule.
  A document with no template has no `changes`, and nothing is refused on its account (TPL-015).

### Values

- **A document's values** are the version's `metadata_values`, the column a component's already use.
  Four things hold them to components today, and each widens to documents: the column's constraint
  `artifact_version_values_by_kind` (migration 0029), `DocumentSubstance`, which gains `values`,
  `canonicaliseVersion`, which reads a document's values into the digest's `values` member as it
  reads a component's (ADR-0024), and `insertVersion` and `substanceOf`, which write and read them. A
  document version made before templates has none, so its digest is unchanged: the member was the
  empty object's canonical form before and is still. `PUT /v1/documents/{id}/values`, taking
  `openedFrom` and the whole set, cuts a version with the outline unchanged.
- **A section's values** are its node's `values`, which `set` writes (STR-060). A reference's stay
  `{}`: a component's values are its own.
- **Both are checked where written**: a value must name an effective field at its level and pass
  `checkValue` (MET-004), and a fixed field's value may not change; a failure refuses the write by
  name. **Required is not checked on write** - an author fills a document in over time - but at
  publication (TPL-055).

A document with no template has no effective fields, so its values, and its sections', stay empty.

## Publishing a document made from a template

`requestPublication` (`packages/db/src/publishing.ts`) takes the **layout and theme the document's
recorded template version names**, at their latest versions, read by `layoutLatest` and
`themeLatest` beside `defaultLayout` and `defaultTheme`, where the environment's defaults stood; a document with no template keeps the
defaults (TE-F). The document page's layout and its numbering read the same, so the numbers shown are
the numbers that publish (STR-036).

Before anything is queued, after the checks that stand today, in this order:

1. **Required sections** (TPL-013): every required starting section's key must be the `origin` of a
   section in the version being published; otherwise `400 section_required`, naming each missing
   section by its starting title.
2. **Fields** (TPL-055): the document's values against the document-level effective fields, and each
   section's against the section-level ones, by `validate`; otherwise `400 metadata_invalid`, carrying
   every failure in MET-022's shape with the node it belongs to, `null` for the document's own.

Refused at the door, as a format or a language is (PUB-014, PUB-095), so the author is told at once and
nothing is queued to fail.

## Parameters

**T2's half of TPL**: what a document is about, declared by its template, asked for when it is made,
recorded on it, and fed to its metadata and to its bindings' `{ document }` arguments (DAT-030).
Bindings established at creation, a query set and parameters resolving variables are T4's
([ADR-0043](../decisions/0043-a-templates-bindings-query-set-and-variables-move-to-t4.md)), since a
T2 template's outline holds sections and no components.

> **Not built.** Built in two slices, [below](#build-order).

### Declared on the template

The definition gains `parameters`, at most 50, additive at template schema 1 (absent reads as none):

```ts
TemplateParameter = Parameter & {        // data.md's declaration: name, type, required, list, permitted
  changeable: boolean,                   // TPL-021
  feeds: {                               // TPL-068: at least one
    field?: string,                      // a document-level effective field it seeds when the document is made
    arguments: boolean,                  // offered to bindings as { document: name }
  },
}
```

- **The query definition's own `parameterSchema` and checks** (DAT-010, DAT-020), so one rule reads a
  value whether a definition or a template declares it; `variation` is refused (`parameter_variation`),
  since it selects SQL.
- **A parameter feeding nothing is refused** at save, `parameter_unused` (TPL-068).
- **A seeded field** must be a document-level effective field (resolution, TE-L) whose type takes the
  parameter's: text to text, integer and decimal to number, date to date, time to time, instant to
  date-time, boolean to boolean, a list only to a field of many. Anything else is `parameter_field`,
  naming both. A local date-time has no field to seed.

### Asked for when a document is made

`POST /v1/spaces/{space}/documents` takes `parameters: Record<name, value>` beside `template`, and the
New document form asks for them, each by its type: a text box, a number, a date, a check box, a list
of entries, or a choice where `permitted` lists values (TPL-026). In the same transaction as today:

- **Checked** by `checkParameterValues`: a required one missing, or any value invalid, refuses the
  request, `400 parameter_invalid`, naming every parameter, its rule and its value, as the form shows
  them (TPL-018, TPL-045); a name the template does not declare is `parameter_unknown`.
- **Recorded** in the document's first version (below), and **each seeded field's value set** from it
  over the field's default (TPL-066). Seeding happens once: a later change to the parameter does not
  rewrite the field, which is the author's from then on.

### Recorded on the document

- **A document version holds `parameters`**, beside `values`: a new nullable `parameters` column on
  `artifact_version` (0057), documents only, in `DocumentSubstance` and in the digest, which leaves it
  out when empty so no existing document's digest moves.
- **Changing one** is `PUT /v1/documents/{id}/parameters`, `openedFrom` and the whole set, cutting a
  version with outline and values unchanged; a value of a parameter that is not `changeable` and
  differs is refused, `parameter_fixed`, naming it (TPL-021); every value is checked as at creation.
  Outline and values acts carry `parameters` unchanged.
- **Visible and auditable** (TPL-020): the document page's **Parameters** panel shows each value, and
  its history - each change, who made it and when, read from the version chain's author and time.
  `GET /v1/documents/{id}/parameters` answers the same.

### Feeding the bindings

- **A `{ document: name }` argument takes the document's current value** at resolve and check: absent
  from the document, or of a template parameter whose type and list are not the definition
  parameter's, is `parameter_invalid` naming it; the value is then checked against the definition's
  own declaration, which may be narrower.
- **A changed value marks the bindings using it changed.** A binding's digest, wherever it is compared
  with a resolution's - the view, Keep, the Data tab and the publish request's `binding_unresolved` -
  is taken over the binding **with its document arguments replaced by their current values**, and resolve records it so. A
  binding with none keeps the digest it has, so no resolution held today moves; a parameter change
  makes every binding that reads it `changed`, and the Data tab says which parameter, read against
  the held dataset version's provenance. Nothing runs by itself: the author checks and accepts, as for
  any change (ADR-0035).
- **The Value dialog's From the document** becomes available: in a document, a choice of its template
  parameters that feed arguments and match the definition parameter's type; in a component alone, a
  name typed, checked where it is resolved.

### Failures

| Failure               | Where                     | Meaning                                                                                 |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `parameter_unused`    | template save             | A parameter seeds no field and supplies no argument (TPL-068)                           |
| `parameter_variation` | template save             | A template parameter declares a variation                                               |
| `parameter_field`     | template save, resolve    | A seeded field is not document-level, or cannot take the parameter's type               |
| `parameter_invalid`   | creation, change, resolve | A required value missing or a value invalid, naming parameter, rule and value (TPL-045) |
| `parameter_unknown`   | creation, change          | A value for a parameter the template does not declare                                   |
| `parameter_fixed`     | change                    | A changed value of a parameter that is not changeable (TPL-021)                         |

### Build order

1. **TP1, parameters declared, asked for and recorded**: the template member and its checks, creation
   with parameters through the API and the form, seeding, 0057, the change route, the Parameters panel
   and its history.
2. **TP2, parameters feeding bindings**: `{ document }` resolved, the substituted digest everywhere it
   is compared, the Data tab's reason, the Value dialog's From the document, the whole system, and the
   close.

## Routes

| Route                               | Permission                                    | Does                                                                                                                |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/templates` | `design` on the space                         | Makes a template at 0.1 from a definition that passes `checkTemplate` and resolves (TE-L)                           |
| `GET /v1/templates`                 | Signed in                                     | The templates the caller may read, each with its name, space and latest version. Not yet paged                      |
| `GET /v1/templates/{id}`            | `read` on the template                        | Its latest version and definition                                                                                   |
| `POST /v1/templates/{id}/versions`  | `design` on the template                      | Cuts a version from `openedFrom` and a whole definition that passes and resolves, as above (API-037's precondition) |
| `POST /v1/spaces/{space}/documents` | `create` on the space, `read` on the template | As today, with an optional `template`                                                                               |
| `PUT /v1/documents/{id}/values`     | `edit` on the document                        | Replaces the document's values, cutting a version                                                                   |
| `PUT /v1/documents/{id}/parameters` | `edit` on the document                        | Replaces the document's parameters, cutting a version (TPL-021)                                                     |
| `GET /v1/documents/{id}/parameters` | `read` on the document                        | Each value and its history (TPL-020)                                                                                |

## Where the code lives

| Where                                              | What                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain: src/template/`                            | The definition's schema, `checkTemplate`, `resolveTemplate`, and the starting outline's materialising                                                                                                      |
| `domain: src/structure/`                           | `origin`, outline schema 3, and `changes` passed to `applyOutlineOperation`                                                                                                                                |
| `db: migrations/tenant/0028_templates.sql`         | The kind, its space rule, and its versions authored                                                                                                                                                        |
| `db: migrations/tenant/0029_document_template.sql` | `document_template`, and documents' values                                                                                                                                                                 |
| `db: src/templates.ts`                             | Making, reading and versioning a template; a document's template, and the layout and theme it binds                                                                                                        |
| `service: src/templates.ts`                        | The template routes; the documents and publishing handlers read a document's template                                                                                                                      |
| `domain: src/version/substance.ts`                 | `DocumentSubstance.values`, and `canonicaliseVersion` digesting them                                                                                                                                       |
| `db: src/versions.ts`                              | `insertVersion` and `substanceOf` writing and reading a document's values                                                                                                                                  |
| `db: src/publishing.ts`, `layouts.ts`, `themes.ts` | `requestPublication` reading the document's template's layout and theme, `layoutLatest` and `themeLatest`, and the two door checks                                                                         |
| `service: src/wire-codes.ts`                       | `template.unresolved`, `section.required` and `metadata.invalid`, with their rules TPL-004, TPL-013 and TPL-055 (API-006); `values.invalid` and `values.unresolved`, a written value's refusals, with none |
| `web: src/structure/NewDocument.tsx`               | The template to start from                                                                                                                                                                                 |

## Verification

- `packages/domain`: a definition refused for each rule `checkTemplate` holds; `resolveTemplate`
  refusing each kind of unresolved reference, and answering effective fields per level; materialising
  a starting outline with its origins and seeded values; `applyOutlineOperation` refusing each change
  `changes` forbids, a section carried inside a reference included, and allowing every other
  reference act.
- `packages/db`: a template made, read and versioned by the one mechanism; instantiation writing the
  outline, the values and the link in one transaction, and nothing when refused; `document_template`
  refusing an update.
- `apps/service`: every route with its permission, a grant on a template deciding it (IAM-018); a
  document publishing under its template's layout and theme; each refusal at the door.
- `apps/web`: the chooser, and making a document from a template.

## Decisions

Taken as recommended on Ken's standing instruction of 2026-09-26 ("continue through to the end of W4 ...
and I will review all live at the end"), each open to reversal at that review.

| #    | Decision                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TE-A | A template is a spaced kind (TPL-001), and a document may be made from any template its author may read into any space they may create in                                                                                                   |
| TE-B | The theme, layout and schemas are referenced by artifact identifier and resolved to their latest versions where used - at instantiation and at publication - while the template version a document was made from is recorded (TPL-025)      |
| TE-C | A starting outline holds sections only, each with a key stable across versions; no component references in T1 (TPL-014)                                                                                                                     |
| TE-D | `changes` is template-wide - add, remove, reorder - applies to sections only, and is read from the document's recorded template version                                                                                                     |
| TE-E | The link is an insert-only table beside the document; a section's origin is an optional outline member no act writes, at outline schema 3                                                                                                   |
| TE-F | A template is optional: a blank document keeps the environment's default theme and layout. No tenant is seeded with a template; development's seed has one                                                                                  |
| TE-G | A document's values are its version's `metadata_values`; a section's are its node's `values`. Each is checked field by field when written, and for required fields only at publication                                                      |
| TE-H | Required sections and fields are checked at the publication request's door, as two refusals in that order, each naming every failure                                                                                                        |
| TE-I | `design` on the space makes a template and on the template changes it; `read` shows it; making a document from one asks `create` in the target space and `read` on the template, an unreadable template answered as not found               |
| TE-J | T1's interface is the template chooser in **New document** and the refusals where the page already shows them; making and changing a template is through the API, and a template's own page and editor come later                           |
| TE-K | With TPL-056 and TPL-057 outside T1, nothing records definition versions on a document: its values are resolved and validated against the current definitions each time, which leaves MET-019 unmet for documents and sections, named above |
| TE-L | A template is refused, when made and when versioned, unless its definition passes `checkTemplate` and every reference resolves; resolution runs again when a document is made from it, because what it names can change after it is saved   |
| TE-M | **T2's TPL is parameters alone**; bindings at creation, a query set and variables are T4's (ADR-0043)                                                                                                                                       |
| TE-N | **A template parameter is the query definition's `Parameter`**, plus `changeable` and `feeds`, so one declaration and one checker serve both                                                                                                |
| TE-O | **Parameters live in the document's versions**, so who changed one and when is the version chain's record, not a second log                                                                                                                 |
| TE-P | **A seeded field is seeded once**, at creation; afterwards it is the author's                                                                                                                                                               |
| TE-Q | **A binding's digest is taken with its document arguments substituted**, so a changed parameter marks exactly the bindings that read it, and a binding without one keeps its digest                                                         |

## What was ruled out

- **Copying the theme and layout into the template or the document.** TPL-053 says reference, and a
  copy would be a second theme nobody could change.
- **The link as an outline member.** The outline is the document's to change (TPL-027); what it was
  made from is not, so it sits beside the document where no act reaches it.
- **Checking required sections on removal.** Refusing the removal would stop an author restructuring
  on the way to a version that has the section again; TPL-013 is about publishing, and is checked there.
- **Validating required fields on every write.** It would refuse every intermediate version of a
  document being filled in.

## Open questions

| Question                                                                                   | Where it goes                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| A template's own page and an editor for its starting outline                               | After T1, with TPL-026's API-first instantiation |
| Whether a document may move to a later version of its template, and what that would change | Not in T1's requirements                         |
