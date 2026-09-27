# W5: Definitions and the metadata panel

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W5 of
> [the rest of T1](2026-09-25-t1-remainder.md) from [definitions.md](../design/definitions.md), whose
> decisions DE-A to DE-J were taken as recommended on Ken's instruction of 2026-09-27 and are his to
> review.

**Goal:** fields, schemas and component types are made and changed through the API, each change
checked against everything that uses it; a component's values are written with its iterations; a
component's, a document's and a section's fields are shown and validated as an author works; and a
publication fails where a component it references holds a value its fields refuse.

| PR   | Holds                                                                                                                                     | Version |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W5.0 | This plan and [definitions.md](../design/definitions.md), claiming MET-041, 031, 008, 040, 037, 021 and 023                               | Build   |
| W5.1 | Definitions through the API: making, reading, listing and versioning; names (0030); what they name; `checkSchema`; MET-008, 040 and 037   | Minor   |
| W5.2 | A component's values with its iterations and its cut: the three refusals, MET-033 and MET-038; the view's type, fields and values; people | Minor   |
| W5.3 | The metadata panel: `FieldsForm`, its inputs per data type, live validation, saving with the iteration                                    | Minor   |
| W5.4 | A document's fields and a section's on the document page, through the same form                                                           | Minor   |
| W5.5 | Publication: each resolved component version validated against its recorded definitions (MET-023)                                         | Minor   |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title; an
  `it.each` title cites nothing, and a `rule:` field in a test cites its requirement.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; the full suite before each pull request.
- A new tenant migration is appended to every test that lists the migrations.

## W5.1: Definitions through the API

1. **Names** (`domain: src/metadata/`): `nameKey(name)`, trimmed, NFC and lower-cased. Uncited test.
2. **The checks, pure** (`domain: src/metadata/`): `schemaConflicts(candidate, places, schemas,
fields)` resolving each place with the candidate in place of its schema and grouping every
   `defaultConflict` by field and other schema with its places; `brokenDefaults(candidate, schemas)`
   running `checkSchema` over every schema grouping the field. Uncited tests of each.
3. **Storage** (`0030_definition_names.sql`, `db: src/definitions.ts`): `definition_name`, filled from
   every definition's latest version, insert and `name_key` update only; `createDefinition`,
   `readDefinitionLatest`, `listDefinitions`, `recordDefinitionVersion`, `placesOf(schemaId)` over the
   latest component types and templates. **Tests:** `MET-041 creates a new version for every change to
a field, a schema or a component type` (versions 0.1 and 0.2 both read); `MET-031 refuses a name
another definition of its kind holds, compared folded` (and the same name across kinds taken);
   `MET-008 refuses a component type assigning two schemas whose defaults for a field differ, naming
the field and both schemas`; `MET-040 refuses a schema version whose default would differ from a
schema applied beside it, naming the field, the other schema and every such place` (a component
   type and a template level both named; and an assignment taking the schema's latest version);
   `MET-037 refuses a field version that would make a schema's default invalid, naming each schema
and its default`; uncited: a missing field or schema named, a schema's own invalid default refused,
   a race on a name.
4. **Routes** (`api-contract: definitions.ts`, `service: src/definitions.ts`): the four routes,
   `manage_definitions` at the tenant; the codes and rules of DE-E. **Tests:** the routes decided by
   `manage_definitions`, each refusal with its code and rule; the harnesses gain each route.
5. Docs: architecture.md, features.md and README, the changelog.

## W5.2: A component's values

1. **The iteration** (`api-contract: editing.ts`, `db: src/editing.ts`): `values` on the body, whole,
   optional so a session that sends none keeps the opened ones; stored with the iteration and hashed.
2. **The checks** (`service`): the component's fields resolved from its type's current definitions;
   `validate` filtered to `fixed` and `type`, and `checkUserValues` over one query of the principals
   named; `values_invalid` carrying each. **Tests:** `MET-033 refuses an iteration or a cut holding a
fixed field's value other than its default, naming the field and the schema`; `MET-038 refuses a
user value naming no user of this tenant`; uncited: a wrong type refused, and a required field
   empty saved and cut (MET-023's second sentence is cited in W5.5 with the rest of it).
3. **The cut** (`db: src/promotion.ts`): the fixed check before `recordVersion`.
4. **The view** (`api-contract: components.ts`): `type`, `fields` and `values`. Uncited test.
5. **People** (`GET /v1/people`): the tenant's active principals by display name, paged, signed in.
   Uncited test, and the harnesses.
6. Docs.

## W5.3: The metadata panel

1. **`FieldsForm`** (`web: src/metadata/`): the inputs of component-editor.md's table, a `many` field
   as an ordered list, required and fixed marked with the schemas that make them so, `validate` on
   every change, each failure beside its field and in a live region. `dateTime` takes a local date and
   time in the author's zone and stores the instant with its offset; a time the zone skips is refused
   in a sentence, and one it repeats asks which is meant.
2. **The panel** beside the component's surface, in the `F6` ring, its values saved with the
   iteration; the session sends `values` whole.
3. **Tests:** `MET-021 shows a missing or invalid field as it arises, while authoring` (a required
   field emptied and a value too long each announced as typed, and saved regardless); uncited: each
   input, a fixed field read-only, a refusal shown.
4. Docs.

## W5.4: A document's and a section's fields

1. **The view** (`api-contract: documents.ts`): the document-level and section-level fields its
   template applies, as the component's view carries its own.
2. **The document's fields** on its page and **the selected section's** in the outline panel, through
   `FieldsForm`, saving through the values route and `set`. **Tests:** the same live validation at
   both places, uncited beyond MET-021's own test in W5.3 unless it can name both; saving each.
3. Docs.

## W5.5: Held at publication

1. **`requestPublication`**: each resolved component version's recorded definitions read, its fields
   resolved from them, `validate` run, each failure recorded as `component_metadata_invalid` with the
   node and the field's name; the failure code added to the domain's publish failures, and a sentence
   for it on the page. **Test:** `MET-023 fails a publication whose component holds a missing or
invalid value, and never refuses a cut for one`.
2. Docs; definitions.md's claims all covered; the remainder plan's W5 row reads Built.

## What the build changed

Filled in as each pull request lands.

## Done when

- Every requirement definitions.md claims is Covered, and MET-033 and MET-038 are cited under the
  designs that claim them.
- The remainder plan's W5 row reads Built, and Ken has reviewed DE-A to DE-J.
