# 0005 - A purpose-built node-and-mark content model

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[`docs/specification/Project_Scope.md`](../specification/Project_Scope.md) fixes what the canonical
content representation has to carry: conditions, redlines, comment anchors, citations, variables,
inline and block data bindings, footnotes anchored at span, cell and table level, maths, cross-
references and transclusion resolved by identity at publish time, semantic comparison between
arbitrary versions, per-language variants, and a live co-editing upgrade path held open rather than
taken.

The obvious candidates were DITA, Markdown and XHTML, each of which has been built on before. Two
more belong in the set and are usually left out: OOXML held as the canonical form, and a
purpose-built model aligned with the editor.

Three things reframed the choice.

**Those five are not five points on one axis.** A content representation answers three separate
questions - what a node means, how it is serialised, and what the editor manipulates - and DITA,
Markdown and XHTML each bundle an answer to all three. The third question is the one none of them
represents, and it is not optional: any credible collaborative web editor is a tree of **nodes and
marks**. If that is not also the storage model, every save is a lossy transform, and there are two
models to keep in step forever.

**The main thing a standard vocabulary buys here is the output chain, and the scope has already
committed to owning the output chain.** Section 7.10 specifies a deterministic
resolve/compose/paginate/render pipeline hitting PDF/UA. DITA-OT's publishing path is most of
DITA's practical value, and it is being replaced regardless.

**The market imposes nothing on the storage layer.** In technical-documentation procurement "is it
DITA?" is scored. In the regulated-reporting wedge the question is asked about the output and never
about the representation.

Against that, the decisive technical discriminator is **overlapping ranges**. Take a sentence where
a profiling condition covers "registered under" and a reviewer's suggested deletion covers "is
registered". The two ranges overlap without nesting. In any tree markup a range annotation has to
be an element and elements must nest, which leaves three options: fragment the annotation and
repeat it, destroying its identity so that accept and reject are no longer one action; use
milestone or standoff markup with matching start and end ids, which works and is what TEI and DITA
both reach for, but leaves the tree model behind so validation can no longer help; or forbid the
overlap, which is not available, because reviewers overlap conditions constantly.

There is also a documented experience of conforming to DITA and then writing a long tail of
extensions to cover what it does not express. The result carries the standard's constraints while
no longer being interchangeable with anyone else's DITA - the benefit is spent and the cost remains.

## Decision

**Canonical content is a purpose-built document model of nodes and marks, JSON-serialised,
validated in `packages/domain`, and identical to the editor's in-memory model.**

Standards live at the boundary, where they are worth something:

| Format       | Role                                                                 |
| ------------ | -------------------------------------------------------------------- |
| **XHTML**    | The defined publishing intermediate, and a first-class export        |
| **OOXML**    | A first-class export, and an assisted import                         |
| **Markdown** | Authoring shortcuts in the editor, and lightweight import and export |
| **DITA**     | An export target if a customer needs one. Never the core             |

Supporting choices that follow:

- **Every annotation over a range is a mark, and every mark carries an id.** Conditions, redlines,
  comment anchors, citations, variables and inline bindings are all range annotations. Marks are
  sets applied to ranges rather than elements that must nest, so overlapping ranges are the native
  case, and accept, reject or exclude acts on every fragment of one id at once. Marks still
  fragment at block boundaries; the shared id is what makes that the same shape as standoff markup
  rather than a loss.
- **The schema is designed against the OOXML and PDF/UA mappings from the start.** They are the two
  hardest targets, and a mapping retrofitted onto a schema that did not anticipate it is where
  publishing fidelity dies.
- **The model carries no presentational formatting.** Character-level marks are semantic; appearance
  belongs to the presentation theme, which is what lets one component look right in every document
  that uses it.
- **The model must be able to persist the editor's transform steps alongside revisions.** How much
  weight that step log carries for comparison, versus a post-hoc tree diff, is settled by the spike
  rather than here - but the model is chosen partly because it makes the step log available at all,
  and because the same mechanism is the CRDT upgrade path that the scope's section 14 reserves.

## What would change the answer

- **The wedge shifts to technical documentation.** Procurement starts scoring DITA compliance, an
  existing customer corpus makes migration a sales motion, and the interchange value that is
  currently near zero becomes substantial.
- **A spike gate fails.** Cases 1, 3, 7 or 8 in
  [`Content_Model_Spike.md`](../specification/Content_Model_Spike.md) needing a workaround that
  leaks into the schema means this record is superseded rather than patched.
- **A standard appears that natively expresses overlapping ranges, tracked changes and data
  bindings together.** None does today. One that did would remove the argument above entirely.

Note what does **not** change the answer: live co-editing becoming table stakes. Node-and-mark is
the family that CRDT implementations are built for, so that outcome strengthens this decision
rather than reopening it.

## Consequences

- **No DITA-OT, no Pandoc, no ecosystem.** Every importer and exporter is written here. That is the
  honest price, and it was paid deliberately.
- **Word export belongs in the first delivery tranche**, not the interchange tranche. It is the
  stated fidelity bar, and the schema is being designed against its mapping - so the mapping has to
  be exercised while the schema can still change cheaply.
- **Schema evolution is a permanent owned concern.** `packages/domain` carries a versioned schema
  and a migration path from the first revision ever written, because revisions are immutable and a
  schema change cannot rewrite them.
- **The tested export guarantee matters more, not less.** With no standard at the core, a working
  export is the entire anti-lock-in story rather than a supplement to a format name.
- The schema and its validation live in `packages/domain`, which already forbids React, Electron
  and `fs` - the right home for the one part of the product that has to be testable without booting
  anything.
