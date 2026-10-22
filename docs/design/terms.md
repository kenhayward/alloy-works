# Terms

How a document uses a governed term - a preferred label, its abbreviation, its definition - and prints
it consistently, with a glossary and a list of abbreviations: T6's third slice. Ken's answers of
2026-10-22 shaped it, and [the TM plan](../plans/2026-10-22-tm-terms.md) builds it. Vocabularies,
value lists for metadata fields, are T7's beside those fields.

## The shape in one paragraph

A **term** is an artifact in a space, versioned on the chain, holding a preferred label, alternative
labels and an abbreviation per language (a base language declared), a definition, and broader,
narrower and related terms - a thesaurus that states and never infers. Its standing is a workflow of
its own: draft, approved, deprecated, a deprecated term naming its replacement. Content refers to a
term through the `definedTerm` mark (since T1), which covers words the author typed: the editor shows
them, and **publishing prints the term's own forms** in their place, by the theme's rule - expanded on
first use, always or never - first use resolved across the document in reading order. A glossary and
a list of abbreviations are generated from the terms the document uses, where the layout declares
them. An author applies a term from a **Term** action or by typing its abbreviation or a label and
taking the suggestion offered; a deprecated term is flagged as it is chosen and wherever it is used.
Search finds terms, and finds content by a term's labels and its narrower terms, at query time.

## Requirements owned

| ID          | How it is met                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| **LIB-013** | A term holds a preferred label, alternative labels, an abbreviation, a definition and its standing       |
| **LIB-014** | Each label and abbreviation per language                                                                 |
| **LIB-016** | First use resolved at publish in reading order: the expansion once, the abbreviation after               |
| **LIB-017** | Expansion is the theme's: first use, always or never                                                     |
| **LIB-018** | A deprecated term is flagged where it is used, its replacement named                                     |
| **LIB-019** | Typing an abbreviation or a label offers the term                                                        |
| **LIB-025** | Broader, narrower and related terms, stated                                                              |
| **LIB-026** | Search reaches content through a term's labels and narrower terms                                        |
| **LIB-028** | Exported as SKOS JSON-LD in a documented form; imported from it and from Turtle                          |
| **LIB-029** | An import reports what it could not represent                                                            |
| **LIB-049** | Standing is a declared workflow: draft, approved, deprecated                                             |
| **LIB-050** | A language with no label falls back to the term's base language, and the fallback is reported at publish |
| **LIB-057** | A deprecated term is flagged as it is chosen                                                             |
| **CNT-165** | A Term action on the toolbar and a shortcut apply and remove it                                          |
| **PUB-039** | A glossary and a list of abbreviations generated from the terms used                                     |
| **SCH-015** | As LIB-026                                                                                               |
| **SCH-056** | Terms are searchable                                                                                     |
| **IMP-015** | As LIB-028                                                                                               |

LIB-015 and LIB-027 are the library's constraints, kept here: a term is referred to, never typed, and
relations infer nothing.

## The term

`term`, a space's artifact. Its version: `{ schemaVersion, base: <BCP 47>, labels: [{ language,
preferred, alternatives[], abbreviation? }], definition: [{ language, text }], broader[], narrower[],
related[], replacedBy? }`, every relation a term of the same space by identity. A relation's inverse is
never inferred: what is stated is what holds.

Its standing is the workflow kind `term`, seeded as draft, approved (Approve, a gate of one approver
not an author, designating a revision) and deprecated (Deprecate, Reinstate and Reopen, each with a
reason). **Deprecated is read by the state's key**, `deprecated`, not a flag on the state: the
workflow check refuses a term workflow without that state, or with it initial or approved, so a
tenant may rename it but not lose it. A relation or replacement names a term of the same space its
author may read; a replacement chain never returns to the term and is at most five long. A term is
archived only while no component's latest version uses it, by the reference index, under the
space's terms lock that a save using a term also takes.

## Interchange

SKOS (LIB-028, LIB-029, IMP-015). Exported as JSON-LD with one fixed context: `@graph` holds each
term as `{"@id": "urn:uuid:<id>", "@type": "skos:Concept"}` with `prefLabel`, `altLabel` and
`definition` keyed by language, an abbreviation as `notation` `{"@value", "@language"}` in its
label's language, `broader`, `narrower` and `related` as identities, and a replacement as
`isReplacedBy` (`dct:isReplacedBy`). Standing and archival are not exported.

Imported from that form, read by its names alone, or from Turtle by `n3`; nothing a file names is
fetched. Each `skos:Concept` becomes a term, its base language the requested one (`en` by default)
where it has a preferred label in it, else its first; a `notation` with no language is the base
language's abbreviation. A concept whose base preferred label matches, case aside, a term of the
space the importer may read is merged into it where they may edit it (missing languages,
alternatives, abbreviations, definitions and stated relations added); otherwise it is made in draft.
Reported, not dropped: any other predicate (`hiddenLabel`, `scopeNote`, `inScheme` among them), a
subject that is not a concept, a tag that is not BCP 47, a label in a language with no preferred
one, a second preferred label, abbreviation or definition in a language, and a relation to a concept
outside the file. At most 2,000 concepts an import.

## Printing

The theme's term catalogue (a new catalogue version) declares `expand: firstUse | always | never`.
Publishing walks the document's terms in reading order, as it does citations: under `firstUse`, the
first prints "preferred label (abbreviation)" and the rest the abbreviation; a term with no
abbreviation always prints its preferred label. Labels are the document language's, else the base's,
the fallback reported. A term the publisher cannot read prints the covered words and is reported.

A heading, the contents, bookmarks and running heads print the preferred label and are not uses; first
use is counted after transclusion and conditions, in reading order, footnotes at their reference. The
printed run takes the other marks of the span's first character. A draft, unreadable or missing term
prints the covered words and is reported; a deprecated one prints and is reported. The term versions a
publish reads are pinned as its inputs and a baseline's.

## Search

A query's words that are a term's label or abbreviation reach, through the reference index, the
content using that term and its narrower terms, three levels at most. Nothing is copied into index
text, so a renamed or related term is found at once.
