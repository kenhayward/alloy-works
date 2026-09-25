# MET - Metadata and component types

> **Status: v1, reviewed.** Written when designing the content model found a component's metadata
> specified as a template's; reviewed, and the review answered in section 12. TPL, CNT, STR, SCH, REU,
> REL, LIB and VER changed to agree, and each says so in its change history.

## 1. Purpose

The typed information an artifact carries about itself, as distinct from its content: which fields
exist, how they are grouped, which artifacts they apply to, and what makes a value valid.

This area exists because the definition was in the wrong place and too thin to build from. **TPL**
owned "the metadata schema" as a thing a template contains, declared that a schema "must be able to
apply fields at document level and at component level" (TPL-009), and never said what a schema was.
That made a component's metadata depend on the template of whichever document referenced it - which
holds until a second document, made from a different template, references the same component. And the
scope already said otherwise: section 6 has a template compose definitions it "owns none of", and
decision 3 rejects a template owning metadata as a god-object.

Four concepts, and the words are used exactly:

| Term                | Means                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Field**           | One piece of typed information - `jurisdiction`, `study number`, `review cycle` - with its data type and what a valid value is            |
| **Metadata schema** | A named group of fields, managed and assigned as one unit, declaring which of its fields are required, their defaults, and which it fixes |
| **Component type**  | What kind of component this is - a narrative overview, a stability table section - and which schemas its components carry                 |
| **Content type**    | Not a definition here. What a component _holds_ - paragraphs, a table, an image - is the content model's (**CNT**), not this area's       |

A **template** is assigned schemas too, for its documents and their sections, and so is a **relationship type**, for its relationships. Those assignments are **TPL**'s and **REL**'s; what a schema is, and how assignments combine, is here.

## 2. Depends on

| Rests on                                                           | What it fixes                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.22, §9 decision 3 | A template composes definitions and owns none of them but its outline; the area's remit                         |
| [CNT](CNT-content-and-authoring.md)                                | What a component is, its versions, and its closed content root (CNT-144)                                        |
| [TPL](TPL-templates-and-document-instantiation.md)                 | How a template assigns schemas to a document and its sections, which MET-019 and MET-034 rest on                |
| [LIB](LIB-reference-libraries.md)                                  | The vocabulary a field draws its permitted values from, and the external sources one may use                    |
| [IAM](IAM-identity-tenancy-and-access-control.md)                  | What a user of the tenant is, which a user field's value names                                                  |
| [REL](REL-relationships-and-the-graph.md)                          | Relationship types, which assign schemas, and the guard that refuses a change breaking a relationship (REL-054) |
| [VER](VER-versioning-baselines-and-comparison.md)                  | What a version and a baseline pin                                                                               |
| [ADR-0006](../../decisions/0006-iteration-version-revision.md)     | Iteration, version and revision                                                                                 |

| Not here                                                                             | There            |
| ------------------------------------------------------------------------------------ | ---------------- |
| Which schemas a template assigns, and to documents or sections                       | **TPL**          |
| A document's and a section's field values, and how those are versioned and validated | **TPL**, **VER** |
| What a component holds, and its content vocabulary                                   | **CNT**          |
| Vocabularies themselves, and the external sources a vocabulary may draw from         | **LIB**          |
| Searching and faceting by field                                                      | **SCH**          |
| Who may be granted the permission MET-024 names                                      | **IAM**          |
| Approval gates, and what a transition may require                                    | **LIF**          |
| Which schemas a relationship type assigns, and what a change may not break there     | **REL**          |

Sections 5 to 7 are about **component** values. A document's and a section's values follow the same
field and schema rules - sections 3 and 4 hold for every artifact - but what happens to them over time
is **TPL**'s, because a document moves forward only by the deliberate act TPL section 9 describes. A relationship's values are **REL**'s: a relationship is edited in place, and a change that would break one is refused (REL-054).

