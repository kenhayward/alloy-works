# Storage 1: the version chain

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every versioned thing a permanent, insert-only chain in its tenant's schema: spaces,
artifacts, and versions that record their author, time, note, schema version, content and metadata,
the definitions they were written against and two digests - with the functions that create an
artifact at `0.1`, read a version back, and record the next one or say why not.

**Architecture:** `packages/domain` gains the canonical serialisation of a whole version, composed
from the content model's and the metadata rules' own canonical forms, and stays platform-free.
`packages/db` gains a dependency on it, hashes with `node:crypto`, and holds two tenant migrations -
`space` and `artifact`, then `artifact_version` and `version_definition` with the grant that makes
the chain insert-only - and the functions that write and read the chain inside `withTenant`. Before
those functions are written, a load test measures inline JSONB at a stated authoring volume, and its
result decides whether the plan continues as designed.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Vitest 5. One
new workspace dependency: `@alloy-works/db` on `@alloy-works/domain`. No new third-party dependency.

**Spec:** [`../design/storage-and-versioning.md`](../design/storage-and-versioning.md), with
[ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md) (the two digests). Read with
[access.md](../design/access.md), "Spaces" and "Stores" (a content artifact belongs to one space, a
definition to none); [metadata.md](../design/metadata.md), "Canonical form", and the built
`packages/domain/src/metadata/` (`definitionsFor`, `canonicaliseValues`, `canonicaliseNotCarried`);
[component-editor.md](../design/component-editor.md), "Cutting a version" and "Creating a component"
(what the store answers); and [service-foundations.md](../design/service-foundations.md), "Database
roles", "`withTenant`", "Migrations" and "Verification".

First of the storage plans. It builds the chain and nothing that sits on it: no iteration, no lock, no
revision, no baseline, no route and no screen. Those have their own plans, named at the end.

