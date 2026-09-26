# W2: Small fixes found by the audit

> **A sketch**, built a task at a time, with one final whole-branch review before each pull request
> that is asked for a break of its own against every citation, as W1's were. It builds W2 of
> [the rest of T1](2026-09-25-t1-remainder.md): the defects and gaps
> [the T1 audit](<../reviews/T1 - Audit against the code.md>) found in what is built, and the design
> text it found stale.

**Goal:** what is built does what its requirements say, each shown by a test, and the design text says
what the code does.

**Three pull requests**, each on its own:

| PR   | Holds                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| W2.1 | The editor: CNT-075 read-only text set as the editor sets it, CNT-175 a definition list as one, CNT-074 who may edit and why, CNT-069's history depth |
| W2.2 | The API: API-003 (issue #240), API-006, API-012, API-037, API-047                                                                                     |
| W2.3 | Publishing and paste: PUB-003's order, CNT-167 Word's footnotes kept on paste, and the stale design text                                              |

Each bumps the version by CLAUDE.md's rule at the time: a PR that adds what an author or a caller can
see or use (CNT-074's card state, API-047's header, Word's footnotes on paste) is a functional
enhancement, and the rest are fixes.

**Every defect starts as an issue** describing what somebody sees, filed before its fix, and closed by
the PR's body (CLAUDE.md). The defects are CNT-075, CNT-175's `dd`, CNT-074's missing release time,
CNT-069's depth, PUB-003's order and #240; the rest are gaps against a requirement, not defects.

**Claims to add first**, each only for what its task demonstrates: CNT-075, CNT-175 and CNT-074 in
component-editor.md; API-037 and API-047 in service-foundations.md; CNT-167 in content-model.md.

## Measured before planning

**Word's clipboard HTML for footnotes** (Word 16 through COM, copying two paragraphs with a footnote
each, one note's words part bold). Each anchor is an `<a>` in the text whose style names
`mso-footnote-id:ftnN` and whose `href` is `#_ftnN`, holding the printed number inside Word's
conditional comments (`<![if !supportFootnotes]>`). The notes follow the last paragraph in
`<div style='mso-element:footnote-list'>`, one `<div style='mso-element:footnote' id=ftnN>` each,
whose `MsoFootnoteText` paragraphs open with a back-anchor to `#_ftnrefN` and then hold the note's
words, marks included. The capture is kept as the reader's test fixture, its words invented.

## Decisions for Ken

**Agreed as recommended**, all three, on 2026-09-26.

**CNT-175 moved to its own PR, W2.1b** (Ken, 2026-09-26): a real `dd` needs a node for a definition's
body, which changes Enter, Backspace, Delete, wrapping and lifting in definition lists - more than a
small fix. W2.1 ships CNT-075, CNT-074 and the undo depth; issue #246 closes with W2.1b.

| #    | Decision                                                                                                                                                                                                                                                                                  | Recommendation                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W2-A | **How far back undo reaches.** ProseMirror's history keeps 100 events by default, so a long session cannot undo back to where it opened (CNT-069). The history is already cleared at every version cut (CNT-169)                                                                          | **No limit on depth.** A session's history lives until the next cut or Done; its steps are text-sized. CNT-069 stays uncited until W11 makes it survive a reload                        |
| W2-B | **Whether the document page's cards say who may edit each component now** (CNT-074: "whether this user may edit it right now, and when they may not, why - naming who holds the lock and when it is expected to release"). Today only an open editor says so, and never the release time  | **Now, in W2.1:** the texts route answers each occurrence's permission and lock; a card says "Read only" or "Grace is editing, expected back 14:30" before it is opened. W9 restyles it |
| W2-C | **PUB-003's citation.** The order is fixed here (conditions before contributions, as publishing.md states) and swap tests cover the stages that exist. But `conditions` is the identity until REU (T4), so no output can differ when it moves, and "every part of it" cannot yet be shown | **Cite PUB-003 when REU gives conditions a meaning.** The claim stands; its prose says which swaps are tested now and which wait                                                        |

## Global constraints

- Test titles cite only what they show (`pnpm trace show <ID>` beside the title), in a literal title:
  an `it.each` title cites nothing.
- Each test is watched fail: a new test before the fix, or, where the code exists, by breaking it.
- No em or en dash in user-facing text.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  prettier and `pnpm trace pins`.

---

## W2.1: The editor

### Task 1: CNT-075, the read-only text set as the editor sets it

**Issue first:** a document's text, read before a component is opened, differs from the same text
once it opens: ligatures (fi, fl) join in one and not the other, runs of spaces collapse in one and
not the other, and the paragraphs sit at different distances.

- Move the editing surface's typographic rules (`font-variant-ligatures: none`,
  `font-feature-settings: 'liga' 0`, `white-space: break-spaces`, the paragraph margins) from
  `packages/editor/style.css`'s `.ProseMirror` into one class both the surface and the read-only text
  (`renderContent`'s container, `DocumentText.module.css`'s `.body`) carry.
- **Test** (`apps/web`): `CNT-075 sets a component's read-only text with the editing surface's own
typography` - the read-only card and the open editor both carry the shared class, and the
  stylesheet gives that class every rule the surface had (read from the CSS, as the colours test
  reads tokens). **Break:** drop the class from the read-only container.
- **Claim** CNT-075 in component-editor.md.

### Task 2: CNT-175, a definition list as one (W2.1b)

**Issue #246:** a screen reader reading a definition list in the editor, or in a document's text,
hears each definition as a plain paragraph in an unlabelled group, not as the definition of its term.

**What the schema does today, and why it cannot be fixed in the rendering alone.** A
`definitionItem` is `term block+` and renders `div > dt + p...`: the body's blocks are the item's own
children, so no `toDOM` can put a `dd` round them, and a node view's one content element cannot split
them from the term. A `dd` needs a node.

**The change.** A new node, `definition`, `content: 'block+'`, `defining`, rendering `dd` and read
back from `dd`; `definitionItem` becomes `term definition`, rendering `div` (HTML admits
`dl > div > dt + dd`). The stored model does not change - an item is `{ term?, content }` and still
is - so nothing is migrated: `mapping.ts` is where the two spellings meet, and gains the one level.

- `mapping.ts`: `definitionListOf` wraps an item's blocks in `definition`; `storedBlock` reads them
  from it; the labels of a failure inside a definition keep their numbers (the body's labels start at
  0 today because the term is skipped - they now start at 0 because the definition is the body).
- `identity.ts`, `state.ts`: `definition`, like `listItem`, is walked through and never named.
- `blocks.ts`: every definition-list command is written against `term block+` - Enter from the term
  into the body, Enter in the body making the next item, Backspace and Delete joining two items,
  leaving the list from an emptied last item, lifting and nesting, the empty-item test, and
  **Definition list** wrapping a paragraph. Each moves one level deeper. Their behaviour does not
  change, and the ~80 existing definition-list tests in `blocks.test.ts`, whose builder gains the
  `definition` node, are the regression suite for it; an expected shape that names the body changes
  with it, and nothing else in an expectation does.
- `style.css`: `.aw-text dd`, set as the body was.
- **Paste needs nothing.** A component pasted into another travels as the product's own type
  (`PRODUCT_CLIPBOARD_TYPE`), not as HTML. `packages/readers` already reads `dl > div > dt + dd` and
  never read the old `div > dt + p` body (it skips a `p` there, measured), so the editor's own HTML,
  read back without the product's type, now keeps its definitions where it did not.
- **Test** (`packages/editor`): `CNT-175 exposes a component's lists, tables and footnotes to
assistive technology as structure` - the view's DOM and `renderContent`'s alike: a list `ul`/`ol`
  of `li`, a definition list `dl` of `dt` and `dd` (each `div` holding exactly one `dt` then one
  `dd`), a table `table` with `caption`, `th` and `td`, a footnote's anchor carrying its note. **Break:**
  the definition rendered as `div`, or the item's blocks outside it.
- **Claim** CNT-175 in component-editor.md. Version 0.74.1, a fix; issue #246 closes.

### Task 3: CNT-074, who may edit and why

**Issue first:** when somebody else holds a component, its notice names them but never says when the
lock is expected to be released, though the service says.

- The editor's notice: "Grace is editing this component, expected back at 14:30." from the lock's
  `expectedRelease`, in the reader's time (W2-B's words decided in the task).
