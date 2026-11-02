# AP: The authoring page, one header and one side dock

> From [the handoff](../interface/handoffs/authoring-page/README.md) (option C2). **Full tier**: a new
> contract (the command registry), a change to the standing view, and the desktop shell's menu.
> **One PR** (Ken): the slice's only build PR, so the close rides in it. D1 to D9 are Ken's answers of
> 2026-11-02. Pre-flight found 15 defects, answered here; one it refuted (the Dark paper contrast).

**Goal:** the document page gives about 240px back to the sheet: one 56px header with a menu bar, a
side dock on the desk, style labels in the margin, an icon rail, with every action still reachable.

## What the review found

The handoff says every action exists and the sheet, the editor and the right panel do not change.
Against the code:

1. **A shortcut registry exists and the handoff's table overrides it.** `EDITOR_COMMANDS`
   (`packages/editor/src/marks.ts`) binds 28 commands, many with a written reason for their key. 6 of
   the handoff's keys collide with it, and others move keys that the registry chose to avoid exactly
   the problems the handoff's first open question raises (D1).
2. **Not every action exists** (D2): Find, Find and replace, Clear formatting, Focus, Check document,
   Filter sections, the shortcuts dialog. Comment is drawn in Authoring, but threads
   render only in Review.
3. **The stepper cannot be drawn from what the page knows** (D3). `Standing` carries the current state
   and its transitions and gates, not the workflow's states; `GET /v1/workflows` needs `administer`.
   Workflows are the tenant's, so a state count and order are not fixed, a state can offer several
   transitions, and "Submit for review" is a transition's stored name, not wording we can change.
4. **Headings cannot be paragraph styles.** `paragraphChoices` (`theme/StyleChoice.tsx`, CNT-094) never
   offers a style only a role takes. The drawn submenu's Title, Heading 1 to 3 and their keys contradict
   it (D4).
5. **Much of today's chrome has no drawn home** (D5): the Data tab; people here; the revision, dates,
   scope, archived and on hold chips; the range preview; the open component's strip (Done, Save
   version, Lines, Translations, its lifecycle and retirement acts); the second line (the list,
   preformatted, figure and value panels); and 7 registry commands no menu lists
   (Definition list, Preformatted text, Cite, Index entry, Value, Message form, Condition), with Paste
   as Markdown beside them. CNT-077 needs the commands reachable.
6. **The rail's list differs from the app's.** It draws Connectors and Settings. The app has
   Connections, Query definitions and Admin. Ken's answer is D9.
7. **Go-to keys are single printable keys**, so WCAG 2.1.4 (CNT-078) needs a way to turn them off, and
   they must not fire in the type-to-choose lists and the outline tree.
8. **Margin labels shrink.** The drawing leaves the margin at about 69px at 75%, but `base.css` scales
   it to 52.5px, so a scaled label is 7.5px at 75% and 5px at 50% (D4).
9. **The header is every screen's, not this page's.** The handoff draws only the document page (D6).

## Decisions

Accepted by Ken, D4 and D9 as he amended them.

**D1. Shortcuts: the existing registry wins; a key is added only where nothing has it.**
Matching is `prosemirror-keymap`'s own `keydownHandler`, its `keyCode` fallback included, plus "never
when `AltGraph`", so a page key and an editor key cannot disagree on a layout. The handoff's `event.code`
would make two matchers.

