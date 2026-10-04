# B1: The value shown

> **A sketch**, built in one pull request, test-first, with one final whole-branch review before it
> opens that is asked for a break of its own against every citation. It builds B1 of
> [bindings.md](../design/bindings.md)'s build order, under
> [ADR-0035](../decisions/0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md)
> and [ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md), on what
> [D3](2026-10-03-d3-datasets-and-resolutions.md) and [D4](2026-10-03-d4-the-builder.md) built - and
> on what each of their "Changed while building" tables found, not on what their plans expected.
> bindings.md's decisions BI-A to BI-R were approved by Ken on 2026-10-04, every one as recommended.
> This plan's own decisions, B1-A to B1-P below, are proposed, each with a recommendation, for Ken to
> approve before the build.

**Goal:** a component holding a binding opens for editing, and the binding is an atom in its text that
an author can select, delete, undo, copy, cut and paste without losing what any document holds for
it. In a document - in the read text and in an editor opened in place - each binding shows the one
value the document holds, taken from its stored result by `takeValue` and formatted by `formatValue`
from the document's theme's value catalogue, or says in place why it has none; on its own, a binding
shows what it asks for and never a value. Activating a value opens its provenance in one step. The
service holds what a take gave as derived data, `dataset_take`, so a page never reads a result object
to show a value. Nothing places, changes, resolves, checks or accepts a binding from a screen yet -
those are B2 and B4 - and nothing publishes one: D3's publish and preview guard stands until B3
replaces it.

| PR   | Holds                                                                                                                                                                                       | Version |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| B1.0 | This plan                                                                                                                                                                                   | Build   |
| B1.1 | The build: the editor's node and the identity fix, `takeValue` and `formatValue`, the value catalogue and the default theme's 0.6, `dataset_take`, values and failures in place, provenance | Minor   |

## What the named questions answered

Four questions could have changed this plan. Three were answered by reading the code; one needed a
spike, run on 2026-10-04 in the editor package's own ProseMirror and Node, with no container and
nothing of the development stack touched.

**Q1: can the value catalogue be bindings.md's `catalogue/1`, and can a theme name it without a new
theme schema version? Neither, as written.** Catalogue kinds share one schema version
(`CATALOGUE_SCHEMA_VERSION = 3`, `packages/domain/src/theme/schema.ts`), and `readCatalogue` upgrades
by that number through `upgradeCatalogue1` and `upgradeCatalogue2`, whose schemas hold the six kinds;
a value catalogue written at `schemaVersion: 1` would be read as a catalogue/1 and refused. And
`themeSchema.catalogues` is a strict object with one **required** key per `CATALOGUE_KINDS` entry, so
adding `value` to the kinds would refuse every stored theme from 0.1 to 0.5. No reader today fills in a
catalogue a theme does not name (`themeMigrationChain` is empty). **It changes the plan** (B1-F): the
value catalogue is a new arm of `catalogueSchema` at catalogue/3, which refuses nothing stored, since
nothing stored is of kind `value`; and `catalogues.value` is an **optional** member of theme/1, which a
theme from before 0.6 omits and the reader answers with the product's default formats.

**Q2: what does the read text draw today for a component holding a binding? Nothing.** `renderContent`
(`packages/editor/src/render.ts`) opens content through `toEditor`, which answers a binding as
unsupported (`marksWithNoType` adds any inline but text, a reference, an equation, an image and a
footnote), so the document page shows "This component holds content this editor cannot show yet." in
its place. **It changes the plan**: the read text, not only the editor, needs the node, and
`renderContent` gains a binding context beside its reference context (B1-D).

**Q3: what does the paste pipeline do with a binding today? It refuses it, and admission would keep
its identifier.** `pasteInto` runs `toEditor` on what `admit` gave and reports a binding
`unrepresentable`; `reidentifyInline` returns any inline but text, a reference and a footnote as it
came, so once the editor admits the node a copy pasted into its own component would hold an
identifier twice. `namesIn` also counts a binding's identifier as one a cross-reference's `block`
target may name. And a footnote's paste admits text, references and equations alone. **It changes the
plan** (B1-C): the binding is renamed by admission and recorded in `renamed`, `pasteInto` gives back
the original where the receiving component no longer holds it, a binding is never a reference's
target, and a footnote's paste admits one.

