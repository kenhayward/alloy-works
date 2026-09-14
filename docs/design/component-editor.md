# The component editor and its editing session

> **Status: DRAFT for review.** Committed as it stood when handed over, so `git diff` shows exactly
> what changed. Edit anything directly; where you want to say something rather than change it, add a
> line starting `> **Ken:**` under the paragraph or table it is about.

Editing one component, end to end: the surface an author types into, the lock that makes them the one
editing it, continuous saving, cutting a version, and the component's type and metadata alongside its
content.

This is the first slice of the editor. It rests on [ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md)
(ProseMirror, one view per component), [content-model.md](content-model.md) (what is stored),
[storage-and-versioning.md](storage-and-versioning.md) and [ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md)
(iterations, versions and the digest), [metadata.md](metadata.md) (which fields apply and what is
valid), [themes.md](themes.md) (how it looks) and [realtime.md](realtime.md) (how others learn of the
lock). **The document view** - many components in one scroll, the read, review and author modes,
choosing which version a reference points at, and preview - is the next slice, designed once the
outline (STR) and the publishing pipeline are.

## The shape in one paragraph

The renderer holds the editor state. A component opens read-only; the first change an author makes
claims the component's **lock**, and the change is held rather than lost while the claim is answered.
Every change after that is sent, after a short pause, as an **iteration** - a whole snapshot of the
content and the metadata values, carrying the lock - and the author is told plainly whether it arrived.
The steps of the session are kept in the browser's session storage, so undo survives a reload. A
**version** is cut only by a positive act: **Save version**, or **Done editing**, which also releases
the lock. A lock that times out cuts nothing, and its iterations wait to be recovered. Beside the
content, the component's type decides its fields, and validation runs as values change.

## Requirements owned

| ID          | How it is met                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-066** | After a pause in changes the renderer sends the whole content and values as an iteration; there is no save action for drafts                                                        |
| **CNT-067** | The renderer reports a change saved only when its iteration is acknowledged, so reopening after any interruption offers that iteration or a later one                               |
| **CNT-068** | A save indicator with three states - saved, saving, not saved and retrying - with the time of the last acknowledged save; the change to not saved is announced                      |
| **CNT-069** | One `prosemirror-history` per component; the session's steps are kept in `sessionStorage` and replayed into a fresh history on reload, back to the version the session opened from  |
| **CNT-103** | Cutting a version clears the history and the stored steps, so undo never reaches past a version                                                                                     |
| **CNT-070** | A version is cut by **Save version** or **Done editing** and by nothing else - not a keystroke, a timer, a lost connection or a timeout                                             |
| **CNT-089** | The session never promotes an iteration on its own; iterations are rows the storage design keeps immutable and visible only to the lock holder (VER-001 to VER-003)                 |
| **CNT-090** | A **Recovery** panel lists the component's retained iterations to its lock holder, and restoring one makes it the current content of the session - as an edit, undoable             |
| **CNT-071** | Every write in the session - iteration, version, release - carries the lock, and nothing here assumes the author is the only one who could write                                    |
| **COL-005** | The lock is claimed by the first change an author makes, not by a separate act; the change waits for the claim rather than being refused                                            |
| **COL-006** | The lock gates writes to the component and nothing else: reading it, and later commenting and suggesting, never ask for it                                                          |
| **COL-008** | A lock expires after a period without saved changes - provisionally fifteen minutes - which is a tenant setting; each acknowledged iteration extends it                             |
| **COL-010** | **Done editing** releases the lock and cuts a version of what changed; a lock expiring cuts nothing                                                                                 |
| **COL-011** | The lock is a row per component; nothing locks a document                                                                                                                           |
| **API-039** | The service checks the lock on every mutating component request and refuses one from anybody but the holder, naming the holder and the expected release                             |
| **MET-011** | Creating a component requires a component type, offered with the tenant's default preselected; the version row's type column is not nullable                                        |
| **MET-033** | A fixed field is read-only in the panel, naming the schema that fixes it, and the service refuses an iteration whose value for it differs from the default, naming field and schema |
| **CNT-057** | An insertion palette of mathematical, Greek, and scientific and technical symbols, as a keyboard-navigable grid that inserts characters                                             |
| **CNT-077** | Every command is in a keymap and in the toolbar; the toolbar is a single tab stop with arrow-key movement, and `F6` moves between the surface, the toolbar and the metadata panel   |
| **CNT-048** | An equation's alternative is generated from its MathML when it is entered and stored as the MathML `alttext`, editable in the equation's panel                                      |
| **CNT-080** | Equations render as native MathML carrying `alttext`, which assistive technology reads                                                                                              |
| **CNT-098** | The surface sets `spellcheck`, so the delivery's own checker marks spelling as the author types                                                                                     |
| **CNT-147** | A run carrying a language mark whose language differs from the component's base language is rendered with `spellcheck="false"`, so a passage in another language is never flagged   |
| **CNT-148** | The web delivery uses the browser's checker; the desktop shell enables the base languages of the components open, through one platform bridge call, so neither lacks a checker      |

