# Document language: a space's default, and changing a document's

**Goal.** A delivered document need not stay `und`. A space names a default language, which CT Studio's
deliveries and new documents and components take; a document's language can be changed from a modal, from
the Document menu and a toolbar icon, optionally with its components'.

Ken's call, 2026-11-02, superseding [ct-studio-sink.md](../design/ct-studio-sink.md) "language stays out of
this design until the contract carries one": the space supplies it, with no contract change. Issue #906 has
the captions.

## Decisions

- **L1. Stored:** `space.default_language`, nullable, migration `0193_space_language`. Read with `to_jsonb`
  where current code runs on old schemas. Null: delivery records `und`, and New document offers `en-GB` as now.
- **L2. Wire:** `SpaceView.language` (string or null); `UpdateSpaceBody.language` (a tag, null clears), under
  `updateSpace`'s existing permission. Audit: `space.language_changed` with `{from, to}`.
- **L3. Created here:** New document and New component prefill from the chosen space until the person types
  in the field. A template holds no language (`materialise` takes the heading), so a document made from one
  takes the same prefill; nothing is added to templates.
- **L4. Delivered:** a new document, its components and new assets' alternative text take the default, else
  `und`. On update each keeps its language unless that is `und`, then takes the default. So setting a default
  and delivering again repairs an untouched `und` document, and a person's choice survives.
- **L5. A language change is not an edit to a delivery.** `changed_in_target` compares version ids, so the
  change would block every later delivery with no way out. A version counts as unchanged where its substance
  equals the delivered one's apart from `language`, and, for the document, apart from pins that moved to a
  component version itself differing only in language. Pure `sameApartFromLanguage`, in `packages/domain/src/bridge`.
- **L6. Route:** `POST /v1/documents/{id}/language`, `{openedFrom, language, components: boolean}`, `edit` on
  the document. Not an outline operation: undo, the assistant and `tree.ts` have no need of it, and a pure
  `withLanguage(outline, tag)` is enough. One transaction. Answers `{document, components: {changed, skipped}}`.
- **L7. Translated titles:** refused, `outline_invalid`, where a title has a translation in a language serving
  the new one (`serves`), since a title is never translated into the outline's own. Nothing is discarded.
- **L8. With components:** each distinct component referenced, sorted, not already in the tag, gets a new
  version from its latest, `content.language` changed. A pin at that latest moves to the new version in the
  same outline version. Skipped, with a reason and reported, never failing the whole:
  `not_permitted` (`loadFactsFor` + `decide('edit')`), `locked` (anybody's, the caller's too), `pinned_behind`
  (a pin older than latest), `translated` (a language line serving the tag), `changed` (`version.precondition`),
  `missing`. An `approved` reference gets its version and shows it once approved, as any edit does.
  Runs of text marked with their own language are untouched. A declared language's script sets the
  direction too, as the component's own header does (TE-E); another keeps what it has.
- **L9. Web:** `document.language` command in the registry; Document menu row beside `scope`; an `IconButton` on
  the document bar; both open `DocumentLanguageDialog`: a tag input with the declared languages as a datalist
  (from `ComponentHeader`, extracted), a checkbox "Also set the language of its components", refusal words, and
  a notice counting what changed and what was skipped by reason. Disabled as `scope` is, without `mayEdit`.
  **Spaces** gains the default in its dialog; **CT Studio** settings say delivered content takes it.

## From the pre-flight

- **Translations stay current.** A language-only version would mark every language line out of date
  (`needsRetranslating`): each one, from L4's repair and L8, declares `retranslate: false`.
- **Readers read the list.** The language goes on `SpaceList`, `listSpacesFor` and `creatableSpacesIn`, not only
  `SpaceView`, and `UpdateSpaceBody` accepts a body of language alone.
- **L8 locks first.** `lockAll` exported from delivery; every artifact locked in id order, `openedFrom` checked,
  then versions cut; a refusal throws to roll back. So `changed` cannot happen and is dropped. A component with
  one pin at latest and another behind is `pinned_behind`, unwritten. `translated` ignores closed lines. One
  exported `serves`. `recordRepoints` runs as in `editOutline`. Unreadable components are counted, not named.
  The dialog refetches: the version and pins have moved.
- **L4 per artifact.** A component new to a document takes the document's language if that is not `und`, else
  the default; an existing one keeps its own unless `und`. The overlay is applied before unchanged is decided, so
  an unchanged delivery still writes nothing. A repair moves an approved document to draft, as any new version does.
- **L5 conditions.** One helper over both loops; unreadable or another artifact's version is changed; the map and
  components only, never assets; `values`, `notCarried`, `definitions` and `parameters` compared too.
- **Audit.** `space.language_changed` needs its entry in `kinds.ts`, the kinds check rewritten in 0192,
  `auditWords.ts` and the census.
- **There is no document bar** (ADR-0075 decision 3 replaced it with menus). The icon goes in the document's header
  beside its menus, an addition ADR-0075 does not rule out for a place Ken asked for by name.

## Tasks, each test first

1. **Space default:** migration and lists, db, audit kind, contract, service, regenerate, Spaces dialog.
2. **Prefill:** `useCreatableSpaces` carries the language; New document, New component.
3. **Delivery:** `mapDocument` takes a language; L4; L5 in both `changed` loops of `bridge-documents.ts`.
4. **Route:** `withLanguage`, L7, L8, contract, documentation, registries, regenerate.
5. **Dialog:** command, menu, icon, dialog, pseudo walk (`dialogs.test.ts`), accessibility and navigation walks.
6. **Docs:** `ct-studio-sink.md`, `features.md`, `README.md`, guide, fragment.

Tests a person would notice: a delivery into a space with a default is `en-GB` throughout; again after a person
changes the language keeps it and is not refused; an edit besides language is still refused; a change with
components moves pins and reports a locked one, an unpermitted one and an old pin.

## Seams

- `openapi.json` and the client after any new code. Migration lists in the db tests. The audit census and
  access-route registries. `query-*-migration` tests on old schemas (L1).
- Layout language mismatch stays a publish failure (PUB-095); not checked in the modal.