**Used by, and not changed by this area:** SCH-002, SCH-018, SCH-044 and SCH-046 search and facet
over field values; REU-016, REU-036 and REU-038 resolve variables from document metadata; GEN-002 and
GEN-056 declare metadata as prompt context; TPL-019, TPL-022 and TPL-041 seed metadata from
parameters; IMP-018 and AST-030 export it.

**The word, not the concept.** These use "metadata" for something this area does not define, and are
listed so the next sweep does not have to re-read them: ADM-026 and ADM-042 (support access to
administrative data), AST-007 and IMP-012 (metadata embedded in an ingested file), IMP-009 (a Word
document's own properties), COL-050 (the record of a review), IAM-069 (administrative data about a
tenant), REU-048 (scanning an output for excluded content).

## 3. Fields

**A field is defined once and shared.** The alternative - each schema defining its own fields - makes
`jurisdiction` in one schema and `jurisdiction` in another two different things, so search cannot
facet across them (SCH-046) and a template assigned both needs a rule for which wins. With shared
fields the collision cannot arise: a field reached through two schemas is one field.

**What a value _is_ belongs to the field.** Its data type and its validation are the field's, so a
valid `jurisdiction` is valid everywhere it appears. What a group of fields _asks for_ - whether one is
required, its default, and whether it is fixed - belongs to the schema (section 4).

**The data types are closed**, the way the mark vocabulary is (CNT-006). A tenant configures fields;
it does not invent kinds of value, because every kind of value is something search, validation,
comparison and both output formats must each handle correctly. **Date, time, and date and time are
three types rather than one**, because they are three different questions: a submission date names a
day in no particular place, a daily cut-off names a time of day, and a signature timestamp names one
instant - which it can only do if it carries its offset from UTC.

**A user is a type of its own**, because "the responsible author" is somebody in this tenant rather
than a string that happens to match their name. A person leaves; the record that they were
responsible must not leave with them.

**A value from another system is a vocabulary, not a type.** A clinical study number drawn from a
study register is a value from a list that happens to be maintained elsewhere. Treating it as a
vocabulary whose values come from a declared source keeps one mechanism for "a value from a list", and
takes the rule LIB-033 to LIB-035 already set for citations: the value is held here with the identifier the source gave it, it can be re-checked against the source, and neither validation nor publishing ever depends on reaching that system. The vocabulary taking values from a source is **LIB-058**'s; what that means for a field is MET-032's.

**A field holding several values needs its own meaning of required and default.** Required means at
least one value, a default is a list, and the values keep the order they were given - which has to be
fixed rather than incidental, because the values are part of a version and a version's hash must not
depend on the order a store happened to return them in.

| ID          | Requirement                                                                                                                                                                                                                                                                     | Tranche | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **MET-001** | A field must be a tenant-wide definition with a stable identifier, a name, a data type and the validation its values must satisfy. A field grouped by more than one schema must be one field                                                                                    | T1      | Specified             |
| **MET-002** | The data types a field may take must be a closed set - text, number, date, time, date and time, true or false, and user - and a field must declare whether it holds one value or several. Adding a data type must be a product change, not a configuration option               | T1      | Specified             |
| **MET-028** | A date-and-time value must carry its offset from UTC, so that it names one instant. A date and a time must carry no offset                                                                                                                                                      | T1      | Specified             |
| **MET-029** | A user field's value must be a user of this tenant, and must remain readable - shown as no longer active - after that user is de-provisioned (**IAM-008**). A value must never become empty because the user it names has left                                                  | T1      | Superseded by MET-038 |
| **MET-038** | A user field's value must be a user of this tenant                                                                                                                                                                                                                              | T1      | Specified             |
| **MET-039** | A user field's value must remain readable - shown as no longer active - after that user is de-provisioned (**IAM-008**). A value must never become empty because the user it names has left                                                                                     | T2      | Specified             |
| **MET-030** | A field holding several values must hold no value twice and must keep its values in the order they were given, and must be able to declare the most values it may hold. For such a field, required must mean at least one value, and a default must be a list of values         | T1      | Specified             |
| **MET-003** | A field must be able to draw its permitted values from a vocabulary (**LIB**) rather than taking free text, whether the vocabulary is maintained in the tenant or takes its values from an external source (**LIB-058**). _Replaces TPL-008 and LIB-021, which said this twice_ | T2      | Specified             |
| **MET-032** | A field drawing on a vocabulary whose values come from an external source (**LIB-058**) must be validated against the values held in the tenant and never against the source, so that neither authoring nor publishing depends on reaching it                                   | T6      | Specified             |
| **MET-004** | Whether a value is valid must depend on its field alone: the same value for the same field must never be valid on one artifact and invalid on another                                                                                                                           | T1      | Specified             |

