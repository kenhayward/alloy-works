# Translation

How a component exists in more than one language, knows which source each translation follows, and
goes out of date when the source changes; and how a document publishes in a language: T6's fifth
slice. Ken's answers of 2026-10-22 and 2026-10-23 shaped it, and [the TR plan](../plans/2026-10-23-tr-translation.md)
builds it. XLIFF, translation jobs and machine translation are XL's; the interface's own localisation
is UI's.

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

| ID          | How it is met                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **LOC-007** | A variant is a language line of the one component                                               |
| **LOC-012** | A variant's versions are the chain's, on its line                                               |
| **LOC-013** | Each version on a language line records the source version it translates                        |
| **LOC-014** | Status is computed: out of date at any later source version, immediately                        |
| **LOC-015** | Out of date says whether any change since needs retranslating                                   |
| **LOC-031** | A source cut declares it, defaulting to yes; revisable by whoever may edit; audited             |
| **LOC-040** | An out-of-date variant opens on its earlier translation, beside the source blocks changed since |

LOC-010, LOC-017 and LOC-037 (publishing in a language, refusal and fallback) and LOC-016 (status
wherever a component is used, and across a space) are claimed as TRb and TRc build them. LOC-030's
declared set is defined here, but `machineDrafted` and `inTranslation` are XL's, so XL claims it.

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

## The page

**Translations** on a component's header lists each translation with its status and opens it; to
whoever may edit, it begins one and declares whether the source's latest version needs
retranslating. On a language line it shows the source's changed blocks, in words, and **Mark
current**. A language line is not offered in the **Line** chooser and never brought back.
