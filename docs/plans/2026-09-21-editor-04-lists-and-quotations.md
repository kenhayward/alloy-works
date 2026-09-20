# Editor 4: lists, and the nesting the editor has never done

> **For agentic workers:** execute this plan task by task, test first, one commit per task. Every task
> names its expected RED failure; run it and see that failure before writing the code that fixes it.

**Goal:** an author can make a bulleted, a numbered or a definition list, nest items inside items, set
a numbered list's start and its numbering, and publish all of it to a tagged PDF in which a reader's
assistive technology is told `L`, `LI`, `Lbl` and `LBody` at every level. And the two write paths
stop disagreeing about how deeply content may nest.

**Architecture:** the stored `list` node becomes four nodes in the editor's ProseMirror schema -
`list` and `listItem` for the two counted kinds, `definitionList` and `definitionItem` for the third,
with `term` as the item's own textblock - shaped so that most of `prosemirror-schema-list`'s commands
drive them unchanged. The stored item is **widened** with an optional `term`, which is additive and
needs no schema version. The identity plugin and the adjacency plugin, both of which walk the top
level only today, are made to descend; the mapping recurses both ways; the command registry widens
from marks to editing actions; `assemble` carries a list into a new published schema, `publishing/4`,
and a new immutable template, `publication/4`, sets it. `parseContentDocument` gains the nesting
limit that only admission applied, which closes
[#125](https://github.com/kenhayward/alloy-works/issues/125).

**Designs:** [component-editor.md](../design/component-editor.md) (the authoring matrix, the identity
table, the invariants, CNT-077), [content-model.md](../design/content-model.md) (CNT-117, CNT-118,
CNT-153, CNT-002, CNT-023), [publishing.md](../design/publishing.md).

**Version:** 0.33.0 - a functional enhancement. Do not bump on the planning branch.

**On this file's name.** It was commissioned as `editor-04-lists-and-quotations`, and the name is
kept so the commission and the artifact match. It plans **lists only**, all three kinds; the reason
is the first thing below, and block quotations and preformatted text are the plan after it.

---

## Scope: this should be two pull requests, and here is the seam

**The commission - lists, block quotations and preformatted text, with their published half - is too
much for one pull request.** The marks slice ran to thirteen tasks over one family of inline marks
that changed no node, no plugin and no invariant. This slice changes three plugins, the doc's own
content expression, the mapping in both directions, the command registry's shape, the stored list
item, the published document's block type and the template - before any family is added. Three
families on top of that is not a review anybody can hold in their head.

**Recommended split:**

| Pull request                                          | What it carries                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor 4 - lists** (this plan)                      | #125 on every write path; identity and adjacency at depth; the mapping's recursion; the stored item widened with a term; four list nodes; the structural commands; the registry widened; the list controls and the list panel; CNT-153; `publishing/4`; `publication/4`; veraPDF |
| **Editor 5 - block quotations and preformatted text** | `blockquote` and `preformatted`, their toolbar commands, `BlockQuote` and `Code` in template 5, and the face-aware `covers` with Liberation Mono (decision G)                                                                                                                    |

**Why lists first, and not the other way round.** The engineering argument runs the other way:
a blockquote nests one level and would prove the descent work with smaller tests, so doing it first
de-risks the plugin rewrite. Lists win anyway for three reasons. Four T1 rows sit behind lists
(CNT-015 superseded into CNT-117, CNT-118 and CNT-119, itself now superseded by CNT-153) against one
each for the other two. Lists are the family that stresses the descent rewrite hardest - structural
commands, unbounded depth, an item that is a node carrying no identifier, and now a third kind whose
item has a shape of its own. And if only one of the two lands, lists is the one a reader of the
product notices.

**What the second pull request inherits, free:** every plugin, the mapping's recursion, `assemble`'s
recursive block walk, the published document's recursive shape, and #125's test. It is a small PR.

---

## Global constraints

- **TDD.** No production code without a failing test that preceded it, and the failure watched.
- **No dashes in user-facing text.** A plain hyphen in every UI string, catalogue entry and changelog
  bullet. Code and comments are exempt. **Read decision H before writing the template**: the engine
  inserts an em dash of its own in one place, and that place is in the next slice, not this one.
- **Invented names only** in fixtures: Ada, Grace, Alice. No real person, address or document.
- **The console gate.** A passing run has no `console.error` or `console.warn`. A test that provokes
  noise on purpose calls `allowConsoleNoise()`.
- **`<StrictMode>`.** Every `apps/web` test renders under it. Every test that touches the ProseMirror
  view first waits for the surface:
  `await screen.findByRole('textbox', { name: 'Content of Install the printer' })`. Never touch the
  `onView` handle before that await; the repository has lost time to exactly that race.
- **`packages/editor` runs in Node.** No `document`. A `toDOM` result is asserted as the spec array it
  returns; what a browser makes of it is asserted once, in `apps/web`, under jsdom.
- **Affected suites only** while working: `pnpm --filter @alloy-works/editor test`,
  `--filter @alloy-works/domain test`, `--filter @alloy-works/web test`,
  `--filter @alloy-works/worker test`, `--filter @alloy-works/db test`. Never the root `pnpm test`,
  never `turbo run test`, never `pnpm test:e2e`.
- **`pnpm --filter @alloy-works/worker fetch-typst` and `fetch-verapdf`** once, before task 11.
- **Order at the end:** `pnpm format` (prettier --write), then
  `pnpm --filter @alloy-works/trace generate`, then `pnpm trace check` and `pnpm trace pins`.
- **Never** run `pnpm dev:setup`, write to the development database, or stop or restart a container.

---

## What was run before this plan was written, and what it settled

Six questions, each answered by the smallest thing that answers it. Nothing was built; every spike
file was deleted and `packages/editor/package.json` and `pnpm-lock.yaml` were reverted.

### 1. Preformatted text has no monospace face, and this time it shows

A page was compiled with the pinned Typst 0.15.1, the pinned faces and `--pdf-standard ua-1`, and
looked at as a PNG at 300 ppi. **Preformatted text set in Liberation Serif at the body size is
indistinguishable from a paragraph**, and worse than that:

- **The columns whitespace exists to make do not line up.** `mode  = duplex`, `tray  = 2` and
  `iiii  = mmmm`, each with two spaces before the `=`, put the `=` at three different places on the
  page. The bytes are preserved; the alignment is not. A reader cannot read a configuration file, a
  table of values or anything positional.
- **Passing `lang:` to Typst's `raw` deletes whitespace.** `mode:  duplex` - two spaces - is set as
  `mode:duplex`, with no space at all, because the highlighter tokenises and re-joins. It also sets
  the tokens in **colour and nothing else**, which is a distinction a reader who cannot see colour
  does not get. Both of those are CNT-018's own words broken by the thing meant to serve them. So
  **`raw` is never given a language**, in this slice or the next: the label is stored, and the engine
  is never told it.
- A grey panel behind the block (`block(fill: luma(240), inset: 6pt)`) does make it unmistakably a
  block without a face and without colour alone, which is the mitigation decision G weighs.

**Then the cost of a face was measured, and decision C of the marks plan turns out to rest on a
mix-up.** That decision said pinning Liberation Mono "would tighten `PinnedFonts.covers` ... and so
would shrink the publishable character set that publishing 1a established at 4,170 code points in 19
ranges." Those are two different sets. The 4,170 is `SET_WITHOUT_A_GLYPH` in
`packages/domain/src/publishing/glyphs.ts`, the list of characters the **engine** sets without
drawing a glyph; it is measured against Typst and has nothing to do with which faces are pinned.
What `covers` actually holds, measured:

| Intersection                                            | Code points | Ranges |
| ------------------------------------------------------- | ----------- | ------ |
| The four pinned Liberation Serif faces (today)          | **2,321**   | 127    |
| The four Liberation Mono faces                          | 2,305       | 129    |
| All eight together, which is what `covers` would become | **2,305**   | 129    |

**Pinning Liberation Mono costs sixteen code points**, and they are: U+0237 (dotless j), U+2000 to
U+2006, U+2008 to U+200B (the fixed-width spaces), U+2016 (double vertical line), U+202F (narrow
no-break space), U+F004 (private use) and U+FFFC (object replacement). U+200B is already exempt
through `SET_WITHOUT_A_GLYPH`, and the last two are not characters an author writes, so **thirteen
characters an author could write would become unpublishable**: the dotless j, eleven typographic
spaces and the double vertical line. The Liberation 2.1.5 release's serif files hash byte for byte to
the repository's pinned files, so the mono files are the same release under the same SIL OFL 1.1
(ADR-0010). **Ken's answer is decision G**, and it is the next slice's to build.

### 2. Identity across the commands that create blocks at depth

The real `identityPlugin` and `annotationsInOnePiece` were driven over a schema shaped to the stored
model. **`identityPlugin` gives no identifier to any block below the top level**, in every case:

| Gesture                               | What came out                                                        |
| ------------------------------------- | -------------------------------------------------------------------- |
| `wrapInList` over a paragraph         | the new `list` got one (it is top level); the paragraph kept its own |
| `splitListItem` at the end of an item | the new item's paragraph: **`id=null`**                              |
| `sinkListItem`                        | the nested `list` it makes: **`id=null`**                            |
| Enter at the end of a nested item     | the new paragraph: **`id=null`**                                     |
| `splitBlock` inside a blockquote      | the new paragraph: **`id=null`**                                     |
| Typing into an unidentified paragraph | still `id=null`                                                      |

It is `oldState.doc.forEach` and `newState.doc.forEach` - one level - and so is
`noAdjacentEmptyParagraphs`. **`fromEditor` throws on a block with no identifier**, so as things
stand the first Enter an author presses inside a list item makes the component unsaveable. This is
task 3, and it is the largest piece of work in the slice.

**`annotationsInOnePiece` needs no change, and that is not obvious.** A mark spanning two list items
keeps one identifier and is **not** repaired, because `spansOf` joins two runs when
`doc.textBetween` between them is empty and a block boundary reads as empty. The stored model agrees:
`parseContentDocument` accepts one mark identifier across two list items, and accepts one that
reappears in a paragraph after the list, and refuses one split by readable text in the same
paragraph. Editor and model see the same annotation. Pin it with a test rather than trusting it.

**What does not agree:** the model's `refuseAdjacentEmpties` runs over **every** block sequence,
list items included, and refuses two adjacent empty paragraphs inside one item; the editor's plugin
never looks there. That is task 4.

### 3. `prosemirror-schema-list`, or commands of our own - and the answer differs by kind

**It is not a dependency today.** Version 1.5.1 was added, driven, and removed.

**For a bulleted or a numbered list, a schema shaped to the stored model works with its commands
unchanged.** `list` with `content: 'listItem+'`, `listItem` with `content: 'block+'` and
`defining: true` and **no attributes** - which is exactly the stored shape,
`items: [{ content: BlockNode[] }]`, where an item carries no identifier - drove `wrapInList`,
`splitListItem`, `sinkListItem` and `liftListItem` with no adaptation at all. Sinking made a nested
list inside the item; lifting put it back; the document came out in the shape the stored model
holds. **Take the dependency.** Writing three structural commands by hand to reach the same place
would be a few hundred lines of position arithmetic with no test suite behind it.

**For a definition list, two of the four decline, and it is exactly the two that create items.**
With `definitionItem` shaped `content: 'term block+'`:

| Command                         | Verdict                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sinkListItem(definitionItem)`  | **works unchanged** - the nested definition list came out right                                                                                                                            |
| `liftListItem(definitionItem)`  | **works unchanged** - and put it back                                                                                                                                                      |
| `splitListItem(definitionItem)` | **returns false**, from the end of the term and from the end of the body alike: the remainder of a split is a paragraph, which cannot be an item's first child where that must be a `term` |
| `wrapInList(definitionList)`    | **returns false**: it cannot make an item that needs a `term` out of a paragraph                                                                                                           |

So `splitDefinitionItem` and `makeDefinitionList` are ours, and nothing else is. Both are small and
task 6 specifies them.

**The one trap in the counted kinds, and it looks correct until it is run.** `splitListItem`
**returns false** in an empty list item - it declines, expecting the keymap to fall through to
`liftListItem`. Today's `enterWithoutEmpties` returns **true** and does nothing when the cursor is in
an empty paragraph. Bind Enter to `enterWithoutEmpties` first and an author who presses Enter in an
empty list item is trapped in the list with no key that leaves it. The order is fixed in task 6 and
has a test of its own.

### 4. What a reader gets from a list in the tagged PDF

Compiled and read with pdf.js and the pinned veraPDF. **veraPDF: compliant, zero failures**, for the
counted kinds and for definition lists alike. The roles for a nested bulleted list:

```
L, LI, Lbl, LBody, P, L, LI, Lbl, LBody, P, L, LI, Lbl, LBody, LI, Lbl, LBody, ...
```

**A counted list reaches a reader as a real list, at every level.** `L` holds `LI`; each `LI` holds
`Lbl` - the marker or the number - and `LBody`; a nested list is an `L` inside its parent's `LBody`.
That is the full PDF/UA list structure, and it is not the bare-`Span` disappointment the marks slice
found. The extraction carries the labels as text: an ordered list with `start: 5` and alphabetic
numbering gave `e.` and `f.`; an ordered list nested in an unordered one gave `•`, then `1.` and `2.`.
A list item holding two paragraphs came out as one `LI` with both paragraphs under the one label.

**A definition list is weaker, and the plan says so rather than claiming the structure.** Typst
0.15.1's `terms` element gives:

```
L, LI, Lbl, Span, LBody, LI, Lbl, Span, Span, Span, LBody, Span, ...
```

**It is a list, not a definition list.** PDF/UA has `DL > DI > (DT, DD)` for exactly this, and Typst
0.15.1 emits none of those and offers no way to ask for another role. What a reader gets instead: the
term in the item's `Lbl` and the definition in its `LBody`, which a screen reader announces as a
label followed by a body. That is materially better than bare `Span`s - the term really is the
label, and a term carrying marks keeps them, as `Span`s inside the `Lbl` - and it is materially less
than the structure the format has. A nested definition list is an `L` inside its parent's `LBody`,
and a definition list inside a bulleted list is too. **This goes in the changelog's Known limits and
is why CNT-079 stays unclaimed on more than the headings argument.**

**Typst's own default list markers break the compile.** They are `•`, `‣`, `–`, and **U+2023 is not
in Liberation Serif**, so a two-level unordered list fails with
`PDF/UA-1 error: the text "‣" could not be displayed with font "Liberation Serif"` - not a warning,
not a fallback, a refused compile. Candidates were compiled one by one: `•` U+2022, `◦` U+25E6, `▪`
U+25AA, `–` U+2013, `·` U+00B7, `-` U+002D, `●` U+25CF and `■` U+25A0 all set; `⁃` U+2043 does not.
The template pins `([•], [◦], [▪])`, which is the disc/circle/square convention a reader knows.
That the template is the wrong home for it is [#158](https://github.com/kenhayward/alloy-works/issues/158).

**`start: 0` on a roman list prints `n.`** - Typst's _nulla_. An author could ask for a list that
begins `n., i., ii.`. Ken's answer is CNT-153 and decision F.

**Typst has no mutual recursion between top-level `let` bindings.** The obvious template shape -
`block-of` calling `list-of` calling `block-of` - fails with `error: unknown variable: blocks`,
because a binding sees only what was bound before it. The template must use **one self-recursive
function** over every block kind, with the list branch inside it. The exact fragment is in task 10
and it compiles.

### 5. Where #125's check belongs, and whether it refuses anything an author can now make

**The check belongs in `parseContentDocument`**, before `contentDocumentSchema.parse`. That function
is the single door: `packages/db/src/editing.ts` (an iteration), `promotion.ts` (cutting a version),
`versions.ts` (read-back), `migrate.ts` and `admit.ts` all go through it, and
`packages/editor/src/mapping.ts`'s `fromEditor` calls it in the renderer before a save leaves the
browser. One line closes every path.

**It refuses nothing an author can make.** Measured against `exceedsLimits`:

| Levels of list nesting | Verdict                     |
| ---------------------- | --------------------------- |
| 6 (CNT-118's floor)    | within                      |
| 20, 21, 22, 30         | within                      |
| 40                     | `nested more than 128 deep` |

So the limit bites somewhere above thirty levels of list. CNT-118 asks for six. That the number is a
JSON depth rather than a decision about content is
[#159](https://github.com/kenhayward/alloy-works/issues/159).

**What it costs, and what not having it costs.** `exceedsLimits` over a 400-paragraph component:
**0.070 ms**, against `parseContentDocument`'s own **0.462 ms** on the same input - about a sixth
added to a parse that already runs on every iteration. What it buys: at 1,000 levels today,
`parseContentDocument` throws **`RangeError: Maximum call stack size exceeded`** - an uncaught stack
overflow on the save route, not a named refusal. At 200 levels it simply **accepts** content
admission would refuse. Both stop.

### 6. Does a definition list force content schema version 2? No - the widening is additive

**This was the question the slice turned on, and the answer is measured rather than argued.** A
candidate item schema was built - `z.strictObject({ term: z.array(inlineNodeSchema).min(1).optional(), content: z.array(blockNodeSchema).min(1) })` -
and run against the real `canonicalJson`, the real `parseContentDocument` and the real migration
chain:

| Asked                                                          | Answer                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Does today's stored item `{ content: [...] }` still parse?     | **Yes**, and the parsed object's keys are `["content"]` - no `term`                               |
| Is the canonical form identical before and after the widening? | **Yes**, character for character, so **no version digest moves**                                  |
| Does an inline term carrying a mark parse and canonicalise?    | **Yes**                                                                                           |
| Does today's schema refuse a term?                             | **Yes** - so the change goes one way only, which is what makes it a widening                      |
| Does the migration chain need an entry?                        | **No**. `contentMigrationChain.migrations` stays `{}` and `CURRENT_SCHEMA_VERSION` stays `1`      |
| And an explicit `term: undefined`?                             | zod leaves the key present, and `canonicalJson` drops it anyway, so the digest is safe either way |

**So the definition form lands here, CNT-117 is honoured in full, and #101 and #88 stay exactly where
they are.** Those two genuinely restructure - a mark gains a member, and `caption` changes kind from
`string` to inline content - and they still need version 2. This does not: nothing is restructured,
no stored document changes shape, and CNT-012's fixture set does not grow.

---

## Decisions

Each is a recommendation with the alternative that was rejected and why. A to E change what ships;
F to I are rulings.

**A. Take `prosemirror-schema-list` as a dependency of `packages/editor`, and shape the schema to
the stored model rather than the other way round.** Spike 3 drove all four commands unchanged against
a schema that is the stored model's shape exactly, and two of the four against the definition form.
_Rejected:_ hand-written structural commands with no suite behind them, to avoid a 10 kB MIT
dependency from the same authors as the six ProseMirror packages already pinned.

**B. A definition list item carries an optional `term` of inline content:
`{ term?: InlineNode[]; content: BlockNode[] }`.** Spike 6 shows the widening is additive: no schema
version, no migration, no digest moves. The stored shape is **insert-only**, so what is written here
is accepted for ever; these are the four shapes that were weighed and why three lost.

| Shape                                                                | Why not                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `term?: string`, like `caption`                                      | **This is the #88 mistake, booked again.** A plain-string `caption` is exactly why an equation, a mark or a cross-reference cannot go in one, and fixing it needs a schema version. A term is a phrase an author writes; it will want emphasis, a defined term mark, an inline equation. Refused outright |
| No new member: the term is the item's first block, by convention     | Nothing marks which block is which, which is the defect being fixed; and the publisher could not tell a term from a definition, so `Lbl` would get whatever came first                                                                                                                                    |
| A discriminated union on `kind`, with a separate item shape per kind | Also additive at the data level, and arguably tidier - but it turns one exported `listNodeSchema` into a union every consumer must narrow, for a distinction one optional member already carries. Kept in reserve if a second per-kind member ever appears                                                |
| **`term?: InlineNode[]`, optional on every item**                    | **Chosen.** One member, additive, inline from the start so the #88 debt is never booked, and `min(1)` so a term that is there is never empty                                                                                                                                                              |

The cost of the chosen shape is that `term` is _structurally_ allowed on an item of any kind, where
it means nothing on a counted one. That is closed by a **rule in the walk, not the schema**:
`checkBlock` refuses an item carrying a term where `kind` is not `definition`, and refuses an item
**lacking** one where it is. A rule is the right home because it is a narrowing, and a narrowing is
safe to add now while nothing has stored a list; a schema that expressed it would be the union above.

**C. Four editor node types for one stored node, and the editor's schema is not the stored model
one-for-one here.** `list`/`listItem` for `ordered` and `unordered`, `definitionList`/`definitionItem`
for `definition`, and `term` as the definition item's own textblock. A ProseMirror node's content
expression is fixed per type, so one `listItem` cannot be `block+` for two kinds and `term block+`
for the third. _Rejected:_ `listItem` as `content: 'term? block+'`, which would make
`splitListItem` split the term instead of the body in a definition item and would put an optional
first child in the way of every command that assumes the item opens with a block.

**D. `publishing/4` and `publication/4`.** `PublishedBlock` becomes a union and a template version is
immutable. Templates 1, 2 and 3 go on reading their own schemas, byte for byte. _Rejected:_ adding an
optional `items` member that template 3 ignores, which would print a document's lists as nothing at
all with nothing saying so.

**E. A list is carried only under a layout, exactly as a run's marks are.** `publishing/1` and
`publishing/2` hold paragraphs alone and are frozen; `assemble` with no layout goes on refusing a
list with `block_not_publishable`. _Rejected:_ back-filling the frozen schemas, which would change
what a request recorded before migration 0018 publishes as.

**F. `start` is 1 or more, except in decimal where 0 is allowed - and the corpus says so first.**
Typst sets a roman zero as `n.`, and "n., i., ii." is not a numbering any author asked for. Ken's
answer: CNT-119 is **superseded by CNT-153**, which reads the rule, landed by this pull request with
its change-history row (task 12). The editor's refusal and `assemble`'s then enforce what the corpus
requires rather than the product being quietly stricter than its own requirement. `assemble`'s is
`block_not_publishable` with detail `list:start`. _Rejected:_ tightening `listNodeSchema`'s `min(0)`,
which is an insert-only stored shape and would refuse a document nobody has stored; and equally
rejected, letting it through and printing `n.`

**G. The monospace face is settled and belongs to the next pull request.** Ken's answer:
`covers(codePoint, 'body')` and `covers(codePoint, 'code')` - **two sets from one loader, one branch
in `characterProblems`** - with Liberation Mono pinned beside Liberation Serif. `assemble` already
knows which block it is in, so the body set does not narrow at all and the thirteen writable code
points spike 1 measured are not lost anywhere they are used. Recorded here so editor 5 starts from a
settled answer; nothing in this slice builds it, because nothing here sets code.

**H. The engine writes an em dash into a block quotation's attribution, and the next slice must not
use `quote(attribution:)`.** Typst sets `— Ada Lovelace`, right-aligned, with a U+2014 the author
never typed, and tags the whole attribution as a bare `Span` - so a reader is not told it is an
attribution either. Recorded here because it was measured here; the slice that acts on it is the next
one, which should set the attribution itself rather than hand it to `quote`.

**I. Issue #125 is closed in this slice, in `parseContentDocument`, and its test is a list.** The
marks plan's decision H deferred it to exactly here. Task 1, and it lands **first**, because every
other task in the plan writes through that function.

---

## Requirements

**Cited by this slice** - each because a test's own body demonstrates the statement, and the design
that claims it claims it in full:

| ID          | Claimed by          | What demonstrates it                                                                                                                                                                                 |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-117** | content-model.md    | All three kinds are made in the editor, round-trip through the mapping unchanged, and reach the PDF: bulleted, numbered and definition                                                               |
| **CNT-118** | content-model.md    | Six levels of nesting in a mixture of all three kinds, made by the commands, round-tripped, and published                                                                                            |
| **CNT-153** | content-model.md    | A numbered list's start and numbering are set by the author and reach the PDF as `e.` and `f.`; a start of 0 is refused on a lettered or roman list, named, and allowed on a decimal one             |
| **CNT-002** | content-model.md    | A block created at depth - by a split, a sink and an Enter at the end of a nested item - carries a freshly allocated identifier, unique within the component, and never one already in it            |
| **CNT-023** | content-model.md    | The second of two adjacent empty paragraphs inside one list item is removed by the editor, so the editor cannot make the document the model refuses                                                  |
| **CNT-010** | content-model.md    | Content nested past the limit is refused on creation, on change and on read-back, because all three go through `parseContentDocument`                                                                |
| **CNT-077** | component-editor.md | Every command in the widened `EDITOR_COMMANDS` has a shortcut in the keymap and a button in the toolbar, asserted as one invariant over the registry, and the list panel is driven by keyboard alone |

**CNT-117 and CNT-118 are citable only because Ken chose to give the definition list a real shape.**
The first draft of this plan shipped two kinds and left both uncited, with the definition list named
as a gap. Both statements say "three kinds", and two of three is not a demonstration.

**Deliberately not cited, with the reason:**

- **CNT-079** - "headings, lists, tables, footnotes" as structure to assistive technology. Two
  reasons now, not one: headings are the document view's and tables and footnotes are not built; and
  spike 4 found that a definition list reaches a reader as `L`/`Lbl`/`LBody` rather than
  `DL`/`DT`/`DD`, so even the list half is not the structure the format has. Stays unclaimed.
- **PUB-090** - the veraPDF half passes here; the Matterhorn Protocol checkpoints "only a person can
  judge" do not, and no design claims it. Named, as the marks plan named it.
- **CNT-094** - a block's appearance comes from a named style. A list marker is appearance and this
  slice pins it in the template rather than in a style. themes.md owns the claim; the gap is #158.
- **CNT-119** - superseded by CNT-153 in this pull request. Its claim in content-model.md is
  **repointed** to CNT-153, as CNT-099's was to CNT-147, not added beside it.
- **CNT-124** - already `Covered`. The `block+` change touches it and task 2 has a regression test,
  but a regression test is not a second demonstration.

---

## File structure

| File                                                           | Responsibility                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/domain/src/content/model/document.ts`                | Modify: the nesting limit before the parse; the term rule in `checkBlock`                              |
| `packages/domain/src/content/model/blocks.ts`                  | Modify: `listNodeSchema`'s item gains an optional inline `term`                                        |
| `packages/domain/src/content/model/document.test.ts`           | Modify: #125's tests, and the term rule                                                                |
| `packages/editor/package.json`                                 | Modify: `prosemirror-schema-list` as a dependency, pinned exactly                                      |
| `packages/editor/src/schema.ts`                                | Modify: `block+`, and the `list`, `listItem`, `definitionList`, `definitionItem` and `term` nodes      |
| `packages/editor/src/schema.test.ts`                           | Modify                                                                                                 |
| `packages/editor/src/identity.ts`                              | Modify: the descent rule at any depth                                                                  |
| `packages/editor/src/identity.test.ts`                         | Create                                                                                                 |
| `packages/editor/src/state.ts`                                 | Modify: adjacency at depth, the Enter chain, the list keymap                                           |
| `packages/editor/src/blocks.ts`                                | Create: the block commands, `splitDefinitionItem`, `makeDefinitionList`, `listAt`, `setListAttributes` |
| `packages/editor/src/blocks.test.ts`                           | Create                                                                                                 |
| `packages/editor/src/marks.ts`                                 | Modify: `EditorCommand` becomes a union; `EDITOR_COMMANDS` gains five rows                             |
| `packages/editor/src/mapping.ts`                               | Modify: recursive both ways over all three kinds; `unsupportedIn` recursive                            |
| `packages/editor/src/index.ts`                                 | Modify: the new exports                                                                                |
| `packages/editor/style.css`                                    | Modify: how a list is set on the surface                                                               |
| `apps/web/src/editor/EditorToolbar.tsx`                        | Modify: block commands beside the mark commands                                                        |
| `apps/web/src/editor/ListPanel.tsx`                            | Create: kind, start and numbering                                                                      |
| `apps/web/src/editor/ComponentEditor.tsx`                      | Modify: the panel, and `F6` reaching it                                                                |
| `packages/domain/src/publishing/published.ts`                  | Modify: `PublishedList`, `PublishedBlock` a union, `publishing/4`                                      |
| `packages/domain/src/publishing/assemble.ts`                   | Modify: `publishable` recurses; a term's runs; the `list:start` refusal                                |
| `apps/worker/templates/publication/4/main.typ`                 | Create: template 3 plus one self-recursive `block-of` and the pinned marker set                        |
| `apps/worker/src/template.ts`                                  | Modify: version 4, its hash, and the reading map                                                       |
| `apps/worker/src/lists.test.ts`                                | Create: the PDF a list makes, through veraPDF                                                          |
| `docs/specification/requirements/CNT-content-and-authoring.md` | Modify: CNT-153, CNT-119 superseded, and the change history                                            |

---

## Task 1: one nesting limit on every path that stores content (issue #125)

**Files:** modify `packages/domain/src/content/model/document.ts` and `document.test.ts`.

**Lands first**, because every later task writes through `parseContentDocument`.

**Produces:** `parseContentDocument` calls `exceedsLimits` on its input **before**
`contentDocumentSchema.parse`, and throws naming what was exceeded. Nothing else moves: the limit
lives in `packages/domain/src/content/admission/limits.ts` and is imported, never restated.

- [ ] **Step 1: write the failing tests**

```ts
/** A list nested `levels` deep, holding one paragraph at the bottom. */
const nested = (levels: number) => {
  /* as the spike built it */
};

it('CNT-010 refuses content nested past the limit, on every path that parses it', () => {
  expect(() => parseContentDocument(documentWith(nested(1_000)))).toThrow(
    /nested more than 128 deep/,
  );
  // And it is a refusal, not a stack overflow: today this is a RangeError.
  try {
    parseContentDocument(documentWith(nested(1_000)));
  } catch (error) {
    expect(error).not.toBeInstanceOf(RangeError);
  }
});

it('refuses content admission would refuse, which today it accepts', () => {
  // 200 levels is within the stack and over the limit: today this returns a document.
  expect(() => parseContentDocument(documentWith(nested(200)))).toThrow(
    /nested more than 128 deep/,
  );
});

it('CNT-118 accepts a list nested far deeper than six levels', () => {
  // Thirty levels is within the limit, so the limit refuses nothing an author can make.
  expect(parseContentDocument(documentWith(nested(30))).content).toHaveLength(1);
});
```

- [ ] **Step 2: run it red.** Expected: the 1,000-level case throws
      `RangeError: Maximum call stack size exceeded`, so the `toThrow(/nested more than/)` fails on
      the message; the 200-level case does not throw at all.
- [ ] **Step 3: write it.** One call at the top of `parseContentDocument`. The message is
      `exceedsLimits`' own sentence, prefixed so a caller can tell which document it was about, and
      carries **no word of the author's text** - the rule `claimRange`'s message follows.
- [ ] **Step 4: green**, with `pnpm --filter @alloy-works/domain test`. Then run the `db` suite too:
      `parseContentDocument` is on the save path and a fixture somewhere may be deeper than it looks.
- [ ] **Step 5: commit.** `fix(domain): hold every write path to the nesting limit (#125)`

The pull request body carries `Fixes #125` on its own line.

---

## Task 2: the stored item carries a term, and the walk holds the rule the schema cannot

**Files:** modify `packages/domain/src/content/model/blocks.ts` and `document.ts`; modify
`document.test.ts`.

**Produces:** one widened member, and one rule:

```ts
// An item of a definition list carries the term it defines, as inline content rather than a string:
// a term is a phrase an author writes, and a plain string is what makes an equation, a mark or a
// cross-reference unrepresentable in a caption (#88). Optional, and so additive: every document
// stored under schema version 1 stays valid, the canonical form of one is unchanged, and the
// migration chain stays empty (the plan's spike 6). Which items must have one is a rule in the walk
// below, not a shape here, because it is a narrowing and nothing has stored a list yet.
items: z
  .array(
    z.strictObject({
      term: z.array(inlineNodeSchema).min(1).optional(),
      content: z.array(blockNodeSchema).min(1),
    }),
  )
  .min(1),
```

and in `checkBlock`'s `list` branch: an item carrying a `term` where `kind` is not `definition` is
refused by name; an item **lacking** one where `kind` is `definition` is refused by name. A term's
inline content goes through `checkInlineContent` in the same scope as the rest of the component, so a
mark in a term claims its identifier exactly as one in a paragraph does.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-117 holds a definition list, each item carrying the term it defines', () => {
  const document = parseContentDocument(documentWith([definitionList()]));
  expect((document.content[0] as ListNode).items[0]!.term).toEqual([
    { type: 'text', value: 'Tensile strength', marks: [] },
  ]);
});

