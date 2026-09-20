# Editor 3: marks, hyperlinks and language marks

> **For agentic workers:** execute this plan task by task, test first, one commit per task. Every task
> names its expected RED failure; run it and see that failure before writing the code that fixes it.

**Goal:** an author can emphasise a word, mark a phrase strong, underline it, set it as subscript,
superscript, inline code or a quoted phrase, link a span to an address, and say that a run is in
another language - from a toolbar and from the keyboard - and publishing prints all of it.

**Architecture:** the ten marks the content model already stores become marks in the editor's
ProseMirror schema; the mapping stops collapsing a paragraph to one run and carries a run per mark
set; one command registry feeds both the keymap and the toolbar; `assemble` carries a run's marks
into a new published schema, `publishing/3`, and a new immutable template, `publication/3`, sets
them.

**Designs:** [component-editor.md](../design/component-editor.md) (the authoring matrix, the identity
table, CNT-077, CNT-098, CNT-147), [content-model.md](../design/content-model.md) (what a mark is,
CNT-003, CNT-031, CNT-126, CNT-127, CNT-140), [publishing.md](../design/publishing.md).

**Version:** 0.32.0 - a functional enhancement. Do not bump on the planning branch.

---

## Global constraints

- **TDD.** No production code without a failing test that preceded it, and the failure watched.
- **No dashes in user-facing text.** A plain hyphen in every UI string, catalogue entry and changelog
  bullet. Code and comments are exempt.
- **Invented names only** in fixtures: Ada, Grace, Alice. No real person, address or document.
- **`example.test` for every link target in a test.** Never a real domain.
- **The console gate.** A passing run has no `console.error` or `console.warn`. A test that provokes
  noise on purpose calls `allowConsoleNoise()`.
- **`<StrictMode>`.** Every `apps/web` test renders under it, as the existing ones do. Every test that
  touches the ProseMirror view first waits for the surface:
  `await screen.findByRole('textbox', { name: 'Content of Install the printer' })`. Never touch the
  `onView` handle before that await; the repository has lost time to exactly that race.
- **`packages/editor` runs in Node.** No `document`. A `toDOM` result is asserted as the spec array it
  returns; what a browser makes of it is asserted once, in `apps/web`, under jsdom.
- **Affected suites only** while working: `pnpm --filter @alloy-works/editor test`,
  `--filter @alloy-works/domain test`, `--filter @alloy-works/web test`,
  `--filter @alloy-works/worker test`. Never the root `pnpm test`, never `turbo run test`, never
  `pnpm test:e2e`.
- **Order at the end:** `pnpm format` (prettier --write), then
  `pnpm --filter @alloy-works/trace generate`, then `pnpm trace check` and `pnpm trace pins`.
- **Never** run `pnpm dev:setup`, write to the development database, or stop or restart a container.

---

## What was run before this plan was written, and what it settled

Four questions, each answered by the smallest thing that answers it. Nothing was built.

**1. Does a mark change a block's identity, or its canonical shape?** A spike ran the real
`identityPlugin` over mark transactions.

- `addMark` inside a block, and across a block boundary, leaves every block identifier as it was: a
  mark step maps every offset to itself, so `heir.get(id) === offset` holds. The identity plugin needs
  no change.
- The canonical form already sorts marks by type then identifier at any depth, so the editor's set
  order (ProseMirror sorts by schema rank) and the stored order (lexicographic) hash alike. Two
  documents differing only in mark order produced one canonical string.
- **Bold then unbold gives back the identical document** (`doc.toJSON()` equal), so a mark applied and
  removed leaves `version.unchanged` intact.

**2. Does a mark's identifier survive the editor, and what happens when an edit splits it?**

- Typing inside a marked run keeps one identifier over the whole run: `alpha` bolded, `XX` typed in
  the middle, one run, one id. That is CNT-004.
- Two adjacent runs of the same type with **different** identifiers do not merge: ProseMirror keeps
  two text nodes. **So `fromEditor` cannot keep using `paragraph.textContent`** - it must emit one
  text node per mark set. This is the single largest change in the mapping.
