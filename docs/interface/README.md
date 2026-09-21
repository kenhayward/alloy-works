# Interface

How Alloy Works looks and how its screens are put together: the shell, the four layouts every
screen is one of, the routes, the words, and the states. It is the visual half of
[`../design/`](../design/) - `structure.md` says what a document outline _is_, this says what it
looks like and what a person does to it.

> **Not true yet.** Nothing in `apps/web` looks like this today; the renderer is unstyled markup
> ([`../features.md`](../features.md) is the honest account). This document and the screens beside
> it are the target, drawn before the work so that thirteen screens agree with each other rather
> than converging by accident.

## Why this is not in `docs/design/`

Because a design document there **claims requirements**, and this one cannot yet.
`packages/trace/src/design.test.ts` requires every document in that folder to own at least one
requirement, and rightly: a design that claims nothing is a design nobody can hold to anything. The
presentation requirements in CNT, STR, PUB and IAM have not been read against these screens one by
one, and claiming a requirement a design only partly answers is the single failure that whole
apparatus exists to prevent.

So this folder is the visual specification, and it is **meant to be dismantled**. As each subsystem
is built, the screen belonging to it moves into that subsystem's design document in `docs/design/`,
claiming the requirements it answers in full - the component editor's screens into
`component-editor.md`, the outline and document view into `structure.md`, publishing into
`publishing.md`, access into `access.md`. What is left here at the end should be the shell, the
tokens and the layouts: the things no single subsystem owns. Work through
`pnpm trace area CNT`, `STR`, `PUB` and `IAM` when the time comes; the claims are the point of the
move, not paperwork around it.

## The evidence beside this document

`docs/interface/screens/` holds one rendered screen per file:

| File                | Screen                                            |
| ------------------- | ------------------------------------------------- |
| `Main`              | The structure map: shell, layouts, routes, tokens |
| `Home`              | Module cards over the backdrop                    |
| `Components`        | The components list                               |
| `NewComponent`      | New component, over the list, and the row menu    |
| `ComponentEditor`   | A component open in the triptych                  |
| `Documents`         | The documents list                                |
| `DocumentOutline`   | A document: outline left, its text in the middle  |
| `DocumentCollapsed` | The same, both side panes collapsed               |
| `Publication`       | A publication, read                               |
| `Access`            | Manage access to a component                      |
| `Administration`    | The Administration modal                          |
| `Search`            | Search results                                    |
| `States`            | Saving, empty, refused, conflict, lozenges        |

Each is a `.html` file and a `.png` of it at its own size. The HTML is self-contained: no
stylesheet, no script, no network, no fonts to fetch. Open it in a browser and read the exact
paddings, sizes and colours off the elements rather than measuring the picture. The PNG is there so
a reviewer, an issue or a pull request can show the screen without running anything. Each PNG is
drawn from its HTML by a headless browser at the size named above, so its typeface is whatever
sans-serif that machine's system supplies; where the two differ, the HTML is the one to trust.

**They are drawings, not code.** They carry literal hex values because they were drawn in a design
canvas, which has no variables. Nothing in them should be pasted into the renderer as-is: build
from `tokens.css` and take the geometry from the drawing.

## Light only, for now

`docs/interface/tokens.css` is the whole palette as custom properties, light theme.

The design system these screens come from carries a dark value for every colour token, and the
intention is Light, Dark and Auto, chosen by the person and applied as `data-theme` on `<html>`.
That is a later pass. It costs almost nothing **provided nothing outside `tokens.css` ever writes a
colour**: the day dark mode is built, this file gains a `[data-theme="dark"]` block and a
`prefers-color-scheme` mapping, and no component changes. A single hard-coded hex in a component is
the thing that makes it expensive, so treat one as a bug.

Two consequences worth stating now, because they look like mistakes later:

- **The header band is dark in both themes.** It is not the dark theme leaking; it is the product's
  one constant. `--header-bg`, `--header-text`, `--header-btn-border` exist for it alone.
