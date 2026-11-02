# Handoff: the authoring page, one header and one side dock

The document authoring page loses about 300px of chrome above the sheet (31% of a 957px window) to
five stacked rows: the app header, the document bar, the lifecycle actions, the formatting toolbar
and the paragraph style row. This handoff folds them into **one 56px header with a menu bar**, a
**side dock** on the desk, and **style labels in the sheet's margin**. The module rail becomes
**icons with instant names**. Drawn in the design canvas on 2 November 2026; option C2 was chosen
from five (A: one header and one tool row; B: floating toolbar and selection bubble; C: tool strip
without menus; D: tabbed ribbon).

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML. Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at
1600x900 (2x). 1600 rather than 1440 because Contents open plus the sheet at 75% needs it; at 1440
the desk scrolls sideways, as [`../canvas/`](../canvas/README.md) decision 8 already accepts.

Delivered as a zip; it lives in `docs/interface/handoffs/authoring-page/`.

## Screens

| Files                   | Screen                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `authoring-*`           | A document in Authoring, Contents open in the dock, style labels shown |
| `authoring-collapsed-*` | The same with the dock's panel closed: the most document               |
| `menu-format-*`         | Format open, its Paragraph style submenu open                          |
| `menu-document-*`       | Document open: lifecycle, versions, properties, hold, archive, delete  |
| `menu-view-*`           | View open: modes, panels and display toggles as checked items          |
| `menu-insert-*`         | Insert open                                                            |
| `tooltip-rail-*`        | The module rail with the pointer on Documents                          |
| `tooltip-dock-*`        | The dock with the pointer on Bold                                      |

Edit, Review and Help are not drawn; their items are in **Menus and shortcuts** below.

## Decisions to record (two ADRs: the layout, and the shortcut registry)

1. **The module rail is icons only**, 56px (was about 78px). Each entry is an icon link with its
   name as accessible name. Its name shows **instantly** (no delay) on hover and on focus, in a
   tooltip to its right with the go-to keys (`G` then a letter). The current entry has
   `--accent-weak`, `--accent-text` and a 3px `--accent` bar on the rail's edge. Groups keep their
   dividers; Connectors and Settings sit at the bottom. The environment ("Development") becomes a
   small `DEV` chip under the logo, with the full name as its tooltip.
2. **One header, 56px**, replaces the app header, document bar, actions row, toolbar and style row.
   - Left, two lines: the breadcrumb, title and version; under them the **menu bar**.
   - Right: the **lifecycle** (decision 6), **Search** (an icon with `Ctrl K`), the **mode switch**
     (Reading and Review as icons, Authoring with its word), **Preview**, and the account button.
   - Theme and language move into the account menu. Manage access, Dates, Effective for,
     Relationships, Place a hold, Archive and Delete move into the Document menu. Show boundaries and
     Pages as you edit move into View.
   - This supersedes the canvas handoff's document bar (its decision 4). Its sheet and desk stand.
3. **The menu bar is drawn by the renderer**, not by Electron, so a tab and a window are the same
   (the renderer never branches on delivery). It follows the WAI-ARIA menubar pattern: `F10` or
   `Alt` focuses it; arrows move; `Enter`, `Space` and `Down` open; `Esc` closes and returns focus;
   once one menu is open, pointing at another opens it. Each name underlines its access letter
   (`Alt+D`, `E`, `V`, `I`, `F`, `R`, `H`). Each item shows an icon, its words and its shortcut,
   right-aligned in mono. Toggles are `menuitemcheckbox` with a tick; paragraph styles are
   `menuitemradio`; a submenu has a chevron. An item that cannot apply is `aria-disabled`, not
   hidden.
4. **One shortcut registry** feeds the menus, the tooltips, `aria-keyshortcuts` and Help ›
   Keyboard shortcuts, so they cannot disagree. A command is registered once with its words, icon,
   keys and enablement; menus and dock buttons are views of it.
5. **The side dock** floats on the desk at its left, 12px in, full height. It **combines the outline
   pane's rail with the toolbar**, so there are two verticals (module rail, dock), not three:
   - top: **Contents** and **Baselines**, toggles (`aria-pressed`);
   - a stronger divider;
   - the frequent tools: Paragraph style (`¶`), Bold, Italic, Underline, More text formatting (`Aa`),
     Link, Mark as term, Bulleted list, Numbered list, Insert (`+`), Comment.
   A small corner mark means the button opens a flyout. Names and keys show **instantly** on hover
   and focus, as on the rail. An open panel **extends the dock** by 264px (the same surface, a 1px
   rule between them), and the sheet stays centred in what is left (canvas decision 6). The panel
   keeps the outline pane's content; only its frame changes.
