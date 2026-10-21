# WB: Webhooks

> T5's webhooks ([webhooks.md](../design/webhooks.md); GN-D). **Full tier**: new tables and a trigger
> on the audit log, a connector route and key, a worker loop, outbound requests to tenant-named hosts.
> Ken's answers of 2026-10-21 are marked **(Ken)**; the rest **(default)**. The pre-flight review's
> findings are folded in.

**Goal:** an administrator subscribes a service identity's HTTPS endpoint to event types; every
committed event of those types about what the identity may read is delivered, signed, at least once,
thin, retried for a day, the endpoint disabled after three days failing, every attempt readable
(API-028, API-029, API-046, API-060, COL-037, LIF-071).

| PR  | Holds                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| WBa | This plan and the design; 0139 (subscriptions, deliveries, attempts, the queueing triggers, kinds); `/v1/webhooks`; sealing       |
| WBb | The worker's delivery loop; the connector's `/v1/deliver`, its key and exchange; retries and disabling                            |
| WBc | Deliveries read (API-029); the notification of a disabling; Administration's Webhooks; e2e; the final review; the close (0.202.0) |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WB-A | **Thin payloads** (Ken; API-046): `{ type, id, sequence, at, subject, detail }`, the audit event's detail, never content; `id` a uuid kept across retries.                                                                                                                                                                                                                                               |
| WB-B | **The service identity's view** (Ken): a subscription names one; each attempt asks `readableOf` first, dropping what it may not read, recorded and never sent. Its identity disabled disables it.                                                                                                                                                                                                        |
| WB-C | **No ordering, each event sequenced** (Ken; API-046): `sequence` is `audit:<n>` or `notification:<n>`, with the artifact's version.                                                                                                                                                                                                                                                                      |
| WB-D | **Queued by trigger** (the pre-flight review): after insert on `audit_event` (its kind in the closed list, in domain and held to the trigger's by a test) and on `notification` (addressed to a subscription's identity), a `webhook_delivery` row per enabled subscription wanting it, in the act's transaction. No frontier.                                                                           |
| WB-E | **Retries** (Ken; API-028): from 30 s, doubling to an hour, for 24 hours from the first attempt, then `given_up`. Disabled by the system when its first failure since its last success, or since it was made, is three days old and nothing has succeeded since; `webhook.changed` recorded and the administrator who made it told (WBc; notification kind `webhook`, in a savepoint as `alertSpend`'s). |
| WB-F | **Through the connector** (ADR-0064): `POST /v1/deliver`, `CONNECTOR_DELIVER_KEY` opening it alone; a delivery exchange keeping the real status, refusing redirects, reading 2 KiB of reply, 10 s; public hosts only (RFC 1918, CGNAT, ULA refused besides the guard's); four at once beside queries' runs, `busy` no attempt. The worker never holds a secret.                                          |
| WB-G | **Signing** (default): Standard Webhooks, HMAC-SHA256, `whsec_` and 32 random bytes, shown once, sealed by the connector as `webhook-signing` bound to the subscription's id and URL, so a changed URL needs a new secret; rotation keeps the old sealed beside it 24 hours, both signing.                                                                                                               |
| WB-H | **Administered** (API-055): `/v1/webhooks` list, make, change, rotate, remove, `administer` at the tenant with a session; HTTPS URLs only; each change `webhook.changed`. The configuration export is T7's: API-055 is not claimed.                                                                                                                                                                      |
| WB-I | **The delivery loop** (the pre-flight review): its own interval of 5 s in the worker, apart from the 10-minute sweeps; due rows claimed `for update skip locked` with a lease; sent outside any transaction. Deliveries and attempts kept 30 days, swept.                                                                                                                                                |
| WB-J | **Read** (API-029): `GET /v1/webhooks/{id}/deliveries` and `/{delivery}`, the payload and every attempt.                                                                                                                                                                                                                                                                                                 |

## Tasks

- **WBa**: 0139; domain's event list; db `webhooks.ts`; contract and routes; the connector's `/v1/webhook/seal` and `SealPurpose`; census, `grants.test.ts`, `every-kind.ts`. Tests: LIF-071 each change recorded; a URL not HTTPS refused; the secret answered once; the trigger queues a committed act once, a rolled-back one never, and nothing with no subscription.
- **WBb**: db claim and attempts; the worker's loop; connector `/v1/deliver`, its key, exchange and guard; compose, `worker.env.example`, the connector-boundary pin; the fake API's `/hooks` receiver. Tests: API-046 events from transactions committed out of order each delivered; WB-B a grant removed drops a waiting delivery; API-028 backoff, given up, disabled and told; the signature verifiable; a private address refused; the embed key refused at `/v1/deliver`.
- **WBc**: deliveries routes; the `webhook` notification to whoever made it; Administration's Webhooks; an e2e delivery to `source-http`'s `/hooks` (`CONNECTOR_WEBHOOK_PRIVATE=allow`); the final review; the close.

## Risks

- **A trigger in every audited act**: one indexed select of enabled subscriptions per event, and a row per match; none without subscriptions.
- **A slow receiver** holds a connector child for 10 s; four at once, a pass at most 50.
- **Tenants with private receivers** cannot use webhooks yet, named in the design.