**CNT-147 and CNT-148 are new, and the change they come from is part of this design's review.** Native
spellcheck ignores an element's `lang`, in Chromium and in Firefox, so CNT-099 - check each run against
its own language - and CNT-101 - the browser supplies the checker - could not both be met. The decision
was to keep the native checker, so CNT-099 is superseded by CNT-147 and CNT-101 by CNT-148, which say
what native checking can honestly promise. In the web delivery that is less than it sounds: a page
cannot choose which dictionaries the browser uses, so a component in a language the author's browser
has not enabled is checked against whatever it has.

## What this document does not own

| Left unclaimed            | Why                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-035                   | Every CNT-031 mark from toolbar and keyboard includes **defined term**, whose control needs a term to choose, and terms are LIB's T6 library. The other seven marks are designed here |
| CNT-078, CNT-139          | WCAG 2.2 AA and its verification are for the editor as a whole, and half of the editor is the document view, not yet designed. This slice is built to it and tested against it        |
| CNT-079                   | Headings are outline nodes, rendered by the document view. Lists, tables and footnotes are exposed as structure here                                                                  |
| CNT-074                   | Which component the cursor is in is the document view's; this slice shows the lock state of the one component open                                                                    |
| MET-021                   | The metadata panel runs validation as values change, for a component. MET-021 replaced TPL-038 and covers a document's and a section's fields too, which the document view edits      |
| CNT-045, CNT-046, CNT-049 | Rendering an equation in PDF and Word, and in a heading or a caption, are the publisher's and the document view's                                                                     |
| CNT-113, COL-026          | Seeing what this session changed needs the comparison algorithm, which [storage-and-versioning.md](storage-and-versioning.md) leaves for its own design                               |
| COL-007, API-036          | Showing a held lock to others and delivering the change are [realtime.md](realtime.md)'s                                                                                              |
| COL-009                   | Taking a lock from an idle holder, with a warning and an audit, is not in the minimal lock. The row supports it; the act is not designed                                              |
| API-037                   | The version precondition is honoured below, but it is a rule for every versioned resource, not something this design is the realisation of                                            |
| STY-070                   | An unresolvable style shows its marker from the theme projection; an unresolvable glyph needs font coverage the editor does not yet have                                              |

## Where the code lives

