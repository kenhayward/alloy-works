# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

## 0.2.10 - 2026-09-11 (PR #15)

The publishing engine is chosen: Typst, fed the document as data rather than as code.

### Added

- A decision that Typst produces the PDF. It was the only one of four open-source engines to pass
  all four gates, and it went on to pass the five remaining cases - mathematics in every position,
  roman and restarted page numbering with running heads, embedded typefaces, a 300-page document in
  1.3 seconds with every generated page number right, and byte-identical output on two different
  kinds of server.
- Typst is given the document as data, read by one fixed template, and never as Typst source. Typst's
  language can run code, so writing content into it would turn every missed escape into code running
  inside the publishing pipeline - the spike showed one line of content doing exactly that. As data,
  the same line prints as the characters it is.
- Seven requirements: a provisional budget for preview and for publishing, content reaching the
  engine only as data, the engine version recorded with every publication and kept available for as
  long as its baseline exists, untagged previews of part of a document but never an untagged
  publication, and a publish that fails when any character has no glyph in the theme's typefaces.

### Changed

- XHTML is no longer the step between the content and the PDF, though it stays a first-class export.
  The earlier decision about the content model is otherwise untouched.
- The spike findings now cover all nine cases, including two more failures that make no noise: an
  engine that sets unreadable empty boxes, or borrows letters from a font nobody chose, when a
  typeface lacks a character; and a contents page that prints the wrong page number while its own
  link goes to the right one.

## 0.2.9 - 2026-09-11 (PR #14)

The publishing engine spike has run its four gates, and one engine passed all of them.

### Added

- The findings of the publishing engine spike. Four open-source engines were each asked to produce
  an accessible PDF, place footnotes on the right page, break a long table across pages, and
  re-render page 40 of a 300-page document fast enough to preview while writing. Typst passed all
  four; no other engine passed more than two.
- The most important thing it found is a failure nobody would see. Given a footnote too long to fit,
  one engine pushes it upward past the top of the page, and the first part of the note simply is not
  there - no error, no warning, and nothing for a reader to notice.
- The harness that produced those findings, kept so the cases can be re-run against whichever engine
  is chosen. It runs in Docker and is not part of the build.

### Changed

- Choosing Typst is not recorded yet. It collides with an earlier decision that the published
  document passes through HTML on its way to PDF, which Typst does not read, and the cost of that is
  every theme existing twice - once for the editor and once for the output. That is a product call,
  and it is written up for one.
- The requirements are found to be missing two things: a stated budget for how fast preview must be,
  and any record of which engine version produced a publication. Without the second, re-publishing an
  approved document on a newer engine can change it with nothing anyone pinned having moved.

## 0.2.8 - 2026-09-10 (PR #13)

Where design documents live, and the first one: how history is stored.

### Added

- `docs/design/`, one document per subsystem, sitting between the requirements and the code. Each
  design document names the requirements it answers, and a test builds the reverse index - so a
  requirement nothing claims is work not yet designed, and that gap shows up without anybody
  maintaining a list. Design boundaries follow subsystems rather than the twenty-one requirement
  areas, because storage alone answers six of them.
- A decision on how history is stored: a relational, append-only version chain with content held
  inline and addressed by a hash. Baseline pins are real foreign keys, so refusing to delete
  something a baseline still needs is the database's job rather than something application code has
  to remember. Interim saves live in a separate store with a time to live that nothing points at,
  which keeps continuous autosaving out of the table every audit and comparison reads.
- The first design document, covering iterations, versions, revisions, baselines, restore and
  derived data. It answers thirty-two requirements, and says which ones it deliberately does not.
- Two requirements for derived data: what produced it must be recorded, and re-deriving must alter
  no version. Embeddings are keyed by the content they came from rather than by the version they
  were found in, so identical text is embedded once however many versions and documents contain it.
- A requirement that computing an embedding is a model call like any other, and so is subject to the
  same rules about a tenant's data boundary. Semantic search reads like an index rather than like
  inference, which is exactly why that needed saying.

