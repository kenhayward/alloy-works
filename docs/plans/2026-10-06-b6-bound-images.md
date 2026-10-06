# B6: Bound images

> B6 of [bindings.md](../design/bindings.md)'s build order, on what B1 to B4 and D8 built. **Full
> tier, one review**: a content schema change and a migration, so Ken answers the questions below
> before B6.1 (the plan rides alone, [ADR-0039](../decisions/0039-ci-at-two-speeds-and-fewer-prs.md)),
> and a final review breaks each citation and probes the stored shape, the walk and the stage; no
> per-task reviews. Ken may overrule.

**Goal:** an image column can be bound (BI-P). An inline binding taking one is drawn and printed as
an inline image, in a line or a table's cell, from the asset the dataset version's provenance
`images` maps the cell's hash to; a figure can take its image from a binding instead of an asset
version. The description is the definition's named column, or the image is decorative; a null or
empty description fails the publish by name, `image_description_missing` (DAT-097). The Value dialog
offers image columns, and the editor reads a bound image only through the document (D8-I).

| PR   | Holds                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| B6.0 | This plan, with a change fragment                                                                                                       |
| B6.1 | The model and the publish: the figure's member, the walk, `takeValue`'s image arm, 0052, the bindings view, the stage, the worker, Word |
| B6.2 | The editor and the page: the figure's binding, bound images drawn, the Value dialog and panels, the whole system, and B6's close        |

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Beat                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B6-A | **A figure gains an optional `binding` member holding a whole `binding` node** (`bindingNodeSchema`, its `type` included), and `asset` becomes optional; the walk requires exactly one, `figure_image`, and claims the binding's `id` as it claims an inline one's. So `bindingsIn`, the digest, resolve, Keep, holders, the request and the Data tab find it unchanged, at path `content.N.binding`                                                                                                    | An `image: {asset} \| {binding}` member, which renames `asset` and needs schema 2 with a migration; a new block type, a second figure for numbering, references and the list of figures to learn |
| B6-B | **Additive, at content schema 1, by the footnotes plan's evidence rule**: every stored figure has `asset` and no `binding`, so it parses and its canonical form and digest are unchanged; no evidence query is needed, since nothing narrows. `CURRENT_SCHEMA_VERSION` stays 1, the chain stays empty, and `fixtures/v1/every-node.json` gains a bound figure                                                                                                                                           | Schema 2 for a widening, a migration with nothing to do                                                                                                                                          |
| B6-C | **A bound figure's `alternative` is `inherited` (the definition's description, or decorative where the definition says so) or `decorative`; `own` is refused by the walk**, `figure_bound_alternative`, since one fixed text cannot describe each document's row (DAT-097). Ken, 2026-10-06: an author's `decorative` overrides a missing description, so such a figure never fails `image_description_missing`                                                                                         | An author's own text over a bound image, as AST-013 allows over an asset's, which would describe one row's image in every document                                                               |
| B6-D | **`takeValue` gains an image arm**: an image column's cell answers `{ image: hash, description: text \| 'decorative', column }`, its description read from the same row by the column type's `description`; null or `White_Space` alone is `image_description_missing`. Placement is not the take's: a figure's binding of a non-image column is `value_not_image`, and an inline bound image inside a footnote `image_not_placeable` (CNT-129), each decided by the view and the stage beside the take | Placement in the take, which would key `dataset_take` by where a binding stands                                                                                                                  |
| B6-E | **The stage sets a bound image as an ordinary one**: an inline binding becomes an `image` inline, `imageStyle: 'inline'` (what the editor gives an inserted image), and a bound figure gains `asset`; each with `alternative` `own` from the description or `decorative`. So Typst, Word, the glyph checks and PDF/UA tagging read what they read today                                                                                                                                                 | A bound-image arm through the published document, template and Word writer                                                                                                                       |
| B6-F | **The worker loads the metadata of every asset version the held dataset versions' `images` name** (one query) into `assemble`'s `assets`, and reads the bytes only of those the stage placed, held to their hash. Nothing is recorded on `publication_request_asset`: `publication_binding` already holds the dataset version, whose provenance names the asset version                                                                                                                                 | Recording bound images at the request, which would mean taking values under the access epoch's lock (BI-L); or reading every image of a large result                                             |
| B6-G | **The page draws a bound image from `/v1/asset-versions/{id}/content`**, which D8-I's gate already answers only to a reader of a document holding it; the bindings view answers the asset version beside the hash                                                                                                                                                                                                                                                                                       | A document-scoped image route, a second door to the same bytes                                                                                                                                   |
| B6-H | **The Value dialog offers image columns, and on one asks Place as**: _In the line_ (default) or _As a figure_, the latter only where a block may stand. A bound figure's panel shows its binding, with **Change** opening the dialog on it                                                                                                                                                                                                                                                              | A From data choice in the Figure dialog, a second way to choose a definition                                                                                                                     |
| B6-I | **`provenance.json` goes to `schemaVersion: 2`**, a value gaining an image arm (`image: { hash, assetVersion }`, `description`), every new publication written at 2; stored files stay as written                                                                                                                                                                                                                                                                                                       | An unannounced arm at 1, which a strict reader of 1 would refuse                                                                                                                                 |