## 4. Metadata schemas

**A schema is a group, managed and assigned as one.** A tenant defines `Regulatory submission` once,
with its six fields, and assigns it to the component types and templates that need it. **Changing the
group changes it everywhere it is assigned**: an assignment always takes the latest version of a
schema. Nothing already written moves, because every artifact version records the definitions it was
written against (MET-017) - what changes is what the _next_ version is asked for.

**Schemas meet in exactly four places**, and never across them. A component takes its schemas from its component type; a document from its template's document-level assignments; a section from its template's section-level assignments; and a relationship from its relationship type (REL-053). A schema a template assigns and a schema a component type assigns
never govern the same artifact, because a component takes nothing from any document (MET-013).

**At one place, several schemas can apply**, which raises the only real composition question: two
schemas that share a field and disagree about it. Required composes safely - if either asks for the
field, it is required - and so does fixed. A default does not, because two defaults cannot both be the
value a new artifact starts with. So the conflict is refused at the two moments it can arise: when a
second schema is assigned beside the first, and when a new version of a schema would disagree with a
schema already assigned beside it somewhere. Floating assignments make the second moment real, and
where-used (MET-025) is what lets the refusal name every place.

**A default can also be broken from the field's side.** A schema's default is checked against its
field when the schema is saved, but the field is a definition of its own and moves on: a new version
that shortens its maximum length or narrows its range can leave a default no longer valid. For a fixed
field that is a value every artifact must carry and no author can make valid. So it is refused where
it happens, as a conflicting schema version is (MET-037).

**A schema can fix a value.** Some fields are not a question at all - every component of a kind carries
the same classification, and an author must not be able to change it. A fixed value comes from the
schema's default and cannot be edited on the artifact. Without this, the old TPL-010's "whether that
default may be changed" was a flag nothing read.

**An assignment may tighten a schema and nothing else.** A template or a component type may make an
optional field required for itself. It may not loosen one, change a default, fix or unfix a value, or
change validation, because then "the Regulatory submission schema" would mean different things in two
places and reading the schema would no longer tell anybody what an artifact must carry.

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                            | Tranche    | Status                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **MET-005** | A metadata schema must be a named, versioned, tenant-wide definition grouping fields, managed and assigned as one unit. _Replaces TPL-007_                                                                                                                                                                                                                             | T1         | Specified             |
| **MET-006** | A schema must declare, for each field it groups, whether the field is required, its default where it has one, and whether its value is fixed (MET-033). _Replaces TPL-010_                                                                                                                                                                                             | T1         | Specified             |
| **MET-033** | A value a schema fixes must be taken from the schema's default, which a fixed field must have, and must not be editable on the artifact: an attempt must be refused, naming the field and the schema (MET-022). A field must be fixed wherever any schema applied there fixes it                                                                                       | T1         | Specified             |
| **MET-034** | Schemas must apply at exactly four places - a component, through its component type; a document, through its template's document-level assignments; a section, through its template's section-level assignments (**TPL-054**); and a relationship, through its relationship type (**REL-053**). Schemas applied at different places must never compose on one artifact | Constraint | Specified             |
| **MET-007** | Where more than one schema applied at the same place (MET-034) groups the same field, the field must apply once, and must be required if any of those schemas requires it                                                                                                                                                                                              | T1         | Specified             |
| **MET-008** | Assigning a schema whose default for a field differs from the default of a schema already applied at the same place must be refused, naming the field and both schemas                                                                                                                                                                                                 | T1         | Specified             |
| **MET-035** | An assignment must always take the latest version of a schema. A new version of a schema must be refused where its default for a field would differ from that of a schema applied beside it at any place, naming the field, the other schema and every such place, and where it would make an existing relationship invalid (**REL-054**)                              | T1         | Superseded by MET-040 |
| **MET-040** | An assignment must always take the latest version of a schema. A new version of a schema must be refused where its default for a field would differ from that of a schema applied beside it at any place, naming the field, the other schema and every such place                                                                                                      | T1         | Specified             |
| **MET-037** | A new version of a field must be refused where it would make invalid the default of any schema grouping that field, naming the field, each such schema and its default                                                                                                                                                                                                 | T1         | Specified             |
| **MET-009** | An assignment of a schema must be able to make an optional field required for that assignment, and must not otherwise alter the schema: not make a required field optional, change a default, fix or unfix a value, or change a field's validation                                                                                                                     | T1         | Specified             |