it('keeps a document stored before the term existed valid, and its canonical form unchanged', () => {
  // The digest is what an unchanged version rests on: a widening that moved it would record a
  // version for every component holding a list, for nothing (ADR-0024).
  const stored = documentWith([unorderedList('L1', ['alpha'])]);
  expect(canonicalise(parseContentDocument(stored))).toBe(CANONICAL_BEFORE_THE_WIDENING);
});

it('refuses a term on an item of a list that is not a definition list, naming it', () => {
  expect(() => parseContentDocument(documentWith([orderedListWhoseItemHasATerm()]))).toThrow(
    /term/,
  );
});

it('refuses an item of a definition list that has no term, naming it', () => {
  /* ... */
});

it('refuses a term with no inline content at all', () => {
  /* min(1) */
});

it('claims a mark in a term in the same scope as one in a paragraph', () => {
  // One mark identifier used in a term and again in a paragraph after the list is one annotation;
  // the same identifier split by readable text is refused, exactly as it is anywhere else.
});
```

- [ ] **Step 2: run it red.** Expected: `expected undefined to deeply equal [ { type: 'text', ... } ]` - `strictObject` is refusing `term` outright, so the first test fails on the parse.
- [ ] **Step 3: write it.** `CURRENT_SCHEMA_VERSION` stays `1` and `contentMigrationChain.migrations`
      stays `{}`. **If either has to change, stop and say so**: that would mean the widening is not
      additive after all, which spike 6 says it is.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(domain): a definition list item carries its term`