## The stored-shape check

- **Content** (B6-A, B6-B): `figureNodeSchema` gains `binding?: bindingNodeSchema`, `asset` optional;
  every write path - the editor's `fromEditor`, admission (re-identify renews and keeps the figure's
  binding as an inline one's, `bindingsRenamed`), the readers (which never write one) and the
  service's saves through `parseContentDocument` - is held to the walk's exactly-one and alternative
  rules. Fixture v1 edited, as D3 did for the binding.
- **0052** (tenant): `dataset_take_outcome` widened to the image arm and `image_description_missing`;
  and every derived row with `take_invalid` deleted, since an image take written before B6 answered
  it and is recomputed on a miss (derived, BI-G).
- **`provenance.json`** at 2 (B6-I); the bindings view and `GET /v1/publications/{id}/bindings` gain
  the image arm in the contract. No table but `dataset_take` changes.

## Task 1: The model (`packages/domain`) - B6.1

- `blocks.ts`, `document.ts`: B6-A and B6-C in the schema and the walk; `data/binding.ts`'s
  `bindingsIn` visits a figure's binding; `admission/reidentify.ts` renews it.
- `data/take.ts`: B6-D's arm, `TAKE_FAILURES` and `takeOutcomeSchema` widened.
- Tests: **`CNT-012`** the every-construct test requires a bound figure, red before the fixture
  edit; an asset figure's canonical form pinned unchanged, written out, as `numbered`'s was.
  **`DAT-098`** a figure holding a binding in place of an asset; both or neither refused
  `figure_image`; its binding found by `bindingsIn` and its id claimed against a duplicate.
  **`DAT-097`** an image take answers the named description or decorative, and a null or blank
  description `image_description_missing`; a bound figure's own alternative refused.

## Task 2: The stage, the worker and Word (`packages/domain`, `apps/worker`) - B6.1

- `publishing/bind.ts`: B6-E and B6-D's two placement failures; `PrintedValue` gains the image arm;
  `publishing/provenance.ts` per B6-I. `assemble` refuses a figure still without `asset` after bind
  as a backstop. `apps/worker/src/jobs/publish.ts`: B6-F.
- Tests (`bind.test.ts`, `apps/worker/src/bindings.test.ts`, `word-values.test.ts`): **`DAT-098`** a
  bound image in a line, in a table's cell and as a figure, each read back from the PDF and the docx
  as an image of the asset's bytes. **`DAT-097`** a publish and a preview fail
  `image_description_missing` naming the binding, the block and the column, every one gathered; a
  described image's PDF `/Alt` and docx `descr` are the cell's text, a decorative one an Artifact
  and `descr`-free; veraPDF passes both. **`DAT-042`** `provenance.json` records the image's hash,
  asset version and description.

