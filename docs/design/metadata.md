# Metadata

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

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MET-001** | A field definition carries `id`, `name`, `dataType` and `validation`; schemas refer to a field by `id`, so a field grouped by two schemas is one definition                                                                                                                                                                                               |
| **MET-002** | `dataType` is a closed enum - `text`, `number`, `date`, `time`, `dateTime`, `boolean`, `user` - and `multiplicity` is `one` or `many`. Adding a type is a definition-schema version with a migration                                                                                                                                                      |
| **MET-028** | A `dateTime` value must parse as ISO 8601 with an explicit offset or `Z`; a `date` or `time` value with an offset is refused                                                                                                                                                                                                                              |
| **MET-030** | A `many` field's value is an array with no duplicate after normalisation, in the order given; `required` means at least one element; a default is an array; `maxValues` is optional                                                                                                                                                                       |
| **MET-004** | `checkValue(field, value)` takes the field and the value and nothing else, so no context can make a value valid in one place and invalid in another                                                                                                                                                                                                       |
| **MET-005** | A schema definition carries `id`, `name` and its entries, and is an artifact kind versioned by the one mechanism (ADR-0024)                                                                                                                                                                                                                               |
| **MET-006** | Each schema entry is `{ field, required, default?, fixed }`                                                                                                                                                                                                                                                                                               |
| **MET-007** | Resolution keys effective fields by field `id`, so a field reached through several schemas appears once, required if any entry or assignment requires it                                                                                                                                                                                                  |
| **MET-009** | A component type's assignment is `{ schema, requires: fieldId[] }`. There is no member that could loosen a field, change a default or fix a value, so an assignment cannot do those by construction. `requires` can only name a field the assigned schema groups, and a field becomes effective only through a schema entry, so `requires` cannot add one |
| **MET-010** | A component type definition carries `id`, `name` and zero or more assignments, and nothing about content                                                                                                                                                                                                                                                  |
| **MET-013** | `resolveComponentFields` takes a component type and its definitions and nothing about any document, so there is no input through which a document could contribute a field                                                                                                                                                                                |
| **MET-017** | `validate` takes the definition versions it is given; checking a stored version passes the versions recorded in `version_definition`, never the current ones                                                                                                                                                                                              |
| **MET-018** | `definitionsFor(type)` names the current version of the type, each schema it assigns and each field those group; the service stamps that list on a version at promotion                                                                                                                                                                                   |
| **MET-036** | `carryForward(values, effective)` returns the values whose field still applies, unchanged, and a `notCarried` list of every other value by field, which the version records. It fills only a field with no member, so it never changes a value that is present                                                                                            |
| **MET-022** | Every failure is `{ code, field, rule, schemas, detail }`, with a stable `code`; the caller adds the artifact. A rule a schema imposed - required, fixed - lists every schema that imposed it, since more than one can. A requirement an assignment imposed names the schema assigned                                                                     |

## What this document does not own

| Left unclaimed              | Why                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MET-011, MET-021            | A component being created with a type, and validation shown while authoring, are [component-editor.md](component-editor.md)'s                                                                                                                                                                                  |
| MET-033                     | Resolution marks a field fixed here, carrying forward fills a fixed field that has no value, and validation's `fixed` rule names a value that differs, with its schemas. Refusing a write that carries one - an iteration or a cut - is the service's, so [component-editor.md](component-editor.md) claims it |
| MET-008                     | `checkAssignment` finds every conflict, but refusing the assignment is the act of the definitions-management service, which is not designed                                                                                                                                                                    |
| MET-012                     | A tenant declaring its default component type is tenant configuration, and nothing designs that yet                                                                                                                                                                                                            |
| MET-014                     | Changing a component's type is T2. Carrying forward already gives its consequence - a value whose field the new type lacks goes to `notCarried` - but the explicit, audited act is not designed, and [component-editor.md](component-editor.md) keeps the type read-only                                       |
| MET-015, MET-016            | [storage-and-versioning.md](storage-and-versioning.md)'s: values are a column of the insert-only version row, beside `content`, whose closed root refuses them. Here values only take part in the digest, below                                                                                                |
| MET-029                     | Its entry half is designed here: `checkUserValues`, below, refuses a value naming no principal of this tenant. Showing a departed user as no longer active is [component-editor.md](component-editor.md)'s for a component and undesigned for a document or a section                                          |
| MET-034                     | Only the component place is designed here. A document's and a section's fields come through a template (TPL), and a relationship's through REL                                                                                                                                                                 |
| MET-035                     | Refusing a new schema version that conflicts "at any place" needs where-used (MET-025, T2) and REL-054's guard, neither designed                                                                                                                                                                               |
| MET-019, MET-020            | Existing documents and sections are validated by TPL's recorded versions; auditing a definition change is LIF's                                                                                                                                                                                                |
| MET-023                     | Failing a publish is the publishing pipeline's, which calls `validate`                                                                                                                                                                                                                                         |
| MET-003, MET-032            | Vocabulary-backed fields are T2 and T6. No data type is reserved for them; one arrives as a definition-schema version                                                                                                                                                                                          |
| MET-024 to MET-027, MET-031 | Managing definitions - the permission, where-used, deletion, deprecation, unique names - is the later management design                                                                                                                                                                                        |

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

