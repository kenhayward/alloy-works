# LIB - Reference libraries

> **Status: v1, reviewed.**

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

| Not here                                                      | There            |
| ------------------------------------------------------------- | ---------------- |
| The citation and term marks in content                        | **CNT**          |
| How a citation renders                                        | **STY**, **PUB** |
| Generating a glossary or bibliography                         | **PUB**          |
| Which vocabulary a metadata field uses                        | **TPL**          |
| Searching across terms                                        | **SCH**          |
| Binaries                                                      | **AST**          |
| Whether a metadata field may draw on more than one vocabulary | **TPL**          |
| Which roles may read or edit a library record                 | **IAM**          |
| The audit log a change to a record lands in                   | **LIF**          |
| Adding a connector for an external source                     | **API**          |

## 3. Common behaviour

| ID          | Requirement                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-001** | Every library record must belong to a space and be permissioned by it (**IAM**)                                                                                                                                                                    | T2         | Specified |
| **LIB-002** | Every record must carry a stable identifier, allocated once and never reused                                                                                                                                                                       | Constraint | Specified |
| **LIB-003** | Content must reference a record by identity, never repeat its contents                                                                                                                                                                             | Constraint | Specified |
| **LIB-004** | Records must be versioned (**VER-011**), and a baseline must pin the versions it used                                                                                                                                                              | T3         | Specified |
| **LIB-005** | Where a record is used must be listable (**REU-006**)                                                                                                                                                                                              | T2         | Specified |
| **LIB-006** | A record must not be deletable while anything references it                                                                                                                                                                                        | Constraint | Specified |
| **LIB-007** | A reference to a record that cannot be resolved must fail the publish, naming the record and where it was used                                                                                                                                     | Constraint | Specified |
| **LIB-041** | A record identifier must be unique within the tenant rather than within its space, so that a library shared between spaces (LIB-030) presents one identity everywhere it appears                                                                   | Constraint | Specified |
| **LIB-042** | A shared library must be one record seen from several spaces, never a copy per space: an edit in one is the edit everywhere, and who may see it is each space's (LIB-001)                                                                          | Constraint | Specified |
| **LIB-043** | Two records may carry the same label in different spaces, because a label is not an identity (LIB-002). Where a shared record and a private one collide by label, both must be offered with the space each came from named, and the author chooses | T2         | Specified |
| **LIB-047** | A change to a record must reach an unpinned reference at the next publish, and must never reach a baseline that pinned an earlier version (LIB-004, **VER**)                                                                                       | Constraint | Specified |
| **LIB-048** | Records that have changed since a document last published must be listable for that document, so that a change reaching a reference is visible before the publish rather than after it (LIB-005)                                                   | T3         | Specified |
| **LIB-056** | Creating, changing, deprecating and retiring a library record must be audited with who, when and what changed (**LIF-026**, **LIF-027**)                                                                                                           | Constraint | Specified |
| **LIB-057** | Inserting a reference to a deprecated term, or to a deprecated or retired vocabulary value, must be flagged at the moment of insertion as well as where it is already used (LIB-018, LIB-023, LIB-055)                                             | T6         | Specified |

**LIB-041 to LIB-043 settle what identity means here, which review found the least specified thing
relative to what depends on it.** Sharing a glossary between spaces (LIB-030) only makes sense if the
shared record is one record: identifiers are unique across the tenant, a share is a view rather than
a copy, and the same term seen from two spaces is the same term. Labels collide and that is fine -
a label was never the identity - so the answer to a collision is to say where each came from and let
somebody choose, not to prevent it.

**LIB-047 and LIB-048 state the local consequence of versioning, which LIB-004 had delegated
entirely.** The mechanics are **VER**'s; what an author needs to know is that an edit to a term
reaches every unpinned reference at the next publish and no baseline ever, and that they can see
which records changed before the publish that carries them.

**LIB-057 moves a check to where it is cheapest.** Flagging a deprecated term wherever it is used
(LIB-018) is right and late; the moment somebody inserts one is when the replacement costs a
keystroke.

## 4. Bibliography

