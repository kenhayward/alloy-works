# TPL - Templates and document instantiation

> **Status: v1, for review.**

## 1. Purpose

The artifact that binds the others, and how most documents in this product begin. This area owns
template authoring, the two definitions nothing else owns - the metadata schema and the starting
structure outline - the parameters a template declares, and what happens when a document is created
from one.

It exists because of a gap the ownership pass found: the scope defined a parameter set and specified
generating documents in bulk, but nothing covered a single document being created, and the template
designer named as a user in §5 had no area serving them.

## 2. Depends on

| Rests on                                               | What it fixes                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.19    | Template, parameter set, the six definitions a template binds |
| [STR](STR-structure-numbering-and-cross-references.md) | A document's live outline, which a starting outline becomes   |
| [DAT](DAT-data-connectivity-and-bindings.md)           | Query definitions and binding modes                           |

| Not here                                 | There   |
| ---------------------------------------- | ------- |
| A document's outline once it exists      | **STR** |
| Query definitions themselves             | **DAT** |
| Themes and style catalogues              | **STY** |
| Publishing layouts                       | **PUB** |
| Prompt libraries                         | **GEN** |
| The vocabulary a metadata field draws on | **LIB** |
| Generating many documents at once        | **REU** |
| Who may design a template                | **IAM** |

## 3. Templates

| ID          | Requirement                                                                                                                                               | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-001** | A template must be a named, versioned artifact belonging to a space                                                                                       | T1      | Specified |
| **TPL-002** | A template must bind exactly one of each definition: metadata schema, structure outline, query set, presentation theme, publishing layout, prompt library | T1      | Specified |
| **TPL-003** | A template must **own** its metadata schema and its structure outline, and must **reference** the other four                                              | T1      | Specified |
| **TPL-004** | A template must not be usable to create a document while any definition it references does not resolve                                                    | T1      | Specified |
| **TPL-005** | A template must be testable by creating a throwaway document from it, without that document entering the space                                            | T2      | Specified |
| **TPL-006** | Templates must be permissioned separately from the documents made from them, because designing one and writing one are different jobs                     | T1      | Specified |

**TPL-004 is cheap here and expensive anywhere else.** A template whose theme was deleted or whose
query set moved is discovered either when somebody tries to create a document, or at publish time a
fortnight later. The first costs a moment; the second has already cost somebody a day.

## 4. The metadata schema

| ID          | Requirement                                                                                                                 | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-007** | A metadata schema must declare typed fields, each with a type, whether it is required, and its validation rules             | T1         | Specified |
| **TPL-008** | A field must be able to draw its permitted values from a controlled vocabulary rather than being free text (**LIB**)        | T2         | Specified |
| **TPL-009** | A schema must be able to apply fields at document level and at component level, since the two are asked different questions | T1         | Specified |
| **TPL-010** | A field must be able to declare a default, and whether that default may be changed after instantiation                      | T1         | Specified |
| **TPL-011** | Changing a schema must not invalidate documents already created against an earlier version of it                            | Constraint | Specified |

## 5. The structure outline

| ID          | Requirement                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-012** | A structure outline must declare the sections a document starts with, and their order                                                         | T1         | Specified |
| **TPL-013** | It must be able to mark a section as required, meaning a document may not be published without it                                             | T1         | Specified |
| **TPL-014** | It must be able to declare a component that every document from this template includes - shared boilerplate, a standard methodology statement | T4         | Specified |
| **TPL-015** | It must declare what an author may change: whether sections can be added, removed or reordered                                                | T1         | Specified |
| **TPL-016** | A starting outline must not be a document's outline. Once instantiated, the document owns it (**STR**)                                        | Constraint | Specified |

## 6. Parameters

| ID          | Requirement                                                                                                                                                    | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-017** | A template must declare its parameters: name, type, whether required, and the permitted values or range of each                                                | T2      | Specified |
| **TPL-018** | A document must not be creatable until every required parameter has a value                                                                                    | T2      | Specified |
| **TPL-019** | A parameter must be usable to seed metadata, to resolve variables, and to supply arguments to the queries the template's bindings run                          | T2      | Specified |
| **TPL-020** | A parameter's value must be recorded on the document, and must be visible and auditable afterwards                                                             | T2      | Specified |
| **TPL-021** | Whether a parameter may be changed after instantiation must be declared, because changing "the site this report is about" is not the same as correcting a typo | T2      | Specified |

## 7. Instantiation

| ID          | Requirement                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-022** | Creating a document must materialise the starting outline, seed its metadata, resolve its variables, and establish its bindings                          | T2         | Specified |
| **TPL-023** | Whether a binding's query runs at creation and is pinned, or stays live, must follow the binding mode (**DAT-034**) rather than being a template setting | T2         | Specified |
| **TPL-024** | A failure during instantiation must leave no partial document behind                                                                                     | Constraint | Specified |
| **TPL-025** | Instantiation must record which template, and which template version, produced the document                                                              | T2         | Specified |
| **TPL-026** | Instantiation must be available through the API as well as the interface, since creating documents is the commonest thing another system will want to do | T2         | Specified |