### Changed

- Event sourcing is ruled out rather than left open. The argument for it was that comparison needed
  a log of every edit; the content model spike found that it does not.
- Semantic search will not have a permission story of its own, and must not. Because the vectors sit
  beside the content they came from, filtering by permission is part of the search rather than
  something applied to its results - which matters, because discarding results afterwards leaks the
  fact that they existed.
- `docs/README.md` and `docs/architecture.md` now distinguish what is true of the repository today
  from what is planned. Architecture is the map; the design documents are the depth.

## 0.2.7 - 2026-09-10 (PR #12)

How people outside the organisation take part, which the requirements had flagged as the question
most likely to force a change.

### Added

- A decision on external participation. A client reviewer becomes a guest principal inside the host
  tenant - read, comment and suggest, never edit, approve, sign or publish - authenticating the same
  way everybody else does, with an expiry that cannot be left unset. A finished report reaches
  somebody outside by a link that names its recipient, expires, can be revoked, records every access
  and tells a reader when a later publication has superseded the one they are holding.
- Seven requirements covering guest principals, and four covering shared publications.
- Three requirements making a comment thread markable internal, so that a document can be reviewed
  alongside a client without every conversation happening in front of them.

### Changed

- Anonymous distribution is now explicitly not something the product does. A report meant for the
  public goes on a web server. A reader with no identity cannot be told that the version in their
  hands has been corrected, and answering that is most of the reason this product exists.
- Sharing between tenants stays out, and is now deferred rather than merely absent: what would bring
  it back is customers' own clients becoming customers, and until that happens guests serve the same
  need for a fraction of the work.
- Two smaller questions replace the two large ones: what a guest's name should do on a five-year-old
  comment once their access has lapsed, and whether one person invited by three organisations is one
  record or three.

## 0.2.6 - 2026-09-10 (PR #11)

The three decisions that needed a product answer rather than an engineering one.

### Added

- A decision that tenants are isolated by schema - one database, a schema per tenant, enforced by
  the database's own roles rather than by application code remembering a filter. What settles it is
  which mistakes stay reversible: moving a schema into its own database later is mechanical, while
  splitting pooled rows into schemas later is a migration of everything.
- A decision that authentication is federated and the product never holds a password. A tenant uses
  its own provider over OIDC, or Google accounts where it has no provider yet, which is the state
  every tenant is in for its first hour. Only basic identity scopes are requested, which is what
  keeps the product out of Google app verification.
- A decision that product-supplied typefaces are open-licence only, and that a customer's brand face
  is supplied by the customer under the customer's own licence. Same reasoning as the publishing
  engine: nothing priced per server, per domain or per title sits between a document and its reader.
- Five requirements that follow from those: the Google route and the tenant's choice of which
  authentication routes it permits, the ban on local credentials, the licence terms product-supplied
  typefaces must meet, and coverage of the scripts and mathematics the rest of the specification
  already promised.

### Changed

- A baseline now pins the typeface files it published with, not the theme version that named them.
  This closes a real gap: one requirement pins a theme version in a baseline and another requires
  re-publishing that baseline years later to produce the same document, and those two are only
  compatible if the files themselves are pinned. A typeface revised or withdrawn in the meantime
  re-renders the document differently and says nothing about it.
- The open question about Google Docs export now records that it has a second problem as well as
  being lossy. Writing to somebody's Google Docs needs restricted scopes, which means app
  verification and a periodic security assessment - a compliance cost nothing else in the product
  carries.

## 0.2.5 - 2026-09-10 (PR #10)

How documents will be turned into PDF, decided in part.

### Added

- A decision to keep per-server commercial licensing out of the publishing pipeline. The two engines
  that reliably meet the fidelity bar are priced per server, and keeping them out keeps the cost of
  running the product independent of what it charges. The price is that whatever the free engines do
  not do becomes something to build, and accessible tagging is the likeliest candidate.
