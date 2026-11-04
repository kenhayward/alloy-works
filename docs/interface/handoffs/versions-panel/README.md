# Handoff: the Versions panel, a timeline by day

The Versions tab (`VersionsPanel`, `VersionList`; CNT-111, CNT-112, CNT-113) becomes a **timeline
grouped by day**, built for documents with tens or hundreds of versions. It has:

- an **activity graph** that can be minimised;
- **day headers that collapse** their day, and a toolbar icon that collapses or expands every day;
- **icon actions in colour**, including compare any two versions;
- a **whole-panel view** of one version, with its signatures, what changed and where it came from.

Drawn in the design canvas on 4 November 2026. Layout A (a timeline) was chosen from three, and
takes C's activity graph; B (a table) and C (milestones and runs) were dropped.

**Do the lifecycle states first.** Every state in this panel is a lozenge from
[`../../lifecycle-states.md`](../../lifecycle-states.md). That guide was approved with this handoff
and applies to **the whole app**, not this panel: build `Lozenge` and move every state shown
anywhere to it, as that guide's "Making the whole app use it" says, before or alongside this
panel. Its sheet is `../../lifecycle-states/lozenges.png`.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and the existing wording from `en-GB.json` (`editor.*`). Each screen has a `-light` and a
`-dark` `.html`, each self-contained, and a `.png` of each at 400x788 (2x), the panel's height in
the authoring page.

Delivered as a zip that unpacks at the repository root. It lives in
`docs/interface/handoffs/versions-panel/`, beside `docs/interface/lifecycle-states.md` and its sheet.

## Screens

| Files                 | Screen                                                                        |
| --------------------- | ----------------------------------------------------------------------------- |
| `list-*`              | The graph shown; today open; version 2.12 opened in place with its actions    |
| `days-collapsed-*`    | Today open, every earlier day collapsed to one line                           |
| `all-collapsed-*`     | Every day collapsed and the graph minimised: the toolbar offers it again      |
| `compare-pick-*`      | Compare mode: 2.10 chosen as A, 2.14 as B, the compare bar at the foot        |
| `delivered-version-*` | Version 2.10 taking the panel: facts, what changed, the delivery's provenance |
| `approved-version-*`  | Version 2.0: Approved, Effective, signatures, its baseline                    |
| `compare-*`           | Comparing 2.0 with 2.14: A and B, quick choices, what changed                 |

## Decisions to record (one ADR)

1. **A timeline, newest first, grouped by day.**
   - **Day headers:** "Today · 4 Nov", "Yesterday · 3 Nov", then "Mon · 2 Nov" and so on, with the
     year added past the current one. Each stays at the top of the list while its day scrolls.
   - **The timeline:** a 2px line runs down the left. Each version is a 12px node on it in its
     state's ink; a version that reached a state other than Draft has an 18px node with its state's
     icon.
   - **Loading:** the list loads a page at a time as it scrolls (the existing `limit`), and is
     virtualised past one screen.
2. **A version's line**, top to bottom:
   - the number and time in Plex Mono (`2.14 09:41`, tabular), a "Current" pill on the latest, and
     its lozenge (small size), right;
   - the avatar and who saved it (a system, such as CT Studio, has initials on `--avatar-6`);
   - the note, one line;
   - badges, each icon and words: Restored from {n}, Delivered, {n} signatures, the baseline's
     name, Effective from {date}.

   The line is the row's one control. Clicking it opens the version in place (decision 5).

3. **Day headers collapse.**
   - **Toggling:** clicking a header (or `Enter`, `Space`) folds its day to the one line
     (`aria-expanded`); clicking again opens it.
   - **A collapsed header** shows a ▸ chevron, the day, a dot lozenge for each non-draft state in
     that day (at most three), the avatars of who saved versions that day, and "{n} versions". An
     open header shows ▾ and the count alone.
   - **Collapse every day / Expand every day** is a toolbar icon (decision 6). It collapses all if
     any day is open, and expands all otherwise.
   - **What opens by default:** today is open; with the panel opened fresh, the other days follow
     the person's last choice for this document.
