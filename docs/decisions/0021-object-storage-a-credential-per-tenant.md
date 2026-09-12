# 0021 - Object storage: a credential per tenant, scoped to its own prefix

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

[ADR-0019](0019-platform-typescript-service-publishing-workers-object-storage.md) put binaries in
S3-compatible object storage, "keyed by content hash under a tenant prefix and reached with
credentials scoped to that tenant". [system.md](../design/system.md) repeats that in its isolation
table: keys under the tenant's prefix, readers given signed links and never credentials.

That leaves the question of what "scoped to that tenant" is made of. One credential for the whole
product, with the service careful to build every key correctly, would be simpler - and would make a
single wrong key a cross-tenant read. The service already refuses to let a mistake reach another
tenant's rows: `withTenant` assumes that tenant's database role, so a query that skips it is refused
by Postgres rather than by our own care ([ADR-0008](0008-schema-per-tenant-isolation.md)). Storage
should be no weaker than the database beside it.

Two things had to be established before committing to that. Whether a store we bundle can scope a
credential to a prefix at all, and where the secret then lives, given that a store issues the secret
rather than accepting one.

A spike against SeaweedFS 4.46, the store in the compose file, answered the first. Its embedded IAM
API takes the same calls as AWS IAM, and a credential with a policy over `bucket/t_<id>/*` is
refused another tenant's prefix, the bucket root and a `..` key, for reads, writes, listings and
signed links alike. Credentials survive a restart, a replaced key stops working at once, and
provisioning can be run again safely.

## Decision

**Each tenant gets its own object store credential, allowed its own prefix and nothing else. The
secret is sealed before it is stored, bound to that tenant, and kept in that tenant's own schema.**

- **The credential is made through the store's IAM API** when a tenant is provisioned: a user named
  for the tenant's role, a policy over `bucket/t_<id>/*` and a listing condition on the same prefix.
  These are AWS's own calls, so the same code provisions against AWS.
- **The secret is sealed with AES-256-GCM** under a key from the service's secret store, with the
  tenant's id as authenticated data, and the sealed text is kept in that tenant's schema. Reading it
  needs both the tenant's database role and the key, so a database backup unlocks nothing, and a
  sealed secret copied into another tenant's row does not open.
- **Keys are content hashes under the prefix**, `t_<id>/sha256/<hex>`, built by one module that
  never takes a key from a caller without checking it belongs to that tenant. The store refuses the
  same mistake independently.
- **Downloads are signed links** the tenant's own credential mints, valid for minutes. The object
  store never decides who may read anything.

## What would change the answer

- **The number of tenants.** AWS caps IAM users at 5,000 per account. Past a few thousand tenants the
  same prefix policy has to be minted per request as a short-lived credential (AWS does this with a
  session policy) rather than kept as a user. That is a different implementation of the same rule,
  behind the same interface, and it removes the stored secret entirely.
- **A store whose access control cannot scope to a prefix.** Then the unit becomes a bucket per
  tenant, with the same policy shape. The code holds the prefix in one place for that reason.
- **Somewhere better for the secret.** A production secret store that can hold a value per tenant
  would replace the sealed row; the sealing exists because a database is what a development
  installation has.

## Consequences

- Provisioning a tenant now has a second step, against the object store, which can fail on its own.
  It is safe to run again, and running it again replaces the credential rather than adding one.
- A leaked or mis-used credential reaches one tenant's objects, and an environment's own bug cannot
  write into another environment's prefix: the store refuses it, as Postgres refuses the same
  mistake in the database.
- The compose file runs SeaweedFS with its IAM API writable, which is why the object store's port is
  the only one published: the filer's IAM service is unauthenticated inside the container.
- The service and the workers both open a store the same way, so publishing inherits this without
  changing anything.
