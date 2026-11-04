# Handoff: the Part panel, grouped and folding

The Part panel (`NodeDetails` in `structure/OutlinePanel.tsx`, the pane beside the text; the LG
plan, LG6c) stops being one long column of labelled rows. It becomes:

- a **compact identity block**, saying what the part is, where it sits, its state and its key
  facts;
- **four groups that fold**, each giving a one-line summary when shut: Layout, Fields, Readers and
  Links;
- **icon actions in the header**, Remove included, in red;
- a **centred modal**, over a greyed page, for removal.

It covers every kind of part: a section, a component, a section holding template fields, and a
component the reader may not read.

Drawn in the design canvas on 4 November 2026. Design A (groups) was chosen over B (tabs), because
shut groups still say how the part is set up and a missing group costs no space.

**Drawings, not code**, as for the other handoffs:

- colour comes from `tokens.css`;
- layout comes from the HTML;
- the existing wording comes from `en-GB.json` (`document.*`, `editor.*`).

Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 2x.
The panel is drawn at 360x800, the modal over the whole authoring page at 1600x900.

**The states are lozenges** from [`../../lifecycle-states.md`](../../lifecycle-states.md) (small
size), as everywhere else. If that app-wide work has not landed yet, it comes first.

Delivered as a zip that unpacks at the repository root, into `docs/interface/handoffs/part-panel/`.

## Screens

| Files                | Screen                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| `section-*`          | A top-level section, Layout and Links open; not numbered, with the "Number it" offer    |
| `section-folded-*`   | The same section with every group shut: the whole part on one screen, summaries showing |
| `component-*`        | A placed component: Approved, numbered 6.1, starting on a new page, two references      |
| `fields-section-*`   | An appendix section holding template fields, Fields open; Numbered locked by its parent |
| `unreadable-*`       | A component the reader may not read: Layout only, and why                               |
| `remove-section-*`   | Remove pressed on a section: the modal, centred, over the greyed page                   |
| `remove-component-*` | The same for a component referenced from elsewhere                                      |

## Decisions to record (one ADR)