## 5. Component types

**A component type is what kind of component this is, not what it holds.** A stability table section
and a narrative overview may both contain a table and three paragraphs; they differ in what they are
for, and so in what a reviewer, a search or a submission needs to know about them. What a component
holds is the content model's (**CNT**), and a type does not constrain it (MET-N01).

**A component takes its fields from its type and never from a document.** This is the asymmetry the
old TPL-009 got wrong. A document's fields come from its template, chosen once at instantiation. A
component is referenced by many documents, from many templates, so nothing about a document can decide
what a component must carry - the component has to know for itself.

**Every component has a type, so a tenant has a default one.** Creating a component in a hurry and
importing one from Word both need a type to take. A declared default that may assign no schemas at all
keeps the rule total without forcing a choice nobody can make yet - the same move TPL-046 makes for a
template that needs no prompt library.

| ID          | Requirement                                                                                                                                                                                                    | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **MET-010** | A component type must be a named, versioned, tenant-wide definition assigning zero or more metadata schemas, and must be distinct from the kinds of content a component holds                                  | T1         | Specified |
| **MET-011** | Every component must be of exactly one component type, chosen when it is created                                                                                                                               | T1         | Specified |
| **MET-012** | A tenant must declare a default component type, which may assign no schemas, so that creating or importing a component always has a type to take                                                               | T1         | Specified |
| **MET-013** | A component's fields must come from its component type and never from a document that references it, so that a component referenced by documents made from different templates carries the same fields in each | Constraint | Specified |
| **MET-014** | Changing a component's type must be an explicit, audited act, taking effect from the component's next version. Versions already cut must keep the type they were cut under                                     | T2         | Specified |

## 6. Values, versions and change

**Metadata values belong to the version.** Setting a value is a change to the component, recorded
through iteration and version like any other edit (ADR-0006), and a version's values never change once
it is cut. Otherwise a baseline, which pins component versions (VER-018), would pin the content and
leave the metadata free to move - and "what did this component say it was, as published" would have no
answer. The obvious objection, that reassigning an owner should not cut a version, does not apply:
owner and workflow state are already separate from metadata (SCH-018) and are **LIF**'s.

**Values sit beside the content, not inside it.** The content document's root is closed (CNT-144), and
that closure is what makes a content hash mean something. Metadata values are part of the version,
held next to its content.

**Definitions change without breaking anything already written.** Component versions are immutable, so
the rule that works for relationships - refuse a change that would make an existing instance invalid
(REL-036) - would mean a required field could never be added once a tenant had any content, because no
immutable version can be filled in. Instead each version records the definitions it was written
against and is judged by those for ever, and the _next_ version is written against the current ones.
A newly required field is asked for the next time somebody edits the component, which is the moment
they can answer it.

