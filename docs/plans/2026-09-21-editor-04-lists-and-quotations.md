# Editor 4: lists, and the nesting the editor has never done

> **For agentic workers:** execute this plan task by task, test first, one commit per task. Every task
> names its expected RED failure; run it and see that failure before writing the code that fixes it.

**Goal:** an author can make a bulleted or numbered list, nest items inside items, set a numbered
list's start and its numbering, and publish all of it to a tagged PDF in which a reader's assistive
technology is told `L`, `LI`, `Lbl` and `LBody` at every level. And the two write paths stop
disagreeing about how deeply content may nest.

**Architecture:** the stored `list` node becomes two nodes in the editor's ProseMirror schema -
`list` and `listItem` - shaped so that `prosemirror-schema-list`'s own commands drive them unchanged;
the identity plugin and the adjacency plugin, both of which walk the top level only today, are made
to descend; the mapping recurses both ways; the command registry widens from marks to editing
actions; `assemble` carries a list into a new published schema, `publishing/4`, and a new immutable
template, `publication/4`, sets it. `parseContentDocument` gains the nesting limit that only
admission applied, which closes [#125](https://github.com/kenhayward/alloy-works/issues/125).

**Designs:** [component-editor.md](../design/component-editor.md) (the authoring matrix, the identity
table, the invariants, CNT-077), [content-model.md](../design/content-model.md) (CNT-117, CNT-118,
CNT-119, CNT-002, CNT-023), [publishing.md](../design/publishing.md).

**Version:** 0.33.0 - a functional enhancement. Do not bump on the planning branch.

**On this file's name.** It was commissioned as `editor-04-lists-and-quotations`, and the name is
kept so the commission and the artifact match. It plans **lists only**; the reason is the first thing
below, and block quotations and preformatted text are the plan after it.

---

## Scope: this should be two pull requests, and here is the seam

**The commission - lists, block quotations and preformatted text, with their published half - is too
much for one pull request.** The marks slice ran to thirteen tasks over one family of inline marks
that changed no node, no plugin and no invariant. This slice changes three plugins, the doc's own
content expression, the mapping in both directions, the command registry's shape, the published
document's block type and the template - before any family is added. Three families on top of that is
not a review anybody can hold in their head.

**Recommended split:**

| Pull request                                          | What it carries                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor 4 - lists** (this plan)                      | #125 on every write path; identity and adjacency at depth; the mapping's recursion; `list` and `listItem`; the three structural commands; the registry widened; the list controls and the list panel; `publishing/4`; `publication/4`; veraPDF |
| **Editor 5 - block quotations and preformatted text** | `blockquote` and `preformatted`, their toolbar commands, `BlockQuote` and `Code` in template 5, and the monospace face (decision F)                                                                                                            |

**Why lists first, and not the other way round.** The engineering argument runs the other way:
a blockquote nests one level and would prove the descent work with smaller tests, so doing it first
de-risks the plugin rewrite. Lists win anyway for three reasons. Four T1 rows sit behind lists
(CNT-015 superseded into CNT-117, CNT-118 and CNT-119) against one each for the other two. Lists are
the family that stresses the descent rewrite hardest - three structural commands, unbounded depth,
and an item that is a node carrying no identifier - and a rewrite proved on the easy case is a
rewrite proved on the easy case. And if only one of the two lands, lists is the one a reader of the
product notices.

**What the second pull request inherits, free:** every plugin, the mapping's recursion, `assemble`'s
recursive block walk, the published document's recursive shape, and #125's test. It is a small PR.

---

## Global constraints

- **TDD.** No production code without a failing test that preceded it, and the failure watched.
- **No dashes in user-facing text.** A plain hyphen in every UI string, catalogue entry and changelog
  bullet. Code and comments are exempt. **Read decision G before writing the template**: the engine
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

Five questions, each answered by the smallest thing that answers it. Nothing was built; every spike
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
  block without a face and without colour alone, which is the mitigation decision F weighs.

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
(ADR-0010).

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

### 3. `prosemirror-schema-list`, or commands of our own

**It is not a dependency today.** Version 1.5.1 was added, driven, and removed.

**A schema shaped to the stored model works with its commands unchanged.** `list` with
`content: 'listItem+'`, `listItem` with `content: 'block+'` and `defining: true` and **no
attributes** - which is exactly the stored shape, `items: [{ content: BlockNode[] }]`, where an item
carries no identifier - drove `wrapInList`, `splitListItem`, `sinkListItem` and `liftListItem` with
no adaptation at all. Sinking made a nested list inside the item; lifting put it back; the document
came out in the shape the stored model holds. **Take the dependency.** Writing three structural
commands by hand to reach the same place would be a few hundred lines of position arithmetic with no
test suite behind it.

**The one trap, and it looks correct until it is run.** `splitListItem` **returns false** in an empty
list item - it declines, expecting the keymap to fall through to `liftListItem`. Today's
`enterWithoutEmpties` returns **true** and does nothing when the cursor is in an empty paragraph. Bind
Enter to `enterWithoutEmpties` first and an author who presses Enter in an empty list item is trapped
in the list with no key that leaves it. The order is fixed in task 6 and has a test of its own.

### 4. What a reader gets from a list in the tagged PDF

Compiled and read with pdf.js and the pinned veraPDF. **veraPDF: compliant, zero failures.** The
roles, in document order:

```
L, LI, Lbl, LBody, P, L, LI, Lbl, LBody, P, L, LI, Lbl, LBody, LI, Lbl, LBody, ...
```

**A list reaches a reader as a real list, at every level.** `L` holds `LI`; each `LI` holds `Lbl` -
the marker or the number - and `LBody`; a nested list is an `L` inside its parent's `LBody`. That is
the full PDF/UA list structure, and it is not the bare-`Span` disappointment the marks slice found.
The extraction carries the labels as text: an ordered list with `start: 5` and alphabetic numbering
gave `e.` and `f.`; an ordered list nested in an unordered one gave `•`, then `1.` and `2.`. A list
item holding two paragraphs came out as one `LI` with both paragraphs under the one label.

**Typst's own default list markers break the compile.** They are `•`, `‣`, `–`, and **U+2023 is not
in Liberation Serif**, so a two-level unordered list fails with
`PDF/UA-1 error: the text "‣" could not be displayed with font "Liberation Serif"` - not a warning,
not a fallback, a refused compile. Candidates were compiled one by one: `•` U+2022, `◦` U+25E6, `▪`
U+25AA, `–` U+2013, `·` U+00B7, `-` U+002D, `●` U+25CF and `■` U+25A0 all set; `⁃` U+2043 does not.
The template pins `([•], [◦], [▪])`, which is the disc/circle/square convention a reader knows.

**`start: 0` on a roman list prints `n.`** - Typst's _nulla_. The stored shape allows
`start: z.number().int().min(0)`, so an author can ask for a list that begins `n., i., ii.`, which
means nothing to a reader. Alphabetic at zero was not measured. Decision E.

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

So the limit bites somewhere above thirty levels of list. CNT-118 asks for six.

**What it costs, and what not having it costs.** `exceedsLimits` over a 400-paragraph component:
**0.070 ms**, against `parseContentDocument`'s own **0.462 ms** on the same input - about a sixth
added to a parse that already runs on every iteration. What it buys: at 1,000 levels today,
`parseContentDocument` throws **`RangeError: Maximum call stack size exceeded`** - an uncaught stack
overflow on the save route, not a named refusal. At 200 levels it simply **accepts** content
admission would refuse. Both stop.

---

## Decisions

Each is a recommendation with the alternative that was rejected and why. A to D change what ships;
E to H are rulings.

**A. Take `prosemirror-schema-list` as a dependency of `packages/editor`, and shape the schema to
the stored model rather than the other way round.** Spike 3 drove all four commands unchanged against
a schema that is the stored model's shape exactly. _Rejected:_ three hand-written structural commands
with no suite behind them, to avoid a 10 kB MIT dependency from the same authors as the six
ProseMirror packages already pinned.

**B. Two kinds of list in the editor, not three.** `ordered` and `unordered`. **A definition list is
not representable in the stored model** - see decision D - so a control that made one would let an
author declare something no publication can honour. `toEditor` opens a component holding
`kind: 'definition'` **read-only, naming it** as `list:definition`, exactly as it does a mark it has
no counterpart for; `assemble` refuses one by the same name. _Rejected:_ shipping a third button that
stores a kind nothing downstream can set, which is how a model acquires a member no one dares remove.

**C. `publishing/4` and `publication/4`.** `PublishedBlock` becomes a union and a template version is
immutable. Templates 1, 2 and 3 go on reading their own schemas, byte for byte. _Rejected:_ adding an
optional `items` member that template 3 ignores, which would print a document's lists as nothing at
all with nothing saying so.

**D. A list is carried only under a layout, exactly as a run's marks are.** `publishing/1` and
`publishing/2` hold paragraphs alone and are frozen; `assemble` with no layout goes on refusing a
list with `block_not_publishable`. _Rejected:_ back-filling the frozen schemas, which would change
what a request recorded before migration 0018 publishes as.

**E. Refuse `start: 0` on an alphabetic or a roman list, by name, at the editor's control and again
at `assemble`.** Typst sets a roman zero as `n.`, and "n., i., ii." is not a numbering any author
asked for. Decimal keeps zero, where `0.` means something. The editor's refusal is the words in task
7; `assemble`'s is `block_not_publishable` with detail `list:start`. _Rejected:_ letting it through
and printing `n.`, and equally rejected: tightening `listNodeSchema`'s `min(0)`, which is an
insert-only stored shape and would refuse a document nobody has stored. **This wants Ken's answer:
it may be that the right fix is in the corpus, which does not say what a start of zero means.**

**F. The monospace face, and with it preformatted text, belongs to the next pull request - and the
evidence says pin it there rather than waiting for publishing 4.** Not here, because this slice sets
no preformatted text. But decision C of the marks plan deferred it on a cost that has now been
measured and is not what it was thought to be: **sixteen code points, thirteen of them writable**,
not a re-derivation of 4,170. Two ways to spend it, for Ken:

- **Pin Liberation Mono and let `covers` stay one intersection.** Simplest. Costs the dotless j,
  eleven typographic spaces and the double vertical line, in **body text as well as code**, which is
  where a thin space before a French colon or a narrow no-break space in `5 km` actually lives.
- **Pin it and make `covers` ask which faces the text will be set in.** `covers(codePoint, 'body')`
  and `covers(codePoint, 'code')`, two sets from the same loader, one branch in `characterProblems`,
  and `assemble` already knows which block it is in. Costs nothing in the body. **Recommended.**

**G. The engine writes an em dash into a block quotation's attribution, and the next slice must not
use `quote(attribution:)`.** Typst sets `— Ada Lovelace`, right-aligned, with a U+2014 the author
never typed, and tags the whole attribution as a bare `Span` - so a reader is not told it is an
attribution either. Recorded here because it was measured here; the slice that acts on it is the next
one, which should set the attribution itself rather than hand it to `quote`.

**H. Issue #125 is closed in this slice, in `parseContentDocument`, and its test is a list.** The
marks plan's decision H deferred it to exactly here. Task 1, and it lands **first**, because every
other task in the plan writes through that function.

---

## Requirements

**Cited by this slice** - each because a test's own body demonstrates the statement, and the design
that claims it claims it in full:

| ID          | Claimed by          | What demonstrates it                                                                                                                                                                                 |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-002** | content-model.md    | A block created at depth - by a split, a sink and an Enter at the end of a nested item - carries a freshly allocated identifier, unique within the component, and never one already in it            |
| **CNT-023** | content-model.md    | The second of two adjacent empty paragraphs inside one list item is removed by the editor, so the editor cannot make the document the model refuses                                                  |
| **CNT-010** | content-model.md    | Content nested past the limit is refused on creation, on change and on read-back, because all three go through `parseContentDocument`                                                                |
| **CNT-119** | content-model.md    | A numbered list's start and numbering are set by the author, round-trip through the editor, and reach the PDF as the labels `e.` and `f.`                                                            |
| **CNT-077** | component-editor.md | Every command in the widened `EDITOR_COMMANDS` has a shortcut in the keymap and a button in the toolbar, asserted as one invariant over the registry, and the list panel is driven by keyboard alone |

**Deliberately not cited, with the reason** - this matters more than the table above, because two of
them look citable:

- **CNT-117** - "three kinds" includes **definition**, which decision B does not ship and decision D
  says the stored model cannot represent. Two of three arrive here. Do not repoint the claim.
- **CNT-118** - "in every kind and in any mixture of kinds" includes definition too. The editor test
  nests six levels in a mixture of the two kinds it has, which is not the statement. CNT-118 stays
  `Covered` on `document.test.ts`'s stored-model test, where all three kinds exist as data.
- **CNT-079** - "headings, lists, tables, footnotes" as structure to assistive technology. The PDF
  test shows `L`, `LI`, `Lbl` and `LBody`; headings are the document view's and tables and footnotes
  are not built. component-editor.md leaves it unclaimed and it stays unclaimed. See challenge 3.
- **PUB-090** - the veraPDF half passes here; the Matterhorn Protocol checkpoints "only a person can
  judge" do not, and no design claims it. Named, as the marks plan named it.
- **CNT-094** - a block's appearance comes from a named style. A list marker is appearance and this
  slice pins it in the template rather than in a style. themes.md owns the claim. See challenge 4.
- **CNT-124** - already `Covered`. The `block+` change touches it and task 2 has a regression test,
  but a regression test is not a second demonstration.

---

## File structure

| File                                                 | Responsibility                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/domain/src/content/model/document.ts`      | Modify: `parseContentDocument` applies the nesting limit before the parse       |
| `packages/domain/src/content/model/document.test.ts` | Modify: #125's tests                                                            |
| `packages/editor/package.json`                       | Modify: `prosemirror-schema-list` as a dependency, pinned exactly               |
| `packages/editor/src/schema.ts`                      | Modify: `block+`, the `list` and `listItem` nodes                               |
| `packages/editor/src/schema.test.ts`                 | Modify                                                                          |
| `packages/editor/src/identity.ts`                    | Modify: the descent rule at any depth                                           |
| `packages/editor/src/identity.test.ts`               | Create                                                                          |
| `packages/editor/src/state.ts`                       | Modify: adjacency at depth, the Enter chain, the list keymap                    |
| `packages/editor/src/blocks.ts`                      | Create: the block commands, `listAt`, `setListAttributes`                       |
| `packages/editor/src/blocks.test.ts`                 | Create                                                                          |
| `packages/editor/src/marks.ts`                       | Modify: `EditorCommand` becomes a union; `EDITOR_COMMANDS` gains four rows      |
| `packages/editor/src/mapping.ts`                     | Modify: recursive both ways; `unsupportedIn` recursive                          |
| `packages/editor/src/index.ts`                       | Modify: the new exports                                                         |
| `packages/editor/style.css`                          | Modify: how a list is set on the surface                                        |
| `apps/web/src/editor/EditorToolbar.tsx`              | Modify: block commands beside the mark commands                                 |
| `apps/web/src/editor/ListPanel.tsx`                  | Create: kind, start and numbering                                               |
| `apps/web/src/editor/ComponentEditor.tsx`            | Modify: the panel, and `F6` reaching it                                         |
| `packages/domain/src/publishing/published.ts`        | Modify: `PublishedList`, `PublishedBlock` a union, `publishing/4`               |
| `packages/domain/src/publishing/assemble.ts`         | Modify: `publishable` recurses; the definition and `start` refusals             |
| `apps/worker/templates/publication/4/main.typ`       | Create: template 3 plus one self-recursive `block-of` and the pinned marker set |
| `apps/worker/src/template.ts`                        | Modify: version 4, its hash, and the reading map                                |
| `apps/worker/src/lists.test.ts`                      | Create: the PDF a list makes, through veraPDF                                   |

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

## Task 2: the editor schema holds a list and its item

**Files:** modify `packages/editor/src/schema.ts` and `schema.test.ts`; modify
`packages/editor/package.json`.

**Produces:** `doc`'s content goes from `paragraph+` to `block+`; `paragraph` joins the `block`
group **and is declared first**, so it stays what ProseMirror fills an empty document with
(CNT-124). Two nodes:

```ts
list: {
  group: 'block',
  content: 'listItem+',
  attrs: {
    id: { default: null },
    kind: { default: 'unordered' },   // 'ordered' | 'unordered'; 'definition' is never made here
    start: { default: null },
    format: { default: null },        // 'decimal' | 'alphabetic' | 'roman'
  },
  parseDOM: [{ tag: 'ul' }, { tag: 'ol', getAttrs: () => ({ kind: 'ordered' }) }],
  toDOM: (node) => [node.attrs.kind === 'ordered' ? 'ol' : 'ul', 0],
},
// No attributes at all: the stored model's item is `{ content: BlockNode[] }` and carries no
// identifier, so there is nothing for one to hold and nothing for identity to allocate.
listItem: { content: 'block+', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
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

it('lets a list item hold a list, so nesting is unbounded by construction (CNT-118)', () => {
  expect(
    editorSchema.nodes.listItem!.contentMatch.matchType(editorSchema.nodes.list!),
  ).not.toBeNull();
});
```

- [ ] **Step 2: run it red.** Expected: `Cannot read properties of undefined (reading 'spec')` -
      `editorSchema.nodes.list` does not exist.
- [ ] **Step 3: write it.**
- [ ] **Step 4: green.** Then `pnpm --filter @alloy-works/editor typecheck`.
- [ ] **Step 5: commit.** `feat(editor): a list and its item in the editor schema`

---

## Task 3: the identity plugin descends

**Files:** modify `packages/editor/src/identity.ts`; create `packages/editor/src/identity.test.ts`.

**This is the task the slice exists around.** Today the plugin walks `doc.forEach` - top level only -
so every block a command makes at depth comes out with `id: null`, and `fromEditor` throws on it. The
spike found it in five separate gestures.

**Produces:** the same descent rule ADR-0023 states, applied at any depth. The walk becomes
`doc.descendants`, and it **skips nodes whose type declares no `id` attribute**, so `listItem` is
walked through and never named.

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
- **A `listItem` is never given an identifier**, and `fromEditor` never looks for one.

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

it('names both of two blocks made at depth in one transaction, each at its own position', () => {
  // Two nested paragraphs inserted in one transaction: both named, and the text under each
  // identifier is the text that was there - the assertion that catches a position read too late.
});

it('leaves a list item unnamed, because the stored model gives an item no identifier', () => {
  expect(nodeAt(after.doc, ['list', 0]).attrs).toEqual({});
});

it('keeps the descent rule: the block at its identifier mapped forward keeps it', () => {
  // A split inside an item: the first half keeps `b1`, the second half is renewed. Not the reverse.
});

it('draws again rather than allocating an identifier the component already carries', () => {
  // newIdentifier returns a taken identifier once, then a fresh one.
});
```

- [ ] **Step 2: run it red.** Expected: `expected null to be any String` on the first three, because
      the plugin never reaches those nodes.
- [ ] **Step 3: write it.** Keep the existing comment's account of association 1 and extend it to say
      why the walk descends and why an item is skipped. **Do not change the rule** - only its reach.
- [ ] **Step 4: green.** Run the whole editor suite: the top-level tests in `state.test.ts` are the
      regression that says the rule did not change.
- [ ] **Step 5: commit.** `feat(editor): allocate an identifier for a block at any depth`

---

## Task 4: adjacency descends too

**Files:** modify `packages/editor/src/state.ts`; modify `packages/editor/src/state.test.ts`.

**Consumes:** task 2's schema. **Produces:** `noAdjacentEmptyParagraphs` walks every block sequence,
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

## Task 5: the mapping carries a list, both ways

**Files:** modify `packages/editor/src/mapping.ts` and `mapping.test.ts`.

**Produces:** `toEditor`, `fromEditor` and `unsupportedIn` recursive and inverse over `list`.
`unsupportedIn` reports a block type it has no node for **wherever it is**, including inside a list
item, and reports `list:definition` for a definition list.

- [ ] **Step 1: write the failing tests**

```ts
it('round-trips a list nested six levels deep, in a mixture of kinds, unchanged', () => {
  const document = documentWith([sixLevelsMixingOrderedAndUnordered()]);
  const opened = toEditor(document);
  expect(opened.editable).toBe(true);
  expect(fromEditor((opened as Extract<Opened, { editable: true }>).doc)).toEqual(document);
});

it('CNT-119 keeps a numbered list start and its numbering format', () => {
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

it('omits a start and a format a list does not have, rather than writing null', () => {
  // The schema's defaults are null and `listNodeSchema` is strict: null is refused, absence is not.
  const document = documentWith([unorderedList('L1', ['alpha'])]);
  expect(fromEditor(openedDoc(document))).toEqual(document);
});

it('opens read-only for a definition list, naming it', () => {
  expect(toEditor(documentWith([definitionList()]))).toEqual({
    editable: false,
    unsupported: ['list:definition'],
  });
});

it('opens read-only for a block it cannot edit that is inside a list item, naming it', () => {
  // A table inside a list item: today `unsupportedIn` looks at the top level only.
  expect(toEditor(documentWith([listHolding(table())]))).toEqual({
    editable: false,
    unsupported: ['table'],
  });
});

it('refuses a list item holding no block, because the stored shape requires one', () => {
  /* ... */
});
```

- [ ] **Step 2: run it red.** Expected: `{ editable: false, unsupported: [ 'list' ] }` on the
      round-trip test, because `unsupportedIn` still reports any block that is not a paragraph.
- [ ] **Step 3: write it.** `fromEditor`'s `runsOf` keeps throwing by name on a child it cannot
      store; the block walk gains the same treatment for a node type it has no stored shape for.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(editor): map a list to and from the stored model`

---

## Task 6: the block commands, and the Enter chain

**Files:** create `packages/editor/src/blocks.ts` and `blocks.test.ts`; modify
`packages/editor/src/state.ts` and `index.ts`.

**Produces:**

```ts
export type BlockAction = 'bulletedList' | 'numberedList' | 'nestItem' | 'liftItem';
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
author has used does. `nestItem` is `sinkListItem` and `liftItem` is `liftListItem`, each taking
`editorSchema.nodes.listItem`.

**The Enter chain, and the order is the whole of it:**

```ts
Enter: chainCommands(
  splitListItem(editorSchema.nodes.listItem!),  // declines in an empty item
  liftListItem(editorSchema.nodes.listItem!),   // which is what leaves the list
  enterWithoutEmpties,                          // CNT-023, outside a list
),
```

> **The trap, measured.** `splitListItem` **returns false** in an empty list item rather than handling
> it. `enterWithoutEmpties` returns **true** and does nothing in an empty paragraph. Put
> `enterWithoutEmpties` anywhere before `liftListItem` and an author who presses Enter in an empty
> list item is trapped in the list with no key that leaves it. `liftListItem` returns false outside a
> list, so the order below is safe in both directions.

`Tab` and `Shift-Tab` are bound to `nestItem` and `liftItem` **as well as** `Mod-]` and `Mod-[`.
Both list commands return false outside a list, so focus still leaves the surface on Tab everywhere
else, which CNT-077 needs: a Tab that is always swallowed is a keyboard trap.

- [ ] **Step 1: write the failing tests**

```ts
it('makes a bulleted list of the paragraph the cursor is in', () => {
  /* ... */
});

it('takes a paragraph back out of a list when the same command runs again', () => {
  /* ... */
});

it('CNT-118 nests an item under the item above it, to six levels and past them', () => {
  let state = sixSeparateItems();
  for (let level = 0; level < 6; level += 1) state = run(state, blockCommand('nestItem', ids));
  expect(depthOfDeepestList(state.doc)).toBe(6);
});

it('lifts a nested item back to the level above', () => {
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

it('refuses a start of zero on an alphabetic or a roman list, and allows it on a decimal one', () => {
  expect(setListAttributes({ format: 'roman', start: 0 })(inAList(), () => undefined)).toBe(false);
  expect(setListAttributes({ format: 'decimal', start: 0 })(inAList(), () => undefined)).toBe(true);
});
```

- [ ] **Step 2: run it red.** Expected: `Cannot find module './blocks.js'`.
- [ ] **Step 3: write it.** **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): commands for making, nesting and lifting list items`

---

## Task 7: the registry widens, and the toolbar shows the list commands

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

Every existing row gains `kind: 'mark'`. Four rows are added, after the nine marks. **These are the
exact user-facing words:**

| kind    | action / mark  | label         | shortcut      | shortcutSaid                         | prompts |
| ------- | -------------- | ------------- | ------------- | ------------------------------------ | ------- |
| `block` | `bulletedList` | Bulleted list | `Mod-Shift-8` | Ctrl or Cmd, Shift and 8             | no      |
| `block` | `numberedList` | Numbered list | `Mod-Shift-7` | Ctrl or Cmd, Shift and 7             | no      |
| `block` | `nestItem`     | Nest item     | `Mod-]`       | Ctrl or Cmd and right square bracket | no      |
| `block` | `liftItem`     | Lift item     | `Mod-[`       | Ctrl or Cmd and left square bracket  | no      |

**The list panel.** It appears beside the toolbar while the cursor is inside a list, and `F6` reaches
it in the region order **component header, toolbar, list panel, surface**. Exact words:

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
    'Nest item',
    'Lift item',
  ]);
  expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  // End still reaches the last button, and ArrowRight still wraps from it.
});
```

```ts
it('CNT-077 gives every command a shortcut and one label, with no shortcut used twice', () => {
  expect(EDITOR_COMMANDS).toHaveLength(13);
  for (const command of EDITOR_COMMANDS) {
    const fancy = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(command.label + command.shortcutSaid).not.toMatch(fancy);
    if (command.kind === 'mark') expect(editorSchema.marks[command.mark]).toBeDefined();
  }
  expect(new Set(EDITOR_COMMANDS.map((c) => c.shortcut)).size).toBe(13);
});
```

```tsx
it('shows the list panel only while the cursor is in a list, and sets its numbering', async () => {
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

it('says why a start of 0 is refused on a lettered list, and changes nothing', async () => {
  expect(
    await screen.findByText('Only a 1, 2, 3 list can start at 0. Try 1 or more.'),
  ).toBeInTheDocument();
});

it('CNT-077 moves between the header, the toolbar, the list panel and the surface with F6', async () => {
  /* ... */
});

it('saves an iteration holding the list the author made', async () => {
  // The PUT body's content carries a list whose blocks each have an id of 26 base32 characters.
});
```

- [ ] **Step 2: red.** Expected: `expected length 9 to be 13`; and no element with the role `button`
      and the name `Bulleted list`.
- [ ] **Step 3: write it.** **Step 4: green**, with `pnpm --filter @alloy-works/web test`.
- [ ] **Step 5: commit.** `feat(web): list controls in the toolbar, and a list panel`

---

## Task 8: how a list is set on the surface

**Files:** modify `packages/editor/style.css`; modify `packages/editor/src/schema.test.ts`.

Rules for `.ProseMirror ul`, `.ProseMirror ol` and `.ProseMirror li`: the markers the template pins,
set with `list-style-type: disc`, `circle` and `square` at the three depths so the surface and the
PDF agree; `ol` taking its marker from the node's `format`; and a nested list indented by the
editor's own step rather than the browser's default. No test asserts colour; one test asserts the
stylesheet parses and names each selector.

- [ ] **Step 1:** `it('styles a list at every level it can nest')`, reading `style.css` with
      `node:fs` and asserting one selector per level.
- [ ] **Step 2: red.** Expected: `expected '.ProseMirror li li' to be found in style.css`.
- [ ] **Step 3:** write the rules. **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): set a list on the surface`

---

## Task 9: a published document carries a list

**Files:** modify `packages/domain/src/publishing/published.ts` and `assemble.ts`; modify
`assemble.test.ts`.

**Produces:**

```ts
export interface PublishedList {
  readonly type: 'list';
  readonly id: string;
  /** Two kinds. A definition list is refused by name: nothing can set one (decision B). */
  readonly kind: 'ordered' | 'unordered';
  readonly start: number | null;
  readonly format: 'decimal' | 'alphabetic' | 'roman' | null;
  /** One entry per item, each a sequence of blocks, so the template recurses as `assemble` did. */
  readonly items: readonly (readonly PublishedBlock[])[];
}

