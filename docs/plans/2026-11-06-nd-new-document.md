# New document (ND)

One PR, as Ken asked: the New document dialog redrawn as a template gallery beside the details (the
handoff in `docs/interface/handoffs/new-document/`), and a template made mandatory, with a default for each
space. A second handoff is expected before building; this plan is revised for it.

## Calls

Ken's, on the handoff (2026-11-06):

- **ND-A** a template is always chosen. Each space has a **default template**, made as **Blank** with the space;
  spaces made before this get one too. A space's administrator may make another of its templates the default.
- **ND-B** `POST /v1/spaces/{space}/documents` with no `template` uses the space's default, so integrations keep
  working and get something to edit. This replaces "no template means empty" (TE-J); an empty outline is still
  a valid document (STR-054), and a template may still start with none.
- **ND-C** each component a template places is **referenced** (today's behaviour, the default) or **copied**:
  a copy is the new document's own component, made from the template's at its version then, with a
  **derived from** relationship back to it. Chosen per component when the template is designed; a starting
  section may set the default for the components under it. Blank is a template placing one copied component.
- **ND-D** a template gains an optional **description**, and each of its values an optional **label**, both set
  through the API until templates have a page of their own. The value's key is shown where it has no label.
- **ND-E** no publish check for a copied component's words left unchanged.

Mine, to confirm with the second handoff:

- **ND-F** the component a template copies from is **owned by the template**: not listed in Components, read
  with the template, versioned with it. An ordinary component may be placed for copying too. Blank's is titled
  "Please supply a title", holding "Please supply the text.", in the space's language where the catalogue has
  them, else en-GB.
- **ND-G** a copy is made in the document's transaction by Duplicate's copy code (RM), in the document's space, of
  its source's type, in its workflow's first state, as the creator, placed `latest`, audited as made, with its
  derived-from relationship. A component the template requires may be a required copy: it stays, guarded as
  required components are, but is the document's to rewrite. Duplicate's "never copy a required component"
  (REU-057) follows the template's choice.
- **ND-M** **derived from** is a built-in relationship, the first not defined by a tenant, written by template
  copies and by Duplicate alike, so what changed in a source since is shown as any relationship's reach is
  (REL-024).
- **ND-H** the gallery reads a summary on `GET /v1/templates`: sections, values, required values, copied and referenced
  shared components, its description, its first five headings, and whether it is its space's default. No read
  for each template.
- **ND-I** the gallery lists the templates of every space the reader may read templates in, the space chosen
  for Where first, its default selected; it groups by space, and Blank is no longer a group of its own.
- **ND-J** values whose kind has no picker yet (the drawing's person) do not exist: each value is drawn by its
  real type (text, number, date, time, date and time, yes or no, a choice from its permitted values).
- **ND-K** a required value is edged in `--warn` only after a Create is attempted or the pill is pressed.
- **ND-L** a space's tone is stable by its id, not its order, from the four tones; its name is always beside it.

## Stored shapes

- `space.default_template` (nullable, references `artifact`), a migration making Blank in every space and
  setting it; `createSpace` does the same.
- The template definition, additive at schema 1: `description?`; on each component, `instantiate?: 'reference' |
'copy'` (absent is `reference`); on each starting section, the default for its components; `label?` on each
  value. Template-owned components: a flag on the artifact, left out of listings and search.
- A built-in `derived from` relationship type. Every write path checked (`createTemplate`, template versions, moves, export and import).

## Interfaces

- Domain: the instantiate choice and its defaulting; `BLANK_TEMPLATE(language)`; the template summary from a definition, pure.
- Db: `createSpace` makes Blank; `setDefaultTemplate`; `createDocument` resolves the default and makes each copy.
- Contract: `TemplateSummary` gains its summary; `SpaceView` and `SpaceList` gain `defaultTemplate`;
  `PUT /v1/spaces/{space}/default-template`, administer at the space. The create route's description, for ND-B.
- Web: `NewDocument` on `Modal` as the handoff draws it; Spaces' row gains Default template.

## Tests

Requirements to raise first with `pnpm trace draft`: a default template per space (TPL), a template component
copied or referenced (TPL), derived from (REL), a template's description and value labels (TPL), the dialog (TPL or STR). Domain, db,
service and web tests as the handoff's order lists, the 30-value test among them; the pseudo and accessibility
walks over the dialog.

## Docs

An ADR for ND-A, ND-B, ND-C, ND-F and ND-M; the handoff's ADR for the dialog; `templates.md`; `features.md` and
`README.md`; `openapi.json` and the client; one fragment.
