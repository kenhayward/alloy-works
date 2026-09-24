# Features

The canonical, full-prose inventory of what Alloy Works does. The Features table in
[`README.md`](../README.md) is a short two-column summary that links here; when a feature changes,
**both change in the same PR**.

> **Status: the first pieces of the first tranche, on scaffolding.** Components can be made, edited and
> versioned, their text formatted, linked, marked with a language and arranged into lists, and
> documents made, their
> outlines restructured, their sections numbered and their paragraphs, lists, quotations,
> preformatted text, tables and figures published as a laid-out PDF with a cover, a contents, lists
> of figures and tables and numbered pages that carries all of that formatting.
> Footnotes, a table's note, cross-references and equations are written and published, and every
> publication is set from the environment's theme and records it, its tables and images from the
> theme's table and image styles.
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

- **An interface in one theme.** Every screen sits under a dark header band with:
  - the mark, which goes to Home, where each module is chosen;
  - the module's name;
  - the environment's name;
  - an account chip that signs out, or offers Sign in to somebody signed out. Signing in always
    asks the provider which account to use, so signing out and back in can switch person.

  Controls, tables and messages are drawn in the Light theme from the tokens in
  `apps/web/src/theme/tokens.css`, the only file that writes a colour. A test fails the build if
  any other file writes one, and another fails it if a second theme misses a token. The components list is a table - title,
  type, space, version, language, when changed and by whom - beside a filter pane of spaces with
  their counts, which hides to a rail, Administration opens from the account chip with the environment, its spaces, its people and invitations, its roles and the version; the application opens on Home, a card for each module with how many there are to read; publications are listed together, across documents, and each opens with its PDF shown in the page beside what it was made from; a document opens as one page - its outline in a tabbed pane that resizes and hides to a rail, holding the way back to the documents, the acts as icons, the document as the root of an indented tree, and a triangle or a page beside each section or component - a section's triangle, or Left and Right on the keyboard, collapses and expands what it holds - its text in reading order with each component's text under its number, any one of which opens for editing in place when you click its text, the caret where you clicked, and closes again with Done, and the chosen part's settings beside them; the documents list is a table - title, space, version, section and component counts, publishing state and when changed - filtered by space and by publishing state; its access page sets what is granted and why beside giving and inviting, and an open component sits beside the list of its space, under one strip holding its title (renamed by clicking it), its version and space, its language and direction as chips that open to change them, a save chip saying Saved, Saving or Not saved, and Done and Save version, over a single row of icons for the toolbar, each naming itself and its shortcut on hover; its block and word counts are the tooltip of its section number, or of its version where it has none; with New component in a dialog and a menu on each row to open it, copy its link or manage its access; a status bar along the foot of every page says the latest notice, such as a move or why one was refused, and for a document how many sections and components it holds and which version it is in which space; there is no search, sort, or filter by type, language or
  date yet. Messages have one look per state: could not be loaded, signed out, read only, refused, someone else
  editing, empty and waiting, and the save state carries a coloured dot. There is one
  theme, so there is no theme choice, and no screen has the layout the drawings in
  `docs/interface/` give it yet.

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
  another format or publishes it yet: the editor writes paragraphs of formatted text and lists of
  them, and publishing takes those and refuses the rest.

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
  type, and each taken off again by pressing the same button. **Link** opens a dialog over the editor, showing the text the link will go on, that asks for an address beginning
  `http:`, `https:` or `mailto:` and an optional title, with **Cancel** and **OK**, and **Remove link** where there is one to take off; an address of any other kind is refused with a
  sentence saying why, and nothing is applied. **Language** marks a run with a BCP 47 tag such as `fr`
  or `pt-BR`, and the page stops asking the browser to check that run's spelling, so a passage in
  another language is no longer flagged as misspelt. Where you type a tag a publication cannot carry,
  the dialog says so before anything is applied and the button becomes **OK anyway**, so you decide
  rather than finding out at a publish somebody else asked for. The whole toolbar is one tab stop with
  the arrow keys moving along it, and `F6` and `Shift-F6` move between the component header, the
  toolbar, any panel and the surface.

  **Lists, in three kinds.** **Bulleted list**, **Numbered list** and **Definition list** sit on the
  same toolbar, each with a shortcut, and each turns the paragraph the cursor is in into a list of
  that kind. Pressing **Bulleted list** or **Numbered list** again takes the list off, or, where the
  item is nested, lifts it one level. **Nest item** and **Lift item** move an item in and out a
  level, with `Tab` and `Shift-Tab` as a second route, and a list nests as deep as the content model
  admits, mixing all three kinds freely. `Enter` at the end of an item makes
  the next one; `Enter` in an item where you have written nothing leaves the list, coming up one level
  if you are nested and out of the list altogether if you are not. A definition list's term is a piece
  of the document like any other, so it can be emphasised, linked or marked with its own language, and
  `Enter` in a term moves into its definition rather than splitting the term in two. While the cursor
  is in a numbered list a **List** panel appears beside the toolbar, offering its kind, the number to
  **Start at** and a **Numbering** of `1, 2, 3`, `a, b, c` or `i, ii, iii`; `F6` reaches it like the
  other regions, and it goes away again when you leave the list. A start that cannot be used is
  refused with a sentence beside the box rather than taken silently: only a `1, 2, 3` list can start
  at 0, and a start is a whole number.

  **Quotations and preformatted text.** **Quotation** on the toolbar (`Ctrl` or `Cmd`, `Shift` and
  full stop) sets the paragraphs you have selected as a quotation, with a line beneath for its
  attribution - who said it, formatted like any other text - which you can leave empty. Pressing it
  inside a quotation takes the quotation off again and keeps any attribution as a paragraph after it.
  **Preformatted text** (`Ctrl` or `Cmd`, `Shift` and comma) turns the paragraphs you have
  selected into one block of text whose spaces, tabs and blank lines are kept exactly as you type
  them, in a fixed-width typeface with tab stops every eight columns. Formatting such as bold or a
  link is dropped when a paragraph becomes preformatted text, and one undo brings it back. Inside it,
  `Enter` starts a new line and `Tab` types a tab; `Ctrl` or `Cmd` and `Enter` leaves it for a
  new paragraph after it, and `Shift-Tab` always moves the focus back out of it. While the cursor is
  in preformatted text a **Preformatted text** panel offers a **Language label** - `sql`, `python`,
  `c++` - which says what the text is without colouring it; a label that is not letters, digits and
  `+ # . _ -` is refused with a sentence beside the box.

  **Copy and paste.** Paste into a component from a web page, from Word or Google Docs, from plain
  text, or from another component, and its paragraphs, lists, quotations, preformatted text and
  formatting come with it; a link is kept when its address is a web or email address. Pasted text in
  the middle of a paragraph joins it, and one undo takes a paste back. Pasting into preformatted text
  keeps every character exactly. What could not be kept is said at the time: the status bar says the
  paste happened, and a **Paste report** above the text lists what was changed or left out - a
  heading kept as a paragraph, a table's rows made the same length, an image or an equation left out, a typeface
  or a colour removed because the theme decides how text looks, a script or a link that could run
  something removed - with a **Close** button; `F6` reaches it like the other regions. Copying from a
  component writes its own format beside HTML and plain text, so a copy into another component keeps
  everything the editor holds. An ordinary paste of Markdown is plain text, because a clipboard never
  says it holds Markdown; **Paste as Markdown**, the last button on the toolbar, reads what the
  clipboard holds as Markdown instead - emphasis, links, lists, quotations and fenced code - with the
  same report. The browser may ask you first whether the page may see the clipboard, and if it is
  refused the status bar says so and nothing is pasted. Nothing can be dragged in yet.

  **Tables.** **Table** on the toolbar (`Ctrl` or `Cmd`, `Shift` and 0) puts a table of three columns
  and three rows after the paragraph you are in, its first row a header row, with a caption line above
  it that says **Caption** until you type one - a caption is formatted like any other text. A cell
  holds paragraphs and lists. `Tab` moves to the next cell and `Shift-Tab` to the one before, and
  from the last cell or the first the focus moves on out of the table. While the cursor is in a table
  a **Table** panel offers how many **Header rows** and **Header columns** it has, and **Row above**,
  **Row below**, **Column before**, **Column after**, **Delete row**, **Delete column**, **Merge cells**
  (over cells you have selected by dragging), **Split cell**, **Delete table**, and **Add note** and
  **Remove note** for a note on the table as a whole, written beneath it; a button that would
  do nothing says it is unavailable. `F6` reaches the panel like the other regions. A table pasted
  from a web page, Word, Google Docs or Markdown arrives as a table, with its caption, header rows and
  columns and merged cells.

  **This is formatted paragraphs, lists, quotations, preformatted text and tables, not the editor.** A
  component holding a footnote or an image anywhere but a paragraph - in a caption, a term, an
  attribution or a table's note - opens for reading only. There is no control for
  a defined term or a citation, an image cannot be pasted and an equation only from another
  component, changes saved but never made into a version are
  kept and cannot yet be got back, undo does not survive a reload, and there is no metadata to fill in.
  A list stops nesting at thirty levels: every control that would build a level becomes unavailable
  there, and `Tab` moves the focus on. `Backspace` at the start of a definition's term, or `Delete`
  at the end of the definition before it, joins the two definitions into one, the term's words running
  on at the end of the definition before; after an empty term it undoes the `Enter` that made it.
  A list deeper than that is not a document the product can store. Content that gets deeper by some
  other route is not saved, and what you are told is thin - that the text cannot be saved as it
  stands and to undo the change that caused it, without the page being able to say which change that
  was.

