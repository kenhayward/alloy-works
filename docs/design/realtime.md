# Realtime

How a screen learns that something changed - who else is here, which components are locked, that a
notification arrived - and how a model's output reaches the person who asked for it.

This realises the realtime requirements of [COL](../specification/requirements/COL-collaboration-and-review.md)
and [API](../specification/requirements/API-api-mcp-and-extensibility.md), under
[ADR-0018](../decisions/0018-realtime-one-push-channel-postgres-fan-out.md), which rests on
[`Realtime_Spike_Findings.md`](../specification/Realtime_Spike_Findings.md). Everything below is
per tenant (ADR-0008) and runs in the web service; the desktop app loads the same renderer
(ADR-0003) and so uses the same stream.

## The shape in one paragraph

Each open document holds one Server-Sent Events stream to the service. The stream only ever says
that something changed, by id; it carries no content and decides nothing. Anything a person does -
taking a lock, moving to another component, reading a notification - is an ordinary request, and the
transaction that records it also notifies Postgres, so the event and the change commit together.
Every service instance listens, and each decides for every viewer it holds what that viewer may hear.
A connection starts with a snapshot of the current state and applies events on top of it, so a
reconnect is just a connect and a missed event cannot leave a screen wrong. Model output does not use
the stream at all: it is the streamed response to the request that asked for it.

## Requirements owned

| ID          | How it is met                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **API-016** | The stream is opened by an authenticated request; a permission change ends it, and the reconnect is authorised afresh                   |
| **API-017** | Stated plainly: individual events are not guaranteed and are not replayed; the picture is, because every connect begins with a snapshot |
| **API-035** | The snapshot on connect, events held until it is sent, and events applied as state                                                      |
| **API-036** | Measured by the conformance suite with the spike's harness: every delivery, to every entitled viewer, at stepped rates                  |
| **COL-001** | Presence names each person in the document and the component they are in                                                                |
| **COL-002** | Presence carries the mode - read, review or author - from the document view (CNT-104)                                                   |
| **COL-003** | A person in a component the viewer may not read is reported only as present in the document, component and mode removed                 |
| **COL-004** | Presence lasts as long as the connection; an instance that stops beating has its viewers' presence swept within fifteen seconds         |
| **COL-007** | Lock events and the snapshot carry the holder and the expected release, wherever the component is shown                                 |

Lock rules that are not about transport - who may take a lock, from whom, and how long it lasts
(COL-005, COL-008 to COL-011) - belong to collaboration's design, which reads and writes the same row.

## The stream

`GET /realtime/documents/{id}` opens the stream for one document, authenticated as any request is.
It is served over **HTTP/2**, which matters: browsers allow six HTTP/1.1 connections per site, so a
seventh tab's stream would wait, while HTTP/2 carries every tab's stream on one connection. The
server sends `retry` so the browser's `EventSource` reconnects on its own, and each client adds a
random wait before reconnecting so that a crowd whose instance restarted does not return all at once.

| Event            | Says                                                                    | Sent to                                             |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `snapshot`       | The locks and presence in the document now                              | The viewer who connected                            |
| `presence`       | Person, component, mode                                                 | Everyone in the document; redacted as COL-003 says  |
| `presence-leave` | Person                                                                  | Everyone in the document                            |
| `lock`           | Component, holder or none, expected release                             | Everyone in the document who may read the component |
| `inbox`          | That a notification is waiting                                          | Its recipient                                       |
| `permissions`    | That this viewer's permissions changed; the server then ends the stream | The viewer concerned                                |

**Events carry ids, never content**, and a nudge says only that something is waiting, so nothing
readable travels on the stream that the viewer could not fetch anyway. What a notification says is
the inbox's business, and COL-036 governs it there.

## State, not events

A connection is registered before its snapshot is read, so nothing that commits afterwards is
missed, and **its events are held until the snapshot has been sent**. Without that hold, an event
committed just after the snapshot's read could reach the viewer first and then be overwritten by the
older snapshot - the spike met this before it ran. The client applies each event as state - a lock is
held by this person, this person is in that component - so an event the snapshot already reflects,
or a repeat, changes nothing.