| ID          | Requirement                                                                                                                                                                                                                                            | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **LIB-008** | A bibliography entry must hold the fields the citation styles in use require, by source type                                                                                                                                                           | T6      | Specified |
| **LIB-009** | Entries must be importable from standard interchange formats, and exportable the same way                                                                                                                                                              | T6      | Specified |
| **LIB-010** | Import must detect a record that already exists rather than creating a second, and must say what it merged                                                                                                                                             | T6      | Specified |
| **LIB-011** | An entry must be able to record where it was obtained and when it was last checked, because a source that has moved is a common defect                                                                                                                 | T6      | Specified |
| **LIB-012** | An entry missing a field its citation style requires must fail the publish, naming both                                                                                                                                                                | T6      | Specified |
| **LIB-044** | Creating an entry by hand must run the same duplicate detection as import (LIB-010), and must offer the existing record rather than refusing the creation                                                                                              | T6      | Specified |
| **LIB-045** | Duplicate detection must use canonical identifiers first - DOI, PubMed identifier, ISBN, ISSN where the entry has one - and only where none exists fall back to a declared comparison of title, authors and year. Which it used must be said           | T6      | Specified |
| **LIB-046** | An entry's in-text citation key must be generated from the fields it holds, must be unique within a document, and must not change for the life of the entry. How two entries that would render identically are told apart is the style's (**STY-022**) | T6      | Specified |

**LIB-010 is the difference between a bibliography and a pile.** Four records for one paper produce
four entries in a reference list, and nobody notices until a reviewer does.

**LIB-044 and LIB-045 close the door LIB-010 left open**, which review put exactly: import was
guarded and hand-creation was not, so the fourth copy of a paper arrives by the route nobody
watched. Naming the canonical identifiers matters as much as extending the check - without them, an
implementation comparing titles as strings satisfies the requirement and still produces the pile.

**LIB-046 puts key generation here and key disambiguation in STY**, which review was right to say sat
awkwardly between the two. The key is made from fields this area holds, so it is made here; what two
identical-looking keys become is a property of the style, and STY-022 already owns it.

## 5. External reference sources

The literature a regulated report cites lives in PubMed, Crossref and half a dozen registries that
already do search and identity better than this product ever will. Holding a copy of one of them is
not a feature; **reaching into them, and being able to say afterwards that what was cited is still
what it was, is.**

So the product searches them, takes what it cites, and keeps that. The record is local from the
moment it is inserted - publishing cannot depend on a network - and the connection back to the source
exists to confirm rather than to fetch.

| ID          | Requirement                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-031** | An author must be able to search a configured external reference source from inside the editor and insert a citation from a result, without leaving the document and without keying the record in by hand                                                                                | T6         | Specified |
| **LIB-032** | The external sources the product supports must be a declared, versioned list rather than a hard-coded set, and adding one must follow the extension rules in **API** (**API-030**, **API-033**) (**LIB-Q07**)                                                                            | T6         | Specified |
| **LIB-033** | Inserting a citation from an external source must create a local bibliography entry holding the fields the citation styles require (LIB-008). A citation must never point at a remote record, and publishing must never depend on reaching one                                           | Constraint | Specified |
| **LIB-034** | An entry taken from an external source must record which source it came from and the canonical identifiers that source gave it, and those identifiers are what duplicate detection uses (LIB-045)                                                                                        | Constraint | Specified |
| **LIB-035** | An entry obtained from an external source must be re-checkable against that source - that it still exists, that the fields held still match, and that it has not been superseded - recording when the check last ran (LIB-011)                                                           | T6         | Specified |
| **LIB-036** | A retraction or a correction reported by the source must be surfaced wherever the entry is cited, and a lifecycle gate must be able to refuse to issue a document citing a retracted source (**LIF**, **LIB-Q08**)                                                                       | T6         | Specified |
| **LIB-037** | Searching an external source sends the author's terms outside the tenant boundary. Which sources a tenant permits must be configured, and that the search leaves the boundary must be stated in configuration rather than discovered (**GEN-031** is the same rule for a model endpoint) | Constraint | Specified |
| **LIB-038** | Credentials for an external source must be held in the tenant secret store, write-only from any client's perspective, on the same terms as a data connection (**ADM-006**, **DAT-003**)                                                                                                  | Constraint | Specified |
| **LIB-039** | A source that is unavailable, rate-limited or slow must fail visibly and must never block authoring: creating an entry by hand must remain available, and an unavailable source must never silently return nothing                                                                       | Constraint | Specified |
| **LIB-040** | Searching a source and inserting a citation from one must be available as tools in the interactive assistant (**GEN-052**), acting with the calling user's permissions (**GEN-008**) and producing a proposal a person accepts (**GEN-024**)                                             | T6         | Specified |

