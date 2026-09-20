# Features

The canonical, full-prose inventory of what Alloy Works does. The Features table in
[`README.md`](../README.md) is a short two-column summary that links here; when a feature changes,
**both change in the same PR**.

> **Status: the first pieces of the first tranche, on scaffolding.** Components can be made, edited and
> versioned, their text formatted, linked and marked with a language, and documents made, their
> outlines restructured, their sections numbered and their paragraphs published as a laid-out PDF with
> a cover, a contents and numbered pages that carries all of that formatting. Nothing is arranged
> beyond paragraphs - no list, table, footnote or equation - and nothing is cross-referenced.
> What follows describes what actually exists today, so that
> each new feature has something honest to be added to rather than a list of intentions to be
> corrected.

## What exists today

- **An environment you can open.** Point a browser at an environment and it shows itself: which one
  it is, a way to sign in with the organisation's provider or a Google account, and once you are in,
  who you are. Ask it for a sample document and a worker renders it, the page saying so the moment
  it is done without being asked again, with the document handed over by a link only that
  environment can sign. The desktop app opens the same environment and signs in the same way. It is
  the whole system working end to end, on one sample document, and it is the shape the first real
  feature arrives into rather than a feature itself.

- **One renderer, two deliveries.** The React renderer in `apps/web` is served as a web application
  and loaded unchanged by the Electron shell in `apps/desktop`. There is no per-delivery fork of the
  UI, and the running app names which delivery and runtime it is on.

- **A platform bridge.** The single seam between the renderer and its host. In a browser it answers
  locally; in the desktop shell it answers over an enumerated IPC channel from a sandboxed preload.
  The renderer never branches on which one it got.

- **An identity.** The Alloy Works mark - an isometric wireframe cube whose three coloured seams
  run into one fused centre node - as the browser favicon, the installed web-app icon, the desktop
  window, taskbar, Dock and About-panel icon, a theme-aware tray icon, and the application and
  installer icons for a packaged build. The vector masters live in `assets/brand/`.

- **A service, and the environments it serves.** One web service answers for every environment,
  telling them apart by the address in the browser's bar, and keeps each one's data in a schema only
  that environment's database role may reach. It serves the renderer beside its API, so a page and
  the calls it makes are one address. One command runs the whole of it: the database, the
  object store, a stand-in sign-in provider, the service and a worker.

- **A packaged desktop build.** `pnpm --filter @alloy-works/desktop package` produces a Windows
  installer. Nothing is signed, notarised or published.

- **A content model.** `packages/domain` defines the shape a component's content is stored in: seven
  kinds of block, eight kinds of inline content, and thirteen annotations that can overlap each other
  without splitting the text underneath. Every block and every annotation carries an identifier of its
  own, which is what lets a comment or a suggestion survive the text around it being edited. Content
  records the schema version it was written against, so content written today stays readable when the
  schema changes, and it is checked on the way in and on the way back out - content that fails the check
  is set aside and reported rather than quietly repaired. Every construct has a checked route into Word
  and into tagged PDF. It is pure TypeScript: no React, no Electron, no filesystem.

  **This is the shape, not the product.** Nothing authors most of this content, imports it from
  another format or publishes it yet: the editor writes paragraphs of formatted text, and publishing
  takes those and refuses the rest.

