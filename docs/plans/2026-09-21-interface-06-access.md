# Interface 6: Access

> **A sketch, by request**, built inline and test first. It is slice 6 of
> [the build order](2026-09-21-interface-00-build-order.md), and that plan's global constraints bind
> it. It is a first draft for Ken to refine by looking at it.

**Goal:** `#/components/{id}/access` looks like `docs/interface/screens/Access.png`, a page (Q3), in
two columns:

- **left:** what is granted at the component, its space and the environment, each a card of rows,
  then _What someone may do here_ with its table;
- **right:** _Give access_ as a card, then _Invite someone_ with the waiting invitations.

**Requirements:** none claimed. The page's requirements (IAM) stay with `AccessPanel.test.tsx`,
whose assertions do not change: this moves and styles what is there, and rewords nothing.

## Rulings

- **Access is a page, not a dock panel** (build order Q3). The README's route table says "B, dock
  open", and this slice corrects it to "Page".
- **The DOM moves into two columns.** The explanation now comes after the grants and before Give
  access, as drawn, so the tab order follows the page as a reader sees it. Nothing is renamed or
  reworded.
- **A grant row keeps its sentence** (`Allowed Author to Ada`) and gains a `data-effect`. A deny is
  edged in `--danger`. There are no avatars or lozenges: the sentence already says Allowed or Denied,
  and a lozenge saying it again would be read twice.
- **Remove and Withdraw take the danger outline**, a `danger` class in `base.css`, beside `primary`.

## Tasks

1. `AccessPanel.test.tsx` gains
   `lays out what is granted and why on the left, and giving and inviting on the right`. It checks
   which column each named part is in, by `data-column`.
2. `AccessPanel.tsx` wraps its parts in `<div data-column="granted">` and
   `<div data-column="giving">`, and uses the module classes: grant cards, rows, the form grid and the
   invitation rows.
3. Add `button.danger` to `base.css`, and correct the README's route row for access.

## Done when

- Lint, typecheck, format, and the web, trace and desktop suites are clean.
- `trace.json` is regenerated last, before the commit.
- The page has been looked at in the running renderer. That view is a proxy.
