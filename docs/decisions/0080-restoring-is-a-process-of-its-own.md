# 0080 - Restoring is a process of its own, and an archive comes in as the owner

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

A restore must bring back history that a tenant's live triggers exist to refuse: its log, versions in order,
rows written by people who are gone. A spike ([the EI plan](../plans/2026-11-03-ei-export-and-import.md), S1)
found that only the schema's owner, in one transaction with user triggers off, can do it and still have foreign
keys hold. The worker runs Typst over content, and must never be able to become a tenant's owner.

## Decision

1. **A `restorer` process**, the worker's image with another command, is the only holder of `aw_restorer`, a
   login with each tenant's owner and tenant role, inherit false. It claims `restoration` jobs alone.
2. **An archive is untrusted input.** Entries by exact name, sizes against the manifest, columns against this
   schema, every digest and hash recomputed, before anything is written. A part holding access or audit is refused.
3. **All or nothing, in one transaction.** A whole archive goes only into an empty tenant, and a restore that would
   leave its restorer unable to administer is undone.
4. **A part's preview is the import, rolled back**, so it says what would happen here, at the cost of pausing
   writers to the tables it holds for that moment as well. It waits at most 30 seconds for its locks.
5. **Every secret arrives switched off**, set afterwards through its kind's own route. A provider this tenant
   already has stays as it is.
6. **Definitions are the one chain that merges.** Tenants seed the same definitions under their own version ids and
   a digest names the id, so an arriving definition version takes the next number, and this tenant's current
   version is put back on top if it says anything else.

## What would change the answer

A signed log (SG) changes what restored events can claim. A value bound during the import, through the
connector, would replace arriving switched off. A set-based load, if parts prove large enough to feel the pause.

## Consequences

Each deployment runs one more container with one more login. Every new table must be decided in the census, and a
carried column's change costs a format bump. Objects are put before the transaction, so a refused apply can leave
unreferenced bytes in the tenant's store.
