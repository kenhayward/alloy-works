# Citations

How a document cites a source and prints its bibliography: T6's first slice. Ken's answers of
2026-10-22 shaped it, [ADR-0067](../decisions/0067-citations-are-csl-rendered-by-citeproc-js.md)
records the engine, and [the CI plan](../plans/2026-10-22-ci-citations.md) builds it. External
reference sources (LIB-031 onwards) are the next slice's.

## The shape in one paragraph

A **bibliography entry** is an artifact in a space, versioned on the chain as any other, holding one
source as CSL-JSON, a citation key fixed at its creation, and where it was obtained and when last
checked. Making one, by hand or by import, looks for the same source first: by DOI, PubMed identifier,
ISBN or ISSN, else by title, year and first author, and offers the one found. A component **cites** an
entry by its identity (`citation { entry, locator? }`, in the content model since T1), and a
cross-reference may target one. A **citation style** is a CSL file, a tenant's managed artifact; CSE,
Vancouver and Harvard are seeded, and a theme names the one its documents use. At publish, citeproc-js
renders each citation's in-text form and the bibliography of what is cited, in the style's order and
with its disambiguation, the same for PDF and Word; each citation links to its entry in the
bibliography. The editor's form is indicative (see "Built in CId"). A citation whose entry cannot be read, or an entry missing a field its style needs,
fails the publish, naming both.

## Requirements owned

| ID          | How it is met                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **CNT-053** | Formatted at publish from the theme's citation style, by citeproc-js                                                           |
| **CNT-102** | CSE, Vancouver and Harvard seeded; any CSL style uploaded                                                                      |
| **STY-020** | A CSL style declares both forms                                                                                                |
| **STY-021** | As CNT-102                                                                                                                     |
| **STY-022** | A CSL style declares its ordering and disambiguation; citeproc-js applies them across the document                             |
| **STY-023** | A style is uploaded as a CSL file, no release                                                                                  |
| **API-032** | As STY-023, through `/v1/citation-styles`                                                                                      |
| **LIB-008** | An entry holds CSL-JSON, typed by CSL's source types                                                                           |
| **LIB-009** | Imported and exported as CSL-JSON, BibTeX and RIS                                                                              |
| **LIB-010** | Import finds an existing record and says what it merged                                                                        |
| **LIB-011** | `obtained { from, at }` and `checkedAt` on the entry                                                                           |
| **LIB-012** | A style declares the fields it requires by source type; an entry lacking one fails the publish, naming the entry and the field |
| **LIB-044** | Making one by hand runs the same search and offers the existing record                                                         |
| **LIB-045** | Canonical identifiers first, then title, year and first author, normalised                                                     |
| **LIB-046** | The key is made from the fields at creation, unique in the space (so in any document), and never changes                       |
| **PUB-040** | The bibliography is generated from the citations present, in the style's form                                                  |
| **PUB-097** | Each citation links to its entry in the bibliography: PDF a link, Word a hyperlink to the entry's bookmark                     |
| **STR-069** | A cross-reference's target gains an `entry` arm, by identity                                                                   |
| **IMP-014** | As LIB-009                                                                                                                     |

CNT-051 (content-model.md) and CNT-054 (publishing.md) are claimed where they were designed; this
slice builds them. LIB-006, LIB-007 and LIB-047 are the library's constraints, honoured here for
entries and claimed by the library's design once every kind of record keeps them.

## The entry

`bibliographyEntry`, an artifact kind in a space. Its version holds `{ schemaVersion, csl, key,
obtained?: { from, at }, checkedAt? }`: `csl` a CSL-JSON item without its `id` (the artifact's identity
is its id), checked against CSL's types and variables; `key` fixed at the first version. Fields beyond
CSL's are refused, never kept.

**The key** (LIB-046) is the first author's family name and the issued year (`smith2020`), else the
first significant word of the title and the year, else `entry`; lower-cased ASCII, then `a`, `b` and on
where the space already holds it, under a unique index on the space and key. It names the entry to an
author and in an export; the printed label is the style's (`Smith 2020a`), never the key.

**Kept while cited** (LIB-006): an entry cited by any component's latest version, or a version a
baseline pins, cannot be deleted or archived; its uses are listed by component, from an index kept as
cross-references' are. A change reaches an unpinned citation at the next publish and never a baseline's
pin (LIB-047).

**The citation** keeps its stored shape (`entry` a string, as fixtures hold): a save is refused where a
new or changed citation names no entry the author may read in the component's space, and at publish an
entry that cannot be resolved is `citation_unresolved` (LIB-007).

**Duplicates** (LIB-010, LIB-044, LIB-045): `DOI` (lower-cased, prefix stripped), `PMID`, `ISBN`
(digits, ISBN-10 as 13) and `ISSN` are each a match; otherwise the normalised title, the issued year and
the first author's family name. A match is offered, never refused; import merges into the match the
fields it lacks and says which.

## The style

