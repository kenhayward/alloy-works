# Architecture - the repository as built

> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules,
> the version chain and access. The workspaces, the split between web and desktop, and the seam between
> them are real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain) - and who may do what to it - [access](#access) - and the
> first thing a person authors with: [the editor and its session](#the-editor-and-its-session), which
> creates a component in a space, opens its paragraphs, edits its title, base language and base direction
> above the surface, formats, links and language-marks its text from a toolbar or the keyboard, saves
> them as iterations under a lock and cuts versions from them - and
> [the document and its outline](#the-document-and-its-outline), which makes a document in a space,
> restructures its outline of sections and component references a version at a time, and numbers it -
> and [publishing](#publishing), which makes a document's latest version into a tagged PDF of its
> outline, its marked paragraphs, lists, quotations, preformatted text, tables and figures, with lists
> of figures and tables after the contents, or a Word document of all of that, its footnotes,
> cross-references and equations among it, or both, keeps it and lists it - and [assets](#assets), which takes an
> image uploaded into a space through the API, proves it is only a PNG or a JPEG, and hands it back to
> who may read the space, and which the editor places as a figure or in a line of text and the publisher
> prints either way. The editor places a footnote in a paragraph and writes it in an editor of its
> own, and adds a note to a table, and the publisher sets the footnote at the foot of its anchor's page
> and the note beneath its table. The editor places a cross-reference to a section, a figure, a table
> or a footnote from a dialog and shows it as it will print, in the layout's own words, or as broken,
> and the publisher resolves it in the document it publishes and prints it - a number, a title, both,
> a page or above and below - as a link in a paragraph's text. The editor places an equation typed
> as LaTeX from a dialog, inline or as a block, draws it as MathML and writes its spoken alternative
> in the component's language, and the publisher sets it in a pinned maths face from the maths tree
> its stored MathML converts to, tagged as a formula carrying that alternative, a numbered one with
> its number beside it, which a cross-reference can point at and a layout can list; the outline's
> title field is an editor of its own, so a section's title takes words and inline equations too. Nothing yet
> pastes an image or an equation from outside the product or makes a component type; an administrator
> invites people by address, makes and fills groups in Administration, and grants and removes roles from
> the access page of a component, a document, a template, a space or the environment. The single `Component` in `packages/domain` is still the scaffolding's, and nothing
> renders it any more.
>
> **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
> system of record, publishing workers, PostgreSQL and object storage, and the data flowing between
> them - is [`design/system.md`](design/system.md). Part of it exists here: the web service as the system of record, one worker and its queue, PostgreSQL with a schema per environment, and the object store, each described below; publishing beyond a PDF and a Word document, search, realtime beyond one stream, and the rest do not.

**This document describes the repository as it stands.** The subsystems being designed on top of it
live in [`design/`](design/), one document per subsystem, each naming the requirements it answers.
This page is the map; those are the depth. As each subsystem is built, its design document stops
describing something planned and starts describing something here.

## Workspaces

One pnpm workspace, one lock file, fifteen workspaces.

| Workspace               | Package                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `@alloy-works/domain`       | The content model - the stored shape of a component's content, its canonical form and its migration chain - the admission pipeline everything entering a component passes through - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - a document's outline and the five operations over it, its numbering - the scheme, what a component's content contributes, and `number` - the canonical serialisation of a whole version, access - the closed permission set, roles, `decide` and the readable set - the theme model - `catalogue/2`, reading a `catalogue/1` by upgrading it, and `theme/1`, `readCatalogue` and `readTheme`, contrast, the default theme's three versions and their catalogues as data, and its Typst, CSS and Word projections - `src/publishing/`: the layout's stored shape and the product's default, the published document's types, the failure vocabulary and `assemble`, the pure function that resolves language, numbering under the layout's scheme, the theme's styles and glyph coverage into one and refuses everything checked so far at once (PUB-052), which the worker's `publish` job calls, told the formats it is for, and the maths tree an equation's stored MathML converts to - `src/word/`, the Word writer, `writeDocx`, which makes a publication's `.docx` from what `assemble` answers for Word - and their rules. Pure TypeScript + zod - no React, no Electron, no `fs` |
| `packages/editor`       | `@alloy-works/editor`       | The editor's ProseMirror schema, the mapping to and from the stored model, the identity plugin, the invariants every transaction keeps, and the view one component is edited in. Browser code, no React; all but the view is tested in Node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries. `src/shell/` is the header band; `src/theme/` holds `tokens.css` (the only file that writes a colour: invariant tokens in `:root`, each theme's colours in a `[data-theme]` block), `base.css` (element styles) and `themes.ts` (the theme names, applied as `data-theme` on `<html>`); a screen's own styles are a CSS module beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests, for components, documents and definitions alike; and access - roles, groups, grants, the access epoch, the facts a decision reads, invitations and the first administrator; and what numbering reads of a document's components; and publishing - the layout every environment starts with, a request resolved as its publisher and made under that layout, the immutable record and the listing. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas with what each checks, and the OpenAPI document generated from them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/service`          | `@alloy-works/service`      | The web service: Fastify, hostname to tenant, the contract's routes each checked as it declares - a status a route does not list held to the one error shape, every response carrying its `X-Request-Id`, and every refusal a requirement makes naming it as its `rule` - and the built renderer beside them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, playing an organisation's provider or Google, for development and tests only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/readers`      | `@alloy-works/readers`      | The readers content from outside the product arrives through: plain text, and HTML - a web page, Word and Google Docs - on parse5 - a table as a table, made a grid whatever the HTML's rows say - and Markdown through markdown-it and the HTML reader, from an entry point of its own, each answering the admission pipeline's input with a report of what it kept differently or left out. Platform-free, tested in Node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/objects`      | `@alloy-works/objects`      | Object storage: a credential per tenant scoped to its own prefix, objects by content hash - put, read and removed - and signed links, which can name the file a download is saved as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/fonts`        | `@alloy-works/fonts`        | The faces the product sets text in, pinned by hash: the files and their licences in `files/`, which the worker hands Typst and the renderer bundles for the editor; the list of them, each with its cap height; and what each family covers, generated from the files. Its root is platform-free; `/node` reads the files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/worker`           | `@alloy-works/worker`       | Claims jobs from the platform queue and runs each inside its own tenant - the sample, `publish`, which assembles a requested document once, compiles its PDF, writes its Word document, or both, and records the publication, `check_pdf`, which checks each recorded publication's PDF against PDF/UA-1 with the veraPDF the image carries, one process per worker kept warm, and keeps what it found beside the publication, and `ingest`, which proves an uploaded image is only an image with sharp and records it as an asset; carries the pinned Typst and, pinned by hash beside it, the product's default faces (Liberation Serif, Liberation Mono for inline code and preformatted text, and STIX Two Math for equations), to which it holds a theme's typefaces before a publish; a refusal a job's own input caused (`JobRefused`) finishes the job at once rather than being retried; the regression corpus and veraPDF, pinned by digest, check every change to the template or the engine in the worker's own suite, the corpus keeping its PDFs for the Matterhorn review where `ALLOY_CORPUS_PDFS` is set, the Open XML SDK's validator, built from pinned images in `tools/ooxml-check/`, every `.docx` a test makes, and the Word check, run by hand on Windows with Word, opens the writer's fixtures in Word itself                                                                                                                                                       |
| `packages/api-client`   | `@alloy-works/api-client`   | The one way in for a client: types generated from `openapi.json`, a typed client, and the stream reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/trace`        | `@alloy-works/trace`        | The requirement corpus compiled: the parsers, the citation scanner, the state ladder, `check` and `verify`, the committed `trace.json`, the query command, a hand-written baseline declaring what a release is answerable for, `pnpm trace gate` deciding pass or fail over it, `pnpm trace pack` writing the evidence pack a baseline's release commits alongside it, and intake - the issue form and `pnpm trace draft`, which drafts a row from a filed issue or from flags but never inserts it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tests/e2e`             | `@alloy-works/e2e`          | The whole system in containers, driven over HTTP: sign in, ask for a sample, wait on the stream, fetch the PDF; publish a document, follow the request, and download the publication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/browser`         | `@alloy-works/browser`      | The renderer in a pinned Chromium against the whole system, driven by Vitest over playwright-core: signed in once through the stand-in's page, fixtures made through the API, the page's console gated, axe-core over WCAG 2.2 AA; the pinned `chrome-headless-shell` and its hashes in `src/chromium-release.ts`, fetched by `fetch-chromium`; the outline edited by keyboard, pointer and API; axe over every state of the editor and the document view, and `undecided`, which prints what axe left for the audit a person makes; and the editor measured against the PDF of the same document under five themes, which it writes into the stack's database through `@alloy-works/db`'s theme writers, the PDF read by pdf.js; and the navigation budgets, STR-072 and CNT-179, timed by the page itself over a five-hundred-node document made through the API once per stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

CI now has one real gate: `pnpm trace gate`, run in a job of its own once the build job and the
whole-system job have finished, is not `continue-on-error` like the checks around it - see
[`docs/testing.md`](testing.md) and [`CLAUDE.md`](../CLAUDE.md) for why that is safe rather than
reckless. It reads every suite's JSON report: the build job uploads what `pnpm test` wrote, and the
whole-system job - which builds the compose stack and runs the end-to-end suite and then the browser
suite against the same containers, the pinned Chromium restored from a cache keyed on its pin file -
uploads the other two, so a browser test's citation is verified by the same gate as any other
([`docs/ci-and-releases.md`](ci-and-releases.md)).

The theme model (`src/theme/`), measured as a prototype and recorded in ADR-0014, is exported from
the package since [themes 1](plans/2026-09-24-themes-01-the-theme-in-the-pdf.md), when the publishing
pipeline first needed it: the stored shapes `catalogue/3` and `theme/1`, closed at every depth -
`catalogue/2` since [themes 2](plans/2026-09-24-themes-02-table-and-image-styles.md), adding table
and image styles and a paragraph's `contextualSpacing`, with `catalogue/1` frozen and read by
`upgradeCatalogue1`, which fills what version 2 adds with template 12's look, and `catalogue/3` since
W14.5, adding where a table's or a figure's caption sits, with `catalogue/2` frozen and read by
`upgradeCatalogue2`, which puts a table's caption above and a figure's below; the
reader, `readCatalogue` and `readTheme`, which walks every `basedOn` chain, finds every typeface,
place and role, checks each place's and role's style applies there, each style's line spacing is no
less than its size, and each colour's contrast - a mark's at the size and weight it sets its text,
its `scale` and a script's `SCRIPT_SCALE` applied, and on a table style's fills too, for every
paragraph style that applies to a cell or a list item - checks an image style's units against its
dimension and its placement against what it applies to, and a table style's rules against its
padding, none wider than twice it (`table_rule_over_text`), and returns every
refusal at once; the default theme, `DEFAULT_THEME`, and its catalogues under fixed
version identifiers - 0.4, with 0.1 frozen as `FIRST_DEFAULT_THEME` and `FIRST_DEFAULT_CATALOGUES`,
0.2 as `SECOND_DEFAULT_THEME` and `SECOND_DEFAULT_CATALOGUES`, and 0.3 as `THIRD_DEFAULT_THEME`;
and three projections - `projectTypst`, the data templates 13 and 14 read, which `assemble` uses, beside
`projectTypst12`, template 12's, frozen - `projectCss`, which the renderer sets a component's text
by (W8.2, [The theme in the editor](#the-theme-in-the-editor)), and `projectStylesXml`, which the Word
writer's styles come from. The zod schemas
stay inside the package: the store and `assemble` read a theme only through the reader.

Dependencies point one way: `apps/web` depends on `@alloy-works/domain`, on `@alloy-works/editor` -
itself on the domain package and ProseMirror - and on `@alloy-works/api-client`, which is the only way
it calls the service (API-001); `apps/desktop`
depends on `@alloy-works/web` **for types only** (see the platform bridge below). `packages/db`
depends on `@alloy-works/domain`, for the version's canonical serialisation and the schemas a
version's content is checked against, and for `decide`. `packages/api-contract` and `apps/service`
depend on it for the permission set a route declares and the decision it is checked by, and the
contract takes an outline operation's schema from it rather than restating it. `apps/worker` depends
on it for `assemble`, which the `publish` job runs, and on `packages/db` and `packages/objects` for the
queue, the record and the store; `apps/web` imports the draft notice's words from it. The domain package
depends on neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI
along.

**The access page checks what arrives, as well as its type.** It was written while the client's answers
reached the renderer as `any` (issue #110, fixed by PR #111), so `apps/web/src/access/describe.ts` checks
each response's shape by hand before reading it. The generated types now reach the renderer too; the
hand-written shapes stay as a check on the body a service actually sent, and can become aliases of the
generated types when the page is next touched.

## The content model

`packages/domain/src/content/model/` holds the shape a component's content is stored in, designed in
[`design/content-model.md`](design/content-model.md) and built on
[ADR-0005](decisions/0005-purpose-built-node-and-mark-content-model.md) and
[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md). It is the whole of the stored
shape and none of the product on top: nothing authors content, stores it, admits it from another
format or publishes it.

| File            | Holds                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `marks.ts`      | Thirteen marks, and the set is closed. Each carries an identifier and no appearance                                                                                                        |
| `inline.ts`     | Eight inline nodes, a cross-reference's closed target union, and the three-state alternative a figure or an image carries                                                                  |
| `blocks.ts`     | Seven blocks, a list item's optional `term`, a figure's and a table's optional `numbered: false` (W14.4), the restricted sequence a footnote's content is, and `startsOutsideItsNumbering` |
| `document.ts`   | The root a version holds, and `parseContentDocument` - the one way a document is constructed                                                                                               |
| `identifier.ts` | `blockIdentifierFrom`, over bytes the caller supplies, and the two identifier spellings a cross-reference names - an outline node's and an artifact's                                      |
| `canonical.ts`  | `canonicalise`, whose output is what a caller hashes into `content_hash`                                                                                                                   |
| `migrate.ts`    | The migration chain, applied on read, and the quarantine for content that will not parse                                                                                                   |
| `mapping.ts`    | One row per node and per mark, naming what it becomes in Word and in tagged PDF                                                                                                            |
| `fixtures/v1/`  | Stored content at schema version 1, never deleted                                                                                                                                          |

**Four properties, because each is a decision rather than an implementation detail.**

**The root's members are closed.** A component's content carries the schema version it was written
against, its own title, its base language, its base direction, and its blocks. Adding a member is a
schema version with a migration and a fixture, not a configuration option.

**Every document goes through `parseContentDocument`.** Eleven rules live there rather than in the
schema, because each is a property of a document rather than of a node: every block's, footnote's
and cross-reference's identifier, a footnote's paragraphs included, is unique within the component;
two adjacent empty paragraphs are refused while one is admitted; a footnote's content is paragraphs
holding no image and no footnote; a cross-reference in a section title targets an outline node alone,
where one in a component may target anything, a node included; a
mark identifier carries one value, over one contiguous range of runs; a sequence of inline
content comes back with its runs merged; a `term` stands only on a definition list's item and holds
visible text where it is there at all; a start and a numbering stand only on an ordered list; and a
list starts at 0 only where its numbering is decimal (CNT-153).
The identifiers, the footnote's list and where a cross-reference may point are checked in one walk
over inline content, `checkInlineContent`, sharing one set of claimed identifiers with the walk over
the blocks; adjacency is checked in every sequence of blocks either reaches - the top level, a list
item, a blockquote, a table cell and a footnote - as admission's normalise collapses it in each. A
section title runs the same walk, where a cross-reference targets an outline node and nothing else,
and shows a number or a page, never a title, so resolving a title cannot loop. A footnote's
paragraphs hold no footnote, so the walk descends one footnote deep and stops. The walk returns what
it parsed - a footnote's paragraphs with the defaults the parse fills in everywhere else - and that
is what is stored and digested, in a component and in a section title alike, so two spellings of one
footnote are one version. Every identifier the walk claims, and the block a target names, is refused
unless it is already in NFC, the form the digest is taken over.

**One visible text carrying one set of marks is one run.** The same walk drops a run holding no text
and joins two adjacent runs whose marks are equal, so a text has one stored spelling and one digest
wherever it is stored - a paragraph, a blockquote's attribution, a table's note, a footnote's
paragraphs, a section title. "Equal" is equal in the canonical form: the mark arrays go through the
marks-as-a-set rule the digest already sorts by and are then compared member by member, a mark's
identifier included, so `[emphasis, language]` and `[language, emphasis]` merge while two links, or
two annotations of one type, do not. No identifier survives at another's expense, because the two
mark sets that merge are one value; the merged run keeps the first run's array as it stands. The
merge is in the walk rather than in `canonicalise`, which returns a string and would have left the
stored spelling split while only the digest agreed - and would have missed a section title, whose
canonical form the outline composes itself. A run's value is put in NFC on the way in and again
after a join, because two strings each in NFC need not join into one, and a join the digest reads
differently from what is stored would be the same defect by another door. Text is normalised where
an identifier is refused: an identifier is compared and resolved by exact string, so folding one
would change what it names.

**A mark identifier names one annotation, and only one.** Within one scope - a component, or a
section title, which is in no component - an identifier carries exactly one value: one kind and one
set of attributes. A `language` mark `m1` reading `fr-FR` on one run and `de-DE` on another is two
annotations wearing one identifier, and the parse refuses that document by name, saying which
identifier and that it carries two values, with no word of the author's text in the message. An
identifier worn by two different kinds of mark is refused for the same reason: CNT-005 makes
accepting or rejecting an annotation one operation over every fragment of that identifier, which
means nothing when the identifier names two. The value compared is the mark's canonical form, the
same string the digest is taken over, and the identifier is keyed in NFC, because the canonical form
folds its two spellings into one. Refusing was the reversible direction: nothing had stored a mark,
so admitting more later needs no migration, while admitting it then could never have been tightened.
What the rule protects is the fragmented annotation itself - one identifier on many runs, all
reading alike, is exactly what CNT-004 asks for and is accepted.

**And it covers one range, not two.** The runs carrying one identifier are contiguous in document
order: once an identifier has appeared and a later text run does not carry it, it may not appear
again in that scope, and the parse says which identifier covers two separate ranges, again with no
word of the author's text. One annotation in two visually separate pieces would resolve in two
places an author never joined, and the editor reaches it by the shortest route there is - mark a
phrase, then press the same button over a word in the middle. Only a text run closes an identifier,
so the runs one edit splits an annotation into all carry it, a block boundary and an empty paragraph
break nothing, and a node that is not a run - an equation, a cross-reference - carries no marks and
leaves an annotation whole. A footnote's content is a range of its own, so its anchor never breaks
an annotation it stands in and an identifier cannot reach from the main text into the note.

The editor is written to the same predicate and holds it after **every** transaction rather than
inside each command, in `annotationsInOnePiece`: an annotation left in two pieces has its later
pieces renamed, whatever split it, and the first piece keeps the identifier so that text nobody
touched is not renamed. A plugin rather than a command, because the gestures that split an
annotation are not all commands - typing one character at the end of a language run is not one, and
the mark is not inclusive, so the typed run carries no mark and stands between two pieces. Within a
mark type, then, an editing session cannot reach this refusal. What the refusal still stands
between a version and is content from somewhere else - another producer, a future import - and the
two cases the plugin leaves out on purpose: one identifier worn by two kinds of mark, which the
value rule above answers and no command can mint, and a document handed to `createEditorState`
already in two pieces, which nothing produces and which the plugin leaves alone until the first
edit.

**What the parse accepts, it accepts again unchanged.** The walk returns something other than what
it was given, so every rule about a sequence is judged on what that sequence became: CNT-023's
adjacency runs over the blocks the walk returned, not over the blocks that arrived, because a
paragraph holding one empty run is an empty paragraph once the run is dropped. Judged the other way
round, two of them would be accepted at the door, stored, and refused on read-back - a version an
author could never cut. A test parses every fixture and every awkward shape twice and compares.

**And nothing is parsed deeper than admission would admit.** `exceedsLimits` - admission's own
depth, breadth and size guard - runs at the top of `parseContentDocument`, **before** the schema
parse, and iteratively rather than recursively, so a document built to exhaust the call stack is
refused by name instead of crashing inside the parse it would otherwise recurse into. Until lists
there was nothing nested enough for it to matter and the guard ran on a paste alone, while an
editing session saved through this function with nothing upstream measuring its depth. The limit is
a JSON depth (128) rather than a number of list levels, which is honest about what is measured and
useless to an author who reaches it - [#159](https://github.com/kenhayward/alloy-works/issues/159)
is that gap, and it now carries a second half: the publishing engine's own JSON reader stops one
level below where this guard does, so there is a window where content stores and can never publish.

**One start rule, asked by both sides.** `startsOutsideItsNumbering` in `blocks.ts` says a list
counting in letters or roman numerals may not start at 0, and it is exported rather than copied:
`checkBlock` asks it on the way in and `assemble` asks it again at publish time as a backstop, with a
test on each side so the tie is a test rather than a convention. The stored shape keeps `start` at 0
or more, because narrowing an insert-only shape can never be taken back, so the rule is a narrowing
in the walk - which reaches every producer, an import and a future API client included, rather than
only the author in front of the editor.

**Migration is a read-time projection and never a rewrite.** Version rows take inserts only and
`content_hash` is the hash of what was written, so migrating stored content would either invalidate
its hash or need a version row nobody authored. The stored bytes never change. With one schema version
the chain is empty; the chain, the fixture directory and the test that walks every fixture to current
exist anyway, because the first schema change is when a chain nobody built is found to be missing.

**No node exists without a way out.** `mapping.ts` carries a row for every block, inline node and mark,
and a test fails when a type has no row or a row has a blank cell. A cell that cannot be filled is a
finding about the node rather than a comment in the file.

**Randomness is not here either, for the same reason hashing is not.** `blockIdentifierFrom` spells
sixteen bytes it is given; where those bytes come from is the caller's platform, so `packages/editor`
passes `crypto.getRandomValues` and `packages/db` passes `node:crypto`'s `randomBytes`. Both spell an
identifier the same way because there is one function that spells one, and one test holds the spelling.

Hashing is deliberately not here. `canonicalise` returns a string and the caller hashes it, because
`node:crypto` is not platform-free and `crypto.subtle` would make parsing async for nothing. The
canonical rules and the migration chain themselves live in `packages/domain/src/stored/`, shared
with the metadata definitions; `canonicalise` names `marks` as the one member whose array is a set.
The whole version's serialisation is `packages/domain/src/version/`, and the hashing of it and of
content is `packages/db/src/version-digest.ts`.

**A document's outline is not content, and has a module of its own**: `packages/domain/src/structure/`,
beside `content/model/` and built on it - a section title is the content model's inline content, and
the outline's canonical form reuses the content model's marks-as-a-set rule for that title and for
nothing else. It is described under [the document and its outline](#the-document-and-its-outline).

**The content model spike's schema still stands beside this one**, in `packages/domain/src/content/`,
with `compare.ts`, `resolve.ts`, `binding.ts`, the OOXML reader and writer, and the four gate-case
tests that are the evidence ADR-0005 rests on. Retiring it, and moving the OOXML pair out of this
package as `design/content-model.md` requires, is a later plan's work - named in
[`plans/README.md`](plans/README.md) so it is a debt rather than a surprise.

## The admission pipeline

`packages/domain/src/content/admission/` is the one way content enters a component from outside it - a
paste, a copy from another component, and later an import - designed in
[`design/content-model.md`](design/content-model.md), "The admission boundary". The editor pastes through it
([editor 7](plans/2026-09-22-editor-07-paste.md)), from the product's own clipboard or from
`packages/readers`, which reads plain text and HTML - a web page, Word and Google Docs - into the
pipeline's input on parse5. A reader removes nothing hostile itself: it hands a script, an embedded
object, an event handler, a style and a link's target over in the pipeline's own vocabulary, so
sanitising happens once. Markdown is read only when an author asks, by **Paste as Markdown**:
`@alloy-works/readers/markdown` renders it with markdown-it and reads the result as HTML, and is an
entry point of its own so the renderer loads it, as a chunk of about 100 KB, on the first press. A
reader of a Word file is a later plan.

| File            | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.ts`     | The entries every stage appends, with fixed messages; what arrived travels in `detail`, never in a message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `limits.ts`     | The provisional limits one admission is held to, measured without recursion before any stage walks the content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mathml.ts`     | A strict reader of an equation's MathML, an allowlist of MathML Core, the one form it is written back in, and the check validation makes against it; `equationAlternative`, the root's `alttext` read back by the same parser, and `withAlternative`, which sets or removes it and writes the reader's form (equations 1); `drawsNothing`, whether an equation has no token anywhere that shows, the one rule the dialog and a publish both refuse an equation by (the final review of equations 2)                                                                                                                                                                                                                                                                        |
| `temml.ts`      | `admitTemmlMathml` (equations 1): Temml's output read with the reader's own parser and rewritten before the unchanged reader judges it - an overline or underline `menclose` made a `mover` or `munder` with a stretchy line, alignment classes made `columnalign` - and refused, with a reason the dialog words, where the reader would lose something: any other enclosure, `\boxed`, `\cancelto`, a filled `\rule` and a raised or lowered box (`mpadded`'s `voffset`) by the command, an equation number Temml drew, a line break marked outside an environment, content the reader removes, or an equation that draws nothing (`drawsNothing`). Temml's real output is kept as fixtures in `temml.fixture.ts`, outside the build; the domain does not depend on Temml |
| `sanitise.ts`   | Scripts, embedded objects, event handlers, links whose scheme is not allowlisted, executable formatting, MathML                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `migrate.ts`    | Content at an earlier schema version brought to current through content's own chain, or refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `normalise.ts`  | Formatting dropped, NFC, empty runs and adjacent empty paragraphs removed, the source's language kept as a mark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `reidentify.ts` | A new identifier for every block, footnote, cross-reference and mark, a copied cross-reference pointed at the copy of a block that travelled with it - and left as it stands where its block did not travel or where the block's old identifier arrived on two blocks in one paste, which makes it ambiguous, counted in the report as kept where the receiving component does not hold its target; nothing allocated that the receiver or the paste already names, as an identifier or a `block` target; comments, suggestions and conditions without an axis dropped                                                                                                                                                                                                     |
| `admit.ts`      | The stages in order, validation last, and the outcome: blocks, the report and `renamed` - each block's and footnote's new identifier by the one it arrived with, leaving out one that arrived twice - or a named refusal and the report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `clipboard.ts`  | The product's own clipboard format, written on copy and read on paste                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Four properties, because each is a decision rather than an implementation detail.**

**One pipeline, and it does not know the source.** A reader turns its format into untrusted JSON, using a
fixed vocabulary for what the pipeline removes, and never removes it itself; a copy within the product and
a foreign paste are therefore reported to one standard. Anything inside the content that no stage knows is
refused by validation, with the whole admission - the candidate's root contributes only its content,
schema version, language and direction, so any other root member (a stray `title`, say) is dropped in
silence rather than refused.

**The report comes back with the content.** Every stage that discards or rewrites appends to it, and a
refusal returns it too, ending with why. Messages are fixed strings; content is never interpolated into one.

**An outcome, never an exception, and never part of the content.** Either every block that survived,
validated as a whole under the receiving component's root, or a named refusal and nothing.

**MathML is the one markup this package reads.** An equation is rendered as markup, so it is the one string
a script could hide in. The reader refuses rather than guesses, and writes every combining mark as a
reference so that NFC cannot fuse one with a tag. Validation asks the same reader: `parseContentDocument`
refuses an equation whose MathML the reader would not keep exactly as it stands, so content that reaches
validation without passing through admission meets the same rule, and there is no second description of
the form to drift from the first.

## Metadata

`packages/domain/src/metadata/` holds the rules that decide which fields apply to a component, what
makes a value valid, and what a version records about the definitions it was written against, designed
in [`design/metadata.md`](design/metadata.md). They are pure functions over definition payloads a
caller hands in. One definition is stored - the component type migration 0015 gives every environment -
and creating a component and cutting a version each resolve its fields and apply every default through
`carryForward`; `GET /v1/spaces/{space}/component-types` lists the types an environment holds. Nothing
else makes, changes or assigns a definition, no route carries a value, and no panel shows one.

| File                  | Holds                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lexical.ts`          | The forms a value takes: a decimal as a canonical string, a date, a time, a date and time with its offset                              |
| `definition.ts`       | The definition schema version every field, schema and component type records                                                           |
| `field.ts`            | Seven closed data types, and the field definition. No `pattern` yet                                                                    |
| `schema.ts`           | The metadata schema definition, and `checkSchema`, which checks each default against its field                                         |
| `component-type.ts`   | The component type definition, whose assignments name a schema and the fields they require                                             |
| `migrate.ts`          | The migration chain per definition kind, applied on read, and `readDefinition`'s report                                                |
| `failure.ts`          | `MetadataFailure`, its stable `code` and the rule union, and `failure()` to build one - the shape the service's error shape will carry |
| `check-value.ts`      | `checkValue(field, value)`: the field's own rules, and nothing else                                                                    |
| `values.ts`           | `MetadataValues`, `hasMember`, `isClear`, `isUserValue` and `sameValue` - the value-shape rules the rest of the package shares         |
| `resolve.ts`          | `resolveComponentFields`, and the error a default it cannot use throws - disagreeing, or refused by its field                          |
| `check-assignment.ts` | `checkAssignment`: a stray `requires`, and a default that disagrees with one already assigned                                          |
| `validate.ts`         | `validate(effective, values)`: every failure, each naming the schemas behind a schema's rule                                           |
| `users.ts`            | `checkUserValues` over a lookup the service supplies, and `principalIdsIn` to load it in one query                                     |
| `carry.ts`            | `carryForward`: what the next version holds, and `notCarried`                                                                          |
| `record.ts`           | `definitionsFor`, and the canonical form of values and `notCarried` in the version digest                                              |
| `fixtures/v1/`        | Stored definitions at definition schema version 1, never deleted                                                                       |

The canonical form and the migration chain both rest on `packages/domain/src/stored/`, shared with the
content model - see [above](#the-content-model).

**Four properties, because each is a decision rather than an implementation detail.**

**A value is valid or not by its field alone.** `checkValue` takes the field and the value. The two
rules a schema imposes - required and fixed - are `validate`'s, and name every schema that imposed
them; checking that a user value names somebody needs the directory, so it is `checkUserValues`, apart
from `validate`, which runs at publish with no directory to hand.

**A number is the string entered.** It is valid only in canonical form - no leading zeros, no trailing
fractional zeros - and `canonicaliseDecimal` is how a caller gets there. Comparison is exact, so a bound
of `9007199254740993` means that number and not its nearest float.

**Carrying forward never changes a value that is present.** No member and a clear are different: only
a field with no member takes a default, so a clear survives, and a present value on a fixed field that
differs from its default stays for `validate` to name rather than being replaced.

**Definitions are read the way content is.** Every payload records its definition schema version and is
migrated on read, never on write, through the chain `packages/domain/src/stored/` now provides to
content and definitions alike, beside the canonical rules both serialise with.

`pattern` does not exist yet: metadata.md's open question on bounding its backtracking is unanswered,
and the field definition refuses one.

## The version chain

`packages/db` holds the permanent record every versioned thing is kept in, designed in
[`design/storage-and-versioning.md`](design/storage-and-versioning.md) under
[ADR-0024](decisions/0024-a-version-digest-over-the-whole-version.md). Five tenant migrations and the
functions that write the chain, each taking the transaction `withTenant` opened. Creating a component
inserts its first version and the editing session cuts the rest (see
[the editor and its session](#the-editor-and-its-session)); creating a document inserts its first
version and each structural act records the next (see
[the document and its outline](#the-document-and-its-outline)); there is no revision and no baseline.

| Where                                                    | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/tenant/0007_spaces_and_artifacts`            | `space`, name unique in the tenant; `artifact`, an id and a kind, in exactly one space for a component and in none for a field, schema or type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `migrations/tenant/0008_version_chain`                   | `artifact_version` - numbers, author, time, note, schema version, content, values, what was not carried, the type, both digests - and `version_definition`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `migrations/tenant/0015_component_types`                 | The component type every environment starts with, _Topic_; `component_type_default`, one row, declaring it; and an author nullable for a definition alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `migrations/tenant/0016_documents`                       | `document` as a kind in `artifact_kind_check`, in exactly one space by `artifact_space_by_kind`, and required to have an author by `artifact_version_component_author`; no new table                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `migrations/tenant/0018_layouts`                         | `layout` as a kind in `artifact_kind_check`, in no space, unauthored, and one seeded version of the product's default (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `migrations/tenant/0020_assets`                          | `asset` as a kind of artifact, in exactly one space and authored; `asset_upload`, made and then moved forwards only, never deleted (see [assets](#assets))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `migrations/tenant/0019_default_layout_lists`            | The default layout's version 0.2, at layout schema 2 with a list of tables, inserted only where the environment's layout is still the unchanged 0.1 that 0018 seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `migrations/tenant/0021_default_layout_figures`          | The default layout's version 0.3, listing figures before tables, inserted only where the environment's layout is still the unchanged 0.2 that 0019 seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `migrations/tenant/0022_publication_assets`              | `publication_request_asset` and `publication_asset`, the images a request resolved and a publication printed, insert-only; and 0018's whole-record check holding them too (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `migrations/tenant/0023_default_layout_relative_words`   | The default layout's version 0.4, at layout schema 3 with the words _above_ and _below_, inserted only where the environment's layout is still the unchanged 0.3 that 0021 seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `migrations/tenant/0024_themes`                          | `theme` and `catalogue` as kinds, in no space and unauthored; the default theme's six catalogues and the theme seeded as one version each, and `theme_default` declaring it (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `migrations/tenant/0025_table_and_image_styles`          | The default theme's 0.2 - its paragraph, table and image catalogues at `catalogue/2` and the theme naming them - and the default layout's 0.5 at layout schema 4, each inserted only where its own chain is still the product's unchanged version before (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                  |
| `migrations/tenant/0026_word`                            | The default theme's 0.3, STIX Two Math declaring Cambria Math as its Word face, inserted only where the theme is still 0025's unchanged 0.2 (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `migrations/tenant/0027_word_layout_and_outputs`         | The default layout's 0.6 at layout schema 5, with a Word page, inserted only where the layout is still 0025's unchanged 0.5; and a publication's formats, its engine and template null without a PDF, and one output per format with its producer and report (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                              |
| `migrations/tenant/0028_templates`                       | `template` as a kind, in exactly one space, whose versions are authored ([templates.md](design/templates.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `migrations/tenant/0029_document_template`               | A document version's metadata values, and `document_template`, insert-only, naming the template version a document was made from ([templates.md](design/templates.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `migrations/tenant/0030_definition_names`                | `definition_name`, one folded name per field, schema and component type, unique per kind (MET-031), filled from every definition's latest version ([definitions.md](design/definitions.md))                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `migrations/tenant/0031_search`                          | Search's projection, `search_entry` and `search_text`, made whole by the migration runner in the run that applies it (see [Search](#search))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `migrations/tenant/0032_listing_snapshot`                | `written_by`, the writing transaction, on every version and publication written from now on, which a listing's snapshot reads (see [Listings](#listings))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `migrations/tenant/0033_idempotency`                     | `idempotency_record`, a mutating request's answer against its principal's idempotency key, kept a day (see [Idempotency](#idempotency))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `migrations/tenant/0034_default_theme_choices`           | The default theme's 0.4, adding Lead, Centred, Small print, Banded and Half width to its paragraph, table and image catalogues, each inserted only where its own chain is still the product's unchanged version before it (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                 |
| `migrations/tenant/0035_previews`                        | A request's kind, `publish` or `preview`, and a done preview's PDF and expiry on its request; the default layout's 0.7 at layout schema 6, with the words a preview says, inserted only where the layout is still 0027's unchanged 0.6 (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                    |
| `migrations/tenant/0036_preview_sweep`                   | The runtime role may delete a request, and a trigger lets it delete only a preview an hour after it finished, its versions and images going with it (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `migrations/tenant/0037_iteration_retention`             | `editing_policy`, the tenant's window for keeping iterations; `iteration.expires_at` dropped; the runtime role may delete an iteration, and a trigger lets it delete only one past its window after the next cut (see [the editor and its session](#the-editor-and-its-session))                                                                                                                                                                                                                                                                                                                                                          |
| `migrations/tenant/0038_api_tokens`                      | `api_token`, a personal token kept as its hash, its scopes a subset of the closed permission set without `read`, and an expiry at most 365 days after it was made; the runtime role inserts the named columns, updates `last_used_at` alone and deletes (see [Personal tokens](#personal-tokens))                                                                                                                                                                                                                                                                                                                                         |
| `migrations/tenant/0039_groups`                          | `identity_provider.groups_claim`, the ID token claim carrying the provider's group values, `groups` unless configured; a group's grants deleted with it; a change to `access_policy.external_cap_days` taking the epoch, since every decision reads it; a provider value never empty; the runtime role's delete on `group_member` and `access_group` stated (see [Groups](#groups))                                                                                                                                                                                                                                                       |
| `migrations/tenant/0040_publication_check`               | `publication_check`, what veraPDF found of a publication's PDF against PDF/UA-1: its version, compliant or not and each rule failed, and its whole report's key, digest and size in the tenant's store, one per PDF output, insert-only for the runtime role and timed by the database (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                    |
| `migrations/tenant/0041_publication_check_given_up`      | `publication_check_given_up`, a publication's PDF whose checks gave up three times, which the check sweep left and recorded, with how many had, one per PDF output, insert-only for the runtime role and timed by the database (see [publishing](#publishing))                                                                                                                                                                                                                                                                                                                                                                            |
| `migrations/tenant/0042_sealed_sign_in_secret`           | `identity_provider.sealed_secret`, the environment's sign-in client secret sealed by `packages/db`'s `seal.ts` with the service's sealing key, bound to the tenant and to sign-in, so it opens for no other environment and as no other kind of secret; `secret_name` kept, nullable, for a row configured before, which signs nobody in until it is configured again; exactly one of the two, and a sealed secret shaped like one (issue #312)                                                                                                                                                                                           |
| `migrations/tenant/0043_default_theme_caption_placement` | The default theme's 0.5 (W14.5): the table and image catalogues' fourth versions at `catalogue/3`, each 0.4's with its captions where they always stood, and the theme naming them, on 0034's guard                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/version-digest.ts`                                  | `versionDigests`: SHA-256 over `canonicaliseVersionContent` and `canonicaliseVersion` from the domain package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/spaces.ts`                                          | `createSpace`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/versions.ts`                                        | `createArtifact` at `0.1`, `readVersion`, `latestVersion`, `versionContents` - each version's content and number, for the texts route - `listVersions` - an artifact's versions newest first, by keyset over `(revision_no, version_no)` with no snapshot, since the chain is append-only (W9.4) - `substanceOf`, and `recordVersion`, each taking a component, a document, a definition or a layout; `createArtifact` refuses a layout, a theme and a catalogue, which only their migrations make, and `recordVersion` a theme and a catalogue, whose versions `themes.ts` reads whole before it writes them through `recordReadVersion` |
| `src/load/`                                              | The load test, outside `pnpm test`: `pnpm --filter @alloy-works/db test:load`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Four properties, because each is a decision rather than an implementation detail.**

**Insert-only is a grant.** The tenant's runtime role holds `INSERT` and `SELECT` on `artifact_version`
and `version_definition` and nothing else, and no `UPDATE` on `artifact`; a test attempts each refused
statement as that role. A correction is another version.

**Two digests, each with one meaning.** The version digest is over the whole version - content, type,
values, what was not carried, and the definitions as a set - and decides whether a version changed:
`recordVersion` answers `version.unchanged` rather than inserting a version that says nothing new. The
content hash is over content alone and will key derived data. Authorship is in neither. Both are
recomputable from a row read back, by `versionDigests(substanceOf(row))`.

**The database checks the shape of what a version records, not its substance.** It checks that a
version's kind is its artifact's; that only a component records a component type or carries values,
held as an object and a list; that its schema version is its content's; that each recorded
definition's kind, identifier and version are exactly a stored definition version's, by a composite
foreign key; and that a component's type is the component type version it records among those
definitions, by a key checked at commit (`artifact_version_component_type_recorded`). It does not
check the content against the content model, that a definition's payload `id` is its artifact's id,
that every identifier is spelled as a lower-case hyphenated UUID, or that the digests match the row:
`createArtifact` and `recordVersion` do those before they write, and anybody holding the row can
recompute the digests. **One gap is named rather than closed:** nothing refuses a later transaction
inserting a `version_definition` row against a version already cut. The version digest detects it, since
the definitions are part of what it covers, but nothing prevents it; refusing it would take a trigger,
which the plan's decision 5 disfavours. storage-and-versioning.md names the same gap beside VER-008 and
VER-042.

**Content is inline JSONB, and was measured before it was built on.** The load test's volumes,
thresholds and result are in [the plan](plans/2026-09-15-storage-01-the-version-chain.md), task 5.
Content is stored as parsed and never rewritten; migration stays a projection on read.

## Access

Who may do what to which artifact, designed in [`design/access.md`](design/access.md): a pure decision in
`packages/domain/src/access/`, the stores and the facts it reads in `packages/db`, and a route helper in
`apps/service` that checks what each route declares. Grants are listed, made and removed through routes,
and the access panel in `apps/web` calls them, on a component, a document or a template and, from
Administration, on a space or the environment (W12.4, GP-E); roles, people and, to an administrator of the
environment, groups are listed to choose from, and an administrator of the environment invites an address
there, so somebody can be granted access before they first sign in. Groups are made, filled and deleted
in Administration's Groups. Nothing manages a role or a principal's kind.

| Where                                            | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain: access/permissions.ts`                  | The ten permissions, closed; what an external principal is capped at; a principal's kinds                                                                                                                                                                                                                                                                                                                                                                                |
| `domain: access/role.ts`                         | `checkRole`, `allowable` - only a role holding `read` may be allowed - and the nine roles a tenant starts with - Editing for denials, and Publisher, alone holding `publish`, added by 0017                                                                                                                                                                                                                                                                              |
| `domain: access/level.ts`                        | The tenant, a space or an artifact, and how a route's `target` spells one                                                                                                                                                                                                                                                                                                                                                                                                |
| `domain: access/decide.ts`                       | `decide(permission, facts)`: the answer, the deciding level, the grants that decided and every level looked at; a request's token scopes in the facts refuse an allowed permission outside them as `scoped`, reading never                                                                                                                                                                                                                                               |
| `domain: access/readable.ts`                     | `readableSet`: the tenant flag, spaces, exclusions and inclusions a listing's query holds, computed by `decide`                                                                                                                                                                                                                                                                                                                                                          |
| `db: migrations/tenant/0009_access`              | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, and starting rows                                                                                                                                                                                                                                                                                                                                             |
| `db: migrations/tenant/0010_access_epoch`        | `access_epoch`, and the triggers that lock it on every write to a fact a decision reads                                                                                                                                                                                                                                                                                                                                                                                  |
| `db: migrations/tenant/0011_first_administrator` | `first_administrator`: namings by issuer and subject, kept as the record; nothing names or claims one any more                                                                                                                                                                                                                                                                                                                                                           |
| `db: migrations/tenant/0014_invitations`         | An invitation per row, each with the principal it made; a principal's issuer and subject optional; `principal.email_verified`; the runtime role writing only the invitation columns the service needs, never `named_by`                                                                                                                                                                                                                                                  |
| `db: src/invitations.ts`                         | `invite`, `withdrawInvitation`, `listInvitations` and `readInvitation`, and `claimInvitation`, called in a sign-in through either route that found no principal. `inviteToTenant` (`src/sign-in.ts`) is the operator's invitation, with no expiry                                                                                                                                                                                                                        |
| `db: src/roles.ts`, `groups.ts`, `grants.ts`     | `createRole`, `findRole`, `grant`, with the external rules where a grant is made; `createGroup`, `listGroups`, `readGroup`, `groupNames`, `setGroupMembers`, `addToGroup`, `deleteGroup` and `syncProviderGroups`                                                                                                                                                                                                                                                        |
| `db: src/access-facts.ts`                        | `loadFacts`, `loadFactsFor` (many artifacts from one read of the principal and the grants) and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to                                                                                                                                                                                                                                                                     |
| `db: migrations/tenant/0013_deciding_only`       | `access_changed()` again, refusing a change in a transaction that declared it only decides                                                                                                                                                                                                                                                                                                                                                                               |
| `db: src/grants.ts` (removing)                   | `removeGrant` under the lock-out guard, `administeringGrants` - what the guard counts - and `grantLevel`                                                                                                                                                                                                                                                                                                                                                                 |
| `db: src/access-listings.ts`                     | `listGrants` at one level, `readGrant`, `listRoles` and `listPrincipals`, each paged by id                                                                                                                                                                                                                                                                                                                                                                               |
| `db: src/first-administrator.ts`                 | `inviteFirstAdministrator`, run as a database administrator: an invitation whose principal holds Administrator at the tenant                                                                                                                                                                                                                                                                                                                                             |
| `api-contract: contract.ts`                      | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from; and `credential: 'session'` where it takes a session alone, never a token                                                                                                                                                                                                                                                                                       |
| `db: src/api-tokens.ts`                          | `issueApiToken`, `findApiToken` - by hash, unexpired, recording a use at most once a minute - `listApiTokens`, a person's own paged by id, and `revokeApiToken`, deleting one of a person's own                                                                                                                                                                                                                                                                          |
| `service: src/tokens.ts`                         | The token routes, the secret made and shown once, `bearerSecret`, what an `Authorization` header carries, and `administeredTokenHandlers`, an administrator's list and revoke                                                                                                                                                                                                                                                                                            |
| `service: src/managing-access.ts`                | The grants, roles and people routes; each refusal a 409 with an underscore code                                                                                                                                                                                                                                                                                                                                                                                          |
| `service: src/invitations.ts`                    | The invitations routes: listing, inviting or renewing, and withdrawing with the principal's grants                                                                                                                                                                                                                                                                                                                                                                       |
| `service: src/groups.ts`                         | The groups routes: listing with members, making the environment's own or a provider's, setting an own group's members, deleting with grants                                                                                                                                                                                                                                                                                                                              |
| `web: src/access/`                               | The access panel, `AccessPanel` with `at` - a component, document or template, a space or the environment - and its levels from there up: giving to a person, or to a group where `GET /v1/groups` answers, removing, an explanation per person naming a group by its name, and, to an administrator of the environment, inviting; `ManageAccessLink`, offered where `GET /v1/access` says administer, by `administersAt`, which Administration's Access buttons ask too |
| `web: src/admin/`                                | Administration: Access at each space and the environment in place of its section, and Groups - listed with source and members, made, an own group's members chosen, deleted after asking - with focus kept inside as a view or a row goes                                                                                                                                                                                                                                |
| `service: src/access.ts`                         | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in                                                                                                                                                                                                                                                                                                                                                   |

**Four properties, because each is a decision rather than an implementation detail.**

**Nothing is stored that could be computed.** `access_grant` is the only table that confers a permission,
and every decision reads the grants as they are, so a change to a role reaches every holder at the next
decision.

**The explanation is the decision.** `decide` returns the level and grants behind an answer, or the levels
it looked at, and the route helper reads `allowed` from the same value `GET /v1/access/explain` shows.
Each grant it shows carries `groupName`, the name of the group it came through or null for one made to the
person, read by `groupNames` in one statement under the same lock, so a view names the group (IAM-030).

**A check and its act are one unit, by a lock rather than by care.** Every decision takes `access_epoch`
`FOR SHARE` in the transaction of its act, and a trigger on every fact a decision reads takes it exclusively,
so a change to access waits for an act already authorised and an act begun after a change sees it. A test
holds the list of facts against the triggers.

**A change to access says so, or cannot happen.** A route declaring `changesAccess` takes the epoch
`FOR UPDATE` before it decides, so its decision never upgrades a shared lock into a deadlock; every other
permission-checked route marks its transaction as deciding only, and the epoch's trigger and
`lockAccessForChange` refuse a change there, so a route that forgets fails its first test rather than
deadlocking under load.

**Unreadable is absent.** A target the caller may not read answers 404 exactly as a missing one does; a
readable target refused answers 403 and names only the permission. `administer` is the one exception:
asked "at the target's level or above", a target the caller may administer from a level above is never
refused as unreadable on that account, `GET /v1/access/explain` included, because the walk that answers
it is not the ordinary nearest-level one that decided whether the target is readable in the first place.

**A token is a mask, never a grant.** A request made with a personal token is decided as its creator's,
and then refused, as `scoped`, any permission its scopes leave out; reading is never masked. The scopes
travel in the facts, so every decision taken for the request reads them (see
[Personal tokens](#personal-tokens)).

**An invitation is a principal before it is a person.** Inviting an address makes a principal with no issuer
and no subject, which grants name like any other, so every rule is applied where a grant is made. The first
sign-in through a permitted route whose provider verifies the address gives it an identity. Making or
claiming one changes no fact a decision reads and takes no epoch - neither sign-in route takes it -
while two invitations of one address take turns on an advisory lock keyed by the schema and the address,
which a first sign-in for a verified address takes too, before claiming and held through the principal it
makes when it claims nothing, and inviting the first administrator takes right after the epoch;
withdrawing one removes its grants, so it takes the epoch before the invitation's row, and a claim, which
takes the address's lock, the row and then the principal's and never the epoch, cannot deadlock against
it. The order throughout is: claim - address lock, invitation row, principal; invite - epoch `FOR SHARE`,
address lock, invitation row; first administrator - epoch `FOR UPDATE`, address lock, invitation rows,
principal; withdraw - epoch `FOR UPDATE`, invitation row, principal, never the address lock; grant -
epoch `FOR UPDATE`, then the principal it names. Because a claim
can commit while an invitation waits on its row, inviting asks again, after that lock, whether somebody has
signed in with the address; inviting the first administrator asks again, after each such lock, both that
and whether anybody administers the tenant.

`pnpm dev:setup` invites the stand-in's Ada, at `ada@example.com`, to administer both development
environments before either permits a sign-in, so she administers each from her first sign-in there.

### Groups

A group holds grants as a person does, and each of its members holds what the group is granted (W12.3,
access.md's [Groups and Access, as W12 builds them](design/access.md#groups-and-access-as-w12-builds-them),
GP-A to GP-D). Administration's Groups section manages them, and the access panel offers a group beside a
person to an administrator of the environment (W12.4, GP-E).

**Two kinds.** A group is the environment's own, whose members an administrator names, or stands for one
value of the organisation's provider's groups claim, whose members the sign-ins decide. A provider's
group cannot be filled by hand (`409 group_from_provider`), and a value is matched exactly.

**The claim.** `identity_provider.groups_claim`, `groups` unless `configureOrganisationSignIn` is given
another, names the ID token claim carrying the values. `oidc.ts` reads it from the ID token alone, under
`openid email profile` - no scope is ever asked for groups (IAM-044) - so a provider that puts groups
there only under a scope of its own must be configured to put them there. A list keeps its strings,
each once, and at most the first 1,000 of them (`MOST_GROUP_VALUES`), the rest ignored, so no claim is
too long for the statements that follow it; anything that is not a list is no groups (GP-B). The Google
route reads no claim for groups. Because the ID token now confers roles, `oidc.ts` checks its signature
against the keys the provider publishes, for both routes (`enableNonRepudiationChecks`), where
openid-client would otherwise trust the TLS connection to the token endpoint alone.

**An external member is held to the cap by the decision.** Nothing refuses a provider asserting an
external principal into a group whose grants reach further than a grant to them directly could, so
`decide` does: for an external principal, it reads no allow at the tenant, none with no expiry, and none
expiring later than the tenant's cap (`access_policy.external_cap_days`) from now, whatever path the
grant arrived by. The loaders read the cap into the facts, and 0039's `access_policy_cap_changed` takes
the epoch when it changes, as 0010's triggers do for every other fact.

**At an organisation sign-in**, `syncProviderGroups` brings the principal's memberships of provider
groups into line with the values: a value no group stands for is ignored, and no values removes every
provider membership. Only the memberships that differ are added or removed, and only when there are some
is the epoch taken, so a sign-in with nothing changed takes no lock that a decision would wait on; each
membership the claim still carries has `asserted_at` brought up to now, which no trigger watches. It runs
in the transaction that writes the session, before the session, not the one that finds or claims the
principal: a claim holds an invitation's row, which a withdrawal takes after the epoch, so the two in one
transaction could wait on each other. The Google route changes no membership.

**The routes**, each needing `administer` at the tenant:

| Route                         | What                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/groups`              | Every group, paged by id, each with its source, its provider value and its members by name                                                                                                    |
| `POST /v1/groups`             | `{ name, providerValue? }`: a name of 1 to 80 characters, trimmed, and a value of 1 to 256 kept exactly; `409 group_name_taken` or `group_value_taken`. Changes no access                     |
| `PUT /v1/groups/{id}/members` | `{ principals }`: an own group's members, exactly those named, only the differences written; `409 group_from_provider`, `group_member_missing`, or an external rule a direct grant is held to |
| `DELETE /v1/groups/{id}`      | Deletes a group of either kind with its memberships and every grant it holds, by its keys' cascades (0039); `404` for one that is not there                                                   |

The last two declare `changesAccess`. **A grant may name a group**: `POST /v1/grants` takes `subject:
{ group }` beside `{ principal }`, under the same rules. The lock-out guard still counts direct grants
alone, so neither removing a member nor deleting a group is ever refused by it.

**The stand-in** asserts `groups` in the ID token under the `openid` scope, as `hd` rides there, and never
at userinfo, so a client reading them anywhere else finds none: Ada is in `authors`, Grace in `authors`
and `publishers`, Alice and Ivy in none. Told `signsWithUnpublishedKey`, it publishes a key other than the
one it signs with, so a test can show a forged ID token refused. A user's groups are read at each
sign-in, so a test holding the user can move them between two.

### Personal tokens

A person issues themselves a token for a script (W12.1, [ADR-0028](decisions/0028-personal-api-tokens-in-t1.md),
service-foundations.md's TK-A to TK-F). It acts as them, can do no more than they may, can be limited to
less, and expires. An administrator of the environment lists and revokes anybody's (W12.2, TK-E), and
both are done from the renderer: API tokens from the account chip, and Tokens on a person in
Administration's People.

**The request path.** For every route that checks anything, the hook reads `Authorization` before the
cookie. Only the `Bearer` scheme, in any case, is a credential of ours: a header naming any other -
`Basic` from a reverse proxy in front, `Negotiate` - is passed over, and the cookie decides. A `Bearer`
header must be `Bearer awt_` and 43 base64url characters, or the request is `401 unauthenticated`,
whatever cookie it also carries. The secret is hashed with SHA-256 and looked up in `api_token` inside
`withTenant`, joined to its principal and unexpired; not found, revoked or expired is `401
unauthenticated`, and a token issued by another environment is simply not there. Found, it records the
use when the last is more than a minute old, and sets `request.principal` and `request.credential = {
kind: 'token', scopes }`. Without the header, the session cookie is read as before, and
`request.credential` is `{ kind: 'session' }`.

**Session-only routes.** A route declaring `credential: 'session'` refuses a found token `403
token_not_allowed`: signing out, the event stream, the five token routes, and `POST /v1/samples`, the
development sample, which writes a row and queues a job. The token is looked up first, so one revoked or
from another environment is still `401` there. A stolen token cannot mint a successor, and no stream is
held open on a token after it is revoked. The published document says the same: those operations take
the `session` scheme, and every other authenticated one `session` or `token`, an HTTP bearer.

**The mask, in every decision.** `authorise` adds the request's scopes to the facts it loads, so the
route's decision and every decision its handler takes from `Authorised.facts` are masked: `mayEdit` on a
component, `mayEdit` and `mayPublish` on a document and in the outline's answers, `mayDesign` on a
template, `GET /v1/access`, and `administer` "at its level or above". `authoriseAt` takes a `Caller`,
the principal and the scopes, for a level a handler finds for itself (an upload's space, a preview's
document); `putAssetUploadBytes` decides `create` on the upload's space through it, so a token without
`create` cannot fill an upload its creator's session began. The texts route masks each component's
`mayEdit` with the document's scopes, since `loadFactsFor` reads no request; `listSpacesFor` takes the
scopes for `mayCreate`, a parameter every caller must pass, `undefined` for a session. What is not
masked, by TK-B: the read gate in `authorise`, `POST /v1/documents/{id}/previews`, which is decided on
`read` (PV-B), so a token with no scopes may ask for a preview, the readable sets behind search and
listings, a template or component read on a document's behalf, and `GET /v1/access/explain`, which
explains another principal's grants rather than this request's. A scope never lifts a refusal: `denied`,
`not_granted` and `capped` keep their reasons, and `scoped` masks only an allow.

**The routes**, each taking a session alone. The first three are the caller's own, and decide no
permission; the last two are an administrator's, each deciding `administer` at the tenant. They are
routes of their own rather than the owner's widened, so each declares the one decision it takes, and the
access, cross-tenant and listing harnesses hold each to it:

| Route                                       | What                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/tokens`                            | The caller's tokens, paged by id: name, scopes, created, expires and last used; never a secret or a hash                                                                                                                                                                                                                                                                          |
| `POST /v1/tokens`                           | `{ name, scopes, expiresAt }`: a name of 1 to 80 characters, trimmed; scopes from the closed set without `read`, each once, else `400`; an expiry required, and `400 token_expiry_invalid` unless it is after the transaction's clock and at most 365 days past it. Answers the token and `secret`, `awt_` and 32 random bytes as base64url, once, with `Cache-Control: no-store` |
| `DELETE /v1/tokens/{id}`                    | Revokes one of the caller's own by deleting its row: `204`, and the next request with it is `401`. Anybody else's is `404`                                                                                                                                                                                                                                                        |
| `GET /v1/principals/{id}/tokens`            | A person's tokens, for an administrator, paged by id as the caller's own are: never a secret or a hash. A person the environment does not hold, another environment's among them, is `404`                                                                                                                                                                                        |
| `DELETE /v1/principals/{id}/tokens/{token}` | Revokes that person's token, for an administrator: `200 { revoked }`, as removing a grant and withdrawing an invitation answer, and the next request with it is `401`. A token that is not that person's is `404`                                                                                                                                                                 |

**What is kept.** Only the hash, in the tenant's schema. The secret is in the one answer that issues it and
nowhere else: the request log never writes a header, and a test holds the log lines of a token issued,
used, refused and revoked to having no `awt_` in them. `POST /v1/tokens` takes no idempotency key,
because a kept answer would keep the secret for a day; a retry issues a second token, which its owner can
see and revoke. A principal removed takes their tokens with them.

**On the page.** `apps/web/src/account/`: `ApiTokens`, a modal from the account chip, lists the person's
tokens - their name, what each may do in the access page's words, reading first, its expiry and its last
use or `never` - and holds New token, a dialog opened beside it rather than inside it, so it closes
alone: a name, the scopes as checkboxes, and the day it works until the start of, from tomorrow to a
year away, 90 days unless changed, sent as the start of that day. The form refuses a start more than
365 days of milliseconds from now, as the service does, and offers as its last the last day whose start
is not: a year from today, or the day before where the clocks go back once more than they go forward in
between and it is not yet an hour past midnight, when a year of calendar days is 365 days and an hour.
The list shows the expiry to the minute, under Works until, and what each may do under May do. The
answer's secret is shown in that dialog, with Copy, and lives in its state alone: never in
storage, the address or a log, and gone however the dialog closes. `TokenTable` is the list, each row
with Revoke, which asks first in a dialog of its own and keeps focus in the list once the row has gone;
Administration's People gives each person who has signed in a Tokens button showing theirs in it,
focus moving to their heading and back to the button, so it never falls out of the dialog. A
refusal is said in the service's own `message` where it gave one.

## The editor and its session

Opening a component, editing its paragraphs and saving them, designed in
[`design/component-editor.md`](design/component-editor.md) over
[`design/storage-and-versioning.md`](design/storage-and-versioning.md)'s iterations and
[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md)'s one view per component. A
component is created, opened, edited above and on the surface, and cut; its text is formatted, linked
and marked with a language from a toolbar or the keyboard; its paragraphs are made into bulleted,
numbered and definition lists, nested to any depth the content model admits, and into quotations and
preformatted text (editor 5: three nodes, `preformatted`, `blockquote` and `attribution`, the last
outside the `block` group as a term is; a **Preformatted text** panel in the `F6` ring; Enter and Tab
answered by the code-aware commands ahead of the list's in preformatted text), and figures (figures
2: an image uploaded through the **Figure** dialog and a **Figure** panel in the `F6` ring), footnotes
(footnotes 1), cross-references (cross-references 1: a `crossReference` atom placed and changed from
the **Reference** dialog, showing what it will print) and equations (equations 1: an `equation` atom
and an `equationBlock`, placed and changed from the **Equation** dialog and drawn as MathML). A
section's title is a second, smaller view (equations 3): `mountTitleEditor` over `titleSchema`, one
line of text and inline equations, mounted by the outline panel. A component holding anything else
opens for reading only. A component's values are edited in the **Fields** panel beside the surface
(W5.3, below), and an author's own iterations are read back and restored by Recovery (W11.2, below), and a reload replays the session's changes, undo and all
(W11.3, below). A paste reaches
the surface only through the admission pipeline (editor 7), and what it changed is listed in a
**Paste report** region in the `F6` ring.

| Where                                                               | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor: src/schema.ts`, `mapping.ts`                               | The editor's schema - the root, paragraphs, text, five list node types and ten of the model's thirteen marks - and `toEditor`, which refuses by name what the schema lacks, and `fromEditor`, through `parseContentDocument`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `editor: src/marks.ts`                                              | `EDITOR_COMMANDS`, the one registry the toolbar and the keymap both read, twenty-one rows of two kinds, **Symbols** the last; `commandKeymap`; `toggleMarkCommand`, `applyMarkCommand` and `removeMarkCommand`; and `markAt`, `markThroughout` and `somewhereToPutMark`, which a renderer asks before it asks the author for anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `editor: src/blocks.ts`                                             | `blockCommand` over eleven `BlockAction`s, **Reference** the tenth and **Equation** the eleventh - each of which answers whether one could be placed and places nothing, since its dialog places it - `listAwareEnter`, `setListAttributes` and `listAt` - the list commands, the Enter chain and the one query the list panel reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `editor: src/identity.ts`, `state.ts`                               | 128-bit block and mark identifiers, ADR-0023's descent rule as a plugin, `annotationsInOnePiece`, which re-identifies a mark left in two pieces after **every** transaction, `spellcheckDecorations` (CNT-147), no two adjacent empty paragraphs at any depth - a footnote's paragraphs included - `Enter` that makes none, and one history per component; `footnotePluginsOf`, what a footnote's own editor is built with. The identity plugin keeps an identifier one node holds in an undo, a redo or a transaction carrying `keepsIdentifiers` (cross-references 1), and the one decorations plugin draws each reference's text beside spellcheck and the placeholders; `prosemirror-gapcursor` 1.4.1, ahead of `tableEditing`, stands the caret beside a block equation, a figure or a table where no text does, and a table's figure refuses it inside itself (equations 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `editor: src/view.ts`, `style.css`                                  | `mountEditor`: spellcheck, language and direction on the surface, a rule per mark, paste, copy and cut taken through `clipboard.ts` rather than ProseMirror's own parser, and a drop refused; `src/render.ts`, `renderContent`: a component's content as markup through the same mapping and schema, with no view, for a document's text, each reference drawn as the surface draws it from an optional context, and each equation by `drawEquation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `editor: src/tables.ts`                                             | `tableOf`, a table built from stored rows under its header counts; `tableHeadersAgree`, the plugin keeping every cell's kind and scope to the counts and taking away a table left with no cells, kept out of the history; `insertTable` behind **Table**; `setTableHeaders`, `tableCommand` over `prosemirror-tables` 1.8.5 and `tableAt`, which the table panel reads, the note's two, `addNote` and `removeNote` (footnotes 1), and `setTableNumbered`, the panel's **Numbered** box (W14.4). The schema holds a stored table as `tableFigure` - its caption, a `prosemirror-tables` table, since `TableMap` reads every child of a table as a row, and its note where it has one, an isolating `tableNote` - with its cells holding paragraphs and lists alone, and `numbered`, false where the author marked it unnumbered and stored only then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `editor: src/figures.ts`, `figureView.ts`                           | `figureAt`, which the figure panel reads; `insertFigure` after the paragraph the cursor is in, or in place of an empty one, never in a table's cell; `setFigureAlternative`, `setFigureNumbered` (W14.4), `replaceFigureImage` keeping the figure's identity, caption and whether it is numbered, and `deleteFigure`. An own text that says nothing is refused and one that says something is stored as typed. The schema holds a figure as `figure` - its asset version, image style, alternative text and `numbered` - around one `figureCaption`, and draws the image from the asset version's content route, uneditable; `figureView` draws that same spec on the surface and marks an image that does not load, _An image you may not see_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `editor: src/images.ts`, `imageView.ts`                             | An image in a run of text (figures 4): `imageAt`, an image selected whole, which the panel reads; `insertImage` at the cursor in a paragraph - wherever the paragraph is, a table's cell included - and nowhere else; `setImageAlternative`, `replaceImageAsset` and `deleteImage`. The schema's `image` is an inline atom with the stored node's attributes and no marks, and a paragraph holds `(text \| image \| footnote \| crossReference)*`; `imageView` holds the `img` in a span that marks one that does not load. `imagesUnmarked` and `marksPastImages` treat a footnote's mark and a cross-reference as they treat an image, taking a mark off the node alone, in every home a reference stands in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `editor: src/footnotes.ts`, `footnoteView.ts`                       | A footnote (footnotes 1): `insertFootnote` at the end of the selection in a paragraph and nowhere else, selected whole; `footnoteAt`; `enterFootnote`; `sparingFootnotes`, which keeps a mark command off a footnote's text; `openFootnote`, the nested editor open in a surface. The schema's `footnote` is an inline atom with the stored identifier and anchor, holding `footnoteParagraph+` - a textblock of text alone outside the `block` group - so what CNT-129 excludes cannot stand in one. `footnoteView` draws the mark, and while it is selected a nested `EditorView` over the node's own content whose transactions are mapped into the surface's, so one history and one save hold both; `pasteIntoOpenFootnote` pastes into it through `pasteInto`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `editor: src/references.ts`, `referenceText.ts`, `referenceView.ts` | A cross-reference (cross-references 1): `insertReference` at the end of the selection in any inline home but preformatted text, selected whole; `referenceAt`; `changeReference`, keeping its identifier and dropping `withoutPages` unless the form is `page`. The schema's `crossReference` is an inline atom with the stored identifier, target, display and `withoutPages`, and no marks, standing in a paragraph, a footnote's paragraph, a term, an attribution, a caption and a table's note. `referencesShown`, what each reference shows from a `ReferenceContext` - the document's targets and the component being edited, whose own `component` target it shows as a `block` target, or none on its own - and whether it is broken; `ownTargets`, a component's own figures, tables, footnotes and numbered block equations from the live document, a figure or a table marked unnumbered said to be so, for the dialog; `referencesPlugin` holding the context, set by `setReferenceContext` out of the history; and `referenceView`, which draws the text a decoration carries, on the surface and in a footnote's open editor                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `editor: src/equations.ts`, `equationView.ts`                       | An equation (equations 1): `insertEquation` - inline at the end of the selection in any inline home but preformatted text, or a block after the paragraph the caret is in, or in place of an empty one, never in a table's cell, with an empty paragraph after one that would end what holds it - selected whole; `equationAt`; `equationPlaceable`, which the dialog asks before offering a block; `changeEquation`, keeping the kind and a block's identifier; `enterEquation`, `Enter` over one selected whole handed to the dialog, on the surface and in a footnote's open editor. Each checks its MathML against the content model before it places anything. The schema's `equation` is an inline atom with `mathml` and `latex`, and `equationBlock` a block with `id`, `mathml`, `latex` and `numbered`, neither taking a mark. `drawEquation`, exported for the dialog's preview, asks the reader again, parses the MathML as XML and imports it as MathML elements, never HTML - a block in display style with a `(#)` marker where numbered, the `math` named by its alternative with `aria-label`, _No description_ beside one with none and _An equation that cannot be shown_ for MathML the reader refuses; `equationView` is the node view that draws it, for both nodes. The commands look their node types up in the state's own schema by name, so the title editor's schema is served by the same four (equations 3)                                                                                                                                                                           |
| `editor: src/symbols.ts`                                            | A symbol (W14.7, CNT-057): `canInsertSymbol`, a caret or a range of text anywhere text is typed, preformatted text and a footnote's own text among them, never over something selected whole; `insertSymbol`, one character - one code point that stands visibly in a line, never a control, format, private-use, line or paragraph separator character, nor half a surrogate pair - typed at the selection in one transaction, as typing it would, taking the marks of the text it stands in. The registry's **Symbols** row, on `Mod-Shift-m`, prompts as **Equation** does: as a block command it answers `canInsertSymbol` and types nothing, and the palette runs `insertSymbol` with the author's choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `editor: src/title.ts`, `titleView.ts`                              | A section's title (equations 3): `titleSchema`, a root that is the one textblock, holding `text` and the component schema's own `equation`, no marks; `titleToEditor`, null for a title holding a mark or any run but text and an equation, and `titleFromEditor`, untrimmed; `mountTitleEditor`, a view with its own `history()`, without a depth limit since W11.3, whose `Enter`, `Shift+Enter` and `Mod+Enter` commit - or open the dialog over an equation selected whole - and never split, `Mod+Shift+E` opening the dialog, a paste read as `text/plain` with every line break a space, and a handle to read, replace - with a fresh history, unreported - focus, place and change an equation, and destroy it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `editor: src/clipboard.ts`                                          | `readClipboard`, reading the product's type (`application/vnd.alloy-works.content+json`), then HTML, then plain text - only plain text into preformatted text; `pasteInto`, admitting against the component as it stands and placing one slice open to its first and last text blocks, refusing whole and by name what the editor cannot hold - into a footnote's text, anything but paragraphs of runs and references - keeping the identifiers admission gave, and pointing a reference left behind whose block is gone at the identifier `renamed` gives it, counted in the report; `productClipboard`, a range wrapped in the blocks it stands in; `readMarkdownText`, loading the Markdown reader the first time it is asked for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `editor: src/header.ts`                                             | `headerOf`, and `setTitle`, `setLanguage` and `setDirection` as steps on the root, with `titleAccepted` beside the command it gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `editor: src/replay.ts`                                             | `recordChange`, one dispatched transaction and what the plugins appended as a reload keeps it, with how the history took it; `replayChanges`, those changes replayed onto a document into a history holding exactly the events they were recorded with, then closed, or a throw where one does not replay exactly (W11.3); `mergeChange`, a run of typing kept as one change; `replayPlain`, the steps applied with no history; `schemaIdentity` and `editorSchemaIdentity`, a hash of a model a record is stamped with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db: migrations/tenant/0012_editing`                                | `component_lock`, one row per component; `iteration`, insert-only, which nothing references                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `db: src/editing.ts`, `promotion.ts`                                | `claimLock`, `readLock`, `readLocks` (many in one query) and `saveIteration` under the sequence rules; `latestSequence`, a session's latest accepted sequence read as `saveIteration` reads it (W11.3); `cutVersion`, promoting the latest iteration, and `releaseLock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db: migrations/tenant/0037_iteration_retention`                    | `editing_policy`, one row, `iteration_retention_days` from 1 to 365, 30 by default, which the runtime role reads and changes and never inserts or removes; `iteration.expires_at` and its check dropped; `delete` on `iteration` granted to the runtime role behind `iteration_swept_only`, a `before delete` trigger; an index on `iteration (artifact_id, opened_from)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `db: src/retention.ts`                                              | `editingPolicy` and `setEditingPolicy`, refusing a window that is not a whole number of days from 1 to 365 as `retention.out_of_range`; `sweepIterations`, the worker's; `iterationRetained`, the same condition as a SQL expression, which the Recovery listing reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `db: src/recovery.ts`                                               | `listIterations`, a principal's own retained iterations of a component, newest first, over the listings' keyset; `readIteration`, one whole; `newestUncutIteration`, when they last saved work never made a version, or null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `api-contract: settings.ts`                                         | `GET /v1/settings/editing`, to anybody signed in, and `PUT /v1/settings/editing`, `administer` at the tenant, over `EditingSettings`, `{ iterationRetentionDays }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `service: src/settings.ts`                                          | Their handlers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `worker: src/sweep.ts`                                              | `sweepExpiredIterations`, run by `main.ts` on the sweep interval in every tenant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `db: src/creation.ts`                                               | `createComponent` at `0.1`, `listComponentTypes` and `defaultComponentType`, and `currentDefinitionsFor`, which creating and cutting share                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `db: src/components.ts`, `spaces.ts`                                | `listReadableComponents`, filtered by the shared readable-set predicate inside its query, a page at a time, optionally to named spaces, each with its type, language and last change; `countReadableComponents`, the same set counted per space; `listSpacesFor`, each space with whether the caller may create in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `db: src/dev-content.ts`                                            | `seedDevelopmentContent`: a component over the component type the environment starts with, and Ada and Grace allowed Author on General, for development only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `api-contract: components.ts`, `editing.ts`                         | Nine routes and their schemas - `GET /v1/spaces`, `GET /v1/spaces/{space}/component-types` and `POST /v1/spaces/{space}/components` beside the six the session uses; a route may declare a request body. Since W9.4 a tenth, `GET /v1/components/{id}/versions`, a component's versions newest first, paged by a cursor naming the last version's number, to whoever may read it. Since W11.2 two more, `GET /v1/components/{id}/iterations` and `GET /v1/components/{id}/iterations/{iteration}`, `edit` and the lock held by the session a `session` query names, and `unsaved` on the component's view; since W11.3, `sequence` on it, the latest accepted from the session an optional `session` query names, the caller's own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `service: src/components.ts`, `editing.ts`                          | The handlers, and refusals with their members - `lock_held` naming the holder and the expected release; `listIterations` and `getIteration`, each asking `holding` first and refusing as a save is refused, and `newestUncutIteration` read into `getComponent`'s `unsaved`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `web: src/editor/`                                                  | The session as a state machine over a service and a clock, the adapter onto the generated client, the save indicator, the editor and its header, the **Formatting** toolbar, the mark prompt and the **List** panel, the **Figure** and **Image** buttons, the dialog, the panel - for a figure or an image selected whole, a figure's with its **Numbered** box (W14.4) - `ReferenceDialog` and `referenceChoices.ts`, what it offers and what each choice will show, `SymbolPalette` and `symbols.ts` (W14.7) - three groups of characters as data, each one code point named by its Unicode name in plain words, drawn as grids of buttons the arrow keys move through, those the typeface at the cursor lacks dimmed and disabled, pointing to an equation (W-M) - `EquationDialog`, `latex.ts` - LaTeX made MathML by Temml and admitted by `admitTemmlMathml`, every refusal in words - and `speech.ts`, the speech rule engine loaded on first use with its language data from the build, and `uploadImage` - the two requests of an upload, then the upload followed every half second for thirty seconds, and a refusal said in words - `press.ts` - the one function a button press and a shortcut both run - **New component**, the list and the workspace, and Recovery (W11.2): the session's `recovery` phase, `RecoveryPanel`, and `recovery.ts`, its words; and `stored-session.ts` (W11.3), what the window keeps of a session for a reload, parsed, replayed and written as it changes, and `editing-storage.ts`, forgetting it all at sign-out and keeping nothing more for the rest of the page |

**Sixteen properties, because each is a decision rather than an implementation detail.**

**The header is content, not a column on the component.** A component's title, base language and base
direction are attributes of the editor's root, so changing one is a step in the same history as the text,
undone with `Ctrl+Z`, carried inside the iteration the session already sends, and recorded by the next
version cut. Creating needed no route for them and editing needs no request member, so a version records
the title the component had when it was cut (CNT-143) without anything keeping two copies in step.

**A version is cut from an iteration, and only when asked.** Saving writes iterations; only Save version
and Done editing call `cutVersion`, which promotes the session's latest iteration through `recordVersion`.
A lock that expires cuts nothing.

**The lock is checked where the write is.** `saveIteration`, `cutVersion` and `releaseLock` each check
that the calling session holds the lock, in the transaction that writes, serialised per component on the
advisory lock `recordVersion` already takes.

**No write in a session touches access.** A lock, an iteration and a version are not facts a decision
reads, so none takes the access epoch for update, and the shared lock `authorise` took first is never
upgraded; a test runs the writes while another transaction holds the epoch.

**One registry, so a button and its shortcut cannot drift.** `EDITOR_COMMANDS` is one list of
twenty-one rows of two kinds - nine marks and twelve block actions - each with the label, the key, how the
key is said aloud, and, for a mark or a block action like **Reference**, whether the author must be asked
for a value first.
`commandKeymap` builds the keymap from **every** row and the toolbar renders from it, so a button
added without a shortcut, or a shortcut with nothing that names it, is not a thing the code can
express (CNT-077) - and a registry that declared five block shortcuts and bound none of them is not
either, which is what the `kind` switch in one place rather than a second keymap prevents. Both routes end in `pressCommand`, one function in `apps/web/src/editor/press.ts`,
so the keyboard cannot acquire its own answer to what a dialog opens on or what a refusal is reported
as. Applying a mark always mints a fresh identifier: `markAt` answers a mark's attributes and never its
identifier, so there is nothing for a caller to reuse, and re-marking a span with a changed value is a
new annotation rather than the old one edited.

**`F6` cycles the regions that are there, and `Shift-F6` cycles them backwards; both wrap.** The
regions are the component header, the **Formatting** toolbar, the **List** panel and the surface. The
list panel is the first region that comes and goes with the selection - it is rendered only while the
cursor stands in a counted list - so the ring is built from what is present rather than from a fixed
list: a region that is not there is not in the ring. The design names a fifth, the metadata
panel, which is not built. The **Component** toolbar - Save version and Done editing - is deliberately
not one of them and keeps its own ordinary tab stops, which is why every test that reaches for a
toolbar names it. The **Formatting** toolbar is a single tab stop with the arrow keys, `Home` and `End`
moving along it, and its buttons are `aria-disabled` rather than `disabled` when the component is read
only, so a keyboard user can still reach it and `F6` still has somewhere to land.

**The List panel asks the command and shows what it said.** It is rendered only while the cursor
stands in a counted list, and its **Start at** and **Numbering** fields only over a numbered one:
`setListAttributes` refuses a start or a numbering on anything else, and a control that announces
itself as available and does nothing when it is used is the defect this editor has been fixed for
three times. Every change is merged onto what the list already carries and the merged result is
judged, so asking for letters on a list already starting at 0 is refused at the moment it is asked
rather than weeks later by a publish. Each refusal gets its own sentence beside the field - a start
that is not a whole number and a start of 0 under letters or roman numerals are two different
complaints - and the box keeps what was typed so the value stays on screen beside the sentence about
it. It gives way to the document when something else changes the value, **and when the cursor moves to
a different list, told apart by the list's identifier rather than by its three attributes**: two lists
with no start and no numbering are the same answer twice, so a box comparing only those would carry a
refused `0` and its complaint into a list that never had the problem. The panel keeps `disabled`
rather than the toolbar's `aria-disabled`, following the component header, because a form group is not
an ARIA toolbar and the reason the toolbar needs a reachable disabled button does not transfer.

**A dialog makes the rest of the component inert.** **Link** and **Language** open a prompt; while one
stands, the article holding the surface and both toolbars carries `inert`, so a click cannot move the
selection out from under the dialog and land the mark on text the author never opened it for. The
session's notice goes to a live region that is never inside that article, because a live region
removed from the accessibility tree announces nothing - and the rollback that moves text out from
under a dialog is exactly what writes that notice. In the application that region is the status bar
along the foot of the page (`web: src/shell/Status.tsx`), the one live region the document page's
notices use too; an editor rendered with no shell around it keeps a `<p role="status">` of its own
beside the article.

**An equation is drawn from its MathML as MathML, never as HTML, and by one function.** The stored
MathML has already been judged by the strict reader, and `drawEquation` asks the reader again before
it parses the string as XML and imports the root, which must be `math` in the MathML namespace with no
parse error, into the page. So the surface, a footnote's open editor, a document's text and the
dialog's preview draw the same thing, and nothing in an equation reaches `innerHTML`. The `math` keeps
its own role and is named with `aria-label` from its `alttext`: a wrapping `math` or `img` role would
make the MathML beneath it presentational, and `alttext` alone is read by few readers. That this is
what a screen reader announces is argued, not measured - none has been run over it.

**Temml and the speech rule engine are the renderer's, pinned, and both are loaded on use.** Temml
0.13.5 (MIT) is imported statically by `latex.ts`, since the preview is drawn on every keystroke, but
`EquationDialog` is loaded by `React.lazy` the first time it opens, so Temml comes with it, in a chunk
of the build of about 65 kB compressed, and the main chunk is about 64 kB compressed smaller; it is
called with `xml`, `throwOnError` and no annotation, and a test renders every one of the domain's
fixtures with it, so a bump that changes its output fails. **A line broken outside an environment's
rows is found in the LaTeX** by a scanner in `latex.ts`, since Temml draws it in a display equation
as an empty operator no different from `\pmod`'s. The speech rule engine 4.1.4 (Apache-2.0, the newest release that is not a candidate)
is imported from its ES module build the first time the dialog asks for words, about 89 kB
compressed, and speaks thirteen languages. **Its language data are the product's own files**: each
locale's JSON is a chunk of the build, handed to the engine by a loader set as the global
`SREfeature` before the engine loads, because on import the engine sets itself up and would otherwise
fetch `base` and English from a CDN; it always loads English beside the language asked for, as its
fallback. Requests are answered one at a time, since the engine holds one locale at once, and a load
that fails is not kept: the next request tries again. Its Node
path reaches `require` through `eval`, which the build warns of and a browser never runs.

**Six editor node types for the model's one `list`, and the mapping is where they meet.**
`list` (`listItem+`, `kind` ordered or unordered, with `start` and `format`), `listItem` (`block+`),
`definitionList` (`definitionItem+`), `definitionItem` (`term definition`), `term` (inline, marks
allowed) and `definition` (`block+`). The stored model holds one `list` of three kinds whose item is
`{ term?, content }`, its `content` the definition's children; a ProseMirror content expression is
fixed per type, so no single item type can be `block+` for two kinds and open with a term for the
third - [ADR-0025](decisions/0025-the-editor-schema-is-not-the-stored-model-one-for-one.md), superseded
by [ADR-0026](decisions/0026-a-definition-is-its-own-editor-node.md), which gave the definition its
own node so that the list renders `dl > div > dt + dd` and a screen reader is told what each
definition defines (CNT-175). `definitionItem` is never relaxed to `term? definition`: an item without
its term is then unrepresentable rather than merely refused. `start` and `format` reach the rendered `ol` as `start` and `data-format`, and are
read back judged rather than trusted, because the stylesheet takes the marker from one and the browser
takes the first number from the other - without them an author setting **Start at 5, a b c** would see
`1.` on the surface and `e.` in the PDF.

**Four commands come from `prosemirror-schema-list`, and a definition list's are ours where that
package assumes an item's blocks are its own children.** `wrapInList`, `splitListItem`,
`sinkListItem` and `liftListItem` drive the counted lists unchanged. `splitListItem(definitionItem)`
returns false from the term and from the definition alike, measured - a split's remainder is a
paragraph, which cannot be an item's first child where that must be a term - so `splitDefinitionItem`
is ours: from the term Enter moves into the definition, and from the definition it makes a new item
with an empty term, built as one `Transform.split` step so every position before the cursor maps
forward and the blocks already in the item keep the identifiers they had.
`liftListItem(definitionItem)` returns false at the top level of a definition list for the same
reason, so `outOfDefinitionList` is ours too, or an author who pressed Enter in a fresh definition
item would have no key that leaves the list. `sinkListItem` and `liftListItem` put and look for a
sublist after an item's last child, which in a definition item is its definition, so
`sinkDefinitionItem` and a lift beside it build the same `ReplaceAroundStep`s one level deeper, inside
the definition. `Enter` is one chain -
`splitDefinitionItem`, then `splitListItem`, then the lift - and it stands **ahead of** the
empty-paragraph `Enter`, which returns true and does nothing in an empty paragraph and would
otherwise shadow every list-aware answer; the order is held by a test that presses the key through
the real keymap rather than by reasoning about precedence. Tab and Shift-Tab are bound literally and
carry no registry row, because they are a second route to Nest item and Lift item rather than their
named shortcut, and Tab outside a list still lets the focus leave.

**Everything that would build a level declines past the depth the content model admits.** Thirty
levels, measured against `fromEditor` rather than chosen, and asked of the document the command would
make rather than of the cursor's ancestry - so a deep list in one part of a component does not freeze
Tab in a shallow one. **Five routes could build one**, found by sweeping every textblock of five
fixtures at both ends with every keymap: **Nest item**; **Definition list** over any paragraph;
**Bulleted list** or **Numbered list** over a paragraph inside a definition, where they wrap instead
of toggling; and **`Backspace` at the start of a definition item's term** or **`Delete` at the end of
the item before it**, which could not join two items while `definitionItem` was `term block+` -
`deleteBarrier` wrapped the following item in a new definition list inside the previous one - and so
nested where an author expected a deletion. Since ADR-0026 nothing may follow an item's definition,
so the wrap finds no place, measured; the keys stay guarded so the depth rule rests on neither fact. The three commands decline, the toolbar shows the control
unavailable and Tab hands the key back to the browser. The two keys now **join the two items**, at any
depth (`joinDefinitionItems`, issue #160): the second term runs on at the end of the first item's last
paragraph and its definition's blocks join the first item's, or, after an empty term, the
definition's first paragraph joins instead,
which is the inverse of `Enter` in a definition. A join makes nothing deeper, and where the item before
ends in something that is not a paragraph the key is taken and does nothing. Every deleting binding in
`baseKeymap` is guarded, found by identity against its own commands rather than typed out, so a
platform alias cannot be missed. The alternative was what the editor did
until the final whole-branch review: the thirty-first level was built, `fromEditor` threw on every
save afterwards, and the author kept typing into a page that said it was saving.

**Both descending plugins descend.** Identity walks every block at any depth, so a block made inside
a list item is named like any other; adjacency is held in every sequence of blocks the editor can
make, which is the top level, a list item and a definition. Identity is registered **before** adjacency,
and that is a preference rather than a rule: ProseMirror re-runs every `appendTransaction` over
whatever any of them appends, so each sees the document the other left however they are ordered, and
swapping them changes no outcome. What the order buys is that a paragraph about to be removed is
named and then removed, one wasted identifier, rather than the document being cut about between the
pass identity reads its positions in and the one it writes them back in. **The order that is
load-bearing is inside the adjacency walk**: it pushes a node's removal and then descends into that
node, because collecting a later sibling's position before a deeper one and then deleting back to
front addresses a position that no longer exists - a `RangeError` out of `appendTransaction`, which
is an uncaught exception on a keystroke, and which `state.test.ts` drives rather than argues.
A mid-item split can duplicate an identifier rather than leave one absent, so the repair covers both,
and the identifiers a command mints are asserted on the command's own transaction rather than on the
applied state, where the plugin has already repaired them.

**What the editor holds is always storable.** Every iteration leaves the renderer through `fromEditor`,
which runs `parseContentDocument`, and the service parses it again. The identity plugin and the
empty-paragraph plugin keep that true after any sequence of edits, which a seeded test of two thousand
operations holds them to - over a nested document as well as a flat one, with every one of its six
operations really drawn, which it was not until the generator's own arithmetic was checked.

**And the session does not trust it.** `fromEditor` is what `snapshot` calls, so a shape no gesture
declined would throw inside the save path. The snapshot is therefore taken **before** the attempt
moves anything - the sequence, `dirty`, the indicator - and a throw leaves the change unsaved, still
dirty, with a sentence saying so and editing going on, exactly as a refusal from the service does;
`dispose` does the same and sends nothing rather than throwing out of the unmount or writing an older
snapshot as the author's latest. Clearing `dirty` first, as it did until the final whole-branch review,
left the indicator saying "Saving" for ever, stopped the unmount saving anything, and made **Save
version** and **Done editing** reject into a control that then waited for ever.

**An iteration is kept until the next version is cut, and for the tenant's window after that** (W11.1;
VER-003, VER-004). Nothing is decided at insert, when the cut has not happened: migration 0037 dropped
`expires_at`, which the T1 audit found gave an iteration written long before a cut no window after it.
The window is `editing_policy.iteration_retention_days`, one row per tenant, 30 days unless an
administrator changes it through `PUT /v1/settings/editing`; anybody signed in reads it through the
`GET`, since VER-004 wants it stated, and no page shows it yet. The worker's `sweepExpiredIterations`
runs `sweepIterations` in every tenant on the sign-in sweep's interval, passing over a tenant whose sweep
fails, and deletes each iteration whose component has a version after the one it was opened from, the
first such version - the next cut - made the window ago or more by the database's clock. The window is
read when the sweep runs, so a longer one keeps longer what has not been swept, and nothing swept comes
back. The runtime role may delete an iteration and still never update one (VER-001):
`iteration_swept_only` refuses the delete of any row not past its window, whatever role asks, so the
sweep's own condition, which `iterationRetained` states for the Recovery listing, is never the guard.
An iteration nothing has been cut after is never deleted, however old, since it may be the only copy of
its writer's work.

**An iteration is read back by its writer, under the lock** (W11.2; CNT-174, CNT-090, CNT-067; RC-A,
RC-E, RC-F, RC-G). `listIterations` and `readIteration` in `packages/db/src/recovery.ts` answer only the
asking principal's own rows of the component, and only where `iterationRetained` holds, so the list never
offers what the next sweep may take; the listing carries no content, and one iteration is read whole on
its own. Their routes need `edit` and the lock held by the session a `session` query names - `holding`,
the check every write makes - and answer any other iteration as absent, so an author who takes the lock
after another never reads the other's work. The component's `GET` answers its caller `unsaved`, the time
of their newest retained iteration, and null where a version - the one it was opened from or any cut
after it - holds exactly what it holds, by its digest; only the time leaves the store before the lock is
held. In the renderer, a component opened with `unsaved` and no session of its own running says so above
its text and offers **Recover** where nobody holds the lock, says the author is editing in another window
and offers **Recover here** where their own other window holds it, and offers nothing where somebody else
does; a session lost to a stale save offers **Recover** beside **Continue**. `recover()` claims under a
fresh session, with `move`, into the session's `recovery` phase, which the surface takes no change in;
from `editing` it claims nothing, flushes, and enters the phase, which is **Saved text** in the strip.
The Recovery panel lists the iterations, each marked this window's where its session is any this window
has used, which the adapter keeps in session storage beside the current one; and `restore` saves anything
unsaved and waits for the acknowledgement, reads the iteration, opens it through `readContent` and
`toEditor` into a fresh editor state, so the history is cleared as a cut clears it, puts its values in
the fields, and sends it as the next iteration. A listing or a read that finds the lock lapsed claims it
again once under the same session, as a save does. One that will not read is refused by its time and
nothing of it opens. Nothing yet enters Recovery in a window that lost the lock to a move
([component-editor.md, "Two windows, one author"](design/component-editor.md#two-windows-one-author)).

**Undo survives a reload** (W11.3; CNT-069, CNT-067, CNT-169; RC-H). The surface's `dispatch` applies each
transaction with `applyTransaction`, and `recordChange` in `packages/editor/src/replay.ts` records it
with what the plugins appended - each transaction's steps as `Step.toJSON` writes them, whether the
history holds it, the selection it set - the selection before it, and how the history took it, `new`,
`join`, `none`, `undo` or `redo`, read off `undoDepth` before and after rather than worked out again. A
footnote's editor maps its steps into the surface's transaction, so they are recorded as the surface's.
`apps/web/src/editor/stored-session.ts` keeps, under `alloy-works:editing-steps:<componentId>` in session
storage beside the session's id, a record stamped with its format and `editorSchemaIdentity` - a hash of
every node's and mark's spec, keys sorted, less functions, `parseDOM`, `toDOM` and `leafText` - and the
principal it was kept for; the session, the version it
opened from, the document then as the editor's JSON, the changes, the values, a revision bumped by every
change and the sequence and revision of the last save sent, with what that save held. A run of typing is kept as one change:
`mergeChange` folds a join of one held step onto a change of one held step, typed from the selection
the last left, where `Step.merge` takes the two, which the history holds as one step already. The record
is written whole at most 300 ms after a change - each change turned into JSON once - and at once for a
send, a reset, a flush and a close; the component editor flushes it on `pagehide` and on
`visibilitychange` to hidden, since a real reload runs no unmount. Nothing is written while nothing has
changed. A write the storage refuses first forgets every other component's record and tries again, then
stops keeping anything, and removes what was kept, until the next reset. Every sequence sent is also
kept under `alloy-works:editing-sent:<componentId>:<session>`, only ever rising, written by a save sent
after the page has gone as well - so a page's last save is not taken on the next page for somebody
else's - and the last answer the service gave to one under
`alloy-works:editing-acked:<componentId>:<session>`, its sequence and whether it was accepted, once or
again, or refused as stale or conflicting, only ever rising and written by an answer that arrives after
the page has gone as well, since `createSession`'s `onAccepted` and `onSaveRefused` are told of a save
the page sent as it went too. A cut, a restore, a refused claim and Done editing reset the record, and a page's session told of
a save after its page has gone writes no record. On opening, the component's `GET` names the session id
the window keeps for the component, whether or not a record is kept, and answers `sequence`; a page that
goes on under that id starts above it and above the last this window kept as sent under it. `readKept` gives a record only to the principal it was kept for,
forgetting it for anybody else, and gives a record of another format or model as its text alone -
`replayPlain`, every step applied with no history - forgetting the record. One of the kept session
against the version that opens, with anything changed, where the author may edit, is replayed by
`replayChanges` onto its document in a state holding the history and nothing else - so no plugin appends
or draws anything - each change forced into its own event by `closeHistory` or into the last by a shared
composition, each undo and redo replayed as the command and checked against the steps it made, the
history's depth checked after each change, and the history closed at the end; the state is then
reconfigured with the surface's plugins, and a node selected whole is replaced by a caret beside it.
Where the service's sequence for the session is above the last this window kept as sent - the record's
or the rising one's - or that sequence was refused, another page holding the same session saved past it
or saved that number first: a sequence sent is not a sequence accepted. `behind` sends and claims nothing
and goes to `lost` as a stale save does, with Continue and Recover, and the replayed text offered to
copy. Where it equals the last sent and no answer to that number was kept - a save sent as the page went,
which arrived after it had gone, most often - `continuing` answers `repeat`, and `lastSent` rebuilds that
save exactly: the record keeps `sentAs`, how many of its changes the save held and the values then,
and the recorder folds nothing typed after a send into a change the send held; a save sent after the
record was closed is the record whole, where its revision is the record's. `resume` then sends it again
at the same number, under the same session, once the claim is granted and before anything else, and a
page that goes meanwhile sends nothing; the service answers the same content again as accepted, and the
session goes on, what was typed since sent as the next sequence, or refuses different content as
conflicting, and the session goes to `lost` as `behind` leaves it, the text on screen offered. A save
that cannot be rebuilt exactly, or a sent-again save with no answer, is taken for another page's, never
guessed at. The record's format is 3. Otherwise the session starts from the larger of the last sequence sent and the service's, and
`resume` claims again under the same id, neither fresh nor moving, holding the changes as unsent unless
the service accepted the last send and nothing changed after it. A refusal puts the latest version back
on screen, the changes offered as text where any were unsent, as any refused claim does. A record that
will not replay, or that the author may no longer edit, opens as a page opened afresh does, with its text
offered to copy where it differs from what opens, or a notice where none can be read; one against another
version, or that does not parse, is forgotten. Text offered on opening - from such a record, or a replay
the service has saved past - is held apart from a refused claim's kept text, which a successful claim
clears, and kept under `alloy-works:editing-offered:<componentId>` with the principal it was offered to,
so a reload offers it again, until **Dismiss** forgets it. Nothing tells a duplicated tab from a reload: a
duplicate goes on under the session it copied, as a second window of the same author does, and the
service's sequence refuses whichever of the two sends second. `apps/web/src/editor/editing-storage.ts`'s
`forgetEditing` removes every `alloy-works:editing-` key as the Header signs out, and again just before
it reloads the page, and sets the flag `mayKeepEditing` answers, which every write of a record, a sent
sequence, an answer, an offered text or a session id - one a fresh claim mints among them - asks first,
so nothing is written for the rest of the page; a sign-out with no answer, where `/v1/me` does not say
nobody is signed in, reloads nothing and sets the flag back with `keepEditingAgain`. The
renderer's tests clear session storage, and that flag, around every test, since jsdom keeps one storage
for a whole file.

`pnpm dev:setup` makes "Install the printer" in both development environments, over the component type
the environment starts with rather than one of its own, and allows Ada and Grace Author on General; Alice
is left with nothing.

## The document and its outline

Making a document and restructuring its outline, designed in [`design/structure.md`](design/structure.md)
and built by [the first structure plan](plans/2026-09-18-structure-01-the-document-and-its-outline.md).
A document is an artifact of its own kind, in exactly one space, and **its content is its outline**: one
JSON tree of sections and component references, versioned through the same chain as a component, with
the same two digests. [The second structure plan](plans/2026-09-18-structure-02-numbering.md) numbers
it: the outline panel shows each node's section number, and `GET /v1/documents/{id}/numbering` answers
the whole numbering table - sections, figures, tables, equations and footnotes - with the component
version each reference resolved to. What a document offers a cross-reference, and what one prints, is
`structure/references.ts` (cross-references 1), which the document page reads to number the references
in its text and in the editor opened in place, in its layout's words for above and below
(cross-references 2); the same file resolves a reference in the document that publishes it, which
`assemble` calls. Nothing shows a document as a document view.

| Where                                                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain: structure/outline.ts`                            | The outline at schema version 3 - a title, a base language and direction, and `nodes` - each node a section or a reference carrying an identifier, `numbered`, `matter` (`front`, `body` or `appendix`), `pageBreak`, `values` and children, a section a title, a reference a component and a `mode`; the parse, which bounds the depth at 64, keeps `matter` to the top level, refuses a `front` node after any top-level node that is not front matter (STR-064) and holds a title to the content model's inline rules, to `hasText` and to what Postgres can store; `mayBeFront`; the migration chain, whose schema 1 step refuses an outline holding front matter schema 1 never allowed, and the canonical form, a section's title in it by `canonicaliseTitle`, which the outline panel compares titles by too (equations 3); and the view a reader is shown, `withholdComponents` and `readOutlineView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `domain: structure/operations.ts`                         | `outlineOperationSchema`, the closed union of insert, move, remove, retitle and set, and `applyOutlineOperation`, which applies one to a tree and answers the new outline or a fixed reason, never an exception                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `domain: structure/scheme.ts`                             | The numbering scheme - a sequence's rule per matter, with its label, formats, restart depth, prefix depth and separator - its schema, which refuses a restarting rule that could print one label twice (a footnote's excepted), `defaultNumberingScheme` (`default/1`), and the counter formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `domain: structure/contributions.ts`                      | `contributionsOf`, a component version's content projected to what it contributes: each figure, table, block equation and footnote, in document order wherever it is nested, whether it is numbered - false for an equation, a figure or a table its author left unnumbered, which takes no number and is in no list (STR-071) - and a figure's or table's caption, which the contributions route sends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `domain: structure/numbering.ts`                          | `resolve`, `conditions` (the identity until conditions exist) and `number`, each taking the stage before as a type of its own, and `sectionNumbers`. `number` walks occurrences with a counter stack per matter and answers a table whose every entry names its node, block, sequence, matter, section counters, value and the node that last restarted it; a number an unknown occurrence could have moved is `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `domain: structure/lists.ts`                              | `contents(conditioned, numbering, depth)`, every node to a depth in document order, numbered or not, a reference's title left to its caller; and `listOf(conditioned, numbering, sequence)`, one sequence's entries in order, each with the caption its component holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `domain: structure/references.ts`                         | `documentTargets`, in document order, every section as a `node` target, its title's own reference as its number, and every figure, table, footnote and numbered block equation an occurrence contributes, a figure or a table marked unnumbered among them, `unnumbered` and with no label - a `block` target in the occurrence being edited, a `component` target where its component occurs once, and nothing where it occurs more than once - each with its label, title and whether it is above or below, and a section whose title holds an equation marked so; `formsFor`, the forms a kind of target has; `targetForms`, the forms a target is offered in, which are its kind's less the title forms for such a section and the number forms for a figure or a table marked unnumbered, since the publish refuses them; `printed`, what a form prints, in the layout's words for above and below where it is given them and English where not; `kindWord`; and resolution (cross-references 2): `referenceResolver`, which indexes the stored outline, each readable occurrence's content and the numbering table once and binds each reference where it is read - a `block` target in that occurrence, a `component` target in its component's one occurrence, a `node` target to the node - to its node, block, kind, label and title, or to why it failed, `missing`, `componentAbsent` or `componentRepeated`; and `printableForms`, the forms a bound target has something to print for                                                                            |
| `domain: version/substance.ts`                            | `DocumentSubstance` and `LayoutSubstance`, the third and fourth arms of a version's substance, and `canonicaliseVersionContent` choosing among four                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `db: migrations/tenant/0016_documents`                    | The three widened checks, above, and the one deferred constraint set immediate and back so they apply on a fresh environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: src/documents.ts`                                    | `createDocument` at `0.1` with an empty outline, `readDocument`, `listReadableDocuments` (with each document's last change, its outline's section and reference counts, and its publishing state as the reader may see it), `readableComponents`, and `editOutline`, which checks a reference's target, applies one operation to the version the caller opened from and records it through `recordVersion`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `db: src/numbering.ts`                                    | `numberingInputs`: which version each occurrence resolves to - a `latest` reference its component's head, a `pinned` one its version, an `approved` one nothing yet - and what each readable one contributes, in two reads of component versions whatever the outline's size - beside the readable-set lookups, a constant handful of queries - each read restricted to the components the principal may read inside the query, so no row of any other is ever selected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `db: src/readable-artifacts.ts`                           | The readable-set predicate every listing of content filters through inside its query - components and documents alike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `api-contract: documents.ts`                              | `GET /v1/documents`, `POST /v1/spaces/{space}/documents`, `GET /v1/documents/{id}`, `GET /v1/documents/{id}/numbering`, `POST /v1/documents/{id}/outline` and `GET /v1/documents/{id}/contributions`, and their schemas - `DocumentView.layout` carrying the layout a publish requested now would be made under, with its scheme and its words, each a loose record the page parses with the domain's schema, and the formats it makes, and `NumberingView.layout` the same version beside the table; the operation's schema is the domain's, and the service validates a body with it, so what `openapi.json` cannot express - that only a page reference carries `withoutPages`, and that a title's cross-reference targets an outline node alone - is refused at runtime as `invalid_request`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `service: src/documents.ts`                               | The handlers: a document's kind checked by each, a stale act answered with the current outline, `outline.invalid` mapped to `outline_invalid`, every answer carrying an outline built through one view that withholds what the caller may not read, and the environment's declared layout - its version, its language, its scheme, its words and the formats it makes - beside it, read afresh per view and never cached; the numbering of the latest version against that layout's scheme from `numberingInputs`, with the layout version named beside the table; and each occurrence's contribution to the sequences, taking no parameter and naming each version's contributions once; and each occurrence's text, each resolved version named once with its content and its number (W9.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `web: src/structure/`                                     | The documents list, **New document**, the document page holding the outline the last act returned and an undo stack, the outline panel with its keymap and drag and drop, each node's section number computed with `number` whenever the outline changes - over the scheme the document's layout carries, parsed once per view, never the product's default - and shown as the item's description, **Numbered** beside the selected node and **Matter** beside a top-level one, the **Title** field - the title editor with **Equation** beside it, opening the lazily loaded `EquationDialog` with the panel inert, or a read-only field and a sentence for a title it cannot keep (equations 3) - `tree.ts`, the panel's arithmetic, pure and tested against the domain's operations, with `titleText` reading an equation as its alternative and `trimTitle`, `links.ts` and a node's address, the `#/documents/{id}/nodes/{node}` route and its arrivals, the panel going to a linked node and choosing, focusing and marking it, its **Link to** field and **Copy link**, and `GeneratedLists.tsx`, the figures, tables and equations beneath the outline, numbered in the page from the contributions route, and `DocumentText.tsx`, the document's text, each reference numbered from `documentTargets` and printed in the layout's words for above and below, which the page parses with `layoutWordsSchema` as it parses the scheme, and the same context handed to the editor opened in place, and each section's heading with its equations drawn by `drawEquation` |
| `web: src/spaces.ts`, `paging.ts`, `editor/Workspace.tsx` | The creatable spaces loader **New component** and **New document** share, the every-page reader the access page and the document page share, and the hash routes `#/documents`, `#/documents/{id}`, `#/documents/{id}/nodes/{node}` and `#/publications/{id}` beside the components', with a **Components** and **Documents** link above either list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Five properties, because each is a decision rather than an implementation detail.**

**One act, one version, and no lock.** Each of the five operations is sent alone, carrying the version
it was made against, and is recorded as a version of its own through `recordVersion`, under the
advisory lock the chain already takes. The store applies it to the version the caller opened from,
never the latest, so one person's act is never rebased onto another's: a second act from the same
version is refused with the outline as it now stands, and an act that puts things back where they were
is answered with that outline and records nothing. A document cannot be locked at all:
`component_lock`'s check constraint refuses the kind, and the lock route turns a document's id away
before that.

**The stored outline refuses what a later rule would.** A version is immutable, so anything it
accepts is accepted for ever. The parse holds a section title to the walk `parseContentDocument` runs
over inline content, and every identifier inside a title is unique within it; to `hasText`, which the
editor's `titleAccepted` is; and to characters a `jsonb` column can store. It keeps `matter` to the
top level and bounds the depth at 64, before it recurses. An operation writes nothing into `values`
but `{}`, and the store checks a reference's target in the write transaction: a component the author
may read, and a pinned version of that component, or one fixed `outline_invalid` reason whatever was
wrong.

**A reader is shown a view, and nothing is computed from one.** Every answer carrying an outline -
the page, an act's answer, a `409`'s `current` - withholds the component and pinned version of a
reference whose component the caller may not read, found through the one readable-set predicate. The
digests, the versions and every operation run on the stored outline; the renderer reads the view with
`readOutlineView` and names such a node **A component**.

**A stale caller is told so first.** Whatever else an act from an older version gets wrong, it is
answered `409 version_precondition` with the current outline; `outline_invalid` is kept for an act
refused against the latest, so it always means the author asked for something the outline cannot do.

**The canonical form is composed, not blanket.** A section title is inline content, whose marks are a
set; a section's `values` are metadata, where a field's values keep their order. So the outline is
serialised member by member, the title through the content model's rule and everything else through the
plain one, and a test fails when a member is added to a node and not composed.

**Numbering is computed, never stored.** No stored shape changed for it: no migration, column, table
or cache. The route resolves and reads each occurrence and numbers the latest version whenever it is
asked, and every answer names the component version each occurrence resolved to, so a `latest`
component's new version moves its figures on the next request. The panel computes section numbers in
the browser with the same `number` over the outline it holds, knowing nothing of any occurrence -
no section number depends on one - so the tree is renumbered by the outline an act returns, with no
second request, and the panel never asks the service for a number. It shows section numbers alone.

**Both number with the document's layout's scheme, and neither falls back.** Every `DocumentView`
carries the environment's declared layout - its id, its version, its language and its scheme - read
in the handler's own transaction and deliberately uncached, because a cached scheme could show
numbers a publish would not produce. The page parses that scheme once per view and hands it to the
panel, to the generated lists and to the words a publish failure names its place in. A layout that
will not read, or an environment declaring none, is a `500` from both the document and the numbering
routes, and a scheme the page cannot parse numbers nothing and says **This document's numbering could
not be read.**, the outline staying fully editable; falling back to the product's default was
rejected, because a number that looks right and will not publish is worse than no number
(`design/publishing.md`, "The layout").

**A reader is numbered only from what they may read** (IAM-073). `numberingInputs` never selects a
row of a component the caller may not read, and answers its occurrence `version: null`, as it
answers an `approved` reference or content that does not read. `number` treats such an occurrence as
unknown, whatever it holds: every counter in its matter is `null` from there until that counter next
restarts. Section numbers are always shown, and everybody shown a number is shown the same one.

**The panel offers only what the outline accepts.** A top-level node carries a **Matter** choice of
**Front matter**, **Body** and **Appendix**, and nothing below the top level carries one, because
that is where the outline's parse allows it; **Front matter** is left out of the choice where
`mayBeFront` says the parse would refuse it, except on a node already in front matter, which would
otherwise show a value it has no option for. A node left ticked beneath an unnumbered one says **Not
numbered while** that one **is not.**

**And it refuses what the outline refuses, before anything is sent.** `moveOrNothing` returns
nothing for a key move or a drop that would take a node that is not `body` below the top level, or
that would leave a `front` node after one that is not, and the panel then says **Front matter and
appendices stay at the top level.** or **Front matter comes before the rest of the outline.** A drop
that would break either rule is never offered, since `allowDrop` reads the same function. An insert
or a **Matter** change is left to the service: `applyOutlineOperation` refuses a front-first breach
before the parse with the same sentence, which the service carries as the `outline_invalid` reason
and the page shows as the panel's notice, so an author meets one wording whichever path refused them.

**Undo is operations, computed in the renderer.** The page keeps, for each act, the one operation that
takes it back, computed from the outline before and the outline the service returned. A conflict
empties the stack, because undoing onto somebody else's outline would overwrite it unseen; a removal
empties it too, because it has no inverse - the subtree's identifiers can never be allocated again.

**One act in flight at a time.** The page sends nothing while an act is unanswered. Every retitle goes
through one queue in the panel that holds **one retitle per section**, in the order of its latest
commit, and sends them one at a time once nothing is in flight, each from the version the one before it
made: a second commit to the same section replaces the first, and a commit to another section waits
behind it rather than taking its place. Each held retitle keeps the rules it had alone - given way to
behind a refusal (a conflict, not permitted, no longer there, not applying), sent behind a failure, not
sent once the author is signed out - and a title that is not saved is always named: after the refusal's
own sentence when a refusal took it, and, when its field has closed, once no other retitle is
outstanding, so a later one's answer cannot replace the sentence. Every other act made meanwhile - a
move by key or pointer, an undo, a page-break change, an add or a remove - is ignored, with the tree's
`aria-busy` the only sign.

**A section's title is a one-line editor, compared by its canonical form** (equations 3). The panel
mounts `mountTitleEditor` for a title of words and inline equations and keeps a read-only field for
one holding anything else. The retitle machine compares what is typed, what the outline holds and what
it has sent by `canonicaliseTitle`, the domain's own form, so a retitle the store would record as no
change is nothing new to the field, and another author's different equation under the same words is
seen. **Equation** beside the field opens the same `EquationDialog` a component uses, which already
took its target from its caller, inline only and in the document's language; the panel owns it, makes
itself `inert` while it is open and puts the focus back after - **only the panel**, not the rest of the
page, as the component editor makes its whole article. Placing an equation commits the retitle; one
alone is refused, since the store's `hasText` refuses it, and kept in the field for words to be added.
The panel's `Ctrl+Z` leaves the field its own undo, as it leaves a text input's.

**Navigation is computed too, and no stored shape changed for it.** `contents` and `listOf` in
`packages/domain/src/structure/lists.ts` read the conditioned outline and the numbering table:
`contents` walks the outline, and `listOf` takes each caption from the resolved contributions. A
node's address, `#/documents/{document}/nodes/{node}`, names nothing positional, so a reorder cannot
invalidate it; the panel follows one to a node, chooses it, focuses it and marks it, and offers
**Copy link** beneath the chosen node. `GET /v1/documents/{id}/contributions` takes no parameter and
names each version an occurrence resolved to once, however many occurrences name it, rather than
once per occurrence - 232 KB rather than 542 KB at 500 nodes - and the document page numbers its
figures, tables and equations from it with the same pipeline the service numbers with, so a move
renumbers the lists before the page hears back.

`pnpm dev:setup` makes no document: **New document** makes one in General, which Ada and Grace may
create in.

## Templates

A template ([templates.md](design/templates.md), W4) is an artifact of its own kind, in one space,
whose version is its whole definition: the starting sections a document begins with, each with a key
and whether it is required, what an author may change, the theme and layout it binds by identifier,
and the metadata schemas it assigns at a document's level or its sections'. Its starting titles are
section titles with no cross-reference, and its canonical form takes the content model's rule for
their marks, so two spellings of one template digest alike.

It is made and changed only when every identifier it names resolves - a theme, a layout, each schema
and each field those group, and each `requires` against its schema - through `resolveTemplate`, which
reuses the metadata resolution a component type's assignments go through (`resolveAssignedFields`)
and names every reference that does not resolve. `design` makes one in a space and changes one;
`read` shows it; a grant on the template itself decides it as a grant on any artifact does.

| Where                          | What                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `domain: template/`            | `templateDefinitionSchema` with `checkTemplate`'s rules, `resolveTemplate`                                             |
| `domain: metadata/resolve.ts`  | `resolveAssignedFields`, which `resolveComponentFields` and templates share                                            |
| `domain: version/substance.ts` | `TemplateSubstance`, canonicalised with titles' marks as a set                                                         |
| `db: src/templates.ts`         | `createTemplate`, `readTemplate`, `recordTemplateVersion`, `listReadableTemplates`, `templateReferences`               |
| `api-contract: templates.ts`   | `GET /v1/templates`, `POST /v1/spaces/{space}/templates`, `GET /v1/templates/{id}`, `POST /v1/templates/{id}/versions` |
| `api-contract: openapi.ts`     | `hoist`: a recursive schema's own definitions moved to `components.schemas`, so every reference resolves               |
| `service: src/templates.ts`    | The handlers, `template_unresolved` carrying each reference and TPL-004 as its rule                                    |
| `db: src/dev-content.ts`       | Development's Reviewer field, Review schema and **Report** template, and Designer on General                           |

A document is made from a template in one transaction (W4.2): the template read at its latest version
where the author may read it, resolved again, and **materialised** - each starting section a section
node with a new identifier and `origin`, the key it came from, at outline schema 3, and the default
values of the fields at each level seeded by `carryForward` into each section's `values` and the
version's own `metadata_values`. `document_template` records the template version, and everything
read from the template afterwards - its layout and theme - is read at that version, so a template's
next version changes no document already made. A document's values join the version digest's `values`
member as a component's do; a document with none digests as it did before, and an outline act carries
them forward unchanged. The page's view, its numbering and a publication request take their layout
from `documentLayout`, and a request its theme from `documentTheme`: the template's, at its latest
version, or the environment's declared one for a blank document.

| Where                             | What                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `domain: template/materialise.ts` | `materialiseTemplate`: the starting outline as a document's, and its seeded values                              |
| `domain: structure/outline.ts`    | Outline schema 3: a section's optional `origin`, which no outline act writes                                    |
| `domain: version/substance.ts`    | `DocumentSubstance.values`, read into the digest's `values` member                                              |
| `db: src/documents.ts`            | `createDocument` with a `template`; `editOutline` carrying a document's values                                  |
| `db: src/templates.ts`            | `documentTemplate`, `documentLayout` and `documentTheme`                                                        |
| `db: src/layouts.ts`, `themes.ts` | `layoutLatest` and `themeLatest`, beside `defaultLayout` and `defaultTheme`                                     |
| `api-contract: documents.ts`      | `template` on `POST /v1/spaces/{space}/documents`, and on `DocumentView`, null where the caller may not read it |
| `web: structure/NewDocument.tsx`  | The **Template** choice, Blank first                                                                            |

An outline act on a document made from a template is held to it (W4.3): `documentRules` reads the
recorded template version's `changes`, and resolves that version against the definitions as they are
now for its fields, and `applyOutlineOperation` takes both as its `rules` - refusing an insert, removal
or move of a section that `changes` forbids before anything else, and a section's `values` written by
`set` that `checkWrittenValues` refuses: a field that does not apply at that level (`unknown`), a
fixed field holding another value, or what `checkValue` refuses. Values written are stored whole, with
each default the writer left without a member (`writtenValues`, `carryForward`'s rule). Required is
not checked on a write. `PUT /v1/documents/{id}/values` writes the document's own the same way, as a
version with the outline unchanged; `values_invalid` carries the failures, and `values_unresolved`
answers a write to a document whose template no longer resolves. Neither names a rule.

| Where                             | What                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `domain: metadata/write.ts`       | `checkWrittenValues` and `writtenValues`; `unknown` joins the metadata rules          |
| `domain: structure/operations.ts` | `OutlineRules`, `set`'s `values` opened and storable                                  |
| `db: src/templates.ts`            | `documentRules`                                                                       |
| `db: src/documents.ts`            | `editOutline` held to them; `recordDocumentValues`                                    |
| `api-contract: documents.ts`      | `PUT /v1/documents/{id}/values`, `DocumentView.values`, `OutlineRefusal`'s `failures` |

A publication of a document made from a template is checked at the door (W4.4), after every check
that stood before and before anything is queued: `missingSections` names each required starting
section, at any depth, that no section of the version came from, found by `origin`; then
`valueFailures` runs `validate` over the document's values and each section's, against the fields
resolved now, each failure with its node. `section_required` (TPL-013) and `metadata_invalid`
(TPL-055) carry them, with messages naming the sections and fields, which the page shows as it shows
any refusal at the door; a template that no longer resolves is `values_unresolved`.

| Where                             | What                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `domain: template/conformance.ts` | `missingSections` and `valueFailures`                             |
| `db: src/publishing.ts`           | `requestPublication`'s two checks, through `documentRules`        |
| `service: src/publishing.ts`      | The refusals, each message naming what is missing or does not fit |
| `api-contract: publishing.ts`     | `PublicationRefusal`'s `sections`, `failures` and `unresolved`    |

## Definitions

Fields, metadata schemas and component types are made and changed through `/v1/definitions`
([definitions.md](design/definitions.md), W5): `manage_definitions` at the tenant for a write, `read`
for a read, as access.md reads a definition. The service allocates a definition's identifier and cuts
every change as a version through `recordVersion`. Before either, under a transaction-scoped advisory
lock that serialises definition writes, a definition is checked in order:

1. What it names exists: `definition_unresolved`, with each missing field or schema and each stranded
   `requires`.
2. Its own defaults pass their fields (`checkSchema`): `definition_invalid`.
3. Its name is free, folded by `nameKey` and held by `definition_name`: `definition_name_taken`, MET-031.
4. Its kind's own check against what uses it:
   - a component type's schemas disagreeing about a default (`assignmentConflicts`): `assignment_conflict`, MET-008;
   - a schema version disagreeing with a schema beside it at any place, meaning a component type or a template level at its latest version (`placesOf`, `schemaConflicts`): `schema_conflict`, MET-040, naming every place;
   - a field version refusing a schema's default for it (`brokenDefaults`): `field_breaks_default`, MET-037.

| Where                          | What                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `domain: metadata/manage.ts`   | `nameKey`, `assignmentConflicts`, `schemaConflicts`, `brokenDefaults`                                |
| `db: src/definitions.ts`       | `createDefinition`, `recordDefinitionVersion`, `readDefinitionLatest`, `listDefinitions`, `placesOf` |
| `api-contract: definitions.ts` | The four routes; a payload read by its kind's own schema, with no `id`                               |
| `service: src/definitions.ts`  | The handlers, each refusal with its code and rule                                                    |

A component's values travel with its iterations (W5.2): an iteration's body may carry `values`, the
whole set, checked against the component's fields at its type's current definitions
(`componentFieldsNow`) by `unstorableValues` - a fixed value changed, a value of the wrong type, and a
`user` naming no principal of the tenant, over one query - and refused `values_invalid` with every
failure. Absent, the iteration keeps the opened version's values. A cut refuses only a fixed value that
differs at the definitions it is cut against. The component's view carries its type, its fields, the
schemas behind them and its values; `GET /v1/people` lists everybody who has signed in, for a `user`
field.

| Where                                                    | What                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `db: src/component-values.ts`                            | `componentFieldsNow`, `unstorableValues`, `listPeople`                          |
| `db: src/editing.ts`, `promotion.ts`                     | Values with an iteration, and the cut's fixed check                             |
| `api-contract: components.ts`, `editing.ts`, `people.ts` | `FieldView` and the view's metadata, `values` on an iteration, the people route |

The **metadata panel** (W5.3) is a region of the component editor beside the surface, in the `F6`
ring, wherever the component's type gives it fields. It holds `FieldsForm`, which renders a field per
data type - a `dateTime` entered in the author's zone and stored with its offset by `instantFor` - runs
`validate` on every change and shows each failure beside its field and in a live region, and hands
every change on but a value of the wrong kind. The session sends the values whole with every save,
beside the content. A definition's name is held by `createArtifact` and renamed by `recordVersion`,
whatever path writes it.

| Where                              | What                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `web: src/metadata/FieldsForm.tsx` | The form, its inputs and its live validation                      |
| `web: src/metadata/dateTime.ts`    | `instantFor` and `localIn`: a local date and time and its instant |
| `web: src/editor/session.ts`       | `values` beside `snapshot`, sent whole with every save            |
| `db: src/dev-content.ts`           | Development's Procedure type and Calibrate the scanner            |

A document's fields and its sections' (W5.4) are drawn from the document's view, which carries the
fields its template applies at each level and the schemas behind them (`fieldViews`, shared with the
component's view). `HeldFields` holds them between saves on the document page: a save a pause after
the last change - the document's through `PUT /v1/documents/{id}/values`, a section's through the
outline act's `set` - and the stored values taken back only where they differ from what it holds.

| Where                                 | What                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `web: src/metadata/HeldFields.tsx`    | Fields held between saves, saved a pause after the last change |
| `web: src/structure/DocumentPage.tsx` | The document's fields in the side column, and `saveValues`     |
| `web: src/structure/OutlinePanel.tsx` | A chosen section's fields beside its settings                  |

A component's values are held at publication (W5.5, MET-023): `requestPublication` validates each
component version it resolves against the definition versions that version recorded, and records each
failure as the request's own, `component_metadata_invalid`, naming the node, the field and what is
wrong. `assemble` fails a request holding failures, so the publication fails naming each.

## Listings

Components, documents, publications and templates are each listed a page at a time by one rule
(service-foundations.md, "Listings and idempotency, in T1"; W7). Each takes `cursor`, `limit`, `sort`
and `order`, sorts by its keys and then the artifact's id - a total order; a publication's time is to
the second, so two in one second are told apart by when each was recorded - and reads a page by keyset,
the rows after the last one shown, never an offset (API-007). A listing is read **as of its first
page**: that page records the database's snapshot, and every later one keeps only the versions and
publications the snapshot could see, by the transaction each records as `written_by` (0032), so a walk
is over one set no later write moves (SCH-022). The cursor is the base64url of the listing, sort,
order, snapshot and the last row's key and id; one another listing, sort or order gave out is refused
`400 invalid_request`. The application reads the documents, publications and templates listings to
their end with `everyPage` until their filters are the service's.

The small listings page the same way, each in one order and with no sort to choose (W7.2): spaces by
name - the readable set now in the query, so a page is never short - component types and definitions by
their latest name, as of the snapshot, and people by when each first appeared - invited or signed in - since a name is changed
in place at every sign-in; the picker sorts them by name. The access listings - grants, roles,
principals and invitations - page by id, as they did. The application reads each to its end.

Each content listing is filtered on the service (W7.3): components by space and component type,
documents by space and publishing state - the latest publication the reader may read of each, as of the
snapshot, in SQL - publications by space and document, templates by space. The page, the total and each
facet are read from one base query, `countOf` and `facetOf` running it with every filter but the facet's
own. **Documents**, **Publications** and **Templates** - the last at `#/templates` - page with Show
more through `usePagedListing`, sort with `SortChooser` and filter with `Facet`, the counts the
service's. **Components** sorts with the same chooser and takes its type facet through `Facet`, but keeps
the paging and the space facet it already had, since its answer still carries the space counts as
`spaces` beside `facets` (API-012).

| Where                                 | What                                                     |
| ------------------------------------- | -------------------------------------------------------- |
| `db: src/listing.ts`                  | `countOf`, `facetOf`, `FacetCount`                       |
| `db: src/readable-artifacts.ts`       | `readableArtifactsAs`, the predicate over a second alias |
| `web: src/listing/`                   | `usePagedListing`, `SortChooser`, `Facet`, `More`        |
| `web: src/structure/TemplateList.tsx` | The templates view                                       |

| Where                          | What                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `db: src/listing.ts`           | `listingSorts`, `keysetPage`, `snapshotFor`, `visibleIn`, `isListingRequest`       |
| `api-contract: src/listing.ts` | `listingQuery` and `nextCursor`, what every content listing takes and answers      |
| `service: src/listing.ts`      | `pageAsked` and `cursorFor`: the cursor written, and read back only by its listing |

## Idempotency

A mutating request may carry `Idempotency-Key`, 1 to 255 visible characters (API-008, W7.4). On a
permission-checked route the key is honoured inside the one transaction its decision and its work
share: `recallAnswer` locks the tenant's principal and key, then reads what is kept - the same route and
a SHA-256 of its method, path, query and body is answered from the record with `Idempotent-Replayed:
true` and the work is not done; a different request with the key is refused `422
idempotency_key_reused`; otherwise the handler runs and `rememberAnswer` keeps its answer before the
transaction commits, so a refusal, which rolls back, keeps nothing. A record is kept a day. The
development sample request takes the key through the same helper, `once`; putting an upload's bytes
answers the same image sent again with the upload as it stands, its object being named by the image's
hash; signing out needs no key; and issuing a personal token takes none, since its answer carries the
secret and a record would keep it.

| Where                         | What                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `db: src/idempotency.ts`      | `recallAnswer` and `rememberAnswer`, under the key's lock    |
| `service: src/idempotency.ts` | `keyedRequest`, the key and the request's digest, and `once` |
| `service: src/app.ts`         | The permission-checked wrapper, and the sample request       |

## Search

Everything the product holds is projected for search by its words ([search.md](design/search.md),
"Searching words, in T1"; W6). The projection is two tables in the tenant's schema, derived and never
a record: `search_entry`, one row per thing found - an artifact at its latest version, a publication,
and each section of a document, keyed by its document and node - with the columns the readable set,
the filters and the facets read and every place's words together, matched as one; and `search_text`, one row per place in an entry, with its words and
a generated `tsvector` in the entry's language's text search configuration, indexed with GIN.

`entriesOf` in `packages/domain` reads a version into entries and their places: a component's title,
each block's own words - a caption with its figure, a footnote's and a cell's paragraphs as blocks of
their own, an equation and an image by their alternatives - and each field's value as words by its
data type; a document's title and values and each section's; a publication by its document's title
and version; a template by its name and starting sections; an asset by its description; a definition
by its name. Every string is composed (NFC). `configurationFor` maps a language's primary subtag to the
configuration Postgres ships for it, or `simple`.

`insertVersion` rewrites an artifact's entries with every version the chain writes, and
`recordPublication` writes a publication's, each in its own transaction, so a thing is findable the
moment it is written (SCH-066). The migration runner rebuilds a tenant's projection whole with
`reindexSearch`, in the transaction that applies 0031 and as the tenant's owner role, on a
`TenantTransaction` over its own connection (`transactionOver`); a migration listed in `REINDEXED_BY`
does the same. A tenant with no `search_entry` table yet is skipped, which only a test migrated to an
earlier point reaches.

| Where                               | What                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `domain: src/search/entries.ts`     | `entriesOf`, `configurationFor`, `SEARCH_CONFIGURATIONS`, the kinds and the places |
| `db: migrations/tenant/0031_search` | `search_entry` and `search_text`, the `tsvector` generated and indexed with GIN    |
| `db: src/search.ts`                 | `indexVersion`, `indexPublication`, `reindexSearch`                                |
| `db: src/migrate.ts`                | `REINDEXED_BY`, and the reindex in the run that applies 0031                       |

A search is `GET /v1/search?q=` (W6.2), open to anybody signed in and answered over what they may read.
`parseQuery` in `packages/domain` composes the query and lifts out its scoped terms - `title:word`, and
`name:word` for a field by its folded name - handing the rest on in Postgres's web search syntax, and
names the queries it will not run: `empty`, and `nothing_to_match` for one that only excludes.
`searchWords` in `packages/db` resolves each scope - `unknown_field` for a name no field the reader may
read has - and runs one statement: the readable set as access.md's predicate, a definition read at the
tenant and refused, as anything is, by a grant on itself; the free words against each entry's vector and each scoped term against its place;
the count, capped at 1,000 over what matched; and for each result on the page its best place by
`ts_rank` and a passage from that place by `ts_headline`, its matched words marked. The service says
each outcome in a sentence.

| Where                         | What                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `domain: src/search/query.ts` | `parseQuery`: composing, scoped terms, `empty` and `nothing_to_match` |
| `db: src/search-words.ts`     | `searchWords`: the scopes, the one statement, the passage in pieces   |
| `api-contract: search.ts`     | `GET /v1/search`, its query and every outcome's body                  |
| `service: src/search.ts`      | The handler, and `sentenceFor`, each outcome in a sentence            |

Filters and facets (W6.3) are in the same statement. Each filter - kind, space, component type, owner,
changed, and each field's value - is a column over the matched entries, so the results are the rows
where all hold and each facet counts the rows where all but its own hold: a field's own filter is left
out of that field's facet alone. A field's values are read from the entry's stored values as its facet
names them, for the fields the reader may read, the ten commonest of each. `GET /v1/search` takes each
filter as a query parameter and answers the facets with the results.

The **Search** page (W6.4) is `#/search?q=`, the query the address's so a search can be linked to, and
a link beside the other modules. It sends the query and the facets chosen, says the outcome's sentence,
and shows each result's kind, space, where it was found and its passage, the matched words marked,
linked by `resultLink`: a component's block by `#/components/<id>/blocks/<block>`, which opens the
editor with the caret at the block - `whereBlockIs` in `packages/editor`, a footnote's paragraph at its
footnote, and a block with nothing to type into, an equation, selected whole - or says the block is
gone, and moves there again on each arrival while the component stays open, as a document does for a
node; a section by its node link. Each facet is a group of checkboxes,
each saying how many it would leave.

| Where                             | What                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `web: src/search/SearchPage.tsx`  | The page: the query, the outcome, the results and the facets    |
| `web: src/search/links.ts`        | `resultLink`, `componentAddress`, `searchAddress`, `whereFound` |
| `editor: src/identity.ts`         | `whereBlockIs`                                                  |
| `web: src/editor/ComponentEditor` | `linked`, each arrival at a block, and `LINKED_PART_GONE`       |

## The theme in the editor

The editor is handed the theme and layout a component's text is set in (themes.md, "The theme in the
editor"; W8.1). `GET /v1/presentation` answers the environment's, and
`GET /v1/documents/{id}/presentation` a document's, to whoever may read it: the theme version as
stored with each catalogue version it names, which the renderer reads by `readTheme` as the publisher
does, and the layout's measure and text block height, computed on the service by the domain's
`textMeasure` and `textBlockHeight`.

`PresentationProvider` (`apps/web/src/theme/presentation.tsx`) reads it and declares the theme's faces
with `projectFontFaces`, one `@font-face` to a file under the family `aw-face-<typeface id>`, never the
face's real name, from the renderer's own copy of the pinned files: `apps/web/src/theme/faces.ts`
imports each from `@alloy-works/fonts` with Vite's `?url`, so the build emits them beside the renderer
and both deliveries load them from there. A typeface one of whose files the renderer does not hold is
declared not at all and named in `unheld`.

**The canvas** (W8.2). The provider also injects the theme's own rules, `projectCss`, which write every
paragraph and character property but the pagination-bound under `.aw-canvas`, each length in points
times `--aw-zoom`, and the canvas's two rules: the text the layout's measure wide, `--aw-measure`, and
a narrower column scrolling sideways. The editor's markup carries the hooks those rules select by: a
paragraph's stored style as `data-style`, the place it stands in as `data-place` - by a decoration on
the surface and by `drawPlaces` on the read text, both from `paragraphPlaces`, the nearest list item,
quotation or cell - what the template sets by role as `data-role`, and each mark as `aw-mark-<mark>`.
A table's style is `data-table-style` on its figure and an image's `data-image-style`, and
`projectCss` draws each table style's rules, fills, banding and padding from them (W8.3); an image is
sized by `useStyledImages` (`apps/web/src/theme/images.ts`), which sets each at `styledSize`'s width
from its asset version's pixels, asked once by the provider. `Canvas` wraps the editing surface and
`useCanvas` makes a document's text column one canvas (W9.1, [document-view.md](design/document-view.md)),
its headings in the theme's heading roles and no card round a component, whose edges and label show on
hover, on focus and under **Show boundaries**; the page is in **Reading** or **Authoring** (W9.2), the
latter offered from the document's `mayEdit` and each occurrence's, and kept per viewer; the outline
marks the node the reader is at in the text, `useReadingPosition` (`apps/web/src/structure/position.ts`),
and choosing a node or following its link takes the text to it (W9.3); each component's label says the
version its reference resolves to and whether it is pinned or follows the latest, from the texts
route's number and the reference's mode, and in Authoring, to whoever may restructure the document,
is a button opening `VersionChoice` (`apps/web/src/structure/VersionChoice.tsx`) - **Always the
latest** and the component's versions from `GET /v1/components/{id}/versions` - whose choice is the
outline's `set` of the mode (W9.4); both are the same element whether or not the
theme has arrived, so ProseMirror's host is never remounted. The zoom - 50 to 200 per cent, or Fit -
is the provider's, kept in `localStorage`; `ZoomControl` sets it on the component page and the
document's. The component page is set in the environment's presentation and a document's page in the
document's. The style lists offer what the theme holds, and nothing edits a theme yet, so the default
theme's 0.4 (migration 0034, ET-H) gives them something to offer: Lead, Centred and Small print for
running text, Banded for a table and Half width for a figure, beside each place's default.

**The canvas as the page sets it** (W13.4). `projectCss` sets what the template decides of a block the
way the template does, measured against the PDF by the browser suite (toward STY-080): a block's spaces are
padding, named `--aw-before` and `--aw-after` so contextual spacing takes either away, with its fill,
`--aw-fill`, a colour where it has no spaces and otherwise a gradient painted between them; given each face's cap height - `projectCss(theme, { capHeight })`, which
the provider passes from `capHeight` in `apps/web/src/theme/faces.ts`, from `@alloy-works/fonts`'
`capHeightOfFile` - it adds, under `@supports (text-box: trim-both cap alphabetic)`, rules trimming each
block to its first line's cap height and its last baseline and placing the baseline by padding, which a
browser measures exactly where it rounds ascent and descent to whole pixels; a table's rules are inset
shadows, custom properties `--aw-rule-<side>`, taking no room, with a cell's first and last blocks
without their outer spaces; a list is a grid of a marker column as wide as its widest marker and its
items' text, each item a row through `subgrid`, its items their place's leading apart; a quotation's
attribution stands within its indents; preformatted text's label stands above its block; a figure
stands apart from its neighbours in a block of its own; and the application's own table and `code`
styles stand down on the canvas, which has 6pt of room either side of the measure for a table's outer
rule (`CANVAS_CSS` in `presentation.tsx`).

**A line held open as the page holds it** (issues #331 and #333, which let STY-080 be claimed). Every
paragraph style's rule also names what a line of it is - `--aw-face`, `--aw-size`, `--aw-weight`,
`--aw-posture`, `--aw-line`, `--aw-descent`, `--aw-top`, and the size and look a mark in it inherits,
`--aw-run` (registered by an `@property` as a length, so a mark inside another reads the enclosing run's
size) and `--aw-run-face`, `--aw-run-weight`, `--aw-run-posture`. A mark's markup is three elements:
its own, carrying `aw-mark-<mark>` and `data-mark-id`, which the view reads back, then
`span.aw-mark-below`, then `span.aw-mark-run`, which holds the text and is ProseMirror's content hole
(`render` in `packages/editor/src/schema.ts`); `projectCss` sets the first two as lines of the
paragraph's own text, raised and lowered by the run's growth, and the look on the third. An image in a
line stands in `span.aw-inline-image-holder` on the surface (`imageView`) and in a document's read text
(`drawImages` in `render.ts`), which `projectCss` makes a block holding a trimmed line of the text above
the image. A paragraph holding either, where the browser trims, begins and ends with a line of its own
text as `::before` and `::after`, generated content with empty alternative text, lifted by `--aw-lift`,
which every block's margin above carries, and clipped by `clip-path` where it is lifted, so a pointer
over the line above reaches that line. The clip makes it a stacking context at no `z-index`; the editor
stylesheet raises `.ProseMirror p:has(.aw-footnote-editor)` to 2, so an open footnote stays over the
paragraphs after its own, and draws a chosen inline image's outline inside its holder. A list's
marker is trimmed and padded to hold its item's row open. On the canvas the document view's headings
are blocks spaced by their heading style alone, each in a `.measured` holder the measure wide, inside
sections and components as wide as the column (`DocumentText.module.css`).

| Where                                | What                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts: src/coverage.ts`             | Each family's characters as ranges, generated and drift-checked                                                                                                                                                                  |
| `fonts: src/pinned.ts`, `metrics.ts` | Each pinned file's cap height, held to its file's `OS/2` by a test, and `capHeightOfFile`                                                                                                                                        |
| `domain: src/theme/faces.ts`         | `projectFontFaces` and `faceFamily`                                                                                                                                                                                              |
| `service: src/presentation.ts`       | The two routes                                                                                                                                                                                                                   |
| `web: src/theme/presentation.tsx`    | `PresentationProvider` and `usePresentation`                                                                                                                                                                                     |
| `domain: src/theme/css.ts`           | `projectCss`: every property but the pagination-bound; `ProjectCssOptions`, each face's cap height                                                                                                                               |
| `editor: src/places.ts`              | `paragraphPlaces`, its decorations and `drawPlaces`                                                                                                                                                                              |
| `web: src/theme/Canvas.tsx`          | `Canvas`, `useCanvas` and `ZoomControl`                                                                                                                                                                                          |
| `web: src/theme/images.ts`           | `sizeImages` and `useStyledImages`: images at their styled size                                                                                                                                                                  |
| `editor: src/styles.ts`              | `setParagraphStyle`, `setTableStyle`, `setImageStyle` and `paragraphsAt`                                                                                                                                                         |
| `web: src/theme/StyleChoice.tsx`     | The style lists: what each offers, from the theme, and the lists themselves                                                                                                                                                      |
| `editor: src/resolution.ts`          | The theme's check, kept in plugin state, and the marks it makes on what will not resolve; `textWhereAt`, where the text at the cursor stands, for the face that sets it (W-M)                                                    |
| `web: src/theme/check.ts`            | `styleCheckFor`, `markUnresolved` and `useUnresolvedMarks`: the check, from the theme, and the read text's marks; `typefaceAt`, the family setting the text at the cursor and what it lacks, which the symbol palette dims (W-M) |

## One renderer, two deliveries

`apps/web` **is** the web application, and it is also the thing the Electron window loads. There is
no second copy of the UI and no per-delivery fork of a component.

```
                    packages/domain          (content rules, platform-free)
                            |
                            v
                       apps/web              (React renderer - the whole UI)
                       /        \
          built and served    loaded by
          as a web app        apps/desktop in a BrowserWindow
```

The shell decides where to load the renderer from, and that decision is a pure function
(`resolveRendererTarget` in `apps/desktop/src/shell.ts`) so it can be tested without booting
Electron:

- **Given an environment's address** - loads it, packaged or not
  ([ADR-0022](decisions/0022-the-desktop-window-loads-the-service.md)). A session is a `__Host-`
  cookie belonging to the service's own hostname, and a window loading `file://` is a different
  origin that can hold none, so a desktop delivery without this could not sign in at all. The
  address comes from `ALLOY_SERVICE_URL`; there is no screen to ask for it yet.
- **Unpackaged** - loads `http://127.0.0.1:5173`, the Vite dev server, so a renderer edit
  hot-reloads inside the desktop window. The address is pinned to the **IPv4 loopback**, not
  `localhost`: Node 17+ resolves `localhost` to `::1` first, so a Vite server left on the default
  host binds IPv6 only and the shell's `wait-on tcp:127.0.0.1:5173` blocks forever - a hang with no
  error and no window. Vite's `server.host`, the shell's `DEV_SERVER_URL` and the `dev` script all
  name the same literal address, and a test fails when they drift apart.
- **Packaged** - loads `apps/web/dist/index.html` from disk. The renderer is built with
  `base: './'` for exactly this reason: an absolute `/assets/...` URL resolves against the
  filesystem root under `file://` and the window comes up blank.

### The service serves the renderer

The page and the API it calls are one origin, which is what lets the session cookie work in a
browser tab and in an Electron window alike.

- **In the image**, the service stage carries `apps/web/dist` at `/app/renderer` and `RENDERER_ROOT`
  names it. Without that variable the service answers the API and nothing else, which is what every
  service test does.
- **Anything under `/v1` stays the API's**, including its own "there is nothing here" as JSON.
  Anything else that matches no file is answered with the renderer's page, because the addresses a
  single-page interface owns exist only in the browser. That is `apps/service/src/renderer.ts`.
- **In development** the renderer keeps its own server on 5173 and proxies `/v1` to the service,
  passing the `Host` header through, so the environment resolves from the address in the browser's
  bar exactly as it does in production.
- **A deep link is a hash**, so the renderer's relative asset paths are never under a deep path and
  the `file://` fallback serves one as it serves the root.

## The platform bridge

Everything that differs between a browser tab and an Electron window arrives through one interface,
so nothing above it has to ask which delivery it is running in.

```ts
interface PlatformInfo {
  readonly delivery: 'web' | 'desktop';
  readonly runtime: string;
}

interface PlatformBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
  setSpellCheckLanguages(languages: readonly string[]): Promise<void>;
}
```

- The contract lives in `apps/web/src/platform/contract.ts` and is deliberately **free of DOM
  types**, because the CommonJS Electron shell typechecks against it too. `window` lives next door
  in `bridge.ts`, which only the renderer imports.
- `resolveBridge()` returns the injected bridge if the host provided one, and a browser
  implementation otherwise. The renderer never branches on "am I in Electron".
- The shell's `describePlatform` is typed to return the renderer's own `PlatformInfo`, and the
  preload's bridge is typed as the renderer's own `PlatformBridge`, so changing the contract without
  changing the shell is a **typecheck failure**, not a wrong value in a window.
- **`setSpellCheckLanguages`** (W14.7, CNT-178) is told the base languages of the components open.
  Every component editor holds its base language in `spellingFor(bridge)`
  (`apps/web/src/platform/spelling.ts`) while it is open and as it changes, and the bridge is told
  the list whenever it changes - not when it empties, since setting no dictionary would switch the
  desktop's checker off for every other field, and not when it is the list last told. A run in
  another language carries `spellcheck="false"` (CNT-147), so its language is not asked for. The
  browser's bridge does nothing: the surface sets `spellcheck`, and the browser checks it with the
  dictionaries its user enabled, which a page cannot choose. The desktop's asks the main process,
  which checks the request (`spellCheckRequest`: an array of at most eight tags in the stored
  model's shape, or refused whole and logged without its content) and maps each tag to a dictionary
  `session.availableSpellCheckerLanguages` has (`spellCheckerLanguages`: the tag's own, else its
  language's, else that language's usual one - `en-US` for English, `de-DE` for German - else any of
  it, else dropped) before `setSpellCheckerLanguages`; one that maps to none leaves the dictionaries
  as they were. **On macOS nothing is set**: Electron checks with the system's checker there, which
  chooses its own languages, and `setSpellCheckerLanguages` does nothing. The window's context menu,
  over a misspelled word, offers up to five of the checker's suggestions and **Add to dictionary**
  (`spellingMenu`); the decisions are `apps/desktop/src/shell.ts`'s and `main.ts` carries them out.
  A word added is kept in the app's own dictionary, and cannot yet be removed. Chromium on Windows
  and Linux fetches a dictionary it does not hold from Google's servers the first time it is set,
  which the shell has not changed.

### The cross-process surface

| Direction        | Mechanism                        | Channel                             |
| ---------------- | -------------------------------- | ----------------------------------- |
| Renderer -> main | `ipcRenderer.invoke` via preload | `alloy-works:platform-info`         |
| Renderer -> main | `ipcRenderer.invoke` via preload | `alloy-works:spell-check-languages` |

Rules that hold for every channel added later:

- **The renderer is untrusted.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The preload exposes a narrow, enumerated surface - never a general "run this
  `fs` call for me" bridge.
- Every handler **validates its own arguments in the main process**. The renderer having already
  checked is not a check.
- Channels are namespaced (`alloy-works:`) so an unrelated handler cannot answer them, and the
  channel name and the injected global name are pinned by tests in `apps/desktop/src/shell.test.ts`.
  A rename on one side without the other is a blank window, not a build error.
- Every handler **answers the renderer and nothing else**: it refuses a call whose frame is not the
  renderer's own address - its origin where it is served, its file where it is loaded from disk
  (`isRenderer` in `shell.ts`). And the window **stays on the renderer**: a link out of it opens in the
  system browser, a page never opens a window of its own, and anything the system would run is
  refused (`navigationDecision`, `opensExternally`). A sign-in that has left for the identity provider
  goes on, since the provider's pages navigate, and the bridge refuses whatever page it is on. A
  server's redirect is held to the same rule, save one a sign-in route began (`redirectDecision`), and
  the bridge's own check is `isTrustedFrame` (issue #309).

## Data flow today

The renderer asks the bridge which delivery it is running under, and, once somebody is signed in,
lists the components they may read. Each component open tells the bridge its base language, for the
spelling checker. Opening one fetches it at its latest version; its first change
claims the lock, changes go back as iterations after a pause, and Save version and Done editing cut
versions from them. Beside the components, it lists the documents they may read; opening one fetches
its outline at its latest version, numbers its sections in the page, and sends each structural act
back alone, carrying the version it was made against, to be answered with the outline as it now
stands - every call through the generated client.

Beside it, the web service answers HTTP on its own: a request's hostname names a tenant, found in the
platform table; the service reads that tenant's data only through `withTenant` in `packages/db`,
which assumes the tenant's role for one transaction
([ADR-0020](decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)); and every
answer and every error follows the contract in `packages/api-contract`, from which the committed
`openapi.json` is generated and checked. People sign in through their organisation's identity
provider - in development and tests, the stand-in - and hold a session in their environment's own
schema, which `GET /v1/me` and signing out use. The environment's client secret for that provider is
its own, sealed into its `identity_provider` row by `configureOrganisationSignIn` with the key its store
credential is sealed with, and opened for that tenant alone; `oidc.ts` keeps each provider's discovered
metadata and published keys by issuer, holding no secret, and makes every start and exchange a
configuration of its own from the client id and secret it is handed, so no environment exchanges with
another's secret. An environment whose secret is named from before 0042, or does not open for it, is
refused as a closed route and logged once while the process runs. The Google
route's one client secret is the product's, in the service's secret store (IAM-041). A script presents a personal token as a bearer instead,
which acts as the person who issued it, masked to its scopes ([Personal tokens](#personal-tokens)). An environment may also take Google accounts:
Google returns to the one sign-in address, `signin.<domain>`, which checks the account against the
environment's invitations and named Workspace domains and hands the sign-in back to the environment
with a one-time code. Work a request should not wait for goes on a queue in the platform schema - a
tenant, a kind and an id, never content - which a worker claims with `SKIP LOCKED` under a lease and
then does inside that tenant's schema. There are two kinds: one renders a sample PDF, and `publish`
makes a document into a publication ([below](#publishing)); both compile with the pinned Typst, set
only in the pinned faces, and keep the PDF in the tenant's own corner of the object store, which its
own credential is the only one that reaches. Every store is tenant-scoped - the search projection,
objects, publications, the object store's credentials, sessions and tokens, and the caches - but a
sign-in client secret, read from the service's one secret store by the name a tenant's row gives;
store by store in [service-foundations.md](design/service-foundations.md#tenant-scope-of-every-store).
A signed-in viewer can hold one stream
open on their environment,
`GET /v1/stream`: it sends a snapshot of what is there, then ids as things happen. A worker's own
transaction notifies a channel named for its tenant, so nothing is announced that did not commit and
a tenant can speak on no other channel; one listening connection in the service fans that out to the
streams it holds. A stream registers with the fan-out and waits for its subscription's `ready` - the
database has acknowledged the `LISTEN` covering its channel - before its snapshot is read, and holds
what arrives until the snapshot has gone, so nothing committed in between is lost or overtaken by
older state. `ready` rejects rather than waits when the `LISTEN` cannot be made or the listener is
closed, and the stream then ends for the browser to come back. Nothing in the renderer calls it:
that arrives with the scaffolding's last plan (see [`plans/`](plans/)). The rest of the proposed
system is [`design/system.md`](design/system.md).

## Publishing

A document's latest version made into a tagged PDF of its outline and its paragraphs, laid out by a
layout, kept for ever, listed with the document and downloaded, designed in
[`design/publishing.md`](design/publishing.md) and built by
[the first publishing plan](plans/2026-09-19-publishing-01-a-document-to-pdf.md) and then by
[the second](plans/2026-09-19-publishing-02-the-layout.md), which added the layout, and
[the marks plan](plans/2026-09-20-editor-03-marks-and-links.md), which carried a run's marks into it,
and then by [the lists plan](plans/2026-09-21-editor-04-lists-and-quotations.md), which carried lists,
[editor 5](plans/2026-09-21-editor-05-quotations-and-preformatted-text.md), which carried quotations
and preformatted text, and [tables 2](plans/2026-09-22-tables-02-publishing-tables.md), which carried
tables and the list of tables, and each later publishing plan - figures, footnotes, cross-references
and [equations 2](plans/2026-09-24-equations-02-publishing-equations.md), which carried equations and
the maths face - described in its bullet below - and
[themes 1](plans/2026-09-24-themes-01-the-theme-in-the-pdf.md), which set every publication from a
stored theme, and [themes 2](plans/2026-09-24-themes-02-table-and-image-styles.md), which set its
tables and images from their styles, and [Word 1](plans/2026-09-25-word-01-a-publication-in-word.md),
which made a publication a PDF, a Word document or both, and
[Word 2](plans/2026-09-25-word-02-lists-tables-and-figures.md), which carried lists, quotations,
preformatted text, tables, figures and images into Word, and
[Word 3](plans/2026-09-26-word-03-footnotes-and-cross-references.md), which carried footnotes and
cross-references, and [Word 4](plans/2026-09-26-word-04-equations.md), which carried equations,
designed in [`design/word-output.md`](design/word-output.md).
Every page says **Not approved**, because nothing can approve a publication yet. A run's emphasis,
strong, underline, subscript, superscript, inline code, quoted phrase, link and language are
published; a defined term, a condition, a suggestion and a comment are refused by name, and so are
a citation, a variable and a binding in a line of text. Every block the content model holds is
published, and every other inline item - an image, a footnote, a cross-reference and an equation - each set from the environment's theme, tables and images from their table and image styles. A Word document carries a document's paragraphs, headings, marks, links and languages, its lists, quotations, preformatted text, tables, figures and images in a line, its footnotes as Word's own, its cross-references as fields Word updates and its equations as Word's own, OMML from the maths tree the PDF sets, and its page - the cover, the contents, the lists after the contents, the running heads and feet and the notice - and refuses by name what Word would print otherwise than the PDF: a number Word's fields cannot compute (`numbering_not_in_word`, `list_not_in_word`) and a reference whose field would print other words (`cross_reference_not_in_word`); a heading or a listed caption whose equation Word's rebuilt entries set as its runs alone it reports, and, since W14.6, every structure the PDF tags that Word has no place for - a description's language, a quotation, preformatted text, a definition list, a quoted phrase, inline code, a numbered equation set as a table, and once an equation's alternative and the maths face's unchecked characters, the titles the PDF tags as headings and Word sets as body text, and a list of figures it cannot link ([word-output.md](design/word-output.md#accessibility-pub-100)); a maths character Cambria Math lacks it reports only as unchecked, never by character. A list of equations in the default layout, preview and review in Word are later slices'. Nothing chooses or edits a
layout or a theme: every environment has the ones its migrations seeded, and every document publishes under them.

| Where                                                        | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db: migrations/tenant/0017_publishing`                      | `publication` as a kind of artifact, in exactly one space; the Publisher role; `publication_request` and `publication_request_occurrence`, the operational rows a job works from; `publication`, `publication_input` and `publication_output`, the record; and the grants and triggers that hold it, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: migrations/tenant/0018_layouts`                         | `layout` as a kind of artifact, in no space; the product's default layout seeded as version 0.1 and declared by `layout_default`, one row the runtime role reads and never changes; `layout_id` and `layout_version_id` on a request and on a publication, keyed into `artifact_version`, and the checks and triggers that hold them, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `db: migrations/tenant/0019_default_layout_lists`            | The default layout's version 0.2, declaring a list of tables, as literals `default-layout.test.ts` recomputes from `defaultLayout`; inserted only where version 0.1 is 0018's own, by its content hash, and nothing later exists, so an environment's own layout is never overlaid. A request made under 0.1 keeps it and publishes with no list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db: migrations/tenant/0021_default_layout_figures`          | The default layout's version 0.3, declaring a list of figures before the list of tables, as literals `default-layout.test.ts` recomputes; inserted only where 0.2 is 0019's own, by its content hash, and nothing later exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `db: migrations/tenant/0022_publication_assets`              | `publication_request_asset`, each image a request's components place that its publisher may read, and `publication_asset`, each image a publication printed; each keyed into `artifact_version` as an asset, insert-only, written only while its request is queued; and `publication_recorded_whole` again, holding a publication's images to exactly its request's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `db: migrations/tenant/0023_default_layout_relative_words`   | The default layout's version 0.4, at layout schema 3 with the words for a relative cross-reference, _above_ and _below_, as literals `default-layout.test.ts` recomputes; inserted only where 0.3 is 0021's own, by its content hash, and nothing later exists. A request made under 0.3 keeps it, and a relative reference under it fails by name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `db: migrations/tenant/0024_themes`                          | `theme` and `catalogue` as kinds of artifact, in no space; the default theme's six catalogues seeded as version 0.1 each under the fixed version identifiers the theme names, and the theme as version 0.1, as literals `default-theme.test.ts` recomputes from the domain's data; `theme_default`, one row the runtime role reads and never changes, declaring it; `theme_id`, `theme_version_id` and `theme_kind` on a request and on a publication, keyed into `artifact_version`, and the checks and triggers that hold them, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `db: migrations/tenant/0025_table_and_image_styles`          | The default theme's 0.2: the paragraph, table and image catalogues' version 0.2 at `catalogue/2` under fixed identifiers, each inserted only where its own chain is still 0024's unauthored 0.1 by its content hash with nothing after it, and the theme's 0.2 naming them only where the theme is still 0024's 0.1 and all three went in; and the default layout's 0.5, at layout schema 4 with `continued`, only where 0.4 is 0023's own. Literals `default-theme.test.ts` and `default-layout.test.ts` recompute. Each chain is judged on its own: an environment that recorded its own theme version gets catalogue 0.2s nothing names, and one that recorded its own version of any of the four stays on theme 0.1. A request made under 0.1 keeps it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: migrations/tenant/0026_word`                            | The default theme's 0.3: 0.2 with STIX Two Math declaring `embedding.word: false` and `wordFamily` Cambria Math, since Word cannot embed its CFF outlines; binding 0.2's six catalogue versions; inserted only where the theme's latest is 0025's unauthored 0.2, by its id and content hash, with nothing after it. Literals `default-theme.test.ts` recomputes. A request made under 0.2 keeps it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `db: migrations/tenant/0027_word_layout_and_outputs`         | The default layout's 0.6, at layout schema 5 with a `docx` member copying the PDF's page, only where 0.5 is 0025's own; `formats` on a request and a publication one of `{pdf}`, `{docx}` and `{pdf, docx}`; a publication's `engine`, `engine_version`, `template` and `template_version` null exactly where it has no PDF (`publication_made_by_typst`); `publication_output` taking `docx`, its `standard` `ua-1` for a PDF and null for Word, and gaining `producer` (`typst` or `word`), `producer_version` (the template's version, or `word/<n>`) and `report` (an array, empty but for Word), backfilled for every existing output from its publication; and `publication_recorded_whole` redefined, holding one output per format the publication names and a Typst output's version to the publication's template                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `db: migrations/tenant/0034_default_theme_choices`           | The default theme's 0.4 (ET-H): the paragraph, table and image catalogues' third versions at `catalogue/2` under fixed identifiers - 0.2's with Lead, Centred and Small print, Banded, and Half width added - each inserted only where its own chain is still 0025's unauthored 0.2, by its id and content hash, with nothing after it, and the theme's 0.4 naming them only where the theme is still 0026's 0.3 and all three went in. Literals `default-theme.test.ts` recomputes. An environment that recorded its own version of any of the four stays on theme 0.3. A request made under 0.3 keeps it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: migrations/tenant/0035_previews`                        | `publication_request.kind`, `publish` (the default, so every earlier request is one) or `preview`, granted on insert and frozen by `publication_request_finish_once`; a preview asks for `{pdf}` alone (`publication_request_preview_pdf_alone`); `preview_key`, `preview_sha256`, `preview_bytes` and `expires_at`, granted on update, all four exactly on a done preview and on nothing else (`publication_request_preview_whole`, `publication_request_preview_only`), the key ending in its digest, a digest, more than no bytes and an expiry after it finished (`publication_request_preview_output`), and the key in the tenant's own store, checked by the finish-once trigger; `publication_recorded_whole` redefined to ask a publication of a done publish request only; and the default layout's 0.7, at layout schema 6, only where 0.6 is 0027's own. Literals `default-layout.test.ts` recomputes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db: migrations/tenant/0036_preview_sweep`                   | `delete` on `publication_request` granted to the runtime role, and nothing else of what 0017 and 0022 revoked; `publication_request_swept_only`, a `before delete` trigger refusing any request but a preview finished an hour ago or more by the database's clock, whatever role deletes it; an index on a preview's `finished_at`. A request's occurrences and images go with it by 0017's and 0022's `on delete cascade`, which no trigger refuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `db: migrations/tenant/0040_publication_check`               | `publication_check` (W14.1, W-C): a PDF output's check by veraPDF - the checker and its version, the profile `ua1`, `compliant`, `failed_rules` as a bounded array of `{ clause, test, description? }`, veraPDF's whole report as `report_key`, `report_sha256` and `report_bytes` (PUB-091: the report retained), its key naming its digest and held to the tenant's own prefix by `publication_check_report_in_own_store`, which reads `tg_table_schema` as 0017's output trigger does, and `checked_at`, the database's - keyed to its output and deleted with it and its publication; the runtime role selects and inserts it by what was found alone, and never updates or deletes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: migrations/tenant/0041_publication_check_given_up`      | `publication_check_given_up` (W14.1, from its final review): a PDF output the check sweep left after its checks gave up `CHECK_GIVE_UPS` times, with `give_ups` and `given_up_at`, the database's, keyed to its output and deleted with it and its publication; the runtime role selects and inserts it by publication, format and count alone, and never updates or deletes it. `readPublication` answers it as each output's `checkGaveUp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `db: migrations/tenant/0043_default_theme_caption_placement` | The default theme's 0.5 (W14.5): the table and image catalogues' fourth versions at `catalogue/3` under fixed identifiers - 0.4's, each style stating `caption`, a table's above and a figure's below - each inserted only where its own chain is still 0034's third version, unauthored, and the theme's 0.5 naming them only where the theme is still 0034's 0.4 and both went in; literals `default-theme.test.ts` recomputes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `domain: publishing/layout.ts`                               | The layout's stored shape at schema 6, strict at every depth, with `matter.lists` - the generated lists it declares, each sequence once, each with its title - `words.above` and `words.below`, both or neither, the words a relative cross-reference prints, and `words.continued`, required from schema 4, the words a continued table's label adds, and `words.preview`, required from schema 6, the notice and sentence a preview says in place of the draft's; `formats.pdf` and, from schema 5, an optional `formats.docx`, each a `PageFormat` held to the same rules, the Word page no more than 1584pt each way; `PUBLISHING_FORMATS`, `pdf` then `docx`; `layoutWordsSchema`, the words alone; `parseLayout`, `readLayout` and its migration chain, which reads a schema 1 layout as declaring no lists, a schema 2 one as having no words for above and below, one before schema 4 as having no `continued`, one before schema 5 as having no Word page, and one before schema 6 as having no words for a preview; `FIRST_DEFAULT_LAYOUT`, 0018's literal, `SECOND_DEFAULT_LAYOUT`, 0019's, `THIRD_DEFAULT_LAYOUT`, 0021's, `FOURTH_DEFAULT_LAYOUT`, 0023's, `FIFTH_DEFAULT_LAYOUT`, 0025's, and `SIXTH_DEFAULT_LAYOUT`, 0027's, all frozen, read through today's chain when the module loads, and `defaultLayout`, 0035's; `speaksFor` (RFC 4647 basic filtering) and `unsupportedFormats`                                       |
| `domain: publishing/outputs.ts`                              | `OUTPUT_CONTENT_TYPES`, each format's media type; an output's report, `outputReportSchema`, a list of closed entries, each once - `face_substituted` with the theme's family and the Word family it became, `no_page_cited_output`, `pages_cite_the_pdf`, and `header_column_lost`, `header_repeated` and `continuation_label_omitted`, each naming a table by its node, block and label, `equation_flattened`, naming a heading - its block null - or a listed caption by its node, block and number or label, and W14.6's, each structure the PDF tags that Word has no place for: `description_language_lost`, `quotation_not_structure`, `preformatted_not_structure` and `definition_list_not_structure`, each by its node and block, `quoted_phrase_not_structure` and `inline_code_not_structure` by the node and block of their runs, never a heading's, which carries no mark, `equation_numbered_as_table` by its node, block and label, and, once for a document setting an equation, `equation_alternative_lost` and `maths_coverage_unchecked` with the Word family the maths is set in; and, from W14.6's final review, `titles_not_headings`, once for every document, naming which of the document's, the contents' and the lists' titles stand in it, and `list_not_linked`, a list after the contents Word cannot link, by its sequence, only `figure` - and `parseOutputReport`, which the store reads and writes through |
| `domain: word/`                                              | The Word writer (below): `writeDocx`, `WORD_WRITER_VERSION` (`word/5`); `omml.ts`, `omml`, an equation's maths tree as OMML, and `inOneRow`, whether it is runs alone, which Word's rebuilt entries keep as they are; `numbering.ts`, the heading numbering definitions, `captionField`, the one shape a caption's number is written in, `sequenceNames`, each sequence's `SEQ` names in the document's order - an equation's `EquationFront` and `Equation` - `footnoteSections` and `footnoteProperties`, the sections Word counts footnotes in and each one's `w:footnotePr`, and `numberingNotInWord`, which follows Word's caption fields and footnote counts through the outline; `lists.ts`, a list's numbering definition, its marker's width and `listsNotInWord`; `advances.ts`, a face file's advances, `faceAdvances`; `spacing.ts`, `spacingOverrides`, what Word would read differently of the spaces the PDF wants; `panels.ts`, `panelsApart`, which panels to stand a twip further in; and `fonts.ts`, a face's key and its obfuscation                                                                                                                                                                                                                                                                                                                                                                                     |
| `db: src/layouts.ts`                                         | `DEFAULT_LAYOUT_ID` and `defaultLayout(trx)`: the environment's declared layout at its latest version, parsed, throwing where the environment declares none or the content does not read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `domain: theme/`                                             | The theme model (see [workspaces](#workspaces)): `catalogue/3`, `catalogue/2` frozen as `catalogueSchema2` and read by `upgradeCatalogue2`, `catalogue/1` read by `upgradeCatalogue1`, and `theme/1`, `readCatalogue` and `readTheme`, contrast, `DEFAULT_THEME`, `DEFAULT_CATALOGUES` and `DEFAULT_CATALOGUE_VERSIONS` at 0.5, the `FOURTH_DEFAULT_*` at 0.4, `THIRD_DEFAULT_THEME` at 0.3 and `SECOND_DEFAULT_THEME` at 0.2, frozen, the `SECOND_DEFAULT_CATALOGUE*` both name, and their `FIRST_*` 0.1s, and `projectTypst`, which `assemble` puts in `publishing/15`, and `projectTypst12`, `publishing/12`'s, frozen; and the Word projection the writer includes, `projectStylesXml`, every paragraph and character style as a Word style with every property stated, and `wordRun`, a run's character style and what Word's toggling would lose pinned beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `db: src/themes.ts`                                          | `DEFAULT_THEME_ID`, `DEFAULT_CATALOGUE_IDS`, `defaultTheme(trx)` - the declared theme at its latest version, read through `readTheme` with the catalogue versions it names, throwing where it does not read - `themeAt(trx, versionId)`, a recorded one, and `addCatalogueVersion` and `addThemeVersion`, the only writers, refusing whatever the reader refuses and a catalogue version bringing back a style identifier an earlier version dropped (`style_reused`); a catalogue is judged unchanged against its latest version as the reader reads it, so a `catalogue/1` saved again, upgraded or not, records nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db: src/publishing.ts`                                      | `resolveOccurrences` and `requestPublication`, which resolve every reference as the publisher - restricted to what they may read inside the query - and every image the resolved components place, by the same readable-set predicate, and record the request, its formats, its occurrences, its images, the declared theme's latest version and its job, refusing a request without `pdf` where anything the resolved content or a section's title holds cites a page (`page_reference.without_pdf`, PUB-074); `requestPublication` told the kind, a preview asked for by the same code path, the PDF alone, and queued as a `preview` job; `publicationInputs`, which returns the recorded kind, formats and theme, `recordPublication`, which takes one output per format the request names, each with its producer and, for Word, its report, and refuses a preview, `recordPreview`, which records a preview's PDF on its request and finishes it done, expiring an hour later, and refuses a publish, and `failPublicationRequest`, the job's; `readPublicationRequest`, with the request's kind and a done preview's PDF and expiry, `readPublication` and `listPublications`, the routes'; `sweepPreviews`, the worker's sweep, below                                                                                                                                                                                                |
| `api-contract: publishing.ts`                                | The five routes below and their schemas - a request's `formats`, a preview's body, the version alone, a request's `kind` and a done preview's `preview`, its links and expiry, and a publication's `outputs`, one per format, each with its standard, producer, producer version, report and links; `DocumentView.mayPublish` and `DocumentView.layout.formats`, the formats the layout makes, are in `documents.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `service: src/publishing.ts`                                 | Their handlers, a publish's and a preview's answered by one mapping, `answered`, and a request's view by `requestView`, which signs a lasting preview's links; `DOWNLOAD_SECONDS`, the five minutes a download link is signed for, which the sample routes in `app.ts` use too; `storageUnavailable`, shared with them, is in `errors.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `objects: src/store.ts`                                      | `signedLink(key, seconds, fileName?)`: a file name sets the download's `Content-Disposition`, and is refused unless it is a lowercase identifier and an extension, so nothing a header could be split on is ever signed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `worker: src/jobs/publish.ts`                                | The `publish` job, and the `preview` job it also runs, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `worker: src/jobs/check.ts`, `src/verapdf.ts`                | The `check_pdf` job, and the worker's veraPDF and the server-mode protocol it shares with the suite's, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `worker: src/sweep.ts`                                       | `sweepExpiredSignIns`, and `sweepExpiredPreviews`, which `main.ts` runs on the same interval: below; `sweepExpiredIterations` beside them (see [the editor and its session](#the-editor-and-its-session))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `worker: templates/publication/1/` to `15/`                  | The publication templates, below: version 1 reads `publishing/1`, version 2 the document under a layout (`publishing/2`), version 3 that document with a run's marks set (`publishing/3`), version 4 that document with lists (`publishing/4`), version 5 with quotations and preformatted text (`publishing/5`), version 6 with tables and the lists after the contents (`publishing/6`), version 7 with figures (`publishing/7`), version 8 with an image in a run of text (`publishing/8`), version 9 with footnotes and a table's note (`publishing/9`), version 10 with cross-references and the labels they name (`publishing/10`), version 11 with equations in the maths face and a node's title as runs (`publishing/11`), version 12 the same set from its theme (`publishing/12`), version 13 with its tables and images set from their styles (`publishing/13`), version 14 with a table or a figure marked unnumbered left out of its list (`publishing/14`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `worker: templates/publication/1/` to `14/`                  | The publication templates, below: version 1 reads `publishing/1`, version 2 the document under a layout (`publishing/2`), version 3 that document with a run's marks set (`publishing/3`), version 4 that document with lists (`publishing/4`), version 5 with quotations and preformatted text (`publishing/5`), version 6 with tables and the lists after the contents (`publishing/6`), version 7 with figures (`publishing/7`), version 8 with an image in a run of text (`publishing/8`), version 9 with footnotes and a table's note (`publishing/9`), version 10 with cross-references and the labels they name (`publishing/10`), version 11 with equations in the maths face and a node's title as runs (`publishing/11`), version 12 the same set from its theme (`publishing/12`), version 13 with its tables and images set from their styles (`publishing/13`), version 14 with a table or a figure marked unnumbered left out of its list (`publishing/14`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `worker: src/fonts.ts`, `src/metrics.ts`                     | The pinned files by family, `covers(codePoint, family)`, each file's `metrics` by its hash, `pinnedFacesByHash`, every pinned file's bytes by its hash, hash-checked as the compile reads them, for the Word writer to embed, and `typefacesNotHeld(theme, fonts)`, the faces a theme declares that the worker does not hold exactly - its family's files, their metrics, a maths face's `MATH` table - each with why, `files`, `metrics` or `maths`; `faceMetrics(bytes)`, a face's units per em, ascender, descender and advances, and whether it has a `MATH` table, read from the file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `web: src/publishing/`                                       | `Publishing.tsx`, the panel beneath a document's outline; `Preview.tsx`, a preview asked for from the document page and shown in a pane beside its text (below); `following.ts`, how a publish's or a preview's request is followed and the words it is refused in, shared by both; `FailureList.tsx`, a request's failures at their places; `PublicationPage.tsx`, a publication's own page at `#/publications/{id}`; `failures.ts`, each failure's words; `formats.ts`, a publication's formats in words and a Word output's report as sentences, `reportLines`: one per entry, but each kind named by its place alone - a quotation, a quoted phrase, inline code, preformatted text, a definition list, a description's language - said once, counting its places                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Five routes.**

| Route                                  | Decided                        | Answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/documents/{id}/publications` | `publish` on the document      | `200` and the request, queued. `403` naming only the permission to a reader who may not publish; `404` for anything that is not a document the caller may read; `409 version_precondition`, naming the version the document is at by its heading alone and never its outline (IAM-073), when the version named is not the latest; `400 format_unsupported` naming each format the document's layout does not make; `400 layout_language` where the layout's words are not in a language the document's tag matches, naming both tags; `400 page_reference_without_pdf` where `pdf` is not asked for and the document cites a page. Each is refused before anything is queued                                                                                                                                                                                                          |
| `POST /v1/documents/{id}/previews`     | `read` on the document         | `200` and the request, of kind `preview`, queued, asking for the PDF alone. The body is the version alone, and a format in it is refused `400 invalid_request`. Refused as a publish is, by the same mapping: `404` for anything that is not a document the caller may read, `409 version_precondition`, and `400 format_unsupported`, `layout_language` and the template's refusals. Each is refused before anything is queued. An `Idempotency-Key` is honoured, as on every mutating permission-checked route                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /v1/publication-requests/{id}`    | A session; the requester alone | The request's kind, its state, its failures, and its publication once done; for a done preview that has not expired, by the service's clock, `preview`: `view`, a link with no file name that a browser shows, `download`, saving it as `{id}-preview.pdf`, each signed for `DOWNLOAD_SECONDS`, and `expiresAt`. Once it has expired, and for a publish, `preview` is null. A lasting preview with no object store configured is answered `503 storage_unavailable`. Anybody but the requester is answered `404`, as for no such request, and so is a preview's requester who may no longer read its document, decided at every answer                                                                                                                                                                                                                                                |
| `GET /v1/documents/{id}/publications`  | `read` on the document         | The document's publications the caller may read - each decided on the publication itself, inside the query - newest first, each with its version, title, publisher, time, approval and formats. `404` for an id that is not a document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /v1/publications/{id}`            | `read` on the publication      | The record - the version, the formats, the engine and the template where it has a PDF, the pipeline - and each output with its size, digest, standard, producer, producer version and report and a link signed for `DOWNLOAD_SECONDS`, which saves the file as the publication's id and `.pdf` or `.docx`, never the title, because the link's query string reaches the store's logs, and for the PDF alone a `view` link a browser shows and its `check`, what veraPDF found of it with its whole report's size, digest and a link signed the same way that saves it as `{id}-verapdf.json`, or none until it is checked, and its `checkState` - `pending`, `passed`, `failed`, or `gave_up` where the check sweep left it - which the contract holds to agree with `check`. `404` for an id that is not a publication; `503 storage_unavailable` where the environment has no store |

`publish` is decided by the route helper in the transaction the handler runs in, under the access
epoch's shared lock, and `requestPublication` resolves and records **in that same transaction**, so no
grant can change between the decision and what the publisher's read resolved to. A preview is decided
the same way on `read`, and recorded by `requestPublication` told the kind, in its transaction. A document's answer
carries `mayPublish` beside `mayEdit`, decided the same way. A publication's readers are decided on the
publication artifact, in the document's space: a grant on the document alone reaches none of its
publications. **Nothing goes on the stream**: the stream still sends every event to every viewer
(issue #147), so the requester follows the request by asking instead.

**The panel and the page.** Beneath a document's outline and its lists, **Publications** lists what the
reader may read, each as its version, who published it and when, and what it was made in and that it
is not approved, **(PDF and Word, not approved)**; somebody who may publish is offered **Publish as
PDF**, which asks for the version on the page. Where the layout makes Word, which the document's
answer says in `layout.formats`, a **Publish as** group of three radio buttons comes first - PDF,
chosen, Word, and PDF and Word - and the button's name follows the choice. The panel then asks
about the request a second later, and twice as long after each answer that it is still queued, up to
half a minute, one ask at a time and none after the page closes - but it does not stop while the page is
open. Following starts from the click, not from an effect, so React's StrictMode cannot start a second
follower. A refused publish lists every failure at once, each at its place in the outline the page
holds - its section number and its name, **A component** where the reader may not read it - and a
failure of the engine or the store is introduced as the product's, not the document's. A publication's
page shows its title, the draft notice's sentence from the domain, who published which version and
when, the engine and template where there is a PDF, and the Word writer's version where there is a
Word document, a download for each - **Download the PDF**, **Download the Word document** - the PDF
shown in the page and a Word document never, the Word report as a sentence per entry - each kind named by a place alone once, counting its
places - under **About the Word document**, what veraPDF found of the PDF - **Not yet checked for accessibility.** until the
check has run, **Could not be checked for accessibility.** where its checks all gave up and the sweep
left it, then **Checked for PDF/UA-1 by veraPDF 1.30.2: passed.** or **Checked for PDF/UA-1 by
veraPDF 1.30.2: 2 rules failed.** with each rule listed by its clause, its test and veraPDF's words under **Rules the PDF failed**,
and **Download the full report**, veraPDF's own JSON, once checked -
and **Open the document**. A download is a signed
link to the store's own address. It expires five minutes after the page opened; in the desktop app it
opens in the system browser, since the window stays on the renderer (issue #309).

**The record is held by the database.** The runtime role inserts and reads the record and never changes
it, and inserts a request by what was asked alone, so every request starts queued, under its own id and
at its own time. Triggers let a request finish once, from queued to done or failed, and only the move
to failed write its failures; `done` is refused while it carries any. Occurrences, a publication's
inputs and its output are taken only while the request is queued, and an output's key must name its own
digest in its own tenant's store. A constraint trigger checked at commit refuses a publication not
recorded whole. Three gaps are named rather than closed, each reachable only by SQL written as the
runtime role: a version row can be inserted for a `publication` artifact; a request can be moved to
`done` with no publication behind it; and a publication's inputs are read from the request's
occurrences when the record is made rather than carried from what the job compiled.

**The layout is held there too.** A request is made under a layout version and records it by its key;
finishing the request never changes it; and the commit-time rule requires a publication's layout
version to be exactly its request's, null for null, so a publication can neither name another layout
nor drop the one it was made under. **A publication is recorded with template 1 exactly when it has
no layout, and with a later template under one**, by the check
`(template_version = 1) = (layout_version_id is null)`; under a layout that template is 3 today and
was 2 before a run carried its marks, and the publications made with 2 keep it. A request queued
before migration 0018 keeps
no layout and publishes under template 1 as it would have: 0018 updates no existing row and disables
no trigger, and closes the new columns with a check on the pair and a **before insert** trigger
rather than a `NOT VALID` check, which Postgres would have applied to every update and which would
have left such a request unable to finish at all.

**The theme is held the same way, from migration 0024.** A request is made under the declared theme's
latest version and records it by its key, a before-insert trigger (`publication_request_made_under_a_theme`)
refusing one made without; finishing the request never changes it; and the commit-time rule requires
a publication's theme version to be exactly its request's, null for null. The theme's version is the
one key needed: it names its six catalogue versions, and all seven are immutable. Unlike the layout,
the theme is not tied to the template's version. **A request made before layouts keeps no theme**, as
it keeps no layout, and publishes under template 1, which reads none; 0024's backfill gave the theme
only to a request still queued under a layout, holding `publication_request_finish_once` off for that
one statement inside the migration's transaction, since the trigger refuses any update that leaves a
request queued. So `publicationInputs` answers a theme exactly where it answers a layout. Migration
0025 adds the theme's 0.2 as 0023 added a layout version: a request made at 0.1 and still waiting
keeps it, and one made after records 0.2; 0026 adds its 0.3, 0034 its 0.4 and 0043 its 0.5 the same
way.

**Formats and outputs, from migration 0027.** A request and its publication name `{pdf}`, `{docx}` or
`{pdf, docx}`, the publication its request's. A publication without a PDF has no engine and no
template (`publication_made_by_typst`), and still records the pipeline, the fonts, the data's digest
and the numbering, since one `assemble` made every output. Each output row says what made it: `typst`
and the publication's template version, with standard `ua-1` and an empty report, or `word` and
`word/<n>`, with no standard and a report the domain's `outputReportSchema` holds on the way in and
out, the database checking only that it is an array. The commit-time rule holds exactly one output
per format the publication names, where it held exactly one. The migration backfilled every existing
output as Typst's under its own publication's template, the one update an output row has ever taken,
made as the owner; the runtime role still has none.

**Previews, from migration 0035** (publishing.md, "Preview"). A request has a kind, `publish` or
`preview`, named at the insert - a publish by the column's default, so every earlier request is one -
and frozen by `publication_request_finish_once`. A preview is asked for by `requestPublication` down
the same code path as a publish, every check and refusal alike, recording the same occurrence, image,
layout and theme versions a publish of that version would (PUB-006); it differs in asking for `{pdf}`
alone, anything beyond it answered `format.unsupported` by name and refused by a check besides, and
in its job, a `preview`, on the same queue. A done preview carries its PDF on its request - its key in
the tenant's store, ending in its digest, the digest, its size - and when it expires, an hour after it
finished; all four exactly when a preview is done and on nothing else, written only in the move that
finishes it, and the key held to the tenant's own store by the finish-once trigger, as an output's is
by `publication_part_while_queued`. `recordPreview` writes them, locking the request as
`recordPublication` does; `recordPublication` refuses a preview and `recordPreview` a publish, and the
commit-time rule asks a publication of a done publish request only, so a preview never has a
publication, an artifact, inputs or outputs, and nothing lists or searches it. `readPublicationRequest`
answers the kind and a done preview's PDF and expiry, and `POST /v1/documents/{id}/previews` asks
for one and `GET /v1/publication-requests/{id}` answers it, above (W10.2).

**A preview on the document page (W10.3).** `usePreview` in `apps/web/src/publishing/Preview.tsx`
holds one preview for the page: **Preview**, which `Publishing` places beside **Publish** for anybody
who may read the document, whether or not they may publish, asks for the version the page holds and
follows the request with `useFollowing` (`following.ts`), the follower `Publishing` uses - the first
ask after `FOLLOW_MS`, twice as long after each answer still queued up to `FOLLOW_CAP_MS`, one ask at
a time, and the waiting timer cleared and any answer on its way dropped when the page closes. A
refusal at the door is answered by `refusedWords`, the words a publish is refused in, and a failed
preview's failures by `FailureList` with `failureWords` and the page's `placeOf`, as a publish's are.
`PreviewPane` is placed by the document page in a column of its own between the text and the dock:
the layout grid carries `data-previewing` and gains a column while a pane is open, so the text column
narrows in place and nothing in it remounts, an editor open in it included; under 1100px the pane
goes below the text, the whole width, as the dock does. The pane shows the PDF in an `iframe` by the
view link it was answered with, titled for the document, the time it was made - its `expiresAt` less
an hour, in local time - and **Download the PDF**, which reads the request again when pressed, because
a signed link lasts `DOWNLOAD_SECONDS` and the pane may stay open for the hour, and goes to the fresh
`download` link with `window.location.assign`. A request answering no preview, or answering `404`
once swept, is an expired preview, and the pane says so and offers a new one. A second preview replaces
the first, and closing the pane forgets it.

**The preview sweep, from migration 0036** (PV-F). The runtime role may delete a request, and
`publication_request_swept_only` refuses the delete of anything but a preview finished an hour ago or
more by the database's clock, whatever role deletes it: a publish, a queued preview, and one its asker
may still be reading are never deleted. Its occurrences and images go with it by their keys' cascades.
`sweepPreviews` deletes every such preview, done or failed, **except one another preview of its
document version and its second still waits beside**: the second it was asked in is compiled into the
PDF, so only such a pair can be the same bytes under the same key, and the one still queued may have
kept the bytes and not yet recorded them. It answers the done ones' keys that nothing left names - a
publication's output, another preview, a sample, an upload being checked or kept, or an asset's
version - read after the delete. The worker's `sweepExpiredPreviews` runs it in every tenant on the
sign-in sweep's interval and removes each key from the tenant's store once the transaction has
committed. A tenant whose sweep or store fails is logged and passed over; a PDF whose removal fails is
left in the store, named by nothing, and logged by its key, which is a hash.

**The worker's side.**

- **The pinned faces.** `packages/fonts/files/` - `apps/worker/fonts/` until W8.1 moved them for the
  editor to share - holds Liberation Serif 2.1.5 and, from editor 5,
  Liberation Mono 2.1.5 - four faces of each - and, from equations 2, STIX Two Math 2.13 b171, one
  file from the tag `v2.13b171` of stipub/stixfonts, each file listed with its family (`Liberation
Serif`, `Liberation Mono` or `STIX Two Math`) since themes 1, which set the glyph check asking a
  family where it asked a `Face`, each under the SIL Open Font Licence with its text beside it (`LICENSE-Liberation.txt`,
  `LICENSE-STIX.txt`) - committed and pinned by
  SHA-256 (`packages/fonts/src/pinned.ts`, read by `apps/worker/src/fonts.ts`); the worker refuses to start if one is missing or does not match
  its pin. `compile` (`apps/worker/src/typst.ts`) re-hashes them again immediately before every run,
  copies the just-checked bytes into that run's compile root, and points `--font-path` there alone -
  so a fifth, unpinned face placed beside the pinned ones is never read, and the bytes Typst reads are
  always the bytes that were hashed. **This is not belt-and-braces: in the worker image
  (`deploy/Dockerfile`), the faces are copied `--chown=node:node`, so they are writable by the same
  user the worker runs as**, and the start-up check alone would miss a face changed or removed after
  the process started. A face that fails the per-compile check throws `FontsUnavailable`, an ordinary
  error the queue retries like any other platform failure - to its maximum attempts, then failed as
  `fonts_unavailable`, indistinguishable to an author from any other exhausted failure except by that
  code. **A theme's faces are held to them before `assemble` runs**: a face the theme declares, used or
  not, that does not record exactly its family's pinned files, whose recorded ascent, descent or
  advance is not its files' own, or which is the maths face and has no `MATH` table, fails the publish
  at once, `typeface_unavailable` with the detail `<family>: <files | metrics | maths>`, one failure per
  family, rather than every character it would set failing `glyph_missing`, a line counted by a wrong
  advance passing, or an equation refused unnamed.
- **A refused job is finished, not retried.** `JobRefused` (`apps/worker/src/refusal.ts`) is thrown for
  what a job's own input caused - Typst's own non-zero exit (`TypstRefused`), and a document's own
  failures to publish (`PublishRefused`). `processNext`'s `catch` (`apps/worker/src/worker.ts`) fails such a job at once, in one attempt,
  recording its code; a crash, a timeout or a missing binary is still an ordinary error, and the queue
  retries those with back-off as before.
- **`assemble`.** `packages/domain/src/publishing/` holds the published
  document's types, the layout, the failure vocabulary and `assemble`: a pure function over a resolved
  document and a layout that numbers it with the layout's scheme, resolves each occurrence's and the
  document's own language (refusing a tag the engine cannot carry, never shortening it), checks every
  character - the layout's own words included, which fail as the layout's rather than the document's -
  against the pinned faces' coverage, and returns either the published document or every failure at
  once (PUB-052). Given no layout it returns the first slice's `publishing/1` instead, unchanged. The
  `publish` job and the worker's regression corpus call it.
- **A run and its marks (`publishing/3`).** A paragraph is a list of runs, each its text and the marks
  that cover it, so one visible text carrying one set of marks is one run in the PDF as it is in the
  stored model. Which marks may be carried is an **allowlist** over `PUBLISHED_MARK_ORDER` in
  `packages/domain/src/publishing/published.ts` - `language`, `hyperlink`, `quotedPhrase`, `emphasis`,
  `strong`, `underline`, `subscript`, `superscript`, `inlineCode`, outermost first - never a
  `default:` that drops what it does not recognise: a defined term, a condition, a suggestion or a
  comment is refused by name and the run is not published, because a condition silently flattened
  would carry conditional text into a PDF unconditionally. The order is a literal rather than any
  schema's own, so one document makes one PDF and the publication's digest is stable; a run carrying
  two marks of one kind - two links, or `fr` and `de` - is refused naming the kind, the same shape the
  editor's mapping refuses, because otherwise one target or one language would win by the template's
  fold order rather than by anything the author wrote. A `hyperlink`'s title is deliberately dropped.
  `assemble` makes neither `publishing/2` nor `publishing/3` any more - a request under a layout is now
  `publishing/4` - while `publishing/1` is still made for a request recorded before layouts.
- **A list (`publishing/4`).** A published block is now a paragraph **or** a list, and
  `PublishedBlock` is a union - which is what makes the no-layout path's `withoutMarks` narrow
  explicitly and **throw** on anything else rather than close with a `default:` that would drop a list
  silently into the frozen `publishing/1` shape. A `PublishedList` carries its kind - ordered,
  unordered or definition, the stored three rather than the editor's split - its start, its numbering
  and its items; an item carries its `term` as published runs or null, and its blocks, so a list holds
  lists and nesting needs no construct of its own. Two things were decided rather than fallen into.
  **A term's failure names the list**, not a block inside the item: a stored item has no identifier of
  its own, and the nearest thing an author can be pointed at is the list, with the detail naming the
  code point; `runsOf` and `assemble` reached that answer independently and each one's comment now
  points at the other. **An item that came out empty is kept rather than dropped**, because dropping it
  would renumber the list. `startsOutsideItsNumbering` is asked here as well as in the content model's
  walk, as a backstop rather than as the rule, and every fall-through in the file closes with
  `const never: never` and a throw, so a tenth block kind cannot be added to the domain without this
  file failing to compile.
- **The `publish` job.** `apps/worker/src/jobs/publish.ts` reads exactly what the request recorded
  (`publicationInputs`) - the formats, and the layout version and the theme version recorded on the
  request, each read by its key and never the latest - holds the theme's faces to the pinned files, runs
  `assemble` over it once, told the formats, and makes each output asked for: for Word, the Word
  writer over what `assemble` answers for Word, the pinned face files by hash and the images the
  document places by their paths, kept in the store as a `.docx` by its hash and recorded as `word/3`
  with the writer's report; the images are read once, held to their hashes, and the same bytes handed
  to Typst and to the writer; for the PDF, it compiles the
  published document through the
  template that reads its schema with the pinned Typst, puts the PDF in the tenant's store by its
  hash, and
  records the publication whole, every output or none, in a transaction of its own (`recordPublication`): the layout and theme
  versions copied from the request, the engine and its
  version, the template's version, `PIPELINE_VERSION` - held by `template.test.ts` to what `assemble`
  makes of one fixed input, so it also covers the draft notice, whose words are the data's and which
  the template's hash does not - the pinned faces with their hashes, the digest of the data Typst read
  and the numbering. The document's own failures (`PublishRefused`) fail the request at once with every
  one of them, and Typst's own refusal (`TypstRefused`) fails it at once too, as `engine`: both are
  `JobRefused`, never retried. Anything else is retried, and after the last attempt fails the request
  in a fresh transaction with its stage and no node, block or detail, so a platform fault never reads
  as the document's: `store` where an output was made and could not be kept - the store refusing it, or
  the database refusing its record - and `engine` for the rest, such as a face changed under the
  worker, a crash, a read that failed or a worker that never came back. An object stored before a
  record the database refuses is left behind, content-addressed and referenced by nothing, and
  nothing sweeps it yet. A job with no subject - nothing enqueues one - is refused at once, as
  `JobRefused('no_subject', ...)`, rather than matching no request and completing silently as `done`.
- **The `preview` job.** The same handler, registered for the `preview` kind in `apps/worker/src/main.ts`,
  told which it is by the request's kind from `publicationInputs`, never by the job's. For a preview it
  passes `status: 'preview'` to `assemble`, which sets the layout's `words.preview` - at layout schema
  6, the default layout's 0.7 saying **Preview - not approved** - as the published document's
  `words.notice` and `words.noticeSentence`, so the current template (14, since W14.4) prints the preview's notice on every page
  and its sentence once as tagged text where it prints the draft's, and changes nowhere else
  (PUB-005); a layout with no words for a preview, one stored before schema 6, fails it
  `preview_words_missing`. It makes the PDF alone, keeps it in the tenant's store by its hash, and ends
  with `recordPreview` instead of `recordPublication`; a failure is recorded by `failPublicationRequest`
  as a publish's is. A publish's `assemble` is told `draft`, and its published document is byte for
  byte what it was, which `template.test.ts`'s pipeline digests hold. The end-to-end check asks for a
  preview through the API and reads the PDF its `view` link answers, which is what shows `main.ts`
  registers the job.
- **The `check_pdf` job** (W14.1; ADR-0030, W-A to W-C). `recordPublication` queues one for a
  publication with a PDF, its subject the publication, in the transaction that records it, so a
  worker that dies once the record commits leaves the check queued and the next worker takes it; a
  record rolled back takes its check with it. `apps/worker/src/jobs/check.ts` reads the PDF's key from
  `publicationToCheck`, holds the bytes the store answers to the digest the output recorded, checks
  them, keeps veraPDF's whole report - its JSON, as it wrote it - in the tenant's store by its hash,
  as the PDF is kept, and records the verdict with `recordPublicationCheck`: its version, read from
  its own report, compliant or not, each failed rule by clause, test and description, and the
  report's key, digest and size. The report is kept before the row names it, so a run that fails
  between the two leaves an object nothing names and never a row naming nothing. A PDF that fails is
  a check done; a check that could not happen - veraPDF would not start or answer, the store answered
  other bytes, veraPDF checked another profile - throws and is retried by the queue, and after the last
  attempt leaves the publication not yet checked until the check sweep, below, queues it again. A
  second run finds the check recorded and asks veraPDF nothing. A publication is recorded before it
  is checked, so the check is outside the span PUB-102 measures.
- **The check sweep.** `sweepUncheckedPublications` in `src/sweep.ts`, run by `main.ts` on
  `SWEEP_INTERVAL_MS` beside the other sweeps, in every tenant: it asks the queue for the subjects of
  the tenant's `check_pdf` jobs still waiting or running (`JobQueue.waiting`, as `aw_worker`, which
  reads `platform.job`; a tenant's own role may only insert there, and neither grant is widened), then
  `publicationsToCheckAgain` for each publication with a PDF, no `publication_check`, recorded - its
  request finished - more than `CHECK_WITHIN_MS`, ADR-0030's five minutes, ago and not among them,
  oldest first and at most a hundred, and queues a `check_pdf` for each in the tenant's own
  transaction. Read in that order, a check finishing between the two has recorded its row first, and a
  publication recorded between them is too young. Two sweeping workers may each queue one, which costs
  a run that finds it checked. It stops asking: it reads how many of each subject's `check_pdf` jobs
  gave up (`JobQueue.givenUp`, as `aw_worker` again), and a publication whose checks have given up
  `CHECK_GIVE_UPS`, three times, it leaves, recording it with `recordCheckGivenUp` in
  `publication_check_given_up` (0041), which `publicationsToCheckAgain` then passes over and the
  publication's page reads as **Could not be checked for accessibility.** A publication recorded before
  0040 has no check and no job, so the first sweep after deployment checks those too, a hundred in each
  tenant per sweep. The sweep logs how many it queued, and warns of each tenant's left.
- **The worker's veraPDF.** `apps/worker/src/verapdf.ts`'s `startLocalVeraPdf` runs
  `/opt/verapdf/verapdf --servermode --flavour ua1 --format json` (`VERAPDF_COMMAND` overrides the
  path) as a child of the worker: started on the first check, kept warm, started again for the check
  after one that found it gone, and ended by `main.ts` when the worker stops. A PDF is written to a
  directory of the process's own, and `java.io.tmpdir`, set through `JAVA_OPTS`, is another, so a
  report path elsewhere is refused. `startServerMode` holds the protocol - one path per line, the
  answers paired first in first out, the report read and removed, a report for another file or no
  answer in time ending the process - and `verdictOf` reads a report; the suite's warm veraPDF in its
  container (`testing/verapdf-server.ts`) speaks through the same two, and `verdictOf` keeps the
  report's text whole beside what it reads from it. In the worker image, on Debian's Java 17, a cold
  start took under a second and a warm check about thirty milliseconds, measured once on one machine.
  **It is started with little of the worker's environment** (`veraPdfEnvironment`): `PATH`, which the
  launcher finds `java` on, `JAVA_HOME`, `LANG`, `LC_ALL` and `TZ` where they are set, the variables
  a Windows process needs to start where the suite's stand-in runs there, and `JAVA_OPTS` - never the
  database URL, the store's key or anything else a deployment gives the worker. `JAVA_OPTS` is the
  deployment's, read by the configuration, given `-XX:MaxRAMPercentage=50` where it names no heap
  limit (`javaOptionsWithHeapLimit`), and `java.io.tmpdir` after it. **It waits a third of the queue's
  lease** for veraPDF to start and a third for each check (`veraPdfTimeouts`, from `LEASE_MS`, two
  minutes by default), so a cold start and a check together take at most two thirds of the lease and
  a check never outlives the job holding it. Its directories are named by the worker's process id,
  `aw-verapdf-<pid>-*`, and `main.ts` removes, as the worker starts, each one under the temporary
  directory whose process is not running, or which has this process's id and was not made by it - a
  worker before it, restarted in the same container, where process ids begin again
  (`removeStaleVeraPdfDirectories`). **In production veraPDF has network access**, as the worker does,
  but its XMP parser refuses external entities: the final review of W14.1 gave the pinned veraPDF a
  PDF whose metadata named an external DTD, an external general entity and a parameter entity, and
  all three were refused with no request made. Its Java runtime is Debian's `openjdk-17-jre-headless`,
  which floats with Debian's updates as the `node:24-bookworm-slim` base image does.
- **The preview sweep.** `sweepExpiredPreviews` in `src/sweep.ts`, run by `main.ts` on
  `SWEEP_INTERVAL_MS` beside `sweepExpiredSignIns`, as described above.
- **The iteration sweep.** `sweepExpiredIterations` in `src/sweep.ts`, run beside them, as
  [the editor and its session](#the-editor-and-its-session) describes.
- **`assemble` told its formats, and what it answers for Word** (Word 1). `AssembleInput.formats` is
  required, at least one. The PDF engine's own refusals - a line, caption or image too wide for the
  PDF's measure, a table's header spanning its body, a footnote or a reference target in a header
  row, a missing continuation label's words and, since W14.2, a node nested deeper than six levels
  under a layout (`heading_too_deep`, naming it: PDF/UA-1 has six heading levels and the pinned Typst
  tags a seventh as a paragraph, ADR-0031; a request made before layouts keeps publishing as it
  always did) - are tagged as they are made and said only where `pdf` is asked for,
  and since Word 3 none of them drops its construct from the published document, so Word publishes
  a deeper node at its own heading level, to its ninth.
  Since Word 4 every `equation_unrenderable` reason is said for every format, since a refusal leaves
  no maths tree and Word, like the PDF, is written from the tree alone. Where `docx` is, `word_not_yet`
  named each construct the writer did not write yet, until Word 4 wrote the last, equations; it names
  nothing now and stays a code for the failures stored under it. `numbering_not_in_word` names a
  heading's, a figure's, a table's, an equation's or a footnote's number Word's fields or count would
  compute otherwise, `list_not_in_word` a list past the ninth level, in
  letters from the 28th or past roman 3999, `image_too_wide` an image in a line wider than Word's
  line, and since Word 3 `cross_reference_not_in_word` a reference Word's field would print
  otherwise than the PDF - above or below across a footnote's boundary (`relative:footnote`) or in a
  floated figure's caption, which Word writes in a text box (`relative:float`), a
  caption's words named inside it (`title:caption`, `numberAndTitle:caption`) or where they hold a
  reference that is not a number (`title:nested`, `numberAndTitle:nested`); `format_unsupported` is
  said, not thrown, for Word under a layout with no Word page. Since Word 3 a footnote in a header
  row and a reference to a header-row target stay in the published document, refused for the PDF
  alone. The answer carries `word: WordInput` - the layout's `docx` member, the resolved theme, the
  scheme, each figure's and inline image's size against the Word page, by the PDF's own functions,
  keyed by `figureImageKey` and `inlineImageKey`, and since Word 3 `references`, each printed
  reference's form and its target's number and title keyed by `inlineReferenceKey`, and `titles`,
  each section title holding a reference as its words and its reference runs, and since Word 4 its
  equations in their places - exactly where Word is asked for, and null otherwise. The
  published document is the same for either format, so `publishing/13`, template 13 and
  `PIPELINE_VERSION` did not move, and the PDF made beside a Word document is byte for byte the PDF
  made alone.
- **The Word writer.** `packages/domain/src/word/`'s `writeDocx({ document, numbering, word, formats,
faces, images })`, pure and deterministic - a fixed zip time, the parts in a fixed order, relationships
  numbered as met, each face's key from its hash - zips with `fflate` the content types, the
  relationships, `docProps/core.xml` with the title and language, `document.xml`, `styles.xml` from
  `projectStylesXml`, `numbering.xml`, `settings.xml` (fields updated on opening, compatibility mode
  15 with paragraph spaces that add, faces embedded, the maths face's Word face, the language),
  `fontTable.xml` and the embedded faces, obfuscated as ECMA-376 says, and the headers and footers.
  A heading's number is one of three numbering definitions, the body's linked from the heading
  styles, front matter's and appendices' given by `w:numPr`; a heading is in the style Word names for
  its depth, since Word takes a heading's outline level from that name - the role's, or the writer's
  own `heading 7` to `heading 9` based on the sixth's; a later appendix starts its page by
  `w:pageBreakBefore`; the cover, the contents and each run of
  one matter are sections, each numbered by the layout's Word page; the contents is a `TOC` field
  prefilled with its entries and no pages; every header carries **Not approved** and the running
  slots, with `PAGE`, `NUMPAGES` and `STYLEREF "Heading 1"` fields, the section's number inside an `IF`
  that prints nothing for a heading with none; each paragraph names its style,
  each run its character style by `wordRun`, a link is a `w:hyperlink` and a passage in another
  language `w:lang`, right to left with `w:bidi` and `w:rtl`. Since Word 2: a list is a numbering
  definition of its own, its markers' widths read from the face file, a definition list its terms and
  indented definitions; a quotation's blocks and attribution in their styles, spaced as the PDF's by a
  pass that states over a style only what Word would read differently; preformatted text a paragraph
  a line, a panel beside another of its look stood a twip further in, and a block whose widest line
  Word would wrap set closer; a table in a Word table style projected by `projectStylesXml`, banded
  by `band1Horz`, its header rows `w:tblHeader`, its caption above as Word's `STYLEREF` and `SEQ`
  fields and its `w:tblCaption`, its note after; a figure's image a `wp:inline` described or flagged
  decorative with its caption below, a floated one a text box (`wps:wsp`) holding it and its caption,
  anchored at the head of the text area where no other float may overlap it; an image in a
  line a `wp:inline` in its run; each image once in `word/media/` by its hash; and the lists of
  figures and of tables after the contents as `TOC \c` fields. Since Word 3: `footnotes.xml`, with
  Word's separators, right to left in a right-to-left document, holds each note, its paragraphs through the same flow as the text's and its
  links and images related from its own part, its mark a `w:footnoteReference` in Word's Footnote
  Reference style, each matter's section restarting the count (`w:footnotePr`, `eachSect`); every
  anchor a reference names is a hidden bookmark `_Ref` and nine digits, in the order written - a
  heading's around its title, a caption's around its label - or holding nothing at its start where it
  has none - and around its words, a footnote's around
  its mark, a block's holding nothing at its first paragraph's start, and a floated figure's third in
  its anchor paragraph; and every reference is a field prefilled with what the PDF prints, `REF`
  (`\r` for a heading's number, `\p` for above or below), `NOTEREF` or `PAGEREF`, the last empty,
  `\h` exactly where the published run links, and a space between two fields printing left to
  right in a right-to-left passage written without its direction. Since Word 4: an equation is
  `omml`'s OMML of its published maths tree, never an image or a second conversion of its MathML -
  in a line an `m:oMath` in its run's place, sized from its style's size, a zero-width space before
  it where it is all its paragraph holds, so Word keeps it in the line; displayed an `m:oMathPara` in
  a paragraph of its own; numbered a borderless row of two cells, the equation and its label, the
  label a `SEQ Equation` field - front matter's `SEQ EquationFront` - prefilled from the numbering
  table inside the equation's hidden bookmark; cases a matrix after a brace; `settings.xml`'s
  `m:mathPr` names the maths face's Word face, and text inside an equation
  names it too, and in a bold style every maths run states bold off, since Word bolds a heading's
  equation as it saves; the list of equations is a `TOC \c "Equation"` field, after a
  `TOC \c "EquationFront"` where front matter numbers one, the first ended in an empty paragraph whose
  mark is hidden; a number reference to a caption's or an equation's label carries `\* CHARFORMAT`. It answers
  the bytes and the output's report, which names each table's lost header column, repeated header and
  omitted label, each heading and listed caption whose equation Word's rebuilt entries flatten, and
  the maths face Word sets equations in.
  [`design/word-output.md`](design/word-output.md#what-was-built) says what Word 1 to Word 4 built
  and what Word showed.
- **The publication templates.** `apps/worker/templates/publication/1/main.typ` reads `assemble`'s
  first published document (`publishing/1`), `2/main.typ` the document under a layout
  (`publishing/2`), `3/main.typ` that document with a run's marks (`publishing/3`) and `4/main.typ`
  that document with lists (`publishing/4`), each from
  `data.json` as values, evaluating none of it. The worker picks by the
  document's schema, not by configuration (`apps/worker/src/template.ts`), and the pipeline's version
  is per schema too. **Both of those maps are keyed by a constant and are therefore pinned as literal
  objects**, because repointing `PUBLISHING_SCHEMA` moves the key while the value stays behind and the
  `satisfies Record<PublishedSchema, string>` clause cannot catch it - `PublishedSchema` derives from
  the same constant. Left unpinned, every publication the new pipeline made would have recorded itself
  as made by the old one, in the single field PUB-063 exists for. **Since template 10 the typecheck
  catches it too**: the current schema's rows are keyed by `PUBLISHING_SCHEMA_CURRENT`, exported from
  `template.ts` and annotated with its literal, `'publishing/15'`, so repointing `PUBLISHING_SCHEMA`
  fails to compile there, and a frozen schema's row by its own frozen constant; `satisfies` refuses a
  row for a schema nothing makes, `publishing/9`'s to `publishing/14`'s excepted, which are kept. A version is immutable:
  `apps/worker/src/template.test.ts` holds each one's hash,
  an edit is a new directory and a new number, and `.gitattributes` keeps every `.typ` file LF so no
  checkout rewrites a pinned template. Template 1's file and hash have not changed, and the same test
  recomputes template 1's row from a fixed input with no layout and holds it to the digest the first
  slice pinned, so a request made before layouts still publishes byte for byte as it would have.
  **Templates 2 and 3 are kept although nothing makes a document for either**, because they are what
  the publications made before a run carried its marks, and before a block could be a list, were
  compiled with, and a published version is a record; each one's test
  builds the `#assert` it should carry from `PUBLISHING_SCHEMA_2` or `PUBLISHING_SCHEMA_3` and reads it
  out of that template's own bytes, so repointing a frozen schema fails there rather than quietly.
- **What template 3 sets.** The page the layout declares, in points and in the portrait sense, turned
  where it is landscape, the gutter widening the inside margin, which alternates about the binding
  edge. A cover of its own with no page number, holding the title and the draft notice's sentence.
  Running heads and feet of three slots each, of the layout's words and the fields `title`, `section`,
  `page`, `pages` and `revision`; the notice is placed above the head by the template, on every page
  including the cover, so no layout can remove it. The contents is Typst's own `outline` over the
  headings the template set with `number`'s numbers, so a screen reader is told it is a table of
  contents, and only the page comes from the engine; it always ends its page. Page numbers run in
  chains, so a matter entered again resumes its own chain rather than repeating a label, and every
  change of matter starts a page. And a run's marks: `emph`, `strong`, `underline`, `sub`, `super`,
  `quote(quotes: false, ...)` - the mark is for assistive technology and the author's own quotation
  characters are the only ones on the page - `link` and `text(lang:, region:)`, folded outermost
  first. `inlineCode` is **hoisted out of that fold** and computed before it, because Typst's `raw()`
  replaces its body rather than wrapping it, and applying it inside the fold would silently throw away
  every mark already applied - a PDF saying something the author did not write. A kind the template
  does not know ends in `panic`, so a publish fails rather than printing an unmarked run. **That
  failure is deliberately imprecise, and the cost is recorded rather than paid.** A `panic` reaches
  the worker as `TypstRefused`, is recorded as `engine_failed`, and the page then says "The
  publication could not be made. Publish again." - right for a transient engine fault, wrong for a
  document that can never compile. A named `compose` failure was ruled out of the template's scope,
  and `assemble`'s allowlist plus `marks.test.ts`'s `EVERY_MARK` - typed as
  `Record<PublishedMark['kind'], true>`, so a tenth kind cannot be added to the domain without that
  file failing to compile - make the branch unreachable in practice.
- **What template 4 sets, beyond template 3.** A list, at any depth, through one `block-of` binding
  that a `let` calls recursively, placed **after** `paragraph` and **before** `node` because Typst
  resolves a name among the bindings already made and a forward reference does not compile. A counted
  list is Typst's `enum` with its `start` and a `numbering` built from the stored `format` - `1.`,
  `a.` or `i.` - defaulting to decimal where there is none; a bulleted list is Typst's `list`, whose markers
  are set once at the head of the file as disc, circle and square, written as escapes so that no
  invisible character reaches a source file. Three markers are not a ceiling on the nesting: Typst
  cycles the array, so a fourth level takes the first again. **That a marker is pinned in a template
  at all is the wrong home and is said to be**: CNT-094 puts a block's appearance in a named style,
  and [#158](https://github.com/kenhayward/alloy-works/issues/158) is where it moves to. **A definition list is set with Typst's `terms`, whose item label is
  the term**, which is all this engine gives: Typst 0.15.1 emits `L`, `LI`, `Lbl` and `LBody` and has
  no way to ask for `DL`, `DI`, `DT` or `DD`, so a reader is told "list" where the content says
  "definition list". An item whose term was never typed prints an empty label rather than failing. An
  unknown block kind ends in `panic`, as an unknown mark does; an unknown numbering defaults to
  decimal instead, because a numbering is presentation and a block kind is content. `apps/worker/src/lists.test.ts`
  compiles the result and reads it back with pdf.js - the whole role sequence rather than a count of
  `L`, which would pass with every sublist removed - and through veraPDF, PDF/UA-1 clean, including a
  six-level mixture of all three kinds and a term carrying marks. It also asserts that no `DL` role
  appears: **that assertion cannot fail today and is a tripwire**, there to go red the day the pinned
  engine grows the structure.
- **Quotations and preformatted text (`publishing/5`, template 5).** A published block may also be a
  `PublishedQuotation` - its blocks and its attribution as runs or null - or a
  `PublishedPreformatted` - its label or null and its lines, **each tab already expanded** to stops
  every eight columns, because the engine ignores `tab-size` without a language and a language
  deletes whitespace. **The glyph check is face-aware**: `covers(codePoint, face)` asks the body
  family or the monospace one, each the intersection of its four files, and a character Mono lacks
  (sixteen, Mono being a strict subset of Serif) is `code_glyph_missing` in preformatted text or an
  inline code run and nothing in a paragraph. Template 5 sets every `raw` in Liberation Mono with
  `fallback: false`, which is what keeps the engine from quietly setting a missing character in Serif.
  **A preformatted line wider than its place is refused by `assemble`** as `line_too_wide`, from
  `packages/domain/src/publishing/measure.ts`: the text block less the panel's inset and the indent
  the line stands at - a quotation costs **two** ems because the engine pads one on both sides, a
  list its widest marker at a full em a character (conservative, #164) - over one column of Mono at
  8.8pt. The template asserts the same bound per line with `layout` and `measure` as a backstop that
  must never fire. The quotation is Typst's `quote(block: true)`, tagged `BlockQuote`, with the
  attribution set by the template in a block of the full width and **never** through `quote`'s own
  attribution, which writes an em dash; preformatted text is `raw(block: true)`, tagged `Code` with
  a `P` per line. The attribution reads as the quotation's last `P` and the label as a stray `Span`
  (#163), and leading whitespace does not reach the extracted text (#162).
  `apps/worker/src/quotations.test.ts` reads positions back through `readPdf`'s `items` and checks
  the whole fixture through veraPDF. Adding Mono to the font path has one effect on older templates:
  templates 3 and 4 set inline code with `raw` and name no font for it, so it now falls back to Mono
  where it fell back to Serif - no glyph check changes, Mono being a subset.
- **Tables and the list of tables (`publishing/6`, template 6).** A published block may also be a
  `PublishedTable`: `number`'s label, the caption as runs, the header counts, its width in
  `columns`, and rows of cells, each with its blocks, its spans and its `scope` - `column`, `row`,
  `both` or null - which `assemble` works out from where the cell starts in the grid. `assemble`
  refuses a table with no words in its caption (`table_without_caption`), one whose header cell
  spans down past the header rows (`table_header_spans_body`: the engine would grow the header over
  a data row and tag it a `TH`), and one in a style other than `table`. The template sets a
  **breakable** `figure(kind: table)` - a figure is unbreakable by default, and a long table would
  overflow its page - with numbering off and the caption above it, the label written as text; the
  header rows as one `table.header(repeat: true)`; and a header column's cells as
  `pdf.header-cell(scope: ...)` **around** `table.cell(colspan:, rowspan:)`, because the other way
  round a spanning header cell is tagged a `TD`. `pdf.header-cell` exists only behind
  `--features a11y-extras`, which `typstArguments` now passes to every compile; templates 1 and 5
  were measured to compile to the same bytes with and without it. Each list the layout declares and
  `assemble` found an entry for (`front.lists`) is Typst's `outline` over the figures of its kind,
  on a page of its own after the contents, so it too is tagged `TOC` and `TOCI`.
  `apps/worker/src/tables.test.ts` is the regression case: a header row, a header column, a cell
  spanning rows and one spanning columns, sixty rows crossing a page, through veraPDF and read back.
- **The theme (`publishing/12`, template 12).** `assemble` takes the theme the request recorded,
  resolved, beside the layout - both or neither, a mismatch throwing as a caller's defect - and the
  published document gains `theme`, `projectTypst` of it: the paper, the maths face's family, **every**
  paragraph style of the theme by identifier with every property concrete, its face's family, its
  descent and the leading its line spacing leaves, the nine marks' renderings, and the style of each
  place and role. A `PublishedParagraph` carries its `style` wherever one is published, a footnote's
  included: a stored `body` becomes the style of the place that holds it most nearly - `text`,
  `listItem`, `quotation`, `tableCell` or `footnote` - and any other identifier is itself; a table's and
  an image's styles are checked and not carried, and what is set by role carries no identifier. The
  failures join the list: `style_missing`, a paragraph's, a table's or an image's style the theme's
  catalogue of that kind lacks; `style_not_applicable`, one used where its `appliesTo` does not reach;
  and `typeface_not_embeddable`, once per family the document sets text in whose `embedding.pdf` is
  false, with no node or block. **The glyph check asks a family**: `Covers` is
  `(codePoint, family) => boolean`, and a run asks its innermost mark's face, else its style's, every
  generated text its role's - a preformatted block's label now among them - under a `Setting`
  (`body`, `code` or `math`, which was `Face`) that decides the no-glyph rules and the code; a request
  made before layouts asks `SLICE_ONE_FAMILY`, Liberation Serif, frozen. **What `assemble` measures it
  measures from the theme**, by the contract at the head of `measure.ts`: preformatted columns from the
  role's size, its face's `advance`, its indents and, where it has a fill, its padding; a quotation's
  inset its style's start and end indents; a list's indent in ems of its item's size; a caption's
  estimated height in the caption's size; and an image in a line of text 1.2 ems of the style it stands
  in (`inlineImageHeight`). `PUBLISHING_SCHEMA_11` freezes `publishing/11`. **Template 12 sets every face,
  size, weight, posture, colour, space and line from `theme`**: each block wrapped in its style - the
  lettering (face, size, weight, posture, fill, hyphenation, the text's edges from the face's descender,
  the widow and orphan costs), the paragraph (leading, justification, first-line indent), and only where
  it changes something alignment, a padded fill, a direction-aware indent and a `block` that is `sticky`
  for keep-with-next and unbreakable for keep-together - and between two blocks weak space of the
  first's space after, the second's space before and its leading, `par` and `block` spacing being zero;
  each mark from its character style, never `strong` or `emph`; footnotes through `footnote.entry`;
  the page filled with the paper. A quotation is padded by its place's style alone, the engine's inset
  and its space stopped, and the items of one list stand a line apart. `template.test.ts` reads the
  template, comments stripped, and fails on a face name, a colour, a size or a length, a weight or a
  posture, but for an allowlist each of whose entries says why and must still occur - the units a number
  from the data is multiplied by, `rgb` of a theme's colour, the two costs, zero, a full width, and two
  lengths of maths layout. `PIPELINE_VERSION` is `'12'`. `apps/worker/src/themes.test.ts` is the
  regression case: the default theme and a second theme differing in every paragraph property and every
  mark - its `strong` coloured and underlined rather than bold, on a tinted paper - compiled, checked by
  veraPDF and read back through `readPaint` in `testing/pdf.ts` (each painted run's face, size, fill,
  position and ink width, the fills, the strokes and the embedded faces) for every place's and role's
  face, size, colour, alignment, indents, spaces, line spacing, keep-with-next, keep-together and widow
  control, every mark, every face embedded, the metrics held to the files by `faceMetrics`, the pinned
  faces' coverage of Latin, Greek, Cyrillic and Hebrew and the maths face's of `MATHS_CHARACTERS`, and
  the job refusing a face not embeddable and a face not held, each by name with no publication. The
  web's `failures.ts` says each: a style the theme does not have and one that cannot be used where it
  stands, naming the style, and a typeface that cannot be embedded or is not held, naming it and saying
  the theme has to change, never to publish again.
- **Table and image styles (`publishing/13`, template 13).** `theme` is `projectTypst`'s `TypstTheme`:
  every paragraph style now with its `id`, so the template can tell one style from two with equal
  values, and `contextualSpacing`, and the theme's `tables` and `images` by identifier, a table style's
  header row and column (fill, weight, rule), band, outer, horizontal and vertical strokes, inset and
  breaks, an image style's fixed dimension, maximum, placement and alignment. A `PublishedTable`
  carries `style`; a `PublishedFigure` `placement` (`block` or `float`) and `alignment`; a
  `PublishedImageRun`'s image `placement: 'inline'`; and `words.continued`, null under a layout read
  before schema 4. `assemble` sizes an image by its style (`imageLength` and `styledSize` in
  `measure.ts`): the fixed dimension in points, a fraction of the layout's measure, a fraction of the
  text block's height or ems of the style it stands in, the other from its pixels, both re-derived
  from the maximum where the other would pass it; a figure then held to its room and its caption's
  estimate as before, and an image in a line held to the text block's height, its proportion kept, and
  refused past its room as before - so under the default an image in a line at the top level, whose
  maximum is the measure, is made smaller rather than refused.
  A cell's room is its share less twice its table style's padding. `FIGURE_HEIGHT_SHARE`, `CELL_INSET`,
  `INLINE_IMAGE_EMS` and `inlineImageHeight` are gone. The failures join the list:
  `continuation_words_missing`, a table whose style asks for a continuation label under a layout with
  no `continued`, naming the table and, in `detail`, the style; the words are glyph-checked with the
  layout's others. `PUBLISHING_SCHEMA_12` freezes `publishing/12`. **Template 13** decides each rule
  once, by the cell after it, the header row's rule a `table.hline` inside the header so it repeats
  with it; fills the header row, then the header column, then the band from the first body row; sets a
  header's bold on the text, over the cell style and marks; makes a body cell unbreakable where rows
  are kept whole and its row fits a page - each run of rows a spanning cell joins measured, inside
  `layout`, as a table of the same columns and inset, against the text block's height less the header
  and label that repeat above it - so a row taller than a page splits; and, where the style asks for
  a label, puts a level 1 header before the header rows at level 2, holding in `context` a
  `pdf.artifact` label - "Table 3 (continued)", in the caption role's style - on every page after the
  table's first and the same label hidden on its first, so the row takes the same room on every page
  and a row split on the first page is set within the text block on the next; there it leaves an
  empty `TH` in the structure tree. A figure is `figure(placement: auto)` where it floats, wrapped in
  a full-width block aligned by its style. Between two blocks of one style that both ask for
  contextual spacing, only the leading - within one container: two blocks of one flow neither of which
  is a list, a quotation, a table or a figure; across a container's edge, and between two notes or a
  table's caption and its cells, both spaces. `template.test.ts`'s literal allowlist is unchanged and reads
  templates 12 and 13; `PIPELINE_VERSION` is `'13'`. `apps/worker/src/table-and-image-styles.test.ts`
  is the regression case: four table styles over a table crossing pages - fills, strokes and weights
  from the content stream (`readPaint` now reports a stroke's `width`), padding from positions, the
  header repeated or not, a tall row whole or split, the label on each continued page and not the
  first - and every image placement and alignment, a fixed width and a fixed height each constrained
  by its maximum with its proportion kept, each compile through veraPDF; `themes.test.ts` pins the
  quotation's six distances.
- **A figure or a table unnumbered (`publishing/14`, template 14; W14.4, issue #129).** A stored
  figure or table carries `numbered: false` where its author marked it unnumbered (content model), and
  `contributionsOf` passes it on, so `number` gives it no entry: no label, no counter value, and no
  place in `listOf`. A `PublishedTable` and a `PublishedFigure` carry `listed`, false exactly where the
  block has no numbering entry, and `PUBLISHING_SCHEMA_13` freezes `publishing/13`. **Template 14** is
  template 13 with `outlined: b.listed` on a table's and a figure's `figure`, so the list its kind's
  `outline` makes leaves an unnumbered one out; its caption is set with no label, as template 13 set
  one the scheme withholds a number from, which stays listed. `PIPELINE_VERSION` is `'14'`. A reference
  to one binds to its caption with no label, so a title form prints the caption and a number form
  fails `cross_reference_form_unavailable`. The Word writer is unchanged: with no entry, its caption
  has no `SEQ` field. `tables.test.ts` shows a document with none unnumbered set by template 14 as by
  template 13, and the unnumbered case, its reference and its list, through veraPDF; `figures.test.ts`
  the same for a figure; and `word.test.ts` the Word document, through the Open XML SDK.
- **A caption on its style's side (`publishing/15`, template 15, `catalogue/3`, migration 0043;
  W14.5).** A table style and an image style placing a figure carry `caption: 'above' | 'below'`,
  required at `catalogue/3`; `catalogueSchema2` freezes version 2, whose rows the reader holds to it and
  upgrades by `upgradeCatalogue2` - a table's caption above, a figure's below - and the store writes a
  catalogue at 3. Migration 0043 seeds the default theme's 0.5: the table and image catalogues' fourth
  versions at `catalogue/3`, each 0.4's with its captions where they always stood, and the theme naming
  them, on 0034's guard. `projectTypst` gives each table and
  image style a `captionPosition`, `top`, `bottom` or, for an image in a line, null, and a
  `PublishedFigure` carries its own; `PUBLISHING_SCHEMA_14` freezes `publishing/14`. **Template 15** is
  template 14 with each caption's `figure.caption(position: ..)` from them, a caption below a table
  spaced as a block below its cells and its note after both, and a caption above an image spaced by its
  space after; the tagging is template 14's. `PIPELINE_VERSION` is `'15'`. The Word writer writes the
  caption paragraph on the style's side, parts two tables that would meet by an empty paragraph a
  tenth of a point high, and names a table whose caption is below it for above, below and its page by
  a bookmark at the head of its first cell; and `projectCss` stacks and orders a caption the markup does
  not already stand where its style places it. `table-and-image-styles.test.ts` sets both sides of each
  through veraPDF and shows a document under the default theme set by template 15 as by template 14;
  `word.test.ts` the Word document, through the Open XML SDK.
- **Equations (`publishing/11`, template 11).** `packages/domain/src/publishing/maths.ts` is the one
  converter both writers are to read (EQ-B): `mathsTree` reads an equation's stored MathML with the
  strict reader and returns the maths tree - rows, identifiers with their variant by MathML Core's
  rule, numbers, operators, named operators, text, space, fractions, stacks and binomials, roots,
  scripts in three modes, primes, accents, lines, braces, fences, matrices and cases with an alignment
  per column, phantoms, display and inline style, and the script and script-script sizes - with its
  alternative, the root's `alttext`, or a refusal naming the construct. It keeps an allowlist of its
  own rather than the reader's, so an element or an attribute the mapping does not know is refused,
  never dropped; a column aligned two ways, a space of more than twenty ems either way, an accent of
  more than one character once composed and an equation that draws nothing (`drawsNothing`) are
  refused, a script level of one or two (`\substack`, `smallmatrix`, `subarray`, `\scriptstyle`) is
  set in the engine's script sizes, the four characters that only say where a line may break are
  dropped from every token, and an operator's `minsize` and `maxsize`, `mpadded`'s sizes,
  `mspace`'s height and depth and `intent` are accepted and not set. A published run may be a
  `PublishedEquationRun`, `{ equation: { tree, alternative: { text, language } } }`, wherever runs are
  published, and a block a `PublishedEquationBlock` - its `id`, `anchor`, `label`, which is `number`'s
  and null where the author left it unnumbered, tree and alternative - at a node's level, in a list's
  item and in a quotation. A node's `title` is `PublishedTitleRun[]`, text carrying no mark and
  equations, where it was a string, and `publishing/1` joins it back into one. `assemble` fails
  `equation_unrenderable` with the construct from a fixed list (`REFUSAL_NAMES`, never an element's
  name or an attribute's value), `alternative_missing`, `math_glyph_missing` for each character of the
  tree's strings (`mathsText`) the `math` face lacks - named apart from `glyph_missing` as
  `code_glyph_missing` is - and `equation_unnumbered` for a numbered equation the scheme gives no
  number, every reason once per block; a caption's equation counts towards `caption_too_long`. An
  equation is a reference target of kind `equation`, printing a number, a page or above and below, and
  a title form of a reference to a section or a caption holding one fails
  `cross_reference_form_unavailable`, since dropping the equation would print words the author did not
  write. A request made before layouts still refuses an equation by name. `PUBLISHING_SCHEMA_10`
  freezes `publishing/10`. Template 11 is template 10 with every equation in STIX Two Math with the
  fallback off, and **the body text's fallback off too**, since STIX in the font folder would
  otherwise set a character Liberation Serif lacks while `assemble` refused it; `maths()`, building the
  tree from the engine's maths functions, every string handed to `symbol()` or `text` and nothing
  evaluated, a column aligned by an alignment point in each of its cells - `mat(align:)` takes one for
  the whole matrix - and cases set as a matrix fenced on the left, since `math.cases` ignores the
  points; every equation `math.equation(alt:)` inside `text(lang:)` of its alternative; a numbered
  block equation a `figure(kind: "equation")` with no supplement and no numbering of its own, its
  caption `number`'s label, which a show rule places at the right in room kept on both sides of the
  equation - or, as amsmath does, on a line beneath it at the right where the equation is too wide to
  leave that room - so the number is a `Span` after the `Formula` either way; an unnumbered one the
  equation alone, labelled where a reference names it; the list of equations as `outline` over that
  figure kind; and a node's title set from its runs, so the contents, the running heads and the
  bookmarks follow it. A block equation wider than its line still runs past both margins and can be
  cut off at the page's edge, and nothing refuses one (publishing.md's open width gap). `PIPELINE_VERSION` is `'11'`. `apps/worker/src/equations.test.ts` is the regression
  case: equations in running text, a list, a quotation, a table's body cell and a header row repeated
  across pages, a footnote, both captions and a section's title, numbered and not, in English and
  German, the spike's constructs and its injection strings, references to a numbered and an unnumbered
  equation and all three lists, through veraPDF and read back through `readPdf`'s new `formulas` -
  each `Formula`'s page, `/Alt`, own `/Lang` and the language a reader is told, its ancestors, its
  text, its box and the element after it. The web's `failures.ts` says each new failure in words: one
  sentence per construct for `equation_unrenderable` where an author can act on it by name and one for
  the rest, each ending _Open it and rewrite it, or delete it._, `equation_unnumbered` as
  `footnote_unnumbered` is, and `math_glyph_missing` naming the maths typeface; `alternative_missing`
  names an equation beside an image, and the refusal a request made before layouts still gives is
  _An equation cannot be published from this request. Publish again._ The **Reference** dialog offers
  a numbered block equation, in a document and on its own, and never one left unnumbered.
- **Cross-references (`publishing/10`, template 10).** `assemble` resolves every cross-reference in
  the document once, under a layout, after the layout's own checks and before anything is projected
  (`resolveReferences`): one walk in the order the publish sets things gives each reference and each
  target a place, each reference is bound with `referenceResolver` where it is read, and it prints its
  form - the label, the title, both, or the layout's `above` or `below` by that order - or asks the
  template for a page. A published run may be a `PublishedReferenceRun`,
  `{ reference: { anchor, text, page, relative, link } }`, a link only in a paragraph's text, a
  footnote's included, `relative` true where the text is the layout's word for above or below; a
  section's title prints its own reference as its number, in its words, and a caption read as a title
  prints each of its own references as its target's number, or its kind. Every published block,
  footnote, footnote's paragraph and node carries `anchor`, straight after `id` - `b-<node>-<block>`
  or `n-<node>` - and null unless a reference names it, and a named block that publishes nothing
  leaves a `PublishedMarker`, `{ type: 'marker', anchor }`, in its place; a named footnote paragraph
  that holds nothing stays, with no runs, to carry its anchor. A `component` target read in an
  occurrence of the component it names resolves as a `block` target. `cross_reference_unresolved` names the
  stored target and `cross_reference_form_unavailable` the form - one the target has nothing to print
  for, a page in a title, a relative form under a layout with no words for it, or any form of a target
  in a table's header rows, which the engine sets again on every page, and a label set twice refuses
  the compile (measured). A request made before layouts still refuses a reference by name.
  `PUBLISHING_SCHEMA_9` freezes `publishing/9`. Template 10 is template 9 with a reference run - its
  text, or a page in `context` from `locate` and `counter(page).at` in the location's own
  `page-numbering`, wrapped in `link(label(anchor), ..)` only where `link` is true, and a relative
  word set in the layout's language with `words` - and a label, built with `label(..)`, on every
  element carrying an anchor: a heading, a paragraph, a list, preformatted text, a quotation, a
  table's figure, a figure, a footnote and a marker, set as `metadata(none)`, and a footnote's
  paragraph, on a `metadata(none)` where it begins in the note;
  `PIPELINE_VERSION` is `'10'`. `apps/worker/src/references.test.ts` is the regression case: every
  form, every place a reference can stand, forwards and backwards, in front matter and the body,
  through veraPDF and read back - each link's destination page from `readPdf`'s new `destinations`,
  each page number against its target's page, and no link in a header row, a caption, the contents,
  the lists or a running head, which veraPDF alone would pass. The web's `failures.ts` says each
  failure in words an author can act on, and the refusal a request made before layouts still gives
  as _A cross-reference cannot be published from this request. Publish again._
- **Footnotes and a table's note (`publishing/9`, template 9).** A published run may also be a
  `PublishedFootnoteRun`: `{ footnote: { label, paragraphs } }`, the label the numbering table's for
  the footnote and the paragraphs published as a paragraph's are, their failures naming the footnote.
  Only a paragraph's runs hold one: `publishedRuns` takes whether it is publishing a paragraph's runs,
  with the table the paragraph stands in, and anywhere else - a caption, a term, an attribution, a
  table's note, a section's title, a table's header row, which the engine refuses a link in once it
  repeats - refuses one, `footnote_not_publishable_here`, as it does one anchored to the table as a
  whole. An anchor to a cell must resolve against that table
  (`anchorResolves`: by position within the grid; by key, one declared key column and a row whose key
  cell's words are the key), or `footnote_anchor_unresolved` names the footnote; a footnote with no
  text is `footnote_empty`, and one the scheme gives no number `footnote_unnumbered`. Every reason a
  footnote is refused is said. A `PublishedTable` carries its `note` as runs, or null. Template 9 sets
  a footnote as `context footnote(numbering: _ => label, text(lang:, region:, dir:, body))` - the
  language where the mark stands carried to the foot of the page, which the engine would otherwise
  give the document's - the paragraphs joined by paragraph breaks so the number opens the first, and
  the note as a paragraph a point smaller straight after the table's
  figure - inside it, the engine tags the figure so that the caption stops being the table's.
  `apps/worker/src/footnotes.test.ts` is the regression case: footnotes in running text, a list, a
  quotation and a cell, a report long enough that they fall on several pages, a note longer than a
  page, a note in another language, and a table with a note, through veraPDF and read back; `readPdf`
  reports each `Note`'s spoken language.
- **Images in a line of text (`publishing/8`, template 8).** A published run may also be a
  `PublishedImageRun`: `{ image: { path, width, height, alternative } }` beside the `{ text, marks }`
  a run is, wherever runs are published. `assemble` sets it 1.2 ems of the body text high
  (`INLINE_IMAGE_HEIGHT`; since themes 1, 1.2 ems of the style it stands in, `inlineImageHeight`) with its width from its proportions, refuses one wider than the room where it
  stands (`image_too_wide`) - in a table's cell, the cell's share of the measure less the engine's
  inset of 5 points each side (`cellIndent`), since themes 2 its table style's padding - and describes and refuses it as a figure, naming the
  block that holds it. The request resolves an inline image as the publisher wherever it stands, naming
  a block once however many of its images the publisher may not read. Template 8's `run` sets it as
  `box(image(..))` inside `text(lang:, region:)`, or `pdf.artifact(box(image(..)))` where
  decorative; the engine then declares the language on the `Figure` or hoists it to an ancestor - a
  table row whose first cell is German says so once - which is why `readPdf`'s `figures` report the
  language a reader is told, `spoken`, and each `Figure`'s `parent`.
- **Figures and the list of figures (`publishing/7`, template 7).** A published block may also be a
  `PublishedFigure`: `number`'s label, the caption as runs, the image's path in the compile root -
  `assets/<sha256>.<png|jpg>`, from its key and its format, and nothing else of the asset - its
  printed width and height in points, and its alternative text resolved to text and a language, or
  null where it is decorative. `assemble` sizes the image - since themes 2 by its image style, whose
  default's numbers are these: the width where the figure stands, the
  height from the proportions as displayed, and past 60 per cent of the text block's height
  (`textBlockHeight`), that height and the width from it, because the engine lets an image run off
  its page in silence - and where the caption's generous estimate (`captionHeight`) leaves less than
  that share, what it leaves, since a figure does not break; a caption leaving less than an inch is
  `caption_too_long`. It refuses a figure with no words in its caption (`figure_without_caption`),
  one given alternative text by neither itself nor its image, or its own of spaces alone
  (`alternative_missing`, PUB-033), one
  whose image the request could not read (`asset_unreadable`), and one in an image style other than
  `figure`. The template sets a `figure(kind: image)` with numbering off and the caption below it,
  the image inside `text(lang:, region:)` of its alternative text's language so the `Figure` carries
  its own `/Lang`, and a decorative image as `pdf.artifact(image(..))`, with no `Figure` and its
  caption and number kept. The request records every image its components place that the publisher
  may read (`publication_request_asset`) and refuses the rest by the figure's place; the job reads
  each from the tenant's store, holds its bytes to the hash its key names (`rootImages`), and hands
  them to `compile`, which writes them into the root under `assets/` and refuses any other path;
  bytes that do not match are a broken store, retried and then failed at the engine's stage. The
  publication names every image it printed (`publication_asset`). `apps/worker/src/figures.test.ts`
  is the regression case: a figure with its own text, one inheriting German text, a decorative one
  and one too tall for its page, through veraPDF, read back for each `Figure`'s `/Alt`, `/Lang`
  and layout box.
- **What a test can see of a PDF.** `apps/worker/src/testing/pdf.ts` reads a compiled PDF back:
  `taggedText` per page, `roles` flat in document order - read a page at a time, as pdf.js answers,
  so an element crossing a page appears once per page - `elements`, every structure element in the
  file counted once from the objects themselves, `links` - each page's link annotations by
  their target - `figures`, each `Figure` element's `/Alt`, `/Lang` and layout box read from the
  objects themselves - `formulas`, each `Formula`'s the same, with the element after it - and `languages`, each declaring run's language paired with the text it covers. That
  last one exists because `/Lang` lives only on a marked-content property dictionary inside the page's
  compressed content stream: no role, no annotation, nothing in the uncompressed bytes, so deleting
  the template's `text(..language(m.language), body)` left every other assertion passing. It throws
  rather than answering empty, so it cannot go quietly vacuous.
- **The regression corpus and veraPDF.** `apps/worker/src/regression.test.ts` builds each case as an
  outline, through `assemble` and the publication template, and compiles it with the pinned Typst; the
  checker (`apps/worker/src/testing/verapdf.ts`) runs the pinned `verapdf/cli` image, pulled by digest
  (`pnpm --filter @alloy-works/worker fetch-verapdf`), against each PDF's PDF/UA-1 profile - one
  process for the whole run, in veraPDF's server mode, started on the first check by the suite's global
  setup and reached by every test file over 127.0.0.1 (`testing/verapdf-server.ts`). This runs
  in the worker's own test suite, on every change to the template, the engine or `assemble`; every
  publication is checked by the worker's own veraPDF too (`check_pdf`, above), and `check.test.ts`
  runs that job with the suite's in its stead (`suiteChecker`). `apps/worker/src/marks.test.ts` is the same pattern over
  a marked document: every mark set, the links reaching the page, a quoted phrase given no quotation
  marks of its own, one run heard in another language, and veraPDF over the result. The corpus itself
  holds these cases: six heading levels, which veraPDF passes, each tagged `H1` to `H6`; nine
  heading levels, refused for the PDF by name from the seventh and published to Word as its nine
  heading styles, with the engine's `P` for levels seven to nine kept as a tripwire (W14.2); a PDF not
  made to PDF/UA-1, which veraPDF must fail; `assemble`'s verdict on sixteen character probes held to
  the engine's; and the code face's dropped letter. Then (W14.3) the publishing engine spike's nine
  cases ported from `spikes/publishing-engine`, a case for every publishing defect filed, named by
  its issue (those still open pinned as they stand), and the keep rules' cases, its documents built by
  `apps/worker/src/testing/corpus.ts` (docs/testing.md). The resolution order's test is
  `packages/domain/src/publishing/order.test.ts`.
- **The publishing budget** (PUB-102, W14.2). `apps/worker/src/publishing-budget.test.ts` declares
  a 311-page reference document - 30 chapters, each a component of 100 blocks, 150 each of figures,
  tables, numbered equations and footnotes and 2,400 paragraphs of prose - seeded through the store,
  and publishes it eleven times from `requestPublication` to the publication `processNext` records,
  the publish job alone among the handlers. The first is held to the maximum alone; the other ten
  are held to a p95 of ten seconds and a maximum of thirty where `CI` is not `true`, and recorded only
  on CI's runner, as STR-063's navigation budget is. The `check_pdf` each publication queues (W14.1)
  is settled outside the measured span before the next publish: the first's and the last's by the
  run's veraPDF, each held to join its publication within five minutes of its recording and to pass
  PDF/UA-1, and the others' passed over unchecked. The configuration - CPU, operating system,
  memory, Node, Typst and PostgreSQL - and the pages and parts read back off the PDF are written into
  the test's `meta`, which the JSON reporter carries into `.trace-results/worker.json`. It runs in the
  ordinary suite, in about fifty seconds. `config.test.ts` holds the worker's defaults to the five
  minutes for a check whose first attempt fails: two leases, the queue's first backoff and a poll.
- **The Open XML validator and the Word check.** `apps/worker/tools/ooxml-check/` is a .NET 8
  console program over the Open XML SDK's `OpenXmlValidator` (`DocumentFormat.OpenXml` 3.5.1, Office
  2019's rules), its packages pinned by a NuGet lock file and restored from nuget.org alone, built
  into an image from digest-pinned `mcr.microsoft.com/dotnet` images by
  `pnpm --filter @alloy-works/worker fetch-ooxml-check`, and tagged
  `alloy-works/ooxml-check:<hash>`, the hash of its own sources, so a changed source names an image no
  machine has rather than validating with a stale one. `checkOoxml(bytes)` in
  `apps/worker/src/testing/ooxml.ts` runs it with `--pull never` and no network and answers each
  error's description, part, path and type; every worker test that makes a `.docx` asserts none, and
  CI builds the image beside veraPDF's. The Word check, `apps/worker/src/word-check.test.ts` with
  `apps/worker/scripts/word-check.ps1`, opens the writer's fixtures in Word through COM on Windows
  when `ALLOY_WORD_CHECK=1` is set, and is skipped everywhere else, CI included;
  [`testing.md`](testing.md#the-word-check) says how and when it is run.

## Assets

An image uploaded into a space and proved to be only an image, built by
[figures 1](plans/2026-09-23-figures-01-assets.md) from [assets.md](design/assets.md). The
editor places it as a figure through these routes (see [the editor](#the-editor-and-its-session)),
and the publisher prints it, read as the publisher and held to its hash (see [publishing](#publishing)).

| Where                               | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain: src/assets/header.ts`      | `ADMITTED_FORMATS` - PNG and JPEG, each made safe by proof (AST-051) - the limits, 25 MB and 50 million pixels, and `readImageHeader`: a strict walk of a PNG's chunks by their lengths and CRCs to `IEND`, or a JPEG's markers and entropy-coded data to `EOI`, saying where the image ends - the service keeps the bytes up to it and no further, so a phone's second picture, a motion clip or a file hidden after the image is never stored - and refusing an animated PNG, a coding the pipeline does not decode, and more pixels than the limit on the header alone. Resolution is read from JFIF, or EXIF where JFIF declares none Dimensions are recorded as displayed, turned by the EXIF orientation |
| `domain: src/assets/version.ts`     | An asset version's stored shape at schema version 1, strict and flat, and its default description: text and a BCP 47 language. `AssetSubstance` canonicalises by the shared rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `domain: content/model`             | A figure's and an inline image's `asset` is an artifact version identifier, tightened in place at schema version 1 on a read-only count of none stored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `db: migrations/tenant/0020_assets` | `asset` in the kind, space and author checks; `asset_upload`, whose runtime role inserts by where, by whom and with what description, and moves a state forwards through a trigger: awaiting to checking or refused, checking to ready or refused, with its bytes written once                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `db: src/assets.ts`                 | `createAssetUpload`, `receiveAssetBytes` (the move to checking and the `ingest` job, in one transaction), `recordAsset` (the asset in the upload's space at 0.1 by its uploader, and the upload ready, in one), `refuseAssetUpload` from the state named, and nothing where the upload has left it, `readAssetUpload`, `readAssetVersion`, `holdObject` - an advisory lock on an image's hash - and `objectInUse`, whether an asset version or another upload checking or ready still names the bytes                                                                                                                                                                                                          |
| `objects: src/store.ts`             | `remove(key)`, with the tenant key check the others make                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `api-contract: assets.ts`           | Five routes. The contract grew three things for them: a raw body of one content type and a byte limit, a binary answer of named types, and a target named by an artifact **version**, decided on the artifact it belongs to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `service: src/assets.ts`            | The handlers, and the service's half of the check: `create` in the upload's space decided again by `authoriseAt` when the bytes arrive, anything but `application/octet-stream` answered `415` without touching the upload, the format from the bytes, the walk and the pixel limit, each refusal committed on the upload before it is answered; then the image alone kept under its hash, held by it while it is stored                                                                                                                                                                                                                                                                                       |
| `worker: src/jobs/ingest.ts`        | The job: the bytes read back and held to their key's hash, walked again, refused if they run past the image's end, decoded whole by sharp 0.35.4 under the pixel limit - `stats`, which reads every pixel and keeps none - the two readings compared, then `recordAsset`; or the upload refused and its bytes removed in the same transaction, held by their hash, unless anything else still names them. A decoder that fails for its own reasons is retried, not taken as the image's fault. Its last failure refuses the upload as `unchecked`                                                                                                                                                              |

**Two requests make an upload.** `POST /v1/spaces/{space}/asset-uploads`, decided `create` in the
space, makes it `awaiting` with the description its uploader gave; `PUT /v1/asset-uploads/{id}/bytes`,
its uploader's alone, fills it with `application/octet-stream`. A body over the byte limit is refused
by Fastify's `bodyLimit` before it is read whole and leaves the upload awaiting; anything the walk
refuses refuses the upload, and the refusal is committed before the error is answered, so the upload
says why. `GET /v1/asset-uploads/{id}` follows it; anybody but its uploader is told there is no such
upload.

**An asset version is read by who may read its space.** `GET /v1/asset-versions/{id}` and
`.../content` are decided `read` on the asset the version belongs to, found in the deciding
transaction. The bytes are sent after that transaction commits, as a body is, with
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and, since a version never
changes, `Cache-Control: private, max-age=31536000, immutable` - by the service, never by a signed
link to the store, which would expire under an open editor.

**sharp is the worker's alone**, pinned exactly, and the lock file carries its Linux x64 and arm64
binaries, which the worker's image installs; the end-to-end suite uploads an image through the
containers and reads the same bytes back, which is the one place those binaries are run as they will
be.

## Containers and images

One `Dockerfile`, in [`deploy/`](../deploy/) with everything else the system is deployed by, holds
every image the system runs as, so the install and the build are done once and shared. Its build
context is the repository root, and the ignore list beside it, `deploy/Dockerfile.dockerignore`, is
what keeps `node_modules` and the tests out of that context:

| Target    | Carries                                                                                                                                                                                                                                                       | Runs                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `build`   | The workspaces the containers need, installed and built                                                                                                                                                                                                       | Nothing; the other targets copy from it              |
| `tools`   | The whole workspace, `tsx` included                                                                                                                                                                                                                           | The compose stack's setup, and the stand-in provider |
| `service` | `apps/service` and its production dependencies, plus the built renderer at `/app/renderer`                                                                                                                                                                    | `node dist/server.js` on 8088                        |
| `worker`  | The same for `apps/worker`, with its pinned faces and publication template, plus the pinned Typst binary, checked against its hash, Debian's `openjdk-17-jre-headless`, and veraPDF's jars and launcher, copied from the pinned `verapdf/cli` image by digest | `node dist/main.js`                                  |

Neither image carries development tooling, test files or Electron: the install is filtered to the
workspaces the containers need, and `pnpm deploy` reduces each app to its own production tree. The
service image is the exception to "no renderer": it carries `apps/web/dist` as static files, because
the page and the API it calls have to be one origin.
Both run as the `node` user. The worker's veraPDF comes from the image the worker's suite checks
with, named once as the `VERAPDF_IMAGE` build argument, which `apps/worker/src/image.test.ts` holds
equal to the suite's pin. That image is Alpine and published for x86-64 alone, and its Java runtime is
built against musl, so only `/opt/verapdf` is copied from it - veraPDF's jars and its launcher, the
same on every architecture - taken as `VERAPDF_PLATFORM`, `linux/amd64`, whatever the worker is built
for. They run on Debian's `openjdk-17-jre-headless` (veraPDF 1.30.2 asks for Java 11 or later), which
Debian builds for each architecture the worker is, so the worker image stays multi-architecture as
Typst's download already made it; the launcher finds `java` on the path, and nothing sets
`JAVA_HOME`. The stage runs `verapdf --version` as it builds. Built for arm64 under emulation, the
worker target built, its `verapdf --version` among it, and an image of the same runtime and jars for
arm64 passed a PDF/UA-1 PDF and failed an untagged one; no arm64 machine has run the worker natively.
veraPDF and its runtime add about 238 MB, uncompressed, to the
worker image: Debian's runtime is 220 MB of it, where the musl runtime the first build copied was
51 MB. CI builds both images, for x86-64, on every pull request and runs each entry point, veraPDF's
among them; nothing is pushed anywhere, because where they would be pushed comes with hosting.

`deploy/compose.yaml` runs the whole system: PostgreSQL, the object store, the stand-in provider, a
one-shot `setup` that migrates and creates the development environments, then the service and the
worker. Two of those services answer to a name rather than only a container: the object store is also
`store.localhost` and the provider `idp.localhost`. Any `*.localhost` name resolves to the local
machine in a browser and to the container inside the compose network, so **one address works on both
sides** - which is what a signed download link and a sign-in redirect need, since each carries the
address that made it. Their published ports must match the ports inside for the same reason.

The development environment also answers at `127.0.0.1`, given by `DEV_EXTRA_HOSTNAME`, so a tool
that makes nothing of `*.localhost` still reaches it - `tests/e2e` is the reason. Running the setup
again brings an environment's addresses up to date rather than only creating what is missing.

## Build and packaging

| Workspace          | Build                               | Output                                       |
| ------------------ | ----------------------------------- | -------------------------------------------- |
| `packages/domain`  | `tsc -p tsconfig.build.json`        | `dist/` - JS, `.d.ts` and source maps        |
| `packages/editor`  | `tsc -p tsconfig.build.json`        | `dist/`, beside the `style.css` it exports   |
| `packages/readers` | `tsc -p tsconfig.build.json`        | `dist/` - JS, `.d.ts` and source maps        |
| `apps/web`         | `vite build`                        | `dist/` - the static renderer bundle         |
| `apps/desktop`     | `tsc`, then esbuild for the preload | `dist/main.js`, `dist/preload.js` (CommonJS) |

**The preload is bundled, not merely compiled.** The window is created with `sandbox: true`, and a
sandboxed preload can `require` only `electron` and a small set of Node built-ins - a relative
`require` throws before `contextBridge` is reached. `tsc` alone emits `require("./shell.js")`, and
the failure is **silent**: the bridge is never injected, `resolveBridge` falls back to the browser
implementation, and the desktop window reports itself as `web`. So esbuild bundles `preload.ts` into
one self-contained file with `electron` left external, and a test fails the build if a relative
`require` reappears in the output.

Turborepo orders these: `build`, `typecheck` and `test` all declare `dependsOn: ["^build"]`, so the
domain package is built before anything that imports it.

The Electron main process is **CommonJS** on purpose. An ESM main process would force
`sandbox: false` on the preload, which is a worse trade than the one import attribute the CommonJS
side needs to type-import from an ESM package (see the comment in `apps/desktop/src/shell.ts`).

## Packaging

`apps/desktop/electron-builder.yml` produces a Windows NSIS installer, and carries macOS and Linux
configuration that has not been run. There is **no signing, no notarisation, no auto-update and no
release workflow** - `pnpm --filter @alloy-works/desktop package` builds one locally. When releases
are wired up they run on a **tag**, not on every PR.

Two layout facts the shell depends on:

- **The renderer is copied into the bundle as `renderer/`.** `apps/web` does not exist inside the
  package, so `files` maps `../web/dist` to `renderer/` and `rendererIndexHtml` resolves that path
  when `app.isPackaged` is true.
- **Images are unpacked out of the asar.** Electron's **native** image loader is not asar-aware,
  even though Node's `fs` is - so a tray or window icon path inside `app.asar` reads fine from
  JavaScript and produces no icon at all, with no error. The tray images and the window icon are
  listed in `asarUnpack` and read from `app.asar.unpacked` via `assetRoot()`. The renderer is
  deliberately **not** unpacked: `loadFile` goes through the asar-aware path.

## Icons

The vector masters live in `assets/brand/`; everything else is rendered from them. An icon path is
never a build error in any of these mechanisms - the platform substitutes its own default silently -
so every path below is checked against the disk by a test.

| Where                     | Mechanism                                 | Asset                                           |
| ------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Browser tab               | `<link rel="icon">`, ICO and SVG          | `apps/web/public/favicon.ico`, `mark-light.svg` |
| iOS home screen           | `<link rel="apple-touch-icon">`           | `apps/web/public/apple-touch-icon.png` (opaque) |
| Installed web app         | `site.webmanifest`, incl. a maskable icon | `apps/web/public/icon-*.png`                    |
| Window and taskbar        | `BrowserWindow({ icon })`                 | `apps/desktop/assets/icon.png`                  |
| macOS Dock, development   | `app.dock.setIcon()`                      | same                                            |
| About panel               | `app.setAboutPanelOptions({ iconPath })`  | same                                            |
| Tray / menu bar           | `new Tray()`, theme-aware                 | `apps/desktop/assets/tray/*`                    |
| Windows app identity      | `app.setAppUserModelId()`                 | none - see below                                |
| Application icon          | electron-builder `win`/`mac`/`linux`      | `apps/desktop/build/*`                          |
| Installer and uninstaller | electron-builder `nsis`                   | `apps/desktop/build/icon.ico`                   |

**`AppUserModelID` is the one with no asset.** Windows groups taskbar buttons, jump lists and toast
notifications by that id rather than by the window or the executable; left unset, the app inherits
Electron's identity and shows Electron's icon however the other icons are configured. It must equal
`appId` in the packaging config, and a test asserts it does.

**The tray needs three files, not one.** macOS takes a template image and inverts it for the menu
bar itself; Windows and Linux have no such concept, so the glyph is swapped against
`nativeTheme.shouldUseDarkColors` and re-swapped when the theme changes. Each variant ships an
`@2x` companion, which Electron finds on its own from the 1x path.
