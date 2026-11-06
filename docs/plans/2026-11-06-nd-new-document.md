# New document (ND)

One PR, as Ken asked: the New document dialog redrawn as a template gallery beside the details (the
handoff in `docs/interface/handoffs/new-document/`), and a template made mandatory, with a default for each
space. Pre-flight reviewed; its findings are folded in below.

## Calls

Ken's (2026-11-06):

- **ND-A** a template is always chosen. Each space has a **default template**, **Blank** until its administrator
  makes another of its templates the default.
- **ND-B** `POST /v1/spaces/{space}/documents` with no `template` uses the space's default, so integrations keep
  working and get something to edit. This replaces TE-J ("no template means empty") and TE-F ("no tenant is
  seeded with a template"); an empty outline is still a valid document (STR-054), from a template with none.
- **ND-C** each component a template places is **referenced** (today's, the default) or **copied**: a copy is the
  new document's own component, with an **origin record** back to what it was made from. Chosen per component;
  a starting section may set the default for those under it. Blank places one copied component.
- **ND-D** a template gains an optional **description**, each value an optional **label**, set through the API
  until templates have a page. A value without a label shows its key.
- **ND-E** no publish check for a copy's words left unchanged.
- **ND-M** the origin record (Ken chose it over a built-in relationship type): which component and version, or
  which template, a component was made from, shown on it as "Copied from X at v1" and whether X has changed since.
  Written by template copies and by Duplicate (RM). Insert-only; not in the relationship graph.

Mine, from the pre-flight:

- **ND-F** a template component either names a `component` (referenced, or copied from its latest version) or holds
  its `content` inline (title and blocks, always copied). Nothing hidden is owned by a template, so Components,
  search and where-used are untouched. Blank's is "Please supply a title" holding "Please supply the text.", in
  the catalogue's words for the document's language, else en-GB.
- **ND-G** a template component gains `required?` (absent is true, as today). Blank's is not required. A required
  copy stays guarded as required components are, but is the document's to rewrite, and Duplicate may copy it
  (REU-057 exempts it).
- **ND-N** Blank is **made when first needed**, as the person creating: by `POST /v1/spaces` for a new space, and by
  a create with no template in a space whose default is none, under a lock on the space. A version needs an
  author, so no migration makes it. A default archived, deleted or moved out of its space counts as none, so
  moving and retiring templates need no new guard.
- **ND-O** the default is resolved **at the service route**, not in the db's `createDocument`, which imports,
  reference documents and the db tests call for an empty outline. Copies are made in `createFromResolution`, so
  cohorts and bindings make them too; a cohort's rows times its template's copies is limited to
  `COHORT_ROWS_MAX`.
- **ND-P** a template **move never adds a copy**: a copied component new to the target version is reported missing,
  as a required section is.
- **ND-H** `GET /v1/templates` carries a summary from the latest definition it already reads: sections, values,
  required values, copied and referenced components, description, first five headings, and whether it is its
  space's default. Pure, in the domain, so the gallery can show Blank for a space that has not made it yet.
- **ND-I** the gallery lists the templates of every space the reader may read templates in, grouped by space, the
  Where space first, its default selected.
- **ND-J** no person value: each value is drawn by its real type.
- **ND-K** a required value is edged `--warn` only after a Create is tried or the pill is pressed.
- **ND-L** a space's tone is stable by its id, from the four tones, its name always beside it.

## Stored shapes

- `space.default_template` nullable, references `artifact` on delete set null. No backfill (ND-N).
- `artifact_origin (tenant_id, artifact_id, from_artifact?, from_version?, template_id?, template_version?)`,
  insert-only, forced row security, one row per copy.
- Template definition, additive at schema 1: `description?`; per component `component?` or `content?` (one of
  them), `instantiate?` and `required?`; per starting section `instantiate?`; per value `label?`. Checked on every
  write path (`createTemplate`, versions, Duplicate of a template, import).

## Interfaces

- Domain: the definition additions; `instantiateOf`; `blankTemplate(words)`; `templateSummary(definition)`.
- Db: `ensureDefaultTemplate`, `setDefaultTemplate`; `createFromResolution` makes copies and origins; `originOf`.
- Contract: `TemplateSummary` gains the summary; `SpaceView`/`SpaceList` gain `defaultTemplate`;
  `PUT /v1/spaces/{space}/default-template` (administer at the space); a component's view gains `origin`.
- Web: `NewDocument` as its own `Modal` per the handoff; Spaces' row gains Default template; the component page
  shows its origin.

## Tests

Requirements first (`pnpm trace draft`): the default template (TPL, answering TPL-Q01), copy or reference (TPL),
the origin record (REU), description and labels (TPL), the gallery dialog (TPL). STR-054's test uses a template
with no sections; the service, e2e and browser tests that posted for an empty outline say so. Domain, db, service
and web tests as the handoff orders, the 30-value test among them; pseudo and accessibility walks over the dialog.

## Docs

An ADR for ND-A, ND-B, ND-C, ND-M and ND-N; `templates.md`; `features.md` and `README.md`; `openapi.json` and the
client; one fragment.
