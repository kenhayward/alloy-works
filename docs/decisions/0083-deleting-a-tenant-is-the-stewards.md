# 0083 - Deleting a tenant is a process of its own, holding the least that can

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Deleting a tenant ([tenant-lifecycle.md](../design/tenant-lifecycle.md), TL-I) must drop its schema and roles and remove
its objects and credential, within a day, and be able to show it did. Until now only the administrator's URL could touch
a role. Neither the worker, which runs Typst over content, nor the service may be able to do any of it.

## Decision

1. **A `steward` process**, the worker's image with another command, claims `tenant_purge` alone and holds
   `OBJECT_STORE_ADMIN_*`. It parses no archive and renders no content.
2. **`aw_steward` holds `createrole` and the admin option on each tenant's two roles**, membership not inherited. The
   TL plan's spike found that enough on PostgreSQL 16 and later: `drop schema` and `drop owned by` run as the tenant's own
   roles after `set local role`, and `drop role` needs only those two. It is no superuser, and can touch no other role.
3. **Each stage repeats safely, in order:** addresses gone, a 31-minute wait for whatever was in flight, the credential,
   the objects, the schema and roles, then a report of what was found by looking. A purge that finds anything left
   writes nothing and tries again.
4. **A dropped tenant's row stays**, so whatever reads `platform.tenant` to act in a tenant asks for rows with a schema or
   a role. Without that, the first purge would stop every later deploy.
5. **A job that gives up is queued again**, and one past the day is an alarm, since silence would break the promise.

## What would change the answer

Backups held to the same timetable (ADM-043, DG) would let IAM-006 be claimed. A store whose administrative credential
can be scoped below the whole bucket would narrow what this process holds.

## Consequences

Each deployment runs one more container with the most dangerous credentials in the system, kept off the worker's and the
service's. `createrole` on `aw_steward` is also what creating a tenant from a console needs (TL-N). Dropping a tenant holds
the migration lock, so a deploy and a purge take turns.