- `docs/specification/Publishing_Engine_Spike.md`, the brief that chooses between the open engines
  that decision leaves. Nine cases, four of them gates, and one of them a question the requirements
  had quietly left contradictory: a preview must be quick and must come from the same machinery as a
  finished document, and an engine that has to lay out every page before it can show the fortieth
  cannot do both.

### Changed

- The risk register now says that a licensing risk has been traded for a fidelity one rather than
  retired. What happens if that trade turns out badly was already written down, and it is that a
  licence comes back into the cost model and the smallest worthwhile customer gets larger.

## 0.2.4 - 2026-09-10 (PR #9)

The first detailed requirements, and identifiers to track them by.

### Added

- `docs/specification/requirements/`, holding one document per capability area in the scope. Every
  requirement carries an identifier like `CNT-014` so it can be pointed at from a commit, a test or
  a conversation without being quoted, and so that progress can be read off what cites it rather
  than off a status column somebody has to remember to update.
- The first area written in full: content and authoring. Eighty requirements covering the content
  model, the block and inline vocabularies, footnotes, mathematics, citations, characters, pasting
  from other tools, the editing session, the document view and editor accessibility - each with the
  reasoning next to it, because a requirement without its argument gets re-litigated by the first
  person who disagrees.
- All seventeen area codes are reserved up front, so the shape of the whole specification is visible
  before most of it is written and nothing quietly fails to be specified at all.
- A test over the requirements. Identifiers have one permitted shape, are never issued twice, never
  renumber, and leave no gaps - a withdrawn requirement keeps its row rather than vanishing. It also
  checks that every requirement actually states something binding, which caught twenty-one entries
  that were vocabulary items rather than requirements.
- Non-requirements and open questions are numbered as well, so a reviewer can cite one without
  quoting it, in a shape that cannot be confused with a requirement.

### Changed

- Revised after review. An author can now apply bold, italic, underline, superscript and subscript
  directly - the earlier wording put appearance entirely in the hands of the theme, which is right
  for blocks and wrong for characters. What an author still cannot choose is a typeface, a size or a
  colour, because those are what make two parts of one document look like they came from two.
- Language is recorded rather than foreignness. The earlier wording spoke of a "foreign phrase",
  which describes a relation to a reader rather than a property of the text; a component now
  declares its language and any passage that differs declares its own.
- Images can sit in a table cell and inline with text, and carry an intent - icon, inline, column
  width, full width - that the theme turns into a real size. So the same illustration can be sized
  for the document it appears in rather than carrying one size everywhere.
- Footnotes hold text and citations, and deliberately not tables or images. That was an open
  question and is now settled.
- The editor shows the spacing the theme will apply, so removing an author's blank lines no longer
  means losing the gap they were making.
- Where a component cannot be edited, the reason is shown - who holds it and when it frees up -
  rather than only that it is unavailable.
- **Three words for a component's history, where there had been one.** An **iteration** is an interim
  save - immutable, private to whoever holds the lock, and kept only long enough to recover from a
  closed tab. A **version** is an iteration kept for the record, cut when an author stops rather than
  on every keystroke. A **revision** is a version that has been issued, when a component passes a
  lifecycle gate. Written together as `3.14` - the fourteenth version since the third issue.
- This closes a real gap: content saves continuously, but a snapshot is deliberately not taken on
  every keystroke, and until now the save had nowhere to land. It also stops an author pressing save
  from spending a number that is supposed to mean somebody signed something.
- The scope, the domain package, the README and the feature list now use the new words. Earlier
  records keep their wording and carry a note, because a record of what was decided is not rewritten
  after the fact.
- Appearance now comes from **named styles picked from a catalogue** that an administrator can
  extend - an image is a "Thumbnail", a paragraph takes a paragraph style, a table takes a table
  style, a citation takes Harvard or Vancouver. Authors get real control over how something looks
  without being handed a font picker, and a house style has somewhere to live.
