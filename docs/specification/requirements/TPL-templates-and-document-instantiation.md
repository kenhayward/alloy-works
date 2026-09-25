# TPL - Templates and document instantiation

> **Status: v1, reviewed.**

## 1. Purpose

The artifact that binds the others, and how most documents in this product begin. This area owns
template authoring, the one definition nothing else owns - the starting structure outline - which metadata schemas a template assigns to its documents and their sections, the parameters a template declares, and what happens when a document is created
from one.

It exists because of a gap the ownership pass found: the scope defined a parameter set and specified
generating documents in bulk, but nothing covered a single document being created, and the template
designer named as a user in §5 had no area serving them.

## 2. Depends on

| Rests on                                               | What it fixes                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.19    | Template, parameter set, the six definitions a template binds         |
| [STR](STR-structure-numbering-and-cross-references.md) | A document's live outline, which a starting outline becomes           |
| [DAT](DAT-data-connectivity-and-bindings.md)           | Query definitions and binding modes                                   |
| [MET](MET-metadata-and-component-types.md)             | Fields, metadata schemas and how assigned schemas compose (MET-034)   |
| [LIB](LIB-reference-libraries.md)                      | The vocabulary a parameter's permitted values may come from (TPL-045) |
| [REU](REU-reuse-variants-and-conditional-profiling.md) | What a variable is, and what it resolves against                      |

| Not here                                                    | There   |
| ----------------------------------------------------------- | ------- |
| A document's outline once it exists                         | **STR** |
| Query definitions themselves                                | **DAT** |
| Themes and style catalogues                                 | **STY** |
| Publishing layouts                                          | **PUB** |
| Prompt libraries                                            | **GEN** |
| Fields and metadata schemas themselves, and component types | **MET** |
| The vocabulary a metadata field draws on                    | **LIB** |
| Generating many documents at once                           | **REU** |
| Who may design a template, and who may create from one      | **IAM** |
| What a variable is, and how one resolves                    | **REU** |

## 3. Templates

| ID          | Requirement                                                                                                                                                                                                     | Tranche | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **TPL-001** | A template must be a named, versioned artifact belonging to a space                                                                                                                                             | T1      | Specified             |
| **TPL-002** | A template must bind exactly one of each definition: metadata schema, structure outline, query set, presentation theme, publishing layout, prompt library                                                       | T1      | Superseded by TPL-052 |
| **TPL-003** | A template must **own** its metadata schema and its structure outline, and must **reference** the other four                                                                                                    | T1      | Superseded by TPL-053 |
| **TPL-052** | A template must bind exactly one structure outline, query set, presentation theme, publishing layout and prompt library, and zero or more metadata schemas (**MET-005**)                                        | T1      | Superseded by TPL-059 |
| **TPL-059** | A template must bind exactly one structure outline, presentation theme and publishing layout, and zero or more metadata schemas (**MET-005**)                                                                   | T1      | Specified             |
| **TPL-060** | A template must bind exactly one query set                                                                                                                                                                      | T2      | Specified             |
| **TPL-061** | A template must bind exactly one prompt library                                                                                                                                                                 | T5      | Specified             |
| **TPL-053** | A template must **own** its structure outline, and must **reference** every other definition it binds, its metadata schemas included                                                                            | T1      | Specified             |
| **TPL-004** | A template must not be usable to create a document while any definition it references does not resolve                                                                                                          | T1      | Specified             |
| **TPL-005** | A template must be testable by creating a throwaway document from it, without that document entering the space                                                                                                  | T2      | Specified             |
| **TPL-006** | Templates must be permissioned separately from the documents made from them, because designing one and writing one are different jobs                                                                           | T1      | Specified             |
| **TPL-046** | Where a template needs no prompt library or no query set, it must bind a declared empty default rather than nothing, so that TPL-060 and TPL-061 hold and TPL-004 always has something to resolve (**TPL-Q01**) | T2      | Specified             |

