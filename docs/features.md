# Features

The canonical, full-prose inventory of what Alloy Works does. The Features table in
[`README.md`](../README.md) is a short two-column summary that links here; when a feature changes,
**both change in the same PR**.

> **Status: nothing here is a product feature yet.** The repository is scaffolding. What follows
> describes what actually exists today, so that the first real feature has something honest to be
> added to rather than a list of intentions to be corrected.

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

  **This is the shape, not the product.** Nothing authors this content, imports it from another format
  or publishes it yet, and the store below holds it only when a test puts it there.

- **Access.** Who may do what is decided through roles, granted to a person or a group as an allow or a
  denial, on the whole environment, one space, or one item. Every environment starts with eight roles and
  a space called General. An environment's first administrator is named, by their sign-in identity, by
  whoever sets it up, and is granted the role once, at their first sign-in; in development, Ada
  administers both environments from hers. Two read-only routes answer what a caller may do to something,
  and, for an administrator, what someone else may do and why.

  **This is the model, not the management.** There are no screens and no routes yet to create a role,
  make a grant, or manage a group or a principal - the first sign-in's grant is the only one anything
  makes.

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

  **This is paragraphs of text, not the editor.** A component holding a list, a table, an equation, a
  footnote or any formatting opens for reading only. Nothing yet creates a component: in development,
  `pnpm dev:setup` makes one, "Install the printer", and lets Ada and Grace edit it; outside
  development nobody can be given permission to edit, because no screen or route grants a role yet.
  Changes saved but never made into a version are kept and cannot yet be got back, undo does not
  survive a reload, and there is no metadata to fill in.

## What does not exist

Named explicitly so nobody has to read the source to find out:

- No way to create a component, or to author anything but paragraphs of text in one that exists.
  Nothing imports content from a Word file or exports it anywhere. The one sample document is a fixed
  template with no content of yours in it.
- No document view, component tree, reuse or transclusion.
- No publishing or output formats.
- No way to choose an environment in the desktop app: it is told one, and there is no screen to ask.
- No hosting. Everything runs on your own machine, over plain HTTP, with development passwords.
- No search, no metadata anybody can fill in, no taxonomy, no workflow, and no revisions, baselines or
  comparison: versions are cut and kept, and nothing yet compares or designates one. Numbering, cross-reference resolution, conditional text and suggestion
  handling are all described in the content model and none of them runs: content can say a paragraph
  refers to a figure, and nothing resolves it.
- No signed or published release - the installer builds locally and is unsigned.
- No auto-update.
