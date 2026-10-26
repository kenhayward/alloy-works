# Interface localisation

How the interface speaks each person's language, independent of the content's: T6's seventh slice,
built by [the UI plan](../plans/2026-10-26-ui-interface-localisation.md). Ken's answers of 2026-10-26
shaped it.

## The shape in one paragraph

Every word a person reads in the renderer is a message in a catalogue, `apps/web/src/words/en-GB.json`,
in ICU message form, read by `words(key, values)` in the language the interface is in. Dates, numbers,
lists and plurals are formatted from CLDR as pinned FormatJS packages carry it, forced over the
runtime's own and recorded in `LOCALE_DATA`. The declared languages are English (`en-GB`) and two
pseudo-locales made from it (`en-XA`, expanded and accented; `ar-XB`, right to left), which the
browser suite walks so a word left in English, cut short or spilling shows. A person's language is
theirs (`principal.interface_language`, 0166), chosen from the header, else their browser's first
declared one; never any content's, which keeps its own language and direction.

## Requirements owned

| ID          | How it is met                                                                                |
| ----------- | -------------------------------------------------------------------------------------------- |
| **LOC-005** | A person's interface language is theirs, stored apart from and never read from any content's |

LOC-003, LOC-004, LOC-029, LOC-038 and LOC-042 are claimed as the slice's later PRs answer them: the
whole interface moved, sorted in the person's collation and laid out right to left.

## The mechanism

- `words(key, values)` is a function, not a hook: `WordsProvider` sets the language before anything
  beneath renders and remounts it when the language changes, so a word read in any function as a
  screen renders is in the person's language. With no provider, English.
- `formats()` gives the language's date, number and list formats and its collation.
- `wordsWith(key, values, elements)` places an element, a link, a `<time>` or a lozenge, where a whole
  message holds its placeholder, so a sentence around one stays one message.
- Text that is the tenant's, a title, a space's or a person's name, a workflow state's, carries
  `data-content`, so the pseudo walk tells it from the interface's words.
- A table of words at module scope holds keys, never words, read where it is shown.
- `en-XA` and `ar-XB` are made from English by `pseudolocalise`: letters accented, words bracketed,
  padded in breakable groups half again as long, twice under twenty characters; placeholders and
  plurals untouched.
- English locale data is bundled; another language's loads before it is shown.
- The ESLint rule `alloy/interface-words` refuses words written in place in the folders moved so far.
- `packages/editor` keeps its own words in `EDITOR_WORDS`, said through `say`; the renderer merges them
  into its catalogue as `pm.<key>` and gives them back through `sayWith`, so the views ProseMirror draws
  speak the person's language. With none given, as in the package's tests, English.

## Collation (UI-H)

Every request carries the interface language as `Accept-Language`. A listing whose order is a text key
sorts it with the ICU collation for that language that Postgres holds (`<locale>-x-icu`, then the
base language, then `und-x-icu`), in the cursor's keyset as in its order, and a cursor records the
language it was made in, refusing one from another. The renderer's own sorts use `formats().compare`.

## The API

`GET` and `PUT /v1/me/preferences` read and choose `interfaceLanguage`, a declared tag or null; `GET
/v1/me` carries it, so the first render is in it. A refusal's `message` stays English for integrators.

The service's sentences in a successful answer are worded by the renderer from codes beside them (UI-L),
the English kept for integrators: the assistant's `tool_result.said`, a prompt's `ended.refusal` and a
restore's `why`, and what search's answer, the admission report's action and subject and a range
preview's page already hold. A code the renderer has no words for shows the service's English.