**A `pattern` is an anchored regular expression that must not be able to backtrack exponentially**,
so that a pattern a tenant writes cannot make validation take exponential time on a hostile value.
Banning backreferences and lookaround is necessary and is not enough: a nested quantifier such as
`(a+)+b` backtracks exponentially in a standard engine with neither. How the rule is enforced is an open
question below, and `pattern` does not ship until it is answered.

**No value and a cleared value are different.** A component's values are an object keyed by field
`id`. A field with no member has never been given a value. Clearing one writes `null` for a `one` field
and `[]` for a `many` field, and that stays as written: only a field with no member takes a default
(carrying forward, below), so the next write never undoes a clear. `required` treats all three - no
member, `null`, `[]` - as no value.

**A metadata schema** is `id`, `name`, and entries of `{ field, required, default?, fixed }`. A fixed
entry must have a default, and a default must itself pass `checkValue` for its field.

**A component type** is `id`, `name`, and assignments of `{ schema, requires }`, where `requires` lists
fields the assignment makes required. **Every field `requires` names must be one the assigned schema
groups.** `checkAssignment` refuses one that is not, so a mistyped identifier is refused where it is
typed rather than ignored.

## Resolution

`resolveComponentFields(type, schemas, fields)` returns the effective fields for a component of that
type. The inputs are definition payloads at specific versions; which versions is the caller's choice,
and that choice is what makes the same function serve both authoring (current versions) and checking a
stored version (recorded versions, MET-017).

For each field reached through any assignment:

| Effective member | Rule                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`       | Any entry says `required`, or any assignment lists the field in `requires`. Each source is kept, for naming: an entry by its schema, an assignment by the schema it assigns |
| `fixed`          | Any entry says `fixed`                                                                                                                                                      |
| `default`        | The entries' default. Entries that disagree are a **resolution error**, never a silent pick                                                                                 |
| `order`          | Assignment order, then entry order, first occurrence - so the editor lists fields predictably                                                                               |

**Disagreeing defaults are an error rather than impossible.** MET-008 refuses them at assignment and
MET-035 refuses a schema version that would introduce them, so a correct tenant never reaches the
error - but neither refusal is designed yet: `checkAssignment` finds the conflict and nothing acts on it,
and MET-035 waits on where-used. A resolver that picked one default silently would turn those gaps into
wrong data. It throws, naming the field and the schemas, and the editor shows it as a definition problem
for an administrator rather than a validation failure for an author.

**A `requires` naming a field its schema no longer groups is ignored, not thrown.** `checkAssignment`
refuses one when the assignment is saved, but assignments float to the latest schema version, so a
later version that drops a field can leave one behind. Resolution ignores it because nothing is lost by
doing so: a field is effective only through a schema entry, so the stray has no field to make required,
and no value is written differently. A schema version that strands a `requires` is one of the conflicts
MET-035 is meant to refuse, and until that is designed it is found only by running `checkAssignment`
over the type again.

`checkAssignment(assigned, candidate)` is the comparison run before an assignment is saved: every
default the candidate shares with a schema already assigned, and every field its `requires` names.

## Validation

`validate(effective, values)` returns every failure, not the first:

| Rule                       | Fails when                                                                                | Names its schemas |
| -------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `required`                 | A required field has no member, holds `null`, or a `many` field holds an empty array      | Yes               |
| `fixed`                    | A fixed field holds a value that differs from its default, `null` and `[]` included       | Yes               |
| `type`                     | A value is not the JSON its data type takes; `null` on a `one` field is a clear, not this | No                |
| `multiplicity`             | A `one` field holds an array, a `many` field does not, or a `many` field repeats a value  | No                |
| `maxValues`                | A `many` field holds more than it declares                                                | No                |
| The field's own validation | `minLength`, `pattern`, `min`, `scale` and the rest                                       | No                |

Rules that come from the field name no schema, because by MET-004 they are the field's alone. A
`required` failure that an assignment imposed names the schema assigned: the assignment is how that
schema applies to the component, and MET-022 asks for the schema, so an author told "required by
Regulatory" knows where to look. Every failure carries a stable `code` - `metadata.required`, `metadata.fixed`, `metadata.type` and so on - so the editor, the service and the publisher report one failure the same way, and a service refusal carries the same members inside service-foundations' error shape.

**A value whose field is not among the effective fields is not a validation failure.** It is a value
that will not be carried forward, and the editor shows it as that (MET-036) rather than as an error an
author has to fix.

### User values

`checkUserValues(values, effective, principals)` checks that every `user` value names a principal of
this tenant, where `principals` is a lookup the service supplies over the tenant's directory. A value
naming no principal the lookup can see - a mistyped identifier, or one from another tenant, which a
tenant-scoped lookup cannot see by construction - fails `metadata.user`. The service runs it on every
iteration it accepts and refuses on a failure, because a value naming nobody cannot be stored honestly.

**An inactive principal passes.** The picker offers only active principals (component-editor.md), so an
author does not choose a departed one, but the check does not refuse one. Refusing only a newly entered
departed user would make the same value valid on one component and invalid on another, which MET-004
forbids; refusing every departed user would fail a component whose value was entered before its user
left, which MET-029 forbids. Of the three, accepting is the only rule that breaks neither.

`checkUserValues` is not part of `validate`, which by MET-004 takes the field and the value and nothing
else, and runs at publish from recorded definitions with no directory to hand.

## Carrying forward

`carryForward(values, effective)` runs when the next version is written, and **never changes a value that
is present**:

| The value                                                | What happens                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Present, and its field is effective                      | Carried unchanged, even if it is now invalid - an invalid carried value is a failure the author sees, not one dropped for them |
| Present, and its field is no longer effective            | Returned in `notCarried`, which the version records in full (MET-036)                                                          |
| A clear, `null` or `[]`, for a field no longer effective | Dropped. It holds nothing to record                                                                                            |
| No member, and the field has a default                   | Takes the default. This is how a fixed field is filled, at creation or whenever a field reaches a component without a value    |
| No member, and no default                                | Stays without one                                                                                                              |

**A present value on a fixed field that differs from its default is not replaced.** Replacing it would
turn a write that should have been refused - through the API, an import, a migration - into a silent
change to a value MET-033 says must not be edited. It stays, and validation's `fixed` rule names it with
every schema that fixes the field. The service refuses a write that carries one, an iteration or a cut
([component-editor.md](component-editor.md)), and when a field becomes fixed while a component holds
another value, the editor applies the default where the author can see it and sends again.

## Canonical form

Values and `notCarried` take part in the version digest (ADR-0024), so they are serialised by the
content model's canonical rules: members in lexicographic order, strings in NFC, no insignificant
whitespace. A `many` field's array keeps its order, because MET-030 makes the order part of the value.

## Where the code lives

`packages/domain/src/metadata/`: the definition schemas, their migration harness, `checkValue`,
`resolveComponentFields`, `checkAssignment`, `validate`, `checkUserValues`, `carryForward` and
`definitionsFor`. No database, no network, no clock: the directory reaches `checkUserValues` as a
function the service passes in. The service loads definitions, calls these, and stores what they return.

## Verification

- **Every rule in the validation table has a test that fails without it**, the same discipline as the
  content model's: a rule whose test passes with the rule removed is not tested.
- **A fixture per definition schema version**, never deleted, migrated to current by one test.
- **Resolution over a matrix**: two schemas sharing a field with every combination of required, fixed
  and default, and assignments that tighten.
- **A property test for `carryForward`**: every input value other than a clear is either carried or in
  `notCarried`, exactly once, and every value carried is byte-identical to its input.
- **Clears survive**: a `one` field cleared to `null` and a `many` field cleared to `[]`, each with a
  default, are still cleared after `carryForward`.
- **Nothing present is replaced**: a fixed field holding another value comes out of `carryForward`
  unchanged, and `validate` names it with every schema that fixes it.
- **Assignments**: `checkAssignment` refuses a `requires` naming a field the schema does not group, and
  resolution given one produces the same fields as without it. A requirement from an assignment names
  the schema assigned.
- **User values**: a principal of the tenant passes, active or not; an identifier the lookup cannot see
  fails `metadata.user`.
- **Numbers**: a round trip of decimal strings that a float would corrupt.

## What was ruled out

- **JSON Schema as the definition language.** It can express a field's validation, and it cannot
  express required-by-assignment, fixed-from-default or the naming MET-022 requires without extensions
  that are a second language inside the first. The definitions are small and closed; zod over our own
  shape keeps them that way.
- **Numbers as JSON numbers.** See above: a regulated value must be the value entered.
- **Resolving through the document.** MET-013, and the reason MET exists.

## Open questions

| ID  | Question                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | How `pattern` is kept from backtracking exponentially. Banning backreferences and lookaround does not do it, since nested and overlapping quantifiers backtrack too. It needs either a linear-time engine that runs identically in the renderer, the service and the publisher, or a subset checked for those quantifiers as well. `pattern` does not ship until this is answered |
| New | Whether `text` needs a language. A free-text field on a component that is later translated (LOC) may need its value per language, which MET does not yet say                                                                                                                                                                                                                      |

## Review

[The review](../reviews/design-reviews/metadata-review.md) read the draft against the MET requirements it
claims and against its two ownership tables, and raised eight points. **Each was taken as an input, not
an instruction**, and checked against the requirement text and component-editor.md before deciding. All
eight held. One was answered differently from the way it was framed, because the obvious answer broke
another requirement.

| Point                                          | Decision                           | Change and reasoning                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MET-014, MET-015 and MET-016 in neither table  | **Accepted**                       | The count was right: 33 of 36. Rows added. MET-015 and MET-016 were already claimed by storage-and-versioning.md, which was checked rather than assumed; MET-014 is T2, and its consequence is carrying forward's while the audited act is undesigned                                                                                                                                      |
| Fixed-value application contradicts MET-033    | **Accepted**                       | Carrying forward now fills only a field with no member and never changes a value that is present. The unconditional reset would have turned a leaked write into a silent change instead of a named failure. Following it through found that a cut could carry a value fixed after the last iteration, so component-editor.md now refuses that cut the way it already refused the iteration |
| Default application can undo a clear           | **Accepted**                       | No member means never set; a clear is `null` or `[]` and is kept. Only no member takes a default. A representation was chosen over tracking which fields are newly effective, because that needs the previous definitions and still undoes a clear made in the same session as a field arrived                                                                                             |
| MET-029's entry-time clause has no owner       | **Accepted, answered differently** | `checkUserValues` refuses a value naming no principal of the tenant, at every iteration. The natural extension - refusing a newly entered departed user - was **declined**: it makes the same value valid on one component and invalid on another, against MET-004. MET-029 stays unclaimed, because its display half for documents and sections is undesigned                             |
| `requires` unchecked against the schema        | **Accepted**                       | A `requires` must name a field the assigned schema groups, and `checkAssignment` refuses one that does not. A stray left by a later schema version is ignored by resolution rather than thrown, since it cannot create a field or change a value, and is named as one of MET-035's conflicts                                                                                               |
| Naming a requirement an assignment imposed     | **Accepted**                       | It names the schema assigned: the assignment is how that schema applies, and MET-022 asks for the schema. The component type is not added to the failure, since it is the component's own                                                                                                                                                                                                  |
| The resolution section hedges half its gap     | **Accepted**                       | Both refusals are now named as undesigned - MET-008's act as well as MET-035's                                                                                                                                                                                                                                                                                                             |
| The pattern subset does not bound backtracking | **Accepted**                       | The claim was wrong: `(a+)+b` backtracks exponentially with no backreference or lookaround. Definitions now states the aim, not an achievement; the open question names the two ways to reach it and adds that it must behave identically in renderer, service and publisher. `pattern` does not ship until it is answered                                                                 |