---

## Task 3: the editor schema holds all three kinds

**Files:** modify `packages/editor/src/schema.ts` and `schema.test.ts`; modify
`packages/editor/package.json`.

**Produces:** `doc`'s content goes from `paragraph+` to `block+`; `paragraph` joins the `block`
group **and is declared first**, so it stays what ProseMirror fills an empty document with
(CNT-124). Five nodes, of which four are new:

```ts
list: {
  group: 'block',
  content: 'listItem+',
  attrs: {
    id: { default: null },
    kind: { default: 'unordered' },   // 'ordered' | 'unordered'; a definition list is its own node
    start: { default: null },
    format: { default: null },        // 'decimal' | 'alphabetic' | 'roman'
  },
  parseDOM: [{ tag: 'ul' }, { tag: 'ol', getAttrs: () => ({ kind: 'ordered' }) }],
  toDOM: (node) => [node.attrs.kind === 'ordered' ? 'ol' : 'ul', 0],
},
// No attributes at all: the stored model's item is `{ term?, content }` and carries no identifier,
// so there is nothing for one to hold and nothing for identity to allocate.
listItem: { content: 'block+', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },

definitionList: {
  group: 'block',
  content: 'definitionItem+',
  attrs: { id: { default: null } },
  parseDOM: [{ tag: 'dl' }],
  toDOM: () => ['dl', 0],
},
// A ProseMirror node's content expression is fixed per type, so one item type cannot be `block+`
// for two kinds and `term block+` for the third: decision C.
definitionItem: { content: 'term block+', defining: true, toDOM: () => ['div', 0] },
// The term is a textblock, so it is an editable region of its own carrying its own marks - which is
// what makes a term inline content rather than a string.
term: { content: 'text*', marks: '_', defining: true, parseDOM: [{ tag: 'dt' }], toDOM: () => ['dt', 0] },
```

