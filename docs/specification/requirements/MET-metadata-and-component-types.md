# MET - Metadata and component types

> **Status: DRAFT for review - section 1 of the metadata proposal.** Not yet in the corpus: no row
> here is allocated until the pull request that lands it. Sections 2 to 4 of the proposal - the
> changes to TPL, CNT, STR, SCH, REU, REL and LIB, and the scope edits - are not in this file yet.
>
> **How to mark this up.** Edit anything directly: reword a row, change a tranche, delete a row, add
> one with `MET-???` as its identifier. Where you want to say something rather than change it, add a
> line starting `> **Ken:**` under the paragraph or table it is about. The draft is committed as it
> stood when it was handed to you, so `git diff` shows exactly what you changed and nothing else.

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

| Term                | Means                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Field**           | One piece of typed information - `jurisdiction`, `study number`, `review cycle` - with its data type and what a valid value is      |
| **Metadata schema** | A named group of fields, managed and assigned as one unit, declaring which of its fields are required and their defaults            |
| **Component type**  | What kind of component this is - a narrative overview, a stability table section - and which schemas its components carry           |
| **Content type**    | Not a definition here. What a component _holds_ - paragraphs, a table, an image - is the content model's (**CNT**), not this area's |

A **template** is assigned schemas too, for its documents and their sections. That assignment is
**TPL**'s; what a schema is, and how assignments combine, is here.

## 2. Depends on

| Rests on                                                       | What it fixes                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`Project_Scope.md`](../Project_Scope.md) §6, §9 decision 3    | A template composes definitions and owns none of them                    |
| [CNT](CNT-content-and-authoring.md)                            | What a component is, its versions, and its closed content root (CNT-144) |
| [LIB](LIB-reference-libraries.md)                              | The vocabulary a field draws its permitted values from                   |
| [VER](VER-versioning-baselines-and-comparison.md)              | What a version and a baseline pin                                        |
| [ADR-0006](../../decisions/0006-iteration-version-revision.md) | Iteration, version and revision                                          |

| Not here                                                       | There   |
| -------------------------------------------------------------- | ------- |
| Which schemas a template assigns, and to documents or sections | **TPL** |
| What a component holds, and its content vocabulary             | **CNT** |
| Vocabularies themselves                                        | **LIB** |
| Searching and faceting by field                                | **SCH** |
| Who may be granted the permission MET-024 names                | **IAM** |
| Approval gates, and what a transition may require              | **LIF** |
| A relationship type's fields                                   | **REL** |

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
required, and its default - belongs to the schema (section 4).

**The data types are closed**, the way the mark vocabulary is (CNT-006). A tenant configures fields;
it does not invent kinds of value, because every kind of value is something search, validation,
comparison and both output formats must each handle correctly.

| ID          | Requirement                                                                                                                                                                                                                            | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **MET-001** | A field must be a tenant-wide definition with a stable identifier, a name, a data type and the validation its values must satisfy. A field grouped by more than one schema must be one field                                           | T1      | Specified |
| **MET-002** | The data types a field may take must be a closed set - text, number, date, and true or false - and a field must declare whether it holds one value or several. Adding a data type must be a product change, not a configuration option | T1      | Specified |
| **MET-003** | A field must be able to draw its permitted values from a vocabulary (**LIB**) rather than taking free text. _Replaces TPL-008 and LIB-021, which said this twice_                                                                      | T2      | Specified |
| **MET-004** | Whether a value is valid must depend on its field alone: the same value for the same field must never be valid on one artifact and invalid on another                                                                                  | T1      | Specified |

## 4. Metadata schemas

**A schema is a group, managed and assigned as one.** A tenant defines `Regulatory submission` once,
with its six fields, and assigns it to the component types and templates that need it. Changing the
group changes it everywhere it is assigned, through the versioning in section 6 rather than
underneath anybody.

**An artifact can be governed by several schemas at once**, which raises the only real composition
question: two schemas that share a field and disagree about it. Required composes safely - if either
asks for the field, it is required. A default does not, because two defaults cannot both be the value
a new artifact starts with, so the conflict is refused when the second schema is assigned rather than
resolved silently later.

