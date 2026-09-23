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

## What the build changed

- **R1 is a factory over what `assemble` holds**, not a stage taking `Conditioned`:
  `referenceResolver({ outline, occurrences, numbering })` indexes the document once and returns the
  function that binds each reference, `(target, { node }) -> resolution`. It reads the **stored**
  outline, since a reader's view withholds occurrences and a `component` target counted over one
  could take a component's one visible occurrence for its only one. It still cannot run before
  `number`, whose table it takes; while `conditions` is the identity the outline is what survives
  it, and the day REU gives `conditions` a profile, resolution must be handed what survives (STR-051).
  A `node` target naming an occurrence binds as a section, by its number and its component's title.
  Every block that takes no number - a paragraph, a list, a quotation, preformatted text, and an
  equation, whose number nothing offers - is kind `block`, with neither label nor title.
- **A footnote's own paragraphs are not targets.** Resolution does not find them (`missing`): they are
  the footnote's, set in its note on its page, a reference names the footnote, and a label inside a
  note is not among the cases XR-D measured. With equations unpublishable too, no test can publish a
  page reference to every kind of block, so **CNT-125 is not cited**.
- **R2's words are optional members held together by a refinement** - _A layout gives its words for
  above and below together, or neither_ - and `layoutWordsSchema`, the `words` member alone, is
  exported so the document page can check them as it checks a scheme. `SECOND_DEFAULT_LAYOUT` and a
  new `THIRD_DEFAULT_LAYOUT`, 0.3, are frozen as literals at schema 2, each parsed through today's
  migration chain when the module loads, so a frozen default that no longer reads fails at import.
  Migration 0023 seeds 0.4 only where 0021's unauthored 0.3 is still the latest version. `above` and
  `below` are checked against the faces with the layout's other words, `layout_glyph_missing`.
- **R3's title of a section is the words it is published with**, its own reference printed as its
  number - _Results of 1_. **A caption's title is its author's words**, as resolution reads them,
  with no reference in it resolved: a caption printing another caption could have no end. `relative`
  comes from one walk in publish order - a node where its heading is set, a block where it begins, a
  footnote where its mark stands - so a target holding the reference, its section, its paragraph or
  the table whose caption it is in, is _above_.
- **R4's anchors stand on named targets alone.** Every published block, footnote and node carries
  `anchor`, straight after `id`, and it is null unless a reference names it. A named block that
  publishes nothing - an empty paragraph, empty preformatted text, a list or a quotation whose items
  are all empty - leaves a `{ type: 'marker', anchor }` block in its place, which can stand at a
  node's level, in a list's item, in a quotation and in a table's cell. A footnote's paragraphs never
  carry one.
- **A target in a table's header rows is refused**, a ruling the plan did not have. Measured with the
  pinned Typst: a reference to a paragraph in the header row of a table long enough to repeat it
  refused the compile - _label ... occurs multiple times in the document_ - because the repeated row
  sets the label again on every page. So `assemble` fails any reference whose target stands in a
  header row - a paragraph, a list, a marker or a footnote there -
  `cross_reference_form_unavailable`, naming the form asked, which can only be `page` or `relative`,
  since nothing there has a number or a title. It is refused whether or not the table breaks, which
  only the engine knows, as a footnote there is. It is a form failure and not `unresolved`, because
  the target resolves: what cannot be printed is what the reference asks of it there. A header column
  is set once, and a target there is published.
- **R6 and R7 hold under a layout.** A request made before layouts (`publishing/1`, frozen) has no run
  to carry a reference, so it still refuses one by name, `inline_not_publishable` with the detail
  `crossReference`, and a title's `title_not_publishable`. The page's sentence for it is reworded
  rather than removed: _A cross-reference cannot be published under this request's layout._
- **R7's failures come in one place in the list**: references are resolved once, after the layout's
  own checks and before anything is projected, so their failures follow the layout's and come before
  every other failure of the content, in document order among themselves. A reference in a section's
  title names that section as its node. `cross_reference_unresolved`'s detail is the stored target
  whatever the reason - not held, its component placed nowhere, or placed twice - and the page says
  one sentence for all three: _A cross-reference points at something this document does not hold, or
  at a component it holds more than once._ Which of them is not an author's to read from a component
  they may not see. `cross_reference_form_unavailable` has a sentence per form, and the page's and
  the relative form's name a table's header row.
- **R8's maps are guarded by a typed constant.** `template.ts` exports
  `PUBLISHING_SCHEMA_CURRENT: 'publishing/10' = PUBLISHING_SCHEMA`, annotated with its literal, so the
  day `PUBLISHING_SCHEMA` is repointed the typecheck fails; `TEMPLATE_READING` and `PIPELINE_VERSION`
  key the current template by it, and their `satisfies` refuses a row for a schema nothing makes.
  **The row `publishing/9` to template 9 is kept**, as R8 asked, although nothing makes `publishing/9`
  now; footnotes 2 dropped 8's on that ground. It is typed and harmless, and dropping it means
  dropping `typeof PUBLISHING_SCHEMA_9` from the `satisfies` too.
- **Template 10 labels a heading only where a reference names it**, where template 9 labelled every
  one: a label for every reference and no more. Every label is built with `label(..)`, never the
  literal syntax, since a block's identifier is any stored string. A page reference asserts that its
  target's page has a numbering, which only the cover lacks, and the cover holds no target.
- **R9 reaches the wire.** `DocumentView.layout` carries `words` beside `scheme`, a loose record the
  page checks with `layoutWordsSchema` as it checks the scheme; the editor's `ReferenceContext`
  carries them into the surface and the dialog's line alike, and `printed` falls back to the English
  words without them. **A title's own reference now shows as its number in the page too**:
  `documentTargets` read a section's title as a caption is read, dropping the reference, so a title
  published as _Results of 1_ was offered as _Results of_; `titleWords` resolves it from the same
  labels.
- **R10's read-back is what holds "no link in a caption or a title"**: veraPDF passes a link nested in
  a contents or a list's entry, so only reading each page's links back catches one. `readPdf` gained
  `destinations`, each internal link's rectangle and the page it goes to. The regression case uses
  the layout's own words, _earlier_ and _further on_, so English cannot pass for them.
- **Citations**: STR-028, STR-029, STR-031, STR-032, STR-056 and STR-062 are cited by `assemble`'s
  tests - a failure of `assemble` is the publish's, as footnotes 2's CNT-042 test has it - and
  STR-027 by the worker's regression case, which reads each form back from the PDF.

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