`prosemirror-schema-list` is added to `dependencies` **at an exact version**, as the six ProseMirror
packages already there are - no caret.

- [ ] **Step 1: write the failing tests**

```ts
it('holds a list and an item shaped as the stored model holds them', () => {
  expect(editorSchema.nodes.list!.spec.content).toBe('listItem+');
  expect(editorSchema.nodes.listItem!.spec.content).toBe('block+');
  // The item carries nothing: the stored item has no identifier, so neither has this.
  expect(editorSchema.nodes.listItem!.spec.attrs).toBeUndefined();
  expect(editorSchema.nodes.listItem!.spec.defining).toBe(true);
});

it('CNT-117 holds a definition list whose item opens with the term it defines', () => {
  expect(editorSchema.nodes.definitionList!.spec.content).toBe('definitionItem+');
  expect(editorSchema.nodes.definitionItem!.spec.content).toBe('term block+');
  // A term takes marks, because a term is inline content and not a string.
  expect(editorSchema.nodes.term!.spec.marks).toBe('_');
});

it('CNT-124 still fills an empty document with a paragraph, not a list', () => {
  const doc = editorSchema.node('doc', { title: 'T', language: 'en-GB', direction: 'ltr' });
  expect(doc.childCount).toBe(1);
  expect(doc.firstChild!.type.name).toBe('paragraph');
});

it('renders a numbered list as an ordered list and a bulleted one as unordered', () => {
  const ordered = editorSchema.node('list', { id: 'L1', kind: 'ordered' }, [
    editorSchema.node('listItem', null, [editorSchema.node('paragraph', { id: 'b1' })]),
  ]);
  expect(editorSchema.nodes.list!.spec.toDOM!(ordered)).toEqual(['ol', 0]);
});

it('CNT-118 lets every kind of item hold every kind of list, so any mixture nests', () => {
  for (const item of ['listItem', 'definitionItem']) {
    for (const list of ['list', 'definitionList']) {
      expect(
        editorSchema.nodes[item]!.contentMatch.matchType(editorSchema.nodes[list]!),
      ).not.toBeNull();
    }
  }
});
```

- [ ] **Step 2: run it red.** Expected: `Cannot read properties of undefined (reading 'spec')` -
      `editorSchema.nodes.list` does not exist.
- [ ] **Step 3: write it.** **Step 4: green.** Then `pnpm --filter @alloy-works/editor typecheck`.
- [ ] **Step 5: commit.** `feat(editor): three kinds of list in the editor schema`

---

## Task 4: the identity plugin descends

**Files:** modify `packages/editor/src/identity.ts`; create `packages/editor/src/identity.test.ts`.

**This is the task the slice exists around.** Today the plugin walks `doc.forEach` - top level only -
so every block a command makes at depth comes out with `id: null`, and `fromEditor` throws on it. The
spike found it in five separate gestures.

**Produces:** the same descent rule ADR-0023 states, applied at any depth. The walk becomes
`doc.descendants`, and it **skips nodes whose type declares no `id` attribute**, so `listItem`,
`definitionItem` and `term` are walked through and never named.

