### Added

- **Workflow states.** Every component and document is in one workflow state, starting in Draft, and moves to In review and Approved by the transitions its kind's workflow declares, each audited, with a reason where the transition asks for one.
- **Workflows per environment.** An administrator saves each kind's states and transitions as a new version through the API; every version is kept. Saving an approved component or document moves it back to Draft.
- **Search by state.** Search narrows by workflow state and counts results in each.
