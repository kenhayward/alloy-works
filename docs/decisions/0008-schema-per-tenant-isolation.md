# 0008 - Schema-per-tenant isolation

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[IAM-002](../specification/requirements/IAM-identity-tenancy-and-access-control.md) requires tenant
isolation to be enforced at the data layer rather than by application code remembering to add a
filter, and [`Project_Scope.md`](../specification/Project_Scope.md) §13 names multi-tenant leakage as
one of the two likeliest sources of a serious breach. Three models were considered.

**Pooled**, with a tenant column and row-level security, gives the best density and the simplest
operations. Postgres RLS can genuinely satisfy IAM-002. Its failure mode is a policy gap or a
`SECURITY DEFINER` function nobody noticed, on exactly the risk the scope names.

**Database-per-tenant** makes residency, export, deletion and "prove we are separate" trivial - all
sales questions in this market. It is probably where a regulated-customer product ends up. It also
makes every schema change a fleet operation from the first day, before there is a customer.

**Schema-per-tenant** sits between them.

Two things about this market weigh on the choice. The wedge implies **few large customers rather
than many small ones** - consultancies, pharmaceutical companies, engineering firms - so density is
worth less here than in a typical SaaS, while separation is worth more. And **residency is a separate
question from isolation**: where data sits and how tenants are separated are independent, and
treating them as one makes the decision look larger than it is.

## Decision

**Tenants are isolated by schema: one database, one schema per tenant, enforced by role and search
path rather than by application code.**

The argument that settles it is **which mistakes stay reversible**. Moving a schema into its own
database later is mechanical. Splitting pooled rows into schemas later is a migration of every
table. Schema-per-tenant therefore keeps the stronger option open at a cost pooling does not.

Supporting choices:

- **The isolating mechanism is the database's, not the application's.** A tenant's connection carries
  a role that can reach that tenant's schema and no other. Application code that forgets a filter
  gets an error rather than another tenant's rows.
- **Everything else that holds tenant data is scoped the same way**, not only the primary store:
  search indexes, caches, object storage prefixes, and the audit log (IAM-005).
- **Residency is deferred, deliberately.** A single region is assumed until a customer requires
  otherwise, and the commitment is stated rather than implied.
- **The cross-tenant test in IAM-004 stays**, because a model that makes leakage unlikely is not a
  model that makes it impossible.

## What would change the answer

- **A customer requiring physical separation.** Some regulated procurement asks for a dedicated
  database or a dedicated deployment, and the answer is to move that tenant's schema rather than to
  change the model for everybody. Mixing models across a fleet is worse than either.
- **Tenant count reaching the thousands.** Per-schema migration is fine at hundreds and unpleasant
  well before ten thousand. That would be a good problem and a real one.
- **Residency turning into multi-region.** One database in one region stops being the shape, and the
  decision reopens alongside a much larger one about deployment.

## Consequences

- **Migrations run per schema**, and the tooling for that has to exist before the second tenant does.
  It is the main cost of this choice and it is paid up front.
- **Per-tenant export, backup and deletion are straightforward**, which serves IMP-018, the deletion
  timetable in IAM-006, and legal hold in LIF.
- **Connection management is more complex than pooled**, since a connection is tenant-bound. Pool
  sizing is now a function of tenant count as well as load.
- **Cross-tenant reporting becomes deliberately awkward**, which ADM-N02 already wants.
- The storage and version model decision, still open, inherits this: whatever is chosen sits inside a
  per-tenant schema.
