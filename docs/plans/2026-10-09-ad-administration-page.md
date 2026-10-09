# AD: Administration as a page

> Building [the Administration handoff](../interface/handoffs/admin/README.md) under
> [ADR-0049](../decisions/0049-administration-is-a-page.md). **Full tier, several PRs**, one of them
> a contract change (AD3). Ken's review of this plan is its pre-flight.

**Goal:** Administration as a page in the Ledger shell, every section in the one shape, details in a
side panel, in Light and Dark, with no string reworded and no requirement that passes today failing.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                               | Beat                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| AD-A | **Counts come from a `total`** on `/v1/principals`, `/v1/invitations` and `/v1/groups`, as the components listing has one; spaces and roles are one page already. A contract change, additive                                                                                                                                                                                                                                                          | Walking every page of people to print one number                                         |
| AD-B | **Roles read `/v1/roles`**, the environment's own rows, which a tenant may rename or change; the columns are `packages/domain`'s permissions. **Deny only** comes from the domain's `allowable`, and the footnote from its external rules, so neither is written in the page                                                                                                                                                                           | The handoff's "starter roles by the permissions in `packages/domain`": stale once edited |
| AD-C | **Everybody may open Administration**, as today; a section the caller may not manage says "You may not manage access here." and its menu entry shows no count                                                                                                                                                                                                                                                                                          | Hiding Admin, which needs an "administers anything" read at every page load              |
| AD-D | **One `SidePanel` part** in `apps/web/src/parts`: 440px, docked from 1366px and floating below, focus in, Escape, focus back to its opener. Which panel is open is not in the URL                                                                                                                                                                                                                                                                      | A panel per section; a deep link nobody has asked for                                    |
| AD-E | **Search and filters act on what is loaded**, with **Show more** paging on the cursor, as the drawing shows; a search on the service waits for a tenant that needs one                                                                                                                                                                                                                                                                                 | A `q` parameter on each listing now                                                      |
| AD-F | **Times are absolute**: "Used 4 Oct", not "Used 2 hours ago" (COL-054's rule, and TokenTable's today)                                                                                                                                                                                                                                                                                                                                                  | Two ways of writing a time                                                               |
| AD-G | **Drawn ahead, checked**: kept, each backed by a route today - the environment's grants beside a space's (`GET /v1/grants?level=tenant`), Signed in, Active and Invited (`kind`, `invited`), Lapsed (`lapsed`), Withdraw (`DELETE /v1/invitations/{id}`), a token's scopes and last use, What she may do (`/v1/access/explain`), sign-in groups (`claim`). **Off**: "on Chrome" (the bridge knows only web or desktop, so About says "Running as web") | Building to a picture                                                                    |
| AD-H | **Not drawn, so not placed**: the tenant's data limits (D2-N), component types and layouts. Each becomes a section in this menu when it is built                                                                                                                                                                                                                                                                                                       | Squeezing them in now                                                                    |

## The PRs

| #   | PR                                                                                                                                                                                                                                          | Cites, in literal titles                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| AD1 | The handoff, ADR-0049, this plan, `docs/interface/README.md` pointing at the handoff                                                                                                                                                        | Nothing                                        |
| AD2 | Parts: `--on-danger` and the measures in `tokens.css`; the admin glyphs in `Icon`; `SidePanel` (AD-D), the 480px confirmation with its danger button, and row actions (two icons, then a more-actions menu)                                 | Nothing new; axe over each part in both themes |
| AD3 | The page: `#/admin/<section>`, the menu with counts (AD-A, the `total`s and their contract tests), Admin on the rail a link marked current, each section moved in as it is, the modal removed; the browser suite's states moved to the page | As today                                       |
| AD4 | Spaces in the one shape, Access in the side panel with the environment's grants beside                                                                                                                                                      | ADM-049, IAM-029, IAM-030, IAM-031 kept        |
| AD5 | People with its tabs, a person's tokens and What they may do in the side panel, Waiting invitations with Lapsed and Withdraw                                                                                                                | As today                                       |
| AD6 | Groups, Members in the side panel, Delete asking first                                                                                                                                                                                      | As today                                       |
| AD7 | Roles as a grid (AD-B), Overview, About; the close                                                                                                                                                                                          | As today                                       |

Each PR checks 1280x800 as well as 1440x900, both themes, and keeps every string the handoff keeps.

## Requirements this must keep

Today's admin tests cite ADM-049 (spaces made, renamed, archived) and IAM-029 to IAM-031 (managing
access); the browser suite runs axe over every Administration state (CNT-176, CNT-078), which AD3
moves from the dialog to the page. Nothing is newly claimed: the interface claims nothing.

## Risks

- **Focus**: the modal trapped focus; a page does not, and F6 must now reach the menu, the section
  and an open panel as regions (`RegionKeys`). AD2's tests hold the panel's half, AD3 the page's.
- **The `total`s** read a count on every listing; on a large tenant that is a count over the
  principals table per request, cheap beside the page it is printed with.
