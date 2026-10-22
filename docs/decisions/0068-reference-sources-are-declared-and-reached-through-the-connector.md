# 0068 - Reference sources are declared and reached through the connector

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

T6 asks that an author search an external reference source and cite a result (LIB-031), that the
sources be a declared, versioned list extended the extension way (LIB-032), and that a retraction or
correction reach every citation of it (LIB-035, LIB-036). Every call to the public internet already
leaves through the connector's guard ([ADR-0034](0034-data-connectors-run-apart-as-a-declared-identity.md),
[ADR-0064](0064-model-calls-leave-through-the-connector.md)). Ken chose Crossref and PubMed built in,
re-checks on demand and nightly, and a gate condition off by default (2026-10-22; the
[XR plan](../plans/2026-10-22-xr-reference-sources.md)).

## Decision

- **A source is a declared entry, by id**: Crossref and PubMed in domain's list; a further one an
  extension of kind `reference`. The service asks the connector by source id and operation, never by
  URL.
- **Reached through the connector**, public addresses only, with no tenant credential.
- **A source's word is a status, never a version**: what a re-check finds is held beside the entry;
  only a person changes its fields.

## Consequences

- Searching and re-checking depend on two public services' availability; a failure is the source's.
- A retraction reaches every citation without anyone editing an entry.

## What would change the answer

- **A source needing a tenant's credential** (a licensed index): it would take a sealed secret, as a
  model endpoint does.