export type PublishedBlock = PublishedParagraph | PublishedList;

export const PUBLISHING_SCHEMA_3 = 'publishing/3'; // frozen
export const PUBLISHING_SCHEMA = 'publishing/4';
```

`publishable` becomes recursive and goes on returning `PublishedBlock[]`, so a list every one of
whose items came out empty contributes nothing rather than an empty `L`. The glyph check and the
`style_missing` check reach a paragraph at any depth, because they are called from the paragraph
branch, which the recursion reaches.

Two new refusals, both `block_not_publishable`:

| detail            | When                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `list:definition` | `kind` is `definition`; nothing resolves a term from a definition list |
| `list:start`      | `start` is 0 and `format` is `alphabetic` or `roman` (decision E)      |

And, unchanged, `block_not_publishable` with detail `list` when there is **no layout**: `publishing/1`
and `publishing/2` hold paragraphs alone and are frozen (decision D).

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-119 carries a list, its start and its numbering, and its items in order', () => {
  expect(blocksOf(assembled)).toEqual([
    {
      type: 'list',
      id: 'L1',
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
      items: [
        [{ type: 'paragraph', id: 'b1', runs: [{ text: 'Check the readings', marks: [] }] }],
        [{ type: 'paragraph', id: 'b2', runs: [{ text: 'Note the serial', marks: [] }] }],
      ],
    },
  ]);
});

it('CNT-118 carries a list nested six levels deep, in a mixture of kinds', () => {
  /* ... */
});

it('carries the marks over a run inside a list item exactly as in a paragraph', () => {
  /* ... */
});

it('names a character outside the pinned faces inside a list item, with its block', () => {
  expect(failuresOf(result)).toEqual([
    expect.objectContaining({
      code: 'glyph_missing',
      block: 'b2',
      detail: 'U+0627',
    }),
  ]);
});

it('refuses a definition list, naming it, because nothing can set one', () => {
  expect(failuresOf(result)).toEqual([
    expect.objectContaining({
      code: 'block_not_publishable',
      detail: 'list:definition',
    }),
  ]);
});

it('refuses a lettered or a roman list that starts at zero, naming it', () => {
  /* list:start */
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

## Task 10: template 4 sets it

**Files:** create `apps/worker/templates/publication/4/main.typ` (copied from version 3, which must
not be edited); modify `apps/worker/src/template.ts` and `template.test.ts`.

**The two places the exact Typst matters.** Both were compiled with the pinned Typst 0.15.1, the
pinned faces and `--pdf-standard ua-1` while this plan was written.

```typst
// Typst's own nested markers are • ‣ – and U+2023 IS NOT IN LIBERATION SERIF: a two-level
// unordered list fails the compile outright under PDF/UA-1, with no fallback and no warning.
// These three are the disc/circle/square convention and every one of them sets in the pinned faces.
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
    let items = b.items.map(bs => bs.map(block-of).join())
    if b.kind == "ordered" {
      enum(
        start: if b.start == none { 1 } else { b.start },
        numbering: numbering-of(b.format),
        ..items.map(enum.item),
      )
    } else {
      list(..items.map(list.item))
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

## Task 11: the PDF a list makes

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

  // CNT-119, as a reader meets it: start 5 and alphabetic numbering print `e.` and `f.`.
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
```

- [ ] **Step 2: red.** Expected: `expected [ 'Document', 'H1', 'P' ] to contain 'L'`.
- [ ] **Step 3: write it.** The spike already showed this passes, with zero veraPDF failures. **If
      the compile is refused with `TypstRefused` and nothing else, the first thing to check is the
      marker set**: that is the one failure mode measured, and its diagnostic is suppressed by
      design, so run the template by hand under `.tools/typst-0.15.1/` to read it.
- [ ] **Step 4: green.** **Step 5: commit.** `test(worker): a published list, through veraPDF`

---

## Task 12: the documents, and the changelog

**Files:** modify `docs/architecture.md`, `docs/features.md`, `README.md`,
`docs/design/component-editor.md` (the built banner only), `docs/design/content-model.md` (the named
gap on CNT-117), `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
`apps/desktop/package.json`.

- [ ] **Step 1:** `docs/architecture.md` - the list nodes, `prosemirror-schema-list` as a dependency,
      identity and adjacency at depth, the nesting limit in `parseContentDocument`, the widened
      registry, the list panel, `publishing/4` and `publication/4`, each described as built.
- [ ] **Step 2:** `docs/features.md` and the README's Features table, in lockstep: bulleted and
      numbered lists, nesting, start and numbering, and the honest note that a definition list is not
      offered.
- [ ] **Step 3:** `docs/design/content-model.md` - beside the `## Requirements owned` table, the named
      gap in prose: **the stored `list` shape cannot represent a definition list**, because an item is
      one sequence of blocks with nothing marking a term from its definition, so CNT-117's third kind
      is storable as a declaration and honourable by nothing. This is the single most important
      sentence of the twelve tasks; see challenge 1.
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

- **An author can make lists.** Bulleted and numbered, from the toolbar or the keyboard, over the
  paragraph the cursor is in. Pressing the same button again takes the list off again.
- **Lists nest.** Nest item and Lift item move an item in and out, with Tab and Shift Tab as well as
  Ctrl or Cmd and the square brackets, to six levels and well past them, mixing bulleted and
  numbered lists freely.
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

### Known limits

- A definition list cannot be made. The stored shape has no way to tell a term from its definition,
  so the editor offers bulleted and numbered lists only, and a component that already holds a
  definition list opens for reading rather than being edited into something without it.
- A numbered list that counts in letters or roman numerals starts at 1 or more. Only a list counting
  1, 2, 3 can start at 0.
- Block quotations and preformatted text are still not writable, and a document holding one still
  cannot be published.
```

---

## Pins, citations and the trace

Before, from `pnpm trace pins` on `main` at 0.32.0:
`requirements 1385, non-requirements 117, questions 135, design claims 409, citations 217,
scanned .tsx test files 11, areas 22`.

**Expected moves.** `citations` rises by one for every test title naming a requirement, and the
exact number comes from `pnpm trace pins`, never from counting by hand. `scanned .tsx test files`
stays at **11**: `ListPanel.tsx` is new but is tested through `ComponentEditor.test.tsx` and
`EditorToolbar.test.tsx`, both of which the corpus already scans - **if a `ListPanel.test.tsx` is
written instead, it becomes 12 and this paragraph is wrong**. `design claims` stays at **409**: every
requirement this slice cites is already claimed by content-model.md or component-editor.md, and no
`## Requirements owned` table gains a row - task 12's step 3 adds **prose**, not a claim.
`requirements`, `non-requirements`, `questions` and `areas` do not move, because this slice files no
requirement. If Ken answers challenge 1 by amending CNT-117, they do; the task that amends it says so.

`pnpm --filter @alloy-works/trace generate` runs **after** prettier, or the generated JSON is
reformatted underneath it.

---

## Requirement challenges, for Ken

Lead item first, because it is a defect rather than an opinion.

1. **CNT-117's third kind cannot be built, and the stored shape does not say so.** A definition list
   is pairs - a term, then what it means - and PDF/UA gives it `DL > DI > (DT, DD)`. The stored shape
   is `items: [{ content: BlockNode[] }]`: one sequence of blocks per item, with nothing saying which
   part is the term. So `kind: 'definition'` is **storable and unhonourable** - an author can declare
   a definition list and no publication, no reader and no assistive technology can be told what it
   is. That is worse than refusing it, because the model accepts a claim nothing keeps. Three ways
   out, and the slice needs one of them: reword CNT-117 to two kinds and file the definition list as
   its own requirement with its own shape; or give the stored `list` a definition form in a content
   schema version 2 (which #101 and #88 are already waiting for, per the marks plan's decision E);
   or leave it and accept a member of the model nobody may use. **Recommendation: the first, now, and
   the second when schema version 2 comes.**

2. **CNT-119 does not say what a start of zero means, and the engine answers `n.`** Typst sets roman
   zero as _nulla_. `start: z.number().int().min(0)` lets an author ask for a list that begins
   `n., i., ii.`. Decision E refuses it in the editor and at publish, which is a product decision
   standing in for a requirement. Either CNT-119 should say the start is a positive number except in
   decimal, or it should say what a zero start means in each format. **Recommendation: reword to
   "a start number of 1 or more, and 0 where the format is decimal".**

3. **CNT-079 bundles four families delivered in four slices, and so can never be claimed until the
   last of them.** Headings are the document view's, lists are this slice's, tables and footnotes are
   later. This PDF really does carry `L`, `LI`, `Lbl` and `LBody`, and CNT-079 gets no credit for it
   and will read `Specified` through all of T1. **This is the same challenge Ken declined on CNT-035**
   - "a requirement reading Designed until T6 is honest" - so it is raised once and not pressed. The
     difference, if there is one: CNT-035 waits on one thing arriving, while CNT-079 waits on four, and
     three of the four will be honest and invisible for a year.

4. **Nothing in the corpus says a list has a marker, and the default one breaks the build.** No
   requirement names what an unordered list's marker is, or asks that it be legible in the faces the
   product pins. That gap is how a two-level list silently became a refused compile: Typst's own
   default set holds U+2023, which Liberation Serif does not have. This slice pins the set in the
   template, which is the wrong home - CNT-094 says appearance comes from a named style, and a marker
   is appearance. **Recommendation: file a requirement that the list marker at each level is a
   property of the presentation theme (STY), and that a theme's marker must be covered by the
   theme's own typefaces, checked.** Until then themes.md carries a named gap.

5. **CNT-118's "at least six levels" is a floor with no ceiling anywhere.** A list item holds block
   content, so nesting is unbounded by construction; the only thing that stops it is the admission
   limit, which bites somewhere above **thirty** levels and is a JSON depth of 128, not a decision
   about content. So the only answer an author can ever be given is "nested more than 128 deep",
   which means nothing to them. **Recommendation: state a maximum list nesting depth in the content
   model, in levels, and have the editor decline the command at that depth and say so, rather than
   letting a save be refused in the language of a JSON walk.** Low priority - nobody reaches thirty
   levels by accident - but the number should be somebody's decision rather than an accident.

---

## What this plan leaves undone

Named so the next plan starts from a list rather than from a reading of the diff.

- **Block quotations and preformatted text**, and with them the monospace face - editor 5, the other
  half of this commission. Decision F has the measured cost and the recommendation; decision G has
  the em dash `quote(attribution:)` writes that the slice must avoid.
- **Definition lists**, everywhere: the stored shape, the editor and the published document, waiting
  on challenge 1's answer.
- **Tables** and **footnotes**, the other two nesting families, which inherit every plugin this slice
  rewrote. `prosemirror-tables` and the restricted footnote schema are component-editor.md's.
- **Equations** and the #103 ruling; **figures**, which wait on the assets design.
- **Paste** through the admission pipeline with its report (CNT-063), and **issue #102** with the HTML
  readers. Nothing here admits anything: no reader, no paste.
- **Issue #101** (a run's direction) and **issue #88** (a caption holding inline content), together,
  as content schema version 2 with one migration and one permanent fixture - and, if challenge 1 is
  answered that way, the definition list's shape beside them.
- **The list marker as a theme property** (challenge 4). It is pinned in the template here, which is
  the wrong home and is said to be.
- **CNT-079 in full**, which needs headings, tables and footnotes as well as lists.
- **PUB-090 in full**, which needs the Matterhorn Protocol review a person does. The veraPDF half
  passes on every publication this slice makes.
- **A maximum nesting depth stated in levels** (challenge 5), so an author who reaches it is told in
  their own language.
- **`docs/plans/README.md`'s editor numbering**, which this plan displaces: recovery and undo move to
  editor 6 and paste to editor 7, done in task 12 rather than on the planning branch.