- **Access.** Who may do what is decided through roles, granted to a person or a group as an allow or a
  denial, on the whole environment, one space, or one item. Every environment starts with nine roles -
  among them Publisher, the only one that may publish - and a space called General. An environment's first administrator is invited, by address, by whoever sets
  it up, and is Administrator from the first sign-in that proves that address; in development, Ada
  administers both environments from hers. On any component they may administer, **Manage access**
  lists what is granted on it, on its space and across the whole environment, gives a person a role at
  any of those as an allow or a denial, removes a grant, and shows what a chosen person may do there and
  why. Removing the last grant that lets anyone administer the whole environment is refused. An
  administrator of the whole environment also invites an address there: the person is offered to give
  access to straight away, and has what they were given from the first time they sign in with that
  address, through either sign-in route, as long as their provider has verified it. An invitation
  waits fourteen days, is renewed by inviting the address again, and can be withdrawn, with everything
  given to it, until it is accepted. Whether the person is from outside the organisation is chosen when
  inviting them, and cannot be changed afterwards yet. Somebody who has already signed in is given access directly, and
  inviting their address is refused.

  **This is grants to people, not the whole of managing access.** Nothing sends the invitation: the
  administrator tells the person to sign in. Nothing creates or changes a role, manages a group,
  marks somebody who has already signed in as from outside the organisation, extends an expiring grant
  or gives one an expiry, and only a component has an access page.

- **Editing a component.** Signed in, you see the components you may read and open one. If you may
  edit it, your first change starts editing: nobody else can change it while you are, and anyone who
  tries is told who is editing and until when. Your changes are saved a moment after you stop typing -
  the page says whether they are saved, saving, or not saved and being retried - and **Save version**
  or **Done editing** makes a version of them, numbered `0.2`, `0.3` and so on; nothing else does.
  Undo reaches back within what you have done since the last version. Pasting is refused rather than
  put in unexamined. A pause longer than fifteen minutes lets somebody else start editing, but if
  nobody has, your next change carries on where you left off. If you are signed out, the page says so
  and keeps what was not saved, and your next change after signing in again saves it; if you may no
  longer edit or read the component, the page says that instead, and keeps the text for you to copy.

  **Formatting, links and languages.** Above the surface is a **Formatting** toolbar: **Strong**,
  **Emphasis**, **Underline**, **Subscript**, **Superscript**, **Inline code** and **Quoted phrase**,
  each with a keyboard shortcut, each applied over what you have selected or over the next thing you
  type, and each taken off again by pressing the same button. **Link** asks for an address beginning
  `http:`, `https:` or `mailto:` and an optional title; an address of any other kind is refused with a
  sentence saying why, and nothing is applied. **Language** marks a run with a BCP 47 tag such as `fr`
  or `pt-BR`, and the page stops asking the browser to check that run's spelling, so a passage in
  another language is no longer flagged as misspelt. Where you type a tag a publication cannot carry,
  the dialog says so before anything is applied and the button becomes **Apply anyway**, so you decide
  rather than finding out at a publish somebody else asked for. The whole toolbar is one tab stop with
  the arrow keys moving along it, and `F6` and `Shift-F6` move between the component header, the
  toolbar and the surface.

  **This is formatted paragraphs, not the editor.** A component holding a list, a table, an equation
  or a footnote opens for reading only. There is no control for a defined term or a citation, nothing
  pastes, changes saved but never made into a version are
  kept and cannot yet be got back, undo does not survive a reload, and there is no metadata to fill in.

- **Making a component.** On the list of components, **New component** offers the spaces you may create
  in, a title, a base language such as `en-GB`, a direction, and the component type the environment
  offers. Creating makes version 0.1 with one empty paragraph and opens it. Above the surface, the
  title, the language and the direction can be changed as you work: each is part of the document, so
  each is undone by `Ctrl+Z` and recorded in the next version you cut.