- Splitting a paragraph inside a marked run leaves **one mark identifier across two blocks**. That is
  allowed: mark identifiers are not in the set the domain holds unique within a component (a block's,
  a footnote's, a footnote paragraph's, a cross-reference's), and CNT-004 asks only that one
  annotation keep one identifier.
- Applying a character mark over a range that already carries one of the same type replaces the
  overlap with the fresh identifier, leaving the untouched part under the old one - exactly what the
  design's identity table says.
- `prosemirror-commands` 1.7.2's `toggleMark` **removes when the mark is present anywhere** in the
  range by default, so bolding a selection in which one word is already bold un-bolds all of it.
  `{ removeWhenPresent: false }` gives the behaviour an author expects in both directions, verified
  on and off.
- A mark declared `inclusive: false` is not extended by typing at its end. Verified for `hyperlink`.

**3. What must a language mark carry to satisfy the stored shape and the publisher?** The stored shape
takes `fr`, `pt-BR`, `zh-Hans`, `es-419` and `sr-Latn-RS`, and refuses `FR` and `french`.
`publishedLanguage` carries only two or three letters and a two-letter region, so `zh-Hans`,
`es-419` and `sr-Latn-RS` are refused at publish, naming the tag, and never shortened (Ken's answer
K). A component's **base** language already behaves that way, so this is the existing bargain, not a
new one. See decision D.

**4. What can only a browser show?** The pinned Typst 0.15.1 compiled a page carrying all seven
character marks, a link and a French run, with the pinned faces and `--pdf-standard ua-1`, and the
pinned veraPDF passed it: **106 rules passed, 0 failed, PDF/UA-1 compliant**. pdf.js read the roles
`H1, P, Span x7, P, Code, Quote, Link` and one Link annotation carrying
`https://example.test/report`. So printing a hyperlink costs nothing in conformance. Two things the
suites cannot show and the plan says so rather than implying otherwise:

- Whether a browser's spelling checker honours `spellcheck="false"` on a span inside a
  `contenteditable`. jsdom asserts the attribute; only a browser shows the checker obeying it.
- How a right-to-left run reads inside a left-to-right paragraph. The Unicode bidirectional algorithm
  handles a strong run without help, which is why decision E defers issue #101, but only a browser
  shows the neutral characters at its edges.

Also found, and acted on in decision C: with only Liberation Serif pinned, Typst sets `raw` in the
serif face and **warns about nothing** (a genuinely unknown family does warn, checked).

---

## Decisions

Each is a recommendation with the alternative that was rejected and why. A, B and C change what
ships; D to H are rulings on open issues.

**Ken's answers (2026-09-20):** every recommendation accepted, with three additions. Each is written
into the task it changes as well as here.

- **The canonical form merges adjacent runs carrying identical marks, in this slice** (issue #154,
  filed): the plan proposed filing it. Two spellings of one text give two fingerprints, so a save that
  changed nothing records a version; versions are insert-only, and nothing has stored a mark yet, so
  it is cheapest now. It is **task 11**, and it lands before the mapping can write two runs that mean
  one.
- **The editor says at the time when a language an output cannot carry is used** (issue #155, filed as
  a requirement): decision D lets an author write `zh-Hans` and leaves the publisher to refuse it,
  which is the trap this slice was told to avoid. **Task 6** builds the warning and lands #155's row;
  if the warning turns out to cost more than the slice can carry, the publish refusal must at least
  name the run and its place, and the plan says which was done.
- **CNT-085 is reworded to its first clause**, its second living in the design as prose (challenge 1).
  **Task 10** makes the edit under `docs/specification/requirements/README.md`'s rules, with its
  change-history row. Challenge 2 (splitting CNT-035) is **declined for now**: a requirement reading
  `Designed` until T6 is honest, and splitting it would file a row to make a count look better.

**A. Publishing prints marks and links in this slice, not in publishing 3.** Today
`unpublishableInline` refuses any inline carrying a mark, so the first word an author emphasises
makes the document unpublishable. It is refused by name, so nothing is silent - but shipping a
toolbar that breaks publishing is not a state to ship. _Rejected:_ leaving it to publishing slice 3
and shipping 0.32.0 with an editor whose first action stops the only output the product has.
Publishing 3 keeps everything else: lists, tables, block quotations, preformatted text, footnotes,
figures and equations.

**B. A new published schema and a new template version, `publishing/3` and `publication/3`.** A run
gains `marks`, and a template version is immutable. Template 2 goes on reading `publishing/2`
documents unchanged. _Rejected:_ adding an optional `marks` member that template 2 ignores - it would
print a marked publication as plain text with nothing saying so.

**C. Do not pin a monospace face; inline code publishes in the body face, and the plan says so.**
Adding Liberation Mono would tighten `PinnedFonts.covers`, which is the intersection over **every**
pinned face, and so would shrink the publishable character set that publishing 1a established at
4,170 code points in 19 ranges, each compiled to prove it. That re-derivation is a slice of its own.
_Rejected:_ pinning Liberation Mono here. A monospace face belongs to publishing 4, themes and
typefaces, with the coverage work beside it. The content is still tagged `Code`, so assistive
technology is told; a sighted reader is not, and that is the named gap.

**D. A language mark takes every tag the model takes, and the publisher refuses what it cannot
carry, naming it.** `zh-Hans` is stored and a PDF of it fails with `language_not_publishable` naming
the tag - as a component's base language already does. _Rejected:_ refusing `zh-Hans` in the editor,
which would put a publisher's limit into the author's hands and contradict CNT-140's own example.
A requirement is proposed at the end for the editor to say, at the time, what an output cannot carry.

**E. Issue #101, a run's direction: deferred, to a content-model plan that raises the content schema
to version 2.** Adding a member to a mark is a schema version with a permanent fixture (CNT-012), and
this slice adds none. The practical loss is small: the Unicode bidirectional algorithm renders a
strong right-to-left run inside a left-to-right paragraph without being told. The editor here
derives nothing from a tag, which is what content-model.md forbids. **Recommendation:** fix #101 and
**#88** together in one content schema version 2, because two migrations in one version cost less
than two versions and each fixture is permanent.

**F. Issue #88, a caption holding an equation, a mark or a cross-reference: deferred, same plan as
#101.** Nothing in this slice authors a caption.

**G. Issue #102, the admission report naming what was inside something removed whole: deferred to the
HTML readers plan,** which the issue itself names as the one that meets the case again. This slice
admits nothing: it adds no reader and no paste.

**H. Issue #125, the nesting limit on the saving path: deferred to the lists plan.** Marks do not
nest blocks, so this slice cannot reach the limit and cannot demonstrate a fix. The first family that
nests - lists, then tables and footnotes - is where a test can show content refused at the save route
that admission would refuse, and where the fix earns its test.

**I. Ten marks in the editor schema, nine of them authorable.** The eight character marks, plus
hyperlink and language. `definedTerm` is in the schema so the mapping is total over it and CNT-031
can be demonstrated end to end; it has no command, because a term comes from LIB's catalogue, which
is T6. `condition`, `suggestion` and `comment` stay refused by name in `toEditor`, because nothing in
T1 can put one into a component, so a component holding one opens read-only and honest.
_Rejected:_ rendering the three annotation marks as read-only markers now - unreachable code with a
styling budget attached.

---

## Requirements

**Cited by this slice** - each because a test's own body demonstrates the statement, and the design
that claims it claims it in full:

| ID          | Claimed by          | What demonstrates it                                                                                                                                                                              |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-003** | content-model.md    | A comment mark and an emphasis mark over overlapping ranges, neither nested nor split into two annotations                                                                                        |
| **CNT-031** | content-model.md    | All eight character marks round-trip `toEditor` then `fromEditor` unchanged                                                                                                                       |
| **CNT-126** | content-model.md    | A hyperlink applied over a selection carries `href` and an optional `title`, and overlaps a character mark                                                                                        |
| **CNT-077** | component-editor.md | Every command in `EDITOR_COMMANDS` has a shortcut in the keymap and a button in the toolbar, asserted as one invariant over the registry, and the toolbar is reached and driven by keyboard alone |
| **CNT-098** | component-editor.md | The surface renders with `spellcheck="true"`                                                                                                                                                      |
| **CNT-147** | component-editor.md | A run whose language mark differs from the component's base language renders with `spellcheck="false"`, and the surface asks for checking                                                         |

CNT-098 and CNT-147 are **proxy claims and are labelled as such in the plan's closing section**: a
test asserts the attribute the product sets, not the checker obeying it.

**Deliberately not cited, with the reason:**

- **CNT-035** - the design leaves it unclaimed because "every CNT-031 mark from toolbar and keyboard"
  includes defined term, whose control needs LIB's terms in T6. Seven of the eight arrive here.
- **CNT-085** - its second clause ("must be understood as the one mark named for its appearance") is
  a claim about a document, not about code. content-model.md answers it in prose; no test can.
- **CNT-084**, **CNT-128** - "every output format" includes Word, which is publishing 7. A PDF-only
  test does not demonstrate either statement. Left unclaimed and named, as PUB-090 was.
- **CNT-005** - accepting, rejecting or excluding an annotation is COL's and REU's workflow; nothing
  here resolves one.
- **CNT-138** - markers distinguishable without colour applies to the annotation marks this slice
  does not render.

---

## File structure

| File                                           | Responsibility                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/editor/src/schema.ts`                | Modify: ten marks, their attributes, `inclusive`, `excludes` and `toDOM`      |
| `packages/editor/src/marks.ts`                 | Create: the command registry, `toggleMarkCommand`, `markAt`, `markThroughout` |
| `packages/editor/src/marks.test.ts`            | Create                                                                        |
| `packages/editor/src/mapping.ts`               | Modify: a run per mark set, both ways                                         |
| `packages/editor/src/state.ts`                 | Modify: the mark keymap, built from the registry                              |
| `packages/editor/src/index.ts`                 | Modify: the new exports                                                       |
| `packages/editor/style.css`                    | Modify: how each mark is set on the surface                                   |
| `apps/web/src/editor/EditorToolbar.tsx`        | Create: `role="toolbar"`, one tab stop, arrow keys                            |
| `apps/web/src/editor/MarkPrompt.tsx`           | Create: the link and language prompts                                         |
| `apps/web/src/editor/ComponentEditor.tsx`      | Modify: the toolbar, the prompts, `F6` between regions                        |
| `apps/web/src/editor/EditorToolbar.test.tsx`   | Create                                                                        |
| `packages/domain/src/publishing/published.ts`  | Modify: `PublishedMark`, `PublishedRun.marks`, `publishing/3`                 |
| `packages/domain/src/publishing/assemble.ts`   | Modify: carry a run's marks, refuse a tag the engine cannot carry             |
| `apps/worker/templates/publication/3/main.typ` | Create: template 2 plus `run`                                                 |
| `apps/worker/src/template.ts`                  | Modify: version 3, its hash, and the reading map                              |
| `apps/worker/src/marks.test.ts`                | Create: the PDF a marked document makes, through veraPDF                      |

---

## Task 1: the editor schema holds ten marks

**Files:** modify `packages/editor/src/schema.ts`; create `packages/editor/src/schema.test.ts`.

**Produces:** `editorSchema.marks` with `emphasis`, `strong`, `underline`, `subscript`,
`superscript`, `inlineCode`, `quotedPhrase`, `definedTerm`, `hyperlink`, `language`. Every mark
carries `id`; `definedTerm` also `term`; `hyperlink` also `href` and `title` (default `null`);
`language` also `tag`. `hyperlink` and `language` are `inclusive: false`. `paragraph`'s `marks` goes
from `''` to `'_'` (all).

- [ ] **Step 1: write the failing tests**

```ts
describe('the editor schema', () => {
  it('holds the ten marks an author or the mapping needs', () => {
    expect(Object.keys(editorSchema.marks).sort()).toEqual([
      'definedTerm',
      'emphasis',
      'hyperlink',
      'inlineCode',
      'language',
      'quotedPhrase',
      'strong',
      'subscript',
      'superscript',
      'underline',
    ]);
  });

  it('does not hold a mark nothing in T1 can create', () => {
    for (const name of ['condition', 'suggestion', 'comment'])
      expect(editorSchema.marks[name]).toBeUndefined();
  });

  it('does not extend a hyperlink or a language mark by typing at its end', () => {
    expect(editorSchema.marks.hyperlink!.spec.inclusive).toBe(false);
    expect(editorSchema.marks.language!.spec.inclusive).toBe(false);
    expect(editorSchema.marks.emphasis!.spec.inclusive ?? true).toBe(true);
  });

  it('CNT-147 renders a language mark with its tag and asks that it is not spell checked', () => {
    const mark = editorSchema.mark('language', { id: 'm1', tag: 'fr-CA' });
    expect(editorSchema.marks.language!.spec.toDOM!(mark, true)).toEqual([
      'span',
      { lang: 'fr-CA', spellcheck: 'false', class: 'aw-language' },
      0,
    ]);
  });

  it('CNT-126 renders a hyperlink with its target and its title', () => {
    const withTitle = editorSchema.mark('hyperlink', {
      id: 'm2',
      href: 'https://example.test/report',
      title: 'The quarterly report',
    });
    expect(editorSchema.marks.hyperlink!.spec.toDOM!(withTitle, true)).toEqual([
      'a',
      { href: 'https://example.test/report', title: 'The quarterly report' },
      0,
    ]);
    const bare = editorSchema.mark('hyperlink', { id: 'm3', href: 'mailto:ada@example.test' });
    expect(editorSchema.marks.hyperlink!.spec.toDOM!(bare, true)).toEqual([
      'a',
      { href: 'mailto:ada@example.test' },
      0,
    ]);
  });
});
```

- [ ] **Step 2: run it red.** `pnpm --filter @alloy-works/editor test`. Expected:
      `expected [] to deeply equal [ 'definedTerm', ... ]`, and `toDOM` undefined on a mark that does
      not exist.

- [ ] **Step 3: write the schema.** Each character mark is `{ attrs: { id: {} }, toDOM: () => [tag, 0] }`
      with `tag` being `em`, `strong`, `u`, `sub`, `sup`, `code`, `q` and, for `definedTerm`,
      `['dfn', { 'data-term': term }, 0]`. `parseDOM` is deliberately **omitted on every mark**: the
      view refuses paste, so nothing parses marks out of the DOM, and a `parseDOM` rule would let the
      browser's own clipboard parser make one without an identifier.

- [ ] **Step 4: green.** Then `pnpm --filter @alloy-works/editor typecheck`.

- [ ] **Step 5: commit.** `feat(editor): ten marks in the editor schema`

---

## Task 2: the mapping carries a run per mark set

**Files:** modify `packages/editor/src/mapping.ts`; modify `packages/editor/src/mapping.test.ts`.

**Consumes:** task 1's schema. **Produces:** `toEditor` and `fromEditor`, total over the ten marks and
inverse. `unsupportedIn` reports `mark:condition`, `mark:suggestion` and `mark:comment` only.

`fromEditor` builds one `{ type: 'text', value, marks }` per text node, with each mark's attributes
spread and `title` **omitted** where it is `null` - `hyperlinkMarkSchema` is strict and refuses
`title: null`.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-031 round-trips all eight character marks unchanged', () => {
  const document = documentWith([
    run('plain', []),
    run('emphasised', [{ type: 'emphasis', id: 'm1' }]),
    run('strong', [{ type: 'strong', id: 'm2' }]),
    run('underlined', [{ type: 'underline', id: 'm3' }]),
    run('sub', [{ type: 'subscript', id: 'm4' }]),
    run('sup', [{ type: 'superscript', id: 'm5' }]),
    run('code', [{ type: 'inlineCode', id: 'm6' }]),
    run('quoted', [{ type: 'quotedPhrase', id: 'm7' }]),
    run('term', [{ type: 'definedTerm', id: 'm8', term: 'tensile strength' }]),
  ]);
  const opened = toEditor(document);
  expect(opened.editable).toBe(true);
  expect(fromEditor((opened as Extract<Opened, { editable: true }>).doc)).toEqual(document);
});

it('CNT-003 keeps two overlapping annotations whole, neither nested nor split in two', () => {
  // "alpha beta gamma": emphasis over "alpha beta", a comment-like second annotation over
  // "beta gamma" - modelled here with `language`, the other overlapping mark this slice has.
  const document = documentWith([
    run('alpha ', [{ type: 'emphasis', id: 'e1' }]),
    run('beta', [
      { type: 'emphasis', id: 'e1' },
      { type: 'language', id: 'l1', tag: 'fr' },
    ]),
    run(' gamma', [{ type: 'language', id: 'l1', tag: 'fr' }]),
  ]);
  const doc = (toEditor(document) as Extract<Opened, { editable: true }>).doc;
  expect(fromEditor(doc)).toEqual(document);
  const ids = new Set<string>();
  doc.firstChild!.forEach((text) => text.marks.forEach((m) => ids.add(m.attrs.id as string)));
  expect([...ids].sort()).toEqual(['e1', 'l1']);
});

it('CNT-126 keeps a hyperlink target and omits a title it does not have', () => {
  const document = documentWith([
    run('the report', [{ type: 'hyperlink', id: 'h1', href: 'https://example.test/report' }]),
  ]);
  const doc = (toEditor(document) as Extract<Opened, { editable: true }>).doc;
  expect(doc.firstChild!.firstChild!.marks[0]!.attrs.title).toBeNull();
  expect(fromEditor(doc)).toEqual(document);
});

it('opens read-only for a mark nothing in T1 can create, naming it', () => {
  const document = documentWith([run('x', [{ type: 'comment', id: 'c1', threadId: 't1' }])]);
  expect(toEditor(document)).toEqual({ editable: false, unsupported: ['mark:comment'] });
});
```

- [ ] **Step 2: run it red.** Expected: the round-trip test fails with
      `{ editable: false, unsupported: [ 'mark:emphasis', ... ] }`.

- [ ] **Step 3: write the mapping.** `toEditor` maps each inline `text` to
      `editorSchema.text(value, marks.map(toMark))`; an empty `value` is dropped, because
      ProseMirror refuses an empty text node. `fromEditor` walks `paragraph.forEach` rather than
      reading `textContent`.

- [ ] **Step 4: green.**
- [ ] **Step 5: commit.** `feat(editor): map a run per mark set, both ways`

---

## Task 3: the command registry, and applying a mark

**Files:** create `packages/editor/src/marks.ts` and `packages/editor/src/marks.test.ts`; modify
`packages/editor/src/state.ts` and `index.ts`.

**Produces:**

```ts
export interface EditorCommand {
  readonly mark: string; // the mark type's name
  readonly label: string; // the toolbar's and the keymap's one label
  readonly shortcut: string; // a prosemirror-keymap key, e.g. 'Mod-i'
  readonly shortcutSaid: string; // what the button's tooltip says, e.g. 'Ctrl or Cmd and I'
  readonly prompts: boolean; // whether the author must supply a value first
}
export const EDITOR_COMMANDS: readonly EditorCommand[];
export function toggleMarkCommand(
  mark: string,
  newIdentifier: () => string,
  attrs?: Record<string, unknown>,
): Command;
export function applyMarkCommand(
  mark: string,
  newIdentifier: () => string,
  attrs?: Record<string, unknown>,
): Command;
export function removeMarkCommand(mark: string): Command;
export function markAt(state: EditorState, mark: string): Record<string, unknown> | null;
export function markThroughout(state: EditorState, mark: string): boolean;
```

> **Corrected during the build (task 3 and its two reviews).** `markActive` is `markThroughout`,
> because `toggleMark` runs with `{ removeWhenPresent: false }` and a button reading "the mark is
> somewhere in the selection" would contradict what pressing it does. `removeMarkCommand` takes the
> identifier generator because a removal that splits an annotation gives the surviving far piece a
> fresh identifier. `applyMarkCommand` exists because `toggleMark` decides by `rangeHasMark` and
> ignores attributes, so re-applying a hyperlink over a range that already carries one removes it
> instead of retargeting it. `markAt` returns no `id`, so a prompt filled from it cannot hand an
> identifier back to name a changed value.

The registry, in the order the toolbar shows it. **These are the exact user-facing words:**

| mark           | label         | shortcut      | shortcutSaid              | prompts |
| -------------- | ------------- | ------------- | ------------------------- | ------- |
| `strong`       | Strong        | `Mod-b`       | Ctrl or Cmd and B         | no      |
| `emphasis`     | Emphasis      | `Mod-i`       | Ctrl or Cmd and I         | no      |
| `underline`    | Underline     | `Mod-u`       | Ctrl or Cmd and U         | no      |
| `subscript`    | Subscript     | `Mod-,`       | Ctrl or Cmd and comma     | no      |
| `superscript`  | Superscript   | `Mod-.`       | Ctrl or Cmd and full stop | no      |
| `inlineCode`   | Inline code   | `Mod-e`       | Ctrl or Cmd and E         | no      |
| `quotedPhrase` | Quoted phrase | `Mod-Shift-q` | Ctrl or Cmd, Shift and Q  | no      |
| `hyperlink`    | Link          | `Mod-k`       | Ctrl or Cmd and K         | yes     |
| `language`     | Language      | `Mod-Shift-l` | Ctrl or Cmd, Shift and L  | yes     |

`toggleMarkCommand` wraps `prosemirror-commands`' `toggleMark` with
`{ removeWhenPresent: false }` and a **freshly generated identifier on every call**, merged over any
`attrs` given.

- [ ] **Step 1: write the failing tests**

```ts
it('CNT-077 gives every command a shortcut and one label, with no shortcut used twice', () => {
  expect(EDITOR_COMMANDS).toHaveLength(9);
  for (const command of EDITOR_COMMANDS) {
    expect(command.label, command.mark).toMatch(/^[A-Z][a-z ]+$/);
    // No fancy dashes in anything an author reads; a plain hyphen would be allowed. Written by
    // code point rather than as a character, so the rule cannot be broken by the rule's own test.
    const fancy = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(command.label + command.shortcutSaid).not.toMatch(fancy);
    expect(editorSchema.marks[command.mark]).toBeDefined();
  }
  expect(new Set(EDITOR_COMMANDS.map((c) => c.shortcut)).size).toBe(9);
});

it('gives each application of a mark its own identifier', () => {
  const state = stateWith('alpha beta gamma'); // one paragraph, id 'b1'
  const first = run(state, 2, 7, toggleMarkCommand('emphasis', counter()));
  const second = run(first, 8, 12, toggleMarkCommand('emphasis', counter()));
  expect(idsIn(second, 'emphasis')).toEqual(['id1', 'id2']);
});

it('CNT-004 keeps one identifier when an edit splits a marked run', () => {
  let state = run(stateWith('alpha beta'), 2, 12, toggleMarkCommand('emphasis', counter()));
  state = state.apply(state.tr.insertText('XX', 6));
  expect(idsIn(state, 'emphasis')).toEqual(['id1']);
  expect(state.doc.firstChild!.textContent).toBe('alphXXa beta');
});

it('marks the whole of a selection where only part of it was marked', () => {
  let state = run(stateWith('alpha beta gamma'), 8, 12, toggleMarkCommand('emphasis', counter()));
  state = run(state, 2, 17, toggleMarkCommand('emphasis', counter()));
  expect(textAndMarks(state)).toEqual([
    { text: 'a', marks: [] },
    { text: 'lpha beta gamm', marks: ['emphasis'] },
    { text: 'a', marks: [] },
  ]);
});

it('takes a mark off a selection that carries it throughout', () => {
  let state = run(stateWith('alpha'), 1, 6, toggleMarkCommand('emphasis', counter()));
  state = run(state, 1, 6, toggleMarkCommand('emphasis', counter()));
  expect(textAndMarks(state)).toEqual([{ text: 'alpha', marks: [] }]);
});

it('CNT-127 refuses a link target whose scheme is not allowed, before it is applied', () => {
  const state = stateWith('alpha');
  const applied = toggleMarkCommand('hyperlink', counter(), {
    href: 'javascript:alert(1)',
  })(state, () => undefined);
  expect(applied).toBe(false);
});

it('reads back the mark under the cursor, so a prompt can be filled with what is there', () => {
  const state = run(
    stateWith('the report'),
    1,
    11,
    toggleMarkCommand('hyperlink', counter(), {
      href: 'https://example.test/report',
      title: 'The quarterly report',
    }),
  );
  expect(markAt(state, 'hyperlink')).toEqual({
    id: 'id1',
    href: 'https://example.test/report',
    title: 'The quarterly report',
  });
  expect(markAt(state, 'language')).toBeNull();
});
```

- [ ] **Step 2: run it red.** Expected: `Cannot find module './marks.js'`.

- [ ] **Step 3: write `marks.ts`.** `toggleMarkCommand` validates a `hyperlink`'s `href` against the
      domain's `allowedLinkSchemes` and a `language`'s `tag` against the domain's mark schema before
      dispatching; an invalid value returns `false` and the command is a no-op, so nothing
      unstorable ever reaches a transaction. Export `allowedLinkSchemes` from `@alloy-works/domain`
      if it is not exported already, rather than repeating the list.

- [ ] **Step 4: green.**
- [ ] **Step 5: add the keymap to `createEditorState`,** built by mapping `EDITOR_COMMANDS` over
      `toggleMarkCommand(command.mark, options.newIdentifier)` - the two that prompt are bound to a
      command that does nothing in the editor and is handled by the renderer, so the registry stays
      one list. Add a test `it('binds every command in the registry into the state keymap')` that
      asserts every `shortcut` is a key of the state's mark keymap.
- [ ] **Step 6: commit.** `feat(editor): one command registry for the keymap and the toolbar`

---

## Task 4: how a marked surface is set

**Files:** modify `packages/editor/style.css`; modify `packages/editor/src/view.ts` if needed.

Rules for `.ProseMirror em/strong/u/sub/sup/code/q/dfn` and `a[href]`: inline code in a monospace
stack, a quoted phrase without a second pair of quotation marks (`q { quotes: none }` where the
mark's own characters are the author's text), `dfn` not italic by default, `a[href]` underlined and
in the link colour, and `.aw-language` with no visual treatment of its own. No test asserts colour;
one test asserts the stylesheet parses and names each selector.

- [ ] **Step 1:** write `it('styles every mark the schema can render')` in
      `packages/editor/src/schema.test.ts`, reading `style.css` with `node:fs` and asserting one
      selector per mark tag.
- [ ] **Step 2: red.** Expected: `expected '.ProseMirror code' to be found in style.css`.
- [ ] **Step 3:** write the rules.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(editor): set the marks on the surface`

---

## Task 5: the toolbar

**Files:** create `apps/web/src/editor/EditorToolbar.tsx` and `EditorToolbar.test.tsx`.

**Consumes:** `EDITOR_COMMANDS`, `toggleMarkCommand`, `applyMarkCommand`, `markThroughout`, `markAt`.

**Produces:**

```tsx
export interface EditorToolbarProps {
  readonly view: EditorView | null;
  readonly enabled: boolean;
  readonly newIdentifier: () => string;
  /** Asked for a value before a prompting command runs; resolves null when the author cancels. */
  readonly prompt: (
    command: EditorCommand,
    current: Record<string, unknown> | null,
  ) => Promise<Record<string, unknown> | null>;
}
export function EditorToolbar(props: EditorToolbarProps): JSX.Element;
```

One `role="toolbar"` with `aria-label="Formatting"`, one tab stop (roving `tabIndex`), `ArrowLeft`,
`ArrowRight`, `Home` and `End` moving between buttons, each button `aria-pressed` from `markThroughout`
and `title` from `shortcutSaid`, and each disabled when `enabled` is false.

- [ ] **Step 1: write the failing tests**

```tsx
it('CNT-077 offers every command as a button reachable by keyboard alone', async () => {
  renderToolbar();
  const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
  const buttons = within(toolbar).getAllByRole('button');
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
  ]);
  expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  buttons[0]!.focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  expect(document.activeElement).toBe(buttons[2]);
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(buttons[8]);
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(buttons[0]); // it wraps
});

