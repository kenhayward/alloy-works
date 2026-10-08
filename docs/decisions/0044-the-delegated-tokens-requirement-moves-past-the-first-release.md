# 0044 - The delegated token's requirement moves past the first release

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

[ADR-0041](0041-the-delegated-provider-token-is-deferred-past-the-first-release.md) deferred the
delegated provider token but moved no requirement: DAT-076 stayed in T2, its delegated half named as a
gap beside data.md's claim. So T2 could not close with DAT-076 Covered, and a T2 baseline could only
include it by excluding it.

[The T2 audit](<../reviews/T2 - Audit against the code.md>) recommended splitting it, and Ken approved
on 2026-10-08.

## Decision

**DAT-076 is superseded by its two halves.** This replaces ADR-0041's "No requirement moves"; the rest
of ADR-0041 stands.

- **DAT-117, in T2**: a connection declares a service account or an asserted identity its connector
  declares; the run goes as the person whose act caused it, and an act whose person the connection
  cannot name is refused before anything runs. Built in D7 and data.md claims it.
- **DAT-118, in T7**: the delegated token, from the tenant's own provider only, never for a user
  signed in by another route or through a personal API token. The corpus has no unscheduled tranche;
  T7 holds what was deferred, with federation, and a row there moves earlier by name when a tranche
  needs it ([Project_Scope.md](../specification/Project_Scope.md) section 12).

## What would change the answer

ADR-0041's: a tenant before the first release needing each person's own authority at an HTTP or S3
source, or a provider tenants share adopting RFC 8693. Then DAT-118 moves to the tranche that builds
it, and D6.4 is planned.

## Consequences

- T2 closes with every row in force Covered; the delegated token is out of baseline rather than
  excluded.
- data.md claims DAT-117 in DAT-076's place and names DAT-118 as designed but unbuilt.
