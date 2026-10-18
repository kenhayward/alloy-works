# R21: Stored results as sources, and the tenant export

> T4's twenty-first slice, extending [data.md](../design/data.md). **Full tier**: a migration (0117),
> a new fetch kind and stored shape, new routes, and an export job. Built inline, one final review at
> the slice's end. Decisions marked **(default)** are recommendations Ken may overturn; the rest are his
> answers of 2026-10-18.

**Goal:** a stored dataset is queryable as a source of its own through the query builder, governed by
read on the dataset (DAT-094); and a tenant's content is exported at scale as a job (API-044).

Two PRs: R21a (DAT-094), R21b (API-044) with the close.

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R21-A | **A built-in source, run in the service** (Ken): fetch `dataset`, the builder's tree over one stored result, no connection, evaluated from the stored rows by their checksum. `read` on the dataset governs it. No joins, no image column (default); the run recorded, taking no slot (default).                |
| R21-B | **A tenant export job** (Ken): content, definitions, relationships, versions, baselines and publication records as JSON Lines, asset and output bytes by hash, and a manifest stating what it leaves out. Administrators only, on Administration > Export, each kept 7 days; every export and download audited. |

## Tasks

- **R21a**: the fetch kind and its checks in the domain; 0117 (`query_run.connection_id` nullable); the stored results listing and sample routes; resolve, check and accept over one; the page's **A stored result**. Tests: listed by read, sampled with no connector run, saved with no connection, resolved with the dataset's provenance; its definition withheld from a non-reader.
- **R21b**: the export job, its routes and Administration > Export; the browser walk; the final review; the close (0.192.0).
