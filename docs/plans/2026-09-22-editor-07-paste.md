# Editor 7: Copy and paste

> **A sketch, by request**, built inline and test first, as editor 5 was. It wires the admission
> pipeline content model 2 built ([content-model.md](../design/content-model.md), "The admission
> boundary") into the editor, and adds the readers that pipeline was built to take.

**Goal:** an author pastes into a component from a web page, from Word or Google Docs, from plain
text, or from another component, and keeps its structure: paragraphs, the three kinds of list,
quotations, preformatted text, and the nine marks. What could not be kept is said, at the time, in a
**paste report** beside the surface (CNT-063). Copy and cut write the product's own format beside
HTML and plain text, so a copy between components loses nothing the editor holds.

**Requirements:** cites **CNT-063** (the report, shown at the time) and **CNT-130** (pasted HTML
sanitised before it reaches the model, through the one pipeline). **CNT-060** and **CNT-062** stay
uncited: both ask for tables and footnotes to survive, and the editor holds neither yet. **CNT-061**
stays uncited: see ruling A.

## Rulings

- **A. Three sources: the product's own clipboard, HTML, and plain text.** HTML covers a web page,
  Word and Google Docs, which all put HTML on the clipboard. Markdown is deferred: a clipboard never
  says that it holds Markdown, so it arrives as plain text, and reading every plain paste as Markdown
  would turn an author's asterisks into emphasis they did not ask for. It belongs to an explicit
  **Paste as Markdown** command or to import.
- **B. The readers live in a new workspace, `packages/readers`**, as content-model.md says: an HTML
  reader needs a parser, which `packages/domain` exists to exclude. Platform-free, so import can use
  it on the server later. The parser is **parse5 8.0.1**, pinned: it parses as a browser does, and it
  is already in the lock file through jsdom. Moving the OOXML reader and writer out of the domain
  package stays with import (IMP), which is the first thing to call them.
- **C. Which type is read.** The product's type, `application/vnd.alloy-works.content+json`, then
  `text/html`, then `text/plain`. **In preformatted text only `text/plain` is read**, and it lands in
  the block exactly, line breaks and tabs included: code pasted into code keeps every character.
- **D. What the HTML reader makes of each element:**

  | HTML                                                                                                                                                    | Becomes                                                                      |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
  | `p`, `div`, and text standing between blocks                                                                                                            | a paragraph                                                                  |
  | `h1` to `h6`                                                                                                                                            | a paragraph, reported: a component's headings are its document's sections    |
  | `ul`, `ol` (with `start`), `li`, nested                                                                                                                 | a bulleted or numbered list, nested                                          |
  | `dl`, `dt`, `dd`                                                                                                                                        | a definition list, the term from `dt`                                        |
  | Word's list paragraphs (`mso-list: lN levelM`)                                                                                                          | a list, nested by level, numbered or bulleted by its marker                  |
  | `blockquote`                                                                                                                                            | a quotation                                                                  |
  | `pre`                                                                                                                                                   | preformatted text, its label from a `language-` or `lang-` class             |
  | `b`, `strong`, `i`, `em`, `u`, `sub`, `sup`, `code`, `q`                                                                                                | the matching mark                                                            |
  | `span` styled bold, italic, underlined, raised, lowered                                                                                                 | the matching mark; `font-weight: normal` undoes a `b` (Google Docs)          |
  | `a href`                                                                                                                                                | a link, whose target the pipeline checks                                     |
  | `br`                                                                                                                                                    | a new paragraph: a component has no line break                               |
  | `table`                                                                                                                                                 | its text, a paragraph per cell, reported                                     |
  | `img`, `math`, `hr`                                                                                                                                     | left out, reported                                                           |
  | `script`, `iframe`, `object`, `embed`, `video`, `audio`, `svg`, `on*` attributes, `font-family`, `font-size`, `color`, `background-color`, `text-align` | handed to the pipeline in its own vocabulary, which removes and reports them |
  | the `head`, comments, and any other element                                                                                                             | the head and comments are not content; any other element is its children     |

- **E. The HTML reader reads no `lang` attribute.** Word marks every span with the language of the
  keyboard it was typed on, so reading them would put a language mark on most Word pastes. The
  component's base language stands.
- **F. Text is cleaned by the reader and the cleaning is reported.** HTML whitespace collapses as a
  browser collapses it; `\r\n` becomes `\n`; a control character other than tab and line feed is
  removed and counted; a tab in a paragraph becomes a space. Plain text makes a paragraph of each line
  and skips blank lines, as ProseMirror's own plain paste does.
- **G. A paste lands as ProseMirror's own does.** The admitted blocks become one slice, open as far
  as its first and last text blocks go (`Slice.maxOpen`), and replace the selection: pasted text in
  the middle of a paragraph joins it. One transaction, so one undo takes it back. Every pasted block
  and mark has a new identifier before ProseMirror sees it, from the pipeline (CNT-132), and the
  receiving paragraph keeps its own by the descent rule.
- **H. Copy and cut write three types**: the product's, HTML from ProseMirror's own serialiser, and
  plain text. A selection whose slice does not make a valid document writes only the last two. Copy
  works while a component is being read; cut and paste only while it is being edited.
- **I. The report.** After a paste the status bar says **Pasted.**, or **Pasted. Some of it was
  changed or left out: the paste report says what.** when there is anything to say. The **Paste
  report** is a region above the surface, in the `F6` ring while it is shown, listing each entry's
  message, how many times it happened and what arrived (as text, never markup), with a **Close**
  button; the next paste replaces it, and it is shown only while the surface takes changes.
  **New identifiers are not listed**: the author cannot see or act on them, and they would fill every
  report. A refused paste inserts nothing, and the status bar says why, in the report's own last sentence.
- **J. Dropping content is still refused**, now in its own words: **Dragging content in is not
  available yet. Copy and paste it instead.** A drag within the surface moves text, which needs the
  same path as a paste plus deleting the source, and is a slice of its own.
- **K. New report subjects**, each a fixed sentence: a heading kept as a paragraph, a table kept as
  its text, an image and an equation left out ("cannot be pasted yet"), a horizontal line left out,
  and control characters removed.

## Tasks

1. **`packages/domain`**: the report's new subjects (ruling K); `createReport` exported beside
   `readerEntry`, so a reader outside the package builds entries with the fixed sentences; the
   surface pin updated.
2. **`packages/readers`** (new): `readPlainText(text, into: 'blocks' | 'preformatted')` and
   `readHtml(html)`, each answering the domain's `ReaderResult`. Tests assert the report as well as
   the output (CNT-064), and run each reader's output through `admit`: a script, a handler, an
   embedded object and a `javascript:` link never reach the admitted content (**CNT-130**). Word's
   list paragraphs and Google Docs' `font-weight: normal` wrapper are fixtures, invented text only.
3. **`packages/editor`**, `clipboard.ts`: `readClipboard(source, into)` choosing the type (ruling C),
   `pasteTransaction(state, reading, newIdentifier)` running `admit` against the component as it
   stands and answering a transaction or a refusal with the report, and `clipboardFor(state, slice)`
   answering the three types (ruling H). `mountEditor` handles `paste`, `copy` and `cut` itself and
   takes `pasted(outcome)`; `refused` is now for a drop alone.
4. **`apps/web`**: `PasteReport` and its region in the ring (ruling I); `ComponentEditor` says the
   paste in the status bar; the two tests that pinned **Pasting is not available yet** now paste, and
   **CNT-063** is cited by the test that shows the report.
5. The Dockerfile copies the new manifest; `docs/architecture.md` gains the readers workspace and the
   clipboard's type; `docs/features.md` and the README; the plans index; the version (Minor) and the
   changelog.

## Found while building

- **Word draws its second-level bullet as the letter `o`**, in Courier New. Read as a letter it made
  every nested bulleted list from Word an alphabetic one starting at 15. A marker is numbering only
  when it ends in `.` or `)`, which every numbered marker Word writes does.
- **A slice is rooted at the deepest node its two ends share**, so a few words of one paragraph copy
  as bare text, which is no document. `productClipboard` takes the two positions and wraps the range
  in the blocks it stands in, so the words arrive as the paragraph they came from and join the text
  they are pasted into.
- **The text after the caret keeps the receiving paragraph's identifier until the identity plugin
  renames it**, as it renames a split's second half: ProseMirror closes an open slice with the node it
  cut. Every identifier stays unique, and the receiving paragraph keeps its own.
- **The session's notice replaced the paste's sentence** (issue #196). The session publishes its
  notice with every change of state, so a paste that was the first change was followed by **You are
  editing this component.**, and so was any sentence the page said while editing - a refused header
  field, a refused drop - at the next save. A session notice now reaches the status bar only when it
  changes, and a paste made while the lock is being claimed is said after the claim's sentence.
- **The HTML parser drops a NUL in text itself**, before any reader sees it, so the reader's count of
  control characters never includes one.
