# Editor 5: block quotations and preformatted text

> **For agentic workers:** execute this plan task by task, test first, one commit per task. Every task
> names its expected RED failure; run it and see that failure before writing the code that fixes it.
> **This plan is a sketch, by request**: it gives paths, signatures, values, strings and test cases,
> and no implementation. Where it names a signature, use it exactly - a later task depends on it and
> its implementer sees only their own task.

**Goal:** an author can write a block quotation, with an optional attribution, and a preformatted
block, with an optional language label and its whitespace kept exactly, from the toolbar or the
keyboard, and publish both to a tagged PDF: `BlockQuote` for the quotation, `Code` for the
preformatted block, set in a pinned monospace face.

**Architecture:** no stored shape changes kind - `preformattedNodeSchema` and `blockquoteNodeSchema`
already exist and nothing moves `CURRENT_SCHEMA_VERSION` or the migration chain. What changes in the
model is **six narrowings** the walk must hold before anything stores a quotation or a preformatted
block (decision G). The glyph check becomes **face-aware** - `covers(codePoint, 'body' | 'code')` -
with Liberation Mono pinned beside Liberation Serif (decision A). The editor gains three node types,
`preformatted`, `blockquote` and `attribution`, two registry rows and a panel; the published document
becomes `publishing/5` and a new immutable template, `publication/5`, sets both.

**Tech stack:** TypeScript, zod, ProseMirror (`prosemirror-commands`' `newlineInCode` and `exitCode`,
no new dependency), React, Typst 0.15.1 pinned, Liberation Serif and Liberation Mono 2.1.5, pdf.js,
veraPDF 1.30.2 by digest.

**Spec:** CNT-018 (`pnpm trace show CNT-018`), CNT-019 (`pnpm trace show CNT-019`).
**Designs:** [content-model.md](../design/content-model.md) (both nodes, and the narrowings this
plan adds), [component-editor.md](../design/component-editor.md) (the authoring matrix, the
invariants, the regions), [publishing.md](../design/publishing.md) (build order item 3, the faces).

**Version:** 0.34.0 - a functional enhancement. Not bumped on the planning branch.

