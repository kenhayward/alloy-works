# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

## 0.68.0 - 2026-09-24 (PR #PRNUM)

### Added

- **Every publication is set from a theme.** Each typeface, size, weight, slant and colour in a PDF,
  how its paragraphs are aligned and indented, the space above, below and between their lines, which
  paragraphs keep with the next or stay whole on a page, and that no paragraph leaves a single line
  alone at the foot or head of a page, now come from the environment's theme rather than from settings
  fixed in the product. Every environment starts with the default theme, set in Liberation Serif,
  Liberation Mono and STIX Two Math as before, and each publication records the exact version of the
  theme it was made under, beside the layout's, so it says how it looked. Nothing yet lets you choose
  or change a theme, and the editor does not show it.
- **Publishing says when the theme stands in the way**, naming what to change: a paragraph, a table or
  a figure using a style the theme does not have, or using one where that style cannot be used; a
  typeface whose licence does not allow it to be embedded in a PDF; and a typeface the publishing
  service does not have. For the last two the theme has to change, and publishing again will not help.
  The default theme refuses none of these.

### Changed

- **Publications look almost exactly as they did**, the default theme's sizes and spaces measured from
  them, with these differences you can see:
  - **A quotation is no longer set apart by extra space.** It stands as close to the text around it,
    and its attribution as close to it, as one paragraph stands to the next: about 16.5 points closer
    above it and before its attribution, and about 10 points closer after it.
  - A heading straight under another heading, a list after a paragraph, and a table's caption, rows
    and note stand between half a point and 4 points further apart; a footnote's second paragraph
    stands about 3 points closer to its first; and a figure's caption about 2 points closer to its
    image.
  - The running head sits about 2 points higher, the foot about 1 point lower, and the first line of a
    page 1 to 2 points lower.
  - A table's cells are still centred and a figure's caption too.
- **An image in a line of text is as tall as a line of the text around it**, 1.2 times its size, so it
  follows that text's size, in a paragraph, a list, a table's cell or its note, or a footnote. At the default
  sizes nothing moves.
- **A preformatted block's label is checked before publishing**, and a character no typeface can set
  in it is named, where before the publish failed without saying why.
- **A style the publication cannot find is now said to be missing from the theme**, naming it, rather
  than from the publication's template.

## 0.67.1 - 2026-09-24 (PR #226)

### Changed

- **Themes for the PDF are designed**, ready for review before any of it is built: a publication's
  typefaces, sizes, colours, spacing and page-break behaviour coming from a stored theme rather than
  being fixed, and each publication recording the theme it was made with. Measured against the
  typesetting engine first. Small capitals are left out because the product's typefaces have none,
  and a floated image can sit only at the top or foot of a page. A table's "continued" label is
  possible, and its words come from the layout.

## 0.67.0 - 2026-09-24 (PR #225)

### Added

- **A section's title can hold an equation.** The **Title** field in a document's outline now takes
  words and equations on one line: **Equation** beside it, or `Ctrl+Shift+E` in it, opens the same
  equation dialog a component uses, with the description written in the document's language, and
  placing the equation saves the title. Select an equation in the title and press `Enter` to change
  it. The equation is drawn in the field and in the section's heading on the document's page, and a
  publication sets it in the heading, the contents, the running heads and the bookmarks. With this,
  an equation can be written in every place one can stand: running text, a heading, a table's cell, a
  footnote and a caption.
- In the outline's tree and in what the page says about a section, an equation in its title is read
  as its description.

### Changed

- **A title has to have words.** One that is only an equation is not saved: the page says _A
  section's title needs words as well as an equation._ and keeps the equation in the field for you to
  add them. A title holding formatting or a cross-reference is still shown and not changed, with a
  sentence saying why.
- The **Reference** dialog offers a section whose title holds an equation as a number, a page or a
  place, and no longer as its title: a publication refuses to print such a title as words, so the
  reference would not have published.

### Fixed