```ts
// Both walks collect (identifier, position) for every node whose type has an `id` attribute.
const identified = (doc: Node) => {
  /* doc.descendants, filtered on node.type.spec.attrs?.id */
};
```

**Three things that are true and are not obvious, each with a test:**

- **Positions are collected before any attribute is set.** `tr.setNodeAttribute` produces an
  `AttrStep`, which maps every position to itself, so one pass over positions read from `newState.doc`
  stays right for every renewal in the transaction. A test renews **two nested blocks in one
  transaction** and asserts both got identifiers and neither was written at the wrong position.
- **Association 1 still decides the heir**, unchanged, and a nested split must be shown to choose the
  same way a top-level one does.
- **An item and a term are never given an identifier**, and `fromEditor` never looks for one.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-002 gives a block made inside a list item an identifier of its own', () => {
  // A list of one item holding 'alpha'; cursor at the end; splitListItem.
  const after = run(stateWithList(), splitListItem(editorSchema.nodes.listItem!));
  const ids = blockIdentifiersIn(after.doc);
  expect(ids).toHaveLength(2);
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(2);
});

it('CNT-002 gives a list made by sinking an item an identifier of its own', () => {
  // Two items; cursor in the second; sinkListItem makes a nested `list` - today `id: null`.
  const after = run(twoItems(), sinkListItem(editorSchema.nodes.listItem!));
  expect(nodeAt(after.doc, ['list', 0, 'list']).attrs.id).toEqual(expect.any(String));
});

it('CNT-002 gives a block made at the end of a nested item an identifier of its own', () => {
  /* ... */
});

it('CNT-002 gives a definition list made by sinking a definition item one too', () => {
  /* ... */
});

it('names both of two blocks made at depth in one transaction, each at its own position', () => {
  // Two nested paragraphs inserted in one transaction: both named, and the text under each
  // identifier is the text that was there - the assertion that catches a position read too late.
});

it('leaves an item and a term unnamed, because the stored model gives neither an identifier', () => {
  expect(nodeAt(after.doc, ['list', 0]).attrs).toEqual({});
  expect(nodeAt(after.doc, ['definitionList', 0, 'term']).attrs).toEqual({});
});

it('keeps the descent rule: the block at its identifier mapped forward keeps it', () => {
  // A split inside an item: the first half keeps `b1`, the second half is renewed. Not the reverse.
});

it('draws again rather than allocating an identifier the component already carries', () => {
  // newIdentifier returns a taken identifier once, then a fresh one.
});
```

- [ ] **Step 2: run it red.** Expected: `expected null to be any String` on the first four, because
      the plugin never reaches those nodes.
- [ ] **Step 3: write it.** Keep the existing comment's account of association 1 and extend it to say
      why the walk descends and why an item and a term are skipped. **Do not change the rule** - only
      its reach.
- [ ] **Step 4: green.** Run the whole editor suite: the top-level tests in `state.test.ts` are the
      regression that says the rule did not change.
- [ ] **Step 5: commit.** `feat(editor): allocate an identifier for a block at any depth`

---

## Task 5: adjacency descends too

**Files:** modify `packages/editor/src/state.ts`; modify `packages/editor/src/state.test.ts`.

**Consumes:** task 3's schema. **Produces:** `noAdjacentEmptyParagraphs` walks every block sequence,
not the top level, because `refuseAdjacentEmpties` in `packages/domain` already does - it runs over
the top level, a list item, a blockquote, a table cell and a footnote. The editor is the half that
disagrees, and a rule the two write paths disagree on is a rule one of them breaks.

The walk collects removals from the **innermost sequence outwards** and applies them back to front,
as it does now, so a removal never invalidates a position collected earlier.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-023 removes the second of two adjacent empty paragraphs inside one list item', () => {
  // A list item holding two empty paragraphs, reached by a transaction: one is left.
  expect(paragraphsIn(after.doc, ['list', 0])).toHaveLength(1);
});

it('CNT-023 does the same inside a definition item, beneath its term', () => {
  /* ... */
});

it('does not remove an empty paragraph that is the only one in its item', () => {
  /* CNT-124 */
});

it('never makes a document the stored model refuses', () => {
  // The invariant stated as the seam it is: whatever the plugin leaves, `fromEditor` accepts.
  expect(() => fromEditor(after.doc)).not.toThrow();
});
```

- [ ] **Step 2: run it red.** Expected: `expected length 2 to be 1` - the plugin never looked inside.
- [ ] **Step 3: write it.** **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): hold the adjacency rule at every depth`

---

## Task 6: the mapping carries all three kinds, both ways

**Files:** modify `packages/editor/src/mapping.ts` and `mapping.test.ts`.

**Produces:** `toEditor`, `fromEditor` and `unsupportedIn` recursive and inverse over every kind.
`unsupportedIn` reports a block type it has no node for **wherever it is**, including inside a list
item or under a term.

**`term` is omitted, never written as null**, which is the same bargain `markOf` strikes with a
hyperlink's `title`: the stored schema takes the member's absence and refuses null, and the editor
has no absence to spell. A `definitionItem` whose `term` node is empty is refused by name rather than
stored as a term of nothing - `z.array(...).min(1)` would refuse it at the save, and a message
written for a programmer is not what an author should meet.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-118 round-trips a list nested six levels deep, mixing all three kinds, unchanged', () => {
  const document = documentWith([sixLevelsMixingEveryKind()]);
  const opened = toEditor(document);
  expect(opened.editable).toBe(true);
  expect(fromEditor((opened as Extract<Opened, { editable: true }>).doc)).toEqual(document);
});

it('CNT-117 round-trips a definition list, its terms and their marks unchanged', () => {
  const document = documentWith([
    {
      type: 'list',
      id: 'D1',
      kind: 'definition',
      items: [
        {
          term: [
            { type: 'text', value: 'Tensile strength', marks: [{ type: 'emphasis', id: 'm1' }] },
          ],
          content: [paragraph('b1', 'The greatest stress a material bears.')],
        },
      ],
    },
  ]);
  expect(fromEditor(openedDoc(document))).toEqual(document);
});

it('CNT-153 keeps a numbered list start and its numbering format', () => {
  const document = documentWith([
    {
      type: 'list',
      id: 'L1',
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
      items: [{ content: [paragraph('b1', 'Check the readings')] }],
    },
  ]);
  expect(fromEditor(openedDoc(document))).toEqual(document);
});

it('omits a start, a format and a term a list does not have, rather than writing null', () => {
  // The schema's defaults are null and the stored shapes are strict: null is refused, absence is not.
  const document = documentWith([unorderedList('L1', ['alpha'])]);
  expect(fromEditor(openedDoc(document))).toEqual(document);
});

it('refuses a definition item whose term is empty, by name', () => {
  /* ... */
});

it('opens read-only for a block it cannot edit that is inside a list item, naming it', () => {
  // A table inside a list item: today `unsupportedIn` looks at the top level only.
  expect(toEditor(documentWith([listHolding(table())]))).toEqual({
    editable: false,
    unsupported: ['table'],
  });
});

it('opens read-only for a block it cannot edit that is under a term', () => {
  /* ... */
});
```

- [ ] **Step 2: run it red.** Expected: `{ editable: false, unsupported: [ 'list' ] }` on the
      round-trip test, because `unsupportedIn` still reports any block that is not a paragraph.
- [ ] **Step 3: write it.** `fromEditor`'s `runsOf` keeps throwing by name on a child it cannot
      store; the block walk gains the same treatment for a node type it has no stored shape for.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(editor): map all three kinds of list to and from the stored model`

---

## Task 7: the block commands, and the Enter chain

**Files:** create `packages/editor/src/blocks.ts` and `blocks.test.ts`; modify
`packages/editor/src/state.ts` and `index.ts`.

**Produces:**

```ts
export type BlockAction =
  'bulletedList' | 'numberedList' | 'definitionList' | 'nestItem' | 'liftItem';
export function blockCommand(action: BlockAction, newIdentifier: () => string): Command;
/** The list the cursor is inside, innermost first, or null: what the list panel reads. */
export function listAt(
  state: EditorState,
): { kind: string; start: number | null; format: string | null } | null;
/** Changes a list's kind, start or numbering, refusing a start a numbering cannot carry. */
export function setListAttributes(attrs: Record<string, unknown>): Command;
```

`bulletedList` and `numberedList` wrap `wrapInList`; where the cursor is already in a list of that
kind they **unwrap it** with `liftListItem`, so the button toggles, which is what every editor an
author has used does. `nestItem` and `liftItem` are `sinkListItem` and `liftListItem` over the item
type the cursor is in - **both of which spike 3 drove unchanged against a definition item as well as
a counted one.**

**Two commands are ours, because `prosemirror-schema-list`'s decline** (spike 3):

```ts
/**
 * `wrapInList(definitionList)` returns false: it cannot make an item that needs a term out of a
 * paragraph. This wraps the paragraph as the item's body and opens an empty term above it, with the
 * selection in the term, because the term is what an author types first.
 */
function makeDefinitionList(newIdentifier: () => string): Command;

/**
 * `splitListItem(definitionItem)` returns false from the term and from the body alike: a split's
 * remainder is a paragraph, which cannot be an item's first child where that must be a term.
 *
 * From the **term**, Enter does not split at all - it moves the cursor into the body, which is what
 * every definition list an author has used does and what they mean by pressing it.
 * From the **body**, Enter makes a new item whose term is empty and whose body holds the remainder,
 * and puts the selection in the new term.
 */
