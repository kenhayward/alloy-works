# Interface 1: the shell and the theme

> **A sketch, by request**: paths, names, strings and test titles, no implementation. Built inline,
> test first, and aimed at a working first draft Ken refines by looking at it. Slice 1 of
> [the build order](2026-09-21-interface-00-build-order.md), whose global constraints bind it.

**Goal:** every screen in `apps/web` sits under the dark header band, in the Light theme, with the
interface's type, colour and controls, without a single existing string reworded.

**Requirements:** none is claimed. The corpus has no requirement for the shell, the theme or sign
out (`pnpm trace search theme`, `sign out`, `contrast` find only publishing and style rows), so the
tests below cite nothing and no design document takes a claim.

## Rulings taken from the build order

- **Q1:** `#/` and the empty hash still list components, until Home.
- **Q2:** the environment panel (`Make a sample` and its list) and the platform line sit under the
  Components list only, unchanged.
- **The four layout frames are not built here.** Each arrives with the first screen that uses it
  (List with slice 3, B with 5, C with 8, D with 10), because an empty frame has nothing to test.
- **The hash router stays in `Workspace.tsx`.** The shell reads the hash only to name the module.
- **`index.html` keeps its two `theme-color` metas.** The browser reads them before any stylesheet,
  where `var()` means nothing, and `icons.test.ts` pins them. The colour test scans `src/`, not the
  page.

## Tasks

1. **Tokens and themes.**
   - `git mv docs/interface/tokens.css apps/web/src/theme/tokens.css`. Split it into:
     - `:root`, which holds what no theme changes (type, space, radius, stacking, opacity, geometry,
       `--doc-*`);
     - `:root, [data-theme='light']`, which holds every interface colour and the shadows.
   - Point `docs/interface/README.md` at the new path.
   - `theme/themes.ts`: `THEMES = ['light'] as const`, `ThemeName`,
     `applyTheme(name, root = document.documentElement)` setting `data-theme`.
   - `main.tsx` calls `applyTheme('light')` and imports `tokens.css`, then `base.css`.
   - `theme/colours.test.ts`:
     - `finds a colour written in CSS or in a string, and ignores one in a comment` (the scanner on
       inline samples);
     - `writes no colour outside tokens.css` (every `.css`/`.ts`/`.tsx` in `apps/web/src` and
       `packages/editor`, tests excluded);
     - `every theme defines the same colour tokens as light`;
     - `applies a theme as data-theme on the root element`.
   - The four hex values in `packages/editor/style.css` become `var(--accent)`, `var(--muted)` and
     `var(--chip-bg)`.
2. **Base styles.** `theme/base.css`, global and on elements only:
   - body ground, face and size;
   - headings at the token sizes;
   - links;
   - buttons as the secondary control, and `[aria-pressed='true']` on `--accent-weak`;
   - inputs, selects and textareas on `--input-border`, with the `--ring` focus ring;
   - tables with 13px rows and `--border` rules;
   - lists and `dl`;
   - `[role='alert']` with the `--danger` edge;
   - `:focus-visible`;
   - tabular numerals on `time` and `td`.

   A class opts in to the primary button: `.primary`, in base.css. Nothing is tested. The PR's
   screenshots are the check, and they are a proxy.

3. **The header band.**
   - `shell/moduleOf.ts`: `moduleOf(hash): 'Components' | 'Documents' | 'Publications'`. Its tests:
     - `names Components for the empty hash, #/ and a component`;
     - `names Documents for the list, a document and a part`;
     - `names Publications for a publication`.
   - `shell/Header.tsx` and `Header.module.css`, a `<header>` 44px high on `--header-bg`. It holds:
     - the mark (`mark-dark.svg`) with `Alloy Works`, a button that opens the module switcher,
       which links to `Components` (`#/`) and `Documents` (`#/documents`); Publications has no list
       until slice 10;
     - a hairline, then the module name;
     - pushed right, the environment's name from `GET /v1/tenant`;
     - the account chip: initials and the name from `GET /v1/me`, a button opening a menu that
       holds `Sign out` (`POST /v1/sign-out`, then the page reloads);
     - signed out, `Sign in` (`/v1/sign-in/organisation`) in the chip's place;
     - `Theme`, which is not rendered while `THEMES.length === 1`, and Administration, which waits
       for slice 12.

     Escape closes either menu and returns focus to its button. `Header.test.tsx`:
     - `shows the product, the module, the environment and who is signed in`;
     - `offers Sign in when nobody is signed in`;
     - `signs out from the account chip`;
     - `switches module from the mark`;
     - `closes a menu on Escape, returning focus to its button`;
     - `offers no Theme while there is one theme`;
     - `takes initials from the name, or the address when there is none`.
4. **The page.**
   - `App.tsx` renders the header band, then `<main>` holding the workspace. On the components
     list only, the environment panel and the platform line follow it.
   - `App.module.css` pads the page 4px under the band with the `--space-24` gutter.
   - `App.test.tsx` changes where the page's structure changed:
     - the product name is in the banner, not an `h1`;
     - the environment panel shows on the list and not on a document.

## Done when

- `pnpm lint`, `pnpm typecheck` and `pnpm test` are clean, and the console gate is quiet.
- There is a screenshot of the components list and of a component open in the running stack.
  Ken's own look is the real check.
