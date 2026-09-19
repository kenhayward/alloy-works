# Publishing 2: the layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A document publishes under a **layout**: a versioned artifact every environment starts with
one version of, declaring the page (size, orientation, inside and outside margins, gutter), running
heads and feet built from words and fields, page numbering per matter, a cover, a contents to a depth,
the numbering scheme, the formats it makes and the language its words are in. An outline gains
`front` matter; the outline panel numbers with the layout's scheme; a document in another language
than its layout, or a format the layout does not make, is refused at the door, naming why.

**Architecture:** `packages/domain` gains outline schema 2 (`front` matter, front-first), a `front`
rule per sequence in the scheme, `src/publishing/layout.ts` (the closed layout shape, the product's
default, language matching) and `publishing/2` from `assemble`. `packages/db` gains migration 0018: a
`layout` artifact kind in no space, the default layout seeded as version 0.1 and declared by a
singleton, and the layout version recorded on each request and publication. The worker gains template
`publication/2`: page geometry, a cover, running heads and feet as artifacts, page numbering per
matter and a contents built by Typst's `outline` over headings whose numbers are `number`'s. The
document and numbering routes answer the layout and its scheme, and the renderer numbers with it.

**Tech stack:** as the first publishing plan: TypeScript strict, zod 4, Kysely, PostgreSQL 17,
Fastify 5, React 19, Vitest 5, Typst 0.15.1 and Liberation Serif 2.1.5 pinned by hash, veraPDF 1.30.2
by digest, `pdfjs-dist` in the worker's tests. No new dependency.

