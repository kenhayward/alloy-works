# Realtime spike - brief and findings

> **Status: complete; decided in
> [ADR-0018](../decisions/0018-realtime-one-push-channel-postgres-fan-out.md).** A short spike, run
> before the decision, on the one risk the chosen shape carries.

## The question

Scope §10's last open decision was realtime transport: presence, locks, notifications and streaming
model output, and whether one channel serves all four (API-Q01). API-016 requires a realtime
connection to be authorised as a request is; API-017 requires delivery to be at-least-once with
de-duplication, or to say plainly that it is not; COL-003 requires presence to respect permissions,
and COL-004 requires it to degrade to absence rather than to a wrong answer.

The four differ in what matters. The truth about a lock and a notification is a row, and a lost
message about either is only wrong if the client never re-reads; presence is ephemeral, and losing
it is fine if it fades to absence; a model's output belongs to the one request that asked for it. So
the shape chosen before the spike was:

- **One server-push channel per session** - Server-Sent Events - carrying presence, lock changes and
  notification nudges, as ids, never content and never authority. Actions are ordinary requests: a
  lock is taken by a transaction.
- **Model output streamed on the request that asked for it**, not on the shared channel.
- **Fan-out between service instances by Postgres `LISTEN`/`NOTIFY`**, so an event commits in the
  same transaction as the change it describes.
- **Presence per component**, with the mode - read, review, author - rather than live cursors.

Its risk is the fan-out. `NOTIFY` serialises the commits that use it, there is one notification
queue per database, and ADR-0008 puts every tenant in one database.

## Set-up

PostgreSQL 18.6; two realtime instances in Node 22, each holding Server-Sent Events connections and
listening on Postgres; one load generator holding **5,000 viewers**, ten to each of 500 documents,
2,500 on each instance. The documents' 15,000 components are spread across ten spaces and each
viewer may read eight, so every instance must decide per viewer what each event may say.

Events are the product's mix - 80% presence moves, 15% lock changes, 5% notification nudges - each a
transaction that changes a row and notifies in the same commit. Each instance decides who may hear an
event from its own copy of which space a component is in, never from the event: a lock on a
component the viewer may not read is withheld, and a person working in one is reported only as
present in the document.

A viewer connecting is sent a snapshot of the locks and presence in its document, then events; the
instance holds the events until the snapshot is out, so an older snapshot can never overwrite a newer
event. The client applies events as state, so a repeat is harmless.

Every delivery was checked: the generator knew who should hear each event, and counted what was
missing, duplicated or delivered to somebody who should not have had it. After each phase, every
viewer's picture of locks and presence was compared with the database, as that viewer is allowed to
see it.

**Budget, provisional:** the other spikes' 250ms at p95, from the start of the transaction making a
change to its arrival at every viewer entitled to it.

## Results

### Delivery, stepped

| Asked   | Achieved | Deliveries | Missing | Duplicated | Leaked | p50 ms | p95 ms | p99 ms | Max ms |
| ------- | -------- | ---------- | ------- | ---------- | ------ | ------ | ------ | ------ | ------ |
| 100/s   | 98/s     | 18,161     | 0       | 0          | 0      | 1      | 2      | 19     | 53     |
| 300/s   | 291/s    | 54,066     | 0       | 0          | 0      | 1      | 2      | 5      | 327    |
| 1,000/s | 958/s    | 177,371    | 0       | 0          | 0      | 2      | 4      | 7      | 548    |
| 3,000/s | 2,897/s  | 535,755    | 0       | 0          | 0      | 5      | 9      | 41     | 404    |

The filter was exercised, not merely present: one instance alone withheld or redacted 90,227
deliveries over the run. No connection ever fell behind its writes.

### One instance crashes

With events flowing at 300 a second, one instance was killed; it restarted, cleared the presence its
previous life had left behind, and its 2,500 viewers reconnected with jitter, as `EventSource` does.