**TPL-004 is cheap here and expensive anywhere else.** A template whose theme was deleted or whose
query set moved is discovered either when somebody tries to create a document, or at publish time a
fortnight later. The first costs a moment; the second has already cost somebody a day.

## 4. Metadata schemas

**What a metadata schema is now belongs to [MET](MET-metadata-and-component-types.md).** This
section used to own the schema and describe its fields, and it said too little to build from - a
schema "must be able to apply fields at document level and at component level" (TPL-009) without
anything saying what a schema was. It also got the component half wrong: a component is referenced by
documents made from many templates, so its fields cannot come from any of them. MET takes fields,
schemas and component types; what stays here is the template's side of it - which schemas a template
assigns, and to what.

**A template assigns schemas; it does not own one.** Zero or more, each applying to the document or to
its sections, which is what the scope's section 6 always said: a template composes definitions and owns
none of them but its starting outline.

| ID          | Requirement                                                                                                                                                                                                                     | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **TPL-007** | A metadata schema must declare typed fields, each with a type, whether it is required, and its validation rules                                                                                                                 | T1         | Superseded by MET-005 |
| **TPL-008** | A field must be able to draw its permitted values from a controlled vocabulary rather than being free text (**LIB**)                                                                                                            | T2         | Superseded by MET-003 |
| **TPL-009** | A schema must be able to apply fields at document level and at component level, since the two are asked different questions                                                                                                     | T1         | Superseded by TPL-054 |
| **TPL-010** | A field must be able to declare a default, and whether that default may be changed after instantiation                                                                                                                          | T1         | Superseded by MET-006 |
| **TPL-011** | Changing a schema must not invalidate documents already created against an earlier version of it                                                                                                                                | Constraint | Superseded by MET-019 |
| **TPL-054** | Each metadata schema a template assigns must declare whether it applies to the document or to the document's sections (**MET-034**), and may make an optional field required for that assignment and nothing more (**MET-009**) | T1         | Specified             |

## 5. The structure outline

| ID          | Requirement                                                                                                                                                              | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **TPL-012** | A structure outline must declare the sections a document starts with, and their order                                                                                    | T1         | Specified |
| **TPL-013** | It must be able to mark a section as required, meaning a document may not be published without it                                                                        | T1         | Specified |
| **TPL-014** | It must be able to declare a component that every document from this template includes - shared boilerplate, a standard methodology statement                            | T4         | Specified |
| **TPL-015** | It must declare what an author may change: whether sections can be added, removed or reordered                                                                           | T1         | Specified |
| **TPL-016** | A starting outline must not be a document's outline. Once instantiated, the document owns it (**STR**)                                                                   | Constraint | Specified |
| **TPL-049** | A required component (TPL-014) must declare where it sits: at a position in the starting outline, or as document-level matter the publishing layout places (**PUB-088**) | T4         | Specified |

## 6. Parameters

| ID          | Requirement                                                                                                                                                                                                                                                                      | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-017** | A template must declare its parameters: name, type, whether required, and the permitted values or range of each                                                                                                                                                                  | T2         | Specified |
| **TPL-018** | A document must not be creatable until every required parameter has a value                                                                                                                                                                                                      | T2         | Specified |
| **TPL-019** | A parameter must be usable to seed metadata, to resolve variables, and to supply arguments to the queries the template's bindings run                                                                                                                                            | T2         | Specified |
| **TPL-020** | A parameter's value must be recorded on the document, and must be visible and auditable afterwards                                                                                                                                                                               | T2         | Specified |
| **TPL-021** | Whether a parameter may be changed after instantiation must be declared, because changing "the site this report is about" is not the same as correcting a typo                                                                                                                   | T2         | Specified |
| **TPL-041** | A template must declare what each parameter feeds: which metadata field it seeds, which variables take their value from it (**REU-018**), and which query arguments it supplies (**DAT-010**). A parameter with no declared use must be refused rather than accepted and ignored | T2         | Specified |
| **TPL-042** | A variable a parameter feeds must be one **REU** declares (REU-018). This area supplies values; it does not define the vocabulary or the resolution rules (REU-016, REU-036)                                                                                                     | Constraint | Specified |
| **TPL-045** | A parameter value that is present but invalid - the wrong type, outside its permitted range, or absent from its vocabulary - must be refused and named with the parameter, the rule and the value, through the API (TPL-026) exactly as in the interface (**MET-022**)           | T2         | Specified |

