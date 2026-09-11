# Search spike - harness

> **Throwaway.** This is the harness behind
> [`Search_Spike_Findings.md`](../../docs/specification/Search_Spike_Findings.md), which
> [ADR-0016](../../docs/decisions/0016-search-in-postgres-behind-one-interface.md) rests on. It is
> scaffolding to reach a decision and should not be built on; the conformance suite that measures the
> search budget (SCH-033) will be written for the product's own schema.

Not part of the pnpm workspace, not run by CI. It needs Docker and about 4GB of disk.

## What is here

| File       | Does                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| `load.sql` | Builds a synthetic tenant inside Postgres: a million components in 2,000 spaces, with text |
|            | at controlled word frequencies and vectors clustered by topic. About six minutes           |
| `bench.py` | Measures words, facets, meaning three ways and the merged list for three users, and checks |
|            | that nothing outside each user's permissions appears in any result or count                |

## Running it

```bash
docker network create search-spike
docker run -d --name search-pg --network search-spike -e POSTGRES_PASSWORD=spike --shm-size=2g pgvector/pgvector:pg17 -c shared_buffers=2GB -c work_mem=64MB -c maintenance_work_mem=2GB -c max_parallel_workers_per_gather=4 -c max_parallel_maintenance_workers=6 -c effective_cache_size=6GB
docker exec -i search-pg psql -U postgres < load.sql
docker run --rm --network search-spike -v "$PWD:/spike" python:3.13-slim sh -c "pip install -q 'psycopg[binary]' && python /spike/bench.py"
```

The bench writes `report.json` beside itself. It is not committed: the findings carry the numbers.

**One thing it gets wrong, found afterwards.** The driver prepares a statement after five runs, and
Postgres may then reuse a generic plan across users with very different permission sets. The broad
user's slowest full-text cases are inflated by it. The findings explain how that was found, and the
design runs every search with custom plans.