**The code below was run before the plan was committed.** Against `main` at 0.19.0 (merge `ff2a4ea`),
every block was applied in task order: the domain suite passed (282 tests), the database suite (101)
and the service suite (102) passed against the compose Postgres, `pnpm build`, `pnpm typecheck`,
`pnpm lint`, `pnpm format` and `pnpm trace check` were clean, and the trace suite passed with the pin
at 112. The worker suite's six Typst tests could not run, because that checkout had not fetched the
pinned binary; its database tests passed. The citation counts each task names were measured from a
regenerated `trace.json` rather than estimated, and the load test was run once at the volume task 5
states - its numbers are in [the outcome](#task-5-outcome-measured-when-this-plan-was-written). Then the code was
removed, so the plan's tasks can be executed test first. It is still worth watching each test fail: the
run proves the code, not that the order of an executor's steps did.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail. A test that passes before the implementation exists is testing nothing. The
  one exception is task 5's load test, which measures rather than specifies: it is run against the
  schema tasks 3 and 4 built, and its thresholds are the specification.
- **Name the requirement in the `describe` or `it` title**, as `it('VER-007 records who cut a version,
...')`. `packages/trace` scans titles; an identifier in a comment is a mention, not a citation.
- **Cite only what storage-and-versioning.md owns, and only when the test demonstrates that
  requirement's own statement** - not a requirement nearby. The table in
  [Requirements this plan cites, and those it does not](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier. `pnpm trace check` fails on a citation of
  a requirement no design claims, but it cannot catch a citation of one a design claims and the test
  does not show, so that is the reviewer's check.
- **Every read and write path has a cross-tenant test** (service-foundations.md, Verification; IAM-004):
  a second tenant tries the path with the first tenant's ids and is refused or sees nothing. The tests
  do not cite IAM-004, whose statement is about every path in the product and is service-foundations.md's.
- **Insert-only is a grant, and it is tested as a grant**: the runtime role attempts `UPDATE`, `DELETE`
  and `TRUNCATE` and Postgres refuses with `permission denied`. A test that only shows the application
  never issues an update is not the test.
- **`packages/domain` stays platform-free.** No `node:crypto`, no `fs`, no clock, no I/O in production
  code. Hashing is `packages/db`'s (docs/architecture.md, the content model).
- **A migration is never edited once it has shipped.** 0007 and 0008 are new; if `main` has gained a
  0007 by the time this is executed, renumber these two before the first commit, never the one on
  `main`. A later change to the chain is a later migration.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Leeds`, `York`; the load test's
  text is generated from invented syllables.
- **No em or en dashes in user-facing text.** Nothing here reaches a user yet; error messages use a
  plain hyphen anyway, because the service will pass some on. Code comments are exempt.
- **A passing run has no errors or warnings.** The load test prints its report with `console.info`
  on purpose, and only when run by hand.
- **`pnpm install --frozen-lockfile` in CI.** Task 2 changes `pnpm-lock.yaml` with a plain
  `pnpm install` and commits it in the same commit as the `package.json` it follows.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump, one changelog entry**, in the last task. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show VER-0NN` for any requirement named.
- **The database suite needs Postgres, and the root `pnpm test` needs the object store too.** Once per
  session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. The domain suite
  needs neither. Database test files run one at a time, because they share the cluster's login roles:
  **never run the load test and the database suite at once.**
- **`pnpm --filter @alloy-works/db test` does not build the domain package first.** The database
  package now imports `@alloy-works/domain`'s `dist/`. After changing the domain package, run
  `pnpm --filter @alloy-works/domain build` before a filtered database run, or go through `pnpm test`.
- **`trace.json` is drift-checked and the citation count is pinned.** Every task that adds a cited title
  runs `pnpm --filter @alloy-works/trace generate` and moves the pin in
  `packages/trace/src/trace.test.ts` in the same commit. The numbers each task gives were measured
  against 103 citations on `main` at 0.19.0; if `main` has moved, set the pin to what the regenerated
  file holds and say so in the commit.

---

## Decisions taken before this plan was written

storage-and-versioning.md settles the chain. It leaves some shapes to the plan, and a reviewer should
be able to reject each of these on its own, so they are stated rather than buried in code.

**1. The serialisation is the domain's; the hashing is the database package's, which now depends on
the domain.** ADR-0024 says "the domain package owes a canonical serialisation of the version record",
and docs/architecture.md says hashing is not in the domain because `node:crypto` is not platform-free.
So `canonicaliseVersion` lives in `packages/domain/src/version/` and returns a string, and
`versionDigests` in `packages/db` hashes it. The alternative - the service computing digests and the
store trusting them - would let a caller write a digest that does not match its row, and would make the
store's `version.unchanged` answer depend on a number it never checked. `@alloy-works/db` therefore
gains `@alloy-works/domain` as a dependency; Turborepo's `^build` already builds the domain first, the
images copy every package manifest, and `pnpm deploy` carries the domain's `dist/` into the service and
worker trees.

**2. The version record is one canonical JSON document of five members, composed rather than
serialised whole.** `{"componentType","content","definitions","notCarried","values"}`, in that
(lexicographic) order, each member in its own canonical form: content by `canonicalise`, where `marks`
is a set; values by `canonicaliseValues` and `notCarried` by `canonicaliseNotCarried`, where no array
is; definitions sorted by kind, identifier and version, with a definition named twice refused. Composing
is necessary, not stylistic: `canonicalJson` over the whole object with content's array rule would sort
the values of a metadata field whose identifier is `marks`, which MET-030 forbids. **`componentType` is
derived from the definitions** - the version of the one `componentType` entry, and a component version
naming none or two is refused - so the column and the recorded definitions cannot disagree. **A
definition version takes the same five members** with `null`, `[]`, `[]` and `{}`, so every row's digest
has one shape. There is no format marker inside the serialisation: a version digest is only worth
anything if the rule never changes, so the rule is pinned by two tests that are never edited (the exact
string in the domain, the exact hex in the database package), and changing it is a superseding decision
record.

**3. The chain holds four kinds today: `component`, `field`, `metadataSchema`, `componentType`.** They
are the kinds with a stored shape in the domain. A document, an outline, an asset or a query definition
admitted now would be unvalidated JSON in a permanent, insert-only table. Each arrives with the plan
that gives it a shape, by a migration widening two check constraints - an expanding change. The
spellings are the domain's `DefinitionKind` values, so nothing translates between `metadataSchema` and
`metadata_schema`. It follows that **VER-011 is not cited**: its statement names documents, outlines,
assets, query definitions, themes, layouts and templates, and none of them is here.

**4. A definition's payload `id` is its artifact's id.** metadata.md gives every field, schema and type
an `id` "never reused", and a version records the definitions it used as `{ kind, id, version }`.
If the payload's `id` and the artifact's id could differ, the `id` in a version digest would name
nothing the database could check. So `createArtifact` creates a definition artifact with the payload's
`id`, which must be a UUID; `recordVersion` refuses a definition version carrying another; and
`version_definition`'s composite foreign key to `artifact_version (id, artifact_id, kind)` makes all
three members of each recorded definition exactly what is stored. The domain's fixtures keep readable
identifiers such as `field-study`: the domain never required a UUID, and still does not.

**5. `artifact_version` carries its artifact's `kind`,** kept equal to the artifact's by a composite
foreign key. A check constraint cannot read another table, and three rules depend on kind: a component
records a component type and nothing else does; only a component carries metadata values; and a
recorded definition is a definition. The alternative, triggers, puts rules where a reader of the schema
does not look.

**6. The row stores the parsed content, and the digest is over the row.** `parseContentDocument` and the
definition schemas fill defaults (a text node's `marks`, a paragraph's `style`), so the stored JSON and
what the caller handed in can differ. The version holds what was validated, and both digests are over
that. Recomputing (VER-042) reads the row's content **as stored, never migrated**: migration is a
read-time projection (CNT-012), and a digest over the projection would stop matching the day the first
migration ships. **Metadata values are not validated by the store**: whether a value is valid is
`validate`'s, which the service runs, and a version may hold a value that fails it (MET-023 fails the
publish, not the save). The database checks only what it can: values are an object and `notCarried` a
list.

**7. Numbering: `0.1` at creation, then the next `version_no` within the latest version's revision.**
component-editor.md creates "version `0.1`", VER-015 says a version never designated carries revision
0, and VER-009 numbers versions within their revision. What a version cut after a designation is
numbered - `1.1`, or the next number continuing - is not written anywhere, and designations are not in
this plan. So this plan numbers within revision 0 and **does not cite VER-009**: its statement is about
every revision, and the numbering after the first designation is a gap for the revisions plan to settle,
not a rule to guess here.

**8. Two cuts from one version take turns on a transaction-scoped advisory lock.** `recordVersion` takes
`pg_advisory_xact_lock(hashtextextended('alloy-works:artifact:' || id, 0))` before reading the latest
version, so the second of two concurrent cuts reads the first's committed version and is answered
`version.precondition` rather than colliding on `(artifact_id, revision_no, version_no)` with a unique
violation that aborts its transaction. `SELECT ... FOR UPDATE` on `artifact` was the obvious choice and
does not work: it needs `UPDATE` privilege, which task 3 revokes. A 64-bit hash collision between two
artifacts - possibly in different tenants, since advisory locks are per database - costs a moment's
wait and nothing else. The editor's lock (COL) is the real guard against two authors; this makes the
store correct without it.

**9. The load test's volumes and thresholds** - the design's open question asks "whether inline JSONB
holds up at authoring volumes", answerable "by load rather than by argument". The corpus states two
numbers to argue from: REL-031 and SCH-033 budget an interactive read at **p95 250 ms, never above 500
ms, for a tenant of a million components**, and PUB-064 budgets **a 300-page document at thirty
seconds** to publish. Everything else is an assumption, stated here for Ken to change, and each lives
once as a constant at the top of `packages/db/src/load/version-chain.load.ts`:

| Assumption                   | Value                                                                                                   | Why                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Components loaded            | **200,000** (`ALLOY_LOAD_COMPONENTS`, default 20,000 for a quick check)                                 | A fifth of the corpus's million-component tenant: large enough that the chain outgrows the Postgres container's memory, small enough to load on a laptop. The storage result is projected to a million; latency is not, see the outcome's limits |
| Versions per component       | 40% 1-2, 35% 3-6, 20% 7-15, 5% 16-40 (mean about 5.8)                                                   | A component is cut when somebody decides something (the design), not on every save: most are cut a handful of times, a few are revised for years                                                                                                 |
| Content size, canonical JSON | 70% 0.5-4 KB, 25% 4-32 KB, 4.5% 32-128 KB, 0.5% 128 KB-1 MB, log-uniform within each (mean about 11 KB) | A 300-page document at about 500 words a page is 150,000 words over about 900 components - around 1 KB of text each, doubled by node and mark structure - with a tail of large tables, which dominate the bytes                                  |
| Metadata-only versions       | 20% of the versions after the first                                                                     | ADR-0024's case: a value corrected, content untouched. Stored inline in full, since nothing deduplicates yet                                                                                                                                     |
| One document                 | 900 component versions                                                                                  | PUB-064's 300 pages at three components a page                                                                                                                                                                                                   |

| Measure, each through `withTenant` as the runtime role                       | Pass when                                    | Derived from                                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Cut**: advisory lock, read the latest, insert a version and its definition | p95 at most **50 ms**, none above **500 ms** | The interactive budget's 250 ms, of which storage may take a fifth: the service, the network and the renderer take the rest            |
| **Open**: the latest version of a component, content and values              | p95 at most **50 ms**, none above **500 ms** | The same                                                                                                                               |
| **Document**: the content and values of 900 versions, in one query           | p95 at most **1,000 ms**                     | A thirtieth of PUB-064's thirty seconds, leaving the rest to resolution, layout and Typst                                              |
| **Digests**: the digests of the same 900 versions, without content           | p95 at most **100 ms**                       | Comparison's short-circuit (ADR-0024) reads these; inline content must not tax a read that does not need it                            |
| **Storage**: the chain's on-disk size, projected to a million components     | at most **250 GB**                           | An assumption: the size at which one tenant's chain stops fitting a mid-sized managed instance's storage and backup window comfortably |

**If every measure passes, the plan proceeds as designed.** If any fails, stop after task 5: commit the
load test and its recorded result, do not start task 6, and take the numbers to Ken. A failure is ADR-0024's "What would change the answer" arriving, in its words "inline JSONB not
holding up at authoring volumes", and the content hash is what makes extracting payloads to a
content-addressed store a move rather than a migration. That is a design change with its own decision record, not a fix inside this plan.

**10. The store answers with values, and throws only for a caller's bug.** `recordVersion` returns
`recorded`, `version.unchanged`, `version.precondition` (naming the current version) or
`artifact.missing`, in that precedence after the lock: an artifact the tenant does not hold, then a
stale opened-from version, then a digest equal to the latest. component-editor.md checks the
precondition before computing anything, so a stale request that also changes nothing is told it is
stale - which is the answer the author can act on. The codes are component-editor.md's, so the service
passes them into its error shape unchanged. A substance of the wrong kind, content that does not parse,
a component naming no component type, or a definition carrying another identity are bugs in the caller
and throw. A foreign key refusing an author or a definition from another tenant is also a throw, because
the service resolved those ids from this tenant before calling.

**11. metadata.md's third open question - whether `09:00` and `09:00:00` are one value in the digest - is
answered: they are two.** The digest compares canonical bytes, exactly as `sameValue`, `fixed` and
default comparison already do, so the refusal of an unchanged version and those rules cannot disagree
about what "the same value" means. If metadata.md later decides the two spellings are one value, the
answer is to canonicalise a time where it is entered, as `canonicaliseDecimal` does for a number - the
stored value then changes and the digest follows it, with no change to the serialisation. No rule in metadata.md changes; task 8 records the ruling in its Open questions table as that
question's answer.

**12. Smaller shapes the design names but does not draw.**

| Name                               | Shape chosen                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A space's name                     | Unique within the tenant exactly as written, not empty, no surrounding spaces. Case and Unicode folding are the access plan's to decide, with the route that creates a space                                                                         |
| The _General_ space                | **Not created here.** access.md gives every new tenant one; creating it, renaming it and who may do either are the access plan's                                                                                                                     |
| Changing an artifact               | `UPDATE` on `artifact` is revoked: its kind is what every version agrees on, and moving content between spaces is not designed. `DELETE` stays granted and is refused by the version's foreign key, since every artifact has a version from creation |
| A version's author                 | `author_id` referencing `principal` with `on delete restrict`: erasure changes a principal's details and never deletes the versions it cut (VER-038's direction)                                                                                     |
| The timestamp                      | `created_at timestamptz default now()`: the start of the transaction that cut it                                                                                                                                                                     |
| The note                           | Optional, and never an empty string. Its length is the API's to bound                                                                                                                                                                                |
| The schema version                 | A column, and a check that it equals `content ->> 'schemaVersion'`, so it cannot be a second opinion (VER-010)                                                                                                                                       |
| A definition version's definitions | None: `version_definition` is written for components only. Whether a schema version records the field versions it grouped is the definitions-management design's                                                                                     |
| Revoking from the runtime role     | `format('revoke ... from %I', current_schema())`: a migration does not know the role's name, and `tenantNames` makes the schema and the runtime role one name. The grants test proves the revoke reached the role the service uses                   |
| The Kysely row types               | Every column of `artifact_version` and `version_definition` has update type `never`, so an update does not compile, as it would not run                                                                                                              |

---

## Files

| File                                                          | Responsibility                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/version/substance.ts`                    | `VersionSubstance`, `componentTypeOf`, `canonicaliseVersionContent`, `canonicaliseVersion`               |
| `packages/domain/src/index.ts`                                | Modified: promotes the three functions and three types                                                   |
| `packages/db/package.json`, `pnpm-lock.yaml`                  | Modified: `@alloy-works/domain` as a dependency; `test:load`                                             |
| `packages/db/src/version-digest.ts`                           | `sha256Hex`, `versionDigests`: the only place a digest is computed                                       |
| `packages/db/migrations/tenant/0007_spaces_and_artifacts.sql` | `space`, `artifact`, its check over kind, and the revoked update                                         |
| `packages/db/migrations/tenant/0008_version_chain.sql`        | `artifact_version`, `version_definition`, their constraints, and the revoked update, delete and truncate |
| `packages/db/src/artifact-kind.ts`                            | `artifactKinds` and `contentKinds`, the lists the check constraints name                                 |
| `packages/db/src/spaces.ts`                                   | `createSpace`                                                                                            |
| `packages/db/src/tables.ts`                                   | Modified: the four tables' row types                                                                     |
| `packages/db/src/versions.ts`                                 | `createArtifact`, `readVersion`, `latestVersion`, `substanceOf`, `recordVersion`                         |
| `packages/db/src/index.ts`                                    | Modified: the package's public surface                                                                   |
| `packages/db/src/load/generate.ts`                            | A seeded generator of valid content at a target size                                                     |
| `packages/db/src/load/version-chain.load.ts`                  | The load test                                                                                            |
| `packages/db/vitest.load.config.ts`                           | Runs only the load test, outside `pnpm test`, with no JSON report                                        |
| `packages/db/tsconfig.json`, `tsconfig.build.json`            | Modified: the load config typechecked; `src/load/` kept out of `dist/`                                   |

Each production file has a `.test.ts` beside it, except `artifact-kind.ts`, which `spaces.test.ts`
checks against the database's own constraint. Test setup - two tenants, a principal, a space - is
repeated in each database test file, as the existing ones do: a shared helper would be compiled into
`dist/testing/` and exported.

## How the design's commitments become tests

| storage-and-versioning.md and ADR-0024 say                                        | Where                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A content artifact belongs to exactly one space, a definition to none (access.md) | Task 3, over every kind                                                               |
| `artifact_version` takes inserts only; the grant, not a convention (VER-008)      | Task 4, as grants; task 7, a correction is another version and the first is untouched |
| Author, timestamp, optional note (VER-007)                                        | Task 6                                                                                |
| `schema_version` from the content (VER-010)                                       | Task 4 (the check refuses a disagreement), task 6 (recorded)                          |
| No general attribute column; a new attribute is a migration (CNT-145)             | Task 4 pins both tables' columns; task 6 shows the closed set on a stored component   |
| Values in their own column, never in content (MET-016)                            | Task 6                                                                                |
| Every row's version digest, recomputable by anybody holding it (VER-042)          | Task 6, recomputed from a read row, and a row changed behind the grant is detected    |
| `version_definition`, one row per definition version, by foreign key              | Tasks 4 and 6                                                                         |
| A version whose digest equals the previous one is refused (ADR-0024)              | Task 7: `version.unchanged`, whoever cuts it and whatever they note                   |
| A metadata-only change is a version; the content hash stays (ADR-0024)            | Task 7                                                                                |
| `version.precondition` naming the current version (component-editor.md)           | Task 7, including two concurrent cuts                                                 |
| Whether inline JSONB holds up at authoring volume (open question)                 | Task 5                                                                                |

## Requirements this plan cites, and those it does not

storage-and-versioning.md owns 35 requirements. **This plan cites six**, each only in a test that shows
its own statement:

| ID      | Statement, in short                                                                                 | Cited in                                          | Tasks |
| ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- |
| VER-007 | A version records its author, the time and an optional note                                         | `versions.test.ts`                                | 6     |
| VER-008 | A version is never edited or deleted; correcting one produces another                               | `version-chain.test.ts`, `record-version.test.ts` | 4, 7  |
| VER-010 | Every version records the schema version its content was written against                            | `version-chain.test.ts`, `versions.test.ts`       | 4, 6  |
| VER-042 | Every version records a digest over its canonical serialisation, recomputable by anybody holding it | `versions.test.ts`                                | 6     |
| CNT-145 | A component's structural attributes are a closed set; adding one is a migration                     | `version-chain.test.ts`, `versions.test.ts`       | 4, 6  |
| MET-016 | Metadata values are held beside content, never inside the content document                          | `versions.test.ts`                                | 6     |

That is nine citations in three files, taking the pin from 103 to 112.

**Owned, built in part here, and not cited** - each waits for the plan named:

| ID      | What is built                                                  | What is missing, and whose                                                                                                                     |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| VER-009 | `revision_no` and `version_no`, numbered within revision 0     | Numbering after a designation is written nowhere (decision 7). The revisions plan                                                              |
| VER-011 | One mechanism parameterised by kind                            | Its named kinds - documents, outlines, assets, query definitions, themes, layouts, templates - do not exist (decision 3). Each kind's own plan |
| VER-015 | Revision 0 on every version                                    | Revisions numbered from 1. The revisions plan                                                                                                  |
| VER-038 | The author is a reference to a principal, restricted on delete | What erasure removes and what remains must be stated; VER-Q03 is unanswered. A later design                                                    |
| MET-015 | Values on the insert-only row, changed only by a new version   | "A baseline pinning the version must pin them" - there is no baseline. The baselines plan                                                      |
| VER-006 | Versions are inserted by an explicit call                      | Promotion from an iteration. The editor session plan                                                                                           |
| VER-036 | Nothing here expires                                           | Retention for as long as the tenant keeps its content, subject to policy (LIF). A later plan                                                   |

**Owned and not touched:** VER-001 to VER-005 (iterations; the editor session plan), VER-012 to VER-014
and VER-016 (designations; the revisions plan), VER-017 to VER-023 (baselines; the baselines plan),
VER-032, VER-033 and VER-035 (restore; the restore plan), VER-037 (legal hold), and VER-039 and VER-040
(derived data; the search plan). **Not owned, and not cited even where a test comes close:** MET-017 and
MET-018, which metadata.md claims and whose rules its tests already cite; IAM-004, service-foundations.md's;
and API-008 and COL-010, which the service and the editor session answer.

---

## Task 1: The canonical serialisation of a whole version

**Files:**

- Create: `packages/domain/src/version/substance.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/index.test.ts`
- Test: `packages/domain/src/version/substance.test.ts`

**Interfaces:**

- Consumes: `canonicalise(document: ContentDocument): string` (content model),
  `canonicaliseValues(values: MetadataValues): string`,
  `canonicaliseNotCarried(notCarried: readonly NotCarried[]): string`,
  `type DefinitionRef = { kind: DefinitionKind; id: string; version: string }` (metadata),
  `canonicalJson(value: unknown, order?: ArrayOrder): string` (stored).
- Produces, from `@alloy-works/domain`:
  - `type ComponentSubstance = { kind: 'component'; content: ContentDocument; values: MetadataValues; notCarried: readonly NotCarried[]; definitions: readonly DefinitionRef[] }`
  - `type DefinitionSubstance` - `{ kind: K; content: DefinitionOf[K] }` for each `DefinitionKind` K
  - `type VersionSubstance = ComponentSubstance | DefinitionSubstance`
  - `componentTypeOf(definitions: readonly DefinitionRef[]): string` - throws unless exactly one `componentType`
  - `canonicaliseVersionContent(substance: VersionSubstance): string` - the content hash's input
  - `canonicaliseVersion(substance: VersionSubstance): string` - the version digest's input

See decision 2. No requirement is cited here: the serialisation is half of VER-042, and the half that
records and recomputes a digest is task 6's.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/version/substance.test.ts
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/document.js';
import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { fieldDefinitionSchema } from '../metadata/field.js';
import { canonicalJson } from '../stored/canonical.js';

import {
  canonicaliseVersion,
  canonicaliseVersionContent,
  componentTypeOf,
  type ComponentSubstance,
} from './substance.js';

const TYPE = '6f1c1a52-0000-4000-8000-000000000001';
const SCHEMA = '6f1c1a52-0000-4000-8000-000000000002';
const FIELD = '6f1c1a52-0000-4000-8000-000000000003';

const content: ContentDocument = {
  schemaVersion: 1,
  title: 'Dosing',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        {
          type: 'text',
          value: 'Take one',
          marks: [
            { type: 'strong', id: 'm2' },
            { type: 'emphasis', id: 'm1' },
          ],
        },
      ],
    },
  ],
};

const component: ComponentSubstance = {
  kind: 'component',
  content,
  values: { 'field-study': 'S-1', 'field-sites': ['Leeds', 'York'] },
  notCarried: [{ field: 'field-old', value: 'Ada' }],
  definitions: [
    { kind: 'metadataSchema', id: 'schema-reg', version: SCHEMA },
    { kind: 'componentType', id: 'type-protocol', version: TYPE },
    { kind: 'field', id: 'field-study', version: FIELD },
  ],
};

describe('the component type a component version records', () => {
  it('is the version of the one component type among its definitions', () => {
    expect(componentTypeOf(component.definitions)).toBe(TYPE);
  });

  it('refuses definitions naming no component type, or two', () => {
    expect(() => componentTypeOf([])).toThrow(/one component type, not 0/);
    expect(() =>
      componentTypeOf([
        { kind: 'componentType', id: 'type-a', version: TYPE },
        { kind: 'componentType', id: 'type-b', version: SCHEMA },
      ]),
    ).toThrow(/one component type, not 2/);
  });
});

describe('the canonical serialisation of a whole version', () => {
  it('is one canonical document: its five members in order, each in its own canonical form', () => {
    const sortedDefinitions = [...component.definitions].sort((a, b) =>
      a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
    );
    expect(canonicaliseVersion(component)).toBe(
      canonicalJson({
        componentType: TYPE,
        content: JSON.parse(canonicaliseVersionContent(component)),
        definitions: sortedDefinitions,
        notCarried: component.notCarried,
        values: component.values,
      }),
    );
  });

  it("sorts content's marks as a set and keeps a many value's order, in one serialisation", () => {
    const serialised = canonicaliseVersion(component);
    expect(serialised).toContain(
      '"marks":[{"id":"m1","type":"emphasis"},{"id":"m2","type":"strong"}]',
    );
    expect(serialised).toContain('"field-sites":["Leeds","York"]');

    const underMarks = canonicaliseVersion({ ...component, values: { marks: ['York', 'Leeds'] } });
    expect(underMarks).toContain('"values":{"marks":["York","Leeds"]}');
  });

  it('serialises the definitions as a set, whatever order they were listed in', () => {
    expect(
      canonicaliseVersion({ ...component, definitions: [...component.definitions].reverse() }),
    ).toBe(canonicaliseVersion(component));
  });

  it('refuses two versions of one definition, which would record neither honestly', () => {
    expect(() =>
      canonicaliseVersion({
        ...component,
        definitions: [
          ...component.definitions,
          { kind: 'field', id: 'field-study', version: SCHEMA },
        ],
      }),
    ).toThrow(/field field-study is recorded twice/);
  });

  it('changes when only a metadata value changes, and when only what was not carried changes', () => {
    const base = canonicaliseVersion(component);
    expect(
      canonicaliseVersion({ ...component, values: { ...component.values, 'field-study': 'S-2' } }),
    ).not.toBe(base);
    expect(canonicaliseVersion({ ...component, notCarried: [] })).not.toBe(base);
    expect(canonicaliseVersionContent({ ...component, notCarried: [] })).toBe(
      canonicaliseVersionContent(component),
    );
  });

  it('holds a definition version in the same five members, with nothing but its content', () => {
    const field = fieldDefinitionSchema.parse({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: FIELD,
      name: 'Study',
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    expect(canonicaliseVersion({ kind: 'field', content: field })).toBe(
      `{"componentType":null,"content":${canonicalJson(field)},"definitions":[],"notCarried":[],"values":{}}`,
    );
  });

  // Pinned, and never edited: every stored version digest is SHA-256 over this serialisation, so a
  // change here makes every digest already written unverifiable. A change is a new decision record.
  it('serialises a known version to exactly this string', () => {
    expect(canonicaliseVersion(component)).toBe(
      '{"componentType":"6f1c1a52-0000-4000-8000-000000000001",' +
        '"content":{"content":[{"content":[{"marks":[{"id":"m1","type":"emphasis"},{"id":"m2","type":"strong"}],' +
        '"type":"text","value":"Take one"}],"id":"b1","style":"body","type":"paragraph"}],' +
        '"direction":"ltr","language":"en-GB","schemaVersion":1,"title":"Dosing"},' +
        '"definitions":[{"id":"type-protocol","kind":"componentType","version":"6f1c1a52-0000-4000-8000-000000000001"},' +
        '{"id":"field-study","kind":"field","version":"6f1c1a52-0000-4000-8000-000000000003"},' +
        '{"id":"schema-reg","kind":"metadataSchema","version":"6f1c1a52-0000-4000-8000-000000000002"}],' +
        '"notCarried":[{"field":"field-old","value":"Ada"}],' +
        '"values":{"field-sites":["Leeds","York"],"field-study":"S-1"}}',
    );
  });
});
```

The last test is pinned and never edited: every stored digest is SHA-256 over this string.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/version`
Expected: FAIL - the import `./substance.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/version/substance.ts
import { canonicalise } from '../content/model/canonical.js';
import type { ContentDocument } from '../content/model/document.js';
import type { NotCarried } from '../metadata/carry.js';
import type { DefinitionKind, DefinitionOf } from '../metadata/migrate.js';
import {
  canonicaliseNotCarried,
  canonicaliseValues,
  type DefinitionRef,
} from '../metadata/record.js';
import type { MetadataValues } from '../metadata/values.js';
import { canonicalJson } from '../stored/canonical.js';

/**
 * What a component version says (ADR-0024): its content, its metadata values, the values it did not
 * carry forward, and the definition versions it was written against - the component type among them.
 * Authorship is deliberately absent. Author, time, note and `revision.version` are not what a version
 * says, and a digest over them would make every version differ from the last.
 */
export type ComponentSubstance = {
  readonly kind: 'component';
  readonly content: ContentDocument;
  readonly values: MetadataValues;
  readonly notCarried: readonly NotCarried[];
  readonly definitions: readonly DefinitionRef[];
};

/** A field, metadata schema or component type version says its payload, and nothing else. */
export type DefinitionSubstance = {
  [K in DefinitionKind]: { readonly kind: K; readonly content: DefinitionOf[K] };
}[DefinitionKind];

export type VersionSubstance = ComponentSubstance | DefinitionSubstance;

/**
 * The version of the one component type a component version was written against. `definitionsFor`
 * always names exactly one; anything else is a caller's bug, and a version recording it would say
 * nothing true about its type.
 */
export function componentTypeOf(definitions: readonly DefinitionRef[]): string {
  const types = definitions.filter((each) => each.kind === 'componentType');
  const [type] = types;
  if (types.length !== 1 || type === undefined) {
    throw new Error(`A component version records one component type, not ${types.length}`);
  }
  return type.version;
}

/**
 * The canonical content alone: the input to `content_hash`, which keys derived data. A component's
 * content takes the content model's rules, where marks are a set; a definition's payload takes the
 * shared rules, where no array is.
 *
 * The content is serialised as it is handed in and never migrated, because a digest is over what was
 * written. Recomputing one from a stored row passes the row's content exactly as stored.
 */
export function canonicaliseVersionContent(substance: VersionSubstance): string {
  return substance.kind === 'component'
    ? canonicalise(substance.content)
    : canonicalJson(substance.content);
}

/**
 * The canonical serialisation of the whole version: the input to the version digest (ADR-0024,
 * VER-042), which decides whether a version changed.
 *
 * One canonical JSON document of five members in lexicographic order - `componentType`, `content`,
 * `definitions`, `notCarried`, `values` - composed from each member's own canonical form rather than
 * by serialising one object, because content's rule that `marks` is a set must not reach a metadata
 * field whose identifier happens to be `marks` (MET-030). A definition version holds the same five
 * members, with no type, no definitions and no values, so every row's digest has one shape.
 */
export function canonicaliseVersion(substance: VersionSubstance): string {
  const component = substance.kind === 'component' ? substance : undefined;
  const members: readonly (readonly [string, string])[] = [
    ['componentType', canonicalJson(component ? componentTypeOf(component.definitions) : null)],
    ['content', canonicaliseVersionContent(substance)],
    ['definitions', canonicaliseDefinitions(component?.definitions ?? [])],
    ['notCarried', canonicaliseNotCarried(component?.notCarried ?? [])],
    ['values', canonicaliseValues(component?.values ?? {})],
  ];
  return `{${members.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(',')}}`;
}

/** The definitions a version records are a set: sorted by kind, identifier and version. */
function canonicaliseDefinitions(definitions: readonly DefinitionRef[]): string {
  const seen = new Set<string>();
  for (const each of definitions) {
    const key = `${each.kind} ${each.id}`;
    if (seen.has(key)) throw new Error(`The definition ${key} is recorded twice`);
    seen.add(key);
  }
  return canonicalJson(
    [...definitions].sort(
      (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
    ),
  );
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/version`
Expected: PASS, 9 tests.

- [ ] **Step 5: Promote it to the package's public surface, test first**

In `packages/domain/src/index.test.ts`, add to the sorted list, after `'validate',`:

```ts
        // The version record's serialisation, promoted in the storage plan that composes it.
        'canonicaliseVersion',
        'canonicaliseVersionContent',
        'componentTypeOf',
```

Run: `pnpm --filter @alloy-works/domain test -- src/index`
Expected: FAIL - the three names are missing from the exports.

In `packages/domain/src/index.ts`, after `export * from './metadata/index.js';`:

```ts
// The whole version, as its digest serialises it (ADR-0024). The caller hashes.
export {
  canonicaliseVersion,
  canonicaliseVersionContent,
  componentTypeOf,
} from './version/substance.js';
export type {
  ComponentSubstance,
  DefinitionSubstance,
  VersionSubstance,
} from './version/substance.js';
```

Run: `pnpm --filter @alloy-works/domain test && pnpm --filter @alloy-works/domain build`
Expected: PASS, 282 tests, and the build emits `dist/version/substance.js`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/domain/src
git add packages/domain/src/version packages/domain/src/index.ts packages/domain/src/index.test.ts
git commit -m "Serialise a whole version canonically, for its digest"
```

---

## Task 2: The two digests

**Files:**

- Modify: `packages/db/package.json`, `pnpm-lock.yaml`, `packages/db/src/index.ts`
- Create: `packages/db/src/version-digest.ts`
- Test: `packages/db/src/version-digest.test.ts`

**Interfaces:**

- Consumes: `canonicaliseVersion`, `canonicaliseVersionContent`, `type VersionSubstance` (task 1).
- Produces, from `@alloy-works/db`: `sha256Hex(text: string): string`,
  `versionDigests(substance: VersionSubstance): VersionDigests`,
  `interface VersionDigests { contentHash: string; versionDigest: string }`.

See decision 1. This test needs no database.

- [ ] **Step 1: Depend on the domain package**

In `packages/db/package.json`, add as the first entry of `dependencies`:

```json
    "@alloy-works/domain": "workspace:^",
```

Run: `pnpm install`
Expected: `pnpm-lock.yaml` gains exactly this under `packages/db: dependencies:`, and nothing else:

```yaml
'@alloy-works/domain':
  specifier: workspace:^
  version: link:../domain
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/db/src/version-digest.test.ts
import {
  canonicalise,
  canonicaliseVersion,
  DEFINITION_SCHEMA_VERSION,
  fieldDefinitionSchema,
  type ComponentSubstance,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { sha256Hex, versionDigests } from './version-digest.js';

// The version the domain package pins its serialisation against, in
// packages/domain/src/version/substance.test.ts.
const component: ComponentSubstance = {
  kind: 'component',
  content: {
    schemaVersion: 1,
    title: 'Dosing',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          {
            type: 'text',
            value: 'Take one',
            marks: [
              { type: 'strong', id: 'm2' },
              { type: 'emphasis', id: 'm1' },
            ],
          },
        ],
      },
    ],
  },
  values: { 'field-study': 'S-1', 'field-sites': ['Leeds', 'York'] },
  notCarried: [{ field: 'field-old', value: 'Ada' }],
  definitions: [
    { kind: 'metadataSchema', id: 'schema-reg', version: '6f1c1a52-0000-4000-8000-000000000002' },
    { kind: 'componentType', id: 'type-protocol', version: '6f1c1a52-0000-4000-8000-000000000001' },
    { kind: 'field', id: 'field-study', version: '6f1c1a52-0000-4000-8000-000000000003' },
  ],
};

describe('the two digests a version records', () => {
  it('hashes the UTF-8 bytes of a string, as 64 lowercase hexadecimal digits', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('takes the version digest over the whole version, and the content hash over content alone', () => {
    const digests = versionDigests(component);
    expect(digests.versionDigest).toBe(sha256Hex(canonicaliseVersion(component)));
    expect(digests.contentHash).toBe(sha256Hex(canonicalise(component.content)));
  });

  it('moves the version digest and not the content hash when only a metadata value changes', () => {
    const before = versionDigests(component);
    const after = versionDigests({
      ...component,
      values: { ...component.values, 'field-study': 'S-2' },
    });
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.versionDigest).not.toBe(before.versionDigest);
  });

  it('digests a definition version by the same rules', () => {
    const field = fieldDefinitionSchema.parse({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: '6f1c1a52-0000-4000-8000-000000000003',
      name: 'Study',
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    const digests = versionDigests({ kind: 'field', content: field });
    expect(digests.versionDigest).toBe(
      sha256Hex(canonicaliseVersion({ kind: 'field', content: field })),
    );
    expect(digests.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Pinned, and never edited: a stored digest is recomputed by anybody holding the row, so this
  // number is what every such recomputation of this version must reach.
  it('digests a known version to exactly these values', () => {
    expect(versionDigests(component)).toEqual({
      contentHash: '7099d261808076077624c5db0484441cc6cca92166cc65e7f061bd12f775a9b4',
      versionDigest: 'aa6b5c84b3f6b71a244e282d99cd95dfedb8d8d7062a83d3d5104d79002ba26a',
    });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/db test -- src/version-digest`
Expected: FAIL - the import `./version-digest.js` does not resolve.

- [ ] **Step 4: Write the minimal implementation**

```ts
// packages/db/src/version-digest.ts
import { createHash } from 'node:crypto';
import {
  canonicaliseVersion,
  canonicaliseVersionContent,
  type VersionSubstance,
} from '@alloy-works/domain';

export interface VersionDigests {
  /** SHA-256 over the canonical content alone. Keys derived data; never decides whether a version changed. */
  readonly contentHash: string;
  /** SHA-256 over the whole version's canonical serialisation. Decides whether a version changed (ADR-0024). */
  readonly versionDigest: string;
}

/** SHA-256 over the UTF-8 bytes of `text`, as 64 lowercase hexadecimal digits. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Both digests of a version. Hashing lives here rather than in `packages/domain`, which serialises
 * and stays platform-free: `node:crypto` is not, and `crypto.subtle` would make the domain async for
 * nothing (docs/architecture.md, the content model).
 */
export function versionDigests(substance: VersionSubstance): VersionDigests {
  return {
    contentHash: sha256Hex(canonicaliseVersionContent(substance)),
    versionDigest: sha256Hex(canonicaliseVersion(substance)),
  };
}
```

In `packages/db/src/index.ts`, append:

```ts
export { sha256Hex, versionDigests, type VersionDigests } from './version-digest.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/version-digest && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 5 tests; no type errors. The pinned hex was checked independently when this plan was
written: `printf '%s' '<the domain test's pinned string>' | sha256sum` gives the same
`aa6b5c84...ba26a`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/db/package.json
git add packages/db/package.json pnpm-lock.yaml packages/db/src/version-digest.ts packages/db/src/version-digest.test.ts packages/db/src/index.ts
git commit -m "Hash a version's content and its whole substance in the database package"
```

---

## Task 3: Spaces and artifacts

**Files:**

- Create: `packages/db/migrations/tenant/0007_spaces_and_artifacts.sql`,
  `packages/db/src/artifact-kind.ts`, `packages/db/src/spaces.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/spaces.test.ts`

**Interfaces:**

- Consumes: `definitionKinds` from `@alloy-works/domain`; `withTenant`, `createTenant`, the test harness.
- Produces: tables `space (id, name, created_at)` and `artifact (id, kind, space_id, created_at)` with
  `unique (id, kind)`; `artifactKinds`, `type ArtifactKind`, `contentKinds`, `type ContentKind`;
  `createSpace(trx: TenantTransaction, name: string): Promise<Space>`,
  `interface Space { id: string; name: string; createdAt: Date }`; row types `SpaceTable`,
  `ArtifactTable`.

See decisions 3 and 12. No requirement is cited: a content artifact's one space is access.md's rule,
and access.md is not this design.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/spaces.test.ts
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactKinds, contentKinds } from './artifact-kind.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('spaces and artifacts', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('creates a space with a name unique within the tenant, and not across tenants', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Regulatory'));
    expect(space).toMatchObject({ name: 'Regulatory' });
    expect(space.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      service.withTenant(production, (trx) => createSpace(trx, 'Regulatory')),
    ).rejects.toThrow(/space_name_key/);
    await expect(
      service.withTenant(development, (trx) => createSpace(trx, 'Regulatory')),
    ).resolves.toMatchObject({ name: 'Regulatory' });
  });

  it('refuses a space name that is empty or carries surrounding spaces', async () => {
    for (const name of ['', ' Quality', 'Quality ']) {
      await expect(service.withTenant(production, (trx) => createSpace(trx, name))).rejects.toThrow(
        /space_name_check/,
      );
    }
  });

  it('puts a content artifact in exactly one space, and a definition in none', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Clinical'));
    const insert = (kind: (typeof artifactKinds)[number], spaceId: string | null) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('artifact')
          .values({ kind, space_id: spaceId })
          .returning('kind')
          .executeTakeFirstOrThrow(),
      );

    for (const kind of artifactKinds) {
      const content = (contentKinds as readonly string[]).includes(kind);
      await expect(insert(kind, content ? space.id : null)).resolves.toEqual({ kind });
      await expect(insert(kind, content ? null : space.id)).rejects.toThrow(
        /artifact_space_by_kind/,
      );
    }
  });

  it('refuses a kind the version chain does not hold', async () => {
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into artifact (kind) values ('document')`.execute(trx),
      ),
    ).rejects.toThrow(/artifact_kind_check/);
  });

  it('never changes an artifact once it exists: the runtime role holds no update', async () => {
    const artifact = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'field', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        sql`update artifact set kind = 'metadataSchema' where id = ${artifact.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot see another tenant's space, or put an artifact in one", async () => {
    const theirs = await service.withTenant(development, (trx) => createSpace(trx, 'Theirs'));
    const seen = await service.withTenant(production, (trx) =>
      trx.selectFrom('space').selectAll().where('id', '=', theirs.id).execute(),
    );
    expect(seen).toEqual([]);
    await expect(
      service.withTenant(production, (trx) =>
        trx.insertInto('artifact').values({ kind: 'component', space_id: theirs.id }).execute(),
      ),
    ).rejects.toThrow(/artifact_space_id_fkey/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/spaces`
Expected: FAIL - the imports `./artifact-kind.js` and `./spaces.js` do not resolve.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/tenant/0007_spaces_and_artifacts.sql
-- A space holds content (access.md): a component lives in exactly one, and a definition - a field, a
-- metadata schema, a component type - in none, because definitions are shared across the tenant.
create table space (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  created_at timestamptz not null default now()
);

-- The identity of a versioned thing: a kind and an id (storage-and-versioning.md). One table for
-- every kind, so every kind is versioned by one mechanism rather than by tables agreeing to behave
-- alike. A kind arrives with the plan that gives its content a shape, by widening both checks.
create table artifact (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('component', 'field', 'metadataSchema', 'componentType')),
  space_id uuid references space on delete restrict,
  created_at timestamptz not null default now(),
  -- The target of artifact_version's key, which is what keeps a version's kind its artifact's.
  unique (id, kind),
  constraint artifact_space_by_kind check ((kind in ('component')) = (space_id is not null))
);
create index artifact_space on artifact (space_id);

-- An artifact's identity does not change: its kind is what every version of it agrees on, and moving
-- content between spaces is not designed. The tenant's runtime role shares this schema's name.
do $$
begin
  execute format('revoke update on artifact from %I', current_schema());
end
$$;
```

- [ ] **Step 4: Write the kinds, the row types and `createSpace`**

```ts
// packages/db/src/artifact-kind.ts
import { definitionKinds } from '@alloy-works/domain';

/**
 * Every kind of artifact the version chain holds, and the check constraint on `artifact.kind` names
 * the same list. A kind is added with the plan that gives its content a shape: a document, an outline,
 * an asset and the rest arrive that way, by a migration widening the check.
 */
export const artifactKinds = ['component', ...definitionKinds] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/** Content kinds live in exactly one space; every other kind is a definition and lives in none. */
export const contentKinds = ['component'] as const satisfies readonly ArtifactKind[];

export type ContentKind = (typeof contentKinds)[number];
```

In `packages/db/src/tables.ts`, add `import type { ArtifactKind } from './artifact-kind.js';` after the
`kysely` import; add these interfaces before `TenantTables`:

```ts
export interface SpaceTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
}

