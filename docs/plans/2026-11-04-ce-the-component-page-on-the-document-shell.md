# CE: the component page on the document's shell

> **Full tier:** several PRs and the largest page in the renderer. No migration, no stored shape, no route before CE6.
> Rulings 1 to 7 and refinements A to C are Ken's, 2026-11-04. Pre-flight found twelve defects, answered here. **While
> GitHub Actions is down, Ken's call: CE1 onward stay on one branch and one PR, tested locally,** until he says it is back.
> Decided in [ADR-0085](../decisions/0085-a-components-page-shares-the-documents-shell.md).

**Goal:** the controls of a document and of a component are one set of code. A control added for documents reaches
components by declaring that it applies, and a component's page shows only what applies to it.

**Not the goal:** a component opened as a document of one. `DocumentPage` is built on an outline, and a component has
none. Some differences stay on purpose: a binding shows what it asks for rather than a value, and the Reference dialog
offers the component's own targets.

| PR  | Holds                                                                          | A reader notices |
| --- | ------------------------------------------------------------------------------ | ---------------- |
| CE1 | This plan and the ADR; the editor's chrome apart from `onDone`                 | Nothing          |
| CE2 | `AuthoringShell` and the panel registry, extracted from `DocumentPage`         | Nothing          |
| CE3 | The editor made ready: the header's channel, dialogs out of the strip, Reading | Nothing          |
| CE4 | The menu bar taking a kind, its new rows, a component's Language dialog        | Nothing          |
| CE5 | The component page on the shell; `ComponentDock` and the old chrome deleted    | The redesign     |
| CE6 | Threads and Suggestions on a component, and Review; a plan of its own if large | Review arrives   |

CE1 to CE5 are one slice and close in CE5. CE6 can wait. Hold other work on `DocumentPage` during CE2.

## Rulings

| #   | Ruling                                                                            |
| --- | --------------------------------------------------------------------------------- |
| 1   | Reading and Authoring only. Review arrives with Threads in CE6                    |
| 2   | Opens straight away, with no click-to-open and nothing to close (refinement A)    |
| 3   | Title, lifecycle and mode in the header, everything else in a menu (refinement B) |
| 4   | `SpacePane` stays on the left                                                     |
| 5   | No Preview on a component for now                                                 |
| 6   | Shell-level controls apply automatically; a panel opts in                         |
| 7   | Authoring to Reading with the lock held: as a document does                       |

**Ruling 7:** do as a document does. Its mode switch unmounts the editor, sending the last save and leaving
the lock to lapse (`chooseMode`, `session.ts` `dispose`), and nothing is cut. It is the same behaviour on both pages and
the least code. The alternative, cutting a version and releasing as Done editing does, makes a mode switch create a
version. If leaving a lock to lapse proves wrong, fix it for both.

## Refinements

Reading the code corrected three things said in the assessment; Ken accepted these.

- **A. Done editing stays.** The assessment said a component's page has no use for Done. On its own page, Done editing
  cuts a version where anything changed (CNT-070) and releases the lock, and leaving the page releases nothing, so it is
  the only way to let a lock go at once. It stays as an act and closes nothing. Only the closing part of `onDone` is absent.
- **B. The menu is the menu bar, not the frame's Component menu.** The assessment called that an existing menu of acts.
  It is a button disclosing only the language and direction chips (`titled` unmounts the acts in a band). The menu bar's
  Document menu already lists nearly the same rows, so the page gets a **Component** menu built from them.
- **C. A component needs a Language dialog of its own.** The assessment implied one existed. `DocumentLanguage` is a
  document's, and a component's chips are editor steps that claim the lock. CE4 adds it, Direction with it.

## Panels

| Panel                                        | On a component                                   |
| -------------------------------------------- | ------------------------------------------------ |
| Selection, Table                             | Yes, as a document's, with the dot of ADR-0079   |
| Part                                         | Yes, named Attributes: identity, then Fields     |
| Versions                                     | Yes, `VersionsPanel` with My changes             |
| Threads, Suggestions                         | CE6                                              |
| Assistant                                    | No: its tools read an outline; revisit after CE6 |
| Document, Lists, Publishing, Rounds, Sources | No                                               |

## Where each act goes

