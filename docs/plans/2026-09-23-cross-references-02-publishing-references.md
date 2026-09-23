# Cross-references 2: Publishing references

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as cross-references 1 was. It builds structure.md's resolution (structure 4's
> `references`, [Cross-references](../design/structure.md#cross-references)) and
> [Making, showing and printing a reference](../design/structure.md#making-showing-and-printing-a-reference)'s
> XR-C (the layout's words), XR-D and XR-F's publish half: the second of XR-G's two pull requests.

**Goal:** a publish resolves every cross-reference in the document it publishes and prints it: a
number, a title, both, a page or "above" and "below" in the layout's words, as a link to its target
in a paragraph's text and as text where a link cannot stand. A reference whose target the document
does not hold, or cannot tell apart, fails the publish naming the reference and its target; one asking
its target for a form it lacks fails naming the form.

**Not in this slice:** Word's fields (PUB-026, with Word output); a format with no pages, and so
`withoutPages` (STR-055: the PDF is the only format, and it is paged); a way to say which of a
component's several occurrences a `component` target means (structure.md: a widening for later);
citations (PUB-022's other half, with LIB).

**Requirements** each test cites, only where it demonstrates the whole statement:

- **STR-027** (the five display forms): each form published and read back from the PDF - the number,
  the title, both, the page in the target's matter's numbering, and "above" and "below" in the
  layout's words.
- **STR-028** (resolve in the resolving document): one component placed in two documents prints its
  reference's number from each.
- **STR-029** (an unresolved reference fails the publish, naming both): `cross_reference_unresolved`
  naming the reference and its target, through the publish job.
- **STR-031** (resolve afresh; no stale number): the same document published after its outline is
  reordered prints the new number.
- **STR-032** (the same component and another): both published.
- **STR-056** (a component placed twice resolves against the occurrence read): each occurrence's
  reference prints its own occurrence's number.
- **STR-062** (exactly one occurrence, else a named failure): a `component` target whose component
  occurs twice, or not at all, fails by name.
- **CNT-125** (any block can be a target), only if the test publishes a page reference to every kind
  of block the model has; otherwise not cited.
- **Not cited:** STR-026 (its bibliography entry is still missing), STR-055 (no format without pages),
  PUB-022 (citations), PUB-051 and PUB-072 (their other failures), PUB-026 (Word).

## Rulings

- **R1. Resolution** (structure 4's `references`), in `packages/domain/src/structure/references.ts`,
  pure: a reference is bound to the occurrence it is read in. A `block` target reaches that
  occurrence's block or footnote; a `component` target that component's one occurrence, and fails
  where the document holds it in none or several (STR-062); a `node` target the node. Bound, it is
  looked up in the numbering table for a number, and in the occurrence's content for a block that
  takes none - a paragraph, a list - which can still be pointed at for a page or a relative form
  (XR-C). A target in neither fails. It returns the bound target - its occurrence, its block or node,
  its kind, label and title - or the reason it failed.
- **R2. The layout's words** (XR-C): layout schema 3 adds `words.above` and `words.below`, both or
  neither. Version 2 reads as neither - a migration cannot know another language's words - and the
  default layout's **version 0.4**, seeded by a new migration as 0.3 was, carries _above_ and
  _below_. A `relative` reference under a layout with neither fails
  `cross_reference_form_unavailable`, naming the form.
- **R3. What a reference prints**, in `assemble`: `number` is the label (a section's number where its
  scheme gives no word); `title` a section's title or a figure's or a table's caption words;
  `numberAndTitle` both, a space between; `relative` the layout's _above_ where the target comes
  before the reference in document order or holds it, else _below_; `page` is left to the template,
  which prints the target's page number in its matter's own numbering. A form the target lacks - a
  number or a title asked of a paragraph, a title of a footnote - fails
  `cross_reference_form_unavailable`, naming the reference and the form.
- **R4. The published document** (`publishing/10`): a run may be
  `PublishedReferenceRun { reference: { anchor, text, page, link } }` - the target's anchor, the text
  (null for a page), whether the page is asked for, and whether it is a link. Every published block,
  footnote and node that a reference names carries `anchor` (`b-<node>-<block>`, `n-<node>`); others
  carry null, so the file carries a label for every reference and no more. A named target that
  publishes nothing carries its anchor on an empty marker (XR-D), which `assemble` emits in its place.
  `publishing/9` is frozen as `PUBLISHING_SCHEMA_9`.
- **R5. Where a reference is a link** (XR-D, measured): in a paragraph's text - running text, a list's
  item, a quotation, a table's body cell, a footnote's text. **Not** in a table's header row (repeated
  rows are artifacts, where a link refuses the compile, as a footnote there did), a caption, a term, an
  attribution or a table's note: there it is text.
- **R6. A section title's reference** is resolved into the title's words, since a published title is
  a string: its number. A `page` reference in a title fails `cross_reference_form_unavailable` - the
  running heads and the contents set a title again, where a page would be computed per place and a
  link refuses the compile.
- **R7. Failures** (XR-F): `cross_reference_unresolved` and `cross_reference_form_unavailable` join
  the failure codes, each naming the occurrence, the reference's identifier as the block, and the
  target or the form in `detail` (`block <id>`, `node <id>`, `component <id> block <id>`, or the form's
  name) - never the author's text. Every reference's failure is collected, as footnotes 2's are. The
  refusal `inline_not_publishable` with detail `crossReference` goes, and the publishing page's
  sentence for it with it. The API contract's enum and the client's types are regenerated.
- **R8. The template, version 10**: template 9 plus a reference run - text, linked or not, or a page
  set in `context` from `locate`, `counter(page).at` and the location's `page-numbering`, linked or
  not - and a label on each published element carrying an anchor: a heading, a paragraph, a list, a
  quotation, preformatted text, a table's figure, a figure, a footnote, and the empty marker
  (`metadata(none)`). `TEMPLATE_READING` keys schema 9 by its frozen constant, never by
  `PUBLISHING_SCHEMA`, which now names 10 (the schema-keyed map trap), and `PIPELINE_VERSION` is `10`.
- **R9. The editor speaks the layout's words**: the document page passes its layout's `above` and
  `below` to `printed`, falling back to English where the layout has none, so what the editor shows
  is what the publish prints.
- **R10. The regression**: a worker test compiling a document with every form, every link and non-link
  place, a forward and a backward reference, a reference to a section, a figure, a table, a footnote
  and a paragraph, in front matter and the body, checked by veraPDF and read back: each link's
  destination, each page number against the target's page, and no link in a header row, a caption, the
  contents or a running head.

## Tasks

1. **`packages/domain`, resolution and the layout**: R1 and R2 - `references.ts`'s resolution, layout
   schema 3 with its migration, and the default layout 0.4 constant.
2. **`packages/db`**: the migration seeding the default layout 0.4, and `default-layout.test.ts`.
3. **`packages/domain`, the publish**: R3 to R7 - `publishing/10`, the failure codes, and `assemble`.
4. **`apps/worker`**: R8 and R10 - template 10, `template.ts`, the pipeline version, the pins, and the
   regression test.
5. **`apps/web`, the contract and the client**: R7's sentences and regenerated types, and R9.
6. **Docs**: publishing.md's and structure.md's claims and what building changed, architecture,
   features and the README, CLAUDE.md's status, this plan's status, the version (Minor, 0.64.0) and the
   changelog; trace generate and pins.
