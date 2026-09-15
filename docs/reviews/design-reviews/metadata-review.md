# Review of Metadata Design Document

Reviewed against the MET requirements this document claims in _Requirements owned_, and against its two ownership tables. Findings are gaps, inconsistencies or errors in metadata.md only; where a finding points at an unmade hand-off to another design (component-editor, storage-and-versioning, definitions management), that is noted rather than reviewed. The other owned rows were checked against their requirement text and match as stated.

## MET-014, MET-015 and MET-016 are in neither table

**Gap.** The two tables account for 33 of the 36 MET requirements; these three appear in neither:

| ID          | Requirement (abridged)                                                                                                    | What this document already implies                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **MET-014** | Changing a component's type is an explicit, audited act taking effect from its next version; cut versions keep their type | `carryForward` plus the recorded definitions (MET-017) implement the "takes effect from the next version" half; the act itself is unclaimed |
| **MET-015** | A component's metadata values belong to its version (ADR-0006); a cut version's values never change                       | Values take part in the version digest here, but ownership of the rule is unstated - presumably storage-and-versioning.md                   |
| **MET-016** | Metadata values are held beside the content, never inside it (**CNT-146**)                                                | The intro's split ("Definitions and values are stored by storage-and-versioning.md") implies it; unclaimed                                  |

The document's own convention is that every MET requirement is either owned or named as left unclaimed. Add a row for each, even where the answer is another design.

## Fixed-value application contradicts MET-033

**Inconsistency.** Carrying forward says: "When a component is created, and when a next version is written, every fixed field takes its default and every unset field with a default takes that default." Read literally, the first clause is unconditional - a present value on a fixed field is reset to the default at every write. That silently coerces exactly what **MET-033** forbids ("must not be editable on the artifact: attempts must be refused, naming the field and the schema"), and it makes validation's `fixed` rule unreachable on the normal write path, which the paragraph concedes ("catches only a value that was changed some other way"). The not-owned table assigns refusal to the editor's save, so in the intended flow a changed fixed value never reaches this code; but then the unconditional reset is dead weight that converts any leak - an API write, an import, a migration - into silent coercion rather than a named failure. If fill-only was intended, say so: "every _unset_ field with a default takes it", and let the `fixed` rule catch a present-but-different value with its schemas named.

## Default application can undo an explicit clear

**Gap.** "Every unset field with a default takes that default" runs on every next-version write, but the document never says how a cleared value is represented or whether it counts as unset. If an author clearing an optional `one` field leaves it indistinguishable from never-set, the default resurrects on the next save and the clear is silently undone. Define the representation of "no value" for a `one` field and state which of {never set, explicitly cleared} takes the default.

## MET-029's entry-time clause has no owner

**Gap.** The not-owned row covers only the display half: "showing a de-provisioned user as no longer active is IAM's state and the editor's rendering." **MET-029** also requires that "a user field's value must be a user of this tenant". `checkValue` cannot enforce that by construction (**MET-004**: field and value only), and nothing else claims it. Say where entry-time enforcement lives - the editor presenting users from the directory, or a service-side check against IAM - so the clause is owned somewhere.

## `requires` is unchecked against the assigned schema

**Gap.** A component type's assignment is `{ schema, requires }`, "where `requires` lists fields the assignment makes required", but nothing states that those fields must be among the ones the assigned schema groups, and Resolution ("For each field reached through any assignment:") does not say what a stray identifier does: it either creates an effective field no schema entry supports (against **MET-009** and **MET-013**) or is silently ignored (an invisible typo). `checkAssignment`'s stated scope is the default comparison only. Add the constraint to the definition schema and say where a violation is refused.

## Naming a requirement imposed by an assignment

**Minor gap.** Resolution keeps "each source" of `required`, but a failure's shape is `{ code, field, rule, schemas, detail }` and **MET-022** requires naming the schema that applied the rule. Where an assignment - not any schema entry - made the field required, say what appears in `schemas`: the assigned schema (defensible, since the assignment is how that schema reaches the component), nothing, or the component type. As written the case is unspecified.

## The resolution section hedges only half its own gap

**Minor inconsistency.** It says "MET-008 refuses them at assignment and MET-035 refuses a schema version that would introduce them, so a correct tenant never reaches the error - but MET-035's refusal is not designed yet." Per this document's own not-owned table, **MET-008**'s refusal act is equally undesigned: "`checkAssignment` finds every conflict, but refusing the assignment is the act of the definitions-management service, which is not designed." The defensive throw stands on both gaps; name both.

## The stated pattern subset does not bound backtracking

**Error.** Definitions says a `pattern` is "an anchored regular expression from a safe subset - no backreferences, no lookaround - so that a pattern a tenant writes cannot make validation take exponential time". Banning those two constructs is necessary but not sufficient: nested or overlapping quantifiers such as `(a+)+b` still backtrack exponentially in standard engines. The Open questions table already concedes the subset needs "a named engine or a checked subset to enforce it"; the Definitions paragraph should not state exponential-time safety as achieved by the two bans alone.