| Today, on the component's own page                    | Goes to                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Title, click to edit; `#component-title`              | Header, still naming the article                       |
| Lifecycle lozenge, revision chip, transitions         | Header, as `DocumentHeader`'s                          |
| Archived, on hold                                     | Header, by `Lozenge`                                   |
| Version and space; size tooltip                       | Header's `space` and `version`; the tooltip on version |
| Done editing, Save version, Saved text                | The band's leading acts                                |
| Save version, too                                     | Component menu, as a document's                        |
| Dates, scope (set)                                    | Component menu                                         |
| Relationships, Access                                 | Component menu                                         |
| Language, Direction                                   | Component menu, the new dialog (refinement C)          |
| Move, Hold, Archive, Delete                           | Component menu                                         |
| Lines, Begin a line, Translations, Bring back         | Component menu: **new rows**, each one dialog (CE4)    |
| Used in                                               | Component menu: **new row**                            |
| Dates and scope as shown, the line read; scope accept | Attributes identity, always in sight, accept with them |
| Identifier                                            | Attributes identity                                    |
| Save state (`SaveIndicator`)                          | Status lead, as a document's                           |
| Approved note, `ReachDialog`                          | Out of the strip, drawn by the editor in any placement |
| The breadcrumb                                        | Gone: the header names the module                      |

## CE1: the chrome apart from `onDone`

`inBand = onDone !== undefined && bandHost !== null` joins "may close" to "has a band". Split them: the band follows
`bandHost` alone; the frame, canvas and `data-in-place` stay on `onDone`. Band without frame leaves `stripPart` drawn
nowhere, so first move out of it what must always stand: `ReachDialog` (or `askFirst` on Done and Save version never
shows), `SaveIndicator` and the approved note. `leading` is passed only out of a band and drawn only in the row layout
(`EditorToolbar.tsx:247,391`): add it to the dock layout.

- **Test first:** given a band and no `onDone`, the toolbar stands in the band with the leading acts, no frame; Done
  editing there asks, cuts and releases, and closes nothing.
- No caller changes. `DocumentPage` is the only provider of a band, and only in Authoring, so `draft` never sees one.
- **As built:** the strip stays drawn in the card on a band with no frame until CE3 takes its parts out, so nothing is
  orphaned meanwhile.

## CE2: the shell and the registry

- **`layouts/AuthoringShell.tsx`:** slots for the header, start pane, band, desk, preview column, panels and status, and
  the `data-desk-page` styling. Pure layout. **It does not own the providers or pane widths:** `DocumentPage` reads them
  above where they are provided (`activeEditor`, `selectionHeld`, its panes), so the page keeps them and passes them in.
- **`parts/panels.ts`:** `DOCK_PANELS` moves here as `{ key, icon, label, applies(context) }`, the filter at
  `DocumentPage.tsx:2480` becomes `applies`, and `selectionMayTake` moves with it. A pure function under test.
- **Ids per kind:** `dockIds`, `document-title` and `document-mode` take the kind and id. A kept document beside a kept
  component must not let `aria-labelledby` resolve into the hidden page.
- Small commits: panels, then rail, band, header slot, status. Do not try to shrink `DocumentPage`'s hooks here.
- **Test first:** `panels.test.ts` pins the set per kind and mode in literals. **The gate on this PR:** no `DocumentPage.*`
  test changes beyond an import, and the accessibility, navigation, outline, canvas and document-panes walks all pass.

## CE3: the editor made ready

Nothing visible: the own page has no band until CE5.

- **The header's channel.** Title, standing, dates, scope, lines and archived all live inside `ComponentEditor`, and
  `ActiveEditorHandle` is a ref read when a menu opens, so it cannot drive a live header. The editor draws `WorkHeader`
  and the identity by portal, through `HeaderSlot` and a host given by the page, as it already does for fields. Lifting
  the fetch out would be cleaner and far larger; not here.
- **Dialogs out of the strip.** In a band `titled` unmounts every act, and passing `act` removes an act's button
  (`Archive.tsx:79`). So on a band without a frame the editor mounts the acts' dialogs apart from the strip, each with an
  `act` ref for the menu. `LinesControl`, `TranslationsButton`, `BringBackButton` and `UsedInButton` gain `act`.
- **Reading.** A new prop is needed: a first change claims the lock, `reading` counts as editable, and a reload's
  `editing.resume` also claims. The prop refuses all three, so a remembered Reading claims nothing.
- **A third placement:** reading on a page with a shell, neither card nor band. `draft` keeps the card, so that path stays.
- **Test first:** each of the above in `ComponentEditor.*`; Reading on a reload with work unsent sends nothing.

## CE4: the menu

- `buildMenus` takes a kind. Its rule, "what cannot apply stays" (`menus.ts:83`), holds within a kind and not across them.
  For a component these go: `preview`, `mode.review`, `panel.*`, `assistant`, `boundaries`, `pages`, `comment`, the
  Review menu. First menu named Component, with the new rows and registered commands (ADR-0076).
