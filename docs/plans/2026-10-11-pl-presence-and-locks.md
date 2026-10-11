# PL: Presence and locks

> T3's second phase ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)):
> [realtime.md](../design/realtime.md)'s stream as designed, presence, a lock taken from an idle
> holder ([collaboration.md](../design/collaboration.md)), the event protocol beside OpenAPI, and the
> contents live. **Full tier**: migrations, a new contract, the stream's permissions, so a pre-flight
> review and a final review. Ken asked for the run to proceed on 2026-10-11; the decisions marked
> **(default)** are recommendations he may overturn.

**Goal:** a document shows who else is in it, where and doing what, and which components are held, by
whom and until when, as it happens, to each viewer only what they may read; an author takes a lock
from an idle holder after warning them; the contents update as another person changes the outline.

| PR  | Holds                                                                                               |
| --- | --------------------------------------------------------------------------------------------------- |
| PL1 | This plan and the designs; the stream scoped and filtered; lock events; the event protocol (Task 1) |
| PL2 | Presence: the row, its beat, staleness and redaction; the document view's people (Task 2)           |
| PL3 | Lock settings: both periods, release by the setting (Task 3)                                        |
| PL4 | Taking a lock (Task 4)                                                                              |
| PL5 | The contents live, and marked: held, broken, failed (Task 5); the whole system, docs and the close  |

## Decisions

realtime.md's and collaboration.md's, and:

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PL-A | **One route, scoped by a query**: `GET /v1/stream?document=` or `?component=`, a scope the viewer may not read answered `404`. The unscoped stream stays for the environment's own events and sends an allow-list of kinds, `sample` alone: never a lock, presence or outline (the pre-flight review)                                                                                                                                                                                                                                                                |
| PL-B | **Filtered by what the stream read when it opened**: the viewer's readable set and the scope's components; a lock outside it is not sent, presence in one is sent without component or mode (COL-003). **Every access change ends every stream of the tenant** with `permissions`, notified inside `access_changed()`, the one function every fact change already runs; and **every stream ends after five minutes** and reconnects, so a grant lapsing by the clock reaches it too. An `outline` event for the stream's document reads the scope's components again |
| PL-C | **Presence is a row a request writes** (`PUT /v1/presence`, its document and component readable by the caller): beaten every 20 seconds and on each change. **Each beat notifies, carrying `beatAt`**, and viewers age what they hold: live under 30 seconds, stale to 60, then absent (COL-055) **(default)**. The snapshot reads only rows beaten within 60 seconds; a stream closing deletes its viewer's row; the worker's sweep only tidies. An unlogged table                                                                                                  |
| PL-D | **Presence notifies per beat**, not batched: at a beat every 20 seconds a hundred viewers are five commits a second, against ADR-0018's ceiling of thousands. The batch is a change behind the same interface when the budget (API-036) says so                                                                                                                                                                                                                                                                                                                      |
| PL-E | **The event protocol is AsyncAPI 3.0** (API-015): `events.ts` declares each event in zod, `asyncapi.json` is generated by `z.toJSONSchema` as `openapi.json` is and drift-checked, and every event the service's tests receive is parsed against it. It says the stream takes a session alone (TK-D). **API-014 is not claimed**: it also names notifications and streamed model output, which do not exist                                                                                                                                                          |
| PL-F | **Lock periods are tenant settings** on `editing_policy` (COL-008, COL-046): released after 15 minutes without activity, takeable after 5 **(default)**; take shorter than release by a table `CHECK`; the runtime role granted update on both columns                                                                                                                                                                                                                                                                                                               |
| PL-G | **Taking warns, waits, then takes** (COL-009, COL-047), by collaboration.md's rules: activity is a claim or a saved iteration; an ask records the taker and a grace of 60 seconds **(default, declared)**; activity in the grace ends it; the asker's window asks again when it ends and, under `serialise`, takes only its own ask, past the grace, the holder idle since; a lock that lapses in the grace is simply claimed. The taker types nothing until it holds the lock                                                                                       |
| PL-H | **The holder is told, and keeps their work** (COL-045): their window hears `lock` with `taken`, or its next save is refused `lock_taken` naming the taker; it shows who has it, that their saved work is kept, and what it had not sent as text to copy. What they saved is theirs to recover when they hold the lock again, within the tenant's retention after the taker's cut: a gap collaboration.md names, beside an offline holder's unsent work                                                                                                               |
| PL-I | **Extensions notify only when the expected release, to the minute, changes**: an iteration every few seconds would otherwise be the busiest notifier                                                                                                                                                                                                                                                                                                                                                                                                                 |
| PL-J | **The contents hear `outline`** (STR-066): a document's version cut notifies its id, sent to whoever may read it; the panel reads the outline again once no act of its own is pending. **Its rows mark** a held component, a broken reference and a failed binding (STR-038), from a read of their own                                                                                                                                                                                                                                                               |

