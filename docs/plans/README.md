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

| #   | Plan                                                                                            | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status          |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [The schema and its canonical form](2026-09-13-content-model-01-the-schema.md)                  | `packages/domain/src/content/model/`: thirteen closed marks, eight inline nodes, seven blocks, the root a version holds, the canonical serialisation `content_hash` rests on, migration as a read-time projection with a fixture per schema version, the output mapping every node must have a row in, and the promotion to the package's public surface                                                                                                                                                                                                                                     | Built (PR #79)  |
| 2   | [The admission pipeline](2026-09-15-content-model-02-the-admission-pipeline.md)                 | `packages/domain/src/content/admission/`: the report every stage appends to, the limits one admission is held to, a strict MathML reader keeping MathML Core that validation also asks of every stored equation, then sanitise, migrate, normalise, re-identify and validate in that order behind `admit`, and the product clipboard's reader and writer. No Word, Markdown or HTML reader, no editor, no route, no storage                                                                                                                                                                  | Built (PR #104) |
| 3   | [Footnotes and cross-references](2026-09-18-content-model-03-footnotes-and-cross-references.md) | In `packages/domain`, at content schema version 1 and in place: every identifier in a component unique, footnotes included (issue #122); a footnote holding no image and no footnote; a cross-reference with an identifier of its own, a closed target union of `block`, `component` and `node`, each held to where it may stand, and STR-055's `withoutPages`; re-identify giving a copied reference a new identifier and pointing it at the copy of what travelled with it; the contract regenerated. And STR-062, issue #73 reworded. No resolution, no numbering, nothing authors either | Built (PR #128) |

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

**Plan 3 is built.** Every identifier in a component - a block's, a footnote's, a footnote
paragraph's and a cross-reference's - is unique within it (issue #122), and a section title holds
its own to the same rule; a footnote holds no image and no footnote (issue #123), and is stored as
the parse reads it, so two spellings of one are one digest (issue #124); a cross-reference carries
an identifier of its own, a closed target union of `block`, `component` and `node`, each held to
where it may stand, and STR-055's `withoutPages`; and re-identify gives a copied reference a new
identifier and points it at the copy of what travelled with it, leaving one whose block did not
travel, or arrived twice, as it stands - counted in the report where the receiving component does
not hold its target - and allocates nothing a reference in the receiving component or the paste
still names. Every identifier, and the block a target names, is in NFC; two adjacent empty
paragraphs are refused in a footnote and a table cell as everywhere else; and a section title's
reference shows a number or a page, never a title that could loop. All of it is at content schema
version 1 and in place, on the evidence of a read-only query that nothing stored held either
construct. STR-062 landed from issue #73, reworded from identifying a target by the pair of
occurrence and block to resolving against exactly one occurrence, because a component does not know
where it is placed; it and STR-056 are claimed by structure.md and cited by nothing until numbering
resolves a target. What that is not: nothing authors a footnote or a cross-reference, and nothing
resolves one.

What plan 3 deliberately leaves, named so the next plan starts from a list rather than from a
reading of the diff: resolving a target and the named failure, for the numbering plan; checking a
`component` target at write, and pasting a cross-reference between components - where a `block`
target whose block did not travel resolves in the receiver - for the plan that first authors a
cross-reference; a component's reference to a section, which with the missing entry arm is why
STR-026 is not claimed; saying which of several occurrences a `component` target means, for a later
structure plan; a bibliography entry as a target, for LIB; bounding a block tree's depth on every
write path (issue #125), a small content-model fix; refusing a NUL or a lone surrogate in a
component's content rather than answering `500` (issue #127); and cleaning up after an interrupted
database test run (issue #126). A footnote admits the `condition`, `language`, `comment` and
`suggestion` marks, which CNT-129's closed list does not name, because they annotate text rather
than add content - a ruling made while building, and a walk rule to add before footnotes are
writable if it is wrong.

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
| 2   | [Managing grants](2026-09-17-access-02-managing-grants.md)                              | In `packages/db`, removing a grant under the lock-out guard, listing grants, roles and people, and migration 0013 refusing a change to access where a route only decides; in `packages/api-contract` and `apps/service`, `changesAccess`, targets named in a body or by a grant, and the grants, roles and people routes; in `apps/web`, a component's access page with an explanation per person. No invitations, groups, role changes, principal kinds, expiries or extensions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built (PR #112) |
| 3   | [Invitations](2026-09-17-access-03-invitations.md)                                      | In `packages/db`, migration 0014 - a principal made by an invitation before it has an identity, `email_verified`, and 0004's invitation reshaped - with inviting, renewing, listing, withdrawing, and claiming at the first verified sign-in through either route, without taking the access epoch; the lock-out guard counting only principals who have signed in; and the first administrator invited by address, retiring the naming by issuer and subject (IAM-059); in `packages/api-contract` and `apps/service`, the invitations routes and invited people; in `apps/web`, Invite someone on the access page; Ada invited by `pnpm dev:setup`, and Ivy in the stand-in; and IAM-072, inviting anybody. No mail, audit (IAM-060), expiry setting or inviting into a group                                                                                                                                                                                  | Built (PR #114) |

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

**Plan 3 leads with nine findings** - the most serious that IAM-059 asks only for the first administrator, and that a Google-only tenant cannot get one today - and eight decisions for Ken, the first of which reverses his ruling on naming the first administrator by issuer and subject.

**Plan 3 is built.** An administrator of the environment invites an address from a component's access page
and gives the person access before they first sign in; the first sign-in through either route, with an
address the provider verifies, has it. A tenant's first administrator arrives the same way. What it leaves is
listed at the end of the plan: sending the invitation, auditing the bootstrap (IAM-060), a tenant setting
for the expiry, marking somebody external after inviting them, and inviting into a group.

**Plan 2 is built.** An administrator gives a person a role at a component, its space or the whole
environment, and removes it, from the component's access page, which also says why a chosen person may or
may not do each thing. What it leaves is listed at the end of the plan: invitations to an address, which
IAM-059's design owns; managing roles, groups and a principal's kind, with the lock-out guard's other two
cases; extending a grant and the external listing (IAM-050, IAM-051); and Access on anything but a
component.

## Structure

The document, its outline, and everything positional computed over it, designed in
[structure.md](../design/structure.md). It comes after the editor's first two slices, because a
document's outline points at components and a component nobody can make is an outline nobody can
fill. The design claims forty-one requirements and is built in slices: the document and its outline
first, because numbering, captions, cross-references and the contents panel are each a pure function
over a tree that has to exist before any of them can be written.

| #   | Plan                                                                                    | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status          |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [The document and its outline](2026-09-18-structure-01-the-document-and-its-outline.md) | In `packages/domain`, `src/structure/`: the outline document's schema - one tree of sections and component references, each identified, each carrying its positional switches, a section title being inline content - its parse, its migration chain, its own canonical form where marks are a set, and the five operations as pure functions over a tree; a third arm in `VersionSubstance`. In `packages/db`, migration 0016 widening `artifact.kind`, `artifact_space_by_kind` and the author check, `document` as a content kind, the version chain branching three ways, and `createDocument`, `readDocument`, `listReadableDocuments` and `editOutline`. Four routes; in `apps/web`, the documents page and the outline panel with its keymap and undo stack. And STR-061, what a document is. No numbering, captions, cross-references, generated lists, deep links or cycle check | Built (PR #121) |
| 2   | [Numbering](2026-09-18-structure-02-numbering.md)                                       | In `packages/domain`, `src/structure/`: the numbering scheme and the product's default, the projection from a component's content to what it contributes, and `resolve`, `conditions` and `number` - one pure function over occurrences, a counter stack per matter, restarts, appendices and excluded nodes, and a numbering table whose every entry names what produced it. In `packages/db`, `numberingInputs`, resolving each occurrence with two reads of component versions and never reading a component the reader may not read. `GET /v1/documents/{id}/numbering`, withholding every number such a component could move. In `apps/web`, section numbers in the outline panel, and Numbered and Appendix beside each node. Nothing stored, no migration. No cross-reference resolved                                                                                             | Built (PR #133) |
| 3   | [Navigation](2026-09-18-structure-03-navigation.md)                                     | In `packages/domain`, `src/structure/lists.ts`: `contents` to a declared depth, every node numbered or not, and `listOf`, one sequence's entries with the caption a contribution now carries. `GET /v1/documents/{id}/contributions`, each occurrence's version and each version's contributions once, through `numberingInputs`, so nothing of a component the reader may not read is sent. STR-063, issue #119 narrowed to the service's share of the navigation budget, measured in the service suite at five hundred nodes. In `apps/web`, an address for every node, `#/documents/{id}/nodes/{node}`, that opens the document there, marks the node, survives a reorder and is copied by Copy link; and the lists of figures, tables and equations beneath the outline, numbered in the page. Nothing stored, no migration. No cross-reference resolved                              | Built (PR #136) |

Plan 1 leads with ten findings - the most serious that the version chain assumes every artifact that
is not a component is a definition, and that migration 0016 cannot alter `artifact_version` on a
fresh environment without flushing pending trigger events first - and eleven decisions for Ken, the
first of which is that numbering is not in this slice. It files one requirement, STR-061, since
nothing in the corpus declared what a document is.

**Plan 1 is built.** A person makes a document in a space they may create in, and builds its outline of
sections and component references by pointer or by keyboard, each act a version of its own and each
but a removal undoable; a second person's conflicting act is refused against the outline as it now
stands, and no document can be locked. Building it found ten more: the most serious that a removal
cannot be undone, because its inverse would need identifiers STR-003 forbids reusing, and that the
content model's marks rule, applied to the whole outline, would have sorted a section's metadata
field named `marks`; the canonical form is now composed member by member. What it leaves is listed at
the end of the plan: numbering, captions and cross-references, structure 2's, after a small
content-model change; the contents panel, generated lists and deep links, structure 3's; the cycle
check, the relationships plan's; a component version resolved for each reference; a document's own
title, language and direction changed after it is made; paging the documents listing; getting a
removed subtree back; and `Alt+Left` and drag and drop checked in a browser, with the rest of the
accessibility suite.

Plan 2 builds numbering and captions, and leaves resolving a cross-reference to **structure 4**,
planned beside the first editor slice that authors or renders one: resolution is small in code, but
what it shows a reader of a target they may not read is an access decision, and nothing would call
it yet. It leads with thirteen findings - the most serious that the design's cache key would serve a
stale figure number once a `latest` component moves on, and that a gap in the numbers would tell a
reader how many figures a component they may not read holds - and ten decisions for Ken. It stores
nothing; its code was run against a scratch database, numbering 330 nodes and 300 occurrences in a
median 19.6 ms. Structure 3 stays navigation.

**Plan 2 is built.** Every section and component in a document's outline shows its number, computed
in the page by the same function the service numbers with, so a move renumbers everything at once; an
author can take a node and everything under it out of the section numbering, and make a top-level node an
appendix. `GET /v1/documents/{id}/numbering` answers the whole table - sections, figures, tables,
equations and footnotes, each entry naming what produced it - and never reads a component the caller
may not read: every number it could have moved is `null`, for that caller, whatever it holds. That
rule is IAM-073, filed as issue #130 and landed here, narrowed to the numbers an outline produces.
Building it found nine more: the most serious that a scheme could print one label twice, and that a
caption before any numbered appendix printed a bare number repeating a body caption's; the scheme now
refuses the first, and such a caption takes no number. It also fixed issue #131, structure 1's drag
cancelled under load. What it leaves is listed at the end of the plan: resolving a cross-reference,
structure 4's; the contents panel, generated lists, deep links and the contributions route, structure
3's; a layout's scheme and bringing it to the panel, PUB's; conditions, REU's; resolving `approved`,
the revisions plan's; an explicitly unnumbered figure or table, issue #129; and the panel's new
controls checked in a browser.

Plan 3 builds navigation: a link to every node, the lists of figures, tables and equations, the
contributions route, and issue #119. It leads with twelve findings - the most serious that STR-034 is
claimed and answered only for the author's own acts, since another person's change reaches an open
page only when the author next acts or reloads, and that issue #119 as filed cannot be demonstrated,
because most of the time it budgets is the interface's and no suite here can measure an interface -
and thirteen decisions for Ken. It drops STR-034's claim, lands #119 as STR-063 narrowed to the
service's share, and files the interface's share as [issue #134](https://github.com/kenhayward/alloy-works/issues/134),
to land beside the browser suite. It stores
nothing; its code was run against the compose Postgres, where the service answered a document of five
hundred nodes at p95 17 ms, its contributions at 39 ms, its numbering at 45 ms and a move at 32 ms,
and, bundled into Electron's Chromium over a fake service, the page opened it at p95 110 ms and
answered a move at 91 ms.

**Plan 3 is built.** Every node in a document's outline has a link,
`#/documents/{document}/nodes/{node}`, that opens the document with that node chosen, focused and
marked, survives a reorder, and is copied with **Copy link**; a node the address names that is no
longer in the document says **The linked part is not in this document.** Beneath the outline, the
document lists its figures, tables and equations, each with its number and caption, renumbered at
once when anything moves; `GET /v1/documents/{id}/contributions` answers what the numbering route
reads, so the page numbers no caption from a component the reader may not read. Beyond the plan's
twelve, building it found a list entry that did nothing when it named the address already shown,
now taken as an arrival again, and each task's review found behaviour the tests did not yet pin -
among them the guard that takes an arrival once, the literal size STR-063 states, and the lists
renumbering before the service answers - each pinned before the task was accepted. What it leaves is listed at the end
of the plan: resolving a cross-reference and a component's reference to a section, structure 4's;
another person's outline change reaching an open page, the plan that puts document versions on the
stream; the interface's share of the navigation budget, issue #134 and the browser suite; tracking
the reader's position as they scroll and a link into the body, the document view's; a published
contents and lists, PUB's; expanding and collapsing the tree, the accessibility plan; and a pinned
reference named by its pinned version's title, issue #135.

## The editor

Opening, editing and saving components, designed in [component-editor.md](../design/component-editor.md)
over [storage-and-versioning.md](../design/storage-and-versioning.md)'s iterations. It comes after access,
because every route it adds is checked, and its first plan builds the least of that design a person can
use honestly - with the lock and iterations, because a version must be promoted from an iteration - so
that each later slice arrives into something that runs.

| #   | Plan                                                                            | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status          |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | [Open, edit and save](2026-09-16-editor-01-open-edit-and-save.md)               | `packages/editor`: a schema for paragraphs of text, the mapping that refuses what it lacks, the identity plugin, no two adjacent empty paragraphs, and a view that refuses paste; in `packages/db`, `component_lock` and the insert-only `iteration`, claiming, saving under the sequence rules, cutting from the latest iteration and releasing, the readable listing, and a component Ada and Grace may edit in development; six routes, request bodies in the contract and refusals carrying members; and in `apps/web`, the session as a state machine, the save indicator, the editor and the list. No creating, paste, marks, lists, tables, equations, metadata panel, recovery or undo across a reload                                                                                                                                                                               | Built (PR #106) |
| 2   | [Creating a component](2026-09-17-editor-02-creating-a-component.md)            | In `packages/db`, migration 0015 - a component type in every environment, _Topic_, assigning no schemas, and the row declaring it the default (MET-012), with a definition the environment itself started with authored by nobody - `createComponent` writing version 0.1 with one empty paragraph and every default the type resolves to, and the definition loader cutting already used, lifted out to be shared; in `packages/api-contract` and `apps/service`, `GET /v1/spaces` with who may create in each, `GET /v1/spaces/{space}/component-types` decided by `create` on the space, and `POST /v1/spaces/{space}/components`; in `packages/editor`, the title, base language and base direction changed as steps; in `apps/web`, New component on the list and a component header above the surface. No managing component types, no metadata panel, no idempotency key, no deleting | Built (PR #117) |
| 3   | [Marks, hyperlinks and language marks](2026-09-20-editor-03-marks-and-links.md) | In `packages/editor`, ten marks in the schema, a mapping carrying a run per mark set, one command registry feeding both the keymap and the toolbar, and a fresh identifier on every application; in `apps/web`, a formatting toolbar that is one tab stop, the link and language prompts with their refusals, and `F6` between the component header, the toolbar and the surface; in `packages/domain`, a published run carrying its marks as `publishing/3`, refusing a language tag the engine cannot carry; and in `apps/worker`, template `publication/3` setting them, checked through veraPDF. No lists, tables, quotations, preformatted text, footnotes, equations or paste, no defined term or citation control, and no monospace face                                                                                                                                              | Built (PR #n)   |

**Plan 3 is the first slice that reaches the published half in the same pull request**, because there
is no point in an author writing formatting a publication drops: it carries a run's marks through
`publishing/3` and template `publication/3` as well as building the editor that makes them. It was
planned under the new method and its pre-flight found 27 problems before any of it was built, six of
them critical - the sharpest that Typst's `raw()` **replaces** its body rather than wrapping it, so
applying inline code inside the fold over a run's marks would have thrown away every mark already
applied, silently, in a PDF. What building it found was mostly about identity. A mark identifier names
one annotation over one contiguous range, and three separate gestures could leave one in two pieces -
typing at the end of a non-inclusive mark, removing a mark from the middle paragraph of three, and a
transaction from outside the editor's own commands - so the invariant is restored by a plugin after
**every** transaction rather than by each command, which retired a repair that was solving a problem
already solved. It lands CNT-152 (#155), rewords CNT-085 to its first clause, and names in
[component-editor.md](../design/component-editor.md) the half of the same harm still unwarned - a
component's own base language, filed as #156. What it leaves is listed at the end of the plan.

**Plan 2 led with ten findings** - the most serious that no environment holds a component type at all,
so MET-011's choice has nothing to choose and nothing outside development can be created - and nine
decisions for Ken, the second of which is that MET-012 is built and deliberately not claimed, because
nothing yet lets a tenant declare anything. It files one requirement, CNT-149, since nothing in the corpus
asked for creating a component. Building it found two more: a title of whitespace alone passes the content
model's own rule, so creating and editing hold one trimming agreement between them; and a field showing
the title or the language cannot mirror the document back as it is typed, because the model trims one and
refuses an unfinished tag.

What plan 2 leaves, named so the next plan starts from a list: managing component types and a tenant
declaring its own default, which is what makes MET-012 claimable, the definitions-management plan's;
changing a component's type (MET-014); the metadata panel; a BCP 47 picker and a direction defaulting
from the language's script, LOC's; confirming a change of base language, the marks plan's; an
idempotency key on creating (API-008); deleting a component, LIF's; creating or renaming a space; and,
found while building, a component's id in a path validated as any-case where a space's is lowercase-only
and `saveIteration`'s own already is, which is a refusal moving from 404 to 400 on the four routes that
take it and wants a change of its own.

Plan 1's findings and what it left follow.

The plan leads with eleven findings against the designs - the most serious that nobody outside
development can be granted `edit`, since no route grants a role - and five decisions for Ken.

What this plan deliberately leaves undone, named so the next plan starts from a list rather than from a
reading of the diff: granting `edit` outside development, and `RouteAccess` declaring a route that changes
access, the access management plan's; creating a component - reading component types when creating, the
tenant's default type (MET-012), MET-011 and the component header - editor 2's; undo across a reload, Recovery
and the iterations listing, and lock events on the stream (CNT-069, CNT-103, CNT-067, CNT-090, VER-002,
COL-007) - and with them, telling either window of two of the same author's about the other's saves once the
lock has moved between them - editor 4's; paste through the admission pipeline with its report (CNT-063), editor
5's; lists, tables, block quotations, preformatted text and footnotes, one plan per family, the toolbar
and keymaps (CNT-077) having arrived with the marks plan; equations and the #103 ruling, the equations plan's; the metadata panel
(MET-033, MET-036), its own plan's; retention and the lock period as tenant settings, the sweep - which may
remove an iteration only once it is past retention and a later version exists - and an iteration's retention
counted from the cut (VER-003, VER-004, COL-008), storage 2's; idempotency keys (API-008), service
foundations'; the desktop's checker languages (CNT-147, CNT-148); the accessibility suite and audit (CNT-078,
CNT-139) and autosave measured under load; a theme for a component opened on its own; a repository-wide
policy for how every future error code is spelled, this plan's own six having settled on an underscore at
the wire (decision F) rather than waiting for one; and retiring the scaffolding's `createComponent`.

## Publishing

A document version to a PDF somebody can download, cite and keep, designed in
[publishing.md](../design/publishing.md) as Ken's answer of 2026-09-19 amended it. It comes after
structure, because a publication is an outline numbered by `number` with each component's content
beneath its reference, and both had to exist first. The design claims forty-seven requirements and is
built in seven slices: a document to PDF first, then the layout, the rest of the content, themes and
typefaces, accessible output checked on every publication, preview, and Word.

| #   | Plan                                                                           | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status          |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1a  | [A document to PDF](2026-09-19-publishing-01-a-document-to-pdf.md) (tasks 1-4) | veraPDF over nine heading levels, first, and the regression corpus it starts (levels seven to nine pass, read to assistive technology as paragraphs; PUB-090 stays unclaimed, not reworded); Liberation Serif pinned by hash into `apps/worker/fonts`, re-checked before every compile, and the worker refusing to start or compile without it (#145); a job refused on its merits finished at once, never retried (#146); in `packages/domain/src/publishing/`, the published document's types and `assemble`, resolving language and refusing a tag the engine cannot carry, and checking every character against the pinned faces before Typst runs - called by nothing yet                                                                | Built (PR #150) |
| 1b  | Same plan, tasks 5-11                                                          | in `packages/db`, migration 0017, the Publisher role, a request resolved as its publisher that refuses a component they may not read by its place alone (#143), and the immutable record; the fixed template and the publish job, wiring 1a's `assemble` in; every page saying **Not approved** (#142); four routes, the publishing panel on the document page and a publication's own page                                                                                                                                                                                                                                                                                                                                                   | Built (PR #151) |
| 2   | [The layout](2026-09-19-publishing-02-the-layout.md)                           | Outline schema 2 with `front` matter, first and numbered in its own scheme (#152, STR-064); in `packages/domain`, the layout closed at its first version and the product's default; migration 0018 seeding it in every environment and recording it on each request and publication; a document refused at the door in another language than its layout (#144, PUB-095) or for a format it does not make; template `publication/2` with the page, a cover, running heads and feet, page numbering per matter in chains and a contents tagged as one; and the layout's scheme reaching the routes, the outline panel and its lists, with **Matter** beside a top-level node. Lists of figures and caption labels move to slice 3, with figures | Built (PR #153) |

Plan 1 leads with fifteen findings - the most serious that PUB-085's ten seconds and PUB-091's veraPDF on
every publication cannot both hold while veraPDF starts cold in eleven seconds, and that headings at
levels seven to nine pass veraPDF and are read to assistive technology as paragraphs - and sixteen
decisions for Ken, the first of which is to publish deep documents as the engine tags them and keep
PUB-090 unclaimed. Its load-bearing code was run before it was committed: nine levels through veraPDF,
fifteen characters through `assemble` and the engine, a publish through the queue, the store and Typst
in 385 ms, 208 pages compiled in 425 ms, the request refusing by place, and the routes and the page
against the service and the renderer's suites. Ken split it into two pull requests: **1a** fixes #145
and #146 and publishes nothing a person can see (0.29.2, a fix release); **1b** lands #142 and #143 as
rows and is where publishing a person can see arrives, making #147 no worse by putting nothing on the
stream (0.30.0).

**1a**, built: the nine-level regression case passes every veraPDF PDF/UA-1 machine rule (106 rules, 0
failed), so PUB-090 stays unclaimed with the gap named rather than reworded to fit the engine, exactly
as Ken's answer A asked. The pinned faces are re-checked before every compile, not only at start-up,
because the worker's own user can write to them at runtime (`deploy/Dockerfile`); a face that fails
that check is retried like any other platform failure rather than refused outright. `assemble` refuses
a language tag the engine cannot carry - naming it, never shortening it - reversing what the plan
proposed (decision K), and refuses a character the pinned Typst refuses under PDF/UA-1 with the pinned
faces, and additionally U+FEFF, U+FFFE and U+FFFF. The characters it lets through with no glyph are
4,170 code points in 19 ranges; the fix round added 4,142 of them in 14 ranges, each range compiled on
its own with the pinned Typst. PUB-085 is no longer claimed: with a cold veraPDF at 11.2 s a page it
cannot hold alongside PUB-091, and Ken deferred that choice to slice 5. `assemble` itself is built
and tested but wired into no job: publishing still produces nothing a person can see until 1b.

**1b**, built: a person who may publish a document presses **Publish as PDF** beneath its outline and,
a second or two later, has a tagged PDF of the version on the page - its title, its sections numbered
and bookmarked, each component's paragraphs beneath its heading - that says **Not approved** at the
top of every page and once where a screen reader reads it (#142, landed as PUB-093). The publication is
an artifact in the document's space, read on its own grants, listed with the document and opened at
its own address with a download named by its id. A publish holding a component its publisher may not
read is refused, naming the place and nothing of the component (#143, landed as PUB-094, with IAM-074
withdrawn for it). Nothing goes on the stream: the requester asks until the request is done, so #147 is
made no worse. Building it found that the database, not only the grants, had to hold the record: a
caught error part way through recording could otherwise have committed half a publication, and the
runtime role could have added inputs to a finished one, so migration 0017 gained triggers that finish
a request once and refuse at commit a publication not recorded whole. The document's title, which
Typst tags as a paragraph, became a level-one heading before anything was published, re-pinning the
template's first version; a record the database refuses is the store's failure, not the engine's; and
a failure of the engine or the store is introduced on the page as the product's, never as the
document's. Three stored-shape gaps reachable only by SQL are named in publishing.md rather than
closed. It cites PUB-021, PUB-047, PUB-048, PUB-050, PUB-053, PUB-061, PUB-062, PUB-063, PUB-093,
PUB-094 and PUB-086's engine and store stages; 1,382 requirements, 193 citations. What it leaves is
listed at the end of the plan: the layout, publishing 2's; marks, hyperlinks and language marks, which
the marks plan took early, with the editor that writes them; every other block, publishing 3's, with
PUB-003; the theme and its typefaces, publishing 4's; veraPDF on every
publication and its report kept, PUB-085 settled and floats' reading order, publishing 5's; preview,
publishing 6's; Word and PUB-073, publishing 7's; sweeping finished requests and unreferenced objects;
a stop for the page's asking; a download link that outlives five minutes; the desktop app's handling
of the download, unchecked; per-viewer events on the stream (#147); contributions after conditions
(#148); and a publication shared outside the tenant (PUB-084).

**2**, built: a publication is laid out. It opens with a cover carrying the title, then a contents
page Typst tags as a table of contents, then the document; every page after the cover carries a
running head with the title and the part it is in and a foot with the revision and the page; and
pages are numbered per matter, roman through the front matter and from 1 in the body. All of it comes
from a **layout**, a new kind of artifact versioned by the chain, seeded as version 0.1 by migration
0018 in every environment and declared by a singleton, whose exact version each request and each
publication records. An outline gained a third matter, `front`, which must come first and stay at the
top level (#152, STR-064), with its own rule per sequence in the numbering scheme, and the panel
offers it: **Matter** beside a top-level node, Front matter, Body or Appendix, in place of the
**Appendix** tick box. A publish is refused at the door for a format the layout does not make or a
document in a language the layout's words are not written in (#144, PUB-095), naming both tags.

**The layout's scheme reaches the page, which is what makes STR-036 citable at last.** The document
view answers the document's layout - its version, its language and its scheme - the numbering route
numbers with that scheme and names the version, and the panel and its generated lists number with it
rather than with the product's default. The panel's test numbers an outline under a second layout
version and compares every number it shows with what `assemble` makes of the same outline under the
same layout, so "numbering as it will publish" is demonstrated by one function's output rather than
by two things agreeing. A layout that will not read is a 500 and a scheme the page cannot parse
numbers nothing and says so: a fallback to the product's default was ruled out, because it would show
numbers no publish could produce, which is the one thing that requirement exists to prevent.

It was planned under a new method - briefs carrying interfaces, test titles, assertions and exact
words, with the implementer writing the code - and the pre-flight that followed found 28 problems in
the plan before any of it was built, two of them critical: both were Ken's own answers, taken in the
plan's decisions section and never threaded into the task briefs extracted from it. The sharpest
finding was in the migration. The plan closed the new columns with a `NOT VALID` check, which reads
as "only rows written from now on" and is not: Postgres applies such a check to every row an `UPDATE`
writes, so a publish queued before the migration could never have been moved to `done` or `failed`
and would have sat unfinishable for ever. It is closed by a check on the pair and a before-insert
trigger instead, nothing existing is updated, and a request made before layouts still publishes
through template 1, byte for byte, which a test proves against the digest the first slice pinned.
Three more came out of building it: page numbers have to run in **chains**, because Typst has one
page counter and an outline may return to a matter it left; the contents has to be Typst's own
`outline` rather than a list of our own, because only that is tagged `TOC`/`TOCI` and heard as a
contents; and a glyph or a language the **layout** brings needs its own failure, because no change to
the document would fix it. A fourth came from the release itself: **`pnpm trace generate` has to run
after prettier, never before** - reformatting a test file shifts the citation line numbers the model
records, and `pnpm trace pins` cannot catch it, because the counts stay right and only the lines are
wrong. It cites PUB-007, PUB-008, PUB-009, PUB-011, PUB-014, PUB-037, PUB-079, PUB-088, PUB-095,
STR-013 and STR-036; 1,384 requirements, 408 claims, 205 citations. What it leaves to slice 3 is the
lists of figures and tables and caption labels, which need figures to be publishable first.