- **Making a component.** On the list of components, **New component** offers the spaces you may create
  in, a title, a base language such as `en-GB`, a direction, and the component type the environment
  offers. Creating makes version 0.1 with one empty paragraph and opens it. Above the surface, the
  title, the language and the direction can be changed as you work: each is part of the document, so
  each is undone by `Ctrl+Z` and recorded in the next version you cut.

- **Images, through the API.** An image can be uploaded into a space you may create in - a PNG or a
  JPEG of up to 25 MB and 50 million pixels, with a description for somebody who cannot see it, in a
  language. It is checked twice before anything may use it: by what its own bytes say it is, never its
  name, and then decoded whole by the worker, so a file that is not a complete PNG or JPEG, or whose
  pixels do not decode, is refused, saying why, and its bytes are not kept. Only the picture is kept:
  anything after it in the file - a phone's second picture or motion clip, say - is left behind. Its width and height are recorded as it is displayed, turned the way the camera meant.
  Everybody who may read the space may see it. The editor's **Figure** button uploads one this way.

- **Figures.** **Figure** on the formatting toolbar asks for a PNG or a JPEG and for one of two answers:
  a description of the image, for someone who cannot see it, in a language that starts as the
  component's - or **It is decorative**. It will not upload without one of them. While the image is
  checked it says _Checking the image_; a refusal is said in words, and nothing is placed. Otherwise
  the figure is placed after the paragraph the cursor is in, or in its place if it is empty, with the
  cursor in its caption, which says **Caption** until something is typed. The image is shown no wider
  than the column and no taller than 60 per cent of the window; one that cannot be shown - you may not
  read its space, or it is gone - says _An image you may not see_ in its place. While the cursor is in
  a figure, a **Figure** panel in the `F6` ring sets its alternative text: **Use the image's
  description**, showing it and its language, or saying the figure cannot be published until it is
  given one where the image has none; **Describe it here**, in the component's language, which stores
  nothing until something is typed; or **Decorative**. **Replace image** gives it another image through
  the same dialog, keeping its caption and its place, and **Delete figure** removes it. A figure copied
  within the product pastes as a figure, and a published document prints it (see Publishing). An
  image cannot be pasted from outside the product or dropped.

