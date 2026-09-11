# Realtime spike - harness

> **Throwaway.** This is the harness behind
> [`Realtime_Spike_Findings.md`](../../docs/specification/Realtime_Spike_Findings.md), which
> [ADR-0018](../../docs/decisions/0018-realtime-one-push-channel-postgres-fan-out.md) rests on. It is
> scaffolding to reach a decision; the realtime service will be written in the product, and the
> conformance suite that measures its budget (API-036) with it.

Not part of the pnpm workspace, not run by CI. It needs Docker.

## What is here

| File              | Does                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `schema.sql`      | Components in spaces and documents, lock rows, unlogged presence, the inbox, and a table for ordinary writes |
| `rt.mjs`          | One realtime instance: Server-Sent Events, Postgres `LISTEN`, a snapshot on connect, filtering per viewer    |
| `load.mjs`        | 5,000 viewers, a producer at stepped rates, a crash and reconnect, and a check of every delivery             |
| `interference.sh` | What notifying costs ordinary writes, and the ceiling on notifying commits                                   |
| `busy.sql`        | The ordinary write pgbench repeats                                                                           |
| `Dockerfile`      | Node 22 with the Postgres driver, for the instances and the load                                             |

## Running it

```bash
docker build -t alloy-rt-spike .
docker network create rt-spike
docker run -d --name rt-pg --network rt-spike -e POSTGRES_PASSWORD=spike -v "$PWD:/spike" postgres:18 -c shared_buffers=1GB -c max_connections=200
docker exec -i rt-pg psql -U postgres < schema.sql
docker run -d --restart always --name rt1 --network rt-spike -e INSTANCE=rt1 -v "$PWD:/app/spike" alloy-rt-spike node /app/spike/rt.mjs
docker run -d --restart always --name rt2 --network rt-spike -e INSTANCE=rt2 -v "$PWD:/app/spike" alloy-rt-spike node /app/spike/rt.mjs
docker run --rm --network rt-spike -v "$PWD:/app/spike" alloy-rt-spike node /app/spike/load.mjs steps
bash interference.sh
```

The steps take about two and a half minutes and write `report.json`, which is not committed: the
findings carry the numbers. `NO_NOTIFY=1` on the producer runs the same transactions without
notifying, which is how the ceiling was shown to be `NOTIFY`'s.