**LIB-033 is the requirement the rest of this section is arranged around.** A citation that resolves
over the network is a document that publishes differently on a bad afternoon, and in this market a
report has to render identically in five years - by which time the source may have reorganised its
identifiers, moved behind a paywall, or gone. So the entry is copied in at insertion and the source
is never on the publishing path.

**LIB-035 and LIB-036 are why the connection is worth keeping at all.** Once the record is local it
can go stale quietly, and the expensive version of stale is specific: a paper cited in a submission
was retracted eighteen months after somebody cited it. Confirming an entry is cheap, the answer is
worth having, and a gate that can refuse to issue over a retraction is what turns it from a report
into a control - **LIB-Q08** asks whether it blocks or warns, the same question **AST-Q04** asks
about a licence.

**LIB-037 is the privacy consequence nobody expects from a search box.** The terms an author types
to find a paper can disclose what a confidential programme is about, and they leave the tenant to do
it. That is the same shape as sending content to a model endpoint outside the boundary, and it gets
the same treatment: configured, declared, and never discovered afterwards.

**LIB-040 is where this meets the assistant.** "Find me the trials this claim rests on and cite
them" is the task an author actually has, and it is a good use of a tool surface that is closed by
construction (GEN-007). The tool searches and proposes; a person accepts, exactly as with every other
change a conversation makes.

## 6. Terms

| ID          | Requirement                                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-013** | A term entry must carry a preferred label, any number of alternative labels, an abbreviation, a definition and a status                                                                                                    | T6         | Specified |
| **LIB-014** | A term must carry a label per language, so that translation has something to translate against (**LOC**)                                                                                                                   | T6         | Specified |
| **LIB-015** | A term must be referenced from content and must never be typed as text (**CNT-031** carries the mark)                                                                                                                      | Constraint | Specified |
| **LIB-016** | First use of a term in a document must be resolvable at publish time, so that an expansion appears once and the abbreviation thereafter                                                                                    | T6         | Specified |
| **LIB-017** | Whether a term expands on first use, always, or never must be a property of the document's style rather than of the component                                                                                              | T6         | Specified |
| **LIB-018** | A deprecated term must be flagged wherever it is used, with its replacement named                                                                                                                                          | T6         | Specified |
| **LIB-019** | An author must be able to insert a term reference by typing its abbreviation or an alternative label                                                                                                                       | T6         | Specified |
| **LIB-049** | A term's status must come from a declared set, at minimum draft, approved and deprecated. Whether transitions through it are governed by a workflow gate is **LIB-Q01**; the value set itself must not wait on that answer | T6         | Specified |
| **LIB-050** | Where a requested language has no label (LIB-014), the term's label in its own declared base language must be used, and the fallback must be reported wherever it happened rather than passing as a translation            | T6         | Specified |

**LIB-049 unblocks a build that was waiting on a question.** Review is right that the status value
set was undefined pending LIB-Q01, and that this is a scheduling dependency rather than an
interesting uncertainty: draft, approved and deprecated are needed whatever the answer, and LIB-Q01
decides only whether moving between them passes a gate.

**LIB-050 answers what a missing translation does.** Falling back to the base label is the only
usable behaviour; doing it silently is what makes a half-translated glossary look finished.

**LIB-016 is the whole argument for terms being references.** Whether a mention is the first depends
on the document, and a component reused in two reports may be the first mention in one and the
fortieth in the other - so expanding into text would bake a document-level fact into reusable
content. This is the same reason numbering lives in the outline.

