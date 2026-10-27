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

| ID          | How it is met                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **LOC-003** | Every listing and the renderer's own sorts in the person's collation: [below](#collation-ui-h) |
| **LOC-004** | Laid out right to left in a right-to-left language: [below](#right-to-left)                    |
| **LOC-005** | A person's interface language is theirs, stored apart from and never read from any content's   |
| **LOC-042** | `en-XA` and `ar-XB` as modes, and the pseudo walk run in both                                  |

Not claimed, each answered in part:

- **LOC-027**: the renderer's words are all in the catalogue, but a refusal code the renderer has no
  words for shows the service's English.
- **LOC-029**: the pseudo walk checks pages for words cut short or spilling sideways; dialogs are not
  walked, and elements overlapping each other are not measured.
- **LOC-038**: formats and plurals come from pinned CLDR, recorded in `LOCALE_DATA`; collation in a
  browser tab is the runtime's, unrecorded.

## The mechanism

- `words(key, values)` is a function, not a hook: `WordsProvider` sets the language before anything
  beneath renders and remounts it when the language changes, so a word read in any function as a
  screen renders is in the person's language. With no provider, English.
- `formats()` gives the language's date, number and list formats and its collation.
- `wordsWith(key, values, elements)` places an element, a link, a `<time>` or a lozenge, where a whole
  message holds its placeholder, so a sentence around one stays one message.
- Text that is the tenant's, a title, a space's or a person's name, a workflow state's, carries
  `data-content`, so the pseudo walk tells it from the interface's words; an element named by content,
  a pane by its space's name, carries `data-content-name`.
- A table of words at module scope holds keys, never words, read where it is shown.
- `en-XA` and `ar-XB` are made from English by `pseudolocalise`: letters accented, words bracketed,
  padded in breakable groups half again as long, twice under twenty characters; placeholders and
  plurals untouched.
- English locale data is bundled; another language's loads before it is shown.
- The ESLint rule `alloy/interface-words` refuses words written in place anywhere in the renderer. It
  sees JSX text and the props that say something; a word in a variable or a table is review's to
  catch, and the pseudo walk's. An icon is named, never worded (`icons-named.test.ts`).
- The pseudo walk (`tests/browser/src/pseudo.test.ts`) walks Home, each module's page and the component
  editor as Grace, and Administration's sections as Ada.
- `packages/editor` keeps its own words in `EDITOR_WORDS`, said through `say`; the renderer merges them
  into its catalogue as `pm.<key>` and gives them back through `sayWith`, so the views ProseMirror draws
  speak the person's language. With none given, as in the package's tests, English.

## Right to left

`<html dir>` follows the interface language (UI-G), and everything follows it:

- Stylesheets name sides by the inline start and end, never left and right; a slide along x is
  multiplied by `--inline-sign`, -1 right to left. `theme/logical.test.ts` refuses a physical side
  unless its line says why (`/* physical: centred */`).
- An arrow key is read through `inlineKey` (`parts/inline.ts`): right to left, Left goes on. Tabs,
  segmented controls, toolbars, the symbol palette, the outline's moves and a pane's separator use it;
  a drag reads `inlineSign`.
- An icon that points along the line is mirrored (`MIRRORED` in `editor/Icon.tsx`), by `scale`, so a
  turned triangle keeps its turn.
- Content keeps its own direction: a component's label is measured from its text's inline start, and
  a redline's content carries its component's `lang` and `dir`, `dir="auto"` where it has none.

## The desktop shell

The tray and the spelling menu are worded from the catalogue (`words/desktop.ts`), which the main
process bundles with esbuild, as the preload is. They start in the system's language matched against
the declared list, and follow the renderer's: `setInterfaceLanguage` on the bridge, one declared tag
on `alloy-works:interface-language`, checked in the main process and refused otherwise.

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
