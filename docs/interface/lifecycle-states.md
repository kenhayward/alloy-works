# Lifecycle states

**The master guide to showing a state of content in Alloy Works.** A state is shown one way, by one
component, everywhere: the lozenge. Decided in [ADR-0081](../decisions/0081-lifecycle-states-are-lozenges.md),
from Claude Design's guide as Ken ruled on it ([the plan](../plans/2026-11-04-ls-vp-lifecycle-states-and-versions-panel.md),
D1 to D5). The sheet, [`lifecycle-states/lozenges.png`](lifecycle-states/lozenges.png), is the drawing as
approved, of the kinds it had then and with small words at 10px; where it and this guide differ, this guide
wins, and it wins over any handoff too.

## The rule

1. **Every state of content is shown through `Lozenge`** (`apps/web/src/states/Lozenge.tsx`): a document,
   component, query definition, prompt, term, revision, publication, baseline, thread, suggestion, review
   round, translation or binding. Never as plain text, a bare `Chip`, a coloured word or a lone dot.
2. **Operational statuses stay `Chip`:** a person Invited, a webhook Off, a session, a sign-in provider Open,
   an export's outcome. They are not the life of content.
3. **Icon and words, always** (LIF-078). Colour is never the only signal.
4. **The tone says what the state means**, by the table, and nothing else.
5. **The words are the catalogue's** (`states.*`) for built-in states, and the tenant's own name for one a
   tenant declares (LIF-005), never translated. A lozenge may carry the facts a state is shown with:
   "Superseded by Issue 2", "en-GB: Out of date".

## The states

| Kind (`LozengeKind`)    | Words                   | Tone      | Icon           | Means                                                  |
| ----------------------- | ----------------------- | --------- | -------------- | ------------------------------------------------------ |
| `draft`                 | Draft                   | `neutral` | dashed circle  | being written; not sent                                |
| `beingEdited`           | Being edited            | `info`    | pencil         | somebody else has it open; kind ready, no caller yet   |
| `returned`              | Returned                | `warn`    | back arrow     | a tenant's state, key `returned`; the seed has none    |
| `inReview`              | In review               | `info`    | eye            | reviewers are reading it                               |
| `inApproval`            | In approval             | `info`    | clock          | a tenant's state, key `in_approval`; the seed has none |
| `approved`              | Approved                | `ok`      | ticked circle  | decided; a publication a gate approved                 |
| `effective`             | Effective               | `ok`      | starred circle | a revision in force, from its date, where its scope is |
| `published`             | Published               | `ok`      | send           | a document has a publication                           |
| `changedSince`          | Changed since           | `warn`    | warning        | a document differs from what was published             |
| `notApproved`           | Not approved            | `warn`    | dash circle    | a publication made from no gate's approval             |
| `pastReview`            | Past review             | `warn`    | calendar       | past its review-by day (LIF-018)                       |
| `onHold`                | On hold                 | `warn`    | pause          | kept from change or deletion (LIF-021)                 |
| `released`              | Released                | `muted`   | open lock      | a hold that has ended                                  |
| `superseded`            | Superseded              | `muted`   | arrow          | a baseline, publication or source replaced             |
| `current`               | Current                 | `neutral` | dotted circle  | a baseline not superseded                              |
| `archived`              | Archived                | `muted`   | box            | kept, no longer in use (LIF-020)                       |
| `retired`               | Retired                 | `muted`   | power          | a connection or definition that runs nothing now       |
| `neverPublished`        | Never published         | `neutral` | dash           | a document with no publication yet                     |
| `notYoursToRead`        | Not yours to read       | `neutral` | lock           | you may not open it                                    |
| `diverged`              | Diverged                | `neutral` | branch         | it has divergent lines, named beside (LIF-046)         |
| `pending`               | Pending                 | `info`    | hourglass      | a suggestion undecided; a revision waiting             |
| `accepted`              | Accepted                | `ok`      | tick           | a suggestion taken                                     |
| `rejected`              | Rejected                | `warn`    | cross          | a suggestion turned down                               |
| `withdrawn`             | Withdrawn               | `muted`   | crossed circle | a suggestion its author took back                      |
| `resolved`              | Resolved                | `muted`   | ticked square  | a thread finished with                                 |
| `notStarted`            | Not started             | `neutral` | circle         | a reviewer has not begun (COL-029)                     |
| `inProgress`            | In progress             | `info`    | turning arrow  | a reviewer is reading                                  |
| `complete`              | Done                    | `ok`      | tick           | a reviewer has finished                                |
| `closed`                | Closed                  | `muted`   | dashed square  | a review round ended                                   |
| `untranslated`          | Untranslated            | `warn`    | dash           | no translation yet (LOC-030)                           |
| `machineDrafted`        | Machine drafted         | `info`    | spark          | drafted by a model, not yet translated                 |
| `inTranslation`         | In translation          | `info`    | clock          | a job is out                                           |
| `translated`            | Translated              | `neutral` | globe          | translated and in step                                 |
| `outOfDate`             | Out of date             | `warn`    | warning        | its source has changed                                 |
| `neverResolved`         | Never resolved          | `neutral` | dash           | a binding with no result yet                           |
| `changedSinceResolved`  | Changed since resolved  | `warn`    | warning        | a binding's result is stale                            |
| `failed`                | Failed                  | `danger`  | crossed circle | a binding's check failed                               |
| `revisionWaiting`       | Revision waiting        | `warn`    | clock          | a binding's revision awaits a decision                 |
| `definitionChanged`     | Definition changed      | `warn`    | warning        | a binding's definition moved on                        |
| `revisedByHand`         | Revised by hand         | `neutral` | pencil         | a person stands in front of the result                 |
| `changedSincePublished` | Changed since published | `warn`    | warning        | a binding differs from what was published              |
| `holding`               | Holding                 | `ok`      | tick           | a binding holds a current result                       |
| `retracted`             | Retracted               | `danger`  | crossed circle | its source says retracted (LIB-035)                    |
| `corrected`             | Corrected               | `warn`    | pencil         | its source says corrected (LIB-035)                    |
| `state`                 | the tenant's own name   | `neutral` | square         | a state a tenant declared (LIF-001, LIF-005)           |