- **Images in a line of text.** **Image** on the formatting toolbar places an image inside a paragraph -
  in running text, a list, a quotation or a table's cell - at the cursor, through the same dialog as a
  figure: a PNG or a JPEG, described or marked decorative as it is uploaded. It stands one line high,
  and one that cannot be shown says _An image you may not see_ in its place. Selected, it is given the
  same panel as a figure, titled **Image**, with **Replace image** and **Delete image**. It takes no
  formatting of its own, and a link or a mark over the words either side of it is still one. One copied within the
  product pastes as one, and a published document prints it (see Publishing). One cannot be placed
  in a caption, a term, an attribution or preformatted text.

- **Footnotes.** **Footnote** on the formatting toolbar, or `Ctrl+Alt+F` (`Cmd+Option+F` on a Mac),
  places a footnote at the cursor in a paragraph - in running text, a list, a quotation or a table's
  cell - after any words you have selected, and opens its text beneath the paragraph with the cursor
  in it. Its mark in the text is a small raised asterisk, read to a screen reader as _Footnote_, with
  no number: the number is the document's, and a component on its own has none. Selecting the mark
  opens its text again, `Enter` on the mark puts the cursor there and `Escape` takes it back to the
  mark. A footnote's text is paragraphs you format as any others, from the toolbar or the keyboard,
  with links and languages, and a cross-reference or an equation can stand in it too; nothing else the
  toolbar makes can go there, and says so. Pasting into it
  keeps paragraphs and their formatting and refuses anything else, and `Ctrl+Z` undoes what you typed
  there with the rest of the component. Delete the mark to delete the footnote. One copied within the
  product pastes as one. A footnote cannot be placed in a caption, a term, an attribution, a table's
  note or preformatted text, and one stored by a table's key or by row and column is kept as it is.
  A published document prints each footnote at the foot of the page its mark is on, numbered with
  the document's number for it (see Publishing).