- An image style fixes one dimension and takes the other from the picture's own proportions, so
  nothing is ever squashed. Where that would make an image too tall for the page, the style caps the
  height instead and still keeps the proportions.
- The editor shows the theme's type and spacing, and a preview shows the document as it will
  publish, in whichever output format is chosen. Both are needed: a scrolling editor can show the
  words a reader will see but has no pages, so it can never show where a table breaks.
- Spelling is checked as you type, against the language of the words being written rather than one
  language for the whole editor, with room for a tenant's own dictionary. It behaves the same in the
  desktop app, which does not get it for free the way a browser does.
- The document opens in one of three modes - read, review or author - so a reader is not looking at
  an editing interface with most of it greyed out.
- A version is now only ever created by a deliberate act, never by leaving the room. Interim saves
  are kept until the next version rather than for a fixed time, so nothing is lost by walking away
  and nothing is recorded as a decision nobody made.
- Undo reaches back to where the editing session started and no further. Going back beyond that is
  restoring an earlier version, which is a different and recorded act.
- An eighteenth capability area, **styles and presentation themes**. Style catalogues turned out to
  span the editor and the publisher and to belong to neither, so they now have a section of their own
  in the scope rather than being assumed by both.
- The specification is marked **v1** and is the baseline the next round iterates against. It is not
  finished in the sense of being right - 91 open questions say otherwise - it is finished in the
  sense that every area has been written once, so that a change to any of it is now a visible change
  rather than a gap being filled.
- **All twenty-one capability areas written**: 847 requirements, 88 non-requirements and 91 open
  questions, each carrying the reasoning beside it. Enough of the specification to choose an
  architecture on, which was the point of writing them.
- Seven of the twenty-one areas written in full, close to four hundred requirements between them:
  content and authoring, structure and numbering, identity and access, data and bindings, styles and
  themes, publishing and output, and templates. Enough of the specification to choose an architecture
  on, which was the point of writing them.
- Two more areas written in full. **Structure, numbering and cross-references** covers the outline a
  document is built from, the numbering computed over it, and what "see section 4.2" resolves to -
  all of it recomputed rather than stored, because a component that is section 2 of one report and
  section 7.3 of another cannot carry either. **Identity, tenancy and access control** covers the
  customer boundary, signing in through a customer's own directory, and who may do what - written
  as how things must be enforced rather than only what must be true, since this is the area where a
  mistake is a breach.
- A map of which area owns each thing the specification defines, and a check that nothing is
  missing from it. Two areas so far have existed only because somebody happened to ask "is that
  covered elsewhere?" - an artifact may now be listed as belonging to nobody, deliberately and
  visibly, but it cannot simply be absent.
- A twentieth, **assets and media**, and a twenty-first, **reference libraries**. Both came out of
  the ownership pass: assets, bibliographies and terminology were all things a space holds and
  content points at, and none of them belonged to anybody.
- Terminology in particular is new to the specification. A term is referenced rather than typed, the
  same way a citation is, which is what makes "Marketing Authorisation Holder (MAH)" on first mention
  and "MAH" thereafter possible at all - whether a mention is the first depends on the document, and
  a component reused in two reports may be the first in one and the fortieth in the other.
- A nineteenth, **templates and document instantiation**. Most documents in this product will begin
  by being created from a template, and nothing covered that happening once - only the same thing
  happening in bulk. It also gives a home to the two definitions nothing else owned, the metadata
  schema and the starting outline, and to the template designer the scope named as a user and then
  never served.
- An author can move a document's reference to a different version or revision of a component,
  forwards or back, from the document itself - the audited step back and step forward. It changes
  what a reader sees without changing a word, so it is recorded.
- Comparison is reachable while writing: pick an earlier version or revision from a list showing who
  changed each and when, and see it as a redline. Separately, an author can see what they themselves
  have changed since sitting down, which is a different question with a different boundary.

## 0.2.3 - 2026-09-10 (PR #8)

The rules for decision records, written down and then enforced.

### Added

