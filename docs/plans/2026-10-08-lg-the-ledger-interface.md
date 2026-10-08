# LG: The Ledger interface

> Building [the Ledger handoff](../interface/handoffs/ledger/README.md) under
> [ADR-0046](../decisions/0046-the-ledger-interface.md). **Full tier, several PRs**: an ordering
> plan, as [Interface 0](2026-09-21-interface-00-build-order.md) was. Each PR below gets a few lines
> in its own body, or a sketch plan here where it crosses the shell's process boundary (LG2, LG4).
> Ken's review of this plan is its pre-flight.

**Goal:** every screen in the rail, the theme-aware header and the new scales, in Light, Dark and
Auto, with no string reworded and no requirement that passes today failing.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                       | Beat                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| LG-A | **Every token today has a value in both themes.** The handoff names 23; `tokens.css` has about thirty more (`--surface-2`, `--input-border`, `--ring`, `--chip-bg`, `--concept-*`, `--overlay`, `--state-*`, `--status-*`, `--diff-*`, `--mark-*`, `--shadow-*`). LG2 maps each onto a Ledger token where one means the same, gives the rest a dark value meeting the handoff's 5.2:1, and drops `--header-*` and `--module-*` | Leaving them light in Dark, which axe would catch one screen at a time |
| LG-B | **The theme is remembered per device**, in `localStorage`, as the panes' widths are, and applied before the first render so Dark never flashes Light. Auto is the default                                                                                                                                                                                                                                                      | A stored preference on the service: a new contract for one word        |
| LG-C | **The desktop window follows**: `shell.ts` picks the window's background from `nativeTheme` before the renderer loads; the renderer tells the shell nothing                                                                                                                                                                                                                                                                    | A `PlatformBridge` call, a new IPC handler to validate                 |
| LG-D | **The Theme choice is the header's icon button**, a menu of Light, Dark and Auto; the account chip loses Theme                                                                                                                                                                                                                                                                                                                 | Two places to choose one thing                                         |
| LG-E | **Plex is the chrome's face only.** `--sans` and `--mono` become Plex; the editing surface and the document text keep the theme's typefaces (CNT-097, STY-036). The woff2 files sit in `packages/fonts` apart from the publishing faces, outside its coverage and the theme catalogue                                                                                                                                          | A component's text in Plex, which is not what publishes                |
| LG-F | **Old scale names alias the new** (`--size-page-title` to 20px, `--space-14` to 16px and so on) in LG2, so no screen moves until its own PR, which then writes only the new names. The last screen PR deletes the aliases                                                                                                                                                                                                      | One PR restyling every screen at once                                  |
| LG-G | **Ctrl K starts as navigation**: modules and the commands that open a modal (New component, New document). Searching content waits for the search subsystem                                                                                                                                                                                                                                                                    | A search box that finds nothing                                        |
| LG-H | **Drawn ahead comes off** unless a requirement exists by the time its screen PR starts. The handoff's list misses some: sorting, facets beyond space, bulk selection on the components list, Used in (where-used), Compare (CNT-111, Specified), and a page pager on the publication (the browser's viewer today)                                                                                                              | Building to a picture                                                  |
| LG-I | **What is built and not drawn stays**: the document's reading and authoring modes (CNT-156), Preview (CNT-150, PUB-005), the paste report (CNT-063), the API tokens modal (ADR-0028)                                                                                                                                                                                                                                           | Losing a covered requirement to a redesign                             |

## The PRs

| #    | PR                                                                                                                                                                                                | Cites, in literal titles                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| LG1  | This plan, ADR-0046, `docs/interface/README.md` pointing at the handoff                                                                                                                           | Nothing                                           |
| LG2  | Tokens (LG-A, LG-F), `THEMES` gains Dark, Auto, the Theme menu (LG-D), the choice remembered (LG-B), the window's background (LG-C); `colours.test.ts` holds the blocks equal; axe in both themes | CNT-176 (axe over the editor in Dark)             |
| LG3  | Plex in `packages/fonts` (LG-E): woff2, OFL texts, a test that every face loads from a local path and none from the network                                                                       | Nothing                                           |
| LG4  | The shell: rail, header, status bar, Ctrl K (LG-G), Home. F6 order becomes header, rail, panes, text                                                                                              | CNT-077 for the rail and Ctrl K by keyboard alone |
| LG5  | Shared parts: button, icon button, grouped toolbar (one tab stop, arrows, `aria-pressed`), panel tabs, chips                                                                                      | CNT-164 for the grouped Formatting toolbar        |
| LG6a | Components list, the chosen row in a side panel                                                                                                                                                   | As each screen's tests do today                   |
| LG6b | Component editor: Attributes, Versions, Access in words                                                                                                                                           | CNT-068, CNT-074, CNT-162 kept                    |
| LG6c | Document: outline, text, Part, Used in, History, Checks                                                                                                                                           | STR-006, STR-036, STR-045, IAM-073, CNT-156 kept  |
| LG6d | Publication, layout D                                                                                                                                                                             | PUB-048, PUB-093, PUB-080 kept                    |
| LG6e | Connections and Query definitions                                                                                                                                                                 | As today                                          |
| LG6f | Administration; the aliases (LG-F) deleted; the close                                                                                                                                             | Nothing new                                       |

Each screen PR snaps the drawing's stray 6 and 10px radii to the scale, keeps every string, and
checks its screen at 1280x800 as well as 1440x900: the rail and two panels take about 500px, and
CNT-115 sets the text at the layout's measure scaled to what is left.

## Requirements this must keep

Read from `pnpm trace area CNT`, `STR`, `PUB`, `IAM`. None is newly claimed: the interface claims
nothing ([`../interface/README.md`](../interface/README.md#why-this-is-not-in-docsdesign)), and the
designs that own these keep them.

- **Accessibility**: CNT-077 keyboard alone, CNT-078 WCAG 2.2 AA (Designed), CNT-175 structure to
  assistive technology, CNT-176 axe in CI, CNT-177 the manual audit, now over two themes.
  CNT-138 (Specified) is not claimed: state dots are colour alone today, and stay so.
- **What the view must show**: CNT-068 saved state, CNT-074 which component and why not, CNT-162
  version and pinned or floating, STR-036 numbering as published, IAM-073 no number revealing
  unreadable content (the drawing numbers an unreadable reference 4.3; LG6c checks that is the
  outline's own number and nothing a component moved).
- **Budgets**: CNT-180 and STR-073 run unchanged after LG4 and LG6c; the rail must not cost them.
- **Publishing's surface**: PUB-005 preview says unapproved, PUB-048 who published and when,
  PUB-093 not approved, PUB-080 the untagged preview said to assistive technology.

## Verification

- Per PR: the affected suites, `typecheck`, `lint`, `format`, `trace check`; the browser suite's
  axe in both themes from LG2 on; screenshots of the screen in both themes beside its drawing.
- **Each review drives**: Dark set before load, Auto flipped while open, Electron's first paint, the
  screen at 1280 wide, every panel by keyboard, the console gate silent.

## Questions for Ken

1. **LG-B**: per device (recommended), or per account across devices, which needs a stored
   preference and a route?
2. **The five stray hexes** the handoff's step 2 names: a search of `apps` and `packages` finds none
   outside `tokens.css` (`colours.test.ts` already refuses them) but the service's API docs page.
   Which five did you mean?
3. **LG-H**: confirm the additions to the drawn-ahead list come off rather than get requirements now.
