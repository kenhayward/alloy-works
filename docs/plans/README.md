# Plans

Implementation plans: how a design becomes code, task by task, test first. A plan argues from a
design in [`../design/`](../design/) and the decision records behind it; it does not restate them.

Each plan is written when its turn comes, not all at once, so that it can use what the plans before
it actually built rather than what they were expected to build. A plan is committed before the work
it describes begins, and its status here changes when the work lands.

Every plan is executed test-first, as [`CLAUDE.md`](../../CLAUDE.md) requires, and every task ends
in a commit. The whole of a plan lands as one pull request unless the plan says otherwise.

## Scaffolding

The skeleton [service-foundations.md](../design/service-foundations.md) and
[system.md](../design/system.md) describe, built so that one path runs end to end - in the compose
stack and in CI - before any feature is built on it: signing in, a tenant-scoped read, a job through
a worker, and a live update.

| #   | Plan                                                                                     | Builds                                                                                                                                                                                 | Status          |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [Database foundations](2026-09-11-scaffolding-01-database-foundations.md)                | `packages/db`: login roles, tenant provisioning, the migration runner, `withTenant`; Postgres in compose and in CI                                                                     | Built (PR #26)  |
| 2   | [Service skeleton and contracts](2026-09-11-scaffolding-02-service-skeleton.md)          | `apps/service` on Fastify and `packages/api-contract`: configuration, the error shape, hostname to tenant, OpenAPI generated and drift-checked, one unauthenticated tenant-scoped read | Built (PR #29)  |
| 3a  | [Signing in with the organisation's provider](2026-09-11-scaffolding-03a-signing-in.md)  | The stand-in OpenID Connect provider, the organisation's provider route, sessions and cookies, sign-out, `GET /v1/me`, the cross-tenant harness                                        | Built (PR #31)  |
| 3b  | [Signing in with Google](2026-09-11-scaffolding-03b-signing-in-with-google.md)           | The Google route, `signin.<domain>` and its hand-off, invitations and named Workspace domains (IAM-054)                                                                                | Built (PR #33)  |
| 4a  | [Workers and object storage](2026-09-11-scaffolding-04a-workers-and-object-storage.md)   | The job queue in the platform schema, `apps/worker` claiming and running jobs, a store credential per tenant, and one job kind end to end: a sample PDF rendered by the pinned Typst   | Built (PR #35)  |
| 4b  | [Images and the full stack](2026-09-12-scaffolding-04b-images-and-the-full-stack.md)     | Images for the service and the worker, the whole compose stack, and the image build in CI                                                                                              | Built (PR #37)  |
| 5a  | [Live updates and the client](2026-09-12-scaffolding-05a-live-updates-and-the-client.md) | One Server-Sent Events stream per environment, fanned out through Postgres, and the client generated from the committed document                                                       | Built (PR #41)  |
| 5b  | The renderer, the desktop app and the end-to-end check                                   | The service serving the renderer, the renderer talking to it, the desktop window on the service, and an end-to-end check in CI                                                         | Not yet written |

Each plan leaves the repository working and tested on its own: plan 1 is a library with no service,
plan 2 a service nobody can sign in to, and so on, each a smaller thing that is finished rather than
a larger thing that is not.