/** No update: an artifact's identity does not change, and the runtime role holds no such grant. */
export interface ArtifactTable {
  id: ColumnType<string, string | undefined, never>;
  kind: ColumnType<ArtifactKind, ArtifactKind, never>;
  space_id: ColumnType<string | null, string | null, never>;
  created_at: ColumnType<Date, never, never>;
}
```

and add to `TenantTables`, after `sample: SampleTable;`:

```ts
space: SpaceTable;
artifact: ArtifactTable;
```

```ts
// packages/db/src/spaces.ts
import type { TenantTransaction } from './tables.js';

export interface Space {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

/**
 * Creates a space in the tenant the transaction belongs to. The name is unique within the tenant and
 * the table refuses a second one; who may create a space is access.md's `administer`, which the
 * caller decides before calling this.
 */
export async function createSpace(trx: TenantTransaction, name: string): Promise<Space> {
  const row = await trx
    .insertInto('space')
    .values({ name })
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow();
  return { id: row.id, name: row.name, createdAt: row.created_at };
}
```

In `packages/db/src/index.ts`, add after the `./provision.js` export:

```ts
export {
  artifactKinds,
  contentKinds,
  type ArtifactKind,
  type ContentKind,
} from './artifact-kind.js';
```

add `ArtifactTable` and `SpaceTable` to the `./tables.js` type export, in alphabetical order, and append:

```ts
export { createSpace, type Space } from './spaces.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/spaces && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 6 tests. `createTenant` migrates, so every tenant made in the test has the new tables.

- [ ] **Step 6: Run the whole database suite**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS. The migration runner's tests apply every tenant migration to several tenants, so a
migration that fails for a second tenant, or twice, fails here.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db
git add packages/db/migrations/tenant/0007_spaces_and_artifacts.sql packages/db/src/artifact-kind.ts packages/db/src/spaces.ts packages/db/src/spaces.test.ts packages/db/src/tables.ts packages/db/src/index.ts
git commit -m "Add spaces, and artifacts that live in one space or none by kind"
```

---

## Task 4: The version chain, insert-only

**Files:**

- Create: `packages/db/migrations/tenant/0008_version_chain.sql`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`,
  `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/version-chain.test.ts`

**Interfaces:**

- Consumes: `space`, `artifact`, `createSpace`, `type ArtifactKind` (task 3).
- Produces: tables `artifact_version` and `version_definition` exactly as the migration draws them;
  row types `ArtifactVersionTable` and `VersionDefinitionTable`, every column's update type `never`.
  Constraint names later tasks' tests match on: `artifact_version_schema_version_is_content`,
  `artifact_version_type_by_kind`, `artifact_version_values_by_kind`,
  `artifact_version_metadata_shape`, `artifact_version_author_id_fkey`,
  `artifact_version_component_type_version_id_fkey`,
  `version_definition_definition_version_id_definition_artifa_fkey` (Postgres truncates the generated
  name at 63 characters), `version_definition_version_id_definition_artifact_id_key`.

See decisions 5 and 12. This task cites VER-008 (the grant), VER-010 (the schema version is the
content's) and CNT-145 (both tables' columns pinned: there is no general attribute column, so a new
structural attribute is a new column and therefore a migration, and this test with it).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/version-chain.test.ts
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArtifactKind } from './artifact-kind.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const DIGEST = 'a'.repeat(64);
const content = (schemaVersion: unknown = 1) => ({ schemaVersion, title: 'Dosing' });