| Where                   | What                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/editor`       | New. The ProseMirror schema, the mapping to and from the stored model, plugins, commands, keymaps and node views. Browser code, no React |
| `apps/web`              | A thin React component that mounts one `EditorView`, the toolbar, the metadata panel, the save indicator and the session state machine   |
| `packages/domain`       | Unchanged in role: the content model and [metadata.md](metadata.md)'s rules, imported by both the renderer and the service               |
| `packages/api-contract` | The routes below                                                                                                                         |
| `apps/service`          | The routes, the lock, iterations and versions, per [storage-and-versioning.md](storage-and-versioning.md)                                |
| `apps/desktop`          | One bridge call to set the platform checker's languages (CNT-148), decided in `shell.ts` as a pure function                              |

**`packages/editor` is a workspace rather than a folder in `apps/web`** because most of it is testable
without a browser: `prosemirror-model` and `prosemirror-state` run in Node, so the mapping, the identity
plugin and every command are tested there. Only node views and the view itself need a DOM.

**No editor toolkit sits on top of ProseMirror.** A toolkit brings its own schema and extension model,
and this product already has a schema - two definitions of one document are two things to keep in
agreement for ever. ADR-0023 said a toolkit is a separate, reversible choice; this design takes the
choice not to.

## The surface

**The schema is the stored model's, mapped losslessly.** Every node and mark in content-model.md has a
ProseMirror counterpart, and `toEditor` and `fromEditor` are total and inverse. The one difference the
spike found is kept: a block's `id` has a default of `null` in the editor schema, because ProseMirror
must be able to generate a paragraph, and the identity plugin fills it. `fromEditor` refuses a `null`
identifier, so an unidentified block can never reach storage.

**Identity is ADR-0023's plugin, unchanged**: a block at its identifier's forward-mapped position, with
association 1, descends and keeps it; every other block holding that identifier is re-identified.

| Content                                          | In the editor                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Paragraph styles                                 | A style picker offering the theme's allowed paragraph styles (STY-033). No alignment, spacing or typeface control (CNT-094)    |
| Character marks                                  | Toolbar buttons and platform shortcuts for emphasis, strong, underline, subscript, superscript, inline code and quoted phrase  |
| Lists                                            | Three kinds, nesting by `Tab` and `Shift-Tab`, start and format on an ordered list                                             |
| Tables                                           | `prosemirror-tables` with ADR-0023's accessible `toDOM` - `scope` on header cells, a `<caption>` - and **column resizing off** |
| Equations                                        | A node view rendering MathML; editing opens a LaTeX field converted to MathML as you type, with the LaTeX kept (CNT-043)       |
| Footnotes                                        | A node view holding a nested editor for the note's paragraphs, as in ProseMirror's footnote pattern                            |
| Figures and images                               | Rendered from their asset. **Inserting one waits for the assets design**: nothing yet ingests an asset to insert               |
| Cross-references, citations, variables, bindings | Rendered as atoms naming what they point at. Inserting each waits for the design that owns its target - STR, LIB, REU, DAT     |
| Symbols                                          | The insertion palette (CNT-057)                                                                                                |

**Column resizing is off because ADR-0023 made accessibility win.** The resizing plugin's node view owns
the table's DOM and ignores `toDOM`, so it cannot emit the `<caption>` TAB-039 requires. A table's
widths are the theme's.

**Equations are native MathML.** Chromium renders MathML Core, and Electron is Chromium, so there is no
typesetting library in the editor and nothing to disagree with the publisher about except the MathML
itself. LaTeX is converted by a converter that emits MathML - Temml is the candidate, being small and
MIT-licensed - and the alternative text is generated from the MathML by a speech rule engine, loaded
only when an equation is being edited, because it is large.

**The theme is `projectCss`** (themes.md), scoped to the component's container, with the tenant's
typefaces. The editor resolves nothing itself (STY-035).

**Paste goes through the admission pipeline** content-model.md designs - read, sanitise, migrate,
normalise, re-identify, validate - through ProseMirror's `transformPasted`, and the report is shown
when anything was dropped. Until the pipeline is built, the editor accepts plain text only rather than
admitting anything unsanitised.

## The session

| State         | Means                                                         | Leaves by                                                                                      |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Reading**   | Open, not held. Selecting and copying work; changing does not | A change → Claiming                                                                            |
| **Claiming**  | The first change is held while the lock is requested          | Granted → Editing, with the held change applied. Refused → Reading, naming the holder          |
| **Editing**   | This session holds the lock. Changes are saved as iterations  | Save version → Cutting. Done editing → Releasing. Lock lost → Recovery                         |
| **Cutting**   | Unsent changes are flushed, then the version is requested     | Cut, or nothing to cut → Editing, history cleared                                              |
| **Releasing** | Flushed, a version cut if anything changed, the lock released | → Reading                                                                                      |
| **Recovery**  | The lock expired or was taken while changes existed           | The author restores an iteration after claiming again, or discards the session's unsaved steps |

**Claiming waits rather than refuses.** COL-005 wants claiming to be automatic on beginning to edit. An
editor that refused the first keystroke and asked the author to type it again would make claiming a
separate act in all but name. So the first change is held - the surface shows that editing is starting

- and applied when the lock is granted, normally within a round trip.

**Saving.** After two seconds without a change, or every ten seconds during continuous typing, the
renderer sends an iteration: the whole content and values, the lock's session, and a sequence number.
The service inserts it unless that session and sequence are already stored, so a retry never makes two
rows. The indicator says **saved** when the latest sequence is acknowledged, **saving** while one is in
flight, and **not saved, retrying** once a save has failed for ten seconds - with backoff to thirty
seconds between attempts, and every unsent step still in session storage.

**Undo across a reload.** Session storage holds, per component and lock session, the version the
session opened from, the document at that point, and every step since, with the history's grouping. On
reload, if the service confirms this session still holds the lock and the version is unchanged, the
steps are replayed into a fresh editor state with history, so undo reaches back exactly as far as it
did. If the lock is gone, the session enters Recovery.

**Undo covers content, not metadata.** ProseMirror's history is the document's. A metadata field is an
ordinary input with its own undo, and folding value changes into the content history would make one
`Ctrl-Z` undo an edit the author cannot see from where the cursor is.

**Two windows, one author.** The lock belongs to a principal and an editing session. A second window of
the same author finds the component held by its own other session and is told so, and may **continue
here**, which moves the lock to the new session. Iterations stay visible to that author, because the
holder is the principal (VER-002).

## Cutting a version

**Save version** takes an optional note (VER-007). The renderer flushes unsent changes, then asks for a
version from the latest acknowledged iteration, stating the version the session opened from.

The service, in one transaction: checks the lock; refuses if the component's latest version is not the
one stated, which cannot happen while the lock is held and is checked anyway (API-037); loads the
current definitions (`definitionsFor`, metadata.md); carries the values forward (`carryForward`);
computes the content hash and the version digest (ADR-0024); **refuses with `version.unchanged` if the
digest equals the latest version's**; and inserts the version with its `version_definition` rows.

**Nothing to cut is not an error to the author.** Save version with no change says so and does nothing.
Done editing with no change releases the lock and cuts nothing - COL-010's "releasing cuts a version"
has nothing to cut, and ADR-0024 refuses a version that says nothing new.

**Values that will not be carried are shown before the cut.** If the current definitions no longer
include a field that holds a value, the author is told which values the version will leave behind,
by field, before confirming (MET-036).

## Metadata alongside

The **metadata panel** sits beside the surface in the same view. It shows the component's type -
read-only in T1, since changing it is MET-014, T2 - and its effective fields in resolution order
(metadata.md), each with its data type's input: text, a decimal input that keeps the string entered,
date, time, date and time with a zone, a switch, and a user picker over the tenant's principals.

- **Required** fields are marked, naming the schema that requires them.
- **Fixed** fields are read-only, naming the schema that fixes them (MET-033).
- **Validation runs on every change** (MET-021), in the renderer, with the same `validate` the service
  and the publisher use.
- **Values are part of the iteration**, so they autosave, recover and version with the content.

**The service refuses only what cannot be stored honestly.** An iteration is refused if a fixed value
differs from its default (MET-033) or a value is not the JSON its data type takes. Every other failure -
a required field left empty, a pattern not matched - is saved and shown, and fails the publish
(MET-023). An author mid-draft is never blocked from saving.

## Creating a component

A title, a base language (a BCP 47 picker), and a component type, with the tenant's default preselected
(MET-011). Creating inserts the artifact and version `0.1`: one empty paragraph (CNT-124), every fixed
field at its default and every other default applied (metadata.md). Creation is itself a positive act,
so every component has a version from the moment it exists, and a baseline can pin it.

## The API

| Route                                                | Does                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/components`                 | Creates a component and its version `0.1`                                                               |
| `GET /v1/components/{id}`                            | The latest version, its values, and the effective fields for authoring                                  |
| `POST /v1/components/{id}/lock`                      | Claims the lock for an editing session, or moves it to a new session of the same principal              |
| `DELETE /v1/components/{id}/lock`                    | Done editing: cuts a version if anything changed, then releases                                         |
| `PUT /v1/components/{id}/iterations/{session}/{seq}` | Saves an iteration; idempotent on session and sequence                                                  |
| `GET /v1/components/{id}/iterations`                 | Retained iterations, to the lock holder only                                                            |
| `POST /v1/components/{id}/versions`                  | Cuts a version from the latest iteration, with an optional note and the version the session opened from |