**A value whose field no longer applies is not carried forward, and says so.** When a component's type
changes, or a schema drops a field, the next version is written against definitions under which some of
its values have no field. Shared fields decide most of these cases for free: a field present under both
the old and the new definitions is the same field, so its value simply carries over. A value with no
field left is not carried into the next version - keeping it would make it look governed when nothing
governs it - and the version records each value it left behind, so a reader can see what went and why.
Earlier versions keep every value they had.

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                | Tranche    | Status                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **MET-015** | A component's metadata values must belong to its version: setting one must be a change to the component (**ADR-0006**), a version's values must never change once it is cut, and a baseline pinning the version must pin them (**VER-018**)                                                                                                                | Constraint | Specified             |
| **MET-016** | Metadata values must be held beside a component's content and never inside the content document (**CNT-144**)                                                                                                                                                                                                                                              | Constraint | Specified             |
| **MET-017** | Every component version must record the versions of the component type, schemas and fields it was written against, and must be validated against those for as long as it exists                                                                                                                                                                            | Constraint | Specified             |
| **MET-018** | A component's next version must be written against the current versions of its type, schemas and fields, so that a field newly made required is asked for the next time the component is edited                                                                                                                                                            | T1         | Specified             |
| **MET-036** | Where a component's next version is written against definitions under which a value's field no longer applies - its type changed, or a schema no longer groups the field - that value must not be carried into the version, and the version must record each value it did not carry, by field. A value whose field still applies must be carried unchanged | Constraint | Specified             |
| **MET-019** | Changing a field, a schema or a component type must never make an existing component version, document or section invalid. _Replaces TPL-011, which said this of documents only_                                                                                                                                                                           | Constraint | Specified             |
| **MET-020** | Every change to a field, a schema or a component type must create a new version of it and must be audited                                                                                                                                                                                                                                                  | T1         | Superseded by MET-041 |
| **MET-041** | Every change to a field, a schema or a component type must create a new version of it                                                                                                                                                                                                                                                                      | T1         | Specified             |

## 7. Validation

**Metadata is enforced at publish, and shown while authoring.** A version may be cut, and a revision
designated, with a required field missing or a value invalid; publishing a document that references
such a version fails, exactly as it fails for the document's own fields. The gap is visible from the
moment it exists (MET-021), so publish is where it is enforced rather than where it is discovered.

**The consequence, stated so it is a decision rather than a surprise:** a component can pass its
approval gate and be issued as a revision with a required field missing. **MET-Q03** asks whether a
workflow definition should be able to require complete metadata at its own gate, which is where a
regulated regime that needs it would say so.

| ID          | Requirement                                                                                                                                                                                                                        | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **MET-021** | Validation must run while authoring, showing a missing or invalid field as it arises rather than only when publishing. _Replaces TPL-038, which said this of documents only_                                                       | T1      | Specified |
| **MET-022** | A validation failure must name the field, the rule, the artifact, and the schema that applied the rule. _Replaces TPL-037_                                                                                                         | T1      | Specified |
| **MET-023** | Publishing a document must fail where any component version it references is missing a required field or holds an invalid value. Neither cutting a version nor designating a revision may be refused for that reason (**MET-Q03**) | T1      | Specified |

## 8. Managing the definitions

**Fields, schemas and component types are tenant-wide.** One `jurisdiction` facets across every space,
and a component reused into another space (IAM-016) never carries a type that space cannot see.

**A name picks out one definition.** Two schemas both called "Regulatory" make every assignment screen
and every validation message ambiguous, so a name is unique among definitions of its kind - the rule
REL-040 already sets for relationship types.

**Managing them is a job of its own.** Designing component types is a content architect's work, not a
tenant administrator's, and it is not the same job as designing a template (TPL-006) - so it is a
permission that can be granted to somebody who holds neither.