| Viewers on the crashed instance | Resynced | p50  | p95  | Slowest |
| ------------------------------- | -------- | ---- | ---- | ------- |
| 2,500                           | 2,500    | 1.8s | 2.6s | 3.4s    |

The times run from the crash, and most of them is the restart and the client's own wait of half a
second to two and a half before retrying. Afterwards **every viewer's picture matched the database**,
locks and presence both, and none had seen a duplicate or anything it should not.

### What notifying costs everything else

Ordinary inserts from 16 clients, which never notify, while the producer notified at each rate:

| Notifying at             | Ordinary writes a second | Change |
| ------------------------ | ------------------------ | ------ |
| Nothing                  | 21,587                   |        |
| 300/s                    | 21,040                   | -2.5%  |
| 1,000/s                  | 20,491                   | -5.1%  |
| 3,000/s asked, 1,498 met | 19,517                   | -9.6%  |

**And the ceiling is `NOTIFY` itself.** The same transactions - a lock change or an inbox insert -
committed about **15,000 a second without notifying and about 2,475 with it**, each measured twice.
A notifying commit holds the queue's lock through the commit itself, so notifying commits take turns,
and how fast each can go is set by how fast the disk confirms a commit. The load run reached 2,897 a
second only because most of its events were presence changes to an unlogged table, whose commits
wait for no disk.

That ceiling is per database, so it is shared by every tenant in it.

## Findings

**The shape holds, given three rules** - now in [`docs/design/realtime.md`](../design/realtime.md):

1. **Presence is batched; locks and nudges are not.** Presence is most of the traffic and needs no
   atomicity with anything, so each instance gathers the presence changes it receives and notifies
   them together a few times a second, in one commit. A lock change or a notification notifies in its
   own transaction, because an event must never be sent for a change that did not commit.
2. **State, not events.** Every connect and reconnect starts with a snapshot, events are held until it
   is out, and the client applies events as state. Nothing is replayed, so no event log is kept; a
   missed event cannot leave a screen wrong once the connection is back. That is what API-017 asks to
   be stated plainly: individual events are not guaranteed, the picture is.
3. **The instance decides who hears what**, from its own data, per viewer, and the event carries ids
   only. A lock on something the viewer may not read is withheld; a person working in it becomes
   "present in this document".

A rough sense of the headroom, on invented rates of a presence change every twenty seconds, a lock
change every two minutes and a notification every five minutes per person: 5,000 people at once is
about 300 events a second. Unbatched, the measured ceiling is reached at around 40,000 people at once
per database. With presence batched, the notifying commits left are the locks and nudges, about a
fifth of the events, and the same ceiling is reached at around 200,000.

## What is a proxy

| Claim                            | How it was established                                     | What would verify it                             |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Latencies                        | One machine, Docker Desktop, no network between the parts  | Production, across a network and a load balancer |
| The ceiling                      | Docker Desktop's disk; the ceiling moves with commit speed | The production database class                    |
| Real clients                     | A Node load generator speaking the protocol, not browsers  | Browsers' `EventSource`, behind real proxies     |
| People's event rates             | Invented                                                   | Observed behaviour once collaboration exists     |
| Batching presence closes the gap | Reasoned from the ceiling, not built                       | The load run repeated with presence batched      |
| Model output streaming           | Not measured; it rides the ordinary request path           | The generation work, when it is built            |

Two known limits were not tested because they are properties of the protocols, not of this design:
browsers allow six HTTP/1.1 connections per site, so a seventh tab's stream would wait - production
serves the channel over HTTP/2 - and some corporate proxies buffer `text/event-stream`, which would
delay events without losing them.

## Where the code is

`spikes/realtime/`: `schema.sql`, `rt.mjs` (one instance), `load.mjs` (viewers, producer and checks),
`interference.sh`, and a `Dockerfile` with Node and the Postgres driver. Throwaway, Docker-only,
outside CI.