describe('the version chain as stored', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let author: string;
  let spaceId: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ({ author, spaceId } = await service.withTenant(production, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const space = await createSpace(trx, 'Clinical');
      return { author: principal.id, spaceId: space.id };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const artifact = (trx: TenantTransaction, kind: ArtifactKind) =>
    trx
      .insertInto('artifact')
      .values({ kind, space_id: kind === 'component' ? spaceId : null })
      .returning('id')
      .executeTakeFirstOrThrow();

  type Row = {
    artifactId: string;
    kind: ArtifactKind;
    versionNo?: number;
    content?: unknown;
    schemaVersion?: number;
    values?: string;
    notCarried?: string;
    componentType?: string | null;
  };

  const version = (trx: TenantTransaction, row: Row) =>
    trx
      .insertInto('artifact_version')
      .values({
        artifact_id: row.artifactId,
        kind: row.kind,
        revision_no: 0,
        version_no: row.versionNo ?? 1,
        author_id: author,
        note: null,
        schema_version: row.schemaVersion ?? 1,
        content: JSON.stringify(row.content ?? content()),
        content_hash: DIGEST,
        metadata_values: row.values ?? '{}',
        not_carried: row.notCarried ?? '[]',
        component_type_version_id: row.componentType ?? null,
        version_digest: DIGEST,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  /** A component type version, and a component version written against it. */
  const component = async (trx: TenantTransaction) => {
    const type = await artifact(trx, 'componentType');
    const typeVersion = await version(trx, { artifactId: type.id, kind: 'componentType' });
    const made = await artifact(trx, 'component');
    const first = await version(trx, {
      artifactId: made.id,
      kind: 'component',
      componentType: typeVersion.id,
    });
    return { type, typeVersion, component: made, version: first };
  };

  it('VER-008 gives the runtime role no update, delete or truncate on a version or what it records', async () => {
    const stored = await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      await trx
        .insertInto('version_definition')
        .values({
          version_id: made.version.id,
          definition_version_id: made.typeVersion.id,
          definition_artifact_id: made.type.id,
          definition_kind: 'componentType',
        })
        .execute();
      return made;
    });

    const refused = [
      sql`update artifact_version set note = 'changed' where id = ${stored.version.id}`,
      sql`delete from artifact_version where id = ${stored.version.id}`,
      sql`truncate artifact_version cascade`,
      sql`update version_definition set definition_kind = 'field' where version_id = ${stored.version.id}`,
      sql`delete from version_definition where version_id = ${stored.version.id}`,
      sql`truncate version_definition`,
    ];
    for (const statement of refused) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }

    const still = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['note'])
        .where('id', '=', stored.version.id)
        .executeTakeFirstOrThrow(),
    );
    expect(still.note).toBeNull();
  });

  it('VER-010 refuses a version whose schema version is not the one its content records', async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, {
          artifactId: field.id,
          kind: 'field',
          content: content(2),
          schemaVersion: 1,
        }),
      ).rejects.toThrow(/artifact_version_schema_version_is_content/);
    });
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', content: { title: 'None' } }),
      ).rejects.toThrow(/artifact_version_schema_version_is_content/);
    });
  });

  it("refuses a version whose kind is not its artifact's", async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(version(trx, { artifactId: field.id, kind: 'metadataSchema' })).rejects.toThrow(
        /artifact_version_artifact_id_kind_fkey/,
      );
    });
  });

  it('records a component type on a component version and on nothing else', async () => {
    await service.withTenant(production, async (trx) => {
      const made = await artifact(trx, 'component');
      await expect(version(trx, { artifactId: made.id, kind: 'component' })).rejects.toThrow(
        /artifact_version_type_by_kind/,
      );
    });
    await service.withTenant(production, async (trx) => {
      const { typeVersion } = await component(trx);
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', componentType: typeVersion.id }),
      ).rejects.toThrow(/artifact_version_type_by_kind/);
    });
  });

  it('holds metadata values as an object and what was not carried as a list, on a component only', async () => {
    const refusals: [Partial<Row>, RegExp][] = [
      [{ values: '[]' }, /artifact_version_metadata_shape/],
      [{ notCarried: '{}' }, /artifact_version_metadata_shape/],
    ];
    for (const [row, refusal] of refusals) {
      await service.withTenant(production, async (trx) => {
        const { typeVersion } = await component(trx);
        const made = await artifact(trx, 'component');
        await expect(
          version(trx, {
            artifactId: made.id,
            kind: 'component',
            componentType: typeVersion.id,
            ...row,
          }),
        ).rejects.toThrow(refusal);
      });
    }
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', values: '{"field-study":"S-1"}' }),
      ).rejects.toThrow(/artifact_version_values_by_kind/);
    });
  });

  it('numbers a version once within its artifact', async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await version(trx, { artifactId: field.id, kind: 'field' });
      await expect(version(trx, { artifactId: field.id, kind: 'field' })).rejects.toThrow(
        /artifact_version_artifact_id_revision_no_version_no_key/,
      );
    });
  });

  it('records a definition only as the version, artifact and kind it is, and one version of each', async () => {
    const record = (
      trx: TenantTransaction,
      versionId: string,
      definition: {
        version: string;
        artifact: string;
        kind: 'field' | 'metadataSchema' | 'componentType';
      },
    ) =>
      trx
        .insertInto('version_definition')
        .values({
          version_id: versionId,
          definition_version_id: definition.version,
          definition_artifact_id: definition.artifact,
          definition_kind: definition.kind,
        })
        .execute();

    await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      await expect(
        record(trx, made.version.id, {
          version: made.typeVersion.id,
          artifact: made.type.id,
          kind: 'field',
        }),
      ).rejects.toThrow(/version_definition_definition_version_id_definition_artifa_fkey/);
    });

    await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      const second = await version(trx, {
        artifactId: made.type.id,
        kind: 'componentType',
        versionNo: 2,
      });
      await record(trx, made.version.id, {
        version: made.typeVersion.id,
        artifact: made.type.id,
        kind: 'componentType',
      });
      await expect(
        record(trx, made.version.id, {
          version: second.id,
          artifact: made.type.id,
          kind: 'componentType',
        }),
      ).rejects.toThrow(/version_definition_version_id_definition_artifact_id_key/);
    });
  });

  it('CNT-145 holds a component in closed columns, with no general attribute column to add one to', async () => {
    const columns = (table: string) =>
      service.withTenant(production, async (trx) => {
        const { rows } = await sql<{ column_name: string }>`
          select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = ${table}
          order by column_name
        `.execute(trx);
        return rows.map((row) => row.column_name);
      });

    expect(await columns('artifact')).toEqual(['created_at', 'id', 'kind', 'space_id']);
    expect(await columns('artifact_version')).toEqual(
      [
        'artifact_id',
        'author_id',
        'component_type_version_id',
        'content',
        'content_hash',
        'created_at',
        'id',
        'kind',
        'metadata_values',
        'not_carried',
        'note',
        'revision_no',
        'schema_version',
        'version_digest',
        'version_no',
      ].sort(),
    );
  });

  it("cannot read another tenant's versions, or write one naming another tenant's author", async () => {
    const theirs = await service.withTenant(development, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: 'Grace',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const field = await trx
        .insertInto('artifact')
        .values({ kind: 'field', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      const stored = await trx
        .insertInto('artifact_version')
        .values({
          artifact_id: field.id,
          kind: 'field',
          revision_no: 0,
          version_no: 1,
          author_id: principal.id,
          note: null,
          schema_version: 1,
          content: JSON.stringify(content()),
          content_hash: DIGEST,
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: DIGEST,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { author: principal.id, version: stored.id };
    });

    const seen = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact_version').select('id').where('id', '=', theirs.version).execute(),
    );
    expect(seen).toEqual([]);

    await expect(
      service.withTenant(production, async (trx) => {
        const field = await artifact(trx, 'field');
        await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: field.id,
            kind: 'field',
            revision_no: 0,
            version_no: 1,
            author_id: theirs.author,
            note: null,
            schema_version: 1,
            content: JSON.stringify(content()),
            content_hash: DIGEST,
            metadata_values: '{}',
            not_carried: '[]',
            component_type_version_id: null,
            version_digest: DIGEST,
          })
          .execute();
      }),
    ).rejects.toThrow(/artifact_version_author_id_fkey/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/version-chain`
Expected: FAIL, every test - `relation "artifact_version" does not exist`, and the column pin receives
`[]` for `artifact_version`.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/tenant/0008_version_chain.sql
-- The permanent version chain (storage-and-versioning.md, ADR-0024): one row per version of any
-- artifact, taking inserts only. Everything a baseline, a comparison or an audit reads refers here.
create table artifact_version (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  -- The artifact's kind, carried so the checks below can read it; the key keeps it the artifact's.
  kind text not null,
  revision_no integer not null check (revision_no >= 0),
  version_no integer not null check (version_no >= 1),
  -- A reference to a principal, never a copy of their details (VER-038).
  author_id uuid not null references principal on delete restrict,
  created_at timestamptz not null default now(),
  note text check (note <> ''),
  schema_version integer not null check (schema_version >= 1),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata_values jsonb not null,
  not_carried jsonb not null,
  component_type_version_id uuid references artifact_version on delete restrict,
  version_digest text not null check (version_digest ~ '^[0-9a-f]{64}$'),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  unique (artifact_id, revision_no, version_no),
  -- The target of version_definition's key, which is what makes a recorded definition exactly the
  -- version, artifact and kind the version digest names.
  unique (id, artifact_id, kind),
  -- VER-010: the schema version is the one the content itself records, never a second opinion.
  constraint artifact_version_schema_version_is_content check (
    schema_version::text = coalesce(content ->> 'schemaVersion', '')
  ),
  constraint artifact_version_metadata_shape check (
    jsonb_typeof(metadata_values) = 'object' and jsonb_typeof(not_carried) = 'array'
  ),
  -- A component records its type; nothing else has one.
  constraint artifact_version_type_by_kind check (
    (kind = 'component') = (component_type_version_id is not null)
  ),
  -- Only a component carries metadata values.
  constraint artifact_version_values_by_kind check (
    kind = 'component' or (metadata_values = '{}' and not_carried = '[]')
  )
);

-- Each definition version a version was written against (MET-017's record), by foreign key. The
-- composite key makes the kind, identifier and version the digest serialises exactly what is stored.
create table version_definition (
  version_id uuid not null references artifact_version on delete restrict,
  definition_version_id uuid not null,
  definition_artifact_id uuid not null,
  definition_kind text not null
    check (definition_kind in ('field', 'metadataSchema', 'componentType')),
  primary key (version_id, definition_version_id),
  -- One version of each definition: two would say two different things about one field.
  unique (version_id, definition_artifact_id),
  foreign key (definition_version_id, definition_artifact_id, definition_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index version_definition_definition on version_definition (definition_version_id);

-- VER-008 is a grant rather than a convention: the tenant's runtime role, which shares this schema's
-- name, may insert and read the chain and do nothing else to it.
do $$
begin
  execute format(
    'revoke update, delete, truncate on artifact_version, version_definition from %I',
    current_schema()
  );
end
$$;
```

- [ ] **Step 4: Add the row types**

In `packages/db/src/tables.ts`, add `import type { DefinitionKind } from '@alloy-works/domain';` as the
first import, and after `ArtifactTable`:

```ts
/**
 * Insert and read, nothing else (VER-008): every column's update type is `never`, as the grant is.
 * JSONB goes in as the text of a JSON document, because `pg` would send a JavaScript array as a
 * Postgres array rather than as JSON.
 */
export interface ArtifactVersionTable {
  id: ColumnType<string, never, never>;
  artifact_id: ColumnType<string, string, never>;
  kind: ColumnType<ArtifactKind, ArtifactKind, never>;
  revision_no: ColumnType<number, number, never>;
  version_no: ColumnType<number, number, never>;
  author_id: ColumnType<string, string, never>;
  created_at: ColumnType<Date, never, never>;
  note: ColumnType<string | null, string | null, never>;
  schema_version: ColumnType<number, number, never>;
  content: ColumnType<unknown, string, never>;
  content_hash: ColumnType<string, string, never>;
  metadata_values: ColumnType<Record<string, unknown>, string, never>;
  not_carried: ColumnType<unknown[], string, never>;
  component_type_version_id: ColumnType<string | null, string | null, never>;
  version_digest: ColumnType<string, string, never>;
}

/** Insert and read, nothing else, on the same terms as the version row. */
export interface VersionDefinitionTable {
  version_id: ColumnType<string, string, never>;
  definition_version_id: ColumnType<string, string, never>;
  definition_artifact_id: ColumnType<string, string, never>;
  definition_kind: ColumnType<DefinitionKind, DefinitionKind, never>;
}
```

and add to `TenantTables`, after `artifact: ArtifactTable;`:

```ts
artifact_version: ArtifactVersionTable;
version_definition: VersionDefinitionTable;
```

In `packages/db/src/index.ts`, add `ArtifactVersionTable` and `VersionDefinitionTable` to the
`./tables.js` type export, in alphabetical order.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/version-chain && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 9 tests.

If the grants test fails with the update succeeding, the `do` block revoked from a role other than the
one `withTenant` assumes - check that `tenantNames` still gives the schema and the runtime role one name.

- [ ] **Step 6: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

In `packages/trace/src/trace.test.ts`, change `expect(model.citations).toHaveLength(103);` to `106`.

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.` Three citations: VER-008, VER-010 and CNT-145, one
each in `version-chain.test.ts`.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db packages/trace/src/trace.test.ts
git add packages/db/migrations/tenant/0008_version_chain.sql packages/db/src/version-chain.test.ts packages/db/src/tables.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Add the version chain, which the runtime role may insert into and read, and nothing else"
```

---

## Task 5: Inline JSONB at authoring volume - measure before building on it

**Files:**

- Create: `packages/db/src/load/generate.ts`, `packages/db/src/load/version-chain.load.ts`,
  `packages/db/vitest.load.config.ts`
- Modify: `packages/db/package.json` (`test:load`), `packages/db/tsconfig.json`,
  `packages/db/tsconfig.build.json`, `docs/testing.md`, and this plan's outcome section below

**Interfaces:**

- Consumes: the tables of tasks 3 and 4; `versionDigests` (task 2); `parseContentDocument`,
  `canonicalise` and `type ComponentTypeDefinition` from `@alloy-works/domain`.
- Produces: `pnpm --filter @alloy-works/db test:load`, and a recorded result that decides whether task 6
  starts. Nothing in `src/load/` is exported or built into `dist/`.

See decision 9 for every volume and threshold, and why. This is the one task without a red run: it is a
measurement, and the thresholds are what it is checked against.

The load test writes its seed rows as the administrator, in batches, because loading a million rows one
`withTenant` at a time would measure the loader. Every seeded row is still a valid version - content
that parses, both digests computed by `versionDigests` - so the rows the measures read are the rows the
functions of tasks 6 and 7 will write. **Every measured statement runs through `withTenant` as the
tenant's runtime role**, and issues the same SQL tasks 6 and 7 issue: the advisory lock, the latest
version by `(artifact_id, revision_no desc, version_no desc)`, the insert of the version and its
definition row, and reads by id.

- [ ] **Step 1: Keep the load test out of the build and out of `pnpm test`**

In `packages/db/package.json`, add after `"test": "vitest run",`:

```json
    "test:load": "vitest run --config vitest.load.config.ts",
```

In `packages/db/tsconfig.build.json`, set `"exclude": ["src/**/*.test.ts", "src/dev-setup.ts", "src/load/**"]`.
In `packages/db/tsconfig.json`, set `"include": ["src", "vitest.config.ts", "vitest.load.config.ts"]`.

```ts
// packages/db/vitest.load.config.ts
import { defineConfig } from 'vitest/config';

// The version chain's load test: slow, so outside `pnpm test`, and run by hand with
// `pnpm --filter @alloy-works/db test:load` against the compose Postgres.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/load/**/*.load.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 3_600_000,
    // Pinned, as every suite's reporter is. No JSON report: this run is not evidence for the trace,
    // and writing db.json would overwrite the unit suite's.
    reporters: ['default'],
  },
});
```

The unit suite's `include` is `src/**/*.test.ts`, so a `.load.ts` file never runs in `pnpm test`.

- [ ] **Step 2: Write the content generator**

```ts
// packages/db/src/load/generate.ts
import type { ContentDocument } from '@alloy-works/domain';

/** mulberry32: a seeded generator, so a run on Windows and a run on Linux load the same rows. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A class of content size, in bytes of canonical JSON, drawn log-uniformly between its bounds. */
export interface SizeClass {
  readonly name: string;
  readonly share: number;
  readonly min: number;
  readonly max: number;
}

export interface VersionCountClass {
  readonly share: number;
  readonly min: number;
  readonly max: number;
}

export function pick<T extends { readonly share: number }>(
  classes: readonly T[],
  random: () => number,
): T {
  let roll = random();
  for (const each of classes) {
    if (roll < each.share) return each;
    roll -= each.share;
  }
  return classes[classes.length - 1]!;
}

export function logUniform(min: number, max: number, random: () => number): number {
  return Math.round(Math.exp(Math.log(min) + random() * (Math.log(max) - Math.log(min))));
}

export function uniformInt(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1));
}

// Invented syllables, so no generated word is anybody's data.
const SYLLABLES = ['ka', 'lo', 'mi', 'ren', 'sa', 'tu', 'vel', 'dor', 'ine', 'qua', 'bro', 'ste'];

function word(random: () => number): string {
  const length = uniformInt(1, 4, random);
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
  }
  return text;
}

function sentence(words: number, random: () => number): string {
  const parts: string[] = [];
  for (let index = 0; index < words; index += 1) parts.push(word(random));
  return `${parts.join(' ')}.`;
}

/**
 * A component's content of roughly `bytes` bytes as canonical JSON: paragraphs of generated text with
 * the occasional mark, and above 32 KB a table as well, because large components in a regulated
 * document are tables more often than prose. It parses as a `ContentDocument`.
 */
export function generateContent(bytes: number, random: () => number): ContentDocument {
  const blocks: ContentDocument['content'][number][] = [];
  let size = 120;
  let next = 1;
  const id = () => `b${next++}`;

  if (bytes > 32_000) {
    const rows: {
      cells: { content: ContentDocument['content']; colspan: number; rowspan: number }[];
    }[] = [];
    let tableSize = 0;
    while (tableSize < bytes * 0.6) {
      const cells = [0, 1, 2, 3].map(() => {
        const text = sentence(uniformInt(1, 6, random), random);
        tableSize += text.length + 90;
        return {
          content: [
            {
              type: 'paragraph' as const,
              id: id(),
              style: 'body',
              content: [{ type: 'text' as const, value: text, marks: [] }],
            },
          ],
          colspan: 1,
          rowspan: 1,
        };
      });
      rows.push({ cells });
    }
    blocks.push({
      type: 'table',
      id: id(),
      caption: sentence(5, random),
      headerRows: 1,
      headerColumns: 0,
      rows,
    });
    size += tableSize;
  }

  while (size < bytes || blocks.length === 0) {
    const text = sentence(uniformInt(12, 60, random), random);
    const marked = random() < 0.2;
    blocks.push({
      type: 'paragraph',
      id: id(),
      style: 'body',
      content: marked
        ? [
            { type: 'text', value: text, marks: [] },
            {
              type: 'text',
              value: ` ${word(random)}`,
              marks: [{ type: 'strong', id: `m${next}` }],
            },
          ]
        : [{ type: 'text', value: text, marks: [] }],
    });
    size += text.length + (marked ? 160 : 70);
  }

  return {
    schemaVersion: 1,
    title: sentence(4, random),
    language: 'en-GB',
    direction: 'ltr',
    content: blocks,
  };
}
```

- [ ] **Step 3: Write the load test**

```ts
// packages/db/src/load/version-chain.load.ts
import { randomUUID } from 'node:crypto';
import {
  canonicalise,
  parseContentDocument,
  type ComponentSubstance,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from '../bootstrap.js';
import { migrate } from '../migrate.js';
import { createTenant, type Tenant } from '../provision.js';
import { createTenantDatabase, type TenantDatabase } from '../tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '../testing/database.js';
import { versionDigests } from '../version-digest.js';
import {
  generateContent,
  logUniform,
  pick,
  seeded,
  uniformInt,
  type SizeClass,
  type VersionCountClass,
} from './generate.js';

/*
 * Whether inline JSONB holds up at authoring volume (storage-and-versioning.md, open questions).
 * Every number below is an assumption stated in docs/plans/2026-09-15-storage-01-the-version-chain.md,
 * decision 9, and each can be changed there and here together.
 */
const COMPONENTS = Number(process.env.ALLOY_LOAD_COMPONENTS ?? 20_000);
const MILLION = 1_000_000; // REL-031 and SCH-033 state their budgets for a tenant of a million components

const SIZES: readonly SizeClass[] = [
  { name: 'small, 0.5-4 KB', share: 0.7, min: 500, max: 4_000 },
  { name: 'medium, 4-32 KB', share: 0.25, min: 4_000, max: 32_000 },
  { name: 'large, 32-128 KB', share: 0.045, min: 32_000, max: 128_000 },
  { name: 'very large, 128 KB-1 MB', share: 0.005, min: 128_000, max: 1_000_000 },
];
const VERSION_COUNTS: readonly VersionCountClass[] = [
  { share: 0.4, min: 1, max: 2 },
  { share: 0.35, min: 3, max: 6 },
  { share: 0.2, min: 7, max: 15 },
  { share: 0.05, min: 16, max: 40 },
];
/** Of the versions after the first, the share that change metadata and leave content alone. */
const METADATA_ONLY = 0.2;
/** Components one 300-page document assembles (PUB-064), at three a page. */
const DOCUMENT_COMPONENTS = 900;

const THRESHOLDS = {
  cutP95: 50,
  openP95: 50,
  anyMax: 500,
  documentP95: 1_000,
  digestsP95: 100,
  projectedGigabytes: 250,
};

interface Seeded {
  readonly artifactId: string;
  readonly size: SizeClass;
  latest: { id: string; versionNo: number; digest: string };
}

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const summary = (samples: readonly number[]) => ({
  n: samples.length,
  p50: Number(percentile(samples, 50).toFixed(2)),
  p95: Number(percentile(samples, 95).toFixed(2)),
  p99: Number(percentile(samples, 99).toFixed(2)),
  max: Number(Math.max(...samples).toFixed(2)),
});

describe('inline JSONB at authoring volume', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let author: string;
  let typeArtifact: string;
  let typeVersion: string;
  const components: Seeded[] = [];
  const report: Record<string, unknown> = {};
  const random = seeded(20260915);

  const valuesFor = (component: number, version: number) => ({
    'field-study': `S-${component}`,
    'field-dose': `${version}.5`,
    'field-date': '2026-09-15',
    'field-owner': { user: author },
    'field-sites': ['Leeds', 'York', `Site ${version}`],
  });

  const substance = (content: ComponentSubstance['content'], values: Record<string, unknown>) =>
    ({
      kind: 'component',
      content,
      values,
      notCarried: [],
      definitions: [{ kind: 'componentType', id: typeArtifact, version: typeVersion }],
    }) satisfies ComponentSubstance;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Load' },
      hostnames: ['load.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl, { max: 2 });

    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const schema = admin.escapeIdentifier(tenant.schema);
    const started = performance.now();
    let rawBytes = 0;
    let versions = 0;
    try {
      author = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.principal (issuer, subject, display_name) values ('https://idp.example', 'ada', 'Ada') returning id`,
        )
      ).rows[0]!.id;
      const space = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.space (name) values ('Load') returning id`,
        )
      ).rows[0]!.id;
      typeArtifact = randomUUID();
      const typeContent: ComponentTypeDefinition = {
        schemaVersion: 1,
        id: typeArtifact,
        name: 'Protocol',
        assignments: [],
      };
      await admin.query(`insert into ${schema}.artifact (id, kind) values ($1, 'componentType')`, [
        typeArtifact,
      ]);
      const typeDigests = versionDigests({ kind: 'componentType', content: typeContent });
      typeVersion = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.artifact_version (artifact_id, kind, revision_no, version_no, author_id,
             schema_version, content, content_hash, metadata_values, not_carried, version_digest)
           values ($1, 'componentType', 0, 1, $2, 1, $3, $4, '{}', '[]', $5) returning id`,
          [
            typeArtifact,
            author,
            JSON.stringify(typeContent),
            typeDigests.contentHash,
            typeDigests.versionDigest,
          ],
        )
      ).rows[0]!.id;

      const columns =
        'id, artifact_id, kind, revision_no, version_no, author_id, schema_version, content, content_hash, metadata_values, not_carried, component_type_version_id, version_digest';
      let artifactRows: unknown[][] = [];
      let versionRows: unknown[][] = [];
      let batchBytes = 0;
      const flush = async () => {
        if (artifactRows.length > 0) {
          await admin.query(
            `insert into ${schema}.artifact (id, kind, space_id) values ${artifactRows
              .map((_, index) => `($${index * 2 + 1}, 'component', $${index * 2 + 2})`)
              .join(',')}`,
            artifactRows.flat(),
          );
        }
        if (versionRows.length > 0) {
          const width = 13;
          await admin.query(
            `insert into ${schema}.artifact_version (${columns}) values ${versionRows
              .map(
                (_, row) =>
                  `(${Array.from({ length: width }, (_, column) => `$${row * width + column + 1}`).join(',')})`,
              )
              .join(',')}`,
            versionRows.flat(),
          );
          await admin.query(
            `insert into ${schema}.version_definition (version_id, definition_version_id, definition_artifact_id, definition_kind)
             select id, $1, $2, 'componentType' from unnest($3::uuid[]) as id`,
            [typeVersion, typeArtifact, versionRows.map((row) => row[0])],
          );
        }
        artifactRows = [];
        versionRows = [];
        batchBytes = 0;
      };

      for (let index = 0; index < COMPONENTS; index += 1) {
        const artifactId = randomUUID();
        const size = pick(SIZES, random);
        const count = uniformInt(
          ...(({ min, max }) => [min, max] as const)(pick(VERSION_COUNTS, random)),
          random,
        );
        artifactRows.push([artifactId, space]);
        let content = generateContent(logUniform(size.min, size.max, random), random);
        let latest = { id: '', versionNo: 0, digest: '' };
        for (let versionNo = 1; versionNo <= count; versionNo += 1) {
          if (versionNo > 1 && random() >= METADATA_ONLY) {
            content = generateContent(logUniform(size.min, size.max, random), random);
          }
          const record = substance(content, valuesFor(index, versionNo));
          const digests = versionDigests(record);
          const json = JSON.stringify(content);
          const id = randomUUID();
          versionRows.push([
            id,
            artifactId,
            'component',
            0,
            versionNo,
            author,
            1,
            json,
            digests.contentHash,
            JSON.stringify(record.values),
            '[]',
            typeVersion,
            digests.versionDigest,
          ]);
          latest = { id, versionNo, digest: digests.versionDigest };
          rawBytes += json.length;
          batchBytes += json.length;
          versions += 1;
          if (batchBytes > 8_000_000 || versionRows.length >= 2_000) await flush();
        }
        components.push({ artifactId, size, latest });
      }
      await flush();
      await admin.query(`vacuum analyze ${schema}.artifact_version`);
      await admin.query(`vacuum analyze ${schema}.version_definition`);

      const sizes = (
        await admin.query<{ heap: string; toast: string; indexes: string; total: string }>(
          `select pg_relation_size(c.oid) as heap,
                  coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast,
                  pg_indexes_size(c.oid) as indexes,
                  pg_total_relation_size(c.oid) as total
           from pg_class c where c.oid = $1::regclass`,
          [`${tenant.schema}.artifact_version`],
        )
      ).rows[0]!;
      const total =
        Number(sizes.total) +
        Number(
          (
            await admin.query<{ total: string }>(
              `select pg_total_relation_size($1::regclass) as total`,
              [`${tenant.schema}.version_definition`],
            )
          ).rows[0]!.total,
        );
      const perVersion = total / (versions + 1);
      report.seed = {
        components: COMPONENTS,
        versions,
        meanVersionsPerComponent: Number((versions / COMPONENTS).toFixed(2)),
        rawContentMegabytes: Number((rawBytes / 1e6).toFixed(1)),
        meanContentKilobytes: Number((rawBytes / versions / 1e3).toFixed(2)),
        seconds: Number(((performance.now() - started) / 1e3).toFixed(1)),
      };
      report.storage = {
        heapMegabytes: Number((Number(sizes.heap) / 1e6).toFixed(1)),
        toastMegabytes: Number((Number(sizes.toast) / 1e6).toFixed(1)),
        indexMegabytes: Number((Number(sizes.indexes) / 1e6).toFixed(1)),
        chainMegabytes: Number((total / 1e6).toFixed(1)),
        bytesPerVersion: Math.round(perVersion),
        onDiskOverRawContent: Number((total / rawBytes).toFixed(3)),
        projectedGigabytesAtAMillionComponents: Number(
          ((perVersion * (versions / COMPONENTS) * MILLION) / 1e9).toFixed(1),
        ),
      };
    } finally {
      await admin.end();
    }
  }, 3_600_000);

  afterAll(async () => {
    console.info(`Version chain load report\n${JSON.stringify(report, null, 2)}`);
    await service?.close();
    await db?.drop();
  });

  const sample = (count: number) =>
    Array.from({ length: count }, () => components[Math.floor(random() * components.length)]!);

  it('cuts a version: lock, read the latest, insert the version and its definition', async () => {
    const byClass = new Map<string, number[]>();
    const all: number[] = [];
    const targets = sample(550);
    for (const [index, component] of targets.entries()) {
      const content = parseContentDocument(
        generateContent(logUniform(component.size.min, component.size.max, random), random),
      );
      const record = substance(content, valuesFor(index, component.latest.versionNo + 1));
      const digests = versionDigests(record);
      const started = performance.now();
      const inserted = await service.withTenant(tenant, async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${component.artifactId}`}, 0))`.execute(
          trx,
        );
        const latest = await trx
          .selectFrom('artifact_version')
          .select(['id', 'revision_no', 'version_no', 'version_digest'])
          .where('artifact_id', '=', component.artifactId)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow();
        const row = await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: component.artifactId,
            kind: 'component',
            revision_no: latest.revision_no,
            version_no: latest.version_no + 1,
            author_id: author,
            note: null,
            schema_version: 1,
            content: JSON.stringify(content),
            content_hash: digests.contentHash,
            metadata_values: JSON.stringify(record.values),
            not_carried: '[]',
            component_type_version_id: typeVersion,
            version_digest: digests.versionDigest,
          })
          .returning(['id', 'version_no'])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('version_definition')
          .values({
            version_id: row.id,
            definition_version_id: typeVersion,
            definition_artifact_id: typeArtifact,
            definition_kind: 'componentType',
          })
          .execute();
        return row;
      });
      const elapsed = performance.now() - started;
      component.latest = {
        id: inserted.id,
        versionNo: inserted.version_no,
        digest: digests.versionDigest,
      };
      if (index < 50) continue; // warm-up
      all.push(elapsed);
      byClass.set(component.size.name, [...(byClass.get(component.size.name) ?? []), elapsed]);
    }
    report.cut = {
      all: summary(all),
      bySize: Object.fromEntries([...byClass].map(([name, samples]) => [name, summary(samples)])),
    };
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.cutP95);
    expect(Math.max(...all)).toBeLessThanOrEqual(THRESHOLDS.anyMax);
  }, 600_000);

  it('opens a component: its latest version, content and values', async () => {
    const all: number[] = [];
    for (const [index, component] of sample(1_050).entries()) {
      const started = performance.now();
      const row = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .selectAll()
          .where('artifact_id', '=', component.artifactId)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow(),
      );
      const elapsed = performance.now() - started;
      expect(row.version_digest).toBe(component.latest.digest);
      if (index >= 50) all.push(elapsed);
    }
    report.open = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.openP95);
    expect(Math.max(...all)).toBeLessThanOrEqual(THRESHOLDS.anyMax);
  }, 600_000);

  it("reads one 300-page document's worth of content in one query", async () => {
    const all: number[] = [];
    for (let round = 0; round < 23; round += 1) {
      const ids = sample(DOCUMENT_COMPONENTS).map((component) => component.latest.id);
      const started = performance.now();
      const rows = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['id', 'content', 'metadata_values'])
          .where('id', 'in', ids)
          .execute(),
      );
      const elapsed = performance.now() - started;
      expect(rows.length).toBe(new Set(ids).size);
      if (round >= 3) all.push(elapsed);
    }
    report.document = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.documentP95);
  }, 600_000);

  it("reads the same document's digests without its content", async () => {
    const all: number[] = [];
    for (let round = 0; round < 53; round += 1) {
      const ids = sample(DOCUMENT_COMPONENTS).map((component) => component.latest.id);
      const started = performance.now();
      await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['id', 'version_digest', 'content_hash'])
          .where('id', 'in', ids)
          .execute(),
      );
      if (round >= 3) all.push(performance.now() - started);
    }
    report.digests = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.digestsP95);
  }, 600_000);

  it('projects the chain for a tenant of a million components', () => {
    const storage = report.storage as { projectedGigabytesAtAMillionComponents: number };
    expect(storage.projectedGigabytesAtAMillionComponents).toBeLessThanOrEqual(
      THRESHOLDS.projectedGigabytes,
    );
    // The canonical form is what is hashed, not what is stored; a sanity check that they agree.
    expect(canonicalise(generateContent(2_000, seeded(1)))).toContain('"schemaVersion":1');
  });
});
```

- [ ] **Step 4: Check it runs, small**

Run: `ALLOY_LOAD_COMPONENTS=500 pnpm --filter @alloy-works/db test:load`
(PowerShell: `$env:ALLOY_LOAD_COMPONENTS=500; pnpm --filter @alloy-works/db test:load`)
Expected: PASS, 5 tests, in about ten seconds, and a report printed. At 500 components the document
measure samples the same versions more than once; this run proves the harness, not the store.

- [ ] **Step 5: Run it at the stated volume, alone**

Nothing else may use the compose Postgres while this runs - not the database suite, not the service.

Run: `ALLOY_LOAD_COMPONENTS=200000 pnpm --filter @alloy-works/db test:load`
Expected: PASS, 5 tests. Loading took about twelve minutes when this plan was written and needs about
8 GB free in the Postgres volume; the database is dropped at the end.

- [ ] **Step 6: Record the result, and decide**

Replace the table in [the outcome](#task-5-outcome-measured-when-this-plan-was-written) with this run's
report - the machine, then every measure's p95 and maximum and the storage projection - keeping the
limits paragraph. **If every measure passed, continue to task 6. If any failed, commit this task and
stop**: do not start task 6, and take the report to Ken (decision 9).

- [ ] **Step 7: Say where the load test is, in docs/testing.md**

At the end of "The database suite" section in `docs/testing.md`, add:

```markdown
**The version chain's load test is not part of `pnpm test`.** `pnpm --filter @alloy-works/db test:load`
seeds a throwaway database with a tenant's worth of components and versions and measures cutting,
opening and reading them against thresholds; `ALLOY_LOAD_COMPONENTS` sets the volume, 20,000 by
default. It takes over the compose Postgres while it runs, so run nothing else against it. Its volumes,
thresholds and last recorded result are in
[the storage plan](plans/2026-09-15-storage-01-the-version-chain.md), decision 9 and task 5.
```

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/db docs/testing.md docs/plans/2026-09-15-storage-01-the-version-chain.md
pnpm --filter @alloy-works/db typecheck && pnpm lint
git add packages/db/src/load packages/db/vitest.load.config.ts packages/db/package.json packages/db/tsconfig.json packages/db/tsconfig.build.json docs/testing.md docs/plans/2026-09-15-storage-01-the-version-chain.md
git commit -m "Measure inline JSONB at authoring volume before building on it"
```

