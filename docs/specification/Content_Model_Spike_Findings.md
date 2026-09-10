# Content model spike - findings

> **Status: in progress.** Three of the four gates are run. Case 8 is blocked on a Word-authored
> fixture. Nothing here is final until every gate has a verdict and this document ends in either a
> confirmation of [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) or a
> record superseding it.

The brief is [`Content_Model_Spike.md`](Content_Model_Spike.md). Only the four gate cases are in
scope for this run - see the depth decision recorded there.

## Verdicts so far

| Case                                            | Gate | Verdict            | Cost                                                                 |
| ----------------------------------------------- | ---- | ------------------ | -------------------------------------------------------------------- |
| **1** - Overlapping annotations                 | Yes  | **Pass**           | None. The overlap needed no construct of its own                     |
| **3** - Cell-anchored footnote in a bound table | Yes  | **Pass with cost** | Bound tables need a declared key column, and it is not optional      |
| **7** - Comparison across a move + edit         | Yes  | **Pass with cost** | Blocks need a stable id in the schema from the first revision stored |
| **8** - Word round-trip                         | Yes  | **Blocked**        | Needs a `.docx` produced by Word - see below                         |

Code: `packages/domain/src/content/`. Cases are tests named after the case they answer, so the
brief and the suite stay traceable to each other.

## Case 1 - Overlapping annotations: pass

A profiling condition covering _"registered under"_ and a reviewer's suggested deletion covering
_"is registered"_ overlap without nesting. Both are marks, both carry an id, and the overlap is
simply a text node carrying two marks.

What the tests establish:

- The annotation split by the overlap stays **one** annotation. Accepting the suggestion, rejecting
  it, or excluding the condition each act once over every fragment.
- **The two operations commute.** Accepting the deletion and then excluding the condition produces
  exactly what excluding then accepting produces. This is the property that fails when an
  annotation is fragmented into independent pieces, which is what a tree markup would have to do.
- No mark type exists whose only purpose is to represent the overlap. A test pins the mark list, so
  adding a positional marker later is a deliberate act rather than a drift.

**What this does not establish.** It shows the chosen model handles the case cleanly. It does not
prove the alternatives fail - that remains the argument in ADR-0005, not a measured result. Testing
the discarded options was out of scope and would have cost more than the claim is worth.

## Case 3 - Cell-anchored footnote in a bound table: pass, with a cost

The finding that matters: **the anchor has to name the data, not the position.** A footnote on
"row 2, emissions" is meaningless against generated content, because the next run of the same query
can reorder, insert or drop rows without anybody editing the document. The anchor is therefore the
value of a declared key column plus a column name, and the schema rejects a positional anchor
outright rather than accepting it and misbehaving later.

The test that proves it is the reordering one: the same rows in a different order - which is what
happens the moment somebody adds an `ORDER BY` to a query - leave the footnote on the same data.

**The cost: a bound table must declare a key column, and there is no sensible default.** Any query
feeding a table that anything can be anchored to has to return something that identifies a row. That
is a real constraint on the query definitions in scope section 7.4, and it belongs in those
requirements: a query used by a bound table is not just a result set, it has a primary key.

Behaviour when the anchored row disappears is a named diagnostic (`footnote-anchor-missing`) that
carries the footnote, the key and the query. Resolution still returns the rows it did get, so an
author sees a draft with the problem visible; publishing refuses. That split matters - refusing to
render at all would make the problem harder to fix, and rendering silently would put a document
with a missing footnote in front of a regulator.

## Case 7 - Comparison across a move plus an edit: pass, with a cost

A paragraph moved past two others and reworded reports as **one** `moved-and-edited` block. No
deletion and no insertion is invented to explain it, and the blocks that merely shifted position
report as unchanged.

Two findings, and the second is the more useful one.

**Blocks need a stable id, in the schema, from the first revision ever stored.** Revisions are
immutable, so an id cannot be granted retrospectively to content written without one. This is a
schema decision that has to be right at the start or not at all.

**A step log is not required to tell a move from a delete-plus-insert.** The brief assumed
comparison would lean on the editor's persisted transform steps, and it does not: block identity
plus a longest-stable-run calculation is enough, and it works between any two versions rather than
only along a linked history. That materially simplifies open decision 1 (the storage and revision
model) - the step log is still wanted for the CRDT upgrade path ADR-0005 reserves, but it is no
longer load-bearing for comparison, so it does not have to be in the first storage design.

The fallback for versions sharing no identity - after a restore, an import, or independent
authoring - is content similarity, and it recovers the same result on this case. Two details worth
carrying into the requirements:

- Every change record says **how** it was matched (`id` or `similarity`), because a reader needs to
  know how much to trust it. A comparison view should show those differently.
- Similarity is word-token Dice at a 0.4 threshold. Character bigrams were tried first and scored
  _"Bravo"_ against _"Bravo, revised"_ at 0.47, which would have missed the match this case exists
  to test. The threshold is tuned against one case and should be revisited against real content -
  it is the least defensible number in the spike.

## Case 8 - Word round-trip: blocked

Needs a `.docx` produced by Word itself: a numbered heading, a paragraph with a footnote and a
cross-reference, then track changes turned on for one insertion, one deletion and one comment.
Hand-written OOXML would test our understanding of the format rather than what Word actually emits,
which is the thing the fidelity bar depends on.

A second, quicker check follows once the emitter exists: opening a `.docx` **we** produce and
confirming Word renders the numbering, cross-references and footnotes correctly.

## Schema decisions taken so far

These fell out of the cases rather than being designed up front, and each has a test holding it in
place:

1. **Every mark carries an id.** Annotations survive the fragmentation an overlap causes.
2. **Every block carries an optional stable id.** Optional only because imported content has no
   identity to carry; content this system writes always has one.
3. **Anchors into generated content name the data.** The anchor object is strict, so a positional
   anchor is a validation failure rather than a misunderstanding discovered in a published PDF.
4. **Resolution preserves ids.** Accepting a suggestion is not an edit, and a block that lost its
   identity to a resolution pass would compare as a deletion for ever afterwards.
5. **Marks are semantic, never presentational.** Appearance belongs to the presentation theme.

## Preliminary recommendation on the revision store

Not final - case 8 could still change it - but on cases 3 and 7 the requirement is modest: whole
immutable document snapshots keyed by component and revision, with block ids inside them. Comparison
needs no history between two snapshots, only the two snapshots. Event sourcing and content-addressed
storage were both anticipated as possibly necessary; neither is, for comparison. That leaves the
storage decision to be argued on audit, retention and volume rather than on diff quality, which is a
narrower and easier question than the brief assumed.