- **The document palette is separate.** `--doc-*` describes a rendered publication - the page, the
  navy Word headings, the grey desk behind it - and must never be used for interface chrome, nor
  the interface palette for a publication. They are two vocabularies sharing a window.

## The shell

A 44px header band across the top, then a row of panes filling the rest of the viewport.

In the band, left to right: the mark, which is the module switcher; a hairline; the current module's
name at 70% opacity; then, pushed right, the environment name and the account chip. The account chip
holds Administration, Theme and Sign out. Module pages sit 4px under the band.

**Three modules**, each with a colour used only on its Home card, its switcher dot and inside
itself: Components (`--module-components`), Documents (`--module-documents`), Publications
(`--module-publications`).

**Administration is not a module.** It is a modal from the account chip - environment, spaces,
people and invitations, roles, groups, component types, layouts, about and release notes. New
component, New document, Give access and the removal confirmations are modals too. A modal is never
a route: it opens over the screen that asked for it, 40px from the top, and Escape closes it.

## The four layouts

Every screen is one of these. Widths are exact; anything not stated is
`--space-*` from `tokens.css`.

**A. List.** A 240px filter pane on `--surface-2`, collapsing to a 40px rail with a vertical label,
then the list at nearly full width with a 14px gutter. Above the list: the page title, a search
field, and one primary button. Below it: `Show more`, never a pager. Rows are 13px, separated by
1px `--border` rules, hovered with `--accent-weak`, selected with `--accent-weak` plus a 3px
`--accent` left edge. Components, Documents, Publications and Search results are all this.

**B. Editor triptych.** A 260px space pane (the components of the space you are in, the open one
marked), the editor, and the facet dock: a 38px icon rail plus a 320px panel, one panel at a time.
The editor is a header strip (title, version, type, language, direction, save state, `Done editing`,
`Save version`), the Formatting toolbar, the surface, and a status strip.

**C. Document triptych.** The same shape: a 300px outline pane, draggable between 220 and 520 and
collapsing to a 46px rail; the document's own text in the middle, each component edited in place
under its section number; the same facet dock on the right. **Structure and content are one screen,
never two.** The panes' widths and collapsed state are remembered per person.

**D. Reading.** A 260px contents pane, then the publication on `--doc-canvas` with the page in
`--doc-page`, and a 320px pane saying what it was made from. Nothing here is editable, ever.

## Routes

Hash routes, kept as `apps/web/src/editor/Workspace.tsx` already has them, because the Electron
shell loads the renderer over `file://` and a path route breaks there.

| Route                      | Screen                     | Layout        |
| -------------------------- | -------------------------- | ------------- |
| `#/`                       | Home                       | Module cards  |
| `#/components`             | Components                 | A             |
| `#/components/{id}`        | Component editor           | B             |
| `#/components/{id}/access` | Access to a component      | B, dock open  |
| `#/documents`              | Documents                  | A             |
| `#/documents/{id}`         | Document: outline and text | C             |
| `#/documents/{id}/{node}`  | The same, at that part     | C             |
| `#/publications`           | Publications               | A             |
| `#/publications/{id}`      | A publication              | D             |
| `#/search?q=`              | Search results             | A             |
| `#/sign-in`                | Sign in                    | Frosted panel |

Every outline node has a link, shown with `Copy link` beside the chosen node, and choosing a node
rewrites the address with `history.replaceState` so arrow-keying through a tree does not fill the
back button.

## The words

The product's existing strings are the vocabulary. They were written carefully, they are cited by
tests, and a redesign is not a licence to reword them. `There are no components you may read.`
stays exactly that.

- **Sentence case** for buttons, menu items, labels and messages. Title Case for module and product
  names: Alloy Works, Components, Documents, Publications, Administration.
- **Plain hyphens, straight quotes, ASCII only**, in every user-facing string - the repository
  already enforces this in `apps/web/src/dashes.test.ts`.
- **Say what happened and what to do.** `The components could not be loaded.` with `Try again`.
  Never an error code, never blame.
