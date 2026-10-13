# Search-versions spike - harness

> **Throwaway.** The harness behind
> [`Search_Versions_Spike_Findings.md`](../../docs/specification/spikes/Search_Versions_Spike_Findings.md)
> (SV3). Scaffolding to reach a decision; the conformance suite that measures SCH-033 will be written
> for the product's own schema. Mirrors [`../search/`](../search/README.md).

Not part of the pnpm workspace, not run by CI. It needs Docker and about 25GB of disk.

| File       | Does                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `load.sql` | Builds a tenant with edit histories inside Postgres: a million components and 10,000           |
|            | documents with their sections, every version kept, in tables shaped as migrations 0031,        |
|            | 0062, 0083, 0085, 0088 and 0089 leave them, plus the proposal's `search_history`. About 25 min |
| `bench.py` | Measures today's query (as `search-words.ts` builds it) and the proposal for three users and   |
|            | four word frequencies, checks every result and count against ground truth, and times writes    |

## Running it

```bash
docker network create sv3-spike
docker run -d --name sv3-pg --network sv3-spike -e POSTGRES_PASSWORD=spike --shm-size=2g pgvector/pgvector:pg17 -c shared_buffers=2GB -c work_mem=64MB -c maintenance_work_mem=1GB -c max_parallel_workers_per_gather=4 -c max_parallel_maintenance_workers=4 -c effective_cache_size=6GB -c synchronous_commit=off -c max_wal_size=8GB
docker exec sv3-pg psql -U postgres -c "create database big"
docker exec -i sv3-pg psql -U postgres -d big -v comps=1000000 -v docs=10000 < load.sql
# RUM, for the `rum` section only: from the PGDG repository the image already carries
docker exec sv3-pg sh -c "apt-get update && apt-get install -y postgresql-17-rum"
docker run -d --name sv3-py --network sv3-spike -v "$PWD:/spike" -v "$PWD/out:/out" python:3.13-slim sleep infinity
docker exec sv3-py pip install "psycopg[binary]"
docker exec sv3-py python /spike/bench.py baseline proposal checks write rum explain --db big
docker rm -f sv3-pg sv3-py && docker network rm sv3-spike
```

`-v comps=10000 -v docs=100` makes a tenant of 1% in seconds, for trying a change. The bench writes
`report-<db>-<section>.json` to `/out`; they are not committed: the findings carry the numbers.