`citationStyle`, a tenant's managed artifact (no space), its version `{ csl: <the XML>, requires }`:
`requires` maps a CSL type to the variables an entry of that type must hold, since CSL itself declares none:
seeded for the three, and given with every upload, the page proposing one from the variables the style
prints. A file that does not parse as CSL 1.0.2 is
refused. The theme's citation style catalogue, empty since T1, gains a version naming one style **at a
version**, so a baseline's output never moves; the default theme names
Harvard.

## Rendering

The domain's `citations` module builds a citeproc-js engine from data it is given, never a file: the
style's XML, the entries cited, and the CSL locale for the document's language (bundled by the caller,
falling back to `en-US`), registers the citations in reading order, and answers each citation's in-text
form and the bibliography's entries as the published document's runs. Typst and Word draw those runs;
neither formats a citation. A bibliography is placed where the layout's matter says, as the lists are.
The editor shows a citation's form as the service renders it, so citeproc-js never reaches the browser;
a citation whose entry a reader cannot read shows as unavailable. **Whose read decides** at publish is
the publisher's, as with every other record.

## Failures

| Code                  | When                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `citation_unresolved` | A citation's entry does not exist, or the publisher may not read it                         |
| `entry_incomplete`    | An entry lacks a variable its style requires for its type: the entry and the variable named |
| `style_invalid`       | The theme's style no longer renders (never at upload, where it is refused)                  |

## Built in CIc, and where it departs

- **Assemble** renders every citation once, in reading order (footnotes and table cells included),
  through `renderCitations` handed in by the worker, so citeproc stays out of the renderer;
  `publishing/23` carries each as a `citation` run and the bibliography as `back.bibliography`, its
  entries anchored `e-<entry>`. Template 23 draws them.
- **The layout places it**: `matter.bibliography { title }`, added at schema 7 in place as
  `approvals` was. A layout without one places none and its citations print unlinked; the default
  layout declares none yet. A citation in a section's title is still refused.
- **Word** links a citation to the entry's bookmark with a hyperlink, not a `REF`: a `REF` would print
  the entry's words. The bibliography is outside Word's headings and contents, as the PDF keeps it out
  of its own.
- **Tagged PDF**: the pinned Typst writes no `Reference` or `BibEntry`, so a citation is a `Link` and
  the bibliography an `L` of `LI`.
- **Failures** name a citation by its place among its block's citations, `detail` `<n>: <entry>`;
  `entry_incomplete` `<entry>: <variable>`; `style_invalid` `none` or `render`.
- **Recorded and pinned** as images are: the entry versions read are rows of their own kind beside a
  request's and a publication's images, and a baseline pins them (`entries` in its digest, absent where
  none), so 0022's and 0073's checks hold them. A publication records its theme's style version. A
  baseline's publish by someone who may not read a pinned entry fails each citation of it by name;
  the pin is recorded and never read.

## Built in CId

- **Editable.** The editor's `citation` node holds `entry` and `locator` (null where none), mapped
  both ways; a component holding citations opens for editing. **Cite** (Ctrl or Cmd, Shift and 2)
  opens a picker over the space's entries, read through the list API and found by key, author or
  title in the browser.
- **Drawn by the service.** `POST /v1/components/{id}/citations/preview` renders a component's
  citations, in order, in the style of the document named (one placing the component, else 404), else
  the environment's theme's; null for one naming no entry of the space the caller may read, drawn
  _Citation unavailable_, as is every citation of a failed preview. The editor asks 500 at a time.
- **Indicative in the editor.** The preview renders one component alone, so its form is not the
  published one: numbering and disambiguation (`2020a`) are the document's, set at publish over every
  citation it places. The Reference dialog says so.
- **The save check** (CI-H) runs on a save, a suggestion and an assistant's proposal: an entry the
  opened version did not cite must be one of the space the author may read, else
  `citation_unreadable`. A component's restore is checked as a save is, against the latest version.
- **Archiving and citing serialise** on the space's bibliography lock, taken by `archiveEntry` and by
  `indexReferences` for every version citing an entry, so an archive never misses a citation
  committing beside it (LIB-006).
- **A style's size is bounded.** citeproc-js expands every macro call in place, so `checkStyle`
  refuses a style expanding past 50,000 elements, or a macro calling itself, `style_invalid`; and
  `renderCitations` refuses the same before every render, so a style stored earlier cannot hang a
  preview or the worker.
- **An import** takes at most 500 records, else `import_too_many` before anything is written.
- **An `entry` cross-reference** (STR-069) prints the entry's in-text form, never its key (the key is
  the author's name for it, not the reader's): publishing renders it as a citation of the entry, so it
  is numbered, linked to `e-<entry>` and failed `citation_unresolved` as a citation is, counted among
  its block's citations. Its one `display` is `number`.
- **The default layout's 0.10** (migration 0148) places the bibliography, titled _References_, on
  0.9 alone, as 0056 guarded; a request, publication or baseline made under 0.9 keeps it.
