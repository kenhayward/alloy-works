# 0018 - Realtime: one push channel, fanned out through Postgres

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10's last open decision was realtime
transport: presence, locks, notifications and streaming model output, and whether one channel serves
all four (API-Q01). Scope §9 decision 4 chose soft component locks and presence over real-time
co-editing; decision 2 made the web service the system of record, with the desktop app loading the
same renderer ([ADR-0003](0003-one-renderer-two-deliveries.md)). API-016 requires a realtime
connection to be authorised as a request is, API-017 requires delivery to be at-least-once or to say
plainly that it is not, and COL-003 and COL-004 require presence to respect permissions and to fade to
absence rather than to a wrong answer.

The four surfaces are not one problem. The truth about a lock or a notification is a row, so a lost
message is only wrong if nothing re-reads it; presence is ephemeral; a model's output belongs to the
request that asked for it. What they share is the need to tell a screen that something changed.

The alternatives were one WebSocket per session carrying all four, and a WebSocket for collaboration
beside streamed requests for model output. Both give bidirectional traffic nothing here needs, since
every action is an ordinary request; both put model output on a socket, where it needs its own
framing and cancellation; and WebSockets remain the thing corporate proxies in this market are likeliest
to break. For fan-out between instances, a broker such as Redis or NATS scales further, at the price
of another service to run and isolate per tenant, and of events that are no longer atomic with the
change they describe.

[`Realtime_Spike_Findings.md`](../specification/Realtime_Spike_Findings.md) measured the chosen
shape's risk - `NOTIFY`, which serialises the commits that use it, with one queue per database and
every tenant in one database (ADR-0008). With 5,000 viewers on two instances, it found:

- Every delivery arrived, once, to exactly the viewers entitled to it, at up to 2,897 events a second:
  p95 of 9ms, p99 of 41ms. Nothing leaked across a permission boundary.
- When an instance crashed, all 2,500 of its viewers resynced within 3.4s, and every viewer's picture
  of locks and presence matched the database afterwards.
- Notifying at 1,000 events a second slowed ordinary writes by 5%.
- **`NOTIFY` is the ceiling**: the same transactions committed about 15,000 a second without it and
  about 2,475 with it, because notifying commits take turns through the commit itself.

## Decision

**A session's realtime is one Server-Sent Events stream, fanned out between instances by Postgres
`LISTEN`/`NOTIFY`, carrying ids and never content or authority. Clients converge on state from a
snapshot, not by replaying events. Model output streams on the request that asked for it.**

- **One stream per session**, served over HTTP/2, carrying presence, lock changes and notification
  nudges. It is plain HTTP, authenticated as a request is (API-016).
- **Actions are requests.** Taking a lock is a transaction that updates its row and notifies in the
  same commit, so no event is sent for a change that did not happen, and none is missed for one that
  did. The stream decides nothing.
- **Events carry ids only.** The instance holding a connection decides what each viewer may hear from
  its own data, never from the event: a lock on something the viewer may not read is withheld, and a
  person working in it becomes "present in this document" (COL-003).
- **State, not events.** Every connect and reconnect begins with a snapshot of the viewer's document;
  events are held until it is out, and applied as state. Nothing is replayed and no event log is kept.
  This is API-017's plain statement: individual events are not guaranteed, the picture is. The inbox
  is the durable record of a notification; the event is a nudge to look.
- **Presence is per component**, with the mode, and lasts as long as the connection. An instance that
  dies has its viewers' presence swept by the others.
- **Presence is batched; locks and nudges are not.** Each instance notifies the presence changes it
  receives together, a few times a second, in one commit, because presence is most of the traffic and
  needs no atomicity with anything.
- **Model output streams as the response to the request that asked for it**, and closing that request
  cancels the generation. Work too long to wait for runs in the background and ends with a nudge.
- **Both ends sit behind one interface** - one realtime client in the renderer, one publish and
  subscribe interface in the service - so a broker can replace `NOTIFY` without any caller changing.

## What would change the answer

- **Notifying commits approaching the ceiling.** When sustained notifying commits in a database pass
  about 1,000 a second, two fifths of the ceiling measured, a broker goes behind the same interface -
  or the busiest tenants move to their own database, which ADR-0008 already makes mechanical.
- **Networks that hold back Server-Sent Events.** Some corporate proxies buffer `text/event-stream`,
  delaying events without losing them. If customers' networks do, the stream gains a WebSocket
  fallback behind the same client.
- **A need for live cursors.** Presence per component is a product decision as much as a technical
  one; cursor-level presence implies the co-editing scope §9 decision 4 ruled out, and would need its
  own design.

## Consequences

- API-Q01 is settled, and scope §10 has no open decisions left.
- **Three requirements follow**: API-035 (a realtime client converges on current state from a
  snapshot on every connect), API-036 (the delivery budget, provisionally p95 of 250ms) and COL-N05
  (no live cursors).
- The design is [`docs/design/realtime.md`](../design/realtime.md). It owns presence, the realtime
  side of locks, and delivery of notifications; lock rules that are not about transport stay with
  collaboration.
- `NOTIFY` fails a transaction if its queue fills, which happens if a listening session stalls inside
  a transaction. The listening connection does nothing else, and queue usage is monitored like any
  other capacity.
- The realtime protocol is specified beside the OpenAPI document, as API-014 and API-015 require.