1. **The header.** "Part", then three icon buttons, each with its words as accessible name and
   tooltip:

   | Action                                   | Icon           | Colour     | Today                        |
   | ---------------------------------------- | -------------- | ---------- | ---------------------------- |
   | Go to it in the text                     | crosshair      | neutral    | new (check: the row's click) |
   | Copy a link to {name}                    | link           | neutral    | `NodeLink` (STR-044)         |
   | Remove section / Remove component {name} | `Delete` (bin) | `--danger` | the foot button              |

   A 1px `--border` rule, 18px high, separates Remove from the other two. **The foot button and
   the link row go.** The copy messages ("Copied the link to {name}.", and the failure sentence)
   stay, as a status announcement and a toast.

2. **The identity block**, under the header, always shown, never folding:
   - **A type tile,** 34px, 9px corners: the section or component icon on `--accent-weak` in
     `--accent-text`; a lock on `--sunken` in `--muted` for a component the reader may not read.
   - **A kicker** of where it sits, in 11px `--muted` with dot separators: "Section · Body · Top
     level", "Component · In 6. Performance testing (bench)", "Section · Appendix · In
     Appendices".
   - **The title:**
     - for a section, the existing title field with its equation button (π, Ctrl Shift E);
     - for a component, its name as a link that opens the component (↗);
     - for one the reader may not read, "A component" in `--muted`.
   - **A row of chips:** the state lozenge (small), then facts as 18px chips with 4px corners,
     `--border` and `--muted`: "Number {n}", "{n} components", "Latest version, {n}" (or "Pinned to
     {n}", "Approved version, {n}" by the reference mode), "{n} fields".
   - **The unreadable note,** for a component the reader may not read, under the block: "You may
     not read this component. You can still change where it starts and whether it is numbered, or
     remove it from this document."
3. **Groups that fold.** Each group is a 42px header button (`aria-expanded`): its icon, its name,
   then, **only when shut**, a summary right-aligned and ellipsed, and a chevron. Groups:

   | Group   | Shown for                                | Summary when shut                                                           |
   | ------- | ---------------------------------------- | --------------------------------------------------------------------------- |
   | Layout  | every part                               | "{starts on} · numbered {n}" or "· not numbered", "· {matter}" at top level |
   | Fields  | a section whose template gives it fields | "{n} from the template"                                                     |
   | Readers | every part the reader may read           | the condition, or "Every reader"                                            |
   | Links   | every part the reader may read           | "{n} referring" or "Nothing refers", "· {n} components"                     |

   **What is open is remembered per person**, for the panel and not per part, with the panes' other
   remembered state. By default, Layout is open. Choosing another part keeps the same groups open.

4. **Layout.**
   - **Starts on** becomes a three-way icon control (`radiogroup`), 48px, on `--sunken`. Its options
     are Flows on, New page and Right page, each an icon over the short words. The full words
     ("Wherever it falls", "A new page", "A new right-hand page") are the tooltip and accessible
     name. The chosen one is on `--accent-weak` in `--accent-text`.
   - **Numbered** is a switch with a second line under its label: "Shown as {n}" or "Takes no
     number".
     - **Locked:** when an ancestor is not numbered, the switch is `aria-disabled` at half opacity,
       the line reads "Would be {n}", and the existing reason sits beneath with a lock ("Not
       numbered while {value1} is not.").
   - **The Number it offer (new).** When Numbered is off and the title starts with a typed number
     (`6.`, `6.1`, `A.2`), a row on `--accent-weak` reads "The title starts with “{n}”. Number it
     instead, so it stays right when parts move?", with a **Number it** button. Pressing it does
     two things as one operation:
     1. it turns Numbered on;
     2. it takes the typed number off the title.

     It is undoable as one step. It is an offer, never automatic.

   - **Matter,** at the top level only (STR-016, STR-064): the existing segmented control, Front,
     Body and Appendix, with its existing hint when Front matter cannot leave.
5. **Fields** (STR-060): the template's fields as today (`HeldFields`), under the line "From the
   document's template. Saved as you type." Each label has a small icon for its kind: text, person,
   date and choice. Identifiers are in Plex Mono.
6. **Readers** (REU-021, REU-026): the condition summary and **Set condition** (or **Change**), as
   today's row.
7. **Links.**
   - **Referenced by** (STR-074), with its count right: one 34px row per place, the cross-reference
     icon, its name, "{n} references", and a chevron that goes there. With none, the existing
     sentence ("Nothing else in this document refers to it.", or the unreadable variant), and
     "Checking." and "Could not be checked." as today.
   - **Where it is used** (STR-075; R14-B), with its count right: **one 38px row per component**,
     replacing the large "Where {title} is used" buttons. Each row has the component icon, its name,
     a pill and a chevron that opens today's Used in.
     - The pill reads "Only here" (plain, `--muted`), or "Here and {n} more" (`--accent-weak`,
       `--accent-text`).
     - The heading reads "Where its components are used" for a section, and "Where it is used" for
       a component.
8. **Removal is a modal**, opened from the header's red icon:
   - **Size and place:** centred on the window at 420px wide, over a scrim that greys the whole
     page (`rgba(4,7,10,.62)` dark, `rgba(21,32,43,.32)` light; make them `--scrim` tokens).
   - **Markup:** `role="alertdialog"`, `aria-modal="true"`, labelled by its question. Focus is
     trapped. **Keep has focus** on opening, `Esc` keeps, and focus returns to the red icon on
     close.
   - **Content:** today's `ConfirmRemoval` content, unchanged in meaning:
     - a bin tile on `--danger-bg`;
     - the question and the irreversible sentence;
     - the facts as a list: for a section, "It places {n} components. They stay in the library;
       only their place here goes."; for a component, "The component stays in the library; only
       its place here goes."; and the references sentence;
     - **Why it is removed,** only where the template requires a reason (`needsReason`, as today),
       with Remove disabled until it is given;
     - **Keep** (outlined) and **Remove** (solid `--danger`).
   - **Edge:** the dialog has a 1px `--danger` border, 12px corners, and the modal shadow.
9. **Nothing scrolls sideways.** Long names ellipse, with the full name as the tooltip. The groups'
   area scrolls under the fixed header and identity block.
10. **Light and dark** follow the user's theme. Tokens only.

## Measures

```css
:root {
  --part-head: 48px; /* icons 30px, glyphs 16px */
  --part-tile: 34px;
  --part-group-head: 42px;
  --part-starts-on: 48px; /* three-way icon control */
  --part-ref-row: 34px;
  --part-used-row: 38px;
  --part-chip: 18px;
  --part-modal-width: 420px;
}
```

The panel's padding is 14px either side. Group bodies sit 2px under their header and keep 14px at
the foot. Each group has a 1px `--border` under it. The switch is 34x20.

## Wording

Kept (`document.*`, `editor.*`):

- "Part", "Numbered", "Matter", "Front matter", "Body", "Appendix";
- the three page-break words, now tooltips and summaries;
- "Not numbered while {value1} is not." and the Front matter hint;
- "Set condition" and "Kept for every reader";
- "Referenced by" and its sentences, "Checking." and "Could not be checked.";
- the copied-link messages;
- every `ConfirmRemoval` sentence: "Why it is removed", "Remove", "Keep".

New, check each:

- "Go to it in the text", "Copy a link to {name}", "Remove section {name}", "Remove component
  {name}".
- "Flows on", "New page", "Right page".
- "Shown as {n}", "Would be {n}", "Takes no number" (exists as `editor.table-unnumbered-line`'s
  first half; give it its own key).
- "The title starts with “{n}”. Number it instead, so it stays right when parts move?", "Number
  it".
- "Layout", "Fields", "Readers", "Links"; "{n} from the template"; "Every reader"; "{n}
  referring", "Nothing refers", "{n} components".
- "From the document's template. Saved as you type."
- "Number {n}", "{n} components", "Latest version, {n}", "Pinned to {n}", "Approved version, {n}",
  "{n} fields".
- "Where its components are used", "Where it is used", "Only here", "Here and {n} more".
- "A component", and the unreadable note.
- "It places {n} components. They stay in the library; only their place here goes.", "The
  component stays in the library; only its place here goes."

No em or en dashes.

## Open questions

1. **"Here and {n} more"** needs a count of other places per component. Today Used in is fetched on
   demand. Answer the counts in one call for the part's components, or show the pill only once
   known.
2. **Number it.** Recognising a typed number: digits or a letter, then dot-separated parts, then a
   space. Confirm it should offer only when the typed number matches the number the part would
   take, or always.
3. **Go to it in the text.** Today, choosing a row in Contents scrolls the text. Confirm the header
   icon is the same operation, for the Part panel opened elsewhere.
4. **A shared modal.** If the app has no modal dialog part yet (`parts/`), make one here: scrim,
   focus trap, `Esc`, return focus. Use the equation dialog's behaviour if it has these. Removal
   and later confirmations use it.
5. **Remembering open groups:** per person, across documents (drawn), or per document like the
   Versions graph. The drawing assumes across documents.

## Not drawn

- The fields' editors open (the person picker, the date picker, the choice list).
- Set condition's editor.
- Checking and failed states for Referenced by and Used in (the wording is kept).
- A required reason left empty: Remove disabled.
- A read-only reader: no Remove, the controls read only.

## Example data

The titles, numbers, people, study identifier and counts are invented. Do not use them in fixtures.

## Order of work

One plan, two or three PRs. The modal part is the only shared piece.

1. Query the trace (`pnpm trace show STR-016`, `STR-038`, `STR-044`, `STR-060`, `STR-064`,
   `STR-074`, `STR-075`, `REU-021`, `REU-026`; `pnpm trace search part`, `remove`) and cite what
   exists.
2. This handoff's ADR; settle the open questions.
3. The identity block and the header icons. Move Copy link and Remove into the header; the foot
   and the link row go.
4. The groups, their summaries, remembering what is open.
5. Layout: the three-way Starts on, the Numbered line, the lock, Number it (with its undo).
6. Links: the compact Referenced by and Used in rows, the pills.
7. The modal part, and removal moved into it.
8. Move the existing tests' queries (`OutlinePanel.test.tsx`). Keep their requirement IDs and
   accessible names where the words are kept. Add axe checks for the header, the groups and the
   modal.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy.

Everything the panel does today stays:

- the title and equation;
- the template fields;
- Starts on, Numbered and Matter, with their rules;
- the conditions;
- the link;
- Referenced by and Used in;
- removal with its reason.

What is new:

- the identity block;
- the folding groups with summaries;
- the icon header with a red Remove;
- the three-way Starts on;
- the Number it offer;
- the compact used-in rows with counts;
- removal as a centred modal.
