# Architecture decision records

One file per decision, numbered in the order they were taken, named `NNNN-short-title.md`. A record
is written when a choice **constrains later work** and its reasoning **would otherwise have to be
reconstructed from the diff** - which stack, which boundary, which trade-off, and above all what
would change the answer.

Write it once the choice has survived contact with something - a spike, a prototype, a review. A
decision that is one conversation old belongs in [`../specification/`](../specification/), where it
can still be edited, until it has earned a record here.

## The shape of a record

```
# NNNN - Title

- **Status:** Accepted | Proposed | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
## Decision
## What would change the answer
## Consequences
```

`0001` predates the "what would change the answer" section and does not have one. It keeps its
omission rather than acquiring reasoning invented after the fact.

Records are not edited once accepted, and **the status line is the only edit a record ever takes**.
A decision that no longer holds gets a new record that supersedes it, and the old one is marked
`Superseded by NNNN` so the reasoning stays readable.

The table below is part of the record, not a convenience: `apps/desktop/src/decisions.test.ts` fails
when a record is missing from it, when a row points at a file that is not there, or when the two
disagree about a status. A stale index is worse than no index, because it says a decision does not
exist.

| #                                                                  | Decision                                                      | Status   |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                      | Record architecture decisions                                 | Accepted |
| [0002](0002-pnpm-workspaces-and-turborepo.md)                      | pnpm workspaces with Turborepo                                | Accepted |
| [0003](0003-one-renderer-two-deliveries.md)                        | One renderer, two deliveries                                  | Accepted |
| [0004](0004-brand-assets-and-packaging.md)                         | Brand assets and desktop packaging                            | Accepted |
| [0005](0005-purpose-built-node-and-mark-content-model.md)          | A purpose-built node-and-mark content model                   | Accepted |
| [0011](0011-external-participation-guests-and-identified-links.md) | External participation: guest principals and identified links | Accepted |
| [0010](0010-open-licence-typefaces-only.md)                        | Open-licence typefaces only                                   | Accepted |
| [0009](0009-federation-and-google-accounts-no-local-passwords.md)  | Federation and Google accounts, no local passwords            | Accepted |
| [0008](0008-schema-per-tenant-isolation.md)                        | Schema-per-tenant isolation                                   | Accepted |
| [0007](0007-no-per-server-licensing-in-the-publishing-pipeline.md) | No per-server licensing in the publishing pipeline            | Accepted |
| [0006](0006-iteration-version-revision.md)                         | Iteration, version and revision                               | Accepted |