**LIB-019 is where phrase expansion belongs.** Typing `mah` and getting a reference is a convenience;
typing `mah` and getting plain text is the thing that must not happen, and the two look identical
until the day somebody renames the term.

## 7. Vocabularies

| ID          | Requirement                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-020** | A vocabulary must be a named list of permitted values, each with a label and a stable identifier                                                                                                                                                              | T2         | Specified |
| **LIB-021** | A metadata field must be able to draw its permitted values from a vocabulary (**TPL-008**)                                                                                                                                                                    | T2         | Specified |
| **LIB-022** | A condition axis must be able to draw its permitted values from a vocabulary (**REU-020**)                                                                                                                                                                    | T4         | Specified |
| **LIB-023** | Retiring a value must not invalidate documents already using it; it must stop being offered and must be flagged where used                                                                                                                                    | Constraint | Specified |
| **LIB-024** | A vocabulary must carry labels per language                                                                                                                                                                                                                   | T6         | Specified |
| **LIB-053** | A vocabulary must declare the order its values are offered in, and that order must be deterministic rather than whatever the store returns                                                                                                                    | T2         | Specified |
| **LIB-054** | A value must be able to carry an optional description, shown where the value is chosen                                                                                                                                                                        | T2         | Specified |
| **LIB-055** | A value must be able to be **deprecated** - still offered, marked, with its replacement named - as a state before **retired** (LIB-023), which is no longer offered and still valid where used. This is the term side's behaviour (LIB-018) applied to values | T2         | Specified |

**LIB-055 removes an asymmetry review found between the two halves of this document.** A term can
be deprecated with a replacement named while people still use it; a value could only be retired, so
the only way to discourage one was to stop offering it, which is a harder change to make in a
vocabulary somebody is mid-way through adopting.

**LIB-023 is the one that gets missed.** A value removed from a vocabulary leaves documents carrying
a metadata value that no longer validates, and the failure shows up months later at publish time on a
document nobody has touched.

## 8. Relations between terms

| ID          | Requirement                                                                                                                                                      | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIB-025** | A term must be able to declare broader, narrower and related terms                                                                                               | T6         | Specified |
| **LIB-026** | Search must use those relations and the alternative labels, so that looking for one term finds documents using another (**SCH**)                                 | T6         | Specified |
| **LIB-027** | The relations must be a thesaurus and must not support inference - nothing may be concluded that somebody did not state                                          | Constraint | Specified |
| **LIB-051** | Broader and narrower must form an acyclic graph. An edit that would create a cycle must be refused at the point of the edit, not discovered by a traversal later | Constraint | Specified |
| **LIB-052** | Related must be symmetric: stating it once must make it true in both directions, and removing it must remove both                                                | Constraint | Specified |

**LIB-051 and LIB-052 are cheap now and a migration later**, which is the whole reason to write
them down before there is data. A thesaurus that has acquired a cycle cannot be walked, and a
`related` that is symmetric in one direction only produces a search that finds a term from one side
and not the other - both are the kind of defect that arrives quietly and is then everywhere.

**LIB-027 is deliberate and worth defending.** [REL](../Project_Scope.md) already provides a declared,
queryable relationship graph. What a regulated customer needs is to find things; what they cannot
accept is a system asserting something nobody wrote, because "the system inferred it" is not an
answer anybody can sign.

## 9. Interchange

| ID          | Requirement                                                                                             | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **LIB-028** | Terms and vocabularies must be exportable and importable in a documented format                         | T6      | Specified |
| **LIB-029** | Import must report what it could not represent rather than dropping it                                  | T6      | Specified |
| **LIB-030** | A library must be shareable between spaces within a tenant, so that a house glossary is maintained once | T2      | Specified |

## 10. Non-requirements

