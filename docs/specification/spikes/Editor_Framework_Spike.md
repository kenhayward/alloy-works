# Editor framework spike

> **Status: proposed, not run.** This is the brief. Findings go beside it, and are not edited
> afterwards.

## 1. What this spike is for

[CNT-001](../requirements/CNT-content-and-authoring.md) requires stored content to be "structurally
identical to what the editor manipulates in memory", and
[ADR-0005](../../decisions/0005-purpose-built-node-and-mark-content-model.md) rests its whole
argument on that: "if that is not also the storage model, every save is a lossy transform, and there
are two models to keep in step forever."

**No decision record chooses an editor.** Twenty-two records, and none of them names one. So the
requirement binds the stored model to something that does not exist, and
[content-model.md](../../design/content-model.md) had to state a reading of CNT-001 rather than meet
it. This spike settles the thing that reading defers.

**It runs before the content model becomes code, not after.** The schema, its validation and its
migration fixtures are the next thing built, and a fixture written at schema version 1 is permanent -
CNT-012 keeps every version ever written readable. If the editor imposes a shape on the model, the
cheap moment to find out is while there are no fixtures. That is the whole reason this is not deferred
to the editor's design.

**What it is not for.** It does not reopen ADR-0005. Node-and-mark is the direction, and a spike that
re-litigates the direction produces a debate rather than an answer.

## 2. The candidate, and why it is a candidate rather than a conclusion

The corpus narrows the field before any code is written, in two steps.

**Marks cannot be elements.** CNT-003 requires marks to cover overlapping ranges "without nesting and
without being split into separate annotations", and CNT-007 forbids "any mark or node whose only
purpose is to represent an overlap, a range start or a range end". An editor whose range annotation is
an element wrapping text must split it at every overlap, which is the failure ADR-0005 rejected tree
markup for. That leaves the family where a mark is a **set or a property on a text node**.

**ADR-0005 describes a step log without naming one.** "The model must be able to persist the editor's
transform steps alongside revisions... the same mechanism is the CRDT upgrade path that the scope's
section 14 reserves." A framework whose edits are first-class transform steps, with collaborative
editing built on those steps, is what that sentence assumes.

Taken together those point at **ProseMirror** as the first candidate, with its declarative schema
being a third reason: a closed vocabulary with content expressions is what CNT-006 and CNT-007 are
asking an editor to enforce alongside `packages/domain`.

**That is a premise, not a finding.** These libraries change, and nothing above has been verified
against a current version. **The first task of the spike is to check the narrowing rather than inherit
it**, and to say so in the findings. If the premise is wrong the order changes, and the order is the
only thing it changes: the brief below is candidate-independent by construction.

The order, argued and reversible on the first hour's evidence: ProseMirror, then Slate, then Lexical.
A gate failure sends **this same brief** to the next candidate rather than widening into a comparison.

## 3. Inputs, not questions

Given to the spike and not up for decision inside it:

- **ADR-0005's direction**, and the model as
  [content-model.md](../../design/content-model.md) describes it: seven blocks, eight inline nodes,
  thirteen closed marks, a required identifier on every block and every mark.
- **MathML as the stored form of an equation** (CNT-043 as that document settles it). The editor
  renders and edits it; it does not choose it.
- **The theme's CSS projection**, which exists in `packages/domain/src/theme/` and is decided by
  [ADR-0014](../../decisions/0014-themes-resolve-once-project-three-times.md). The editor renders
  that projection rather than a stylesheet of its own.
- **Soft component locks** (CNT-071, **COL**). Concurrency is not this spike's question, but the
  editor may not assume single-writer access.
- **WCAG 2.2 AA** (CNT-078), and CNT-139's requirement that it be verified by an automated suite in
  CI and a recorded manual audit rather than asserted.

## 4. The ten cases

Each case is a concrete artifact built in a throwaway editor, with a written finding. A case is here
because it is **hard**, not because it is representative.

### Case 1 - A document of many components _(gate)_

One continuous scroll over 300 components (CNT-072, CNT-076), boundaries revealed on hover and by a
toggle rather than as permanent chrome (CNT-073), the view showing which component the cursor is in
and whether this user may edit it right now (CNT-074), with **at least one component in the document
the user may not edit**. Undo scoped to the component being edited, surviving a reload within the
session, and never reaching past the version the session opened from (CNT-069, CNT-103).

This is the gate most likely to fail, and the one least about mark models. Every candidate
has a document model that is a single tree with one undo stack; this asks for many independently
permissioned subtrees in one surface with per-subtree undo. The two shapes available are a
component-boundary node inside one instance, or many instances stitched into one scroll. **A finding
that names which, and what it costs, is the case's real output.**

### Case 2 - Overlapping annotations, then edited _(gate)_

Reproduce the content model spike's case 1 in the editor - a condition covering one range and a
suggested deletion covering an overlapping one - then **edit around it**: type inside one annotation,
split the paragraph across both, merge it back. Both annotations must remain one annotation each,
under one identifier each (CNT-004), and accepting one must act on every fragment in one operation
(CNT-005).

The static case passed in the model already. What is untested is whether the editor's own normalising
of adjacent text nodes preserves the identifiers, which is where a framework merges what it thinks are
equal marks.

### Case 3 - An authored table _(gate)_

Merged cells, declared header rows and header columns, a caption, a footnote anchored to one cell, and
an image inside another (CNT-016, CNT-037, CNT-086, CNT-107, TAB-031). Then **insert a row** and check
the header association and the footnote anchor both survive it.

Table editing is where these frameworks differ most and where custom work is least bounded. The
footnote anchor is the part that connects to CNT-107: where key columns are declared the anchor names
a key value, so a reorder must not move it.

