# WF3: What a gate requires

> T9's third phase ([ADR-0061](../decisions/0061-t9s-order.md)), extending
> [workflow.md](../design/workflow.md). **Plan tier**: a stored shape (a workflow body's transitions)
> and a new refusal. No migration, no new route. Built inline in one PR with the close, one final
> review at its end (Ken, 2026-10-14). Decisions marked **(default)** are recommendations Ken may
> overturn.

**Goal:** a transition, a gate or not, can require conditions, checked as it is taken and refused by
name: no unresolved suggestions, no open threads, no failed bindings, no missing required sections, no
outstanding revisions, and every component a document assembles at an approved revision (LIF-004,
LIF-039, COL-066, DAT-123).

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF3-A | **`requires`** on a transition: a list of `suggestions`, `threads`, `bindings`, `sections`, `revisions`, `components`, optional so stored bodies read unchanged. A component's transitions may require `suggestions` and `threads`; a document's all six; a query definition's none, having neither suggestions nor threads (`condition_kind`). Each at most once (`condition_duplicate`).                                                                                                         |
| WF3-B | **When** (default): as the transition is taken, a plain move and every approval at a gate, so a gate never collects approvals it cannot pass on. A rejection and the automatic draft on save are never held. Refused `conditions.unmet` (409 `conditions_unmet`) naming each condition not met, with nothing recorded.                                                                                                                                                                             |
| WF3-C | **A document's suggestions and threads** are its own threads and those on every component it assembles, readable by the decider or not: counted, never shown. A component's are its own.                                                                                                                                                                                                                                                                                                           |
| WF3-D | **Bindings, sections, revisions, components** are read as the decider, as a gate's baseline is: `bindings` is every binding resolved and current (publishing's `binding.unresolved`), `sections` the template's required sections (TPL-013, named by title), `revisions` a person's revision standing in front of a binding's result (DAT-123, DAT-122's count). A component the decider may not read leaves `bindings`, `revisions` and `components` unproven, so unmet, counted and never named. |
| WF3-E | **At an approved revision** (LIF-039): the version a reference resolves to is a designated revision. An `approved` reference, which phase 4 resolves, is met where its component has a revision. Those not met are named by title.                                                                                                                                                                                                                                                                 |
| WF3-F | **No seed changes** (default): seeds require nothing; a tenant chooses in Administration > Workflows, where each transition offers its kind's conditions as checkboxes. The refusal's message is what a person sees.                                                                                                                                                                                                                                                                               |

## Task: WF3

- Domain: `requires`, its rules. db: `workflow-conditions.ts` (`unmetConditions`), checked in
  `moveArtifact` and `decideGate`; publishing exports what reads a document's held bindings. Contract,
  service refusal and message, the admin checkboxes.
- Tests: each condition met and unmet, for a move and a gate's approval; a rejection never held;
  names and counts; unreadable components counted, not named; the rules; the admin editor; the
  browser walks.
- The final review hunts a condition passed that should not be, a title leaked, and a refusal that
  records. The close: 0.168.0.
