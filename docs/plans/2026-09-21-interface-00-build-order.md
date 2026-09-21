# Interface 0: the build order

> **This is an ordering plan, not a task plan.** It says which screen in
> [`docs/interface/`](../interface/README.md) is built first, what each one needs from the service,
> and what has to be decided before it starts. Each numbered slice below gets its own sketch plan,
> written when its turn comes, and lands as its own pull request with its own version bump and
> changelog entry.

**Goal:** `apps/web` looks and behaves like the thirteen screens in `docs/interface/screens/`, built
one screen at a time. It ships in one theme, Light, but is built so a second theme is a new block of
colour values and nothing else.

**What exists today:**

- **No stylesheet.** The renderer is unstyled semantic markup with no stylesheet of its own.
  `packages/editor/style.css` is the only CSS, and it writes four hex values.
- **One routing function.** `Workspace.tsx` handles every route:
  - an empty hash lists components;
  - `#/components/{id}` and `/access`;
  - `#/documents`, `#/documents/{id}`, `#/documents/{id}/nodes/{node}`;
  - `#/publications/{id}`.
- **No shell.** `App.tsx` stacks a heading, the platform line, `Environment` (tenant name, sign-in
  link, the sample panel) and `Workspace`.
- **The service's routes** are the ones in `packages/api-contract`. They have:
  - no search;
  - no list of publications except per document;
  - no delete;
  - no metadata;
  - no reference index;
  - no preview;
  - no facet counts or filters on either list. `GET /v1/components` takes only `cursor` and `limit`.
  - `GET /v1/me` gives `displayName` and `email`, which is enough for the account chip.

## Global constraints

These bind every slice. Each slice's plan repeats them.

1. **`tokens.css` is the only place a colour is written.** A colour is:
   - a hex literal;
   - `rgb()`, `rgba()`, `hsl()` or `hsla()`;
   - a named colour other than `transparent`, `currentColor` or `inherit`.

   A test enforces it (slice 1), in the shape of `apps/web/src/dashes.test.ts`, over every `.css`,
   `.ts` and `.tsx` in `apps/web/src` and `packages/editor`, excluding tokens.css itself.

2. **Keep the existing user-facing strings exactly as they are.** When a drawing and the code
   disagree, the code wins. For example, the drawings' `New component` form labels are `Where` and
   `Component type`, which the code may word differently. The slice records the difference in
   `docs/interface/README.md` under a new heading, _Where the build departs from the drawings_. It
   does not hand-edit the exported HTML (the README forbids that). New strings come from the
   drawings verbatim. `dashes.test.ts` already holds them to ASCII hyphens.
3. **Test first.** Each slice's tests name the requirement they verify.
4. **No colour in a test.** jsdom does no layout, so the suites assert structure, roles, names,
   focus order and strings.
   - Geometry is checked by a screenshot of the running renderer next to the drawing, taken with
     headless Edge the way the drawings' PNGs were. It is attached to the PR.
   - That screenshot is a **proxy**, and the PR says so. The real check is Ken opening it.
5. **One PR per screen** (or per layout where two screens share one). Each carries:
   - one version bump (a screen is a functional enhancement, so Minor+1);
   - one changelog entry;
   - the move the README asks for: the screen's description goes into its subsystem's design in
     `docs/design/`, claiming only the requirements it answers in full.
6. **Accessible as drawn.** Controls are real `<button>`, `<a href>` and `<label>` elements.
   Icon-only buttons carry a `title` and an `aria-label`. F6 order and tabular numerals are as the
   README says. The editor's existing F6 ring and one-tab-stop toolbar are kept, not rebuilt.
7. **Nothing is drawn that the service cannot answer.** A drawn control with no route behind it is
   left out, not faked, until its subsystem exists. That covers:
   - the search field;
   - facet counts;
   - `Delete`, `Where this is used` and `Version history`;
   - `Preview`;
   - the lifecycle lozenges.

## Themes: one now, room for more

The layouts are fixed; colours vary by theme. Slice 1 builds the mechanism with exactly one theme in
it.

- **`apps/web/src/theme/tokens.css` replaces `docs/interface/tokens.css`**, moved in slice 1 with
  the README pointed at the new path, so there is one copy and it is the one the build reads. It has
  two kinds of block:
  - `:root { ... }` holds everything a theme does not change:
    - type, space, radius, stacking, opacity and pane geometry;
    - the `--doc-*` palette, because a publication is the same page whatever the chrome around it.
  - `:root, [data-theme='light'] { ... }` holds every interface colour: ground, text, accent,
    header band, state, modules, publishing state, diffs and shadows. Shadows are in here because
    their colour is a colour, and a dark theme needs different ones.
