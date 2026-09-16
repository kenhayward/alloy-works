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

| #   | Plan                                                                                                                 | Builds                                                                                                                                                                                 | Status         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | [Database foundations](2026-09-11-scaffolding-01-database-foundations.md)                                            | `packages/db`: login roles, tenant provisioning, the migration runner, `withTenant`; Postgres in compose and in CI                                                                     | Built (PR #26) |
| 2   | [Service skeleton and contracts](2026-09-11-scaffolding-02-service-skeleton.md)                                      | `apps/service` on Fastify and `packages/api-contract`: configuration, the error shape, hostname to tenant, OpenAPI generated and drift-checked, one unauthenticated tenant-scoped read | Built (PR #29) |
| 3a  | [Signing in with the organisation's provider](2026-09-11-scaffolding-03a-signing-in.md)                              | The stand-in OpenID Connect provider, the organisation's provider route, sessions and cookies, sign-out, `GET /v1/me`, the cross-tenant harness                                        | Built (PR #31) |
| 3b  | [Signing in with Google](2026-09-11-scaffolding-03b-signing-in-with-google.md)                                       | The Google route, `signin.<domain>` and its hand-off, invitations and named Workspace domains (IAM-054)                                                                                | Built (PR #33) |
| 4a  | [Workers and object storage](2026-09-11-scaffolding-04a-workers-and-object-storage.md)                               | The job queue in the platform schema, `apps/worker` claiming and running jobs, a store credential per tenant, and one job kind end to end: a sample PDF rendered by the pinned Typst   | Built (PR #35) |
| 4b  | [Images and the full stack](2026-09-12-scaffolding-04b-images-and-the-full-stack.md)                                 | Images for the service and the worker, the whole compose stack, and the image build in CI                                                                                              | Built (PR #37) |
| 5a  | [Live updates and the client](2026-09-12-scaffolding-05a-live-updates-and-the-client.md)                             | One Server-Sent Events stream per environment, fanned out through Postgres, and the client generated from the committed document                                                       | Built (PR #41) |
| 5b  | [The renderer, the desktop app and the end-to-end check](2026-09-12-scaffolding-05b-the-renderer-and-the-desktop.md) | The service serving the renderer, the renderer talking to it, the desktop window on the service, and an end-to-end check in CI                                                         | Built (PR #43) |

Each plan leaves the repository working and tested on its own: plan 1 is a library with no service,
plan 2 a service nobody can sign in to, and so on, each a smaller thing that is finished rather than
a larger thing that is not.

**The scaffolding is finished.** A person can open an environment, sign in, ask for something, watch
it happen and download the result, in a browser or the desktop app, with the whole system checked on
every change.

## Traceability

The layer that turns 1,303 requirements into something queryable, and the chain from a requirement to
the test that verifies it into something computed rather than remembered. Designed in
[the traceability design](../superpowers/specs/2026-09-13-requirements-traceability-design.md), which
the plans below argue from. Four stages, each useful alone; stages 2 to 4 are written when their turn
comes.

| #   | Plan                                                                        | Builds                                                                                                                                                                                                                                                                                                                     | Status         |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | [The compiled corpus](2026-09-13-traceability-01-the-compiled-corpus.md)    | `packages/trace`: the parsers, the state ladder, the committed and drift-checked `trace.json`, the query and search command, and the two repository-wide checks moved into it                                                                                                                                              | Built (PR #61) |
| 2   | [The test edge](2026-09-13-traceability-02-the-test-edge.md)                | A citation scanner finding the requirements a test's title or a `rule:` field names, `check.ts` holding the corpus invariants as data, the `Covered` and `Verified` rungs, and `pnpm trace check` and `pnpm trace verify` reading the JSON reports every suite now writes                                                  | Built (PR #63) |
| 3   | [The baseline and the evidence](2026-09-13-traceability-03-the-baseline.md) | A hand-written baseline document declaring the requirements a release is answerable for, `pnpm trace gate` deciding pass or fail over it as CI's first check that is not `continue-on-error`, the first real baseline (`0.13.0`, seven requirements), and `pnpm trace pack` writing its committed evidence pack            | Built (PR #64) |
| 4   | [Intake](2026-09-13-traceability-04-intake.md)                              | The requirement issue form (`.github/ISSUE_TEMPLATE/requirement.yml`), and `pnpm trace draft`, which reads a filed issue or a set of flags, allocates the next free identifier and prints a row and the candidate sections it might belong in - never inserting it, because where it belongs is a judgement a person makes | Built (PR #65) |

This is tooling rather than product, which is why it has no document in [`../design/`](../design/):
every document there declares the product requirements it owns, and this owns none. The first real
feature is still a product conversation rather than a plan.

**The traceability layer is finished.** A requirement can be filed as an issue, drafted into a row
with `pnpm trace draft`, and landed by the pull request that closes it - and once it is in the
corpus, anybody can ask what a release actually answers for, and have that answer computed from a
committed baseline and a passing test run rather than remembered. What it does not give anybody: the
gate proves that a requirement is cited by a test that passed, not that the requirement is true of
the code or that the test is a good one. The seven problems it found on its first run were fixed in
PR #69 and `pnpm trace check` now reports none; the `0.13.0` baseline and its evidence pack stay
frozen and still record them, which is the record working rather than untidiness.

## The content model

The stored shape of a component's content, designed in [content-model.md](../design/content-model.md)
and built on the editor [ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md)
settled first - because CNT-012 makes the first migration fixture permanent, so a framework that
imposed a shape had to be ruled out while there were no fixtures.

This is the first tranche T1 work. The tranche is designed and built one subsystem at a time rather
than designed whole: a plan written two subsystems early is rewritten when its turn comes, and so is a
design.

| #   | Plan                                                                            | Builds                                                                                                                                                                                                                                                                                                                                                                                                                      | Status          |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [The schema and its canonical form](2026-09-13-content-model-01-the-schema.md)  | `packages/domain/src/content/model/`: thirteen closed marks, eight inline nodes, seven blocks, the root a version holds, the canonical serialisation `content_hash` rests on, migration as a read-time projection with a fixture per schema version, the output mapping every node must have a row in, and the promotion to the package's public surface                                                                    | Built (PR #79)  |
| 2   | [The admission pipeline](2026-09-15-content-model-02-the-admission-pipeline.md) | `packages/domain/src/content/admission/`: the report every stage appends to, the limits one admission is held to, a strict MathML reader keeping MathML Core that validation also asks of every stored equation, then sanitise, migrate, normalise, re-identify and validate in that order behind `admit`, and the product clipboard's reader and writer. No Word, Markdown or HTML reader, no editor, no route, no storage | Built (PR #104) |

**Plan 1 is built.** The stored shape exists, 39 requirements are cited by its tests and
`docs/architecture.md` describes it as built rather than planned. What that is not: a schema that
parses is not a product that authors, and [`../features.md`](../features.md) stays the honest account of
the distance.

Four things plan 1 deliberately leaves, named so the next plan starts from a list rather than from a
reading of the diff: the spike schema and the four gate-case tests still standing beside the new model,
with the OOXML reader and writer still inside `packages/domain` where
[content-model.md](../design/content-model.md) says they should not stay; the admission pipeline, which
is the whole of CNT section 10; and resolution, which needs conditions and suggestions that are T3 and
T4 capabilities even though CNT-116 puts their marks in the first schema version stored; and identity
through editing, which ADR-0023 settled as a rule of descent rather than arrival and which belongs with
the editor, because it is a plugin over transactions rather than a property of the schema.

**Plan 2 is built.** The admission pipeline exists - sanitise, MathML, migrate, normalise, re-identify
and validate in that order behind `admit`, the report every stage appends to, and the product
clipboard's reader and writer - and `docs/architecture.md` describes it as built rather than planned.
What that is not: nothing in the application pastes through it yet.

What plan 2 deliberately leaves, named so the next plan starts from a list rather than from a reading of
the diff: the Word, Markdown and HTML readers (CNT-060 to CNT-062) and the workspace and parsers each
needs, which is the readers plan; pasting in the editor - the paste handler, the adjacency seam, fitting
admitted blocks into a slice, showing the report (CNT-063), the clipboard's MIME type, plain-text paste
and exporting `sanitiseMathml` for a typed equation - which is the editor session plan; a run's
direction, which the built marks have none of and normalise reports one it cannot keep, raised as
#101; what a cross-reference target names, and so whether re-identify should re-point one
at a copied block, for STR; whether a paste within one component keeps its comments and suggestions, for
COL in T3; condition axes and CNT-Q14, every caller passing `conditionAxes: []` until REU designs the
axes and decides the question; when the pipeline needs streaming (CMD-Q03) and whether the provisional
limits hold, for IMP's first real import; import as a product feature - IMP-047's report, an import
route and a component split from a document - for IMP's design; and retiring the spike schema and its
gate-case tests, and resolution, both plan 1's leftovers and still unchanged.

## Metadata

The rules deciding which fields apply to a component, what makes a value valid, and what a version
records about the definitions it was written against, designed in [metadata.md](../design/metadata.md).
They are built first as pure functions in `packages/domain`, before anything stores a value or shows a
field, because the editor's metadata panel, the service's refusals and the publisher all call the same
ones - and a rule written three times is three rules.

| #   | Plan                                             | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status         |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | [The rules](2026-09-15-metadata-01-the-rules.md) | `packages/domain/src/metadata/`: field, schema and component type definitions with a fixture per definition schema version, `checkValue`, resolution, `checkAssignment`, `validate`, `checkUserValues`, `carryForward`, `definitionsFor` and the canonical form values and `notCarried` take in the version digest - and the content model's canonical rules and migration chain moved to `packages/domain/src/stored/` so both share them. No `pattern`, no storage, no route, no panel | Built (PR #97) |

**Plan 1 is built.** The rules exist as pure functions over definitions a caller hands in: all fifteen
requirements metadata.md owns are cited by its tests, plus CNT-011, CNT-012 and CNT-056 in the
canonical rules and migration chain now shared with the content model, and `docs/architecture.md`
describes it as built rather than planned. Two things differ from the table's Builds cell:
`values.test.ts` was added, covering the predicates `carryForward`, `checkAssignment`, `checkValue`,
`checkSchema`, `checkUserValues` and `validate` share, and
`checkUserValues`' failure names a value with no known user rather than one outside the organisation,
because an organisation groups several tenants and "tenant" is not vocabulary an author sees. What
this is not: rules that validate are not a product that stores, shows or refuses anything, and
[`../features.md`](../features.md) stays the honest account of the distance.

Six things plan 1 deliberately leaves, named so the next plan starts from a list rather than from a
reading of the diff: `pattern`, unanswered by metadata.md's open question on bounding its
backtracking, which the field definition refuses until it is answered; storing anything - the
`values` and `not_carried` columns, `version_definition` and the version digest - which
storage-and-versioning.md's plan composes from what this package hands it; the service's refusals -
`metadata.fixed`, `metadata.type`, `metadata.user` - inside service-foundations' error shape, and the
metadata panel with re-resolution when definitions change mid-session, both component-editor.md's;
refusing an assignment (MET-008), a schema version that conflicts anywhere (MET-035) and a field
version that would make a schema's default invalid (MET-037), which `checkAssignment` and resolution
find but nothing acts on until the definitions-management design exists; and whether `text` needs a
language, metadata.md's second open question.

## Storage

The permanent record every versioned thing is kept in, designed in
[storage-and-versioning.md](../design/storage-and-versioning.md) under
[ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md). The chain comes first, before
iterations, revisions or baselines, because each of those refers to a version row and none of them can be
built against a table that does not exist.

| #   | Plan                                                            | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status         |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | [The version chain](2026-09-15-storage-01-the-version-chain.md) | The canonical serialisation of a whole version in `packages/domain`; in `packages/db`, both digests, `space` and `artifact`, the insert-only `artifact_version` and `version_definition`, `createArtifact`, `readVersion`, `latestVersion` and `recordVersion` with its `version.unchanged` and `version.precondition` answers - and, before those functions, a load test of inline JSONB at 200,000 components. No iteration, lock, revision, baseline or route | Built (PR #98) |

Eleven things plan 1 deliberately leaves, named so the next plan starts from a list rather than from a
reading of the diff: iterations, the lock, and the cut that promotes the latest iteration - checking the
lock, loading `definitionsFor`, running `carryForward` and calling `recordVersion` - and whether the
store refuses a component version whose component type differs from its predecessor's, all the editor
session plan's; revisions and designations, the lifecycle service's gate, and the numbering of a version
cut after a designation, the revisions plan's; baselines, the condition set, and the foreign keys that
make a pinned version undeletable - already in place on `artifact_version` - the baselines plan's;
restore, legal hold and retention, which the design does not yet answer, each its own plan's; derived
data - `embedding`, keyed by content hash, block id, model and model version - the search plan's, with
`content_hash` already on every row for it; the other artifact kinds - documents, outlines, templates,
assets, query definitions, style catalogues, themes and layouts - each a migration widening `artifact`'s
two checks when its content has a shape; roles, grants, groups and `decide`, who may create a space, the
_General_ space every tenant starts with, and a space's name folding, the access plan's; every route and
every screen, idempotency, and the error shape `version.unchanged` and `version.precondition` travel in,
the editor session plan's, with the service; erasure - what is removed from a principal and what the
record keeps; a cold cache at a million components, unmeasured and belonging with the hosting decision;
and deduplicating content, whose cost the load test measured without yet being worth a content-addressed
store.

## Access

Who may do what to which artifact, designed in [access.md](../design/access.md). It comes before the
editor session, because every route that session adds is checked, and a route written before the check
exists is a route that has to be revisited.

| #   | Plan                                                                                    | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status          |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [Roles, grants and the decision](2026-09-16-access-01-roles-grants-and-the-decision.md) | `packages/domain/src/access/`: the closed permission set, `checkRole`, `allowable` and the eight starter roles with Editing for denials, `decide` with its explanation and the external cap, and `readableSet`; in `packages/db`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, `access_policy`, `principal.kind`, the roles and _General_ every tenant starts with, `access_epoch` locked by triggers on every fact, `grant` with the external rules and allows that must hold `read`, the facts loaders, and the first administrator - named by issuer and subject, claimed once at sign-in, and named for Ada by `pnpm dev:setup`; in the service, every route declaring what it checks, the route helper, and `GET /v1/access` and `GET /v1/access/explain`; and access.md amended for the seven places planning found it wrong. No roles, groups or grants routes, no lock-out guard, no provider groups, no `modesFor`, no panel | Built (PR #105) |

The plan leads with the seven findings against access.md and Ken's rulings on two of them: a denial may
name a role without `read`, so one artifact can be made read-only, and a tenant's first administrator is
named at provisioning and claimed at their first sign-in.

What this plan deliberately leaves undone, named so the next plan starts from a list rather than from a
reading of the diff: reading a definition through a component, as access.md now states it, and
`GET /v1/spaces` with who may create in each, both the editor session plan's, which also declares
`create` on a space and `read` and `edit` on a component for its routes; managing access - the roles,
groups, grants and principals routes, removing a grant, changing a role, setting a principal's kind,
refusing to take `read` out of a role an allow names, the lock-out guard, "`administer` at its level or
above" for grant management, taking the epoch `FOR UPDATE` before deciding a change, extending
external access (IAM-050), the external listing (IAM-051) and the Access panel (IAM-029 to IAM-031), all
the access management plan's; the first administrator by invitation to an address, and auditing the
bootstrap into the tenant's log (IAM-059, IAM-060), and naming a Google-only tenant's administrator
before anyone has signed in, IAM-059's design with LIF's log; provider groups - the groups claim on
`identity_provider`, memberships brought into line at sign-in by difference, and the bound IAM-056 asks
for (IAM-009) - the provider groups plan's; `modesFor` (IAM-023, CNT-104 to CNT-106), the document view's
plan; levels for templates and documents, and so inheritance through the whole hierarchy (IAM-018,
IAM-024, TPL-006), each kind's plan, widening `artifact`; auditing every change to access and every
refusal (IAM-013, IAM-037, IAM-060), LIF's plan; moving an artifact (IAM-015, IAM-028), for which
`artifact_space_changed` already takes the lock, T2; and a space's name folding, and creating or renaming
a space, whichever plan adds the spaces routes.
