# Recovering saved changes, reworked

Ken's ask of 10 October 2026: Recover opens a dialog listing the saved changes, each showing what
recovering it would change, with Recover and Cancel; the notice can be dismissed, and the changes
discarded. Agreed in two PRs. Only R2 crosses a stored shape and a contract, so only it is planned.

| PR  | What                                                                                      |
| --- | ----------------------------------------------------------------------------------------- |
| R1  | Saved text as a modal, what recovering one changes, Recover and Cancel; Dismiss for a tab |
| R2  | Discard: the changes no longer offered, everywhere, kept for Saved text until they expire |

## R2: Discard

The runtime role may not delete an iteration (VER-001), and the iterations are the safety net the
retention window promises (VER-003), so Discard deletes nothing: it sets the caller's unversioned work
aside up to a time.

- **Store**: tenant migration 0063, `unsaved_discarded`: a row per person and component, `up_to`, the
  latest kept (`greatest`). `newestUncutIteration` offers nothing saved at or before it; anything
  saved after is offered again.
- **Contract**: `PUT /v1/components/{id}/unsaved/discarded`, `{ upTo }` (the component's
  `unsaved.savedAt`), `edit` on the component, no lock. A permission-checked route answers a body, so
  it answers what is offered now, `{ unsaved }`, null unless something was saved since.
- **Editor**: **Discard** beside Recover and Dismiss, asking first: "These changes will no longer be
  offered for recovery. They stay in Saved text until they expire."
- **Risk**: Saved text still lists discarded work while it is kept, which is the point; nothing marks
  it there as discarded. Accepted until someone asks.