**Spec:** [`../design/publishing.md`](../design/publishing.md) - "The layout", decisions H and M, "The
published document", "Changed while planning and building the first slice" and build order slice 2 -
with [`../design/structure.md`](../design/structure.md) ("The scheme", "The counter stack", "Generated
lists", STR-036) and issue #144. Written 2026-09-19 against `main` at `5f0fe31` (0.30.0).

**Version:** this plan's pull request is **0.31.0** (a functional enhancement). Its changelog entry is
drafted in task 12.

---

## What was run, and what it settled

Only the three questions whose answers could change the plan, each by the smallest thing that answers
it, in a scratch directory since deleted: the pinned Typst 0.15.1 (`fetch-typst`), the four pinned
Liberation Serif faces with `--ignore-system-fonts --ignore-embedded-fonts --font-path`,
`--pdf-standard ua-1` and a pinned creation timestamp; pdf.js (the worker's) reading page labels,
page boxes, artifact and tagged text and the structure tree; veraPDF by the digest in
`apps/worker/src/testing/verapdf.ts`, `--rm --network none`. No suite was run.

| Q      | Ran                                                                                                                                                                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | A 12-page document: a cover (numbering `none`), front matter `i` restarting, body `1` restarting, appendix `1` continuing; heads and feet of three slots (title, section, pages; revision, empty, page) in `page(header:, footer:)`; the notice above the head on every page and once as tagged text | **veraPDF compliant, 106 rules, 0 failed** (portrait and landscape). Page labels exactly `["", "i", "ii", "iii", "1", ... "6", "7", "8"]` - the cover unlabelled, the appendix continuing at 7. Every page's artifact text holds **Not approved** once; the notice sentence is tagged once, on page 1. Heads and feet are artifacts. `pages` from `locate(<end>).page()` printed `12`. Landscape A4: every page box `842 x 595`                     |
| Q1+    | The section field, first as "the last level-one heading before here"                                                                                                                                                                                                                                 | **Wrong on the page a chapter begins** (it showed the previous chapter). Fixed as "the first level-one heading on this page, else the last before it" - the fragment in task 8                                                                                                                                                                                                                                                                      |
| Q1+    | Inside 72 + gutter 18, outside 54                                                                                                                                                                                                                                                                    | Tagged text's leftmost x: **90.00 on odd pages, 54.00 on even**, from the cover on                                                                                                                                                                                                                                                                                                                                                                  |
| Q1+    | The matter switch as a loop over segments of consecutive top-level nodes, `set page(numbering:)` inside the loop body                                                                                                                                                                                | Compiles; identical labels and bookmarks                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Q2** | The same document's contents two ways: (a) Typst's `outline(depth: 2, target: heading.where(outlined: true))` with a `show outline.entry` rule setting `body() leader page()` as a link; (b) our own list of links to `<n-ID>` labels, each page from `counter(page).at()` in `loc.page-numbering()` | **Both compliant, 106 rules, 0 failed.** Only (a) is tagged as a table of contents: `TOC TOCI Reference Link`, nested `TOC` for depth 2. (b) is `P Link` - a screen reader hears paragraphs of links. In both the numbers are the heading text we set (`number`'s) and only the page is Typst's; the leader dots are artifacts; the `Contents` heading is not bookmarked. An empty `outline` compiles and passes, as a page holding only `Contents` |
| **Q3** | `v1/every-node.json` parsed now, then through an identity step to schema 2 and parsed again; both canonicalised                                                                                                                                                                                      | **Parses member for member unchanged.** Canonical forms differ at one place only, `"schemaVersion":1` against `2`, so content hash and version digest differ (decision D). A grep finds **15 test files and `dev-content.ts`** building current outlines with a literal `schemaVersion: 1`, which schema 2 refuses                                                                                                                                  |

No fourth question: nothing else open could change a decision below.

## Decisions for Ken

Each is the plan's recommendation; the rejected alternative follows it.

**Ken's answers (2026-09-19):** every recommendation accepted, except as follows.

- **F: no trigger is disabled.** Migration 0018 does not backfill a layout onto requests queued before
  it: `publication_request.layout_version_id` is null for a request made before 0018, as it is for a
  template-1 publication, and the job treats a null layout as template 1's. Migration 0017's triggers
  stay enabled throughout.
- **#144 lands in PUB, not TPL**, beside PUB-007 to PUB-014, with the wording: "A layout must declare,
  as a BCP 47 tag, the language its generated words are in; publishing a document whose language that
  tag does not match as a language range must be refused, naming both." Drafted with
  `pnpm trace draft --area PUB --statement "..." --issue 144` (the issue's own area says TPL, which was
  the controller's filing error; the issue carries a comment saying so).
- **PUB-008 and PUB-079 are reworded for clarity** (edits keeping their identifiers, each with a
  change-history row): PUB-008's "total pages" becomes "the physical page count"; PUB-079's "no body
  content" becomes "no outline node survives conditions". Each is edited in the task that cites it.
- **Front matter first is a requirement**: filed as issue #152, it lands as an STR row via
  `pnpm trace draft 152` in task 1, which enforces it, and task 1's test cites it.
- D's cost is accepted knowingly: the first no-op edit of each existing document records one extra
  version, because the canonical form carries the schema version.

**A. Lists (PUB-038) and caption labels (STR-024) move to slice 3.** Slice 2 publishes paragraphs only:
a figure, table or equation fails `block_not_publishable`, so every list of figures would be empty and
no caption is ever printed. The layout's version 1 therefore holds **no `lists` member** - the design's
own rule is that a member nothing reads is not stored - and slice 3 adds it by layout schema 2 and a
second version of the default layout, alongside figures. _Rejected:_ building the lists now and citing
them on a template test fed data `assemble` can never produce, which demonstrates nothing a person can
reach. Q2's answer carries over: slice 3 sets each list with `outline(target: figure.where(...))`.

**B. PUB-012 is not cited in slice 2.** With one format there is nothing to differ. The shape answers it
(`formats` keyed by format, each member its own declaration) and the Word slice cites it with a `docx`
member. `paged` is not stored either: nothing reads it until a format without pages exists.
_Rejected:_ a parse test of one member cited as "able to differ per format".

**C. The contents is Typst's `outline` over our headings, not a list built from `contents()`.** Q2: only
`outline` is tagged `TOC`/`TOCI`; both pass veraPDF, so the difference is exactly what a screen-reader
user meets. Decision F still holds: each heading's text carries `number`'s number, and Typst supplies
only the page. The published document carries `front.contents: { depth } | null`, and a worker test
holds the PDF's entries equal to `contents(conditioned, numbering, depth)`. _Rejected:_ our own list
(read as paragraphs of links; Typst 0.15.1 has no way to role-map custom content to `TOC`). This
changes the design's "each already computed": the depth is computed, the entries are Typst's selection
checked against ours.

**D. Front matter is outline schema 2, by an identity migration** (Q3), and front matter must come
first: a `front` top-level node after any other top-level node is refused by the parse. Tightening is
free now, since no stored outline holds `front`. _Costs, named:_ 15 test files and `dev-content.ts`
move to `OUTLINE_SCHEMA_VERSION`; the first act on a schema-1 document that changes nothing (a node put
back where it was) records a version rather than `version.unchanged`, once per document, because the
digest covers `schemaVersion`. _Rejected:_ widening schema 1 in place - no churn, but "schema 1" would
then mean two shapes, and a rolled-back build would read a `front` outline as corrupt rather than as
newer.

**E. The scheme gains a `front` rule per sequence, and the default's are:** sections `i`, `i.1` (lower
roman, then decimal); figures and tables `Figure i.1`, restarting with each numbered front section;
equations `Equation i`, continuous; footnotes from 1. A caption in front matter before any numbered
front section is withheld, as an appendix's is. Every front label differs from every body label, so no
label prints twice. The id stays **`default/1`**: every outline that could exist before this slice
numbers identically. _Rejected:_ front sharing the body's counters (a preface figure would renumber
every body figure); `default/2` (identical numbers recorded under two names).

**F. The layout is an artifact version seeded by migration 0018**, as 0015 seeds the starter
component type, declared by a singleton `layout_default`. A request records `layout_id` and
`layout_version_id`; a publication carries the same two columns, null exactly on template-1
publications. _Rejected:_ a `publication_input` row (its unique `(publication_id, node)` cannot tell a
node-less layout row from the document's without a new discriminator); a layout held in code
(VER-011, T1, wants layouts versioned by the chain, and a publication must pin by key).

**G. A layout's language matches a document's by RFC 4647 basic filtering**, case-insensitively: the
layout's tag is a range, and the document's tag equals it or extends it at a subtag boundary. `en`
takes `en` and `en-GB`, never `fr`; `sr-Latn` never takes `sr-Cyrl`. The default layout is `en`.
Refused at the door as `layout_language`, naming both tags. Only the document's language is compared:
a component in another language inside it is carried as today. _Rejected:_ exact equality (every
`en-GB` document refused under `en`); the primary subtag alone (`sr-Cyrl` published under `sr-Latn`
words).

**H. The notice's words move into the layout's `words`**, set in the layout's language, but the
template places them itself - above the head on every page including the cover, outside the three
slots - so no layout can remove them. `DRAFT_NOTICE` stays, as the default layout's source.
_Rejected:_ the notice as a slot field, which a layout could leave out.

**I. `pages` is the PDF's physical page count, in decimal; `page` is the page's label in its matter's
format.** Measured. The default foot therefore prints `Page 3`, not `Page 3 of 12`, since the two
count differently. _Rejected:_ the last page of the page's own matter (undefined for an appendix that
continues the body).

**J. Every change of matter starts a new page**, because page numbering is a page property in Typst
(`set page` breaks). A matter restarts its numbering on its first entry only when its rule says so;
returning to a matter continues the counter as it stands. `matter.appendices.newPage` then decides
whether each **later** top-level appendix starts a page. The cover is a page of its own with no label,
holding the title (level-one heading, not bookmarked) and the notice sentence; without a cover both
open the first page as in slice 1.

**K. `nothing_to_publish` when no node survives and the layout declares no cover.** A contents of
nothing is omitted (`front.contents` null), so it never counts as front matter. An empty document under
the default layout publishes its cover alone.

**L. The layout reaches the renderer inside the document view** (`DocumentView.layout`: id, version,
language, scheme); the numbering route numbers with it and names it. _Rejected:_ a layouts route (a
round trip and an access decision for a definition every reader of the document already depends on).

## Global constraints

Plan 1's "Global Constraints" hold unchanged (TDD watched red; plain `it`/`describe` citations only
where the body demonstrates the statement and the design claims it in full; domain platform-free; no
dashes in user-facing strings; `\u{...}` for any non-ASCII in a test; invented names only; `trace.json`
regenerated and pins moved per task; build a package before a filtered run of its importers; never
`pnpm dev:setup`, never stop a container, never unfiltered `turbo run test`). In addition:

- **A task leaves every suite it touches green**, including importers of what it changed.
- **Template `publication/2` is re-pinned freely until this pull request merges**; nothing is published
  from a branch. Template 1's file and hash never change.
- **Page geometry is in points** in the stored layout and in `publishing/2`.
- **The corpus is queried.** Pins are read with `pnpm trace pins`, never counted by hand.

## The stored-shape check

| #   | Shape                                                     | Written by                                                                                                 | Closed by                                                                                                                                                                                       | Later                                                    |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Outline schema 2: `matter` in `front`, `body`, `appendix` | Every outline write (`createDocument`, `editOutline`'s five operations, `recordVersion`, `dev-content.ts`) | The parse, which every path goes through: top level only (existing), **front first** (new). Schema 1 reads through an identity step                                                             | Nothing                                                  |
| 2   | The scheme's `front` rules                                | Nothing stores a scheme except inside a layout (row 3)                                                     | `sequenceRulesSchema` requires all three matters                                                                                                                                                | A new matter is a scheme and layout schema change        |
| 3   | Layout version content, schema 1                          | Migration 0018's literal; `recordVersion` with a `layout` substance (tests only; no route)                 | `layoutSchema`: strict at every depth, `storableEverywhere` over the whole value, a language Typst can carry, a text area of at least 72 pt each way, slots of at most 8 parts, words non-empty | Slice 3 adds `lists` (schema 2); slice 7 a `docx` member |
| 4   | `layout_default`                                          | Migration 0018 alone                                                                                       | Singleton; key to a `layout` artifact; runtime role has no update, delete or truncate                                                                                                           | A route that changes it                                  |
| 5   | `publication_request.layout_id`, `layout_version_id`      | `requestPublication`; 0018's backfill of queued rows                                                       | Composite key to a `layout` version; `not valid` check: not null on every row written from now on                                                                                               | Nothing                                                  |
| 6   | `publication.layout_id`, `layout_version_id`              | `recordPublication`                                                                                        | Composite key; both or neither; `template_version = 1 or layout_version_id is not null`; the commit trigger: null, or its request's                                                             | Nothing                                                  |
| 7   | `publication.numbering` entries with `matter: 'front'`    | `recordPublication`                                                                                        | As slice 1: an object, from `number`                                                                                                                                                            | Read by `pipeline_version`                               |
| 8   | `data.json` `publishing/2`                                | Never stored; its digest is                                                                                | -                                                                                                                                                                                               | A new schema string and template version                 |

## Requirements

**Cited here** (each checked against `pnpm trace show`; all claimed by publishing.md, STR-036 by
structure.md): PUB-007, PUB-008, PUB-009, PUB-011, PUB-014, PUB-037, PUB-079, PUB-088, STR-013,
STR-036, and **TPL-059**, landed from #144 by `pnpm trace draft 144` in task 5 and claimed by
publishing.md there. PUB-088 is not in the build order's list but is what slice 2 builds (cover,
contents, appendices), and its claim is in full.