- **Signed out is not an error.** It says `You are signed out. Sign in again to see your documents.`
  and offers no `Try again`, because trying again cannot help.
- **Domain words are exact**: component, document, outline, section, component reference, front
  matter, body, appendix, matter, space, environment, version, publication, layout. A component is
  never a "topic" unless it is of the type named Topic.

## States

`States.html` draws all of these; the wording there is the wording to ship.

- **Saving**: `Saved at 14:02`, `Saving`, `Not saved, retrying`, `Not saved`, `No unsaved changes`,
  each with its own dot colour. An unsaved component shows a `--warn` dot beside its name in the
  outline and the space pane.
- **Empty**: the sentence, plus the one action that would fill it. Never an illustration.
- **Could not**: `--danger` edge, the sentence, `Try again`.
- **Not yours to change**: read-only, refused, withdrawn and being-edited each have their own
  sentence and their own colour, and they are not interchangeable.
- **Conflict**: a document refuses the change and shows what is there now, because nobody locks a
  document. A component is the opposite: the first change starts editing and holds it.
- **Refused publish**: every reason at once, each at its place in the outline, with the product's
  own failures kept separate from the ones in the document.

## Accessible as drawn

Not a later pass. The screens are drawn with real elements and the build should keep them:

- `<button>`, `<a href>`, `<input>` with a `<label>`. Never a `div` with `role` and a click handler.
- Every icon-only button carries a `title` and an `aria-label`.
- The Formatting toolbar is one tab stop with arrow keys along it, `aria-pressed` on the toggles.
  The outline tree is one tab stop with arrow keys, `Alt` and the arrows to move a node.
- `F6` and `Shift-F6` move between the header, the toolbar, the list panel and the text.
- Text at 4.5:1 against what is behind it, 3:1 from 24px.
- Version numbers, counters and section numbers use `font-variant-numeric: tabular-nums`.

## What is assumed, and not yet real

Drawn on the screens, ahead of the code. Each is cheap to remove and expensive to discover late:

1. **Four component types** (Topic, Concept, Task, Reference). The product has one, named Topic, and
   nothing makes another.
2. **Search**, in the header of each list and as its own screen. Designed, not built.
3. **Metadata** as the first facet-dock panel: audience, product, applies-from-release, keywords.
4. **Where this is used**, from the reference index.
5. **A document view** - the whole of layout C. `features.md` says plainly that there is none today;
   this is the largest single piece of work on these screens.
6. **Preview** beside `Publish as PDF`, per the warm-preview design in `publishing.md`.
7. **Delete**, in the row menu. Nothing deletes anything yet.
8. **Lifecycle lozenges** (Draft, In review, In approval, Approved, Superseded, Archived) are drawn
   on `States` but reserved for the review and approval tranche. Today the only real publishing
   states are Published, Changed since, Never published, and every publication says **not approved**.

## Building from this

- Take colour, type, space, radius, shadow and pane geometry from `tokens.css`. Take layout from the
  HTML. Take wording from the screens and from the strings already in `apps/web`.
- A screen is not done because it resembles the picture. It is done when its test names the
  requirement it verifies, `pnpm lint`, `pnpm typecheck` and `pnpm test` are clean, and the console
  gate has nothing to say.
- One PR per screen, or per layout where two screens share one. Each carries its version bump and
  its changelog entry, as `CLAUDE.md` requires.
- When a screen here turns out to be wrong - and some will - change this document and the drawing in
  the same PR that changes the code, so the three never disagree.

## How these files were made, and how to remake them

The screens were drawn in a design canvas outside the repository, in the Protocol Authoring design
system, and exported here as self-contained HTML. The PNGs are 1:1 screenshots of that HTML at each
screen's own size, taken headless.

The canvas is the working surface; **this folder is the record**. If a screen changes, export it
again and replace both files rather than editing the HTML by hand - an edited export and the canvas
drift apart silently, and then nobody knows which one the build followed.