- **`apps/web/src/theme/themes.ts`** has:
  - `export const THEMES = ['light'] as const` and `type ThemeName`;
  - `applyTheme(name)`, which sets `data-theme` on `<html>` and sets the `<meta name="theme-color">`
    content from the computed `--header-bg`. That removes the two hex literals now in
    `apps/web/index.html`.
- **Two tests hold the room open:**
  - _Parity._ Every theme block in tokens.css defines the same set of colour tokens as `light`. With
    one theme it passes trivially. The day a second block lands, a missing token fails the build
    rather than showing through as the light value.
  - _No stray colour._ Constraint 1.
- **The account chip's `Theme` item is not rendered while `THEMES.length === 1`.** A test pins that
  it appears once there are two. Where the choice is stored (per person, on the service or in the
  browser) is decided in the slice that adds the second theme, not now.
- **Styling mechanism: CSS Modules** (`Foo.module.css` beside `Foo.tsx`). Vite supports them with no
  new dependency. They scope class names per component, so two layouts cannot fight over one. Only
  tokens.css and a short `base.css` (reset, body font, focus ring) are global.
- The Electron shell's `nativeTheme` stays tray-only. Auto (following the OS) is the dark-theme
  slice's work: a `prefers-color-scheme` mapping in tokens.css, not an IPC channel.

## The build order

| #   | Slice                            | Layout      | Needs from the service                                                                                                                                                                                                   | Settle first                         |
| --- | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1   | The shell and the theme          | shell       | Nothing new: `GET /v1/tenant`, `GET /v1/me`, `POST /v1/sign-out`                                                                                                                                                         | Q1, Q2                               |
| 2   | The states kit                   | -           | Nothing                                                                                                                                                                                                                  | A8                                   |
| 3   | Components                       | A           | `GET /v1/components` gains `type`, `language`, `changedAt`, `changedBy` per row, a `total`, and filters by space. Type, language and changed come later, with their counts                                               | A1, A2                               |
| 4   | New component and the row menu   | modal       | Nothing new (spaces, per-space types, create)                                                                                                                                                                            | A1, A7                               |
| 5   | Component editor                 | B           | The space pane: 5's filter by space. The rest exists                                                                                                                                                                     | A3, A4, Q3                           |
| 6   | Access                           | B or page   | Nothing new                                                                                                                                                                                                              | Q3                                   |
| 7   | Documents                        | A           | `GET /v1/documents` gains paging (it has none), `total`, `changedAt`, section and component counts, and a publishing state (published, changed since, never published)                                                   | A8                                   |
| 8   | Document: outline and properties | C, part one | Nothing new: the outline, numbering and contributions exist                                                                                                                                                              | A5, Q4                               |
| 9   | Document: the text in place      | C, part two | Every referenced component's latest version in one call, rather than one request per reference                                                                                                                           | A5                                   |
| 10  | Publications and a publication   | A and D     | A list of publications across the environment, and a way to show the page                                                                                                                                                | Q5                                   |
| 11  | Home                             | cards       | The three totals (from 3, 7 and 10). _Where you left off_ needs a recents route and is left out until one exists                                                                                                         | -                                    |
| 12  | Administration                   | modal       | Only the sections with routes: Environment (`/v1/tenant`), Spaces (`/v1/spaces`), People and invitations (`/v1/principals`, `/v1/invitations`), Roles (`/v1/roles`), About (the version). Groups, types and layouts wait | A1                                   |
| -   | Search                           | A           | The search subsystem                                                                                                                                                                                                     | A2. Not scheduled; built with search |

**Why this order:**

- **1 and 2 first,** because every later slice composes them.
  - _Slice 1:_ tokens, theme, base CSS, the header band, the module switcher, the account chip, the
    four layout frames as empty components (`ListLayout`, `Triptych`, `Reading`, `Modal`) and the
    hash router moved out of `Workspace.tsx`.
  - _Slice 2:_ `Notice` (could not, not yours to change, signed out), `Empty`, `Lozenge`,
    `SaveIndicator`'s dots, `Confirm` and the spinner. Each is restyled from what exists; nothing
    is reworded.
  - Neither is a screen, so neither carries a screen's design move.
- **Components before documents,** because the component screens already have a service to call, and
  the component editor (5) is what the document text (9) puts in place.