- Lines is a select plus Begin a line (`Lines.tsx:73,94`), so its row opens a dialog holding both.
- `DocumentHeader`'s frame splits from what is a document's: title, lifecycle, mode and menu bar become `WorkHeader`.
- A component's Language dialog, Direction in it. The `LOC-044` test (`ComponentEditor.editing.test.tsx:245`) moves with
  it, cited as before.
- **Test first:** `commands.test.ts` pins the component menu's rows in literals; each row opens its dialog.

## CE5: the component page on the shell

- `Workspace.tsx`'s triptych becomes `ComponentPage`: `AuthoringShell`, `WorkHeader`, `SpacePane`, Attributes and Versions,
  and `ComponentEditor` in the band. Ring: the frame and old header stops go from F6 (`regions.tsx`).
- **Mode:** its own key, `aw.component.mode`, default Authoring for whoever may edit, so reading a document does not open
  the next component read-only. Switching remounts the editor (ruling 7).
- **The panel remembered:** `aw.component.dock`. A key naming a panel not offered falls to Attributes.
- **Deleted:** `ComponentDock`, the `PanelTabs` use, the breadcrumb, `COMPONENT_PANELS`. List what of `!inBand` survives for
  `draft` and tests.
- **Readers:** the same shell, Reading alone; the read-only and unreadable notices as now.
- **Walks, separate cases:** the rail hides the page (kept mounted, session live, lock held, toolbar gone); a list or
  another component in the same place unmounts it (last save sent, lock lapses); back; a link. Move
  `ComponentEditor.blocks.test.tsx:351` and `accessibility.test.ts:1270-1317`.
- A test that the two pages offer the same toolbar: every `EDITOR_COMMANDS` entry reachable on each.
- **Docs and close:** `component-editor.md`, `document-view.md`, `features.md`, `README.md`, `architecture.md`; fragment
  folded, version, baseline.

## CE6: Review on a component

`ThreadsPanel` and `SuggestionsPanel` take `document: string` and call document routes. The API has
`/v1/components/{id}/threads` and suggestions. They take a `target` of a kind and an id. `placeOf`, `targets` and `onGoTo`
assume an outline, and that is the size of this PR: read them before committing to it. Review then joins the modes.
`RoundsPanel` stays a document's.

## Risks

| Risk                                         | Answer                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| CE2 breaks the document page                 | Small commits, document tests held unchanged, walks before each push           |
| Other work collides during CE2               | Land #958 and #961 first; CE2 short and alone                                  |
| An editor reaching into the header by portal | One host per kept page, cleared on hide; pinned by the kept-page walk          |
| A remembered Reading claiming a lock         | Tested on reload with work unsent (CE3)                                        |
| F6 and tab order change                      | The accessibility walk rewritten in CE5; axe in both themes, at 1366 and below |
| A panel's typed fields lost when switching   | Attributes stays mounted, as a document's Part does                            |
| An act lost                                  | The table above; a test per menu row                                           |
| The dialog census                            | `dialogs.test.ts` follows moved dialogs: update `pseudo.test.ts` with each     |
| The toolbar over a hidden page (#960)        | `PageShown` comes from `Workspace`, so it holds; a walk on the component page  |

No requirement row pins the present chrome (pre-flight checked Title, Attributes, the toolbar's place and the triptych),
so tests move and no row is superseded. `pnpm trace gate` has not been run against this.

## What this plan has not done

No code has run for it. Unverified: how much of `!inBand` survives, whether portals into the header hold up under a kept
page, how much CE6 costs. CE3 is the likeliest to grow: if the header's channel proves awkward, stop and raise lifting the
fetch rather than working round it.

## Built

CE1 to CE5 landed together in one PR, tested locally, while GitHub Actions was down. Differs from the above:

- **The shell is composed parts, not slots** (`ShellPage`, `ShellLayout`, `ShellPanels` and so on), so `DocumentPage`'s JSX kept its order and nesting and its tests held.
- **The header's channel needed no host.** `HeaderSlot` is already by context, so the editor draws `DocumentHeader`, which took a `kind` rather than being renamed `WorkHeader`.
- **Language, Direction, Lines, Translations and Bring back stand in Attributes, not in dialogs of their own.** The chips and controls there are the existing ones, with their tests; the menu's **Language** and **Lines and translations** rows open that panel. It answers refinement C with less new code, and is a change from what Ken accepted, flagged to him.
- `usePanelChoice`, `useDockRoom` and `ModeSwitch` came out of `DocumentPage` so both pages share them.