## 8. Divergence

A starting shape is not a cage. After instantiation the document is the author's, and departing from
the template is expected rather than a fault - but it should be visible, because "this report does
not have the section every other report from this template has" is worth somebody noticing.

| ID          | Requirement                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **TPL-027** | A document must own its outline after instantiation, and must be able to depart from the template's starting shape | T1      | Specified |
| **TPL-028** | Departures must be listable: what this document has that the template does not, and what it lacks                  | T3      | Specified |
| **TPL-029** | A section the template marked required must not be removable without a stated reason, recorded on the document     | T3      | Specified |
| **TPL-030** | Publishing must fail where a required section is absent                                                            | T1      | Specified |

## 9. When a template changes

| ID          | Requirement                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-031** | Changing a template must not alter any document already created from it                               | Constraint | Specified |
| **TPL-032** | It must be possible to list the documents created from a given template version                       | T2         | Specified |
| **TPL-033** | Moving a document to a newer template version must be an explicit, audited act, and must be refusable | T3         | Specified |
| **TPL-034** | Such a move must report what it will change before it runs, and must be abandonable at that point     | T3         | Specified |
| **TPL-035** | A move that cannot be completed must leave the document exactly as it was                             | Constraint | Specified |

**Section 9 is a migration wearing the clothes of a setting**, which is why it is written as one.
The tempting design is a checkbox marked "keep this document up to date with its template". What
that means in practice is a document changing under an author who did not ask, possibly after
approval, which is the one thing an audited system must not do.

## 10. Validation

| ID          | Requirement                                                                                                | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-036** | A document must satisfy the metadata schema its template binds, and publishing must fail where it does not | T1      | Specified |
| **TPL-037** | Validation failures must name the field, the rule and the document                                         | T1      | Specified |
| **TPL-038** | Validation must run while authoring, not only at publish, so that a missing required field is known early  | T1      | Specified |

## 11. Bulk generation

Scope §7.3 puts parameterised bulk generation in **REU**. It rests on everything above: creating
forty documents from one template and forty parameter rows is the same act repeated, and it needs
the same guarantees.

| ID          | Requirement                                                                                                                            | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-039** | Bulk generation must report success or failure per row, and must never leave a partially created document behind for a row that failed | T4      | Specified |
| **TPL-040** | A cohort created together must be identifiable afterwards, so that forty reports can be tracked, reviewed and published as a set       | T4      | Specified |

## 12. Non-requirements

| ID          | Not this                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TPL-N01** | **No document that stays synchronised with its template.** Moving forward is a migration, taken deliberately (section 9)                                            |
| **TPL-N02** | **No template inheritance in the first instance.** A template that derives from another is a reasonable idea and an unreasonable amount of consequence; see TPL-Q02 |
| **TPL-N03** | **No definitions owned here that another area owns.** A template references a theme, a layout, a query set and a prompt library; it does not contain them           |
| **TPL-N04** | **Not a form builder.** A metadata schema describes a document, not a data-entry application                                                                        |

## 13. Open questions

| ID          | Question                                                                                                                                                                     | What would settle it                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **TPL-Q01** | **Can a document be created without a template at all?** A blank document is an obvious thing to want and an easy way to bypass every guarantee here                         | Whether early users need one. The likely answer is a minimal default template rather than no template                                    |
| **TPL-Q02** | **Do templates need to inherit (TPL-N02)?** An organisation with twelve report types that share eleven twelfths of their structure will ask                                  | The first customer with a family of templates. It interacts badly with versioning, since a change to a parent is a change to every child |
| **TPL-Q03** | **How much may a parameter change after instantiation (TPL-021)?** Changing the site a report is about invalidates every bound value in it                                   | Whether re-parameterising an existing document is a real workflow or a wish. If real, it is closer to a migration than an edit           |
| **TPL-Q04** | **Does a required component (TPL-014) float or pin?** Boilerplate that updates everywhere is the point of reuse; boilerplate that changes inside an approved document is not | A decision with **VER** and **LIF** about whether an approved document may contain a floating reference at all                           |

## 14. Traceability

| This document    | Rests on                                                              |
| ---------------- | --------------------------------------------------------------------- |
| Section 1        | Scope §7.19, and the ownership pass that found the gap                |
| TPL-003          | The two definitions no other area owned                               |
| TPL-016, TPL-027 | STR - a starting outline becomes a document's own                     |
| TPL-023          | DAT-034, binding modes decide when a query runs                       |
| Section 9        | Scope §7.19, existing documents not changing underneath their authors |
| Section 11       | Scope §7.3, parameterised bulk generation                             |