- The project's own type check passes again: a test added with the last release left it failing, which
  the build did not stop on (#224).

## 0.66.0 - 2026-09-24 (PR #223)

### Added

- **Equations are published.** Every equation in a component prints as mathematics in the PDF - in
  running text, a list, a quotation, a table's cell and its header rows, a footnote and a caption -
  set in **STIX Two Math**, a typeface made for mathematics that now ships with the product beside
  Liberation Serif and Liberation Mono, under the same open licence. A screen reader is told each is
  a formula and reads the words written for it, in the language of the text around it. Rows
  stacked under a sum, a small matrix and maths set a size or two smaller print as written.
- **A numbered equation prints its number** at the right of its line, as the document numbers it,
  and a screen reader hears the number after the equation. An equation too wide to leave its number
  room has the number on a line of its own beneath it.
- **A cross-reference can point at a numbered equation.** The **Reference** dialog lists each one by
  its number, and a publication prints its number, its page, or above or below, as a link in running
  text. An equation left unnumbered is not offered.
- **A layout can list the equations** after the contents, each entry leading to its page, as it lists
  figures and tables. The layout every environment starts with lists figures and tables only.

### Changed

- **Publishing says why an equation cannot be published**, rather than refusing every one: one
  holding something the typesetter cannot set, such as an error mark, maths written right to left or
  a box raised or lowered, a space of more than twenty ems or an accent made of more than one
  character, each in its own words; one that draws nothing at all; one with no description; one using
  a character the maths typeface lacks, an invisible one such as a joiner among them; and a numbered
  one the layout gives no number. Each is named at its place in the outline, and its text is never
  quoted.
- **The Equation dialog refuses an equation that draws nothing**, such as an empty group or a space
  on its own, saying so beneath the LaTeX, since a publication would have nothing to carry its
  description.
- **A reference asking for the title of a section or a caption that holds an equation is refused**,
  since the equation cannot be printed as words; asking for its number still works.
- An equation already stored in a section's heading is published there, and in the contents, the
  running heads and the bookmarks. Writing one there comes in a later release.
- Some LaTeX prints as less than it asks rather than being refused: `\big(` and its kin print at
  their normal size, and `\smash` and `\mathrlap` take the room of what they hold. A block equation
  wider than its line runs past both margins and can be cut off at the page's edge, and nothing
  refuses it yet. A letter written with a separate accent character that has no combined form prints
  as it should but is missing from the PDF's copyable text, as is the same letter in the document's
  other equations.

## 0.65.0 - 2026-09-23 (PR #222)

### Added

- **Equations, written in the editor.** **Equation** on the toolbar, or `Ctrl+Shift+E`
  (`Cmd+Shift+E` on a Mac), opens a dialog where you type an equation in LaTeX and see it drawn as
  you type, or are told what is wrong with it and where. Place it in a line of text - a paragraph, a
  list, a quotation, a table's cell, a caption, a term, a footnote - or, where a block can stand, as
  an equation of its own, numbered or not. Select it and press `Enter` to change it.
- Some LaTeX is refused rather than stored with part of it missing or drawn out of place -
  `\cancel`, `\boxed`, a filled `\rule`, a box raised with `\raisebox`, a number written into the
  equation, or a line broken with `\\` on its own - and the dialog says what to write instead.
- **The words a screen reader says for an equation are written for you**, in the component's
  language, in thirteen languages including English, French, German and Spanish, and are yours to
  change: once you have changed them, changing the equation leaves them alone, and **Generate
  again** writes them afresh. Press **Insert** before they are written and it waits for them. In any
  other language the field is empty and says so, and the equation is marked _No description_ until
  you write one. Everything this needs comes from the product
  itself, never from another site.
- **The arrow keys pass an equation standing on its own, a figure or a table** at the start or the end of a component
  without changing anything, and typing there starts a new paragraph.

### Changed

- **A component holding an equation opens for editing**, where before it opened for reading only.
- **Publishing names an equation in a line of text** as one that cannot be published yet, as it
  already did for one standing on its own. Equations are published in a later release.

## 0.64.1 - 2026-09-23 (PR #221)

### Changed

- **Equations are designed**, ready for review before any of it is built: typing an equation as LaTeX
  in a dialog and seeing it as it will print, its spoken alternative written for you and yours to
  change, and an equation in running text, a list, a quotation, a table, a footnote, a caption or a
  section's heading. A numbered equation carries its number beside it, can be pointed at by a
  cross-reference, and can be listed after the contents. Measured against the typesetting engine
  first: no equation can be set until a maths typeface is added, so the design adds one.

## 0.64.0 - 2026-09-23 (PR #220)

### Added

- **Cross-references are published.** Each prints what it was set to show: the number the document
  gives its target, such as _Table 1.1_, its title or caption, both, the page it is on in that part's
  own numbering, or above or below by where it stands. One component placed in two documents, or
  twice in one, prints each place's own number, and a document published again after its outline is
  reordered prints the new numbers.
- **A reference in running text is a link** to what it points at, in a list, a quotation, a table's
  cell and a footnote too. In a caption, a heading, a term, an attribution, a table's note or a
  table's header row it is plain text, since those are printed again elsewhere.
- **The layout has words for above and below**, and the default layout says _above_ and _below_. The
  editor shows a reference in the document's layout's own words, as the publication prints it.

### Changed

- **Publishing says why a cross-reference cannot be published**, rather than refusing every one: one
  pointing at something the document does not hold, or at a component it holds more than once or not
  at all, and one asking for what its target has not got - a number or a title of a paragraph, a page
  in a section's heading, or anything in a table's header rows, which are printed again on every
  page. Each is named at its place in the outline.
- **A section's heading holding a reference shows its number** on the document's page, as the
  publication prints it, where before the reference was left out.

## 0.63.0 - 2026-09-23 (PR #219)

### Added

- **Cross-references, made in the editor.** **Reference** on the toolbar, or `Ctrl+Alt+X`, opens a
  dialog for pointing at something from the cursor: editing a component in its document's page, any
  of the document's sections and any figure, table or footnote its components hold; in a component
  opened on its own, its own figures, tables and footnotes. Choose how it shows - its number, its
  title, both, its page, or above or below - and the dialog says what that will be before you insert
  it. The reference shows it in the text, such as _Table 1.1_, or the target's kind and caption,
  such as _Table: Readings_, where nothing has numbered it yet; one whose target has been deleted
  says _Broken reference_, or _Broken reference to a section_ where that is what it pointed at, and
  a copy to another application carries the words it shows. Select a reference and press
  **Reference** again to change it, or delete it to delete it. A reference can stand anywhere text
  can but preformatted text, a footnote's text included.
- **A reference follows what it points at.** Delete a table and press `Ctrl+Z`, or cut a figure and
  paste it back in the same component, and every reference to it still points at it; the paste report
  says how many references were pointed again.
- A document's text on its page shows each reference with the number the document gives its target.
- A component holding a cross-reference now opens for editing rather than for reading only.

### Changed

- **Publishing refuses a cross-reference by name**, saying _A cross-reference cannot be published
  yet._, until the next release publishes them.
- **Undo puts back exactly what it took away.** A footnote, a table or a paragraph brought back by
  `Ctrl+Z` or redone by `Ctrl+Y` is the same one it was, rather than a copy given a new identity.

## 0.62.1 - 2026-09-23 (PR #218)

### Changed

- **Cross-references are designed**, ready for review before any of it is built: how an author points
  at a section, a figure, a table or a footnote from a dialog in the editor, what a reference shows as
  they write and what a publication prints - a number, a title, both, a page, or "above" and "below" -
  where it is a link, and what happens to a reference when its target is deleted and put back or cut
  and pasted. Measured against the typesetting engine first: a link in a running head stops a
  publication outright, so a reference in a heading or a caption is printed as text.

## 0.62.0 - 2026-09-23 (PR #217)

### Added

- **Footnotes are published.** Each footnote prints at the foot of the page its mark is on, with the
  document's number for it in the text and before the note, numbered straight through the body and on
  their own in front matter and each appendix; a note too long for what is left of its page begins there
  and carries on over the next. A screen reader reads each as a note, in the language of the text its
  mark stands in.
- **A table's note is published**, beneath the table and a little smaller than the text.

### Changed

- **Publishing says why a footnote cannot be published**: one in a caption, a heading, a definition's
  term, a quotation's attribution, a table's note or a table's header row, or anchored to a whole table,
  is named with where it is; so is one with no text, one anchored to a table's cell the table does not
  have, and one the layout would give no number.

## 0.61.0 - 2026-09-23 (PR #216)

### Added

- **Footnotes, written in the editor.** **Footnote** on the toolbar, or `Ctrl+Alt+F`, places a
  footnote at the cursor in a paragraph - in running text, a list, a quotation or a table's cell - and
  opens its text beneath the paragraph for you to write. Its mark is a small raised asterisk with no
  number, since the number is the document's. Select the mark to open its text again, press `Enter`
  on it to go into the text and `Escape` to come back. The text is paragraphs you format and link as
  any others, from the toolbar or the keyboard; pasting into it keeps paragraphs and refuses the rest;
  `Ctrl+Z` undoes it with the rest of the component. Delete the mark to delete the footnote.
- **A note on a table.** **Add note** in the Table panel adds a note beneath the table for what is true
  of the whole table, and **Remove note** takes it away.
- A component holding a footnote in a paragraph now opens for editing rather than for reading only.

### Changed

- **Publishing refuses a footnote or a table's note by name**, saying _A footnote cannot be published
  yet._ or _A table's note cannot be published yet._, until the next release publishes them. A table
  with a note was published without it before; now the publish says so instead.

### Fixed

- Pressing **Strong**, or any formatting button, over words formatted on both sides of an image in a
  line of text now takes the formatting off, as the pressed button says it will; before, nothing
  happened.

## 0.60.1 - 2026-09-23 (PR #215)

### Changed

- **Footnotes are designed**, ready for review before any of it is built: where a footnote may stand
  and why only in a paragraph, how its number is the one the outline shows, how it is edited beside the
  text it belongs to, how a note on a table as a whole is written and published, and what a publication
  refuses. Measured against the typesetting engine first: a footnote in a caption or a heading would be
  printed twice, once in the contents or list and once in place, so none may stand there.

## 0.60.0 - 2026-09-23 (PR #214)

### Added

- **Images in a line of text are published.** A document holding them now publishes: each image is
  printed one line high in the paragraph or table cell it stands in, and a screen reader is told what
  it shows, in the language its description is written in; a decorative one is passed over. An image
  wider than the room it stands in is refused, naming where it is, as is one with no description or
  whose image you may not see, and one in a caption.

## 0.59.0 - 2026-09-23 (PR #213)

### Added

- **Images in a line of text.** **Image** on the formatting toolbar places a PNG or a JPEG inside a
  paragraph at the cursor - in running text, a list, a quotation or a table's cell - one line high,
  described or marked decorative as it is uploaded, through the same dialog as a figure. Selected, it
  has the same panel, where its description can be changed and the image replaced or deleted. A
  component holding one now opens for editing. Publishing a document with an image in a line of text
  is still refused, until a later change.

## 0.58.0 - 2026-09-23 (PR #212)

### Added

- **Figures are published.** A document holding figures now publishes: each figure is printed with
  its number and its caption below it, no wider than the text and no taller than 60 per cent of the
  page's text area, so a tall image is made smaller rather than running off the page. A screen reader
  is told what the image shows, in the language its description is written in; a decorative image is
  passed over, and its caption and number stay. A **list of figures** follows the contents, before
  the list of tables.
- A long caption makes its image smaller, so the two stay on one page.
- A figure is refused, and named, when its caption is empty or too long to stand on a page with its
  image, when neither it nor its image has a description and it is not marked decorative, or when its
  image is in a space you may not read.

### Changed

- The default layout now lists figures before tables after the contents. A document published under
  the earlier layout keeps it.

## 0.57.0 - 2026-09-23 (PR #209)

### Added

- **Figures in the editor.** **Figure** on the formatting toolbar uploads a PNG or a JPEG and places
  it, with a caption line beneath it. It asks you to describe the image for someone who cannot see it,
  or to say it is decorative, before it uploads; if the image is refused, it says why and places
  nothing. While the cursor is in a figure, a Figure panel lets you use the image's own description,
  describe it for this figure alone, or mark it decorative, and replace its image or delete it. An
  image you cannot see is marked in its place. A component holding a figure now opens for editing.
  Publishing a document with a figure in it is still refused, and an image cannot yet be pasted or
  placed in a line of text.

### Fixed

- A table pasted into the middle of a paragraph no longer takes the rest of the paragraph into its
  last cell: the text after the cursor stays in a paragraph after the table (#208).

## 0.56.1 - 2026-09-23 (PR #211)

### Fixed

- The build no longer fails at random when a busy test machine runs two of the editor's long
  randomised checks a little slowly: they are given the time the others like them already have
  (#210).

## 0.56.0 - 2026-09-23 (PR #207)

### Added

- **Images can be uploaded into a space, through the API.** A PNG or a JPEG of up to 25 MB and 50
  million pixels, with a description for somebody who cannot see it. Before anything can use it, it is
  checked by what its own bytes say it is, never its name, and then decoded whole in the background: a
  file that is not a complete PNG or JPEG, or whose pixels do not decode, is refused with the reason and
  not kept. Only the picture is kept - a phone's second picture or motion clip after it is left behind. Whoever may read the
  space may see it. Nothing in the application places an image yet: this is what figures will be made
  from.

### Changed

- An uploaded image is made safe by being proved to be only an image, rather than by a malware scan,
  which PNG and JPEG files gain little from (AST-051, replacing AST-003). A format that can carry
  scripts or embedded files will still be scanned when one is admitted.

## 0.55.1 - 2026-09-23 (PR #205)

### Changed

- **Figures are designed**, ready for review before any of it is built: how an image arrives and is
  proved to be a real PNG or JPEG before anything can place it, who may see it, how the editor asks
  for its description, and how it is printed so that a screen reader is told what it shows. Measured
  against the engine the product publishes with. Nothing changes in the application yet.

## 0.55.0 - 2026-09-22 (PR #204)

### Added

- **Tables are published.** A table prints under its caption, which begins with its number, such as
  Table 1.1, and a screen reader is told the caption is the table's. Header rows repeat at the top of
  every page the table reaches and are still heard once, as headers. Header columns are marked as
  the headers of their rows, and merged cells print merged.
- **A list of tables** follows the contents, on a page of its own, where a document has any tables.
  Each entry leads to its table and names its page. The layout every environment starts with has a
  new version, 0.2, that declares it; a publish requested before this keeps the layout it was
  requested under.

### Changed

- A document is refused, naming the table, when a table's caption is empty, or when a header cell
  is merged down into rows that are not header rows, which would make the PDF read a row of data as
  more header.
- A table's header column is a requirement only where the output can mark one: Word cannot, so a
  Word publication will say which tables lost it (TAB-049, replacing TAB-031).

### Known limits

- A table too wide for the page is not turned, shrunk or split, and every table repeats its header
  rows, until table styles arrive.

## 0.54.0 - 2026-09-22 (PR #203)

### Added

- **Tables in a component.** **Table** on the toolbar (Ctrl or Cmd, Shift and 0) adds a table of
  three columns and three rows with a header row and a caption line above it. Cells hold paragraphs
  and lists, and Tab moves between them. A **Table** panel sets how many header rows and header
  columns there are, adds and deletes rows and columns, merges and splits cells, and deletes the
  table. A table pasted from a web page, Word, Google Docs or Markdown arrives as a table. Tables
  are not published yet: a document holding one is refused by name until the next step.

### Changed

- A figure's and a table's caption can now hold formatting, and will be able to hold an equation
  or a cross-reference once those can be written.

## 0.53.2 - 2026-09-22 (PR #201)

### Changed

- **Tables are designed**, ready for review before any of it is built: what a table holds, how it is
  edited, and how it is published so that a screen reader hears its caption and its header rows and
  columns, measured against the engine the product publishes with. Nothing changes in the application
  yet.

## 0.53.1 - 2026-09-22 (PR #200)

### Fixed

- **Undo after Definition list takes the list off again**, and no sequence of editing, list
  commands, undo and redo makes the editor stop taking changes any more. Some undos after list
  gestures used to fail inside the editor and leave it unable to take the next key (#166).
- **Enter over a selection** deletes it and then starts a new paragraph or item, including over a
  selection that runs out of a quotation, where it used to fail (#166). In a list it now makes a new
  item, as Enter does anywhere in a list.
- **Bulleted list and Numbered list** no longer fail over a selection that starts in a definition
  inside a list; they do nothing there (#166).
- **Backspace at the start of a definition's term, or Delete at the end of the definition before it**,
  joins the two definitions into one, instead of tucking the second inside the first one level deeper
  (#160).
- **A title of nothing but spaces, or text holding a character the database cannot store**, is
  refused as invalid content when a component is saved through the API, instead of storing a blank
  title or answering with a server error (#116, #127).

## 0.53.0 - 2026-09-22 (PR #199)

### Added

- **Paste as Markdown.** A new button at the end of the editor's toolbar pastes what the clipboard
  holds as Markdown: emphasis, strong text, code, links, bulleted and numbered lists, quotations and
  fenced code blocks with their language. A heading is kept as a paragraph and an image is left out,
  and the paste report says so, as for any paste. The browser may ask whether the page may see the
  clipboard; if it is refused, nothing is pasted and the status bar says why. An ordinary paste of
  Markdown is still plain text.

### Fixed

- A pasted paragraph that held only an image was reported as an empty paragraph used for spacing. It
  is now reported as the image that was left out (#198).

## 0.52.0 - 2026-09-22 (PR #197)

### Added

- **Copy and paste.** Paste into a component from a web page, Word, Google Docs, plain text or
  another component, and its paragraphs, lists, quotations, preformatted text and formatting come
  with it. Pasted text joins the paragraph you paste into, one undo takes a paste back, and a paste
  into preformatted text keeps every character. A **Paste report** above the text says what was
  changed or left out: a heading kept as a paragraph, a table kept as its text, an image or an
  equation left out, a typeface or colour removed, a script or an unsafe link removed. Copying from
  a component keeps everything the editor holds when you paste it into another. Markdown pastes as
  plain text, and dragging content in is not available yet.

### Fixed

- A sentence the editor said in the status bar, such as a refused header field, was replaced by
  **You are editing this component.** again at the next save. The session's own sentences now appear
  only when they change (#196).

## 0.51.0 - 2026-09-22 (PR #195)

### Added

- **A section in the outline collapses and expands.** Click the triangle beside a section to hide
  what it holds and click it again to show it, or use the Left and Right arrow keys on the section.
  The arrow keys skip what is collapsed. Collapsing a section over the item you had chosen chooses
  the section instead. Collapsing only changes what you see; the document is not changed.

## 0.50.0 - 2026-09-22 (PR #194)

### Added

- **A status bar along the foot of every page.** It says the latest message, such as where a section
  moved to or why a move was refused, and keeps it until the next one. On a document it also says how
  many sections and components it holds and which version it is, in which space.

### Changed

- **The document's outline sits in a tidier pane at the top of its column.** A **Contents** tab heads
  it, with an arrow back to the documents and the button that hides the pane. Add section, Add
  component and Undo are icons; hover over one to see its name. The document's title and version
  head the tree.
- **The outline reads more easily.** Each level is indented, sections carry a small triangle and
  components a page, the numbers are in the accent colour, and the chosen item is highlighted across
  the pane.
- **The title strip above a document and the paragraph listing the outline's keys are gone.** Screen
  readers still hear the keys. Hidden to its rail, the pane shows its tab's name on its side.

## 0.49.0 - 2026-09-22 (PR #193)

### Changed

- **The Link and Language dialogs now open over the editor**, near the top of the window, instead
  of at the foot of the page where you had to scroll to find them. Each shows the same icon as the
  button that opened it, and says which text the link or tag will go on.
- **Apply is now OK**, at the right of the dialog, with **Cancel** at the left. **Apply anyway** is
  now **OK anyway**, and **Remove** says what it removes: **Remove link** or **Remove language tag**.
- **Every dialog's close button** is now a drawn cross, matching the editor's icons.

## 0.48.0 - 2026-09-22 (PR #192)

### Changed

- **The component editor takes far less room above the text.** The title, version, language,
  direction, save state, Done and Save version now sit on one slim strip, and the formatting buttons
  are a single row of icons. Hover over any icon to see what it does and its shortcut.
- **The title is shown once and renamed by clicking it.** Language and direction are small chips;
  click one to change it.
- **The save state is a coloured chip: Saved, Saving or Not saved.** Hover over it for the time of the
  last save.
- **In a document, click a component's text to edit it there.** The caret goes where you clicked, and
  **Done** closes it again. The Edit and Close buttons are gone.
- **A component's block and word counts moved into a tooltip**, on its section number in a document
  or on its version on its own page. The line under the text that said how to move around with F6 is
  gone.

## 0.47.0 - 2026-09-22 (PR #191)

### Changed

- **The Alloy Works mark at the top left now takes you to Home.** It no longer opens a menu of
  modules; Home is where each module is chosen.

### Fixed

- **Signing out and back in can now switch to a different person.** Signing in always asks the
  sign-in provider which account to use, so after signing out you are no longer taken straight back
  in as whoever signed out.

## 0.46.1 - 2026-09-21 (PR #189)

### Fixed

- **A pull request no longer fails its checks because the build machine was slow, at any limit.**
  The timing test for large documents had already stopped holding shared build machines to its
  250 ms target (0.40.3). It still failed one when a single request took 535 ms against the 500 ms
  maximum, on code nothing had changed. On a shared build machine the timings are now recorded
  beside the result and fail nothing. On a named machine both limits still hold.

## 0.46.0 - 2026-09-21 (PR #187)

### Added

- **Administration.** Open it from your account chip. It is a dialog with a section for each part
  of the environment the service can show today:
  - its name and address;
  - its spaces, and where you may create;
  - its people, and the invitations still waiting;
  - its roles, with what each holds;
  - About, which says which version this is.

  Where you may not manage the environment, the section says so and the rest still show.

### Changed

- The sample panel and the line naming the delivery have moved from Home into About.

## 0.45.0 - 2026-09-21 (PR #186)

### Added

- **Home.** The application now opens on a greeting and a card for each of Components, Documents
  and Publications. Each card says what the module is for, what you can do there today, and how many
  there are for you to read, and opens its list.

### Changed

- The components list is now at `#/components`, and the module switcher and every "Back to
  components" link go there. `#/` is Home.

## 0.44.0 - 2026-09-21 (PR #185)

### Added

- **Publications have a list of their own.** Publications, from the module switcher or at
  `#/publications`, lists every publication you may read, of every document, newest first: its
  title, the version it was made from, when and by whom, and that it is not approved. Tick documents
  in the filter pane to narrow it.
- **A publication shows itself.** Its page now holds the PDF, in the browser's own viewer on the
  grey desk it was drawn on, with what it was made from beside it. Download the PDF still saves it.

### Changed

- The service lists every publication you may read at `GET /v1/publications`, and a publication
  gives a second link to its PDF, `view`, that a browser shows rather than saves.

## 0.43.0 - 2026-09-21 (PR #184)

### Added

- **A document shows its components' text, and you can edit any one of them where it stands.** Each
  component's card in the middle of a document now holds its text, formatted as it is when you
  open it. Edit puts that component's own editor in the card, and Close puts the text back, showing
  what you saved. One component is open for editing at a time. Opening another closes the first,
  keeping what you typed. A component you may not read still shows only that it is there.

### Changed

- The service answers the text of every component a document places in one call,
  `GET /v1/documents/{id}/texts`. A component you may not read is never read for it.

## 0.42.0 - 2026-09-21 (PR #183)

### Added

- **A document is one page: its outline, its text and the part you have chosen, side by side.**
  - The outline sits on the left. Drag its edge to make it wider or narrower, or move the edge with
    the arrow keys. Hide it to a thin rail when you want the room. The page remembers both.
  - In the middle, the document reads in order: each section a heading under its number, and each
    component a card under its own, with Open to go to it. A component you may not read says so.
  - On the right is what is said of the part you have chosen: its settings, its link and, when you
    remove it, the question that asks first. The figures, tables and equations and the
    publications sit beneath.
  - Editing a component in place, in the middle, comes next.

## 0.41.0 - 2026-09-21 (PR #178)

### Added

- **The documents list is a table.**
  - Each document is a row: its title, its space, its version, how many sections and component
    references its outline holds, whether it is published, and when it last changed.
  - Publishing says Published when the latest publication you may read is of the latest version,
    Changed since when the document has moved on, and Never published when you may read none.
  - A filter pane counts the documents by space and by publishing state. Tick to narrow, Clear to
    see everything again.
  - New document is a blue button that opens the same form in a dialog, offered only where you may
    create one.

### Changed

- The service's list of documents now also gives each document's last change, its outline's
  section and component counts, and its publishing state.

## 0.40.3 - 2026-09-21 (PR #180)

### Fixed

- **A pull request no longer fails its checks because the build machine was slow.** The test that
  times opening, numbering and restructuring a large document measured the same code at anywhere
  from 100 to 258 milliseconds on the shared build machines, so a change could fail the 250 ms
  budget without touching anything it timed. On a shared build machine it now fails only past the
  500 ms maximum, and records the 95th percentile beside the result. On a named machine both limits
  still hold.

## 0.40.2 - 2026-09-21 (PR #182)

### Fixed

- **Building the images no longer fails when GitHub answers the Typst download with an error for
  a while.** The download is tried again every twenty seconds for up to five minutes. A file that does not
  match its checksum is still refused.

## 0.40.0 - 2026-09-21 (PR #177)

### Added

- **The access page has its layout.** What is granted, and what someone may do and why, fill the
  left. Each level is a card of rows, and a denial is edged in red. Giving access and inviting
  someone sit in their own cards on the right. Remove and Withdraw are outlined in red. Nothing on
  the page is reworded.

## 0.39.0 - 2026-09-21 (PR #176)

### Added

- **The component editor has its layout.**
  - A pane on the left lists the components of the open one's space, with their versions and the
    open one marked. Go to another in one click.
  - The editor is a card:
    - a strip across the top holds the title, the version, the language and the direction, with
      the save state, Done editing and Save version on the right;
    - the formatting toolbar sits under it;
    - the text sits under that in a framed surface.
  - A status line at the foot says how F6 moves between the header, the toolbar, the list panel and
    the text, and how many blocks and words the component holds.

## 0.38.0 - 2026-09-21 (PR #175)

### Added

- **New component opens as a dialog.** The components list has one blue New component button. It
  opens the same form as before, in a dialog over the list, with each field's label above it.
  Escape or Close puts it away, and focus goes back to the button.
- **Each component has a row menu.** It offers Open, Copy link and, if you may administer that
  component, Manage access. Copy link says when it has copied the link.

### Changed

- The New component form is no longer always open above the list, and the button is offered only
  to somebody who may create a component somewhere.

### Fixed

- The list says "1 component you may read" rather than "1 components".

## 0.37.0 - 2026-09-21 (PR #174)

### Added

- **The components list is a table.**
  - Each component is a row: its title, its component type, its space, its version, its base
    language, when it last changed, and who changed it. It says You when that was you.
  - A filter pane beside the table lists the spaces you may read, each with how many components it
    holds.
  - Tick spaces to narrow the list, or Clear to see everything again.
  - Hide the filter to a thin rail when you want the room. The list remembers that.
  - A line above the table says how many components you may read and how many are shown.

### Changed

- The service's list of components now also gives each component's type, language and last change,
  a total, and the spaces it can be narrowed to (`spaces=` takes their ids).

## 0.36.0 - 2026-09-21 (PR #173)

### Added

- **Every state has its own look.** Each kind of message now looks different:
  - something that could not be loaded has a red edge, with Try again beside it;
  - being signed out, reading only, being refused and someone else editing each have their own
    colour;
  - an empty list sits in a dashed box;
  - waiting shows a small spinner beside its words;
  - the save state has a coloured dot: green for saved, blue for saving, amber for retrying, red
    for not saved.

  Every sentence is worded exactly as before.

## 0.35.0 - 2026-09-21 (PR #172)

### Added

- **The interface has its look.** Every screen now sits under a dark header band. The band holds:
  - the mark, which switches between Components and Documents;
  - the name of the module you are in;
  - the environment's name;
  - an account chip, with Sign out.

  Buttons, fields, tables and messages take the Light theme's colours and type, and each screen's
  main action is the one blue button. The words on every screen are unchanged. This is a first
  draft: no screen has its own layout yet.

### Changed

- The sample panel and the line naming the delivery now sit under the components list, and nowhere
  else.

## 0.34.3 - 2026-09-21 (PR #171)

### Added

- **A build order for the interface.** A plan in `docs/plans/` says which of the thirteen drawn
  screens is built first and what each needs from the service. It also sets out how the one Light
  theme is built so a second theme is only new colour values, and which assumptions on the drawings
  have to be settled before the work reaches them. Nothing in the application changes yet.

## 0.34.2 - 2026-09-21 (PR #168)

### Added

- **The interface has a specification.** `docs/interface/` says what the product looks like: the
  dark header band and the three modules, the four layouts every screen is one of, the route each
  screen answers, the words on its controls, and the states it can be in. Thirteen screens are drawn
  in full beside it - as HTML you can open and read the real values off, and as a picture for an
  issue or a review.
- **One palette, in one file.** `docs/interface/tokens.css` carries every colour, type size, spacing
  step, corner, shadow and pane width as a custom property. Nothing else writes a colour, which is
  what makes a dark theme an afternoon later rather than a project later.

### Known limits

- **Light theme only.** The design system these screens come from carries a dark value for every
  colour token. The `[data-theme="dark"]` block and the Auto mapping are a later pass, and they land
  in `tokens.css` alone if no component has written a hex in the meantime.
- **Eight things are drawn ahead of the code** - among them a document view, search, metadata,
  Preview, and component types beyond Topic. `docs/interface/README.md` lists every one of them
  rather than leaving them to be found in a diff.
- **The folder is not in `docs/design/`, and it claims no requirement.** A design document there owns
  what it answers in full, and these screens have not been read against CNT, STR, PUB and IAM one by
  one. Each screen moves into its subsystem's design document, with its claims, as that subsystem is
  built; what should be left here at the end is the shell, the tokens and the layouts.

## 0.34.1 - 2026-09-21 (PR #170)

### Fixed

- **The service and the worker no longer stop when the database drops an idle connection.** A
  database restart, a failover or an idle timeout ends connections the product is holding open but
  not using, and until now that took the whole process down with it, along with anything it was
  doing. The connection is now simply replaced the next time one is needed.

## 0.34.0 - 2026-09-21 (PR #167)

### Added

- **An author can quote.** **Quotation** on the toolbar, or Ctrl or Cmd, Shift and full stop, sets
  the selected paragraphs as a quotation, with a line beneath for who said it, formatted like any
  other text. Leave it empty if there is nobody to name. Press it again inside a quotation to take
  the quotation off; an attribution you wrote stays, as a paragraph after it.
- **An author can write preformatted text.** **Preformatted text**, or Ctrl or Cmd, Shift and comma,
  turns the selected paragraphs into one block whose spaces, tabs and blank lines are kept exactly,
  in a fixed-width typeface with tab stops every eight columns. Enter starts a new line and Tab types
  a tab; Ctrl or Cmd and Enter leaves the block, and Shift Tab always moves the focus back out of it.
  Formatting is dropped when a paragraph becomes preformatted text, and one undo brings it back.
- **Preformatted text can say what it is.** While the cursor is in it, a **Preformatted text** panel
  offers a **Language label** such as sql or python, which F6 reaches like the other regions. A label
  that is not letters, digits and + # . _ - is refused with a sentence beside the box.
- **A publication prints both.** A quotation is indented on both sides with its attribution at its
  end and nothing added before it, and preformatted text is set in its own panel in Liberation Mono,
  every space and tab where you put it, with its label above it. A screen reader is told which is a
  quotation and which is code. Inline code is now printed in Liberation Mono too. It still passes
  every PDF/UA-1 rule the checker applies.

### Known limits

- Preformatted text copied out of a PDF, or read aloud, loses its indentation, and a tab is read as
  spaces (#162).
- A quotation's attribution is read aloud as its last paragraph, and a preformatted block's label as
  a stray word before it, because a PDF has no structure of its own for either (#163).
- A line of preformatted text inside a numbered list may be refused although it would just have fit,
  because the limit there is worked out cautiously (#164).
- A line of preformatted text wider than the page refuses the publish rather than being wrapped or
  cut off: 83 columns under the default layout, and 79 inside a quotation. Much ordinary code is
  wider than that; a layout that sets code smaller is what will fix it (#165).
- A character the fixed-width typeface does not have, such as a handful of typographic spaces, is
  refused in preformatted text and inline code, although a paragraph can print it. So is an invisible
  character such as a zero-width space or a soft hyphen, because in fixed-width text the engine would
  drop the letter before it.
- Blank lines at the very end of preformatted text are not printed.
- Quotations can be put inside one another fifteen deep, which is the most a publication can set.
- Turning a paragraph into preformatted text turns any line separator in it into a line break, and
  leaves out other invisible control characters, which preformatted text cannot hold. One undo brings
  them back.

## 0.33.0 - 2026-09-21 (PR #161)

### Added

- **An author can make lists.** Bulleted, numbered and definition lists, from the toolbar or the
  keyboard, over the paragraph the cursor is in. Pressing **Bulleted list** or **Numbered list**
  again takes the list off, or, where the item is nested, lifts it one level.
- **Lists nest.** Nest item and Lift item move an item in and out, with Tab and Shift Tab as well as
  Ctrl or Cmd and the square brackets, to six levels and well past them, mixing all three kinds
  freely. Enter in an item you have written nothing in leaves the list, one level at a time.
- **A definition list holds the term it defines**, written as ordinary text, so it can be
  emphasised, linked or marked as being in another language like any other phrase.
- **A numbered list can start where you want and count how you want.** Set it to start at any number
  and to count 1, 2, 3 or a, b, c or i, ii, iii, from the List panel beside the toolbar. The panel
  is there while the cursor is in a numbered list and F6 reaches it like the other regions.
- **A publication prints all of it.** A PDF now carries lists at every level, with the numbering and
  the start the author chose, and a screen reader is told it is a list rather than a row of
  characters. It still passes every PDF/UA-1 rule the checker applies.

### Fixed

- **Content can no longer be saved nested more deeply than the product allows.** The limit that
  applied when content was pasted or imported now applies on every path that stores content,
  including an editing session. Before, content nested past it was accepted, and content nested
  deeper still failed in a way that said nothing at all; now nothing past it is stored. What an
  author is told is still thin: from the editor, that the text cannot be saved as it stands and to
  undo the change that caused it; from anywhere else, only that the content is not a document this
  product can store.

### Changed

- A numbered list counting in letters or roman numerals now starts at 1 or more. Only a list
  counting 1, 2, 3 can start at 0, where a zero means something.
- A publication made from now on uses publication template 4. Publications already made are
  unchanged and still open exactly as they were.

### Known limits

- A definition list is published as a list whose item label is the term. A screen reader announces
  the term and then its definition, which is the right order and the right emphasis, but PDF has a
  definition-list structure of its own and the engine the product uses cannot yet produce it, so a
  reader is told "list" where you wrote "definition list".
- The markers beside a bulleted list - a disc, then a circle, then a square - are fixed by the
  product rather than set by a style, and they repeat after three levels of nesting. They belong in
  a named style and will move there.
- A list stops nesting at thirty levels. Every control that would build one - **Nest item**, and the
  three list buttons where they would make a list inside a list - becomes unavailable there, `Tab`
  moves the focus on instead, and the two keys that can nest a definition item under the one above
  it, `Backspace` at the start of a term and `Delete` at the end of the definition before it, do
  nothing. A list deeper than thirty levels is not a document the product can store. A list of
  exactly thirty is stored and can never be published: the publish fails, and the only thing you are
  told is that it failed. A single stated limit, in levels rather than in the language of a file
  format, and below the depth a publication can carry as well as the depth the store takes, is still
  to come.
- A footnote written inside a definition list's term would take no number. Nothing can put one there
  today; it is named so that whatever makes it possible starts from knowing.
- Block quotations and preformatted text are still not writable, and a document holding one still
  cannot be published.

## 0.32.0 - 2026-09-20 (PR #157)

### Added

- **An author can format text.** Strong, emphasis, underline, subscript, superscript, inline code and
  a quoted phrase, from a toolbar above the surface or from the keyboard, over a selection or over
  the next thing typed. Pressing the same button again takes the formatting off.
- **A span of text can be a link.** **Link** asks for an address beginning http:, https: or mailto:,
  and an optional title. An address of any other kind is refused with a sentence saying why, and
  nothing is applied.
- **A run can be in another language.** **Language** marks a selection with a BCP 47 tag, such as fr
  or pt-BR, and the surface stops asking the browser to spell check it, so a passage in another
  language is no longer flagged as misspelt.
- **The whole toolbar is reachable from the keyboard.** It is one tab stop, the arrow keys move
  along it, and F6 moves between the component header, the toolbar and the surface.
- **A publication prints all of it.** A PDF now carries emphasis, strong, underline, subscript,
  superscript, inline code, quoted phrases, live links and a run's own language, and still passes
  every PDF/UA-1 rule the checker applies.

### Changed

- A publication made from now on uses publication template 3. Publications already made are
  unchanged and still open exactly as they were.

### Known limits

- Inline code prints in the same face as the text around it, because only one typeface is pinned
  today. A screen reader is still told it is code. A monospace face arrives with themes.
- Of the nine marks a publication carries, only a link, inline code and a quoted phrase reach a
  screen reader as something it names. Strong, emphasis, underline, subscript and superscript are
  printed but are not announced.
- A quoted phrase is marked as a quotation for assistive technology and is given no quotation marks
  of its own, so the only quotation characters on the page are the ones the author typed.
- A language tag carrying a script or a numeric region, such as zh-Hans or es-419, is stored but
  cannot be published to PDF yet. The editor says so when a run's tag is applied, and a publish
  naming that tag says so and prints nothing. A component's own base language, in the header, is not
  warned about: one of these tags typed there is taken without comment and refused only at the
  publish (issue #156).
- The optional title on a link is stored and is not carried into a PDF, because a PDF link has
  nowhere to put it and inventing somewhere would tell a reader something you did not say. The
  address is what a reader of the PDF gets.

## 0.31.0 - 2026-09-20 (PR #153)

### Added

- **A publication is laid out.** It opens with a cover carrying the document's title, then a contents
  page a screen reader announces as a table of contents, then the document itself. Every page after
  the cover carries a running head with the title and the part you are in, and a foot with the
  revision and the page number. Pages are numbered per part: roman numerals through the front matter,
  from 1 again in the body, and appendices carrying on from the body.
- **A top-level part of an outline is front matter, the body or an appendix.** **Matter** beside the
  selected part replaces the **Appendix** tick box and offers all three, so an outline can now open
  with front matter - a preface, say - numbered `i`, `i.1` in a scheme of its own and paged on its
  own. Front matter has to come first, so it is not offered once the body has begun, and a move that
  would break the order is refused with a sentence saying why rather than done. `Ctrl+Z` takes a
  **Matter** change back like any other.
- **The outline panel numbers with the scheme the document publishes with**, not with a scheme of the
  page's own, so the numbers you see while you work are the numbers that come out of the PDF. So do
  the figures, tables and equations listed beneath the outline. If the scheme cannot be read the page
  says so and numbers nothing, rather than showing numbers no publish would produce; the outline is
  still fully editable.
- **Every environment starts with a layout**, the product's default: English words, A4 with an inch
  margin, the cover and a contents three deep, and each appendix starting a new page. Every
  publication records the exact version of the layout it was made under, beside the document version
  and the fonts it already recorded.

### Changed

- **A document is published only under a layout written in its own language.** Where the two do not
  agree the page says so, naming both, before anything is queued; a layout in English publishes a
  document in `en-GB` as well as one in `en`. Asking for a format the layout does not make is refused
  the same way. Every document still publishes under the product's default layout, in English (#144).
- The requirements now number 1,384: front matter must come before the rest of an outline (#152), and
  a layout must declare the language its generated words are in (#144).

Nothing chooses or edits a layout yet, and there is still no list of figures or tables, no caption
labels, no Word file and no preview.

## 0.30.0 - 2026-09-19 (PR #151)

### Added

- **Publish a document as a PDF.** A document's page has **Publish as PDF** for anybody who may
  publish it. A second or two later the publication is ready: a tagged PDF of the version on the page,
  its sections numbered as the outline shows them and bookmarked, each component's paragraphs beneath
  its heading, set in Liberation Serif. Only plain paragraphs are published so far: a document holding
  formatting, a list, a table, a figure, a footnote or an equation is refused, and there is no layout,
  theme, Word file or preview yet.
- **Every publication says it is not approved**, at the top of every page and once where a screen
  reader reads it, because nothing can approve one yet. Publications are kept and never changed:
  publishing again makes another.
- **The document's publications are listed beneath its outline**, each with who published which
  version and when, and each has its own page with a download. Who may read a publication is decided on
  the publication, so somebody given a single document does not see its publications unless given them
  too.
- **A Publisher role**, holding read and publish. In the development environment, Ada and Grace hold it
  on General.
- **When a document cannot be published, you are told every reason at once**, each at its place in the
  outline: a component you may not read (never which one), a block or formatting that cannot be
  published yet, or a character no typeface can set.

### Changed

- The requirements now number 1,382: a publication that is not approved must say so (#142), and
  publishing must be refused where the publisher may not read every component (#143). The second
  replaces a narrower requirement, which is withdrawn.

## 0.29.2 - 2026-09-19 (PR #150)

### Changed

- The publishing requirements were revised after the publishing design: ten were replaced by eleven
  more precise ones and one duplicate was withdrawn, so the product now has 1,380 requirements.

### Fixed

- The sample PDF is now set only in the Liberation Serif faces the product ships and pins by hash,
  checked again before every compile, and the worker refuses to render anything if a face is missing
  or has changed since it was checked (#145).
- A sample PDF that fails because of what it was asked to render, such as a document the
  engine refuses to set, is now finished at once with that reason recorded, instead of being tried
  again for no different result (#146).

## 0.29.1 - 2026-09-19 (PR #149)

### Added

- **`pnpm trace pins`.** Editing the requirement corpus can move the exact counts `trace.test.ts`
  and `parse/requirements.test.ts` pin, and working out by hand what each becomes is slow. The new
  command prints what each pin counts, its pinned value, what the working tree compiles to now, and
  the file and line to edit, marking each one that has moved. It only reads and prints.

## 0.29.0 - 2026-09-19 (PR #136)

### Added

- **A link to every part of a document.** Choose a section or a component in the outline to see its
  link, or copy it with Copy link. Opening the link opens the document there, with that part marked,
  even after the outline has been reordered.
- **Figures, tables and equations listed.** Beneath the outline, a document lists its figures, tables
  and equations with their numbers and captions, each a link to where it is placed. Move anything and
  the numbers change at once. A number that would depend on a component you may not read is left off.
  Nothing in the editor adds a figure, table or equation yet, so the lists show only those made
  through the API.
- **A time limit for large documents.** On a document of five hundred sections and components, the
  service now has to open, number and restructure it within a quarter of a second for 95 requests in
  100, and never take more than half a second in a test run. Every test run checks it.

## 0.28.2 - 2026-09-19 (PR #141)

### Fixed

- Two of the checks that run on every change could fail now and then for no reason other than a busy
  build machine, blocking a change that was fine. They check that document numbering and outline
  editing give the right answers, and now have the time they need to do it.

## 0.28.1 - 2026-09-19 (PR #139)

### Fixed

- A sample that finished just as you opened a page could show its old state until you reloaded: the
  page began listening for news a moment after it had already read what was there, and anything that
  happened in that moment was never passed on. The page now reads what is there only once it is
  sure to hear what happens next, and if it cannot listen at all it tries again a few seconds later
  rather than sitting still.

## 0.28.0 - 2026-09-18 (PR #133)

### Added

- **Section numbers.** A document's outline shows every section and every component its number -
  `1`, `2.1` - and a move renumbers them straight away. Untick **Numbered** to leave a section and
  everything under it out of the section numbering, and the sections after it close the gap; a section left
  ticked beneath one that is not says **Not numbered while** that one **is not.** Tick **Appendix** on
  a top-level section to number it `A`, `B` and so on. An appendix stays at the top level: the outline
  does not offer to move one beneath another section, and says so if you try with `Alt` and the right
  arrow.
- **Numbering through the API.** A document's numbering - sections, figures, tables, equations and
  footnotes - can be read with where each number came from: which section or component produced it,
  and which version of each component it was counted from. Figures and tables are numbered per chapter
  (`Figure 2.1`), equations and footnotes straight through, and appendices on their own (`Figure A.1`).
  A number that would depend on a component you may not read is left out rather than guessed, so it
  never tells you what that component holds. Nothing in the editor adds a figure yet, so these numbers
  are only seen through the API for now.

### Fixed

- The automatic checks on dragging a row in a document's outline failed now and then on a busy
  machine, because a drag started in the first moments after the outline appeared could be cancelled.
  Nobody can start a drag that quickly by hand, so nothing you did was affected, and the checks now
  pass every time.
- `Ctrl+Z` now undoes the last change while the **Starts on** choice has the focus, as it does from
  the outline itself. A text field still keeps `Ctrl+Z` for its own undo.

## 0.27.1 - 2026-09-18 (PR #128)

### Fixed

- A component can no longer be saved with two things sharing one identifier when one of them is
  inside a footnote. Every identifier in a component is now unique, footnotes included.
- A footnote can no longer hold an image or another footnote, as the content rules always said.
- A footnote's text is held the same however it was spelled, so the same footnote saved twice is
  recognised as no change rather than as a new version.
- A component or a footnote can no longer be saved with two empty paragraphs side by side in a table
  cell or a footnote, and an identifier must be written in one standard form of its characters, so
  two identifiers that look the same can never be two different things.

### Changed

- A cross-reference now carries an identifier of its own, says whether it points at something in its
  own component, in another component, or at a section of the document, and a reference to a page can
  say what to show instead where there are no pages. A cross-reference in a section title shows a
  number or a page only, for now, so a heading can never end up showing itself. Nothing in the
  product writes cross-references or footnotes yet, so nothing you have made changes.

## 0.27.0 - 2026-09-18 (PR #121)

### Added

- **Documents.** A document is a thing of its own now. Choose **Documents** beside **Components**, and
  **New document** makes one in a space you may create in, with a title, a base language and a
  direction. It opens at version 0.1 with an empty outline.
- **Outlines.** Build a document's structure as a tree: add a section or a component after the one
  selected, move one under another by dragging it or with `Alt` and the arrow keys, rename a section,
  choose whether one starts on a new page or a new right-hand page, and remove one with everything
  beneath it. The same component can appear more than once. Each act is its own version, and `Ctrl+Z`
  or **Undo** takes the last one back - except a removal, which cannot be undone, so the page asks
  before it removes anything.
- **No lock on a document.** Two people can have the same outline open. If somebody else changes it
  first, your next change is refused and the page shows you the outline as it now stands, rather than
  overwriting what they did, and clears what you could undo so an undo cannot overwrite it either.
- Somebody who may read a document but not change it sees its outline and is offered nothing to
  change.
- **A component you may not read stays private.** A document can include one you may not read: it
  shows as **A component**, which you can still move, remove or start on a new page, and nothing says
  which component it is. You can only add a component you may read.
- **Every section has a title**, and the service refuses one with none, whoever sends it.
- **No rename is lost without a word.** Renames of two sections made while another change is being
  saved are both saved, in order. A rename refused because somebody else changed the document first
  names the title that was not saved, and so does one that could not be saved after you had moved on
  to another section.

### Changed

- The version chain now holds a fifth kind of thing, a document, on the same terms as a component: one
  space, one chain of versions, the same two digests, and an author for every version.
  A development database from before this release gains three widened checks and nothing else.
- **Components** and **Documents** are links above either list, so each is one click from the other.

## 0.26.0 - 2026-09-18 (PR #117)

### Added

- **New component.** On the list of components, choose a space you may create in, give a title, a base
  language and a direction, and take the component type the environment offers. Creating makes version
  0.1 with one empty paragraph and opens it for editing. A space you may read but not create in is not
  offered, and where there is nowhere you may create, nothing is shown at all.
- **A component header.** The title, the base language and the base direction are edited above the
  surface. Each is part of the document, so each is undone with the rest of your changes and recorded
  in the next version you cut. A title cannot be emptied and a language tag that is not one is not
  taken; the page says which, and the document keeps what it had.
- Every environment now starts with a component type, named Topic, and declares it the default, so
  creating always has a type to take.

### Changed

- `pnpm dev:setup` no longer makes a component type of its own; it takes the environment's default. A
  development database from before this release keeps the Topic it already had, and gains only the row
  declaring it the default.

## 0.25.0 - 2026-09-17 (PR #114)

### Added

- **Invite somebody before they have signed in.** On a component's **Manage access**, an administrator
  of the whole environment enters an address under **Invite someone**. The person is offered straight
  away, marked as invited and not signed in yet, so they can be given access; the first time they sign
  in with that address, through either sign-in route, they have it. Their sign-in provider must have
  verified the address. Nothing is sent to them: tell them where to sign in.
- **Waiting invitations, renewed and withdrawn.** An invitation waits fourteen days and is listed with
  its date. Inviting the address again renews it and keeps what it was given; **Withdraw** takes it
  back, with everything given to it, until it is accepted. Whether the person is from outside the
  organisation is chosen when inviting them, and cannot be changed afterwards yet.

### Changed

- **A new environment's first administrator is invited by address.** Whoever sets the environment up
  invites them before anyone can sign in, and they are administrator from their first sign-in, whether
  the environment signs in through its own provider or only with Google. In development,
  `pnpm dev:setup` invites Ada this way, and the stand-in sign-in provider offers Ivy, whom nothing has
  invited yet. In a development database set up before this version where Ada never signed in, she
  does not become administrator: start from a fresh one, as docs/development.md describes.
- **Somebody who has already signed in is given access directly, not invited.** Inviting their address
  is refused, and says so.

## 0.24.0 - 2026-09-17 (PR #112)

### Added

- **Managing who may do what.** An administrator opening a component now sees **Manage access**. It
  lists what is granted on the component, on its space and across the whole environment, wherever
  they may manage it, and lets them give a person a role at any of those, as an allow or a denial,
  and take a grant away. A change applies at the person's next request.
- **What someone may do, and why.** On the same page, choose a person and **Show**: every permission,
  whether it is allowed, and the level and grants that decided it, or every level that granted
  nothing.
- **A tenant cannot lose its last administrator.** Removing the last grant that lets anyone administer
  the whole environment is refused, and says so.

### Changed

- **Somebody new is given access after they first sign in.** A person signs in once, sees nothing,
  and can then be chosen; inviting an address before that is not built yet.

## 0.23.3 - 2026-09-17 (PR #111)

### Fixed

- **The web application's calls to the service are type-checked again.** Every answer the API client
  gave the renderer was untyped, so a renamed route or a missing field typechecked cleanly and only
  failed when the application ran. `pnpm typecheck` now refuses a route or a field the API document
  does not declare, in the renderer and in the end-to-end check.

## 0.23.2 - 2026-09-17 (PR #109)

### Changed

- **The service now answers on port 8088 by default**, in the compose stack and run from source, so
  open `http://dev.acme.localhost:8088`. The renderer's development server and the stand-in sign-in
  provider point there too.
- **Every port the compose stack publishes can be changed in `deploy/.env`**: `SERVICE_PORT`,
  `IDP_PORT`, `STORE_PORT` and `POSTGRES_PORT`. `deploy/.env.example` lists them with their
  defaults. Each one also moves every address that names it, so signing in keeps working on a
  moved port without editing anything else.

## 0.23.1 - 2026-09-17 (PR #108)

### Fixed

- **`pnpm dev:setup` works on a checkout that has not been built yet.** It stopped after preparing the
  database, unable to find the database package, until something had run `pnpm build`. It now builds
  what the setup needs first.

## 0.23.0 - 2026-09-17 (PR #106)

### Added

- **Editing a component**, built from [the component editor design](docs/design/component-editor.md).
  Signed in, the page lists the components you may read; open one, and if you may edit it, your first
  change starts editing it.
- **One person edits a component at a time.** Anyone else who tries is told who is editing it and when
  they are expected to stop, and what they typed is kept for them to copy. The same person in a second
  window is offered to continue there.
- **Changes are saved as you type**, a moment after you stop, and the page says plainly whether they are
  saved, saving, or not saved and being retried.
- **A long pause does not lose your place.** After fifteen minutes without a change somebody else may
  start editing, but if nobody has, your next change, Save version or Done editing carries on as before.
- **Being signed out, or losing permission, is said plainly** rather than retried for ever: signed out,
  the page keeps what was not saved and saves it with your next change once you sign in again; if you
  may no longer edit or read the component, the page says so and keeps the text for you to copy.
- A component that could not be opened, or a list that could not be loaded, says so and offers Try
  again, rather than reading as missing or showing nothing.
- **A version is made only when you ask**: Save version, or Done editing, which also lets somebody else
  edit. Nothing you type and no amount of waiting makes one, and asking when nothing has changed says so
  rather than making an empty version.
- **Undo** reaches back through what you have done since the last version, and no further.
- In development, `pnpm dev:setup` makes a component called "Install the printer" and lets Ada and Grace
  edit it.
- For now a component can hold only paragraphs of text to be edited here - anything else opens for
  reading only - pasting is refused, and nothing creates a component or grants permission to edit one
  outside development.

### Changed

- The page no longer shows the fixed sample component the scaffolding rendered.

## 0.22.0 - 2026-09-16 (PR #105)

### Added

- **Who may do what, decided one way everywhere**, built from [the access design](docs/design/access.md).
  Ten permissions - read, create, edit, comment, suggest, approve, publish, design, managing definitions
  and administer - are held only through roles, and a role is granted to a person or a group on the whole
  environment, one space, or one item, as an allow or a denial.
- **The nearest grant decides.** A grant on an item overrides its space, a space overrides the
  environment, and a denial wins over an allow made at the same place. Every answer names the grants and
  the place that decided it, or the places it looked at when nothing did.
- **Every environment starts with eight roles** - Reader, Reviewer, Author, Approver, Designer,
  Definitions manager, Administrator and Editing - and a space called General. They are the environment's
  own to change.
- **Read-only on one item**: denying someone Editing on an item leaves them reading, commenting and
  suggesting there while they still author the rest of its space. Editing can only be denied, because
  allowing a change without allowing a read describes nobody.
- **An environment's first administrator**: whoever sets it up names that person by their sign-in
  identity, and their first sign-in makes them Administrator, once. In development, Ada administers both
  environments from her first sign-in.
- **Access for people outside the organisation is limited by design**: never across the whole
  environment, never to create, edit, approve, publish, design, manage definitions or administer, and
  always with an end date, which defaults to 30 days and can reach at most 90.
- **A change to access cannot slip between a check and the act it allowed**: the act finishes first, or
  it sees the change.
- **Two ways to ask**: what you may do to something, and, for an administrator, what someone else may do
  and why. An item you may not read answers exactly as one that does not exist.
- There are no screens for roles or access yet; the editor's routes will be the first to be checked.

## 0.21.0 - 2026-09-16 (PR #104)

### Added

- **One way in for content**, built from [the content model design](docs/design/content-model.md).
  Everything pasted or copied into a component will pass through the same checks, in the same order,
  wherever it came from.
- **Anything that could run code or navigate is removed before content is kept**: scripts, embedded
  objects, event handlers, links that are not web or email addresses, formatting that could run code, and
  anything in an equation that is not standard MathML. An equation is only ever kept in one standard form,
  however it arrives.
- **Formatting is dropped and spacing paragraphs are removed**, because the theme decides how content
  looks. Text is kept in one Unicode form, and text copied from a component in another language keeps its
  language.
- **Copied content gets new identifiers**, so a copy is never mistaken for the original, and comments and
  suggestions stay with the component they were made on.
- **A report of everything removed or changed**, returned with the content so it can be shown at the
  time. Content that cannot be kept whole is refused whole, with a reason.
- Nothing in the application pastes through it yet; the editor will.

## 0.20.1 - 2026-09-16 (PR #100)

### Fixed

- **The database test suite no longer prints a warning from the Postgres driver.** The connection that
  hears each environment's events now sends one request at a time, instead of starting a new one before
  the last had finished - which the driver warns about today and its next major version will refuse.

## 0.20.0 - 2026-09-15 (PR #98)

### Added

- **A permanent record of every version**, built from
  [the storage design](docs/design/storage-and-versioning.md). A component's versions, and those of the
  fields, metadata schemas and component types it is written against, are kept in its environment's own
  database and can be added to but never changed or deleted, by the database's own permissions rather
  than by the application remembering not to.
- **Each version records who made it, when, an optional note, its content and metadata values, the
  values it did not carry forward, and exactly which versions of its type, schemas and fields it was
  written against.**
- **A fingerprint of each version that anybody holding it can recompute**, so a version changed behind
  the application's back is detectable. A version that would change nothing is not recorded, and a
  version that corrects only a metadata value is.
- **Spaces**, which hold components; fields, schemas and component types belong to none.
- **A load test for the version store**, run by hand, whose measured result is recorded with the plan.
- Nothing in the application creates or shows a version yet; this is the store the editor will use.

## 0.19.0 - 2026-09-15 (PR #97)

### Added

- **The rules for a component's metadata**, in `packages/domain/src/metadata/`, built from
  [the metadata design](docs/design/metadata.md). Fields, metadata schemas and component types are
  definitions that record the version of their own format and are read forward from it, with a stored
  example of each kept for good.
- **Validation that reports every problem at once**, each naming the field, the rule and, where a schema
  made the rule, every schema that did. A number is held as the decimal text entered, so a value such
  as 0.1 is never changed by rounding, and a date and time must say its offset from UTC.
- **Carrying values into the next version without changing any value that is there**: a cleared value
  stays cleared, a field with no value takes its default, and a value whose field no longer applies is
  recorded with the version rather than lost.
- **A check that every person named in a value names a known user**, which still accepts a person who
  has since left.
- Nothing in the application shows or stores metadata yet; these are the rules the editor, the service
  and publishing will share.

### Changed

- The content model's canonical form and its migration chain are now shared with metadata. Content
  serialises and migrates exactly as before.

## 0.18.4 - 2026-09-15 (PR #96)

### Added

- A design for access: spaces, tenant-defined roles, and grants at the tenant, a space or a single
  item, with a decision that names the grants behind every answer, so an administrator can see why
  somebody may or may not do something. It also sets the rules for people outside the organisation:
  their access always expires and can never open the whole tenant. Revised against its review, which
  is kept alongside it.

### Changed

- A new requirement refuses a change to a metadata field that would make a schema's default value
  invalid, so a fixed field can never hold a value no author is able to correct.

## 0.18.3 - 2026-09-15 (PR #95)

### Added

- A design for metadata: which fields apply to a component, what makes a value valid, how values carry
  into the next version, and how a cleared value stays cleared. Revised against its review, which is
  kept alongside it.
- A design for the component editor: the editing surface, the lock, continuous saving, cutting a
  version, and the metadata panel. Revised against its review, which is kept alongside it.

### Changed

- Two spelling requirements are replaced, because the spellchecker built into browsers and the desktop
  cannot check each passage in its own language. A passage in another language is now not checked
  rather than wrongly flagged, and the desktop checks the languages the open components are written in.

## 0.18.2 - 2026-09-14 (PR #94)

### Fixed

- A listing written with `pnpm trace area --file` now starts with a UTF-8 byte-order mark. Editors that
  decide a file's encoding from one, and otherwise assume the Windows legacy code page, showed the
  listing's `§` characters as `Â§`; they now read the file as UTF-8 without guessing.

### Changed

- An `untracked/` folder at the repository root is ignored by git, as a place for local output - a
  listing written to a file, a script kept for one's own use - that is never part of the repository.

## 0.18.1 - 2026-09-14 (PR #92)

### Fixed

- A listing written with `pnpm trace area --file` on Windows showed as one run-on block in Notepad-style
  text viewers, because its lines ended in a bare LF. It now uses the line endings of the platform that
  writes it - CRLF on Windows, LF elsewhere - so it reads one requirement per line in that platform's
  own viewers. It is still UTF-8 with no byte-order mark, and the same machine writes the same bytes
  every time.

## 0.18.0 - 2026-09-14 (PR #90)

### Added

- `--file <filename>` on `pnpm trace area`, with an area code or with `--all`, writes the listing to a
  file instead of printing it, and prints one line saying how many requirements and areas it wrote and
  the full path. The file is UTF-8 with no byte-order mark, LF line endings and a final newline, so it
  opens the same in any editor on any platform and diffs cleanly against the last one.
- A relative filename is taken from the repository root, wherever inside the repository the command is
  run - not from `packages/trace`, where pnpm actually runs the tool. An existing file is overwritten;
  a folder that does not exist is refused, naming it, rather than created.

## 0.17.0 - 2026-09-14 (PR #89)

### Added

- `pnpm trace area --all` lists every requirement in the corpus in one command: each area in the
  order the areas index gives, under a heading with its code, its name and how many requirements it
  holds, followed by the same rows `pnpm trace area <XXX>` prints for that area. An area in the index
  with nothing in it yet is still listed and says so, and a requirement whose area the index does not
  list is shown rather than left out, so the listing is always the whole corpus - its row count
  matches `pnpm trace stats`.

## 0.16.2 - 2026-09-14 (PR #87)

### Fixed

- **A correction to a component's metadata alone would have been refused as an unchanged version.** The
  storage design decided "unchanged" by the content hash, and since metadata sits beside content rather
  than inside it, fixing a mistyped study number left that hash exactly as it was. A version is now
  judged by a **version digest** over everything it holds - content, component type, metadata values
  and the definitions it was written against - so that correction is a version, compares as a change,
  and is covered by the version's tamper-evident digest. The content hash stays, for the one job it is
  right for: keying search embeddings, which are of content. Recorded as
  [ADR-0024](docs/decisions/0024-a-version-digest-over-the-whole-version.md), superseding ADR-0012.

### Changed

- The storage design now holds a component version's type, metadata values, the values it did not
  carry forward and the definition versions it was written against, and versions fields, metadata
  schemas and component types like every other artifact, so a baseline pins them.

## 0.16.1 - 2026-09-14 (PR #81)

### Added

- **A twenty-second requirements area, [MET - Metadata and component types](docs/specification/requirements/MET-metadata-and-component-types.md)**,
  with 36 requirements. A **field** is defined once for the tenant and shared, so `jurisdiction` means
  one thing and is one search facet wherever it appears. A **metadata schema** is a named group of
  fields, managed and assigned as one, saying which are required, their defaults and which values it
  fixes. A **component type** is what kind of component something is - a narrative overview, a
  stability table section - and assigns the schemas its components carry.
- A component's metadata values belong to its **version**, beside its content, so a baseline pins what
  a component said it was as well as what it said. A version is judged for ever by the definitions it
  was written against, and the next version by the current ones.
- **Reusing what a section holds**: a section found in an existing document leads to the components it
  places, and they can be placed into another document as references under a section of its own,
  without the found section being shared (REU-054, SCH-053).
- The review of the MET draft, kept as it arrived, and its answer in MET's change history.

### Changed

- **A template assigns zero or more metadata schemas rather than owning exactly one**, each applying to
  the document or to its sections, as the scope always said a template should. A document records the
  schema and field versions it was created against, because a schema's assignments always take its
  latest version.
- **A component takes its fields from its type, never from a document that references it.** The old
  rule broke the moment two documents made from different templates referenced one component.
- Relationship types now use the same metadata schemas instead of a shape of their own, and changes to
  a shared schema or field are refused where they would break an existing relationship.
- A vocabulary may take its values from an external source - a study register, say - held locally so
  that validation and publishing never depend on reaching it.
- Eighteen requirements across TPL, CNT, STR, SCH, REL, LIB and VER are superseded by rows that say what
  they now mean, and each area records why in its change history. The corpus is 1,360 requirements.
- `Project_Scope.md` defines a field and a component type, and gains section 7.22. The requirement issue
  form offers the new area.
- The requirements index's count of settled questions is corrected: it said twenty-nine and one half
  settled when twenty-eight and one half were, and it now says twenty-nine, counting the one this
  change settles.

## 0.16.0 - 2026-09-13 (PR #79)

### Added

- **The content model's stored shape**, in `packages/domain/src/content/model/` - the first tranche T1
  code, built from [the content model design](docs/design/content-model.md) and the editor decision
  [ADR-0023](docs/decisions/0023-prosemirror-as-the-editor-and-its-model.md) that had to come first.
  Seven kinds of block, eight kinds of inline content and thirteen annotations that overlap without
  splitting the text underneath, each carrying an identifier of its own so that a comment or a
  suggestion survives the text around it being edited.
- **One entry point that validates**, `parseContentDocument`, carrying the three rules no per-node check
  can express: block identifiers are unique within a component, two adjacent empty paragraphs are
  refused while one is admitted, and a footnote holds paragraphs and nothing else.
- **A canonical serialisation**, so that two documents differing only in how they were built produce one
  string and therefore one content hash. Members in lexicographic order, text in Unicode NFC, no
  insignificant whitespace. The hash itself belongs to whoever stores the content, which keeps this
  package free of any platform.
- **Migration on read, never on write.** Content records the schema version it was written against and
  is projected forward every time it is read, so stored bytes never change and a version's hash stays
  the hash of what was written. Content that fails the check on the way back out is set aside and
  reported rather than quietly repaired.
- **A fixture of stored content per schema version, never deleted** - one minimal component and one
  carrying every construct, with tests that migrate both to the current version and assert the second
  really is complete.
- **A checked route out of the product for every construct**: one row per block, inline node and mark
  naming what it becomes in Word and in tagged PDF, and a test that fails when a construct has no row or
  a row has a gap. A construct with no way out is a finding about the construct.
- **The content model as the domain package's public surface**, promoted deliberately, with the whole
  export list pinned by a test so the next addition is a decision rather than drift.

### Changed

- `docs/architecture.md` now describes the content model as built rather than planned, and its status
  note says so; [the design](docs/design/content-model.md) keeps the argument and the requirements it
  owns, and marks what is built.
- `README.md` and [`docs/features.md`](docs/features.md) describe the content model as the stored shape
  it is, and say plainly what it is not: nothing authors this content, stores it, imports it or
  publishes it. A schema that parses is not a product that authors.

**What this release answers for.** Forty requirements are now cited by a passing test for the first time
outside the scaffolding, thirty-nine of them by the content model's own tests. That means each is cited
by a test that passed, which is not the same as the requirement being true of the product: there is no
editor, no storage and no publishing, and `pnpm trace gate` still measures a release against a baseline
a person writes by hand.

## 0.15.5 - 2026-09-13 (PR #78)

### Added

- The implementation plan for the content model's schema, in
  [`docs/plans/`](docs/plans/2026-09-13-content-model-01-the-schema.md) - the first tranche T1 build.
  Eight tasks, each test-first and each ending in a commit: the thirteen closed marks, the eight inline
  nodes, the seven blocks and the root a version holds, the canonical serialisation the content hash
  rests on, migration as a read-time projection with a fixture directory per schema version, the output
  mapping no node may lack a row in, and the deliberate promotion of the model to the domain package's
  public surface.
- A **Content model** section in the plans index, naming what plan 1 leaves for later rather than
  leaving the next reader to find it in a diff: the spike schema and its four gate-case tests still
  standing beside the new model, the admission pipeline, and resolution.

### Changed

- Three decisions the plan takes and records before the work starts, so a reviewer can disagree with
  them cheaply. The new model goes **beside** the spike code rather than through it, because rewriting
  `document.ts` in place breaks `compare.ts`, `resolve.ts`, the OOXML pair and the four gate-case tests
  at once and no task in between would leave the repository green. The **hash is the caller's** and this
  package produces its canonical input, because hashing here would mean either a Node builtin that is
  not platform-free or an async parse for no gain. And an **inline image carries an alternative the same
  way a figure does**, because CNT-087 admits an image inline and says nothing about alternative text,
  which would leave an image with no accessible name representable.

### Fixed

- The plans index still said the corpus "carries the seven known problems `pnpm trace check` reports".
  They were fixed in PR #69 and `pnpm trace check` now reports none. The `0.13.0` baseline and its
  evidence pack stay frozen and still record them, which is the record working rather than untidiness.

## 0.15.4 - 2026-09-13 (PR #77)

### Added

- **The editor is ProseMirror** - [ADR-0023](docs/decisions/0023-prosemirror-as-the-editor-and-its-model.md),
  after the spike briefed in 0.15.3 ran. All four gates pass and no cost leaks into the stored schema,
  so `docs/design/content-model.md` does not change: the vocabulary survived contact with an editor,
  which is what the spike ran to find out.
- The architecture is **one editor view per component**, stitched into one scrolling container - and
  it is chosen by two requirements rather than by preference. CNT-069 scopes undo to the component
  being edited and the history plugin keeps one stack per editor, and CNT-074 wants per-component
  editability as a flag rather than as a filter on every transaction forever. 300 components mount in
  26 to 34ms, so clearing CNT-076 needs no virtualised scroll.
- [The findings](docs/specification/spikes/Editor_Framework_Spike_Findings.md), and the throwaway code
  in `spikes/editor-framework/`.

### Fixed

- Nothing in the product. Three defects were found in the spike and are recorded rather than shipped:
  a block identifier cannot be a **required** attribute in the editor schema, so it takes a default
  and a plugin fills it; splitting a block **duplicates its identifier silently**; and the obvious fix
  for that renames the wrong block, breaking cross-references to stored content. The rule that works
  is descent rather than arrival, and one argument to the position mapping decides it.
- The accessibility finding worth reading twice: **axe reported zero violations against a table whose
  caption was not associated with it.** CNT-139 requires an automated suite in CI and a recorded
  manual audit, and the suite missed a real defect in the first thing that tested it. A screen reader
  pass with Narrator and NVDA followed and found nothing wrong - which is the point rather than a
  contradiction: the two halves catch different things. It is still narrower than CNT-139, which binds
  its audit to a release and to the product rather than to a throwaway surface.

## 0.15.3 - 2026-09-13 (PR #76)

### Added

- `docs/specification/spikes/Editor_Framework_Spike.md` - the brief for the one decision CNT-001
  names and no decision record makes. Twenty-two records, none of them chooses an editor, and
  ADR-0005 rests its whole argument on the stored model being the editor's model. Four gates: a
  document of 300 components in one scroll with per-component editability and component-scoped undo;
  overlapping annotations keeping one identifier each through ordinary editing; an authored table with
  merged cells, a cell-anchored footnote and an image in a cell, surviving a row insert; and the
  editor reachable from the keyboard alone and legible to assistive technology. Six further cases are
  measured rather than gating.

### Changed

- The spike runs **before** the content model becomes code rather than with the editor design. A
  migration fixture written at schema version 1 is permanent, because CNT-012 keeps every version ever
  written readable - so if the editor imposes a shape on the stored model, the cheap moment to find
  out is while there are no fixtures.
- The candidate order is argued from the corpus and is explicitly a premise rather than a finding:
  CNT-003 and CNT-007 rule out any editor whose range annotation is an element that must split at an
  overlap, and ADR-0005 describes a transform step log without naming one. Checking that narrowing
  against current versions is the spike's first task, not its assumption.

## 0.15.2 - 2026-09-13 (PR #75)

### Added

- `docs/design/content-model.md` - the first design document for tranche T1. It describes the
  canonical stored shape of a component: the root a version holds, seven block nodes, eight inline
  nodes, thirteen closed marks, required identifiers on every block and every mark, and one admission
  pipeline that everything entering the model goes through. It claims 81 requirements, which moves
  CNT from 112 undesigned in T1 to 46 and AST from 6 to 2.
- Decisions the document takes rather than inherits. **MathML is the canonical stored form of an
  equation**, with the LaTeX an author typed kept beside it as a non-authoritative input record -
  every consumer except a human reads MathML, and Word import arrives as OMML, which converts to
  MathML losslessly and to LaTeX badly. **Migration is a read-time projection, never a rewrite**,
  because versions are immutable and the content hash is the hash of what was written. **A figure
  alternative text is a three-state** - its own, inherited from the asset, or decorative - because an
  optional string makes empty mean both "nobody supplied it" and "deliberately none", which is how an
  inaccessible document passes its own check. And **a canonical serialisation**, which nothing
  previously stated and which the content hash needs to be sound.

### Changed

- `docs/design/word-output.md` now says MathML rather than LaTeX comes from the content model, which
  shortens its equation route by a step.
- Five gaps are named in prose beside the new document rather than papered over with a claim that
  reads well: component typed metadata, how CNT-001 is read while no editor framework is chosen,
  CNT-Q14, CNT-Q04, and the two things the document requires of STR. Twelve requirements are left
  deliberately unclaimed because the model answers one clause of them and the outline or the
  publisher answers the other.

## 0.15.1 - 2026-09-13 (PR #74)

### Added

- A component has a title of its own. CNT-142 gives every component a title distinct from the
  heading of whatever outline section places it, CNT-143 carries that title in versioned content so
  a version records what the component was called when it was cut, and CNT-144 closes the set of
  attributes every component carries whatever its type. The specification had asserted this from the
  beginning - `Project_Scope.md` calls a component "a small, typed, titled, independently revisable
  piece of content" - and none of the twenty-one requirement areas had written it down. The only
  title in the corpus belonged to an outline section, so a component would have taken its name from
  the heading above it: wrong the first time the component is reused under a different heading, and
  wrong immediately for search, which covers titles and had nothing to cover in a space with no
  documents in it yet.

### Changed

- **CNT-Q12 is half settled.** The structural half is answered by the three requirements above. The
  other half - a component is also _typed_, and a type declares the metadata its components carry -
  stays open, because it is a subsystem rather than a row and a component cannot take its type from
  a document it is reused into. The open question now records the split and says what would settle
  the rest.
- The corpus is 1,306 requirements, from 1,303. The counts in `CLAUDE.md`, the trace guide, the
  requirements index and the baselines guide move with it.

## 0.15.0 - 2026-09-13 (PR #70)

### Added

- `pnpm trace tranche <Tn>` reports a tranche by area, with a count per state, and
  `pnpm trace tranche <Tn> <XXX>` lists one area of it in full. This is the listing that designing a
  tranche starts from, and neither existing command gave it: `stats` reduces a tranche to one number
  per state, and `area` gives one area across every tranche at once. T1, for instance, is 322
  requirements across twelve areas, of which CNT holds 112 still unanswered by any design.
- The Verified column is omitted, with a line saying `pnpm trace verify` adds it, exactly as `stats`
  does. A column of zeroes would read as "nothing is verified" rather than "verification was not
  computed", and STY has verified requirements in T1, so printing 0 there would have been untrue.

### Changed

- `CLAUDE.md` now says how requirements, designs, implementation and the trace fit together, because
  it did not, and it is the only thing a new session reads. Four things were missing. The commands
  that query the corpus - `show`, `search`, `area`, `next` - appeared nowhere, so a new session had no
  way to know the 1,303 requirements in 21 documents are meant to be queried rather than read. The
  guide at `docs/guides/reading-the-trace.md` was not named. The chain from a requirement through a
  design and a test to a release's evidence was scattered across four sections and is now one table
  naming who writes each link. And the discipline that a design claims only what it answers in full,
  with a gap named in prose rather than papered over by repointing a claim, was recorded nowhere.
- `docs/guides/reading-the-trace.md` carries the new command in both of its command listings.

## 0.14.2 - 2026-09-13 (PR #69)

### Fixed

- `pnpm trace check` reports no problems in the requirement corpus. It had reported seven since the
  tooling could see them, and none of them was about a requirement the `0.13.0` release claims, which is
  why the gate stayed green while they stood.
- Six of the seven were the same shape: a cross-cutting review replaced a requirement with a broader
  one, and the design still claimed the requirement no longer in force while the one in force was
  claimed by nothing. Three of those designs now claim the replacement - `relationships.md` claims
  REL-052, `themes.md` claims STY-056 and STY-058 - because the replacement asks for what the design
  already answers, and in one case the design answers it more generally than the requirement it
  replaced did.
- The other three claims were **dropped rather than repointed**, and each design now says in prose why:
  REL-047 asks a relationship type to declare whether it is acyclic, whether it permits self-reference,
  and the permission required at each end, none of which `relationships.md` designs; SCH-050 names a
  freshness interval that `search.md`'s own open question still calls unchosen; and VER-044 asks for a
  check over a restored version's references that `storage-and-versioning.md` does not have, having
  answered a case VER-044 itself points out cannot arise. Moving those claims would have made four
  designs look complete where they are not, which is the failure this tooling exists to catch.
- The seventh was not a missing design. `apps/service/src/http.test.ts` used `IAM-018` as the sample
  rule in a fixture refusal, so a test asserting the shape of an error envelope read as coverage of a
  permission requirement. The fixture names `ZZZ-001` now, the area reserved for exactly this, which
  the citation scan ignores. The repository cites eighteen requirements rather than nineteen as a
  result, and the count is the honest one.
- `docs/specification/baselines/0.13.0.md` and `docs/trace/0.13.0/` are deliberately unchanged. A
  baseline declares what a release was answerable for and a pack is its evidence, both fixed to a tag;
  rewriting either so that today's corpus agrees with them would destroy the thing an audit is
  checking. `gaps.md` still records the seven problems, and `pnpm trace check` now reports none.

## 0.14.1 - 2026-09-13 (PR #66)

### Added

- A guide, `docs/guides/reading-the-trace.md`, on how to run the traceability tooling and how to read
  what it tells you. It has two reading paths, because it has two audiences with different questions: a
  developer needs the commands, the convention for citing a requirement from a test, and what makes the
  CI gate fail; somebody assessing this product needs to know which artifact answers which question,
  how to reproduce an evidence pack from the commit it names, and what the evidence does not prove. It
  ends by following one requirement, IAM-043, from its statement through the design that answers it and
  the three tests that demonstrate it to the row in the release's evidence pack.
- `docs/guides/` is a new folder, and `CLAUDE.md` says what belongs in it: a procedure written for
  somebody who has not followed it before, and the only place in `docs/` addressed to a reader outside
  the team. It may restate a fact once; what it must not become is the place that fact lives, because
  then two documents disagree and the guide is the one nobody updates.

### Fixed

- Writing the guide meant checking every claim in it against the tool, which found one wrong before
  anybody read it: the requirements mentioning footnotes span six areas, not four.

## 0.14.0 - 2026-09-13 (PR #65)

### Added

- A requirement can now be **filed as a GitHub issue**, through a form that asks for the area, the
  statement, why it matters, how somebody would know it is done, and a suggested tranche - never an
  identifier, because none is allocated yet. The form offers all 21 area codes, kept in step with the
  requirements index by a test.
- `pnpm trace draft` reads a filed issue, or the same information from flags with no issue and no
  `gh` required, allocates the next free identifier in that area, and prints a table row along with
  every section of the area document that already introduces a requirements table, as candidates for
  where it might go. It never inserts the row: a requirement added later belongs beside the ones it
  relates to, and that is a judgement about meaning that a tool would get wrong silently, because the
  corpus would still parse with a technically valid row filed in the wrong place. A person places the
  row, in the pull request that lands it.
- The requirements traceability design's four stages are now all built. Every requirement in the
  corpus is compiled from committed documents into one queryable, drift-checked model. Whether a
  requirement is actually covered by a test, and whether that test passed, is computed rather than
  remembered, and a baseline can now declare exactly which requirements a release is answerable for
  with a gate in CI that fails when that claim does not hold. A requirement can also now arrive from
  outside as a GitHub issue and be drafted into a row for a person to place, closing the loop from
  proposal to corpus.

### Fixed

- A requirement written across two paragraphs, as the issue form's textarea allows, produced a
  drafted row that vanished from the corpus with no error at all once pasted in - the row's second
  line broke the table, so the parser silently read zero requirements from it. The statement is now
  normalised to one line before it is drafted, so this cannot happen.
- A statement that quoted a markdown snippet containing a heading such as `### Area` could hijack that
  field, replacing the filer's real answer and truncating another one, with no error. Only a heading
  naming one of the form's own fields is recognised, one inside a fenced code block never is, and a
  genuine duplicate heading is now refused rather than silently picked.
- An uppercase `MUST` or `SHOULD` in a filed statement was refused, contradicting the wording on the
  filer's own screen. Both cases are now accepted when filing, alongside the lowercase form.
- An empty or blank suggested tranche no longer slips past the placeholder that would otherwise warn
  that a tranche still needs to be chosen.
- Drafting from the command line with `--area` and `--statement` now applies the same checks as
  drafting from a filed issue, instead of only warning about a problem the issue form would refuse
  outright.
- The requirement form pointed a bug report at a template that does not exist. It now points to a
  blank issue instead, and tells the filer what happens after they submit.

## 0.13.0 - 2026-09-13 (PR #64)

### Added

- A **baseline** now declares which requirements a release is actually answerable for: a hand-written
  document, committed alongside the release, naming what is in force and why, what is deliberately
  excluded and why, and how anything not proven by a passing test is verified instead. The first one,
  `0.13.0` (`docs/specification/baselines/0.13.0.md`), declares 7 requirements in force - the
  tenant-isolation and sign-in rules in the service, and the style-resolution and cross-format
  spacing rules in the theme model - and excludes 4 more by name, each with a stated reason.
- `pnpm trace gate` checks a release against its baseline, and is now the first check in CI that is
  not `continue-on-error`. That is safe rather than reckless: the baseline declares only what this
  release actually implements, so the gate passes on the day it lands. It fails outright when the
  test run it reads has failed, because it cannot verify anything from a broken run - so a red
  `pnpm test` now fails the build too, through the gate, even though the `Test` step itself keeps
  `continue-on-error`. Beyond that it says nothing about the other checks in CI - lint, format,
  typecheck and build keep the temporary flag they already had, until the whole switch-over described
  in `docs/ci-and-releases.md` happens together. The gate proves linkage between a requirement and a
  passing test; it does not audit whether a baseline's claims are true of the code, which is what
  caught the overstatement described below.
- The gate reports the corpus's other known problems - 7 of them, mostly a superseded requirement
  still claimed by a design whose replacement nobody claims - as informational rather than failing on
  them, because none names a requirement this release's baseline declares itself answerable for. A
  gate that failed on a problem outside its own declared scope would be checking the wrong thing.
- `pnpm trace pack` writes an **evidence pack** for a baseline that passes its own gate: the trace
  matrix, the gap report, the compiled requirement model and the raw test results, as a record of the
  exact run that produced them, for an auditor to read from a release tag without running anything.
  The first one is committed at `docs/trace/0.13.0/`.

### Fixed

- The first draft of the `0.13.0` baseline declared ten requirements, not seven. Auditing all ten
  against the code and its tests - rather than against the design documents describing what is being
  built - found that three of those claims were not true of the repository as it stands: it described
  licence-embedding fields, a publish report and editor preview behaviour that do not exist, and a
  mark catalogue covering eight character marks where the theme implements two. The baseline was cut
  to the seven requirements the code actually supports before it was committed. Recorded here rather
  than smoothed over, because the next person writing a baseline needs the warning it leaves: `docs/design/`
  describes what a subsystem is being built towards, not what is built, and a baseline that cites it
  instead of the source will overstate what a release delivers.
- `Verified` was computed from any citation at all, including a `rule:` field naming a requirement
  inside a test's body rather than its title - so a requirement cited only that way reached `Verified`
  the moment its test passed, even though no test result is ever identified by a `rule:` field's text.
  `IAM-018`, cited only this way, now correctly stays `Covered`. `Verified` is still 10 and the gate
  is still 7 of 7, because every requirement the baseline actually includes has a title citation.
- An attestation - the declared way to verify a requirement no test reaches - accepted any non-blank
  text at all, so a one-character `by` passed the gate cleanly. The parser now refuses a baseline
  document whose attestation does not name a person and a date in `YYYY-MM-DD` form, in at least 30
  characters, so the honest escape hatch stays as expensive to use as the design always said it
  should be. The gate applies the same bar to a baseline built programmatically rather than parsed
  from a document, since the gate decides CI and must not assume every caller went through the parser.
- The first evidence pack said "Generated at commit `c251471`", but that commit's own `matrix.md`
  held neither citation this branch had already made. It was packed while those edits were still
  uncommitted, so the commit it recorded was the wrong one - evidence that could never be reproduced
  from the tag it named, on the very first pack. `pnpm trace pack` now refuses to run on a dirty
  working tree, and names why.
- The `0.13.0` baseline's `STY-050` cell said CSS passes the resolved space-before value unchanged
  into padding, which is not what `css.ts` does - it adds a half-leading correction there and cancels
  it with a negative bottom margin, so the space a reader actually sees is still the sum `STY-050`
  requires. The cell now names that mechanism instead of the wrong one.

## 0.12.0 - 2026-09-13 (PR #63)

### Added

- A citation scanner reads every test file outside `packages/trace` for the requirement identifiers a
  test's `describe` or `it` title names, or a `rule:` field cites in a refusal payload. Fifteen
  citations across eleven requirements, found across 64 test files (62 `.test.ts` and 2 `.test.tsx`),
  now join the committed `trace.json` alongside what the requirement and design documents already
  said.
- Two rungs complete the ladder: `Covered` means a test names the requirement, and `Verified` means
  that test actually passed. Every `vitest.config.ts` now writes its own JSON test report to
  `.trace-results/` (ignored by git and Prettier, rebuilt by every `pnpm test`), and `pnpm trace
verify` reads them to compute `Verified`. Ten of the eleven currently-`Covered` requirements verify
  this way; the eleventh, IAM-018, is cited only by a `rule:` field with no matching test title, so it
  stays `Covered` rather than `Verified` - a result is identified by its test's name, a `rule:`
  assertion is not in the name, and that is deliberate rather than a bug: a weaker kind of evidence
  answering to the same word as `Verified` would be the dishonesty this design exists to prevent, and
  a named kind for it is stage 3's to define.
- `pnpm trace check` reports every problem in the corpus: a design claiming a requirement that no
  longer exists, or a citation naming a requirement no design claims. Run against the real corpus for
  the first time, it finds seven: six requirements claimed by a design after being superseded, in
  every case by a replacement that no design has claimed either (REL-002, REL-009, SCH-027, VER-034,
  STY-007, STY-036), and one requirement cited by a test but claimed by no design at all (IAM-018).
  Finding these is the tool doing its job, not a regression - fixing them is a separate, later
  conversation.
- `ZZZ` is now a reserved area code, alongside the twenty-one real ones: fixtures and examples use it
  for a requirement-shaped identifier that must never be mistaken for real coverage, and a test
  enforces that the corpus never allocates it.

### Changed

- `docs/architecture.md`, `docs/testing.md`, `docs/specification/requirements/README.md` and
  `CLAUDE.md` now describe the citation convention, `pnpm trace check` and `pnpm trace verify` -
  naming the requirement a test verifies in its `describe` or `it` title is load-bearing, not
  incidental, and somebody writing a test needs to know that.

### Fixed

- `pnpm trace stats` no longer prints a `Verified` count of zero for every tranche when verification
  was never computed. Only `pnpm trace verify` supplies that count, so `stats` and `show` now say
  plainly that verification was not computed instead of showing a column that reads as "nothing is
  verified" when the truth is "nobody asked yet".
- `pnpm trace verify` no longer trusts whatever happens to be sitting in `.trace-results/`. Nothing
  cleans that directory, so it could hold a report from a run that failed, a report far older than the
  others (a stale `tests/e2e` report, or a suite that never finished its last run), or be missing a
  report entirely for a package that has tests. `verify` now refuses to report a count in any of those
  cases, naming the report at fault, rather than quietly folding a bad report into the numbers.
- A requirement could previously be reported as `Verified` from a passing test result even when no
  test actually named it, because a passing result was checked before a citation was. `Verified` now
  requires both: a test that names the requirement, and that test having passed.

## 0.11.0 - 2026-09-13 (PR #61)

### Added

- `packages/trace` compiles the requirement corpus. 1,303 requirements across twenty-one areas, the
  112 non-requirements and the 131 open questions beside them, and every requirement a design claims,
  are parsed into one `trace.json` that is committed and checked against a fresh compile, in the same
  way `openapi.json` already is. A requirement now has a state computed from what cites it -
  `Specified`, `Designed`, or off the ladder entirely as `Withdrawn` or `Superseded` - rather than
  from a column somebody maintains.
- `pnpm trace` answers the question the corpus was too large to answer: `show CNT-014` for one
  requirement with its tranche, its state and the design that claims it; `search footnote` across
  every statement; `area VER` for a whole area; `next CNT` for the next free identifier; and `stats`
  for the shape of the whole.

### Changed

- The two repository-wide checks over the requirements move from `apps/desktop` into
  `packages/trace`, which is the workspace both files' own comments asked for once there were three or
  four of them. Nothing they asserted is lost: the identifier shapes, the tranche vocabulary and the
  status vocabulary are now refused by the parser at the document and line holding the offending row,
  which is a better failure than a test naming a value, and five tests that could no longer fail were
  deleted rather than left as decoration.

### Fixed

- `pnpm format` was failing on scratch files under `.superpowers/`, a git-ignored working area for
  in-flight implementation plans. Prettier reads its own ignore list rather than `.gitignore`, so that
  directory is now excluded there too.
- `turbo.json` gave the trace package's drift check no override, so a cached run could replay a
  passing log and print `FULL TURBO` without re-running the check, even after the requirement or
  design documents it reads had changed - a local run could look green while trusting a stale
  answer. The task now sets `cache: false`, like every other check that reads state outside its own
  directory.

## 0.10.16 - 2026-09-13 (PR #60)

### Added

- A design for requirements traceability, in
  `docs/superpowers/specs/2026-09-13-requirements-traceability-design.md`. The corpus is now 1,303
  requirements across twenty-one areas, and the chain an audit asks for - requirement to design to
  test to result - exists only for its first link. The design keeps markdown as the source of truth
  and adds a `packages/trace` workspace that compiles it: a real parser in place of the regular
  expressions currently embedded in two test files, a committed and drift-checked `trace.json` in the
  same spirit as `openapi.json`, a query and search command for finding the handful of requirements
  that govern a piece of work, and a four-state ladder - Specified, Designed, Covered, Verified -
  computed from what cites a requirement rather than from a column somebody maintains.
- The design also settles the three things that make such a matrix honest rather than decorative: a
  baseline, so that the 620 requirements deliberately deferred to later tranches read as deferred
  instead of missing; three verification kinds, so that the 361 constraints which no single test can
  cover are answered by inheritance or a named attestation rather than pretended over; and a plain
  statement that the matrix proves linkage and not correctness, so that nobody later mistakes it for
  a quality claim. Four staged pull requests are proposed, each useful alone.

- The implementation plan for the first of its four stages, in
  `docs/plans/2026-09-13-traceability-01-the-compiled-corpus.md`, and a Traceability section in the
  plans index to hold it. Seven tasks, fifty-two steps, test first throughout: the parsers, the state
  ladder, the committed index and its drift check, the query command, and the two requirement checks
  moved out of `apps/desktop` into the workspace their own comments had been asking for.

### Fixed

- Measuring the corpus to write the above turned up a requirement, `IAM-018`, that a test cites and
  no design claims. Recorded in the design document; the check that would have caught it arrives with
  the work.

## 0.10.15 - 2026-09-12 (PR #59)

### Changed

- The README, the documentation index and CONTRIBUTING now know that `docs/reviews/` exists: what it
  holds, that its documents are kept as they arrived, and where each review was answered. A folder
  nothing points at is a folder the next person does not find.
- `CLAUDE.md` carries the convention this session established for answering a review - amend the
  requirements rather than the review, supersede rather than edit, end the document with a change
  history that also records what was deliberately not changed, and check a cross-document claim
  before repeating it.
- The seven spike briefs and findings move into `docs/specification/spikes/`, so the scope and the
  requirements are what a reader meets first. Every reference to them across the decisions, designs,
  requirements, plans, the domain package and the spike code was rewritten, and three links that had
  been broken since they were written are fixed.
- The six tranches now say what they actually contain. The shape was right and the contents had
  fallen behind a year of requirements: T1 was described as an editor and a publisher while it also
  needs themes, templates, assets and tables, and the later tranches had each gained a capability
  nobody had written into the summary - revising a value by hand, component lifecycles, diverging
  revisions, interactive chat and external reference sources.

## 0.10.14 - 2026-09-12 (PR #58)

### Added

- Two market assessments in `docs/reviews/market/`: where the specification as written can sell, and
  which capabilities would extend its reach. They are input for a later decision rather than scope -
  nothing in them is written into the requirements, and the folder's README says which boundaries
  they would touch and which open questions they bear on.

### Changed

- `docs/reviews/market/` is excluded from formatting, so documents received from elsewhere stay
  exactly as they arrived.

## 0.10.13 - 2026-09-12 (PR #57)

The twenty-one areas read against each other, and the seams between them closed.

### Added

- A third reference mode - tracking a component's latest approved revision - in the documents that
  define references, which until now described two while lifecycle described three.
- What a baseline pins that a document also depends on: the bibliography entries, terms and
  vocabulary values it cites, and the template version it was created against.
- A rule that every requirement saying an action is audited must name the event it produces and be
  tested, and the event types nine areas were already producing without one.
- The operational layer several documents assumed and none owned: notification channels and their
  delivery guarantee, webhook subscriptions, scheduled work visible per tenant with its state and
  last failure, and one place a tenant can see everything that can leave its boundary.
- Backup and restore rehearsal, integrity re-verification, a register for every performance budget,
  support access as an administrative control, organisation administrators, and high-risk
  administrative acts named separately from `administer`.
- What happens to an open connection or an open shared publication when somebody signs out or a share
  is revoked, and what happens to an outline when two people reorder it at once.

### Changed

- Tenant isolation states the rule behind its list, so every derived copy - index, embedding,
  derivative, export, notification, webhook payload, backup - is covered rather than only the six
  named stores.
- Accepting an AI-proposed edit obeys the lock and the version precondition like any other edit, and
  where-used distinguishes live references from pins a change can never reach.
- Image-style resolution now has one owner: CNT-091 to CNT-093 are superseded by their STY
  equivalents, settling CNT-Q15.
- Nine stale citations to superseded requirements corrected, and every area's status line now reads
  reviewed.

## 0.10.12 - 2026-09-12 (PR #56)

Templates and versioning, answered against their first reviews - and with them, all twenty-one
capability areas.

### Added

- What immutability actually promises: a version records a digest anybody holding the content can
  recompute, so tampering is detectable rather than only forbidden, and a baseline records one over
  everything it pins.
- What happens to a version chain when the thing it belonged to is deleted, whether a baseline can be
  superseded, who may read a history or export a redline, and how long old publishing engines must
  stay runnable.
- Where a template writes down what each parameter feeds - which metadata field, which variable,
  which query argument - without which a template could satisfy every other requirement and do
  nothing.
- Required components that cannot quietly leave a document, invalid parameter values refused by name
  through the API, and a record of who created a document and when.

### Changed

- A document is validated against the template definitions as they were when it was created, so
  tightening a schema no longer makes every existing document fail at its next publish.
- Restore refuses for the reason it actually can - content pointing at something since deleted -
  rather than a case that cannot arise, and comparison across a template change says which two things
  are being compared.

## 0.10.11 - 2026-09-12 (PR #55)

Styles and tables, answered against their first reviews.

### Added

- What an admonition style contains, which the styles document required a catalogue of and never
  described - so a warning that must not look like a note now has somewhere to say so.
- A draft keeps the appearance of the theme version it is bound to, and what a new theme version
  would change is listable before anybody adopts it.
- How a character style composes over a paragraph style, stated once and resolved once rather than
  recomputed by each output format.
- A contrast minimum for a theme's own text and paper, checked when the theme is saved, because a
  published PDF has nothing left that can adjust it.
- Tables: what carries each declaration and that it addresses a column by key rather than position,
  what wins when a style and a column both declare formatting, a closed set of aggregations, caption
  association and repeated headers for assistive technology, and group headings that stay with their
  groups across a page break.

### Changed

- Style inheritance is a `must` rather than a `should`, and the editor renders every declared
  property rather than a sample of them.
- Unit conversion belongs to the query, which the tables document referred to and never granted; the
  locale a table formats for is the one the document publishes in; and a named error carries a stable
  identifier, not only a human message.

## 0.10.10 - 2026-09-12 (PR #54)

Reuse, search and structure, answered against their first reviews.

### Added

- Which document a variable resolves against when a component is reused: the referring one, the same
  rule its conditions already followed - so a component in two reports picks up each report's
  parameters.
- A cohort that cannot drift under its own generation: floating references resolve once at the start
  of a run, so forty documents built over an hour are one document forty times over.
- What a reader sees when a reference points at something deleted or something they may not read,
  cycles refused when they are created, and a bound on how much one reference can pull in.
- Search gets a budget for embedding a query, thread indexing semantics, a defined answer to an empty
  or malformed query, completion and correction, a tie-break that makes paging honest, and structural
  counts filtered exactly as text results are.
- Structure gets one constraint for the order everything else assumed, numbering reproducible from a
  baseline's pinned inputs so a cited section number survives, an implicit root, and a rule for a
  page reference in a format with no pages.

### Changed

- Excluded conditional content now carries its own enforcement: every publication is scanned, text
  and metadata, for content that should not be in it.
- A cycle check names the graph it walks, a deep link that has dangled lands somewhere with an
  explanation, and the indexing interval has a provisional number like every other budget.

## 0.10.9 - 2026-09-12 (PR #53)

A language tag with a shape, and the publishing and relationship requirements answered against their
first reviews.

### Added

- What typography fidelity means operationally: the lines a composition decided are the lines a
  renderer draws, hyphenation follows the language of the passage, and a typeface substituted for a
  licence is composed against rather than swapped in under finished pages.
- Publishing fails wherever the resolved document cannot be faithfully rendered - content that
  cannot flow at all, which the old failure list did not cover because it enumerated instead of
  ruling.
- What a publication is: one baseline, one act, a declared set of formats, and the PDF included
  wherever anything cites a page.
- Determinism that is checked rather than stated: pipeline and library changes tested against
  recorded output, incremental and clean compilation held to the same bytes, and reproduction
  verifying what was pinned.
- What happens to retained publications when a tenant closes, and a preview that says it is untagged
  to assistive technology as well as on screen.

### Changed

- A language tag is a BCP 47 tag with a region wherever the region changes the content, in the
  document that owns it - CNT-083 recorded a language and left its shape open, which nothing that
  formats a date or holds a Brazilian variant can build against.
- Generated matter describing the resolved document is a constraint rather than a T4 item, and Word
  reports anything it cannot carry faithfully rather than being exempt because it is first-class.
- Relationships can be changed rather than only created and removed, and a change is audited like the
  rest - an edit would otherwise have escaped the record by being neither. Creating or removing one
  now requires standing at both ends, which the read side had and the write side did not.
- A relationship type can be deprecated and renamed, so a misnamed one is not permanent merely
  because it is in use; cardinality means something specific; a type can declare itself acyclic, so a
  cycle is refused when it is created rather than stepped around at every traversal; and an impact
  report follows the same job contract as any other long-running work.

## 0.10.8 - 2026-09-12 (PR #51)

The localisation requirements, answered against their first review.

### Added

- What happens when a source document is edited while a translation vendor has it, and the
  translation comes back against a version that has moved: the product notices, reports, and a person
  chooses - it never applies it silently.
- The set of translation statuses a variant can carry, who decides whether a source change needs
  retranslation (the person making it, defaulting to yes), and the previous translation offered as
  the starting point for a retranslation.
- Whether a bound value gets translated, which had been a constraint and an open question
  contradicting each other: the binding stays inert and the value is translated at resolution against
  a declared lookup, or renders as the source gave it and is reported as untranslated.
- A declared list of supported languages, locale data from a named versioned source, pseudolocalisation
  as a test mode, and language tags that can tell Brazilian Portuguese from European.

### Changed

- Interface strings may be assembled by a locale-aware message format, which the old wording had
  forbidden along with the thing it meant to forbid - application code doing grammar.
- Dates, numbers and currency follow the reader in the interface and the published language in the
  document, because a published document has one locale and its reader may have another.
- Layout tolerance is a number that can fail rather than "substantially longer", and a missing
  variant falls back by a policy declared for the document, with anything left in the source language
  marked in the output.

## 0.10.7 - 2026-09-12 (PR #50)

Components that can be approved on their own, revisions effective in more than one place, and the
lifecycle requirements answered against their first review.

### Added

- Components have lifecycles of their own, which customers were unambiguous about: a component is
  approvable on its own, stays approved while the report around it is still being polished, and a
  document can reference a component at its latest approved revision - a third choice beside pinned
  and floating, because one is frozen and the other picks up drafts. Approving a component does not
  stop it being improved for the next report.
- Branch and merge as a regulated fact: more than one revision effective at once, each in a declared
  scope, so a procedure can be at revision 4 in one plant and revision 3 in another, and centrally
  approved labelling can wait for an affiliate to accept it. Convergence says what was left behind
  and is never a silent overwrite.
- What happens when an approver says no: rejection recorded with its reason, a rework path declared
  in the workflow rather than improvised, and an audit event of its own.
- An audit export a recipient can verify without trusting the exporter, holds and archival and
  deletion named in the event list rather than inferred, and every recorded time an absolute instant.

### Changed

- Where state lives is now stated: state belongs to the artifact, a revision is an immutable
  designation, and reworking an approved artifact leaves that revision effective until the next gate.
- A publication is named as PUB's artifact rather than audited as something this area never defined,
  and every version of a workflow definition survives as long as anything references it.

## 0.10.6 - 2026-09-12 (PR #49)

Citing the literature from inside the document, and the reference libraries answered against their
first review.

### Added

- External reference sources: search PubMed, Crossref and their like from inside the editor and
  insert a citation from a result, with the entry copied local at that moment so publishing never
  depends on reaching a network. The product confirms a cited source still says what it said,
  surfaces a retraction wherever the entry is used, and can refuse to issue a document that cites a
  retracted one. Searching is available to the assistant as a tool, and the product mirrors no
  registry.
- What a record's identity means when a glossary is shared between spaces, duplicate detection when
  somebody keys an entry in by hand, and the canonical identifiers - DOI, PubMed identifier, ISBN -
  that detection uses.
- A term's status values, what a missing translation falls back to, a thesaurus that cannot acquire
  a cycle, vocabulary values that can carry a description, be ordered deterministically and be
  deprecated before they are retired.
- A deprecated term or value flagged when somebody inserts one, not only where it is already used.

### Changed

- A change to a record reaches unpinned references at the next publish and no baseline ever, and
  records that changed since a document last published are listable for it.
- Creating, changing, deprecating and retiring a record is audited, rather than left to be inferred
  from whether a library record counts as content.

## 0.10.5 - 2026-09-12 (PR #48)

The import and export requirements, answered against their first review.

### Added

- What happens when a source document is imported again next quarter: an import records what it came
  from, a second one recognises it, shows what has changed and offers to apply it to the components
  that came from it. Nothing owned this before.
- A proposal that can be checked at size: each proposed component reviewable without reading the
  whole source document, the proposal navigable and resumable, and how much of it a person accepted
  unchanged recorded so proposal quality is a number rather than an argument.
- What happens to a reference whose target was never in the file - listed before acceptance, then
  retargeted, converted to plain text and named in the report, or the import refused - and what
  happens when an import dies half way.
- What a space-level export contains when it references something outside itself, and an export
  artifact that is tenant-scoped, expirable and audited on download.

### Changed

- The product's own export format is importable, so an export is a route back in as well as a
  guarantee against lock-in - the attended rule exists for a split judgement that components do not
  need.
- The export read-back test uses a reader written against the documented format rather than the
  product's own importer, because those prove different things.
- Acceptance validates what a person's adjustments produced, not only what the importer proposed;
  identities are shown during review and the tenant's policy applied once, at acceptance; and the two
  questions about scale now name the measurement that settles them and when.

## 0.10.4 - 2026-09-12 (PR #47)

The generative AI and identity requirements, answered against their first reviews.

### Added

- Interactive chat with a model: a user may put their own prompt to it, choose between the endpoints
  an administrator has configured, shape what is retrieved, create and update components through
  tool use, and keep a personal prompt library only they can see. An open prompt is governed exactly
  as a declared one is, and what gets refused is what guardrails forbid rather than what is
  off-topic.
- A prompt's context can be built from a combination of components - by outline position, by
  relationship, by metadata, by the document's parameters - resolved to an enumerable set before the
  model is called and recorded as what it resolved to.
- A terminal state for generated content nobody wants: discarding is deliberate and recorded, the
  record of what was proposed survives it, and a discarded draft no longer blocks publishing for
  ever. With it: context overflow refused rather than silently truncated, embedding costed like any
  other model call, and one context digest instead of two that could differ.
- How the first administrator of a new tenant comes to exist: an invitation to a named address,
  authenticated the way everybody else authenticates, audited into that tenant's own log, and no
  standing vendor access afterwards.
- What happens when a customer's identity provider is unavailable, how quickly a group membership
  change takes effect, and a guest capability cap that now overrides any role that would breach it.

### Changed

- Tenant isolation names the decisions that enforce it - a schema per tenant, and a database role
  assumed for one transaction - which were taken before the requirement was written and never cited.
- Every permission is held through a role, a permission decision and the action it authorises are
  one unit, and the terms this product uses normatively are defined or cross-referenced rather than
  assumed.

## 0.10.3 - 2026-09-12 (PR #46)

The assets requirements, answered against their first review.

### Added

- What an asset version covers, and what happens to a superseded one: alt text, source and licence
  each carry their own history, a licence change is surfaced wherever the asset is used rather than
  reaching a floating reference invisibly, and superseded versions are kept with the relationships
  between them so an inspection can still ask which picture a report used.
- The quarantined state an upload was already in while it waited to be scanned, with a declared
  timeout and the uploader told either way.
- Validation of what a file expands to rather than only what it arrives as, and a content hash
  recorded at ingest as the identity everything else uses.
- An unknown licence now means internal use only rather than sailing through, attribution is
  recordable as something a licence requires, and converting a format is treated as the modification
  a licence says it is.
- Derivatives may be discarded and rebuilt, replacing an original invalidates them, alt text carries
  its language, and assets nothing references are listable.

### Changed

- The Tranche column's two kinds of value are explained where a reader of one document will see
  them, the dependency table names the areas it was already citing, and `duration` no longer commits
  a T1 implementation to formats the platform may never admit.

## 0.10.2 - 2026-09-12 (PR #45)

### Changed

- The settings for running the service or the worker from source now live in `deploy/` with
  everything else you need to run the system, as `service.env.example` and `worker.env.example`
  rather than a hidden file inside each app. Copy one to `service.env` or `worker.env` beside it;
  the copies stay out of git, and the containers still read none of them.

## 0.10.1 - 2026-09-12 (PR #44)

### Changed

- Everything the system is deployed by now lives in one folder, `deploy/`, with a README of its own
  covering what each container is for, every address, the configuration, and what is not there yet.
  Commands that run the stack name it: `docker compose -f deploy/compose.yaml ...`.
- The README now says what the product is for and the order it gets built in, drawn from the scope.

## 0.10.0 - 2026-09-12 (PR #43)

The first thing you can do.

### Added

- Open an environment in a browser and it shows itself: sign in, ask for a sample document, and
  watch it arrive without asking again.
- The desktop app opens the same environment as the browser does, and signs in the same way.
- Every change is now checked against the whole system running in containers, not only its parts.

## 0.9.1 - 2026-09-12 (PR #42)

The plan for the last of the scaffolding.

### Added

- The plan for the renderer showing an environment, the desktop app opening the same one as a
  browser does, and every change being checked against the whole system running.

## 0.9.0 - 2026-09-12 (PR #41)

Watching an environment as it works.

### Added

- A signed-in person can watch their environment: they are told what is there when they connect, and
  then hear when a document they asked for is ready, without asking again.
- One way for anything to call the service, generated from the published description of it, so a
  client and the service cannot drift apart unnoticed.

## 0.8.2 - 2026-09-12 (PR #39)

Five specification areas, answered against their first review.

### Added

- `docs/reviews/`, holding the reviews of the specification documents verbatim, with an index saying
  which document each one reviews and where it was answered. They are inputs, not decisions: what
  was done about a review lives in the document it reviewed, in a change history.
- Content and authoring: hyperlinks, which the inline vocabulary did not have, with a scheme
  allowlist and sanitisation of pasted HTML; copying within the product, where every pasted block
  gets a new identifier; suggestions and comments announced to assistive technology; redlines
  distinguishable without colour; a minimum shape for a component.
- Collaboration and review: accepting a suggestion is an edit and needs the lock, what happens to
  the loser of a claim race and to work under a lock that is taken, two idle periods rather than
  one, review history nobody can delete, suggestions made stale by another being accepted, and what
  a date means to a reviewer in another country.
- API and extensibility: a version precondition and no unconditional overwrite, the component lock
  holding at the API as it does in the interface, jobs for work that outlives a request, stable
  event identifiers and stated ordering for webhooks, a request identifier on every response, and
  what happens when an extension is updated or removed.
- Data connectivity: a value can be revised by hand, and a revised value is a person's value that
  says so everywhere it appears, keeps what the query returned, stays refreshable with an
  accept-or-reject when the source moves, and is surfaced for review before a document is issued.
  With it: connection deletion refused rather than cascaded, key-based row selection for inline
  bindings, an empty result told apart from a failure, a floating binding flagged when its query
  definition advances, and a limit on how much may run at once.
- Administration: the life of a tenant after bootstrapping - suspension, an export offered before
  closure, a reversible grace period - a tenant administrator's sight of their own audit trail, a
  floor under self-service diagnostics, where a budget alert is delivered, what a configuration
  export carries in place of a secret, and what consumes a secret before it is rotated.

### Changed

- Eight bundled or imprecise requirements split or sharpened, each superseded rather than edited:
  lists, image styles, footnote content, the admonition vocabulary, the preview budget, cost trends,
  silent failures, and where rate limits are declared.
- The preview budget now names a reference configuration, so it can be confirmed or refuted.
- Sections reorganised for navigability, and each of the five documents ends with a change history
  recording every change against the review point that prompted it.

## 0.8.1 - 2026-09-12 (PR #40)

The plan for live updates.

### Added

- The plan for watching an environment as it works: one live stream per environment, told what is
  there on connecting and then what happens, and one generated way for anything to call the service.

## 0.8.0 - 2026-09-12 (PR #37)

The whole system, from one command.

### Added

- `docker compose up` now brings up everything: the database, the object store, a sign-in provider
  for development, the service and a worker, prepared and ready to sign in to.
- Images for the service and the worker, built on every change so that a broken one is caught where
  it was broken.

### Fixed

- Preparing several environments at the same time no longer gives up too early when they collide.

## 0.7.1 - 2026-09-12 (PR #36)

The plan for the whole system in one command.

### Added

- The plan for images for the service and the worker, and a compose file that brings the whole
  system up prepared and ready to sign in to.

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
- `docs/specification/spikes/Publishing_Engine_Spike.md`, the brief that chooses between the open engines
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
- `docs/specification/spikes/Content_Model_Spike.md`, the brief that validates that decision before
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
