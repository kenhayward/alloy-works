# Editor framework spike - findings

Run 2026-09-13 against the brief in [Editor_Framework_Spike.md](Editor_Framework_Spike.md).
Candidate: **ProseMirror** 1.25.11 (model), 1.42.3 (view), with `prosemirror-tables` 1.8.5.
Code is in [`/spikes/editor-framework/`](../../../spikes/editor-framework/) and is throwaway.

Findings are not edited once written.

## The premise the brief asked to be checked, not inherited

The brief argued a candidate order from the corpus and said plainly that the narrowing was a premise:
marks cannot be elements (CNT-003, CNT-007), and ADR-0005 describes a transform step log without
naming one. **Both held.** ProseMirror keeps marks as a set on the text node, carrying attrs, so an
identifier lives on the mark itself; and the overlap in gate 2 needed no construct of its own. The
order was never tested further, because the first candidate passed every gate.

## Verdicts

| Case                                      | Verdict            | Cost                                                                                                                                |
| ----------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1** - A document of many components     | **Pass with cost** | The architecture is decided rather than chosen: one view per component, because one view cannot give CNT-069 its per-component undo |
| **2** - Overlapping annotations, edited   | **Pass**           | None. The discriminator holds through editing, not only statically                                                                  |
| **3** - An authored table                 | **Pass with cost** | The model is free; the **accessible DOM is not**. Two defects, one of which blocks a library plugin                                 |
| **4** - Keyboard and assistive technology | **Pass with cost** | Zero automated violations - and the suite passed a defect gate 3 found, which is the finding that matters                           |
| **5** - Block identifiers through editing | **Pass with cost** | One plugin, and its rule is subtler than it looks. Three wrong versions were written before the right one                           |
| **6** - The lossless round-trip           | **Pass**           | None                                                                                                                                |
| **7, 8, 9, 10**                           | **Not run**        | Maths, spelling, the theme at measure, and the step log. Non-gates; recorded as unrun rather than assumed                           |

18 model-level assertions pass with none failing. The full output is reproducible by
`node model-gates.mjs` in the spike directory.

## Gate 1 - a document of many components: pass, and the architecture is decided rather than chosen

**The shape is one `EditorView` per component, stitched into one scrolling container.** The
alternative - one view over a document whose top level is component nodes - was ruled out before it
was built, and by a requirement rather than by taste:

- **CNT-069 scopes undo to the component being edited.** `prosemirror-history` keeps one undo stack
  per editor state. One view over many components is one stack, so per-component undo would mean
  replacing the history plugin rather than configuring it.
- **CNT-074 requires per-component editability.** With one view per component that is the `editable`
  prop, a flag. With one view it is a `filterTransaction` rejecting edits that touch the wrong
  subtree - every transaction, forever, and a bug in it is a permission failure rather than a glitch.

So the requirements choose the architecture. That is worth stating because it looks like an
implementation decision and is not.

**It is fast enough, and by more than expected.** 300 components, each two blocks with overlapping
annotations, a language-tagged run and a footnote:

| Measure                         | Result      |
| ------------------------------- | ----------- |
| Views mounted                   | 300         |
| Mount time, whole document      | 26 to 34 ms |
| DOM nodes                       | 3,916       |
| JS heap after mount             | 7 to 30 MB  |
| Editable / read-only components | 200 / 100   |

**These are warm, single-machine, synthetic figures**, on the same terms as every other spike here.
The components carry real marks but short text, and 300 mounted views is not the same problem as 300
components of a real report. What the number rules out is the fear the brief carried: that 300 editor
instances would be unusable. They are not, by two orders of magnitude, and virtualising the scroll is
not needed to clear CNT-076.

**Undo is scoped, and it was verified rather than assumed.** Text typed into component A and component
B; undo in A reverted A, left B's edit in place, and left B's history untouched.

**A tension between CNT-073 and CNT-074 that the requirements do not resolve.** CNT-073 says component
boundaries "must not be permanent chrome". CNT-074 says the view must always show "whether this user
may edit it right now, and when they may not, why". A read-only component therefore needs a permanent
affordance, which is chrome. The spike settled on a hairline rule rather than a filled box, but the
two requirements pull against each other and the editor design has to say so explicitly rather than
discover it.

