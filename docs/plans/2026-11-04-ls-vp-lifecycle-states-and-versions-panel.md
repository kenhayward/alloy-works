# LS and VP: one way to show a state, and the Versions panel as a timeline

> From [the versions panel handoff](../interface/handoffs/versions-panel/README.md) and
> [the lifecycle states guide](../interface/lifecycle-states.md). **Full tier**: several PRs and a new
> contract, so a plan with a pre-flight. No migration. **D1 to D11 are Ken's rulings, 2026-11-04.** The pre-flight's thirteen findings are folded in.

**Goal:** a state looks and reads the same everywhere and the repository enforces it (LS); a person
can read, compare and restore across hundreds of versions (VP).

## The answer to the open question: a historical version has no lifecycle state

**"Superseded" is absent for versions: neither stored nor derived today, and no requirement asks for
it.** "Every old version is Superseded" is wrong. "An old revision that a newer one has replaced is
Superseded" is right, and is what this plan builds, derived.

| Evidence                                                                                                                                                                                                                                                                            | Says                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **LIF-048** (Constraint): "State must belong to the artifact rather than to a revision", and a revision "never changes state afterwards"                                                                                                                                            | The rule. The guide's "Version: the state it reached" breaks it |
| **LIF-049**, **LIF-077**: rework moves the artifact to a draft; the revision stays designated and effective                                                                                                                                                                         | Artifact Draft and revision Effective at once                   |
| **VER-012**, [ADR-0006](../decisions/0006-iteration-version-revision.md): a revision is a designation on a version                                                                                                                                                                  | Two levels: most versions are never issued                      |
| `workflow_transition` (0095, 0112): the latest row per artifact and line is the state. `artifact_version` is insert-only with no state column                                                                                                                                       | State is stored on moves, per line                              |
| `GET .../versions` answers id, number, createdAt, author, note, restoredFrom                                                                                                                                                                                                        | No state or revision reaches the list                           |
| Superseded where it does exist: **VER-049** baselines (stored, 0072); **PUB-059** publications (derived, `supersession` in `publishing.ts`); bibliography entries (0175, LIB-035); **AST-033** asset versions (unbuilt). Migration 0072's row: "kept, read and published as before" | Never a component's or a document's version                     |

Why "Superseded" fails as the word for every old version:

1. **It carries no information.** In the drawing's 76 versions, 75 would wear the same lozenge.
2. **It claims what did not happen.** The guide defines it as "a newer approved version replaced it".
   Draft 2.13 was never approved and replaced nothing.