| ID          | Not this                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIB-N01** | **No ontology with inference** (LIB-027)                                                                                                                                                                               |
| **LIB-N02** | **No terminology as text macros.** A term is a reference; expansion is how one is inserted, not what one becomes (LIB-019)                                                                                             |
| **LIB-N03** | **No boilerplate here.** A standard phrase or paragraph is reuse, and belongs to **REU** as a component or a variable                                                                                                  |
| **LIB-N04** | **Not a full termbase.** Concept-level modelling, term extraction and translation memory are separate products                                                                                                         |
| **LIB-N05** | **One definition per term.** A term carrying two senses is two terms. Concept-level modelling is the termbase LIB-N04 rules out, and a single definition slot is the deliberate consequence                            |
| **LIB-N06** | **No mirror of an external source.** The product searches PubMed, Crossref and their like and keeps what a document cites (LIB-031, LIB-033). Ingesting a registry would be maintaining somebody else's database badly |

## 11. Open questions

| ID          | Question                                                                                                                                                                                                 | What would settle it                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIB-Q01** | **Does a term need a lifecycle of its own?** A glossary in a regulated environment is often approved, which means states and gates                                                                       | Whether customers govern terminology the way they govern content. In pharma they do                                                                                                                                         |
| **LIB-Q02** | **Where does first-use expansion reset (LIB-016)?** Per document is obvious; per chapter is what several house styles actually require                                                                   | Real house styles. It is a publishing-layout property if it varies                                                                                                                                                          |
| **LIB-Q03** | **Do bibliographies need to be per space or shared (LIB-030)?** A shared one is maintained once and permissioned coarsely                                                                                | Whether early customers' sources are confidential. In clinical work they can be                                                                                                                                             |
| **LIB-Q04** | **Should the product detect terms an author typed as text?** Suggesting a reference where somebody wrote the words is valuable and intrusive                                                             | Whether it can be offered without becoming a spell-checker that argues                                                                                                                                                      |
| **LIB-Q05** | **How are record identities scoped - space, tenant or global - and does a shared library expose one identity or a view per space?**                                                                      | **Settled.** Unique within the tenant, and a share is one record seen from several spaces rather than a copy in each (LIB-041, LIB-042). Labels may collide across spaces, because a label was never the identity (LIB-043) |
| **LIB-Q06** | **Is bibliography dedupe enforced at manual creation as well as import, and on which fields?**                                                                                                           | **Settled.** Both, on the same detection (LIB-044), using canonical identifiers first - DOI, PubMed identifier, ISBN, ISSN - and a declared title-author-year comparison only where none exists (LIB-045)                   |
| **LIB-Q07** | **Which external sources are in the declared list (LIB-032)?** PubMed and Crossref are the obvious two for this market; registries, standards bodies and a customer's own catalogue each cost an adapter | The first customers' citation practice. The list is declared and extensible either way, so this decides the order it grows in rather than whether it can                                                                    |
| **LIB-Q08** | **Does a retracted source block a publish or warn (LIB-036)?**                                                                                                                                           | Whether customers treat a retraction as a control or as a record - the same question **AST-Q04** asks about a licence, and it should get the same answer                                                                    |

## 12. Traceability

| This document      | Rests on                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Section 1          | Scope §7.21, from the ownership pass                                                          |
| LIB-015, LIB-016   | The first-use argument; the same rule as numbering in **STR**                                 |
| LIB-021, LIB-022   | TPL-008, REU-020 - who declares a vocabulary and who holds it                                 |
| LIB-027            | Scope §7.12, a declared relationship graph rather than inference                              |
| LIB-014, LIB-024   | Scope §7.16, multilingual content                                                             |
| LIB-010, LIB-023   | No upstream dependency - self-contained invariants, and the two this document most depends on |
| Section 5          | The v1 review's primary gap: reach external sources, do not mirror them                       |
| LIB-031 to LIB-057 | [The v1 review](<../../reviews/LIB - Reference libraries.md>); section 13                     |
| LIB-037            | GEN-031 - content leaving the tenant boundary is configured, never discovered                 |
| LIB-040            | GEN-008, GEN-024, GEN-052 - a tool acts as the caller and proposes                            |
| LIB-046            | STY-022 - the style disambiguates two keys that would render alike                            |
| LIB-056            | LIF-026, LIF-027 - who changed what, when, against which version                              |
| LIB-001            | IAM-018 to IAM-021 - a space's permissions and the roles that carry them                      |

## 13. Change history

