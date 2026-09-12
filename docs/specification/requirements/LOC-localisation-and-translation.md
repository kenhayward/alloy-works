# LOC - Localisation and translation

> **Status: v1, for review.**

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

| Not here                                      | There            |
| --------------------------------------------- | ---------------- |
| Language tags on a run of text                | **CNT**          |
| Labels per language on a term                 | **LIB**          |
| Which language a document publishes in        | **PUB**          |
| Who may translate                             | **IAM**          |
| Where a tenant policy is declared and audited | **ADM**          |
| Formatting a bound value                      | **STY**, **TAB** |
| Accepting a draft, as an audited act          | **GEN**          |

## 3. Interface

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                        | Tranche    | Status                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **LOC-001** | Every string the interface shows must be localisable, and none may be assembled from fragments at run time                                                                                                                                                                                                                                                                         | Constraint | Superseded by LOC-027 |
| **LOC-002** | Dates, times, numbers and currency must be formatted for the user's locale                                                                                                                                                                                                                                                                                                         | T6         | Superseded by LOC-028 |
| **LOC-003** | Sorting and collation must follow the user's locale rather than byte order                                                                                                                                                                                                                                                                                                         | T6         | Specified             |
| **LOC-004** | Right-to-left interface layout must be supported, not only right-to-left text                                                                                                                                                                                                                                                                                                      | T6         | Specified             |
| **LOC-005** | A user's interface language must be independent of the language of the content they are working on                                                                                                                                                                                                                                                                                 | T6         | Specified             |
| **LOC-006** | Layout must tolerate translated text being substantially longer than the original without truncating or overlapping                                                                                                                                                                                                                                                                | T6         | Superseded by LOC-029 |
| **LOC-027** | Every string the interface shows must be localisable, and must never be assembled from fragments by application code. Where a message varies by number or by gender it must use a locale-aware message format over the categories the locale itself declares, never concatenation                                                                                                  | Constraint | Specified             |
| **LOC-028** | In the interface, dates, times, numbers and currency must be formatted for the user's own locale. In content and in published output they must be formatted for the locale of the language being published, because a published document has one locale and its reader may have another. A currency amount must carry the currency it is in; only its presentation is the locale's | Constraint | Specified             |
| **LOC-029** | Layout must survive translated text 50% longer than its source, and 100% longer for strings under twenty characters, without truncation or overlap - verified by an automated suite running in pseudolocalisation (LOC-042) rather than by inspection                                                                                                                              | T6         | Specified             |
| **LOC-034** | Every language tag in this product must be a BCP 47 tag, carrying a region wherever the region changes the content - `pt-BR` distinct from `pt-PT` - so that a regional variant is expressible at all (**CNT-083**)                                                                                                                                                                | Constraint | Specified             |
| **LOC-038** | The languages and locales the product supports must be a declared list, and locale data - formats, collation, plural categories - must come from a named, versioned source, with the version recorded so that a change in it is a visible change rather than a drift in output (**LOC-Q05**)                                                                                       | T6         | Specified             |
| **LOC-042** | Pseudolocalisation must be available as a mode - expanded, accented, bracketed strings - and the interface suite must run in it and in a right-to-left locale, so that LOC-004 and LOC-029 are verified rather than asserted                                                                                                                                                       | T6         | Specified             |

**LOC-027 replaces LOC-001 because the old wording forbade the solution.** "None may be assembled
from fragments at run time" rules out exactly what a plural form is: a message assembled with a
number, by a formatter that knows the locale's categories. The intent was always that application
code must not do grammar - so that is what it says now, and it names the mechanism that may.

The reason is invisible in English. "Deleted 3 items" built from a verb, a number and a noun cannot
be translated into a language that inflects the noun by number, and the defect only appears once
somebody translates it.

**LOC-028 answers "whose locale", which LOC-002 left open** once LOC-005 made the interface language
independent of the content's. The split is the one a publishing product needs: chrome follows the
person, and a published document follows the language it is published in. A French report shows
French date forms to an English reader, because it is a French report.

**LOC-029 turns "substantially longer" into a number that can fail.** Fifty per cent, and double for
short strings, is the industry's own rule of thumb and is defensible; what matters more is that it is
checkable, because any amount of stretch can be declared acceptable by somebody looking at one
screen.

