# AU2: The log read, sessions and the regression guard

> T3's first phase ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)):
> [audit.md](../design/audit.md)'s AU2, a person's own sessions, and publishing's recorded output.
> **Full tier**: two migrations, a job, new contracts, sessions (auth), so a pre-flight review and a
> final review; no per-task reviews. Ken asked for the run to proceed on 2026-10-11.

**Goal:** an environment administrator reads, filters and exports the tenant's audit log; anyone
sees their own sessions and ends any of them; a change to Typst, a face, a library or a template that
alters a recorded publication fails CI.

| PR   | Holds                                                                       |
| ---- | --------------------------------------------------------------------------- |
| AU2a | This plan; the designs' claims; the guard (Task 1)                          |
| AU2b | The log read: indexes, `GET /v1/audit`, Administration's Audit log (Task 2) |
| AU2c | Exports: the table, the job, the routes, Export on the page (Task 3)        |
| AU2d | Sessions (Task 4); the whole system, docs and the close, 0.151.0 (Task 5)   |

## Decisions

audit.md's AU-A to AU-I, and:

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AU-J | **The guard pins the corpus end to end** (the pre-flight review): the SHA-256 of every PDF and DOCX the regression corpus makes, `assemble` to Typst and `writeDocx`, by case and place, in `testing/recorded-outputs.json`. A recorded `data.json` was the first idea, but Word reads no `data.json`, and today's `assemble` cannot make an older schema's. So the guard holds `assemble`, the templates, Typst, the faces and every library, `sharp`'s images among them                                                                                                                                                                                                                 |
| AU-K | **A difference fails with the evidence**: the case named, the bytes made, and the output kept for comparison. Accepting a difference is a deliberate `pnpm --filter @alloy-works/worker record --accept`, in a PR that says why. A new case is recorded by `record`, which rewrites nothing                                                                                                                                                                                                                                                                                                                                                                                                |
| AU-L | **PUB-075 stays unclaimed until phase 3**: it asks for the recorded output of a fixed set of _baselines_, which VER-017 makes. The trace refuses a citation no design claims, so the test cites it in phase 3, when baselines join the set and publishing.md claims it; publishing.md names the gap until then                                                                                                                                                                                                                                                                                                                                                                             |
| AU-M | **A read pages over its first page's snapshot** (the pre-flight review; `listing.ts`'s LI-H): the cursor carries the last sequence and `pg_current_snapshot()`, and every page filters `pg_visible_in_snapshot(xact, snapshot)`. A walk returns exactly its first page's set, newest first. An xmin bound would skip a late commit newest first, and a long transaction anywhere would hide committed events. audit.md's Order is corrected. Filters: `actor`, `kind` (exact, or a `prefix.` as a range), `from`, `to`, `subject`, `space`; each event with its labels. Migration 0065 indexes `(kind, sequence)`, `(actor, sequence)`, `(subject, sequence)`, `(space, sequence)`, `(at)` |
| AU-N | **An export is complete as of its request's snapshot**: `audit_export` (migration 0066) keeps the filters, `pg_current_snapshot()` taken before its own event, and the newest sequence visible. The job writes every matching visible event in sequence order, as JSON Lines in the read route's shape. `export.produced` is the POST's act and `export.downloaded` is each link handed out, each citing LIF-028 and ADM-039 with `{ export }` detail. xid8 values do not survive a restore into another cluster, which is noted beside AU1's column                                                                                                                                       |
| AU-O | **Kinds read as words** in a web catalogue, every kind held by a test; a subject or actor in a row filters to it on click                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| SE-A | **Sessions are a person's own, by session only**: `GET /v1/sessions`, `DELETE /v1/sessions/{id}` and `DELETE /v1/sessions` (all but this one); a token is refused (`token_not_allowed`), as token management is                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SE-B | **A session is told apart by its route, when it began, when it was last active, and "This session"**: no user agent or address is stored (AU-F). Ending this one is signing out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SE-C | **Ending one deletes its row**, writes `authentication.signed_out` with `ended: 'ended_by_holder'`, and notifies `credential_ended`, so its stream and long acts stop as a revoked token's do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Spikes (AU2a, first)

