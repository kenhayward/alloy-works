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
- **ND-C** a template may hold **starter components**: each new document gets its own copy, owned by it, as well
  as today's shared references (`components`). Blank is a template with one starter.
- **ND-D** a template gains an optional **description**, and each of its values an optional **label**, both set
  through the API until templates have a page of their own. The value's key is shown where it has no label.
- **ND-E** no publish check for a starter's words left unchanged.

Mine, to confirm with the second handoff:

- **ND-F** a starter is held **inline** in the template's definition, `{key, title, content, place}`, not as a
  reference to a component: a reference would leave a source component in every space's Components list, the
  litter Blank's seed was meant to avoid. Blank's starter is titled "Please supply a title", holding "Please
  supply the text.", in the space's language where the catalogue has them, else en-GB.
- **ND-G** a starter is made at creation through `createArtifact`, in the document's space, of the space's
  default component type, in its workflow's first state, as the creator, placed `latest`, in the document's
  transaction, and audited as made. Duplicate's copy code (RM) does the copying.
- **ND-H** the gallery reads a summary on `GET /v1/templates`: sections, values, required values, starter and
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
- The template definition, additive at schema 1: `description?`, `starters?` (at most 10), and `label?` on each
  value. Every write path checked (`createTemplate`, template versions, moves, export and import).

## Interfaces

- Domain: `starterSchema`; `BLANK_TEMPLATE(language)`; the template summary from a definition, pure.
- Db: `createSpace` makes Blank; `setDefaultTemplate`; `createDocument` resolves the default and makes starters.
- Contract: `TemplateSummary` gains its summary; `SpaceView` and `SpaceList` gain `defaultTemplate`;
  `PUT /v1/spaces/{space}/default-template`, administer at the space. The create route's description, for ND-B.
- Web: `NewDocument` on `Modal` as the handoff draws it; Spaces' row gains Default template.

## Tests

Requirements to raise first with `pnpm trace draft`: a default template per space (TPL), a starter copied into
each document (TPL), a template's description and value labels (TPL), the dialog (TPL or STR). Domain, db,
service and web tests as the handoff's order lists, the 30-value test among them; the pseudo and accessibility
walks over the dialog.

## Docs

An ADR for ND-A, ND-B, ND-C and ND-F; the handoff's ADR for the dialog; `templates.md`; `features.md` and
`README.md`; `openapi.json` and the client; one fragment.
