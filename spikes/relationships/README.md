# Relationship storage spike - harness

> **Throwaway.** This is the harness behind
> [`Relationship_Spike_Findings.md`](../../docs/specification/Relationship_Spike_Findings.md), which
> [ADR-0017](../../docs/decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md) rests
> on. It is scaffolding to reach a decision; the traversal will be written for the product's own
> schema, and the conformance suite that measures its budget (REL-031) with it.

Not part of the pnpm workspace, not run by CI. It needs Docker and under 1GB of disk.

## What is here

| File           | Does                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `load.sql`     | Builds a synthetic tenant: a million components, 50,000 documents and 5,000 publications, 3.5 million edges, in seconds                        |
| `traverse.sql` | Two PL/pgSQL functions: impact by frontier, and a bidirectional shortest path                                                                  |
| `bench.py`     | Measures neighbours, impact three ways, capped and hard-only impact, and shortest paths for three users, and checks every answer against scipy |

## Running it

```bash
docker network create rel-spike
docker run -d --name rel-pg --network rel-spike -e POSTGRES_PASSWORD=spike --shm-size=2g postgres:18 -c shared_buffers=2GB -c work_mem=64MB -c maintenance_work_mem=2GB -c max_parallel_workers_per_gather=4 -c effective_cache_size=6GB
docker exec -i rel-pg psql -U postgres < load.sql
docker exec -i rel-pg psql -U postgres < traverse.sql
docker run --rm --network rel-spike -v "$PWD:/spike" python:3.13-slim sh -c "pip install -q 'psycopg[binary]' numpy scipy && python /spike/bench.py"
```

The bench takes about fifteen minutes, most of it waiting for the every-path query to time out. It
writes `report.json` beside itself, which is not committed: the findings carry the numbers.