Every mutating route refuses a request from anybody but the lock holder with the structured error
contract (API-005, API-006), naming the holder and the expected release (API-039). Lock changes notify
through [realtime.md](realtime.md)'s row-and-notify path.

## Verification

- **The mapping round trip, as a property test**: generated content documents survive `toEditor` then
  `fromEditor` unchanged, in Node. This is the test content-model.md named as arriving with the editor.
- **The spike's identity assertions become real tests**, the paste, split and join cases among them.
- **The session state machine against a hand-written fake service**: a claim refused, a claim granted
  with the held change applied, saves retried without duplicates, a lock lost mid-edit, undo after a
  reload.
- **Service tests for every refusal**: another holder (API-039), an unchanged version, a changed fixed
  value, a stale opened-from version; and a timeout that cuts nothing while a release cuts one (COL-010).
- **Desktop**: the shell's language choice tested as a pure function in `shell.ts`.
- **Accessibility** is built to WCAG 2.2 AA and needs a browser to verify - an automated suite in CI and
  a recorded manual audit (CNT-139). The repository has no browser suite yet
  ([testing.md](../testing.md)), so this slice's build plan introduces one.

## What was ruled out

- **The service as the authority over steps.** It would make a step log load-bearing, which ADR-0012 and
  ADR-0024 both declined as the system of record, and it needs co-editing machinery soft locks
  deliberately avoid.
- **Local-first drafts.** Offline-first is a non-goal, and a draft in the browser's database is somewhere
  VER-002's visibility rule cannot be enforced.
- **An editor toolkit over ProseMirror.** A second schema to keep in step with the first.
- **Our own spellchecker.** It would have met CNT-099 as written; the decision was to keep the native
  checker and supersede CNT-099 and CNT-101 instead.
- **A single-writer session.** CNT-071 and VER-002 would have been broken from the first release.
- **Column resizing.** ADR-0023: accessibility wins where a plugin owns the DOM.

## Open questions

| ID  | Question                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | **Where a component opened outside any document hears about its lock.** realtime.md's stream is one per open document. This slice edits a component on its own, so either the stream gains a component scope or others see the lock only once the document view exists |
| New | The lock's inactivity period. Fifteen minutes is a guess that trades an author losing the lock over lunch against a colleague waiting; COL-008 makes it a tenant setting, and the default wants a customer's view                                                      |
| New | The save cadence. Two seconds idle and ten seconds continuous are unmeasured against the service's write budget                                                                                                                                                        |
| New | The speech rule engine's size and licence, which decide whether generated equation alternatives load on demand or not at all                                                                                                                                           |