function splitDefinitionItem(newIdentifier: () => string): Command;
```

**The Enter chain, and the order is the whole of it:**

```ts
Enter: chainCommands(
  splitDefinitionItem(options.newIdentifier),   // the term and the body cases, both ours
  splitListItem(editorSchema.nodes.listItem!),  // declines in an empty item
  liftListItem(editorSchema.nodes.listItem!),   // which is what leaves the list
  liftListItem(editorSchema.nodes.definitionItem!),
  enterWithoutEmpties,                          // CNT-023, outside a list
),
```

> **The trap, measured.** `splitListItem` **returns false** in an empty list item rather than handling
> it. `enterWithoutEmpties` returns **true** and does nothing in an empty paragraph. Put
> `enterWithoutEmpties` anywhere before the two `liftListItem`s and an author who presses Enter in an
> empty list item is trapped in the list with no key that leaves it. Every command above it returns
> false outside a list, so the order is safe in both directions.

`Tab` and `Shift-Tab` are bound to `nestItem` and `liftItem` **as well as** `Mod-]` and `Mod-[`.
Both return false outside a list, so focus still leaves the surface on Tab everywhere else, which
CNT-077 needs: a Tab that is always swallowed is a keyboard trap.

- [ ] **Step 1: write the failing tests**

```ts
it('makes a bulleted list of the paragraph the cursor is in', () => {
  /* ... */
});

it('takes a paragraph back out of a list when the same command runs again', () => {
  /* ... */
});

it('CNT-117 makes a definition list with an empty term and the paragraph as its body', () => {
  const after = run(stateWith('The greatest stress.'), blockCommand('definitionList', ids));
  expect(shapeOf(after.doc)).toEqual(['definitionList', ['definitionItem', ['term', 'paragraph']]]);
  expect(after.selection.$from.parent.type.name).toBe('term');
});

it('CNT-117 moves from a term into its body on Enter, rather than splitting the term', () => {
  const after = run(inATerm('Creep'), enterCommand());
  expect(after.selection.$from.parent.type.name).toBe('paragraph');
  expect(termsIn(after.doc)).toEqual(['Creep']);
});

it('CNT-117 makes a new definition item on Enter in a body, with an empty term', () => {
  const after = run(inADefinitionBody(), enterCommand());
  expect(termsIn(after.doc)).toEqual(['Creep', '']);
  expect(after.selection.$from.parent.type.name).toBe('term');
});

it('CNT-118 nests an item under the item above it, to six levels and past them', () => {
  let state = sixSeparateItems();
  for (let level = 0; level < 6; level += 1) state = run(state, blockCommand('nestItem', ids));
  expect(depthOfDeepestList(state.doc)).toBe(6);
});

it('CNT-118 nests a definition item and lifts it back, in a mixture of kinds', () => {
  /* ... */
});

it('leaves the list when Enter is pressed in an empty item, rather than doing nothing', () => {
  const state = run(listWithEmptyLastItem(), enterCommand());
  expect(state.doc.lastChild!.type.name).toBe('paragraph');
});

it('CNT-023 still creates no second empty paragraph on Enter outside a list', () => {
  /* ... */
});

it('lets Tab move focus on when the cursor is not in a list', () => {
  expect(blockCommand('nestItem', ids)(stateWith('alpha'), () => undefined)).toBe(false);
});

it('CNT-153 refuses a start of zero on a lettered or roman list, and allows it on a decimal one', () => {
  expect(setListAttributes({ format: 'roman', start: 0 })(inAList(), () => undefined)).toBe(false);
  expect(setListAttributes({ format: 'alphabetic', start: 0 })(inAList(), () => undefined)).toBe(
    false,
  );
  expect(setListAttributes({ format: 'decimal', start: 0 })(inAList(), () => undefined)).toBe(true);
});
```

- [ ] **Step 2: run it red.** Expected: `Cannot find module './blocks.js'`.
- [ ] **Step 3: write it.** **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): commands for making, nesting and lifting list items`

---

## Task 8: the registry widens, and the toolbar shows the list commands

**Files:** modify `packages/editor/src/marks.ts`; create `apps/web/src/editor/ListPanel.tsx`; modify
`apps/web/src/editor/EditorToolbar.tsx`, `EditorToolbar.test.tsx` and `ComponentEditor.tsx`.

**`EditorCommand` becomes a union**, so CNT-077's invariant stays one assertion over one list rather
than splitting into two that can drift:

```ts
interface CommandBase {
  readonly label: string;
  readonly shortcut: string;
  readonly shortcutSaid: string;
  readonly prompts: boolean;
}
export type EditorCommand =
  | (CommandBase & { readonly kind: 'mark'; readonly mark: string })
  | (CommandBase & { readonly kind: 'block'; readonly action: BlockAction });
```

Every existing row gains `kind: 'mark'`. Five rows are added, after the nine marks. **These are the
exact user-facing words:**

| kind    | action / mark    | label           | shortcut      | shortcutSaid                         | prompts |
| ------- | ---------------- | --------------- | ------------- | ------------------------------------ | ------- |
| `block` | `bulletedList`   | Bulleted list   | `Mod-Shift-8` | Ctrl or Cmd, Shift and 8             | no      |
| `block` | `numberedList`   | Numbered list   | `Mod-Shift-7` | Ctrl or Cmd, Shift and 7             | no      |
| `block` | `definitionList` | Definition list | `Mod-Shift-9` | Ctrl or Cmd, Shift and 9             | no      |
| `block` | `nestItem`       | Nest item       | `Mod-]`       | Ctrl or Cmd and right square bracket | no      |
| `block` | `liftItem`       | Lift item       | `Mod-[`       | Ctrl or Cmd and left square bracket  | no      |

**The list panel.** It appears beside the toolbar while the cursor is inside a **counted** list, and
`F6` reaches it in the region order **component header, toolbar, list panel, surface**. A definition
list has nothing to set - no start, no numbering, and its kind is the button that made it - so no
panel appears for one, and that is a deliberate absence rather than an empty box. Exact words:

| Where                        | Words                                                |
| ---------------------------- | ---------------------------------------------------- |
| Panel label (`role="group"`) | `List`                                               |
| Kind field label             | `Kind`                                               |
| Kind options                 | `Bulleted`, `Numbered`                               |
| Start field label            | `Start at`                                           |
| Start field hint             | `The number the first item takes`                    |
| Numbering field label        | `Numbering`                                          |
| Numbering options            | `1, 2, 3`, `a, b, c`, `i, ii, iii`                   |
| Start refusal                | `Only a 1, 2, 3 list can start at 0. Try 1 or more.` |

The Numbering field is present only while Kind is Numbered, and is removed from the accessibility
tree rather than disabled when it is not - there is nothing for it to say about a bulleted list.

- [ ] **Step 1: write the failing tests**

```tsx
it('CNT-077 offers every command as a button reachable by keyboard alone', async () => {
  const buttons = within(screen.getByRole('toolbar', { name: 'Formatting' })).getAllByRole(
    'button',
  );
  expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
    'Strong',
    'Emphasis',
    'Underline',
    'Subscript',
    'Superscript',
    'Inline code',
    'Quoted phrase',
    'Link',
    'Language',
    'Bulleted list',
    'Numbered list',
    'Definition list',
    'Nest item',
    'Lift item',
  ]);
  expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  // End still reaches the last button, and ArrowRight still wraps from it.
});
```

```ts
it('CNT-077 gives every command a shortcut and one label, with no shortcut used twice', () => {
  expect(EDITOR_COMMANDS).toHaveLength(14);
  for (const command of EDITOR_COMMANDS) {
    const fancy = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(command.label + command.shortcutSaid).not.toMatch(fancy);
    if (command.kind === 'mark') expect(editorSchema.marks[command.mark]).toBeDefined();
  }
  expect(new Set(EDITOR_COMMANDS.map((c) => c.shortcut)).size).toBe(14);
});
```

```tsx
it('shows the list panel only while the cursor is in a counted list, and sets its numbering', async () => {
  // No panel with the cursor in a paragraph; Bulleted list, then the panel; set Numbered, then
  // Numbering to 'a, b, c' and Start at to 5; then:
  await waitFor(() =>
    expect(fromEditor(view!.state.doc).content[0]).toMatchObject({
      type: 'list',
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
    }),
  );
});

it('shows no list panel for a definition list, which has nothing to set', async () => {
  /* ... */
});

it('CNT-153 says why a start of 0 is refused on a lettered list, and changes nothing', async () => {
  expect(
    await screen.findByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.'),
  ).toBeInTheDocument();
});

it('CNT-117 writes a term the author typed into the definition list it saves', async () => {
  // Definition list, type 'Creep', Enter, type the definition, then the PUT body's content carries
  // a list of kind 'definition' whose item's term is that inline content.
});

it('CNT-077 moves between the header, the toolbar, the list panel and the surface with F6', async () => {
  /* ... */
});
```

- [ ] **Step 2: red.** Expected: `expected length 9 to be 14`; and no element with the role `button`
      and the name `Bulleted list`.
- [ ] **Step 3: write it.** **Step 4: green**, with `pnpm --filter @alloy-works/web test`.
- [ ] **Step 5: commit.** `feat(web): list controls in the toolbar, and a list panel`

---

## Task 9: how a list is set on the surface

**Files:** modify `packages/editor/style.css`; modify `packages/editor/src/schema.test.ts`.

Rules for `.ProseMirror ul`, `.ProseMirror ol`, `.ProseMirror li`, `.ProseMirror dl` and
`.ProseMirror dt`: the markers the template pins, set with `list-style-type: disc`, `circle` and
`square` at the three depths so the surface and the PDF agree; `ol` taking its marker from the node's
`format`; a term set apart from its definition without colour alone; and a nested list indented by
the editor's own step rather than the browser's default. No test asserts colour; one test asserts the
stylesheet parses and names each selector.

- [ ] **Step 1:** `it('styles a list at every level it can nest')`, reading `style.css` with
      `node:fs` and asserting one selector per level and one for a term.
- [ ] **Step 2: red.** Expected: `expected '.ProseMirror li li' to be found in style.css`.
- [ ] **Step 3:** write the rules. **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): set a list on the surface`

---

## Task 10: a published document carries a list

**Files:** modify `packages/domain/src/publishing/published.ts` and `assemble.ts`; modify
`assemble.test.ts`.

**Produces:**

```ts
export interface PublishedItem {
  /** The term this item defines, as runs, on a definition list's items and on no others. */
  readonly term: readonly PublishedRun[] | null;
  readonly blocks: readonly PublishedBlock[];
}

