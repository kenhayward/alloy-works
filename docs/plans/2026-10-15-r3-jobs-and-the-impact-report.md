# R3: Jobs, and the impact report

> T4's third slice, extending [relationships.md](../design/relationships.md) and
> [service-foundations.md](../design/service-foundations.md). **Full tier**: migration 0103, a new
> contract every later job follows, a worker job. One PR with its close; one final review (Ken,
> 2026-10-14). Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** work that can outlive a request is submitted as a job: its identity at once, its state
pollable, cancellable with what it did and did not do, its failure in an error's shape, and inspectable
after; the first is the complete impact report, beyond the interactive limit (API-040 to API-043,
API-057, REL-032, REL-050).

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-A | **A tenant's own job record** (0103): `api_job (id, kind, subject_id, parameters, requested_by, requested_at, state, started_at, finished_at, progress, cancel_requested_at, failure, outcome, object_key, sha256, bytes)`. The platform queue stays the worker's, which a tenant cannot read; it carries the job by `subject_id`, as it carries an audit export. States: `accepted`, `running`, `succeeded`, `failed`, `cancelled` (API-041).                         |
| R3-B | **One contract, a submit route per kind.** A kind is submitted where its subject is (`POST /v1/artifacts/{id}/impact-reports { depth }`), answering the job at once, `accepted` (API-040). Then `GET /v1/jobs/{id}` for its state, when it started and how far it has got; `POST /v1/jobs/{id}/cancel`; `GET /v1/jobs/{id}/download` for a succeeded job's result, a short-lived link as an audit export's is. A job is its requester's: anybody else is answered 404. |
| R3-C | **Cancelling** (API-042): an accepted job is cancelled at once, having done nothing; a running one is asked to stop and does at its next step, and its outcome says how far it got and what it did not do; a finished one is refused, `job_finished`. A cancelled job keeps no partial result.                                                                                                                                                                         |
| R3-D | **Failing** (API-043): `failure` is `{ code, message, rule? }`, ErrorBody's members but the trace, with a fixed message per code; the job stays readable after.                                                                                                                                                                                                                                                                                                        |
| R3-E | **Retrying a submission** (API-057): the submit route takes an `Idempotency-Key`, as every permission-checked mutating route does: a retry answers the job the first made, starting no second.                                                                                                                                                                                                                                                                         |
| R3-F | **The impact report** (REL-032, REL-050): `impact` with no cap, as the requester, to the depth asked, a depth at a time. Each depth records progress (`{ done, of, unit: 'depth' }`) and checks for a cancel in its own transaction. The result is JSON Lines in the tenant's store, one artifact a line, nearest first, with whether the walk was cut. A retried attempt starts again.                                                                                |
| R3-G | **Through the API only** (default): the Used in dialog does not offer the report yet.                                                                                                                                                                                                                                                                                                                                                                                  |

## Task: R3

- 0103; `db`: `submitImpactReport`, `readJob`, `cancelJob`, the worker's `startJob`, `progressJob`, `finishJob`, `failJob`; `impact` gains no limit and a per-depth step. Worker `impact_report`. Contract, routes, documentation, census.
- Tests: submit and read; a retry with the key answering the same job; another person's job not found; cancel before it runs, while it runs (stopping at the next depth, saying how far), and after; a failure readable in an error's shape; the report beyond 1,000, permission-filtered, cut said; download. The final review hunts a result reaching somebody other than its requester, and a running job a cancel cannot stop. The close: 0.174.0.

## Built

R3 with its close (0.174.0) #636. The final review found a cancel at the last depth keeping an orphaned object and reporting a full walk, now keeping nothing; a requester who lost the subject still getting a report, now refused subject_unreadable; lists past the bind limit, now chunked; and a job going with its subject, which it no longer does. A long walk holds one transaction and its results in memory: fine for a report bounded by depth, to measure against REL-031 with the graph view.
