# Webhooks

How an environment tells a receiver outside it that something happened: content cut, workflow moved,
review and publication, notifications. GN-D gave webhooks a design of their own; Ken's answers of
2026-10-21 shaped it. Built by [the WB plan](../plans/2026-10-21-wb-webhooks.md).

## The shape in one paragraph

A **subscription** belongs to a service identity (IAM-033): a public HTTPS URL, the event types it
wants, and a signing secret the connector seals. A **trigger** on the audit log and the notification
table queues, in the act's own transaction, a **delivery** for every enabled subscription wanting that
type: a thin payload of identifiers and versions, never content. The worker's delivery loop sends each
through the **connector** (ADR-0064), signed as Standard Webhooks specifies, and only while the
subscription's service identity may read the artifact. A failure is retried with backoff for a day,
then given up; an endpoint failing for three days with no success is disabled and the administrator who
made it told. Every attempt, what was sent and what came back, is kept 30 days for an administrator to read.

## Requirements owned

| ID          | How it is met                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-028** | Backoff from 30 seconds, doubling to an hour, for 24 hours; failing three days since the first failure with no success, disabled and the administrator who made it told |
| **API-029** | `GET /v1/webhooks/{id}/deliveries`: each delivery's payload and every attempt's status, latency, failure code and reply excerpt                                         |
| **API-046** | No ordering is promised; each payload carries its source's sequence and the artifact's version, so a receiver orders what it needs                                      |
| **API-060** | Content, workflow, review, publication and notification events, by their audit kind's name (Event types)                                                                |
| **COL-037** | A notification addressed to the subscription's service identity is `notification.created`; a service is told only as a person is, by a mention or a reply               |
| **LIF-071** | `webhook.changed`, for every make, change, rotation, removal and disabling, completing LIF-071 beside `tool.used` and the run's kinds                                   |

| Left unclaimed | Why                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------- |
| API-055        | Administered and audited as it asks, but the configuration export (ADM-005) is T7's and not built |
| ADM-048        | A delivery is counted, not costed: nothing prices it yet                                          |

## Event types

The audit kind's name is the event type, so a receiver reads the same words as the audit log. The
list is closed, in domain, each held by a test to an audit kind.

| Types                                                                                  | Subject                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `content.version_cut`, `content.restored`, `artifact.archived`, `artifact.unarchived`  | The artifact and its version                             |
| `workflow.transitioned`, `approval.given`, `gate.rejected`, `revision.effective`       | The artifact and its version                             |
| `round.opened`, `round.closed`, `review.completed`, `review.reopened`, `review.lapsed` | The document and its version                             |
| `publication.requested`, `publication.produced`, `publication.failed`                  | The document and its version                             |
| `notification.created`                                                                 | The notification, and its artifact where it names one    |
| `bridge.delivered`, `bridge.refused`                                                   | CT Studio's delivery: the document it made, or the space |

Deletion is not an event a receiver can be told of: a deleted artifact is read by nobody. A payload:
`{ type, id, sequence, at, subject: { kind, id, version }, detail }`, `detail` the audit event's own
(identifiers and codes, never values, LIF-030; a principal's id among them, as the API answers it to a
reader). `id` is stable across retries; a receiver deduplicates by it, since delivery is at least once.

## Queued in the act's transaction

A trigger after insert on `audit_event` and `notification` inserts a delivery for each enabled
subscription wanting the type, in the same transaction, so a rolled-back act queues nothing and a
committed one queues it once, whatever order transactions commit in. No subscription, no row. A
notification is queued only for a subscription whose service identity it is addressed to.

## Who may receive what

The subscription's service identity decides (Ken): each attempt first asks `readableOf` whether it may
read the artifact; if not, the delivery is dropped, recorded as such, never sent. A notification
naming no artifact is the identity's own and is sent. A disabled service identity disables its
subscriptions.

## Delivery

- **A loop of its own** in the worker, every 5 seconds: due deliveries claimed with `skip locked` and a
  lease, at most 50 a pass, each sent outside any transaction, its attempt recorded after.
- **Through the connector** (ADR-0064): `POST /v1/deliver`, opened by a key of its own, with the
  subscription's sealed secret (sealed to its id and URL), the URL and the body; the child signs and
  sends. **Public hosts only**: private, CGNAT and unique-local addresses are refused as well as what the
  guard already refuses, since the reply is shown. At most four deliveries at once, apart from queries'
  runs; busy is no attempt.
- **Its own exchange**: the real status kept, a redirect refused, at most 2 KiB of the reply read;
  10 seconds in all.
- **Signed** as Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`
  `v1,<base64 HMAC-SHA256 of id.timestamp.body>`. A rotated secret signs beside the new for 24 hours.
- **A 2xx is delivered**; anything else is a failed attempt.

## Failing, and on again

An attempt is recorded only under the lease that claimed it, so a worker whose lease was claimed past
records nothing, and a delivery done is never sent again. The backoff stops at an hour. A day with no
attempt at all restarts the three-day count: a quiet endpoint is not a failing one. Disabling gives up
what waits for it; `PATCH /v1/webhooks/{id}` with `enabled` turns it on again, its count afresh,
where its service identity may act. A type no longer wanted is not sent, though it was waiting. A
reply's control characters are never kept.

## Ruled out

- **Content in the payload** (Ken): it would leave the boundary on every event, filtered at send time.
- **Ordered delivery per artifact** (Ken): one failing receiver would hold its later events back.
- **Tailing the audit log by transaction**: correct, but a long transaction anywhere in the cluster would
  hold back every tenant's events (the WB pre-flight review).
- **Private receivers**: the reply excerpt would read an internal service. A tenant's own network waits
  for a receiver it declares, as a connection is.
