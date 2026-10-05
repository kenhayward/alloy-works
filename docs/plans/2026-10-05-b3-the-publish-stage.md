# B3: The publish's binding stage

> B3 of [bindings.md](../design/bindings.md)'s build order, on what [B1](2026-10-04-b1-the-value-shown.md)
> built; it needs nothing of B2. **Full tier, reviews only where the risk is**: one targeted review of
> the stage and its order and of `provenance.json`'s redaction, and a final independent break of each
> citation; no pre-flight or per-task reviews. Ken may overrule.

**Goal:** a document holding values publishes and previews. The request refuses a binding holding no
resolution matching its digest and records the rest; the worker reads each result from the store by
its checksum, never a source, and the stage takes, formats and sets each value or fails the job by
name. PDF and Word print `formatValue`'s string; a publication records `publication_binding` and is
accompanied by `provenance.json`, redacted for every reader. D3's guard goes (BI-L, BI-M, BI-N).

| PR   | Holds                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3.0 | This plan, with a change fragment                                                                                                                                                             |
| B3.1 | The build: 0050, the request's refusal and records, the worker's read, `bind` and the order, PDF, Word and preview, `provenance.json` and its route, the page                                 |
| B3.2 | B3's close ([ADR-0037](../decisions/0037-change-fragments-and-versions-at-a-close.md)): the fragments folded, the Minor bump, `docs/architecture.md`, the baseline drafted for Ken to declare |

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Beat                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| B3-A | **One migration, `0050_publication_bindings.sql`** (B2's is 0049; renumbered 0049 if B3 merges first, with the full-migration lists): both tables, the `provenance` format, the widened whole check                                                                                                                                                                                                                                                                              | A migration per table                                                                                                           |
| B3-B | **No revision column until B5.** `binding_revision` does not exist, so the request and the publication record none; B5 adds the column with its table, and the stage's revision branch with it                                                                                                                                                                                                                                                                                   | A nullable column now, pointing at nothing                                                                                      |
| B3-C | **The refusal and the records are `requestPublication`'s** (`packages/db`), over the content it already resolved: a new answer `binding.unresolved` naming each binding by node with `reason: 'never' \| 'changed'`, else one `publication_request_binding` row per binding. `refuseBindings` and `bindingsMet` are deleted                                                                                                                                                      | The service reading the same content a second time beside the request                                                           |
| B3-D | **The stage is `bind`** (`domain: publishing/bind.ts`), between conditions and contributions: it answers `Bound`, branded content in which each `binding` is a `value` inline (text, identifier). **`contributionsOf` takes `Bound` alone**, so nothing is counted, numbered, referenced or listed before `bind`; the page's numbering (`db: numbering.ts`) counts through `unbound(content)`, named as the one way to count without values, since no contribution reads a value | Branding `Conditioned`, which the page's numbering needs too; or a runtime swap test alone, which after numbering cannot go red |
| B3-E | **A value projects to an ordinary text run** in its paragraph's run, language and marks-free, so template 13 and `writeDocx` do not change; `PIPELINE_VERSION`'s current becomes `'16'`, the published schema unchanged                                                                                                                                                                                                                                                          | A run kind of its own and template 14, printing the same characters                                                             |
| B3-F | **The worker holds each distinct dataset version's bytes to its checksum** before parsing; a miss, altered bytes or a non-canonical result is `result_unreadable`, stage `bind`, gathered with every other failure and never retried                                                                                                                                                                                                                                             | Throwing for a retry: a missing object never comes back                                                                         |
| B3-G | **`provenance.json` is built from an allow-list** (`domain: publishing/provenance.ts`, `PublishedProvenance`): no member can hold the SQL, the connection or a column's source; serialised with sorted keys, so a remake is byte-identical; producer `pipeline` at the pipeline's version, an empty report                                                                                                                                                                       | Deleting fields from the stored provenance, which leaks whatever D3 adds later                                                  |
| B3-H | **A preview records and takes as a publish does, and fails the same** (BI-M); it records no publication, so it has no `provenance.json`                                                                                                                                                                                                                                                                                                                                          | A preview's provenance kept for its hour                                                                                        |

## The stored-shape check

| Shape                                             | Every write path                                 | Held by                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publication_request_binding`                     | `requestPublication`, publish and preview, alone | 0022's while-queued trigger; node as the outline's, binding NFC and spelled as content's, digest 64 hex, each by constraint; the resolution's document, node, binding and digest equal to the row's (trigger); dataset version by `(id, artifact_id, kind)` `on delete restrict`; `on delete cascade` from the request, so the preview sweep still works; update and delete revoked |
| `publication_binding`                             | `recordPublication`, alone, in its transaction   | 0017's `publication_part_while_queued`; `publication_recorded_whole` widened: exactly the request's rows, by node, binding and resolution; `on delete restrict` to the dataset version                                                                                                                                                                                              |
| `publication_output.format` gains `provenance`    | `recordPublication`, alone                       | 0027's four checks widened (no standard, producer `pipeline`, `report = '[]'`); the whole check: outputs are the request's formats plus one `provenance` exactly where the request holds a binding, and `provenance` never in `formats`                                                                                                                                             |
| `publication_request.failures` gains stage `bind` | `requestPublication`, `failPublicationRequest`   | The closed `PublishStage` and code list (domain), the contract's enum; the column's array check is unchanged                                                                                                                                                                                                                                                                        |

No content schema change, and no change to a resolution, a dataset version or `dataset_take`, which the
worker never reads (DAT-046). `recordPublication` and `recordPreview` throw before writing where the
outputs or the rows are not whole, as they do today.

## Task 1: The domain

- `publishing/bind.ts`: `bind(node, content, held, formats, language): { bound: Bound; failures }`
  over `held: ReadonlyMap<binding, { result, columns, datasetVersion } | 'unreadable'>`; `takeValue`,
  then `formatValue` with `formatsFor(theme.valueCatalogue, document language)`; failures
  `value_none`, `value_many`, `row_missing`, `value_null`, `value_empty`, `take_invalid`,
  `binding_unresolved` (not recorded), `result_unreadable`, stage `bind`, block and binding named.
  `unbound(content): Bound` for the page. `failures.ts`: the stage and codes.
- `assemble`: `AssembleInput.bindings` (by node), `bind` after `conditionContent` and before
  `contributionsOf`; the `compose` `binding_unresolved` line removed; a `value` read as text by
  references, the lists, the glyph and emptiness checks and the projection. `structure/`:
  `contributionsOf(Bound)`; `references.ts` likewise.
- `publishing/provenance.ts`: `publishedProvenance(assembled, held, numbering): PublishedProvenance`
  and `provenanceBytes`; per value the node and its number, block, binding, what was printed, the
  canonical value and column `{ name, type }`, the take, the dataset by name and version, and the
  provenance less `ran`, `connection` and each column's `from`.
- Tests: **`PUB-108`** in `order.test.ts`: swapped after references a reference to a table whose
  caption holds a value prints none; after generation the list of tables omits it; after numbering,
  `@ts-expect-error` on `contributionsOf(content)` unbound, which `pnpm typecheck` holds.
  **`DAT-046`** in `bind.test.ts`: each failure by name, gathered, no projection, and no path printing
  a blank, zero, placeholder or description. **`DAT-087`** there too: a binding the request did not
  record fails by name. `provenance.test.ts`: the allow-list (below, review b).

## Task 2: The migration and the database

`0050` as the stored-shape check; `requestPublication` per B3-C (digest by `bindingDigestInput`,
latest resolution for document, node and binding; `changed` where one exists under another digest);
`PublicationInputs.bindings` read with each distinct dataset version's provenance and name;
`recordPublication` writing `publication_binding` and the provenance output; `publicationBindings(trx,
id)` for the route. Tests: each constraint and trigger red by a direct insert; **`DAT-087`**: never
and changed refused, nothing queued, the rest recorded; **`DAT-042`**: a publication refused unless
its bindings and provenance output are whole; the preview sweep removing its rows.

## Task 3: The worker

`jobs/publish.ts`: each distinct dataset version read once by `${prefix}sha256/<checksum>`, held to
it (B3-F); `assemble` given the bindings; for a publish holding values, `provenance.json` kept by its
hash and recorded; `PIPELINE_VERSION` `'16'`. Tests, with Typst fetched: **`DAT-088`** a publish
reads each value from its stored result, and an object altered in the store fails
`result_unreadable`, the worker holding no connector configuration; **`STY-082`** a value under a
catalogue unlike the default, read back from the PDF (pdf.js, `packages/conformance`) and from
`word/document.xml`, equal to `formatValue`'s string under Node; **`DAT-042`** / **`PUB-049`** the
provenance output holding what was printed; **`DAT-046`** a preview failing as the publish does
(BI-M); the Open XML SDK's validation of a Word document holding a value.

## Task 4: The service, the contract and the page

`apps/service/src/publishing.ts`: `binding.unresolved` answered 400, `attribution: 'product'`, naming
each binding, its node, its reason and the document; the route `GET /v1/publications/{id}/bindings`,
`read` on the publication, the SQL, connection and column sources only to a reader of each
definition, decided in its transaction. `packages/api-contract`: the route documented under the
publications' tag; stage `bind`; `ProvenanceOutputView` in `outputs`; `openapi.json` and the client
regenerated. `apps/web`: the publication's page lists `provenance.json` beside the PDF and Word; the
refusal's words name never resolved or changed. Tests: **`DAT-087`** the route's refusal;
**`DAT-042`** the bindings route, redacted and whole; the page's listing.

## Task 5: The whole system, and docs

`tests/e2e/src/bindings.test.ts`, uncited: a document holding a value on `source-postgres` published
to PDF and Word, its text read back, `provenance.json` downloaded by a reader without the definition
holding no SQL; the source stopped before the job runs and the publish still made. No browser test:
the page's one change is a row in a list the browser suite already passes through axe. Docs:
bindings.md (PUB-108 moved to owned, the "not built" note), publishing.md's order, features.md and
the README, this plan's row; design claims pin 591 to 592 from `pnpm trace pins`.

## Reviews

One **targeted review** after task 4, of two areas only:

- **(a) The stage and the order**: no path prints a value the document does not hold (a stale
  resolution, another node's, a dataset version not the request's), and each order test red when its
  swap is made in `assemble` itself, not only in the test's composition.
- **(b) `provenance.json` and who may read it**: the bytes hold no SQL, connection or column source
  for any input D3 can store (fuzzed from `provenanceSchema`), the download is `read` on the
  publication and no wider, and the route's whole answer reaches only a definition's reader.

Then the **final independent break** of each citation, each red, and of 0050's whole check.

## Verification

- Each suite alone, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`; `generate`
  after prettier, then `pnpm trace check` and `pins`. `apps/worker` after
  `pnpm --filter @alloy-works/worker fetch-typst` in the build's worktree.
- `pnpm test:e2e` against a compose project of the build's own (`-p alloy-b3 --profile sources`, its
  own ports), every target explicit: `ALLOY_TEST_DATABASE_URL`, `ALLOY_TEST_OBJECT_STORE`,
  `ALLOY_TEST_SOURCE_PORT`, `ALLOY_E2E_COMPOSE_PROJECT`, `ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP`,
  `ALLOY_E2E_IDP_ISSUER`, `ALLOY_E2E_STORE_AT`, and for `pnpm test:browser`'s regression run
  `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API`, `ALLOY_BROWSER_IDP`, `ALLOY_BROWSER_DATABASE`,
  `ALLOY_BROWSER_STORE_AT`. Never Ken's `alloy-works` stack.
- **Word itself** is not in CI: the Open XML SDK's validation and the run text read from
  `word/document.xml` stand in. The Word check (`ALLOY_WORD_CHECK=1`, Windows with Word) gains a
  fixture holding a value, run on Ken's machine before the close and reduced by `pnpm trace
record-run`; the pull request says so.
- **By hand**, on that project: a value published and previewed, the PDF and the Word document
  opened, `provenance.json` read, and a changed binding refused. The pull request says which the
  tests prove and which stand in for Ken's look.

## Questions for Ken

1. **B3-D: claim PUB-108 on `contributionsOf(Bound)`**, with `unbound` the page's named way round it?
   The types refuse the swap as `number` refuses an unconditioned outline; neither stops a caller
   choosing the other function. **Recommended: yes**, and say so beside the claim.
2. **The Word check's run before B3.2**, on your machine, rather than leaving it to the next Word
   slice? **Recommended: yes**; it is the one place Word itself reads a value.

## Changed while building

| Found | Change |
| ----- | ------ |