- The texts route (W2-B) answers, per occurrence, `mayEdit` and `lock` (`holder`, `expectedRelease`,
  or null), from the same decision and lock the component route reads; the card shows "Read only",
  or who holds it and until when, and nothing where the reader may edit it now.
- **Tests:** service - `getDocumentTexts` answers each occurrence's permission and lock, and nothing
  of an occurrence the caller may not read; web - `CNT-074 says of the component being edited, and of
every card, whether the reader may edit it now, and when not, why, naming who holds it and when it is
expected back`. **Breaks:** the release time dropped; the card ignoring the lock.
- **Claim** CNT-074 in component-editor.md.

### Task 4: CNT-069's depth

**Issue first:** after a long session, undo stops short of the text the component opened with.

- `history({ depth: Infinity })` (W2-A), with a comment on why unbounded is safe here.
- **Test** (`packages/editor`): 150 separate edits, then 150 undos, reach the opened text. Not cited:
  CNT-069's reload half is W11's. **Break:** the default depth.

---

## W2.2: The API

### Task 5: API-003, the contract held both ways (issue #240)

- Fastify's serialiser for a route refuses a status the route does not declare: answered as the
  service failing (500, `internal`), as a body that breaks its schema already is.
- **Tests:** `http.test.ts` - `API-003 answers a status the contract does not declare as a failure,
sending nothing undeclared`; `app.test.ts` - `API-003 registers exactly the routes the contract
declares`, collected with `onRoute` and compared with `allRoutes` both ways (health and the
  renderer's routes named as the only others). **Breaks:** the undeclared-status guard removed; an
  extra route registered.
- `Fixes #240`.

### Task 6: API-006, the rule behind every refusal

- Every refusal a rule makes carries `rule`: grant refusals, invitation refusals, `lock_held`
  (API-039), `version_precondition` (API-037), `format_unsupported` (PUB-014), `layout_language`,
  `component_type_missing`, `outline_invalid`, `asset_too_large` - each rule's identifier found with
  `pnpm trace search`, and one only where a requirement is the rule.
- **Test** (`apps/service`): `API-006 names what failed and the rule that refused it, for every
refusal a rule makes` - one table over each route's refusal, in one literal test. **Break:** one
  refusal's `rule` dropped.

### Task 7: API-012, callers told to ignore what they do not know

- The OpenAPI document's `info.description` says a caller must ignore a field it does not know, and
  may rely on no field being removed within the API version.
- **Test** (`packages/api-contract`): `API-012 tells callers to ignore fields they do not know, and
publishes every response open`. **Break:** the sentence removed.

### Task 8: API-037, a stale precondition names the version it is at

- Every mutating route on a versioned resource refuses a stale precondition with
  `version_precondition` naming the current version: the outline act, the iteration and the cut, the
  publication request (whose 409 names none today - a contract change, regenerated).
- **Test:** `API-037 refuses every mutation from a stale version, naming the version the resource is
at` - one literal test over each route. **Break:** the publication request's current version
  dropped.
- **Claim** API-037 in service-foundations.md.

### Task 9: API-047, a request identifier on every response

- Every response carries `X-Request-Id`: the caller's own where it sent one that is a plain token of
  at most 128 characters, and a fresh one otherwise; it is the log's `traceId` and the error body's.
- **Test:** `API-047 answers every response with its request identifier, the caller's where given,
and logs it and reports it in an error`. **Breaks:** the header on success only; the caller's
  ignored.
- **Claim** API-047 in service-foundations.md.

---

## W2.3: Publishing and paste

### Task 10: PUB-003's order

**Issue first:** the publish computes what each component contributes to the numbering before it
applies conditions, the order publishing.md says is wrong: a figure a condition removes would still
take a number the day conditions do anything.

- `assemble` runs `conditions` over each occurrence's content before `contributionsOf`
  (assemble.ts:407-408).
- **Tests** (`packages/domain`): one document whose output differs under each adjacent swap of the
  stages that exist - number before references, references before generated matter, generated matter
  before the checks - and a test that contributions are read from what conditions answer (a
  conditions function standing in for REU, where the stage takes one). Uncited (W2-C). **Break:** the
  old order.

### Task 11: CNT-167, Word's footnotes kept on paste

**Issue first:** pasting from Word text that holds footnotes gives the notes' numbers as `[1]` in the
text and the notes as paragraphs at the end, not as footnotes (confirm the exact result first, against
the fixture).

- The HTML reader reads an `mso-footnote-id` anchor as a `footnote` at its place, holding the
  paragraphs of the `mso-element:footnote` whose `id` it names, their marks kept and the back-anchor
  dropped; the footnote list is not read as text. A note that cannot be found, or an anchor in a place
  a footnote may not stand (CNT-129), is reported (CNT-064).
- **Test** (`packages/readers`): `CNT-167 keeps Word's lists, tables, footnotes and emphasis, and
makes a heading a paragraph, naming it` - the measured fixture, extended with a list, a table and a
  heading, through admission, both halves asserted. **Break:** the footnote list read as text.
- **Claim** CNT-167 in content-model.md, and its "Left unclaimed" row goes.

### Task 12: The stale design text

- publishing.md's CNT-054 row: a citation fails as `inline_not_publishable`, not
  `citation_unresolved`.
- publishing.md's "Where the code lives": veraPDF runs in the worker's suite, not its job.
- docs/features.md: the document page shows the text in reading order, each component opening in
  place; "no document view" means no view that renders the document as it will publish. Say it once
  and consistently.

## What the build changed

**W2.1 (PR #249).** CNT-175 moved to W2.1b on Ken's word (above). CNT-075's fix is one exported class,
`TEXT_CLASS`, carrying the surface's typography, which the surface and the read text both wear. The
cards' state is a line beneath the card's head, "You may read this component but not edit it." or
`heldSentence`'s, which the open editor's notices share; the texts route says nothing of an occurrence
the caller may not read. Undo's depth is unbounded.

The final review found the first cut of CNT-075 true of three properties and not of the rest: the
surface's own rules still set its paragraphs' spacing and every block's typography under
`.ProseMirror`, which the read text never wore. Every typographic rule now hangs on `.aw-text`, the
surface keeps only the caret, the selection and the placeholders, and the test reads both
stylesheets and fails on any typography a rule gives the surface alone. The texts route read the
facts and the lock once per component, 564 ms at the p95 on the STR-063 document against a budget of
250; `loadFactsFor` and `readLocks` read them once for the whole document (80 ms), and the budget
test now measures the route. A card also says so where the reader holds the component in another
window, says nothing of a hold whose time has passed, and hears changes when its window is returned
to. The state is decided for every component the caller may read, including an occurrence with no
version to show.

**W2.1b (PR #251).** Built as Task 2 says, with three things the plan did not foresee.
`prosemirror-schema-list`'s sink and lift put and look for a sublist after an item's last child,
which is now the definition, so `sinkDefinitionItem` and a lift beside it are the product's, one level
deeper; a Backspace or Delete join from a term with words leaves the emptied item behind, since a
deletion cannot move a whole `definition`, so the join takes its definition's blocks in a second
deletion; and upstream Backspace and Delete can no longer nest one item in another - nothing may
follow a definition, measured - so the comments saying they do were corrected and the depth guard on
them kept. ADR-0025 named `term block+` as its decision, so ADR-0026 restates it with the new shape
and supersedes it. The mapping refuses an item whose blocks stand outside a definition, by name. The
old `div > dt + p` body was also losing data in the HTML reader - a definition read back from the
editor's HTML came back empty with nothing in the report - which the new shape ends. The final
review found the join from a term reaching into a list that ends the definition above, a defect
since issue #160 and on `main` too (issue #250): it asked the nearest text whether it was a
paragraph, and a list's last line is one. It now asks the item above's own last block. The same
review asked for the nested sink and the lift with siblings after it to be pressed rather than
derived; both now are, each seen to fail under a break. Its re-review found Delete at the end of a nested definition
list's last item stopping at that item, before the guard, and handing the key on to select the item
after; the climb now carries on to the item holding the list, and the test asserts the caret too.

**W2.2 (PR #252).** API-003's undeclared status is held to the one error shape rather than refused
outright: the published contract already declares that shape as every route's `default`, so a
refusal at an unlisted status still reaches the caller and anything else becomes a 500. The routes
are held to the contract's through an `onRoute` callback on the HTTP options. API-006's rules come
from one table beside the wire codes, found with `pnpm trace show`, and a dotted refusal becomes an
error only through `refused()`, which carries it; codes no requirement refuses name none, each
listed. A bytes-over-the-limit refusal shares `asset_too_large` with the pixel bound and names no rule,
since no requirement sets that limit. API-037 needed the store's publication refusal to carry the
current version's heading, never its content (IAM-073), and a release, which cuts, is held to it as
well as a save and a cut. API-047's header had to be written on the event stream's own head, which
bypasses the hook, and the not-found test's byte-for-byte header comparison now leaves the identifier
out, as it does the body's trace id.

## Done when

- CNT-075, CNT-175, CNT-074, API-003, API-006, API-012, API-037, API-047 and CNT-167 Covered; CNT-069
  waiting on W11 and PUB-003 on REU, each saying so.
- Issues #240 and the six filed here closed by their PRs.
- The remainder plan's W2 row reads Built with the three PR numbers.