**LOC-034 states a dependency rather than assuming it.** CNT-083 records a language; LOC-002 and
LOC-003 are only implementable if that tag distinguishes `pt-BR` from `pt-PT`, and nothing said so.
It says so here.

## 4. Content variants

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                    | Tranche    | Status                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **LOC-007** | A component must be able to exist in more than one language, as variants of one component rather than as separate components                                                                                                                                                                                                                                   | T6         | Specified             |
| **LOC-008** | One language must be the source, and the others must be identified as translations of a particular version of it                                                                                                                                                                                                                                               | Constraint | Specified             |
| **LOC-009** | The content model must accommodate language variants from T1, even though translation ships in T6                                                                                                                                                                                                                                                              | Constraint | Specified             |
| **LOC-010** | A document must be publishable in a language, and must resolve to the variants for that language                                                                                                                                                                                                                                                               | T6         | Specified             |
| **LOC-011** | Where a variant is missing, publishing must fail or fall back to the source by a declared policy - never silently mix languages                                                                                                                                                                                                                                | Constraint | Superseded by LOC-037 |
| **LOC-012** | A variant must be versioned like any other content (**VER-011**)                                                                                                                                                                                                                                                                                               | T6         | Specified             |
| **LOC-037** | Where a variant is missing, publishing must either fail or fall back to the source, by a policy declared for the document rather than per component. Where it falls back, every component appearing in the source language must be marked as untranslated in the output, so that mixed language is a stated outcome and never an accident (LOC-N04)            | Constraint | Specified             |
| **LOC-036** | Every policy this area defers to - fallback (LOC-037), publish refusal (LOC-017), sending content to an external service (LOC-026), and what happens to a conflicted import (LOC-035) - must be a declared tenant setting, versioned and audited like any other configuration (**ADM-001**), and must state its default                                        | T6         | Specified             |
| **LOC-039** | Locale-aware formatting inside content must use the same mechanism as the interface (LOC-027): where a sentence in a variant varies by a number or a gender that a bound value supplies, it must be a locale-aware message form rather than text assembled around the value (**CNT** owns the node, **STY** and **TAB** own how the value itself is formatted) | T6         | Specified             |

**LOC-037 replaces LOC-011 because the old wording permitted two readings that contradict each
other.** Falling back per component produces a page that is nine-tenths translated, which is the
mixed-language output LOC-N04 forbids - unless the mixture is declared and marked, which is what
makes it a decision rather than an accident. So the policy belongs to the document, and a fallback
that happens is visible in the output.

**LOC-036 gives the policies somewhere to live.** Four requirements in this document defer to "a
declared policy" and none said where one is declared, by whom, or what happens when it changes.
They are tenant configuration, which **ADM** already owns and audits.

**LOC-009 is the requirement that costs nothing now and everything later.** Adding a language
dimension to content that is already stored and immutable is a migration of every version ever
written - which is why the scope says it at tranche level and why it is repeated here as a
constraint.

## 5. Translation status

| ID          | Requirement                                                                                                                                                                                                                                                                                                  | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LOC-013** | Each variant must carry a status against the source version it was translated from                                                                                                                                                                                                                           | T6         | Specified |
| **LOC-014** | A change to the source must invalidate the status of every translation of it, immediately and visibly                                                                                                                                                                                                        | Constraint | Specified |
| **LOC-015** | The status must distinguish a source change that needs retranslation from one that does not - a typo fix is not a new translation job                                                                                                                                                                        | T6         | Specified |
| **LOC-016** | Translation status must be visible wherever a component is used, and reportable across a space                                                                                                                                                                                                               | T6         | Specified |
| **LOC-017** | Publishing must be refusable where a document contains out-of-date translations, by policy                                                                                                                                                                                                                   | T6         | Specified |
| **LOC-030** | The statuses a variant may carry must be a declared set: **untranslated**, **machine-drafted**, **in translation** where a job is out, **translated**, and **out of date** against a changed source. Approval is a workflow state (**LIF**) and must not be conflated with a translation status              | T6         | Specified |
| **LOC-031** | Whether a source change needs retranslation (LOC-015) must be declared by the person making it, defaulting to yes where they say nothing, recorded with the change and revisable afterwards by anybody who may translate. The status itself must still go out of date immediately and mechanically (LOC-014) | T6         | Specified |
| **LOC-032** | A model may propose that classification but must never set it: the record must always name the person who declared it (**GEN-024**)                                                                                                                                                                          | Constraint | Specified |
| **LOC-040** | Where a source change needs retranslation, the previous variant must be offered as the starting point rather than a blank or a raw machine draft. This is the component's own earlier translation, not a translation memory (LOC-N02)                                                                        | T6         | Specified |

