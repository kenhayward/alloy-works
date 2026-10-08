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

| #                                                                                 | Decision                                                                      | Status             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------ |
| [0001](0001-record-architecture-decisions.md)                                     | Record architecture decisions                                                 | Accepted           |
| [0002](0002-pnpm-workspaces-and-turborepo.md)                                     | pnpm workspaces with Turborepo                                                | Accepted           |
| [0003](0003-one-renderer-two-deliveries.md)                                       | One renderer, two deliveries                                                  | Accepted           |
| [0004](0004-brand-assets-and-packaging.md)                                        | Brand assets and desktop packaging                                            | Accepted           |
| [0005](0005-purpose-built-node-and-mark-content-model.md)                         | A purpose-built node-and-mark content model                                   | Accepted           |
| [0046](0046-the-ledger-interface.md)                                              | The Ledger interface                                                          | Accepted           |
| [0045](0045-t3-is-the-collaboration.md)                                           | T3 is the collaboration                                                       | Accepted           |
| [0044](0044-the-delegated-tokens-requirement-moves-past-the-first-release.md)     | The delegated token's requirement moves past the first release                | Accepted           |
| [0043](0043-a-templates-bindings-query-set-and-variables-move-to-t4.md)           | A template's bindings, query set and variables move to T4                     | Accepted           |
| [0042](0042-grouping-totals-transposition-and-emphasis-rules-move-to-t3.md)       | Grouping, totals, transposition and emphasis rules move to T3                 | Accepted           |
| [0041](0041-the-delegated-provider-token-is-deferred-past-the-first-release.md)   | The delegated provider token is deferred past the first release               | Accepted           |
| [0040](0040-asserted-identity-trusts-the-sources-function-authors.md)             | Asserted identity trusts the source's function authors                        | Accepted           |
| [0039](0039-ci-at-two-speeds-and-fewer-prs.md)                                    | CI at two speeds, and fewer PRs                                               | Accepted           |
| [0038](0038-sql-server-is-deferred-past-the-first-release.md)                     | SQL Server is deferred past the first release                                 | Accepted           |
| [0037](0037-change-fragments-and-versions-at-a-close.md)                          | Change fragments, and versions at a close                                     | Accepted           |
| [0036](0036-revising-a-bound-value-by-hand-moves-to-t3.md)                        | Revising a bound value by hand moves to T3                                    | Accepted           |
| [0035](0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md) | Bindings hold stored results, and a publish never queries a source            | Accepted           |
| [0034](0034-data-connectors-run-apart-as-a-declared-identity.md)                  | Data connectors run apart, as a declared identity, and pin a canonical result | Superseded by 0035 |
| [0033](0033-t2-is-the-data-spine.md)                                              | T2 is the data spine                                                          | Accepted           |
| [0032](0032-words-fidelity-to-the-pdf-leaves-t1.md)                               | Word's fidelity to the PDF leaves T1                                          | Accepted           |
| [0031](0031-t1-publishes-headings-to-six-levels.md)                               | T1 publishes headings to six levels                                           | Accepted           |
| [0030](0030-the-conformance-report-joins-a-publication-after-it-is-recorded.md)   | The conformance report joins a publication after it is recorded               | Accepted           |
| [0029](0029-a-browser-suite-in-ci-and-attested-audits.md)                         | A browser suite in CI, and audits a person attests                            | Accepted           |
| [0028](0028-personal-api-tokens-in-t1.md)                                         | Personal API tokens in T1, service identities with the MCP facade             | Accepted           |
| [0027](0027-the-warm-range-preview-leaves-t1.md)                                  | The warm range preview leaves T1                                              | Accepted           |
| [0026](0026-a-definition-is-its-own-editor-node.md)                               | A definition is its own editor node                                           | Accepted           |
| [0025](0025-the-editor-schema-is-not-the-stored-model-one-for-one.md)             | The editor schema is not the stored model one for one                         | Superseded by 0026 |
| [0024](0024-a-version-digest-over-the-whole-version.md)                           | A version digest over the whole version, and a content hash beside it         | Accepted           |
| [0023](0023-prosemirror-as-the-editor-and-its-model.md)                           | ProseMirror as the editor, and one view per component                         | Accepted           |
| [0022](0022-the-desktop-window-loads-the-service.md)                              | The desktop window loads the service                                          | Accepted           |
| [0021](0021-object-storage-a-credential-per-tenant.md)                            | Object storage: a credential per tenant, scoped to its own prefix             | Accepted           |
| [0020](0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)            | Service foundations: tenants by hostname and role, zod-first APIs, Kysely     | Accepted           |
| [0019](0019-platform-typescript-service-publishing-workers-object-storage.md)     | The platform: a TypeScript service, publishing workers, object storage        | Accepted           |
| [0018](0018-realtime-one-push-channel-postgres-fan-out.md)                        | Realtime: one push channel, fanned out through Postgres                       | Accepted           |
| [0017](0017-relationships-in-postgres-traversed-by-recursive-sql.md)              | Relationships in Postgres, traversed by recursive SQL                         | Accepted           |
| [0016](0016-search-in-postgres-behind-one-interface.md)                           | Search in Postgres, behind one interface                                      | Accepted           |
| [0015](0015-word-output-our-own-writer-reflowable.md)                             | Word output: our own writer, reflowable by design                             | Accepted           |
| [0014](0014-themes-resolve-once-project-three-times.md)                           | Themes: resolve once, project three times                                     | Accepted           |
| [0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md)            | Typst, rendering resolved data through a fixed template                       | Accepted           |
| [0012](0012-relational-version-chain-hashed-content.md)                           | A relational version chain with hashed content                                | Superseded by 0024 |
| [0011](0011-external-participation-guests-and-identified-links.md)                | External participation: guest principals and identified links                 | Accepted           |
| [0010](0010-open-licence-typefaces-only.md)                                       | Open-licence typefaces only                                                   | Accepted           |
| [0009](0009-federation-and-google-accounts-no-local-passwords.md)                 | Federation and Google accounts, no local passwords                            | Accepted           |
| [0008](0008-schema-per-tenant-isolation.md)                                       | Schema-per-tenant isolation                                                   | Accepted           |
| [0007](0007-no-per-server-licensing-in-the-publishing-pipeline.md)                | No per-server licensing in the publishing pipeline                            | Accepted           |
| [0006](0006-iteration-version-revision.md)                                        | Iteration, version and revision                                               | Accepted           |
