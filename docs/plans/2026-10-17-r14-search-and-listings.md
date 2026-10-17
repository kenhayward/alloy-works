# R14: Search and listings

> T4's fourteenth slice, extending [search.md](../design/search.md) and
> [templates.md](../design/templates.md). **Full tier**: a contract change, and search entries gaining
> two indexed members (0110). Built inline, one final review at the slice's end. Decisions marked
> **(default)** are recommendations Ken may overturn; the rest are his answers of 2026-10-17.

**Goal:** cohorts are listed, sorted and filtered; an author sees, from the outline, where else what a
node places is used; a section found by search says its document and the components it places; and
search narrows by condition value and by the fields relationships carry.

| PR   | Holds                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------- |
| R14a | This plan; the cohort listing (SCH-065, TPL-040); where a node's components are used (STR-075) |
| R14b | A section result's document and components (SCH-053)                                           |
| R14c | Condition values and relationship fields in search (SCH-061, SCH-063); final review; 0.185.0   |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R14-A | **The cohort listing** (SCH-065, TPL-040; default): `GET /v1/cohorts`, the cohorts in spaces the caller may read, by when asked (newest first) or title, filtered by template and by state - complete, failed (a row failed) or pending (a row waits) - each with its rows counted. Templates offers **Cohorts**, and each row opens the cohort's page. |
| R14-B | **Where a node's components are used** (STR-075; default): the outline's details offer **Used in** for each component the node places - the node itself where it is a reference, every reference under it where it is a section - opening R1's where-used, which names the other documents.                                                             |
| R14-C | **A section found** (SCH-053; default): a section result carries its document, by id and title, and the components it places that the reader may read, each by id and title, and the page offers **Place in a document** as REU-054 does.                                                                                                               |
| R14-D | **Condition values** (SCH-061; Ken's answer): an entry holds every `axis:value` its content is conditioned on - a node's, a block's or a mark's - and search filters and facets on them as on a field's values. Nothing is resolved under a profile.                                                                                                    |
| R14-E | **Relationship fields** (SCH-063; Ken's answer): an artifact's entry holds the field values of the relationships it is an end of, under the relationship type, and facets on them; a relationship made, changed or removed reindexes both ends.                                                                                                         |

## Tasks

- **R14a**: listing sort and query, route and contract, the page; Used in from the outline. Tests: sorted, filtered, paged, readable-set held; a section's components each offered.
- **R14b**: the result's members and the page's link. Tests: one section, its components, one the reader may not read left out.
- **R14c**: 0110; the writers; the filters and facets. Tests: each kind of condition found; a relationship's field faceted at both ends and gone with it. The final review; the close.