**LOC-030 names a state set three requirements were already depending on.** LOC-013 required a
status, LOC-015 required it to distinguish two kinds of source change, and LOC-017 made publishing
refusable on it - and nothing said what the values were. Approval is kept out deliberately: a
translated variant that has not been approved is a **LIF** state, and merging the two vocabularies is
how "approved" comes to mean two different things in one screen.

**LOC-031 and LOC-032 answer who classifies, which review was right to press on.** Read literally,
LOC-014 and LOC-015 together demanded that every source edit be triaged immediately or block
publishing everywhere downstream. The split that makes it workable: the status goes out of date
mechanically and at once, and whether the change needs retranslation is a statement the editor makes
while they are making the change, defaulting to yes. A model may suggest; only a person may declare.

**LOC-040 answers a tension review found between LOC-N02 and LOC-015.** Retranslation after a source
change should not start from nothing, and this product holds no translation memory - but it does hold
the component's own previous variant, which is the thing a translator actually wants. Offering it is
not building a TM.

**LOC-014 is the whole reason translation belongs inside the product rather than beside it.** A
translation in a separate system goes stale silently, and nobody discovers it until a reader of the
translated version reads something the source stopped saying a year ago.

## 6. Vendor round-trip

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **LOC-018** | Content must be exportable to XLIFF for a translation vendor, and importable back                                                                                                                                                                                                                                                                                                                                                                            | T6         | Specified             |
| **LOC-019** | The export must carry enough context for a translator to work - surrounding text, the component's purpose, terminology                                                                                                                                                                                                                                                                                                                                       | T6         | Specified             |
| **LOC-020** | Structure, marks, references, bindings and terms must survive the round-trip and must not be translatable as text                                                                                                                                                                                                                                                                                                                                            | Constraint | Specified             |
| **LOC-021** | An import must report anything it could not place, rather than dropping it (**IMP-007**)                                                                                                                                                                                                                                                                                                                                                                     | Constraint | Specified             |
| **LOC-022** | A translation job must be trackable: what was sent, when, to whom, and what has come back                                                                                                                                                                                                                                                                                                                                                                    | T6         | Superseded by LOC-033 |
| **LOC-033** | A translation job must be trackable: what was sent, **which version of the source it was sent from**, when, to whom, and what has come back                                                                                                                                                                                                                                                                                                                  | T6         | Specified             |
| **LOC-035** | An import must be checked against the source version it was sent from (LOC-033). Where the source has moved since, the import must never be applied silently: the conflict must be reported and the outcome chosen - accepted as a translation of the older version and marked out of date, rejected, or placed for review against the changed source - by a person, with the default declared as policy (LOC-036)                                           | Constraint | Specified             |
| **LOC-043** | A bound value must stay inert through the round trip (LOC-020). Where a source returns display text that must appear in another language, it must be translated at resolution against a declared lookup - a vocabulary in **LIB** keyed by the value the source returned - and never by editing the binding or its result inside a variant. Where no lookup exists, the value must render in the language the source gave it and be reported as untranslated | Constraint | Specified             |

**LOC-035 closes what review called the largest gap, and it is a gap on the return leg.** A source
document does not stop being edited because a vendor has it. When the translation comes back against
a base that has moved, applying it silently produces a translated variant of a version that no longer
exists - and LOC-021 does not cover this, because nothing was dropped. Three outcomes are reasonable
and the product must not pick one on somebody's behalf; what it must do is notice, which needs the
source version LOC-033 now records.

**LOC-043 settles LOC-Q03 against LOC-020, which read as a contradiction and was one.** A constraint
saying bindings must not be translatable as text sat beside a question asking whether bound values
get translated, and both are right: the binding stays inert, and the translation happens at
resolution, against a lookup somebody declared. That keeps a variant free of resolved data - which is
what LOC-020 was protecting - while answering the case that made the question worth asking.

**LOC-020 is where a translation round-trip usually breaks.** A cross-reference sent as the number it
resolved to comes back as a translated number; a term sent as text comes back as somebody's guess.
Sending references as references is what makes the terminology work in LIB pay for itself.