6. **The lifecycle in the header**: the document's states as a stepper, the current one in `--warn`
   with a filled dot, the rest muted, and the next action as the one primary button ("Submit for
   review"). The drawn states are placeholders: use the domain's states and the action the user may
   take, and none when there is none.
7. **Style labels in the margin**: each block's paragraph style shows in the sheet's left margin, in
   10px mono `--muted` on the paper. The current block's label is a button (`Body ▾`) that opens the
   style list. They replace the Paragraph style select, live inside `--sheet-margin`, scale with
   zoom and **do not change the measure** (STY-080). View › Style labels in the margin turns them
   off. Long names get an ellipsis and the full name as tooltip.
8. **The status bar** gains the language and direction chips (`und`, `LTR`) from the toolbar. Saved,
   the counts, the version and zoom stay where the canvas handoff put them.
9. **The right-hand panel does not change.**
10. **Light and dark** follow the user's theme. Tokens only; the paper stays paper.

## Menus and shortcuts

`Ctrl` is `Cmd` and `Alt` is `Option` on macOS. Blank means no shortcut. **Check every one** before
the registry is written (see Open questions).

| Menu     | Items (shortcut)                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document | Submit for review (Ctrl Shift Enter), Preview (Ctrl Alt P) / Save a version (Ctrl S), History (Ctrl Alt H), Compare versions / Dates, Effective for, Relationships, Manage access / Place a hold, Archive / Delete (`--danger`)                                                                                                                                                                                         |
| Edit     | Undo (Ctrl Z), Redo (Ctrl Y) / Cut (Ctrl X), Copy (Ctrl C), Paste (Ctrl V), Paste as plain text (Ctrl Shift V) / Find (Ctrl F), Find and replace (Ctrl H) / Search or run a command (Ctrl K)                                                                                                                                                                                                                           |
| View     | Reading (Ctrl Shift 1), Review (Ctrl Shift 2), Authoring (Ctrl Shift 3) / Contents (Ctrl Alt C), Baselines (Ctrl Alt B), Assistant (Ctrl J) / Show boundaries (Ctrl Shift B), Style labels in the margin (Ctrl Shift L), Pages as you edit / Zoom in (Ctrl Alt =), Zoom out (Ctrl Alt -), Fit to width / Focus (F11)                                                                                                   |
| Insert   | Table (Ctrl Alt T), Figure (Ctrl Alt F), Image (Ctrl Alt I), Caption / Equation (Ctrl Alt E), Footnote (Ctrl Alt N), Cross-reference (Ctrl Alt R), Variable (Ctrl Alt V), Symbol / Link (Ctrl Alt K), Comment (Ctrl Alt M)                                                                                                                                                                                              |
| Format   | Bold (Ctrl B), Italic (Ctrl I), Underline (Ctrl U), Subscript (Ctrl =), Superscript (Ctrl Shift =), Code (Ctrl \`), Quotation / Paragraph style ▸ [Body (default) (Ctrl Alt 0), Title, Heading 1 to 3 (Ctrl Alt 1 to 3), Definition, Caption / Manage styles], Bulleted list (Ctrl Shift 8), Numbered list (Ctrl Shift 7), Increase indent (Tab), Decrease indent (Shift Tab) / Mark as term (Ctrl Alt G), Language ▸, Direction ▸ / Clear formatting (Ctrl \\) |
| Review   | Comment (Ctrl Alt M), Check document (Ctrl Alt X) / History (Ctrl Alt H), Compare versions / Ask the assistant (Ctrl J)                                                                                                                                                                                                                                                                                                |
| Help     | Keyboard shortcuts (Ctrl /), Documentation, What is new                                                                                                                                                                                                                                                                                                                                                                 |

`/` separates groups. The paragraph styles listed are the drawing's; the submenu lists the
document's theme's styles. Rail go-to keys: Home `G H`, Components `G C`, Documents `G D`, Templates
`G T`, Prompts `G P`, Bibliography `G B`, Terms `G E`, Images `G I`, Conversations `G V`,
Publications `G U`; not while focus is in the text.

## Measures

```css
:root {
  --nav-rail: 56px; /* module rail; entries 40px on a 44px pitch */
  --header-two-line: 56px; /* title line 22px, menu bar line 26px */
  --menubar-item: 24px;
  --menu: 300px; /* a menu; rows 30px, 6px padding, 10px radius */
  --submenu: 260px;
  --side-dock: 44px; /* buttons 34px on a 36px pitch, dividers 9px */
  --side-dock-panel: 264px;
  --tooltip: 28px; /* 6px radius, 4px from its control, no delay */
  --style-label: 56px; /* the margin label's box, right-aligned 8px from the text */
}
```

New colour tokens (in `tokens.css`, both themes):

| Token              | Light     | Dark      | Used for                                    |
| ------------------ | --------- | --------- | ------------------------------------------- |
| `--hover`          | `#eef1f4` | `#232f3a` | hovered and open menu names, rail entries   |
| `--divider-strong` | `#b4bdc7` | `#4a5a69` | the dock's rule between panels and tools    |
| `--tip-bg`         | `#15202b` | `#e5eaef` | tooltips, inverse of the chrome             |
| `--tip-text`       | `#ffffff` | `#0d1217` | tooltip words                               |
| `--tip-keys`       | `#9aa6b2` | `#56606c` | tooltip shortcut                            |

Everything else is an existing token: menus `--surface`, `--strong-border`, `--shadow-modal`; dock
`--surface`, `--strong-border`, `--shadow-raised`; current items `--accent-weak` and `--accent-text`;
Delete `--danger`; lifecycle current state `--warn`; Saved `--ok` on `--ok-bg`.

## Wording

Kept: "Reading", "Review", "Authoring", "Preview", "Dates", "Effective for", "Relationships",
"Archive", "Delete", "Place a hold", "Manage access", "Show boundaries", "Pages as you edit",
"Contents", "Baselines", the assistant panel's words, the save chip's words and the status bar's
counts.

New, check each:

- The menu names: "Document", "Edit", "View", "Insert", "Format", "Review", "Help".
- Every menu item not in Kept, including "Submit for review" (was "Submit"), "Save a version",
  "Compare versions", "Paste as plain text", "Style labels in the margin", "Fit to width", "Focus",
  "Mark as term", "Clear formatting", "Manage styles", "Check document", "Ask the assistant",
  "Keyboard shortcuts", "Documentation", "What is new".
- "More text formatting", the dock's `Aa` button.
- "Filter sections", the panel's filter placeholder.
- The lifecycle's step names, which must be the domain's.

"Scroll for more sections" in the drawing stands for the list continuing; it is not wording. No em or
en dashes anywhere.

## Open questions

1. **Shortcut clashes.**
   - `Ctrl Alt` is `AltGr` on many European layouts. On German, `AltGr E` is €, `AltGr Q` is @ and
     `AltGr 7` to `0` are `{ [ ] }`, so Equation and the style keys type characters there. On macOS
     `Option` letters type characters too. Decide a policy, for example: match on `event.code`, and
     never fire when `getModifierState('AltGraph')` is true.
   - A browser tab cannot take `Ctrl N/T/W`, `Ctrl Shift N/T/W/Q` or `Ctrl Tab`. Ctrl Shift T, Q
     and P were moved off for that reason. `Ctrl J`, `Ctrl H` and `Ctrl Shift B` are taken by the
     browser but can be overridden; check them in Chrome, Edge, Firefox and Safari.
   - Check every key against the editor's existing ProseMirror keymaps and the shell's.
2. **Electron's native menu.** Keep a minimal native application menu on macOS (Quit, Hide, Edit
   roles for the system), and none on Windows and Linux, so `Alt` reaches the renderer's menu bar?
3. **Lifecycle states and actions**: which states show and which action is primary in each, from
   the domain.

## Not drawn

- Edit, Review and Help open; the Language and Direction submenus; the dock's flyouts (`¶`, `Aa`,
  the lists, Insert). The Insert flyout lists Insert's items; the others list their menu's items.