**Issues filed while planning:** [#162](https://github.com/kenhayward/alloy-works/issues/162) (the
PDF's text layer carries no leading whitespace and no tab),
[#163](https://github.com/kenhayward/alloy-works/issues/163) (the attribution and the language label
have no structure role of their own), [#164](https://github.com/kenhayward/alloy-works/issues/164)
(a preformatted line inside a list is held to a conservative measure). Filed at plan review:
[#165](https://github.com/kenhayward/alloy-works/issues/165) (a line wider than the page refuses the
whole publish, and common code widths exceed it).

---

## Global constraints

Copied verbatim from `CLAUDE.md` and the lists plan; each is binding on every task.

- **TDD.** Write the failing test first, watch it fail, then write the minimal code to pass. No
  production code without a failing test that preceded it.
- **Keep test output pristine** - a passing run has no errors or warnings. A test that provokes noise
  on purpose calls `allowConsoleNoise()`.
- **Name the requirement a test verifies in its `describe` or `it` title**, and only where the test's
  own body demonstrates the statement in full. Plain `it`/`describe`, never `it.each`. **One citation
  of one identifier per file**: `packages/trace/src/parse/citations.ts` keeps the first line and
  drops the rest, so a second, over-claimed citation in one file is invisible to `pnpm trace pins`.
- **No em/en dashes in user-facing text.** A plain hyphen `-` in all UI strings, catalogues, changelog
  entries and user-visible copy. Code, comments and internal docs are exempt. **This includes
  anything a template prints**: see decision D.
- **Never put real user data in the repo.** Invented fixture names only: Ada, Grace, Alice.
- **No raw control characters in source** - write `\u{9}`, `\u{A}`, `\u{D}` and so on, in fixtures
  too. This slice is about whitespace-significant text: a literal tab in a test file is the first
  thing prettier or an editor will silently change. A `'\t'` or `'\n'` escape is fine; a pasted tab is
  not.
- **`<StrictMode>`.** Every `apps/web` test renders under it, and every test touching the ProseMirror
  view first awaits the surface: `await screen.findByRole('textbox', { name: 'Content of ...' })`.
- **`packages/editor` runs in Node.** No `document`. A `toDOM` result is asserted as the spec array.
- **Affected suites only:** `pnpm --filter <pkg> test` for `@alloy-works/domain`, `editor`, `web`,
  `worker`, and `api-contract` where the contract moves. Never the root `pnpm test`,
  never `pnpm test:e2e`, never `docker compose up`. `pnpm --filter <pkg>` bypasses Turborepo, so
  build `@alloy-works/domain` first (`pnpm --filter @alloy-works/domain build`) whenever a later
  package reads a domain change.
- **`fetch-typst` and `fetch-verapdf`** once, before task 8.
- **Order after any edit that touches a test title or a design:** `pnpm exec prettier --write <paths>`
  -> `pnpm --filter @alloy-works/trace generate` -> `pnpm trace pins`. Never generate before prettier.
- **Stage explicit paths.** Never `git add -A`. Never touch `AGENTS.md`.

---

## What was measured before this plan was written

Four questions, each answered by the smallest compile or script that answers it. Every spike file
was deleted. Pages were compiled with the pinned `typst.exe` 0.15.1, `--ignore-system-fonts
--ignore-embedded-fonts --pdf-standard ua-1`, Liberation Serif and Mono 2.1.5 alone on the font path,
and read with pdf.js (roles, text items, positions) and the pinned veraPDF.

### 1. What a reader is told a quotation and a preformatted block are

| Built as                                             | Roles, as pdf.js reads the structure tree                            | veraPDF   |
| ---------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| `raw(block: true, ...)`, five non-blank lines        | `Code` holding one `P` per line; a blank line has no `P`             | compliant |
| `quote(block: true)[...]`, two paragraphs            | `BlockQuote` holding `P`, `P`                                        | compliant |
| the same with the attribution set by the template    | `BlockQuote` holding `P`, `P`, `P` - the attribution is a `P`        | compliant |
| `quote(block: true, attribution: [Ada])[...]`        | `BlockQuote` holding a `Span`, text **`— Ada`** right-aligned        | compliant |
| a quotation inside a quotation; either inside a list | `BlockQuote` inside `BlockQuote`; `Code` and `BlockQuote` in `LBody` | compliant |
| the language label as `text(size: 8pt, label)` above | **`Span` directly under `Document`**                                 | compliant |

**So both get the role the format has** - `Code` and `BlockQuote` are PDF 1.7 types PDF/UA-1 knows,
unlike the definition list's missing `DL`. (`outputMapping` in
`packages/domain/src/content/model/mapping.ts` says "P holding Code"; it is the other way round, and
task 2 corrects the row.) **Two things are weaker than they look**, and both are #163: the
attribution is one more paragraph of the quotation, because PDF 1.7 has no attribution role; and the
label is a stray `Span`. And **Typst's `quote(attribution:)` writes U+2014 before the attribution and
tags it a `Span`** - never use it (decision D).

### 2. Whether `raw` keeps whitespace exactly

- **Leading spaces and blank lines: kept on the page.** `"  two spaces"` starts two columns in; two
  blank lines leave exactly three line steps (11.5 pt each) between their neighbours; runs of spaces
  inside a line keep their width.
- **Tabs: not what `tab-size` says.** Without a language, `tab-size: 4` and `tab-size: 8` both set
  `"\tfour"` two columns in and `"ab\tc"` with `c` at column 4 - the parameter has no effect. And a
  language cannot be given (the lists plan, spike 1: `lang:` deletes whitespace and colours tokens).
  So **no tab ever reaches the template**: `assemble` expands them (decision E).
- **The text layer is not the page (#162).** pdf.js finds no characters for a line's leading
  whitespace - its first word simply starts further right - and a tab reads as spaces. Visible
  whitespace is exact; extractable whitespace is not.
- **A long line is content loss.** 150 `x` with no space ran from x = 70.9 to 599 on a 595-point page
  - past the margin and off the paper, with no error and no warning. A long line with spaces
    **wraps**, which a reader cannot tell from a line the author broke. Both are wrong for CNT-018, so
    a line wider than its place is refused (decision F).
- **The measure is computable.** Liberation Mono advances 1229/2048 em; at Typst's `raw` size, 0.8 em
  of 11 pt = 8.8 pt, that is 5.2809 pt a column, measured as 5.28 on the page. Default layout: text
  block 595.28 - 72 - 72 = 451.28 pt, less a 6 pt panel inset each side = 439.28, so **83 columns**.
  83 `x` compiled on one line inside the panel (ending at 516.3, the panel's inner edge 517.28); 84
  tripped a `layout`/`measure` assertion in the template.
- **Indents, for the measure at depth:** a quotation indents its body 11 pt (1 em). A bulleted item's
  body starts 9.4 pt in. A numbered item's body starts after its marker, which is as wide as its
  number: `xxxviii.` 39.4 pt, `dccclxxxviii.` 62.6 pt, `zz.` 18.0 pt, `99999.` 35.8 pt. A term's
  definition hangs 22 pt (2 em).
- **U+000B, U+000C, U+0085 and U+2028 each break a `raw` line**, like U+000A. A stored preformatted
  text holding one is a second spelling of a line break (decision G).

### 3. Liberation Mono's coverage against Liberation Serif's

Measured through `codePoints` in `apps/worker/src/cmap.ts`, as `loadPinnedFonts` measures:

| Set                                                | Code points |
| -------------------------------------------------- | ----------- |
| The four Serif faces, intersected (today's covers) | **2,321**   |
| The four Mono faces, intersected                   | **2,305**   |
| Mono Regular alone                                 | 2,305       |
| In Mono and not in Serif                           | **0**       |
| In Serif and not in Mono                           | **16**      |

The sixteen: U+0237 (dotless j), U+2000 to U+2006 and U+2008 to U+200A (the typographic spaces),
U+200B, U+2016 (double vertical line), U+202F (narrow no-break space), U+F004 and U+FFFC. U+200B is
exempt through `SET_WITHOUT_A_GLYPH`. **Mono is a strict subset**, so the `body` set is unchanged
and the `code` set is the body set less those sixteen. The test cases write themselves: U+2016 in a
paragraph publishes; in preformatted text or an inline code run it is refused.

**And the engine does not refuse it on its own.** With Typst's default `fallback: true`, `raw`
containing U+2016 **compiled** - the engine quietly set that one glyph from Liberation Serif, which
breaks the column. With `fallback: false` it refused: `the text "‖" could not be displayed with font
"Liberation Mono"`. So the template sets `fallback: false` on `raw` and `assemble`'s face-aware check
refuses first (decision C). This is also the measured reason decision A is right and a union
predicate would be wrong.

The release archive the pinned serif faces came from (`liberation-fonts-ttf-2.1.5`) was checked:
its `LiberationSerif-Regular.ttf` hashes to the pinned
`058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74`. Its mono faces hash:

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `LiberationMono-Bold.ttf`       | `bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb` |
| `LiberationMono-BoldItalic.ttf` | `79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130` |
| `LiberationMono-Italic.ttf`     | `605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1` |
| `LiberationMono-Regular.ttf`    | `f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1` |

`apps/worker/fonts/LICENSE-Liberation.txt` already names Cousine, the face Liberation Mono derives
from, under the same SIL OFL 1.1 (ADR-0010). No licence file changes.

### 4. How the preformatted node behaves in the editor

Read from `prosemirror-commands` 1.7.2 and `prosemirror-schema-list` 1.5.1 and the three plugins in
`packages/editor/src/state.ts`; nothing needed running.

- **Own node spec, not `prosemirror-schema-basic`'s `code_block`.** That package is not a dependency,
  its node is named `code_block` where the stored model says `preformatted`, and it has no `id` or
  `language` attribute. What is worth copying from it is two lines: `code: true` and
  `parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }]`.
- **Enter, the trap this slice would have shipped.** Today `Enter` is
  `chainCommands(listAwareEnter, enterWithoutEmpties)`, bound ahead of `baseKeymap`. In a preformatted
  block **inside a list item** `splitListItem` sees a list item as the grandparent and **splits the
  item**; at the top level `splitBlock` splits the block. `baseKeymap`'s `newlineInCode` never runs.
  So `newlineInCode` goes **first** in the chain (task 5).
- **Tab, the same trap:** `Tab` is bound to `nestItem`, so in a preformatted block inside a list item
  Tab would nest the item. A tab-inserting command goes first (task 5).
- **Leaving:** `exitCode` (bound in `baseKeymap` to `Mod-Enter`) makes a paragraph after the block
  and moves there. It stays reachable because nothing ahead of `baseKeymap` binds `Mod-Enter`.
- **`adjacentEmpties`**: a `preformatted` is in the `block` group and is never an empty paragraph, so
  it separates two empty paragraphs - exactly as `refuseAdjacentEmpties` treats it. It descends into
  a `blockquote` because that is in the group too; `attribution` is not, so it neither pairs nor
  separates, like `term`. **No change**; pin it.
- **`annotationsInOnePiece`**: `spansOf` joins two runs when `doc.textBetween` between them is empty.
  A preformatted block with text between two pieces of one annotation makes them two; the model's
  `claimRange` today **does not** (the walk never looks inside a preformatted block). The editor is
  the stricter side, so a save cannot fail on it, but the two rules disagree and the model's is the
  one that can still be changed for free - decision G, narrowing 6.
- **`refusePastTheLimit`/`tooDeep`** count list levels only. A quotation costs two levels of JSON
  depth (the node, its `content`) and quotations nest; decision L.
- **The walk order**: `checkBlock` walks a blockquote's **attribution before its content**. The editor
  holds them the other way round, so an annotation running from the paragraph before a quotation into
  its body, in a quotation with an attribution, is one piece to the editor and **refused** by the
  model - on save, through `saveIteration`'s fixed message. Decision G, narrowing 2.

---

## Decisions

Each is threaded into the task that builds it; the task repeats what it needs. **A, C and D are
Ken's or measured and are not reopened. B, E, F, I, J and N are judgement calls worth reviewing.**

**A. Face-aware coverage (Ken's).** `export type Face = 'body' | 'code'`;
`export type Covers = (codePoint: number, face: Face) => boolean`. `characterProblems(text, covers,
face)`. `AssembleInput.covers: Covers`. `PinnedFonts.covers(codePoint, face)`, two sets from one
loader: each face's four files intersected. Liberation Mono pinned beside Serif. **Task 1**, before
anything else, because it changes every existing call site.

**B. Inline code moves to Liberation Mono too, and is checked against `code`.** Template 5's
`show raw` rule sets every `raw` - block and inline - in Mono, because an author who sees inline code
in a monospace face on the surface and in a proportional one in print has been shown two different
things. The cost is the thirteen writable code points of spike 3 inside an inline code run.
_Rejected:_ Mono for preformatted text alone, which is one line cheaper and inconsistent. **Tasks 7
and 8.**

**C. `fallback: false` on `raw` (measured).** Without it the engine sets a missing glyph from Serif
and the column is wrong with nothing said. **Task 8.**

**D. Never use Typst's `quote(attribution:)` (Ken's).** It writes an em dash the author never typed,
and `CLAUDE.md` forbids em dashes in user-facing text; it also tags the attribution a bare `Span`. The
template sets the attribution itself, as a right-aligned paragraph at the end of the `quote` body,
with **no prefix character of any kind** - the author types whatever they want before a name.
**Task 8.**

**E. Tabs are expanded by `assemble` to stops every 8 columns; the stored text keeps its tabs.** 8 is
the stop POSIX `expand`, a terminal and `cat` use; Typst's own tab handling is measured to ignore
`tab-size`. The editor surface shows the same stops (`tab-size: 8` in `style.css`), so the author
sees on screen the columns the PDF prints. `raw` is never given `lang:` or `tab-size:`.
_Rejected:_ 4 (common in editors, but not a standard anyone can point at). **Tasks 6 and 7.**

**F. A line wider than its place is refused by `assemble`, before Typst - never wrapped, never
clipped.** Failure code `line_too_wide`, detail `line <n>, <w> of <max> columns`, naming no text.
The measure is exact at the top level and inside quotations, and **conservative inside lists**
(#164): `assemble` has no font metrics, so a counted list allows 11 pt per character of the longest
marker it will print plus 5.5 pt, and a definition list 22 pt. Every measured indent is at or under
that. The template **also** asserts, per line, with `layout` and `measure`, as a backstop that must
never fire - an engine refusal on a document the checks passed is a pipeline defect by publishing.md's
own rule. _Rejected:_ letting Typst wrap (a reader cannot tell a wrap from a line break) and a
template assertion alone (`typst_refused` names nothing). **Accepted by Ken at plan review, knowing
it will bite:** 83 columns is under the width of much ordinary code, and the editor cannot warn while
the author types, because a component does not know the layout - and so the page width - it will be
published under. The fix is a layout's to make (a smaller code size, or shrink to fit down to a
floor), filed as [#165](https://github.com/kenhayward/alloy-works/issues/165) for a layout-editing
slice. **Tasks 7 and 8.**

**G. Six narrowings the walk holds, landing now because nothing has stored either block yet.** The
editor has never made one and admission is not wired to a route; a development database may hold one
written straight through the API, which is the same argument the lists slice made for `term`. After
this slice a narrowing is a migration. In `checkBlock` (`document.ts`) unless said:

1. **An attribution that is there holds text.** `blockquoteNodeSchema`'s `attribution` becomes
   `z.array(inlineNodeSchema).min(1).optional()`, and the walk refuses an attribution `mergeRuns`
   empties - `[]` and absent would otherwise be two digests of one quotation. Judged on what the walk
   returned, as the term is.
2. **A quotation's content is walked before its attribution** - reading order, the order the editor
   holds them and `contributions.ts` already uses. Fixes the refusal spike 4 found.
3. **Preformatted text is put in NFC** in the walk (`text.normalize('NFC')`), because
   `canonicalJson` digests every string in NFC and the stored text must be what the digest covers -
   `mergeRuns`' rule for a run. NFC changes no whitespace.
4. **Preformatted text holds no control character but tab and line feed.** Refused: U+0000 to U+0008,
   U+000B to U+001F (so U+000D: `\r\n` would be a second spelling of `\n`), U+007F, U+0080 to U+009F
   (so U+0085), U+2028 and U+2029. Message: `Preformatted block <id> holds <U+XXXX>, which
preformatted text may not` - the code point by `codePointName`, never the character.
5. **A language label is a token:** `/^[A-Za-z0-9][A-Za-z0-9+#._-]{0,31}$/` - `sql`, `c++`, `c#`,
   `objective-c`, `shell-session`. ASCII, so NFC and every pinned face hold it. Message:
   `Preformatted block <id> carries a language label that is not a token`.
6. **A preformatted block with text closes a mark's range** (`claimed.carried.clear()` when
   `text !== ''`), which is `spansOf`'s answer: readable text stands between the two pieces. An empty
   one is transparent, as an empty paragraph is.

_Rejected:_ refusing rather than normalising non-NFC text (a paste of decomposed text would be
refused with a message that names nothing); normalising `\r\n` to `\n` (a rule nobody asked for,
held for one producer the editor is not). **Task 2.**

**H. Three editor nodes, and the attribution is its own textblock.** `preformatted` (`text*`,
`marks: ''`, `code: true`, attrs `id`, `language`); `blockquote` (`content: 'block+ attribution?'`,
attr `id`); `attribution` (`text*`, `marks: '_'`, outside the `block` group, no attrs). `attribution?`
rather than required, because `wrapIn` cannot make a node whose content expression needs a child it
does not have; `toEditor` and the quotation command always add one, empty where the stored one is
absent, so an author always has somewhere to type it. An empty `attribution` maps to no stored
attribution. **Tasks 3 and 4.**

**I. The keys inside a preformatted block.** `Enter` inserts `\n` and never splits anything, in a
list or out of one. `Tab` inserts `\t`. **`Shift-Tab` is never taken** in a preformatted block, so
focus can always leave backwards by keyboard (CNT-077 forbids a trap), and `Mod-Enter` leaves the
block for a new paragraph after it. In an attribution `Enter` leaves the quotation; in an empty last
body paragraph of a quotation that holds another block, `Enter` moves that paragraph out after the
quotation. _Rejected:_ Tab moving focus in a preformatted block (an author cannot type the character
CNT-018 exists to keep), and an Escape-then-Tab mode (a state the author cannot see). **Task 5.**

**J. Two registry rows.** `Quotation`, `Mod-Shift-.`, said `Ctrl or Cmd, Shift and full stop`;
`Preformatted text`, `Mod-Shift-,`, said `Ctrl or Cmd, Shift and comma`. Letters were avoided because
`Ctrl-Shift-B`, `-C`, `-E`, `-K` and `-U` belong to a browser, a devtool or an input method on at
least one platform; `Ctrl-Alt` is AltGr on Windows. **Task 5.**

**K. What the two commands do.** **Preformatted text** over paragraphs of one parent joins them into
one block, a line each, and **drops every mark** the paragraphs carried (Ken's, at plan review): the
loss is visible, it answers the author's own command, and one undo restores the paragraphs exactly,
mark identifiers included. The plan's first answer - declining over any marked paragraph, the
doctrine `liftItem` follows for a definition term - was overruled because nothing yet clears
formatting in one gesture, so a paragraph holding a link could never become code. What it drops is
**marks only**: over a paragraph holding any inline node that is not text (a footnote, a
cross-reference, an equation, a citation) it still **declines**, because that is content rather than
formatting and a line of code cannot hold it; pressed in a preformatted block it
turns it back into paragraphs, one per line (the adjacency plugin then collapses blank lines, which
are whitespace). **Quotation** wraps the selected blocks and adds an empty attribution; pressed inside
a quotation it unwraps the innermost one, and an attribution with text becomes a paragraph after the
unwrapped blocks rather than being discarded. **Task 5.**

**L. A quotation counts as a level against the nesting limit.** `MOST_NESTED_LIST_LEVELS` is renamed
`MOST_NESTED_LEVELS` (still 30) and `deepestNesting` counts a `blockquote` as a level. A quotation
costs half what a list level does, so this is conservative: thirty levels of any mix stay under
`exceedsLimits`' 128. The Quotation command asks `tooDeep` before wrapping, as `nestItem` does.
**Task 5.**

**M. `publishing/5` and `publication/5`.** `PublishedBlock` gains two members, a template version is
immutable, and template 4 goes on reading `publishing/4`. `publishing/4` becomes a frozen constant,
`PUBLISHING_SCHEMA_4`, as 1, 2 and 3 are. Without a layout both blocks stay `block_not_publishable`
(the lists plan's decision E). **Tasks 7 and 8.**

**N. CNT-019 stays uncited.** Its statement is an attribution "that may carry a citation", and in
this slice a citation can be neither written (no control; LIB's bibliography is T6) nor published
(`inline_not_publishable`). A quotation with an attribution is built end to end, and a stored
attribution holding a citation opens read-only rather than losing it; that is not the statement in
full. content-model.md's claim stands, because the stored shape does answer it. **Task 10.**

**O. The e2e suite is not changed.** `tests/e2e/src/stack.test.ts` pins the engine version,
`LiberationSerif` in the PDF bytes and `template.version > 1`; none moves. A build agent cannot run it,
so task 10 names the human pre-merge run.

**P. Emptiness.** An empty preformatted block publishes nothing (it is where a cursor stands, as an
empty paragraph is); a quotation whose blocks publish nothing and which has no attribution publishes
nothing.

**Q. A Preformatted panel, beside the List panel.** One text field, **Language label**, in the `F6`
ring while the cursor is in a preformatted block and absent otherwise, exactly as the List panel
comes and goes. **Task 6.**

---

## The traps, and who owns each

| Trap                                                                                                                                                                                                                      | Owner                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Schema-keyed maps repoint silently.** `PIPELINE_VERSION` (`apps/worker/src/jobs/publish.ts`) and `TEMPLATE_READING` (`apps/worker/src/template.ts`) have computed keys `[PUBLISHING_SCHEMA]`                            | **Task 8.** New values `'5'` and `5`, pinned by **literal** `toEqual({ 'publishing/1': '1', 'publishing/5': '5' })` and `toEqual({ 'publishing/1': 1, 'publishing/5': 5 })`. `template.test.ts`'s `reads` map row `4: PUBLISHING_SCHEMA` becomes `4: PUBLISHING_SCHEMA_4`, and row `5: PUBLISHING_SCHEMA` is added |
| **Tests that compile `PUBLICATION_TEMPLATE[4]` with a freshly assembled document** - `layout.test.ts:244`, `lists.test.ts:343,578,604`, `marks.test.ts:202`, `regression.test.ts:101,215`, `template.test.ts:279,315,360` | **Task 8.** Template 4 asserts `publishing/4` and `assemble` will make `publishing/5`, so every one goes red. Repoint each to `PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]]`; the literal pins above guard the map                                                                                    |
| **Insert-only stored shapes**                                                                                                                                                                                             | **Task 2** (decision G). Nothing in any later task may add a narrowing                                                                                                                                                                                                                                             |
| **Judged on what the walk returned**                                                                                                                                                                                      | **Task 2**: narrowing 1 is judged after `mergeRuns`; narrowing 6 on the stored text                                                                                                                                                                                                                                |
| **No raw control characters in source**                                                                                                                                                                                   | Every task; task 2's and task 9's fixtures are where it will bite                                                                                                                                                                                                                                                  |
| **The mapping, both ways** (`packages/editor/src/mapping.ts`)                                                                                                                                                             | **Task 4**, and only task 4                                                                                                                                                                                                                                                                                        |
| **The save path** (`apps/web/src/editor/session.ts`, through `fromEditor` and `parseContentDocument`)                                                                                                                     | **Task 6**: a test drives both blocks through the real session and asserts what is sent; and that no gesture of task 5 reaches `cannotSnapshot`                                                                                                                                                                    |
| **The toolbar**                                                                                                                                                                                                           | **Task 5** adds the rows; **task 6** asserts the buttons, their availability and their names                                                                                                                                                                                                                       |
| **The API contract** (two new failure codes)                                                                                                                                                                              | **Task 7**: `openapi.json` and the client regenerated                                                                                                                                                                                                                                                              |
| **The e2e suite** (`tests/e2e`)                                                                                                                                                                                           | **Task 10**: no change (decision O); the PR body asks the human to run `pnpm test:e2e`                                                                                                                                                                                                                             |
| **Typst's diagnostics quote content**                                                                                                                                                                                     | **Task 8**: the backstop assertion's message names the block's identifier and nothing it holds                                                                                                                                                                                                                     |

---

## Requirements, claims and citations

**Cited by this slice** - three new citing titles, each in a file that cites CNT-018 nowhere else:

| File                                           | Exact title                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/editor/src/mapping.test.ts`          | `CNT-018 carries a preformatted block through the mapping both ways with its leading spaces, tabs, blank lines and language label byte for byte`            |
| `apps/web/src/editor/ComponentEditor.test.tsx` | `CNT-018 an author makes preformatted text, types indentation, a tab and a blank line, labels it sql, and the iteration sent holds all of it byte for byte` |
| `apps/worker/src/quotations.test.ts`           | `CNT-018 sets a preformatted block in Liberation Mono with every character in the column its whitespace put it in, under its language label`                |

Each body demonstrates the whole statement at its own layer: a block, its label, and whitespace kept
exactly. CNT-018 is already `Covered` (by `document.test.ts:262`) and its claim is content-model.md's.

**Not cited:** CNT-019 (decision N); CNT-023 and CNT-002 (touched - adjacency inside a quotation,
identifiers for new blocks - and already covered; a regression test is not a second demonstration);
CNT-077 (already cited in `marks.test.ts` for the registry invariant, which these rows extend); and
PUB-090 (the Matterhorn half, as every slice has named it).

**Counts after the slice:** requirements **1,386** (no row added), claims **409** (none added or
dropped), citations **226** (223 + 3). Task 10 moves every pin `pnpm trace pins` reports.

---

## File structure

| File                                                                                                        | What changes                                                                |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/worker/fonts/LiberationMono-{Regular,Bold,Italic,BoldItalic}.ttf`                                     | Create: the four faces, from the 2.1.5 release                              |
| `apps/worker/src/fonts.ts`                                                                                  | Modify: `face` on each pinned file; `covers(codePoint, face)`               |
| `packages/domain/src/publishing/glyphs.ts`                                                                  | Modify: `Face`, `Covers`; `characterProblems` takes the face                |
| `packages/domain/src/content/model/blocks.ts`, `document.ts`                                                | Modify: decision G                                                          |
| `packages/domain/src/content/model/preformatted.ts`                                                         | Create: `isLanguageLabel`, `forbiddenInPreformatted`                        |
| `packages/domain/src/content/model/mapping.ts`                                                              | Modify: the `preformatted` tagged row                                       |
| `packages/editor/src/schema.ts`, `mapping.ts`, `blocks.ts`, `state.ts`, `marks.ts`, `index.ts`, `style.css` | Modify: nodes, mapping, commands, keys, rows, exports, surface              |
| `apps/web/src/editor/PreformattedPanel.tsx`                                                                 | Create                                                                      |
| `apps/web/src/editor/ComponentEditor.tsx`, `EditorToolbar.tsx`                                              | Modify: the panel in the ring; nothing else, the toolbar reads the registry |
| `packages/domain/src/publishing/published.ts`, `assemble.ts`, `failures.ts`                                 | Modify: `publishing/5`, two blocks, two codes                               |
| `packages/domain/src/publishing/measure.ts`                                                                 | Create: tab expansion and the column measure                                |
| `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts`                         | Regenerate                                                                  |
| `apps/web/src/publishing/failures.ts`                                                                       | Modify: the words for two codes                                             |
| `apps/worker/templates/publication/5/main.typ`                                                              | Create: template 4 plus two branches and the raw rules                      |
| `apps/worker/src/template.ts`, `jobs/publish.ts`                                                            | Modify: version 5, the two maps                                             |
| `apps/worker/src/quotations.test.ts`                                                                        | Create: the PDF both blocks make, through veraPDF                           |

---

## Task 1: the glyph check knows which face it is asking about

**Decision A.** Lands first: it changes every existing caller, and every later task writes through it.

**Interfaces.** Consumes nothing new. Produces, from `packages/domain/src/publishing/glyphs.ts` and
re-exported from `packages/domain/src/publishing/index.ts` and the package root:

- `export type Face = 'body' | 'code';`
- `export type Covers = (codePoint: number, face: Face) => boolean;`
- `export function characterProblems(text: string, covers: Covers, face: Face): { problem: CharacterProblem; codePoint: number }[]` - unchanged except that the face is passed to `covers`.

`AssembleInput.covers: Covers`. In `apps/worker/src/fonts.ts`: each `PINNED_FONT_FILES` entry gains
`face: Face`; four `LiberationMono-*` entries with the hashes in spike 3; `PinnedFonts.covers(codePoint:
number, face: Face): boolean`, each face's set the intersection of its own four files.

**Every existing caller passes `'body'`** - `assemble.ts`'s `check` and the layout-words loop. No
behaviour changes in this task; `inlineCode` moves to `'code'` in task 7, with the template that sets
it in Mono.

**Files:** the four `.ttf` files (take them from the `liberation-fonts-ttf-2.1.5` release archive
after checking its four serif files hash to `PINNED_FONT_FILES`; `.gitattributes` already marks fonts
binary); `apps/worker/src/fonts.ts`; `apps/worker/src/typst.test.ts` (its `fonts.covers(...)` asserts);
`packages/domain/src/publishing/glyphs.ts`, `assemble.ts`, `index.ts`; `packages/domain/src/index.test.ts`
(export list pin).

**Steps.**

- [ ] **Red.** In `typst.test.ts`: `loadPinnedFonts` refuses to start when a Mono file is missing, as
      it does for a Serif one; `covers(0x2016, 'body')` is true and `covers(0x2016, 'code')` false;
      `covers(0x41, 'code')` true; the `code` set is exactly 2,305 code points and the `body` set 2,321.
      In a new `glyphs.test.ts` (or `assemble.test.ts` if glyph tests live there):
      `characterProblems('a\u{2016}', covers, 'code')` reports `glyph_missing` for U+2016 and the same
      call with `'body'` reports nothing. Watch them fail: the Mono files are not pinned and
      `characterProblems` ignores a third argument.
- [ ] **Green.** The signatures above. `FONT_DIRECTORY` stays one directory; Typst's `--font-path`
      sees both families.
- [ ] **Typecheck** `pnpm typecheck` - `DocumentPage.test.tsx`'s `covers: () => true` and
      `assemble.test.ts`'s one-argument fakes stay assignable; a failure here is a caller missed.
- [ ] **Commit.** `feat(worker): pin Liberation Mono and make glyph coverage face-aware`

---

## Task 2: the six narrowings, before anything stores either block

**Decision G, in full** - the implementer of this task must read all six there. Also corrects the
`preformatted` row of `outputMapping`.

**Interfaces.** Produces, in a new `packages/domain/src/content/model/preformatted.ts`, re-exported
from the content-model index and the package root:

- `export const LANGUAGE_LABEL = /^[A-Za-z0-9][A-Za-z0-9+#._-]{0,31}$/;`
- `export function isLanguageLabel(value: string): boolean` - the one spelling; the editor's panel and
  the walk both ask it.
- `export function forbiddenInPreformatted(codePoint: number): boolean` - narrowing 4's set.

`blockquoteNodeSchema.attribution` becomes `.min(1).optional()`. `checkBlock` gains a `preformatted`
case (narrowings 3 to 6) and its `blockquote` case walks content, then attribution (2), and refuses an
emptied attribution (1). `parseContentDocument`'s doc comment counts its rules again. `outputMapping.
blocks.preformatted.tagged` becomes `'Code holding a P per line'`.

**Files:** `packages/domain/src/content/model/blocks.ts`, `document.ts`, `preformatted.ts` (create),
`mapping.ts`, `index.ts`; `document.test.ts`; `preformatted.test.ts` (create).

**Test cases** (`document.test.ts` unless said; none cites a requirement - each is a narrowing, and
CNT-018's citation in this file already exists):

- an attribution of `[]` is refused; one holding only an empty run is refused **after** `mergeRuns`
  empties it, with the message naming the block; one holding `Ada` is accepted
- an annotation from the paragraph before a quotation into its first body paragraph, in a quotation
  whose attribution is plain text, is **accepted** (today refused - this is the red case for 2)
- a mark identifier used in a quotation's attribution and again in its body, with plain text between
  in document order, is refused as two ranges
- preformatted text `'e\u{301}'` is stored as `'\u{E9}'`, and a second parse of the result returns it
  unchanged
- `'a\u{D}\u{A}b'`, `'\u{B}'`, `'\u{C}'`, `'\u{85}'`, `'\u{2028}'`, `'\u{0}'`, `'\u{7F}'` are each
  refused naming the code point as `U+000D` and so on, and the message holds no other character of
  the text
- `'\u{9}x\u{A}\u{A}  y\u{A}'` is accepted byte for byte
- labels `sql`, `c++`, `c#`, `objective-c`, `x` accepted; `''` refused by the schema; ` sql`, `sql `,
  `plain text`, `-sql`, 33 characters, `s\u{E9}l` refused by the walk
- an annotation split by a preformatted block holding `x` is refused as two ranges; split by an empty
  one it is one annotation, accepted
- `preformatted.test.ts`: `forbiddenInPreformatted` is false for U+0009 and U+000A and true for every
  other code point in U+0000 to U+001F, U+007F to U+009F, U+2028 and U+2029, asserted over the whole
  range by a loop in one `it`

**Steps.** Red: the narrowings are absent, so every refusal case returns a document and the order case
throws. Green: the rules above. Then run `pnpm --filter @alloy-works/db test` - `parseContentDocument`
is on the save path and a fixture may hold a quotation. Commit:
`feat(domain): hold a quotation and preformatted text to what may be stored`.

---

## Task 3: the editor schema holds both blocks

**Decision H.**

**Interfaces.** In `packages/editor/src/schema.ts`, three nodes, declared **after** `paragraph` (the
first in the group fills an empty document - CNT-124 - and must stay `paragraph`):

- `preformatted`: `group: 'block'`, `content: 'text*'`, `marks: ''`, `code: true`, `defining: true`,
  `attrs: { id: { default: null }, language: { default: null } }`. `parseDOM`: `pre`,
  `preserveWhitespace: 'full'`, reading `data-language` **judged** by `isLanguageLabel` (anything else
  reads as `null`, as `ol`'s rule judges `start`). `toDOM`: `['pre', language ? { 'data-language':
language } : {}, ['code', 0]]`.
- `blockquote`: `group: 'block'`, `content: 'block+ attribution?'`, `defining: true`,
  `attrs: { id: { default: null } }`, `parseDOM: [{ tag: 'blockquote' }]`, `toDOM: ['blockquote', 0]`.
- `attribution`: not in `block`, `content: 'text*'`, `marks: '_'`, `defining: true`, no attrs,
  `parseDOM: [{ tag: 'footer' }]`, `toDOM: ['footer', { class: 'aw-attribution' }, 0]`.

**Files:** `schema.ts`, `schema.test.ts`.

**Test cases:** each `toDOM` as the spec array; `attribution` is outside the `block` group (the
adjacency rule depends on it, as it does for `term`); `preformatted` admits no mark (`marks: ''`) and
`attribution` all ten; the `pre` rule reads `data-language="c++"` and reads `data-language="a b"` as
null; an empty `doc` fills with a `paragraph`, not a `preformatted`. Red: the nodes do not exist.
Commit: `feat(editor): preformatted, blockquote and attribution nodes`.

---

## Task 4: the mapping carries both, both ways

**Owns the mapping seam.** Decision H.

**Interfaces.** In `packages/editor/src/mapping.ts`: `nodeOf` gains `preformatted` (text node only
where `text !== ''`, `language` or null) and `blockquote` (its blocks, then **always** an
`attribution` node - holding the stored runs, or empty). `storedBlock` gains both: a `preformatted`'s
text is `node.textContent`, `language` omitted where null; a `blockquote`'s `content` is its
block-group children through `storedBlocks`, and `attribution` is `runsOf(child, id)` of its
`attribution` child, **omitted** when that is empty or absent. `namesWithNoNode` descends a
blockquote's content, and asks `marksWithNoType` (or its inline counterpart) of its attribution, so a
citation in an attribution opens the component read-only by name.

**Files:** `mapping.ts`, `mapping.test.ts`.

**Test cases:**

- the CNT-018 title in the table above: `'\u{9}if x:\u{A}\u{A}    y = 1\u{A}'` labelled `python`
  round-trips `toEditor` then `fromEditor` with `text` equal byte for byte, and a block with no label
  comes back with no `language` member
- a quotation holding a paragraph and a list, attributed `Ada, Notes` with emphasis over `Notes`,
  round-trips unchanged
- a quotation with no stored attribution opens with an empty `attribution` node and saves with no
  `attribution` member
- a quotation inside a list item and a list inside a quotation, each round-trip
- a quotation whose attribution holds a `citation` opens `editable: false` naming `citation`
- `fromEditor` throws on a `preformatted` or `blockquote` with a null `id` (the identity plugin's job)

Red: `nodeOf` throws on both kinds. Commit: `feat(editor): carry quotations and preformatted text
through the mapping`.

---

## Task 5: the commands, the keys and the registry

**Decisions I, J, K and L.** Owns the registry rows the toolbar reads.

**Interfaces.**

- `packages/editor/src/blocks.ts`: `BlockAction` widens with `'quotation' | 'preformatted'`;
  `blockCommand` answers both (decision K). New exports:
  - `export const MOST_NESTED_LEVELS = 30;` replacing `MOST_NESTED_LIST_LEVELS`; `deepestNesting`
    counts `blockquote` as a level (decision L).
  - `export function preformattedAt(state: EditorState): { language: string | null; pos: number } | null`
  - `export function setPreformattedLanguage(language: string | null): Command` - declines unless the
    cursor is in a preformatted block and `language` is null or `isLanguageLabel(language)`.
  - `export const codeAwareEnter: Command` - `newlineInCode`, then `exitAttribution`, then
    `leaveQuotation` (the empty-last-body-paragraph case).
  - `export const insertTabInCode: Command` - inserts `'\t'` when the selection is in a `code` node,
    false otherwise.
- `packages/editor/src/state.ts`: `Enter: chainCommands(codeAwareEnter, listAwareEnter(...),
enterWithoutEmpties)`; `Tab: chainCommands(insertTabInCode, blockCommand('nestItem', ...))`;
  `Shift-Tab` unchanged (its command returns false in a preformatted block outside a list, and must be
  made to return false **inside** one in a list too - lifting an item from inside its code is not what
  an author pressing Shift-Tab to leave means). `Mod-Enter` stays `baseKeymap`'s `exitCode`.
- `packages/editor/src/marks.ts`: two rows after `liftItem`: `{ kind: 'block', action: 'quotation',
label: 'Quotation', shortcut: 'Mod-Shift-.', shortcutSaid: 'Ctrl or Cmd, Shift and full stop',
prompts: false }` and `{ kind: 'block', action: 'preformatted', label: 'Preformatted text',
shortcut: 'Mod-Shift-,', shortcutSaid: 'Ctrl or Cmd, Shift and comma', prompts: false }`.
- `packages/editor/src/index.ts`: export the new names.

**Files:** `blocks.ts`, `blocks.test.ts`, `state.ts`, `state.test.ts`, `marks.ts`, `marks.test.ts`,
`identity.test.ts`, `index.ts`.

**Test cases** - every key pressed **through the real keymap** of `createEditorState`, as
`blocks.test.ts` already does:

- Enter in a preformatted block at the top level, and in one inside a list item, inserts `\n` and
  leaves the list, the item and the block counts unchanged
- Tab in a preformatted block inside a list item inserts `\t` and nests nothing; Tab outside a list
  and outside code still returns false
- Shift-Tab in a preformatted block inside a nested list item returns false and lifts nothing
- Mod-Enter in a preformatted block makes a paragraph after it holding the cursor
- Enter in an attribution makes a paragraph after the quotation holding the cursor
- Enter in an empty last body paragraph of a quotation holding two blocks moves it out after the
  quotation; in the only body paragraph it does nothing
- Preformatted text over three paragraphs makes one block `'a\nb\nc'`; over a paragraph with a strong
  run and a link it makes one block holding the paragraph's text with no mark, and one undo restores
  the paragraph with both marks and their identifiers; over a paragraph holding a non-text inline
  node it declines and the toolbar query answers false; pressed in a block of three lines it makes
  three paragraphs
- Quotation wraps two paragraphs and adds an empty attribution; pressed inside a quotation attributed
  `Ada` it unwraps and leaves a paragraph `Ada` after the blocks; at `MOST_NESTED_LEVELS` it declines
- a quotation and a preformatted block made by the commands each carry a fresh identifier, unique in
  the component (identity plugin, pinned in `identity.test.ts`)
- two empty paragraphs inside a quotation: the second is removed; an empty paragraph, a preformatted
  block and an empty paragraph: nothing removed (`state.test.ts`)
- one annotation over a paragraph, then a preformatted block holding `x`, then a paragraph: the
  second piece is renamed; with an empty preformatted block between, it is one annotation
- the registry invariant in `marks.test.ts` (every row has a unique shortcut bound in the keymap and a
  label) passes with the two rows - extended by the rows, not rewritten

Red: the actions and exports do not exist, and the Enter case inside a list splits the item.
Commit: `feat(editor): quotation and preformatted commands, and the keys inside code`.

---

## Task 6: the surface, the panel and the save path

**Decisions E and Q. Owns the save-path seam and the toolbar's rendering.**

**Interfaces.** `apps/web/src/editor/PreformattedPanel.tsx`: `export function PreformattedPanel(props:
{ view: EditorView; block: { language: string | null; pos: number }; enabled: boolean; ref?:
Ref<HTMLElement> })`, modelled on `ListPanel.tsx`: a region named **Preformatted text**, one field
labelled **Language label**, applied with `setPreformattedLanguage` on blur and Enter, cleared to
null by emptying it. Strings, exactly:

- hint: `Letters, digits and + # . _ - only, up to 32 characters. Leave it empty for none.`
- refusal (when `isLanguageLabel` says no, nothing applied): `A language label is letters, digits and + # . _ - only, up to 32 characters.`

`ComponentEditor.tsx` renders it after the List panel while `preformattedAt(surface.state)` is not
null, and puts it in the `F6` ring as a region that comes and goes. `packages/editor/style.css`:
`pre` monospace with `tab-size: 8` and `white-space: pre`, a visible frame that is not colour alone,
`pre[data-language]::before` showing the label; `blockquote` indented with a left rule; an empty
`footer.aw-attribution` showing `Attribution` as a placeholder through a node decoration
(`class: 'aw-empty'`) - ProseMirror's trailing break defeats `:empty`.

**Files:** `PreformattedPanel.tsx` (create), `ComponentEditor.tsx`, `ComponentEditor.test.tsx`,
`EditorToolbar.test.tsx`, `session.test.ts`, `packages/editor/style.css`, `packages/editor/src/state.ts`
(the decoration).

**Test cases:**

- the CNT-018 title in the table above, through the real `session`: toolbar **Preformatted text**,
  type `  a`, press Tab, type `b`, Enter twice, type `c`, set the label `sql`; the iteration body's
  block is `{ type: 'preformatted', text: '  a\u{9}b\u{A}\u{A}c', language: 'sql' }`
- a quotation made from the toolbar with an attribution typed is sent with that attribution; one left
  empty is sent with no `attribution` member
- neither gesture ever shows `This text cannot be saved as it stands` (`cannotSnapshot`'s notice)
- the toolbar shows **Quotation** and **Preformatted text** with their shortcuts said, and
  **Preformatted text** is unavailable over a bold paragraph
- the panel appears in a preformatted block and not elsewhere; `F6` reaches it; a label `a b` shows
  the refusal and changes nothing; clearing the field removes the label
- the rendered `pre` has computed `tab-size` 8 under jsdom (the one DOM assertion of the surface)

Red: no button, no panel. Commit: `feat(web): make quotations and preformatted text on the surface`.

---

## Task 7: the published document carries both

**Decisions B, E, F, M and P.** Owns the contract seam.

**Interfaces.**

- `packages/domain/src/publishing/published.ts`: `PUBLISHING_SCHEMA = 'publishing/5'`;
  `export const PUBLISHING_SCHEMA_4 = 'publishing/4'` (frozen); and
  - `export interface PublishedPreformatted { readonly type: 'preformatted'; readonly id: string; readonly label: string | null; readonly lines: readonly string[] }` - tabs already expanded.
  - `export interface PublishedQuotation { readonly type: 'blockquote'; readonly id: string; readonly blocks: readonly PublishedBlock[]; readonly attribution: readonly PublishedRun[] | null }`
  - `PublishedBlock = PublishedParagraph | PublishedList | PublishedPreformatted | PublishedQuotation`
- `packages/domain/src/publishing/measure.ts` (create):
  - `export const TAB_STOP = 8;` `export const BODY_SIZE = 11;` `export const CODE_SIZE = 8.8;`
    `export const CODE_ADVANCE = (CODE_SIZE * 1229) / 2048;` `export const PANEL_INSET = 6;`
    `export const QUOTATION_INDENT = 11;` `export const DEFINITION_INDENT = 22;`
  - `export function expandTabs(line: string): string` - each `\t` to the next multiple of `TAB_STOP`
    columns, counting code points.
  - `export function textMeasure(format: PublishedPdfFormat): number` - the across measure less both
    margins and the gutter, as template 4's page takes it.
  - `export function listIndent(list: ListNode): number` - `DEFINITION_INDENT` for a definition list;
    otherwise `BODY_SIZE` times the character count of the longest marker the list prints (every
    number from its start through its last item, in its format, plus `.`; a bullet is one character)
    plus `BODY_SIZE / 2`.
  - `export function columnsAt(format: PublishedPdfFormat, indent: number): number` -
    `Math.floor((textMeasure(format) - 2 * PANEL_INSET - indent) / CODE_ADVANCE)`.
- `assemble.ts`: `publishable` threads the indent it stands at (quotation `+ QUOTATION_INDENT`, list
  `+ listIndent(block)`); `preformatted` and `blockquote` branches under a layout, `block_not_publishable`
  without one; each expanded line's characters checked with `characterProblems(line, covers, 'code')`,
  reported as `code_glyph_missing`; each line longer than `columnsAt(...)` code points refused
  `line_too_wide`, detail `line <n>, <w> of <max> columns` (1-based `n`); an `inlineCode` run's text
  checked against `'code'` and reported as `code_glyph_missing`, every other run against `'body'`.
- `failures.ts`: `publishFailureCodes` gains `'code_glyph_missing'` and `'line_too_wide'`, appended
  under the compose comment (codes are only ever added).
- `apps/web/src/publishing/failures.ts`, the words, exactly:
  - `code_glyph_missing`: `The character ${detail} is not in the monospace typeface that preformatted text and inline code are set in.`
  - `line_too_wide`: `A line of this preformatted text is too wide for the page, so it would be cut off: ${detail}. Shorten the line or break it.`
- Regenerate: `pnpm --filter @alloy-works/api-contract generate`, then
  `pnpm --filter @alloy-works/api-client generate`.

**Files:** `published.ts`, `measure.ts` (create), `measure.test.ts` (create), `assemble.ts`,
`assemble.test.ts`, `failures.ts`, `publishing/index.ts`, `packages/domain/src/index.test.ts`,
`packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts`,
`apps/web/src/publishing/failures.ts` and its test.

**Test cases:**

- `expandTabs('\u{9}a')` is 8 spaces then `a`; `'abc\u{9}b'` puts `b` at column 8; `'a\u{9}\u{9}b'` at 16
- `columnsAt` of the default layout's format at indent 0 is **83** (the measured number)
- `listIndent` of an ordered roman list starting at 888 with one item is `11 * 13 + 5.5`; of an
  unordered list `16.5`; of a definition list `22` - each at or above spike 2's measured indent
- under the default layout: an 83-column line publishes; 84 is `line_too_wide` with detail
  `line 1, 84 of 83 columns`; the same 83 inside a quotation is refused as `of 81`
- `a\u{2016}b` in a paragraph publishes; in preformatted text and in an inline code run each fails
  `code_glyph_missing` with detail `U+2016`
- an empty preformatted block and an empty quotation publish nothing; a quotation holding a list
  publishes with its list inside
- without a layout both are `block_not_publishable`, as today
- `PUBLISHING_SCHEMA` is `'publishing/5'` and `PUBLISHING_SCHEMA_4` is `'publishing/4'`, as literals

Red: the schema says `publishing/4` and both blocks are `block_not_publishable`. Commit:
`feat(domain): publish quotations and preformatted text as publishing/5`.

---

## Task 8: template 5 sets both

**Decisions B, C, D, F and M. Owns the schema-keyed maps and the repointed compiles** (see the traps
table - every file and line is listed there).

**Interfaces.** `apps/worker/templates/publication/5/main.typ`: template 4 byte for byte, then:

- its first assertion reads `publishing/5`
- `#show raw: set text(font: "Liberation Mono", fallback: false)` and
  `#show raw.where(block: true): set text(size: 8.8pt)` - the size `CODE_SIZE` names, set explicitly
  rather than inherited from Typst's default
- `block-of` gains a `preformatted` branch: where `b.label` is not none, the label above the block in
  the body face at 8 pt; then `block(fill: luma(240), inset: 6pt, width: 100%, ...)` holding
  `layout(size => ...)` that, for each line, asserts `measure(raw(block: true, line)).width <=
size.width` with the message `"preformatted " + b.id + " is wider than its measure"` and nothing
  else, then sets `raw(block: true, b.lines.join("\n"))`. **Never** `lang:`, **never** `tab-size:`.
- and a `blockquote` branch: `quote(block: true, { ..b.blocks.map(block-of); if b.attribution != none
{ align(end, b.attribution.map(run).join()) } })`. **Never `quote(attribution: ...)`** - it writes an
  em dash the author never typed (decision D). No character of any kind before the attribution.

`apps/worker/src/template.ts`: `PUBLICATION_TEMPLATE` gains `5`; `TEMPLATE_READING`'s latest row reads
`5`; its doc comment names template 5. `apps/worker/src/jobs/publish.ts`: `PIPELINE_VERSION`'s latest
row reads `'5'`.

**Files:** the template (create), `template.ts`, `jobs/publish.ts`, `template.test.ts` (hash of 5,
the two literal pins, the `reads` rows, `madeByPipeline['5']`), and the repointed compiles in
`layout.test.ts`, `lists.test.ts`, `marks.test.ts`, `regression.test.ts` and `template.test.ts`.

**Test cases:** the two literal pins in the traps table; template 5's hash, and `madeByPipeline['5']`,
each **taken from the tool** - run red, read the digest the failure prints, write it in, never compute
it by hand; `reads[5]` is `'publishing/5'` and `reads[4]` `PUBLISHING_SCHEMA_4`; the template source
does not contain the text `attribution:` (a guard for decision D a reader can see); and in
`regression.test.ts`, every range of `SET_WITHOUT_A_GLYPH` compiles **inside a preformatted block**
under template 5 - if one does not, the exemption is face-dependent and this task stops and reports it
rather than widening anything.

Red: no template 5; the literal pins say 4. Commit: `feat(worker): template publication/5 sets
quotations and preformatted text`.

---

## Task 9: the PDF both make

**Decisions C, D and F, checked in the output.** Owns veraPDF for this slice.

**Files:** `apps/worker/src/quotations.test.ts` (create), in the shape of `lists.test.ts`: assemble
through `parseContentDocument`, `assemble` and the real template, read with `readPdf`, checked with
`checkPdfUa1`. Where `readPdf` lacks a text item's position within a line, extend
`apps/worker/src/testing/pdf.ts` with `readonly items: readonly { page: number; text: string; x: number;
y: number }[]` rather than parsing positions in the test.

**Test cases:**

- the CNT-018 title in the table above: a block labelled `sql` holding `'  a\u{9}b\u{A}\u{A}c'`: the
  label is tagged text above the block; `a` stands exactly 2 columns (2 x 5.28 pt, within 0.1) right of
  the block's left, `b` at column 8, `c` three line steps below `a`; the text is in a font whose name
  holds `LiberationMono`; roles include `Code` holding `P`
- a quotation of two paragraphs attributed `Ada, Notes` (emphasis over `Notes`): roles
  `BlockQuote`, `P`, `P`, `P`; the attribution's text is right-aligned (its right edge within 1 pt of
  the text block's) and **no tagged text on the page contains U+2014 or U+2013**
- a quotation nested in a quotation, and a preformatted block in a list item: `BlockQuote` in
  `BlockQuote`, `Code` in `LBody`
- an 83-column line sets on one line with its last character left of the panel's inner edge; an
  83-column line inside a roman list starting at 888 is refused by `assemble` (never reaching Typst)
- `checkPdfUa1` is compliant with zero failures for the whole fixture

Red: every case, until tasks 7 and 8 are in. Commit: `test(worker): the tagged PDF a quotation and
preformatted text make`.

---

## Task 10: the documents, the trace and the changelog

**Owns decisions N and O, the e2e note, and every count.**

- `docs/architecture.md`: the pinned faces (two families, face-aware coverage, the sixteen), the
  editor's three nodes, `publishing/5` and template 5, the two new failure codes.
- `docs/design/component-editor.md`: move preformatted text and block quotations from "still design"
  to built in the status note; the regions count.
- `docs/design/publishing.md`: build order item 3 names this plan as built.
- `docs/features.md` and `README.md`, in lockstep: an author can write both and publish both.
- `CLAUDE.md`'s status paragraph: quotations and preformatted text leave the "no ... can be written"
  list; Liberation Mono beside Serif.
- `docs/plans/README.md`: this row's status to `Built (PR #NNN)`, and a paragraph on what building
  it found.
- `CHANGELOG.md`, `version.json`, root `package.json`, `apps/desktop/package.json`: **0.34.0**. The
  entry's **Known limits**, in words for an author: a copied or read-aloud preformatted block loses its
  indentation (#162); a quotation's attribution is read as its last paragraph and a label as a stray
  word (#163); a line in preformatted text inside a numbered list may be refused although it would
  fit (#164); and a line wider than the page, 83 columns under the default layout, refuses the
  publish rather than being wrapped or cut off (#165).
- Trace, in this order: `pnpm exec prettier --write` on every touched file, then
  `pnpm --filter @alloy-works/trace generate`, then `pnpm trace check` (no problems) and
  `pnpm trace pins`; move each reported pin to **1,386 / 409 / 226**.
- The PR body carries `Refs #162`, `Refs #163`, `Refs #164`, `Refs #165` (none is fixed) and asks the human to run
  `docker compose -f deploy/compose.yaml up -d --build --wait` and `pnpm test:e2e` before merging,
  because a build agent cannot.

Commit: `docs: quotations and preformatted text, as built (0.34.0)`.

---

## What this leaves undone

- The text layer's leading whitespace and tabs (#162), the attribution's and the label's roles (#163),
  and an exact measure inside lists (#164) - each filed with its measurement.
- Setting code that is wider than the page - a smaller code size or shrink to fit, chosen by the
  layout (#165). Until then an over-wide line refuses the publish.
- A citation in an attribution: stored, opened read-only, never written or published (LIB, T6) - so
  CNT-019 stays uncited.
- Syntax highlighting: never, while `lang:` deletes whitespace and colour is its only signal.
- Paste into a preformatted block: paste is refused everywhere, and admission's clipboard reader is
  where a pasted block's whitespace will be decided.
- Word output for both (word-output.md's `fixed-pitch style` row), with the writer.