- **Cross-references.** **Reference** on the formatting toolbar, or `Ctrl+Alt+X` (`Cmd+Option+X` on a
  Mac), opens a dialog for pointing at something from the cursor. Editing a component in its
  document's page, **Refer to** lists the document's sections by number and title and every figure,
  table and footnote its components hold, by number and caption, and every numbered equation, by its
  number; a component opened on its own lists its own figures, tables, footnotes and numbered
  equations, by kind and caption, since only a document numbers them. An equation left unnumbered is
  not listed. **Show as** offers the forms the chosen target has - **Number**, **Title**, **Number and
  title**, **Page** and **Above or below**, a footnote and an equation having no title - and a line
  says what the reference will show. **Insert** places it after any words you have selected, in a paragraph, a list, a
  quotation, a table's cell, a caption, a term, an attribution, a table's note or a footnote's text,
  though never in preformatted text. In the text it shows what it will print - _Table 1.1_, a
  section's title, _above_ - or, on its own or for something the page has not numbered yet, the
  target's kind and caption, such as _Table: Readings_; a reference whose target has been deleted
  says _Broken reference_, or _Broken reference to a section_ where the section is not in the
  document, drawn apart and said so to a screen reader. Copied to another application, it carries
  the words it shows. Select a reference and press **Reference** again to change what it points at
  or how it shows, with **Change**; delete it to delete it. It takes no formatting of its own.
  Deleting a table and pressing `Ctrl+Z` leaves every reference to it pointing at it, and so does
  cutting a figure and pasting it back into the same component, which the paste report says. A
  component holding a reference opens for editing. The document's text on its page shows each
  reference as the editor does. In a document, _above_ and _below_ are the document's layout's own
  words, as a publication prints them; on its own, and for a page, which only a publication knows,
  the words are English. A published document prints each reference (see Publishing).

