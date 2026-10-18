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

## Built

R21a #702 and R21b with the close (0.192.0) #703, as planned. Departures: a stored result's listing
names its definition only to a reader of the definition (found by the automated security review);
the export is one ZIP archive, so at most 65,000 files and 4 GB, failing `export_too_large` past them.
The final review found a comparison's operand never held to the stored column's type, so a saved
query could crash its run; an archive whose removal failed forgotten in the store; and versions
exported without their artifact. All fixed: an operand of another type, and a contains on anything
but text, are refused when written, and a run that still cannot compare fails `result_mismatch`; the
sweep removes an archive before it marks the export expired; an artifact is exported where the
snapshot sees one of its versions. Left: a dataset query is evaluated in the service's own process,
the whole stored result in memory, with no deadline; a long export is not leased beyond the worker's
lease, so a second worker may run it again; an expired export's row is kept for ever.
