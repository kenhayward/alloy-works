# TH: Threads, the inbox and review mode

> T3's fifth phase ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)),
> under [collaboration.md](../design/collaboration.md)'s Threads, The inbox and Review mode. **Full
> tier**: a migration, stored shapes, new contracts, permissions over content and a second copy of it
> (the inbox); a pre-flight review and a final review. Ken asked for the run to proceed on 2026-10-12;
> decisions marked **(default)** are recommendations he may overturn.

**Goal:** a reviewer comments on a span, a cell, a component or a node of a document without the
lock; threads are replied to, resolved, never deleted, and survive the text changing or say they are
orphaned; a person mentioned, or in a thread, is told in their inbox - at once, daily or never, as they
choose - and told that something happened, never what; the document view's **Review** mode does it.

| PR  | Holds                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------- |
| TH1 | This plan and the design; migration 0076; threads and comments, their routes, mentions recorded (Task 1)   |
| TH2 | The inbox: notifications made, listed, read, deleted; preferences; the daily digest and retention (Task 2) |
| TH3 | Review mode: the threads panel, anchoring from a selection, a card, a cell and a node (Task 3)             |
| TH4 | The inbox page and preferences; the whole system, docs and the close (0.155.0) (Task 4)                    |

## Decisions

collaboration.md's, and:

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TH-A | **Migration 0076**: `thread` (id, on: artifact and kind, anchor as JSON by kind, the version made against, creator, `created_at`); `thread_comment` (id, thread, author, `created_at`); `thread_comment_text` (comment, parts as JSON, `written_at`), the latest a comment's; `thread_resolution` (thread, by, at), unique; `notification` (recipient, kind, actor, thread, artifact, `counts` for a digest, at, `read_at`); `notification_held` (a `daily` event waiting); `notification_preference` (principal, kind, cadence). Insert-only by grant, but `read_at` and a recipient's delete of their own notification; the worker deletes expired notifications and held rows it folds; `audit_event_kind` rebuilt for the new kinds. **A thread's state is derived**: resolved where a resolution row exists |
| TH-B | **A comment's text** is parts: words, and mentions by principal; 1 to 4,000 characters of words, at most 20 mentions, each a principal of the tenant **(default)**. A quote is at most 500 characters, the text before it at most 200                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TH-C | **Anchors are checked at the door, in `packages/domain`** (`anchorStands`, on `unitTexts`'s text, so phase 6 uses the same): a span's version is a version of the thread's own component and its block holds the quoted text; a cell's first block stands in the named table, never a bound table; a node is in the document's latest outline. One that does not is refused; a version of another component is not found                                                                                                                                                                                                                                                                                                                                                                                         |
| TH-D | **Orphaned is computed when listed**: in a document's list, against the version each occurrence resolves to (a pinned reference's pin); in a component's, against its latest. A component's threads appear in every document placing it. A join keeps the first block's identifier, so a span in the second block is orphaned by it, said so                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| TH-E | **Who is told**: a mention, the person named; a reply, every earlier commenter but its author; a resolution, the same - each only where they may read what the thread is on, decided at the act. **A mention of somebody who may not read is accepted and tells them nothing**; the answer names them to the author, whose composer says so. A mention added by an edit tells its person; one already there tells nobody again                                                                                                                                                                                                                                                                                                                                                                                   |
| TH-F | **Cadence** per kind: `at_once`, `daily` or `never` **(default: mentions and replies at once, resolutions daily)**. A daily event is held; the worker's tick folds, once per 07:00 UTC boundary, claiming the held events by deleting them (nobody holds update on them, so `FOR UPDATE` is refused; a second worker waits and finds them gone), what each person has held from before it into one digest of counts and identifiers, **readability decided again at the fold**. 07:00 UTC is not the reader's time: no time zone is stored for a person                                                                                                                                                                                                                                                          |
| TH-G | **Notifications are made in the transaction of the act**, as the audit event is; their details and the audit's are identifiers, never text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| TH-H | **Retention**: the worker's sweep deletes notifications older than 90 days **(default)**; a recipient deletes their own; anybody else is answered as if there were none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TH-I | **Review mode** is `review` in the mode switch and in presence, kept as the reader's choice, offered by `comment` or `suggest` on the document or any component it places (`mayComment` on the document view and on each occurrence), the text read-only, the threads panel beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TH-J | **A route on a thread** gains an access target, `{ thread }`, decided on what it is on; an unknown thread is not found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TH-K | **No reopening**: a resolved thread takes no reply and no edit (409), and is listed resolved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| TH-L | **Not live**: Review reads the threads when it opens and after each act of its own; the stream gains no thread event, and the inbox's count is read when the shell opens and the inbox does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TH-M | **The `comment` mark stays refused**, as ADR-0058 keeps `suggestion`: threads are never in the content (COL-019)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Task 1: Threads - TH1