**Q4 (spiked): do ProseMirror attributes holding objects - `parameters` and `take` - round-trip, compare
and undo as a binding needs, and which characters are "spaces alone"?** A schema with an inline atom
whose `parameters` and `take` are objects: `Node.fromJSON(toJSON)` gave an equal document; two
bindings differing only inside `parameters` were not equal (ProseMirror compares attributes deeply);
deleting the atom and undoing gave back an equal document, attributes and all. And of eight characters,
JavaScript's `\s` and Unicode's `White_Space` disagree on two: U+0085 (next line) is `White_Space` and
not `\s`, and U+FEFF (the byte order mark) is `\s` and not `White_Space`; neither takes U+200B. **It
changes the plan in one place**: the node carries `parameters` and `take` as object attributes, never a
serialised string (B1-B), and `value_empty` is decided by `\p{White_Space}` (B1-E), not `\s`.

What was not asked, because no answer could change the plan: whether reading a 25 MiB result on a
view's miss is fast enough (BI-G makes the miss once per dataset version and take, and the alternative
is the design's to reopen, not this plan's); and whether a `<button>` inside the read text's clickable
text fails axe's `nested-interactive` (the text is a `div` with a tab stop and no role, which the rule
does not take; the browser suite's axe test is what holds it).

## Decisions