| Command                | Handoff         | Today       | Problem with the handoff's               | Plan                |
| ---------------------- | --------------- | ----------- | ---------------------------------------- | ------------------- |
| Subscript, Superscript | Ctrl =, Shift = | Mod-, Mod-. | Browser zoom                             | Keep today's        |
| Code                   | Ctrl \`         | Mod-e       | None, but needless                       | Keep today's        |
| Link                   | Ctrl Alt K      | Mod-k       | Mac developer tools (marks.ts)           | Keep today's        |
| Table                  | Ctrl Alt T      | Mod-Shift-0 | Linux terminal (marks.ts)                | Keep today's        |
| Equation               | Ctrl Alt E      | Mod-Shift-e | AltGr types the euro sign (marks.ts)     | Keep today's        |
| Footnote               | Ctrl Alt N      | Mod-Alt-f   | Moves Word's own chord                   | Keep today's        |
| Cross-reference        | Ctrl Alt R      | Mod-Alt-x   | Needless                                 | Keep today's        |
| Figure                 | Ctrl Alt F      | none        | **Footnote's key**                       | None                |
| Image                  | Ctrl Alt I      | none        | Mac developer tools                      | None                |
| Preview                | Ctrl Alt P      | none        | **Message form's key**                   | None                |
| Reading, Review        | Ctrl Shift 1, 2 | none        | **Index entry's and Cite's keys**        | None, nor Authoring |
| Style labels           | Ctrl Shift L    | none        | **Language's key**                       | None                |
| Check document         | Ctrl Alt X      | none        | **Reference's key**                      | Item cut (D2)       |
| Contents, Baselines    | Ctrl Alt C, B   | none        | C is Mac developer tools                 | None                |
| Show boundaries        | Ctrl Shift B    | none        | A browser's (marks.ts)                   | None                |
| Paragraph styles       | Ctrl Alt 0 to 3 | none        | AltGr digits are `{ [ ] }` on German     | None                |
| Save a version         | Ctrl S          | none        | A reflex would mint a version each press | None; see below     |
| History, Comment       | Ctrl Alt H, M   | none        | macOS Hide Others, Minimize All          | None                |
| Submit for review      | Ctrl Shift Ent. | none        | The action varies with the workflow      | None                |
| Keyboard shortcuts     | Ctrl /          | none        | Ctrl Shift 7 on QWERTZ: Numbered list    | None                |

`Ctrl S` does not make a version: a version is a decision and the text already saves itself. It is
swallowed in the editor, so the browser's Save page does not open. Kept as drawn: Bold, Italic,
Underline, the lists, Mark as term, Variable, Undo, Redo, `Ctrl K`, `Ctrl J`, zoom, `F10`. `Ctrl K` is
Link in text and Search elsewhere, the one allowed overlap. Paste as plain text (`Ctrl Shift V`) is the
browser's, shown and not bound. Increase and Decrease indent show Nest's and Lift's keys; `Tab` stays
outside the registry (`state.ts`).

**D2. Build the small ones, cut the rest from the menus.** An absent feature is not `aria-disabled`.

- Build: Keyboard shortcuts (Help), Filter sections, What is new (`release-notes.ts`). Fit to width
  exists (`theme/Canvas.tsx`) and becomes a command.
- Cut, each a later slice: Find and replace across one view per component, Check document (no
  defined meaning yet), Clear formatting (annotation identity needs its own thought), Focus, Caption.
- Cut for now: Cut, Copy and Paste rows. A page cannot reliably run paste from a menu; the keys work.
- Comment in Authoring moves to Review with Threads open on the current component.

**D3. The stepper: add the states to the standing view.** `states: {key, name}[]` in definition order,
from `standing.definition` (the version deciding this artifact, not the newest), added in
`standingAnswer` (`apps/service/src/workflows.ts`), which every view and move goes through. The contract
restates the shape six times (`components`, `documents`, `prompts`, `query-definitions`, `terms`,
`workflows`): share one. `standingIn` parses it, defaulting to `[]`. Every reader learns the workflow's
state names; no requirement forbids it, and only `transitions` are filtered by permission. Current state
in `--warn` with a dot, the others muted, with a gate's approvals so far beside it. Past 5 states or
under the narrow width, only the current state shows. **Primary:** Approve on a gate the caller may
decide and has not already approved, else the first transition; else none. Every other transition,
Return and Approve and publish go in the Document menu's lifecycle group, with their reason dialogs.
Names stay the tenant's (`data-content`).

**D4. Margin labels.** Paragraphs show their style; a heading shows its role, not as a button. The
current block's button and the Format submenu offer the styles an author can choose today, from
`paragraphChoices` (Ken: those that appear today, not the drawn list). In a footnote, Format's submenu
is the way, for the footnote's own places, and its paragraphs have no label. Colour is `--muted`, which
`.aw-canvas` already sets to Light's on paper in both themes. Size stays legible instead of scaling: 10px
down to 75%, by the fitted zoom where Fit is chosen, and labels hide below it, with `Style labels` then
`aria-disabled`. Width is the margin less 8px, so about 44px at 75%: an ellipsis and a tooltip past that.
Review's draft card clips its margin and shows none.

**D5. Homes for what is undrawn.**

| What                                                                                                                                             | Goes to                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data tab                                                                                                                                         | A third dock toggle, only where a binding is held                                                                                                                     |
| Back to documents                                                                                                                                | The breadcrumb                                                                                                                                                        |
| People here, revision                                                                                                                            | The title line's end                                                                                                                                                  |
| Dates, scope, archived, on hold chips                                                                                                            | The status bar's lead (`StatusLead`)                                                                                                                                  |
| Range preview                                                                                                                                    | View, and beside Preview while a component is open                                                                                                                    |
| Done, Save version, save text                                                                                                                    | The component frame's label line; Save also in Document                                                                                                               |
| The rest of the component's strip: Lines, Translations, Bring back, Dates, Scope, Used in, Relationships, its transitions, Archive, Delete, Hold | A Component menu on that line, which holds the F6 ring's first region and takes no flow height                                                                        |
| Nest, Lift, list start and numbering; the preformatted, figure and value panels                                                                  | One contextual tab in the right-hand panel, shown while the cursor stands in one, as Table's is (ADR-0052); changed from flyouts, which leave the F6 ring when closed |
| Definition list, Preformatted text                                                                                                               | Format, and the list and `Aa` flyouts                                                                                                                                 |
| Cite, Index entry, Value, Variable, Condition, Message form, Paste as Markdown                                                                   | Insert                                                                                                                                                                |
| Theme, language, go-to keys on or off                                                                                                            | The account menu                                                                                                                                                      |

A component opened on its own, and Review's draft editor, keep the row `EditorToolbar`; the handoff draws
only the document page. In Review the dock's tools are `aria-disabled`, and Format acts on the draft where
one is open. The mode switch stays a `radiogroup` named Mode with radios, drawn as the handoff draws it,
so CNT-154, CNT-105 and IAM-080's tests keep their queries.

**D6. Every other screen:** the same 56px band with the module's name where the title goes, no menu bar
and no lifecycle, Search and the account menu. The mark and environment chip are the rail's everywhere,
so nothing jumps moving between modules.

**D7. Electron menu:** yes to the handoff's question. No application menu on Windows and Linux, so `Alt`
reaches the page, and a minimal one on macOS (Quit, Hide, Edit roles). There is none set today, so
Electron's default is what shows. Dropping it also drops its reload and developer tools keys, so those
stay in an unpackaged run only.

**D8. Requirements:** three rows through the issue form, in CNT: one source for menus, tooltips and
`aria-keyshortcuts`; go-to keys can be turned off; margin labels leave the measure alone and can be
turned off. Everything else cites what exists. "menu" and "rail" appear nowhere in the corpus today.

**D9. The rail as drawn; Connections and Query definitions move to Admin (Ken).** The rail's foot holds
Admin alone, with the drawing's sliders icon. Its groups: Home; Components, Documents, Templates,
Prompts; Bibliography, Terms, Images; Conversations, Publications. Go-to keys as the handoff lists,
and `G A` for Admin.

- A new **Data** group in Administration's menu: sections `#/admin/connections` and
  `#/admin/query-definitions`, each drawing the existing list, with its count from the listing's
  `total`, and Administration's heading the only `h1`. This amends ADR-0046 decision 3 and ADR-0049
  decision 2, in the layout ADR. `sectionOf`'s `[a-z]+` becomes `[a-z-]+`, which also repairs
  `citation-styles` and `reference-sources`, unreachable today (an issue, closed by this PR).