**TPL-041 is the requirement without which every other one here can be satisfied by a template that
does nothing.** TPL-019 says a parameter must be usable to seed metadata, resolve variables and
supply query arguments, and TPL-022 says instantiation does those things - and neither said where the
mapping between them is written down. It is the template's, declared, and a parameter nothing
consumes is a mistake rather than a spare.

**TPL-042 names an owner for a word this document used three times.** "Variable" appeared in
TPL-019, TPL-022 and TPL-Q03, and was defined nowhere and delegated to nobody - in the document whose
reason for existing is that an ownership seam was found by luck. It is **REU**'s, and this area
supplies values into it.

**TPL-045 closes an asymmetry on the path most likely to hit it.** A missing required parameter
blocks creation (TPL-018); a present but wrong one had no stated behaviour at all, and TPL-026 opens
an API where wrong values arrive without a form to check them.

## 7. Instantiation

| ID          | Requirement                                                                                                                                                                                                                                                                                      | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **TPL-022** | Creating a document must materialise the starting outline, seed its metadata, resolve its variables, and establish its bindings                                                                                                                                                                  | T2         | Superseded by TPL-062 |
| **TPL-062** | Creating a document from a template must materialise the starting outline and seed its metadata                                                                                                                                                                                                  | T1         | Specified             |
| **TPL-063** | Creating a document from a template must establish its bindings                                                                                                                                                                                                                                  | T2         | Specified             |
| **TPL-064** | Creating a document from a template must resolve its variables                                                                                                                                                                                                                                   | T4         | Specified             |
| **TPL-051** | A template must be able to declare default values for a document's profile axes, and which axes a document from it must set. Instantiation must establish the profile from those defaults, from parameters or from a declared incomplete state, and must never leave it undeclared (**REU-022**) | T4         | Specified             |
| **TPL-023** | Whether a binding's query runs at creation and is pinned, or stays live, must follow the binding mode (**DAT-034**) rather than being a template setting                                                                                                                                         | T2         | Specified             |
| **TPL-024** | A failure during instantiation must leave no partial document behind                                                                                                                                                                                                                             | Constraint | Specified             |
| **TPL-025** | Instantiation must record which template, and which template version, produced the document                                                                                                                                                                                                      | T1         | Specified             |
| **TPL-026** | Instantiation must be available through the API as well as the interface, since creating documents is the commonest thing another system will want to do                                                                                                                                         | T2         | Specified             |
| **TPL-050** | Creating a document must record who created it and when, on the document and in the audit log (**LIF-026**, **LIF-027**), alongside the template version TPL-025 records                                                                                                                         | T2         | Specified             |
| **TPL-048** | A throwaway test document (TPL-005) must be discarded when the test ends and must never become reachable. Anything it produced - a binding run, a derived asset - must go with it                                                                                                                | T2         | Specified             |

## 8. Divergence

A starting shape is not a cage. After instantiation the document is the author's, and departing from
the template is expected rather than a fault - but it should be visible, because "this report does
not have the section every other report from this template has" is worth somebody noticing.