- **R1.** Are the corpus's bytes the same on Windows and on CI's Linux? If not, the pins are Linux's
  and `record` runs there; back to Ken only if Linux differs from itself.
- **R2.** Does a library's version changed in `pnpm-lock.yaml` alone reach the worker suite? **Yes**:
  `turbo ls --affected` names the worker for `sharp` and every package for `fflate`; the close's full
  run catches the rest.

## Task 1: The guard (`apps/worker`) - AU2a

- `testing/recorded.ts` (`recordedOutputs`, `pinningEach`), `recorded-outputs.json`, `scripts/record.ts`;
  the corpus's Typst and Word writer pinned; case 4's two compiles one after the other.
- Tests (PUB-075 uncited until phase 3 claims it, AU-L): an output with its recorded bytes passes, and one that differs fails, naming
  its case and keeping it. Uncited: no pin fails saying how to record; `record` rewrites nothing;
  `accept` takes a difference; a retried case counts from one again.

## Task 2: The log read - AU2b

- Domain: `auditQuery` (the filters, `audit_filter_invalid`); db: migration 0065, `readAuditEvents`;
  contract `listAuditEvents`; service handler; web: Administration's **Audit log** under System - a
  table (when, who, what, subject, outcome), the filters, the kinds' words.
- Tests: **`ADM-038`** an administrator filters by actor, kind, prefix, dates and subject, newest
  first, labels present after the subject is gone. **`LIF-028`** a walk returns exactly its first
  page's set, none repeated, and an event committed late is in the next walk. **`LIF-031`** another tenant's events unreachable. A
  non-administrator and a token without `administer` refused. Axe clean in Light and Dark.

## Task 3: Exports - AU2c

- `audit_export` (0066), `audit_export` job kind and handler, `POST /v1/audit/exports`,
  `GET /v1/audit/exports/{id}`, the detail shapes of `export.produced` and `export.downloaded`, the
  census (routes and the job); Export on the page with its state and download.
- Tests: **`ADM-039`** an export holds every matching event, none of another tenant's, as of its
  request even as events are written during it. **`LIF-028`** an export of more events than a page
  holds them all. `export_not_ready`; each emitter's event (LIF-063).

## Task 4: Sessions - AU2d

- domain: `ended: 'ended_by_holder'` on `authentication.signed_out`; db: `listSessions` (unexpired,
  as `sessionHeld` reads them), `endSessionOf(principal, id)` locking the row and writing the event
  before the delete; contract and handlers (SE-A to SE-C); web:
  **Sessions** in the account menu beside API tokens, a modal mirroring `ApiTokens.tsx`; the design
  in service-foundations.md, claiming IAM-040.
- Tests: **`IAM-040`** a person sees their own sessions only and ends another, whose next request is
  refused and whose stream closes; End all others leaves this one. Another person's session id is
  `not_found`; a token refused; the event lands.

## Task 5: The whole system, docs and the close - AU2d

- e2e: an export downloaded; a session ended from a second sign-in. `features.md`, `README.md`,
  audit.md's build order; the close (fragments, 0.151.0, `architecture.md`, the baseline draft carrying
  0.150.0's rows).

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format. AU2b to AU2d the browser walks
(`--profile sources`). A final review hunts a cross-tenant read, a late commit skipped by a cursor or
an export, and a session ended by someone else.

## Risks

- **R1 fails both ways**: Linux differs from itself (an unpinned library). Back to Ken.
- **Accepting becomes routine**: each published schema moves every pin. The PR names each case
  changed; a change no case should show is a defect.
- **Large logs**: an export is built in memory in T3; streamed to the store when a tenant's log is
  large enough to need it.