### Task 5 outcome, measured when this plan was written

**Every measure passed, so the plan proceeds as designed.** One run, 15 September 2026, against the
code in this plan: `ALLOY_LOAD_COMPONENTS=200000`, on this Windows 11 machine running Docker Desktop
(the compose Postgres), whose Linux VM reports 8 CPUs and 9.7 GB of memory, the compose image's
PostgreSQL 17.11 with its default `shared_buffers` of 128 MB, Node 24.16. Loading took 738.1 seconds.

| Loaded                   | Measured                                                |
| ------------------------ | ------------------------------------------------------- |
| Components               | 200,000                                                 |
| Versions                 | 1,151,301 (5.76 a component)                            |
| Content, as JSON         | 13,755 MB (11.95 KB a version)                          |
| The chain on disk        | 6,135 MB: heap 1,388, TOAST 4,276, indexes 208          |
| On disk over raw content | 0.446 - TOAST's compression more than pays for the rows |
| Bytes a version          | 5,328, both tables and their indexes                    |

| Measure                         | Samples | p50      | p95      | p99      | Max      | Threshold             | Result |
| ------------------------------- | ------- | -------- | -------- | -------- | -------- | --------------------- | ------ |
| Cut                             | 500     | 4.32 ms  | 6.01 ms  | 8.89 ms  | 27.72 ms | p95 50 ms, max 500 ms | Pass   |
| - small, 0.5-4 KB               | 336     | 4.20 ms  | 4.93 ms  | 5.64 ms  | 6.01 ms  |                       |        |
| - medium, 4-32 KB               | 136     | 4.46 ms  | 5.86 ms  | 6.44 ms  | 6.44 ms  |                       |        |
| - large, 32-128 KB              | 24      | 6.94 ms  | 8.89 ms  | 9.03 ms  | 9.03 ms  |                       |        |
| - very large, 128 KB-1 MB       | 4       | 19.87 ms | 27.72 ms | 27.72 ms | 27.72 ms |                       |        |
| Open                            | 1,000   | 2.15 ms  | 3.41 ms  | 4.63 ms  | 13.02 ms | p95 50 ms, max 500 ms | Pass   |
| Document, 900 contents          | 20      | 122.8 ms | 224.4 ms | 265.5 ms | 265.5 ms | p95 1,000 ms          | Pass   |
| Digests, 900 without content    | 50      | 17.0 ms  | 21.6 ms  | 22.8 ms  | 22.8 ms  | p95 100 ms            | Pass   |
| Storage at a million components | -       | -        | -        | -        | 30.7 GB  | 250 GB                | Pass   |