- A test over `docs/decisions/`. Every record has to appear in that folder's index, every index row
  has to point at a record that exists, and the two have to agree about a record's status. The index
  was previously kept in step by hand, which works right up until it does not - and an index that
  has quietly fallen behind is worse than none, because it says a decision does not exist.

### Changed

- The working agreement now says what a decision record actually is, rather than leaving it to be
  inferred from the four that happened to exist: the sections it contains, the statuses it can
  carry, and the rule that its status line is the only part ever edited afterwards.
- It also says when to write one. Two different tests were in circulation - one in `CLAUDE.md` and a
  different one in the decisions folder - and they are now a single rule with both halves: the
  choice constrains later work, **and** its reasoning would otherwise have to be reconstructed from
  the diff. Along with a note to wait until a decision has survived contact with something rather
  than recording it while it is one conversation old.
- `docs/specification/` is now described in the working agreement. It is the one folder that
  describes the product being built towards rather than the repository as it is, which is what
  separates a specification from a decision record.

## 0.2.2 - 2026-09-10 (PR #6)

The content model decision, tested rather than argued. All four gates pass, so ADR-0005 stands.

### Added

- A schema draft for the content model in `packages/domain/src/content/` - a tree of typed nodes
  carrying marks applied to ranges of text - together with the four hardest cases from the spike
  brief, each written as a test named after the case it answers.
- Overlapping annotations work with no construct of their own: a profiling condition and a
  reviewer's redline can cover overlapping parts of the same sentence, and accepting one then
  excluding the other gives exactly the same result as doing it the other way round.
- Comparison tells a paragraph that moved and was reworded from a paragraph that was deleted and
  replaced, which is the difference between a comparison view that informs and one that is noise.
- A footnote anchored to a cell of a query-driven table stays on the same data when the query
  reorders its rows, and produces a named error - never a blank - when the row it points at stops
  being returned.
- Word documents can be read and written: tracked insertions and deletions arrive as suggestions
  attributed to their author, comments arrive as threads anchored in the content, and footnotes and
  cross-references survive both directions.

### Changed

- `.gitattributes` now pins Office formats as binary. They are ZIP archives, and a checkout that
  normalises line endings inside one produces a file that no longer opens - with a diff that says
  nothing changed.

### Fixed

- Exported Word documents now carry heading numbers, footnote numbers and the spacing between
  blocks. Opening an exported file in Word showed all three missing, and none of it was visible to
  the round-trip test, which reads our own output and so could only ever prove that our reader and
  our writer agree with each other.
- Importing a Word document no longer discards empty paragraphs without saying so. Word writes an
  empty paragraph in a shorter form that the reader was not looking for, so they were dropped and
  never counted - and an import that quietly loses content is the one thing the importer is not
  allowed to do. They are still dropped, deliberately: blank lines are a way of laying a page out,
  and layout is the theme's job, not the content's. What they were doing by hand now comes from the
  layout instead, with wider spacing around headings and a rule that keeps a heading on the same
  page as the text beneath it.

## 0.2.1 - 2026-09-10 (PR #5)

The first scope document, and the first decision it needed. Still no product - this says what the
product is going to be, and how its content will be represented.

### Added

- `docs/specification/Project_Scope.md`, the top-down scope for Alloy Works as a component content
  management system for reports that mix authored narrative with live data. It names the market it
  is aimed at and how it compares to Workiva, Paligo, Heretto, Veeva and Quarto; defines the
  vocabulary the rest of the specification will use - component, revision, document, outline,
  baseline, template, binding, provenance; sets out seventeen capability areas; and is explicit
  about what Alloy Works will not be.
- Nine decisions recorded as settled, with the reasoning: the wedge market, web-first with the
  service as the system of record, the component repository with the template as a binding
  artifact, soft component locks instead of real-time co-editing, OpenAPI as the source of truth,
  a curated rather than mirrored MCP surface, PDF and Word as the fidelity bar, schema-declared
  relationships, and AI output as a proposal until a human accepts it.