## Task 1: The stream scoped, locks on it, the protocol - PL1

- `realtime.ts`: events `lock`, `outline`, `presence`, `presence_left`, `permissions`; claims, releases,
  minute-changing extensions and cuts notify; `access_changed()` notifies `permissions`. `stream.ts`: a
  scope, checked at open; its snapshot (locks; presence from PL2); the filter; the unscoped allow-list;
  the five-minute end. `api-contract`: `events.ts`, `asyncapi.json`, its generator and drift check.
- Tests: **`COL-007`** a lock claimed, extended and released reaches every viewer of the document who may
  read the component, with holder and expected release, and none who may not; never the unscoped stream.
  **`API-016`** an access change ends the stream with `permissions`, and a stream ends at five minutes.
  **`API-015`** every event a stream sends parses against `asyncapi.json`, which matches what `events.ts`
  generates. A scope the viewer may not read is `404`.

## Task 2: Presence - PL2

- Migration (unlogged `presence`), `PUT /v1/presence`, the row deleted when its stream closes, the
  worker's tidying sweep, events with `beatAt`; the document view's people and each card's marker.
- Tests: **`COL-001`**, **`COL-002`** a viewer sees each person in the document, their component and
  mode. **`COL-003`** one in a component the viewer may not read is in the document alone. **`COL-004`**,
  **`COL-055`** a beat missed shows stale, then absent; a closed stream is absent at once. Axe in Light
  and Dark.

## Task 3: Lock settings - PL3

- Migration: `editing_policy`'s two periods, their grants and `CHECK`; `component_lock.active_at`,
  backfilled; `lockExpiry` from the setting; `/v1/settings/editing`; Administration's **Editing**.
- Tests: **`COL-008`** a lock without activity for the release period is free, the period an
  administrator sets. **`COL-046`** a take period not shorter than the release period refused.

## Task 4: Taking a lock - PL4

- `component_lock.taking_by`, `taking_until`; `POST .../lock/take` per collaboration.md's table;
  `lock_taken` refusing the holder's next save; `lock.taken`'s detail; the editor's **Take over**, its
  warning and countdown, the holder's taken state.
- Tests: **`COL-046`** taking refused before the take period. **`COL-047`** the holder warned at once,
  activity in the grace keeping the lock, never instant. **`COL-009`** taken after the grace, audited.
  **`COL-045`** the holder told, by event and by refusal, their work recoverable. **`COL-044`** two
  claims, one winner, the loser shown no editable surface and its typing kept (built in W11; cited now).

## Task 5: The contents live and marked; the close - PL5

- `outline` events reaching the document page, re-read when no act is pending; a read of each node's
  marks; the panel's markers. `features.md`, `README.md`, the close (0.152.0, the baseline carrying
  0.151.0's).
- Tests: **`STR-066`** another person's outline change reaches the panel without a reload, and waits for
  an act in flight. **`STR-038`** a held component, a broken reference and a failed binding each marked.

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format; PL2 to PL5 the browser walks
(`--profile sources`). A final review hunts a lock or presence leaked past a permission, a take that is
instant or silent, and an outline change shown to a viewer who may not read the document.

## Risks

- **COL-056 has no act to answer yet**: nothing deletes a component or moves one between spaces (T7,
  T9). A lock or presence whose component leaves the viewer's readable set degrades to absence through
  PL-B; the claim waits for the act.
- **Proxies buffering SSE** (realtime.md's open question): the client ages presence by `beatAt`, so a
  buffered stream shows as out of date, not as wrong.
- **Ending every stream on any access change** is coarse: a busy environment's streams reconnect often.
  Each reconnect is a snapshot read; narrowing it to the viewers affected is a change behind PL-B.

## Changed while building

| #    | PL1 to PL4                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PL-K | **The database says what changed**: triggers on `component_lock`, `artifact_version` and `presence`, and `access_changed()`, notify the tenant's channel, named after the trigger's own schema; no write path can forget, and a write by any role announces                                                                                                                                                                                                   |
| PL-L | **Leaving presence answers 404 when nothing of the caller's was there**, so another environment's window is never told apart from none (the cross-tenant sweep)                                                                                                                                                                                                                                                                                               |
| PL-M | **A take answers 200 with `taken`**, not 202: an ask and a take are the same request, told apart by its answer                                                                                                                                                                                                                                                                                                                                                |
| PL-N | **The holder hears an ask on the component's own stream**, which the editor follows while it is open, beside the document's                                                                                                                                                                                                                                                                                                                                   |
| PL-O | **The final review**: a take asks again after the service's `retryAfterMs`, re-armed on every answer; the button appears of itself; a stream the service ends keeps its window present, which beats again on each snapshot; presence ages by `ageMs`, not the reader's clock; presence is keyed by person and window (migration 0071); a lapsed ask is no ask; the outline's re-read keeps only the newest; settings change under `FOR UPDATE`; COL-044 cited |
