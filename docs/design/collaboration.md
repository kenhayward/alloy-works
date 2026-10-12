# Collaboration

Who may hold a component's lock, for how long, and how it passes from an idle holder to somebody who
needs it - the lock rules [realtime.md](realtime.md) leaves to "collaboration's design", on the row
[component-editor.md](component-editor.md) claims and saves under. Threads, suggestions and review
rounds (COL's later phases, ADR-0057) will join this document as their turns come.

> **Built** by [the PL plan](../plans/2026-10-11-pl-presence-and-locks.md): the settings and `active_at`
> (PL3), and taking (PL4). **Threads, the inbox and review mode** are being built by
> [the TH plan](../plans/2026-10-12-th-threads-inbox-and-review.md).

## The shape in one paragraph

A lock lasts while its holder saves: each acknowledged iteration moves its **activity** on, and a lock
whose holder has saved nothing for the environment's **release period** is free. Somebody else may ask
to **take** it once the holder has been idle for the shorter **take period**: the ask is recorded, the
holder hears it at once, and for a **grace** of a minute any work they save keeps the lock and ends the
ask. When the grace passes with the holder still idle, the asker's next request moves the lock to them,
and the taking is on the audit log. Nothing the holder saved is lost: it is theirs to recover when they
next hold the lock. A take is never instant and never silent.

## Requirements owned

| ID          | How                                                                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-008** | A lock is free once its holder has saved nothing for the release period, `editing_policy.lock_release_minutes`, 15 by default, which an administrator sets                                                                                                        |
| **COL-009** | `POST /v1/components/{id}/lock/take`: asked, warned, waited, then taken from an idle holder; `lock.taken` names whom from                                                                                                                                         |
| **COL-044** | Claims serialise on the component (`serialise`); one wins, the other is told at once, shown no editable surface, and keeps what it typed (component-editor.md's Claiming)                                                                                         |
| **COL-045** | The holder's window hears `lock` with `taken`, or its next save is refused `lock_taken`; it names the taker, says their saved work is kept, and offers what it had not sent as text to copy; their iterations are theirs to recover when they hold the lock again |
| **COL-046** | The take period, `lock_take_minutes`, 5 by default, is a tenant setting, and a value not shorter than the release period is refused                                                                                                                               |
| **COL-047** | The holder is warned at the ask and given a declared grace of 60 seconds in which any saved work keeps the lock                                                                                                                                                   |

| **COL-012** | A thread is anchored to a span of a component's text (its block and the text it quotes), a table cell (its first block), a whole component, or an outline node |
| **COL-013** | `POST /v1/threads/{id}/resolution` records who and when; nothing else ends a thread |
| **COL-014** | Comments in the order made, each with its author; replying is a comment on the thread |
| **COL-015** | A comment names people as mentions; each who may read what the thread is on is told in their inbox, and one who may not is told nothing, which the composer is then told |
| **COL-016** | An anchor is a block's identifier and the text it quotes, not a position: it holds through any change that keeps that block and that text |
| **COL-017** | A thread whose block, node or quoted text is gone is listed **orphaned**, never dropped, with the text it was on |
| **COL-018** | `GET /v1/documents/{id}/threads`: its own nodes' and every placed component's the caller may read, each placed against the version its occurrence resolves to, filtered by state, author and since when |
| **COL-019** | Threads are their own tables: nothing a publish reads holds one |
| **COL-049** | No route deletes a thread or a comment, and the runtime role holds no delete on either |
| **COL-050** | Each thread records the version it was made against; comments, edits and resolutions are insert-only |
| **COL-051** | An edit is a new text row; the comment shows the latest and says it was edited, and every earlier text is kept and readable to whoever reads the thread |
| **COL-054** | Every time here is a `timestamptz`, sent as an instant, and shown in the reader's own time zone with its time |
| **COL-063** | `notification`: one row per recipient, listed in the inbox newest first, unread marked |
| **COL-034** | `notification_preference`: for each kind - mentions, replies on a thread one is in, resolutions - at once, in a daily digest, or never |
| **COL-035** | The worker folds a person's held events, once a day, into one notification saying how many of what, and where, deciding again what they may read |
| **COL-036** | A notification names its kind, who, and the thread and artifact by identifier: never the text. The inbox shows a title only to a reader of it, at the moment it is read |
| **COL-053** | The digest holds counts and identifiers alone, on the same terms |
| **COL-062** | Kept 90 days, then swept; deleted by its recipient alone; a second copy of tenant content, in the tenant's schema and read only by its recipient (IAM-066). A deprovisioned principal's inbox is deleted with them - no act deprovisions anybody yet, so the rule is stated and waits for that act |
| **CNT-155** | The document view offers **Review** beside Reading and Authoring |
| **CNT-157** | Review shows threads and lets the reader start and answer them; it offers no editing surface. Suggestions join it in phase 6 |
| **IAM-081** | Review is offered to whoever holds `comment` or `suggest` on the document, as Authoring is to whoever holds `edit` (IAM-080) |

**COL-045's two edges**, named rather than hidden: a holder **offline** through the grace has saved
nothing since they lost the network, so what they typed is in their window's storage alone, kept there
and offered when it next opens, not an iteration; and what they did save is recoverable **within the
tenant's retention** after the taker's next cut (VER-003), not for ever.

**Not claimed:** COL-056. Nothing deletes a component or moves it between spaces yet (T7, T9); a lock
whose component leaves a viewer's readable set already degrades to absence on the stream
(realtime.md), and the claim waits for the act that would test it. COL-005 and COL-006 stay
component-editor.md's.

## The row

`component_lock` gains three columns: `active_at`, when the holder last claimed - a claim from the
holding session, on a reload or in Recovery, included - or saved an iteration not seen before
(migration 0068, the PL plan's PL3, backfilled from `claimed_at`); and `taking_by` and `taking_until`, who
has asked to take it and when that ask's grace ends (migration 0069, PL4).
`expires_at` stays the moment the lock is free - `active_at` plus the release period - so every reader
that already treats an expired row as nothing goes on doing so.

| Act                   | Changes                                                                                  | Notifies                  |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| Claim, or claim again | `active_at` now, `expires_at` on, any ask cleared                                        | `lock`                    |
| An iteration saved    | The same: saving is activity, and ends an ask                                            | `lock` where an ask ended |
| Ask to take           | `taking_by`, `taking_until` = now + grace, where the holder is idle past the take period | `lock`, with the ask      |
| Take, after the grace | The row moves to the asker's session, `active_at` now; `lock.taken`                      | `lock`, with `taken`      |
| Release, or expiry    | The row deleted, or read as nothing                                                      | `lock` on release         |

## Taking

| Asked when                                         | Answer                                                       |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Nobody holds it                                    | `409 lock_free`: claim it instead                            |
| The holder is active within the take period        | `409 lock_active`, with when it becomes takeable             |
| Idle, no ask yet, or another's ask lapsed          | `200`, `taken: false`: the ask recorded, with `taking.until` |
| Your ask, its grace not yet over                   | `200`, `taken: false` again, unchanged                       |
| Your ask, its grace over, the holder still idle    | `200`, `taken: true`: the lock is yours                      |
| Somebody else's ask in its grace, or a minute past | `409 lock_taking`, naming them                               |

**The asker's window drives the second request**: it shows the warning it gave, counts the grace down,
and asks again when it ends; a window closed in the grace leaves an ask that lapses a minute after its
grace, when another ask may be made. The asker types nothing until it holds the lock. The second request
takes only under `serialise`, only the asker's own ask, only past its grace, and only where `active_at`
is older than the ask; activity in the grace clears the ask in the same transaction. So an iteration
saved in the last moment of the grace either commits first and keeps the lock, or after and is refused
`lock_taken`. A lock that lapses in the grace is free: the asker claims it.

**The holder's window, taken**, cannot go to Recovery, which begins by claiming a lock the taker now
holds. It shows who has it, that what was saved is kept, and what it had not sent as text to copy, as a
window that lost the lock to its own other window does (component-editor.md); Recovery offers the saved
work when they hold the lock again. It learns at once from `lock` with `taken`, or, where that reached
nobody - an idle laptop asleep - from the refusal of its next save, `lock_taken`, naming the taker.

**Taking from oneself** is **Continue here** (component-editor.md's two windows), not a take.

## Settings

`editing_policy` gains `lock_release_minutes` (5 to 240, default 15) and `lock_take_minutes` (1 to 239,
default 5), with a check that taking is shorter than releasing. `PUT /v1/settings/editing` takes both,
`administer` at the tenant, `settings.changed` naming the fields. Administration's **Editing** shows
them beside the iteration retention.

## Decisions

| ID   | Decision                                                                                                                                    | Instead of                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| CL-A | **Activity is a saved iteration or a claim**, not keystrokes or focus                                                                       | A client heartbeat, which keeps an abandoned open tab's lock for ever              |
| CL-B | **The grace is a declared constant**, 60 seconds                                                                                            | A third setting nobody asked for                                                   |
| CL-C | **The asker's window asks again**; no job moves the lock                                                                                    | A timer in the service, which would take the lock for somebody who has gone        |
| CL-D | **The holder's work stays theirs** (RC-A): the taker cutting a version does not delete it; Recovery offers it when they hold the lock again | Copying it into the taker's session, which would hand one person's work to another |

## Verification

- `packages/db`: each row of Taking, the grace raced by a save both ways, settings' check.
- `apps/service`: the routes, `lock.taken` with its detail, the stream's `lock` events with the ask and
  with `taken`, the settings refused out of order.
- `apps/web`: **Take over**'s warning and countdown; the holder's notice and Recovery; the settings; axe.

## Threads

A thread is a row beside the content, never a mark in it ([ADR-0058](../decisions/0058-suggestions-are-proposals-beside-the-content.md)'s
reasoning holds for comments too: a comment is not a write to the component, so it needs no lock and
waits on nobody). It is **on** one artifact - a component for a span, a cell or the whole component, a
document for an outline node - and records the version it was made against. A comment's text is
plain words and mentions, and an edit adds a text row rather than replacing one. A thread is open
until resolved; it is never deleted.

| Anchor      | Holds                                                               | Orphaned when                                            |
| ----------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `span`      | The block's identifier and the text quoted, with the text before it | The block is gone, or the quoted text is no longer in it |
| `cell`      | The table's identifier and its cell's first block                   | That block is gone                                       |
| `component` | Nothing beyond the component                                        | Never                                                    |
| `node`      | The outline node's identifier                                       | The node is gone from the document's latest outline      |

Who may: read a thread with `read` on what it is on; start one, reply and resolve with `comment`
there; edit a comment as its author alone. A resolved thread takes nothing more, and is never
reopened. A join keeps the first block's identifier (ADR-0023), so a span in the block joined to it
is orphaned, and listed so.

## The inbox

A notification is what happened, to whom, by whom, about which thread and artifact, and when -
**never the text** (COL-036). The inbox lists them newest first; opening one reads the thread then, as
the reader, so a title or a comment is shown only to somebody who may read it now. Each person
chooses, per kind, **at once**, **daily** or **never**; the worker's daily run folds what waits into
one digest notification of counts and places. Kept 90 days.

## Review mode

Review is the document view's third mode (CNT-155): the text as Reading shows it, with every thread on
it marked where it stands and a panel listing them, and a way to start one on a selection, a component,
a cell or a node. It never opens an editor (CNT-157). It is offered to whoever holds `comment` or
`suggest` (IAM-081).
