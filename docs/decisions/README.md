# Architecture decision records

One file per decision, numbered in the order they were taken, named
`NNNN-short-title.md`. A record is written when a choice would otherwise have to be reconstructed
from the diff - which stack, which boundary, which trade-off, and **what would change the answer**.

Records are not edited once accepted. A decision that no longer holds gets a new record that
supersedes it, and the old one is marked `Superseded by NNNN` so the reasoning stays readable.

| #                                             | Decision                           | Status   |
| --------------------------------------------- | ---------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions      | Accepted |
| [0002](0002-pnpm-workspaces-and-turborepo.md) | pnpm workspaces with Turborepo     | Accepted |
| [0003](0003-one-renderer-two-deliveries.md)   | One renderer, two deliveries       | Accepted |
| [0004](0004-brand-assets-and-packaging.md)    | Brand assets and desktop packaging | Accepted |