**Not cited here, though the build order names them:** PUB-038 and STR-024 (decision A, slice 3);
PUB-012 (decision B, slice 7). Their claims stand: the design answers them.

**Pins** (`pnpm trace pins`, read at `5f0fe31`; citations count one per identifier per file):

| Pin (file:line)                                                       | Now  | Moves                                                             | After |
| --------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- | ----- |
| citations, `packages/trace/src/trace.test.ts:264`                     | 193  | T3 +1 (194), T5 +2 (196), T7 +2 (198), T8 +5 (203), T10 +1 (204)  | 204   |
| requirements, `trace.test.ts:52` and `parse/requirements.test.ts:147` | 1382 | T5 +1                                                             | 1383  |
| design claims, `trace.test.ts:121`                                    | 406  | T5 +1                                                             | 407   |
| scanned .tsx test files, `trace.test.ts:309`                          | 10   | none: STR-036's test goes in the existing `DocumentPage.test.tsx` | 10    |

If main has moved when a task runs, set each pin to what `pnpm trace pins` reports and say so in the
pin's comment. **As built**, the pre-flight's sequence superseded this table: the corpus ends at
1,384 requirements (#152 landed as STR-064 in task 1 as well as #144 as PUB-095 in task 5), 408
design claims and 205 citations.

**And `pnpm --filter @alloy-works/trace generate` runs after `pnpm exec prettier --write`, never
before.** Prettier reformatting a test file shifts every citation line below it, and the model
records line numbers, so generating first commits a `trace.json` that no longer matches the tree.
`pnpm trace pins` does not catch it - the counts are right and only the lines are wrong - and the one
CI step that is not `continue-on-error` is the gate, which fails outright when the run it reads has
failed. Task 10 lost an hour to it.

## Files

| Where                                          | Change                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/structure/`               | `outline.ts` (schema 2, front first, `mayBeFront`), `fixtures/v2/every-node.json`, `scheme.ts` (front rules), `numbering.ts`, `lists.ts` (types)          |
| `packages/domain/src/publishing/`              | `layout.ts` (new), `published.ts` (`publishing/2`), `assemble.ts`, `failures.ts`; `version/substance.ts` (a `layout` arm)                                 |
| `packages/db`                                  | `migrations/tenant/0018_layouts.sql`, `src/layouts.ts` (new), `artifact-kind.ts`, `versions.ts`, `tables.ts`, `publishing.ts`, `dev-content.ts`           |
| `apps/worker`                                  | `templates/publication/2/main.typ`, `src/template.ts`, `src/jobs/publish.ts`, `src/testing/pdf.ts`, `src/layout.test.ts` (new)                            |
| `packages/api-contract`, `packages/api-client` | `documents.ts` (`DocumentView.layout`, `NumberingView.layout`, `matter: front`), `publishing.ts` (400 descriptions); `openapi.json` and types regenerated |
| `apps/service`                                 | `documents.ts` (layout in the view and the numbering), `publishing.ts` and `wire-codes.ts` (the two refusals)                                             |
| `apps/web`                                     | `structure/DocumentPage.tsx`, `OutlinePanel.tsx`, `GeneratedLists.tsx`, `tree.ts`; `publishing/Publishing.tsx`                                            |
| Docs and corpus                                | the TPL row, `publishing.md`, `structure.md`, `architecture.md`, `features.md`, `README.md`, `plans/README.md`, `CLAUDE.md`, the release files            |

---

## Task 1: Outline schema 2 and front matter

**Files:** Modify `packages/domain/src/structure/outline.ts`, `outline.test.ts`, `operations.test.ts`;
create `packages/domain/src/structure/fixtures/v2/every-node.json`. Mechanical: every test that builds
a **current** outline with a literal `schemaVersion: 1` takes `OUTLINE_SCHEMA_VERSION` instead -
`structure/{outline,operations,numbering,lists}.test.ts`, `publishing/assemble.test.ts`,
`db/src/{numbering,documents}.test.ts`, `worker/src/{publish,template,regression}.test.ts`,
`service/src/navigation-budget.test.ts`, `web/src/structure/{DocumentPage.test.tsx,tree.test.ts}`,
`web/src/editor/Workspace.test.tsx` - and `db/src/dev-content.ts`. A value standing for a **stored**
schema-1 outline (the `v1` fixture, `version-digest.test.ts`'s digest over what was written) stays 1.

**Interfaces produced:**

```ts
export const OUTLINE_SCHEMA_VERSION = 2;
export const outlineMatterSchema = z.enum(['front', 'body', 'appendix']);
export type OutlineMatter = z.infer<typeof outlineMatterSchema>; // used by SectionNode, ReferenceNode
export const outlineMigrationChain: MigrationChain; // migrations: { 1: (value) => value }
/** A top-level node that no non-front top-level node precedes: where Front matter may be set. */
export function mayBeFront(nodes: readonly { id: string; matter: string }[], id: string): boolean;
```

`refuseAcrossTheTree` gains, beside the depth rule, over the top level:
`Outline node ${id} is front matter after the rest of the outline has begun`.

**Tests** (`outline.test.ts`, `operations.test.ts`):

- `reads a stored schema 1 outline as schema 2, member for member` - `readOutline(v1 every-node)` equals
  the fixture with `schemaVersion: 2`, deep-equal.
- `refuses front matter below the top level, and after any top-level node that is not front matter` -
  `[front, front, body, appendix]` parses; `[body, front]` throws the message above; a `front` child
  throws the existing "sets its matter below the top level".
- The existing `parses every fixture stored at every schema version...` now also collects `matter`
  across the fixtures and expects `outlineMatterSchema.options`; `v2/every-node.json` is `v1`'s with
  `schemaVersion: 2` and a first top-level section `Preface`, `matter: 'front'`, `numbered: false`.
- `mayBeFront answers yes for a leading run of top-level nodes and no after the body begins` -
  `[a front, b body, c body]`: `a` yes, `b` yes, `c` no; a child: no.
- `sets front matter on the first top-level node, and refuses it once the body has begun`
  (`operations.test.ts`) - `set { matter: 'front' }` on the second of two body nodes is
  `outline_invalid` whose reason names the front-first rule.

**RED:** the v2 fixture fails `Stored outline was written against schema version 2, which is newer than
this build's 1`.

- [ ] Write the tests and the v2 fixture; run `pnpm --filter @alloy-works/domain test` - RED as above.
- [ ] Implement; the mechanical edits; `pnpm build`, then `pnpm typecheck` and each touched package's
      suite green. Commit: `Outline schema 2: front matter, first and at the top level`.

**Pins:** none.

## Task 2: Front matter numbers in its own scheme

**Files:** Modify `packages/domain/src/structure/scheme.ts`, `scheme.test.ts`, `numbering.ts`,
`numbering.test.ts`, `lists.ts`; `packages/api-contract/src/documents.ts` (`NumberingView` entries'
`matter` gains `front`); regenerate `openapi.json` and the client's types.

**Interfaces:** `sequenceRulesSchema = z.strictObject({ front, body, appendix })`, each a
`numberingRuleSchema`; `NumberingEntry.matter: OutlineMatter`; `number`'s states keyed by all three;
the withheld rule becomes `matter !== 'body'` where it read `matter === 'appendix'`.

`defaultNumberingScheme` (id `default/1`) gains, exactly:

```ts
section:  { front: { label: '', format: ['lowerRoman', 'decimal'], restartAt: null, prefix: null, separator: '.' } },
figure:   { front: { label: 'Figure', format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' } },
table:    { front: { label: 'Table', format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' } },
equation: { front: { label: 'Equation', format: ['lowerRoman'], restartAt: null, prefix: null, separator: '.' } },
footnote: { front: { label: '', format: ['decimal'], restartAt: null, prefix: null, separator: '.' } },
```

**Tests:**

- `holds the default front matter to its own rules` (`scheme.test.ts`) - the five rules above, and a
  scheme missing any sequence's `front` is refused.
- `numbers front matter in its own counters, and the body as before` (`numbering.test.ts`) - outline
  `[front numbered section with a figure and an equation, body chapter with a figure and an equation]`:
  entries `i`, `Figure i.1`, `Equation i`, then `1`, `Figure 1.1`, `Equation 1`.
- `withholds a front caption before any numbered front section, spending no value` - an unnumbered
  front section holding a figure, then a numbered one holding a figure: `null`, then `Figure i.1`.
- Every existing numbering test passes unchanged: that is the guard that `default/1` numbers every
  pre-existing outline as before.

**RED:** `scheme.test.ts` fails on `front` undefined.

- [ ] Tests; RED. Implement; `pnpm --filter @alloy-works/api-contract generate`, then
      `pnpm --filter @alloy-works/api-client generate`; domain, contract and service suites green.
      Commit: `Front matter numbers in its own scheme`.

**Pins:** none.

## Task 3: The layout, in the domain

**Files:** Create `packages/domain/src/publishing/layout.ts`, `layout.test.ts`; modify
`packages/domain/src/version/substance.ts`, `publishing/index.ts`, `src/index.ts`, `src/index.test.ts`
(the export list).

**Interfaces produced:**

```ts
export const LAYOUT_SCHEMA_VERSION = 1;
export const PUBLISHING_FORMATS = ['pdf'] as const;
export type LayoutField = 'title' | 'section' | 'page' | 'pages' | 'revision';
export type SlotPart = { kind: 'words'; text: string } | { kind: 'field'; field: LayoutField };
export const layoutSchema: z.ZodType<Layout>;
export interface Layout {
  schemaVersion: 1;
  language: string; // BCP 47, one Typst can carry (publishedLanguage)
  words: { contents: string; notice: string; noticeSentence: string };
  scheme: NumberingScheme;
  matter: { cover: boolean; contents: { depth: number } | null; appendices: { newPage: boolean } };
  formats: { pdf: PdfFormat };
}
export interface PdfFormat {
  page: { width: number; height: number }; // points, portrait sense, 72 to 14400
  orientation: 'portrait' | 'landscape';
  margins: { top: number; bottom: number; inside: number; outside: number }; // points, >= 0
  gutter: number; // points, added to the inside margin
  head: [SlotPart[], SlotPart[], SlotPart[]]; // each slot at most 8 parts
  foot: [SlotPart[], SlotPart[], SlotPart[]];
  pageNumbering: Record<OutlineMatter, { format: NumberFormat; restart: boolean }>;
}
export function parseLayout(value: unknown): Layout;
export function readLayout(
  value: unknown,
  context: { artifact: string; version: string },
): { ok: true; layout: Layout } | { ok: false; artifact: string; version: string; failure: string };
export const layoutMigrationChain: MigrationChain; // current 1, no steps
export const defaultLayout: Layout;
/** RFC 4647 basic filtering, case-insensitive: the layout's tag as a range. */
export function speaksFor(layoutLanguage: string, documentLanguage: string): boolean;
export function unsupportedFormats(layout: Layout, formats: readonly string[]): string[];
// substance.ts
export type LayoutSubstance = { readonly kind: 'layout'; readonly content: Layout };
// canonicaliseVersionContent: a layout is canonicalJson(content), as a definition's payload
```

Every object `strictObject`; words and slot words `storableText`, non-empty, at most 200 characters;
the whole value `storableEverywhere`; depth `1..MAXIMUM_OUTLINE_DEPTH`; a refinement that
`width - inside - gutter - outside >= 72` and `height - top - bottom >= 72` in the oriented sense.

`defaultLayout`, exactly:

```json
{
  "schemaVersion": 1,
  "language": "en",
  "words": {
    "contents": "Contents",
    "notice": "<DRAFT_NOTICE.page>",
    "noticeSentence": "<DRAFT_NOTICE.text>"
  },
  "scheme": "<defaultNumberingScheme>",
  "matter": { "cover": true, "contents": { "depth": 3 }, "appendices": { "newPage": true } },
  "formats": {
    "pdf": {
      "page": { "width": 595.28, "height": 841.89 },
      "orientation": "portrait",
      "margins": { "top": 72, "bottom": 72, "inside": 72, "outside": 72 },
      "gutter": 0,
      "head": [
        [{ "kind": "field", "field": "title" }],
        [],
        [{ "kind": "field", "field": "section" }]
      ],
      "foot": [
        [
          { "kind": "words", "text": "Revision " },
          { "kind": "field", "field": "revision" }
        ],
        [],
        [
          { "kind": "words", "text": "Page " },
          { "kind": "field", "field": "page" }
        ]
      ],
      "pageNumbering": {
        "front": { "format": "lowerRoman", "restart": true },
        "body": { "format": "decimal", "restart": true },
        "appendix": { "format": "decimal", "restart": false }
      }
    }
  }
}
```

(`<...>` are the values of those constants, referenced in code, not strings.)

**Tests** (`layout.test.ts`):

- `PUB-011 declares the scheme sections, figures, tables and equations are numbered by, and refuses a
layout without one` - `parseLayout(defaultLayout).scheme` deep-equals `defaultNumberingScheme`; a
  copy with no `scheme` throws; a copy whose scheme lacks `figure` throws.
- `holds the default layout to its own schema` - the values above, and `readLayout` of its JSON
  round-trip is `ok`.
- `refuses every member it does not declare, at every depth` - `lists` at the root, `docx` in
  `formats`, `paged` in `pdf`, `colour` in a slot part: each throws.
- `refuses words and labels that cannot be stored` - `\u{0}` in `words.contents`; a lone `\u{D800}` in
  a scheme label.
- `refuses a page that leaves less than an inch to set text in` - A4 portrait with inside and outside
  of 270 each throws; the same in landscape parses.
- `refuses a language the engine cannot carry` - `sr-Latn` throws; `en-GB` parses.
- `matches a document to its layout by language range` - `speaksFor('en','en-GB')`,
  `('en','EN')`, `('sr-Latn','sr-Latn-RS')` true; `('en','fr')`, `('en-GB','en')`,
  `('sr-Latn','sr-Cyrl')`, `('en','eng')` false.
- `names the formats a layout does not make` - `unsupportedFormats(defaultLayout, ['pdf','docx'])` is
  `['docx']`.
- `digests a layout version's content as canonical JSON` - `canonicaliseVersionContent({ kind:
'layout', content: defaultLayout }) === canonicalJson(defaultLayout)`.

**RED:** `Cannot find module './layout.js'`.

- [ ] Tests; RED. Implement; `pnpm build`; domain suite and `pnpm typecheck` green; regenerate
      `trace.json`; citations pin 193 to 194. Commit: `The layout, closed at its first version`.

## Task 4: The default layout in every environment

**Files:** Create `packages/db/migrations/tenant/0018_layouts.sql`, `packages/db/src/layouts.ts`,
`default-layout.test.ts`, `layout-migration.test.ts`; modify `artifact-kind.ts` (`'layout'`, not
spaced), `versions.ts` (validate and read a `layout` substance through `parseLayout` /
`readLayout`), `tables.ts`, `index.ts`.

**Interfaces produced:**

```ts
export const DEFAULT_LAYOUT_ID = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501';
export interface StoredLayout {
  artifactId: string;
  versionId: string;
  number: string;
  layout: Layout;
}
/** The environment's declared layout at its latest version. Throws if its content does not read. */
export async function defaultLayout(trx: TenantTransaction): Promise<StoredLayout>;
```

**The migration** (the hash literals are computed once with `versionDigests({ kind: 'layout',
content: defaultLayout })` and pasted; `default-layout.test.ts` recomputes them):

```sql
-- Layouts (publishing.md, "The layout"): a definition in no space, versioned by the chain, and every
-- environment starts with one version of the product's default, as 0015 starts it with a component type.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout'));

insert into artifact (id, kind, space_id)
  values ('1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', null) on conflict (id) do nothing;
insert into artifact_version (artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried, component_type_version_id,
  version_digest)
select '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 1, null, null, 1,
  '<defaultLayout as JSON>'::jsonb, '<content hash>', '{}'::jsonb, '[]'::jsonb, null, '<version digest>'
where not exists (select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501');

create table layout_default (
  singleton boolean primary key default true check (singleton),
  layout_id uuid not null,
  layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  set_at timestamptz not null default now(),
  foreign key (layout_id, layout_kind) references artifact (id, kind) on delete restrict
);
insert into layout_default (layout_id) values ('1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501')
  on conflict (singleton) do nothing;

-- A request is made under a layout version. Queued requests take the default, so the job publishes
-- them under it; finished ones keep none, which is what they were made under. The finish-once trigger
-- would refuse the backfill, so it is held off for that one statement.
alter table publication_request
  add column layout_id uuid, add column layout_version_id uuid,
  add column layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  add foreign key (layout_version_id, layout_id, layout_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict;
alter table publication_request disable trigger publication_request_finish_once;
update publication_request r set layout_id = v.artifact_id, layout_version_id = v.id
  from artifact_version v
  where r.state = 'queued' and v.artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501';
alter table publication_request enable trigger publication_request_finish_once;
alter table publication_request add constraint publication_request_layout
  check (layout_id is not null and layout_version_id is not null) not valid;

alter table publication
  add column layout_id uuid, add column layout_version_id uuid,
  add column layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  add foreign key (layout_version_id, layout_id, layout_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  add constraint publication_layout check ((layout_id is null) = (layout_version_id is null)
    and (template_version = 1 or layout_version_id is not null));
```

Then, in the same file: `create or replace function publication_request_finish_once()` with
`old.layout_id` and `old.layout_version_id` added to its unchanged-columns list; the runtime role's
column grant on `publication_request` widened to `(document_id, document_version_id, formats,
requested_by, failures, layout_id, layout_version_id)`; `create or replace function
publication_recorded_whole()` gaining one condition, "the publication's
`layout_version_id` is null or equals its request's" (the trigger passes `new.layout_version_id` as a
new last argument); and `revoke update, delete, truncate on layout_default` from the runtime role.

