# Translation

How a component exists in more than one language, knows which source each translation follows, and
goes out of date when the source changes; and how a document publishes in a language: T6's fifth
slice. Ken's answers of 2026-10-22 and 2026-10-23 shaped it, and [the TR plan](../plans/2026-10-23-tr-translation.md)
builds it; [the XL plan](../plans/2026-10-23-xl-translation-jobs.md) adds XLIFF, translation jobs and
machine drafts. The interface's own localisation is UI's.

## The shape in one paragraph

A component's **variant** in a language is a **language line**: a line of its own beside the main
line ([Lines](storage-and-versioning.md#lines)), begun from the source's latest designated revision,
its blocks and their identifiers kept and its root in the variant's language. It has its own
versions, workflow and scope, so a translation is drafted, approved and scoped like any content, and
its approval is never another language's. Each version cut on it records the main-line version the
translator was shown; a main-line version may declare that it needs no retranslating. A variant's
**status** is computed, never stored: untranslated until its first cut, translated, or out of date the
moment a later source version exists, saying whether any change since needs new words. An
out-of-date translation opens on its own earlier words beside the source blocks changed since; one
needing no new words is **marked current**. A translation is never brought back into its source. Each
line holds its own editing lock, so translators and the author edit at once.

## Requirements owned

| ID          | How it is met                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **LOC-007** | A variant is a language line of the one component                                                               |
| **LOC-012** | A variant's versions are the chain's, on its line                                                               |
| **LOC-013** | Each version on a language line records the source version it translates                                        |
| **LOC-014** | Status is computed: out of date at any later source version, immediately                                        |
| **LOC-015** | Out of date says whether any change since needs retranslating                                                   |
| **LOC-031** | A source cut declares it, defaulting to yes; revisable by whoever may edit; audited                             |
| **LOC-040** | An out-of-date variant opens on its earlier translation, beside the source blocks changed since                 |
| **LOC-010** | A publish names its language; each reference reads its variant, under the layout's words in it                  |
| **LOC-017** | A translation out of date with a change needing retranslation refuses a publish where the policy says           |
| **LOC-037** | A missing variant falls back to the source, marked and reported, or refuses, as the document or the tenant says |
| **LOC-019** | A job's file carries the text either side, the component's title and type, and the terms it uses                |
| **LOC-018** | A job's file goes out as XLIFF 2.1 and comes back, read by the same mapping into each translation               |
| **LOC-033** | A job records what was sent, from which source version, when, to whom, and what came back                       |
| **LOC-035** | A return whose source or translation moved is held; a person accepts it as the older version's or rejects it    |

LOC-016 asks for status wherever a component is used: a document's references say it, and a space
reports it, but a search result and the components listing do not yet, so it is not claimed.
LOC-030's declared set is defined here, but `machineDrafted` and `inTranslation` are XL's, so XL
claims it. LOC-036 wants every policy it names - fallback, refusal, an external service, a conflicted
import - declared, versioned and audited: the first two are here, audited `settings.changed`; the
rest are XL's, which claims it.

## Storage

`artifact_line.language` (0159) is a language line's BCP 47 tag, one open per language per component,
its `name` the tag. `translation_state` records, insert-only, what each language line's newest
version translates, by a cut or by Mark current. `source_change` records, insert-only, whether a
main-line version needs retranslating; a version with none does. `component_lock` is keyed by
`(artifact_id, line_id)`, the main line's row carrying no line.

A cut on a language line names the source version the translator was shown; anything but the main
line's latest is refused `translation_source_stale`, so nothing records a source the translator never
saw. The variant's root language is its line's whatever a session sent.

## Reads that leave language lines out

`latestRevisionsOf`, which every approved reference reads, never returns a language line's revision:
a French approval is not the English source's. `openLinesOf`, which marks a component **Diverged**,
leaves them out: a translation says its status instead. A divergent line's revisions serve as R16
meant.

## The API

`GET` and `POST /v1/components/{id}/translations` list and begin; `POST .../translations/{line}/current`
marks current; `GET .../translations/{line}/source-changes` says what changed; `PUT
/v1/components/{id}/versions/{version}/retranslate` declares. A cut takes `translates` on a language
line and `retranslate` on the main line. A component read on a language line names its source's
latest version. The claim, take and release of a lock take `line`.

## Publishing in a language

A publish, a preview and a range preview take `language` (0160 records it on the request). Each
resolved reference reads its component's variant there: latest its line's newest, approved its line's
newest designated revision, pinned the newest variant translating the pinned version or an earlier
one. A variant serves the language asked for where either tag is a range of the other, its exact tag
first. Its reference's overrides are not applied, being made against the source's words, and are reported (`override_skipped`): an override that replaces words, to withhold them, must be made in the translation too. An approved reference reads the variant's newest designated revision in effect, in the profile's scope, translating the source version read or an earlier one; nothing translating words not yet approved.

Where a component has no variant, the document's own `fallback`, else the tenant's
`translation_policy` - a document's own standing over the environment's, as LOC-037 asks - either publishes the source - its own language tag on its words (PDF `/Lang`,
Word `w:lang`) and a note before them in the document's, the policy's words for that language or
`Untranslated`, with the source's tag (publishing/25, template 25, Word) - and reports it
(`component_untranslated`), or refuses the publish (`occurrence_untranslated`). A variant out of date
with a change needing retranslation is reported, or refuses where the policy says
(`translation_out_of_date`). Each occurrence's outcome is recorded on the request.

**A layout gives its words per language** (Ken; layout schema 8): `translations`, each complete - its
words, its scheme's labels, its matter's titles and its running matter - and `layoutIn` the one place a
layout is read in a language. A publish whose layout has no words in its language is refused
(`layout_language`, PUB-095). The default layout's 0.12 gives French and German.

## Titles by language

A document's title and each section's may be given in further languages (the outline's optional
`titles`, plain words by BCP 47 tag, never in its own; `translateTitle` sets or clears one). A
publish in a language prints each title given in it - in the contents, bookmarks, running heads and
cross-references, which read the outline - and its own where none is, reported
(`title_untranslated`). A translated title carries no marks.

## Status where used

A document's reference rows say each translation of the component placed and its status. `GET
/v1/spaces/{space}/translations` reports each component of a space the caller may read that has a
translation, read-filtered before it is capped at 500 and saying so; the **Translations** page,
linked from Components, shows it.

## Translation jobs

A **job** (0163) is a document's components sent to one language: each component it places, in
another language, needing it - no translation, an untranslated one, or one out of date by a change
declared to need retranslating - that no open job holds out. Its `translation_job_item` records the
source version sent, the translator's (latest designated) one, and the line's head then; a component
the maker may not edit, or one never designated, is listed and not sent. A translation is begun where
none is. A line an open job holds out is **in translation**, over untranslated and out of date,
until something comes back or the job is closed. Audited `translation.job_sent` and
`translation.job_closed`.

The **file** is XLIFF 2.1, written from the versions sent at each download, read-filtered then and
audited `export.downloaded`; nothing of it is stored. The mapping is the domain's
(`translation/xliff.ts`): a `<file>` a component, its title and type as notes; a `<unit>` a translatable
text, keyed `b.{block}` and a member (`.caption`, `.term.{k}`, `.column.{k}`, `.alternative`...), with
the text either side as context and the terms it uses in a `gls` glossary. Every inline node that is
not text, and text in code or another language, is a `<ph>` by its place; a mark is an `<sc>`/`<ec>`
pair; none may be copied or deleted. A unit's target is read back by the same mapping: every
placeholder exactly once, nothing invented, structure the source's. Pending insertions and comments are
not sent. A vendor's file leaves by a person's act, so no policy governs it.

`GET` and `POST /v1/documents/{id}/translation-jobs` list and make; `GET .../{job}/file` downloads;
`POST .../{job}/close` closes. **Translation jobs** in the Publishing panel does each.

## Returned files

`PUT .../{job}/return` keeps the file by its hash as it came (`translation_job_return`, 0164) and
queues `translation_return`. The worker reads it in a thread within an import's budget, by
`readXliff` (`packages/readers`): `readXml`'s guard, UTF-8 or UTF-16, segments and ignorables joined,
`<pc>` as a pair, `<cp>` as its character. A file in another language, or naming a component the job
did not send, is refused whole. Acting for the uploader, who must still edit each component, each
component's units are read back against the source version sent. One write path, `cutReturned`,
makes a version on its line, `translates` that version, where the source a translator is shown and
the line's head are as they were sent and nobody holds the line's lock. Anything else is **held**,
its words kept on the item. One that does not read back is **refused**, and a later file may return
it. Audited `translation.job_returned`.

A held item is still in translation. `GET .../items/{component}/held` shows it beside the source
blocks changed since. `POST .../decision` lets a person with edit on the component accept it, as a
translation of the version sent and so out of date at once, or reject it; audited
`translation.job_decided`. `translation_policy.conflict` (`review`, the default; `accept`; `reject`)
chooses the decision offered first and never decides.

## The page

The Publishing panel offers **Publish in** each language the document's layout gives its words in,
**Preview** beside it in the same language, **Translate titles**, and **Where a component has no
translation**: the document's own fallback, or the
environment's. Administration's **Translation** sets the environment's policy and the mark's words.

**Translations** on a component's header lists each translation with its status and opens it; to
whoever may edit, it begins one and declares whether the source's latest version needs
retranslating. On a language line it shows the source's changed blocks, in words, and **Mark
current**. A language line is not offered in the **Line** chooser and never brought back.
