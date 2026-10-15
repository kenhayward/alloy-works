# R4: Local overrides

> T4's fourth slice, extending [structure.md](../design/structure.md) and
> [comparison.md](../design/comparison.md). **Full tier**: a stored shape (a member of the outline's
> reference node), every reader of placed content. Built inline, one final review at the slice's end
> (Ken, 2026-10-14). Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** a reference can carry a local override, so one document differs in a small way without
forking the component; it lives on the reference, shows in where-used and comparison as an override,
and applies while the block it replaces is as it was, failing loudly where it is not (REU-011 to
REU-015).

| PR  | Holds                                                                                        |
| --- | -------------------------------------------------------------------------------------------- |
| R4a | This plan; the override in the outline, applied wherever placed content is read (Task 1)     |
| R4b | Overriding a paragraph in the document's page; the final review; the close, 0.175.0 (Task 2) |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-A | **What an override is** (default): on a reference node, `overrides: [{ block, against, text }]`, at most 20: the paragraph `block` of the component, as it stood at component version `against`, replaced in this document by `text`, runs of text with their marks and nothing else. A paragraph alone, and its text alone, so an override changes no number, binding, citation, footnote or cross-reference target: it is a small difference (REU-011), and every reader that numbers or binds reads the component as it is. Additive at outline schema 1, as figures' bindings were. |
| R4-B | **On the reference, never the component** (REU-012): set by the outline's `set` operation, `overrides` whole, as a section's values are; `[]` clears them. Refused on a section, on a block that is not a paragraph of the component at `against`, and on an `against` that is not the component's.                                                                                                                                                                                                                                                                                     |
| R4-C | **Survive or fail loudly** (REU-015): an override applies where the paragraph the reference takes now is, canonically, the paragraph at `against`, whatever else of the component changed. Where it has changed or gone, the override is **stale**: the publish fails `override_stale`, naming the node and the block, and the document's page says so beside the paragraph. Never silently dropped, never applied over a changed paragraph.                                                                                                                                            |
| R4-D | **Applied where content is read for a document** (default): one domain function, `applyOverrides(content, overrides, against)`, used by publishing (PDF, Word and previews alike, before conditions), the document's texts, and a baseline's page. Numbering, bindings and search read the component as it is, which R4-A makes the same answer.                                                                                                                                                                                                                                        |
| R4-E | **Where-used** (REU-013): each reference says `overridden`, and the Used in dialog says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R4-F | **Comparison** (REU-014): an outline comparison names `overrides` as changed on the node, and resolved comparison gains a cause, `overridden`, for a node whose overrides differ, apart from `edited`: an override is never a fork, since the component is unchanged.                                                                                                                                                                                                                                                                                                                   |
| R4-G | **Overriding in the page** (R4b, default): a paragraph of a component placed in the document offers **Override here** to whoever may edit the document, a dialog with the paragraph's text; marks are kept where the text of a run is kept, and the dialog says the rest is plain. An overridden paragraph is marked, with **Remove override**; a stale one says it no longer applies.                                                                                                                                                                                                  |

## Task 1: The override - R4a

- Domain: the member, its checks, `applyOverrides` and stale detection; `set`'s `overrides`. Db: the
  `against` checks in `editOutline`; publishing's failure and the applied content; texts and baselines;
  where-used; comparison.
- Tests: set, cleared, refused each way; applied in a publish and the texts; stale on a changed and a
  gone paragraph, failing the publish by name; where-used marked; comparison's cause.

## Task 2: The page - R4b

- **Override here**, the marks, **Remove override**, stale said. The browser walks. The final review
  hunts an override reaching another document, and a stale one applied or dropped silently. The close:
  0.175.0.