**Tests:**

- `default-layout.test.ts` (pattern: `starter-component-type.test.ts`): `is declared in every
environment, at 0.1, authored by nobody and in no space`; `is the domain's default layout exactly,
with the digests the domain computes` (stored content deep-equals `defaultLayout`;
  `versionDigests` equals both columns); `gives the runtime role no update, delete or truncate on the
declaration`; `records a layout version only through its schema` (`recordVersion` with a `layout`
  substance holding `lists` refused before any insert; a valid one recorded as 0.2).
- `layout-migration.test.ts` (pattern: `document-migration.test.ts`, migrations to 0017 then all):
  `gives a queued request the default layout and leaves a finished one and every publication without
one`; `refuses, as the runtime role, a new request with no layout and a template-2 publication with
none`.

**RED:** `relation "layout_default" does not exist`.

- [ ] Tests; RED. Implement; `pnpm build`; `pnpm --filter @alloy-works/db test` green (with
      postgres and seaweedfs up). Commit: `Every environment starts with the default layout`.

**Pins:** none.

## Task 5: A request is made under the layout (TPL-059 lands)

**Files:** Modify `packages/db/src/publishing.ts`, `publishing.test.ts`, `apps/worker/src/jobs/publish.ts`
(one field), `docs/specification/requirements/TPL-templates-and-document-instantiation.md` (the row,
section 3), `docs/design/publishing.md` (the claim), `packages/trace/trace.json`, the two pin files.