One row per change, against [the review](<../../reviews/LIB - Reference libraries.md>) that prompted
it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### The primary gap

| Point                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| External reference sources | **A new section 5, LIB-031 to LIB-040**, built on the review's own distinction: there is no benefit in ingesting PubMed, and there is a great deal in reaching it. Search from inside the editor and insert a citation from a result (LIB-031); a declared, extensible list of sources rather than a hard-coded set (LIB-032, **LIB-Q07**); the entry copied local at insertion so publishing never depends on a network (LIB-033); canonical identifiers recorded and used for dedupe (LIB-034); confirmation that a cited source still says what it said, and a retraction surfaced with a gate that can refuse to issue (LIB-035, LIB-036, **LIB-Q08**); the search declared as leaving the tenant boundary (LIB-037); credentials in the secret store (LIB-038); an unavailable source that never blocks authoring (LIB-039); and the whole thing available as tools in the interactive assistant (LIB-040). **LIB-N06** says the product does not mirror a registry |

### Other gaps and weaknesses

| Point                                      | Change                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and identifiers                   | **LIB-041** (unique within the tenant, not the space), **LIB-042** (a shared library is one record seen from several spaces, never a copy) and **LIB-043** (labels may collide across spaces, because a label is not an identity - both are offered with their space named). Recorded as **LIB-Q05**, settled |
| Bibliographic dedupe                       | **LIB-044** extends detection to hand-creation, and **LIB-045** names the canonical identifiers - DOI, PubMed identifier, ISBN, ISSN - so that an implementation comparing title strings no longer satisfies the requirement. Recorded as **LIB-Q06**, settled                                                |
| The in-text citation key                   | **LIB-046**: generated here from fields this area holds, unique within a document, stable for the life of the entry; disambiguating two that would render alike stays **STY-022**'s                                                                                                                           |
| Versioning consequences                    | **LIB-047** (a change reaches an unpinned reference at the next publish and no baseline ever) and **LIB-048** (records changed since a document last published are listable for it)                                                                                                                           |
| Term status value set                      | **LIB-049**: draft, approved and deprecated at minimum, declared now. LIB-Q01 decides only whether transitions pass a gate, so the build is no longer waiting on it                                                                                                                                           |
| Locale fallback                            | **LIB-050**: fall back to the record's own base language, and report the fallback rather than passing it off as a translation                                                                                                                                                                                 |
| Thesaurus structural validation            | **LIB-051** (broader and narrower acyclic, refused at the edit) and **LIB-052** (related is symmetric, both ways, including removal)                                                                                                                                                                          |
| One definition per term                    | **LIB-N05** states it as deliberate, alongside LIB-N04                                                                                                                                                                                                                                                        |
| Vocabulary order, description, deprecation | **LIB-053** (declared deterministic order), **LIB-054** (an optional description) and **LIB-055** (a deprecated state before retired, matching what terms already had)                                                                                                                                        |
| Multiple vocabularies per field            | **TPL**'s, and a boundary row now says so                                                                                                                                                                                                                                                                     |
| Authoring-time feedback                    | **LIB-057**: a deprecated term or value is flagged at the moment of insertion as well as where it is used, which is when acting on it costs a keystroke                                                                                                                                                       |
| Traceability omits LIB-010 and LIB-023     | Both added, marked as self-contained invariants with no upstream dependency, so their absence is deliberate rather than accidental                                                                                                                                                                            |

### Cross-cutting, checked rather than assumed

| Check                                | Finding                                                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which roles edit versus read records | **Covered by IAM**: LIB-001 permissions a record by its space, IAM-018 to IAM-021 carry the levels, the permission set and tenant-defined roles. Cited in traceability now rather than assumed                          |
| Audit of a change to a term          | **Partly covered, and now explicit.** LIF-026 records a content change and LIF-027 the who, what, when and version - but whether a library record counts as content was an inference. **LIB-056** removes the inference |

### Counts

|                  | Before | After                                    |
| ---------------- | ------ | ---------------------------------------- |
| Requirements     | 30     | 57                                       |
| Non-requirements | 4      | 6                                        |
| Open questions   | 4      | 8, of which 2 settled as they were added |