## Task 3: The view (`packages/db`, `apps/service`, `packages/api-contract`) - B6.1

- Migration 0052 per the check above; `recordTake` writes the image arm. The bindings view answers
  an image value with its asset version from the held provenance, and B6-D's placement failures.
- Contract: the view's and the publication route's image arms, described; `openapi.json` and the
  client regenerated.
- Tests: **`DAT-097`** the view answers a bound image's asset version and description, and
  `image_description_missing` in place; 0052 refuses an image outcome with no hash. A document reader
  fetches the bound image's bytes; a reader of the definition's space and no such document is
  `not_found` (D8-I, already cited by D8, uncited here).

## Task 4: The editor and the page (`packages/editor`, `apps/web`) - B6.2

- `schema.ts`, `mapping.ts`, `figureView.ts`: the figure's `binding` attribute, mapped losslessly; a
  bound figure drawn from the `BindingContext`, its failure in place as a binding's is. `bindings.ts`,
  `bindingView.ts`, `render.ts`: a held image drawn one line high as `imageView` draws one, `alt` the
  description or empty, in the surface and the read text alike.
- `ValueDialog.tsx` per B6-H; `FigurePanel.tsx` and `ValuePanel.tsx` show a bound image's binding and
  description; the Data tab lists a bound figure as any binding.
- Tests: **`DAT-098`** the dialog places an image column in a line, in a cell and as a figure, and
  each draws its image from the asset version route; **`DAT-097`** a missing description shown in
  place; **`DAT-047`** a bound figure's failure leaves the rest of the document drawn. A copied
  bound figure renewed and a cut one kept (BI-D). Every user-facing string dash-free.

## Task 5: The whole system, docs and the close - B6.2

- `tests/browser`: place `sample.site_photo` as a figure in a document on `source-postgres`, publish,
  read the PDF's image back; the dialog through axe and by keyboard; uncited, as B1's were.
  `tests/e2e`: the same over HTTP, and a description emptied in the source failing the publish.
- Docs: bindings.md (DAT-098 claimed, B6's rows, the stored-shapes table), content-model.md's
  figure, component-editor.md's binding row, features.md and the README, this plan's row; the close
  per ADR-0037 in this PR.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` and `pnpm test:browser` against the build's own compose project
  (`-p alloy-b6 --profile sources`), every `ALLOY_TEST_*`, `ALLOY_E2E_*` and `ALLOY_BROWSER_*`
  target set. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation; probes a figure with both or neither, a pasted bound
  figure's identity, a stored figure's digest, a floating definition whose image column became text,
  a description null in one row only, and the D8-I gate (which admits any image of a held result,
  not only the one taken).
- **By hand**: a bound figure and an inline image in Word and Acrobat, read aloud.

## Risks

- **The content schema change** is the one irreversible step: B6-B rests on every stored figure
  parsing with an unchanged digest, which the pinned canonical form proves; `asset` optional reaches
  nine files that read it today, each made to handle a bound figure or to read only bound content.
- **Word and PDF/UA**: B6-E keeps the writers unchanged, so the risk is the stage's output; the
  veraPDF and docx read-back tests above hold it.
- **Alt text**: a description is the source's words in the component's language (AST-039's
  override rule); a source in another language is mis-tagged, as an author's own text would be.
- **D8-I's gate scans `binding_resolution`** once per image read; a page of many bound images may
  need it indexed, measured in B6.2.

## Questions for Ken

Answered by Ken on 2026-10-06: both as recommended.

1. B6-A and B6-B: the figure's `binding` member beside an optional `asset`, at content schema 1
   with no migration? **Recommended: yes**; it is additive, and every binding path reads it as an
   inline binding.
2. B6-C: a bound figure is described by its definition or marked decorative, never by the author's
   own text? **Recommended: yes**, as DAT-097 reads.
