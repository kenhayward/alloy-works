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
space's terms lock that a save using a term also takes; an archived or deleted component's use does
not count, as the uses list leaves it out. **Gap:** the index holds no document's section titles, for
any kind, so a term marked in a section title neither stops its archive nor is listed as a use. A
term's writer takes the terms lock before the term's own; a component's save, after the component's.

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

## Built in TMb

- **The theme's rule** is a term catalogue beside the others, as the value one is: `catalogue/5`,
  `{ kind: 'term', expand }`, the default theme's 0.10 naming one at `firstUse` (0154). A theme naming
  none expands on first use.
- **Assemble** walks uses in reading order where it finds citations, after conditions and bindings,
  a footnote at its mark; a use is the text one mark covers side by side, so a span split into two
  marks is two uses. `publishing/24` carries each as a `term` run, `{ text, marks, link }`, its marks
  the first character's, linked to `g-<term>` in running text where the glossary holds it, and
  `back.glossary` and `back.abbreviations`, sorted by `Intl.Collator` in the document's language. A
  heading prints the preferred label, so its contents, bookmarks and running heads do. Template 24
  draws them, each list an `L` of `LI`.
- **Word** sets a term run in a `Term` character style where no mark names a style, hyperlinked to its
  glossary entry's bookmark (as a citation is, not a `REF`); the glossary and abbreviations follow the
  bibliography, outside Word's headings.
- **Labels** are the document language's, else one whose language serves it (`en` for `en-GB`), else
  the base language's.
- **Resolved as the publisher** at the request: each use's term at its latest designated revision, in
  the space of the component (a heading's, the document's). The versions read are rows of kind `term`
  beside a request's and a publication's images and entries, and a baseline's pins (`terms` in its
  digest, absent where none), decided as its maker. A pin the requester may not read is recorded and
  never read.
- **Reported, not failed**: `term_unresolved` (draft, unreadable, missing or of another space, one code
  so nothing is said of a term the publisher may not read), `term_deprecated` naming `replacedBy`, and
  `term_fallback` naming the document's language, each once a term with its count of uses. Recorded on
  the request as it is made (`publication_request.warnings`, 0154) and returned with its sources'
  warnings. They are counted over the placed content before conditions, so a use a condition removes
  is still reported.

## Built in TMc

- **The Term action** (CNT-165) is a prompting mark in the registry, `Mod-Alt-g` (Ctrl-Alt-T opens a
  terminal on common Linux desktops; Shift-E is Equation's). It applies over the selection or the word
  at a caret outside a term, and opens on and removes the one a caret is in. `definedTerm` is no longer
  inclusive, as a link is not. The **Term dialog** offers the space's approved and deprecated terms,
  found by any label or abbreviation; a deprecated one chosen is flagged with its replacement offered
  (LIB-057).
- **Suggestions** (TM-L, LIB-019): a plugin ahead of every keymap, acting only on the author's own text
  input (`handleTextInput`, never while composing), matches the words before the caret, or before one
  space or mark after them, case aside, against every form of the space's approved terms, at most five
  offered. Tab adds the mark as its own undo step (`closeHistory`), and Enter does once an arrow has
  moved the choice; otherwise Enter does its own job and the offer closes, and with no offer Tab is
  the surface's own. Escape dismisses it for those words. The offer is a `listbox` below the caret that the surface (still a `textbox`) names by
  `aria-controls`, `aria-activedescendant` and `aria-autocomplete="list"`, said in a polite live
  region. The index is the space's listing up to 5,000 terms, read once a space for a document's
  editing session and shared by its editors, and again as the dialog opens, which says when the space
  held more. A footnote's own editor has the action but no suggestions.
- **Flags in use** (LIB-018): `POST /v1/components/{id}/terms/preview` answers each used term's
  standing, its preferred label and a deprecated one's replacement, or `unavailable` where it is no term
  of the component's space the caller may read; a deprecated term's words are underlined and its flag
  said after them, as a flagged citation's is. The Review panel does not list them yet.
- **The save check** (TM-K): a save, a suggestion made or accepted, an assistant's proposal and a
  restore are refused `term_unreadable` where a term mark names a term the version opened did not use
  and that is no term of the component's space its author may read, as `mayCite` refuses a citation.
  The space's terms lock is already taken as the version's references are indexed.