4. **The activity graph.**
   - **Where:** under the search, 46px of weekly bars in `--strong-border` (`--accent` for the weeks
     the list now shows), since the first version, or the last 12 months with a scroll back.
   - **Markers:** each approval is a diamond in `--ok` above its week.
   - **Window:** an outlined box in `--accent` marks the weeks the list is showing. Clicking a week
     moves the list there.
   - **Minimising:** a ⌃ glyph at its top right hides it. Once hidden, the toolbar shows a **Show
     the activity graph** icon (bars), which brings it back.
   - **Remembered:** the choice is per person and per document, with the panes' other remembered
     state. It is not a global setting: an annual procedure keeps it hidden while a submission
     keeps it shown.
   - **Default:** shown when the document has 20 versions or more; hidden below that until the
     person chooses.
5. **Opened in place.** Clicking a version opens it inside the list:
   - "Changes from the version before", with the counts changed, added and removed;
   - its icon actions (decision 7).

   One at a time; clicking again closes it. The latest shows its actions without being opened.

6. **The toolbar**, left to right after "Versions", the count and the line menu ("Main line ▾",
   today's lines, LOC-012). Every item is an icon:
   - **Save a version**, in `--accent-text`;
   - **Compare two versions**, a toggle (`aria-pressed`);
   - **Collapse every day** or **Expand every day**;
   - **Show the activity graph**, only while it is minimised;
   - **Go to a date**, which opens a date picker and moves the list there.

   Under them: search ("Number, note, person or date") and a **Filter** icon (state, person, only
   milestones, only deliveries, only signed).

7. **Actions are icons, in colour by meaning**, each with its words as accessible name and
   tooltip:

   | Action                                          | Icon     | Colour                             | Today                              |
   | ----------------------------------------------- | -------- | ---------------------------------- | ---------------------------------- |
   | View, read only                                 | eye      | neutral                            | Open (SCH-058)                     |
   | Compare with the current version                | ⇄        | `--accent-text` on `--accent-weak` | Compare, with the latest (CNT-111) |
   | Compare with the approved version               | ✓ circle | `--ok` on `--ok-bg`                | new                                |
   | Restore: preview, then make it the next version | ↺        | `--warn` on `--warn-bg`            | Restore (VER-035)                  |
   | Copy a link                                     | link     | neutral                            | new                                |
   | More                                            | ⋯        | neutral                            | new                                |

   More holds: Download as PDF, Edit the note, Pin to a baseline. The current version has no
   Restore. An approved version has Download as PDF in place of "compare with approved".

8. **Comparing any two.**
   - **Choosing:** in compare mode each version shows a box. The first chosen is **A**, the second
     **B**, and a third replaces the oldest choice.
   - **The compare bar** at the foot reads "Compare {A} → {B}", with Swap, Clear and **Compare**.
   - **The Compare view** takes the panel:
     - A and B as two pickers, each with its number, lozenge, time and who, and a swap between
       them;
     - "{n} versions apart · {n} people · {dates}";
     - quick choices: With approved {n}, With the version before, With my changes (today's My
       changes, CNT-112) and With a baseline;
     - "What changed", with the counts and each change, where it is and its kind; each goes to it
       in the redline.
   - **Header icons:** open the redline in the document (today's `Redline`) and export it.
9. **One version, taking the panel.**
   - **Header:** back (`Esc`), the number, its lozenge (default size), newer and older.
   - **Actions:** a row of the icon actions at 40px.
   - **Facts:** Saved, to the second (`3 Nov 2026, 11:12:08`), By, Line, Note, Restored from, and
     Effective.
   - **Signatures,** for a version with any: who, what the signature means, the time to the second.
   - **Changes from {previous}**, with counts and each change.
   - **Delivery,** for a delivered version: From, Asked by, Source and Delivery key. Hashes are
     shortened in the middle (`sha256 31f4a8e2…7c228c`), shown in full on hover, with a **Copy in
     full** icon. **Nothing in this panel ever scrolls sideways.**
   - **In baselines:** a chip for each, linking to the baseline.
10. **Light and dark** follow the user's theme. Tokens only, and the lozenges from the guide.

## Measures

```css
:root {
  --version-node: 12px; /* 18px for a version that reached a state other than Draft */
  --version-day-head: 36px;
  --version-graph: 46px; /* bars; 2px apart; diamonds 8px */
  --version-action: 32px; /* 30px high in place; 40px in the whole-panel view */
  --version-pick: 18px; /* A and B boxes */
}
```

The timeline's line is 2px `--border`, 21px from the panel's edge. Version lines have 8px vertical
padding and a 1px `--border` beneath. The compare bar has a 1px `--accent` top edge. Lozenges are
measured in the guide.

## Wording

Kept (`editor.*`): "Versions", "Compare", "Restore", "Restore this version", "My changes",
"Restored from version {n}", "Open", the restore preview's sentences, and "No version has been
saved" and "The versions could not be read".

New, check each:

- "Today · {d MMM}", "Yesterday · {d MMM}", "{EEE} · {d MMM}"; "{n} versions" and "1 version".
- "Current"; "Versions a week"; "Shown: {from} to {to}"; "Hide the activity graph"; "Show the
  activity graph"; "Collapse every day"; "Expand every day"; "Go to a date"; "Save a version";
  "Compare two versions"; "Number, note, person or date".
- The actions' names in decision 7; "Copy in full"; "Download as PDF"; "Edit the note"; "Pin to a
  baseline".
- "Changes from the version before", "Changes from {n}", "{n} changed", "{n} added", "{n}
  removed".
- "Choose two versions to compare", "Choose one more version to compare with {n}", "Compare {A} →
  {B}", "Swap", "Clear".
- "{n} versions apart · {n} people · {from} to {to}", "With approved {n}", "With the version
  before", "With my changes", "With a baseline", "What changed".
- "Saved", "By", "Line", "Note", "Effective", "Signatures", "Delivery", "From", "Asked by",
  "Source", "Delivery key", "In baselines".
- Badges: "Delivered", "{n} signatures", "Effective from {date}".

No em or en dashes.

## Open questions

1. **Does a version carry a state?** The drawing shows the state each version reached (2.0
   Approved, 1.12 In review, 1.11 Returned, 1.0 Superseded). If only the document carries a
   workflow state today, versions need to record the transition they were part of. That is a stored
   shape: plan and migration.
2. **Signatures and Effective** come from the approval tranche and `lifecycle/Dates.tsx`. Show them
   only where the service answers them.
3. **Compare any two.** Check that the compare route takes any pair, not only "with the latest".
4. **Delivery provenance** is one long note today. Store it as fields (source system, source hash,
   delivery key, asked by), or parse the note in one tested place.
5. **Change summaries** per version (changed, added, removed) need the counts from the service, or
   a cheap comparison per version. Do not compute a full comparison per row on the client.

## Not drawn

- The Filter menu, the line menu and the Go to a date picker.
- More's menu.
- The restore preview, which stays as it is, opened from the Restore icon.
- Empty, failed, and read-only (no Save a version, no Restore).
- A component's versions. The panel is the same, without Effective or signatures unless its
  workflow has them.

## Example data

The people, notes, numbers, hashes and the delivery source are invented, apart from the CT Studio
deliveries author, which is the system's own name. Do not use them in fixtures.

## Order of work

Multi-PR, with a possible stored shape (version states, provenance fields), so it gets a written
plan with pre-flight review (`docs/plans/README.md`).

1. Query the trace (`pnpm trace show CNT-111`, `CNT-112`, `CNT-113`, `VER-033`, `VER-035`,
   `LOC-012`, `SCH-058`, `LIF-005`; `pnpm trace search version`, `state`) and cite what exists.
2. **The lifecycle states, app-wide**, per [`../../lifecycle-states.md`](../../lifecycle-states.md):
   its ADR, `Lozenge`, the guard test, then every surface moved. This can ship before the panel.
3. This handoff's ADR; settle the open questions.
4. The timeline: day groups, version lines, lozenges, paging and virtualisation.
5. Collapsing days and its toolbar icon; remembering per person and document.
6. The activity graph, minimising, remembering, and the default rule.
7. Opened in place and the icon actions, keeping Open, Compare and Restore's behaviour.
8. Compare mode, the compare bar and the Compare view, on the existing redline.
9. The whole-panel version view: facts, signatures, changes, delivery, baselines.
10. Move the existing tests' queries (`VersionsPanel.test.tsx`). Keep their requirement IDs and
    accessible names. Add axe checks for the toolbar, the day headers and the compare bar.

## For Claude Code

Read this README and [`../../lifecycle-states.md`](../../lifecycle-states.md), and open the `.png`
files, before planning. Treat the HTML as a measured drawing, not code to copy. The lifecycle guide
is app-wide work: it changes every place a state is shown, not only this panel, and it stays the
master reference afterwards.

Open, Compare with the latest, My changes, Restore with its preview, notes, restored-from and lines
already exist. What is new:

- the timeline by day and collapsing days;
- the activity graph and remembering it;
- the coloured icon actions;
- comparing any two, and the Compare view;
- the whole-panel version view, with signatures, change summaries and delivery provenance;
- the lozenges.