export interface PublishedList {
  readonly type: 'list';
  readonly id: string;
  readonly kind: 'ordered' | 'unordered' | 'definition';
  readonly start: number | null;
  readonly format: 'decimal' | 'alphabetic' | 'roman' | null;
  readonly items: readonly PublishedItem[];
}

export type PublishedBlock = PublishedParagraph | PublishedList;

export const PUBLISHING_SCHEMA_3 = 'publishing/3'; // frozen
export const PUBLISHING_SCHEMA = 'publishing/4';
```

`publishable` becomes recursive and goes on returning `PublishedBlock[]`, so a list every one of
whose items came out empty contributes nothing rather than an empty `L`. The glyph check and the
`style_missing` check reach a paragraph at any depth, because they are called from the paragraph
branch, which the recursion reaches. **A term's runs go through `publishedMarks` and the glyph check
exactly as a paragraph's do**, so a mark in a term prints and a character outside the faces in one is
named with its block.

One new refusal, `block_not_publishable` with detail `list:start`, when `start` is 0 and `format` is
`alphabetic` or `roman` (decision F, CNT-153). And, unchanged, `block_not_publishable` with detail
`list` when there is **no layout**: `publishing/1` and `publishing/2` hold paragraphs alone and are
frozen (decision E).

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-153 carries a list, its start and its numbering, and its items in order', () => {
  expect(blocksOf(assembled)).toEqual([
    {
      type: 'list',
      id: 'L1',
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
      items: [
        {
          term: null,
          blocks: [
            { type: 'paragraph', id: 'b1', runs: [{ text: 'Check the readings', marks: [] }] },
          ],
        },
        {
          term: null,
          blocks: [{ type: 'paragraph', id: 'b2', runs: [{ text: 'Note the serial', marks: [] }] }],
        },
      ],
    },
  ]);
});

it('CNT-117 carries a definition list, each item with the term it defines and its marks', () => {
  expect(itemsOf(assembled)[0]!.term).toEqual([
    { text: 'Tensile strength', marks: [{ kind: 'emphasis' }] },
  ]);
});

it('CNT-118 carries a list nested six levels deep, in a mixture of all three kinds', () => {
  /* ... */
});

it('carries the marks over a run inside a list item exactly as in a paragraph', () => {
  /* ... */
});

it('names a character outside the pinned faces in a term, with its block', () => {
  expect(failuresOf(result)).toEqual([
    expect.objectContaining({
      code: 'glyph_missing',
      block: 'b2',
      detail: 'U+0627',
    }),
  ]);
});

it('CNT-153 refuses a lettered or a roman list that starts at zero, naming it', () => {
  expect(failuresOf(result)).toEqual([
    expect.objectContaining({
      code: 'block_not_publishable',
      detail: 'list:start',
    }),
  ]);
});

it('refuses a list outright where there is no layout, as publishing/1 and /2 are frozen', () => {
  expect(failuresOf(withoutLayout)).toEqual([
    expect.objectContaining({
      code: 'block_not_publishable',
      detail: 'list',
    }),
  ]);
});

it('PUB-052 reports every refusal in one pass, not the first', () => {
  /* ... */
});
```

- [ ] **Step 2: red.** Expected:
      `expected [] to deeply equal [ { type: 'list', ... } ]` - today `publishable` refuses anything
      that is not a paragraph and returns nothing.
- [ ] **Step 3: write it.** Keep `PUBLISHING_SCHEMA_1`, `_2` and `_3` exactly as they are, and every
      test that asserts those shapes must go on passing unchanged.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(domain): a published document carries a list`

---

## Task 11: template 4 sets it

**Files:** create `apps/worker/templates/publication/4/main.typ` (copied from version 3, which must
not be edited); modify `apps/worker/src/template.ts` and `template.test.ts`.

**The places the exact Typst matters.** All of it was compiled with the pinned Typst 0.15.1, the
pinned faces and `--pdf-standard ua-1` while this plan was written.

```typst
// Typst's own nested markers are • ‣ – and U+2023 IS NOT IN LIBERATION SERIF: a two-level
// unordered list fails the compile outright under PDF/UA-1, with no fallback and no warning.
// These three are the disc/circle/square convention and every one of them sets in the pinned faces.
// That a marker lives here at all rather than in a style is issue #158: CNT-094 says appearance
// comes from a named style, and a marker is appearance.
#set list(marker: ([•], [◦], [▪]))

#let numbering-of(format) = if format == "alphabetic" {
  "a."
} else if format == "roman" {
  "i."
} else {
  "1."
}

// ONE self-recursive function over every block kind. Typst resolves a name among the bindings
// already made, so two top-level `let`s CANNOT call each other: `block-of` calling a later
// `list-of` fails with `unknown variable`. The list branch therefore lives inside `block-of` and
// calls `block-of` itself. An unknown kind stops the compile, as an unknown mark kind does: a
// publish failure the author is told about is worth more than a block quietly set as nothing.
#let block-of(b) = {
  if b.type == "paragraph" {
    paragraph(b)
  } else if b.type == "list" {
    let bodies = b.items.map(i => i.blocks.map(block-of).join())
    if b.kind == "definition" {
      // `terms` is the closest Typst 0.15.1 has. It tags L / LI / Lbl / LBody, NOT PDF/UA's
      // DL / DI / DT / DD, and the engine offers no way to ask for another role: the term reaches a
      // reader as the item's label and the definition as its body. Said in the changelog's Known
      // limits rather than claimed as the structure the format has.
      terms(..b.items.enumerate().map(((i, item)) => terms.item(
        item.term.map(run).join(),
        bodies.at(i),
      )))
    } else if b.kind == "ordered" {
      enum(
        start: if b.start == none { 1 } else { b.start },
        numbering: numbering-of(b.format),
        ..bodies.map(enum.item),
      )
    } else {
      list(..bodies.map(list.item))
    }
  } else {
    panic("unknown block type: " + b.type)
  }
}
```

`node`'s body changes from `if b.type == "paragraph" { paragraph(b) }` to `block-of(b)`, and
`#assert(doc.schema == "publishing/4", ...)`.

- [ ] **Step 1: write the failing tests** in `template.test.ts`: version 4 is registered, its hash is
      pinned, `TEMPLATE_READING['publishing/4']` is `4`, and versions 1, 2 and 3 are byte for byte
      what they were.
- [ ] **Step 2: red.** Expected: `expected undefined to be defined` for `PUBLICATION_TEMPLATE[4]`.
      The hash test then fails naming the hash to paste in; take it from that message, never invent
      one.
- [ ] **Step 3: write it.** **Step 4: green.**
- [ ] **Step 5: commit.** `feat(worker): publication template 4, which sets a list`

---

## Task 12: the PDF a list makes

**Files:** create `apps/worker/src/lists.test.ts`.

`ReadPdf` needs nothing new: `roles` already carries what this asserts.

- [ ] **Step 1: write the failing test**

```ts
it('sets a list as a list at every level, numbers it as asked, and passes veraPDF', async () => {
  const { pdf, read } = await compileOne(listedDocument());

  // What a screen reader is told. Measured: the roles come back in exactly these names, `Lbl`
  // and `LBody` among them, and a nested list is an `L` inside its parent's `LBody`.
  expect(read.roles).toContain('L');
  expect(read.roles).toContain('LI');
  expect(read.roles).toContain('Lbl');
  expect(read.roles).toContain('LBody');
  // Two levels means two `L`s, and the second is inside the first.
  expect(read.roles.filter((role) => role === 'L').length).toBeGreaterThanOrEqual(2);

  // CNT-153, as a reader meets it: start 5 and alphabetic numbering print `e.` and `f.`.
  const said = spoken(read.taggedText[0]!);
  expect(said).toContain('e. Check the readings');
  expect(said).toContain('f. Note the serial');
  // And the markers are the ones the pinned faces hold, not Typst's own.
  expect(said).toContain('•');
  expect(said).toContain('◦');

  const verdict = await checkPdfUa1(pdf);
  expect(verdict.failures).toEqual([]);
  expect(verdict.compliant).toBe(true);
}, 120_000);

it('CNT-117 sets a definition term as its item label, which is all this engine gives', async () => {
  const { read } = await compileOne(definedDocument());
  const said = spoken(read.taggedText[0]!);
  expect(said).toContain('Tensile strength');
  expect(said).toContain('The greatest stress a material bears.');
  // The honest assertion, and the reason it is worded this way: Typst 0.15.1 gives a definition
  // list L / LI / Lbl / LBody and never PDF/UA's DL / DI / DT / DD. Asserting the absence as well
  // as the presence means the day an engine does better, this test says so rather than passing on.
  expect(read.roles).toContain('Lbl');
  expect(read.roles).not.toContain('DL');
}, 120_000);
```

- [ ] **Step 2: red.** Expected: `expected [ 'Document', 'H1', 'P' ] to contain 'L'`.
- [ ] **Step 3: write it.** The spike already showed both of these pass, with zero veraPDF failures.
      **If the compile is refused with `TypstRefused` and nothing else, the first thing to check is
      the marker set**: that is the one failure mode measured, and its diagnostic is suppressed by
      design, so run the template by hand under `.tools/typst-0.15.1/` to read it.
- [ ] **Step 4: green.** **Step 5: commit.** `test(worker): a published list, through veraPDF`

---

## Task 13: CNT-153, and CNT-119 superseded

**Files:** modify `docs/specification/requirements/CNT-content-and-authoring.md`; modify
`docs/design/content-model.md`; modify `docs/specification/requirements/README.md`.

**This is a corpus change and it follows the corpus's own rules, which
[the index](../specification/requirements/README.md) states.** Constraining what CNT-119 permitted is
a **material change**, so it is a new identifier and not an edit in place.