| ID          | Requirement                                                                                                                                                                                                                           | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-027** | A document must own its outline after instantiation, and must be able to depart from the template's starting shape                                                                                                                    | T1      | Specified |
| **TPL-028** | Departures must be listable: what this document has that the template does not, and what it lacks                                                                                                                                     | T3      | Specified |
| **TPL-029** | A section the template marked required must not be removable without a stated reason, recorded on the document                                                                                                                        | T3      | Specified |
| **TPL-030** | Publishing must fail where a required section is absent                                                                                                                                                                               | T1      | Withdrawn |
| **TPL-044** | A component the template declared required (TPL-014) must not be removable without a stated reason recorded on the document, and publishing must fail where one is absent - the treatment TPL-029 and TPL-013 give a required section | T4      | Specified |

**TPL-030 is withdrawn: TPL-013 already says a document may not be published without a required
section.** Two rows saying one thing would be claimed and cited twice, and would drift the first time
either was reworded. TPL-044 now names TPL-029 and TPL-013 as the treatment a required section is
given.

**TPL-044 gives required components the enforcement required sections already had.** A template can
declare that every document carries the standard methodology statement, and until now an author could
have removed it with no reason recorded and nothing failing at publish. **TPL-Q04** asks whether such
a component floats or pins; this is the prior question of whether it may leave at all.

## 9. When a template changes

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TPL-031** | Changing a template must not alter any document already created from it                                                                                                                                                                                                                                                                                                                                  | Constraint | Specified |
| **TPL-032** | It must be possible to list the documents created from a given template version                                                                                                                                                                                                                                                                                                                          | T2         | Specified |
| **TPL-033** | Moving a document to a newer template version must be an explicit, audited act, and must be refusable                                                                                                                                                                                                                                                                                                    | T3         | Specified |
| **TPL-034** | Such a move must report what it will change before it runs, and must be abandonable at that point                                                                                                                                                                                                                                                                                                        | T3         | Specified |
| **TPL-035** | A move that cannot be completed must leave the document exactly as it was                                                                                                                                                                                                                                                                                                                                | Constraint | Specified |
| **TPL-058** | Moving a document forward (TPL-033) must bring its fields to the current versions of the schemas and fields its template assigns as well as its outline to a newer template version, and must be possible when only a schema or a field has changed. The report TPL-034 requires must name each field that changes and each value that would not be carried forward, as **MET-036** treats a component's | T3         | Specified |

**Section 9 is a migration wearing the clothes of a setting**, which is why it is written as one.
The tempting design is a checkbox marked "keep this document up to date with its template". What
that means in practice is a document changing under an author who did not ask, possibly after
approval, which is the one thing an audited system must not do.

## 10. Validation

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tranche    | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **TPL-036** | A document must satisfy the metadata schema its template binds, and publishing must fail where it does not                                                                                                                                                                                                                                                                                                                                          | T1         | Superseded by TPL-055 |
| **TPL-037** | Validation failures must name the field, the rule and the document                                                                                                                                                                                                                                                                                                                                                                                  | T1         | Superseded by MET-022 |
| **TPL-038** | Validation must run while authoring, not only at publish, so that a missing required field is known early                                                                                                                                                                                                                                                                                                                                           | T1         | Superseded by MET-021 |
| **TPL-043** | Validation must enforce the definitions as they were in the template version recorded on the document (TPL-025), not as they are now: tightening a schema or marking a new section required must not make existing documents fail (TPL-011, TPL-031). Moving to a newer version is the deliberate act in section 9                                                                                                                                  | Constraint | Superseded by TPL-057 |
| **TPL-055** | A document must satisfy the fields its template applies at document level, and each section the fields applied at section level, and publishing must fail where either does not (**MET-022** names each failure)                                                                                                                                                                                                                                    | T1         | Specified             |
| **TPL-056** | Instantiation must record on the document the version of each metadata schema and field it was created against. An assignment takes a schema's latest version (**MET-040**), so the template version TPL-025 records no longer decides which fields apply                                                                                                                                                                                           | Constraint | Specified             |
| **TPL-057** | Validation must enforce what is recorded on the document rather than the definitions as they are now: its outline and required sections as they were in the template version TPL-025 records, and its fields as they were in the schema and field versions TPL-056 records. Tightening a schema or marking a new section required must not make an existing document fail (**MET-019**, TPL-031). Moving forward is the deliberate act in section 9 | Constraint | Specified             |