- Ten decisions recorded as still open, each with what it hinges on, so that the three irreversible
  ones - the content representation, the storage and revision model, and the publishing engine -
  are spiked before anything is built on top of them.
- Six delivery tranches, ten named risks with mitigations, and a "what would change the answer"
  section in the same idiom as the decision records.
- A decision record for the content model: content is held as a purpose-built tree of nodes and
  marks, serialised as JSON and identical to the editor's own model, with XHTML, OOXML, Markdown
  and DITA serving at the boundary rather than at the core. The deciding argument is that a
  profiling condition and a reviewer's redline routinely cover overlapping ranges of the same
  sentence, and no tree markup can represent that without abandoning its own model - whereas marks
  applied to ranges make it the ordinary case.
- `docs/specification/Content_Model_Spike.md`, the brief that validates that decision before
  anything is built on it. Ten deliberately hard cases - among them a redline crossing a
  conditional boundary, a footnote anchored to a cell in a table that a query might not return, and
  a round-trip through Word with track changes on - of which four are gates that supersede the
  decision record rather than being worked around.
- The content representation therefore moves from the open list to the settled one, the remaining
  irreversible decisions drop from three to two, and Word export moves into the first delivery
  tranche, since the schema is designed against its mapping and that mapping has to be exercised
  while the schema can still change cheaply.

## 0.2.0 - 2026-09-10 (PR #4)

The Alloy Works mark, wired into every place an icon is asked for.

### Added

- The brand mark as the web favicon - an ICO for browsers that want one, an SVG for those that
  prefer it, an opaque apple-touch-icon for iOS, and a web app manifest with a maskable icon so
  an installed app fills the shape Android gives it rather than sitting in a white circle.
- Desktop icons: the window and taskbar icon, the macOS Dock icon in development, the About
  panel icon, and a tray icon that follows the system theme - a template image on macOS, which
  inverts itself for the menu bar, and a light or dark glyph swapped by hand everywhere else.
- A Windows application identity (`AppUserModelID`), without which the taskbar, jump lists and
  notifications show Electron's icon however the app is configured.
- Packaging with electron-builder: a Windows NSIS installer with its own installer and
  uninstaller icons, plus macOS and Linux icon configuration. Nothing is signed or published.
- The vector masters under `assets/brand/`, with a note on how to re-render any size.

### Changed

- `apps/desktop/package.json` now mirrors `version.json`, because electron-builder stamps that
  version into the installer and the executable. A test fails when the mirrors drift.

## 0.1.0 - 2026-09-10 (PR #1)

The first commit of anything beyond a licence. Scaffolding only - no content storage, no authoring
UI, no publishing.

### Added

- A pnpm workspace with three packages: `@alloy-works/domain` (the content model, platform-free),
  `@alloy-works/web` (the React renderer, and the web delivery) and `@alloy-works/desktop` (the
  Electron shell). Turborepo orders and caches the build, typecheck and test tasks.
- One renderer serving both deliveries: the Electron window loads the same React app the browser
  does, pointed at the dev server while unpackaged and at the built bundle once packaged. The
  preload is bundled into a self-contained file so it can load under `sandbox: true`, and the dev
  server address is pinned to the IPv4 loopback so the shell and the server cannot disagree about
  where it is. Both are covered by tests.
- A typed platform bridge - the single seam for everything that differs between a browser tab and a
  desktop window. The shell is typechecked against the renderer's own contract, so the two cannot
  drift apart silently.
- A `Component` content model with validation on creation, on revision and on anything read back
  from storage.
- Test suites for all three packages, and a console gate that fails any test which logs an error or
  a warning.
- Continuous integration on every push and pull request. The check steps are `continue-on-error`
  for now, while the repository finds its baseline.
- Documentation in `docs/`: architecture, development, testing, CI and releases, the feature
  inventory, and the first three architecture decision records. Plus `CLAUDE.md` and
  `CONTRIBUTING.md` as the working agreement.
