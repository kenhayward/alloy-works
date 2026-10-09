# 0049 - Administration is a page

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Administration has been a modal since the first interface build
([Interface 12](../plans/2026-09-21-interface-12-administration.md)), and
[`docs/interface/README.md`](../interface/README.md) made that a rule: "Administration is not a
module. It is a modal ... A modal is never a route." The Ledger
([ADR-0046](0046-the-ledger-interface.md)) kept it, moving its opener to the rail's foot. Since
then it has grown sections, Groups, a space's Access and a person's API tokens among them, and
Ken's review found it does not fit: the 600px dialog leaves each table about 330px, so columns
overrun, three text buttons crowd every row, lists are written as sentences, and Access and Tokens
replace the section behind a "Back to" button, losing the reader's place. Ken had it redrawn on
8 October 2026 as a console page in the Ledger shell ([the handoff](../interface/handoffs/admin/README.md),
`review.png` the six findings).

This reverses a decision taken earlier, after review: the modal rule in the interface README, and
with it Interface 12's choice of a modal and the "Back to" swaps added to it since (W12 among them).

## Decision

1. **Administration is a page**, at `#/admin/<section>`, opened by Admin on the rail, which is then
   marked current like a module. Its dialogs (New space, rename, archive, delete, New group) stay
   modals. A person's own API tokens, from the account chip, stay a modal
   ([ADR-0028](0028-personal-api-tokens-in-t1.md)).
2. **A grouped menu, 232px**: Environment (Overview, Spaces), People and access (People, Groups,
   Roles), System (About and release notes). Each entry shows its count.
3. **One shape for every section**: breadcrumb, title, one sentence and at most one primary action;
   a toolbar of search, filters and a count; a table with a head row, fixed column widths
   (`table-layout: fixed`) and truncation, never wrapping into its actions.
4. **Row actions are icons**, at most two, then a more-actions menu; each has an `aria-label` and a
   tooltip. Page actions keep their words.
5. **Details open in a side panel**, 440px, docked beside the list, which keeps its place; below
   1366px it floats over the list, as the Ledger's right panel does. Focus moves into it, Escape
   closes it, and focus returns to the row button that opened it.
6. **Removing anything asks first**, in a 480px dialog with a filled danger button.
7. **Roles are a grid**: the environment's roles by the permissions, read only, as the product is
   today.

## What would change the answer

- **Editing roles, component types or layouts arrive** (T7): each is a section in this menu, not a
  new surface; a role grid that edits needs its own design.
- **A tenant with thousands of people**: the counts and the People table page from the service
  (decision 2 needs a `total` from each listing, not a walk of every page).

## Consequences

- `docs/interface/README.md` loses the modal rule and points at the handoff. The browser suite's
  Administration states move from a dialog to a page.
- `tokens.css` gains `--on-danger` and five measures; `Icon` gains the admin glyphs.
- One side panel part serves Administration and, later, any list with details beside it.
- Drawings show things the product cannot answer yet; each is checked against a route before it is
  built, or comes off the screen ([the plan](../plans/2026-10-09-ad-administration-page.md)).