**Interfaces:**

```ts
// PublicationRequestAnswer: replaces { answer: 'format.unsupported' } and adds one
| { readonly answer: 'format.unsupported'; readonly formats: readonly string[] }
| { readonly answer: 'layout.language'; readonly document: string; readonly layout: string }
// PublicationInputs gains
readonly layout: { readonly versionId: string; readonly layout: Layout };
readonly revision: string;            // the document version's `revision.version`, '0.7'
// NewPublication gains
readonly layoutVersionId: string;
```

`requestPublication` reads `defaultLayout(trx)` after the version precondition; refuses
`unsupportedFormats(...)` non-empty, then `!speaksFor(layout.language, outline.language)`; records
`layout_id`, `layout_version_id`. `recordPublication` inserts them from the request. The worker passes
`layoutVersionId: read.inputs.layout.versionId` (template 1 still; the check allows it until task 7).

Run `pnpm trace draft 144`; paste its row, **TPL-059**, into section 3 of the TPL document. Add a
claim row to publishing.md's "Requirements owned": TPL-059, met by the layout's `language` matched to
the document's by language range (this plan's decision G), a document outside it refused
`layout_language` at the request, naming both tags. Add TPL-059 to build order slice 2's list.

**Tests** (`publishing.test.ts`):

- `PUB-014 refuses a format its layout does not make, naming it, and records nothing` - formats
  `['pdf', 'docx']`: `{ answer: 'format.unsupported', formats: ['docx'] }`; request count unchanged.
