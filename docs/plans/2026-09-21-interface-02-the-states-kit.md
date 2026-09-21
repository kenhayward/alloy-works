# Interface 2: the states kit

> **A sketch, by request**, built inline, test first. It is slice 2 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** the states `docs/interface/screens/States.html` draws - saving, empty, could not, signed
out, not yours to change, waiting, and the real lozenges - are components with one look each, and the
screens that already say these things say them through those components, **with every sentence
unchanged**.

**Requirements:** none claimed. CNT-068 (the save state in words) is already verified by
`SaveIndicator.test.tsx`; the dot added here is decoration beside the words, not a new answer.

## Rulings

- **No `Confirm`.** Nothing in the product asks before acting today: the outline's removals undo with
  Ctrl+Z, and a grant's Remove is immediate. It arrives with the first removal that cannot be
  undone.
- **No new roles.** A sentence that was a plain `<p>` stays out of the accessibility tree's live
  regions. Making it `role="alert"` would announce what nobody announced before, which is a behaviour
  change a restyle should not smuggle in.
- **One new colour token, `--ok`** (`#16a34a`), for "Saved". `--status-added` has the same value but
  means a diff, and a token is named for what it means.
- **The lozenges built are the real ones only:** `published`, `changedSince`, `neverPublished`,
  `notApproved`, `beingEdited`, `notYoursToRead` (build order A8). No screen shows one yet. The
  lists that will (slices 3 and 7) do not exist, so the component ships with its test alone.

## Tasks

1. **The kit.** `apps/web/src/states/` gets:
   - `Notice.tsx`:
     - `Notice({ tone, children })`, where `tone` is `'failed' | 'signedOut' | 'readOnly' | 'refused' | 'withdrawn' | 'editing'`;
     - it renders a `div` with `data-tone`, a 3px edge and a tint;
     - colours per `States.png`: failed `--danger` on `--surface`; signedOut `--border`; readOnly `--input-border` on `--surface-2`; refused `--warn` on `--state-behind-bg`; withdrawn `--danger` on `--diff-del-bg`; editing `--state-private-fg` on `--state-private-bg`.
   - `Empty.tsx`: `Empty({ children })`, a dashed `--border` box holding the sentence and the one action that fills it.
   - `Waiting.tsx`: `Waiting({ children })`, an `aria-hidden` spinner (0.8s linear) beside the words.
   - `Lozenge.tsx`: `Lozenge({ kind, children })`, uppercase, `--size-micro`, pill.
   - `States.module.css`.

   `states.test.tsx`:
   - `a notice carries its tone and its words`;
   - `an empty state holds its sentence and its action`;
   - `waiting shows its words, with the spinner hidden from assistive technology`;
   - `a lozenge carries its kind`.

2. **The save dot.** `SaveIndicator` gains an `aria-hidden` dot coloured by `data-save`: saved `--ok`, saving `--accent`, failing `--warn`, stopped `--danger`, idle `--muted`. Test: `shows a dot beside the words, hidden from assistive technology`.
3. **The screens say it through the kit.** Words unchanged, existing tests unchanged:
   - `ComponentList`, `DocumentList` and `Workspace`: failed and signed out go in a `Notice`; the two empties go in `Empty`;
   - `ComponentEditor`: Opening... goes in `Waiting`; missing, failed and signed out go in `Notice`; read only, cannot change yet, and someone else editing go in `Notice`;
   - `DocumentPage` and `PublicationPage`: Opening... and failed;
   - `AccessPanel`: Opening..., Loading..., may not manage, failed, and no invitations;
   - `Publishing`: Publishing... goes in `Waiting`.

## Done when

`pnpm lint`, the web typecheck, the web, desktop and trace suites and `pnpm format` are clean, and
the look has been checked in the running renderer. That look is a proxy for Ken's own.
