# LIB - Reference libraries

> **Status: draft, for review.**

## 1. Purpose

The small structured records a space holds and content references by identity: bibliography entries,
terms, and controlled vocabularies. This area owns creating them, versioning them, importing and
exporting them, and the rule that content points at them rather than repeating them.

Terminology arrived here from customer requirements rather than from the scope, and the argument for
it is the one already made for citations: **what something is called is a fact about the term, not a
string in a paragraph.**

## 2. Depends on

| Rests on                                               | What it fixes                                    |
| ------------------------------------------------------ | ------------------------------------------------ |
| [`Project_Scope.md`](../Project_Scope.md) §7.21        | The area's remit                                 |
| [CNT](CNT-content-and-authoring.md) CNT-050 to CNT-054 | Citations reference an entry and are never typed |
| [STY](STY-styles-and-presentation-themes.md)           | Citation styles render what is held here         |

| Not here                               | There            |
| -------------------------------------- | ---------------- |
| The citation and term marks in content | **CNT**          |
| How a citation renders                 | **STY**, **PUB** |
| Generating a glossary or bibliography  | **PUB**          |
| Which vocabulary a metadata field uses | **TPL**          |
| Searching across terms                 | **SCH**          |
| Binaries                               | **AST**          |

## 3. Common behaviour

| ID          | Requirement                                                                                                    | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-001** | Every library record must belong to a space and be permissioned by it (**IAM**)                                | T2         | Specified |
| **LIB-002** | Every record must carry a stable identifier, allocated once and never reused                                   | Constraint | Specified |
| **LIB-003** | Content must reference a record by identity, never repeat its contents                                         | Constraint | Specified |
| **LIB-004** | Records must be versioned (**VER-011**), and a baseline must pin the versions it used                          | T3         | Specified |
| **LIB-005** | Where a record is used must be listable (**REU-006**)                                                          | T2         | Specified |
| **LIB-006** | A record must not be deletable while anything references it                                                    | Constraint | Specified |
| **LIB-007** | A reference to a record that cannot be resolved must fail the publish, naming the record and where it was used | Constraint | Specified |

## 4. Bibliography

| ID          | Requirement                                                                                                                            | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **LIB-008** | A bibliography entry must hold the fields the citation styles in use require, by source type                                           | T6      | Specified |
| **LIB-009** | Entries must be importable from standard interchange formats, and exportable the same way                                              | T6      | Specified |
| **LIB-010** | Import must detect a record that already exists rather than creating a second, and must say what it merged                             | T6      | Specified |
| **LIB-011** | An entry must be able to record where it was obtained and when it was last checked, because a source that has moved is a common defect | T6      | Specified |
| **LIB-012** | An entry missing a field its citation style requires must fail the publish, naming both                                                | T6      | Specified |

**LIB-010 is the difference between a bibliography and a pile.** Four records for one paper produce
four entries in a reference list, and nobody notices until a reviewer does.

## 5. Terms

| ID          | Requirement                                                                                                                             | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-013** | A term entry must carry a preferred label, any number of alternative labels, an abbreviation, a definition and a status                 | T6         | Specified |
| **LIB-014** | A term must carry a label per language, so that translation has something to translate against (**LOC**)                                | T6         | Specified |
| **LIB-015** | A term must be referenced from content and must never be typed as text (**CNT-031** carries the mark)                                   | Constraint | Specified |
| **LIB-016** | First use of a term in a document must be resolvable at publish time, so that an expansion appears once and the abbreviation thereafter | T6         | Specified |
| **LIB-017** | Whether a term expands on first use, always, or never must be a property of the document's style rather than of the component           | T6         | Specified |
| **LIB-018** | A deprecated term must be flagged wherever it is used, with its replacement named                                                       | T6         | Specified |
| **LIB-019** | An author must be able to insert a term reference by typing its abbreviation or an alternative label                                    | T6         | Specified |

**LIB-016 is the whole argument for terms being references.** Whether a mention is the first depends
on the document, and a component reused in two reports may be the first mention in one and the
fortieth in the other - so expanding into text would bake a document-level fact into reusable
content. This is the same reason numbering lives in the outline.