- [ ] **Step 1:** `pnpm trace next CNT` to confirm the identifier - it was **CNT-153** when this plan
      was written, and a row filed in between moves it. Take the tool's answer, never this sentence's.
- [ ] **Step 2:** add the row, in CNT-119's place in the document's order:

      > An ordered list must carry an author-settable start number and numbering format - decimal,
              > alphabetic or roman - local to that list and independent of the outline's numbering
              > (**STR**). The start number must be 1 or more, except where the format is decimal, where 0
              > is also permitted.

- [ ] **Step 3:** mark CNT-119 `Superseded by CNT-153`, leaving its statement untouched.
- [ ] **Step 4:** add the change-history row at the end of the document, naming what prompted it:
      the editor lists slice found that the engine sets a roman zero as `n.`, so a start of zero is
      a numbering no author asked for, and the model permitted it.
- [ ] **Step 5:** **repoint** content-model.md's `## Requirements owned` row from CNT-119 to CNT-153
      and reword the row to state the start rule, as CNT-099's claim was repointed to CNT-147. Do not
      add a row beside it: `design claims` should not move, and `pnpm trace check` is the arbiter -
      if it wants something else, do what it says and record it here.
- [ ] **Step 6:** update the counts in `docs/specification/requirements/README.md`.
- [ ] **Step 7:** `pnpm --filter @alloy-works/trace generate`, then `pnpm trace check` and
      `pnpm trace show CNT-153`.
- [ ] **Step 8: commit.** `docs(spec): CNT-153, a start number of 1 or more except in decimal`

---

## Task 14: the documents, and the changelog

**Files:** modify `docs/architecture.md`, `docs/features.md`, `README.md`,
`docs/design/component-editor.md` (the built banner only), `docs/design/content-model.md` (the list
row, and the named limit on definition lists in output), `docs/plans/README.md`, `CHANGELOG.md`,
`version.json`, `package.json`, `apps/desktop/package.json`.

- [ ] **Step 1:** `docs/architecture.md` - the five list nodes, `prosemirror-schema-list` as a
      dependency, the two commands that are ours and why, identity and adjacency at depth, the
      nesting limit in `parseContentDocument`, the item's `term`, the widened registry, the list
      panel, `publishing/4` and `publication/4`, each described as built.
- [ ] **Step 2:** `docs/features.md` and the README's Features table, in lockstep: bulleted, numbered
      and definition lists, nesting, start and numbering, and the honest note about what a definition
      list reaches a reader as.
- [ ] **Step 3:** `docs/design/content-model.md` - the `list` row in the vocabulary table gains the
      item's `term`, and beside the `## Requirements owned` table, in prose: **a definition list is
      published as a list whose item label is the term**, because Typst 0.15.1 emits no `DL`, `DI`,
      `DT` or `DD` and offers no way to ask for them. A named limit, not a claim.
- [ ] **Step 4:** this plan's row in `docs/plans/README.md` moves to Built with its PR number. The
      editor section's prose currently earmarks **editor 4** for recovery and undo and **editor 5**
      for paste; those become **editor 6** and **editor 7**, with **editor 5** the quotations and
      preformatted text plan this one splits off.
- [ ] **Step 5:** the changelog entry below, `version.json` to `0.33.0`, and both mirrors.
- [ ] **Step 6:** `pnpm format`, then `pnpm --filter @alloy-works/trace generate`, then
      `pnpm trace check` and `pnpm trace pins`, and move the pins the latter reports.
- [ ] **Step 7: commit.** `docs: the lists slice as built, 0.33.0`

### The changelog entry to write, at the top of `CHANGELOG.md`

```markdown
## 0.33.0 - 2026-09-2X (PR #XXX)

### Added

- **An author can make lists.** Bulleted, numbered and definition lists, from the toolbar or the
  keyboard, over the paragraph the cursor is in. Pressing the same button again takes the list off.
- **Lists nest.** Nest item and Lift item move an item in and out, with Tab and Shift Tab as well as
  Ctrl or Cmd and the square brackets, to six levels and well past them, mixing all three kinds
  freely.
- **A definition list holds the term it defines**, written as ordinary text, so it can be
  emphasised, linked or marked as being in another language like any other phrase.
- **A numbered list can start where you want and count how you want.** Set it to start at any number
  and to count 1, 2, 3 or a, b, c or i, ii, iii, from the List panel beside the toolbar.
- **A publication prints all of it.** A PDF now carries lists at every level, with the numbering and
  the start the author chose, and a screen reader is told it is a list rather than a row of
  characters. It still passes every PDF/UA-1 rule the checker applies.

### Fixed

- **Content can no longer be saved nested more deeply than the product allows.** The limit that
  applied when content was pasted or imported now applies on every path that stores content,
  including an editing session. Content past it is refused by name rather than accepted, or, past a
  certain depth, failing with an error that said nothing.

### Changed

- A numbered list counting in letters or roman numerals now starts at 1 or more. Only a list
  counting 1, 2, 3 can start at 0, where a zero means something.
- A publication made from now on uses publication template 4. Publications already made are
  unchanged and still open exactly as they were.

### Known limits

- A definition list is published as a list whose item label is the term. A screen reader announces
  the term and then its definition, which is the right order and the right emphasis, but PDF has a
  definition-list structure of its own and the engine the product uses cannot yet produce it.
- Block quotations and preformatted text are still not writable, and a document holding one still
  cannot be published.
```

---

## Pins, citations and the trace

Before, from `pnpm trace pins` on `main` at 0.32.0:
`requirements 1385, non-requirements 117, questions 135, design claims 409, citations 217,
scanned .tsx test files 11, areas 22`.

**Expected moves.**

| Pin                                      | Move               | Why                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requirements`                           | **1385 to 1386**   | CNT-153 is filed. CNT-119 stays in the corpus as `Superseded by CNT-153`; nothing is removed                                                                                                          |
| `design claims`                          | **409, unchanged** | CNT-119's row in content-model.md is **repointed** to CNT-153, not added beside. Every other requirement cited is already claimed                                                                     |
| `citations`                              | rises              | One per test title naming a requirement. **The number comes from `pnpm trace pins`, never from counting by hand**                                                                                     |
| `scanned .tsx test files`                | **11, unchanged**  | `ListPanel.tsx` is tested through `ComponentEditor.test.tsx` and `EditorToolbar.test.tsx`, both already scanned. **If a `ListPanel.test.tsx` is written instead it becomes 12 and this row is wrong** |
| `non-requirements`, `questions`, `areas` | unchanged          | This slice files one requirement and nothing else                                                                                                                                                     |

`pnpm --filter @alloy-works/trace generate` runs **after** prettier, or the generated JSON is
reformatted underneath it.

---

## Requirement challenges, for Ken

**Answered (2026-09-20).** Challenge 1 - the definition list - was answered by **building it**: the
stored item is widened with an optional inline `term`, which spike 6 shows is additive, so CNT-117
stands as written and is honoured in full. Challenge 2 was accepted with the supersede: **CNT-153**,
task 13. Challenges 4 and 5 are filed as **#158** (the marker) and **#159** (the nesting ceiling) and
are referenced above rather than re-argued. Challenge 3 is not pressed, consistent with Ken's ruling
on CNT-035.

**One left standing, and it is the same shape as challenge 3 rather than a new one.**

1. **CNT-079 has a second reason to be unclaimable, now measured.** It was already four families in
   one row. Spike 4 adds that the engine gives a definition list `L`/`Lbl`/`LBody` and not
   `DL`/`DT`/`DD`, so even the list third of the statement reaches a reader as something weaker than
   "exposed as structure" plainly means. Raised once and not pressed: the honest place for it is the
   named limit in content-model.md that task 14 writes, and the accessibility suite (CNT-139) is
   where a claim about what assistive technology actually receives belongs.

---

## What this plan leaves undone

Named so the next plan starts from a list rather than from a reading of the diff.

- **Block quotations and preformatted text** - editor 5, the other half of this commission, and
  **the monospace face with them**. Decision G is settled and not re-derivable: Liberation Mono
  pinned beside Liberation Serif, `covers(codePoint, 'body')` and `covers(codePoint, 'code')` from
  one loader, one branch in `characterProblems`, so the body set does not narrow. Decision H has the
  em dash `quote(attribution:)` writes that the slice must avoid, and spike 1 has the grey panel that
  makes a preformatted block legible without a face and without colour alone.
- **`DL`, `DI`, `DT` and `DD` in the PDF**, which Typst 0.15.1 cannot emit. Worth revisiting when the
  pinned engine moves; task 12's test asserts the absence, so it will say so.
- **Tables** and **footnotes**, the other two nesting families, which inherit every plugin this slice
  rewrote. `prosemirror-tables` and the restricted footnote schema are component-editor.md's.
- **Equations** and the #103 ruling; **figures**, which wait on the assets design.
- **Paste** through the admission pipeline with its report (CNT-063), and **issue #102** with the HTML
  readers. Nothing here admits anything: no reader, no paste. **Admission's normalise stage now has a
  term to consider** - a pasted definition list - and this slice does not touch it.
- **Issue #101** (a run's direction) and **issue #88** (a caption holding inline content), together,
  as content schema version 2 with one migration and one permanent fixture. Spike 6 confirms the
  definition list does **not** join them: it is additive and lands here.
- **Issue #158**, the list marker as a theme property. It is pinned in the template here, which is
  the wrong home and is said to be, in the template's own comment and in the design.
- **Issue #159**, a maximum nesting depth stated in levels, so an author who reaches it is told in
  their own language rather than in the language of a JSON walk.
- **CNT-079 in full**, which needs headings, tables and footnotes as well as lists - and an engine
  that emits a definition list's own structure.
- **PUB-090 in full**, which needs the Matterhorn Protocol review a person does. The veraPDF half
  passes on every publication this slice makes.
- **`docs/plans/README.md`'s editor numbering**, which this plan displaces: recovery and undo move to
  editor 6 and paste to editor 7, done in task 14 rather than on the planning branch.
