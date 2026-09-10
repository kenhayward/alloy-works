# Content model spike

> **Status: proposed, not run.** This is the brief for the first spike named in
> [`Project_Scope.md`](Project_Scope.md) section 15. It exists so the spike can be executed by
> somebody who was not in the conversation that produced it, and so that its outcome is a written
> finding rather than an opinion.

## 1. What this spike is for

[ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md) has already decided the
**direction**: a purpose-built node-and-mark document model, JSON-serialised, identical to the
editor's in-memory model, with standards at the boundary.

This spike does not reopen that. It answers the question that comes next and cannot be answered by
argument:

> **Does a node-and-mark schema actually express the ten hardest things this product needs, without
> a workaround that leaks into the schema - and what does the revision store have to look like to
> support it?**

The distinction matters. A spike that re-litigates the direction produces a debate. A spike that
tests the direction against its own hardest cases produces either a schema draft or a superseding
decision record, and both are useful.

## 2. Why the content model and the revision store are spiked together

The scope originally listed content representation, the storage and revision model, and the
publishing engine as three separate spikes. Run independently they produce three locally optimal
answers that do not compose.

Case 7 below - telling a move apart from a delete-plus-insert - is a storage question as much as a
model question, and its answer depends on whether the editor's transform steps are persisted.
Cases 3, 5 and 8 are publishing questions wearing a model question's clothes.

So: **the content model and the revision store are one spike**, with the publishing engine's hard
constraints supplied as inputs rather than decided. The engine choice follows, informed by what
cases 3, 5 and 8 turn up.

## 3. Inputs, not questions

These are given to the spike and are not up for decision inside it:

- The direction in ADR-0005.
- **PDF/UA tagging requirements** - reading order, table header associations, alt text, document
  and fragment language. The schema has to be able to feed them.
- **The OOXML constructs the fidelity bar depends on** - `w:ins` and `w:del` for tracked changes,
  footnote and endnote parts, OMML for maths, bookmarks and `REF` fields for cross-references,
  numbering definitions.
- The performance budgets from the scope's section 11, at whatever provisional numbers exist when
  the spike runs. Provisional is fine; absent is not.

## 4. The ten cases

Each case is a concrete artifact built in the model, with a written finding. The point of a case is
that it is **hard**, not that it is representative.

### Case 1 - Overlapping annotations _(gate)_

A reviewer's suggested deletion covers a range that **begins inside a conditional block and ends
outside it**, and the condition is excluded for one of the document's profiles.

- **Tests:** whether range annotations can overlap without nesting, and whether one annotation keeps
  a single identity across the fragments the overlap creates.
- **Pass:** accept and reject each act once, on the whole suggestion; publishing resolves cleanly
  in both profiles; and no schema construct exists whose only purpose is to represent the overlap.

### Case 2 - A condition splitting a sentence

> The site is `[UK]`registered under`[/UK]``[US]`permitted by`[/US]` section 4.

- **Tests:** sub-sentence conditional granularity, and whitespace and punctuation correctness when
  a branch is removed.
- **Pass:** both profiles render with correct spacing, no doubled spaces and no orphaned
  punctuation, without the author hand-managing whitespace; and the editor shows both branches
  legibly enough to proofread.

### Case 3 - A cell-anchored footnote in a bound table _(gate)_

A table is produced by a block binding. A footnote is anchored to one cell. The parameter set then
changes and the row that cell belonged to is no longer returned.

- **Tests:** where a footnote anchor lives when the thing it points at is generated rather than
  authored, and what identity a generated cell has at all.
- **Pass:** the anchor is expressed against something stable - a keyed row identity, or a declared
  column plus a predicate - and never a positional index. The vanished-row case produces a named,
  surfaced condition, not a silently dropped footnote and not a crash.

### Case 4 - A citation inside a footnote inside a table cell

It reads as an absurd case and it happens constantly in regulated reports.

- **Tests:** whether block-level constructs nest inside inline contexts to arbitrary depth, or
  whether the model has a context limit it has not admitted to.
- **Pass:** it composes with no special case; both the footnote number and the citation are correct
  in published output; and the OOXML export represents it rather than flattening it.

### Case 5 - Maths in a heading, a cell and a footnote

The same equation in all three positions, one instance numbered and cross-referenced from elsewhere
in the document.

- **Tests:** whether maths is a first-class node available in every context, its canonical stored
  form, and its participation in a numbering sequence that the outline owns rather than the
  component.
- **Pass:** one canonical representation renders to screen, to PDF and to OMML; the numbered
  instance is referenceable; the unnumbered ones consume no numbers.