- **Documents and their outlines.** A document is a thing of its own, made in a space you may create
  in, with a title, a base language and a direction; it opens at version 0.1 with nothing in it yet.
  Its outline is a tree: add a section, put a component in it, move one under another with the mouse
  or with `Alt` and the arrow keys, rename a section, mark one to start on a new page or a new
  right-hand page, and remove one with everything under it. Every act is its own version, so the
  history reads as what somebody did rather than as keystrokes, and `Ctrl+Z` or **Undo** takes the
  last one back - except a removal, which cannot be undone, so the page asks first. The same component
  can appear in one outline more than once. Nobody locks a document: if somebody else changes the
  outline while you have it open, your next change is refused, the page shows you theirs rather than
  overwriting it, and what you could undo is cleared so nothing you undo can overwrite it either.
  Somebody who may read a document but not change it sees its outline and is offered nothing to
  change. A component you may not read stays private: in an outline it shows as **A component**, which
  can still be moved, removed or started on a new page, and you can only add a component you may read.
  Every section has a title, and a rename that is not saved names the title it lost.

  **Sections are numbered.** Each section and each component in the outline shows its number - `1`,
  `2.1` - and a move renumbers everything at once. Untick **Numbered** to leave a node and everything
  under it out of the section numbering. Figures, tables, equations and footnotes are numbered too -
  figures and tables per chapter, equations and footnotes straight through, and each appendix on its
  own - and the service answers every number with where it came from - but the editor does not yet
  write a figure, so you only see those through the API. A number that depends on a component you may
  not read is left out rather than guessed. **The numbers are the ones the document will publish
  with**: the panel numbers with the very scheme its layout carries, not with a scheme of the page's
  own, so what you see in the outline is what comes out of the PDF.

  **A top-level part is front matter, the body or an appendix.** **Matter** beside the selected node
  offers all three: **Front matter** for a preface, numbered `i`, `i.1` in a scheme of its own and
  paged on its own; **Body**; and **Appendix**, numbered `A`, `B`. Only a top-level part has the
  choice, because everything under one takes its matter. Front matter has to come first, so **Front
  matter** is not offered once the body has begun, and a move that would take a part out of the top
  level or put front matter after anything else is refused rather than done: the page says **Front
  matter and appendices stay at the top level.** or **Front matter comes before the rest of the
  outline.** `Ctrl+Z` takes a **Matter** change back like any other.

  **Every part of a document has a link.** Choose a section or a component in the outline and its link
  is shown beneath it, with **Copy link**; the address in the browser follows too. Opening the link
  opens the document with that part chosen and marked, however the outline has been reordered since.
  Beneath the outline, the document lists its **figures, tables and equations**, each with its number
  and caption and a link to where it is placed, renumbered at once when you move anything. A number
  that would depend on a component you may not read is left off. Nothing resolves a cross-reference
  yet, and nothing tracks where you are as you read - there is no reading view.

  **This is structure, not the document.** There is no document view:
  the outline is a tree you build, and you still open a component on its own to edit it. A section's
  title is plain text for now, and a document's own title, language and direction cannot be changed
  once it is made.