- **Equations.** **Equation** on the formatting toolbar, or `Ctrl+Shift+E` (`Cmd+Shift+E` on a Mac),
  opens a dialog for writing an equation in LaTeX - `\frac{a}{b}`, `x^2` - and draws it beneath
  the field as you type, as it will stand in the text, or says what is wrong with it: where Temml,
  which reads the LaTeX, stopped and why, or that the equation uses something that cannot be kept -
  `\cancel`, `\boxed`, a filled `\rule`, a box raised or lowered with `\raisebox`, a number written
  into it, or a line broken with `\\` outside an environment such as `aligned`, each with what to do
  instead. `Enter` in the field starts a new line, and `Ctrl` or `Cmd` and `Enter` inserts; pressed
  while the description is still being written, **Insert** says so and waits for it. **Description** is written for you, in the component's
  language, as the words a screen reader says - in Afrikaans, Catalan, Danish, English, French, German,
  Hindi, Italian, Korean, Norwegian, Spanish or Swedish; in any other language it stays empty and says
  so, for you to write. Change the words and they are yours: changing the LaTeX afterwards leaves
  them, and **Generate again** writes them afresh. Where a block may stand, **Place as** chooses
  **Inline**, in the text after any words you have selected, or **Block**, an equation of its own
  after the paragraph, which can be **Numbered**. An inline equation can stand anywhere text can but
  preformatted text - a list, a quotation, a table's cell, a caption, a term, an attribution, a
  table's note and a footnote's text; a block one in running text, a list or a quotation, never in a
  table's cell or a footnote. On the
  page an equation is drawn by the browser as mathematics, a numbered one with _(#)_ beside it, since
  the number is the document's, and one with no description says _No description_, to a screen reader
  too. Select one with the arrow keys and press `Enter`, **Equation** or the shortcut to change it,
  with **Change**; delete it to delete it. The arrow keys pass a block equation at the start or the end
  of the component without changing anything, and typing there starts a paragraph. It takes no
  formatting of its own. The words for a description are loaded the first time they are asked for,
  from the product itself, never from anywhere else. A component holding an equation opens for
  editing, one copied within the product pastes as one, and the document's text on its page shows it
  as the editor does. A published document prints it (see Publishing).

  **A section's title can hold an equation too.** In a document's outline, the **Title** field beside
  the tree takes words and equations on one line: **Equation** beside it, or `Ctrl+Shift+E` in it,
  opens the same dialog, inline only, with the description written in the document's language, and
  placing the equation saves the new title. Select an equation in the title and press `Enter` to
  change it. `Enter` otherwise saves the title, as leaving the field does, a paste arrives as one line
  of text, and `Ctrl+Z` in the field undoes your typing there. The equation is drawn in the field and
  in the section's heading on the document's page; in the outline's tree and in what the page says
  about a section, it is read as its description. A title has to have words: one that is only an
  equation is not saved, the page says _A section's title needs words as well as an equation._, and
  the equation stays in the field for you to add them. The **Reference** dialog names such a section
  by its words and offers a reference to it as a number, a page or a place, never as its title, which
  a publication cannot print as words.

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
  own - and the service answers every number with where it came from. A number that depends on a component you may
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
  that would depend on a component you may not read is left off. A cross-reference in the text shows
  what the page gives its target, as a publication prints it. Nothing tracks where you are as you
  read - there is no reading view.

  **This is structure, not the document.** There is no document view:
  the outline is a tree you build, and you still open a component on its own to edit it. A section's
  title takes words and equations but no formatting or cross-reference - a title that already holds
  one is shown and not changed, with a sentence saying why - and a document's own title, language and
  direction cannot be changed once it is made.

- **Publishing a document as a PDF.** Somebody who may publish a document - the Publisher role, which
  Ada and Grace hold on General in development - has **Publish as PDF** beneath its outline, and a
  second or two later the page says it is published. The publication is a tagged PDF of the version on
  the page: its title, its sections numbered as the outline shows them and bookmarked, and each
  component's paragraphs, lists, quotations and preformatted text beneath its heading, set from the
  environment's **theme** - Liberation Serif, with inline code and preformatted text in Liberation
  Mono and equations in STIX Two Math - and everything you
  formatted
  carried into it: strong, emphasis, underline, subscript, superscript, inline code, quoted phrases,
  links a reader can follow, and each run's own language. **Lists print as you made them** - bulleted
  at every level, with a different marker for the first three depths; numbered from the number and in
  the style you chose; and a definition list with each term beside its definition - and a screen
  reader is told each one is a list rather than a row of characters. **A quotation prints indented
  on both sides**, with its attribution at its end and nothing added before it, and **preformatted
  text prints in its own panel** with every space, tab and blank line where you put it, except blank
  lines at its very end, and its label above it; a reader is told which is a quotation and which is code. **Every publication says it is
  not approved** - at the top of every page, and once where a screen reader reads it - because nothing
  can approve one yet. Publications are kept and never changed: publishing again makes another. The
  document lists its publications beneath the outline, each with the version, who published it and
  when, and each has its own page with a download. Who may read a publication is decided on the
  publication, so somebody given a single document does not see its publications unless given them
  too. When a document cannot be published you are told every reason at once, each at its place in the
  outline: a component you may not read, without saying which; a footnote or any other block that
  cannot be published yet; a cross-reference to something the document does not hold, or asking for
  what its target cannot show; a table with no caption, or whose header cell reaches down into rows that
  are not header rows; an equation that cannot be set, has no description, or would print with no
  number; a defined term, which has no control and no published form yet; or a character no typeface
  can set.

  **Tables are published.** A table prints under its caption, which begins with its number -
  **Table 1.1** - and a screen reader is told the caption is the table's. Its header rows are marked
  as headers and repeat at the top of every page the table reaches, and a reader still hears them
  once, as headers, not as new rows of data. Its header columns are marked as the headers of their
  rows, and merged cells print merged. The columns share the width of the page equally. **How a
  table looks comes from its table style** in the theme: which rules it draws and how thick and in
  what colour, how far its cells are padded, whether its header row and header column are filled or
  bold, whether its body rows are banded, whether its header rows repeat on each page, whether a row
  may split across a page break or moves whole to the next page where it fits on one, and whether
  each page it continues onto is labelled **Table 1.1 (continued)**, in the layout's words. The
  default's looks as tables did: every rule a thin black line, the header neither filled nor bold and repeated, rows allowed to
  split, and no label. A table whose caption is empty is refused, naming it, because the caption is what names it to a reader; so
  is one whose header cell is merged down into rows that are not header rows, which would make the
  PDF read a row of data as more header.

  **A figure prints** with its number and its caption below it, no wider than the text and no taller
  than 60 per cent of the page's text area, so a tall image is made smaller rather than running off
  the page. **Its size and place come from its image style** in the theme: the width or the height it
  fixes, the most the other may be, its shape always kept, and whether it stands in the text or floats
  to the head or foot of a page, at the start, the centre or the end. The default's is the full width
  of the text, centred where it stands. A screen reader is told what it shows, in the language that description is written in -
  the image's own description in its own language, or the figure's own in the component's. A
  decorative figure's image is passed over by a screen reader altogether; its caption and number stay.
  A long caption makes the image smaller, so the two still stand on one page. A figure is refused,
  naming it, where its caption is empty or too long to stand on a page with even a small image, where
  neither it nor its image has a description and it is not marked decorative, and where its image is
  in a space you may not read - which says nothing more about the image. The publication records every image it printed.

  **The publication is laid out.** It opens with a cover carrying the title, then a contents page a
  screen reader announces as a table of contents, then a **list of figures** and a **list of
  tables**, each where the document has any, on a page of its own and announced the same way, each
  entry leading to what it lists and naming its page, then the document. A decorative figure is
  listed too. Every page after the cover
  carries a running head with the title and the part you are in, and a foot with the revision and the
  page number. Pages are numbered per part: roman numerals through the front matter, from 1 again in
  the body, and appendices carrying on from the body. How all of that is set comes from a **layout** -
  A4 with an inch margin, English words, a contents three deep, each appendix on a new page - which
  every environment starts with one of and every document publishes under. Each publication records
  the exact version of the layout that made it, beside the document version and the fonts.

  **Every publication is set from a theme.** How its text looks - each typeface, size, weight, slant
  and colour, how paragraphs are aligned and indented, the space above and below each and between its
  lines, which paragraphs keep with the next or are kept whole where they fit on a page, and that a
  paragraph never leaves a single line alone at the foot or head of a page - comes from the environment's **theme**, not from
  the product's fixed settings. Every environment starts with one, the default, and every publication
  records the exact version it was made under, as it records the layout's. The default is set to look
  as publications looked before, measured from them, with these differences you can see: a
  quotation's own paragraphs stand a line apart, a little closer than they did, and two quotations one
  after the other about 10 points further apart, while the space between a quotation and the text
  around it and before its attribution is as it was; a heading straight under another heading, a list after a paragraph,
  and a table's rows, caption and note stand a few points further apart; a footnote's second
  paragraph stands closer to its first; and the running head and foot and the first line of a page
  each sit a point or two from where they did. A table's cells are still centred and a figure's
  caption too, both now by the theme. A publication made before the theme is kept as it was.
  **A theme can refuse a publish**, naming what to change: a paragraph, table or figure using a style
  the theme does not have, or using one where that style cannot be used; a table whose style labels
  each page it continues onto, under a layout that has no words for the label; and a typeface whose licence
  forbids embedding it in a PDF, or one the publishing service does not have, whose measurements the
  theme records wrongly, or which cannot set equations. The last two are the theme's to change, and
  publishing again will not help. The default refuses none of these.

  **A document is published only under a layout written in its own language.** Where the two do not
  agree the page says so, naming both, before anything is queued; an English layout publishes an
  `en-GB` document as well as an `en` one. Asking for a format the layout does not make - Word, today
  - is refused the same way.

  **Four things about formatting in a PDF, said plainly rather than left to be found.** Inline code
  prints in Liberation Mono, the fixed-width typeface preformatted text uses, and a screen reader is
  told it is code; a character that typeface lacks, or an invisible one such as a zero-width space,
  is refused in it. A quoted phrase is marked
  as a quotation for assistive technology and is given no quotation marks of its own, so the
  characters on the page are the ones you typed and no others. Of the nine marks, only a link,
  inline code and a quoted phrase reach a screen reader as something it names: strong, emphasis,
  underline, subscript and superscript are printed but are not announced, which is how the engine tags
  them. And the optional **title** on a link is stored with the link and is not carried into the PDF -
  a PDF link has nowhere to put it, and inventing somewhere would tell a reader something you did not
  say - so the address is what a reader of the PDF gets.

  **What a definition list reaches a reader as.** A definition list is published as a list whose item
  label is the term. Somebody using a screen reader hears the term and then its definition, in the
  right order and with the right emphasis, which is most of what the structure is for - but PDF has a
  definition-list structure of its own, and the engine the product uses cannot yet produce it, so a
  reader is told "list" where you wrote "definition list". Nothing is lost and nothing is invented;
  the distinction simply does not reach the file. The markers beside a bulleted list are fixed by the
  product for now rather than chosen by a style, and repeat after three levels of nesting.

  **What preformatted text and a quotation reach a reader as.** Preformatted text is set exactly,
  but a reader who copies it out of the PDF, or has it read aloud, loses its indentation and hears a
  tab as spaces: the engine does not carry leading whitespace into the text a reader extracts
  (issue #162). A quotation's attribution is read as its last paragraph, and a preformatted block's
  label as a stray word before it, because PDF has no structure of its own for either (issue #163).
  **A line of preformatted text wider than the page refuses the publish** rather than being wrapped
  - which a reader could not tell from a line you broke - or cut off. Under the default layout that
    is 83 columns, 79 inside a quotation and fewer inside a list; inside a numbered list the limit is
    worked out cautiously, so a line that would just have fitted may be refused (issue #164). Much
    ordinary code is wider than 83 columns, and a layout that sets code smaller is what will fix that
    (issue #165). A character the fixed-width typeface does not have - a handful of typographic
    spaces and `‖` among them - is refused in preformatted text and inline code although a paragraph
    can print it.

  **A language tag a publication cannot carry.** The model keeps any well-formed tag, and the PDF
  engine carries a language and, where there is one, a region of exactly two letters. So `zh-Hans` or
  `es-419` can be stored and cannot be published; the editor says so when you apply it **to a run**,
  and a publish naming one is refused by name rather than shortened to something it does not mean.
  A component's own base language, in the header, is not warned about: one of these tags typed there
  is taken without comment and refused only when the document is published (issue #156).

  **An image in a line of text prints** one line high, in the paragraph or table cell it stands in,
  and a screen reader is told what it shows in the language that description is written in; a
  decorative one is passed over. One wider than the text is made smaller to fit it, its shape kept.
  One still wider than the room it stands in - a quotation, or a table's cell - is
  refused, naming where it is, as are the same things a figure is refused for, and so is one in a
  figure's or a table's caption, which is set again in the lists after the contents.

  **A footnote prints** at the foot of the page its mark is on, with the document's number for it in
  the text and before the note - numbered straight through the body, and on their own in front matter
  and in each appendix - and a screen reader reads it as a note, in the language of the text its mark
  stands in; one too long for what is left of its page begins there and carries on over the next. A
  table's note prints beneath the table, a little smaller; it does not travel with the table, so a
  table that ends a page can have its note begin the next. A footnote in a caption, a heading, a
  definition's term, a quotation's attribution, a table's note or a table's header row - which is
  printed again on every page the table reaches - is refused, naming where it is, as is one with no
  text, one anchored to a table as a whole, and one anchored to a table's cell the table does not have.

  **A cross-reference prints** what it was set to show: the number the document gives its target -
  _Table 1.1_, _2.1_ for a section, _3_ for a footnote - its title or caption, both, the number of
  the page it is on, in that part's own numbering, so a page in the front matter reads _iv_, or
  _above_ or _below_ by where it stands in the document, in the layout's words. In a paragraph's
  text - a list, a quotation, a table's cell or a footnote included - it is a link a reader can
  follow to its target; in a caption, a heading, a term, an attribution, a table's note or a table's
  header row it is plain text, because those are printed again in the contents, the lists or on
  every page. A reference in a section's heading prints its number, and so does that heading
  wherever it is printed again. One component placed in two documents, or twice in one, prints each
  place's own number. A reference whose target the document does not hold, or that points at a
  component the document holds more than once or not at all, is refused, as is one asking for what
  its target has not got - a number or a title of a paragraph, a title of a footnote, a page in a
  section's heading - and one pointing at anything in a table's header rows, which are printed again
  on every page the table reaches. Every one is named.

  **An equation prints** as mathematics, in STIX Two Math, a typeface made for mathematics, wherever
  you can write one: running text, a list, a quotation, a table's cell, a table's header rows (printed
  again on every page, and read once), a footnote, a caption and a section's title. One in a
  section's title prints in its heading and in the contents, the running heads and the bookmarks, where a bookmark
  shows its symbols rather than its description. A screen reader is told each is a formula and reads
  its description, in the language of the text around it. **A numbered equation carries its number**,
  _Equation 1_ under the default layout, at the right of its line, read after the equation; where an
  equation is too wide to leave its number room there, the number goes on a line of its own beneath
  it, at the right. A cross-reference to a numbered equation prints its number, its page or above or
  below, and a layout can ask for a **list of equations** after the contents, though the one every
  environment starts with lists figures and tables only. An equation is refused, naming where it is
  and never quoting it, where it holds something the typesetter cannot set, such as an error mark,
  maths written right to left, a box raised or lowered, a cell spanning others, a space of more than
  twenty ems either way or an accent made of more than one character; where it draws nothing at all,
  which the equation dialog refuses too; where it has no description; where the maths typeface lacks
  one of its characters, an invisible one such as a joiner among them; and where it is numbered and
  the layout gives it no number. Rows stacked under a sum, a small matrix and maths set a size or
  two smaller print as they are written, and an invisible mark that only says where a line may break
  is left out of an equation. A reference
  asking for the title of a section or a caption that holds an equation is refused too, since the
  equation cannot be printed as words. Some LaTeX prints as less than it asks rather than being
  refused: `\big(` and its kin print at their normal size, and `\smash` and `\mathrlap` take the
  room of what they hold. A letter written with a separate accent character that has no combined
  form - an x and a circumflex as two characters - prints as it should but is missing from the text a
  reader copies or searches, and so is the same letter in the same style in every other equation in
  the document; a screen reader reads each equation's description, which is whole.

  **This is a PDF of paragraphs, lists, quotations, preformatted text, tables and their notes,
  figures, images in a line of text, footnotes, cross-references and equations, not publishing.** A
  block equation wider than its line runs past both margins and can be cut off at the page's edge,
  and one in a line of text runs past the right margin; nothing refuses either yet. A table too wide
  for the page is not turned, shrunk or split, and a column is not aligned by the kind of value it
  holds. A citation
  in a quotation's attribution cannot be written or published yet. A list nested
  past about thirty levels is stored by the editor and cannot be published at all, and the page says
  only that the publish failed. Quotations inside one another stop at fifteen in the editor, which is
  the most a publication can set.
  No publication has a list of equations yet, since the one layout lists only figures and tables;
  nothing chooses, makes or edits a layout or a theme, and there is only ever the one of each the
  environment started with, and no style to choose for a paragraph; and there is no Word
  file, no preview, and no way to approve a publication. The page asks how a publish is going for as
  long as it stays open, and a download link lasts five minutes from when the publication's page was
  opened. In the desktop app, downloading has not been checked.

## What does not exist

Named explicitly so nobody has to read the source to find out:

- No way to author anything but formatted paragraphs, lists, quotations, preformatted text,
  tables, figures, images in a line of text, footnotes and tables' notes, cross-references and
  equations: a component holding a footnote or an image anywhere but a paragraph still opens for
  reading only, a section's title takes no formatting or cross-reference, and
  there is no control for a defined term or a
  citation. A paste from outside the product keeps no footnote, image or equation, reads Markdown only when **Paste as
  Markdown** is pressed, and nothing can be dragged into a component. Nothing imports content from a Word file, and nothing exports it but a
  published PDF of a document's paragraphs, lists, quotations, preformatted text, tables, figures,
  images in a line of text, footnotes, cross-references and equations. The one sample document is a fixed template with
  no content of yours in it.
- No way to make, change or choose between component types: every environment has one, named Topic, and
  nothing yet lets an administrator add another or change which is the default.
- No way to delete a component or a document, including one made by mistake.
- No document view: a document's outline is a tree you build, and a component still opens on its own
  to be edited. No reading view. No reuse or transclusion. No way to
  make a figure or a table unnumbered: every one takes a number.
- No publishing beyond a laid-out PDF of a document's outline, its formatted paragraphs, lists,
  quotations, preformatted text, tables and their notes, figures, images in a line of text,
  footnotes, cross-references and equations: no definition-list structure of PDF's own, no list of equations under the one layout, no
  Word, no preview, and no way to approve a
  publication.
- No way to choose, make or edit a layout: every environment has the one it started with, in English,
  and every document publishes under it.
- No way to choose, make or edit a theme, or to give a paragraph, a table or a figure a style of your
  own: every environment has the default theme, and every document publishes under it. The theme does
  not reach the editor, which shows text and tables in its own settings, and every table and figure
  takes the default's one table style and two image styles.
- No way to choose an environment in the desktop app: it is told one, and there is no screen to ask.
- No hosting. Everything runs on your own machine, over plain HTTP, with development passwords.
- No search, no metadata anybody can fill in, no taxonomy, no workflow, and no revisions, baselines or
  comparison: versions are cut and kept, and nothing yet compares or designates one. Conditional text
  and suggestion handling are described in the content model and neither runs.
- No signed or published release - the installer builds locally and is unsigned.
- No auto-update.