| ID          | Requirement                                                                                                                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **MET-031** | The name of a field, of a schema and of a component type must each be unique within the tenant among definitions of its kind (**REL-040** is the same rule for a relationship type)                                                                                                                        | T1         | Specified |
| **MET-024** | Managing fields, schemas and component types must be a permission of its own, grantable without tenant administration and separate from designing templates (**TPL-006**, **IAM**)                                                                                                                         | T1         | Specified |
| **MET-025** | A field, a schema and a component type must each record where it is used - by schemas, component types, templates and relationship types, and through them how many artifacts - and changing one must show what the change affects before it is made (**DAT-016** is the same rule for a query definition) | T2         | Specified |
| **MET-026** | Deleting a field, a schema or a component type that anything uses must be refused, naming what depends on it. It must never cascade                                                                                                                                                                        | Constraint | Specified |
| **MET-027** | A field, a schema and a component type must each be deprecable: no longer offered for new use, still valid wherever it is used, with a replacement namable (**REL-037** and **LIB-055** are the same state elsewhere)                                                                                      | T3         | Specified |

## 9. Non-requirements

| ID          | Not this                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MET-N01** | **A component type does not govern content.** It decides which fields apply and nothing else; every type has the same closed content vocabulary. See MET-Q01 |
| **MET-N02** | **No override but tightening.** An assignment may make an optional field required and may change nothing else about a schema (MET-009)                       |
| **MET-N03** | **No field local to one schema.** Every field is a shared definition, which is what keeps one field one facet                                                |
| **MET-N04** | **Not a form builder.** A schema describes an artifact; it is not a data-entry application. _Carries TPL-N04 across_                                         |
| **MET-N05** | **No definitions per space.** Fields, schemas and component types belong to the tenant. See MET-Q04                                                          |

## 10. Open questions

| ID          | Question                                                                                                                                                                                             | What would settle it                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MET-Q01** | **Should a component type be able to constrain its content?** A stability table section that holds no table is probably a mistake, and MET-N01 says nothing catches it                               | A real type whose content is wrong often enough to matter. A restriction to a subset of the seven blocks needs no content-model change, but makes validating content depend on the type |
| **MET-Q02** | **Do assets take typed metadata through an asset type?** AST-027 and SCH-004 search assets "by metadata" and AST-031 records a fixed set of properties; neither says whether an asset carries fields | Whether a customer needs to classify assets by more than their recorded properties. If so, an asset type is this area's component type again, and should reuse it rather than copy it   |
| **MET-Q03** | **Should an approval gate be able to require complete metadata?** Enforcement is at publish (MET-023), so an approved, issued revision can be missing a required field                               | A decision with **LIF**. LIF-061 already lets a workflow definition declare what a transition requires, which is where a regime needing complete metadata at approval would say so      |
| **MET-Q04** | **Should a space be able to narrow the component types and schemas it offers?** A clinical space offered finance component types is noise, and MET-N05 keeps every definition visible everywhere     | The first tenant with enough types for the list to be a problem. Narrowing what is offered changes nothing already created, so it can be added later without a migration                |

## 11. Traceability

| This document | Rests on                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 1     | Scope §6 and §9 decision 3; TPL-009 and CNT-Q12; issue #72                                                                                    |
| Section 2     | The review's document and section boundary point                                                                                              |
| Section 3     | TPL-007, TPL-008 and LIB-021; SCH-046, which needs one field to be one facet; LIB-033 to LIB-035; IAM-008                                     |
| Section 4     | TPL-007 and TPL-010; the review's composition point; TPL-054 and REL-053, the other places schemas apply                                      |
| Section 5     | Issue #72's transclusion argument; CNT-142 to CNT-144; TPL-046                                                                                |
| Section 6     | ADR-0006; VER-018; CNT-144; TPL-011 and TPL-043; REL-036, whose rule is right for relationships and wrong here; the review's value-fate point |
| Section 7     | TPL-036 to TPL-038; LIF-038 and LIF-061                                                                                                       |
| Section 8     | ADM-001; TPL-006; IAM-016; DAT-016, DAT-065, REL-037, REL-040 and LIB-055                                                                     |