- **Publishing a document as a PDF.** Somebody who may publish a document - the Publisher role, which
  Ada and Grace hold on General in development - has **Publish as PDF** beneath its outline, and a
  second or two later the page says it is published. The publication is a tagged PDF of the version on
  the page: its title, its sections numbered as the outline shows them and bookmarked, and each
  component's paragraphs beneath its heading, set in Liberation Serif, with everything you formatted
  carried into it: strong, emphasis, underline, subscript, superscript, inline code, quoted phrases,
  links a reader can follow, and each run's own language. **Every publication says it is
  not approved** - at the top of every page, and once where a screen reader reads it - because nothing
  can approve one yet. Publications are kept and never changed: publishing again makes another. The
  document lists its publications beneath the outline, each with the version, who published it and
  when, and each has its own page with a download. Who may read a publication is decided on the
  publication, so somebody given a single document does not see its publications unless given them
  too. When a document cannot be published you are told every reason at once, each at its place in the
  outline: a component you may not read, without saying which; a list, a table or any other block that
  cannot be published yet; a defined term, which has no control and no published form yet; or a
  character no typeface can set.

  **The publication is laid out.** It opens with a cover carrying the title, then a contents page a
  screen reader announces as a table of contents, then the document. Every page after the cover
  carries a running head with the title and the part you are in, and a foot with the revision and the
  page number. Pages are numbered per part: roman numerals through the front matter, from 1 again in
  the body, and appendices carrying on from the body. How all of that is set comes from a **layout** -
  A4 with an inch margin, English words, a contents three deep, each appendix on a new page - which
  every environment starts with one of and every document publishes under. Each publication records
  the exact version of the layout that made it, beside the document version and the fonts.

  **A document is published only under a layout written in its own language.** Where the two do not
  agree the page says so, naming both, before anything is queued; an English layout publishes an
  `en-GB` document as well as an `en` one. Asking for a format the layout does not make - Word, today
  - is refused the same way.

  **Four things about formatting in a PDF, said plainly rather than left to be found.** Inline code
  prints in the same face as the text around it, because only one typeface is pinned today - a screen
  reader is still told it is code, and a monospace face arrives with themes. A quoted phrase is marked
  as a quotation for assistive technology and is given no quotation marks of its own, so the
  characters on the page are the ones you typed and no others. Of the nine marks, only a link,
  inline code and a quoted phrase reach a screen reader as something it names: strong, emphasis,
  underline, subscript and superscript are printed but are not announced, which is how the engine tags
  them. And the optional **title** on a link is stored with the link and is not carried into the PDF -
  a PDF link has nowhere to put it, and inventing somewhere would tell a reader something you did not
  say - so the address is what a reader of the PDF gets.

  **A language tag a publication cannot carry.** The model keeps any well-formed tag, and the PDF
  engine carries a language and, where there is one, a region of exactly two letters. So `zh-Hans` or
  `es-419` can be stored and cannot be published; the editor says so when you apply it **to a run**,
  and a publish naming one is refused by name rather than shortened to something it does not mean.
  A component's own base language, in the header, is not warned about: one of these tags typed there
  is taken without comment and refused only when the document is published (issue #156).

  **This is a PDF of paragraphs, not publishing.** No lists, tables, figures, footnotes or equations -
  a document holding any of them is refused.
  There is no list of figures or tables, no caption labels and no theme; nothing chooses, makes or
  edits a layout, and there is only ever the one the environment started with; and there is no Word
  file, no preview, and no way to approve a publication. The page asks how a publish is going for as
  long as it stays open, and a download link lasts five minutes from when the publication's page was
  opened. In the desktop app, downloading has not been checked.

## What does not exist

Named explicitly so nobody has to read the source to find out:

- No way to author anything but formatted paragraphs: a component holding a list, a table, a footnote
  or an equation still opens for reading only, and there is no control for a defined term or a
  citation. Nothing pastes. Nothing imports content from a Word file, and nothing exports it but a
  published PDF of a document's paragraphs. The one sample document is a fixed template with no content
  of yours in it.
- No way to make, change or choose between component types: every environment has one, named Topic, and
  nothing yet lets an administrator add another or change which is the default.
- No way to delete a component or a document, including one made by mistake.
- No document view: a document's outline is a tree you build, and a component still opens on its own
  to be edited. No cross-references resolved, and no reading view. No reuse or transclusion. No way to
  make a figure or a table unnumbered: every one takes a number.
- No publishing beyond a laid-out PDF of a document's outline and its formatted paragraphs: no lists,
  tables, figures, footnotes or equations in a publication, no list of figures or tables, no caption
  labels, no theme, no monospace face for inline code, no Word, no preview, and no way to approve a
  publication.
- No way to choose, make or edit a layout: every environment has the one it started with, in English,
  and every document publishes under it.
- No way to choose an environment in the desktop app: it is told one, and there is no screen to ask.
- No hosting. Everything runs on your own machine, over plain HTTP, with development passwords.
- No search, no metadata anybody can fill in, no taxonomy, no workflow, and no revisions, baselines or
  comparison: versions are cut and kept, and nothing yet compares or designates one. Cross-reference
  resolution, conditional text and suggestion handling are all described in the content model and
  none of them runs: content can say a paragraph refers to a figure, and nothing resolves it.
- No signed or published release - the installer builds locally and is unsigned.
- No auto-update.