- `#/connections/<id>` and `#/query-definitions/<id>` stay as they are, so links people hold, search
  results and a document's bindings keep working. They stay Places of their own, since the workspace
  keeps one page per Place and an unsaved new definition must survive a visit to another section; only
  the rail's current mark moves to Admin. The bare `#/connections` and `#/query-definitions` go to the
  sections, and each page's breadcrumb returns there.
- Both lists stay session-scoped, and Admin stays on everybody's rail, so someone who may use a
  connection but administers nothing still reaches it, with the other sections saying for themselves
  what they may not see.
- Search and commands keeps both as places to go, from a list of its own since it reads `MODULES`; Home
  no longer lists them as modules.

## Interfaces

- `apps/web/src/shell/commands/registry.ts` (pure, no React):
  `AppCommand { id, said(), icon, chord?, scope: 'global'|'page'|'editor', enabled(ctx), checked?(ctx), run(ctx) }`.
  Editor rows are derived from `EDITOR_COMMANDS`, never restated. `RESERVED_CHORDS`.
- `shell/commands/keys.ts`: `chordHandler(bindings)` over `prosemirror-keymap`'s `keydownHandler`, exported
  through `packages/editor`, refusing `AltGraph`; `chordSaid(chord)`, from the existing `command.*.keys`
  words where present; `ariaKeyShortcuts(chord)`.
