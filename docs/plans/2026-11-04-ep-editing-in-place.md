# EP: editing a component in place

> **Draft for Ken's agreement. Nothing is built.** Full tier: several PRs, and requirements change in EP4 and EP6. No
> migration, stored shape or route is expected; any that appears stops the work for a ruling. Pre-flight ran, driving the
> app, and found sixteen defects, answered in each PR below. Rulings 1 to 11 are Ken's, 2026-11-04. **Ruling 12's colour
> awaits him; EP7 has not been through pre-flight.**

**Goal:** clicking into a document's text feels like Word or Google Docs: nothing moves, one marker says what is being
edited, one toolbar holds what applies there, the panel follows, titles can be typed where they stand, and what was
typed never appears to vanish.

**Evidence:** temporary browser walks on the #966 build, removed afterwards, at 1440 and 1920 wide; everything else is from
reading the code.

| PR  | Holds                                                                  | A reader notices                      | Needs     |
| --- | ---------------------------------------------------------------------- | ------------------------------------- | --------- |
| EP1 | The Part panel follows a click in the text                             | The panel shows the part being edited | Nothing   |
| EP2 | No flicker; one blue left line; the grey box and blue boxes gone       | Clicking moves nothing                | Nothing   |
| EP3 | One toolbar, in the reader's theme, above the component                | No light toolbar in Dark              | EP2       |
| EP7 | A lock symbol in the gutter, stacked with the comment symbol           | Who holds a part, without hovering    | Nothing   |
| EP4 | The hover toolbar gone; its contents in the Part panel and Review menu | No toolbar over headings              | EP1, 2, 7 |
| EP5 | Clicking away; moving on cuts a version ([#970][970])                  | Typed words stay, and locks are freed | EP2       |
| EP6 | Click to edit titles, section and component                            | Headings can be typed in              | EP2, 3, 5 |

The close and the baseline ride in EP6 unless the slice stops sooner.

[970]: https://github.com/kenhayward/alloy-works/issues/970

## Rulings

1. **Moving to another component with changes counts as Done editing:** the words stay, a version is cut, the lock is
   released (CNT-070 and COL-010 read to include that click; an ADR records the reading).
2. **The hover toolbar goes,** its contents moved first.
3. **Direct title editing covers both** section titles and component headings.
4. **One toolbar stands above the component, heading included,** locked at the top of the document window as you scroll,
   and gone once the component has scrolled away, as the table toolbar behaves today.
5. **Marker:** a left blue line rather than a box (Ken's request, the shape of the accepted-edit rule).
6. **Items follow the cursor, not the component's type**, since one component can hold text and tables. Accepted with the
   one-toolbar design, not separately argued; say if not.

7. **The reach warning stays on moving on.** Done's question is REU-008's "used elsewhere" warning, not about approval (the
   first draft had this wrong). It appears only for a component used elsewhere; REU-008 stands.
8. **Editing a pinned part moves this document's pin to the version cut,** as an accepted Assistant edit does (`movePins`).
   Otherwise the words leave the page on moving on, with only "Version 0.3 is newer" to explain it.
9. **The toolbar stands at the component's end (right in left to right),** clear of short headings. Above the component it can
   still cover a long section title or the last lines before it: both stay reachable, by scrolling or the Part panel.
10. **A mode switch with changes counts as moving on,** amending ADR-0085 decision 7, which left the words off the page.
    **Leaving the page does not cut:** the words come back on return (driven), and it is not a deliberate release.
11. **CNT-074 stands:** the tooltip says who holds the part and when it is expected back, in place of "Click to edit", as well
    as the panel. **Show boundaries keeps a status mark in the outline's rows**, since it loses the labels.
12. **A lock symbol in the left gutter, stacked with the comment symbol** (Ken's idea): green when you hold the lock, and for
    someone else's, **amber recommended over the grey Ken suggested**, awaiting him. See EP7.

## Assumed unless Ken says otherwise

- **A click on a section title with changes open** counts as moving on.
- **With nothing changed**, a click on empty sheet closes the editor and leaves no marker. **With changes**, it stays open, with
  the line and the toolbar. "Outside" means mousedown and mouseup both on empty sheet, with no selection, and the native
  target checked: a drag and a portalled toolbar both look like a sheet click otherwise.
- **Enter** in a component heading moves into its text; in a section title it commits. **Esc** cancels.
- **Hover** shows the left line in grey and the "Click to edit" tooltip. **Show boundaries** shows lines and no labels.
- **Too narrow for the toolbar:** the overflow goes behind a "More" button.

## EP1: the panel follows

**Today:** the panel follows only a choice in the outline (`chosen` in `OutlinePanel`). Measured: clicking and typing in
Beta left the outline's selection and the panel on the opening section.

- A click in a component's text chooses its node, without scrolling; `linked` scrolls, so it needs a way of its own.
- **In Reading and Review too, keeping any text selection.** `onOpen` is Authoring's alone, so this needs a hook of its own.
- The panel's tab does not change: Threads and the Assistant are left alone (ADR-0079 decision 6).
- The panel shows the version number in every mode: Reading says only "Latest version" today.
- A deliberate choice in the outline may still differ from the part being edited: the line says what is open.

## EP2: nothing moves, one marker

**Today:** `ComponentEditor` returns `Waiting` while it loads. Measured: the text gone from 54 ms to 195 ms locally, and the
next component jumping 163px up and back. Longer over a real network.

- Keep the read text until the editor is ready, then swap in one frame. Failure paths stay.
- **Closing too:** after Done the words left the page from 47 ms to 77 ms locally. Keep the last editor content as the read text
  until the re-read answers.
- **Typing before ready is not lost:** with the read delayed, four of eight keys were dropped, and "Opening" goes. Buffer and
  replay them, pinned in the walk.
- **Where the read text differs from what opens, it changes at once, and says why:** pinned with a newer version (read 23px,
  editor 61px), overridden ("NORTH drain" becomes "drain", and a note moved the next part 51px), and held by someone (45.5px).
  A held part's notice may move what follows: the reader asked to edit and cannot. `openAt` maps only where the texts agree.
- Remove `.card[data-in-place]`'s shadow, `.surface:focus-within`'s outline, the `.component` outline, and the `.body` hover
  tint. Add one 3px accent rule, placed as `data-changed`'s is; it takes that rule's place while the part is open.
- **This PR also adds the grey line** for hover and Show boundaries (CNT-073), since that outline was their only mark. The rule
  needs an edge in forced colours, where `::before` computed white on white (`forced-colors.test.ts`).
- The outline that likely reads as the "dashed line" through a heading goes with it; this PR's walk checks that.
- Keep a focus outline for a keyboard landing on the surface by `F6`.
- **Walk:** no element moves across a click, with a list, a table, a heading, a pinned part with a newer version, an overridden
  part and a held part in the fixture; layout shift of zero but where a text differs. Every block moved 1px when driven: find it.

## EP3: one toolbar

**Today:** the component's acts stand inside the sheet, which takes Light's tokens, so they are light in Dark, and are
clipped where the desk is narrower than the sheet. The table's are portalled to the body.

- One toolbar, portalled to the body; `placeToolbar` follows the component rather than the table.
- Groups declare when they apply, the `applies` pattern of ADR-0085. Component first, so its buttons never move; Table after.
- The Component group shows only in a document; a component's own page keeps its header.
- Keep: the caret never under it (WCAG 2.4.11), the guards of #961 and #964, one `F6` stop, `Esc` back to the text.
- **Copying `placeToolbar` is not enough:** clamp to the desk (at zoom 2, scrolled, it landed over the outline's buttons), add
  right to left, and scroll only for a move by keyboard, since a click on a line beneath it must not move text (EP2's walk).
- **Each group has its own gate.** The table's needs `mayFormat`, a table and no open footnote; Done must stand while reading or
  read-only too. Specify the ring's end: first in the ring, Shift+F6 reaches `RegionKeys` with the focus in no region.
- Measure in the walk what it covers (ruling 9): at 1440 a plain part under a section would meet the section title.
- A new ADR amends ADR-0079 decisions 1 to 3. `table-toolbar.test.ts` changes with it.

## EP7: the lock symbol

**Today:** a held lock is said only in the hover label's words, or a notice once opened. The data is already there and live:
each part's `lock` (`holder`, `yours`, `expectedRelease`), updated by the stream (`live.locks`).

- **It stays in view without hovering,** which answers CNT-074 better than the tooltip alone. No symbol means no one holds it.
- **A button, as `CommentGlyph` is, not a hover:** a 24px target with an accessible name and the same words in its tooltip, so
  keyboard and touch get them too. It opens the Part panel on the part. Uses `heldSentence` for someone else's.
- **Not colour alone (WCAG 1.4.1):** the two differ in shape as well, and hold up in forced colours.
- **Gutter:** one stack for both symbols, absolute, so it moves no text. A one-line part is shorter than two symbols: the walk
  checks that a stack does not run into the next part's.
- **Appears at the first change, not on opening,** since that is when the lock is claimed. So green also says "not a version yet".
- **Goes when the lock does:** `expectedRelease` passes with no event, and the label only checks when it renders, so this needs a timer.
- **Words:** "you are editing" for this window; a lock of yours from another window or left behind says so. Shown in Authoring and
  Review; Reading stays clean, with the panel saying it.
- **Padlock:** the `notYoursToRead` lozenge already uses it, and `released` an open one. Check the two read apart, and add a line to
  `lifecycle-states.md` on why this symbol is not a lozenge (ADR-0081): it says who holds a session, not a state of content.
- The outline's status mark (ruling 11) uses the same symbol.

## EP4: the hover toolbar goes

**Why:** an 8px gap drops the hover before the pointer reaches it (measured: shown at y=248, gone by y=246), and at 602px wide
and 63px tall it covered a section heading.

- **To the Part panel:** the version number and list (CNT-158, CNT-162, CNT-163), Overrides, the warnings, who holds the
  lock, who is here, and the comment and suggestion counts. **To the Review menu and the Part panel:** Suggest changes.
- **Overrides must work while the part is open.** It is hidden then today, and EP1 makes that the usual case.
- Also label-only: "changed by the assistant", and COL-069's moved-part words.
- **Reading has the panel** (driven), and EP1 lets a reader choose a part there. **Review opens on Threads,** so Suggest changes
  acts on the part chosen and says so when none is.
- **Requirements, audited row by row before this PR is planned further.** The label also serves CNT-074, LIF-018, LIF-046,
  LOC-016, REU-011, REU-015 and REU-050. Each is read: a row saying "the view" may need only its test retitled, and CNT-073 may
  survive unchanged on the line and the toggle. Anything superseded goes with `document-view.md` and the next baseline
  **in the same PR**, or the gate breaks.
- **Tests that go or change:** `canvas.test.ts:285-328`, `labelFits` and `textExtent`, `pseudo.test.ts:530`.

## EP5: clicking away and moving on

**Today, measured:** typing, then clicking another component, took the words off the page, in Reading and after a reload too.
No version was cut, and the lock stayed held, for up to 15 minutes. The autosave came about 2 s after typing stopped.

**Reopening restores the words** (driven), in the same page and after a reload; another browser offers "Recover here". So the
ordinary loss is on screen and in the lock, not of data, but for the case below.

- Starts from a reproducing walk ([#970][970]).
- **A pending move, in the page.** `finish` returns once disposed, and `open(node)` unmounts at once, so Done then a click on B
  silently dropped Done (no release, no version). The page holds A mounted, queues the latest target, then re-reads and resets
  (`bindingSession`, `editingTables`, `editorSaved`, which `onEdit(node)` skips today) and opens it.
- **The pending move answers:** typing during the wait, a click on a third part, and each phase. `finish` no-ops in `claiming` and
  `lost`, so those need their own road.
- **Words typed into someone else's part are destroyed today** (driven): `kept` is React state, gone on moving on and on reload.
  Persist it with `keepOffered`, or block the move in `lost` and `stopped`. In the walk.
- **The walk also covers:** a save in flight (both are sent in order, driven), a pinned part (ruling 8), a mode switch and leaving
  the page (ruling 10), a drag out of the editor, and a click in the margin, which lands in the surface.
- **Not yet driven, so first in this PR:** an Assistant accept while open, a suggestion's draft, an open footnote, a save
  conflict, `lost`, and an approved component.

## EP6: titles

- **Section:** `TitleField` lifted out of `PartPanel`, so that the panel and the heading share `mountTitleEditor` and its rules.
  Commits as the panel's does, one outline change. Titles it holds back stay read-only, saying why.
- `openField` belongs to `OutlinePanel`, and either field unmounting clears it (`lostTitles`): lift it above both, and test the
  panel and heading open together.
- **Component:** a heading click opens the editor with the cursor in the title, saved with the session, under the existing "used
  in other places" question. **Not `only="title"`:** a single-line `<input>` collapses a wrapped heading, and carries a hidden
  `h2` that would nest. A wrapping editor instead.
- **Names are re-read on close:** the heading reads the components listing, which closing does not re-read, so a new title
  would revert on screen.
- The number stays the outline's: the cursor stops after it. Set in the theme's heading role, moving nothing (EP2's walk).
- A new requirement row through the form. To decide in the PR: how the heading behaves on a component's own page.

## Not in this plan

- **The same title twice** in Ken's document (section, then component heading): perhaps import. An issue of its own, once
  its source and whether the PDF doubles it are known.
- [#968](https://github.com/kenhayward/alloy-works/issues/968) and [#969](https://github.com/kenhayward/alloy-works/issues/969).
- Threads, Suggestions and Review on a component (CE6).

## Risks

- **Every PR touches `ComponentEditor` and the same walks:** built one at a time, in order.
- **EP5 changes when versions are cut:** more versions in history, and overrides go stale as soon as an edited paragraph is
  cut. Weigh after use. It is also now the largest PR here, and may split.
- **Not driven in pre-flight:** a reader without edit rights, Dark, right to left, the Overrides dialog while open, `pnpm trace
gate` and pins.
- **EP4 changes requirements of T1:** the one PR here that can break the gate.
- **Budgets:** unmeasured until #969 is settled, so EP2's cost to an open cannot be held to a number yet.
