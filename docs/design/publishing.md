# Publishing

How a document version becomes a PDF somebody can download, cite and keep: which component versions
it is made of, how it is numbered and laid out, what Typst is handed, what is stored, who may do it,
and what a publication records so that it can be made again.

This realises most of the T1 half of
[PUB](../specification/requirements/PUB-publishing-and-output.md) and the clauses
[STR](../specification/requirements/STR-structure-numbering-and-cross-references.md) and
[CNT](../specification/requirements/CNT-content-and-authoring.md) left for the publisher. It rests on
[ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md) (Typst reads
the resolved document as data through one fixed template),
[ADR-0019](../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md) (a job
on a Postgres queue, a pinned binary, outputs as objects),
[ADR-0021](../decisions/0021-object-storage-a-credential-per-tenant.md) (a store credential per
tenant), [structure.md](structure.md) (the outline, `number`, `contents` and `listOf`),
[access.md](access.md) (who may publish, and what a reader may be shown),
[storage-and-versioning.md](storage-and-versioning.md) (the chain a publication pins into),
[themes.md](themes.md) (the theme's Typst projection and the typefaces) and
[word-output.md](word-output.md) (the other writer that reads the same resolved document).

> **The first slice is built: a document publishes to a tagged PDF of its outline and its
> paragraphs, and nothing else yet.** The first publishing plan built it in two pull requests: 1a,
> the regression corpus checked by veraPDF in the worker's suite, the worker setting every PDF in
> pinned Liberation Serif (#145), a job Typst refuses finished at once (#146), and `assemble`; 1b, the
> Publisher role, the request decided and resolved as its publisher, the `publish` job and the fixed
> template, the immutable record, four routes, the publishing panel on the document page and a
> publication's own page. Every block but a paragraph, every mark, the layout, the theme, veraPDF on
> every publication, preview and Word are later slices' ([Build order](#build-order)).
> [`../architecture.md`](../architecture.md) describes what is built, and
> [Changed while planning and building the first slice](#changed-while-planning-and-building-the-first-slice)
> where it departs from what follows. Everything else below is design, checked against that code and
> against the pinned binary - see [What was run](#what-was-run).

## The shape in one paragraph

A person who may **publish** a document asks for its latest version to be published. In that one
request the service decides the permission, resolves every component reference to the version it
takes, refuses any the publisher may not read, and records the resolution beside a queued job. A
worker claims the job and runs one pure function, `assemble`, over the recorded inputs: it resolves,
applies conditions, numbers with the layout's scheme, binds cross-references and generated lists,
checks everything Typst would refuse, and returns either a **published document** - the one
intermediate every writer reads - or every failure at once. The worker writes that document as JSON
into a directory holding nothing but it, the fixed template and the pinned fonts, runs Typst with the
creation time pinned, stores the PDF under its hash, and inserts the **publication** - an immutable
artifact in the document's space recording every version, the engine, the template, the fonts and the
digests that made it. A failed publish produces no publication at all. Every T1 publication is a
**draft**, because nothing in T1 can approve one, and every page says so.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PUB-003** | The order is stated under [The order](#the-order): resolve occurrences, conditions over content, contributions, number, references, generated matter, checks, projection. Each stage takes the previous stage's type, and a test builds a document whose output differs under every adjacent swap |
| **PUB-005** | A preview reads the document's latest version and each occurrence's current resolution, and says **Preview - not approved** on every page and once in the tagged text, and in its title                                                                                                           |
| **PUB-006** | A preview is a request of kind `preview` run by the same job, the same `assemble`, template and engine; the differences are listed under [Preview](#preview) and none of them is in what the pages show                                                                                           |
| **PUB-061** | A publication is always compiled with `--pdf-standard ua-1`; the publication path has no page-range parameter to pass, and Typst refuses `--pages` with `ua-1`. Only the warm range preview omits tagging, and it is images, never a PDF                                                          |
| **PUB-062** | The compile root holds `data.json`, the template, the fonts and the assets, nothing else. The template reads values with `json()` and has no `eval`; content reaches Typst only as strings and numbers                                                                                            |
| **PUB-080** | A range preview's pages are images whose alternative text says each is an untagged preview page and names the tagged PDF; the panel says the same on screen and offers the tagged PDF beside it                                                                                                   |
| **PUB-007** | A layout's paged format declares page size, orientation, margins as top, bottom, inside and outside, and a gutter                                                                                                                                                                                 |
| **PUB-008** | Running heads and feet are three slots each, holding literal words and the fields `title`, `section`, `page`, `pages` and `revision`; `revision` is the document version as `revision.version` (VER-009)                                                                                          |
| **PUB-009** | Page numbering is declared per matter - front, body, appendix - each with a format and whether it restarts; front matter is the generated front matter and the outline's `front` matter ([The layout](#the-layout))                                                                               |
| **PUB-011** | A layout carries a numbering scheme in structure.md's shape; `number` is given the layout's, in the publisher, in the numbering route and in the outline panel                                                                                                                                    |
| **PUB-012** | A layout holds one member per format, each its own declaration; `paged` is a property of a format                                                                                                                                                                                                 |
| **PUB-013** | A layout is an artifact kind versioned by the chain; a publication pins the layout version it used, and a baseline pins it as it pins any version (VER-018)                                                                                                                                       |
| **PUB-014** | A format is supported where the layout has a member for it; a request naming another is refused `format_unsupported` before anything is queued                                                                                                                                                    |
| **PUB-016** | A footnote is set as a Typst footnote at its anchor; a cell-anchored footnote sits in its cell, a table-anchored one at the caption. The regression corpus holds the spike's footnote cases                                                                                                       |
| **PUB-021** | Headings come from outline nodes alone and are bookmarked, so the PDF's bookmarks are the outline with its numbers                                                                                                                                                                                |
| **PUB-033** | Compose resolves each figure's alternative text - its own, decorative, or inherited from the asset version's default - and a figure with none fails `alternative_missing`, naming the occurrence and block                                                                                        |
| **PUB-034** | The published document carries the document's language, each occurrence's base language where it differs and each `language` mark; the template sets `text(lang)` for each, and the Word writer sets `w:lang` ([word-output.md](word-output.md))                                                  |
| **PUB-091** | veraPDF checks every PDF in the worker against its PDF/UA-1 profile; its report is stored as an object and referenced from the publication's output row                                                                                                                                           |
| **PUB-037** | The layout's `contents.depth` is passed to `contents`; the template sets each entry as a link with its page from Typst                                                                                                                                                                            |
| **PUB-038** | The layout's `lists` names sequences; each is one `listOf` call, set like the contents                                                                                                                                                                                                            |
| **PUB-042** | `contents` and `listOf` take the numbering table made after `conditions`, and the checks and projection read only the conditioned document                                                                                                                                                        |
| **PUB-047** | A publication has no expiry and no delete route; it is `#/publications/{id}` in the renderer and `GET /v1/publications/{id}` in the API; reading it is `read` decided on the publication artifact                                                                                                 |
| **PUB-048** | `GET /v1/documents/{id}/publications` lists the document's publications the caller may read, each with its publisher and time, and the document page shows them                                                                                                                                   |
| **PUB-050** | `publication`, `publication_input` and `publication_output` take inserts only; publishing again inserts another publication                                                                                                                                                                       |
| **PUB-052** | Resolve and compose never stop at a failure: each records it and carries on over what remains, and the request answers the whole list. Typst runs only on a document with none, and is handed nothing it would refuse                                                                             |
| **PUB-053** | The publication row, its artifact row and its outputs are inserted in one transaction after every output is stored; a failed request has none. An object stored before a failure is referenced by nothing, and no link can be signed for it                                                       |
| **PUB-063** | The publication records the engine and its version, the template's name and version, and the pipeline's version                                                                                                                                                                                   |
| **PUB-093** | Decision A: every T1 publication is a draft; the template sets **Not approved** on every page as a pagination artifact and the full sentence once as tagged text, and the record says `approval: 'none'`                                                                                          |
| **PUB-086** | Every failure names its stage - `resolve`, `compose`, `engine` or `store` - its code, and the node, block, reference or definition it concerns ([Failure](#failure-retry-and-what-an-author-sees))                                                                                                |
| **PUB-087** | The regression corpus - the spike's cases, grown by a case for every defect - is compiled on every change to the template, the engine or `assemble`, and each case holds its expected outcome and its veraPDF verdict ([Verification](#verification))                                             |
| **PUB-088** | A layout's `matter` declares a cover, a contents and whether appendices start on a new page ([The layout](#the-layout))                                                                                                                                                                           |
| **PUB-094** | Decision C: the request resolves every occurrence restricted to what the publisher may read, in the query; one they may not read is `occurrence_unreadable`, naming its node and nothing else, and compose never reads it                                                                         |
| **PUB-073** | A request names one source and a non-empty set of formats; the publication records the set, and publishing the same source to another format is another request and another publication                                                                                                           |
| **PUB-074** | A request whose formats exclude `pdf` is refused `page_citation_without_pdf` where the resolved document holds a `page` cross-reference; otherwise the absence of a PDF is the record that no output is page-cited                                                                                |
| **PUB-079** | Where no node survives conditions, the document publishes the front and back matter its layout declares; a layout declaring none fails `nothing_to_publish`                                                                                                                                       |
| **STR-013** | The scheme is declared by the layout (here) and applied by `number` (structure.md); the numbering route and the panel number with the document's layout's scheme                                                                                                                                  |
| **STR-024** | The caption's text is the component's; its label is the layout scheme's rule, and its number is `number`'s                                                                                                                                                                                        |
| **STR-027** | `number`, `title` and `numberAndTitle` come from `references`; `page` from Typst, at the label; `relative` is "above" or "below" by document order, in the layout's words                                                                                                                         |
| **STR-029** | `references`' failures are the resolve stage's, each naming the reference and its target, and any fails the publish                                                                                                                                                                               |
| **STR-050** | A format whose layout member is not `paged` has no page breaks in its projection, and nothing reports their absence                                                                                                                                                                               |
| **STR-052** | `number` is pure over the outline, the layout's scheme and the profile; the publication pins the first two and records the numbering table it published, in full                                                                                                                                  |
| **STR-055** | In a format that is not `paged`, a `page` reference renders its `withoutPages` form, and one with none fails `page_reference_without_pages`, naming it                                                                                                                                            |
| **CNT-042** | A footnote anchored to a cell whose key or position the table does not hold fails `footnote_anchor_unresolved`, naming the footnote and its component                                                                                                                                             |
| **CNT-049** | One converter turns stored MathML into the maths tree both writers read; an element it does not know fails `equation_unrenderable`, naming the block, before either writer runs                                                                                                                   |
| **CNT-054** | A citation resolves against a bibliography entry, and in T1 there are none (LIB is T6), so every citation fails `citation_unresolved`, naming its entry, its block and its component                                                                                                              |
| **CNT-084** | As PUB-034: each run's language reaches the published document, and each writer emits it                                                                                                                                                                                                          |

**PUB-090 is not claimed. Measured, in the worker's suite (the first publishing plan's task 1):** the
nine-level regression case passes every veraPDF PDF/UA-1 machine rule - 106 rules, 0 failed - and the
pinned Typst 0.15.1 role-maps `H7` to `H9` to `P`, because PDF/UA-1's standard heading types stop at
`H6`. So a heading at those depths is bookmarked and numbered correctly, but reaches assistive
technology as a paragraph, not announced as a heading - exactly the person-judged checkpoint PUB-090
asks for and the machine rules cannot see. **PUB-090 stays unclaimed, and is not reworded** (Ken's
answer A, 2026-09-19): an accessibility requirement is not weakened to fit an engine; the gap - the
person-judged checkpoint failing from level seven - is named beside the table above rather than
claimed away, and stands until Typst writes PDF/UA-2, which has more heading types.

**PUB-085 is not claimed either.** It asks for a declared 300-page reference document to publish, from
the request to the recorded publication, at a p95 of ten seconds, and PUB-091 asks for veraPDF's
report on every publication. Measured in the worker's suite, a cold veraPDF takes 11.2 seconds of wall
time for a single page, almost all of it the container and the JVM starting - so with the report inside
the measured span, PUB-085 cannot hold alongside PUB-091 as this design has them. Ken declined to amend
PUB-085 to leave the report out, and deferred the choice to slice 5, which runs veraPDF on every
publication: **a warm checker, or changing the requirement**. Until slice 5 makes that choice this
design does not answer PUB-085 in full, so it does not claim it; the budget's measurement is still
described under [Verification](#verification).

## What this document does not own

Forty-six claims. What is left out is either answered only in part, answered with another design,
or not T1's.

| Left unclaimed                       | Why                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUB-090                              | Beside the table above. Answered by the first publishing plan's first task: headings at levels seven to nine pass every veraPDF machine rule, but the pinned Typst tags them as paragraphs, so assistive technology does not announce them as headings |
| PUB-085                              | Beside the table above: with a cold veraPDF at 11.2 s a page, the ten-second p95 cannot hold alongside PUB-091's report on every publication. Ken deferred the choice - a warm checker, or changing the requirement - to slice 5                       |
| PUB-004                              | Nothing in T1 approves anything: baselines are T3 and revisions LIF's. Every T1 publication is a draft (decision A); an approved one arrives with `baseline_id`                                                                                        |
| PUB-089                              | An **approval page** has nothing to show until LIF records approvals; it is T3's since Ken's answer, and waits for them                                                                                                                                |
| PUB-017, PUB-032                     | The template repeats a table's header rows and sets the continuation label from the table style; but TAB is not designed, and whether Typst tags a **header column** as row headers is not known                                                       |
| PUB-092                              | Keep-with-next and keep-together are hard in Typst, and widow and orphan control is a cost there. How each style property reaches the engine is themes.md's projection, and which cases the regression corpus holds for them is not designed here      |
| PUB-022                              | Cross-references are internal links. Citations cannot be until LIB gives them entries to link to                                                                                                                                                       |
| PUB-031                              | Blocks are emitted in document order. Whether Typst tags a floated figure at its logical place rather than where it lands is not verified; the accessible-output slice verifies it and claims it                                                       |
| PUB-069                              | Typst hyphenates by each passage's `lang`, which the published document carries; which of the languages LOC admits Typst has patterns for is not known                                                                                                 |
| PUB-043, PUB-046, PUB-075 to PUB-077 | Same inputs give the same bytes (decision K, measured). But the image carries **one** Typst, so a publication made on an earlier engine cannot be made again once it is replaced. Keeping every recorded engine runnable is VER-041's and T3's         |
| PUB-044, PUB-045, PUB-082            | T3's records. The creation time is already the only varying value and the only time the layout can print                                                                                                                                               |
| PUB-068, PUB-070 to PUB-072          | Typst overflows an unbreakable block silently. Detecting what cannot be laid out needs the template to measure and refuse, which is designed as a rule ([Failure](#failure-retry-and-what-an-author-sees)) and not as checks                           |
| PUB-020                              | PDF/A is a layout member away, and not T1                                                                                                                                                                                                              |
| CNT-150, CNT-096, CNT-151            | The warm range preview is shaped here and designed by its own slice. CNT-151 now measures from the save (finding 11), and CNT-150 asks for PDF alone                                                                                                   |
| CNT-128                              | A hyperlink is a PDF link here; word-output.md does not design Word's                                                                                                                                                                                  |
| TPL-013, TPL-055                     | A required section and document-level fields need TPL's link from a document to its template, which does not exist (finding 5). TPL-030 repeated TPL-013 and is withdrawn                                                                              |
| STR-030                              | REU's, T4                                                                                                                                                                                                                                              |

## Three kinds of output, and why T1 makes only two

| Kind     | From                                                                   | Retained               | Says                       | Tagged                                        |
| -------- | ---------------------------------------------------------------------- | ---------------------- | -------------------------- | --------------------------------------------- |
| Preview  | The latest document version and each occurrence's resolution now       | An hour, for its asker | **Preview - not approved** | The whole-document preview; a range is images |
| Draft    | The latest document version and each occurrence's resolution, recorded | For ever               | **Not approved**           | Always                                        |
| Approved | A baseline, designated at a lifecycle gate (PUB-004)                   | For ever               | Nothing extra              | Always                                        |

**Decision A: every T1 publication is a draft.** PUB-004 lets only a baseline produce an approved
publication, and baselines (VER-017, T3) and the gates that would designate one (LIF) do not exist.
The alternatives were pulling baselines into T1 - which would give T1 a named snapshot that nothing
could approve, so an unapproved publication under another name - or treating every T1 output as a
preview, which PUB-047 and PUB-048 forbid by requiring publications to be kept and listed. A draft is
a real publication, kept and addressable, that cannot be mistaken for an approved one: **the template
prints its status on every page in a place no layout can remove, and once as tagged text at the start**,
because a running foot is a pagination artifact assistive technology does not read. The record says
`approval: 'none'`; T3 widens it. The corpus had no row saying a draft must say so; Ken filed one as
[issue #142](https://github.com/kenhayward/alloy-works/issues/142), and it landed with the first
publishing build as **PUB-093**, claimed here.

## The order

PUB-003 asks for the order to be fixed, stated and tested, because every part of it has a failure the
output hides. structure.md fixes four stages by type; publishing extends them, and **corrects one**:

```
1 resolve      the latest document version, and each occurrence's version     (at the request)
2 conditions   over each occurrence's content                                  REU, T4: identity
3 contribute   contributionsOf(conditioned content), by occurrence
4 number       number(conditioned, layout.scheme)                              structure.md
5 references   references(conditioned, numbering)                              structure 4
6 generate     contents(depth), listOf(sequence) for each list the layout names
7 check        alternative text, equations, footnote anchors, citations, glyphs, formats, emptiness
8 project      the published document; then data.json for Typst, parts for Word
```

**The correction: contributions come after conditions.** structure.md's built `Resolved` carries each
occurrence's contributions, projected by `numberingInputs` from content **before** `conditions` runs.
While `conditions` is the identity nothing differs; the day REU arrives, a figure inside a hidden
passage would take a number and appear in the list of figures, which STR-042 and PUB-042 forbid. So the
published pipeline carries content through `conditions` and projects contributions from what survives,
and structure's `Resolved` should carry content by occurrence rather than contributions - a change to
a built type that costs nothing now and a renumbering bug later (finding 3).

Each stage takes the previous one's type, so the order cannot be changed without a type error, and one
test document is built so that each adjacent swap produces different output - that test is PUB-003's
citation. **Transclusion, variables and bindings** (PUB-002) join stage 2's neighbourhood when REU and
DAT design them; the rule they inherit is PUB-002's: all of them before stage 4.

## Who may publish, and what a publication contains

**Publishing is `publish` on the document, decided at the request.** The worker has no principal and
decides nothing: system.md drew the worker "resolving the document as the tenant's role", which would
leave the permission decided by nobody (finding 6). So `POST /v1/documents/{id}/publications`, in one
transaction under the access epoch's shared lock (IAM-063):

1. decides `publish` on the document through the route helper, as every route does - which also refuses
   an external principal, whatever the grants say (IAM-047's cap);
2. reads the latest version and refuses `version_precondition` unless it is the one the caller named,
   so a publisher publishes what they are looking at;
3. resolves every reference node to a version - `pinned` to its pin, `latest` to the head -
   restricted to the publisher's readable set **in the query**, as `numberingInputs` is;
4. records the request, one row per occurrence, and the job.

**Decision C: an occurrence the publisher may not read refuses the publish**, as the failure
`occurrence_unreadable`, naming the node by its section number and title and saying **A component**, as
the panel does - never the component's identity. An `approved` reference, which resolves to nothing
until revisions exist, is `occurrence_unresolved`. Both are recorded on the request and the job still
runs, so compose adds its failures for what the publisher can read and the author gets one list
(PUB-052); compose never reads an unreadable occurrence's content, so no failure can describe it. The
alternatives were worse. **Publishing with the component withheld** makes a document with a hole in it
and, by IAM-073, `null` where every number it could move should be - a publication nobody should send.
**Publishing it anyway** lets anybody with `publish` release what they cannot read, which is the
laundering IAM-017 exists to stop. The corpus had no row saying this of every component; Ken filed one
as [issue #143](https://github.com/kenhayward/alloy-works/issues/143), which landed with the first
publishing build as **PUB-094**, claimed here. IAM-074, which said it of a referenced component in T4,
was withdrawn for it.

**Who starts able to publish: nobody.** access.md's eight starter roles hold `publish` in none, and
`packages/domain/src/access/role.test.ts` asserts it "because nothing publishes in T1" - but T1 is
defined as publishing PDF and Word (scope section 12). **Decision L: a ninth starter role, Publisher,
holding `read` and `publish`**, added by a tenant migration as the others were and granted like any
role. Adding `publish` to Author instead was rejected: publishing is the act that escapes, and a tenant
that granted Author to every contributor would find each of them able to release the whole document
(finding 1). Built: migration 0017 adds Publisher to every environment, and `pnpm dev:setup` grants it
to Ada and Grace on General.

**Decision D: a publication is an artifact in its document's space, and its readers are decided on it,
not on the document.** access.md already says so of external shares (IAM-071), and making it a
`publication` row in `artifact` is what lets a grant name it. Its chain is the publication, its space
and the tenant, exactly as every artifact's is. Two consequences, both stated rather than discovered:

- **Publishing declassifies.** A reader of a publication reads the content of every component in it,
  including components they may not read in the editor. That is what publishing is for - a recipient
  outside the tenant reads no component at all - and it is why decision C requires the publisher to
  read everything. access.md never says it (finding 10).
- **A grant on one document does not reach its publications.** Somebody granted `read` on a single
  document, out of a space they cannot read, sees none of its publications until they are granted on
  them. Putting the document in the publication's chain would fix that at the cost of a new kind of edge
  in `decide` and in the readable-set predicate, and of every future publication silently following a
  grant made for the document. Rejected; the Access view explains the refusal, as it explains any.

**What a reader is shown.** Everything in the publication. Numbers are the publication's own, computed
with everything readable, so IAM-073 has nothing to withhold inside one. The record a reader is
answered also carries the document's title at the version published, the document's id and the
version's id and number, because a reader of the publication is shown them in the PDF anyway; a reader
granted the publication alone is answered `404` for both the document and the version, as for anything
else they may not read, so the ids open nothing: the publication's page offers **Open the document**,
and the document page then says **There is nothing here, or nothing you may read.**

## The published document

ADR-0013 calls the resolved content model "the publishing intermediate". The content model alone is
not enough for a writer: a writer also needs the numbers, the bound references, the generated lists
and the layout, and must decide none of them. So the intermediate is one type in `packages/domain`,
**`PublishedDocument`**, and both writers read it:

| Member   | Holds                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema` | `publishing/1`, the version of this shape the template reads                                                                                                 |
| Identity | Title as plain text and as inline content, language, direction, `revision` (`0.7`), `publishedAt`, `status` (`draft`, `preview`, `approved`)                 |
| `format` | The layout's member for this format, in points, with its words                                                                                               |
| `theme`  | The theme's projection for this writer (themes.md): `TypstTheme` for the PDF                                                                                 |
| `front`  | Generated front matter the layout declares - cover, contents, lists - each already computed                                                                  |
| `nodes`  | The outline as a tree: each node's anchor, depth, matter, number or none, title, `pageBreak`, language and direction where they differ, blocks, and children |
| `back`   | Generated back matter                                                                                                                                        |

**A language tag the engine cannot carry is refused, naming it, never shortened - decision K,
reversed.** Typst's `text(lang:)` takes two or three letters and `text(region:)` exactly two, so a
script subtag (`sr-Latn`), a numeric region (`es-419`) or any variant is not a tag Typst can be handed.
The plan proposed carrying only the language and a two-letter region and dropping the rest; **Ken
reversed it (2026-09-19)**: `assemble` refuses such a tag instead, as `language_not_publishable`,
naming the tag exactly as stored and what the engine accepts, for the document and for any occurrence
whose own language differs from the document's - because `sr-Latn` and `sr-Cyrl` are not the same
language to a screen reader, and silently dropping the script is the wrong default for accessibility.

**Blocks are the content model's, bound.** A figure carries its label ("Figure 2.1"), its caption,
its resolved alternative text and its asset's path inside the compile root; a table its label and
caption; a block equation its maths tree, its number and its alternative text; a footnote its number;
a cross-reference its target's anchor and the text it displays, or `{ page: anchor }` where Typst must
supply the page. **An anchor names an occurrence and a block together** - `b-<node>-<block>` - because
one component placed twice holds the same block identifiers twice (STR-010); a node's anchor is
`n-<node>`.

**No content reaches Typst as anything but a value** (PUB-062). The template walks `nodes` and sets
strings as text; nothing is evaluated. The spike showed an escaping slip becoming a file read; with
data there is nothing to escape.

**Numbers come from `number`, never from Typst's counters** - decision F. The template turns Typst's
heading, figure and equation numbering off and sets each number as text from the published document,
and builds the contents and lists from `contents` and `listOf`, asking Typst only for a page:
`counter(page).at(label)`. The spike let Typst number, which made its numbers agree with the panel's
only by coincidence; STR-036 needs them to be the same function's. A footnote's mark is the number
`number` gave it, passed as the footnote's numbering.

**Headings come from outline nodes alone.** PDF/UA-1 refuses a skipped heading level - measured below -
and an outline's depths never skip, because a child is one level below its parent. A paragraph whose
style looks like a heading is tagged as a paragraph; if a component ever needs a heading of its own, it
is a content-model change, and it must say how its level relates to the outline's.

**Equations** go from the stored MathML to the maths tree ADR-0013 and word-output.md describe, in one
converter in `packages/domain` that both writers use; a construct it does not know fails the publish
(CNT-049) rather than reaching either writer. An equation's alternative text is the MathML's `alttext`,
or text generated from the tree, so Typst is never given an equation without one.

## The layout

A **layout** is an artifact kind of its own, versioned by the chain (PUB-013), and like a style
catalogue it is a **definition in no space**, because TPL-052 has a template reference it and templates
live in many spaces. Changing one needs `design` at the tenant. A tenant starts with one version of the
product's default layout, as it starts with the starter component type; until TPL links a document to a
template, **every document publishes under the default layout** and the publication records which
version it was (finding 5).

**The stored shape is closed at its first version**, because versions are insert-only and a layout
that accepts a member nothing reads becomes a migration of every tenant's layouts. Version 1:

| Member     | Holds                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language` | The one language its words are in (BCP 47). A document whose primary language differs is refused `layout_language`, rather than printing "Figure" in a French report. [Issue #144](https://github.com/kenhayward/alloy-works/issues/144) asks for it, and lands with the layout slice |
| `words`    | Contents, list titles, "above", "below", "continued", **Not approved**, **Preview - not approved**                                                                                                                                                                                    |
| `scheme`   | A numbering scheme in structure.md's shape, labels included (PUB-011, STR-013, STR-024). The default layout's is structure's default scheme, exactly                                                                                                                                  |
| `matter`   | `cover`, `contents` with a `depth`, `lists` naming sequences, and whether appendices start on a new page. No approval page: PUB-089's is LIF's and T3's                                                                                                                               |
| `formats`  | A member per supported format (PUB-014), each declared on its own (PUB-012). `pdf`: `paged: true`, page size, orientation, margins and gutter (PUB-007); running heads and feet as three slots of words and fields (PUB-008); page numbering per matter (PUB-009)                     |

`docx` is absent from the default layout until the Word slice, so asking for Word is refused
`format_unsupported` until it can be answered.

**Front matter needs a place in the outline.** PUB-009 wants front matter numbered in its own scheme,
and structure's `matter` is `body` or `appendix`: a preface is `body`, unnumbered, and its pages would
be numbered as the body's. **Decision M: `matter` gains `front`**, on a top-level node as `appendix` is,
with its own page numbering and a rule per sequence in the scheme. It is a widening, so outline schema
version 2 reads every version 1 outline unchanged, and nothing stored changes; it is settled here so
nothing else is stored in its place. Inferring front matter from position - everything before the first
numbered node - was rejected, because an unnumbered interlude in the body would become front matter.

**The panel is given the layout's scheme.** structure.md claims STR-036 on the term that PUB brings its
scheme to the panel. The numbering route and the document route answer the document's layout version,
and the page numbers with that version's scheme; while every document takes the default, nothing the
panel shows changes.

## The request and the job

```mermaid
sequenceDiagram
    participant R as Renderer
    participant S as Service
    participant D as PostgreSQL
    participant W as Worker
    participant O as Object storage
    R->>S: POST /v1/documents/{id}/publications (version, formats)
    S->>D: decide publish; resolve occurrences as the publisher; insert request, occurrences, job
    W->>D: claim the job; read the recorded inputs as the tenant's role
    W->>O: fetch pinned assets
    W->>W: assemble: resolve to project, every failure collected
    W->>W: Typst: data.json, template, fonts; PDF/UA-1; creation time pinned
    W->>W: veraPDF over the PDF
    W->>O: put the PDF and the report by hash
    W->>D: one transaction: publication artifact, record, inputs, outputs; request done
    R->>S: GET /v1/publication-requests/{id}, while the page is open
    S-->>R: the request's state, and every failure once it has failed
```

**Two job kinds**, `publish` and `preview`, on the existing queue. A job names the request; the
request names everything else. The worker runs each compile in a fresh directory holding `data.json`,
the template's version directory, the fonts and the assets, and runs Typst with:
`--root` at that directory, `--ignore-system-fonts`, **`--ignore-embedded-fonts`**, `--font-path`
at the job's fonts, empty package paths, `--pdf-standard ua-1`, `--creation-timestamp` at the request
time, and `--diagnostic-format short`. **The sample now passes both font flags** (#145, task 2 of the
first publishing plan - finding 2 fixed, not left for the publisher): the worker re-hashes the pinned
faces immediately before every compile, writes the just-checked bytes into the compile root and points
`--font-path` there alone, and refuses to run Typst - `FontsUnavailable`, an ordinary error the queue
retries - if a face is missing or has changed since the last check.

**Fonts in T1 before typeface artifacts exist - decision I.** The product's default theme's faces,
open-licence (ADR-0010), are files in the worker image pinned by hash as the Typst binary is, and the
published document names every family explicitly. The worker refuses to compile with an empty font
directory: with no fonts at all Typst 0.15.1 compiles, exits 0 and warns about nothing (measured
below). Typst's embedded fonts were rejected because they change with the engine rather than with the
theme, and ADR-0013 excluded them; waiting for typeface artifacts was rejected because the first slice
would then wait for the theme store. When themes.md's typeface artifacts exist, they replace the image's
files and are pinned as inputs.

**The creation time is the request's**, truncated to the second, so a retry, a second worker racing an
expired lease and a reproduction months later all compile the same bytes, and the object's key - its
hash - is the same.

## Failure, retry, and what an author sees

**Three kinds of failure, and only one is retried.** The queue retries anything a handler throws
(`packages/db/src/queue.ts`), which would run a document with a missing alternative text three times
and fail it three times (finding 4) - so a document's own failures, and Typst's own refusal once it is
recognised as one, are each thrown as a refusal (`JobRefused`, #146) that the queue fails at once rather
than handing it back to its default retry. **The tradeoff:** Typst also exits 1 when it cannot write its output - a
full disk, which is the platform's fault and would pass on a retry - and the worker cannot tell that
exit from a refusal without parsing Typst's messages, which this design rules out. So such a job is
finished rather than retried, and the author asks again; a platform fault that stops Typst before it
exits 1 - a crash, a timeout, a missing binary - is still retried.

| Kind                     | Examples                                                                                                             | What happens                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The document's           | `alternative_missing`, `equation_unrenderable`, `occurrence_unreadable`, `glyph_missing`, `language_not_publishable` | Checked before Typst runs. The job is **failed at once**, in one attempt, as `publish_refused` (`PublishRefused`, a `JobRefused`): its verdict is the failure list, written to the request, which is `failed`. Nothing is retried                                                               |
| The engine's own refusal | Typst exits refusing a document the checks passed - a pipeline defect, such as a check behind the template's version | `JobRefused` (#146, decision F): the job is **failed at once**, in one attempt, with its code (such as `typst_refused`). Never retried                                                                                                                                                          |
| The platform's           | A crash, a timeout, a missing binary, the store unreachable, the database gone                                       | The handler throws; the queue **retries** with back-off; after the last attempt `failed()` marks the request `failed` with `engine` or `store` - `store` where the PDF was made and could not be kept, the store refusing it or the database refusing its record - and no node, block or detail |

**Every failure names its stage** - `resolve`, `compose`, `engine`, `store` - its code, and the node,
block, reference or definition it concerns. That is PUB-086, which replaced PUB-001's four stages
Typst does not have.

**Everything Typst would refuse is checked before Typst runs - decision G.** Under PDF/UA-1 the pinned
Typst refuses a missing document title, a skipped heading level, an image with no alternative text and
a character no face can set (measured below). Each is a condition `assemble` checks first, collected
with the rest, so **an author never sees an engine's diagnostic**: a Typst failure on a document that
passed every check is a defect in the pipeline, recorded as `engine` with no detail an author could
act on. That matters for a second reason: Typst's diagnostics quote content - the missing-glyph error
prints the character and the face - and the worker's log records the failure's kind alone, as it
already does, so no diagnostic reaches a log (ADM-022). Parsing Typst's messages for authors was
rejected: they carry content and change with every release.

**Failures are reported together** (PUB-052). Resolve and compose never stop at the first: each records
its failure and continues with what remains, skipping only what a failure makes meaningless - an
equation that did not convert is not also checked for its alternative text. **When the template learns
to refuse what cannot be laid out** (PUB-072's unbreakable block, not T1), it must run over a document
whose failed items are replaced by neutral stand-ins, so layout failures arrive in the same list rather
than after the author has fixed the others; its output is discarded, as every failed publish's is.

**A failed publish produces no publication** (PUB-053): the publication is inserted only after every
output is stored, in one transaction; an object put before a failure - a PDF stored, then its record
refused - is referenced by no row, and no link can be signed for it. ADR-0019 removes such an object
by a sweep that finds no row pointing at it; **nothing sweeps objects yet**, so it is left behind,
content-addressed, until that sweep is built.

**Idempotent under a lease.** The lease is two minutes and a publish takes seconds; if a worker stalls
past it, a second may run the same request. The publication carries the request's id under a unique
constraint - a plain value, not a foreign key, so that finished requests can be swept (nothing sweeps
them yet) - so one insert wins
and the other finds the request `done` and stops; the objects they both put are one object, because
the bytes are the same.

## Reproducibility

The same recorded inputs give the same bytes: measured below, three compiles of a 432-page document,
two in parallel and one on a single thread, byte-identical. The publication records what makes that
checkable:

- **every version** it read - the document version, each occurrence's, the layout's, and later the
  theme's, catalogues', typefaces' and assets' - as `publication_input` rows, foreign keys that refuse
  the deletion of anything pinned, as `baseline_pin` does;
- **which occurrence took which version**, because a set of versions does not say which of two
  occurrences of one component took the pinned one;
- the **engine and version**, the **template's name and version**, and the **pipeline's version**
  (PUB-063);
- the **font files** by SHA-256, whichever store they came from;
- the **SHA-256 of `data.json`** beside each output's, so a reproduction can show whether the input or
  the engine differs before anybody compares pages;
- the **numbering table** it printed (STR-052), so a section number cited outside the product can be
  found again.

**A template version is immutable.** The template lives in `apps/worker/templates/publication/<n>/`,
and a test holds each version's hash, so an edit that is not a new version fails the build. **What is
not reproducible yet**: the image carries one Typst, so replacing it makes every earlier publication
unrepeatable on the engine it records. Keeping each recorded engine runnable is VER-041's, with
baselines, and is left there rather than half-built here.

## Preview

**A preview is the same request, the same job and the same `assemble`** (PUB-006). What differs:

- it needs `read` on the document rather than `publish`, and is refused on an unreadable occurrence
  exactly as a publish is, so a preview never shows what publishing would refuse;
- its status is `preview`, so every page says **Preview - not approved**, its title begins
  **Preview:**, and the tagged text begins with the same sentence (PUB-005);
- nothing is recorded as a publication; the PDF is kept for an hour, reachable only by its asker, and
  then swept with its request.

**The warm range preview** - ADR-0013's `typst watch` per open document, for CNT-151's budget - is its
own slice, and two things decided here shape it. **Its pages are images**, because `--pages` makes Typst
drop tagging and PDF/UA-1 then refuses the compile (measured below): an untagged PDF in the page would be
hostile to assistive technology in silence. Each page image's alternative text says it is an untagged
preview page and names the tagged PDF; the panel says so on screen, beside a button that makes one
(PUB-080). This settles system.md's open question of how preview pages reach the renderer. **Its memory
is not small**: ADR-0013 measured about 1.7 MB a page, so a warm 300-page preview holds half a gigabyte,
and a preview worker holds a handful. The slice sizes them and evicts the least recently used.

## Word

The Word writer ([word-output.md](word-output.md)) reads the same `PublishedDocument` and owns
everything about its parts. This design gives it three things: the job runs it when `docx` is in the
request's formats and the layout supports it; its output is a `publication_output` row like the PDF's;
and a request without `pdf` is refused where any reference cites a page (PUB-074), because the PDF is
the paged record (PUB-065).

## Stores

One tenant migration. The application role holds `INSERT` and `SELECT` on everything a publication is
made of, so PUB-050 is a grant, as VER-008 is.

| Table                            | Holds                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `artifact.kind`                  | Gains `publication`, in a space, and `layout`, in none                                                                                                                                                                                                                                                             |
| `publication_request`            | Operational and mutable: kind, document, document version, formats, layout version, requester, `requested_at`, state (`queued`, `done`, `failed`), the failure list, and a preview's object and expiry. Swept once finished and a week old - not built: nothing sweeps them yet; a publication needs nothing in it |
| `publication_request_occurrence` | Insert-only: request, node, the version it took                                                                                                                                                                                                                                                                    |
| `publication`                    | Insert-only; its id is its artifact's. The request's id (unique, no foreign key), document, document version, publisher, `published_at`, `approval` (`none`; T3 adds `baseline` and `baseline_id`), formats, engine, template, pipeline, fonts, `data_sha256`, the numbering table as JSON                         |
| `publication_input`              | Insert-only: publication, a version it read, and the node for an occurrence. The foreign key restricts deletion                                                                                                                                                                                                    |
| `publication_output`             | Insert-only: publication, format, object key, SHA-256, size, the standard it was compiled to, and the accessibility report's object                                                                                                                                                                                |

**Settled now because they would be migrations later.** The occurrence resolution is recorded per node,
not as a set. `approval` is a closed column from the first row, so T3 widens a check rather than
inferring approval from a nullable foreign key. The fonts and the input digest are on every
publication, so reproduction (PUB-077) has something to verify against in the first publication ever
made. The numbering table is recorded whole rather than re-derivable, because STR-052 asks for the
numbers published, and a derivation is only as good as the engine that repeats it.

**As built, migration 0017 holds more than the grants.** The first slice's tables carry what slice 1
publishes and nothing it does not: a request has no kind, no layout version and no preview object, and
`formats` is `{pdf}` by a check that a later slice widens. The runtime role inserts a request by what
was asked alone, so every request starts queued, under its own id and at its own time; a trigger lets
it finish once, from queued to done or failed, and only the move to failed may write the failures;
`done` is refused while the request carries any. An occurrence is taken only while its request is
queued, and so are a publication's inputs and its output, whose object key must name its own digest
in its own tenant's store. A constraint trigger checked at commit refuses a publication not recorded
whole: its request done and matching, its artifact in the document's space, exactly one output, and
its inputs exactly the document's version and each version the request recorded. **Three gaps are
named rather than closed**, each reachable only by SQL written as the runtime role, never by the
product's code: a version row can be inserted for a `publication` artifact directly, since what a
version may be of is `VersionSubstance`'s rule, in code; a request can be moved to `done` by the column
grant with no publication behind it, because the database suite's own request tests do exactly that;
and a publication's inputs are read from the request's occurrences when the record is made, not
carried from what the job compiled, so an occurrence inserted into a queued request between the two
would be recorded as read.

## Routes

| Route                                  | Permission        | Does                                                                                                                    |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/documents/{id}/publications` | Publish, artifact | `version`, `formats`. Decides, resolves and queues; answers the request                                                 |
| `POST /v1/documents/{id}/previews`     | Read, artifact    | `version`. The same, as a preview                                                                                       |
| `GET /v1/publication-requests/{id}`    | Its requester     | State and failures, and a preview's signed link while it lasts. Anybody else is answered `404`                          |
| `GET /v1/documents/{id}/publications`  | Read, artifact    | The document's publications the caller may read, newest first, each with publisher, time, version, formats and approval |
| `GET /v1/publications/{id}`            | Read, artifact    | The record, and a signed link per output, valid five minutes                                                            |

`format_unsupported`, `layout_language` and `page_citation_without_pdf` are refused at the door, before
anything is queued; everything else is the job's. A signed link's file name is the publication's id,
never its title: the link's query string reaches the store's logs, and a title is content.

**Nothing goes on the stream; the requester asks** (the first publishing plan's decision G). The
design had a `publication_request` event carrying the request's state to the principal who asked. The
stream as built sends every event to every viewer in the environment (`apps/service/src/stream.ts`),
which is harmless for a sample and not for a publication of a document somebody may not read (finding
7, issue #147), and filtering it per viewer is #147's own fix. So nothing about a publication is
announced: while the page is open, the requester follows `GET /v1/publication-requests/{id}`, which
answers the requester alone - a second after asking, then twice as long after each answer that it is
still queued, up to half a minute - and the list is read again once the request is done. Others see a
publication when they list the document's. The first slice answers `POST` with `200` and the request,
not `202`: a permission-checked handler cannot set its status.

## Where the code lives

| Where                   | What                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `src/publishing/`: the layout schema and the default layout, `PublishedDocument`, `assemble` and its stages, the failure vocabulary, the MathML-to-tree converter; the theme module exported for the first time, for its Typst projection |
| `packages/db`           | The migration, the Publisher role, `requestPublication` (decide, resolve, record, enqueue), `publicationInputs`, `recordPublication`, the listing, and `JobKind` gaining `publish` and `preview`                                          |
| `packages/api-contract` | The routes above                                                                                                                                                                                                                          |
| `apps/service`          | The handlers; nothing on the stream, since the requester follows the request by asking (decision G of the first publishing plan)                                                                                                          |
| `apps/worker`           | `jobs/publish.ts`, the compile root and its flags, the font directory and its refusal when empty, veraPDF, and `templates/publication/1/`                                                                                                 |
| `apps/web`              | **Publish** and **Preview** on the document page for those who may, the publications beneath the outline, a publication's page with its download, and the failure list naming each place in the outline                                   |

## Verification

- **The order** (PUB-003): one document whose output changes under every adjacent swap of stages.
- **Byte identity**: the same request compiled twice, in two workers, produces one object.
- **Nothing reaches Typst it would refuse**: for each refusal measured below, a document that would
  provoke it fails in `assemble` with the named failure, and Typst is never started.
- **No diagnostic in a log**: a publish failing on a missing glyph leaves the log holding its code
  alone, asserted over the captured log.
- **One list**: a document with an unreadable occurrence, a figure without alternative text and a
  citation fails once, naming all three.
- **No artifact on failure**: a store refusing the put leaves no publication row and no artifact row.
- **Decision C's refusal names no component**: the failure for an unreadable occurrence carries no
  component id, version or title, asserted over the whole response.
- **The regression corpus**: the spike's nine cases, grown by every defect, compiled on every change
  to the template, the engine or `assemble`, and checked by veraPDF; a person reviews the Matterhorn
  checkpoints on it when the engine or template changes.
- **The budget** (PUB-085, unclaimed until slice 5): a generated 300-page reference document of
  prose, figures, tables, equations and footnotes, from request to publication, measured in the worker
  suite.

## What was ruled out

- **Typst numbering the document.** It would make the panel and the PDF agree by coincidence.
- **The permission decided in the worker.** It has no principal, and a decision taken later than the
  act is not the act's (IAM-063).
- **A publication row with a state column.** A failed or pending publication would exist as an
  artifact, which PUB-053 forbids; the request carries the state.
- **The PDF streamed through the service.** Signed links keep bytes off the service, as ADR-0019 and
  ADR-0021 intend.
- **Per-document Typst source.** ADR-0013's reason, still true.

## Open questions

| ID  | Question                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | Whether veraPDF's Java runtime belongs in the worker image or a sidecar. The image grows by roughly 200 MB either way. Slice 1 runs it only in the test suite, in its own container (Ken's answer B); this stays open for slice 5's per-publication check                                                                                       |
| New | How long a finished request is kept. A week is a guess                                                                                                                                                                                                                                                                                          |
| New | Whether PUB-085's ten-second p95 is met by a warm veraPDF or by changing the requirement, since a cold veraPDF takes 11.2 s a page and PUB-091 asks for its report on every publication. Ken deferred it to slice 5; PUB-085 is unclaimed until then                                                                                            |
| New | When the page stops asking about a request. It asks a second after publishing, then twice as long each time up to half a minute, and never stops while the page is open: a request no worker takes is asked about every thirty seconds for as long as the page stays open. A limit, and what the page says when it is reached, are not designed |
| New | What a publication's page does once its download link expires. The link is signed for five minutes when the page opens; a page left open longer offers a link the store refuses, until the page is opened again. Signing on demand, or re-reading the publication when the link is followed, would answer it                                    |
| New | Whether the desktop app saves a download at all. The link leaves the renderer's origin for the store's, and the Electron shell handles neither `will-navigate` nor `setWindowOpenHandler` for it; nothing has checked what the window does with it, and it is to be checked by hand                                                             |

Answered by 1a of the first publishing plan: whether Typst's heading levels seven to nine pass veraPDF
(they do - see the table above and [What was run](#what-was-run)) and which faces the default theme
ships (Liberation Serif 2.1.5, committed and pinned by hash - see
[Changed while planning and building the first slice](#changed-while-planning-and-building-the-first-slice)).
Answered by 1b: how the requester hears that a publish finished - by asking, with nothing on the
stream ([Routes](#routes)).

## Findings against what exists

Most serious first. Findings 2 (#145) and 4 (#146) are fixed by 1a of the first publishing plan, and
finding 1 by 1b, which adds the Publisher role; finding 7 is made no worse by 1b; the rest stand.

1. **Nobody can publish.** No starter role holds `publish`, and `role.test.ts` asserts it on the premise
   that nothing publishes in T1, which scope section 12 contradicts. Decision L; fixed by 1b, whose
   migration 0017 adds Publisher.
2. **The worker does not pin fonts.** `apps/worker/src/typst.ts` passes `--ignore-system-fonts` and
   neither `--ignore-embedded-fonts` nor `--font-path`, so the sample is set in Typst's own faces.
   Worse, measured: with no fonts at all, Typst 0.15.1 compiles, exits 0 and warns about nothing.
   ADR-0013's backstop - treat the missing-face warning as a failure - catches only a family the
   template names, which is why the published document names every one and the worker refuses an empty
   font directory. Filed as [issue #145](https://github.com/kenhayward/alloy-works/issues/145);
   fixed by 1a - the worker now sets every PDF in pinned Liberation Serif and refuses to start without it.
3. **Contributions are computed before conditions.** structure.md's `Resolved` carries contributions
   projected from unconditioned content, so once REU exists a hidden figure is numbered and listed.
   Harmless while `conditions` is the identity, and a change to a built type now rather than a bug
   later. Filed as [issue #148](https://github.com/kenhayward/alloy-works/issues/148); not the first
   build's.
4. **The queue retries everything**, including a document's own failures. A handler must complete a
   job whose verdict is a failure. Filed as
   [issue #146](https://github.com/kenhayward/alloy-works/issues/146); fixed by 1a - a job Typst
   refuses is finished at once (`JobRefused`). 1b's `publish` job fails a document's own failures at
   once the same way, as `PublishRefused`, with every one of them written to the request.
5. **A document knows nothing of its template.** STY-025 and TPL-052 say it takes its template's theme
   and layout, and the outline holds no reference to one; TPL-013 also needs to know which
   of a document's sections came from which template section. Until TPL designs it, the default layout
   and theme; adding an optional member later is a widening.
6. **system.md's publishing flow decides nothing.** It has the worker resolve "as the tenant's role",
   which has no principal. This design moves the decision and the resolution to the request, and
   system.md is corrected.
7. **The stream filters nothing per viewer.** realtime.md says each viewer hears only what they may
   see; the built stream sends every event to every viewer. Filed as
   [issue #147](https://github.com/kenhayward/alloy-works/issues/147). The first publishing build
   makes it no worse by putting nothing about a publication on the stream: the requester follows the
   request by asking while the page is open (the first publishing plan's decision G).
8. **The outline has no front matter**, which PUB-009 needs. Decision M.
9. **ADR-0013 and themes.md are out of date about glyphs.** Both say no engine reports a face that
   lacks a character. Under PDF/UA-1, Typst 0.15.1 fails the compile, quoting the character. The
   pipeline's own check (STY-049) is still needed - to report every glyph at once and name the style and
   face - and the engine's error is a backstop whose text must never be logged.
10. **access.md never says publishing declassifies**, and it does (decision D). access.md now says so,
    under "Permissions".
11. **CNT-136 cannot be met through the save path.** The editor sends an iteration after two seconds
    idle (component-editor.md), so a preview fed from saved state trails an edit by two seconds before
    Typst starts; the budget is one. Either the warm preview is fed the editor's unsaved content for
    its own author, or the budget is measured from the save. CNT-151 now measures it from the save.
12. **A warm preview costs half a gigabyte per open 300-page document** (ADR-0013's 1.7 MB a page);
    system.md's "one warm compilation per open document" needs a cap.
13. **The sample's patterns are not a publication's.** Its 30-second Typst timeout is the whole of
    PUB-085's ceiling, and `GET /v1/samples/{id}` answers any signed-in caller - right for a sample,
    wrong for a publication.

## Requirements challenged

Ken asked for these to be challenged. **Ken's answer (2026-09-19): every challenge below accepted**,
and decisions A to M with it. The corpus now says:

| Challenge           | Now                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUB-001             | Superseded by **PUB-086**: every failure names its stage and what it concerns. Claimed                                                                                                           |
| PUB-015             | Superseded by **PUB-087**: PDF output passes the publishing regression corpus. Claimed                                                                                                           |
| PUB-010             | Superseded by **PUB-088** (cover, contents, appendices; T1, claimed) and **PUB-089** (the approval page; T3, unclaimed)                                                                          |
| PUB-064             | Superseded by **PUB-085**: p95 ten seconds on a declared 300-page reference document. Unclaimed until slice 5 settles it against PUB-091, beside the table                                       |
| PUB-030 and PUB-036 | Superseded by **PUB-090** (PDF/UA-1, veraPDF, and the person-judged checkpoints on the regression corpus; unclaimed, beside the table) and **PUB-091** (claimed)                                 |
| PUB-018             | Superseded by **PUB-092**, which defines "honoured"; unclaimed, since the style projection is themes.md's                                                                                        |
| PUB-004 against T1  | Unchanged; drafts accepted, and #142 lands with the first build                                                                                                                                  |
| TPL-030             | Withdrawn, as TPL-013's duplicate                                                                                                                                                                |
| CNT-095             | Superseded by **CNT-150**, PDF alone; unclaimed with preview                                                                                                                                     |
| CNT-136             | Superseded by **CNT-151**, measured from the save being recorded; unclaimed with preview                                                                                                         |
| IAM-017             | Superseded by **IAM-074**, the publisher's permission, decided at the publication; IAM-074 was then withdrawn for **PUB-094** (#143), which says it of every component in T1. PUB-094 is claimed |
| Citations in T1     | Not answered yet: every citation fails the publish until LIB (CNT-054)                                                                                                                           |

What was proposed, as it was written:

- **PUB-001: reword.** Typst paginates and renders in one run and Word paginates for itself, so four
  separately failing stages is a prescription the engine cannot honour. Proposed: "Every publishing
  failure must name the stage it arose in - resolving the document, composing it against its layout and
  theme, the engine, or storing the output - and the block, reference or definition concerned."
- **PUB-015: cut, or replace.** "The fidelity bar in scope section 4" - indistinguishable from what the
  organisation produces today - cannot be tested. Its measurable parts are already PUB-016 to PUB-022.
  Proposed: "PDF output must pass the publishing regression corpus - the engine spike's cases, grown by
  every defect found - on every change to the engine, the template or the pipeline."
- **PUB-010: move the approval page to T3.** It shows approvals, which LIF records and T1 lacks.
- **PUB-064: tighten and define.** 432 pages compiled in 1.3 seconds here, container start included,
  so thirty seconds would not notice a tenfold regression. Proposed: a declared 300-page reference
  document of prose, figures, tables, equations and footnotes, from request to publication, p95 ten
  seconds, never above thirty.
- **PUB-030 and PUB-036: name the standard and the checker.** "PDF/UA" should be PDF/UA-1, the only
  part Typst writes, checked by veraPDF's machine rules per publication; the Matterhorn checkpoints a
  person must judge belong on the regression corpus, not on every publication.
- **PUB-018: say what "honoured" means.** Widow and orphan control is a penalty in Typst and in Word,
  not a guarantee. Proposed: "... must be declared by style, passed to each engine as its own rule,
  and shown honoured wherever the page allows by the regression corpus."
- **PUB-004 against T1.** As written, T1 cannot make an approved publication. Accept draft
  publications (decision A, and the requirement proposed below), or move baselines into T1.
- **TPL-030 duplicates TPL-013**, which already says a document may not be published without a required
  section. Cut TPL-030.
- **CNT-095: narrow to PDF.** A Word "preview" would be our guess at Word's pagination, which PUB-065
  says is Word's alone.
- **CNT-136 against the save cadence** (finding 11): say whether the second is measured from the
  keystroke or from the save.
- **IAM-017: say whose permission.** The referrer's at the time of referencing, or the publisher's at
  publishing. This design checks the publisher's, which is the one that can be decided at the act.
- **Citations in T1.** With no bibliography until T6, every citation fails the publish (CNT-054).
  Either accept that, or refuse inserting a citation in T1, so an author is not surprised at the end.

**Requirements the design needs and the corpus lacks.** Ken filed all three through the issue form:
the first as [#142](https://github.com/kenhayward/alloy-works/issues/142) and the second as
[#143](https://github.com/kenhayward/alloy-works/issues/143), both PUB and both landing as rows, drafted
with `pnpm trace draft`, in the first publishing build, whose behaviour they are; the third as
[#144](https://github.com/kenhayward/alloy-works/issues/144), in TPL, landing with the layout slice.
As proposed:

1. **PUB**: "A publication not produced from a baseline must say that it is not approved, visibly on
   every page and once where assistive technology reads it, and its record must say so."
2. **IAM** or **PUB**: "Publishing must be refused where the publisher may not read every component
   the resolved document contains, naming each such place in the outline and never the component; a
   publication must never contain what its publisher could not read."
3. **PUB**: "A layout must declare the language its generated words are written in, and publishing a
   document in another language under it must be refused rather than mixing languages."

## Changed while planning and building the first slice

The first slice of this design (docs/plans/2026-09-19-publishing-01-a-document-to-pdf.md) landed as two
pull requests: **1a** - the regression corpus and veraPDF, the pinned faces (#145), a refused job
finished rather than retried (#146), and `assemble` in `packages/domain/src/publishing/`, which nothing
calls yet - and **1b**, the Publisher role, the request, the job, the routes and the page, a person can
see. This section records what each changed against what this design said before it was built.

**What 1a changed.**

- **PUB-090 stays unclaimed, not reworded (Ken's answer A).** Measured: the nine-level case passes
  every veraPDF machine rule, and headings from level seven read as paragraphs. See
  [What this document does not own](#what-this-document-does-not-own) and
  [What was run](#what-was-run).
- **PUB-085 is no longer claimed.** The design claimed it while PUB-091 asks for veraPDF's report on
  every publication, and a cold veraPDF measured 11.2 s for one page, so the two cannot both hold as
  designed. Ken declined to amend PUB-085 and deferred the choice - a warm checker, or changing the
  requirement - to slice 5; until then the claim is dropped and the gap named beside the table (claims
  406 to 405).
- **Decision K is reversed.** The plan proposed carrying a language tag's language and a two-letter
  region and dropping the rest; Ken reversed it (2026-09-19): a tag the engine cannot carry is refused
  instead, naming it in full, never shortened. See
  [The published document](#the-published-document).
- **The faces are pinned, and checked before every compile, not only at start-up (#145).** Liberation
  Serif 2.1.5 is committed in `apps/worker/fonts/`, pinned by SHA-256; the worker refuses to start if
  one is missing or altered, and `compile` re-hashes them again immediately before every run, because
  the worker's own user can write to them at runtime (the image's `deploy/Dockerfile` copies them
  `--chown=node:node` - see [`../architecture.md`](../architecture.md)). A face changed or removed
  between compiles is a known behaviour, not a defect: `FontsUnavailable` is an ordinary error, so the job
  retries like any other platform failure, to its maximum attempts, and is then failed as
  `fonts_unavailable` - to the author, indistinguishable from any other exhausted failure except by
  that code.
- **A refused job is finished at once, not retried (#146).** `JobRefused` (decision F) covers Typst's
  own non-zero exit; a missing binary, a timeout or a crash is still retried. The failure table above
  is corrected to the built behaviour.
- **`assemble` is built, called by nothing yet.** `packages/domain/src/publishing/` holds the published
  document's types, the failure vocabulary and `assemble` over resolved input, checking language,
  numbering and glyph coverage and refusing everything the checks above 1a can produce, all at once
  (PUB-052). **PUB-086's claim is answered for the resolve and compose stages in 1a** - the only two
  `assemble` can produce; its `engine` and `store` stages are cited once 1b's job exists to produce
  them.
- **The glyph check's exemptions are measured, not guessed.** `assemble` refuses a character the pinned
  Typst 0.15.1 refuses under PDF/UA-1 with the pinned faces, and additionally U+FEFF everywhere (the
  engine refuses it only in some clusters), U+FFFE and U+FFFF. `SET_WITHOUT_A_GLYPH` - the characters it
  lets through with no glyph in any face - is 4,170 code points in 19 ranges; the fix round after 1a's
  review added 4,142 of them in 14 ranges, each range compiled on its own with the pinned Typst and
  faces (see [What was run](#what-was-run)). That is what was measured, not a proof that no other
  character behaves the same way. The regression case that
  holds `assemble`'s verdict to the engine's own (decision J) needs the publication template, and
  arrives with 1b's plan task 7, not 1a's.
- **#145's "records which fonts it used" is only a start-up log line so far.** The worker logs the
  pinned files' names once, at start-up; the publication record that would hold them on every
  publication is 1b's (`publication.fonts`). Ken's answer accepts 1a as closing #145 regardless: naming
  the faces once, from a worker that refuses to run in any other face, is enough to close the issue as
  filed, and the recording half is 1b's to build.
- **The requirement corpus changed, but not through tasks 1 to 4.** Tasks 1 to 4 changed no row; the
  amendments this pull request carries are Ken's answer to the design: 1,369 requirements became 1,380,
  as ten rows were superseded by eleven (PUB-010 split in two, into PUB-088 and PUB-089) and TPL-030
  was withdrawn as TPL-013's duplicate. Citations moved from 180 to 182 as tasks 1 to 4 added two
  titled tests.

**What 1b changed.**

- **Slice 1 publishes paragraphs of unmarked text, and nothing else.** No marks, language marks or
  hyperlinks, and no theme: a paragraph holding any mark or inline item fails `inline_not_publishable`,
  every other block `block_not_publishable`, and a paragraph not in the body style `style_missing`, all
  at once. The template sets one face, Liberation Serif, at fixed sizes. Marks, hyperlinks and language
  marks move to slice 3 and the theme's projection to slice 4 ([Build order](#build-order)).
- **The Publisher role is built (decision L), and the development seed grants it** to Ada and Grace on
  General beside Author, so the development environment has somebody who may publish (the plan's
  decision N).
- **The request answers `200`**, not `202`: a permission-checked handler cannot set its status.
- **Nothing goes on the stream (the plan's decision G)**, replacing "The stream tells the requester
  alone": the requester asks, as [Routes](#routes) says, so #147 is made no worse. The sequence diagram,
  finding 7, "Where the code lives" and system.md's flow say the same.
- **IAM-074 is withdrawn for PUB-094** (#143), which says of every component in T1 what IAM-074 said of
  a referenced one in T4; PUB-094 is claimed in its place, and #142 landed as PUB-093. The design's
  claims stand at 46.
- **The database holds the record, not only the grants.** Migration 0017's triggers finish a request
  once, keep `done` for a request without failures, take occurrences, inputs and outputs only while the
  request is queued, and refuse at commit a publication not recorded whole; an output's key must name
  its own digest in its own tenant's store. Three gaps remain, named under [Stores](#stores).
- **A document's own failures fail the job at once**, as `publish_refused`, rather than completing it;
  the request is `failed` either way. A record the database refuses is the `store` stage's, like a
  refused put, since the PDF was made. The failure table says so.
- **An object stored before a refused record is left behind.** This design said it was swept; nothing
  sweeps objects yet, so it stays, content-addressed and referenced by nothing, until ADR-0019's sweep
  is built.
- **Requests are not swept either.** Nothing removes a finished request; how long one is kept stays an
  open question.
- **Every publication records its fonts**, each pinned file by name and SHA-256, so #145's "records
  which fonts it used" is now true of every publication and not only of the worker's start-up log.
- **The document's title is set as a level-one heading**, kept out of the bookmarks, because Typst's
  `title()` is tagged `Title` and role-mapped to `P`, which a screen reader reads as a paragraph. It
  changed before anything was published, so the template's first version was re-pinned rather than
  becoming `publication/2`.
- **The pipeline's version is held to `assemble`.** `PIPELINE_VERSION` is pinned by a test to the
  digest of what `assemble` makes of one fixed input, draft notice included, because the notice's words
  are the data's and the template's hash does not cover them.
- **veraPDF runs in the suites only.** The job does not run it, so no report is stored and a
  publication's output row references none; slice 5's per-publication check adds both (PUB-091).
- **What the page shows.** A failure's place is named against the outline the page holds when it is
  answered, not the version published, so a part moved since may show another number, and one removed
  since reads **A part no longer in this document**; neither names a component. Failures of the engine
  or the store are introduced as the product's, never as something in the document to put right.
- **A `publish` job with no subject is not guarded.** The job reads its request by `subjectId!`, so
  such a job - which nothing enqueues - fails in the database, is retried, and is failed with nothing
  recorded, since `failed` ignores a job without a subject.
- **What slice 1 cites.** PUB-021, PUB-047, PUB-048, PUB-050, PUB-053, PUB-061, PUB-062, PUB-063,
  PUB-093 and PUB-094, and PUB-086 again for its engine and store stages, beside PUB-052 and PUB-086
  cited by 1a - not PUB-003 or PUB-073, which need the order's swaps and a second format. It lands #142
  and #143 as rows; #145 and #146 were fixed by 1a. The corpus now holds 1,382 requirements, and the
  tests cite 193 across every area.

## Build order

Each slice is a plan, lands into something that runs, and cites only what its tests demonstrate.

1. **A document to PDF - built.** The Publisher role; the request and its resolution; the `publish`
   job; the template's first version over the outline, section numbers and the components' paragraphs
   of unmarked text, each occurrence's language where it differs; the image's pinned faces, with glyph
   coverage checked against their character maps before Typst runs, so decision G holds from the first
   publication; the pinned flags; the draft notice; veraPDF over the regression corpus and a
   publication in the suites; the publication, its inputs and output; the listing, the page and the
   download, the requester following the request by asking. Every other block, and any mark or inline
   item, fails, all of them at once. Cites PUB-021, PUB-047, PUB-048, PUB-050, PUB-052, PUB-053,
   PUB-061, PUB-062, PUB-063, PUB-086, PUB-093 and PUB-094. Landed #142 and #143 as rows.
2. **The layout.** The layout artifact and its default version; running heads and feet; page
   numbering per matter and outline `front` matter; the cover; the contents and lists; the layout's
   scheme to the numbering route and the panel. Cites PUB-007 to PUB-009, PUB-011, PUB-012, PUB-014,
   PUB-037, PUB-038, PUB-079, STR-013, STR-024, and STR-036 in structure.md's name.
3. **The rest of the content.** Marks, hyperlinks and language marks; lists, quotations, preformatted
   text, tables with captions and header rows, footnotes, equations through the maths tree, figures
   with assets, citations failing, and cross-references once structure 4 has built `references`. Cites
   PUB-003, PUB-016, PUB-033, CNT-042, CNT-049, CNT-054, STR-027 and STR-029.
4. **Themes and typefaces.** The default theme's Typst projection; themes.md's typeface and theme
   artifacts replace the image's faces, and the coverage check reads theirs. Its claims are
   themes.md's.
5. **Accessible output, checked.** veraPDF per publication and its report kept; reading order of floats
   verified; the budget measured. Cites PUB-091; claims and cites PUB-085 once a warm checker or a
   changed requirement settles it against PUB-091 (Ken's deferral); claims PUB-031 once verified.
   PUB-090 stays unclaimed, since slice 1 measured headings from level seven read as paragraphs.
6. **Preview.** The whole-document preview (PUB-005, PUB-006), then the warm range preview as images
   (PUB-080), once the cadence question is answered.
7. **Word.** word-output.md's writer in the job, `docx` in the default layout. Cites PUB-034, CNT-084,
   PUB-073 and PUB-074, which need a second format to show.

**Claimed and cited by nothing yet**, each for a reason a test cannot get round: PUB-013 and STR-052
need a baseline to pin into (T3); PUB-042 needs conditions to be anything but the identity (REU, T4);
STR-050 and STR-055 need a format without pages, and T1 has none (HTML, PUB-056, is later). Each is
answered by the design, as structure.md's STR-057 is, and cited by the plan that first makes it
observable.

## What was run

Throwaway files in a scratch directory, compiled by the pinned Typst 0.15.1 from the
`alloy-works-worker` image in a container removed after each run, with `--ignore-system-fonts`,
`--pdf-standard ua-1` and a pinned creation timestamp. The directory was deleted afterwards.

| Case                                                                       | Result                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Nine heading levels, numbers set as text, links to a label's page          | Compiles                                                   |
| Heading level 1 then 3                                                     | Refused: "skipped from heading level 1 to 3"               |
| An image with no alternative text                                          | Refused: "missing alt text"                                |
| An image marked as an artifact                                             | Compiles - the route for `decorative`                      |
| No document title                                                          | Refused: "missing document title"                          |
| An empty document                                                          | Compiles, a blank page                                     |
| `--pages 1` with PDF/UA-1                                                  | Refused: `--pages` implies untagged                        |
| A family nobody has                                                        | A warning, exit 0                                          |
| No fonts at all (`--ignore-embedded-fonts`, no font path)                  | **Exit 0, no warning**, a PDF with no text                 |
| A character the face lacks                                                 | Refused under PDF/UA-1, quoting the character and the face |
| 432 pages with contents and footnotes, three times, one on a single thread | 1.3 seconds each, container start included; byte-identical |

**Measured since, in the worker's committed suite (tasks 1 to 4 of the first publishing plan), not a
throwaway spike:**

| Case                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The nine-level case, compiled by the pinned Typst under `--pdf-standard ua-1` and checked by the pinned veraPDF image                                                                              | Passes every PDF/UA-1 machine rule: 106 rules, 0 failed, 1252 checks. Bookmarked nine deep; the role tree reads `H1`-`H6` then `P` from level seven                                                                                                                                            |
| veraPDF, one page, wall time of `docker run` (two runs each)                                                                                                                                       | 11.2 s and 11.1 s; almost all of it the container and the JVM starting - veraPDF's own processing of the page is about 0.20 s                                                                                                                                                                  |
| A PDF that is not PDF/UA-1 (no `--pdf-standard`, no title), checked by the pinned veraPDF image                                                                                                    | `compliant: false`; 103 rules passed, 3 failed (`5-1`, `7.1-9`, `7.1-10`), naming each                                                                                                                                                                                                         |
| The 4,142 code points across 14 ranges the pinned Typst sets without complaint under PDF/UA-1 (bidi isolates, tag characters and the like), each range recompiled on its own with the pinned faces | Every range exits 0 and writes a PDF with no error. The three control cases compiled beside them - U+4E2D, U+0627 and U+FEFF - are refused, each quoting the character. `assemble` refuses all three before Typst runs, and U+FEFF everywhere, with U+FFFE and U+FFFF, which were not compiled |

**Measured by 1b, in the committed suites (tasks 5 to 10 of the first publishing plan):**

| Case                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The nine-level case as an outline, through `assemble` and the publication template, checked by the pinned veraPDF image                                    | Compliant. The role tree reads `Document`, `H1` (the title), `P` (the draft notice's sentence), `H1` to `H6`, then `P` three times - levels seven to nine, tagged `H7` to `H9` and role-mapped to `P`. Bookmarked nine deep, the title not among them. 11.2 s, almost all of it veraPDF starting |
| Sixteen characters, each through `assemble` and, with the check skipped, through the template and the pinned Typst                                         | Typst refuses exactly Arabic, a CJK ideograph, an emoji, a private-use character, a control character and a byte-order mark between capitals; `assemble` refuses those six, a byte-order mark between small letters, and nothing else. 0.7 s for all sixteen                                     |
| A multi-page document through the whole job - the request, `assemble`, the template, Typst, the store and the record - checked by the pinned veraPDF image | Compliant, 0 rules failed. **Not approved** is the only artifact text on every page, and the sentence appears once in the tagged text; the bookmarks are the outline with its numbers                                                                                                            |
| A publish whose store refuses the PDF, three attempts, each compiling                                                                                      | Failed at the `store` stage with no place, no publication and no artifact: 232 ms for all three                                                                                                                                                                                                  |
| The same request compiled again from what it recorded                                                                                                      | Byte-identical, and `data_sha256` is the digest of the data compiled again: 149 ms                                                                                                                                                                                                               |