3. **"A newer approved one" is not the test, for a revision either.** A revision approved with a future
   date is not in force yet (LIF-060). A newer unscoped revision does not displace a scoped one
   ([workflow.md, Scopes](../design/workflow.md#scopes); LIF-042). One waiting on acceptance leaves the
   one before effective there (LIF-047). So it must come from `effectiveRevision`, per scope.

The drawing's "Draft" on every row has the same fault: 2.13 is not a draft, it is a record of what was
saved while the artifact was in Draft.

**What follows (D1):**

- **A version:** no lozenge. Number, time, who, note. The latest also says **Current**.
- **The artifact's state:** one lozenge at the panel's head, for the line open (LIF-005, LIF-048).
- **A revision:** a version a gate designated also shows **Revision N**, and a lozenge for the state its
  gate moved it to, which is fixed (LIF-048; a second gate on an unchanged version keeps the first, the
  designation being one act), plus its **standing**, computed when read over the revisions of the line
  shown, as they stood in time:
  - `pending`: approved, not yet in force anywhere;
  - `effective`: in force somewhere, naming where;
  - `superseded`: was in force, now displaced everywhere it held, naming what displaced it;
  - `neverInForce`: replaced before it took effect (two revisions approved before one effective date, or a
    scoped one still unaccepted when the next was). It shows no standing lozenge.

  A pure function in `packages/domain` beside `effectiveRevision`, taking designation, effective and
  acceptance instants: `revisionScopes` answers only what is pending now, so "was in force" needs that timed
  input. A language line's revisions have their own rule (`translation.ts:770`) and show their state alone
  in VP1.

- **Nothing stored**, so no migration; one contract addition (VP1). Handoff open question 1 falls away.

## Decisions for Ken

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Versions carry no state**, as above. Against: the handoff's "the state it reached", and Ken's "superseded".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D2  | **The rule covers the life of content, not every status.** Lozenge for documents, components, query definitions, prompts, terms, versions and revisions, publications, baselines, threads, suggestions, translations, connections' Retired. Operational statuses (a person Invited, a webhook Off, a session, a sign-in provider Open) stay `Chip`, listed in the guard with the reason. The guide's "every state of every thing" would pull 15 admin surfaces into a vocabulary built for documents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D3  | **Replace "never more than two".** State first, then every condition a requirement makes visible; none hidden in a tooltip. LIF-018 (past review), LIF-046 (diverged) and LIF-021 (hold) each say visible, and a `title` reaches no keyboard or touch user. Archived and Effective are conditions, never the first lozenge: an archived artifact keeps its workflow state (LIF-005, WF-K) and one in Draft may have an Effective revision (LIF-049).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D4  | **The kinds change.** Add `pastReview`, `diverged`, `retired`, `resolved`, `pending`, `accepted`, `rejected`, `released`, the round's three (COL-029), the five of LOC-030, `current`. Keep `returned` and `inApproval`, mapped by key only: the seed rejects to Draft, so nothing shows them until a tenant declares them; no seed change. **Drop `withdrawn` as drawn:** `review.withdrawn` is an author taking back a suggestion, not "taken back after approval" (LIF-014, unbuilt); a suggestion's Withdrawn keeps the word, in `muted`, and the approval's meaning arrives with LIF-014.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D5  | **Small lozenge words at 11px, not 10.** ADR-0046's scale stops at 12, and 10px is the one size that holds a meaning a person must read. Check by rendering at 18px height; 10px only if 11 breaks a row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D6  | **Action icons neutral, Compare in accent; no `ok` or `warn` on actions.** ADR-0046: "A status colour means only its status". A green compare button and an orange Restore say Approved and Warning. The handoff's alternative is to amend ADR-0046 too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D7  | **Not built, because the system disagrees.** Edit the note (`artifact_version` is insert-only). Pin to a baseline (a baseline is of the latest). Download as PDF only where a publication already names that version (`PublicationSummary.version`), linking to it: generating one for an old version is no act the system has. **Signatures** become **Approvals**, the rows `workflow_approval` has: signing is LIF-011, LIF-012 and LIF-076, unbuilt, the SG plan's, and calling an approval a signature is the claim LIF-033 forbids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D8  | **A document's comparison is its outline and values.** A document's version records outline, values and parameters; the text of a tracking reference has its own chain. So a document's "Changes from" lists sections moved, added, removed or retitled and references or values changed, never "Executive summary: changed". New `GET /v1/documents/{id}/comparison`, in VP1 because opened in place needs it; `documentComparison` is outline only (`restore.ts:194`), so it gains values and parameters. **With approved**: a component's, its own route with the revision's version; a document's, this route, plus **Open the baseline's comparison** where its gate took one. A gate need not take a baseline (`baseline` defaults false), and `/v1/baselines/{id}/comparison` takes only a later baseline or `now`, so it cannot be the general answer. Line menu and Save a version are a component's alone (0112 is `kind = 'component'`; no document POST).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D9  | **No virtualising until measured.** Pages by the existing cursor, measured at 500 rows; sticky headers and focus across a virtual list are the likelier break. Remembered choices stay in `localStorage` per browser and document, as the panes' are (`DocumentPage.tsx:758`), not per person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D10 | **The activity graph ships last, on its own route.** It needs weekly counts and approvals from the service, and is one tab stop with arrow keys, not 52 buttons. Lowest value per cost in the handoff; it can be cut without touching the rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D11 | **A document's timeline shows its baselines, each a row of its own at the moment it was made**, in place of the drawn badge and "In baselines" chips. A baseline is not a fact about a version: it names one (`document_version_id`) but pins the component versions of its own moment, so two baselines on one document version may hold different text, and an edit to a tracked component cuts no document version. They are the only points in a document's history with a whole text. The row: flag, name, time, who, the version it names, Superseded where it is (VER-049), **Open** and **Compare with now**, both existing. A gate's baseline says so. Not a version: not in the count, no node, not chooseable as A or B, and **With a baseline** stays the way to compare one. Making, publishing and superseding stay on the Baselines tab. A component's timeline has none. **Publications too (Ken, 2026-11-04):** a row of its own at `publishedAt`, by `GET /v1/documents/{id}/publications`, so only those the caller may read and never a failed request. The row: send icon, time, who, the version it names, the baseline it came from, formats; **Published**, then **Approved** or **Not approved** as `approval` answers, then Superseded where a later one is (PUB-059). **Open**, and Download where the output exists, which is D7's Download as PDF in its honest place. Not a version either: no node, not counted, not chooseable. Filter gains only baselines and only publications; the collapsed day's dots count both. |

## What the drawings get wrong, beyond the rulings

- **`2.0` and `1.0` cannot exist on the main line.** VER-009 and `workflow-gates.test.ts`: a designated
  version keeps its number and the next is `1.1`. Revision 2 reads "Revision 2, version 1.12", and the
  sample's "Compare 2.0 with 2.14" becomes that. A divergent line's version does renumber when designated
  (`lines.ts:277`, `<=`), so links and A and B hold the id, never the number.
- **The panel loses Who decided what.** `ApprovalsList` (WF2-L, LIF-008) holds rejections and their reasons
  (LIF-051) and has no place drawn. It stays, artifact-wide, under the timeline as a collapsed section: with
  no state on a version, moving it into one version's view would bury every rejection. That view shows its
  own rows too.
- **Delivery provenance** (open question 4) is already fields: `bridge_delivery.provenance`, with the note
  written from them (`deliveryNote`). Read those through the receipt; never parse the note.
- **Compare any two** (open question 3): a component's route takes any pair (VER-025, CNT-112). A document
  has none (D8). The A and B pickers reach versions beyond the page loaded, through `q` (VP2).
- **Change counts** (open question 5): shown only on a version opened in place, so one comparison on
  opening; no per-row work (a document's needs the D8 route).
- **Effective and approvals** (open question 2): read from `/effective` and `/approvals`.
- **"Today" is the reader's** (LIF-062): day groups use their zone, not the service's.

## What the guide gets wrong, beyond the rulings

- **The guard as drawn cannot work.** "Text not inside `[data-kind]`" collides with `Home.tsx:155`,
  `OutlinePanel.tsx:1123` and `:1135`, which use that attribute for other things, and "renders each
  screen's fixture" names a registry that does not exist. See [the rule](#the-rule-as-the-repository-holds-it).
- **"Line, baseline, thread: none today" is false.** Baseline Superseded and Current is stored and shown
  (`BaselinePage.tsx:317`, in `warn`; the guide's `muted` changes it). A thread shows Resolved
  (`ThreadsPanel.tsx:1276`). Suggestions, rounds and translations all have states it omits.
- **A publication is not Never published or Changed since.** Those are a document's publishing standing
  (`DocumentList.tsx:425`). A publication's own is Approved or Not approved (`PublicationPage.tsx:376`),
  which the table omits, and Superseded (PUB-059).
- **The 3:1 edge claim is false.** Measured from `tokens.css`: `--strong-border` is 1.56:1 on `--surface`
  and 1.37 on `--sunken` in light, 1.67 and 1.77 in dark. Words pass at 5.2 to 15:1, and `muted` holds at
  5.5 on a selected row, so nothing fails, because the words carry it. Drop the claim; keep 4.5:1 for words.
- **No forced-colours rule.** Grounds vanish there and `transparent` edges show as nothing. Add one, as
  `States.module.css` does for its dot (CNT-138).
- **`beingEdited` is "built" with no caller.** Only tests use it; editing shows through `Notice`.
- **Aliases are not needed.** One catalogue (`en-GB.json`), so keys move. 63 keys hold a state word today,
  five of them "Archived".
- **The stepper stays a stepper.** `DocumentHeader`'s strip lists a workflow's states with the current one
  marked. The current step gains the lozenge; the others stay names.
- **Published output has no lozenge and needs none.** The "Not approved" notice is the layout's words
  (`DRAFT_NOTICE`, `publication/*/main.typ`). Out of the rule, unchanged.

## Found by the way: two bugs

- `PublicationList.tsx:201` draws **Not approved** on every row though the listing answers `approval`, and
  `Publishing.tsx:540` says the same as plain text, so a gate's approved publication reads Not approved
  there and Approved on its page (WF2-I). `baseline` rightly stays Not approved. An issue, a reproducing
  test, and the fix in LS's first task.
- `effectiveAt` (`scopes.ts:353`) does not exclude language lines; `latestRevisionsOf` does
  (`workflow.ts:141`). So **Effective for** may answer a translation's revision. Unproven: an issue and a
  reproducing test first, in VP1, since standing rests on the same reading.

## Inventory: what LS moves

Line numbers at `cf772dc8c`; the PR carries this as its checklist.

| Today               | Where                                                                                                                                                                                                                | Becomes                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `StateLozenge` (15) | Inbox, Home, PromptPage, Terms, TermPage, UsedIn, SearchPage, ComponentEditor, QueryDefinitionPage, ComponentList, DocumentList, BaselinePage, SpacePane, OutlinePanel (2)                                           | Same call; new look; `small` in rows       |
| `Lozenge` (3)       | PublicationList:201, DocumentList:425, DocumentText:741                                                                                                                                                              | Words from the catalogue                   |
| Archived chip       | ComponentEditor:2802, ComponentList:359, DocumentList:411, DocumentPage:2844, VersionPages:102 (in `warn`), Spaces:176                                                                                               | `archived`                                 |
| On hold chip        | ComponentEditor:2804, DocumentPage:2845                                                                                                                                                                              | `onHold`                                   |
| Past review chip    | Dates:73, ComponentList:372, DocumentList:419, DocumentText:782                                                                                                                                                      | `pastReview`                               |
| Publication chips   | PublicationPage:376, :378; superseded notice :387 keeps its sentence, gains the lozenge                                                                                                                              | `approved`, `notApproved`, `superseded`    |
| Baseline chip       | BaselinePage:317; BaselinesTab's filter is a label, an exception                                                                                                                                                     | `current`, `superseded`                    |
| Effective chips     | Dates:62, :75; Scope:99, :110. Each keeps its date or scope in words beside the lozenge                                                                                                                              | `effective`, `pending`                     |
| Diverged chips      | SearchPage:641, ComponentList:376, DocumentText:769 (:766 is a line's name, not a state)                                                                                                                             | `diverged`, with its lines' names          |
| Thread chips        | ThreadsPanel:1276, ThreadPage:155                                                                                                                                                                                    | `resolved`                                 |
| Translation chips   | Translations:87, DocumentText:776, SpaceTranslations:47                                                                                                                                                              | LOC-030's five                             |
| Retired             | ConnectionPage:714, QueryDefinitionPage:1516, uses:111 (chips); Connections:366, QueryDefinitions:217 (plain)                                                                                                        | `retired`                                  |
| Plain text          | SuggestionsPanel:369, RoundsPanel:258 and its Closed, DocumentHeader's current step, Publishing:540, DataTab:447 with `dataStates.ts`, BaselinesTab:235, bibliography/EntryPage's source flag                        | Lozenge                                    |
| Holds               | Holds:117, :120 (In force, Released): a hold's own life                                                                                                                                                              | `onHold`, `released`                       |
| Stay `Chip` (D2)    | People:89 to 96, Spaces:178 (Active), SignIn:541 to 548, Webhooks:394 to 396 and :160, Extensions:363, Sessions:118, Models:578, Roles:207, TenantExport:230, ImportPage:945, AuditLog:415                           | Listed in the guard, with the reason       |
| Not states          | Save indicator (CNT-068), `Notice` tones, Revision N (`RevisionChip`), version numbers, filter labels (`Listing:124`, `:132`, CohortList), column headers (`Holds:85`, `Deleted:120`, `Workflows:313`), `auditWords` | Unchanged; word collisions go in the guard |

Tokens: none new for colour. `--radius-pill` exists. `Lozenge` stops wrapping `Chip`; `Chip` gains no tone.
Requirement LIF-005's tests keep their titles; they read `data-kind`, which stays.

## The rule as the repository holds it

1. **ADR-0081, "Lifecycle states are lozenges"**, amending ADR-0046 decision 4 for lozenges; index row;
   recording D2 to D5.
2. **`CLAUDE.md` and `AGENTS.md`, Conventions**, in the same words (`agents.test.ts`): "**A state of
   content is shown only through `Lozenge`, in icon and words**: `docs/interface/lifecycle-states.md`."
3. **`docs/interface/lifecycle-states.md`** amended by these rulings, the master reference; the handoff's
   README and sheet stay as received, the sheet redrawn where a kind changes. `docs/interface/README.md`
   item 8 and `screens/States.html` point to it.
4. **The guard, in two halves:**
   - **`apps/web/src/states/lozenge-guard.test.ts`:** a catalogue key whose value is, or starts with, a state
     word must be under `states.*`, or excepted by key and file with its reason. A second "Archived" or a new
     "Superseded by {x}" fails. "Open" and "Done" are left out: mostly verbs, so all noise. And every
     `LozengeKind` has a tone, an icon, a word and a row in the guide's table, and each row a kind, so
     changing one alone fails.
   - **An ESLint rule**, beside the interface-words rule that already runs this way: a literal `states.*` key
     outside `Lozenge.tsx` and its word table fails, in `.ts` as well as `.tsx`; so does `data-kind` naming a
     `LozengeKind`, and `state.name` as a JSX child outside `StateLozenge`.
5. **The browser walks:** axe over a sheet of all kinds in both themes, and in forced colours; on the
   existing walks, no text node equal to a state word outside `[data-lozenge]`.

**What the guard cannot catch:** a new state under a new word nobody listed (review is the only answer),
and a state word passed through a table the rule cannot follow (`PUBLISHING.find().label`) until the
runtime walk meets it.

**Two new requirements**, through the issue form and `pnpm trace draft`, neither superseding a row:

- a LIF row: a state must be told by words and a mark as well as colour, and stay told in a high-contrast
  mode (CNT-138 covers suggestions alone). The guard's and `Lozenge`'s tests cite it.
- a VER row: a version list must say which versions are revisions, and whether each is pending, effective,
  superseded or never in force, and a document's must show its baselines and publications where they fall. And `workflow.md` claims LIF-048 only if the tests show it in full; otherwise the gap is
  named beside the table.

## The work

### LS: one PR, closing the slice (minor bump, baseline, `docs/architecture.md`)

**Built, 0.232.0.** Measured from a page of every kind in both themes: 22px, 18px and 20px, the widest small lozenge 152px at 11px, and every icon draws. Differs from above: the sheet is not redrawn, and the guide wins where it differs; the axe sheet of every kind became a unit test of every tone's contrast from `tokens.css`, since the app has no page holding every kind; a binding's eight states and the source flags joined the kinds; the VER row waits for VP1, which demonstrates it.

Fits one PR: no contract, nothing stored, and a half-moved vocabulary is worse than a large diff.

1. Issue and fix for `PublicationList`, test first.
2. `Lozenge`: `kind`, `size`, `content`; icons in `Icon.tsx` (a `dashed` variant for Draft; the stroke
   widths the guide gives); `data-kind`, `data-size`, `data-lozenge`. Tests per kind and size. Render both
   themes and measure before moving anything.
3. `states.*`, then every row of the inventory, by directory. Sizes per the guide.
4. Guard, last, so its red list is the checklist's proof. Its exceptions reviewed line by line.
5. ADR, conventions, guide, requirements, fragment, close.

Tests moved by tone or text: `Lozenge`'s callers assert `data-kind`, kept. Run the accessibility and
navigation walks. Moved tests and two new rows shift `trace.json` and `trace.test.ts`'s pins: run the trace
`generate` after prettier, and bump them.

### VP: three PRs, the last closing the slice

**VP1 built.** Differs from below: standing reads every line but a language's, as `effectiveAt` does, so it can never disagree with what is effective; older rows come by a **Show older versions** button, which is what D9's measuring is to judge; a row is latest by being first, `current` serving other clients; Download follows the output in a hidden frame; the head's lozenge is the main line's, a line having its own header.

**VP1, the timeline.** Contract: each item of both `versions` routes gains `revision` (`{ number, state
{ key, name }, standing, scopes, at }`, null for most) and `current`; `BaselineSummaryView` gains `version
{ id, number }` and `gate` (D11); `openapi.json` and the client regenerated. The baseline list is unpaged,
so it is read once and merged by `madeAt`. Each publication gains `superseded`, batched: `supersession` in `shares.ts` asks of one, and a row per page must not. Versions and publications page apart, so a row shows only down to the older of the two streams' last rows, or one would appear out of order and then gain neighbours. Measured with the 500 rows of D9. `revisionStanding` in the domain, then the list reads it in one query. `VersionsPanel` and
`DocumentVersions` share one `VersionTimeline`, with what differs (line, save, restore's preview,
comparison) passed in. `GET /v1/documents/{id}/comparison` (D8), on `read`, never naming what the caller may
not read, as restoration's titles do. Day groups in the reader's zone, sticky headers, collapse with `aria-expanded`,
the node line, opened in place, icon actions, cursor paging. Keeps CNT-111 to CNT-113, VER-033, VER-035,
SCH-058 and LOC-012's titles and accessible names.

**VP2 built.** Differs from below: a version's delivery comes on `GET .../versions/{version}`, found by its receipt; the `Line` fact waits for the line's name, which the panel does not hold; a component's In baselines section is gone with VP1.

**VP2, comparing and one version.** `versions` gains `q`, which the pickers need. One version's
**In baselines** is the D11 list filtered by version; a component's section drops. Compare mode (A, B, third replaces the
oldest, checkboxes in name and role), the bar, the Compare view, quick choices. The one-version view:
facts, approvals, changes, delivery (shortened hash, Copy in full, no sideways scroll), baselines.

**VP3, finding.** `versions` gains `before` and filters; a weekly `activity` route with approvals;
the graph (D10), search, Filter, Go to a date. Measures against VER-051's budget. ADR-0082, the panel's
decisions; `README.md` and `features.md`; close.

Each PR: the fragment, and `ADR` or docs as noted. Real application at each close, both themes, a
document and a component with 100 versions, in the dock's real width.

## Not doing

Storing a state per version. `Returned` as a seed state. Signatures. Editing a note. A document's text
comparison across arbitrary versions (a tracking reference pins no component's version; a baseline does).