it('says which mark the selection already carries', () => {
  /* aria-pressed true for emphasis */
});

it('asks for a target before it links, and does nothing when the author cancels', async () => {
  // prompt resolves null; the document is unchanged and no transaction was dispatched.
});

it('is unavailable while the component may not be changed', () => {
  // enabled false: every button disabled, the toolbar still in the accessibility tree.
});
```

- [ ] **Step 2: red.** Expected: `Cannot find module './EditorToolbar.js'`.
- [ ] **Step 3: write it.**
- [ ] **Step 4: green.** **Step 5: commit.** `feat(web): a formatting toolbar over the surface`

---

## Task 6: the link and language prompts, and `F6`

**Files:** create `apps/web/src/editor/MarkPrompt.tsx`; modify
`apps/web/src/editor/ComponentEditor.tsx`; modify `apps/web/src/editor/ComponentEditor.test.tsx`.

**The exact user-facing words.** The prompt is a dialog (`role="dialog"`, `aria-modal`, focus moved
to the first field, `Escape` cancels, focus returns to the button that opened it):

| Where                  | Words                                                   |
| ---------------------- | ------------------------------------------------------- |
| Link dialog title      | `Link`                                                  |
| Link field label       | `Address`                                               |
| Link title field label | `Title (optional)`                                      |
| Link field hint        | `An address beginning http:, https: or mailto:`         |
| Link refusal           | `That address must begin http:, https: or mailto:.`     |
| Language dialog title  | `Language`                                              |
| Language field label   | `Language tag`                                          |
| Language field hint    | `A BCP 47 tag, such as fr, pt-BR or zh-Hans`            |
| Language refusal       | `That is not a language tag. Try one like fr or pt-BR.` |
| Apply button           | `Apply`                                                 |
| Remove button          | `Remove`                                                |
| Cancel button          | `Cancel`                                                |

`F6` moves focus between the view's regions in order - component header, toolbar, surface - and wraps.

- [ ] **Step 1: write the failing tests** in `ComponentEditor.test.tsx`, each waiting for the surface
      first.

```tsx
it('links a selection to an address the author gives', async () => {
  let view: EditorView | undefined;
  render(<StrictMode><ComponentEditor ... onView={(m) => (view = m)} /></StrictMode>);
  await screen.findByRole('textbox', { name: 'Content of Install the printer' });
  act(() => { view!.dispatch(view!.state.tr.setSelection(
    TextSelection.create(view!.state.doc, 1, 6))); });
  await userEvent.click(screen.getByRole('button', { name: 'Link' }));
  await userEvent.type(await screen.findByLabelText('Address'), 'https://example.test/setup');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(fromEditor(view!.state.doc).content[0]!.content[0]).toMatchObject({
    type: 'text', value: 'Unbox', marks: [
      { type: 'hyperlink', href: 'https://example.test/setup' },
    ],
  }));
});

