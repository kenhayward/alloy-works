# WF4: The latest approved revision

> T9's fourth phase ([ADR-0061](../decisions/0061-t9s-order.md)), extending
> [workflow.md](../design/workflow.md) and [document-view.md](../design/document-view.md). **Plan
> tier**: every resolver of a reference changes. No migration, no new route. Built inline in one PR
> with the close, one final review at its end (Ken, 2026-10-14). Decisions marked **(default)** are
> recommendations Ken may overturn.

**Goal:** a reference can track its component's latest approved revision, resolved wherever a
reference is read, shown with its revision, chosen from the document view, audited, and flagged when a
newer revision is approved than the last publication carried (LIF-038, LIF-041, REU-050, CNT-159,
CNT-163, CNT-183).

Already built: the `approved` mode in the outline, stored by the outline's `set`, and every mode change
audited `reference.repointed { node, component, from, to }` (RS-G).

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF4-A | **Resolution**: an `approved` reference resolves to the version its component's latest revision designates, in `resolveOccurrences` and `numberingInputs`, so publishing, previews, baselines, the view's texts, numbering, comparison and bindings all read it. None designated is unresolved, as now: a publish fails it `occurrence_unresolved`. Readability as for `latest`. |
| WF4-B | **Shown** (CNT-163, REU-050): the texts carry `revision` for an `approved` occurrence; its label reads "Revision 2, latest approved", "no approved revision" where none is, and the outline tree "latest approved".                                                                                                                                                              |
| WF4-C | **Chosen** (CNT-159): the label's list offers **Always the latest approved revision** beside **Always the latest** and each version; each version that is a revision says so ("Revision 2").                                                                                                                                                                                     |
| WF4-D | **Audited** (CNT-183): `reference.repointed` as built; an `approved` side records the version it resolved to then, so "from which to which" names the revision (default).                                                                                                                                                                                                        |
| WF4-E | **Moved** (LIF-041) (default): an `approved` occurrence whose version is not the one the document's latest publication carried for that node says so, "Revision 3 is approved since the last publication, which carried version 2.1", with **Compare**, as a pinned one's newer version does (CNT-181). Never published: nothing to say.                                         |
| WF4-F | **What a gate requires** (WF3-E) needs no special case: an `approved` reference now resolves to a designated version, and one that resolves to none fails `components`.                                                                                                                                                                                                          |

## Task: WF4

- db: `approvedVersionsOf`, both resolvers, `recordRepoints`, the latest publication's occurrences;
  the texts route's `revision` and `moved`; the contract; the label, its list, the tree, the notice.
- Tests: an `approved` reference resolved in publishing and numbering, unresolved with no revision,
  moving as a newer revision is designated; the texts' revision and moved; the audit's versions; the
  label, the list's choice and the notice; the browser walks.
- The final review hunts a reader served a draft through an `approved` reference, a revision leaked
  past readability, and a resolver left at "unresolved". The close: 0.169.0.
