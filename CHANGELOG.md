# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

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