it('refuses an address whose scheme is not allowed, saying so, and applies nothing', async () => {
  // type 'javascript:alert(1)', Apply, then:
  expect(await screen.findByText('That address must begin http:, https: or mailto:.'))
    .toBeInTheDocument();
  // and the document still holds no hyperlink mark.
});

it('CNT-147 does not ask the checker to check a run in another language', async () => {
  // Apply a language mark 'fr' to a selection in an en-GB component, then:
  const surface = screen.getByRole('textbox', { name: 'Content of Install the printer' });
  const span = surface.querySelector('span[lang="fr"]')!;
  expect(span.getAttribute('spellcheck')).toBe('false');
  expect(surface.getAttribute('spellcheck')).toBe('true');       // CNT-098
});

it('CNT-077 moves between the header, the toolbar and the surface with F6 alone', async () => {
  // focus the title field, press F6 twice, expect the surface focused; a third wraps to the header.
});

it('saves an iteration holding the marks the author applied', async () => {
  // the PUT body's content carries the hyperlink mark with an id of 26 base32 characters.
});
```

- [ ] **Step 2: red.** Expected: an accessible element with the role `button` and the name `Link`
      cannot be found.
- [ ] **Step 3: write `MarkPrompt.tsx` and wire it.**
- [ ] **Step 4: green**, with `pnpm --filter @alloy-works/web test`.
- [ ] **Step 5: commit.** `feat(web): link and language prompts, and F6 between the regions`

---

**Ken's answer, binding (issue #155).** The language prompt says at the time when the tag an author
gives is one the product's outputs cannot carry (the publisher takes a language and an optional
two-letter region; `zh-Hans`, `es-419` and `sr-Latn-RS` are not carriable), naming the tag, before the
mark is applied - it is not a refusal by the content model, which takes any well-formed tag, but a
warning the author can act on. Land #155's row with `pnpm trace draft 155`, placed as the corpus's
rules say, and cite it from the test that demonstrates it. Words for the warning are yours, in the
editor's voice, with no dashes; say them in your report. If the warning proves to cost more than this
task can carry, say so plainly and make the publish refusal name the run and its place instead.

## Task 7: a published run carries its marks

**Files:** modify `packages/domain/src/publishing/published.ts` and `assemble.ts`; modify
`assemble.test.ts`.

**Produces:**

```ts
export type PublishedMark =
  | {
      readonly kind:
        | 'emphasis'
        | 'strong'
        | 'underline'
        | 'subscript'
        | 'superscript'
        | 'inlineCode'
        | 'quotedPhrase';
    }
  | { readonly kind: 'hyperlink'; readonly href: string }
  | { readonly kind: 'language'; readonly language: PublishedLanguage };