### Case 4 - The editor from the keyboard, and to assistive technology _(gate)_

Every action the cases above need, reachable from the keyboard alone (CNT-077). Headings, lists,
tables and footnotes exposed to assistive technology as structure rather than styling (CNT-079).
Equations reachable through their textual alternative (CNT-080). Inserting and resolving a suggestion
or a comment announced, naming which annotation and what happened to it (CNT-137). Suggestions,
comment anchors and redlines distinguishable without colour and in a high-contrast mode (CNT-138).

**This gate needs a person as well as a suite.** CNT-139 requires both, and the spike reports the
automated result and the manual one separately rather than letting one stand for the other.

### Case 5 - Block identifiers through ordinary editing

Split a paragraph, merge two, drag a block, paste a block, and undo each. Identifiers must survive
where the block survives, a new block must get a new identifier, and nothing may reuse one (CNT-002,
CNT-009, CNT-132).

### Case 6 - The lossless round-trip

Model to editor to model, per component, identical after canonical serialisation. This is the test
CNT-001 is satisfied by, as [content-model.md](../../design/content-model.md) reads it, and it is the
one artifact here intended to survive the spike.

### Case 7 - Mathematics in five positions

Running text, a table cell, a footnote, a caption, and a heading (CNT-046). The content model spike
left this case unrun and the publishing engine spike proved the render path, so what is untested is
**editing** one - and the heading position is the one that matters most, because a heading is an
outline node rather than content and its title has to be inline content for this to be possible at
all.

### Case 8 - Spelling against the language of the run

Checked as the author types, against the language of the run rather than one language for the editor,
and behaving identically in both deliveries - the browser supplying it in the web app, the shell
wiring the platform's checker in the desktop one (CNT-098, CNT-099, CNT-101).

### Case 9 - The theme, at the publishing measure

The editing view rendering the theme's block spacing and typefaces at the sizes the theme declares,
set at the measure of the publishing layout, scaled and zoomable (CNT-082, CNT-097, CNT-115 - all
three already claimed by [themes.md](../../design/themes.md)). The theme resolver's CSS projection
exists; this asks whether an editor surface can be driven by it without a second stylesheet appearing
beside it.

### Case 10 - The step log, and the path scope section 14 reserves

What the framework's collaborative mechanism would require of the stored model, and whether persisting
transform steps alongside revisions is available at all. The content model spike already settled that
comparison does **not** need the step log - snapshots were enough - so this is only about the reserved
upgrade, not about the diff.

## 5. Scoring

| Cases       | Role              | Rule                                                                                                                                                     |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 to 4**  | Gates             | A workaround that leaks into the stored schema, or that forces the product to own the editing surface itself, is a **fail**. Report it; do not absorb it |
| **5, 6**    | Correctness       | May pass with work. Record the cost                                                                                                                      |
| **7, 8, 9** | Against decisions | A failure here is a note against ADR-0013 or ADR-0014 rather than against the candidate                                                                  |
| **10**      | The reserved path | Does not gate. A failure narrows scope section 14's reservation rather than this choice                                                                  |

**What a gate failure means, and what it does not.** It sends this brief to the next candidate. It
does **not** supersede ADR-0005 - the content model passed its own four gates and is stored, not
rendered. The one exception is a gate that fails in a way that imposes a shape on the stored schema:
that changes [content-model.md](../../design/content-model.md), and it is the reason this spike runs
before the schema becomes code.

**Every candidate failing the same gate is a scope question**, not a tuning exercise - the shape
section 14 already anticipates for a spike gate. Case 1 is the likeliest place for that to happen.

## 6. What the spike produces

1. **A throwaway editor in `spikes/editor-framework/`**, labelled throwaway, outside CI, so nobody
   promotes a scaffold into the product because it was already there.
2. **A worked artifact per case, expressed as a test where a test can express it**, and a recorded
   manual result where it cannot. Case 4 needs a person; case 1's scroll needs eyes on it.
3. **A written finding per case** - pass, pass with cost, or fail - with the cost named. A case that
   cannot be settled is recorded unsettled; the spike does not expand to fix what it finds.
4. **The round-trip test from case 6**, which is the one artifact intended to survive, because
   [content-model.md](../../design/content-model.md) names it as arriving with the editor.
5. **A statement of what the editor imposes on the content model**, if anything, and whether
   `docs/design/content-model.md` changes as a result.
6. **Either a decision record naming the framework, or a record of why the candidate failed and which
   is next.**

## 7. Out of scope for the spike

- **The editor's design document.** Sections 11 to 13 of CNT are 46 requirements and they are designed
  after this, not inside it.
- **Any UI toolkit layered over the chosen model.** A wrapper does not change the document model, the
  choice is reversible, and deciding it here would confuse a reversible preference with an
  irreversible one.
- **Real-time co-editing**, beyond case 10 asking what it would require. It is T3 and later.
- **Comparison rendering and tracked-changes review** (CNT-111, CNT-112), which are T3.
- **CNT-136's preview budget.** CNT-Q13 says it has no reference configuration yet, and a budget with
  no baseline can be neither confirmed nor refuted - measuring it here would produce a number nobody
  can hold anyone to.
- A real database, real permissions, authentication, and performance tuning.

## 8. What it unblocks

The **editor design** (CNT sections 11 to 13, 46 requirements undesigned in T1) depends on the answer
entirely. The **content model's implementation** depends on it too, in the narrower way section 1
describes: not on which framework wins, but on knowing that none of them imposes a shape before the
first migration fixture is written and becomes permanent.

It also closes the gap [content-model.md](../../design/content-model.md) names in prose. CNT-001 is
currently read rather than met, and an unrecorded gap becomes an assumption.
