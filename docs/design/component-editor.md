# The component editor and its editing session

Editing one component, end to end: the surface an author types into, the lock that makes them the one
editing it, continuous saving, cutting a version, and the component's type and metadata alongside its
content.

This is the first slice of the editor. It rests on [ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md)
(ProseMirror, one view per component), [content-model.md](content-model.md) (what is stored, and the
admission pipeline everything entering it passes through), [storage-and-versioning.md](storage-and-versioning.md)
and [ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md) (iterations, versions and
the digest), [metadata.md](metadata.md) (which fields apply and what is valid), [themes.md](themes.md)
(how it looks, resolved once for the editor and the publisher alike), [realtime.md](realtime.md) (how
others learn of the lock) and [service-foundations.md](service-foundations.md) (how every route is
written). **The document view** - many components in one scroll, the read, review and author modes,
headings, choosing which version a reference points at, and preview - is the next slice, designed once
the outline (STR) and the publishing pipeline are.

> **Part of this is built.** Opening a component, editing its paragraphs, the lock,
> iterations under the sequence rules, Save version and Done editing, the save indicator, and the six
> routes below are in `packages/editor`, `packages/db`, `apps/service` and `apps/web`;
> [`../architecture.md`](../architecture.md) describes them as they stand, and
> [the plan that built them](../plans/2026-09-16-editor-01-open-edit-and-save.md) changed this document
> where planning the build found it wrong or unfinished - see
> [Changed while planning the build](#changed-while-planning-the-build). Creating a component is built
> too, and so are **ten of the thirteen marks**: strong, emphasis, underline, subscript, superscript,
> inline code and a quoted phrase from the **Formatting** toolbar or the keyboard, a hyperlink and a
> language mark through a prompt, and a defined term in the schema with no control yet, by
> [the marks plan](../plans/2026-09-20-editor-03-marks-and-links.md). **Lists are built too** - bulleted,
> numbered and definition, from the toolbar, the keyboard or Tab and Shift-Tab, nesting to any depth
> the content model admits, with a **List** panel carrying a numbered list's start and numbering, by
> [the lists plan](../plans/2026-09-21-editor-04-lists-and-quotations.md), which also carried them into
> the PDF. **Block quotations and preformatted text are built too** - a quotation with its
> attribution, and preformatted text with its whitespace kept exactly and a **Preformatted text**
> panel for its language label, in the `F6` ring while the cursor is in one - by
> [editor 5](../plans/2026-09-21-editor-05-quotations-and-preformatted-text.md). What is still design
> here: tables, footnotes, equations and figures, paste,
> the metadata panel, undo across a reload, Recovery, lock events on the stream, the desktop's checker
> languages, and the accessibility suite.

## The shape in one paragraph

The renderer holds the editor state. A component opens read-only; the first change an author makes -
to the content or to a metadata value - claims the component's **lock**, and changes are held rather
than lost while the claim is answered. Every change after that is sent, after a short pause, as an
**iteration** - a whole snapshot of the content and the metadata values, carrying the lock and a
sequence number the service only ever accepts in increasing order - and the author is told plainly
whether it arrived. The session's steps and latest values are kept in the browser's session storage, so
undo survives a reload. A **version** is cut only by a positive act: **Save version**, or **Done
editing**, which also releases the lock, and neither goes ahead while changes are unsaved. A lock that
times out cuts nothing, and its iterations wait to be recovered. Beside the content, the component's
type decides its fields; validation runs as values change, and a definition that changes mid-session is
noticed and explained rather than discovered at a refusal.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CNT-066** | After a pause in changes the renderer sends the whole content and values as an iteration; there is no save action for drafts                                                                                             |
| **CNT-067** | The renderer reports a change saved only when its iteration is acknowledged, so reopening after any interruption offers that iteration or a later one                                                                    |
| **CNT-068** | A save indicator with three states - saved, saving, not saved and retrying - with the time of the last acknowledged save; the change to not saved is announced                                                           |
| **CNT-069** | One `prosemirror-history` per component; the session's steps are kept in `sessionStorage` and replayed into a fresh history on reload, back to the version the session opened from                                       |
| **CNT-103** | Cutting a version clears the history and the stored steps, and a reload that finds steps recorded against an older version discards them, so undo never reaches past a version                                           |
| **CNT-070** | A version is cut by **Save version** or **Done editing** and by nothing else - not a keystroke, a timer, a lost connection or a timeout                                                                                  |
| **CNT-089** | The session never promotes an iteration on its own; iterations are rows the storage design keeps immutable and visible only to the lock holder (VER-001 to VER-003)                                                      |
| **CNT-090** | A **Recovery** panel lists the component's retained iterations to its lock holder, newest first, and restores one - content and values together - after saving the current state as an iteration                         |
| **CNT-071** | Every write in the session - iteration, version, release - carries the lock, and nothing here assumes the author is the only one who could write                                                                         |
| **COL-005** | The lock is claimed by the first change an author makes, to content or metadata, not by a separate act; changes wait for the claim rather than being refused                                                             |
| **COL-006** | The lock gates writes to the component and nothing else: reading it, and later commenting and suggesting, never ask for it                                                                                               |
| **COL-008** | A lock expires after a period without saved changes - provisionally fifteen minutes - which is a tenant setting; each acknowledged iteration extends it                                                                  |
| **COL-010** | **Done editing** releases the lock and cuts a version of what changed; a lock expiring cuts nothing                                                                                                                      |
| **COL-011** | The lock is a row per component; nothing locks a document                                                                                                                                                                |
| **API-039** | The service checks the lock on every mutating component request and refuses one from anybody but the holder with `lock.held`, naming the holder and the expected release                                                 |
| **MET-011** | Creating a component requires a component type, offered with the tenant's default preselected; the version row's type column is not nullable, and no iteration or version changes it                                     |
| **CNT-149** | "Creating a component" takes a title, a base language and a base direction, in a space the author chose from those `GET /v1/spaces` says they may create in; the component exists at `0.1` from the moment it is created |
| **MET-033** | A fixed field is read-only in the panel, naming the schema that fixes it, and the service refuses an iteration or a cut whose value for it differs from the default, naming field and schema                             |
| **CNT-057** | An insertion palette of mathematical, Greek, and scientific and technical symbols, as a keyboard-navigable grid that inserts characters                                                                                  |
| **CNT-077** | Every command is in a keymap and in the toolbar; the toolbar is a single tab stop with arrow-key movement, and `F6` moves between the regions of the view                                                                |
| **CNT-048** | An equation's alternative is generated from its MathML wherever a generator is available - on entry, and on load for any equation that lacks one - stored as `alttext`, and always editable                              |
| **CNT-080** | Equations render as native MathML carrying `alttext`, which assistive technology reads; an equation is reachable and opened by keyboard                                                                                  |
| **CNT-098** | The surface sets `spellcheck`, so the delivery's own checker marks spelling as the author types                                                                                                                          |
| **CNT-147** | A run carrying a language mark whose language differs from the component's base language is rendered with `spellcheck="false"`, so a passage in another language is never flagged                                        |
| **CNT-148** | The web delivery uses the browser's checker; the desktop shell enables the base languages of the components open, through one platform bridge call, so neither lacks a checker                                           |
| **CNT-152** | A language tag the content model takes and a publication cannot carry is named back to the author, in the dialog they typed it in, before the mark is applied; **OK anyway** then applies it                             |

**What CNT-147's test shows, and what it does not.** The test asserts the attribute the product sets:
a run whose language mark differs from the component's base language is rendered with
`spellcheck="false"`, and a run marked with the base language is not. It never shows a checker obeying
it, because no delivery's checker is under test here - CNT-148 is the bridge that gives the desktop
shell one, and it is not built. Whether a checker honours the attribute is the accessibility suite's
(CNT-139).

**CNT-147 and CNT-148 are new, and the change they come from is part of this design's review.** Native
spellcheck ignores an element's `lang`, in Chromium and in Firefox, so CNT-099 - check each run against
its own language - and CNT-101 - the browser supplies the checker - could not both be met. The decision
was to keep the native checker, so CNT-099 is superseded by CNT-147 and CNT-101 by CNT-148, which say
what native checking can honestly promise. In the web delivery that is less than it sounds: a page
cannot choose which dictionaries the browser uses, so a component in a language the author's browser
has not enabled is checked against whatever it has.

**CNT-152 is a warning, not a refusal, and the editor asks the publishing rule rather than keeping a
copy of it.** The content model takes any well-formed BCP 47 tag and CNT-140 requires a script
subtag to be kept where it changes the content; the publishing engine carries a language and an
optional two-letter region and refuses the rest. The language prompt therefore calls
`publishedLanguage` from the publishing design's own module, and where the answer is nothing it
names the tag back to the author, in the dialog, before anything is applied. The button becomes
**OK anyway** while the warning stands, so a press that means something else is under a name that
says so; pressing it applies the mark. Refusing here would narrow the model to one engine's limits,
and saying nothing would leave the author to find out at a publish they may not be the one to ask
for. The editor never shortens the tag to something the engine would take, for the reason
`publishing.md` gives - a shortened tag tells assistive technology something the author never said.

**What this claim does not cover: the component's own base language.** CNT-152 asks only about a run
an author marks, and the base language goes through exactly the same rule - `assemble` already
refuses a component whose own language the engine cannot carry - while the field that sets it, in
the component header and in Creating a component, is checked against the wide BCP 47 shape alone. So
an author can set a base language of `zh-Hans` today, be told nothing, and have somebody else's
publish refused: the same harm, on the half that has already shipped.
[Issue #156](https://github.com/kenhayward/alloy-works/issues/156) carries it, and this design does
not answer it yet.

## What this document does not own

**Much of what an editor does is designed elsewhere, and this document uses it rather than restating
it.** The admission pipeline that paste and internal copy pass through (CNT-060 to CNT-064, CNT-130 to
CNT-135), what every node and mark stores (CNT-017, CNT-022, CNT-027 to CNT-030, CNT-043, CNT-081,
CNT-107, CNT-126, CNT-127, CNT-129) and identity (CNT-002, CNT-004) are
[content-model.md](content-model.md)'s. Style resolution and the editor's rendering of it (CNT-097,
STY-035, STY-037, STY-053, STY-058) are [themes.md](themes.md)'s. The API conventions every route
follows - the error shape, cursors, idempotency keys, the generated contract (API-002, API-003, API-005
to API-008) - are [service-foundations.md](service-foundations.md)'s.

| Left unclaimed                              | Why                                                                                                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-035                                     | Every CNT-031 mark from toolbar and keyboard includes **defined term**, whose control needs a term to choose, and terms are LIB's T6 library. The other seven marks are designed here                                                         |
| CNT-078, CNT-139                            | WCAG 2.2 AA and its verification are for the editor as a whole, and half of the editor is the document view, not yet designed. This slice is built to it, tested against it, and gated on it below                                            |
| CNT-079                                     | Headings are outline nodes, rendered by the document view. Lists, tables and footnotes are exposed as structure here                                                                                                                          |
| CNT-074                                     | Which component the cursor is in is the document view's; this slice shows the lock state of the one component open                                                                                                                            |
| CNT-045, CNT-046, CNT-049                   | Rendering an equation in PDF and Word is the publisher's; an equation in a heading is the document view's, and **in a caption it is not representable** - see [Captions](#captions)                                                           |
| CNT-122                                     | The editor sizes an image by the shared resolver; resolving it at publish is the publisher's                                                                                                                                                  |
| CNT-113, COL-026                            | Seeing what this session changed needs the comparison algorithm, which [storage-and-versioning.md](storage-and-versioning.md) leaves for its own design                                                                                       |
| COL-007, API-036                            | Showing a held lock to others and delivering the change are [realtime.md](realtime.md)'s, which this design extends to a component opened on its own                                                                                          |
| COL-009                                     | Taking a lock from an idle holder, with a warning and an audit, is not in the minimal lock. The row supports it; the act is not designed                                                                                                      |
| MET-021, MET-029                            | This panel validates as values change and shows a departed user as no longer active - for a component. Both requirements cover a document's and a section's fields too, which the document view edits                                         |
| API-037, API-038, API-047, API-051, API-053 | Preconditions, request identifiers, rate limits and the authentication contract are honoured by every route below, but they are rules for every route in the product, not something this design is the realisation of                         |
| STY-066, STY-070                            | A draft resolving against its document's theme needs a document; an unresolvable glyph needs coverage data the editor does not have. Styles and typefaces that fail to resolve are marked - see [Unresolvable content](#unresolvable-content) |

## Where the code lives

| Where                   | What                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/editor`       | New. The ProseMirror schema, the mapping to and from the stored model, plugins, commands, keymaps and node views. Browser code, no React                          |
| `apps/web`              | A thin React component that mounts one `EditorView`, the toolbar, the metadata panel, the save indicator and the session state machine                            |
| `packages/domain`       | Unchanged in role: the content model, the admission pipeline, [metadata.md](metadata.md)'s rules and the theme resolver, imported by the renderer and the service |
| `packages/api-contract` | The routes below                                                                                                                                                  |
| `apps/service`          | The routes, the lock, iterations and versions, per [storage-and-versioning.md](storage-and-versioning.md)                                                         |
| `apps/desktop`          | One bridge call to set the platform checker's languages (CNT-148), decided in `shell.ts` as a pure function                                                       |

**`packages/editor` is a workspace rather than a folder in `apps/web`** because most of it is testable
without a browser: `prosemirror-model` and `prosemirror-state` run in Node, so the mapping, the identity
plugin, the invariants and every command are tested there. Only node views and the view itself need a
DOM.

**No editor toolkit sits on top of ProseMirror.** A toolkit brings its own schema and extension model,
and this product already has a schema - two definitions of one document are two things to keep in
agreement for ever. ADR-0023 said a toolkit is a separate, reversible choice; this design takes the
choice not to.

## The surface

**The schema is the stored model's, mapped losslessly.** Every node and mark in content-model.md has a
ProseMirror counterpart, and `toEditor` and `fromEditor` are total and inverse. The component's title,
base language and base direction - the content root's other members - are attributes of the editor's
document node, so changing one is a step like any other: saved, undoable and versioned. The one
difference the spike found is kept: a block's `id` has a default of `null` in the editor schema, because
ProseMirror must be able to generate a paragraph, and the identity plugin fills it. `fromEditor` refuses
a `null` identifier, so an unidentified block can never reach storage.

### What an author can do with each thing in the model

The slice boundary, stated for every node and mark rather than left to be inferred. **Create** means a
command makes a new one; **edit** means an existing one can be changed.

| Content                                                                         | Create                                 | Edit                                                                                   | Where it waits                                   |
| ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Paragraph                                                                       | Yes                                    | Text, and its style from the theme's allowed list                                      |                                                  |
| Emphasis, strong, underline, subscript, superscript, inline code, quoted phrase | Yes, toolbar and shortcut              | Apply and remove                                                                       |                                                  |
| Hyperlink                                                                       | Yes, over a selection                  | Target and title; removal                                                              |                                                  |
| Language                                                                        | Yes, over a selection                  | Tag; removal                                                                           |                                                  |
| Defined term                                                                    | No                                     | Removal only                                                                           | LIB's terms, T6                                  |
| List, three kinds                                                               | Yes                                    | Kind, nesting, start and format                                                        |                                                  |
| Table                                                                           | Yes                                    | Cells, spans, header rows and columns, key columns, caption, note                      |                                                  |
| Preformatted                                                                    | Yes                                    | Text and language label                                                                |                                                  |
| Block quotation                                                                 | Yes                                    | Content and attribution                                                                |                                                  |
| Equation, inline and block                                                      | Yes                                    | LaTeX or MathML, alternative text, numbered or not                                     |                                                  |
| Footnote                                                                        | Yes, in all four anchor kinds          | Content, restricted to CNT-129's                                                       |                                                  |
| Figure, inline image                                                            | Yes, from a file ([Figures](#figures)) | Caption, alternative text state, the image; image style once themes give more than one | Built in four slices, publishing.md's F-O        |
| Cross-reference                                                                 | No                                     | Removal only                                                                           | STR, in the document view, where its targets are |
| Citation                                                                        | No                                     | Removal only                                                                           | LIB's bibliography, T6                           |
| Variable                                                                        | No                                     | Removal only                                                                           | REU, T4                                          |
| Binding                                                                         | No                                     | Removal only                                                                           | DAT, T2                                          |
| Condition, suggestion, comment anchor                                           | No                                     | None                                                                                   | REU, T4, and COL, T3. Nothing in T1 creates one  |

**Nothing in T1 can put a condition, a suggestion or a comment anchor into a component** - the admission
pipeline drops annotations whose owner does not travel (CNT-133) and follows CNT-Q14's recommendation to
drop a condition whose axis is absent - so the editor renders one only if it ever meets one: as a marker
distinguishable without colour (CNT-138), read-only. **Admonitions are not in this table because they
are not in the model**: content-model.md left the block out of the first vocabulary deliberately, as T2.

**A figure or image is edited faithfully even where it cannot be shown.** Its caption, its alternative
text in the model's three states - its own text, inherited from the asset, or decorative - and its image
style are editable, and an asset that does not resolve renders as an explicit marker. [Figures](#figures), below, is how one is made, now that [assets.md](assets.md) says how an image arrives.

### Identity, by operation

| Operation                 | Blocks                                                                                                                                       | Marks                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A new block in the editor | The identity plugin allocates 128 random bits, base32, and re-draws on a clash within the component                                          | -                                                                                                                                          |
| Applying a mark           | -                                                                                                                                            | A new identifier. Character marks exclude their own type, so re-applying one replaces it with a fresh identifier; annotation marks overlap |
| Split, join, move         | ADR-0023's descent rule: the block at its identifier's forward-mapped position, association 1, keeps it; every other holder is re-identified | Attributes travel with the text, so a mark split across text nodes keeps one identifier (CNT-004)                                          |
| Paste, from anywhere      | The admission pipeline's re-identify stage allocates a new identifier for every block before ProseMirror sees the slice (CNT-132)            | The same stage allocates a new identifier for every mark, and drops annotations whose owner does not travel (CNT-133)                      |
| Restoring an iteration    | As stored, already unique; migrated to the current schema first or refused by name (CNT-012, CNT-013)                                        | As stored                                                                                                                                  |

**Paste is re-identification, not collision resolution.** The descent rule decides who keeps an
identifier when two blocks in one document hold it. Pasted content never reaches that rule with a copied
identifier, because the pipeline has already given every pasted block and mark a new one - so a copied
block cannot keep its identifier merely because the receiving component did not have it yet.

### Invariants the editor holds

- **At least one block, always.** The editor document's content is `block+`, so deleting everything
  leaves one empty paragraph (CNT-124).
- **Never two adjacent empty paragraphs** (CNT-023). `Enter` in an empty paragraph creates no second one
  - in a list it leaves the list - and an `appendTransaction` removes the second of two adjacent empty
    paragraphs however they arose, from a join, a deletion or an undo. Blank lines in pasted content are
    normalised by the pipeline and reported.
- **Preformatted text keeps every character typed into it.** `Enter` inserts a line feed and never
  splits the block - in a list item or out of one - and `Tab` inserts a tab rather than nesting an
  item. `Shift-Tab` is never taken there, so focus can always leave backwards, and `Mod-Enter` leaves
  the block for a paragraph after it. The surface sets tab stops every 8 columns, which is what the
  publication prints. A quotation's attribution is its own line after the quotation's blocks, always
  offered, stored only when it holds text; `Enter` in it leaves the quotation
  ([editor 5](../plans/2026-09-21-editor-05-quotations-and-preformatted-text.md), decisions H and I).
- **What the editor holds is always storable.** Every iteration is `fromEditor` then
  `parseContentDocument`, in the renderer; the service parses it again and refuses content that does not
  parse, so an invariant broken by a bug is a refused save rather than a stored defect.

### Tables and footnotes

A table's properties - header rows and columns, **key columns**, caption and note - are edited in a table
panel reached from the table's toolbar and by keyboard. **What the tables slice builds of that
(Ken's answer 2026-09-22, with publishing.md's [Tables](publishing.md#tables)):**

- **Table** on the toolbar inserts three columns by three rows, the first a header row, with the cursor
  in the first cell, and a caption line above it - edited in place, as a quotation's attribution is,
  because a caption is inline content (content-model.md's decision T-A).
- **A table panel** - a region in the `F6` ring while the cursor is in a table, as the list panel is -
  holds the number of header rows and header columns, adding a row or a column on either side of the
  cursor, deleting one, merging the selected cells and splitting a merged one, and deleting the table.
  Key columns and the note wait for footnotes, which are all they are for.
- **The header counts are the model's truth.** `prosemirror-tables` marks each cell as a header or a
  data cell, where the model stores two counts, so a plugin keeps every cell's kind agreeing with the
  counts after every transaction, as the identity plugin keeps identifiers.
- **Tab and Shift-Tab move between cells**, and leave the table from its last cell and its first, so
  Tab is never a trap (CNT-077). In a list inside a cell they move between cells too, as Word's do; a
  list there nests with the list's own shortcuts.
- **A table that the grid rules would refuse cannot be made**: merging and splitting are
  `prosemirror-tables`' own, which keep the grid whole, and the walk refuses anything else on save. Tables use `prosemirror-tables` with ADR-0023's
  accessible `toDOM` - `scope` on header cells, a `<caption>` - and **column resizing off**, because the
  resizing plugin owns the table's DOM and ignores `toDOM`, so it cannot emit the caption TAB-039 requires.
  A table's widths are the theme's.

| Footnote anchored to | Inserted by                                                                                       | Survives                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A span of text       | **Insert footnote** at the cursor                                                                 | Any edit that keeps the anchor node                                                                                       |
| A cell, by key       | **Insert footnote** in a cell of a table with key columns; the key is that row's key-column value | Reordering rows. If the key value changes or the row goes, the anchor shows as unresolved, and publishing fails (CNT-042) |
| A cell, by position  | **Insert footnote** in a cell of a table without key columns                                      | Nothing that moves the cell. Shown with a marker saying it is the weaker form (CNT-107)                                   |
| The table as a whole | **Add note** in the table panel                                                                   | Anything that keeps the table                                                                                             |

A footnote's content is a nested editor on the **restricted schema** - paragraphs only, holding the
inline content CNT-129 allows, and no table or image - so the restriction is structural, not a check.

### Equations

**MathML is canonical and LaTeX is an input record**, as content-model.md decided (CNT-043): rendering,
comparison and publishing read the MathML only. An author types LaTeX, converted as they type by a
converter that emits MathML - Temml is the candidate, being small and MIT-licensed - **pinned to a
version**. What the converter emits is not stored as it stands: the pipeline's sanitise stage reads an
equation's MathML with a strict reader of its own - not a general parser, no dependency - and writes it
back in one form, one attribute order, no insignificant whitespace, one namespace declaration - so
identical input stores identical bytes and does not churn the version digest. Whatever writes an
equation, this conversion included, must write the reader's form: validation asks the same reader, and
an equation not already in that form is refused, on save and on read-back alike (the admission plan's
decisions 7 and 17). Equations entered by different paths that mean the same thing are not detected as
equal; nothing requires it, and a comparison showing a re-entered equation as changed is honest.

Chromium renders MathML Core and Electron is Chromium, so there is no typesetting library in the editor.

| Context                              | Equation                                          |
| ------------------------------------ | ------------------------------------------------- |
| Running text, list items, quotations | Inline, and block where blocks are allowed        |
| A table cell                         | Inline, in the cell's paragraphs, and block       |
| A footnote                           | Inline                                            |
| A caption                            | **Not representable** - see [Captions](#captions) |
| A heading                            | The document view's                               |

**Generating the alternative is assistance, and its absence is never silent.** The alternative is
generated from the MathML by a speech rule engine where one is available - when an equation is entered,
and on load for any equation that has none, which covers pasted, migrated and restored ones. It is always
editable. If no generator is available or it produces nothing, the field is empty and marked, and a
missing alternative fails the publish (PUB-072). CNT-048 asks for generation "where possible", so the
choice of engine does not decide whether this slice meets it.

### Captions

A table's and a figure's caption is the model's `caption` member, a **plain string** today, edited as a
text field in the table or figure panel. **Inline content, decided 2026-09-22**, edited in place above
the table - content-model.md's [Tables, before the first is stored](content-model.md#tables-before-the-first-is-stored),
which answers #88 below for both blocks. A caption-bearing block's identity is its block `id` (CNT-081), which
every operation in the identity table above treats like any other.

**A plain-string caption cannot hold an equation, a mark or a cross-reference**, so CNT-046's "an equation
in a caption" is not representable in the model as built. That is a finding about the content model rather
than the editor, raised as [#88](https://github.com/kenhayward/alloy-works/issues/88) rather than worked around here.

### Figures

Designed on 2026-09-23 with [assets.md](assets.md), which is what lets the editor make a figure at all.

**Figure** on the toolbar opens a dialog that chooses one file and asks one question: how would you
describe this image to someone who cannot see it? The answer is **a description**, in a language that
defaults to the component's, or **It is decorative**. The dialog will not upload without one of the
two, because the model has no state for "not yet said" (content-model.md's three states) and an
author asked at the moment of choosing the picture answers better than one asked at publish. A
description becomes **the asset's default**, which the figure inherits; decorative makes the figure
decorative and leaves the asset with no default.

The dialog then uploads, says _Checking the image_ while the ingest job runs - usually under a second

- and inserts the figure after the block the cursor is in, with its caption line saying **Caption**
  until one is typed, as a table's does. A refused upload says why in the dialog, in words: not a PNG
  or a JPEG, larger than 25 MB, more than 50 million pixels, or not a complete image. Nothing is
  inserted.

**The figure in the surface** is a node holding the image and its caption, the caption below it as
the PDF sets it (publishing.md's F-L) and edited in place like any caption. The image is an atom
showing the asset version's bytes from the service's route, at the column's width and no taller than
60 per cent of the viewport - the same rule the publisher applies to the page, read from one function
in `packages/domain` so the two cannot disagree about proportions. An asset the reader may not read
shows _An image you may not see_ in its place, and one that no longer resolves names the asset
(Unresolvable content, below).

**A Figure panel**, beside the surface while the cursor is in a figure and in the `F6` ring like the
table panel, sets the alternative text's state:

| Choice                          | Stores                             | Shows                                                                                                                |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Use the image's description** | `inherited`                        | The asset's default and its language, or _The image has no description_ where it has none - which publishing refuses |
| **Describe it here**            | `own`, in the component's language | A text field; empty is not saved, and the previous state stays until something is typed                              |
| **Decorative**                  | `decorative`                       | Nothing is read to a screen reader; the caption still is                                                             |

and offers **Replace image**, which uploads another file into the same figure, keeping its caption,
identity and number, and **Delete figure**. Changing the image's own default description - a new
asset version - is not in the panel: it changes every figure that inherits it, which is an asset
library's act, and T2's.

**Identity is the figure's block `id`**, as for every caption-bearing block (CNT-081), so replacing the
image keeps the figure's number and every cross-reference to it.

**Copying a figure within the product keeps it**, asset version and all, through the product's own
clipboard type; a paste into a component in another space is allowed where the author may read the
asset, and publishing decides for the publisher as it does for every asset. Pasting or dropping an
image file, and images pasted from a web page or Word, are not in these slices: paste keeps no image
today and still will after them.

**Inline images** - an image in a run of text and in a table cell (CNT-086, CNT-087) - use the same
dialog and the same panel, and come in the last of the four slices (publishing.md's F-O).

## Theme and rendering

**A component opened on its own renders against the product's default theme** (STY-048), at its current
version, and the view says so: _shown in the default theme_. A component is referenced by documents bound
to different themes, and until the document view gives it a document there is no one theme it would be
right to show. In the document view a draft resolves against its document's theme version (STY-066).

**The editor resolves nothing itself.** themes.md's single resolver in `packages/domain` resolves styles
for the editor and the publisher alike (STY-035), and `projectCss` is the editor's projection of what it
resolved, scoped to the component's container, with the tenant's typefaces. Paragraph and character
styles render every declared property (STY-058), and properties that only exist on a page - a table's
repeated header row, a continuation label, keep-together - are not simulated (STY-037); preview is what
shows them. The measured agreement between the editor, the PDF and Word is themes.md's conformance suite.

**Direction is the model's, and the view follows it.** The surface carries `dir` from the component's
base direction; mixed-direction text within a run follows the Unicode bidirectional algorithm; and the
theme projection is expected to express alignment as start and end rather than left and right, so a
right-to-left component aligns correctly without a second style.

### Unresolvable content

| What                                             | The editor shows                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A style not in the theme                         | The resolver's unresolved result, projected as a marker with an accessible description naming the style                                                                                                                  |
| A typeface that fails to load                    | Detected from the font's load status; the text is marked and never quietly set in a fallback (STY-040)                                                                                                                   |
| An asset that does not resolve                   | A marker in the figure's place, naming the asset                                                                                                                                                                         |
| A cross-reference, citation, variable or binding | An atom naming its target where the target can be read, and a marker where it cannot. A cross-reference in a component opened on its own is shown as resolved in a document, because that is where its number comes from |
| A glyph a typeface lacks                         | **Nothing yet.** A browser gives no reliable signal, and coverage data per typeface is not designed - so STY-070 stays unclaimed on this clause                                                                          |

## The session

| State         | Means                                                                          | Leaves by                                                                       | When it fails                                                                                                  |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Reading**   | Open, not held. Selecting and copying work; changing does not                  | A change to content or a value → Claiming                                       | -                                                                                                              |
| **Claiming**  | Changes are held while the lock is requested                                   | Granted → Editing, held changes applied in order                                | Refused → Reading, holder named, held changes kept - see below. No answer in ten seconds → Reading, with retry |
| **Editing**   | This session holds the lock. Changes are saved as iterations                   | Save version → Cutting. Done editing → Releasing                                | Lock expired, taken or moved → Recovery                                                                        |
| **Cutting**   | Unsaved changes are flushed and acknowledged, then the version is requested    | Cut, or nothing to cut → Editing, history and stored steps cleared              | Flush fails → Editing, not saved, no version requested. Refused → Editing, reason shown                        |
| **Releasing** | Flushed and acknowledged, a version cut if anything changed, the lock released | → Reading                                                                       | Flush fails → Editing, not saved: the lock is not released over unsaved work unless the author discards it     |
| **Recovery**  | The lock went while this session had changes                                   | The author claims again and restores, or discards the session's unsaved changes | Claim refused → stays in Recovery, unsaved changes still held locally                                          |

### Claiming

**Claiming waits rather than refuses.** COL-005 wants claiming to be automatic on beginning to edit. An
editor that refused the first keystroke and asked for it again would make claiming a separate act in all
but name.

- **Changes are held in order.** The first change and everything after it - typing, a paste, a metadata
  value - is held as a queue of transactions against the document as it was, and applied in order when
  the lock is granted, normally within a round trip. The surface shows that editing is starting.
- **A refusal loses nothing.** The held changes are not applied, and the author is told who holds the
  component and when it is expected back, and offered the held changes as text to copy - the one thing
  that can be kept without writing to a component someone else is editing.
- **No answer is a refusal to retry**, not a silent wait: after ten seconds the session returns to
  Reading, keeps the held changes, and offers to try again.

### Saving

After two seconds without a change, or every ten seconds during continuous typing, the renderer sends an
iteration: the whole content and values, the lock's session, a sequence number, and the version the
session opened from. **A metadata value change counts as a change**, starting and resetting the same
timers.

**One iteration is in flight at a time, and sequence numbers only increase.** For each editing session the
service keeps the latest accepted sequence and the digest of what it accepted:

| Arrives                                          | Answer                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| A sequence above the latest accepted             | Accepted                                                                 |
| The latest sequence again, same content          | The original acknowledgement - a retry makes no second row               |
| The latest sequence again, different content     | Refused, `iteration.conflict`                                            |
| A sequence below the latest accepted             | Refused, `iteration.stale` - a whole snapshot never replaces a newer one |
| A stated opened-from version that is not current | Refused, `version.precondition`, naming the current version              |

The indicator says **saved** when the latest sequence is acknowledged, **saving** while one is in flight,
and **not saved, retrying** once a save has failed for ten seconds. Retries back off to thirty seconds
between attempts, and a limited response's `Retry-After` is honoured over the client's own backoff.
Every unsent step, and the latest values, stay in session storage throughout.

### Undo across a reload

Session storage holds, per component and editing session: the version the session opened from, the
document at that point, every step since with the history's grouping, the latest metadata values, and
the last sequence number sent.

On reload the renderer asks the service for the session's latest accepted sequence. If this session still
holds the lock and the opened-from version is unchanged, the steps are replayed into a fresh editor state
with history, the values restored, and anything beyond the service's latest sequence sent as the next
iteration - so undo reaches back exactly as far as it did, and the service's record is never overwritten
by an older local one. Steps recorded against an older version are discarded (CNT-103). A lock no longer
held means Recovery. Session storage that does not parse is discarded and the session opens from the
service's latest iteration.

**Undo covers content, not metadata.** ProseMirror's history is the document's - which includes the title,
base language and base direction. A metadata field is an ordinary input with its own undo, and folding
value changes into the content history would make one `Ctrl-Z` undo an edit the author cannot see from
where the cursor is.

### Two windows, one author

The lock belongs to a principal and an editing session. A second window of the same author finds the
component held by its own other session - the component's lock state says so before anybody types - and
may **continue here**, which moves the lock to the new session.

**Moving the lock does not strand the other window's work.** The window that lost the lock learns it from
the lock event (realtime) or, failing that, from its next refused save, and enters Recovery with its
unsent changes still held locally. From there it can move the lock back and save them, or discard them.
Iterations either session saved stay visible to that author, because the holder is the principal
(VER-002).

**Built, this is not yet true without Recovery.** This slice has no lock event and no Recovery to move the
lock back from: a window that loses the lock this way simply finds itself refused on its next save, with
no route back to what it already saved. What it already saved is not lost - the iteration is kept, for
thirty days, and never swept while it is the artifact's latest (VER-003) - but nothing here shows either
window that the other's saves exist, so a version can be cut from one window while the other's later work
sits unreachable until Recovery ships. See [Changed while planning the build](#changed-while-planning-the-build).

### Recovery

Iterations are visible to the lock holder only (VER-002), so **Recovery begins by claiming the lock
again** - which succeeds only if nobody else holds it. Without the lock, the author still has whatever
unsent changes the window holds, and is told who holds the component.

With it, the panel lists retained iterations newest first, a page at a time over a cursor (API-007),
within the tenant's retention window (VER-003, VER-004); an iteration that expires while listed disappears
on the next page or refresh. **Restoring applies a whole snapshot - content and values together** - after
the current state is saved as an iteration of its own, so a restore is itself recoverable. A restored
snapshot is migrated to the current schema and validated first, and one that will not read is refused by
name rather than half loaded (CNT-012, CNT-013).

## Cutting a version

**Save version** takes an optional note (VER-007). The renderer flushes unsaved changes and waits for the
acknowledgement, then asks for a version from the latest acknowledged iteration, stating the version the
session opened from and an `Idempotency-Key`.

The service, in one transaction: checks the lock; refuses if the component's latest version is not the one
stated (`version.precondition`); loads the current definitions (`definitionsFor`, metadata.md); carries the
values forward (`carryForward`); computes the content hash and the version digest (ADR-0024); **answers
`version.unchanged` if the digest equals the latest version's**; and inserts the version with its
`version_definition` rows. A repeated request with the same key returns the first answer (API-008).

**Nothing to cut is not an error to the author.** `version.unchanged` is a structured answer rather than a
failure: Save version with no change says so and does nothing; Done editing with no change releases the
lock and cuts nothing - COL-010's "releasing cuts a version" has nothing to cut, and ADR-0024 refuses a
version that says nothing new.

**After a successful cut** the editor clears its history and replaces the session-storage entry with one
recorded against the new version, so nothing from before the cut can be replayed into undo.

**Values that will not be carried are shown before the cut.** If the current definitions no longer include
a field that holds a value, the author is told which values the version will leave behind, by field,
before confirming (MET-036).

## Metadata alongside

The **metadata panel** sits beside the surface in the same view. It shows the component's type - read-only
in T1, since changing it is MET-014, T2 - and its effective fields in resolution order (metadata.md).

| Data type   | Input                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`      | A text input                                                                                                                                                                                                           |
| `number`    | A decimal input that keeps the string entered                                                                                                                                                                          |
| `date`      | A date input; stored `YYYY-MM-DD`, no offset                                                                                                                                                                           |
| `time`      | A time input; stored `HH:MM` or `HH:MM:SS`, no offset                                                                                                                                                                  |
| `dateTime`  | A local date and time in a named zone, defaulting to the author's; **stored as the instant with its numeric offset**, never the zone name. A time that does not exist or occurs twice in that zone asks which is meant |
| `boolean`   | A switch                                                                                                                                                                                                               |
| `user`      | A picker over the tenant's **active** principals. A stored principal who has since been de-provisioned is shown by name as **no longer active**, and the value stays set and valid                                     |
| Any, `many` | An ordered list of that input, with add, remove and move up and down; duplicates and more than `maxValues` are validation failures shown on the list; order is kept exactly                                            |

- **Required** fields are marked and exposed as required to assistive technology, naming every schema that
  requires them.
- **Fixed** fields are read-only, naming every schema that fixes them (MET-033).
- **Validation runs on every change** in the renderer, with the same `validate` the service and the
  publisher use, each failure associated with its field and announced.
- **Values are part of the iteration**, so they autosave, recover and version with the content.

**The service refuses only what cannot be stored honestly.** An iteration is refused if a fixed value
differs from its default (`metadata.fixed`, MET-033), a value is not the JSON its data type takes, a user
value names no principal of this tenant (`metadata.user`, metadata.md), or it would change the
component's type. Every other failure - a required field left empty, a pattern not
matched - is saved and shown, and fails the publish (MET-023). An author mid-draft is never blocked from
saving. Refusals use service-foundations' error shape, with the field, the rule and the schemas as members
rather than prose.

### When definitions change mid-session

Definitions are tenant-wide and change while people are editing. **A session notices a change rather than
discovering it at a refusal.**

- `GET /v1/components/{id}` returns the definition versions the effective fields were resolved from, and
  every iteration acknowledgement carries a digest of the current ones. When the digest differs, the
  renderer re-fetches the effective fields.
- **The panel then explains what changed**, before the author meets it: a field newly required is marked
  and named; a field newly fixed takes its default, with the old value and the reason shown; a field no
  longer applying keeps its value, listed as one the next version will not carry.
- **An iteration in flight when a field becomes fixed** is refused with `metadata.fixed`, carrying the
  current definitions; the renderer applies them as above and resends, without the author having to act.
  **A cut is refused the same way** when a field became fixed after the last acknowledged iteration,
  because carrying forward never replaces a value that is present (metadata.md).
- **The cut uses the definitions current at the cut**, and shows what will not be carried first, so nothing
  the author entered disappears unseen.

## Creating a component

A title, a base language (a BCP 47 picker), a **base direction** - left to right or right to left,
defaulting from the language's script - and a component type, with the tenant's default preselected
(MET-011). Creating inserts the artifact and version `0.1`: one empty paragraph (CNT-124), every fixed
field at its default and every other default applied (metadata.md). Creation is itself a positive act, so
every component has a version from the moment it exists, and a baseline can pin it.

**Where.** `GET /v1/spaces` answers the spaces the caller may read, each saying whether they may create a
component there, and the form offers only those. The component types to choose from come from
`GET /v1/spaces/{space}/component-types`, decided by `create` on that space: whoever may create here, and
only they, may see what they may create. The environment's default is preselected (MET-011), and until a
tenant can declare its own it is the one every environment is provisioned with.

**A retried create makes a second component, and nothing here prevents it.** This route was written as
carrying an `Idempotency-Key`; no request in this service honours one, because API-008's mechanism is
service-foundations.md's and is not built. Until it is, the renderer sends one create and disables
**Create** while it is in flight, which covers a second click and not a lost answer.

**Title, base language and base direction are edited afterwards** in the component header above the
surface. Each is a step on the editor's document, so each is saved, undoable and versioned like content.
The title is stored trimmed, on creation and on every edit alike, and a title that is nothing but
whitespace is refused rather than set. Changing the base language asks for confirmation, because every run
without its own language mark changes language with it, and the spellcheck rule (CNT-147) is recomputed
from the new base - the confirmation arrives with the language mark, which this slice does not have.

**A field showing one of the three cannot be bound straight to the document.** The model normalises what
it is given (a trimmed title) and refuses what it will not take (a tag still being typed), so a field that
mirrored the document back after every keystroke would lose an interior space the moment it became
trailing, and could never finish a new language tag at all. Each field holds what the author typed and
gives way only when the document's own value differs from the one that field last heard - which is an
undo, a refusal putting the surface back, or a version cut, and never this field's own keystroke.

## Accessibility

- **Regions.** The view has six: component header, **formatting** toolbar, **list** panel,
  **preformatted text** panel, surface,
  metadata panel. `F6` and `Shift-F6` cycle them; inside a nested editor they leave it for the region
  that holds it. The view holds a second toolbar, Save version and Done editing, and that one is
  deliberately not a region: it is two buttons, reached by a Tab from the header as any two buttons
  are, and making it another stop would lengthen the ring without shortening any journey through it.
  `F6` pressed from it enters the ring at the first region, and `Shift-F6` at the last.
- **A region that is not there is not in the ring.** The list panel is the first of these to come and
  go with the selection: it stands between the toolbar and the surface while the cursor is inside a
  counted list, holding that list's kind, start and numbering, and is absent everywhere else -
  including inside a definition list, which carries none of the three and whose kind is the button
  that made it. The **preformatted text** panel is the second: it holds a preformatted block's
  language label, stands after the list panel while the cursor is in such a block, and is absent
  everywhere else. So the ring is built from the regions actually rendered, and the wrap is over those.
- **Nested and transient editors are inline, not modal.** Opening an equation or a footnote moves focus
  into it; `Escape` closes it and returns focus to the node it was opened from. The symbol palette is a
  popup grid: `Escape` or inserting a symbol returns focus to where the cursor was.
- **Equations** are focusable nodes, opened with `Enter`; the LaTeX field has `spellcheck="false"` and an
  accessible name; the alternative-text field is labelled and marked when empty.
- **Status is announced**, politely, through one live region: saving failing and recovering, the lock
  claimed, a claim refused with its holder and expected release, entering Recovery, a version cut or
  nothing to cut, a definition change, and an unresolvable marker appearing.
- **The metadata form** gives every input a label, exposes required and fixed state, associates each
  validation failure with its field, and names a no-longer-active user as such.
- **Markers are never colour alone** (CNT-138): a shape or text accompanies each.

## The API

Every route follows [service-foundations.md](service-foundations.md): declared once in
`packages/api-contract`, the OpenAPI document generated from it and drift-checked, requests and responses
validated both ways, one error shape `{ code, message, rule?, traceId }`, cursor listings, and an
`Idempotency-Key` honoured on any mutating request. **No route honours one yet**, here or anywhere in the
service: API-008's mechanism is service-foundations.md's and is unbuilt, so a cut and a create retried
after their answer was lost are each dealt with by themselves - see "Cutting a version" and "Creating a
component" above.

| Route                                                | Permission   | Carries                                               | Does                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/components`                                 | Signed in    | `cursor`, `limit`, `spaces`                           | The components the caller may read, filtered by the readable set inside the query: title, space, number, type, language and last change, with a total and a count per space                        |
| `GET /v1/spaces`                                     | Signed in    | -                                                     | The spaces the caller may read, each saying whether they may create a component in it                                                                                                              |
| `GET /v1/spaces/{space}/component-types`             | Create       | -                                                     | The component types a component created in this space may take, with the environment's default marked                                                                                              |
| `POST /v1/spaces/{space}/components`                 | Create       | Title, base language, base direction, component type  | Creates a component and its version `0.1`, and answers it. `200`, not `201`                                                                                                                        |
| `GET /v1/components/{id}`                            | Read         | -                                                     | The latest version and its values, the effective fields and the definition versions they came from, and the lock state: holder, expected release, and whether it is this principal's other session |
| `POST /v1/components/{id}/lock`                      | Edit         | The editing session                                   | Claims the lock, or moves it to a new session of the same principal                                                                                                                                |
| `DELETE /v1/components/{id}/lock`                    | Edit, holder | Session and opened-from version in the query          | Done editing: cuts a version if anything changed, then releases; says whether a version was cut                                                                                                    |
| `PUT /v1/components/{id}/iterations/{session}/{seq}` | Edit, holder | Opened-from version                                   | Saves an iteration, under the sequence rules above                                                                                                                                                 |
| `GET /v1/components/{id}/iterations`                 | Edit, holder | `cursor`, `limit`                                     | Retained iterations, newest first                                                                                                                                                                  |
| `POST /v1/components/{id}/versions`                  | Edit, holder | Opened-from version, optional note, `Idempotency-Key` | Cuts a version from the latest iteration                                                                                                                                                           |

**Three different refusals, kept apart.** An unauthenticated request is refused as unauthenticated and a
request without the permission as forbidden, by IAM's contract (API-053); an authorised request against a
component somebody else holds is refused `lock.held`, naming the holder and the expected release (API-039).
An author who may edit but finds the component held is not "forbidden", and the error does not say so.

**Lock changes are heard by a component opened on its own.** realtime.md's stream takes a scope: an open
document, as before, or a single component opened outside any document. The events and the snapshot are
the same, so the component's lock state stays current without anybody polling.

## Verification

- **The mapping round trip, as a property test**: generated content documents survive `toEditor` then
  `fromEditor` unchanged, in Node. This is the test content-model.md named as arriving with the editor.
- **Invariants as property tests**: after any generated sequence of commands, no block has a `null`
  identifier, there is at least one block, no two empty paragraphs are adjacent, block identifiers are
  unique, and a footnote's content holds no table or image.
- **Identity**: the spike's assertions become real tests - paste, split and join among them - and pasted
  content is asserted re-identified, blocks and marks, even where the receiving component lacked the
  copied identifiers.
- **Paste**: the admission pipeline's own tests assert what was dropped as well as what survived (CNT-064);
  the editor's assert that a paste reaches ProseMirror only through the pipeline and that the report is
  shown.
- **The session state machine against a hand-written fake service**, including its failure edges: typing
  and a large paste while claiming; a refused claim keeping held changes; a metadata value as the first
  change; a stale and a conflicting sequence; a flush failing before Save version and before Done editing;
  a fixed field arriving mid-session; the lock moved to another window with unsent changes; a reload with
  the service ahead of session storage; and unreadable session storage.
- **Service tests for every refusal**: another holder (API-039), an unchanged version, a changed fixed value,
  a type change, a stale or conflicting sequence, a stale opened-from version; and a timeout that cuts
  nothing while a release cuts one (COL-010).
- **Contract tests** for every route against the generated OpenAPI document (API-003), asserting error
  bodies - `code` and members - and not only status codes.
- **Desktop**: the shell's language choice tested as a pure function in `shell.ts`.
- **Autosave under load**: request rate under continuous typing and idle bursts, backoff, and `Retry-After`,
  measured on a declared reference configuration and recorded beside the provisional two and ten seconds.
- **Accessibility**, which needs a browser: an automated suite in CI over this surface, and a recorded manual
  audit against WCAG 2.2 AA. The repository has no browser suite yet ([testing.md](../testing.md)), so this
  slice's build plan introduces one. **No release claims CNT-078 or CNT-139 without both results in its
  evidence.**

## What was ruled out

- **The service as the authority over steps.** It would make a step log load-bearing, which ADR-0012 and
  ADR-0024 both declined as the system of record, and it needs co-editing machinery soft locks deliberately
  avoid.
- **Local-first drafts.** Offline-first is a non-goal, and a draft in the browser's database is somewhere
  VER-002's visibility rule cannot be enforced.
- **An editor toolkit over ProseMirror.** A second schema to keep in step with the first.
- **Our own spellchecker.** It would have met CNT-099 as written; the decision was to keep the native checker
  and supersede CNT-099 and CNT-101 instead.
- **A single-writer session.** CNT-071 and VER-002 would have been broken from the first release.
- **Column resizing.** ADR-0023: accessibility wins where a plugin owns the DOM.
- **Detecting equivalent equations.** Normalising MathML makes identical input store identically; deciding
  that two different MathML trees mean the same thing is a semantic comparison nothing requires.
- **Polling for lock state.** A second path to the same state realtime.md already delivers, with staleness
  of its own.

## Open questions

| ID  | Question                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | The lock's inactivity period. Fifteen minutes is a guess that trades an author losing the lock over lunch against a colleague waiting; COL-008 makes it a tenant setting, and the default wants a customer's view |
| New | The save cadence. Two seconds idle and ten seconds continuous are unmeasured against the service's write budget; the verification above is how they get a number                                                  |
| New | The speech rule engine - which one, its licence and its size. It no longer decides CNT-048, only how often an author types an alternative by hand                                                                 |
| New | Whether a tenant should be able to name a house theme for components opened on their own, rather than the product's default                                                                                       |

## Review

[The review](../reviews/design-reviews/component-editor.md) read the draft against four requirement
documents - CNT, MET, STY and API - and said plainly that it did not have the designs the draft rests on.
**Its points were taken as inputs, not instructions.** Each was checked against the corpus and the other
designs before deciding; where a premise was wrong the row says so, and where a point was right in
substance but aimed at the wrong owner, the change went where the rule lives.

### Content surface

| Point                                          | Decision                                  | Change and reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Foreign paste is plain text only           | **Premise corrected; substance accepted** | CNT-060 to CNT-064, CNT-130 and CNT-131 are designed and claimed by content-model.md's admission pipeline, so no requirement is unmet by design. The real point is that "plain text until the pipeline is built" read as a design choice. It is build order: the pipeline is built in this slice's plan, and nothing ships the interim                                                                                                                  |
| 1.2 Internal copy only implied                 | **Accepted**                              | A new identity table by operation, and an explicit rule that pasted content is re-identified before ProseMirror sees it - so the descent rule never gets the chance to keep a copied identifier. CNT-132 to CNT-135 stay content-model.md's                                                                                                                                                                                                             |
| 1.3 No authoring matrix                        | **Accepted**                              | A table covering every node and mark: what can be created, edited, and where each waits. Hyperlink and language commands added, which the draft had omitted. **Admonitions declined**: they are not in the model, deliberately, and that decision is content-model.md's                                                                                                                                                                                 |
| 1.4 Cross-references and others not insertable | **Accepted as explicit scope**            | CNT-027 to CNT-030 are the model's and designed. Insertion waits for the owner of each target - STR in the document view, LIB, REU, DAT - and the matrix now says so for each                                                                                                                                                                                                                                                                           |
| 1.5 Figures cannot be created                  | **Accepted in part**                      | Existing figures are now edited faithfully: caption, the three alternative-text states, image style, and a marker for an unresolved asset. Creation still waits for the assets design, and the document now says the slice is not T1-complete for figures                                                                                                                                                                                               |
| 1.6 Footnotes under-specified                  | **Accepted**                              | A footnote table for all four anchor kinds - how each is inserted and what each survives - key columns in a table panel, the weaker positional form marked, and the restricted schema made structural                                                                                                                                                                                                                                                   |
| 1.7 Empty paragraphs and minimum blocks        | **Accepted**                              | Three invariants: `block+`, no adjacent empty paragraphs enforced on every transaction, and every iteration parsed before it leaves the renderer and again at the service                                                                                                                                                                                                                                                                               |
| 1.8 Identifier allocation                      | **Accepted**                              | The identity table. Allocation is the renderer's, 128 random bits; mark identifiers are allocated on apply and on paste. **The paste rule for marks extends content-model.md's re-identify stage**, which named blocks only; that document is changed to match rather than this one diverging                                                                                                                                                           |
| 1.9 Caption identity                           | **Premise corrected; found a real gap**   | Identity is the block `id` (CNT-081, designed). But answering this found that captions are plain strings in the model, so CNT-046's equation in a caption cannot be represented. That is raised as #88, not patched in the editor                                                                                                                                                                                                                       |
| 1.10 Equations                                 | **Accepted in part**                      | MathML canonical and LaTeX an input record were already content-model.md's (CNT-043); now stated here. Accepted: the converter pinned, MathML normalised on entry, a placement table, and alternatives generated on load for equations lacking one. **Declined**: detecting semantically equivalent equations, which nothing requires. The engine question is narrowed rather than closed, because CNT-048's "where possible" makes generation optional |

### Session

| Point                                          | Decision                          | Change and reasoning                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Claiming edge cases                        | **Accepted**                      | Held changes are a queue applied in order; a refusal keeps them and offers them as text; no answer in ten seconds returns to Reading with a retry. A metadata value is a change that claims                                                                                                                                                                                                                    |
| 2.2 Metadata in the session                    | **Accepted, with one reversal**   | Values claim, start the save timers, and are kept in session storage. **Restoring an iteration was said to be "undoable"; that is withdrawn**, because ProseMirror's history cannot carry values, and an undo that restored content but not values would produce a state no iteration ever held. Instead the current state is saved as an iteration before a restore, so a restore is recoverable the same way |
| 2.3 Lock visibility for a component on its own | **Accepted**                      | The open question is closed: `GET` returns the lock state, and realtime.md's stream takes a component scope. Polling was ruled out as a second path to the same state                                                                                                                                                                                                                                          |
| 2.4 Second window strands work                 | **Accepted**                      | The window that loses the lock enters Recovery holding its unsent changes, and can move the lock back                                                                                                                                                                                                                                                                                                          |
| 2.5 Iteration sequencing                       | **Accepted**                      | The most important point in the review. One iteration in flight, sequences only increasing, and distinct answers for a retry, a conflict and a stale snapshot; reload reconciles against the service's latest accepted sequence rather than trusting session storage                                                                                                                                           |
| 2.6 Recovery authorisation and restore         | **Accepted as clarification**     | Recovery begins by claiming the lock, because VER-002 makes iterations the holder's; listings are paged within the retention window; restores are whole snapshots, migrated and validated                                                                                                                                                                                                                      |
| 2.7 Failure transitions                        | **Accepted**                      | A failure column on the state table. Neither a cut nor a release goes ahead over unsaved changes                                                                                                                                                                                                                                                                                                               |
| 2.8 Clearing stored steps                      | **Already stated; made explicit** | CNT-103's claim said so; the cut section and the reload rule now do too                                                                                                                                                                                                                                                                                                                                        |

### Metadata

| Point                                            | Decision                                   | Change and reasoning                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Multi-value fields                           | **Accepted**                               | An ordered list input for any `many` field                                                                                                                                                          |
| 3.2 De-provisioned users                         | **Accepted**                               | The picker offers active principals; a departed one is shown as no longer active and stays valid. MET-029 stays unclaimed, because it covers document fields too                                    |
| 3.3 Date and time                                | **Accepted as clarification**              | A named zone in the input, a numeric offset in storage, and a question when a time is ambiguous                                                                                                     |
| 3.4 Validation error shape                       | **Accepted; changed where the rule lives** | metadata.md's failure shape gains a stable `code` and a list of `schemas`, since more than one can require or fix a field. Service refusals use service-foundations' error shape with those members |
| 3.5 Definitions changing mid-session             | **Accepted**                               | A section of its own: the change is detected from each acknowledgement, explained in the panel, and an in-flight refusal is recovered without the author acting                                     |
| 3.6 Title, language and direction after creation | **Accepted**                               | They are attributes of the editor document, so they are steps - saved, undoable and versioned. A language change asks for confirmation. The service refuses a type change in any iteration          |

### API

| Point                                     | Decision                       | Change and reasoning                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 Idempotency keys                      | **Premise corrected; applied** | API-008 is designed in service-foundations.md for every mutating request. The routes that create - a component, a version, a release that cuts - now say they carry one                                      |
| 4.2 Preconditions on every mutating route | **Accepted**                   | Iterations and a release that may cut carry the opened-from version, refused `version.precondition` when stale. API-037 and API-038 stay unclaimed: they are rules for every route                           |
| 4.3 Paging iterations                     | **Premise corrected; applied** | API-007 is designed; the listing takes a cursor, newest first                                                                                                                                                |
| 4.4 Request identifiers                   | **Declined here**              | The error shape already carries `traceId`, and a request identifier on every response is a rule for every route, API-047, which belongs in service-foundations.md rather than in each design that has routes |
| 4.5 Rate limits                           | **Accepted**                   | `Retry-After` is honoured over the client's backoff                                                                                                                                                          |
| 4.6 Authorisation                         | **Accepted**                   | A permission column, and unauthenticated, forbidden and `lock.held` kept distinct                                                                                                                            |
| 4.7 Contract tests                        | **Premise corrected; applied** | API-002 and API-003 are designed. The verification now names contract tests for these routes, asserting error bodies                                                                                         |

### Style, accessibility and verification

| Point                                       | Decision                        | Change and reasoning                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 Which theme a component on its own uses | **Accepted**                    | The review's strongest point after sequencing. The product's default theme, labelled as such; a house theme per tenant is an open question rather than invented configuration                                                                                            |
| 5.2 "Resolves nothing itself"               | **Premise corrected; reworded** | themes.md designs one resolver in `packages/domain` for the editor and the publisher, and its conformance suite is STY-053's. The sentence now points there rather than reading as an assumption                                                                         |
| 5.3 Unresolvable markers                    | **Accepted in part**            | Markers for styles, failed typefaces, unresolved assets and unresolvable targets. **Glyph coverage declined for now**: a browser gives no reliable signal, so STY-070 stays unclaimed on that clause rather than claimed on a guess                                      |
| 5.4 Image style in the editor               | **Accepted**                    | Existing images are sized by the shared resolver; CNT-122 stays unclaimed for its publish half                                                                                                                                                                           |
| 5.5 Table pagination                        | **Accepted as clarification**   | Page-only properties are not simulated (STY-037, themes.md's)                                                                                                                                                                                                            |
| 5.6 Accessibility detail                    | **Accepted**                    | An accessibility section: regions, inline nested editors and where focus returns, announcements, the metadata form. And a release gate: no release claims CNT-078 or CNT-139 without both results                                                                        |
| 5.7 Direction                               | **Accepted**                    | Base direction at creation and in the header; `dir` from the model; logical alignment asked of the theme projection                                                                                                                                                      |
| 6.1 to 6.6 Verification                     | **Accepted in part**            | Invariant property tests, identity after paste, the session's failure edges, contract tests and autosave measurement are added. Paste-drop assertions and style conformance are already the pipeline's and themes.md's suites, and are referenced rather than duplicated |

## Changed while planning the build

[The editor plan](../plans/2026-09-16-editor-01-open-edit-and-save.md) was written against this document
and proved in code before it was built. It builds the first slice of this slice - paragraphs, the lock,
iterations and cutting - and found these places where the document was wrong, unfinished or contradicted
by what was built. No requirement claim changed. Where a finding was not changed here, the row says whose
it is.

| Found                                                                                                                                                                                                                                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nothing could be opened, because nothing listed a component**: "The API" had no listing, and access.md's `GET /v1/spaces` lists spaces only                                                                                                                                          | `GET /v1/components`, for any signed-in caller, filtered by the readable set inside its query and paged by a cursor ("The API")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Done editing sent its opened-from version as the body of a `DELETE`**, which some clients and proxies drop                                                                                                                                                                           | The session and the opened-from version travel in the query ("The API")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **No status said which refusal was which**, and a write from a session whose lock had lapsed or been released had no refusal at all                                                                                                                                                    | `lock.held`, `lock.required`, `version.precondition`, `iteration.stale` and `iteration.conflict` are 409s carrying their members; `lock.required` is new, because `lock.held` names a holder and there is none; content that will not parse is 400 `content.invalid`. The wire spells each of these with an underscore instead of a dot (`lock_held`, `lock_required`, `version_precondition`, `iteration_stale`, `iteration_conflict`, `content_invalid` - decision F, below); the store's own answers, named this way throughout this document, stay dotted, and `apps/service/src/wire-codes.ts` is the one place that maps between them |
| **Where the service keeps each session's latest accepted sequence** was not said                                                                                                                                                                                                       | On the iteration rows themselves, filtered by principal as well as session: a session id is chosen by the client and is not unique per principal, so a second principal reusing the first's session id judges its own sequence alone, never against the first's. There is no second table to keep in step                                                                                                                                                                                                                                                                                                                                   |
| **What a cut promotes when the session has saved nothing since it opened** was not said                                                                                                                                                                                                | `version.unchanged`, as for a digest that matches: there is nothing to cut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Undo across a reload assumes reopening at the latest iteration** (CNT-069), which this slice does not build - so a reload, or a second tab of the same session, could otherwise resend a stale or conflicting sequence and silently overwrite an iteration the service already holds | A stale or conflicting answer never overwrites: the session stops and goes to `lost`, offering what could not be saved as text and a **Continue** control that starts a fresh session from what is on screen; a reload that still holds the lock keeps holding it, and is told the same way if a newer iteration exists - one click back to editing. Older iterations are kept for the recovery plan to read                                                                                                                                                                                                                                |
| **Idempotency keys** are relied on for a cut and a release, and nothing records a response (API-008 is service-foundations.md's and unbuilt)                                                                                                                                           | Not changed. A cut retried after its answer was lost is refused `version.precondition` (`version_precondition` at the wire), naming the version it made; the renderer does not retry a cut. It waits for the idempotency work                                                                                                                                                                                                                                                                                                                                                                                                               |
| **An author granted a space cannot read the component types they must choose from** to create a component, and no tenant default type exists (MET-012)                                                                                                                                 | Not changed: creating a component waits for its own plan, which must extend access.md's "a definition is read through what uses it" to creating, and for MET-012's design                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`administer` confers no content permission, and no route grants one**, so outside development nobody can edit anything                                                                                                                                                               | Not changed: a question for Ken, raised in the plan, and the access management plan's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **The refusal codes here are dotted** (`lock.held`) while every code the service already returns is snake_case (`not_found`)                                                                                                                                                           | **Amended in the build (decision F):** Ken accepted spelling every one of them with an underscore at the wire rather than waiting for service-foundations.md, which still owns the vocabulary for any future code; mapped in one place, `apps/service/src/wire-codes.ts`, so a handler never builds a wire code by string replacement. The store's own answers stay dotted, exactly as this document names them                                                                                                                                                                                                                             |
| **Two windows of one author can strand the loser's work**: moving the lock lets a version be cut from one window's iterations while the other's later saves are never promoted into it                                                                                                 | Not fixed here: the stranded iterations are kept (thirty days, and never swept before a later version exists, VER-003), so nothing is destroyed, but this slice shows neither window that the other's saves exist. Raised for the session's next plan, named in [`docs/plans/README.md`](../plans/README.md) (see "Two windows, one author", above)                                                                                                                                                                                                                                                                                         |
| **Requests are validated more strictly than written**: a session id and an opened-from version are lowercase UUIDs, and a request body refuses a member it does not declare                                                                                                            | Amended in the build: an uppercase UUID or an unrecognised body member is a 400 refusal rather than a request the service might otherwise accept and then fail to match against a lowercase-stored id                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Whether a cut is `version.unchanged` depends on whether the session saved, not on whether the content differs from the latest version**                                                                                                                                              | If the session saved nothing since it opened, the answer is `version.unchanged` outright. If it saved an iteration, the version's digest (ADR-0024) covers the content, the values and the definitions carried forward together - so a session whose typed content is identical to the latest version still cuts a new one when a definition changed underneath it, because the digest no longer matches                                                                                                                                                                                                                                    |
| **A pause longer than the lock period ended the session with no way back**: only an accepted iteration extends the lock, so the next save, cut or release after fifteen minutes idle is refused `lock.required`, and this slice has no Recovery                                        | Amended in the build: a write refused `lock.required` claims the lock again once under the same session - Recovery's own first step - and is sent once more, its sequence continuing; a claim that finds somebody else holding it, or a second refusal, stops as before. A heartbeat keeping an idle open tab's lock is COL-008's plan's to decide                                                                                                                                                                                                                                                                                          |

[The second editor plan](../plans/2026-09-17-editor-02-creating-a-component.md) was written against this
document in turn, and found ten more; building it, and reviewing each task, found two. No requirement
claim changed except CNT-149's, which is new (issue #115): nothing in the corpus asked for creating a
component at all. The two the build found are marked as such.

| Found                                                                                                                                                                                                                         | Change                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No environment held a component type**, so MET-011's choice had nothing to choose and nothing outside development could be created                                                                                          | Every environment starts with one, _Topic_, assigning no schemas, written by migration 0015 beside the eight roles and _General_, with the row that declares it the default beside it                                                                                                                          |
| **An author granted a space still could not read the component types they must choose from** (editor 1's finding 4, which access.md and metadata.md had not answered)                                                         | "Creating a component" now reads them through `GET /v1/spaces/{space}/component-types`, decided by `create` on that space; access.md's rule is extended to say so, and "The API" gains the route, which it had never listed                                                                                    |
| **"The API" had no way to see where a component could be created**                                                                                                                                                            | `GET /v1/spaces`, which access.md had already designed and no plan had built, listed here too                                                                                                                                                                                                                  |
| **Creating answers `200`, not `201`**: a permission-checked handler is given no reply and cannot set a status                                                                                                                 | Said here; what every route answers is service-foundations.md's (API-005)                                                                                                                                                                                                                                      |
| **A BCP 47 picker cannot be built** until LOC-038's declared list exists                                                                                                                                                      | The base language is typed and checked against the content model's own rule; the picker, and the direction defaulting from the language's script, wait for LOC                                                                                                                                                 |
| **Changing the base language asks for no confirmation**, because this editor has no language marks and no spellcheck rule to recompute                                                                                        | Said here; the confirmation arrives with the language mark                                                                                                                                                                                                                                                     |
| **The header's fields needed no route, no body member and no contract change**: they are attributes of the editor's root, so they travel in the whole content document an iteration already carries                           | Said here, under "Creating a component"                                                                                                                                                                                                                                                                        |
| **A cleared title or a tag that is not a tag would throw inside the session's save path**                                                                                                                                     | The header's three commands refuse rather than dispatch, so the document is never one `fromEditor` cannot serialise                                                                                                                                                                                            |
| **Built: a title of whitespace alone passes the content model's own rule**, which is `min(1)` and does not trim                                                                                                               | Refused at creation and on every edit alike, and what is stored is the trimmed form - one agreement, so a created title and an edited one can never disagree                                                                                                                                                   |
| **Built: a field showing the title or the language cannot mirror the document back as it is typed**: the model trims one and refuses an unfinished tag, so the field would eat an interior space and could never finish a tag | Said here, under "Creating a component": a field holds what was typed and gives way only when the document's own value differs from the one that field last heard                                                                                                                                              |
| **A retried create makes a second component** (API-008 again)                                                                                                                                                                 | Not changed: this route was written as carrying an `Idempotency-Key` and no route in the service honours one. The claim is withdrawn from "The API" and named as the gap it is; the renderer sends one create and disables **Create** while it is in flight, which covers a second click and not a lost answer |
| **Nothing in the corpus asked for creating a component**                                                                                                                                                                      | CNT-149 filed through the requirement form (issue #115) and claimed here                                                                                                                                                                                                                                       |