export interface PublishedRun {
  readonly text: string;
  /** In a fixed order, so one document makes one PDF: language, hyperlink, then schema order. */
  readonly marks: readonly PublishedMark[];
}

export const PUBLISHING_SCHEMA_2 = 'publishing/2'; // frozen
export const PUBLISHING_SCHEMA = 'publishing/3';
```

A `definedTerm` mark is still refused by `unpublishableInline`, naming `definedTerm`, because nothing
resolves a term. A hyperlink's `title` is **not** carried: a PDF link annotation has no place for it,
and inventing one would tell a reader something the author did not say.

- [ ] **Step 1: write the failing tests**

```ts
it('carries a run and the marks over it, in one fixed order', () => {
  // A paragraph: 'see ' plain, 'the report' hyperlink + emphasis, ' now' language fr.
  expect(runsOf(assembled)).toEqual([
    { text: 'see ', marks: [] },
    {
      text: 'the report',
      marks: [{ kind: 'hyperlink', href: 'https://example.test/report' }, { kind: 'emphasis' }],
    },
    { text: ' now', marks: [{ kind: 'language', language: { lang: 'fr', region: null } }] },
  ]);
});

it('refuses a run whose language tag the engine cannot carry, naming the tag', () => {
  // A language mark of 'zh-Hans'.
  expect(result).toEqual({
    ok: false,
    failures: [
      expect.objectContaining({
        stage: 'compose',
        code: 'language_not_publishable',
        block: 'b1',
        detail: 'zh-Hans',
      }),
    ],
  });
});

