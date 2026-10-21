# 0066 - An extension is a manifest and a remote service

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

T5 asks that new source types and output formats be addable without changing the product (API-030,
API-031, DAT-054), with no arbitrary code run (API-N03), and leaves open where an extension runs
(API-Q03) and how one is versioned and pinned (API-Q06). The connector already reaches tenant-named
hosts through a guard ([ADR-0034](0034-data-connectors-run-apart-as-a-declared-identity.md),
[ADR-0064](0064-model-calls-leave-through-the-connector.md)). Ken chose a manifest and a remote
service, installed by a tenant administrator, source types first (2026-10-21; the
[EX plan](../plans/2026-10-21-ex-extensions.md)).

## Decision

- **An extension is a manifest at an HTTPS URL and the service it names**, hosted by its author. The
  product runs none of its code (API-Q03).
- **A tenant administrator installs one** by its URL, after reading what it declares.
- **Pinned by its manifest's digest** (API-Q06): every manifest an extension has had is kept, and a
  connection snapshots the one it was made against, its endpoint and capabilities among it. An update
  changes nothing a connection does until that connection is saved against it.
- **Called through the connector**, as an HTTP source is: the same guard, limits and canonical result.

## Consequences

- An extension's availability is its author's: its failures are the source side's, named.
- Pinning holds what was declared, not what the remote service does.
- Output formats (API-031) take the same manifest with a `kind` of their own.

## What would change the answer

- **Extensions a tenant cannot host**, which would want code the product runs in a sandbox, and API-N03
  revisited.
