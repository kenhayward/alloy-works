# Metadata

> **Status: DRAFT for review.** Committed as it stood when handed over, so `git diff` shows exactly
> what changed. Edit anything directly; where you want to say something rather than change it, add a
> line starting `> **Ken:**` under the paragraph or table it is about.

The rules that decide which fields apply to a component, what makes a value valid, and what a version
records about the definitions it was written against.

This realises the domain half of [MET](../specification/requirements/MET-metadata-and-component-types.md).
Definitions and values are stored by [storage-and-versioning.md](storage-and-versioning.md) under
[ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md); they are edited while
authoring by [component-editor.md](component-editor.md); and managing them - creating fields, schemas
and component types, where-used, deprecation - is a later design that reuses these rules rather than
restating them.

## The shape in one paragraph

Three kinds of definition - **field**, **metadata schema**, **component type** - each a versioned
artifact whose payload is a zod-validated JSON document. Nothing here reads a database: the service
loads the current versions and hands them in, and pure functions answer the questions. **Resolution**
turns a component type and the schemas and fields it assigns into one list of **effective fields**,
each saying whether it is required, whether its value is fixed, what its default is, and which schema
made each of those so. **Validation** checks a set of values against effective fields and returns
every failure named. **Carrying forward** decides, when a component's next version is written, which
values still have a field and which do not. All of it lives in `packages/domain`, beside the content
model, for the same reason the content model does: it is the part of the product that has to be
testable without booting anything.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MET-001** | A field definition carries `id`, `name`, `dataType` and `validation`; schemas refer to a field by `id`, so a field grouped by two schemas is one definition                                          |
| **MET-002** | `dataType` is a closed enum - `text`, `number`, `date`, `time`, `dateTime`, `boolean`, `user` - and `multiplicity` is `one` or `many`. Adding a type is a definition-schema version with a migration |
| **MET-028** | A `dateTime` value must parse as ISO 8601 with an explicit offset or `Z`; a `date` or `time` value with an offset is refused                                                                         |
| **MET-030** | A `many` field's value is an array with no duplicate after normalisation, in the order given; `required` means at least one element; a default is an array; `maxValues` is optional                  |
| **MET-004** | `checkValue(field, value)` takes the field and the value and nothing else, so no context can make a value valid in one place and invalid in another                                                  |
| **MET-005** | A schema definition carries `id`, `name` and its entries, and is an artifact kind versioned by the one mechanism (ADR-0024)                                                                          |
| **MET-006** | Each schema entry is `{ field, required, default?, fixed }`                                                                                                                                          |
| **MET-007** | Resolution keys effective fields by field `id`, so a field reached through several schemas appears once, required if any entry or assignment requires it                                             |
| **MET-009** | A component type's assignment is `{ schema, requires: fieldId[] }`. There is no member that could loosen a field, change a default or fix a value, so an assignment cannot do those by construction  |
| **MET-010** | A component type definition carries `id`, `name` and zero or more assignments, and nothing about content                                                                                             |
| **MET-013** | `resolveComponentFields` takes a component type and its definitions and nothing about any document, so there is no input through which a document could contribute a field                           |
| **MET-017** | `validate` takes the definition versions it is given; checking a stored version passes the versions recorded in `version_definition`, never the current ones                                         |
| **MET-018** | `definitionsFor(type)` names the current version of the type, each schema it assigns and each field those group; the service stamps that list on a version at promotion                              |
| **MET-036** | `carryForward(values, effective)` returns the values whose field still applies, unchanged, and a `notCarried` list of every other value by field, which the version records                          |
| **MET-022** | Every failure is `{ field, rule, schema?, detail }`; the caller adds the artifact. A rule a schema imposed - required, fixed - names that schema                                                     |

## What this document does not own