it('refuses a defined term, naming it, because nothing resolves a term', () => {
  expect(failuresOf(result)).toEqual([
    expect.objectContaining({
      code: 'inline_not_publishable',
      detail: 'definedTerm',
    }),
  ]);
});

it('checks a marked run against the pinned faces as it checks an unmarked one', () => {
  // a character outside the faces, inside an emphasised run, is still named.
});
```

- [ ] **Step 2: red.** Expected: `expected [ { text: 'see the report now' } ] to deeply equal [...]` -
      because today's `assemble` refuses the marked inlines and joins what is left.
- [ ] **Step 3: write it.** Keep `PUBLISHING_SCHEMA_1` and `PUBLISHING_SCHEMA_2` exactly as they
      are; a `publishing/1` or `publishing/2` document is still made for a request recorded before
      this release, so the existing tests that assert those shapes must go on passing unchanged.
- [ ] **Step 4: green.** **Step 5: commit.** `feat(domain): a published run carries its marks`

---

## Task 8: template 3 sets them

**Files:** create `apps/worker/templates/publication/3/main.typ` (copied from version 2, which must
not be edited); modify `apps/worker/src/template.ts`; modify `apps/worker/src/template.test.ts`.

The one new function, and the only place the exact Typst matters:

```typst
// A run and the marks over it, applied outermost first so one document sets one way.
#let run(r) = {
  let body = r.text
  for m in r.marks.rev() {
    if m.kind == "emphasis" { body = emph(body) }
    else if m.kind == "strong" { body = strong(body) }
    else if m.kind == "underline" { body = underline(body) }
    else if m.kind == "subscript" { body = sub(body) }
    else if m.kind == "superscript" { body = super(body) }
    else if m.kind == "inlineCode" { body = raw(r.text) }
    else if m.kind == "quotedPhrase" { body = quote(body) }
    else if m.kind == "hyperlink" { body = link(m.href, body) }
    else if m.kind == "language" { body = text(..language(m.language), body) }
  }
  body
}
#let paragraph(b) = { if b.runs.len() > 0 { par(b.runs.map(run).join()) } }
```

- [ ] **Step 1: write the failing tests** in `template.test.ts`: version 3 is registered, its hash is
      pinned, `TEMPLATE_READING['publishing/3']` is `3`, and versions 1 and 2 are byte for byte what
      they were.
- [ ] **Step 2: red.** Expected: `expected undefined to be defined` for `PUBLICATION_TEMPLATE[3]`.
      The hash test then fails naming the hash to paste in; take it from that message, never invent
      one.
- [ ] **Step 3: write it.** **Step 4: green.** **Step 5: commit.**
      `feat(worker): publication template 3, which sets a run's marks`