**TPL-043 states the only reading that reconciles three requirements.** TPL-011 says a schema change
must not invalidate existing documents, TPL-031 says a template change must not alter them, and
TPL-036 says a document must satisfy "the metadata schema its template binds" - present tense. Read
literally, tightening a schema would fail every document already created against the looser one at
its next publish. Validation runs against the recorded version, and section 9 is how a document moves
forward.

**TPL-056 and TPL-057 exist because assignments float.** TPL-043 reconciled TPL-011, TPL-031 and
TPL-036 by validating a document against the template version recorded on it - which worked while a
template version owned its schema. A template now assigns schemas that always take their latest
version (MET-035), so the template version no longer says which fields a document was created against.
The document says it instead, and validation reads that record. TPL-058 lets a document catch up on a
schema change alone, which a template version bump could not express.

## 11. Bulk generation

Scope §7.3 puts parameterised bulk generation in **REU**. It rests on everything above: creating
forty documents from one template and forty parameter rows is the same act repeated, and it needs
the same guarantees.

| ID          | Requirement                                                                                                                                                                                 | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TPL-039** | Bulk generation must report success or failure per row, and must never leave a partially created document behind for a row that failed                                                      | T4      | Specified |
| **TPL-040** | A cohort created together must be identifiable afterwards, so that forty reports can be tracked, reviewed and published as a set                                                            | T4      | Specified |
| **TPL-047** | A bulk run must declare whether a failing row stops the run or it continues, the choice must be the requester's with a stated default, and the report must say which happened (**REU-033**) | T4      | Specified |

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

| This document      | Rests on                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Section 1          | Scope §7.19, and the ownership pass that found the gap                                                 |
| TPL-003            | The two definitions no other area owned                                                                |
| TPL-016, TPL-027   | STR - a starting outline becomes a document's own                                                      |
| TPL-023            | DAT-034, binding modes decide when a query runs                                                        |
| Section 9          | Scope §7.19, existing documents not changing underneath their authors                                  |
| Section 11         | Scope §7.3, parameterised bulk generation                                                              |
| TPL-041, TPL-042   | REU-016, REU-018, REU-036 - what a variable is and what it resolves against                            |
| TPL-043            | TPL-011, TPL-031 - the reading that reconciles them with TPL-036                                       |
| TPL-050            | LIF-026, LIF-027 - who did what, when, in the audit log                                                |
| TPL-049            | PUB-088 - document-level matter the layout places                                                      |
| TPL-041 to TPL-050 | [The v1 review](<../../reviews/TPL - Templates and document instantiation.md>); section 15             |
| TPL-052 to TPL-058 | [MET](MET-metadata-and-component-types.md); section 15, "From specifying metadata and component types" |

## 15. Change history

One row per change, against
[the review](<../../reviews/TPL - Templates and document instantiation.md>) that prompted it. The
rules for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Substantive issues

| Point                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seeding and resolution mapping has no home | **TPL-041.** Without it every requirement here can be satisfied by a template that declares no mapping at all: TPL-019 says a parameter is usable to seed metadata, resolve variables and supply query arguments, TPL-022 says instantiation does those things, and neither said where the mapping is written down. It is the template's, and a parameter nothing consumes is refused rather than accepted and ignored |
| "Variables" is used and unowned                | **TPL-042**, plus dependency and boundary rows. The word appeared three times, was defined nowhere and delegated to nobody - in the document that exists because an ownership seam was found by luck. It is **REU**'s; this area supplies values into it                                                                                                                                                               |
| Version pinning is implied, never stated       | **TPL-043.** TPL-011, TPL-031 and TPL-036 can be read as contradicting each other: tightening a schema would fail every document created against the looser one. Validation enforces the definitions as they were in the recorded template version, and section 9 is how a document moves forward                                                                                                                      |
| Required components are under-enforced         | **TPL-044** gives them the treatment required sections already had - a stated reason to remove, and a publish that fails without one. TPL-Q04 asks whether such a component floats; this is the prior question of whether it may leave at all                                                                                                                                                                          |
| Parameter errors are asymmetric                | **TPL-045**: a present but invalid value is refused and named, through the API as in the interface. A missing parameter blocked creation; a wrong one had no stated behaviour, on the path where wrong values arrive without a form to check them                                                                                                                                                                      |

