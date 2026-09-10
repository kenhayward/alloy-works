# Content model spike - findings

> **Status: gates complete.** All four gate cases in [`Content_Model_Spike.md`](Content_Model_Spike.md)
> have run. **[ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) is
> confirmed** - no gate needed a workaround that leaks into the schema, so the record stands rather
> than being superseded.
>
> **Case 8 was declared passed too early.** It was passed on a round-trip verified by our own
> reader. Opening an exported file in Word then found three defects that reader could not see -
> [issue #7](https://github.com/kenhayward/alloy-works/issues/7) - and investigating the third found
> a fourth, worse one. All four were in the importer or the emitter rather than in the content model,
> all four are fixed, and **the corrected output has now been confirmed in Word**. The correction is
> written up below rather than quietly absorbed, because the reason it happened matters more than
> the fix.

Only the four gate cases were in scope for this run - see the depth decision recorded in the brief.
The six non-gate cases (2, 4, 5, 6, 9, 10) have not been run.

## Verdicts

| Case                                            | Verdict            | Cost                                                                                                             |
| ----------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **1** - Overlapping annotations                 | **Pass**           | None. The overlap needed no construct of its own                                                                 |
| **3** - Cell-anchored footnote in a bound table | **Pass with cost** | Bound tables need a declared key column, and it is not optional                                                  |
| **7** - Comparison across a move + edit         | **Pass with cost** | Blocks need a stable id in the schema from the first revision stored                                             |
| **8** - Word round-trip                         | **Pass with cost** | Import must SPLIT into outline plus components; and a real Word session was needed to find three emitter defects |

Code is in `packages/domain/src/content/`. Each case is a test named after the case it answers, so
the brief and the suite stay traceable to one another. 47 tests in the domain package, 105 across the
repository.

## Case 1 - Overlapping annotations: pass

A profiling condition covering _"registered under"_ and a suggested deletion covering _"is
registered"_ overlap without nesting. Both are marks, both carry an id, and the overlap is simply a
text node carrying two marks.

- The annotation the overlap split stays **one** annotation. Accept, reject and exclude each act
  once over every fragment.
- **The two operations commute.** Accepting the deletion then excluding the condition produces
  exactly what excluding then accepting produces. This is the property that fails when an annotation
  is fragmented into independent pieces, which is what tree markup would have to do.
- No mark type exists whose only purpose is to represent the overlap. A test pins the mark list, so
  adding a positional marker later is a deliberate act rather than drift.

**What this does not establish.** It shows the chosen model handles the case cleanly. It does not
prove the alternatives fail - that remains the argument in ADR-0005, not a measured result. Testing
the discarded options was out of scope and would cost more than the claim is worth.

**But case 8 corroborated it from an unexpected direction.** Real Word output carries a single
tracked deletion across two adjacent runs sharing one revision id. The fragment-with-shared-id
shape is not a device invented to make the model work; it is what a mature word processor already
does, arrived at independently.

## Case 3 - Cell-anchored footnote in a bound table: pass, with a cost

**The anchor has to name the data, not the position.** A footnote on "row 2, emissions" is
meaningless against generated content, because the next run of the same query can reorder, insert or
drop rows without anybody editing the document. The anchor is the value of a declared key column plus
a column name, and the schema rejects a positional anchor outright.

The test that proves it is the reordering one: the same rows in a different order - what happens the
moment somebody adds an `ORDER BY` - leave the footnote on the same data.

**The cost: a bound table must declare a key column, and there is no sensible default.** Any query
feeding a table that anything can be anchored to has to return something that identifies a row. That
is a constraint on the query definitions in scope section 7.4 and belongs in those requirements: a
query used by a bound table is not just a result set, it has a primary key.

When the anchored row disappears, the result is a named diagnostic carrying the footnote, the key and
the query. Resolution still returns the rows it did get, so an author sees a draft with the problem
visible; publishing refuses. That split matters - refusing to render would make the problem harder to
fix, and rendering silently would put a document with a missing footnote in front of a regulator.

## Case 7 - Comparison across a move plus an edit: pass, with a cost

A paragraph moved past two others and reworded reports as **one** `moved-and-edited` block. No
deletion or insertion is invented to explain it, and blocks that merely shifted report as unchanged.

**Blocks need a stable id, in the schema, from the first revision ever stored.** Revisions are
immutable, so identity cannot be granted retrospectively. Right at the start or not at all.

**A step log is not required to tell a move from a delete-plus-insert.** The brief assumed
comparison would lean on the editor's persisted transform steps. It does not: block identity plus a
longest-stable-run calculation is enough, and it works between any two versions rather than only
along a linked history. The step log remains wanted for the CRDT upgrade path ADR-0005 reserves, but
it is no longer load-bearing for comparison.

Where two versions share no identity at all, which happens after a restore, after an import, or
between components authored in unrelated sessions, the fallback is content similarity, and it
recovers the same result on this case. Two details for the requirements:

- Every change record says **how** it was matched (`id` or `similarity`), because a reader needs to
  know how much to trust it. A comparison view should show those differently.
- Similarity is word-token Dice at a 0.4 threshold. Character bigrams were tried first and scored
  _"Bravo"_ against _"Bravo, revised"_ at 0.47, which would have missed the match this case exists to
  test. **The threshold is tuned against one case and is the least defensible number in the spike.**

## Case 8 - Word round-trip: pass, with a cost

Run against a genuine Word document, not hand-written OOXML: a Heading 1, a paragraph carrying a
footnote and a `REF` cross-reference, then track changes on for one insertion, one deletion and one
comment.

What survives the import: three suggestions attributed to the Word author, one comment thread
anchored in the content by a mark, the footnote with its text, and the cross-reference pointing at
the bookmark on the heading it targets. What survives a full export-and-reimport: all of it.

Four findings, and the first is the one that changes a requirement.

**The importer must SPLIT, not load.** Word puts headings inline in the body; the model puts them in
the outline, because a component reused at two depths cannot carry its own heading level. So
`importDocx` returns an outline plus components - never one blob of content. This is the mechanical
reason the scope is right that Word import must be assisted rather than automatic: **the split is
precisely the judgement a human has to make**, and no heuristic over heading levels can make it for
them. That belongs in the import requirements as the shape of the feature, not as a caveat.

**Fields are not text.** A cross-reference in OOXML is a field with a cached result - Word stores the
number `2` alongside the instruction. The importer has to discard that cached value, or the number
gets baked into content and the reference stops being a reference. This is the scope's
"resolved at publish time" rule turning up as a concrete parsing obligation at the boundary.

**Real Word documents carry personal data, and any import path ingests it.** The fixture arrived with
the author's name in four parts and a Microsoft account identifier in `word/people.xml`. It was
scrubbed to an invented name before entering the repository. The product consequence is larger than
the fixture: **importing a customer's Word documents ingests the identities of everyone who ever
tracked a change in them**, which interacts directly with the privacy requirements in scope section
11 and needs a stated position - map to tenant users, quarantine, or discard.

**A repository fix fell out of it.** `.gitattributes` had `* text=auto eol=lf` with no rule for
Office formats. A `.docx` is a ZIP, and a checkout that normalises line endings inside one produces a
file that no longer opens, with a diff showing nothing changed. Now pinned as binary.

## What the Word session found, and the lesson under it

An exported file was opened in Word. The text was intact, the footnote was attached in the right
place and the cross-reference resolved. Three things were wrong ([issue #7](https://github.com/kenhayward/alloy-works/issues/7)):

| Symptom                                | Cause                                                                                                                                                                      | Fix                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Headings had no numbers                | No `word/numbering.xml` was emitted at all, and the heading styles linked to no numbering definition                                                                       | A multilevel decimal scheme, related from the document part and linked from every heading style |
| The footnote had no number             | `w:footnoteReference` numbers the mark in the text; the number at the FOOT of the page comes from `w:footnoteRef` **inside the footnote's own content**, which was missing | `w:footnoteRef` in each footnote, a `FootnoteText` style, and a superscript `FootnoteReference` |
| Blank lines between blocks disappeared | The importer drops empty paragraphs - correctly, they are presentation - so the export has to supply the separation from the layout instead, and it supplied none          | Paragraph spacing in `w:docDefaults` and in the heading styles                                  |

**A fourth defect turned up while investigating the third, and it is the worst of them.** Word
writes an empty paragraph as a **self-closing** `<w:p/>`. The walker only finished a paragraph on a
closing tag, so the fixture's three empty paragraphs were never counted and the
`empty-paragraphs-dropped` diagnostic never fired. Content was dropped in silence - the one thing
the import contract says cannot happen, and the exact criterion case 8 was recorded as passing.

It survived because every assertion in the case was about **what came through**. Nothing asserted
about what did not. A test suite for an importer needs both halves, and that belongs in the import
requirements as a rule rather than as a lesson learned once: an importer is judged on its
diagnostics as much as on its output.

The fix is to normalise a self-closing element into an open and a close at the point of scanning,
so a structural element written either way goes down one path. Special-casing at each use is how
the bug happened.

**Two things are worth separating.** All four defects were in the **importer or the emitter**, not
in the content model. Nothing about nodes and marks was implicated, which is mild corroboration for
ADR-0005 rather than a threat to it. But the reason they survived to a human is not mild at all.

**A round-trip test that reads its own output can only prove self-consistency.** Ours did exactly
that, and passed, while producing a document that any reader would have called wrong. For a format
whose consumer is another vendor's application, self-consistency is not the bar and never becomes
it. The consequence for the publishing requirements is a standing one, not a one-off: **Word and PDF
fidelity need a real consumer in the verification loop permanently** - a human check, a reference
renderer, or a third-party validator - and the scope's "maintained test suite against real report
shapes" has to mean that, or it will keep passing while the output is wrong.

## Settled: a Word round-trip is lossy by design

The third symptom was raised twice and is worth recording as a decision rather than a bug, so nobody
re-opens it from the diff.

**Empty paragraphs stay dropped on import.** They are presentation, and schema decision 5 says
appearance belongs to the presentation theme. Preserving them was considered and rejected: a
component carrying its author's blank lines into all forty documents that reuse it is precisely how
a component CMS degrades into a word processor. Spacing would double wherever a theme also supplied
some, comparison would report blank-line edits as content changes, and the visual consistency the
scope promises in section 3 would erode one override at a time. Capturing the spacing as a per-block
property was rejected for the same reason in a quieter form.

**The general principle, which is bigger than this symptom: a Word round-trip through a component
CMS is lossy by design, and that is the product working rather than failing.** The whole premise is
that appearance comes from a theme rather than from the document. So the bar for import is **content
fidelity** - nothing said is lost, and anything dropped is named - and the bar for export is
**publish fidelity** - output under our own layout is right. "The round-trip looks identical to the
source" is neither of those, and chasing it would mean abandoning the premise.

**What follows is that the layout has to do the work the blank lines were doing.** The exported
styles now carry generous paragraph and heading spacing, plus `keepNext` and `keepLines` on headings
so one never strands at the foot of a page with its text overleaf - the kind of thing that is
invisible until something paginates, and exactly what "submission-grade" means in scope section 7.10.
That is the publishing layout earning its place as a first-class artifact, and it is a better answer
than reproducing an authoring habit.

## What is still unproven

- **Word rendering is confirmed, and always will need confirming.** The corrected export was opened
  in Word: headings numbered, the cross-reference showing a real number, the footnote numbered, and
  the spacing reading as intended. The tests here assert the OOXML constructs rather than the
  rendering, which is a proxy - so this is not a box that stays ticked. By the argument above, every
  material change to the emitter needs a real consumer to look at the result.
- **Numbering is emitted but only exercised through heading styles.** The fixture's numbered heading
  takes its number from a style rather than a direct `w:numPr`, so a numbered list in body text is
  still untested. The next Word fixture should carry one.
- **The six non-gate cases have not run**, including case 5 (maths) and case 6 (transclusion with a
  local override) - the case where DITA is genuinely stronger.

## Schema decisions taken

Each fell out of a case rather than being designed up front, and each has a test holding it in place:

1. **Every mark carries an id.** Annotations survive the fragmentation an overlap causes.
2. **Every block carries an optional stable id.** Optional only because imported content has no
   identity to carry; content this system writes always has one.
3. **Anchors into generated content name the data.** The anchor object is strict, so a positional
   anchor is a validation failure rather than a misunderstanding discovered in a published PDF.
4. **Resolution preserves ids.** Accepting a suggestion is not an edit, and a block that lost its
   identity to a resolution pass would compare as a deletion for ever afterwards.
5. **Marks are semantic, never presentational.** Appearance belongs to the presentation theme.
6. **Cross-references carry a target and a display kind, never a number.** Resolved at publish time
   in the context of the document doing the resolving.
7. **Headings are not content.** They are outline nodes, and every import must produce an outline.

## Recommendation on the revision store

Cases 3, 7 and 8 need less of the storage layer than the brief assumed: whole immutable document
snapshots keyed by component and revision, with block ids inside them. Comparison needs no history
between two snapshots, only the two snapshots.

Event sourcing and content-addressed storage were both anticipated as possibly necessary. Neither is,
for comparison. **That leaves open decision 1 to be argued on audit, retention and volume rather than
on diff quality** - a narrower and easier question than the brief assumed, and one that no longer has
to be answered before authoring work can start.

## Note on where this code lives

The schema draft is in `packages/domain`, which is right: it is the content model, and the domain
package is deliberately platform-free.

The OOXML reader and writer are there too, and probably should not stay. The domain package is the
content model and its rules; an OOXML adapter is a boundary translator that happens to need the
model. When this becomes product code it wants its own workspace. It is noted here rather than fixed,
because moving it is a decision for the architecture, not for a spike.

The spike schema is **not** exported from the domain package's public surface - `index.test.ts` still
pins that to the component model. Promoting it is a deliberate act for whoever starts the authoring
work, not something that should happen by drift.