Words are in the catalogue and paths in `Icon.tsx`, on a 24px grid; a test holds kinds, words, icons and this
table together. A kind may stand ready with no caller; a screen shows one only when the service answers it.
**Returned and Not approved are different:** one is a step in a workflow, the other a fact about a publication.

## Which things have which states

| Thing                                              | Its state, first                                     | Conditions after it                                                  |
| -------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Document, component                                | its workflow state, always (LIF-005), a tenant's too | Archived, On hold, Past review, Effective, Diverged                  |
| Document, publishing                               | Published or Never published                         | Changed since                                                        |
| Publication                                        | Approved or Not approved                             | Superseded                                                           |
| Baseline                                           | Current or Superseded                                |                                                                      |
| Thread, suggestion, reviewer, translation, binding | as the table                                         |                                                                      |
| Version                                            | **none** (LIF-048). The artifact holds the state     |                                                                      |
| Revision                                           | the state its gate moved it to, fixed                | what it stands as now: pending, effective, superseded (the VP slice) |

## Combining

State first, then **every condition a requirement makes visible**. None is hidden in a tooltip, which no
keyboard or touch reaches. Archived and Effective are conditions, never the first lozenge: an archived
artifact keeps its workflow state, and one in Draft may have an Effective revision (LIF-049). A collapsed
group shows the dot size for each distinct state in it, at most three.

## Tones

A tone is a meaning, not a colour, from existing tokens.

| Tone      | Ground        | Ink        | Edge              | Means                           |
| --------- | ------------- | ---------- | ----------------- | ------------------------------- |
| `neutral` | `--sunken`    | `--text`   | `--strong-border` | a fact; nothing to do           |
| `info`    | `--info-bg`   | `--info`   | none              | in progress, or somebody else's |
| `ok`      | `--ok-bg`     | `--ok`     | none              | decided, and good               |
| `warn`    | `--warn-bg`   | `--warn`   | none              | needs attention, or held        |
| `muted`   | transparent   | `--muted`  | `--strong-border` | finished with; history          |
| `danger`  | `--danger-bg` | `--danger` | none              | failed or taken back            |

## Sizes

A pill: `--radius-pill`, a 1px edge, its icon, then its words, in IBM Plex Sans 600.

| Size      | Height | Words | Icon | Padding (start, end) | Gap | Use it for                           |
| --------- | ------ | ----- | ---- | -------------------- | --- | ------------------------------------ |
| `default` | 22px   | 12px  | 12px | 7px, 9px             | 5px | headers, cards, detail pages         |
| `small`   | 18px   | 11px  | 10px | 5px, 7px             | 4px | list rows, tables, the stepper       |
| `dot`     | 20px   | none  | 11px | centred circle       |     | only a collapsed group, a dense grid |

## Accessibility

- A lozenge is text with an icon, `aria-hidden` on the icon. Not a button: a click belongs to the row around it.
- The dot carries `role="img"`, `aria-label` and `title` with the words.
- Words at 4.5:1 on their ground in both themes: measured from the tokens, 5.2:1 to 15:1, and `muted` at 5.5:1 on a
  selected row. The edge is decoration, not signal, at 1.4:1 to 1.8:1; the words carry the state.
- In a high-contrast mode the ground goes, so the edge and ink take the system text colour (LIF-078).
- Never rely on tone in tests or prose. "The green one" is not a state.

## How the repository holds it

- `apps/web/src/states/lozenge-guard.test.ts`: a state's word under another key fails, unless listed by key with
  why; kinds, words and this table must agree; `stateWord` callers are listed with why.
- `apps/web/eslint/state-words.js`: a `states.*` key outside `Lozenge.tsx`, `data-kind` naming a kind by hand,
  `state.name` as bare text, a state's word in a `Chip`.
- The same guard's contrast test: every tone's words at 4.5:1, in both themes, from `tokens.css`.
- `tests/browser/src/testing/axe.ts`: on every walk, a state's word standing alone outside a lozenge fails; `forced-colors.test.ts`.

**What this cannot catch:** a new state under a new word nobody listed. That is review's.

## Changing this guide

A state is added, renamed or recoloured here first, in the same PR as its kind, its word, its icon and its tests.
Query the requirements first: `pnpm trace search state`, `pnpm trace show LIF-005`.
