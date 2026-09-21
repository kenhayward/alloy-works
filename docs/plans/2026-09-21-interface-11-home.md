# Interface 11: Home

> **A sketch, by request**, built inline and test first. It is slice 11 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** `#/` is Home (`Home.png`): a greeting, then three module cards over the dark backdrop.

- Each card holds its description, what can be done there today, and its total from the lists
  slices 3, 7 and 10 built.
- The components list moves to `#/components`, as the README's route table has it.

**Requirements:** none claimed.

## Rulings

- **Q1 comes due:** `#/` (and the empty hash) is Home, and `#/components` is the components list.
  - Every link that meant the list moves to `#/components`: the module switcher, the workspace nav
    and `Back to components`.
  - The workspace tests that open the list at the empty hash open it at `#/components`, in one
    `beforeEach`.
- **What each card says it can do is what can be done today.** Of the drawing's bullets, those for
  things not built are left out: "Fill in metadata and see where it is used" and "Number sections,
  figures and tables" (figures and tables cannot be written yet). The drawing's words are kept for
  the rest.
- **Totals from the lists:**
  - components from `GET /v1/components?limit=1`'s `total`;
  - documents and publications counted from their unpaged lists.

  A total that could not be read is left off its card, not guessed.

- **No "Where you left off"**, since no route answers it (build order).
- **The greeting** is `Welcome back, {first word of the name}`, from `/v1/me`, and `Welcome back`
  where there is no name. The line under it is the environment's name.
- **Home names no module:** the header band shows the product alone there, and `moduleOf` answers
  `null` for it.
- **The scaffolding's environment panel** (Q2) moves with the landing page: it stays under Home
  until Administration (slice 12) takes it.

## Tasks

1. **`moduleOf`** answers `null` for `''`, `#` and `#/`. **`Header`** hides the hairline and the
   module name for `null`. Tests are adjusted.
2. **`home/Home.tsx`** and its module: the greeting and the three cards, each a link to its module's
   list. Tests in `Home.test.tsx`:
   - `greets the reader and offers each module with what can be done there and how many there are`;
   - `leaves a total off its card when it could not be read`.
3. **`Workspace`** routes Home and `#/components`, and the links move. **`App`** shows the
   environment panel under Home.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean.
- `trace.json` is regenerated last.
- Home has been looked at in the running renderer. That view is a proxy.