### Smaller gaps

| Gap                 | Change                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding optionality | **TPL-046**: a declared empty default rather than no binding, so TPL-002 holds and TPL-004 has something to resolve. TPL-Q01's anticipated answer now exists as an allowance |
| Bulk run policy     | **TPL-047**: stop or continue is declared, the requester chooses, the report says which happened. TPL-039 guaranteed state and said nothing about behaviour                  |
| Throwaway disposal  | **TPL-048**: discarded when the test ends, never reachable, and whatever it produced goes with it                                                                            |
| Component placement | **TPL-049**: a position in the starting outline, or document-level matter the layout places                                                                                  |
| LIB is load-bearing | Moved into **Depends on** rather than appearing only in the boundary table                                                                                                   |

### Confirmed with the other twenty

| Check                              | Finding                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorisation for instantiation    | **IAM**'s - IAM-018 to IAM-021 carry the levels and the permission set. The boundary row now says "and who may create from one" rather than leaving it to implication       |
| Audit of the creation event itself | **A real gap.** Parameters were auditable (TPL-020) and template version recorded (TPL-025), and "who created this document, when" appeared nowhere in the set. **TPL-050** |
| LIB's vocabulary service at T2     | **Confirmed.** TPL-008 is T2 and LIB-020 and LIB-021 are T2, so the dependency lands in the same tranche rather than one waiting on the other                               |

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 40     | 50    |
| Non-requirements | 4      | 4     |
| Open questions   | 4      | 4     |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections | Change                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.4             | **TPL-051** lets a template declare default profile values and required axes, and requires instantiation to establish the profile rather than leaving it undeclared |

### From specifying metadata and component types

Not a review. Specifying [MET](MET-metadata-and-component-types.md) found that this area owned a
definition the scope said no template owns, and that what it said about the definition was too thin to
build from.

| What was found                                                                                                                                                                                                   | Change                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope §6 says a template composes its definitions and "owns none of them", and §9 decision 3 rejects a template owning metadata as a god-object. TPL-002 and TPL-003 had the template own **exactly one** schema | **TPL-002 superseded by TPL-052** - zero or more schemas. **TPL-003 superseded by TPL-053** - the outline is the one definition a template owns                                                                              |
| TPL-009 took a component's fields from the schema of the document referencing it, which breaks at the second document made from a different template                                                             | **TPL-009 superseded by TPL-054** - a template's schemas apply to the document or its sections. A component's fields come from its component type (**MET-013**)                                                              |
| TPL-007, TPL-008, TPL-010 and TPL-011 described fields and schemas in general, and TPL-037 and TPL-038 described validation that applies to every artifact, not only documents                                   | **Superseded by MET-005, MET-003, MET-006, MET-019, MET-022 and MET-021**, where one statement serves documents, sections and components                                                                                     |
| TPL-043 validated against the definitions a template version owned. Once assignments take a schema's latest version (MET-035), a template version no longer decides a document's fields                          | **TPL-043 superseded by TPL-057**, validating against what the document records. **TPL-056** makes instantiation record the schema and field versions, and **TPL-058** lets a document move forward on a schema change alone |
| TPL-036 required a document to satisfy "the metadata schema its template binds" - singular, and silent on sections                                                                                               | **TPL-036 superseded by TPL-055**, covering the document's fields and each section's                                                                                                                                         |
| Pointers into moved rows                                                                                                                                                                                         | TPL-045 now cites MET-022; TPL-046 cites TPL-052                                                                                                                                                                             |
| Not changed: **TPL-N04, "not a form builder"**                                                                                                                                                                   | Left here because it is still true of a template, and carried into MET as MET-N04                                                                                                                                            |