## 12. Change history

One row per point, against [the review](<../../reviews/MET - Metadata and component types.md>) that
prompted it. **Every row here was still a draft when the review arrived, with no identifier allocated
to anything**, so rows were edited in place rather than superseded; the rules for what gets a new
identifier once a row is in the corpus are in [the index](README.md#how-a-requirement-is-written). New
rows take the next free number and sit beside the rows they relate to, so that the review's references
to MET-002, MET-006, MET-008 and MET-014 still point at what it read.

| Point                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field types: date, time, date and time, and user       | **MET-002** now lists date, time, date and time as three types, and user. **MET-028** makes a date and time carry its UTC offset and a date or a time carry none, because the three name a day, a time of day and an instant. **MET-029** keeps a user value readable after that user is de-provisioned, rather than letting it go empty                                                                                                                                                                                                       |
| Reference types drawn from another system              | **Yes, a vocabulary** - **MET-032**, and **MET-003** now says a vocabulary may be maintained here or drawn from a source. It takes LIB-033 to LIB-035's rule for citations: held locally with the source's identifier, re-checkable, never depended on at validation or publish. **Tranche T6, and that is a flag rather than a settled answer:** LIB's external-source machinery (LIB-031 to LIB-038) is all T6, and a study register feeding study numbers may need pulling forward with it. Needs a LIB change in section 2 of the proposal |
| Metadata schemas should have a name                    | **Already required** - MET-005, and MET-001 and MET-010 for fields and component types. What was missing was that a name picks out one definition: **MET-031** makes a name unique among definitions of its kind, as REL-040 does for relationship types                                                                                                                                                                                                                                                                                       |
| MET-006's "default may be changed" is never used       | **Given a meaning rather than cut.** It is now a **fixed** value (**MET-006**, **MET-033**): taken from the schema's default, not editable on the artifact, refused and named when somebody tries, and fixed wherever any schema at that place fixes it. **MET-009** adds fixing and unfixing to what an assignment may not do                                                                                                                                                                                                                 |
| Value fate when a type or schema changes               | **MET-036**. A value whose field still applies carries over unchanged - shared fields make that the common case, including across a type change. A value with no field left is not carried into the next version, and the version records each one it left behind. Earlier versions keep theirs under MET-015. Section 6 gains the reasoning                                                                                                                                                                                                   |
| "At the same place", and composition across levels     | **MET-034** names the three places - component through its type, document and section through the template - and says schemas at different places never compose on one artifact. **MET-007** now refers to it                                                                                                                                                                                                                                                                                                                                  |
| A schema's new version can make assignments conflict   | **Assignments float** (**MET-035**): they always take a schema's latest version, which is what "managed as a group" needs. So the conflict check moves to where the change happens - a new schema version that would disagree with a co-assigned schema anywhere is refused, naming each place. MET-019 protects versions and MET-035 now protects assignments. **Consequence for section 2 of the proposal:** a document must record the schema versions it was created against, because a template version no longer decides them            |
| Multi-value fields have no required or default meaning | **MET-030**: required means at least one value, a default is a list, no value twice, the order given is kept, and a field may declare the most values it holds. The order is fixed rather than incidental because values are part of a version, and a version's hash must not depend on the order a store returns them in                                                                                                                                                                                                                      |
| The document and section boundary is implied           | A **Not here** row gives a document's and a section's values, and their versioning and validation, to **TPL** and **VER**; **TPL** joins **Rests on**; and a paragraph in section 2 says sections 3 and 4 hold for every artifact while sections 5 to 7 are about components                                                                                                                                                                                                                                                                   |

### Counts

|                  | Before the review | After |
| ---------------- | ----------------- | ----- |
| Requirements     | 27                | 36    |
| Non-requirements | 5                 | 5     |
| Open questions   | 4                 | 4     |

### From drafting section 2 of the proposal

Drafting the changes to the other areas found three things this document had to change to agree with
them, and two it deliberately did not ask for.

| What was found                                                                                                                                                                             | Change                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship types had a metadata shape of their own (REL-003), a second schema system. Consolidating it into metadata schemas (REL-053) makes a relationship a fourth place schemas apply | **MET-034** and section 4's prose now name four places. Section 1 and the boundary rows name REL beside TPL                                                                                                                         |
| A relationship is edited in place, so a schema or field change that breaks one has to be refused rather than recorded against (REL-054)                                                    | **MET-035** now refuses a new schema version that would make an existing relationship invalid, as well as one whose default conflicts                                                                                               |
| MET-032 described a vocabulary taking values from a source, which is LIB's to say - the duplication TPL-008 and LIB-021 had been                                                           | **MET-032 narrowed** to the field side: validate against the values held, never the source. The vocabulary side is **LIB-058**, and **MET-003** cites it                                                                            |
| Where-used named only definitions of this area                                                                                                                                             | **MET-025** now reaches templates and relationship types, which assign schemas                                                                                                                                                      |
| Not changed: **IAM**. MET-024 names a permission of its own, and IAM-019's permission set is explicitly a floor ("at least")                                                               | No IAM row. TPL-006 had already set the precedent of an area naming a permission its own work needs                                                                                                                                 |
| Not changed: **VER-011**, which does not list fields, schemas or component types among what is versioned                                                                                   | MET-020 versions them; the reasoning is in VER's change history                                                                                                                                                                     |
| Pointers re-pointed in other areas                                                                                                                                                         | GEN-054 to TPL-052; PUB-082 to VER-055; TPL-045 to MET-022; TPL-046 to TPL-052; CNT-142 to STR-060. Change histories and traceability rows for superseded requirements were left as written, because they record what was true then |

| Counts           | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 36     | 36    |
| Non-requirements | 5      | 5     |
| Open questions   | 4      | 4     |

### From planning the metadata rules

Not a review. Writing the implementation plan for [metadata.md](../../design/metadata.md) found a
conflict the requirements refused from one side only.

| What was found                                                                                                                                                                                                                                               | Change                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A schema's default is valid against its field when the schema is saved, and nothing checks it again. A later field version that tightens validation leaves the default invalid, and a fixed field then fails every publish with no author able to correct it | **MET-037** refuses that field version where it happens, naming the field, each schema and its default - the field-side counterpart of MET-035's refusal of a conflicting schema version |

| Counts           | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 36     | 37    |
| Non-requirements | 5      | 5     |
| Open questions   | 4      | 4     |

### From the T1 audit against the code (2026-09-25)

[The T1 audit](<../../reviews/T1 - Audit against the code.md>) read every T1 requirement against the code
and against what T1 can deliver. A row moving tranche whole keeps its identifier, and only its tranche
changes; a row split by tranche is superseded by its T1 half, and the rest becomes rows of their own.

| What was found                                           | Change                                                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| De-provisioning a user needs SCIM (IAM-008), which is T2 | **MET-029 superseded by MET-038** - a value a user of this tenant, T1 - with **MET-039**, a value staying readable after its user leaves, in T2                                               |
| Relationships are **REL**'s, in T4                       | **MET-035 superseded by MET-040**, without its relationship clause. A change that would make a relationship invalid is already refused by **REL-054**, a Constraint, so no row is made for it |
| An audited act needs the audit log, which is T3          | **MET-020 superseded by MET-041**, without "must be audited". An administrative action is already recorded by **LIF-026**, in T3, so no row is made for it                                    |

| Counts           | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 37     | 41, of which 3 superseded |
| Non-requirements | 5      | 5                         |
| Open questions   | 4      | 4                         |