**LIB-019 is where phrase expansion belongs.** Typing `mah` and getting a reference is a convenience;
typing `mah` and getting plain text is the thing that must not happen, and the two look identical
until the day somebody renames the term.

## 6. Vocabularies

| ID          | Requirement                                                                                                                | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-020** | A vocabulary must be a named list of permitted values, each with a label and a stable identifier                           | T2         | Specified |
| **LIB-021** | A metadata field must be able to draw its permitted values from a vocabulary (**TPL-008**)                                 | T2         | Specified |
| **LIB-022** | A condition axis must be able to draw its permitted values from a vocabulary (**REU-020**)                                 | T4         | Specified |
| **LIB-023** | Retiring a value must not invalidate documents already using it; it must stop being offered and must be flagged where used | Constraint | Specified |
| **LIB-024** | A vocabulary must carry labels per language                                                                                | T6         | Specified |

**LIB-023 is the one that gets missed.** A value removed from a vocabulary leaves documents carrying
a metadata value that no longer validates, and the failure shows up months later at publish time on a
document nobody has touched.

## 7. Relations between terms

| ID          | Requirement                                                                                                                      | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-025** | A term must be able to declare broader, narrower and related terms                                                               | T6         | Specified |
| **LIB-026** | Search must use those relations and the alternative labels, so that looking for one term finds documents using another (**SCH**) | T6         | Specified |
| **LIB-027** | The relations must be a thesaurus and must not support inference - nothing may be concluded that somebody did not state          | Constraint | Specified |

**LIB-027 is deliberate and worth defending.** [REL](../Project_Scope.md) already provides a declared,
queryable relationship graph. What a regulated customer needs is to find things; what they cannot
accept is a system asserting something nobody wrote, because "the system inferred it" is not an
answer anybody can sign.

## 8. Interchange

| ID          | Requirement                                                                                             | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **LIB-028** | Terms and vocabularies must be exportable and importable in a documented format                         | T6      | Specified |
| **LIB-029** | Import must report what it could not represent rather than dropping it                                  | T6      | Specified |
| **LIB-030** | A library must be shareable between spaces within a tenant, so that a house glossary is maintained once | T2      | Specified |

## 9. Non-requirements

| ID          | Not this                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| **LIB-N01** | **No ontology with inference** (LIB-027)                                                                                   |
| **LIB-N02** | **No terminology as text macros.** A term is a reference; expansion is how one is inserted, not what one becomes (LIB-019) |
| **LIB-N03** | **No boilerplate here.** A standard phrase or paragraph is reuse, and belongs to **REU** as a component or a variable      |
| **LIB-N04** | **Not a full termbase.** Concept-level modelling, term extraction and translation memory are separate products             |

## 10. Open questions

| ID          | Question                                                                                                                                     | What would settle it                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **LIB-Q01** | **Does a term need a lifecycle of its own?** A glossary in a regulated environment is often approved, which means states and gates           | Whether customers govern terminology the way they govern content. In pharma they do |
| **LIB-Q02** | **Where does first-use expansion reset (LIB-016)?** Per document is obvious; per chapter is what several house styles actually require       | Real house styles. It is a publishing-layout property if it varies                  |
| **LIB-Q03** | **Do bibliographies need to be per space or shared (LIB-030)?** A shared one is maintained once and permissioned coarsely                    | Whether early customers' sources are confidential. In clinical work they can be     |
| **LIB-Q04** | **Should the product detect terms an author typed as text?** Suggesting a reference where somebody wrote the words is valuable and intrusive | Whether it can be offered without becoming a spell-checker that argues              |

## 11. Traceability

| This document    | Rests on                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Section 1        | Scope §7.21, from the ownership pass                             |
| LIB-015, LIB-016 | The first-use argument; the same rule as numbering in **STR**    |
| LIB-021, LIB-022 | TPL-008, REU-020 - who declares a vocabulary and who holds it    |
| LIB-027          | Scope §7.12, a declared relationship graph rather than inference |
| LIB-014, LIB-024 | Scope §7.16, multilingual content                                |