---

## Task 9: the PDF a marked document makes

**Files:** create `apps/worker/src/marks.test.ts`; modify `apps/worker/src/testing/pdf.ts`.

`ReadPdf` gains one member, because nothing today can see a link:

```ts
/** Every link annotation, per page, as a reader's viewer would follow it. */
readonly links: readonly (readonly string[])[];
```

read from `page.getAnnotations()`, keeping `subtype === 'Link'` and taking `url`.

- [ ] **Step 1: write the failing test**

```ts
it('sets every mark, links what is linked, and passes veraPDF', async () => {
  const pdf = await compileOne(markedDocument()); // the shared publication pattern of publish.test.ts
  const read = await readPdf(pdf);
  expect(read.roles).toContain('Link');
  expect(read.roles).toContain('Code');
  expect(read.roles).toContain('Quote');
  expect(read.links[0]).toEqual(['https://example.test/report']);
  expect(spoken(read.taggedText[0]!)).toContain('see the report now');
  const verdict = await checkPdfUa1(pdf);
  expect(verdict.failures).toEqual([]);
  expect(verdict.compliant).toBe(true);
});
```

- [ ] **Step 2: red.** Expected: `read.links is not a function` / `expected undefined to equal [...]`.
- [ ] **Step 3: write it.** The spike already showed this passes: 106 rules, 0 failed, one Link
      annotation, roles `H1, P, Span, Code, Quote, Link`. If the suite disagrees, the difference is
      the template, not the engine.
