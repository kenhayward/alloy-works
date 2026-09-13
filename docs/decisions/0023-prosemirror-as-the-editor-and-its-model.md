# 0023 - ProseMirror as the editor, and one view per component

- **Status:** Accepted
- **Date:** 2026-09-13

## Context

[ADR-0005](0005-purpose-built-node-and-mark-content-model.md) makes canonical content "identical to
the editor's in-memory model", and CNT-001 says the same. Neither names an editor. Twenty-two
decision records, and none chose one - so the requirement bound the stored model to something that
did not exist, and [`docs/design/content-model.md`](../design/content-model.md) had to state a
reading of CNT-001 rather than meet it.

The choice was settled before the content model became code rather than with the editor design. A
migration fixture written at schema version 1 is permanent, because CNT-012 keeps every version ever
written readable for as long as a tenant keeps its content. If the editor imposed a shape on the
stored model, the cheap moment to find out was while there were no fixtures.

The corpus narrowed the field before any code was written, and
[`Editor_Framework_Spike.md`](../specification/spikes/Editor_Framework_Spike.md) stated that narrowing
as a premise to be checked rather than inherited. CNT-003 and CNT-007 rule out any editor whose range
annotation is an element wrapping text, because an element must split at an overlap - the failure
ADR-0005 rejected tree markup for. And ADR-0005 describes a transform step log without naming one.
Both premises held, so the first candidate was the only one tried.

## Decision

**ProseMirror is the editor, and its document model is the editor's model that CNT-001 refers to.**

**One `EditorView` per component, stitched into one scrolling container.** This is chosen by two
requirements rather than by preference:

- **CNT-069** scopes undo to the component being edited. `prosemirror-history` keeps one undo stack
  per editor state, so one view over many components is one stack.
- **CNT-074** requires per-component editability. With one view per component that is a prop; with
  one view it is a `filterTransaction` on every transaction forever, where a bug is a permission
  failure rather than a glitch.

**CNT-001 is met by a lossless total mapping, not by identical objects**, as
[`content-model.md`](../design/content-model.md) already reads it. The spike found the reason this
matters: a block identifier **cannot** be a required attribute in ProseMirror's schema, because `doc`
content is `block+` and it must be able to generate a paragraph to fill a required position. The
stored schema still requires it, in `packages/domain`, and the mapping refuses a null identifier at
the boundary.

**Block identity is maintained by one plugin, and its rule is descent rather than arrival.** A block
standing at its identifier's forward-mapped position descends from the block that held it and keeps
it; every other block holding that identifier is new and is re-identified. The position is mapped
with an association of 1, because -1 makes an incoming block look like the heir and renames the
existing one.

**Where a library plugin owns the DOM, accessibility wins.** `prosemirror-tables` emits a bare `<th>`
with no `scope`, and its `columnResizing` node view builds the table DOM itself and ignores `toDOM`,
so no `<caption>` can be emitted while it is enabled. TAB-031 and TAB-039 are not negotiable against a
resize handle.

## What would change the answer

- **A gate failing on a real document.** The spike's 300 components carry short text. If mounting a
  real report's components is slow enough to need virtualising the scroll, the one-view-per-component
  shape acquires a cost this record did not price.
- **Selection across component boundaries turning out to be required.** One view per component means a
  selection cannot span two. The spike did not test it and the editor design has to decide whether
  that is correct for a component CMS or a defect. If it is a defect, the single-view shape returns
  and CNT-069 needs a custom history rather than the library's.
- **CNT-139's release audit failing.** A screen reader pass over the spike's surface, with Narrator
  and NVDA, found nothing - but that is narrower than the recorded audit against the full WCAG 2.2 AA
  criteria which that requirement binds to a release, over the product rather than a throwaway editor.
  An audit that finds the real surface unusable reopens this.
- **ADR-0005 being superseded.** Node-and-mark is what makes this candidate the right family. If the
  content model changed family, this record goes with it.

Note what does **not** change the answer: a UI toolkit layered over ProseMirror. That is a separate,
reversible choice about components and commands, not about the document model.

## Consequences

- **The editor design (CNT sections 11 to 13) is unblocked**, and inherits four named costs: the
  identity plugin, a `toDOM` override for header cell scope, a decision between column resizing and a
  `<caption>`, and CNT-139's release audit, which a screen reader pass over a spike surface does not
  discharge.
- **`docs/design/content-model.md` does not change.** No node, no mark and no member of the root moves.
  The vocabulary survived contact with an editor, which is what the spike ran to find out.
- **The round-trip test CNT-001 is satisfied by now has a definition** and belongs with the editor's
  implementation. `content-model.md` names it as arriving then.
- **A green automated accessibility run is not conformance, and this is now evidence rather than
  policy.** axe reported zero violations against a table whose caption was not associated with it. The
  screen reader pass that followed found nothing wrong, which is the point: the two halves catch
  different things and neither substitutes for the other.
- **We own the accessible DOM of anything a ProseMirror plugin renders.** That is the price of using
  its table editing, and it applies to every plugin adopted later.
- **No DITA, no ecosystem, and now no editor ecosystem either** - the consequence ADR-0005 already
  accepted, extended one step. Every schema node needs its own node view or `toDOM`, and each is ours.