- `TPL-059 refuses a document in a language its layout is not written in, naming both, and takes one
in the layout's language` - a document in `fr`: `{ answer: 'layout.language', document: 'fr',
layout: 'en' }`, nothing recorded; one in `en-GB`: `requested`.
- `records the layout version a request was made under, and hands it and the revision to the job` -
  `publicationInputs(...).layout.versionId` is the default's version; `revision` is `'0.1'` for a
  first version.
- `records the publication under its request's layout, and refuses another` - `recordPublication`
  writes `layout_version_id`; one rigged (as the runtime role, in SQL) with another layout version
  fails at commit.

**RED:** the PUB-014 test: `expected { answer: 'format.unsupported' } to deeply equal { ...,
formats: ['docx'] }`; TPL-059: `answer` is `requested`.

- [ ] Tests; RED. Implement; `pnpm build`; db and worker suites green; `pnpm trace generate`;
      `pnpm trace check` clean; pins: citations 194 to 196, requirements 1382 to 1383 (both files),
      design claims 406 to 407. Commit: `A publish is made under the layout, in its language (#144)`.

## Task 6: The routes and the panel say why

**Files:** Modify `packages/api-contract/src/publishing.ts` (400: "`format_unsupported`: a format the
layout does not make; `layout_language`: the document is not in its layout's language"),
`apps/service/src/wire-codes.ts` (`'layout.language': 'layout_language'`), `apps/service/src/publishing.ts`,
`publication-routes.test.ts`, `apps/web/src/publishing/Publishing.tsx`, `Publishing.test.tsx`;
regenerate `openapi.json` and the client.

**Exact words** (the service's `message`; the panel shows it for these two codes):

- `format_unsupported`: `The layout this document is published under does not make ${formats.join(', ')}.`
- `layout_language`: `This document is in ${document}, and its layout is written in ${layout}. It can be published only under a layout in its own language.`

**Tests:** `refuses at the door a document in another language than its layout, naming both, and
queues nothing` (400, code, the message for `fr` and `en`, no job); `refuses at the door a format the
layout does not make` (`docx`); web: `says why a publish was refused at the door, in the service's
words`. No citations: task 5 cites.

**RED:** the route answers 400 with `This document can be published as PDF only.`; the language case
answers 200.

- [ ] Tests; RED. Implement; generate; contract, service and web suites green. Commit:
      `Say why a publish is refused at the door`.

**Pins:** none.

## Task 7: `assemble` under a layout, and template 2 as the port

**Files:** Domain: modify `published.ts`, `assemble.ts`, `failures.ts` (`'nothing_to_publish'`,
compose), `assemble.test.ts`. Worker: create `templates/publication/2/main.typ` as template 1 reading
`publishing/2` (schema assert, `doc.words.notice`, `doc.words.noticeSentence`, nothing else new);
modify `template.ts` (version 2, `2/main.typ`), `template.test.ts`, `jobs/publish.ts`
(`PIPELINE_VERSION = '2'`; passes `layout` and `revision`). Four of the eight are the port.

**Interfaces:**

```ts
export const PUBLISHING_SCHEMA = 'publishing/2';
// AssembleInput: `scheme` removed; `layout: Layout` and `revision: string` added. The scheme is layout.scheme.
export type PublishedPattern = '1' | 'i' | 'I' | 'a' | 'A'; // from NumberFormat, in that order
export interface PublishedPdfFormat {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  margins: { top: number; bottom: number; inside: number; outside: number };
  gutter: number;
  head: readonly [SlotPart[], SlotPart[], SlotPart[]];
  foot: readonly [SlotPart[], SlotPart[], SlotPart[]];
  pageNumbering: Record<OutlineMatter, { pattern: PublishedPattern; restart: boolean }>;
}
export interface PublishedDocument {
  schema: 'publishing/2';
  title: string;
  language: PublishedLanguage;
  direction: 'ltr' | 'rtl';
  status: 'draft';
  revision: string;
  words: { language: PublishedLanguage; contents: string; notice: string; noticeSentence: string };
  format: PublishedPdfFormat;
  front: { cover: boolean; contents: { depth: number } | null }; // null: declared none, or no node
  appendices: { newPage: boolean };
  nodes: readonly PublishedNode[]; // PublishedNode gains `matter: OutlineMatter`, inherited
}
```

**Tests** (`assemble.test.ts`; existing ones take `layout: defaultLayout, revision: '0.1'`):

- `STR-013 numbers the document with the scheme its layout declares` - a layout whose section body
  rule is `['upperRoman', 'decimal']`: top-level numbers `I`, `II`, a child `I.1`; under
  `defaultLayout`, `1`, `2`, `1.1`.
- `PUB-079 publishes an empty document as the cover its layout declares, and refuses one whose layout
declares none` - no nodes, `defaultLayout`: `ok`, `front` `{ cover: true, contents: null }`; no
  nodes, `cover: false`, `contents: { depth: 3 }`: failures exactly `[{ stage: 'compose', code:
'nothing_to_publish', node: null, block: null, detail: null }]`.
- `carries the layout's page in points, its heads and feet, its page numbering as Typst patterns and
its words in its own language` - `pageNumbering.front` `{ pattern: 'i', restart: true }`; `words.language`
  `{ lang: 'en', region: null }`; `format.width` 595.28.
- `carries each top-level node's matter to every node beneath it` and `carries the revision it was
handed` (`'0.7'`).
- `template.test.ts`: template 2's hash pinned (re-pinned in task 8); template 1's hash kept, as a
  `{ 1: ..., 2: ... }` map over both files; `madeByPipeline` gains row `'2'`, computed from the
  fixed input with `layout: defaultLayout, revision: '0.1'`; row `'1'` stays, now unreachable, a
  record of what version 1 made.

**RED:** `expected '1' to be 'I'`; the PUB-079 case returns `ok` with no failure.

- [ ] Tests; RED. Implement; `pnpm build`; domain and worker suites green (publish.test's existing
      cases pass unchanged through the port). Regenerate `trace.json`; citations 196 to 198. Commit:
      `Assemble under a layout: publishing/2`.

## Task 8: Template 2 lays out the page

**Files:** Modify `apps/worker/templates/publication/2/main.typ`, `src/template.test.ts` (re-pin 2),
`src/testing/pdf.ts`, `src/publish.test.ts`; create `src/layout.test.ts`.

**`ReadPdf` gains:** `pageLabels: readonly string[] | null` (`getPageLabels()`), `pageSizes: readonly
(readonly [number, number])[]` (`page.view`), `textLeft: readonly (number | null)[]` (least x of tagged
text per page, from each item's `transform[4]`).

**The template fragments Q1 and Q2 settled** (the rest is the implementer's):

```typ
#let f = doc.format
#let words(body) = text(lang: doc.words.language.lang, region: doc.words.language.region, dir: ltr, body)
// The level-one node a page is in: the first to begin on it, else the last begun before it.
#let section = context {
  let all = query(heading.where(level: 1, outlined: true))
  let here-page = here().page()
  let on = all.filter(h => h.location().page() == here-page)
  let before = all.filter(h => h.location().page() < here-page)
  if on.len() > 0 { on.first().body } else if before.len() > 0 { before.last().body }
}
#let field(name) = if name == "title" { doc.title } else if name == "revision" { doc.revision }
  else if name == "page" { context counter(page).display() }
  else if name == "pages" { context str(locate(<aw-end>).page()) } else if name == "section" { section }
#let slot(parts) = for p in parts { if p.kind == "words" { words(p.text) } else { field(p.field) } }
#let three(slots) = grid(columns: (1fr, 1fr, 1fr), align(start, slot(slots.at(0))),
  align(center, slot(slots.at(1))), align(end, slot(slots.at(2))))
// The notice is the template's, above the slots, on every page: no layout can remove it.
#let header(cover) = { align(end, words(doc.words.notice)); if not cover { three(f.head) } }
#set page(width: f.width * 1pt, height: f.height * 1pt, flipped: f.orientation == "landscape",
  margin: (top: f.margins.top * 1pt, bottom: f.margins.bottom * 1pt,
    inside: (f.margins.inside + f.gutter) * 1pt, outside: f.margins.outside * 1pt),
  numbering: none, header: header(doc.front.cover), footer: none)
// Contents: Typst's outline, tagged TOC/TOCI; the numbers are the headings' own text (`number`'s).
#show outline.entry: it => link(it.element.location(),
  it.indented(none, [#it.body() #box(width: 1fr, repeat[.]) #it.page()]))
// Segments: consecutive top-level nodes of one matter. Each begins a page in its matter's numbering,
// restarting only on the matter's first entry, when its rule says so (decision J).
#let segments = doc.nodes.fold((), (acc, n) => {
  if acc.len() > 0 and acc.last().matter == n.matter { acc.at(-1).nodes.push(n); acc }
  else { acc.push((matter: n.matter, nodes: (n,))); acc } })
#for (i, s) in segments.enumerate() {
  let rule = f.pageNumbering.at(s.matter)
  pagebreak(weak: true)
  set page(numbering: rule.pattern, header: header(false), footer: three(f.foot))
  if rule.restart and segments.slice(0, i).all(t => t.matter != s.matter) { counter(page).update(1) }
  // ...the contents at the head of the front segment (or a front segment of its own when the outline
  // has no front node); each node as in template 1, its heading labelled `<n-ID>`; each later appendix
  // after `pagebreak()` when doc.appendices.newPage.
}
#metadata(none) <aw-end>
```

The cover, when `front.cover`: the title heading (level 1, not outlined or bookmarked) and the notice
sentence, alone on page 1. Without it, both open the first segment's first page.

**The fixture** (`layout.test.ts`), compiled from `assemble` straight through the template as
`regression.test.ts` does: `Preface` (front, unnumbered reference, 6 paragraphs); `Scope` (section) >
`Terms` (reference, 4) > `Units` (section); `Method` (reference, 8); appendices `Tables` > `Readings`
(reference, 4) and `Sources` > `Notes` (reference, 1). Each paragraph is `Ada measured the bridge twice
and wrote down what she found, because a number written once is a number nobody checked. ` twelve
times. The test layout: the default with A4 **landscape**, margins 72, 72, inside 72, outside 54,
gutter 18, contents depth 2, head `[[title], [section], [words 'Revision ', revision]]`, foot
`[[], [], [words 'Page ', page, words ' of ', pages]]`, revision `'0.7'`.

**Tests** (`layout.test.ts`):

- `PUB-007 sets the page the layout declares: its size, orientation, and inside and outside margins
alternating about the gutter` - every `pageSizes` entry `[841.89, 595.28]` within 0.01; `textLeft`
  90 on odd pages and 54 on even, within 0.5.
- `PUB-008 sets running heads and feet from the layout's words and fields` - every page after the
  cover: artifact text holds the fixture's title `The bridge survey`, `Revision 0.7` and
  `Page <label> of <pages>` (whitespace normalised, `<pages>` the page count); the page where `2 Method` begins, and the next, hold
  `2 Method` and not `1 Scope`; the cover holds the notice alone.
- `PUB-009 numbers each matter's pages as the layout declares` - `pageLabels[0]` is `''`; the front
  pages are `i`, `ii`, ... consecutively; the first body page is `1`; the first appendix page is the
  last body label plus one. A second layout with `appendix: { format: 'upperAlpha', restart: true }`:
  the first appendix page is `A`.
- `PUB-037 sets a contents to the layout's depth, tagged as a table of contents, with number's numbers
and Typst's pages` - `roles` include `TOC` and `TOCI`; the contents page's tagged entries, in order,
  are `Preface`, `1 Scope`, `1.1 Terms`, `2 Method`, `A Tables`, `A.1 Readings`, `B Sources`,
  `B.1 Notes` - exactly `contents(conditioned, numbering, 2)`'s - and not `1.1.1 Units`; each is
  followed by the label of the page its heading is on.
- `PUB-088 sets the cover and contents a layout declares, starts each appendix on a new page, and sets
none of them where it declares none` - default matter: page 1's tagged text is exactly the title and
  the notice sentence, `B Sources` begins a page; `{ cover: false, contents: null, appendices: {
newPage: false } }`: page 1 begins with the title, then `Preface`, no `TOC` role, and `B Sources`
  shares the page `A.1 Readings` ends on.
- `says Not approved on every page, the cover included, and once to assistive technology, under any
layout` - both layouts.
- `passes veraPDF under the default layout and under the test layout` - compliant, 0 failed.
- `publish.test.ts`: the PUB-093 case asserts every page's artifacts **include** the notice (they now
  hold heads and feet too); new `publishes an empty document as its cover alone, under the default
layout` - one page, label `''`, veraPDF compliant; `records the default layout's version on the
publication`.

**RED:** `pageSizes[0]` is `[595.28, 841.89]` (the port sets A4 portrait); `pageLabels` null.

- [ ] Tests; RED. Implement; re-pin template 2's hash; worker suite green (`fetch-typst`,
      `fetch-verapdf`, Docker). Regenerate `trace.json`; citations 198 to 203. Commit:
      `Template 2 sets the page, its heads and feet, its numbers and the contents`.

## Task 9: The layout's scheme to the numbering route and the document route

**Files:** Modify `packages/api-contract/src/documents.ts`, `apps/service/src/documents.ts`,
`numbering-routes.test.ts`, the documents route test (`documents-routes.test.ts`); regenerate.

**Interfaces:**

```ts
// DocumentView gains
layout: z.object({ id: z.string(), version: z.object({ id: z.string(), number: z.string() }),
  language: z.string(), scheme: z.record(z.string(), z.unknown())
    .describe('The numbering scheme this document is numbered and published with') }),
// NumberingView gains
layout: z.object({ id: z.string(), version: z.object({ id: z.string(), number: z.string() }) }),
```

Both handlers read `defaultLayout(trx)`; `getNumbering` numbers with `layout.scheme`.

**Tests:** `numbers with the scheme of the layout the document is published under, and names it` - a
test records version 0.2 of the default layout (`recordVersion`, `layout` substance) whose section
body rule is `['upperRoman', 'decimal']`: entries `I`, `I.1`; `layout.version.number` `'0.2'`.
`answers the document's layout beside its outline, the version a publish would record` -
`DocumentView.layout.version.id` equals `publicationInputs(...).layout.versionId` for a request made
next. Cross-tenant and access tests: nothing new to read (the view already has them).

**RED:** entries read `1`, and `layout` is undefined.

- [ ] Tests; RED. Implement; generate; contract and service suites green. Commit:
      `The routes number with the layout's scheme`.

**Pins:** none.

## Task 10: The panel numbers with the layout, and offers front matter

**Files:** Modify `apps/web/src/structure/DocumentPage.tsx`, `OutlinePanel.tsx`, `GeneratedLists.tsx`,
`tree.ts`, `DocumentPage.test.tsx`, `tree.test.ts`.

**Interfaces:** the page parses `view.layout.scheme` with `numberingSchemeSchema` once per view and
passes `scheme: NumberingScheme` to the panel and the lists, replacing every `defaultNumberingScheme`;
a scheme that does not parse numbers nothing and says `This document's numbering could not be read.`
`tree.ts`: `nestsAnAppendix` becomes `leavesTheTopLevel(nodes, id, direction)` (any node not `body`),
and `breaksFrontFirst(nodes, id, direction)`.

**Exact words:** a top-level node's **Appendix** checkbox becomes a select labelled **Matter** with
options **Front matter**, **Body**, **Appendix**; **Front matter** is offered only where `mayBeFront`
says so. Notices: `Front matter and appendices stay at the top level.` (replacing `An appendix stays
at the top level.`) and `Front matter comes before the rest of the outline.`

**Tests** (`DocumentPage.test.tsx`, `tree.test.ts`):

- `STR-036 numbers the outline with the scheme of the layout the document is published under` - the
  fake view's layout scheme has `['upperRoman', 'decimal']` sections: the panel shows `I`, `II`,
  `I.1`, never `1`; the lists' labels come from the same scheme.
- `offers Front matter, Body and Appendix for a top-level node, and Front matter only before the body
begins` - choosing **Front matter** sends `{ operation: 'set', matter: 'front' }`.
- `says front matter stays at the top level and comes first, and sends nothing` - demoting a front
  node shows the first notice; moving a front node down past a body node shows the second; no
  operation is sent for either.
- The existing appendix tests follow the select.

**RED:** the panel shows `1` for the first node.

- [ ] Tests; RED. Implement; web suite green under the console gate. Regenerate `trace.json`;
      citations 203 to 204. Commit: `The panel numbers with the layout and offers front matter`.

## Task 11: The whole stack

No new code. With the stack up (`docker compose -f deploy/compose.yaml up -d --build --wait`), run
`pnpm test:e2e` only if the end-to-end suite builds an outline or publishes (grep first; it did not
at `5f0fe31`), then `pnpm test` from the root once. Fix what breaks in the task that caused it.

## Task 12: The docs, the trace and the release

- **`publishing.md`**: decisions A to L of this plan recorded under a new **Changed while planning and
  building the second slice**; "The layout"'s table as built (no `lists`, no `paged`, words three, the
  notice outside the slots); build order slice 2's citations as built and slice 3 gaining PUB-038 and
  STR-024, slice 7 PUB-012; "What was run" gains Q1 to Q3's rows; the claim table's PUB-037 row says
  the contents is Typst's `outline` over `number`'s headings.
- **`structure.md`**: `front` matter and its rules in "The scheme" and "The counter stack"; STR-036
  cited, and its "claimed on two terms" paragraph says the layout's scheme now reaches the panel.
- **`architecture.md`**: migration 0018, `layouts.ts`, `layout.ts`, template 2, the view's `layout`.
- **`features.md` and `README.md`**: publications have a cover, a contents, running heads and feet
  and numbered pages; outlines have front matter; a document is published only in its layout's
  language.
- **`docs/plans/README.md`**: this row to `Built (PR #n)` with a paragraph. **`CLAUDE.md`**: the
  status paragraph.
- **Release:** `version.json`, root `package.json`, `apps/desktop/package.json` to **0.31.0**; at the
  top of `CHANGELOG.md`:

```markdown
## 0.31.0 - YYYY-MM-DD (PR #n)

### Added

- Publications are laid out: a cover, a contents that a screen reader announces as one, running
  heads and feet with the title, the chapter, the revision and the page, and pages numbered in roman
  in the front matter and from 1 in the body.
- An outline can hold front matter - a preface, say - at its start, numbered in its own scheme.
- The outline panel numbers with the scheme the document is published with.

### Changed

- A document is published only under a layout in its own language, and the page says so when it is
  not. Every document publishes under the product's default layout, in English (#144).
```

- [ ] PR body carries `Fixes #144` on its own line. `pnpm trace check` and `pnpm trace gate` clean.

---

## What this plan leaves undone

Every task of this plan was built. What it leaves:

- Lists of figures, tables and equations and caption labels (PUB-038, STR-024) - slice 3, with
  figures; PUB-012's citation and any non-paged member - the Word slice.
- The outline's per-node `pageBreak`, stored since structure 1 and still ignored by the template;
  `recto` starts; right-to-left binding (inside margins follow Typst's default binding for the
  document's direction, unverified for `rtl`).
- Choosing or editing a layout (a route, `design` at the tenant, and TPL's link from a document to
  its template); a layout in any language but English; a cover showing more than the title and the
  notice; `pages` counted within a matter.
- **A cover-only publication carries no page labels at all.** An empty document under a layout with a
  cover publishes its one page, and that page is not numbered, so Typst writes no `/PageLabels` for
  the file and a reader shows the page as `1`. Judged acceptable: no `/PageLabels` makes no claim,
  where a wrong label would.
- **A node's own language is not carried into the running head.** The head is furniture, set in the
  document's language whatever the chapter it names is written in.
- **An over-long running head runs off the top of the sheet** rather than being bounded: the widest
  the layout schema allows (three slots of eight parts, each up to 200 characters) does not fit any
  page the schema allows. Unreachable until layouts can be edited, and among the bounds that plan
  must set, with the scheme's strings and repeated page labels across matters.
- **Alphabetic page labels past twenty-six pages are unverified.** PDF's `/a` and `/A` label styles
  repeat letters (`aa`, `bb`) where `formatCounter` is bijective (`aa`, `ab`), and whether Typst's
  printed foot follows one or the other past `z` was never measured; nothing in the fixtures reaches
  it, and the default layout numbers no matter alphabetically.
- **The `n-<id>` label template 2 writes for each top-level node is untested**, because nothing reads
  it until cross-references arrive with structure 4.
- **The panel's own language is not checked against the layout's.** `DocumentView.layout.language`
  reaches the renderer and nothing reads it: a publish that the layout cannot speak for is refused at
  the service's door, so the page finds out by asking rather than by knowing beforehand.
- **Nothing drives a front-matter drag at the pointer level in the rendered page.** `dropMove` is
  covered as a unit and the existing appendix drag tests exercise the same generalised code, so a
  front duplicate of each would test the framework rather than the rule.
- Everything plan 1 left to slices 3 to 7.
