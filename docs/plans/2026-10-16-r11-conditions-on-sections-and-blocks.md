# R11: Conditions on sections and blocks

> T4's eleventh slice, extending [publishing.md](../design/publishing.md)'s conditions (the R6 plan).
> **Full tier**: stored shapes (an outline node's and a numbered block's conditions), a contract
> change. Built inline, one final review at the slice's end. Decisions marked **(default)** are
> recommendations Ken may overturn; the rest are his answers of 2026-10-16.

**Goal:** a section, a component reference and a numbered block can carry conditions, so a profile
can take out what is numbered: what it excludes takes no number, a reference to it fails, the lists
hold only what is kept; a baseline publishes under the profile it pinned; a gate can require a
complete profile; and the order test places transclusion, conditions and variables.

| PR   | Holds                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------- |
| R11a | This plan; conditions on outline nodes; a reference to excluded content failing; the order tests     |
| R11b | Conditions on numbered blocks, the editor and paste keeping them                                     |
| R11c | A baseline's profile (VER-020); the gate's `profile` (LIF-065); the final review; the close, 0.182.0 |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R11-A | **Nodes and blocks** (REU-Q02; Ken's answer): a section and a reference carry `conditions`, `[{ axis, values }]`, additive at outline schema 3 as `origin` was; written whole by the outline's `set`, `[]` clearing. Selected as a mark is (R6-C): every condition must select it, an unset axis excludes and fails `axis_unset` unless accepted (REU-053). An excluded node takes its subtree with it. |
| R11-B | **Which blocks** (default): a table, a bound table, a figure and a block equation, what is numbered, carry `conditions` too, additive at content schema 1. A paragraph keeps its marks. The editor holds the attribute both ways and a paste keeps only declared axes, as for marks; setting one in the page is the next slice's.                                                                       |
| R11-C | **Pruned first** (REU-028, REU-029, STR-051): `assemble` prunes the outline before anything reads an occurrence, so an excluded reference's content is never conditioned, bound, numbered or listed, and its resolve failures are dropped. Excluded titles and words join the scan's passages (REU-048).                                                                                                |
| R11-D | **A reference to excluded content** (STR-030; default): fails `cross_reference_excluded`, naming its target, distinct from one that never resolved.                                                                                                                                                                                                                                                     |
| R11-E | **Required may be conditioned** (Ken's answer): conformance reads the outline, where a conditioned required node is present.                                                                                                                                                                                                                                                                            |
| R11-F | **A baseline pins its profile** (VER-020; Ken's answer): the pinned document version holds it, so it is in the digest already; the baseline's view says it, and its publication records it and runs under it, not the empty profile.                                                                                                                                                                    |
| R11-G | **The gate's `profile`** (LIF-065; Ken's answer): a seventh `requires` member, a document's alone: every axis its kept content is conditioned on is set, read as the decider; a component they may not read leaves it unproven.                                                                                                                                                                         |

## Task 1: Outline nodes - R11a

- Domain: the member, the `set`, `selectOutline` (kept nodes, excluded titles, unset axes), the
  prune in `assemble`, `cross_reference_excluded`. Order tests for PUB-109 to PUB-111.
- Tests: kept and excluded by profile, a subtree, unset refused and accepted; an excluded section
  takes no number and is in no contents, an excluded reference's table in no list (STR-020, STR-042);
  a reference to either fails (STR-030); the scan catching an excluded title.

## Task 2: Blocks - R11b

- Domain: the member on four blocks, `applyConditions` removing a block, its text to the scan. Editor
  schema and mapping; reidentify. Tests: an excluded table unnumbered (REU-028), a save and a paste.

## Task 3: Baselines and the gate - R11c

- Baseline view and request; `profile` in `requires`. The final review hunts excluded content reaching
  an output and a number counted for it. The close: 0.182.0.
