# R15: Revisions effective by scope

> T4's fifteenth slice, extending [workflow.md](../design/workflow.md) ("Dates") and
> [publishing.md](../design/publishing.md). **Full tier**: stored shapes (0111), a contract change, and
> what every `approved` reference serves. Built inline, one final review at the slice's end. Decisions
> marked **(default)** are recommendations Ken may overturn; the rest are his answers of 2026-10-17.
> Divergent lines (LIF-044 to LIF-046) are R16.

**Goal:** a revision can be effective for a scope - a site, a market - while another is effective
elsewhere; "what was effective here on that day" has one answer anybody can ask for; and a revision can
wait on a named party's acceptance before it takes effect in their scope.

| PR   | Holds                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------- |
| R15a | This plan; 0111; scopes set and fixed at designation; resolution by profile; acceptance's route (LIF-042) |
| R15b | Effective for, pending and Accept on the page (LIF-047)                                                   |
| R15c | What was effective, asked from the page (LIF-043); final review; 0.186.0                                  |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R15-A | **A scope is a condition axis value** (Ken): `market:us`, `site:plant_7`, from R6's declared axes, so a document's profile already says the scope it is read in. Components and documents, as dates are.                                                                                                                                                                                                                                                                                                        |
| R15-B | **Set as an act, fixed at designation** (default), as an effective date is (WF5): `PUT /v1/{components\|documents}/{id}/scope` on edit inserts an `artifact_scope` row, its latest the artifact's: the axis values the next revision is effective for, none meaning everywhere, each value declared (`profile_unknown` otherwise), each with an optional accepting party. Audited `scope.set`. A gate designating a revision copies it into `revision_scope`, fixed; audited in `revision.designated`'s detail. |
| R15-C | **One answer per scope and instant** (Ken; LIF-043): in a scope, the newest revision effective there - designated, its effective instant passed, accepted where acceptance is asked - applies; where none is scoped to it, the newest unscoped one. A newer unscoped revision does not displace a scoped one; a new revision scoped to the same value does. Two values of one profile matching two revisions: the newer.                                                                                        |
| R15-D | **Resolved by the document's profile** (Ken): `latestRevisionsOf` takes the profile, and every `approved` reference, publish (under the chosen profile where R12 chose one), baseline, numbering and comparison resolves through it; a document with no profile reads the unscoped revisions alone.                                                                                                                                                                                                             |
| R15-E | **Acceptance by a person or group per scope** (Ken; LIF-047): a scope value may name its party. Until one of them accepts (`POST .../revisions/{n}/acceptance`, audited `revision.accepted`), the revision is pending in that scope, said so on the page, and the one before stays effective there. Nobody else may accept; the party must be able to read the artifact.                                                                                                                                        |
| R15-F | **What was effective** (default; LIF-043): `GET /v1/{components\|documents}/{id}/effective?scope=<axis:value>&at=<instant>` answers the one revision and why - scoped, unscoped fallback, or none - and the component's and document's pages ask it from a scope and a day.                                                                                                                                                                                                                                     |

## Tasks

- **R15a**: 0111 (`artifact_scope`, `revision_scope`, `revision_acceptance`, the audit kinds); set and read; fix at designation; `latestRevisionsOf` by profile and every caller given one; the acceptance route, since its audit kind needs a writer. Tests: each R15-C case; a reference in two documents of two markets served two revisions; pending serves the one before; only the party accepts.
- **R15b**: the pending state in views; Effective for beside Dates; Accept for the party.
- **R15c**: the effective route and its panel; the final review; the close.

## Built

R15a #687, R15b #688, and R15c with the close (0.186.0) #690. One departure: acceptance's route
came in R15a, since its audit kind needs a writer, and R15b held the page. The final review found a
group named to accept that could be deleted under a scope, failing the gate that fixes it, and the
Effective for dialog dropping a group party on save; both fixed, a group a scope names now refused
deletion (`group_in_scope`). Left: a party who loses read access after the scope is set leaves the
revision waiting in that scope until a newer revision is designated there; the dialog offers people,
and a group only where one is already named; the placement report and a template's required
components, having no document's profile, judge the unscoped revisions alone. Divergent lines are R16.