### Case 6 - Transclusion with a local override

One component used by two documents, where one of them needs a single word different.

- **Tests:** the honest comparison against DITA, which does this well with `conref` and `keyref`.
  Whether a purpose-built model can express a scoped override without either forking the component
  or inventing a second reuse mechanism beside the first.
- **Pass:** the override lives on the **reference**, not on the component; "where used" still
  reports both documents; and the overriding document's comparison shows an override rather than a
  fork.
- **If this fails**, the decision still stands, but the reuse claim in scope section 7.3 is weaker
  than written and that section needs revising. This case is deliberately not a gate - it is the
  one where the discarded alternative is genuinely stronger, and pretending otherwise would make
  the spike dishonest.

### Case 7 - Comparison across a move plus an edit _(gate)_

A paragraph is moved into a different section and reworded in the same revision.

- **Tests:** whether the revision store can tell a move from a delete-plus-insert, and how much of
  that depends on a persisted step log rather than a post-hoc tree diff. This is the case that
  makes the model and the store one spike.
- **Pass:** comparison reports "moved and edited" where a step-linked history exists, **and**
  degrades to a legible result rather than noise for two baselines that share no step history -
  which is the normal situation after a restore, or between components edited in unrelated
  sessions.

### Case 8 - Word round-trip _(gate)_

Export a numbered, cross-referenced, footnoted section to `.docx`. Edit it in Word with track
changes on - one insertion, one deletion, one comment. Import it back.

- **Tests:** the OOXML mapping in both directions, and whether Word redlines can arrive as
  **suggestions** rather than as flattened accepted text.
- **Pass:** numbering, cross-references and footnotes survive the export; the import produces
  suggestions attributable to the Word author plus a comment thread; and anything not representable
  is **reported** rather than dropped silently.

### Case 9 - Right-to-left text with an inline binding

An Arabic or Hebrew paragraph carrying a bound numeric value mid-sentence and a footnote anchor.

- **Tests:** whether text direction is content or presentation, and whether bidirectional handling
  lives in the model rather than being left to CSS and rediscovered in the PDF.
- **Pass:** direction is expressed once, in the model; the bound value's numerals and the footnote
  anchor land in the correct visual positions on screen, in PDF and in Word.

### Case 10 - The 300-page case

A document assembling 400 components, one of which is opened, edited and saved.

- **Tests:** what the model costs at the size the scope's performance budgets name.
- **Pass:** opening, editing and saving sit inside the provisional budgets, and **the cost of
  editing one component does not scale with the size of the document containing it.**

## 5. Scoring

| Cases          | Role              | Rule                                                                                                           |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **1, 3, 7, 8** | Gates             | A workaround that leaks into the schema is a **fail**. Report it; do not absorb it. A fail supersedes ADR-0005 |
| **2, 4, 5, 9** | Correctness       | May pass with work. Record the cost                                                                            |
| **6**          | Honest comparison | Does not gate. A failure narrows the reuse claim in scope section 7.3                                          |
| **10**         | Budget            | Runs against provisional numbers. A miss is a scope question, not a tuning exercise                            |

The gates are the four where a workaround becomes permanent. Everything else can be paid for later;
those four cannot.

## 6. What the spike produces

1. **A schema draft in `packages/domain`** covering exactly the constructs the ten cases need and
   nothing else. This is the one artifact intended to survive.
2. **A worked artifact per case, expressed as a test**, so the finding is reproducible and so the
   cases become regression tests for the schema as it evolves.
3. **A written finding per case** - pass, pass with cost, or fail - with the cost named. A case that
   cannot be settled is recorded as unsettled. The spike does not expand to fix what it finds.
4. **A recommendation on the revision store**, argued from cases 7 and 10: relational rows with
   revision history, event sourcing, or content-addressed objects.
5. **A note of what the publishing engine must provide**, argued from cases 3, 5 and 8, as the input
   to the engine decision.
6. **Either a confirmation of ADR-0005 or a record superseding it.**

## 7. Out of scope for the spike

An editor interface, a real database, a real query engine, authentication, performance tuning, and
any code beyond the schema draft and its tests. Everything else the spike produces is throwaway and
should be labelled as such, so that nobody promotes a scaffold into the product because it was
already there.

## 8. What it unblocks

The detailed requirements for authoring, versioning and comparison, publishing, and import and
export all depend on the answer. Scope section 15 puts no implementation before this runs, and that
holds: the content model is decided once, and everything in scope section 7 is downstream of it.