## Gate 2 - overlapping annotations, then edited: pass, no cost

The content model spike's case 1 rebuilt in the editor's model, then edited around:

- A condition over "registered under" and a suggested deletion over "is registered", overlapping
  without nesting, needing **no construct of their own** - no milestone, no range start or end, no
  standoff table. CNT-007 holds.
- **Typing inside the overlap** kept both annotations, each still one identifier. The inserted text
  inherited the marks at the position and merged into the existing text node.
- **Splitting the paragraph across both** left each annotation one annotation under one identifier,
  now spanning two blocks - the fragmentation ADR-0005 describes as "the same shape as standoff
  markup rather than a loss".
- **Accepting acted on every fragment in one transaction** (three ranges), leaving the overlapping
  condition untouched. CNT-005 holds.
- **Two different annotations of one type, adjacent, stayed two.** Distinct attrs make the marks
  unequal, so the text nodes do not merge. This was the one most likely to fail quietly, because
  merging adjacent equal-marked text is exactly what the library does by design.

## Gate 3 - an authored table: pass on the model, two defects in the DOM

**The model is free.** Merged cells, declared header rows and header columns, a caption, a footnote
anchored to a cell by key value, and an inline image in another cell. A row inserted afterwards left
every one of them intact and the table well-formed.

**The accessible DOM is not free, and neither defect announces itself.**

**`prosemirror-tables` emits a bare `<th>` with no `scope`.** In a table with both a header row and a
header column that is ambiguous: assistive technology cannot tell whether a cell heads its row or its
column. TAB-031 requires header cells "associated with the cells they describe, in every output", and
they were not. Fixed by overriding `table_header`'s `toDOM` - a bounded cost, one function.

The spike's own `scope` rule keys off whether a cell declares a key column, which is a fixture-shaped
proxy rather than the real rule. The real one needs the cell's position, which `prosemirror-tables`
supplies through its `TableMap`. That is noted rather than solved.

**`columnResizing` owns the table DOM, so `toDOM` cannot add a `<caption>`.** TAB-039 requires the
caption "programmatically associated with its table in every output, not merely placed beside it". A
`toDOM` emitting `<table><caption>…` produced no caption at all, and the reason is that
`columnResizing` installs a `TableView` node view that builds `<table><colgroup><tbody>` itself and
ignores `toDOM`. This was confirmed by counterfactual rather than inferred: with column resizing
disabled the same code emits `<caption>` correctly, children `[CAPTION, TBODY]`, and every model
assertion still passes.

So TAB-039 costs either column resizing, or a node view of our own replacing theirs. Both are
bounded. Which one is the editor design's call, not this spike's.

## Gate 4 - keyboard and assistive technology: pass, and the finding is bigger than the verdict

**axe-core 4.13.0, WCAG 2.0/2.1/2.2 A and AA: zero violations, 18 passes, one incomplete
(`color-contrast`, which axe cannot determine for these styles).**

The surface reports itself honestly: 300 regions announced as multi-line textboxes, 100 of them
announced read-only with the reason in the label, every suggestion labelled with its operation and
author, every footnote reachable by keyboard and labelled with its note, every non-base-language run
carrying a `lang`, and a polite live region that announced an accepted suggestion naming the
annotation and its fragment count (CNT-137). Suggestions, conditions and comment anchors are
distinguished by border, strike and a marker glyph rather than by colour, and hold in a forced-colours
mode (CNT-138).

**And that is exactly why this finding matters: axe reported zero violations in _both_
configurations - including the one with no `<caption>` at all.** The automated suite passed a table
whose caption is not programmatically associated with it, which is the defect gate 3 found by reading
the DOM.

**CNT-139 requires an automated suite in CI _and_ a recorded manual audit before each release. That is
not belt and braces. The suite did not catch a real accessibility defect in this very spike**, and
anybody treating a green axe run as conformance would have shipped it. The requirement is vindicated
by the first thing that tested it.

## The identity plugin, and three wrong versions