- `shell/commands/menus.ts`: the seven menus as data, by command id.
- `shell/commands/useShortcuts.ts`: one listener, honouring `event.defaultPrevented` as `useCommandKey`
  does, so ProseMirror still handles its keys first and `Ctrl K` stays Link in text.
- `parts/MenuBar.tsx`, `parts/Menu.tsx`: WAI-ARIA menubar; `menuitem`, `menuitemcheckbox`,
  `menuitemradio`, submenu. Focus returns on close to what had it, the editor included.
- `parts/NameTip.tsx`: instant, 1.4.13-compliant, generalised from `PanelRail`'s named tip; must escape
  a clipping parent.
- `shell/HeaderSlot.tsx`: a portal host as `StatusLead` is. A page kept hidden draws nothing
  (`usePageShown`), and its shortcuts do not fire.
- `structure/DocumentHeader.tsx`, `structure/SideDock.tsx`, `lifecycle/Stepper.tsx`, split out of
  `DocumentPage.tsx`. `id="document-title"`'s heading moves to `DocumentHeader`, inline where there is no
  host, so the article's name and the browser tests holding it survive; `OutlinePanel`'s `root` keeps the
  title as plain text and the version.
- `editor/EditorToolbar.tsx` gains `layout: 'row' | 'dock'`, and `parts/Toolbar` an `orientation`, since it
  moves on Left and Right alone. `ComponentEditor` still owns it and portals it through `InPlaceBand`,
  renamed for the dock, so prompts and dialogs stay where they are and F6 still bubbles through the portal.
  With none open, the dock shows the tools `aria-disabled`, as `IdleBand` does today.
- `editor/ActiveEditor.tsx`: a context set by effect from whichever `ComponentEditor` is mounted to edit,
  in place or Review's draft (at most one), publishing `press(commandId)` for the menus.
- `TransitionButtons` splits into `useTransitions` (acts and dialogs) and its views, one for the header
  and one for the menu.
- `apps/desktop/src/shell.ts`: `applicationMenu(platform, packaged)`, pure and pinned in `shell.test.ts`.
- Margin labels: `Decoration.node` attributes in the editor (no schema or stored change), as
  `placeDecorations` does, naming the style through a `styleName(id, place)` the renderer passes in, since
  `data-style` holds an id and the editor has no theme; the same attribute in `DocumentText`. Drawn as an
  absolutely placed `::before` with `content: attr(...) / ""`, so they are never copied, published,
  measured or read inside the textbox. One overlay button for the current block.
- Outline pane: 264px is the default and the resizer stays, since nine levels of nesting (STR-007) need
  it. Contents, Baselines and Data become `aria-pressed` toggles in place of `PanelTabs`.

## Order of work

One commit per step, with `sync_with_base_branch` after each: `DocumentPage.tsx` took five commits in
the last day.

1. **Setup.** The handoff into `docs/interface/handoffs/`; ADRs for the layout and the registry; D8's
   rows; this plan and its index row; `DocumentHeader` extracted with **no behaviour change**, landing
   the conflict-prone move first.
2. **Spike, an hour, only what could change the plan:** in pinned Chromium, whether a page keeps `F10`,
   `Alt`, `Alt+D`, `Ctrl J`, `Ctrl S` and `Ctrl /`. A key a browser refuses keeps `F10` as the way in.
   Firefox and Safari are Ken's manual check.