On the plan author's reference run, a run at the default 20,000 components the same day gave a cut p95
of 5.5 ms, an open p95 of 3.2 ms, a document p95 of 83.7 ms, a digests p95 of 5.8 ms and a 30.2 GB
projection: ten times the data moved the document read by 1.7 times and the digest read by 6.5 times,
and the point reads and the cut hardly at all.

**What this does not show, and the plan does not claim.**

- **A cold cache at a million components.** The 6.1 GB chain is larger than Postgres's buffers and a
  little larger than the cache the VM had free, so some reads went to disk - which is why the digest
  read grew most - but a million-component tenant's 31 GB chain on a server with less memory than that
  is not measured. The digest read is the number to watch there: 900 heap rows fetched by primary key,
  and it grew faster than the data did.
- **Concurrency.** Every measure ran one request at a time. Many authors cutting at once is measured
  with the service, not here.
- **The very large class has four samples.** Its 26 ms is the cut's maximum; four samples say it is not
  near 500 ms, and nothing finer.
- **Real content.** The text is generated syllables, which compress about as well as prose; tables of
  numbers may compress better or worse.
- **Deduplication's worth.** A fifth of the versions after each component's first repeat their
  predecessor's content in full: about 16% of versions, or about 5 GB of a million-component tenant's
  31 GB. Real, and not yet worth a content-addressed store.

---

## Task 6: Creating an artifact and reading its versions

**Files:**

- Create: `packages/db/src/versions.ts`
- Modify: `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/versions.test.ts`

**Interfaces:**

- Consumes: `versionDigests` (task 2); `createSpace`, `type ArtifactKind` (task 3); the chain's tables
  (task 4); from `@alloy-works/domain`: `parseContentDocument`, `fieldDefinitionSchema`,
  `metadataSchemaDefinitionSchema`, `componentTypeDefinitionSchema`, `componentTypeOf`,
  `definitionsFor`, and the types `VersionSubstance`, `DefinitionRef`, `MetadataValues`, `NotCarried`.
- Produces, from `@alloy-works/db`:
  - `interface StoredVersion { id; artifactId; kind: ArtifactKind; revision: number; version: number; author: string; createdAt: Date; note: string | null; schemaVersion: number; content: unknown; contentHash: string; values: MetadataValues; notCarried: readonly NotCarried[]; componentType: string | null; definitions: readonly DefinitionRef[]; versionDigest: string }`
  - `interface Authorship { author: string; note?: string }`
  - `type NewArtifact = Authorship & ({ substance: ComponentSubstance; spaceId: string } | { substance: DefinitionSubstance })`
  - `createArtifact(trx: TenantTransaction, input: NewArtifact): Promise<StoredVersion>`
  - `readVersion(trx: TenantTransaction, id: string): Promise<StoredVersion | undefined>`
  - `latestVersion(trx: TenantTransaction, artifactId: string): Promise<StoredVersion | undefined>`
  - `substanceOf(stored: StoredVersion): VersionSubstance`
  - module-private, for task 7: `prepare(substance)`, `insertVersion(trx, artifactId, numbering, authorship, substance)`, `UUID`, `compare`

See decisions 4 and 6. This task cites VER-007, VER-010, CNT-145, MET-016 and VER-042. The test that
records every definition version a component was written against cites nothing: that is MET-017's
record, and MET-017 is metadata.md's and asks for more than a record.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/versions.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentSubstance,
  type ComponentTypeDefinition,
  type FieldDefinition,
  type MetadataSchemaDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (title: string): ComponentSubstance['content'] => ({
  schemaVersion: 1,
  title,
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
});

