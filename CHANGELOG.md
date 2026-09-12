# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

## 0.7.0 - 2026-09-12 (PR #35)

Work that runs in the background, and somewhere to keep what it makes.

### Added

- The service can hand work to a worker instead of making people wait for it. The first kind is a
  sample PDF of an environment, which a worker renders and stores, and which the person who asked
  for it can then download.
- Each environment's documents are kept in its own part of the object store, reached with a
  credential that can reach nothing else, and downloaded through links that expire.
- Expired sign-in attempts and sessions are now cleared away by the worker.

## 0.6.1 - 2026-09-11 (PR #34)

The plan for workers and object storage.

### Added

- The plan for running work in the background: a queue only a tenant's own environment can add to,
  a worker that does each job inside that environment, and somewhere to keep what it makes that no
  other environment can reach.

## 0.6.0 - 2026-09-11 (PR #33)

Signing in with a Google account.

### Added

- An environment can let people sign in with a Google account, personal or Workspace, with nothing
  for the customer to set up - so a proof of concept or a demonstration can start the same day.
- Only the people an environment invited by address, and accounts of the Workspace domains it names,
  come in that way. An invitation belongs to the first account that accepts it, so the address
  changing hands later lets nobody else in.
- Closing a way of signing in ends every session it started.

## 0.5.1 - 2026-09-11 (PR #32)

The plan for signing in with Google.

### Added

- The plan for the second half of signing in: letting an environment take Google accounts with
  nothing for the customer to set up, through one central sign-in address, admitting only the
  people it invited and the Workspace domains it names.

## 0.5.0 - 2026-09-11 (PR #31)

Signing in, for the first time.

### Added

- People can sign in to an environment through their organisation's own sign-in system, and the
  service remembers them until they sign out, stop using it for an hour, or twelve hours pass.
- Signing out ends the session at once, on every device using it.
- The service can say who is signed in and to which environment.
- A session belongs to the environment that issued it: every part of the service that needs one is
  tested to refuse a session from any other environment.
- A stand-in sign-in system with invented people, so development and testing need no real accounts.

## 0.4.1 - 2026-09-11 (PR #30)

The plan for signing in.

### Added

- The plan for the first half of signing in: a stand-in sign-in system with invented people for
  development and testing, signing in through an organisation's own system, sessions, signing out,
  and a check that no environment accepts another's session. Its riskiest parts were tried out first.
  The second half, signing in with Google, will be planned once this half is built.

## 0.4.0 - 2026-09-11 (PR #29)

The service answers for the first time.

### Added

- The web service itself, running for the first time. Each environment answers at its own address,
  and the service works out which environment a request is for from that address alone.
- Every answer and every error follows one published description of the service's interface, which
  the service is built from and checked against, so the two can never disagree.
- Errors always come in the same form, with a reference to quote when reporting a problem, and never
  reveal anything internal or anything sent with the request.
- A development setup with two sample environments, so the service can be run and tried locally.

### Fixed