**An assignment may tighten a schema and nothing else.** A template or a component type may make an
optional field required for itself. It may not loosen one, change a default, or change validation,
because then "the Regulatory submission schema" would mean different things in two places and reading
the schema would no longer tell anybody what an artifact must carry.

| ID          | Requirement                                                                                                                                                                                                                  | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **MET-005** | A metadata schema must be a named, versioned, tenant-wide definition grouping fields, managed and assigned as one unit. _Replaces TPL-007_                                                                                   | T1      | Specified |
| **MET-006** | A schema must declare, for each field it groups, whether the field is required, its default where it has one, and whether that default may be changed once set. _Replaces TPL-010_                                           | T1      | Specified |
| **MET-007** | Where more than one schema applied to the same artifact groups the same field, the field must apply once, and must be required if any of those schemas requires it                                                           | T1      | Specified |
| **MET-008** | Assigning a schema whose default for a field differs from the default of a schema already applied at the same place must be refused, naming the field and both schemas                                                       | T1      | Specified |
| **MET-009** | An assignment of a schema must be able to make an optional field required for that assignment, and must not otherwise alter the schema: not make a required field optional, change a default, or change a field's validation | T1      | Specified |

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

| ID          | Requirement                                                                                                                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **MET-015** | A component's metadata values must belong to its version: setting one must be a change to the component (**ADR-0006**), a version's values must never change once it is cut, and a baseline pinning the version must pin them (**VER-018**) | Constraint | Specified |
| **MET-016** | Metadata values must be held beside a component's content and never inside the content document (**CNT-144**)                                                                                                                               | Constraint | Specified |
| **MET-017** | Every component version must record the versions of the component type, schemas and fields it was written against, and must be validated against those for as long as it exists                                                             | Constraint | Specified |
| **MET-018** | A component's next version must be written against the current versions of its type, schemas and fields, so that a field newly made required is asked for the next time the component is edited                                             | T1         | Specified |
| **MET-019** | Changing a field, a schema or a component type must never make an existing component version, document or section invalid. _Replaces TPL-011, which said this of documents only_                                                            | Constraint | Specified |
| **MET-020** | Every change to a field, a schema or a component type must create a new version of it and must be audited                                                                                                                                   | T1         | Specified |

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

**Managing them is a job of its own.** Designing component types is a content architect's work, not a
tenant administrator's, and it is not the same job as designing a template (TPL-006) - so it is a
permission that can be granted to somebody who holds neither.

| ID          | Requirement                                                                                                                                                                                                           | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **MET-024** | Managing fields, schemas and component types must be a permission of its own, grantable without tenant administration and separate from designing templates (**TPL-006**, **IAM**)                                    | T1         | Specified |
| **MET-025** | A field, a schema and a component type must each record where it is used, and changing one must show what the change affects before it is made (**DAT-016** is the same rule for a query definition)                  | T2         | Specified |
| **MET-026** | Deleting a field, a schema or a component type that anything uses must be refused, naming what depends on it. It must never cascade                                                                                   | Constraint | Specified |
| **MET-027** | A field, a schema and a component type must each be deprecable: no longer offered for new use, still valid wherever it is used, with a replacement namable (**REL-037** and **LIB-055** are the same state elsewhere) | T3         | Specified |

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

| This document | Rests on                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Section 1     | Scope §6 and §9 decision 3; TPL-009 and CNT-Q12; issue #72                                                     |
| Section 3     | TPL-007, TPL-008 and LIB-021; SCH-046, which needs one field to be one facet                                   |
| Section 4     | TPL-007 and TPL-010                                                                                            |
| Section 5     | Issue #72's transclusion argument; CNT-142 to CNT-144; TPL-046                                                 |
| Section 6     | ADR-0006; VER-018; CNT-144; TPL-011 and TPL-043; REL-036, whose rule is right for relationships and wrong here |
| Section 7     | TPL-036 to TPL-038; LIF-038 and LIF-061                                                                        |
| Section 8     | ADM-001; TPL-006; IAM-016; DAT-016, DAT-065, REL-037 and LIB-055                                               |