So nothing is replayed, and there is no event log to keep, size or expire. A viewer whose connection
drops sees nothing new until it is back; when it is, the snapshot is the truth. This is the plain
statement API-017 asks for, and API-035 makes it binding. Notifications are the one thing a person
must not miss, and they do not depend on the stream: the inbox row is the record, and the event only
says to look.

## Who hears what

The instance holding a connection knows the viewer's permission set, computed when the stream opened,
and keeps its own copy of which space each component is in. It decides from those, never from the
event:

- A **lock** on a component the viewer may not read is not sent.
- A person working in such a component is sent as **present in the document**, with the component
  and mode removed. Dropping the event instead would leave the viewer's screen showing the person where
  they were before - the wrong answer COL-004 forbids.
- A **permission change** sends `permissions` to the viewers it affects and ends their streams, so the
  reconnect is authorised afresh against the new permissions (API-016).

## Fan-out

Every instance holds one Postgres connection that does nothing but `LISTEN`, on a channel per tenant
it has viewers for. A change is recorded and notified in one transaction, so an event exists only for
a change that committed. The payload names the tenant, the kind and the ids, well under the 8,000
bytes `NOTIFY` allows.

**Notifying commits take turns**, and in the spike that capped them at about 2,475 a second per
database, shared by every tenant in it. So the two kinds of traffic are treated differently:

| Traffic              | How it notifies                                                                      | Why                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Locks, notifications | In the transaction that changes the row                                              | An event must never describe a change that did not commit                             |
| Presence             | Each instance gathers the changes it receives and notifies them together every 250ms | Most of the traffic, needing no atomicity with anything; batching removes its commits |

Presence rows sit in an unlogged table - fast to write, gone after a crash, which is what presence
should do anyway - each naming the instance holding the viewer's connection. Instances record a
heartbeat every five seconds; any instance that finds another fifteen seconds silent deletes that
instance's presence and notifies everyone that those people have left.

Behind both ends is one interface: publish and subscribe in the service, one realtime client in the
renderer. When sustained notifying commits approach the level ADR-0018 names, a broker replaces
`NOTIFY` behind it, or the busiest tenants move to their own database.

## Locks on the stream

A lock is a row. Taking one is a request whose transaction updates the row where it is free, and
notifies; releasing it, letting it expire and taking it from an idle holder are the same. The
expected release shown to others (COL-007) is the row's expiry, which the holder's editing activity
extends. The stream tells screens; it never grants anything, and a client that believes it holds a
lock it does not will find out from the request that tries to save.

## Model output

A request for generation is answered with a stream: `POST` to the generation endpoint, and the
response is `text/event-stream`, carrying the output as it is produced. Closing the request cancels
the generation, so a person who navigates away stops paying for words nobody will read. Work too
long to wait for - a batch of suggestions across a document - runs in the background and ends with a
notification.

Keeping model output off the shared stream means its volume never competes with presence and locks,
its failure affects only the request that asked, and cancelling it is closing a request rather than a
message on a channel.

## When something fails

| What fails                      | What the viewer sees                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Their connection                | Presence and lock indicators marked out of date, then refreshed by the snapshot when it reconnects    |
| The instance holding it         | The same; its viewers reconnect to another, and their presence is swept within fifteen seconds        |
| The database                    | The stream ends and the document says live information is unavailable; nothing pretends to be current |
| The listening connection stalls | `NOTIFY` fails once its queue fills, so the listener does nothing else and queue use is monitored     |

## Verification

- **Delivery**, as the spike measured it: every event counted to every viewer entitled to it, at
  stepped rates, with anything missing, repeated or delivered past a permission boundary a failure.
- **Convergence**: after an instance is killed under load, every viewer's picture of locks and presence
  is compared with the database, as that viewer may see it.
- **The leak suite**: viewers without permission to a component receive nothing about its lock and no
  component or mode for anybody in it.
- **The budget** (API-036): the same harness against the production database class.

## Open questions

| ID  | Question                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | Whether customers' networks pass Server-Sent Events promptly. Some proxies buffer `text/event-stream`; if customers' do, the client needs a WebSocket fallback |
| New | The batching interval for presence. A quarter of a second is a guess that trades freshness against commits, and has not been measured                          |
| New | How presence shows a guest. IAM-045 requires an external principal to be marked everywhere, which the presence event will need to carry                        |