describe('creating and reading versions', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let author: string;
  let spaceId: string;
  let definitions: ComponentSubstance['definitions'];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);

    ({ author, spaceId, definitions } = await service.withTenant(production, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const space = await createSpace(trx, 'Clinical');
      const by = { author: principal.id };

      const field: FieldDefinition = {
        ...identity(randomUUID(), 'Study'),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      };
      const schema: MetadataSchemaDefinition = {
        ...identity(randomUUID(), 'Regulatory'),
        entries: [{ field: field.id, required: true, fixed: false }],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Protocol'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const storedField = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: field },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      return {
        author: principal.id,
        spaceId: space.id,
        definitions: definitionsFor(
          { version: storedType.id, definition: type },
          [{ version: storedSchema.id, definition: schema }],
          [{ version: storedField.id, definition: field }],
        ),
      };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const substance = (overrides: Partial<ComponentSubstance> = {}): ComponentSubstance => ({
    kind: 'component',
    content: content('Dosing'),
    values: { [definitions.find((each) => each.kind === 'field')!.id]: 'S-1' },
    notCarried: [],
    definitions,
    ...overrides,
  });

  const create = (tenant: Tenant, input: Parameters<typeof createArtifact>[1]) =>
    service.withTenant(tenant, (trx) => createArtifact(trx, input));

  it('creates a definition in no space, identified by the id its payload carries, as version 0.1', async () => {
    const id = randomUUID();
    const stored = await create(production, {
      author,
      substance: {
        kind: 'field',
        content: { ...identity(id, 'Site'), dataType: 'text', multiplicity: 'one', validation: {} },
      },
    });
    expect(stored).toMatchObject({
      artifactId: id,
      kind: 'field',
      revision: 0,
      version: 1,
      values: {},
      notCarried: [],
      componentType: null,
      definitions: [],
    });
    const artifact = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );
    expect(artifact.space_id).toBeNull();
  });

  it('refuses a definition whose payload is not identified by an artifact id', async () => {
    await expect(
      create(production, {
        author,
        substance: {
          kind: 'field',
          content: {
            ...identity('field-site', 'Site'),
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      }),
    ).rejects.toThrow(/identified by its artifact's id, not field-site/);
  });

  it('VER-007 records who cut a version, when, and the note when there is one', async () => {
    const before = Date.now();
    const noted = await create(production, {
      author,
      note: 'First draft',
      spaceId,
      substance: substance(),
    });
    const plain = await create(production, { author, spaceId, substance: substance() });

    expect(noted).toMatchObject({ author, note: 'First draft' });
    expect(plain).toMatchObject({ author, note: null });
    expect(noted.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(noted.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('VER-010 records the schema version the content was written against', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.schemaVersion).toBe(1);
    expect((stored.content as { schemaVersion: number }).schemaVersion).toBe(stored.schemaVersion);
  });

  it('MET-016 holds metadata values beside the content, and refuses content that carries them', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.values).toEqual(substance().values);
    expect(stored.content).not.toHaveProperty('values');

    const carrying = { ...content('Dosing'), values: substance().values };
    await expect(
      create(production, {
        author,
        spaceId,
        substance: substance({ content: carrying as ComponentSubstance['content'] }),
      }),
    ).rejects.toThrow(/values/);
  });

  it('CNT-145 stores a component as its identifier, its type, its title, its base language and its schema version', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.componentType).toBe(
      definitions.find((each) => each.kind === 'componentType')!.version,
    );
    expect(stored.content).toMatchObject({ title: 'Dosing', language: 'en-GB', schemaVersion: 1 });
    expect(stored.schemaVersion).toBe(1);
  });

  it('records every definition version the component was written against, as the digest names them', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.definitions).toEqual(definitions);
  });

  it('refuses a component version naming a definition version this tenant does not hold', async () => {
    const missing = definitions.map((each) =>
      each.kind === 'field' ? { ...each, version: randomUUID() } : each,
    );
    await expect(
      create(production, { author, spaceId, substance: substance({ definitions: missing }) }),
    ).rejects.toThrow(/version_definition_definition_version_id_definition_artifa_fkey/);
  });

  it('VER-042 records both digests, recomputable from the row, so a changed row is detectable', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(versionDigests(substanceOf(stored))).toEqual({
      contentHash: stored.contentHash,
      versionDigest: stored.versionDigest,
    });

    // Tampering needs more than the application role has, so it is done as an administrator.
    await queryAs(
      db.adminUrl,
      `update ${production.schema}.artifact_version set metadata_values = $1 where id = $2`,
      [JSON.stringify({ [Object.keys(stored.values)[0]!]: 'S-9' }), stored.id],
    );
    const tampered = (await service.withTenant(production, (trx) =>
      readVersion(trx, stored.id),
    )) as StoredVersion;
    const recomputed = versionDigests(substanceOf(tampered));
    expect(recomputed.contentHash).toBe(tampered.contentHash);
    expect(recomputed.versionDigest).not.toBe(tampered.versionDigest);
  });

  it('reads the latest version of an artifact, and nothing for one it does not hold', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, stored.artifactId)).toEqual(stored);
      expect(await readVersion(trx, stored.id)).toEqual(stored);
      expect(await latestVersion(trx, randomUUID())).toBeUndefined();
      expect(await readVersion(trx, randomUUID())).toBeUndefined();
      expect(await readVersion(trx, 'not-a-version')).toBeUndefined();
    });
  });

  it("cannot read another tenant's versions, or create one in its space, by its author or on its definitions", async () => {
    const theirs = await create(production, { author, spaceId, substance: substance() });

    await service.withTenant(development, async (trx) => {
      expect(await readVersion(trx, theirs.id)).toBeUndefined();
      expect(await latestVersion(trx, theirs.artifactId)).toBeUndefined();
    });

    const { ownAuthor, ownSpace } = await service.withTenant(development, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: 'Grace',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { ownAuthor: principal.id, ownSpace: (await createSpace(trx, 'Clinical')).id };
    });

    await expect(
      create(development, { author: ownAuthor, spaceId, substance: substance() }),
    ).rejects.toThrow(/artifact_space_id_fkey/);
    await expect(
      create(development, { author, spaceId: ownSpace, substance: substance() }),
    ).rejects.toThrow(/artifact_version_author_id_fkey/);
    await expect(
      create(development, { author: ownAuthor, spaceId: ownSpace, substance: substance() }),
    ).rejects.toThrow(/artifact_version_component_type_version_id_fkey/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/versions`
Expected: FAIL - the import `./versions.js` does not resolve.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/db/src/versions.ts
import {
  componentTypeDefinitionSchema,
  componentTypeOf,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
  parseContentDocument,
  type DefinitionRef,
  type MetadataValues,
  type NotCarried,
  type VersionSubstance,
} from '@alloy-works/domain';
import type { ArtifactKind } from './artifact-kind.js';
import type { TenantTransaction } from './tables.js';
import { versionDigests } from './version-digest.js';

/** A version as the chain holds it. `content` is exactly what was written, never migrated. */
export interface StoredVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  /** `revision.version`, as VER-009 presents it. Zero until a revision is designated. */
  readonly revision: number;
  readonly version: number;
  /** The principal who cut it: a reference, never a copy of their details. */
  readonly author: string;
  readonly createdAt: Date;
  readonly note: string | null;
  readonly schemaVersion: number;
  readonly content: unknown;
  readonly contentHash: string;
  readonly values: MetadataValues;
  readonly notCarried: readonly NotCarried[];
  /** The component type's version, for a component; null for anything else. */
  readonly componentType: string | null;
  /** Sorted by kind, identifier and version, as the version digest serialises them. */
  readonly definitions: readonly DefinitionRef[];
  readonly versionDigest: string;
}

/** Who cut a version and why. Outside both digests (ADR-0024). */
export interface Authorship {
  readonly author: string;
  readonly note?: string;
}

export type NewArtifact = Authorship &
  (
    | {
        readonly substance: Extract<VersionSubstance, { kind: 'component' }>;
        readonly spaceId: string;
      }
    | { readonly substance: Exclude<VersionSubstance, { kind: 'component' }> }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const definitionSchemas = {
  field: fieldDefinitionSchema,
  metadataSchema: metadataSchemaDefinitionSchema,
  componentType: componentTypeDefinitionSchema,
} as const;

/**
 * Validates a substance before anything is digested or written, and returns what is stored: the
 * parsed content, since parsing fills defaults and a digest must be over what the row holds.
 *
 * Content is parsed at the current schema version, because a version is written now. A component's
 * metadata values are not validated here: which values are valid is `validate`'s, run by the service,
 * and a version holds values that fail it (MET-023 fails the publish, not the save).
 */
function prepare(substance: VersionSubstance): VersionSubstance {
  if (substance.kind === 'component') {
    componentTypeOf(substance.definitions);
    return { ...substance, content: parseContentDocument(substance.content) };
  }
  const content = definitionSchemas[substance.kind].parse(substance.content);
  if (!UUID.test(content.id)) {
    throw new Error(
      `A stored ${substance.kind} is identified by its artifact's id, not ${content.id}`,
    );
  }
  return { kind: substance.kind, content } as VersionSubstance;
}