Proposed; the column beside each is what it is chosen over.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Instead of                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1-A | **One tenant migration, `0048_bound_values.sql`**: the value catalogue's artifact and its 0.1, the default theme's 0.6 naming it under 0043's guard, and `dataset_take`. bindings.md's "one migration per slice"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A migration for the theme and another for derived data                                                                                                            |
| B1-B | **The editor's `binding`** is an inline atom, `marks: ''`, no `parseDOM`, attributes `id`, `query`, `version`, `parameters`, `mode` and `take` - objects held as objects (Q4) - named in every content expression that admits a cross-reference: a paragraph, a term, an attribution, a table's caption and note, a figure's caption and a footnote's paragraph, and so a list item and a cell. Never in preformatted text or the title schema, which already refuse it. `toEditor` and `fromEditor` map it losslessly; `fromEditor`'s parse is the content model's, so the editor is held to D3-C on every save                                                                                                                                                                                                               | A string attribute holding the binding's JSON, which compares as text and would need parsing in every node view                                                   |
| B1-C | **Identity (BI-D)**: `reidentifyInline` gives a binding a new identifier and records it in `renamed`; `pasteInto` gives back each pasted binding's original where, after the paste, no other node of the receiving component holds it - a cut and a paste in one component, or a paste over the original - in the transaction that already says `keepsIdentifiers`. A binding is not a target: `namesIn` leaves it out of `targetable`, as a reference is. A footnote's paste admits one. The paste report counts bindings **copied**, "each to be resolved in a document", and bindings **moved**, which keep every value                                                                                                                                                                                                     | Carrying the source component in the clipboard so that a paste into another component always renames: harmless either way, since a document holds a value by node |
| B1-D | **What a binding shows is drawn by a node view from a decoration** (cross-references 1, R10): `bindingsPlugin` holds the host's `BindingContext`, set by `setBindingContext` in a transaction the history never holds; its decorations are merged into the surface's one decorations plugin; `renderContent` takes the same context and draws each binding as `drawReferences` draws references. The context is computed by a pure function in `packages/editor`, `bindingsShown(doc, context)`, which the surface, the read text and the copy all call                                                                                                                                                                                                                                                                        | A node view reading the context itself, which would not redraw when the context changes and the document does not                                                 |
| B1-E | **`takeValue(take, result, columns)`** in `packages/domain/src/data/take.ts`, pure, in this order: a column the result's declared columns do not have is `take_invalid`; `{ column }` of no rows `value_none`, of more than one `value_many` with the count; `{ key, column }` matched on every key column by canonical string equality, none `row_missing`, more than one `value_many` (a key is unique by D2-M; the code does not trust it); then a null cell `value_null`, and a text cell whose every code point is `\p{White_Space}` (Q4) `value_empty`. The columns are the dataset version's provenance's, never the definition's latest                                                                                                                                                                                | Taking a first row; or the definition's current columns, which a floating definition can change after the result ran                                              |
| B1-F | **The value catalogue** is `{ schemaVersion: 3, kind: 'value', formats, byLanguage }` (Q1), bindings.md's `ValueFormats` member for member, held tight: a group separator never the decimal one, `true` and `false` words differing, `byLanguage` at most 32 primary subtags `^[a-z]{2,3}$` each once. `catalogues.value` is optional in theme/1; `readTheme` answers `valueFormats` from it or from `DEFAULT_VALUE_FORMATS`, the product's (bindings.md's 0.6 values). `CATALOGUE_KINDS` gains `value`, every upgrader and exhaustive switch a case                                                                                                                                                                                                                                                                           | A theme/2 whose reader names a catalogue no older environment holds; or bindings.md's catalogue/1, which the shared catalogue version cannot hold                 |
| B1-G | **`formatValue(value, type, formats)`** and **`formatsFor(catalogue, language)`** in `packages/domain/src/data/format.ts`, no `Intl`: an integer grouped in threes once it has `groupFrom` digits; a decimal at exactly its scale, its trailing zeros put back; the minus as declared; a date in its order and separator, day and month padded by `pad`, the year always four digits; a time `HH`, `MM`, `SS` by its separator, its fraction to the column's declared digits after the number's decimal separator; a local date-time the date, a space and the time; an instant the same in UTC followed by a space and `UTC`; a boolean in its words; text with each line break (CR LF, LF, CR, U+0085, U+2028, U+2029) and tab one space. The language is the document's outline's `language`, its primary subtag lowercased | Separators chosen per output, which would let the editor and the PDF disagree; or `Intl`, whose ICU differs between Chromium, Electron and Node                   |
| B1-H | **`dataset_take`** as bindings.md has it, `outcome` holding `{ value, column: { name, type } }` - the declared column, never its source `from` - or `{ failure, count? }`; written by `recordTake` alone, `on conflict do nothing`, from a resolve's and a check's recording transactions for every version they record or find (held and waiting), and from the bindings view on a miss, which reads the object once by its checksum, held to its SHA-256 as `getDocumentDataset` holds it. Insert and delete granted, update revoked. **Nothing in `apps/worker` imports it** (BI-G)                                                                                                                                                                                                                                         | Writing only at resolve, which would leave every result D3 already stored showing nothing until resolved again                                                    |
| B1-I | **The bindings view gains**, per binding: `held.taken` and `waiting.taken` (the outcome, or null where the held resolution is stale); `definition: { title, version } \| null`, null unless the caller may read the definition; `connection: { name } \| null`, null unless they may read the connection; and `held.by` as `{ id, displayName }`, as a publication names its publisher. Redaction is D3's, unchanged                                                                                                                                                                                                                                                                                                                                                                                                           | A route per binding for its provenance, which the page would call once a value                                                                                    |
| B1-J | **What is shown, in a document**: the formatted value where the binding as the editor holds it equals the binding the view answered (`bindingDigestInput`, compared as strings, no hash in the browser) and its held resolution is not stale; otherwise a marker in place - _No value - never resolved_, _No value - the binding changed since it was resolved_, _No value - the query returned no rows_, _No value - the query returned 3 rows_, _No value - no row where site is north_, _No value - empty_ (null or empty), _No value - the definition has no column depth_. A held value with a newer result waiting carries _revision waiting_, always shown, an icon and words                                                                                                                                           | Showing the view's value for a binding the author has changed in the open editor, which is not the binding the document holds it for                              |
| B1-K | **On its own** a binding shows its column and its definition's title - _depth, Readings_, or _depth where site is north, Readings_, a key's values as stored - in the application's chip, the title read by `GET /v1/query-definitions/{id}` once per definition, and _a bound value_ where the reader may not read it. Never a value (BI-B)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A sample run on opening, which BI-B rules out                                                                                                                     |
| B1-L | **Accessible name and keyboard**: the editor's atom is reached by the arrow keys as a node selection, and holds its kind in visually hidden words after what it shows - _1,234.5, bound value_, _No value - empty, bound value, failed_, _depth, Readings, bound value, a value in each document_ - never `aria-label` on a `span`, which ARIA prohibits on a generic element and axe refuses. In the read text a value is a `<button type="button">` in the tab order, styled as the text it stands in with the focus ring the theme's links take, holding the same words                                                                                                                                                                                                                                                     | `aria-label` on the atom's `span` (`aria-prohibited-attr`); or a value reachable by the pointer alone                                                             |
| B1-M | **Provenance (DAT-041)**: `ProvenancePanel` in `apps/web/src/data/`, in the document page's side column, opened by a value's button in the read text (click or Enter) and by **Provenance** on the **Value panel**, which `ComponentEditor` shows beside its Figure and Table panels when a binding is selected whole, with the provenance in brief and no **Change** (B2). The panel holds bindings.md's five parts, the waiting value beside the held one, and **Show the result**, the rows from `GET .../datasets/{version}` in a table of the first 200 rows with the count of the rest. Focus moves to its heading; **Close** and Escape return it to what opened it                                                                                                                                                     | A modal dialog, which would hide the text the value stands in; or the Data tab, which is B4's                                                                     |
| B1-N | **The context is read when the page opens and again whenever it re-reads the texts** (after an editor's Done, a version cut, an outline act). No live event is added: nothing on a screen changes a resolution until B2 and B4, which refresh after their own acts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A live update of resolutions, for acts no screen makes yet                                                                                                        |
| B1-O | **The publish and preview guard is unchanged.** `refuseBindings` (`apps/service/src/publishing.ts`) and `assemble`'s `binding_unresolved` stay as D3 left them; B3 replaces both. A document page now showing values still answers **Publish** and **Preview** with "cannot be published yet. Remove the binding to publish it."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Loosening the guard before the stage that would print a value exists                                                                                              |
| B1-P | **Citations**: DAT-031 and DAT-032 by `takeValue`'s tests; DAT-027, DAT-047 and DAT-041 by the editor's and the page's tests named below. **Not cited**: DAT-024, whose "where results can differ by user" no result can until D7 (question 2); STY-082, whose "the same in every output" waits for B3's PDF and Word (question 3); DAT-022, B2's; DAT-039 and DAT-082, B4's                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Citing a requirement for the half B1 can show                                                                                                                     |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title; an
  `it.each` title cites nothing, and a `rule:` field in a test cites its requirement.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture. A
  separator such as U+00A0 or U+202F is written in a test with `String.fromCodePoint`, never as an
  escape a tool might decode, and the catalogue stores its tokens (`'U+00A0'`), never the character.
- **Web tests wait for the surface's own content**, never for the header: ProseMirror's mount lands
  after the header commits, which CI's slower runner shows and Windows does not.
- **Schema-keyed maps are keyed by literals, not computed names**: the catalogue kinds, the failure
  codes and their words are each a `Record` over a literal union with `satisfies`, and a test lists
  each key by hand, so a renamed constant cannot repoint one silently.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; pins from the tool, never by hand. The full suite before the pull
  request, and its CI log read, `##[error]` and every step's exit code included.
- A stored shape is checked against every write path it admits (below). Every trigger or function
  reading a table reads it by `tg_table_schema`.
- **Security, from D3's decisions**: a reader without `read` on a definition sees no SQL, no
  connection and no source column name - in the view, the panel and `dataset_take`, which stores the
  declared column alone; a value is shown to whoever may read the document (DAT-090); B1 shows no
  resolve's or check's failure, so no source message reaches a page, and B2 and B4 keep D2-H's rule
  where theirs do; the worker reads no derived row.
- **Never test against the development stack's compose project, its database on 5432 or its store on 8333.** Every suite run sets `ALLOY_TEST_DATABASE_URL`, `ALLOY_TEST_OBJECT_STORE` with its key and
  secret, and `ALLOY_TEST_SOURCE_PORT` to the build's own; every whole-system or browser run sets
  every `ALLOY_E2E_*` and `ALLOY_BROWSER_*` target to a compose project of the build's own.

## The stored-shape check

**The write paths.** A binding in content: every path that writes component content parses it with
the content model's schema, unchanged since D3 - and the editor becomes one more caller of that path,
through `fromEditor`, on every iteration's save, and the paste pipeline through `admit`. A value
catalogue and a theme version: migration 0048 alone in the product, and `addCatalogueVersion` and
`addThemeVersion`, which only tests call (`ownWriters` keeps `recordVersion` from writing either).
`dataset_take`: `recordTake` alone, called by resolve, check and the bindings view.

**The canonical forms.** A take's digest is SHA-256 over `canonicalJson(take)`, no set rule: a key is a
record keyed by column names whose values are single canonical values, never arrays, so no member named
`marks` reaches the set rule with an array. A catalogue is stored as canonical JSON by the migration's
literal, its digests recomputed by `default-theme.test.ts` from the domain's constants.

| #   | Member                         | Validated on every write path by                                                                                                                                                                                                                                                                                                                                                | Loose or tight                                    | Points at, and who checks                                                                                   |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | The editor's `binding`         | `fromEditor` parses with `bindingNodeSchema` (D3-C), unchanged; a binding with no `id` is named by the identity plugin before any save                                                                                                                                                                                                                                          | Tight, as D3                                      | As D3: its definition and take at resolve                                                                   |
| 2   | Value catalogue `formats`      | `number.decimal` `'.' \| ','`; `number.group` `'none' \| ',' \| '.' \| "'" \| 'U+00A0' \| 'U+202F'`, never the decimal; `groupFrom` `4 \| 5`; `minus` `'U+002D' \| 'U+2212'`; `date.order` `ymd \| dmy \| mdy`, `separator` `'-' \| '/' \| '.'`, `pad` boolean; `time.separator` `':' \| '.'`; `boolean.true`, `false` 1 to 40 code points, NFC, no control, trimmed, different | Tight, strict at every level                      | Nothing                                                                                                     |
| 3   | Value catalogue `byLanguage`   | At most 32; each `language` `^[a-z]{2,3}$`, once; `formats` as row 2                                                                                                                                                                                                                                                                                                            | Tight                                             | Nothing                                                                                                     |
| 4   | Theme `catalogues.value`       | Optional at theme/1; an artifact version identifier; `readTheme` refuses one missing or not of kind `value` (`catalogue_missing`, `catalogue_wrong_kind`), as for every kind                                                                                                                                                                                                    | Tight; absent reads as the product's default      | A catalogue version, by `readTheme`                                                                         |
| 5   | `dataset_take.dataset_version` | Not null; with `artifact_id` and `kind` default `'dataset'`, a foreign key to `artifact_version (id, artifact_id, kind)`, `on delete cascade` - derived data goes with what it derives from                                                                                                                                                                                     | Tight                                             | A dataset version, by the foreign key                                                                       |
| 6   | `dataset_take.take_digest`     | `^[0-9a-f]{64}$`, by a check constraint and `recordTake`                                                                                                                                                                                                                                                                                                                        | Tight                                             | A take, which only the binding holds; nothing to point at                                                   |
| 7   | `dataset_take.outcome`         | `takeOutcomeSchema`, strict, in `recordTake`; and a check constraint: an object with exactly `value` and `column`, the value a string or a boolean, or exactly `failure` among the six codes, with `count` an integer above 1 exactly for `value_many`                                                                                                                          | Tight; the value's canonical form is the writer's | The column, by `recordTake` checking the value with `valueProblem` against the column's type before writing |

**What derived means here, held by a test**: deleting every `dataset_take` row and reading the view
again answers the same values, recomputed and written back.

## Task 1: The domain

`packages/domain/src/data/`, exported from the package's surface; zod and no platform.

```ts
// take.ts (B1-E)
export const TAKE_FAILURES = [
  'take_invalid',
  'value_none',
  'value_many',
  'row_missing',
  'value_null',
  'value_empty',
] as const;
export type TakeOutcome =
  | { readonly value: string | boolean; readonly column: { name: string; type: ValueType } }
  | { readonly failure: (typeof TAKE_FAILURES)[number]; readonly count?: number };
export const takeOutcomeSchema: z.ZodType<TakeOutcome>;
export function takeValue(
  take: Binding['take'],
  result: CanonicalResult,
  columns: readonly Column[],
): TakeOutcome;
export function takeDigestInput(take: Binding['take']): string; // canonicalJson, hashed by the caller

// format.ts (B1-G)
export function formatValue(
  value: string | boolean,
  type: ValueType,
  formats: ValueFormats,
): string;
export function formatsFor(catalogue: ValueCatalogue | null, language: string | null): ValueFormats;
```

`packages/domain/src/theme/`: `schema.ts` gains `valueFormatsSchema`, the `value` arm of
`catalogueSchema` at catalogue/3, `value` in `CATALOGUE_KINDS` and an optional `catalogues.value`
(B1-F); `read.ts`'s `readTheme` answers `valueFormats` on `ResolvedTheme` and skips a missing `value`
key where it skips nothing else, and the two upgraders and `addCatalogueVersion`'s switch gain the
kind; `default.ts` gains `DEFAULT_VALUE_FORMATS`, `FIFTH_` names for 0.5's constants and 0.6's
`DEFAULT_THEME_VERSION`, a new fixed identifier, binding 0.5's catalogues and the value catalogue's
0.1. `packages/domain/src/content/admission/reidentify.ts`: B1-C's rename, `renamed` record and
`targetable` fix; `report.ts` gains `rewritten.bindingCopied` and `kept.bindingMoved`, in plain words
with no dash.

**Tests:** `take.test.ts`: `DAT-031 fails a take of one column from more than one row by name, naming
the count, and never takes the first` (red under a take of the first row); `DAT-032 fails a take that
finds no row, a null or text of no characters by name, and never answers an empty string` (red under
an empty string answered); uncited, each row of bindings.md's table, `take_invalid` against the
provenance's columns and not the definition's, a key matched on every key column, U+0085 empty and
U+FEFF not (Q4), a take's digest input with a key named `marks`. `format.test.ts`, uncited (B1-P):
each base type under each declaration, a decimal of scale 3 holding `1.5` printing `1.500`, a
negative with U+2212, an instant at fraction 3 printing `UTC`, a text's CR LF one space, `byLanguage`
chosen by `de-CH`'s primary subtag and missed by `fr`, and a test that greps `format.ts` for `Intl` and
`toLocale` and finds neither. `schema.test.ts` and `read.test.ts`: uncited, each row of the
stored-shape table refused by its rule; a theme/1 with no `value` read with the default formats; one
naming a paragraph catalogue as its `value` refused `catalogue_wrong_kind`; the STY-003 test widened to
seven kinds without moving its citation. `reidentify.test.ts`: uncited, a pasted binding renamed and
recorded, red against today's `return [inline]`; a binding never a reference's target.

## Task 2: The editor

`packages/editor/src/`:

| File             | Holds                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`      | `binding` (B1-B), in each of the seven content expressions; `toDOM` a `span.aw-binding[data-binding]` reading _Bound value_                                                                                                       |
| `mapping.ts`     | `marksWithNoType` passes a binding in every home; `toRun` and `runsOf` map it, `id` through `identifierOf`                                                                                                                        |
| `bindings.ts`    | `bindingAt(state): BindingAt \| null` (a node selection alone), as `referenceAt`; and `bindingsShown(doc, context): BindingShown[]`, in document order, B1-J's and B1-K's words                                                   |
| `bindingView.ts` | `bindingsKey`, `bindingsPlugin`, `setBindingContext(view, context)`, `bindingDecorations(doc, context)` - flat primitives in the spec, compared with `===` - and `bindingView`, drawing the text and the hidden kind words (B1-L) |
| `render.ts`      | `renderContent(content, document, references?, bindings?)`; `drawBindings` turns each `span[data-binding]` into B1-L's button, carrying `data-node` and `data-binding` for the page                                               |
| `state.ts`       | `createEditorState` takes `bindingContext?`, installs the plugin, merges its decorations                                                                                                                                          |
| `view.ts`        | `nodeViews.binding`; the copy writes the shown words into the clipboard's text and HTML as `copiedReferences` does                                                                                                                |
| `clipboard.ts`   | B1-C: the original identifier given back, the report's two counts, a footnote's paste admitting a binding                                                                                                                         |

```ts
export type BindingContext =
  | { readonly kind: 'document'; readonly held: ReadonlyMap<string, BindingHeld> } // by binding id, one occurrence
  | { readonly kind: 'alone'; readonly titles: ReadonlyMap<string, string | null> }; // by definition id
export interface BindingHeld {
  readonly binding: string; // bindingDigestInput of the binding the view answered
  readonly shown:
    { readonly value: string; readonly waiting: boolean } | { readonly failure: string };
}
```

**Tests** (`packages/editor`, jsdom): `mapping.test.ts`: the read-only test becomes `opens for editing
a component holding a binding in a paragraph, a cell or a footnote, and stores it as it came` (red
before the schema), and a binding in each of the seven homes round-trips. `bindings.test.ts`:
`DAT-047 shows a binding whose value fails in place with its reason, apart by more than colour, and
draws the rest of the component as before` - a surface holding a held value, a failed one, a
reference, an equation and an image; the failure's words and its `aw-binding-failed` class, every
other node drawn as with no binding (red under a node view that throws, and under one that draws the
failure as colour alone); uncited, B1-J's precedence (an edited binding shows _changed since it was
resolved_ though the view holds a value), the decorations drawn again when the context changes and
not otherwise, on its own the title or _a bound value_. `identity.test.ts` and `clipboard.test.ts`:
uncited, a copy pasted into its own component renamed, counted copied, and holding nothing; a cut and
a paste keeping the identifier, counted moved (red against today's `reidentify`); a paste over the
original keeping it; a second paste of one cut renamed; an undo of a deletion keeping it; a binding
pasted into a footnote. `render.test.ts`: uncited, the read text's buttons in document order, a
footnote's binding included, with their names.

## Task 3: The migration and the database

**`0048_bound_values.sql`** (B1-A): the value catalogue's artifact, `space_id` null, its 0.1 with the
domain's fixed identifier and digests, `where not exists`, as 0024 seeded each catalogue; the theme's
0.6 binding 0.5's six and the value catalogue's 0.1, inserted only where 0.5 stands under its
identifier and content hash, authored by nobody, with nothing newer - 0043's guard, one version on;
and `dataset_take (dataset_version, artifact_id, kind default 'dataset', take_digest, outcome,
primary key (dataset_version, take_digest))` with rows 5 to 7's constraints, `select`, `insert` and
`delete` granted, `update` and `truncate` revoked. `packages/db/src/themes.ts`: `DEFAULT_CATALOGUE_IDS`
gains the value catalogue. `packages/db/src/takes.ts`: `recordTake(trx, { version, take, outcome })`
and `takesOf(trx, pairs: { version, takeDigest }[]): Map<string, TakeOutcome>`.

**Tests** (`packages/db`): `default-theme.test.ts`: STY-024's test at 0.6 binding one catalogue of
each of the seven kinds, its citation unchanged; the digest test recomputing 21 rows. `theme-migration.test.ts`:
`migration 0048` - an environment at 0.5 given the value catalogue and 0.6, which reads style for style
as 0.5 did and answers `valueFormats` equal to `DEFAULT_VALUE_FORMATS`; a request waiting under 0.5
keeps it; an environment that recorded a theme after 0.5 keeps it and reads the default formats; fresh
against upgraded alike. `takes.test.ts`, uncited: each loose outcome refused by the constraint with
`recordTake` bypassed by a direct insert, an update refused, a second write of the same take a no-op,
a row deleted with its dataset version.

## Task 4: The service and the contract

`apps/service/src/data/bindings.ts`:

- **Resolve and check** call `recordTake` in their recording transactions for each binding's held and
  waiting version, from the rows `runOnce` already holds (B1-H) - before the transaction commits, so a
  failure records neither.
- **The view** (`stateView`) answers B1-I's members. For each held and waiting version it asks
  `takesOf` first; on a miss it reads the result object once per version by its checksum, refusing
  bytes that are not it (`result_unreadable`, as the dataset read refuses), parses it with
  `canonicalResultSchema`, takes, and records. The definition's title and version number and the
  connection's name are read only where `definitionReader` and the connection's `read` allow;
  `held.by` reads the principal's display name.
- `packages/api-contract/src/bindings.ts`: `TakeOutcomeView`, the widened `HeldView` and waiting, and
  `BindingStateView`'s `definition` and `connection`; the route's description in `documentation.ts`
  says what is taken, when it is null and what is redacted. `openapi.json` and the client regenerated;
  `exampleFor` gains what a take's outcome needs, never a loosened test.

**Tests** (`apps/service`, the fake connector), uncited - the view's values are DAT-090's, already
cited, and the page's tests cite what a person sees: a resolve recording the take it ran with; a
check's waiting version taken; the view answering a value, `value_many` with its count, and null for a
stale resolution; the miss path reading the object, recording, and a second read not reading it (the
store's fake counts gets); every `dataset_take` row deleted and the same answer recomputed; an
altered object refused `result_unreadable`; Alice, who may read the document and not the definition,
given no title, no connection, no SQL and no source column, and the same value; the view answering a
binding in a component she may not read nothing, as D3's does. The publish and preview tests of
`binding_unresolved` stay green and unchanged (B1-O).

## Task 5: The page

`apps/web/src/`:

| File                           | Holds                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structure/bindingContexts.ts` | `bindingContexts(view, theme, language): ReadonlyMap<string, BindingContext>` by occurrence node, pure, as `referenceContexts` is: formats each taken value by `formatValue` and `formatsFor(theme.valueFormats, outline.language)` |
| `structure/DocumentPage.tsx`   | Reads `GET .../bindings` with the texts (B1-N); passes each occurrence's context to `DocumentText` and to the editor's `Place`; holds which value's provenance is open                                                              |
| `structure/DocumentText.tsx`   | `RenderedText` passes the binding context to `renderContent`; a click or Enter on a value's button opens its provenance and never the editor                                                                                        |
| `editor/ComponentEditor.tsx`   | Takes `bindingContext` and `onProvenance` on `Place`, pushed by `setBindingContext`; shows `ValuePanel` where `bindingAt` answers; on its own page, reads each definition's title for B1-K                                          |
| `editor/ValuePanel.tsx`        | What the value is, its definition, its mode and when it was fetched, and **Provenance**                                                                                                                                             |
| `data/ProvenancePanel.tsx`     | B1-M                                                                                                                                                                                                                                |
| `editor/pasteReport` words     | The two counts of B1-C                                                                                                                                                                                                              |

**Tests** (`apps/web`, a fake client; each waits for the surface's text, not the header):
`DAT-027 shows in a document's text the one value the document holds, formatted by its theme, where
the binding stands in the sentence` (a paragraph reading _The mean was 1,234.5 m._ in the read text and
in the editor opened in place; red with the binding drawn as _Bound value_);
`DAT-047 shows a failed value in place with its reason in the document's text and its open editor, and
every other component as before`; `DAT-041 opens a value's provenance in one step from the value in the
document's text, by a click or by Enter` (the definition and its version, the parameters, whose view,
when, the rows, the checksum, the dataset and its version, who resolved it, and the SQL for Ada; red
with the click opening the editor). Uncited: the Value panel shown when a binding is selected and its
**Provenance**; a value with a revision waiting marked; Alice's panel with no SQL, no connection and
_a query definition you cannot read_; **Show the result** limited to 200 rows; the component's own page
showing the title or _a bound value_ and no value; the paste report's words; Escape returning focus to
the value. `apps/web/src/dashes.test.ts` already holds every renderer string to no em or en dash; it
does not read `packages/editor`, so `bindings.test.ts` holds B1-J's and B1-K's words there to none.

## Task 6: The whole system and the browser

`tests/e2e/src/bindings.test.ts` gains, uncited: the D3 test's document read through the view after
resolve, the value taken, a reader without the definition given it redacted, and `dataset_take`
holding one row per version and take. `tests/browser`, against a compose project of the build's own
with `--profile sources`, uncited: a document holding a value and a failed one, placed and resolved by
the API on `source-postgres` - the document page passing axe-core's WCAG 2.2 AA rules in Reading and
Authoring with the provenance panel open, as CNT-176's test does for the rest; and **by keyboard
alone**: Tab to a value in the read text, Enter, the panel's heading focused, Escape back to the value;
in Authoring, the component opened, the binding reached by the arrow keys, the Value panel's
**Provenance** by Tab; and a value's text, read in Chromium, equal to `formatValue`'s in Node for the
same value and theme. Each is watched fail against a stack of the build's own with one break built into
its image, as D4's were.

## Task 7: Docs and the release

`docs/design/bindings.md`: B1-B to B1-H folded in where they differ (the catalogue at catalogue/3, the
optional theme member, the identity mechanism, `\p{White_Space}`), DAT-024's and STY-082's claims left
with B1's row as question 2 and 3 decide, and its "Not built" note narrowed. `docs/design/themes.md`:
the value catalogue as the seventh kind, TH-C's six. `docs/design/component-editor.md`: the binding's
row - Create no, Edit removal, copy and move. `docs/architecture.md`: the node, the two functions,
migration 0048, `dataset_take`, the view's members. `docs/features.md` and the README: values shown in a
document and their provenance; nothing placed or published yet. This plan's row: Built. The changelog:
the next Minor.

## Verification

- **Suites**, each alone while building, every target set to the build's own: `packages/domain`,
  `packages/editor`, `packages/db`, `apps/service`, `packages/api-contract`, `apps/web`,
  `apps/desktop`; then the full `pnpm test`, and `pnpm test:e2e` and `pnpm test:browser` against a
  compose project of the build's own with `--profile sources`.
- **CI**: the whole-system and browser jobs run task 6; the traceability gate reads every suite.
- **By hand, before the pull request**, in a compose project of the build's own: a binding placed and
  resolved through `/docs` against `source-postgres`, the document opened - the value in the read text,
  its provenance opened by the keyboard, the component opened in place, the binding cut and pasted
  within its paragraph and the value still shown after **Done**, a copy pasted showing _No value -
  never resolved_ - and **Publish** still refused. Which of these the tests prove, and which stand in
  for Ken's look in the real application, is said in the pull request.

## Questions for Ken before the build

1. **B1-F**: the value catalogue as a new kind at catalogue/3, the version every kind shares, and an
   optional `value` in theme/1 that an older theme omits - where bindings.md says catalogue/1 and says
   nothing of the theme's strict, all-required catalogue list. **Recommended**: the alternative is a
   theme/2, whose reader would have to name a catalogue an older environment does not hold.
2. **DAT-024 uncited until D7.** bindings.md gives it to B1, but its condition - results that differ by
   user - cannot arise while every connection runs as the service account, and the provenance schema
   admits no other identity. B1 builds the panel's **Whose view** line. **Recommended**: cite it in
   D7's plan, with an end-user result; bindings.md's build order says so.
3. **STY-082 cited in B3, not B1.** B1 builds the catalogue and `formatValue` and tests them whole, but
   the requirement's "the same in every output" is only shown once the PDF and Word print a value.
   **Recommended**: B3's worker test, reading the value back from the PDF and Word beside B1's
   Chromium-and-Node test, cites it. The alternative cites it now on the strength of one function.
4. **B1-J**: show _revision waiting_ on a value in B1, with the waiting value in the provenance panel,
   though Accept arrives with the Data tab in B4. **Recommended**: hiding a newer result the page
   already knows of would misstate the value; nothing moves until somebody accepts (DAT-082).
5. **B1-I**: the view's `held.by` changes from an identifier to `{ id, displayName }`, a breaking
   change to a documented route that nothing reads yet. **Recommended**, matching a publication's
   publisher; the alternative is a second member, `byName`.
6. **B1-H**: the bindings view, a `read` route, writes `dataset_take` on a miss. **Recommended**, as
   BI-G designed it: the rows are derived, deletable and never printed, and the alternative leaves every
   result D3 stored without a value until it is resolved again.

## Changed while building

| Found | Change |
| ----- | ------ |

## How this plan was made

About 50 minutes of wall-clock time and about 45 tool calls: three read-only surveys of the editor, the
theme and the data path in parallel, the requirements queried with `pnpm trace show`, and Q4's spike
in Node against the editor package's ProseMirror (under a minute, its script deleted after).