CNT-002 costs one `appendTransaction` plugin. The cost is small; the **rule inside it is not obvious**,
and the spike wrote three wrong versions before the right one. All three are recorded because each
fails in a way that would have reached production looking fine.

1. **A required attribute is refused outright.** `attrs: { id: {} }` on a paragraph, with `doc`
   content `block+`, throws at schema construction: _"Only non-generatable nodes (paragraph) in a
   required position"_. ProseMirror must be able to generate a paragraph to fill a required position
   and cannot generate one whose identifier it does not know. **A block identifier cannot be required
   in the editor's schema.** It takes a default and a plugin fills it.
2. **Splitting a block duplicates its identifier, silently.** `split` copies the node's attrs to both
   halves, so one paragraph becomes two carrying the same identifier and nothing reports it. This is
   the defect CNT-132 exists to prevent, arriving by a route CNT-132 does not describe.
3. **"Rename any identifier already seen" renames the wrong block.** Walking the document and renaming
   duplicates makes document order decide the winner - so pasting a block carrying an identifier
   already in use at the top of the document renames the **existing** block. That breaks every
   cross-reference to it (STR-026) and makes comparison report a deletion.
4. **"Rename whatever arrived" fixes paste and breaks split.** A split creates a new node out of
   content that did not arrive from anywhere, so a predicate over changed ranges cannot see it.

The rule that works for both is **descent, not arrival**: a block standing at its identifier's
forward-mapped position descends from the block that held it and keeps it; every other block holding
that identifier is new and is re-identified.

And one argument decides it. Mapping the old position forward with `assoc` of **-1** maps a position
to _before_ content inserted there, making the incoming block look like the heir and renaming the
existing one. With **1** it maps to after, and the right block keeps its identity. One character,
and the difference is whether a paste silently rewrites the identifiers of stored content.

## What the editor imposes on the content model

**Nothing that changes [content-model.md](../../design/content-model.md).** The brief asked for this
statement explicitly, because it is why the spike ran before the schema became code.

The one schema-adjacent finding is that a block identifier cannot be _required_ in the editor's
schema. The stored schema still requires it - that is `packages/domain` and zod, not ProseMirror - and
the mapping refuses a null identifier at the boundary. This is precisely the situation
`content-model.md` already describes when it reads CNT-001 as a lossless total mapping between the
two rather than as identical objects. **The reading was written before this was known and turns out to
be load-bearing rather than defensive.**

No node, no mark and no member of the root changes. The vocabulary as designed survives contact with
an editor.

## What is still unproven

- **The manual accessibility audit has not been done.** CNT-139 requires it alongside the suite, and
  gate 4's own finding is that the suite is not sufficient. The automated half is reported above; the
  other half is outstanding and no claim here stands in for it.
- **Whether 300 components _read_ as one document is a person's judgement**, and it has not been
  made. The structure is continuous - no cards, no borders, no gaps between components beyond
  paragraph spacing - but "continuous" measured in the DOM is not the same claim.
- **Selection and copying across a component boundary were not tested.** One view per component means
  a selection cannot span two, and whether that is correct for a component CMS or a defect is a
  product question the editor design has to answer.
- **Cases 7, 8, 9 and 10 did not run**: mathematics in five positions, spelling against the language
  of the run, the theme at the publishing measure, and the step log. All non-gates.
- **No IME composition, no real screen reader, no real document.** The figures are warm,
  single-machine and synthetic, and the components carry short text.
- **`prosemirror-tables` was taken as given.** Whether its table model carries everything TAB needs
  beyond gate 3 - rotation, scaling, splitting across pages - is untested.

## Recommendation

**Adopt ProseMirror**, and record it. Every gate passes, no cost leaks into the stored schema, and the
one finding that touches the schema is already answered by how `content-model.md` reads CNT-001.

The costs to carry into the editor design, none of them large and all of them named above: one
identity plugin with a rule that must be written down rather than re-derived; a `toDOM` override for
header cell scope; a decision between column resizing and a `<caption>`; and a manual accessibility
audit that the requirement already demands and this spike has shown cannot be replaced by a suite.