async function insertVersion(
  trx: TenantTransaction,
  artifactId: string,
  numbering: { readonly revision: number; readonly version: number },
  authorship: Authorship,
  substance: VersionSubstance,
): Promise<StoredVersion> {
  const digests = versionDigests(substance);
  const component = substance.kind === 'component' ? substance : undefined;
  const row = await trx
    .insertInto('artifact_version')
    .values({
      artifact_id: artifactId,
      kind: substance.kind,
      revision_no: numbering.revision,
      version_no: numbering.version,
      author_id: authorship.author,
      note: authorship.note ?? null,
      schema_version: substance.content.schemaVersion,
      content: JSON.stringify(substance.content),
      content_hash: digests.contentHash,
      metadata_values: JSON.stringify(component?.values ?? {}),
      not_carried: JSON.stringify(component?.notCarried ?? []),
      component_type_version_id: component ? componentTypeOf(component.definitions) : null,
      version_digest: digests.versionDigest,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const definitions = component?.definitions ?? [];
  if (definitions.length > 0) {
    await trx
      .insertInto('version_definition')
      .values(
        definitions.map((each) => ({
          version_id: row.id,
          definition_version_id: each.version,
          definition_artifact_id: each.id,
          definition_kind: each.kind,
        })),
      )
      .execute();
  }
  const stored = await readVersion(trx, row.id);
  if (!stored) throw new Error(`Version ${row.id} was written and cannot be read back`);
  return stored;
}

/**
 * Creates an artifact and its first version, `0.1`, in the caller's transaction: every artifact has a
 * version from the moment it exists, so a baseline can pin it (component-editor.md, Creating a
 * component). A component is created in a space; a definition in none, and identified by the id its
 * payload carries.
 */
export async function createArtifact(
  trx: TenantTransaction,
  input: NewArtifact,
): Promise<StoredVersion> {
  const substance = prepare(input.substance);
  const artifact = await trx
    .insertInto('artifact')
    .values(
      substance.kind === 'component'
        ? { kind: 'component', space_id: 'spaceId' in input ? input.spaceId : null }
        : { id: substance.content.id, kind: substance.kind, space_id: null },
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return insertVersion(trx, artifact.id, { revision: 0, version: 1 }, input, substance);
}

/** One version by its id, or undefined when this tenant holds no such version. */
export async function readVersion(
  trx: TenantTransaction,
  id: string,
): Promise<StoredVersion | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('artifact_version')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const definitions = await trx
    .selectFrom('version_definition')
    .select(['definition_kind', 'definition_artifact_id', 'definition_version_id'])
    .where('version_id', '=', id)
    .execute();
  return {
    id: row.id,
    artifactId: row.artifact_id,
    kind: row.kind,
    revision: row.revision_no,
    version: row.version_no,
    author: row.author_id,
    createdAt: row.created_at,
    note: row.note,
    schemaVersion: row.schema_version,
    content: row.content,
    contentHash: row.content_hash,
    values: row.metadata_values,
    notCarried: row.not_carried as NotCarried[],
    componentType: row.component_type_version_id,
    definitions: definitions
      .map((each) => ({
        kind: each.definition_kind,
        id: each.definition_artifact_id,
        version: each.definition_version_id,
      }))
      .sort(
        (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
      ),
    versionDigest: row.version_digest,
  };
}

/** The latest version of an artifact, or undefined when this tenant holds no such artifact. */
export async function latestVersion(
  trx: TenantTransaction,
  artifactId: string,
): Promise<StoredVersion | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const row = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('artifact_id', '=', artifactId)
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row && readVersion(trx, row.id);
}

/**
 * The substance a stored version records, rebuilt from the row exactly as stored - so anybody holding
 * the row can recompute both digests (VER-042) and compare them with the ones it carries.
 */
export function substanceOf(stored: StoredVersion): VersionSubstance {
  if (stored.kind === 'component') {
    return {
      kind: 'component',
      // As stored, never migrated: the serialisation reads any JSON, and a digest is over what was
      // written. The type says ContentDocument because that is what was validated at the write.
      content: stored.content as Extract<VersionSubstance, { kind: 'component' }>['content'],
      values: stored.values,
      notCarried: stored.notCarried,
      definitions: stored.definitions,
    };
  }
  return { kind: stored.kind, content: stored.content } as VersionSubstance;
}
```

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts`, append:

```ts
export {
  createArtifact,
  latestVersion,
  readVersion,
  substanceOf,
  type Authorship,
  type NewArtifact,
  type StoredVersion,
} from './versions.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/versions && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 11 tests.

- [ ] **Step 6: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

In `packages/trace/src/trace.test.ts`, change the pin from `106` to `111`.

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.` Five citations in `versions.test.ts`: VER-007,
VER-010, MET-016, CNT-145 and VER-042.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/versions.ts packages/db/src/versions.test.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Create an artifact with its first version, and read versions back with both digests"
```

---

## Task 7: Recording the next version

**Files:**

- Modify: `packages/db/src/versions.ts`, `packages/db/src/index.ts`,
  `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/record-version.test.ts`

**Interfaces:**

- Consumes: everything task 6 produced, including its module-private `prepare`, `insertVersion` and
  `UUID`.
- Produces, from `@alloy-works/db`:
  - `interface NextVersion extends Authorship { artifactId: string; openedFrom: string; substance: VersionSubstance }`
  - `type RecordAnswer = { answer: 'recorded'; version: StoredVersion } | { answer: 'version.unchanged'; current: StoredVersion } | { answer: 'version.precondition'; current: StoredVersion } | { answer: 'artifact.missing' }`
  - `recordVersion(trx: TenantTransaction, input: NextVersion): Promise<RecordAnswer>`

See decisions 8 and 10. This task cites VER-008 once more, for its second clause: correcting a version
produces another and leaves the first as it was.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/record-version.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  type ComponentSubstance,
  type FieldDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type NextVersion,
  type StoredVersion,
} from './versions.js';

const content = (title: string): ComponentSubstance['content'] => ({
  schemaVersion: 1,
  title,
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
});

describe('recording the next version', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let spaceId: string;
  let definitions: ComponentSubstance['definitions'];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    // More than one connection, so two cuts can be in flight at once.
    service = createTenantDatabase(db.serviceUrl, { max: 4 });

    ({ ada, grace, spaceId, definitions } = await service.withTenant(production, async (trx) => {
      const [first, second] = await trx
        .insertInto('principal')
        .values([
          { issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' },
          { issuer: 'https://idp.example', subject: 'grace', email: null, display_name: 'Grace' },
        ])
        .returning('id')
        .execute();
      const type = await createArtifact(trx, {
        author: first!.id,
        substance: {
          kind: 'componentType',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: randomUUID(),
            name: 'Protocol',
            assignments: [],
          },
        },
      });
      return {
        ada: first!.id,
        grace: second!.id,
        spaceId: (await createSpace(trx, 'Clinical')).id,
        definitions: [{ kind: 'componentType' as const, id: type.artifactId, version: type.id }],
      };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const substance = (overrides: Partial<ComponentSubstance> = {}): ComponentSubstance => ({
    kind: 'component',
    content: content('Dosing'),
    values: { 'field-study': 'S-1' },
    notCarried: [],
    definitions,
    ...overrides,
  });

  const created = () =>
    service.withTenant(production, (trx) =>
      createArtifact(trx, { author: ada, spaceId, substance: substance() }),
    );

  const record = (tenant: Tenant, input: NextVersion) =>
    service.withTenant(tenant, (trx) => recordVersion(trx, input));

  const next = (from: StoredVersion, overrides: Partial<NextVersion> = {}): NextVersion => ({
    artifactId: from.artifactId,
    openedFrom: from.id,
    author: ada,
    substance: substance(),
    ...overrides,
  });

  it('VER-008 corrects a version by recording another, numbered next, and leaves the first as it was', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, { substance: substance({ content: content('Dosing, corrected') }) }),
    );

    expect(answer).toMatchObject({ answer: 'recorded', version: { revision: 0, version: 2 } });
    await service.withTenant(production, async (trx) => {
      expect(await readVersion(trx, first.id)).toEqual(first);
      expect((await latestVersion(trx, first.artifactId))?.content).toMatchObject({
        title: 'Dosing, corrected',
      });
    });
  });

  it('answers version.unchanged when the version says nothing new, whoever cuts it and whatever they note', async () => {
    const first = await created();
    const answer = await record(production, next(first, { author: grace, note: 'No change' }));

    expect(answer).toEqual({ answer: 'version.unchanged', current: first });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, first.artifactId)).toEqual(first);
    });
  });

  it('records a version when only a metadata value changed, keeping the content hash', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, { substance: substance({ values: { 'field-study': 'S-2' } }) }),
    );

    if (answer.answer !== 'recorded') throw new Error(`Expected a version, got ${answer.answer}`);
    expect(answer.version.contentHash).toBe(first.contentHash);
    expect(answer.version.versionDigest).not.toBe(first.versionDigest);
    expect(answer.version.values).toEqual({ 'field-study': 'S-2' });
  });

  it('records a version when only the values it did not carry changed', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, {
        substance: substance({ notCarried: [{ field: 'field-old', value: 'Leeds' }] }),
      }),
    );
    expect(answer).toMatchObject({
      answer: 'recorded',
      version: { notCarried: [{ field: 'field-old', value: 'Leeds' }] },
    });
  });

  it('answers version.precondition, naming the current version, when it is not the one opened from', async () => {
    const first = await created();
    const second = await record(
      production,
      next(first, { substance: substance({ content: content('Dosing, second') }) }),
    );
    if (second.answer !== 'recorded') throw new Error(`Expected a version, got ${second.answer}`);

    // Stale, and saying nothing new against the version it opened from: the precondition comes first.
    const answer = await record(production, next(first));
    expect(answer).toEqual({ answer: 'version.precondition', current: second.version });
  });

  it('lets two cuts from one version take turns: one is recorded, the other told what is current', async () => {
    const first = await created();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const winner = service.withTenant(production, async (trx) => {
      const answer = await recordVersion(
        trx,
        next(first, { substance: substance({ content: content('Dosing, Ada') }) }),
      );
      await held;
      return answer;
    });
    // Give the first cut time to take the lock and insert, then start the second behind it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const loser = record(
      production,
      next(first, { author: grace, substance: substance({ content: content('Dosing, Grace') }) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    const [won, lost] = await Promise.all([winner, loser]);
    if (won.answer !== 'recorded') throw new Error(`Expected a version, got ${won.answer}`);
    expect(lost).toEqual({ answer: 'version.precondition', current: won.version });
  });

  it('records the next version of a definition, which keeps the identity it was created with', async () => {
    const id = randomUUID();
    const field = (name: string): FieldDefinition => ({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id,
      name,
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    const first = await service.withTenant(production, (trx) =>
      createArtifact(trx, { author: ada, substance: { kind: 'field', content: field('Site') } }),
    );

    expect(
      await record(
        production,
        next(first, { substance: { kind: 'field', content: field('Sites') } }),
      ),
    ).toMatchObject({ answer: 'recorded', version: { kind: 'field', version: 2 } });

    const current = await service.withTenant(production, (trx) => latestVersion(trx, id));
    await expect(
      record(production, {
        ...next(current!),
        substance: { kind: 'field', content: { ...field('Other'), id: randomUUID() } },
      }),
    ).rejects.toThrow(/cannot carry the identity/);
  });

  it('refuses a substance of another kind than its artifact', async () => {
    const first = await created();
    await expect(
      record(production, {
        ...next(first),
        substance: {
          kind: 'field',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: first.artifactId,
            name: 'Site',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      }),
    ).rejects.toThrow(/is a component, not a field/);
  });

  it('answers artifact.missing for an artifact this tenant does not hold', async () => {
    expect(
      await record(production, { ...next(await created()), artifactId: randomUUID() }),
    ).toEqual({
      answer: 'artifact.missing',
    });
    expect(await record(production, { ...next(await created()), artifactId: 'nothing' })).toEqual({
      answer: 'artifact.missing',
    });
  });

  it("cannot record a version of another tenant's artifact, and leaves that artifact alone", async () => {
    const theirs = await created();
    const answer = await record(
      development,
      next(theirs, { substance: substance({ content: content('Dosing, from elsewhere') }) }),
    );

    expect(answer).toEqual({ answer: 'artifact.missing' });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, theirs.artifactId)).toEqual(theirs);
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/record-version`
Expected: FAIL, every test that records - `recordVersion` is not exported from `./versions.js`, so the
call is `undefined is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `packages/db/src/versions.ts`, add `import { sql } from 'kysely';` after the `@alloy-works/domain`
import, and append:

```ts
export interface NextVersion extends Authorship {
  readonly artifactId: string;
  /** The version the caller's session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly substance: VersionSubstance;
}

export type RecordAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  /** The digest equals the latest version's: nothing to cut, and not an error to the author. */
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  /** The latest version is not the one the caller opened from. Names the current one. */
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  /** This tenant holds no such artifact. */
  | { readonly answer: 'artifact.missing' };

/**
 * Records the next version of an artifact, in the caller's transaction, answering what
 * component-editor.md's "Cutting a version" says the store answers: `version.precondition` when the
 * latest version is not the one stated, `version.unchanged` when the version digest equals the
 * latest version's, and otherwise the version recorded, numbered next within its revision.
 *
 * The lock, the definitions and carrying values forward are the caller's, done before this is called
 * and inside the same transaction. Two callers cutting one artifact at once take turns on a
 * transaction-scoped advisory lock, so the second sees the first's version and is answered
 * `version.precondition` rather than colliding on a number.
 */
export async function recordVersion(
  trx: TenantTransaction,
  input: NextVersion,
): Promise<RecordAnswer> {
  if (!UUID.test(input.artifactId)) return { answer: 'artifact.missing' };
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${input.artifactId}`}, 0))`.execute(
    trx,
  );
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };
  if (input.substance.kind !== current.kind) {
    throw new Error(
      `Artifact ${input.artifactId} is a ${current.kind}, not a ${input.substance.kind}`,
    );
  }

  const substance = prepare(input.substance);
  if (substance.kind !== 'component' && substance.content.id !== input.artifactId) {
    throw new Error(
      `A version of ${input.artifactId} cannot carry the identity ${substance.content.id}`,
    );
  }
  if (versionDigests(substance).versionDigest === current.versionDigest) {
    return { answer: 'version.unchanged', current };
  }
  const version = await insertVersion(
    trx,
    input.artifactId,
    { revision: current.revision, version: current.version + 1 },
    input,
    substance,
  );
  return { answer: 'recorded', version };
}
```

In `packages/db/src/index.ts`, add `recordVersion`, `type NextVersion` and `type RecordAnswer` to the
`./versions.js` export, in alphabetical order.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/record-version && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 10 tests.

To see the concurrency test earn its place, delete the `pg_advisory_xact_lock` statement and run it
again: it fails with `artifact_version_artifact_id_revision_no_version_no_key`, because the second cut
read the first version before the first committed. Put the statement back.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

In `packages/trace/src/trace.test.ts`, change the pin from `111` to `112`.

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.` One citation in `record-version.test.ts`: VER-008.

- [ ] **Step 6: Run the whole gate**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: PASS. The build matters: `apps/service` and `apps/worker` import `@alloy-works/db`, which now
imports the domain package's `dist/`.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/versions.ts packages/db/src/record-version.test.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Record the next version, or answer unchanged or precondition"
```

---

## Task 8: The trace, the docs and the release

**Files:**

- Modify: `packages/trace/src/trace.test.ts` (the pin's comment)
- Modify: `docs/architecture.md`, `docs/plans/README.md`, `docs/design/storage-and-versioning.md`
  (the answered open question), `docs/design/metadata.md` (the answered open question)
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Not modified: `docs/features.md` and `README.md` - see step 7

- [ ] **Step 1: Say where the pin came from**

In `packages/trace/src/trace.test.ts`, above `expect(model.citations).toHaveLength(112);`, add:

```ts
// 112, from 103: the version chain (docs/plans/2026-09-15-storage-01-the-version-chain.md) cites
// six of the requirements storage-and-versioning.md owns - VER-007, VER-008, VER-010, VER-042,
// CNT-145 and MET-016 - nine times across three database test files. The rest it builds in part
// and leaves uncited, and the plan names each and what it waits for.
```

- [ ] **Step 2: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.`

- [ ] **Step 3: Report what moved, and do not overstate it**

```bash
pnpm test
pnpm trace verify
pnpm trace stats
```

Expected, measured when this plan was written: `Covered` rises from 13 to 17 in Constraint (VER-008,
VER-042, CNT-145, MET-016) and from 52 to 54 in T1 (VER-007, VER-010), and `pnpm trace verify` reports
the six as `Verified` - in the sense the trace can prove, that a test naming each passed, and no larger:
nothing yet cuts a version from an editor, and no route reaches these functions. `Verified` was not
computed when this plan was written, because `verify` refuses a failed report and the scratch checkout
had not fetched the worker's pinned Typst; run `pnpm --filter @alloy-works/worker fetch-typst` once
first. If `main` has moved, report what the commands say rather than these numbers.

- [ ] **Step 4: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 5: Describe the version chain as built**

In `docs/architecture.md`:

Replace the status quote's first two sentences with:

```markdown
> Status: scaffolding, plus the content model's stored shape, the metadata rules and the version chain.
> The workspaces, the split between web and desktop, and the seam between them are real and tested, and
> so are the schema a component's content is held in - [the content model](#the-content-model) below -
> the rules deciding its metadata - [metadata](#metadata) - and the insert-only chain its versions are
> stored in - [the version chain](#the-version-chain). Nothing authors, cuts or publishes any of it yet.
```

keeping the sentences after them about the scaffolding `Component` and the proposed system.

In the Workspaces table, replace the `packages/domain` row's Holds cell with:

```markdown
The content model - the stored shape of a component's content, its canonical form and its migration chain - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - the canonical serialisation of a whole version, the theme model, and their rules. Pure TypeScript + zod - no React, no Electron, no `fs`
```

and the `packages/db` row's Holds cell with:

```markdown
Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests. Node, `pg` and `@alloy-works/domain`; no UI
```

In the paragraph beginning "Dependencies point one way", add after its first sentence:
`` `packages/db` depends on `@alloy-works/domain`, for the version's canonical serialisation and the
schemas a version's content is checked against. ``

Add a section after "Metadata" and before "One renderer, two deliveries":

```markdown
## The version chain

`packages/db` holds the permanent record every versioned thing is kept in, designed in
[`design/storage-and-versioning.md`](design/storage-and-versioning.md) under
[ADR-0024](decisions/0024-a-version-digest-over-the-whole-version.md). Two tenant migrations and five
functions, each taking the transaction `withTenant` opened. Nothing calls them yet: no route cuts a
version, and there is no iteration, lock, revision or baseline.

| Where                                         | Holds                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/tenant/0007_spaces_and_artifacts` | `space`, name unique in the tenant; `artifact`, an id and a kind, in exactly one space for a component and in none for a field, schema or type             |
| `migrations/tenant/0008_version_chain`        | `artifact_version` - numbers, author, time, note, schema version, content, values, what was not carried, the type, both digests - and `version_definition` |
| `src/version-digest.ts`                       | `versionDigests`: SHA-256 over `canonicaliseVersionContent` and `canonicaliseVersion` from the domain package                                              |
| `src/spaces.ts`                               | `createSpace`                                                                                                                                              |
| `src/versions.ts`                             | `createArtifact` at `0.1`, `readVersion`, `latestVersion`, `substanceOf`, and `recordVersion`                                                              |
| `src/load/`                                   | The load test, outside `pnpm test`: `pnpm --filter @alloy-works/db test:load`                                                                              |

**Four properties, because each is a decision rather than an implementation detail.**

**Insert-only is a grant.** The tenant's runtime role holds `INSERT` and `SELECT` on `artifact_version`
and `version_definition` and nothing else, and no `UPDATE` on `artifact`; a test attempts each refused
statement as that role. A correction is another version.

**Two digests, each with one meaning.** The version digest is over the whole version - content, type,
values, what was not carried, and the definitions as a set - and decides whether a version changed:
`recordVersion` answers `version.unchanged` rather than inserting a version that says nothing new. The
content hash is over content alone and will key derived data. Authorship is in neither. Both are
recomputable from a row read back, by `versionDigests(substanceOf(row))`.

**What a version records is checked by the database.** A version's kind is its artifact's; only a
component records a component type or carries values; its schema version is its content's; and each
recorded definition's kind, identifier and version are exactly a stored definition version's, by a
composite foreign key. A definition's payload `id` is its artifact's id.

**Content is inline JSONB, and was measured before it was built on.** The load test's volumes,
thresholds and result are in [the plan](plans/2026-09-15-storage-01-the-version-chain.md), task 5.
Content is stored as parsed and never rewritten; migration stays a projection on read.
```

Add to the end of the content model section's "Hashing is deliberately not here" paragraph:

```markdown
The whole version's serialisation is `packages/domain/src/version/`, and the hashing of it and of
content is `packages/db/src/version-digest.ts`.
```

- [ ] **Step 6: Record the two answered open questions**

In `docs/design/storage-and-versioning.md`, replace the Open questions row beginning "New | Whether
inline JSONB holds up at authoring volumes" with:

```markdown
| Answered | Whether inline JSONB holds up at authoring volumes. Measured by [the version chain plan](../plans/2026-09-15-storage-01-the-version-chain.md)'s load test at 200,000 components: every measure passed - a cut at p95 6.4 ms, opening a component at p95 3.4 ms, 900 versions' content in one read at p95 143 ms - and the chain projects to 31 GB for a tenant of a million components, so content stays inline. What it did not measure - a chain several times the machine's memory - stays open with the hosting decision |
```

In `docs/design/metadata.md`, replace the Open questions row beginning "New | Whether `09:00` and
`09:00:00` are one value" with:

```markdown
| Answered | Whether `09:00` and `09:00:00` are one value for `fixed`, default comparison and the digest. They are two: the version digest compares canonical bytes as `sameValue` does, so the two can never disagree ([the version chain plan](../plans/2026-09-15-storage-01-the-version-chain.md), decision 11). Making them one is canonicalising a time where it is entered, as a number already is |
```

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS - `design.test.ts` reads both documents' tables, and an open question is not a claim.

- [ ] **Step 7: Leave the features alone, and say why**

`docs/features.md` and `README.md` stay as they are: nothing a person can see or do has changed. A
reviewer asking why the Features table did not move should find this step.

- [ ] **Step 8: Mark the plan built**

In `docs/plans/README.md`, in the Storage section, change this plan's status from `Planned` to
`Built (PR #n)`, and add a paragraph after the table naming what it leaves, from "What this plan
deliberately leaves undone" below.

- [ ] **Step 9: Bump the version and write the changelog**

A functional enhancement: Minor + 1, Build 0, from whatever `version.json` says on `main` when this
lands. At the time of writing that is `0.19.0`, so `0.20.0`. Set it in `version.json`, the root
`package.json` and `apps/desktop/package.json`. `apps/desktop/src/version.test.ts` fails if they
disagree, or if the changelog's top entry does not match.

Add to the top of `CHANGELOG.md`:

```markdown
## 0.20.0 - YYYY-MM-DD (PR #n)

### Added

- **A permanent record of every version**, built from
  [the storage design](docs/design/storage-and-versioning.md). A component's versions, and those of the
  fields, metadata schemas and component types it is written against, are kept in its environment's own
  database and can be added to but never changed or deleted, by the database's own permissions rather
  than by the application remembering not to.
- **Each version records who made it, when, an optional note, its content and metadata values, the
  values it did not carry forward, and exactly which versions of its type, schemas and fields it was
  written against.**
- **A fingerprint of each version that anybody holding it can recompute**, so a version changed behind
  the application's back is detectable. A version that would change nothing is not recorded, and a
  version that corrects only a metadata value is.
- **Spaces**, which hold components; fields, schemas and component types belong to none.
- **A load test for the version store**, run by hand, whose measured result is recorded with the plan.
- Nothing in the application creates or shows a version yet; this is the store the editor will use.
```

- [ ] **Step 10: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs/architecture.md docs/plans/README.md docs/design/storage-and-versioning.md docs/design/metadata.md CHANGELOG.md packages/trace/src/trace.test.ts
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.20.0: the version chain"
git push -u origin <branch>
gh pr create --base main --title "Build the version chain"
```

CI builds the service and worker images on the pull request. It is the first run in which the service
image's `pnpm deploy` carries `@alloy-works/domain` as a dependency of `@alloy-works/db`; check that job
rather than assuming it.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Iterations, the lock, and promotion** - `iteration`, `expires_at`, the sequence rules, `lock.held`,
  and the cut that promotes the latest iteration, checks the lock, loads `definitionsFor`, runs
  `carryForward` and then calls `recordVersion` (VER-001 to VER-006, COL). **The editor session plan.**
  That plan also decides whether the store refuses a component version whose component type differs
  from its predecessor's: component-editor.md refuses such an iteration, MET-014 makes changing a type
  an explicit act in T2, and this plan records whatever it is handed.
- **Revisions and designations** - `revision_designation`, the lifecycle service's gate, and the
  numbering of a version cut after a designation (VER-009, VER-012 to VER-016). **The revisions plan.**
- **Baselines** - `baseline`, `baseline_pin`, `baseline_value`, the condition set, and the foreign keys
  that make a pinned version undeletable (VER-017 to VER-023, MET-015's third clause). **The baselines
  plan.** `artifact_version`'s `on delete restrict` keys are already in place for it.
- **Restore, legal hold and retention** - VER-032, VER-033, VER-035 to VER-037, and VER-044, which the
  design does not yet answer. **Their own plans.**
- **Derived data** - `embedding`, keyed by content hash, block id, model and model version (VER-039,
  VER-040). **The search plan.** `content_hash` is already on every row for it.
- **The other artifact kinds** - documents, outlines, templates, assets, query definitions, style
  catalogues, themes and layouts, each by a migration widening `artifact`'s two checks when its content
  has a shape (VER-011).
- **Roles, grants, groups and `decide`**; who may create a space; the _General_ space every tenant starts
  with; a space's name folding. **The access plan.**
- **Every route and every screen** - `POST /v1/spaces/{space}/components`, `GET /v1/components/{id}`,
  `POST /v1/components/{id}/versions`, idempotency (API-008), and the error shape `version.unchanged`
  and `version.precondition` travel in. **The editor session plan**, with the service.
- **Erasure** (VER-038, VER-Q03): what is removed from a principal and what the record keeps.
- **A cold cache at a million components.** Task 5 measured a chain larger than Postgres's memory but not
  larger than the operating system's page cache; the latency of a million-component tenant whose chain
  is several times the machine's memory is still unmeasured, and belongs with the hosting decision.
- **Deduplicating content.** Every metadata-only version stores its content again. Task 5 measured what
  that costs; `content_hash` keeps extracting payloads a move rather than a migration when it is worth it.