3. **Registry, keys, menus as data**, pure and tested first.
4. **The five tokens** and `NameTip`.
5. **Rail**: icons, tips, the environment chip, go-to keys; Connections and Query definitions into
   Administration (D9).
6. **Header and menu bar**: the keyboard pattern, then the actions moved, then theme and language.
7. **Dock**: the toggles, the tools, the flyouts, the panel extending it, the sheet centred in the rest.
8. **Margin labels**; the `ParagraphStyle` select goes; `styles.test.ts` rerun for STY-080.
9. **Stepper and standing view**; regenerate `openapi.json` and the client. **Status bar** chips.
10. **Electron menu. Shortcuts dialog, Filter sections.**
11. **Tests moved**: keep their IDs and accessible names. `structure/test/documentPage.tsx` and
    `editor/test/componentEditor.tsx` first, then the document page's suites, `EditorToolbar.test.tsx`,
    `Header.test.tsx`, `Rail.test.tsx`, `moduleOf.test.ts`, `Home.test.tsx`, `CommandPalette.test.tsx`,
    `connections.test.tsx`, `query-definitions.test.tsx`. In the browser, about 19 files match today's
    chrome: accessibility, canvas (the sheet unmoved on opening), pseudo, document-panes, outline, styles,
    imports and the rest of a grep at the time.
12. **Close**: the fragment folded, `version.json` and mirrors (Minor +1), `architecture.md`, `features.md`,
    `README.md`, the baseline; `document-view.md`'s owned rows; `pnpm trace pins`, generate, and
    `packages/trace`'s tests. Push; CI and Auto-fix catch the rest.

## Tests worth naming

- CNT-077 every command in the editor's registry is reachable from a menu.
- CNT-077 a menu's item, a dock button's tip and its `aria-keyshortcuts` say the same keys.
- no two commands in a scope share a chord, an editor key overlaps a global one only for Link and Search, and none is reserved (a literal table, so a moved key fails loudly).
- `chordHandler` never fires with AltGraph held, and fires on a Cyrillic layout as the editor's keymap does.
- <the D8 row> the menu bar follows the menubar pattern: F10, arrows, Enter, Escape returning focus to the text.
- axe finds nothing with a menu and a submenu open, a tooltip shown, in Light and Dark (no citation: CNT-078 asks for all of AA).
- <the D8 row> go-to keys do nothing once turned off, in text, in the outline tree or in a type-to-choose list.
- CNT-077 F6 reaches the frame's menu, the dock and the contextual tab, in that ring's order.
- CNT-164 each mark applies from the dock, from Format and by its key, keeping the selection.
- CNT-165 Mark as term applies from the dock and from Format.
- CNT-073 Show boundaries from View is `menuitemcheckbox` and reveals them.
- CNT-154 the current mode stays obvious in the header's switch.
- CNT-094 the style list in the margin and in Format offers no role's style.
- STY-080 still holds with margin labels on, at each zoom (the existing suite).
- margin labels are absent from a copy of the text and from the published PDF.
- a margin label meets 4.5:1 on a theme's own paper colour (STY-024), not only on white.
- the stepper shows a tenant's six-state workflow without overlap, and no action where the caller has none.
- the stepper lists the deciding version's states after the workflow gains a newer version.
- an already approving caller is offered no Approve as the primary.
- an unsaved new query definition survives a visit to another Administration section.
- `#/admin/citation-styles` opens that section.
- a page kept hidden in the workspace draws no header and answers no shortcut.
- `#/connections` lands on Administration's Connections section, and `#/connections/<id>` marks Admin current.
- someone who administers nothing reads the connections they may use from Administration.
- `applicationMenu` is null on Windows and Linux when packaged, and holds only the system's on macOS.

## Review focus

Drive these, do not read for them: a selection surviving a trip through the menu by keyboard; a dialog
opened from a menu returning focus to the text; a component opening while the dock's panel is open, with
the sheet still; a read-only reader; a hidden kept page beside a shown one; the pseudo-locales and
200% zoom at the header (1.4.10, the handoff draws no narrow window: menu names fold into a More menu,
then the stepper to its current state); right to left (`logical.test.ts`); forced colours on tooltips and
dividers; the opening budget (CNT-179, CNT-180), as the dock renders on every transaction.