| Left unclaimed              | Why                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MET-011, MET-021            | A component being created with a type, and validation shown while authoring, are [component-editor.md](component-editor.md)'s                                                                                       |
| MET-033                     | Resolution marks a field fixed here, and validation's `fixed` rule catches a changed value; refusing the attempt to edit one happens when the editor saves, so [component-editor.md](component-editor.md) claims it |
| MET-008                     | `checkAssignment` finds every conflict, but refusing the assignment is the act of the definitions-management service, which is not designed                                                                         |
| MET-012                     | A tenant declaring its default component type is tenant configuration, and nothing designs that yet                                                                                                                 |
| MET-029                     | A user value is a principal's identifier here; showing a de-provisioned user as no longer active is IAM's state and the editor's rendering of it                                                                    |
| MET-034                     | Only the component place is designed here. A document's and a section's fields come through a template (TPL), and a relationship's through REL                                                                      |
| MET-035                     | Refusing a new schema version that conflicts "at any place" needs where-used (MET-025, T2) and REL-054's guard, neither designed                                                                                    |
| MET-019, MET-020            | Existing documents and sections are validated by TPL's recorded versions; auditing a definition change is LIF's                                                                                                     |
| MET-023                     | Failing a publish is the publishing pipeline's, which calls `validate`                                                                                                                                              |
| MET-003, MET-032            | Vocabulary-backed fields are T2 and T6. No data type is reserved for them; one arrives as a definition-schema version                                                                                               |
| MET-024 to MET-027, MET-031 | Managing definitions - the permission, where-used, deletion, deprecation, unique names - is the later management design                                                                                             |

## Definitions

Every definition is a JSON payload validated by a zod schema in `packages/domain/src/metadata/`, and
every payload records the **definition schema version** it was written against, migrated on read by
the same harness the content model uses (CNT-012's rule, applied to definitions: a field defined in
2026 must still read in 2040).

**A field**

| Member         | Holds                                                             |
| -------------- | ----------------------------------------------------------------- |
| `id`           | Stable identifier, never reused                                   |
| `name`         | What people see                                                   |
| `dataType`     | `text`, `number`, `date`, `time`, `dateTime`, `boolean` or `user` |
| `multiplicity` | `one` or `many`; `maxValues` optional on `many`                   |
| `validation`   | Per data type, below. What a value _is_ (MET-004)                 |

| Data type  | Value in JSON                                   | Validation a field may declare      |
| ---------- | ----------------------------------------------- | ----------------------------------- |
| `text`     | A string, NFC                                   | `minLength`, `maxLength`, `pattern` |
| `number`   | A string holding a decimal, never a JSON number | `min`, `max`, `integer`, `scale`    |
| `date`     | `YYYY-MM-DD`                                    | `min`, `max`                        |
| `time`     | `HH:MM` or `HH:MM:SS`                           | `min`, `max`                        |
| `dateTime` | ISO 8601 with offset or `Z` (MET-028)           | `min`, `max`, compared as instants  |
| `boolean`  | `true` or `false`                               | None                                |
| `user`     | `{ "user": "<principal id>" }`                  | None                                |

**A number is a string**, deliberately. A JSON number is a binary float by the time most parsers are
done with it, and "0.1 mg" stored as `0.1000000000000000055` is a regulated value quietly changed. The
string holds exactly what was entered, canonicalised (no leading zeros, no trailing fractional zeros),
and `scale` bounds its decimal places.

**A `pattern` is an anchored regular expression from a safe subset** - no backreferences, no
lookaround - so that a pattern a tenant writes cannot make validation take exponential time on a
hostile value.

**A metadata schema** is `id`, `name`, and entries of `{ field, required, default?, fixed }`. A fixed
entry must have a default, and a default must itself pass `checkValue` for its field.

**A component type** is `id`, `name`, and assignments of `{ schema, requires }`, where `requires` lists
fields the assignment makes required.

## Resolution

`resolveComponentFields(type, schemas, fields)` returns the effective fields for a component of that
type. The inputs are definition payloads at specific versions; which versions is the caller's choice,
and that choice is what makes the same function serve both authoring (current versions) and checking a
stored version (recorded versions, MET-017).

For each field reached through any assignment:

| Effective member | Rule                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `required`       | Any entry says `required`, or any assignment lists the field in `requires`. Each source is kept, for naming |
| `fixed`          | Any entry says `fixed`                                                                                      |
| `default`        | The entries' default. Entries that disagree are a **resolution error**, never a silent pick                 |
| `order`          | Assignment order, then entry order, first occurrence - so the editor lists fields predictably               |

**Disagreeing defaults are an error rather than impossible.** MET-008 refuses them at assignment and
MET-035 refuses a schema version that would introduce them, so a correct tenant never reaches the
error - but MET-035's refusal is not designed yet, and a resolver that picked one default silently
would turn that gap into wrong data. It throws, naming the field and the schemas, and the editor shows
it as a definition problem for an administrator rather than a validation failure for an author.

`checkAssignment(assigned, candidate)` is the same comparison run before an assignment is saved.

## Validation

`validate(effective, values)` returns every failure, not the first:

| Rule                       | Fails when                                                                               | Names a schema |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| `required`                 | A required field has no value, or a `many` field has an empty array                      | Yes            |
| `fixed`                    | A fixed field's value differs from its default                                           | Yes            |
| `type`                     | A value is not the JSON its data type takes                                              | No             |
| `multiplicity`             | A `one` field holds an array, a `many` field does not, or a `many` field repeats a value | No             |
| `maxValues`                | A `many` field holds more than it declares                                               | No             |
| The field's own validation | `minLength`, `pattern`, `min`, `scale` and the rest                                      | No             |

Rules that come from the field name no schema, because by MET-004 they are the field's alone.

**A value whose field is not among the effective fields is not a validation failure.** It is a value
that will not be carried forward, and the editor shows it as that (MET-036) rather than as an error an
author has to fix.

## Carrying forward

`carryForward(values, effective)` runs when the next version is written. A value whose field is still
effective is carried unchanged, even if it is now invalid - an invalid carried value is a validation
failure the author sees, not something dropped for them. A value whose field is no longer effective is
returned in `notCarried`, which the version records in full.

**Fixed values are applied before validation, not by it.** When a component is created, and when a
next version is written, every fixed field takes its default and every unset field with a default takes
that default. An author never has to type a fixed value, and validation's `fixed` rule catches only a
value that was changed some other way.

## Canonical form

Values and `notCarried` take part in the version digest (ADR-0024), so they are serialised by the
content model's canonical rules: members in lexicographic order, strings in NFC, no insignificant
whitespace. A `many` field's array keeps its order, because MET-030 makes the order part of the value.

## Where the code lives

`packages/domain/src/metadata/`: the definition schemas, their migration harness, `checkValue`,
`resolveComponentFields`, `checkAssignment`, `validate`, `carryForward` and `definitionsFor`. No
database, no network, no clock. The service loads definitions, calls these, and stores what they
return.

## Verification

- **Every rule in the validation table has a test that fails without it**, the same discipline as the
  content model's: a rule whose test passes with the rule removed is not tested.
- **A fixture per definition schema version**, never deleted, migrated to current by one test.
- **Resolution over a matrix**: two schemas sharing a field with every combination of required, fixed
  and default, and assignments that tighten.
- **A property test for `carryForward`**: every input value is either carried or in `notCarried`,
  exactly once.
- **Numbers**: a round trip of decimal strings that a float would corrupt.

## What was ruled out

- **JSON Schema as the definition language.** It can express a field's validation, and it cannot
  express required-by-assignment, fixed-from-default or the naming MET-022 requires without extensions
  that are a second language inside the first. The definitions are small and closed; zod over our own
  shape keeps them that way.
- **Numbers as JSON numbers.** See above: a regulated value must be the value entered.
- **Resolving through the document.** MET-013, and the reason MET exists.

## Open questions

| ID  | Question                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | The safe subset of regular expressions `pattern` allows. The rule is "no construct that can backtrack exponentially", and the product needs a named engine or a checked subset to enforce it |
| New | Whether `text` needs a language. A free-text field on a component that is later translated (LOC) may need its value per language, which MET does not yet say                                 |
