# CI: Citations

> T6's first slice ([citations.md](../design/citations.md), ADR-0067). **Full tier**: two artifact
> kinds, a licensed dependency, a new published-document schema and template, editor insertion. Ken's
> answers of 2026-10-22 are marked **(Ken)**; the rest **(default)**. The pre-flight review's findings
> are folded in.

**Goal:** an author cites managed bibliography entries, and a document publishes their in-text forms and
its bibliography in the theme's CSL style, in PDF and Word, failing on an unresolved citation or an
incomplete entry.

| PR  | Holds                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| CIa | This plan, the design and ADR-0067; `bibliographyEntry` (0145), duplicates, keys, uses and the delete guard; import and export; the pages           |
| CIb | `citationStyle` (0146) and the three seeded; citeproc-js and the `citations` module; the theme's catalogue naming a style at a version              |
| CIc | Publishing: in-text forms, the bibliography, links, the failures, in Typst (template 23) and Word                                                   |
| CId | Citing in the editor: the Cite action, components holding citations editable, a cross-reference to an entry; the walks; the final review; the close |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI-A | **CSL, by citeproc-js under CPAL, unmodified** (Ken; ADR-0067): pinned, its attribution shown in About alone, never where citations are used (Ken).                                                                                                                                                                                                                                                |
| CI-B | **An entry is a space's artifact** (default; CNT-051): `bibliographyEntry` on the version chain, read and written by the space's permissions as a component is. A citation names an entry of its component's own space, checked at save as a cross-reference to another component is; a component carried into another space keeps its citations, which then fail at publish rather than silently. |
| CI-C | **Import and export** (default; LIB-009): CSL-JSON, BibTeX and RIS, by citation-js's core, BibTeX and RIS plugins, each licence checked as MIT before it is taken (never its CSL plugin); each record checked as an entry and matched as LIB-045 says, by indexed identifiers; what could not be represented is reported.                                                                          |
| CI-D | **A style's `requires`** (default; LIB-012): given with every version, seeded for the three, proposed from the style's variables at upload.                                                                                                                                                                                                                                                        |
| CI-E | **The theme names the style at a version** (default): a new catalogue version (4) and its reader; the default theme names Harvard.                                                                                                                                                                                                                                                                 |
| CI-F | **Rendered once, drawn twice** (default): the domain's `citations` module, given style, locale and entries as data; the worker and the service bundle the locales. `assemble` places the runs; a new published-document schema and template 23. Word's links are REF fields to bookmarks; if `write.ts` cannot carry them, PUB-097 is claimed for PDF only and the gap named.                      |
| CI-G | **The editor last** (default): citations make a component read-only until publishing renders them, so the Cite action (a picker of the space's entries by key, author and title), editability and STR-069's `entry` target land in CId, after CIc. The service renders a citation's form for the editor.                                                                                           |
| CI-H | **The stored citation stays a string** (default; the pre-flight review): no migration; a save refuses a new or changed citation naming no readable entry of the space.                                                                                                                                                                                                                             |

## Risks

- **citeproc-js's size and speed** in the worker and the service: measured in CIb against the range preview's budget.
- **CPAL's attribution** is shown in About, which meets its terms (Ken); a reading that asks more is ADR-0067's revisit.
- **A style a tenant uploads** may render badly: shown in a preview on its page before it is named by a theme.

## Built

CI in four PRs: CIa #756, CIb #758, CIc #760 and the close #761. Departures: the seeded Vancouver is
NLM citation-sequence and CSE is its name-year form, upstream having renamed both; citeproc-js lives
behind domain's `citations` subpath, never the renderer's bundle; Word links a citation by a
hyperlink to its entry's bookmark, a REF field printing the whole entry; the pinned Typst tags a
citation `Link` and the bibliography `L`, having no `Reference` or `BibEntry`; a cross-reference to an
entry prints the style's in-text form; the default layout's 0.10 places a bibliography titled
References. Two automated security reviews and the final review found no leak; they fixed an
unchecked link scheme, entries read beyond the publisher's or a baseline maker's reach, a style whose
macros double without bound (refused past 50,000 expanded elements, before every render), an
unbounded import (500 records), a restore that skipped the citing check, an archive racing a citing
save, and a title decoding past Unicode. Left, named: the editor's form is indicative, numbering and
disambiguation the document's at publish; citations in section titles; locators are free text;
LIB-006, LIB-007 and LIB-047 are honoured for entries but claimed with the library's other records.
