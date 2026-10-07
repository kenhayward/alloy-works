# TP1: Template parameters, declared, asked for and recorded

> TP1 of [templates.md](../design/templates.md#parameters)'s build order. **Full tier**: a stored
> shape in two artifacts and a migration, so a pre-flight review (done, folded in) and a final
> review; no per-task reviews. The plan rides in TP1.1 (ADR-0039). Ken may overrule.

**Goal:** a template declares parameters - the query definition's `Parameter` plus `changeable` and
`feeds` - checked when it is saved; making a document from it asks for them, through the API and the
New document form alike, refuses a missing required one or an invalid one by name, records them in
the document's first version and seeds each declared field; the document page shows them with their
history, and changes the changeable ones. Bindings reading them are TP2's.

| PR    | Holds                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| TP1.1 | This plan; the template member and its checks; 0057 and the document substance; creation, change and the read route          |
| TP1.2 | The parameter input; the New document form's parameters; the Parameters panel and its history; the whole system; TP1's close |

## Decisions

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Beat                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TP1-A | **`templateParameterSchema` is `parameterSchema.omit({ variation: true }).extend(...)`** with `changeable` and `feeds { field?, arguments }`, in `template/parameters.ts` (a plain strict object, so zod can), so the contract never offers a variation and strictness refuses one. The definition's `parameters` is optional, at most 50, additive at template schema 1. **`checkPermitted`** is exported from `data/definition.ts` and called, with names declared once, for each template parameter                                                                                                                                                                                                                                                                                                                                      | A parameter shape of the template's own                            |
| TP1-B | **`checkTemplateParameters(definition, resolved)`**, pure, run **at template save and at document creation, never inside `resolveTemplate`** (which `documentRules` re-runs on every values write, TE-K, so a later schema change would make a document unwritable): `parameter_unused` (feeds nothing), `parameter_field` (a `feeds.field` not a document-level effective field, fixed, or not seedable). **`seedable(field, parameter)`**: text to text; integer to number; decimal to number only where the field is not `integer` (unless the decimal's scale is 0) and its scale, where declared, is at least the parameter's; date to date; time with fraction 0 to time; instant to date-time; boolean to boolean; a list only to a field of many, a single value only to a field of one; a local date-time and a `user` field never | Template checks in `resolveTemplate`; converting values at seeding |
| TP1-C | **Route-level refusals with wire codes**: the contract parses the definition's shape; the template routes and creation run TP1-B and answer `parameter_unused`, `parameter_field`, and creation and change `parameter_unknown`, `parameter_fixed` and `parameter_invalid`, each with a `WIRE_CODES` entry, its rule and its words in `failure-words.ts`. `parameter.invalid` keeps its rule DAT-020: one declaration, one checker (TE-N)                                                                                                                                                                                                                                                                                                                                                                                                    | Zod issues on a body path, which say no code                       |
| TP1-D | **0057** adds `artifact_version.parameters jsonb`, null but for documents (a check by kind, as 0029's values), running `set constraints artifact_version_component_type_recorded immediate` first and deferring it after, as 0029 does. **`prepare`** (`db/src/versions.ts`), `StoredVersion`, `readVersion`, `tables.ts`, `DocumentSubstance`, `insertVersion` and `substanceOf` all carry it; `prepare` keeps it only where non-empty and parses it to canonical values; **the digest takes it only where non-empty**, absent members omitted (never `null`), lists in their order, so no stored document's digest moves - the stored-digest test at `documents.test.ts:315` extended                                                                                                                                                     | A table of parameter values beside the version chain               |
| TP1-E | **Every act that cuts a document version carries `parameters` forward**: `editOutline`, `recordDocumentValues` and the new `recordDocumentParameters` are the only callers (the review's census); a test each that the parameters survive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Acts dropping parameters silently                                  |
| TP1-F | **Declarations are read at the document's recorded template version** (`documentRules().definition.parameters`, TE-B), so a later template version changes no document's parameters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The template's latest declarations judging an older document       |
| TP1-G | **`POST /v1/spaces/{space}/documents` takes `parameters?`**, in the transaction before `createArtifact`: unknown names stripped into `parameter_unknown` first (`checkParameterValues` would call one a `type` problem), then `checkParameterValues`, then TP1-B, then **the seeded values through `checkWrittenValues`** - a field's length, range, `maxValues` or duplicates (MET-030) refused `parameter_invalid` naming the parameter and the field's rule - so nothing is written on any refusal (TPL-018). A blank document given parameters is `parameter_unknown`                                                                                                                                                                                                                                                                   | Seeding a value the field would refuse on its next write           |
| TP1-H | **`PUT /v1/documents/{id}/parameters`**, `edit`, `openedFrom` and the whole set: checked as at creation, `parameter_fixed` where a parameter that is not `changeable` differs from the version opened from, a version cut with outline and values unchanged, **answering the `DocumentView`**, which gains `parameters`, so the page's next act opens from it. **`GET /v1/documents/{id}/parameters`**, `read`: the declarations, the current values, and the history - its own query, `lag(parameters)` over the chain, the rows where they changed, with author, time and the names changed, newest first, at most 200 with a cursor; the first version is the first entry, and a version before 0057 reads as no parameters                                                                                                              | A log of its own; `listVersions`, which carries no parameters      |
| TP1-I | **One `ParameterInput`** by type - text box, number, date, time, a check box, a choice where `permitted` lists values, repeated entries for a list - shared by the New document form (which reads the chosen template with `GET /v1/templates/{id}`, marks required, and keeps Create unavailable with the reason until each required one is filled) and the **Parameters panel** beside the document's fields: each value, editable where `changeable` and the author may edit, saved after a pause through the page's `pending` guard as values are, and a **History** disclosure                                                                                                                                                                                                                                                         | `HeldFields`, which renders metadata fields, not value types       |

## Task 1: The template member (`packages/domain`, `apps/service`, `packages/api-contract`) - TP1.1

- `template/parameters.ts` (TP1-A, TP1-B), `template/definition.ts` (`parameters?`),
  `data/definition.ts` (`checkPermitted` exported); the template routes running TP1-B (TP1-C); wire
  codes, rules and words; the contract.
- Tests: **`TPL-017`** a template declares a parameter's name, type, whether required and its
  permitted values or range, read back from the API. **`TPL-068`** a parameter's `feeds` names its
  field and whether it supplies arguments, and one feeding nothing is refused `parameter_unused`.
  Uncited: a variation refused by the strict shape; a name twice; a permitted value out of its type;
  each `seedable` pair and each refusal (a fixed field, a decimal into an integer field, a timed
  fraction, a list into a field of one, a local date-time, a `user` field, a section-level field).

## Task 2: Recorded on the document (`packages/domain`, `packages/db`) - TP1.1

- 0057; TP1-D's members; TP1-E's three callers.
- Tests: a document version with parameters reads back; a stored document's digest unchanged (the
  `documents.test.ts:315` recomputation extended); 0057 refuses parameters on a component version and
  runs on a fresh environment; each of the three callers keeps the parameters it was opened with.

## Task 3: Creation, change and the read route (`packages/db`, `apps/service`, `packages/api-contract`) - TP1.1

- `createDocument` (TP1-F, TP1-G), `recordDocumentParameters` and `documentParameters` (TP1-H); the
  routes, described; `openapi.json` and the client regenerated.
- Tests (db and service suites): **`TPL-026`** a document is made from a template with its parameters
  through the API. **`TPL-018`** a document is not made while a required parameter has no value, and
  nothing is written. **`TPL-045`** a value of the wrong type, outside its range, or not among its
  permitted values is refused naming the parameter, the rule and the value, at creation and at change.
  **`TPL-021`** a changeable parameter changes; a fixed one is refused `parameter_fixed`, and an
  unchanged fixed one passes. **`TPL-020`** the read route answers each value and every change with
  its author and time, across an outline act between. Uncited: a seeded field holds the parameter's
  value in the first version (TPL-066's half, cited whole in TP2); a seeded value the field refuses,
  nothing written; `parameter_unknown`; a later template version's declarations not judging an older
  document; a schema change after creation leaving values writable; the permissions on both routes.

## Task 4: The page (`apps/web`) - TP1.2

- `structure/ParameterInput.tsx`, `NewDocument.tsx`, `structure/ParametersPanel.tsx` beside the
  document's fields in `DocumentPage.tsx` (TP1-I); words dash-free.
- Tests (jsdom): **`TPL-026`** the form sends the request the API takes. **`TPL-045`** the form shows
  the service's refusal beside the parameter, in the API's words. **`TPL-020`** the panel shows each
  value and its history. The form asks for each type and a permitted choice; Create unavailable with
  the reason until required ones are filled; a changeable value edited and saved, a fixed one
  read-only; an outline act after a parameter save opens from the right version.

## Task 5: The whole system, docs and the close - TP1.2

- `tests/browser`: by keyboard, make a document from a template with a required date, a choice and a
  changeable text parameter; read the seeded field; change the text one; open the history; axe on the
  form and the panel. `tests/e2e`: the same over HTTP, and a fixed parameter refused. Development's
  seeded template gains two parameters.
- Docs: templates.md (as built; its failure table's `parameter_field` at template save and creation),
  features.md and the README, this plan's row. The close per ADR-0037: 0.143.0, its baseline.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` and `pnpm test:browser` against the build's own compose project (`-p alloy-tp1`),
  every `ALLOY_TEST_*`, `ALLOY_E2E_*` and `ALLOY_BROWSER_*` target set. Never Ken's `alloy-works`
  stack.
- **The final review** breaks each citation; probes a list seeding a field of one, a decimal of scale
  3 into a number field of scale 2, a decimal into an integer field, a timed fraction, a seeded text
  longer than its field, duplicate list items, a fixed field, an instant seeding a date-time, a
  parameter renamed in a later template version, every act keeping the parameters, the digest of a
  document made before 0057, and the history across an outline act.
- **By hand**: make a document from a template with parameters in the real app.

## Risks

- **An act that drops `parameters`** would silently erase a document's record; `prepare` is the
  choke point, and TP1-E's tests hold each caller.
- **The digest**: TP1-D keeps every stored document's digest; the extended recomputation is the check.

## Questions for Ken

None: templates.md's decisions are taken. The plan rides in TP1.1.

## Changed while building

| PR    | Found                                                                                                                                | Change                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP1.1 | `failure-words.ts` holds the data failures' words, keyed by `DataFailureCode` with an attribution; a template's refusals are neither | The parameter refusals' words are `PARAMETER_WORDS` in the service's `templates.ts`, beside the handler that throws them                                                                                             |
| TP1.1 | Resolution already runs in the store's `createTemplate` and `recordTemplateVersion`                                                  | TP1-B runs there too (`refusedParameters`), answering the first kind found, `parameter.unused` before `parameter.field`, with each of that kind; creation runs the same                                              |
| TP1.1 | Five refusals name parameters in two ways                                                                                            | One `parameterRefusal` spread into `TemplateRefusal` and `OutlineRefusal`: `parameters` (`parameter`, `field?`, `message?`) for unused, field, unknown and fixed; `problems` (DAT-020's shape, `field?`) for invalid |
| TP1.1 | `parameter_field` and `parameter_unknown` refuse by no requirement                                                                   | Unruled in `refusals.test.ts`; `parameter_unused` is TPL-068's and `parameter_fixed` TPL-021's                                                                                                                       |
| TP1.1 | A migration's own test writes through `insertVersion` on a schema before 0057                                                        | `insertVersion` names the `parameters` column only where a document has some                                                                                                                                         |
| TP1.1 | `checkParameterValues` reads a null as no value, and the stored shape refuses one                                                    | A null given an optional parameter is recorded as absent, at creation and change                                                                                                                                     |
| TP1.1 | 0057's refusal is shown by a row copied as the administrator; a component's row needs its definitions' rows beside it                | The test copies a layout version and a document version, not a component's                                                                                                                                           |
| TP1.1 | The history route pages as the versions listing does                                                                                 | `GET /v1/documents/{id}/parameters` takes `limit` (1 to 200, 50 by default) and `cursor`, the versions listing's spelling                                                                                            |
