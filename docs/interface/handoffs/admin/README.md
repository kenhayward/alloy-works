# Handoff: Administration as a console page

Administration redrawn as a full page, in the Ledger shell. It replaces the Administration modal,
whose 600px dialog left its tables about 330px and is why their columns overran the panel
(`review.html` has the six findings). Drawn in the design canvas on 8 October 2026.

**Drawings, not code**, as for [`../ledger/`](../ledger/README.md): colour from `tokens.css`, layout
from the HTML, wording from the strings already in `apps/web`. Each screen is a `-light` and a
`-dark` `.html`, self-contained, and a `.png` of it at 1440x900. The links between files work.

## Screens

| Files            | Screen                                                      |
| ---------------- | ----------------------------------------------------------- |
| `overview-*`     | Overview: counts, this environment, access to it, about     |
| `spaces-*`       | Spaces, with Access to General open in the side panel       |
| `new-space-*`    | New space, the dialog over Spaces                           |
| `people-*`       | People, with Grace Rowe's API tokens open in the side panel |
| `invitations-*`  | People, Waiting invitations tab                             |
| `groups-*`       | Groups, with Members of Reviewers open in the side panel    |
| `delete-group-*` | Delete a group, the confirmation over Groups                |
| `roles-*`        | Roles as a role by permission grid                          |
| `tokens`         | The parts in both themes, and the measures                  |
| `review`         | What was wrong with the modal, and the approach             |

## Decisions to record (one ADR)

1. **Administration is a page**, at `#/admin/<section>`, opened by Admin on the rail. Replaces
   "Administration is not a module. It is a modal" in `../../README.md`. Its dialogs (New space,
   rename, archive, delete, New group) stay modals.
2. **A grouped menu**, 232px: Environment (Overview, Spaces), People and access (People, Groups,
   Roles), System (About and release notes). Each entry shows its count.
3. **One shape for every section**: breadcrumb, title, one sentence, one primary action; a toolbar
   of search, filters and a count; a table with a head row, fixed column widths
   (`table-layout: fixed`) and truncation, never wrapping into the actions.
4. **Row actions are icons**, at most two, then a more-actions menu. Each has an `aria-label` and
   a tooltip. Page actions keep their words.
5. **Details open in a side panel**, 440px, docked beside the list, which keeps its place. Below
   1366px it floats over the list. Focus moves into it, Escape closes it, focus returns to the row
   button that opened it. It replaces Tokens and Access swapping out the section behind a "Back to"
   button.
6. **Removing anything asks first**, in a 480px dialog with a filled danger button.
7. **Roles are a grid** of the starter roles by the permissions in `packages/domain`, read only, as
   the product is today.

## Tokens

The colours are the Ledger tokens already in `apps/web/src/theme/tokens.css`. The dialog scrim is
`--overlay`, a panel or dialog takes `--shadow-modal`. Administration adds one colour and six
measures:

```css
[data-theme='light'] {
  --on-danger: #ffffff;
} /* 6.6:1 on --danger */
[data-theme='dark'] {
  --on-danger: #2a0b08;
} /* 8.0:1 on --danger */

:root {
  --pane-admin-menu: 232px;
  --drawer: 440px; /* docked from 1366px, floating below */
  --dialog: 480px; /* 120px from the top */
  --row: 54px; /* table row; the head row is 38px */
  --icon-button: 32px; /* 16px glyph */
}
```

Badges keep their meanings: **ok** Active, Allow, Signed in; **warn** Deny, Invited; **info** From
outside; neutral (`--sunken` and `--muted`) Archived and role names.

## Icons

Added to the `Icon` set on its 16px grid, used through `IconButton`. Shapes are in the HTML.

| Action              | Icon               |
| ------------------- | ------------------ |
| Rename              | pencil             |
| Access              | shield with a lock |
| Archive             | box                |
| Restore             | undo arrow         |
| API tokens          | key                |
| Members             | two people         |
| Delete, Revoke      | bin                |
| Withdraw invitation | bin                |
| Invite people       | person with a plus |
| More actions        | three dots         |

## Wording

Kept from the code: "Delete Reviewers?", its sentence, "Keep it" and "Delete group"; "New space",
"Make space" and "Grant roles on it from Access once it is made."; "Waiting until", "Nobody is
waiting to accept an invitation.", "You may not manage access here.". New: the section sentences,
"Revoking a token ends it at once, without waiting for it to expire." and "An invitation becomes a
person in the People tab the first time its address signs in.".

## Drawn ahead of the product

Check each, or take it off the screen:

- **Also applies here, from the environment** in a space's Access: needs the environment's grants
  read beside the space's.
- **Signed in / Active** status for people, and **Lapsed** invitations as a filter: the data has
  `invited` and `lapsed`; confirm nothing more is implied.
- **Withdraw** on an invitation: the Access panel handles a gone invitation, so a route probably
  exists; confirm.
- **Counts on the menu and Overview**, and **Running as web on Chrome**: from listings and
  `PlatformBridge`; cheap, but each is a read.
- Names, addresses, token names and dates are invented.

Not drawn, because the product has none: component types, layouts, editing roles, bulk revoke.

## Order of work

1. The ADR, and `../../README.md` pointing here.
2. `--on-danger` and the measures in `tokens.css`; the admin icons in `Icon`.
3. A side panel component and its tests: focus in, Escape, focus back, docked or floating by width.
4. The page and its menu at `#/admin`, Admin on the rail opening it, the modal removed.
5. One PR per section: Spaces with Access, People with tokens and invitations, Groups with members,
   Roles, Overview and About. Each keeps its existing tests' requirement IDs.