- Keyboard focus rings; disabled items; read-only (Reading mode or no right to format), where the
  dock's formatting tools are `aria-disabled` and Format's items with them.
- Baselines open in the dock: the existing baselines content, in the panel frame.
- A narrow window, and right to left (the rail, dock and panel mirror; use `--inline-sign`).
- Focus mode (`F11`): rail, header and status bar hide; the dock stays.

## Example data

The document's text comes from the demo document on the development tenant (a public FDA decision
summary) and stands in for any document. Do not use it in fixtures. The outline, counts and
lifecycle states are illustrative.

## Order of work

This is multi-PR, crosses into the desktop shell (the native menu) and adds a contract, the
shortcut registry, so it gets a written plan with pre-flight review (`docs/plans/README.md`).

1. Query the trace before planning (`pnpm trace search shortcut`, `menu`, `outline`, `toolbar`,
   `boundaries`) and cite what exists; new behaviour arrives as requirements through the issue form.
2. The two ADRs.
3. The shortcut registry and its tests: pure, one source for keys, words and enablement; the
   AltGraph and reserved-key rules.
4. The module rail: icons, instant tooltips, go-to keys.
5. The header and menu bar, keyboard pattern first; then move the actions into the menus.
6. The side dock: the outline pane's rail and the frequent tools in one surface, the panel extending
   it.
7. Style labels in the margin; remove the Paragraph style select. Re-run STY-080's measurements.
8. The lifecycle stepper; the status bar chips.
9. Move the existing tests' queries. Keep their requirement IDs and accessible names; toggles keep
   `aria-pressed`, menu toggles become `menuitemcheckbox` with `aria-checked`. Add axe checks for the
   menubar and tooltips in the browser suite.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy. Every action already exists. What is new is the menu bar and its keyboard pattern,
the shortcut registry, the icon rail with instant tooltips, the combined side dock, the style labels
in the margin, the lifecycle stepper and the five colour tokens. The sheet, the desk, the editor's
behaviour and the right-hand panel do not change.