- **The document triptych is split in two.** It is the README's "largest single piece of work", and
  the outline half (8) is a restyle of what exists, while the text half (9) is new: many editor views
  on one page, one lock at a time. Shipping 8 first gives layout C its frame, its drag, its collapse
  and its remembered widths without waiting on 9.
- **Publications and Home late,** because both need a route that does not exist. Home also reads the
  totals the three lists add.
- **Administration last** among the scheduled slices, because most of what it draws has nothing
  behind it yet.

## The eight assumptions: which must be settled, and when

| #   | Assumption                        | Blocks | Recommendation                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Four component types              | 3, 4   | **Build from what the service returns.** The type column, the filter and the dialog's select show the environment's types, which today is one: Topic. A filter with one option is not rendered. Nothing assumes four                                                                                                 |
| A2  | Search in every list header       | 3      | **Leave the field out** until search exists. A client-side filter over one loaded page would say "no results" for a component on page two                                                                                                                                                                            |
| A3  | Metadata as the first dock panel  | 5      | **Build the dock frame, and render it only when it has a panel.** Today nothing belongs in it: the list and preformatted panels are drawn inline under the toolbar and stay there, and Access is a page if Q3 goes that way. The first panel that exists (Metadata, from MET's editor slice) brings the rail with it |
| A4  | Where this is used                | 5      | **Leave out** of the dock and the row menu until the reference index exists                                                                                                                                                                                                                                          |
| A5  | A document view (all of layout C) | 8, 9   | **Must be settled before 8.** Confirm the decision the README draws: structure and content on one screen, each component edited in place, one lock at a time under ADR-0023's one view per component. 9 needs its own design pass                                                                                    |
| A6  | Preview beside Publish as PDF     | 8      | **Leave out** until the warm-preview design in `publishing.md` is built                                                                                                                                                                                                                                              |
| A7  | Delete in the row menu            | 4      | **Leave out.** The row menu ships with `Open`, `Copy link` and `Manage access` (the last only where `GET /v1/access` allows it, as today)                                                                                                                                                                            |
| A8  | Lifecycle lozenges                | 2, 7   | **Build only the real ones:** `Published`, `Changed since`, `Never published`, `Not approved`, `Being edited`, `Not yours to read`. The review tranche's six stay drawn and unbuilt                                                                                                                                  |

**Only A5 has to be settled before a line of code, and only before slice 8.** The other seven are
"leave out until it exists" or "build from what the service returns". They need a yes, not a design.

## Five questions the drawings leave open

These are not among the README's eight. Each is a place where the drawings and either the README or
the code disagree.

- **Q1: the root route.** The README puts Home at `#/`; today an empty hash lists components. It has
  to be decided in slice 1.
  - **Recommendation:** until Home exists (slice 11), `#/` shows Components.
  - Slice 11 switches it, and changes the one test that pins the empty hash.
- **Q2: the sample panel.** `Environment.tsx`'s `Make a sample` and its live list are scaffolding
  with no place in the drawings.
  - **Recommendation:** move them into Administration's About section in slice 12. Until then they
    sit below the Components list, unchanged, so no test and no string moves twice.
- **Q3: Access, a page or a dock panel.** The README's route table says `#/components/{id}/access`
  is "B, dock open", but `Access.png` draws a full page with `Back to the component`.
  - **Recommendation:** build it as drawn, a page, and correct the README's table. The page has
    room for the grants, the explanation table and the invitations. A 320px panel does not.
- **Q4: the node route.** The README writes `#/documents/{id}/{node}`, but the code has
  `#/documents/{id}/nodes/{node}` and links of that shape have been copied.
  - **Recommendation:** keep the code's form and correct the README.
- **Q5: what layout D shows as "the page".** `Publication.png` draws the publication's text on the
  doc canvas. What exists is a PDF in object storage.
  - **Options:** render the stored PDF in the page (pdf.js is already a worker test dependency), or
    publish an HTML rendition beside the PDF.
  - **Recommendation:** render the stored PDF with pdf.js. It shows exactly what was published,
    which is the point of the screen, and needs no second output.
  - Decide before slice 10 is planned.

## What each slice's plan must carry

Each slice gets a sketch plan in the manner of editor 5:

- paths, component names and signatures;
- test titles with the requirement each cites (from `pnpm trace area CNT|STR|PUB|IAM`);
- the exact strings, each marked _existing_ or _new from the drawing_;
- the service change, if any, as its own first task, test first against `packages/db`;
- the design-document move and the claims it makes.

It also carries the seam no task owns in that slice, named for the final review to drive, for
example the save path through a restyled header.
