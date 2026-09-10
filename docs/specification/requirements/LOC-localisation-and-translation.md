# LOC - Localisation and translation

> **Status: draft, for review.**

## 1. Purpose

The interface in somebody's language, and content in more than one. This area owns interface
localisation, per-language variants of a component, the translation status that tracks them, and the
round-trip to a translation vendor.

Scope §7.16 makes the split plainly: interface localisation is the smaller half, and **content
translation is the half that carries commercial value.** It also carries the constraint that shapes
everything else here - the content model has to accommodate language variants from T1, because
retrofitting them onto a monolingual version model is a rewrite.

## 2. Depends on

| Rests on                                             | What it fixes                                           |
| ---------------------------------------------------- | ------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.16      | UX localisation, content translation, the T1 constraint |
| [CNT](CNT-content-and-authoring.md) CNT-083, CNT-084 | Language is recorded, never foreignness                 |
| [VER](VER-versioning-baselines-and-comparison.md)    | Versions, which translation status is measured against  |

| Not here                               | There   |
| -------------------------------------- | ------- |
| Language tags on a run of text         | **CNT** |
| Labels per language on a term          | **LIB** |
| Which language a document publishes in | **PUB** |
| Who may translate                      | **IAM** |

## 3. Interface

| ID          | Requirement                                                                                                         | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LOC-001** | Every string the interface shows must be localisable, and none may be assembled from fragments at run time          | Constraint | Specified |
| **LOC-002** | Dates, times, numbers and currency must be formatted for the user's locale                                          | T6         | Specified |
| **LOC-003** | Sorting and collation must follow the user's locale rather than byte order                                          | T6         | Specified |
| **LOC-004** | Right-to-left interface layout must be supported, not only right-to-left text                                       | T6         | Specified |
| **LOC-005** | A user's interface language must be independent of the language of the content they are working on                  | T6         | Specified |
| **LOC-006** | Layout must tolerate translated text being substantially longer than the original without truncating or overlapping | T6         | Specified |

**LOC-001 forbids sentence assembly for a reason that is invisible in English.** "Deleted 3 items"
built from a verb, a number and a noun cannot be translated into a language that inflects the noun by
number, and the defect only appears once somebody translates it.

## 4. Content variants

| ID          | Requirement                                                                                                                     | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LOC-007** | A component must be able to exist in more than one language, as variants of one component rather than as separate components    | T6         | Specified |
| **LOC-008** | One language must be the source, and the others must be identified as translations of a particular version of it                | Constraint | Specified |
| **LOC-009** | The content model must accommodate language variants from T1, even though translation ships in T6                               | Constraint | Specified |
| **LOC-010** | A document must be publishable in a language, and must resolve to the variants for that language                                | T6         | Specified |
| **LOC-011** | Where a variant is missing, publishing must fail or fall back to the source by a declared policy - never silently mix languages | Constraint | Specified |
| **LOC-012** | A variant must be versioned like any other content (**VER-011**)                                                                | T6         | Specified |

**LOC-009 is the requirement that costs nothing now and everything later.** Adding a language
dimension to content that is already stored and immutable is a migration of every version ever
written - which is why the scope says it at tranche level and why it is repeated here as a
constraint.

## 5. Translation status

| ID          | Requirement                                                                                                                           | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LOC-013** | Each variant must carry a status against the source version it was translated from                                                    | T6         | Specified |
| **LOC-014** | A change to the source must invalidate the status of every translation of it, immediately and visibly                                 | Constraint | Specified |
| **LOC-015** | The status must distinguish a source change that needs retranslation from one that does not - a typo fix is not a new translation job | T6         | Specified |
| **LOC-016** | Translation status must be visible wherever a component is used, and reportable across a space                                        | T6         | Specified |
| **LOC-017** | Publishing must be refusable where a document contains out-of-date translations, by policy                                            | T6         | Specified |

**LOC-014 is the whole reason translation belongs inside the product rather than beside it.** A
translation in a separate system goes stale silently, and nobody discovers it until a reader of the
translated version reads something the source stopped saying a year ago.

## 6. Vendor round-trip

| ID          | Requirement                                                                                                            | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LOC-018** | Content must be exportable to XLIFF for a translation vendor, and importable back                                      | T6         | Specified |
| **LOC-019** | The export must carry enough context for a translator to work - surrounding text, the component's purpose, terminology | T6         | Specified |
| **LOC-020** | Structure, marks, references, bindings and terms must survive the round-trip and must not be translatable as text      | Constraint | Specified |
| **LOC-021** | An import must report anything it could not place, rather than dropping it (**IMP-007**)                               | Constraint | Specified |
| **LOC-022** | A translation job must be trackable: what was sent, when, to whom, and what has come back                              | T6         | Specified |

**LOC-020 is where a translation round-trip usually breaks.** A cross-reference sent as the number it
resolved to comes back as a translated number; a term sent as text comes back as somebody's guess.
Sending references as references is what makes the terminology work in LIB pay for itself.

## 7. Machine translation

| ID          | Requirement                                                                                                  | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LOC-023** | Machine translation must be available as an assist, producing a draft variant rather than a finished one     | T6         | Specified |
| **LOC-024** | Machine-translated content must be marked as such until a human accepts it, on the same terms as **GEN-022** | Constraint | Specified |
| **LOC-025** | A machine translation must use the tenant's terminology, and must be checkable against it                    | T6         | Specified |
| **LOC-026** | Whether content may be sent to an external translation service must be a tenant policy, not a default        | Constraint | Specified |

## 8. Non-requirements

| ID          | Not this                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| **LOC-N01** | **Not a translation management system.** Vendor selection, quoting and translator workbenches belong to a TMS |
| **LOC-N02** | **No translation memory of its own.** That belongs with the vendor's tooling                                  |
| **LOC-N03** | **No automatic publication of machine translation** (LOC-024)                                                 |
| **LOC-N04** | **No mixed-language output by accident** (LOC-011)                                                            |

## 9. Open questions

| ID          | Question                                                                                                                                         | What would settle it                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **LOC-Q01** | **Can the source language differ per component, or is it per space?** An acquired department may author in another language                      | Real customers. Per component is more general and complicates every status calculation                    |
| **LOC-Q02** | **What granularity does translation status need (LOC-015)?** Per component is simple; per block is what avoids retranslating a page for one word | The cost of retranslation in practice, which is a commercial question                                     |
| **LOC-Q03** | **Do bound values get translated?** A number does not; a category name returned by a query might                                                 | Whether sources hold language-neutral keys or display text. Usually the latter, unfortunately             |
| **LOC-Q04** | **Does a document's outline translate?** Section titles are content; the structure is not                                                        | Whether translated documents ever differ structurally, which in regulated submissions they sometimes must |

## 10. Traceability

| This document | Rests on                                         |
| ------------- | ------------------------------------------------ |
| Section 3     | Scope §7.16 UX localisation                      |
| LOC-009       | Scope §7.16 and §12, the T1 model constraint     |
| LOC-020       | LIB - terms as references rather than text       |
| LOC-024       | GEN-022, generated content marked until accepted |
| LOC-021       | IMP-007, nothing dropped without being reported  |