## 7. Machine translation

| ID          | Requirement                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LOC-023** | Machine translation must be available as an assist, producing a draft variant rather than a finished one                                                                                      | T6         | Specified |
| **LOC-024** | Machine-translated content must be marked as such until a human accepts it, on the same terms as **GEN-022**                                                                                  | Constraint | Specified |
| **LOC-025** | A machine translation must use the tenant's terminology, and must be checkable against it                                                                                                     | T6         | Specified |
| **LOC-026** | Whether content may be sent to an external translation service must be a tenant policy, not a default                                                                                         | Constraint | Specified |
| **LOC-041** | Accepting a machine-drafted variant must be an audited act naming the person who accepted it (**GEN-024**, not only GEN-022's marking), and who may perform it must be a permission (**IAM**) | Constraint | Specified |

**LOC-041 is a check that came back half-covered.** LOC-024 deferred to GEN-022, which marks
generated content until somebody accepts it and says nothing about the act of accepting. GEN-024 is
the one that makes acceptance audited and attributed, and who may do it belongs to **IAM** - a
translator's permission, not an author's.

## 8. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOC-N01** | **Not a translation management system.** Vendor selection, quoting and translator workbenches belong to a TMS                                                                                                                                |
| **LOC-N02** | **No translation memory of its own.** That belongs with the vendor's tooling                                                                                                                                                                 |
| **LOC-N03** | **No automatic publication of machine translation** (LOC-024)                                                                                                                                                                                |
| **LOC-N04** | **No mixed-language output by accident** (LOC-011)                                                                                                                                                                                           |
| **LOC-N05** | **No translating a binding.** A bound value is translated at resolution against a declared lookup, or it is not translated at all (LOC-043). Editing a resolved value inside a variant is how a document comes to disagree with its own data |

## 9. Open questions

| ID          | Question                                                                                                                                                                                                                              | What would settle it                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOC-Q01** | **Can the source language differ per component, or is it per space?** An acquired department may author in another language                                                                                                           | Real customers. Per component is more general and complicates every status calculation                                                                                                                                                                               |
| **LOC-Q02** | **What granularity does translation status need (LOC-015)?** Per component is simple; per block is what avoids retranslating a page for one word                                                                                      | The cost of retranslation in practice, which is a commercial question                                                                                                                                                                                                |
| **LOC-Q03** | **Do bound values get translated?** A number does not; a category name returned by a query might                                                                                                                                      | **Settled: yes, at resolution, never in the variant.** A declared lookup keyed by what the source returned (LOC-043), so the binding stays inert as LOC-020 requires. Where no lookup exists the value renders as the source gave it and is reported as untranslated |
| **LOC-Q04** | **Does a document's outline translate?** Section titles are content; the structure is not                                                                                                                                             | Whether translated documents ever differ structurally, which in regulated submissions they sometimes must                                                                                                                                                            |
| **LOC-Q05** | **Which languages and locales are supported at launch (LOC-038)?** The list is declared and the locale data versioned either way; what is open is which entries it starts with, and which right-to-left locale the suite runs against | The first customers' markets. A regulated submission's languages are decided by where it is filed, so this follows the first filing rather than a product preference                                                                                                 |

## 10. Traceability

| This document      | Rests on                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Section 3          | Scope §7.16 UX localisation                                                                  |
| LOC-009            | Scope §7.16 and §12, the T1 model constraint                                                 |
| LOC-020            | LIB - terms as references rather than text                                                   |
| LOC-024            | GEN-022, generated content marked until accepted                                             |
| LOC-021            | IMP-007, nothing dropped without being reported                                              |
| LOC-034            | CNT-083 - the language tag this area needs to be a BCP 47 locale                             |
| LOC-036            | ADM-001 - a tenant policy is configuration, declared and audited                             |
| LOC-041            | GEN-024 - acceptance is an audited act naming a person; IAM carries the permission           |
| LOC-043            | LIB - the vocabulary a resolved value is translated against; LOC-020 keeps the binding inert |
| LOC-027 to LOC-043 | [The v1 review](<../../reviews/LOC - Localisation and translation.md>); section 11           |

## 11. Change history

One row per change, against
[the review](<../../reviews/LOC - Localisation and translation.md>) that prompted it. The rules for
what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Requirements that needed sharpening

| Point                            | Change                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC-001 forbade the solution     | **Superseded by LOC-027.** "No fragments at run time" ruled out exactly what a plural form is. The rule is that application code must not do grammar, and a locale-aware message format over the locale's own categories is the mechanism that may                                                                                                   |
| LOC-002: whose locale            | **Superseded by LOC-028.** The interface follows the person; content and published output follow the language being published, because a published document has one locale and its reader may have another. A currency amount carries its currency, and only the presentation is the locale's                                                        |
| LOC-006: "substantially longer"  | **Superseded by LOC-029**: 50% longer, 100% for strings under twenty characters, verified by a suite running in pseudolocalisation (LOC-042) rather than by looking at a screen                                                                                                                                                                      |
| LOC-013: the status vocabulary   | **LOC-030** names the set - untranslated, machine-drafted, in translation, translated, out of date - and keeps approval out of it, because a **LIF** state and a translation status sharing a word is how "approved" comes to mean two things                                                                                                        |
| LOC-014 with LOC-015 and LOC-017 | **LOC-031 and LOC-032.** Read literally, every source edit had to be triaged immediately or block publishing downstream. The split: the status goes out of date mechanically and at once, and whether retranslation is needed is a statement the editor makes while editing, defaulting to yes. A model may propose it; only a person may declare it |
| LOC-022 omits the source version | **Superseded by LOC-033**, which records which version was sent - the datum LOC-035 needs and which costs nothing today                                                                                                                                                                                                                              |
| Language against locale          | **LOC-034**: BCP 47, with a region wherever the region changes the content. CNT-083 records a language and does not say this, so this document states what it depends on                                                                                                                                                                             |

### Missing areas

| Gap                           | Change                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-flight round-trip conflict | **LOC-035**, the largest one. A source keeps being edited while a vendor has it, and a return against a moved base is not something LOC-021 covers because nothing was dropped. The product must notice - which needs LOC-033's source version - report, and let a person choose between accepting it as a translation of the older version, rejecting it, or placing it for review |
| Dangling policy objects       | **LOC-036**: the four policies this document defers to are tenant configuration, declared, versioned and audited under **ADM-001**, each with a stated default                                                                                                                                                                                                                      |
| Fallback granularity          | **LOC-011 superseded by LOC-037.** Per-component fallback produces the nine-tenths-translated page LOC-N04 forbids, so the policy is the document's, and a fallback that happens is marked in the output - a stated outcome rather than an accident                                                                                                                                 |
| The supported language set    | **LOC-038** (a declared list, and locale data from a named versioned source so a data update is visible rather than a drift) with **LOC-Q05** for which entries it starts with                                                                                                                                                                                                      |
| Content-side grammar          | **LOC-039**: a sentence in a variant that varies by a number a binding supplies uses the same locale-aware mechanism as the interface. CNT owns the node and STY owns the value's format, so this says which parts are whose                                                                                                                                                        |
| Retranslation assist tension  | **LOC-040** resolves it rather than acknowledging it: the starting point for a retranslation is the component's own previous variant, which is what a translator wants and is not a translation memory                                                                                                                                                                              |
| Acceptance of machine drafts  | **LOC-041.** The check came back half-covered - GEN-022 marks, **GEN-024** makes acceptance audited and attributed - so LOC-024's citation was incomplete, and who may accept is a permission in **IAM**                                                                                                                                                                            |
| Testability hooks             | **LOC-042**: pseudolocalisation as a mode, and the interface suite run in it and in a right-to-left locale                                                                                                                                                                                                                                                                          |

### The internal tension

| Tension                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC-Q03 against LOC-020 | **Both were right, and LOC-043 is how.** The binding stays inert in the variant; a value the source returns as display text is translated **at resolution**, against a declared lookup in **LIB** keyed by what the source returned. No lookup means the value renders as the source gave it and is reported as untranslated. LOC-Q03 is settled, and **LOC-N05** forbids the shortcut of editing a resolved value inside a variant |

### Counts

|                  | Before | After                              |
| ---------------- | ------ | ---------------------------------- |
| Requirements     | 26     | 43, of which 5 superseded          |
| Non-requirements | 4      | 5                                  |
| Open questions   | 4      | 5, of which LOC-Q03 is now settled |