- Test runs no longer end with warnings about missing test output files (#27).

## 0.3.1 - 2026-09-11 (PR #28)

The plan for the service's first working version.

### Added

- The second of the service's building plans, in full: the service itself, the one published
  description of its interface it is built from, the single form every error takes, and how it tells
  which environment a request is for. Each step starts with the test that proves it, and the parts
  most likely to go wrong were tried out before the plan was written.

## 0.3.0 - 2026-09-11 (PR #26)

The first piece of the service: the database it will stand on.

### Added

- The database layer every part of the service will use. It sets up the database, creates each
  customer environment with its own separate storage, and keeps every environment's structure up to
  date, picking up where it left off if an update is interrupted.
- The safeguard at the heart of it: code can reach an environment's data only by first becoming that
  environment, and a mistake produces an error rather than someone else's information. Every part of
  that promise is tested against a real database.
- A local database for development, started with one command, and the same database in the checks
  every change runs through.

## 0.2.20 - 2026-09-11 (PR #25)

The plan for building the service's skeleton, before any of it is built.

### Added

- A home for implementation plans, and the order the service's skeleton will be built in: the
  database, then the service itself, then signing in, then background work, then live updates and
  the application talking to it - each finished and tested before the next begins.
- The first of those plans in full: the database layer, step by step, each step starting with the
  test that proves it.

## 0.2.19 - 2026-09-11 (PR #24)

The groundwork every part of the service will be built on, designed before any of it is written.

### Added

- A customer can have several separate environments - production, a sandbox, a test copy - each
  completely apart from the others, grouped under one organisation that shares sign-in settings,
  administrators and billing.
- Each environment has its own web address, such as `dev.acme` under the product's domain, and a
  customer's own domain can be added later.
- How signing in, staying signed in and signing out work: sessions end the moment you sign out, are
  revoked or are disabled, on every device at once, and no password is ever stored.
- Sign in with a Google account, personal or work, for trials, demonstrations and development
  environments that have no company sign-in yet. Nothing needs setting up; only people you invite, or
  people from work domains you name, can get in.
- A safeguard at the heart of the service: every request can only ever reach its own environment's
  data, and a mistake in the code produces an error rather than someone else's information.
- The conventions every part of the service's interface follows, so that the application, other
  systems and the published interface description can never disagree.
- The design for these foundations, a decision record, and three new requirements.

## 0.2.18 - 2026-09-11 (PR #23)

The whole system on one page, and the platform it runs on.

### Added

- A map of the proposed system: what runs where, in which language, and how information moves
  between the pieces - signing in, writing, live updates, searching, publishing, previewing and the
  AI assistant - with a diagram for each of the main paths.
- A decision on the platform: the service is written in the same language as the application
  itself, so the rules about content, themes and Word documents exist once; publishing runs on
  separate machines so a large publication never slows anyone down while they write; and files are
  kept in standard cloud storage.
- Development and small installations come with everything they need in one bundle, including a
  file store. MinIO, the usual choice, is no longer maintained, so SeaweedFS is used instead.

### Changed

- The existing architecture document now says plainly that it describes the code as it stands, and
  points to the proposed system for everything not built yet.
- Where the system is hosted, and whether customers can host it themselves, is recorded as the one
  decision still open.

## 0.2.17 - 2026-09-11 (PR #22)

How the screen stays live, decided after measuring it - the last of the open architecture decisions.

### Added

- A decision that each open document keeps one live connection to the service, which tells it who
  else is there, which parts are being edited and when a notification arrives. It works through
  ordinary web connections, so it should get through the corporate networks this market uses.
- A test with 5,000 people on two servers delivered every update to exactly the people allowed to see
  it, typically within a few thousandths of a second, and nothing reached anyone who should not have
  had it.
- If a server stops, the people on it reconnect on their own, and within a few seconds their screens
  show the true state again: who holds which component, and who is where.
- Presence shows which component each person is in and whether they are reading, reviewing or
  writing. It does not show live cursors.
- Someone working in a part of a document you cannot see appears only as being in the document.
- Answers from the AI assistant stream onto your screen as they are written, and stop the moment you
  leave.
- The design for live updates, two new requirements, and one thing the product will not do.

### Changed

- The project scope now says what comes next, now that every open architecture decision is settled:
  review the requirements, finish the designs the first release needs, then build it.

## 0.2.16 - 2026-09-11 (PR #21)

How links between things are stored and followed, decided after measuring it.

### Added

- A decision that relationships between artifacts - "derived from", "satisfies", "see also" and the
  rest - live in each organisation's own part of the database, beside everything else, rather than
  in a separate graph database. A test organisation of a million components and three and a half
  million links answered every question well inside the time limit, once two rules were in place.
- "What would changing this affect" shows the nearest thousand things first, and says when there are
  more, rather than trying to list most of an organisation on one screen. The complete list is
  available as a report that is prepared in the background.
- The warning before you change a component used elsewhere only counts what would actually change:
  the documents that use it and the publications that include them, kept separate from things that
  are merely related.
- "How are these two connected" finds the shortest connection rather than every possible one.
- Following links never passes through something you cannot read, and says when a connection was
  cut short for that reason without saying what was there.
- The design for relationships, four new requirements, and a note to revisit the approach when the
  database gains built-in graph queries that can follow links of any length.

## 0.2.15 - 2026-09-11 (PR #20)

Word documents checked in Word itself.

### Changed

- The two parts of the Word output that had been decided but never seen in Word have now been
  opened in it, and both work. Word asks once whether to update the document when it opens, and the
  contents page, the list of figures and "see page" references then show the right page numbers.
  Equations - sums, integrals, limits, fractions, roots and brackets - come out as proper Word
  equations, exactly as intended.
- Numbered equations keep their number in a form that references can point at, having tried Word's
  built-in equation numbering beside it.

## 0.2.14 - 2026-09-11 (PR #19)

How search will work, decided after measuring it.

### Added

- A decision that search runs inside each organisation's own part of the database, searching by words and by
  meaning together, rather than in a separate search service holding a second copy of everything.
  A test organisation of a million components showed it fast enough, provided each search is planned for
  the person asking and the heaviest ranking work is capped.
- Results come back as one list, each marked as matching your words, the meaning of your query, or
  both.
- What you cannot read stays out of your results, counts and filters. The one thing it may influence
  is the order of your results, and that is now stated openly rather than promised away.
- A person who can see only a small part of a large organisation gets a full page of results by
  meaning, where a common shortcut would have shown them nothing.
- Very large result counts show as "1,000+" rather than slowing every search down.
- A provisional time limit for a search, four new requirements, and the design for search.

## 0.2.13 - 2026-09-11 (PR #18)

How Word documents get made, and what they promise.

### Added

- A decision that Word documents are written by our own code, from the same finished document the
  PDF is made from, rather than by a converter or a library. The approach has already been opened
  in Word twice - once for the content model, once for themes - and it is the only one that keeps
  heading numbers, footnotes and cross-references as things Word understands rather than as text.
- A decision that a Word document lays out its own pages. It carries exactly the same content,
  numbering and cross-references as the PDF, but Word decides where pages break, and a recipient's
  first edit moves them anyway. So a page number cites the PDF, and the publication says so.
- Contents pages and "see page" references in Word are worked out by Word itself: the document asks
  to refresh them when it is opened, rather than showing page numbers copied from the PDF that would
  be wrong in Word.
- Equations in Word are real Word equations, built from the same source as the PDF's.
- The design for the Word output, and three requirements that make those promises binding.

## 0.2.12 - 2026-09-11 (PR #17)

The theme model, built and measured: one theme now looks the same in the editor, the PDF and Word.

### Added

- A working prototype of the theme model: a theme checked against a fixed set of typed properties,
  worked out once into concrete values, and translated for the editor, for the PDF and for Word - 41
  tests, written before the code they test.
- A harness that renders the same document all three ways and measures where every line sits. Every
  line now lands within a fifth of a point of the others, and the PDF and Word within a hundredth.
  Opened in Word itself, the document matches the PDF, including its bold and bold italic words.
- A decision recording that shape, now that it has been tested against something real.

### Changed

- The design was wrong in one place, and the prototype found it before any user could. In Word, bold
  in a heading and bold on a word inside it cancel each other out, and a word can carry only one
  character style - so a bold word in a heading, or a word both bold and italic, came out wrong in
  Word however carefully the styles were written. Word output now sets those words' formatting
  directly, and only where Word would otherwise get them wrong.
- Line spacing needed stating more precisely than "a distance". Where a heading meets body text,
  Word puts a line's extra space above it and a web page splits it, so the editor sat a point off.
  A typeface now carries the measurements of its letters, which is what lets all three agree.

## 0.2.11 - 2026-09-11 (PR #16)

How a theme looks the same in the editor, in the PDF and in Word.

### Added

- The design for themes. A theme is data in a fixed set of typed properties - never a stylesheet and
  never code - worked out once into concrete values and then translated for each of the three places
  a document appears. Nothing downstream decides anything about a style, so the editor and the
  published document cannot disagree about which one applies.
- A decision about the words that mean different things in each target. Space between two
  paragraphs is the space after the first plus the space before the second, everywhere, because that
  is how Word does it and Word is the one place a recipient can restyle the document. Line spacing is
  a distance in points rather than a multiple, because "1.15" means three different things in the
  three targets.
- The editor sets text at the page's own text width, zoomable, the way Word's page view does - so an
  image sized to the column is the width it will print, and line lengths look like the output.
- In dark mode the document stays on paper: the application's chrome goes dark, the page does not.
- A brand typeface that may not be embedded in Word names a permitted stand-in for Word, and every
  publication says when it was used.
- Five requirements for those, and a sixth: an automated suite that measures each style property in
  all three targets and fails when they disagree, because agreeing on the values somebody thought to
  test is not the same as agreeing.

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