- [ ] **Step 4: green.** **Step 5: commit.** `test(worker): a marked publication, through veraPDF`

---

## Task 11: the canonical form merges adjacent runs (issue #154)

**Ken's answer, binding.** In `packages/domain`, the content model's canonicalisation merges adjacent
runs of text that carry identical marks into one, so one visible text with one set of marks has one
stored spelling and one digest. Nothing has stored a mark, so no migration is needed; the parse and
every write path must accept what canonicalisation now produces, and refuse nothing it accepted
before. Test first, red: two adjacent runs with the same marks canonicalise to one run, and their
digest equals the digest of the same text written as one run; runs whose marks differ are left alone;
a mark's identifier survives the merge as the plan's spike describes (say which identifier wins and
why). The task's pull request closes #154; cite no requirement unless a test's own body demonstrates
one in full. This task lands **before** task 2, which is what makes two runs meaning one possible.

## Task 10: the documents, and the changelog

**Files:** modify `docs/architecture.md`, `docs/features.md`, `README.md`,
`docs/design/component-editor.md` (the built banner only), `docs/plans/README.md`, `CHANGELOG.md`,
`version.json`, `package.json`, `apps/desktop/package.json`.

- [ ] **Step 1:** `docs/architecture.md` - the editor's ten marks, the command registry, the toolbar,
      `publishing/3` and `publication/3`, and `ReadPdf.links`, each described as built.
- [ ] **Step 2:** `docs/features.md` and the README's Features table, in lockstep: formatting,
      hyperlinks and language marks, and the honest note that inline code publishes in the body face.
- [ ] **Step 3:** this plan's row in `docs/plans/README.md` moves to Built with its PR number, and
      the editor section's prose - which earmarked "editor 3" for recovery and "editor 4" for paste -
      is corrected to the numbers those plans now take: **editor 4** recovery and undo across a
      reload, **editor 5** paste.
- [ ] **Step 4:** the changelog entry below, `version.json` to `0.32.0`, and both mirrors.
- [ ] **Step 5:** `pnpm format`, then `pnpm --filter @alloy-works/trace generate`, then
      `pnpm trace check` and `pnpm trace pins`, and move the pins the latter reports.
- [ ] **Step 6: commit.** `docs: the marks slice as built, 0.32.0`

### The changelog entry to write, at the top of `CHANGELOG.md`

```markdown
## 0.32.0 - 2026-09-2X (PR #XXX)

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
- A language tag carrying a script or a numeric region, such as zh-Hans or es-419, is stored but
  cannot be published to PDF yet; a publish naming that tag says so and prints nothing.
```

---

## Pins, citations and the trace

Before: `requirements 1384, non-requirements 117, questions 135, design claims 408, citations 205,
scanned .tsx test files 10, areas 22`.

**Expected moves.** `citations` rises by one for every test title naming a requirement, and the exact
number comes from `pnpm trace pins`, never from counting by hand. `scanned .tsx test files` rises
from **10 to 11**, because `EditorToolbar.test.tsx` is new. `design claims` stays at **408**: every
requirement this slice cites is already claimed by content-model.md or component-editor.md, and no
`## Requirements owned` table gains a row. `requirements`, `non-requirements`, `questions` and
`areas` do not move, because this slice files no requirement.

`pnpm --filter @alloy-works/trace generate` runs **after** prettier, or the generated JSON is
reformatted underneath it.

---

## Requirement challenges, for Ken

**Answered (2026-09-20):** challenge 1 accepted - CNT-085 is reworded to its first clause in task 10,
its second clause staying in the design as prose. Challenge 2 declined: CNT-035 stays whole and reads
`Designed` until LIB's catalogue exists.

1. **CNT-085's second clause cannot be verified.** "Must be understood as the one mark named for its
   appearance rather than its meaning" is a claim about a document. content-model.md answers it in
   prose, and no test can. Either accept that it is design-answered and never `Verified`, or reword
   it to the first clause alone and let the prose live in the design.
2. **CNT-035 is one T6 library away from claimable, and blocks seven marks that are done.** Consider
   splitting it: the seven marks whose control needs nothing outside the editor, claimable now, and
   defined term, waiting for LIB. As one requirement it will read `Designed` until T6.
3. **Proposed, not filed: the editor should say what an output cannot carry, at the time.** An
   author can apply a `zh-Hans` language mark that the PDF engine will refuse, and finds out at
   publish. component-editor.md already has an "Unresolvable content" table for exactly this shape of
   problem. Suggested statement: _"Where a run's language tag cannot be carried by an output format
   the document can be published to, the editor must mark that run and name the format, at the time
   the tag is applied."_
4. **Proposed, not filed: the canonical form does not merge adjacent runs carrying identical marks.**
   Two text nodes of `a` and `b` with the same emphasis identifier hash differently from one node of
   `ab`. ProseMirror merges them, so the first-party editor cannot produce the split form - but
   another client can, and two spellings of one text would then be two versions. This is the same
   class as issue #124, which was fixed for footnotes.

---

## What this plan leaves undone

Named so the next plan starts from a list rather than from a reading of the diff.

- **Lists, tables, block quotations, preformatted text and footnotes**, one plan per family, each
  with its share of the toolbar - and with them, **issue #125**, the nesting limit on the saving
  path, which the first nesting family can finally demonstrate.
- **Equations** and the #103 ruling; **figures**, which wait on the assets design.
- **Paste** through the admission pipeline with its report (CNT-063), and **issue #102** with the
  HTML readers.
- **Issue #101** (a run's direction) and **issue #88** (a caption holding inline content), together,
  as content schema version 2 with one migration and one permanent fixture.
- **Defined term** and **citation** controls, LIB's T6 library; **cross-reference** insertion, STR's
  document view.
- **A monospace face**, and with it inline code set as code, publishing 4.
- **CNT-084 and CNT-128 in full**, which need Word - publishing 7.
- **CNT-098 and CNT-147 are cited on a proxy**: the tests assert the attributes the product sets, not
  a checker obeying them. Only a browser shows that, and the accessibility suite (CNT-139) is where
  it belongs.
- **The desktop checker's languages** (CNT-148), one bridge call in `shell.ts`.
- **Recovery, iterations and undo across a reload** (CNT-067, CNT-069, CNT-090, CNT-103), now
  editor 4.