- Migration 0076; `packages/db/src/threads.ts`: `startThread`, `addComment`, `editComment`,
  `resolveThread`, `listThreads` (document and component), `readThread` (with every text), anchor
  checks and orphan computation; routes `POST /v1/components/{id}/threads` and `/v1/documents/{id}/threads`, `GET /v1/threads/{id}`,
  `POST /v1/threads/{id}/comments`, `PUT /v1/threads/{id}/comments/{comment}`,
  `POST /v1/threads/{id}/resolution`, `GET /v1/documents/{id}/threads`, `GET /v1/components/{id}/threads`;
  audit `thread.started`, `comment.added`, `comment.edited`, `thread.resolved`; the `{ thread }` target;
  the access, cross-tenant, census and refusal entries; listings paged as `listing.ts` pages.
- Tests: **`COL-012`** each anchor kind, and one that does not hold refused. **`COL-013`**,
  **`COL-014`**, **`COL-051`** (every text kept and readable). **`COL-016`** a thread on a span holds
  after its block is edited elsewhere. **`COL-017`** orphaned when its text or block is gone, still
  listed. **`COL-018`** filtered by state, author and since. **`COL-049`** no delete. **`COL-054`**
  instants. A thread on a component the caller may not read is not found.

## Task 2: The inbox - TH2

- Notifications made in the act (TH-G) by preference (TH-F); `GET /v1/inbox`, `POST /v1/inbox/{id}/read`,
  `DELETE /v1/inbox/{id}`, `GET/PUT /v1/inbox/preferences`, each the caller's own alone; the worker's
  fold (its clock a parameter) and retention sweep.
- Tests: **`COL-015`** a mention told to a reader, refused for one who may not read. **`COL-063`**,
  **`COL-034`**, **`COL-035`** (a day's events one notification of counts). **`COL-036`**, **`COL-053`**
  no text in a notification or a digest. **`COL-062`** swept at 90 days, deleted by its recipient and
  nobody else, another tenant's never seen.

## Task 3: Review mode - TH3

- The mode switch's **Review**; the threads panel (filter, open, reply, edit with its history, resolve);
  marks in the text where each thread stands; start a thread on a selection, a card, a cell, a node.
- Tests: **`CNT-155`**, **`CNT-157`** (no editing surface), **`IAM-081`** (offered by `comment` or
  `suggest`, never otherwise). Axe in Light and Dark; the whole browser suite.

## Task 4: The inbox page; the close - TH4

- The inbox page from the account chip, unread count; preferences; `features.md`, `README.md`; the
  close (0.155.0).
- Tests: the inbox lists, opens a thread, marks read, deletes; preferences saved.

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format; TH3 and TH4 the whole browser
suite. The final review hunts a notification or a thread revealing what its reader may not read, a
thread lost or deletable, and an anchor that drifts silently.

## Final review

Fixed in TH4: anchors found by the drawn block's identifier, not its words (two blocks or two tables'
cells with the same words, an inline node drawing text the content does not); marks held by value, so
a selection survives; every page of threads read; the inbox a session's only; a notification on what
its reader may no longer read keeps only that it happened; a reply told where a mention was not;
the inbox marks read in place and tells a failed read from a gone thread. Known: editing a comment
whose mentions stand mid-text moves them to its end; `anchorStands` reads the quote alone, by TH's
first-occurrence rule.

## Risks

- **Quoted text twice in one block**: the anchor holds the text before it, so the first occurrence
  after that context is taken; otherwise the first, said so.
- **A join orphans a span in the second block** (ADR-0023 keeps the first block's identifier): listed
  orphaned with its text, never lost.
- **Not claimed here**: COL-038 to COL-040 (internal threads, T4), COL-064 (email, T7), COL-037
  (webhooks, T5).