| Counts           | Before | After                      |
| ---------------- | ------ | -------------------------- |
| Requirements     | 51     | 58, of which 11 superseded |
| Non-requirements | 4      | 4                          |
| Open questions   | 4      | 4                          |

### Ken's answer to the publishing design, 2026-09-19

Not a review. [The publishing design](../../design/publishing.md) found two rows saying one thing, and
Ken accepted cutting one. It also proposed that a layout declare the language of its words, filed as
issue [#144](https://github.com/kenhayward/alloy-works/issues/144); it lands as a row with the layout
slice that builds it, not here.

| What was found                                                                                                                     | Change                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TPL-030, "publishing must fail where a required section is absent", repeats TPL-013's "a document may not be published without it" | **TPL-030 withdrawn**, keeping its row. TPL-013 is the one to claim and cite; the prose beside TPL-044 says so                                                                                                 |
| TPL-049 cited PUB-010, superseded by PUB-088 and PUB-089                                                                           | TPL-049 now cites **PUB-088**, a clarity edit: it relies on the front and back matter a layout declares and places, which PUB-088 carries; PUB-089, the approval page, shows approvals and places no component |
| TPL-044 named "the treatment TPL-029 and TPL-030 give a required section", and TPL-030 is withdrawn                                | TPL-044 now names **TPL-029 and TPL-013**, a clarity edit: TPL-013 says what TPL-030 did, that a document may not be published without a required section. The prose beside it says the same                   |
| Section 14's traceability row for TPL-049 rested on PUB-010                                                                        | It rests on **PUB-088**                                                                                                                                                                                        |

| Counts           | Before                     | After                                      |
| ---------------- | -------------------------- | ------------------------------------------ |
| Requirements     | 58, of which 11 superseded | 58, of which 11 superseded and 1 withdrawn |
| Non-requirements | 4                          | 4                                          |
| Open questions   | 4                          | 4                                          |

### From the T1 audit against the code (2026-09-25)

[The T1 audit](<../../reviews/T1 - Audit against the code.md>) read every T1 requirement against the code
and against what T1 can deliver. A row moving tranche whole keeps its identifier, and only its tranche
changes; a row split by tranche is superseded by its T1 half, and the rest becomes rows of their own.

| What was found                                                                                                                                                  | Change                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1's template rows (TPL-012, TPL-013, TPL-015, TPL-027, TPL-055) and STY-025 cannot be verified unless a document records the template and version that made it | **TPL-025 moved from T2 to T1**                                                                                                                                                        |
| A query set is **DAT**'s, in T2, and a prompt library **GEN**'s, in T5                                                                                          | **TPL-052 superseded by TPL-059** - the structure outline, theme, layout and metadata schemas, T1 - with **TPL-060**, the query set, in T2, and **TPL-061**, the prompt library, in T5 |
| TPL-022 was T2 whole, though materialising the outline and seeding metadata need nothing T2 has, bindings are T2 and variables T4                               | **TPL-022 superseded by TPL-062** - the outline materialised and the metadata seeded, T1 - with **TPL-063**, the bindings, in T2, and **TPL-064**, the variables, in T4                |

| Counts           | Before                                     | After                                      |
| ---------------- | ------------------------------------------ | ------------------------------------------ |
| Requirements     | 58, of which 11 superseded and 1 withdrawn | 64, of which 13 superseded and 1 withdrawn |
| Non-requirements | 4                                          | 4                                          |
| Open questions   | 4                                          | 4                                          |
